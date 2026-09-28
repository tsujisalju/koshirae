import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { randomUUID } from "crypto";
import { signAndSubmit } from "@koshirae/sdk";
import { ApiError, approveIntent, getIntent, reportSubmitted, submitIntent } from "../api";
import { operatorKeypair, suiClient } from "../client";
import { expectPrediction, expectStatus } from "./assert";
import { setupAgentCap } from "./setup";

export async function runFlaggedAndExpiredScenario() {
  const recipient = operatorKeypair.toSuiAddress();
  const { agentCapId, operatorCapId, lastDigest } = await setupAgentCap([recipient]);

  const intent = await submitIntent(
    agentCapId,
    {
      actionType: "transfer",
      coinType: SUI_TYPE_ARG,
      target: recipient,
      amount: "1000000",
      operatorCapId,
      idempotencyKey: randomUUID(),
      agentReportedRisk: 255,
      requestedPendingWindowMs: 5_000, // inside the 1 hr ceiling, deliberately short
    },
    lastDigest,
  );
  expectPrediction(intent, "flag", "submit");

  const submitDigest = await signAndSubmit(intent.unsignedTransaction, operatorKeypair, suiClient);
  const flagged = await reportSubmitted(intent.id, submitDigest);
  expectStatus(flagged, "pending_approval", "flagged on-chain");
  if (!flagged.expiresAt) throw new Error("Flagged intent has no expiresAt");

  const waitMs = Math.max(0, flagged.expiresAt - Date.now()) + 1_000;
  console.log(`Waiting ${waitMs}ms for the pending window to lapse...`);
  await new Promise((r) => setTimeout(r, waitMs));

  // Derived on read; nothing on-chain changed.
  expectStatus(await getIntent(intent.id), "expired", "after window");

  // The API refuses before building, so this never reaches a dry-run.
  try {
    await approveIntent(intent.id);
    throw new Error("UNEXPECTED: approval was built past expiry");
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "pending_action_expired") throw err;
    console.log(`Expected refusal: ${err.message}`);
  }
}
