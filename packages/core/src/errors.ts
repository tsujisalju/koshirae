import { z } from "zod";

// 400: the request is malformed.
// 403: the request is well-formed, but policy or authorization says no.
// 404: the thing referenced doesn't exist.
// 409: the request conflicts with current state (inactive, expired, stale, already done).
// 500: our fault.

export const ERROR_STATUS = {
  // request and lookup
  invalid_request: 400,
  not_found: 404,
  internal_error: 500,

  // policy denials
  not_owner: 403,
  action_not_allowed: 403,
  target_not_allowed: 403,
  coin_type_not_allowed: 403,
  over_tx_limit: 403,
  over_period_limit: 403,
  over_vault_tx_limit: 403,
  over_vault_period_limit: 403,
  operator_cap_revoked: 403, // stale_operator_cap
  operator_cap_wrong_agent_cap: 403,

  // state conflicts
  agent_cap_inactive: 409,
  agent_cap_expired: 409,
  wrong_vault: 409,
  pending_action_wrong_agent_cap: 409,
  coin_type_not_in_vault: 409,
  coin_type_already_allowed: 409,
  cannot_remove_protocol_target: 409,
  stale_nonce: 409,
  intent_not_pending_approval: 409,
  pending_action_not_recorded: 409,
  pending_action_expired: 409,
  pending_action_not_expired: 409,
  migration_required: 409,
  already_migrated: 409,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;
export const ErrorCode = z.enum(
  Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]],
);

export const ErrorResponse = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
