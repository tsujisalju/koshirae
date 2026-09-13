import { z } from "zod";
import { CoinAmount, CoinType, SuiAddress, SuiObjectID } from "./primitives";
import { ActionType } from "./action";

export const CoinLimitsInput = z.object({
  spendingLimitPerTx: CoinAmount,
  spendingLimitPeriod: CoinAmount,
});
export type CoinLimitsInput = z.infer<typeof CoinLimitsInput>;

export const CoinLimitsState = CoinLimitsInput.extend({
  periodSpent: CoinAmount,
  periodStartMs: z.number().int().nonnegative(),
});
export type CoinLimitsState = z.infer<typeof CoinLimitsState>;

// What owner supplies to create_agent_cap_for_vault
// owner, generation and vault_id is chain-assigned
export const AgentCapPolicyInput = z.object({
  vaultId: SuiObjectID,
  periodLengthMs: z.number().int().positive(),
  allowedActions: z.array(ActionType).min(1),
  allowedTargets: z.array(SuiAddress),
  protocolTargets: z.array(SuiAddress),
  riskThreshold: z.number().int().min(0).max(255),
  expiryMs: z.number().int().positive(),
});
export type AgentCapPolicyInput = z.infer<typeof AgentCapPolicyInput>;

// Full read-back state of an on-chain AgentCap
export const AgentCap = z.object({
  id: SuiObjectID,
  vaultId: SuiObjectID,
  owner: SuiAddress,
  generation: z.number().int().nonnegative(),
  periodLengthMs: z.number().int().positive(),
  limits: z.record(CoinType, CoinLimitsState),
  allowedActions: z.array(ActionType),
  allowedTargets: z.array(SuiAddress),
  protocolTargets: z.array(SuiAddress),
  riskThreshold: z.number().int().min(0).max(255),
  expiryMs: z.number().int().positive(),
  active: z.boolean(),
  lastNonce: z.number().int().nonnegative(),
});
export type AgentCap = z.infer<typeof AgentCap>;
