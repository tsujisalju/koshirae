import { z } from "zod";
import { ActionType } from "./policy";

export const IntentStatus = z.enum([
  "ready",
  "pending_approval",
  "approved",
  "denied",
  "failed",
]);

export type IntentStatus = z.infer<typeof IntentStatus>;
export const SubmitIntentRequest = z.object({
  actionType: ActionType,
  params: z.record(z.string(), z.unknown()),
  nonce: z.string(),
});
export type SubmitIntentRequest = z.infer<typeof SubmitIntentRequest>;

const Intent = z.object({
  id: z.string(),
  agentCapId: z.string(),
  status: IntentStatus,
  actionType: ActionType,
  params: z.record(z.string(), z.unknown()),
  txDigest: z.string().optional(),
  createdAt: z.number(),
});

export type Intent = z.infer<typeof Intent>;
