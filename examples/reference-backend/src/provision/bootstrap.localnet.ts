import { readFileSync } from "fs";
import { parse } from "smol-toml";
import { operatorKeypair, ownerKeypair, suiClient } from "../client";
import { normalizeStructTag, normalizeSuiObjectId } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";
import { signAndSubmit } from "@koshirae/sdk";
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";

const PUBFILE_PATH = process.env.PUBFILE_PATH ?? "../../move/Pub.localnet.toml";
const CETUS_FEE_TIER = { tickSpacing: 60, feeRate: 2500 }; // same tier as the testnet pool

interface PublishedEntry {
  source: { local: string };
  "published-at": string;
  "original-id": string;
}

function readPubfile() {
  const doc = parse(readFileSync(PUBFILE_PATH, "utf8")) as { published?: PublishedEntry[] };
  const entries = doc.published ?? [];
  const koshirae = entries.find((e) => e!.source.local.includes("/.move/git/"));
  const cetus = entries.find((e) => e.source.local.endsWith("/packages/cetus_clmm"));
  if (!koshirae || !cetus)
    throw new Error(`Could not find koshirae and cetus_clmm in ${PUBFILE_PATH}`);
  return {
    koshirae: { packageId: koshirae["published-at"], originalId: koshirae["original-id"] },
    cetus: { packageId: cetus["published-at"], originalId: cetus["original-id"] },
  };
}

async function findOwnedObjectId(
  owner: string,
  type: string,
): Promise<{ objectId: string; previousTransaction: string | null }> {
  const { objects } = await suiClient.core.listOwnedObjects({
    owner,
    type: normalizeStructTag(type),
    include: { previousTransaction: true },
  });
  if (objects.length === 0)
    throw new Error(`${owner} owns no ${type}. Did this address run test-publish?`);
  return { objectId: objects[0].objectId, previousTransaction: objects[0].previousTransaction };
}

// Get GlobalConfig and Pools created by Cetus' init functions
// in the same publish transaction,
async function findCetusSharedObjects(publishDigest: string, cetusOriginalId: string) {
  const result = await suiClient.core.getTransaction({
    digest: publishDigest,
    include: { effects: true, objectTypes: true },
  });
  const tx = result.Transaction ?? result.FailedTransaction;
  const created = (tx.effects?.changedObjects ?? []).filter((c) => c.idOperation === "Created");
  const typeOf = (id: string) => normalizeStructTag(tx.objectTypes?.[id] ?? "0x0::none::None");
  const find = (type: string) =>
    created.find((c) => typeOf(c.objectId) === normalizeStructTag(type))?.objectId;

  const globalConfigId = find(`${cetusOriginalId}::config::GlobalConfig`);
  const poolsId = find(`${cetusOriginalId}::factory::Pools`);
  if (!globalConfigId || !poolsId)
    throw new Error(`GlobalConfig/Pools not found in ${publishDigest}`);
  return { globalConfigId, poolsId };
}

// Cetus's init leaves pool creation unusable until the factory's permission
// manager exists, and only adds tick spacing 200. The deployer holds the
// pool-manager and fee-tier-manager roles needed for both calls.
async function initCetusFactory(cetusPackageId: string, globalConfigId: string, poolsId: string) {
  const steps: [string, (tx: Transaction) => void][] = [
    [
      "factory::init_manager_and_whitelist",
      (tx) =>
        tx.moveCall({
          target: `${cetusPackageId}::factory::init_manager_and_whitelist`,
          arguments: [tx.object(globalConfigId), tx.object(poolsId)],
        }),
    ],
    [
      `config::add_fee_tier(${CETUS_FEE_TIER.tickSpacing}`,
      (tx) =>
        tx.moveCall({
          target: `${cetusPackageId}::config::add_fee_tier`,
          arguments: [
            tx.object(globalConfigId),
            tx.pure.u32(CETUS_FEE_TIER.tickSpacing),
            tx.pure.u64(CETUS_FEE_TIER.feeRate),
          ],
        }),
    ],
  ];
  for (const [label, add] of steps) {
    const tx = new Transaction();
    tx.setSender(ownerKeypair.toSuiAddress());
    add(tx);
    try {
      const bytes = await tx.build({ client: suiClient });
      await signAndSubmit(Buffer.from(bytes).toString("base64"), ownerKeypair, suiClient);
      console.error(`  ${label}: done`);
    } catch (err) {
      // Both abort if already done, which is expected on a re-run
      console.error(` ${label}: skpped (${(err as Error).message.split("\n")[0]})`);
    }
  }
}

async function firstActiveValidator(): Promise<string> {
  const { response } = await suiClient.ledgerService.getEpoch({
    readMask: { paths: ["system_state.validators.active_validator.address"] },
  });
  const address = response.epoch?.systemState?.validators?.activeValidators[0]?.address;
  if (!address) throw new Error("No active validators found in the current epoch");
  return normalizeSuiObjectId(address);
}

async function main() {
  const owner = ownerKeypair.toSuiAddress();
  const { koshirae, cetus } = readPubfile();

  console.error("Funding owner and operator from the local faucet...");
  for (const recipient of [owner, operatorKeypair.toSuiAddress()]) {
    await requestSuiFromFaucetV2({ host: getFaucetHost("localnet"), recipient });
  }

  const treasuryCap = await findOwnedObjectId(
    owner,
    `0x2::coin::TreasuryCap<${koshirae.originalId}::mock_usdc::MOCK_USDC>`,
  );
  const cetusAdminCap = await findOwnedObjectId(owner, `${cetus.originalId}::config::AdminCap`);
  if (!cetusAdminCap.previousTransaction)
    throw new Error("Cetus AsminCap has no previous transaction");
  const { globalConfigId, poolsId } = await findCetusSharedObjects(
    cetusAdminCap.previousTransaction,
    cetus.originalId,
  );

  console.error("Initializing Cetis factory...");
  await initCetusFactory(cetus.packageId, globalConfigId, poolsId);

  const validator = await firstActiveValidator();

  // stdout is only the env block, so it can be appended to .env.localnet.
  // SUI_NETWORK and SUI_RPC_URL are already there (this script needs them).
  console.log(
    [
      `KOSHIRAE_PACKAGE_ID=${koshirae.packageId}`,
      `KOSHIRAE_ORIGINAL_PACKAGE_ID=${koshirae.originalId}`,
      `CETUS_PACKAGE_ID=${cetus.packageId}`,
      `CETUS_ORIGINAL_PACKAGE_ID=${cetus.originalId}`,
      `CETUS_GLOBAL_CONFIG_ID=${globalConfigId}`,
      `CETUS_POOLS_ID=${poolsId}`,
      `MOCK_USDC_TREASURY_CAP_ID=${treasuryCap.objectId}`,
      `VALIDATOR_ADDRESS=${validator}`,
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
