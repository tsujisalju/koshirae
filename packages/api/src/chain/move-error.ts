import { ErrorCode } from "@koshirae/core";

const CAPABILITY_ABORTS: Record<number, ErrorCode> = {
  0: "agent_cap_inactive",
  1: "agent_cap_expired",
  2: "action_not_allowed",
  3: "target_not_allowed",
  4: "over_tx_limit",
  5: "over_period_limit",
  6: "not_owner",
  7: "wrong_vault",
  8: "pending_action_wrong_agent_cap",
  9: "cannot_remove_protocol_target",
  10: "coin_type_not_allowed",
  11: "coin_type_not_in_vault",
  12: "coin_type_already_allowed",
  13: "operator_cap_wrong_agent_cap",
  14: "operator_cap_revoked",
  15: "over_vault_tx_limit",
  16: "over_vault_period_limit",
  17: "stale_nonce",
  18: "pending_action_expired",
  19: "pending_action_not_expired",
  20: "migration_required",
  21: "already_migrated",
};

// TODO: verify the exact abort message format the gRPC client produces for the match
export function capabilityAbortCode(err: unknown): ErrorCode | null {
  const text = String(err);
  if (!/MoveAbort/.test(text) || !/::capability::/.test(text)) return null;
  const match = /abort code: (\d+)/.exec(text);
  return match ? (CAPABILITY_ABORTS[Number(match[1])] ?? null) : null;
}
