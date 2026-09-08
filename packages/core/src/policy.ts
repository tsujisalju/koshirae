import { z } from "zod";

export const ActionType = z.enum(["swap", "transfer", "deposit", "withdraw"]);
export type ActionType = z.infer<typeof ActionType>;

export const Policy = z.object({
  allowedActions: z.array(ActionType).min(1),
  spendingLimit: z.object({
    amount: z.string(),
    coinType: z.string(),
  }),
  riskThreshold: z.number().min(0).max(1),
  expiry: z.number().int().positive(),
});

export type Policy = z.infer<typeof Policy>;
