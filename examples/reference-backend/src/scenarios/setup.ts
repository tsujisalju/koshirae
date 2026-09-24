import { signAndSubmit, withVersionRaceRetry } from "@koshirae/sdk";
import { Transaction } from "@mysten/sui/transactions";
import {
  addAgentCapCoinLimits,
  addVaultCoinLimits,
  createAgentCapWithVault,
  mintOperatorCap,
} from "../api";
import {
  KOSHIRAE_PACKAGE_ID,
  operatorKeypair,
  ownerKeypair,
  suiClient,
} from "../client";
import { extractCreatedObjectId } from "../extract-created-id";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { CoinLimitsInput } from "@koshirae/core";

interface ExtraCoinLimit {
  coinType: string;
  limits: CoinLimitsInput;
}

const DEFAULT_LIMITS = {
  spendingLimitPerTx: "1000000000",
  spendingLimitPeriod: "5000000000",
};

const DEPOSIT_AMOUNT = 100_000_000n; // 0.1 SUI (owner wallet is small)

const sign = (base64Tx: string) =>
  signAndSubmit(base64Tx, ownerKeypair, suiClient);

export async function setupAgentCap(
  allowedTargets: string[],
  extraCoinLimits: ExtraCoinLimit[] = [],
) {
  const createDigest = await withVersionRaceRetry(
    () =>
      createAgentCapWithVault({
        owner: ownerKeypair.toSuiAddress(),
        vault: { periodLengthMs: 86_400_000 },
        agentCap: {
          periodLengthMs: 86_400_000,
          allowedActions: ["transfer", "mockSwap", "stake", "cetusSwap"],
          allowedTargets,
          protocolTargets: [],
          riskThreshold: 50,
          expiryMs: Date.now() + 30 * 24 * 60 * 60 * 1000,
          maxPendingWindowMs: 3_600_000,
        },
      }),
    sign,
  );

  const [agentCapId, vaultId] = await Promise.all([
    extractCreatedObjectId(
      createDigest,
      `${KOSHIRAE_PACKAGE_ID}::capability::AgentCap`,
    ),
    extractCreatedObjectId(
      createDigest,
      `${KOSHIRAE_PACKAGE_ID}::capability::Vault`,
    ),
  ]);
  if (!agentCapId || !vaultId)
    throw new Error(
      `Could not find created AgentCap/Vault (digest: ${createDigest})`,
    );

  const mintDigest = await withVersionRaceRetry(
    () =>
      mintOperatorCap(agentCapId, operatorKeypair.toSuiAddress(), createDigest),
    sign,
  );

  const operatorCapId = await extractCreatedObjectId(
    mintDigest,
    `${KOSHIRAE_PACKAGE_ID}::operator_cap::OperatorCap`,
  );
  if (!operatorCapId) throw new Error("Could not find created OperatorCap");

  await withVersionRaceRetry(
    () =>
      addAgentCapCoinLimits(
        agentCapId,
        SUI_TYPE_ARG,
        DEFAULT_LIMITS,
        mintDigest,
      ),
    sign,
  );
  const vaultLimitsDigest = await withVersionRaceRetry(
    () =>
      addVaultCoinLimits(vaultId, SUI_TYPE_ARG, DEFAULT_LIMITS, createDigest),
    sign,
  );

  for (const { coinType, limits } of extraCoinLimits) {
    await withVersionRaceRetry(
      () => addAgentCapCoinLimits(agentCapId, coinType, limits, mintDigest),
      sign,
    );
    await withVersionRaceRetry(
      () => addVaultCoinLimits(vaultId, coinType, limits, createDigest),
      sign,
    );
  }

  // The vault starts empty and execute_action draws from vault.balances, so
  // fund it (owner-signed, built locally — no API route for deposit).
  await suiClient.core.waitForTransaction({ digest: vaultLimitsDigest });
  const depositDigest = await withVersionRaceRetry(async () => {
    const tx = new Transaction();
    tx.setSender(ownerKeypair.toSuiAddress());
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(DEPOSIT_AMOUNT)]);
    tx.moveCall({
      target: `${KOSHIRAE_PACKAGE_ID}::capability::deposit`,
      typeArguments: [SUI_TYPE_ARG],
      arguments: [tx.object(vaultId), coin],
    });
    const bytes = await tx.build({ client: suiClient });
    return { unsignedTransaction: Buffer.from(bytes).toString("base64") };
  }, sign);

  return { agentCapId, vaultId, operatorCapId, lastDigest: depositDigest };
}
