const MOVE_ABORT_MAP: Record<number, { status: number; error: string }> = {
    0: { status: 409, error: "agent_cap_inactive" },
    1: { status: 409, error: "agent_cap_expired" },
    2: { status: 403, error: "action_not_allowed" },
    3: { status: 403, error: "target_not_allowed" },
    4: { status: 403, error: "over_tx_limit" },
    5: { status: 403, error: "over_period_limit" },
    6: { status: 403, error: "not_owner" },
    7: { status: 409, error: "wrong_vault" },
    8: { status: 409, error: "wrong_cap" },
    9: { status: 400, error: "cannot_remove_protocol_target" },
    10: { status: 403, error: "coin_type_not_allowed" },
    11: { status: 400, error: "coin_type_not_in_vault" },
    12: { status: 409, error: "coin_type_already_allowed" },
    13: { status: 403, error: "wrong_agent_cap" },
    14: { status: 403, error: "stale_operator_generation" },
    15: { status: 403, error: "over_vault_tx_limit" },
    16: { status: 403, error: "over_vault_period_limit" },
    17: { status: 409, error: "stale_nonce" },
    18: { status: 409, error: "pending_action_expired" },
    19: { status: 409, error: "not_expired_yet" },
    20: { status: 409, error: "migration_required" },
    21: { status: 409, error: "already_migrated" },
};

export function moveAbortResponse(
    err: unknown,
): { status: number; body: { error: string } } | null {
    const match = /MoveAbort[^]*abort code: (\d+)/.exec(String(err));
    if (!match) return null;
    const mapped = MOVE_ABORT_MAP[Number(match[1])];
    if (!mapped) return null;
    return { status: mapped.status, body: { error: mapped.error } };
}
