import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { randomUUID } from "crypto";
import { signAndSubmit } from "@koshirae/sdk";
import { rejectIntent, reportSubmitted, submitIntent } from "../api";
import { operatorKeypair, ownerKeypair, suiClient } from "../client";
import { expectPrediction, expectStatus } from "./assert";
import { setupAgentCap } from "./setup";

export async function runFlaggedAndRejectScenario() {
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
    },
    lastDigest,
  );
  expectPrediction(intent, "flag", "submit");

  const submitDigest = await signAndSubmit(intent.unsignedTransaction, operatorKeypair, suiClient);
  expectStatus(
    await reportSubmitted(intent.id, submitDigest),
    "pending_approval",
    "flagged on-chain",
  );

  const rejection = await rejectIntent(intent.id);
  const rejectDigest = await signAndSubmit(rejection.unsignedTransaction, ownerKeypair, suiClient);
  expectStatus(await reportSubmitted(intent.id, rejectDigest), "denied", "rejected");
}
