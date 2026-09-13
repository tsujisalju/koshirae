import { AgentCap, SubmitIntentRequest } from "@oronyx/core";

export interface RiskContent {
  agentCap: AgentCap;
  request: SubmitIntentRequest;
}

export type RiskEvaluator = (ctx: RiskContent) => number;

const SUI_TYPE_ARG = "0x2::sui::SUI";

export const mechanicalRiskEvaluator: RiskEvaluator = ({
  agentCap,
  request,
}) => {
  const coinType =
    request.actionType === "stake" ? SUI_TYPE_ARG : request.coinType;
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
