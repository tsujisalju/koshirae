import type { Intent, IntentStatus, PredictedOutcome } from "@koshirae/core";

// Scenario assertions fail loudly instead of logging "expected" and moving on,
// so a scenario can't pass while testing something other than what it claims.
export function expectStatus(intent: Intent, expected: IntentStatus, step: string): void {
  if (intent.status !== expected)
    throw new Error(
      `${step}: expected status "${expected}", got "${intent.status}" (intent ${intent.id})`,
    );
  console.log(`${step}: status ${intent.status}`);
}

export function expectPrediction(intent: Intent, expected: PredictedOutcome, step: string): void {
  if (intent.predictedOutcome !== expected)
    throw new Error(
      `${step}: expected predictedOutcome "${expected}", got "${intent.predictedOutcome}" (risk ${intent.riskScore})`,
    );
  console.log(`${step}: predicted ${intent.predictedOutcome} (risk ${intent.riskScore})`);
}
