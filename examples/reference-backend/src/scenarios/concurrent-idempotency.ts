// Two submits with the same idempotency key, fired at the same moment, race
// on the same unique index the sequential idempotency scenario never touches.
// Confirms uniqueViolation() recognizes Drizzle's wrapped postgres.js 23505
// error and the loser replays the winner instead of surfacing a 500.

import { randomUUID } from "crypto";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { submitIntent } from "../api";
import { operatorKeypair } from "../client";
import { setupAgentCap } from "./setup";

export async function runConcurrentIdempotencyScenario() {
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

  const [first, second] = await Promise.all([
    submitIntent(agentCapId, args, lastDigest),
    submitIntent(agentCapId, args, lastDigest),
  ]);

  if (first.id !== second.id)
    throw new Error(`Concurrent submits raced into two intent ids (${first.id} vs ${second.id})`);
  if (first.nonce !== second.nonce)
    throw new Error(`Nonce not pinned across race: ${first.nonce} vs ${second.nonce}`);
  console.log(`Race resolved to one intent: ${first.id}, nonce ${first.nonce}`);
}
