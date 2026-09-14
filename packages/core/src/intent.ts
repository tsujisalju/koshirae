import { z } from "zod";
import { CoinAmount, CoinType, SuiAddress, SuiObjectID } from "./primitives";

const baseIntentFields = {
  target: SuiAddress,
  amount: CoinAmount,
  operatorCapId: SuiObjectID,
  agentReportedRisk: z.number().int().min(0).max(255).optional(),
};

export const SubmitIntentRequest = z.discriminatedUnion("actionType", [
  z.object({
    actionType: z.literal("transfer"),
    coinType: CoinType,
    idempotencyKey: z.string(),
    ...baseIntentFields,
  }),
  z.object({
    actionType: z.literal("mockSwap"),
    coinType: CoinType,
    idempotencyKey: z.string(),
    ...baseIntentFields,
  }),
  z.object({
    actionType: z.literal("stake"),
    idempotencyKey: z.string(),
    ...baseIntentFields,
  }), //No coinType, always SUI
  z.object({
    actionType: z.literal("cetusSwap"),
    coinType: CoinType,
    idempotencyKey: z.string(),
    ...baseIntentFields,
  }),
]);
export type SubmitIntentRequest = z.infer<typeof SubmitIntentRequest>;

export const IntentStatus = z.enum([
  "ready",
  "pending_approval",
  "approved",
  "denied",
  "executed",
  "failed",
]);
export type IntentStatus = z.infer<typeof IntentStatus>;

export const Intent = z.object({
  id: z.string(),
  agentCapId: SuiObjectID,
  status: IntentStatus,
  request: SubmitIntentRequest,
  riskScore: z.number().int().min(0).max(255).optional(),
  txDigest: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  pendingActionId: z.string().optional(),
});
export type Intent = z.infer<typeof Intent>;
