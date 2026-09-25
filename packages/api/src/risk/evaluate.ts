import { AgentCap, SubmitIntentRequest } from "@koshirae/core";
import { resolveIntentCoinType } from "../intent-coin-type";

export interface RiskContext {
    agentCap: AgentCap;
    request: SubmitIntentRequest;
}

export type RiskEvaluator = (ctx: RiskContext) => number;

const evaluators: RiskEvaluator[] = [
    //previous amount proportion and target novelty valuation have moved on-chain.
    // velocity, history, and future risk models go here
];

// returns the highest result across all evaluators
export function reportedRisk(ctx: RiskContext): number {
    const scores = evaluators.map((e) => e(ctx));
    if (ctx.request.agentReportedRisk !== undefined)
        scores.push(ctx.request.agentReportedRisk);
    return Math.min(Math.max(0, ...scores), 255);
}

// Mirrors the risk floor formula on-chain as a predictor.
// The API still needs to tell the caller at submit time whether
// and intent will be ready or pending_approval
export const mechanicalRiskEvaluator: RiskEvaluator = ({
    agentCap,
    request,
}) => {
    const coinType = resolveIntentCoinType(request);
    const limits = agentCap.limits[coinType];

    let score = 0;
    if (limits) {
        const amount = BigInt(request.amount);
        const perTxLimit = BigInt(limits.spendingLimitPerTx);
        const proportion =
            perTxLimit > 0n ? Number((amount * 180n) / perTxLimit) : 180;
        score += Math.min(proportion, 180);
    }

    if (!agentCap.protocolTargets.includes(request.target)) {
        score += 20;
    }

    if (request.agentReportedRisk !== undefined) {
        score = Math.max(score, request.agentReportedRisk);
    }
    return Math.min(score, 255);
};
