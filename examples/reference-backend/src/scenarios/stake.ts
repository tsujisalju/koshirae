import { randomUUID } from "crypto";
import { reportSubmitted, submitIntent } from "../api";
import { setupAgentCap } from "./setup";
import { signAndSubmit } from "@koshirae/sdk";
import { operatorKeypair, suiClient } from "../client";
import { expectPrediction, expectStatus } from "./assert";

const VALIDATOR_ADDRESS = process.env.VALIDATOR_ADDRESS!;

export async function runStakeScenario() {
  // A 1 SUI stake equals the per-tx limit (risk 180), so the validator is a
  // protocol target (no +20) and the threshold sits above 180. The vault
  // needs more than the default 0.1 SUI deposit to fund the stake.
  const { agentCapId, operatorCapId, lastDigest } = await setupAgentCap([VALIDATOR_ADDRESS], [], {
    protocolTargets: [VALIDATOR_ADDRESS],
    riskThreshold: 200,
    depositAmount: 1_100_000_000n,
  });
  const intent = await submitIntent(
    agentCapId,
    {
      actionType: "stake",
      target: VALIDATOR_ADDRESS,
      amount: "1000000000", // 1 SUI, minimum stake amount
      operatorCapId,
      idempotencyKey: randomUUID(),
    },
    lastDigest,
  );
  // Every fresh intent is "ready"; what matters is that it won't be flagged.
  expectPrediction(intent, "execute", "submit");
  const digest = await signAndSubmit(intent.unsignedTransaction, operatorKeypair, suiClient);
  expectStatus(await reportSubmitted(intent.id, digest), "executed", "staked");
}
