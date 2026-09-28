// The submit executes on-chain but its report never reaches the API. Replaying
// the idempotency key must settle the executed transaction and return
// "executed", not hand out a fresh build that would spend a second time.

import { randomUUID } from "crypto";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { signAndSubmit } from "@koshirae/sdk";
import { submitIntent } from "../api";
import { operatorKeypair, suiClient } from "../client";
import { expectStatus } from "./assert";
import { setupAgentCap } from "./setup";

export async function runLostReportScenario() {
  const recipient = operatorKeypair.toSuiAddress();
  const { agentCapId, operatorCapId, lastDigest } = await setupAgentCap([recipient]);

  const args = {
    actionType: "transfer" as const,
    coinType: SUI_TYPE_ARG,
    target: recipient,
    amount: "1000000",
    operatorCapId,
    idempotencyKey: randomUUID(),
  };
  const intent = await submitIntent(agentCapId, args, lastDigest);
  const digest = await signAndSubmit(intent.unsignedTransaction, operatorKeypair, suiClient);
  console.log(`Executed ${digest} without reporting it`);
  await suiClient.core.waitForTransaction({ digest });

  // Deliberately no reportSubmitted here.
  const replay = await submitIntent(agentCapId, args, digest);
  expectStatus(replay, "executed", "replay after lost report");
  if (replay.submitDigest !== digest)
    throw new Error(`Expected submitDigest ${digest}, got ${replay.submitDigest}`);
  if ("unsignedTransaction" in replay)
    throw new Error("Replay of a settled intent returned a new transaction to sign");
  console.log("Lost report recovered; no second transaction issued");
}
