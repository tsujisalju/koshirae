import {
  addAgentCapCoinLimits,
  addVaultCoinLimits,
  createAgentCapWithVault,
  mintOperatorCap,
} from "../api";
import { KOSHIRAE_PACKAGE_ID, operatorKeypair, ownerKeypair } from "../client";
import { extractCreatedObjectId } from "../extract-created-id";
import { signSubmitAndReport } from "../sign-and-submit";

const SUI_TYPE = "0x2::sui::SUI";
const DEFAULT_LIMITS = {
  spendingLimitPerTx: "1000000000",
  spendingLimitPeriod: "5000000000",
};

export async function setupAgentCap(allowedTargets: string[]) {
  const { unsignedTransaction } = await createAgentCapWithVault({
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
  });
  const setupDigest = await signSubmitAndReport(
    unsignedTransaction,
    ownerKeypair,
  );

  const [agentCapId, vaultId] = await Promise.all([
    extractCreatedObjectId(
      setupDigest,
      `${KOSHIRAE_PACKAGE_ID}::capability::AgentCap`,
    ),
    extractCreatedObjectId(
      setupDigest,
      `${KOSHIRAE_PACKAGE_ID}::capability::Vault`,
    ),
  ]);
  if (!agentCapId || !vaultId)
    throw new Error("Could not find created AgentCap/Vault");

  const mintDigest = await signSubmitAndReport(
    (await mintOperatorCap(agentCapId, operatorKeypair.toSuiAddress()))
      .unsignedTransaction,
    ownerKeypair,
  );
  const operatorCapId = await extractCreatedObjectId(
    mintDigest,
    `${KOSHIRAE_PACKAGE_ID}::capability::OperatorCap`,
  );
  if (!operatorCapId) throw new Error("Could not find created OperatorCap");

  await signSubmitAndReport(
    (await addAgentCapCoinLimits(agentCapId, SUI_TYPE, DEFAULT_LIMITS))
      .unsignedTransaction,
    ownerKeypair,
  );
  await signSubmitAndReport(
    (await addVaultCoinLimits(vaultId, SUI_TYPE, DEFAULT_LIMITS))
      .unsignedTransaction,
    ownerKeypair,
  );

  return { agentCapId, vaultId, operatorCapId };
}
