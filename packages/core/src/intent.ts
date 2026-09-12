import { z } from "zod";
import { CoinAmount, CoinType, SuiAddress, SuiObjectID } from "./primitives";

const baseIntentFields = {
  target: SuiAddress,
  amount: CoinAmount,
};

export const SubmitIntentRequest = z.discriminatedUnion("actionType", [
  z.object({
    actionType: z.literal("transfer"),
    coinType: CoinType,
    ...baseIntentFields,
  }),
  z.object({
    actionType: z.literal("mockSwap"),
    coinType: CoinType,
    ...baseIntentFields,
  }),
  z.object({ actionType: z.literal("stake"), ...baseIntentFields }), //No coinType, always SUI
  z.object({
    actionType: z.literal("cetusSwap"),
    coinType: CoinType,
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
});
export type Intent = z.infer<typeof Intent>;
