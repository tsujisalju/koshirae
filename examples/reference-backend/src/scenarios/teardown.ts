import { bcs } from "@mysten/sui/bcs";
import { ObjectError } from "@mysten/sui/client";
import {
  normalizeStructTag,
  SUI_SYSTEM_ADDRESS,
  SUI_SYSTEM_STATE_OBJECT_ID,
} from "@mysten/sui/utils";
import { KOSHIRAE_PACKAGE_ID, ownerKeypair, suiClient } from "../client";
import { signAndSubmit, withVersionRaceRetry } from "@koshirae/sdk";
import { Transaction } from "@mysten/sui/transactions";

interface Registered {
  vaultId: string;
  coinTypes: string[];
}

const registered: Registered[] = [];
const registeredStakes: string[] = [];

export function registerForTeardown(vaultId: string, coinTypes: string[]): void {
  registered.push({ vaultId, coinTypes });
}

export function registerStakeForTeardown(stakedSuiId: string): void {
  registeredStakes.push(stakedSuiId);
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

  const key = TypeNameKey.serialize({ name: typeNameFor(coinType) }).toBytes();
  try {
    const { dynamicField } = await suiClient.core.getDynamicField({
      parentId: bagId,
      name: { type: "0x1::type_name::TypeName", bcs: key },
    });
    return BigInt(bcs.u64().parse(dynamicField.value.bcs));
  } catch (err) {
    // No entry means the coin was never deposited; anything else is a failed read.
    if (!(err instanceof ObjectError && err.reason === "notFound")) {
      console.error(
        ` teardown: read of ${coinType} on ${vaultId} failed (${(err as Error).message.split("\n")[0]})`,
      );
    }
    return 0n;
  }
}

async function submitAsOwner(addCalls: (tx: Transaction) => void): Promise<void> {
  await withVersionRaceRetry(
    async () => {
      const tx = new Transaction();
      tx.setSender(ownerKeypair.toSuiAddress());
      addCalls(tx);
      const bytes = await tx.build({ client: suiClient });
      return { unsignedTransaction: Buffer.from(bytes).toString("base64") };
    },
    (b64) => signAndSubmit(b64, ownerKeypair, suiClient),
  );
}

async function withdrawAll(vaultId: string, coinType: string): Promise<void> {
  const amount = await readVaultBalance(vaultId, coinType);
  if (amount === 0n) return;
  await submitAsOwner((tx) => {
    const coin = tx.moveCall({
      target: `${KOSHIRAE_PACKAGE_ID}::capability::withdraw`,
      typeArguments: [coinType],
      arguments: [tx.object(vaultId), tx.pure.u64(amount)],
    });
    tx.transferObjects([coin], ownerKeypair.toSuiAddress());
  });
  console.error(` teardown: recovered ${amount} of ${coinType} from ${vaultId}`);
}

// The entry function sends the withdrawn SUI to the sender, who owns the StakedSui.
async function unstake(stakedSuiId: string): Promise<void> {
  await submitAsOwner((tx) => {
    tx.moveCall({
      target: `${SUI_SYSTEM_ADDRESS}::sui_system::request_withdraw_stake`,
      arguments: [tx.object(SUI_SYSTEM_STATE_OBJECT_ID), tx.object(stakedSuiId)],
    });
  });
  console.error(` teardown: unstaked ${stakedSuiId}`);
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
  for (const stakedSuiId of registeredStakes.splice(0)) {
    try {
      await unstake(stakedSuiId);
    } catch (err) {
      console.error(
        ` teardown: unstake of ${stakedSuiId} skipped (${(err as Error).message.split("\n")[0]})`,
      );
    }
  }
}
