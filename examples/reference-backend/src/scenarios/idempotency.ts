// Replaying an idempotency key returns the same intent with the same pinned
// nonce. Each replay of a still-ready intent is a fresh build (current object
// versions), but every build shares that nonce, so at most one can execute.
// Nothing here gets signed.

import { randomUUID } from "crypto";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { submitIntent } from "../api";
import { operatorKeypair } from "../client";
import { setupAgentCap } from "./setup";

export async function runIdempotencyScenario() {
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
  const first = await submitIntent(agentCapId, args, lastDigest);
  const second = await submitIntent(agentCapId, args, lastDigest);

  if (first.id !== second.id)
    throw new Error(`Idempotency failed: two intent ids (${first.id} vs ${second.id})`);
  if (first.nonce !== second.nonce)
    throw new Error(`Nonce not pinned: ${first.nonce} vs ${second.nonce}`);
  console.log(`Idempotency confirmed: intent ${first.id}, nonce ${first.nonce} on both builds`);
}
