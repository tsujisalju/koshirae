// Reporting a digest against an intent it wasn't issued for must be refused,
// even when that digest is a real, successful Koshirae transaction.

import { randomUUID } from "crypto";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { signAndSubmit } from "@koshirae/sdk";
import { ApiError, getIntent, reportSubmitted, submitIntent } from "../api";
import { operatorKeypair, suiClient } from "../client";
import { expectStatus } from "./assert";
import { setupAgentCap } from "./setup";

export async function runForeignDigestScenario() {
  const recipient = operatorKeypair.toSuiAddress();
  const { agentCapId, operatorCapId, lastDigest } = await setupAgentCap([recipient]);

  const request = () => ({
    actionType: "transfer" as const,
    coinType: SUI_TYPE_ARG,
    target: recipient,
    amount: "1000000",
    operatorCapId,
    idempotencyKey: randomUUID(),
  });
  const intentA = await submitIntent(agentCapId, request(), lastDigest);
  const digestA = await signAndSubmit(intentA.unsignedTransaction, operatorKeypair, suiClient);
  expectStatus(await reportSubmitted(intentA.id, digestA), "executed", "intent A");

  const intentB = await submitIntent(agentCapId, request(), digestA);
  try {
    await reportSubmitted(intentB.id, digestA);
    throw new Error("UNEXPECTED: intent B accepted intent A's digest");
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "digest_not_issued") throw err;
    console.log(`Expected refusal: ${err.message}`);
  }
  expectStatus(await getIntent(intentB.id), "ready", "intent B unchanged");
}
