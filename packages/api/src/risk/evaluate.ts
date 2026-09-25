import { AgentCap, SubmitIntentRequest } from "@koshirae/core";

export interface RiskContext {
    agentCap: AgentCap;
    request: SubmitIntentRequest;
}

export type RiskEvaluator = (ctx: RiskContext) => number;

// The mechanical floor (amount proportion, target novelty) is computed
// on-chain and cannot be lowered by anything reported here. Only advisory
// signals (velocity, history, future models) belong in this list.
const evaluators: RiskEvaluator[] = [];

// Highest advisory score, sent on-chain as `reported_risk`.
export function reportedRisk(ctx: RiskContext): number {
    const scores = evaluators.map((e) => e(ctx));
    if (ctx.request.agentReportedRisk !== undefined)
        scores.push(ctx.request.agentReportedRisk);
    return Math.min(Math.max(0, ...scores), 255);
}
