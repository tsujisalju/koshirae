// cetus-swap.ts only covers the happy path, and flagged-and-approve.ts only
// covers transfer, so neither exercises approve_and_finish_cetus_swap_* --
// the Move call whose typeArguments fix in build-approval.ts is untested.
// Forcing a flag on a Cetus swap and then approving it exercises exactly that.

import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { randomUUID } from "crypto";
import { signAndSubmit } from "@koshirae/sdk";
import { approveIntent, reportSubmitted, submitIntent } from "../api";
import { KOSHIRAE_PACKAGE_ID, operatorKeypair, ownerKeypair, suiClient } from "../client";
import { expectPrediction, expectStatus } from "./assert";
import { setupAgentCap } from "./setup";

const MOCK_USDC_TYPE = `${KOSHIRAE_PACKAGE_ID}::mock_usdc::MOCK_USDC`;
const CETUS_POOL_ID = process.env.CETUS_POOL_ID!;
const DEFAULT_LIMITS = { spendingLimitPerTx: "1000000000", spendingLimitPeriod: "5000000000" };

export async function runCetusSwapFlaggedApproveScenario() {
  const { agentCapId, operatorCapId, lastDigest } = await setupAgentCap(
    [CETUS_POOL_ID],
    [{ coinType: MOCK_USDC_TYPE, limits: DEFAULT_LIMITS }],
  );

  const intent = await submitIntent(
    agentCapId,
    {
      actionType: "cetusSwap",
      coinTypeIn: SUI_TYPE_ARG,
      target: CETUS_POOL_ID,
      amount: "50000000", // 0.05 SUI
      operatorCapId,
      idempotencyKey: randomUUID(),
      agentReportedRisk: 255,
    },
    lastDigest,
  );
  expectStatus(intent, "ready", "submit");
  expectPrediction(intent, "flag", "submit");

  const submitDigest = await signAndSubmit(intent.unsignedTransaction, operatorKeypair, suiClient);
  expectStatus(
    await reportSubmitted(intent.id, submitDigest),
    "pending_approval",
    "flagged on-chain",
  );

  const approval = await approveIntent(intent.id);
  const approveDigest = await signAndSubmit(approval.unsignedTransaction, ownerKeypair, suiClient);
  if (approveDigest !== approval.digest)
    throw new Error(`Signed digest ${approveDigest} != issued digest ${approval.digest}`);
  expectStatus(await reportSubmitted(intent.id, approveDigest), "executed", "approved");
}
