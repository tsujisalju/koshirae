import { Transaction } from "@mysten/sui/transactions";
import { signAndSubmit } from "@koshirae/sdk";
import { ObjectError } from "@mysten/sui/client";
import { normalizeStructTag } from "@mysten/sui/utils";
import { ownerKeypair, suiClient, KOSHIRAE_ORIGINAL_PACKAGE_ID, KOSHIRAE_PACKAGE_ID } from "../client";
import { extractCreatedObjectId } from "../extract-created-id";

const MOCK_USDC_TREASURY_CAP_ID = process.env.MOCK_USDC_TREASURY_CAP_ID!;

// A MOCK_POOL_ID left over from an earlier chain or package must not count, so
// check it on chain; anything but "not found" is rethrown rather than risk a duplicate.
async function existingMockPool(): Promise<string | undefined> {
  const id = process.env.MOCK_POOL_ID;
  if (!id) return undefined;
  try {
    const { object } = await suiClient.core.getObject({ objectId: id });
    const expected = normalizeStructTag(`${KOSHIRAE_ORIGINAL_PACKAGE_ID}::mock_dex::MockPool`);
    return normalizeStructTag(object.type) === expected ? id : undefined;
  } catch (err) {
    if (err instanceof ObjectError && err.reason === "notFound") return undefined;
    throw err;
  }
}

async function main() {
  const existing = await existingMockPool();
  if (existing) {
    console.error(`Mock pool: skipped (${existing} already exists)`);
    console.log(`MOCK_POOL_ID=${existing}`);
    return;
  }

  const tx = new Transaction();
  tx.setSender(ownerKeypair.toSuiAddress());

  const mockUsdc = tx.moveCall({
    target: `${KOSHIRAE_PACKAGE_ID}::mock_usdc::mint_mock_usdc`,
    arguments: [tx.object(MOCK_USDC_TREASURY_CAP_ID), tx.pure.u64(1_000_000_000)],
  });
  const [sui] = tx.splitCoins(tx.gas, [tx.pure.u64(1_000_000_000)]);
  tx.moveCall({
    target: `${KOSHIRAE_PACKAGE_ID}::mock_dex::create_pool`,
    arguments: [sui, mockUsdc, tx.pure.u64(950_000)], // matches the rate used throughout the Move test suite
  });

  const bytes = await tx.build({ client: suiClient });
  const digest = await signAndSubmit(
    Buffer.from(bytes).toString("base64"),
    ownerKeypair,
    suiClient,
  );
  const poolId = await extractCreatedObjectId(digest, "::mock_dex::MockPool");
  if (!poolId) throw new Error(`Could not find created MockPool (digest: ${digest})`);
  console.error("Mock pool created");
  console.log(`MOCK_POOL_ID=${poolId}`);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
