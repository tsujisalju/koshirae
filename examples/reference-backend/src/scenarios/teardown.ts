import { bcs } from "@mysten/sui/bcs";
import { normalizeStructTag } from "@mysten/sui/utils";
import { KOSHIRAE_PACKAGE_ID, ownerKeypair, suiClient } from "../client";
import { signAndSubmit, withVersionRaceRetry } from "@koshirae/sdk";
import { Transaction } from "@mysten/sui/transactions";

interface Registered {
  vaultId: string;
  coinTypes: string[];
}

const registered: Registered[] = [];

export function registerForTeardown(vaultId: string, coinTypes: string[]): void {
  registered.push({ vaultId, coinTypes });
}

const TypeNameKey = bcs.struct("TypeName", { name: bcs.string() });

function typeNameFor(coinType: string): string {
  return normalizeStructTag(coinType).replace(/^0x/, "");
}

async function readVaultBalance(vaultId: string, coinType: string): Promise<bigint> {
  const vault = await suiClient.core.getObject({ objectId: vaultId, include: { json: true } });
  // Read by field name so a Vault layout change can't make us decode wrong bytes.
  const bagId = (vault.object.json as { balances?: { id?: string } } | null)?.balances?.id;
  if (!bagId) throw new Error(`Vault ${vaultId} has no balances.id in its JSON`);

  try {
    const { dynamicField } = await suiClient.core.getDynamicField({
      parentId: bagId,
      name: {
        type: "0x1::type_name::TypeName",
        bcs: TypeNameKey.serialize({ name: typeNameFor(coinType) }).toBytes(),
      },
    });
    return BigInt(bcs.u64().parse(dynamicField.value.bcs));
  } catch {
    return 0n;
  }
}

async function withdrawAll(vaultId: string, coinType: string): Promise<void> {
  const amount = await readVaultBalance(vaultId, coinType);
  if (amount === 0n) return;
  await withVersionRaceRetry(
    async () => {
      const tx = new Transaction();
      tx.setSender(ownerKeypair.toSuiAddress());
      const coin = tx.moveCall({
        target: `${KOSHIRAE_PACKAGE_ID}::capability::withdraw`,
        typeArguments: [coinType],
        arguments: [tx.object(vaultId), tx.pure.u64(amount)],
      });
      tx.transferObjects([coin], ownerKeypair.toSuiAddress());
      const bytes = await tx.build({ client: suiClient });
      return { unsignedTransaction: Buffer.from(bytes).toString("base64") };
    },
    (b64) => signAndSubmit(b64, ownerKeypair, suiClient),
  );
  console.error(` teardown: recovered ${amount} of ${coinType} from ${vaultId}`);
}

// Never throws: teardown must not mask the scenario's own result
export async function teardownAll(): Promise<void> {
  const batch = registered.splice(0);
  for (const { vaultId, coinTypes } of batch) {
    for (const coinType of coinTypes) {
      try {
        await withdrawAll(vaultId, coinType);
      } catch (err) {
        console.error(
          ` teardown: ${coinType} on ${vaultId} skipped (${(err as Error).message.split("\n")[0]})`,
        );
      }
    }
  }
}
