"""Epoch-aware validator-set trigger check for the stake decision path.

Polled on a coarse fixed interval (STAKE_TRIGGER_INTERVAL_HOURS in
main.py) rather than a push-based epoch-change signal — pysui's gRPC
surface exposes GetLatestSuiSystemStateSC (current epoch + validator set)
but no dedicated "epoch changed" subscription, so this only proceeds past
the epoch check when the epoch number has actually advanced since last
poll.
"""

import logging

from app.models.policy import ActionType, StakeDecision
from app.services import (
    activity_log,
    agent_index,
    executor,
    sui_objects,
    validator_data,
)
from app.services.llm import decide_agent_action

logger = logging.getLogger(__name__)

# 1 SUI — below this, execute_stake always aborts on-chain (capability.move),
# so there's no point proposing a stake decision at all.
MIN_STAKING_THRESHOLD_MIST = 1_000_000_000

# A validator's commission_rate (basis points, 10000 = 100%) moving by more
# than this is treated as "meaningful" for triggering a decision pass.
COMMISSION_CHANGE_THRESHOLD_BPS = 50


async def check_stake_trigger(
    force: bool = False, simulate_commission_change_bps: int | None = None
) -> None:
    """
    :param force: Skip the epoch-change and commission-move gates and run
        the candidate decision pass regardless (falling back to the full
        current validator set as "changed") — for manual testing via the
        /agents/dev endpoints, not used by the scheduled job.
    :param simulate_commission_change_bps: Only used when force=True.
        Real validator addresses never match a candidate's allowed_targets
        (those are this project's own mock/demo targets, not real testnet
        validators), so simply forcing the gate open never produces a
        legitimate "act" — the LLM correctly declines to stake with a
        validator the agent isn't permitted to use. When set, the
        changed-validators context is built per-candidate instead (see
        _decide_for_candidate), synthesizing an entry for the candidate's
        own allowed target with this commission delta, so there's an
        actionable opportunity on a target the agent can actually use.
        Never written to validator_data's real last-seen-state cache.
    """
    state = await validator_data.get_system_state()
    last_state = validator_data.get_last_seen_state()
    validator_data.set_last_seen_state(state)

    if not force:
        if last_state is None:
            return
        if state.epoch == last_state.epoch:
            return

    changed_validators = []
    if last_state is not None:
        last_by_address = {v.address: v for v in last_state.validators}
        changed_validators = [
            v
            for v in state.validators
            if v.address in last_by_address
            and abs(v.commission_rate - last_by_address[v.address].commission_rate)
            >= COMMISSION_CHANGE_THRESHOLD_BPS
        ]

    if not changed_validators and simulate_commission_change_bps is None:
        if not force:
            return
        changed_validators = state.validators

    candidates = agent_index.get_candidate_agents(ActionType.STAKE)
    for candidate in candidates:
        try:
            await _decide_for_candidate(
                candidate, state, changed_validators, simulate_commission_change_bps
            )
        except Exception:
            logger.exception(
                "stake_trigger: decision pass failed for cap %s, continuing with remaining candidates",
                candidate.cap_id,
            )


async def _decide_for_candidate(
    candidate,
    state,
    changed_validators,
    simulate_commission_change_bps: int | None = None,
) -> None:
    detail = await sui_objects.get_agent_detail(candidate.cap_id)
    if detail is None or not detail.active:
        return

    if detail.spending_limit_per_tx < MIN_STAKING_THRESHOLD_MIST:
        activity_log.log_decision(
            cap_id=candidate.cap_id,
            action_type=ActionType.STAKE,
            decision="no_action",
            reasoning=(
                f"spending_limit_per_tx ({detail.spending_limit_per_tx} MIST) "
                f"is below the minimum staking threshold "
                f"({MIN_STAKING_THRESHOLD_MIST} MIST); execute_stake would "
                "always abort on-chain."
            ),
        )
        return

    if not detail.allowed_targets:
        activity_log.log_decision(
            cap_id=candidate.cap_id,
            action_type=ActionType.STAKE,
            decision="no_action",
            reasoning="Agent has no allowed targets for stake.",
        )
        return

    recent = activity_log.get_recent_activity(
        candidate.cap_id, ActionType.STAKE, limit=10
    )

    simulated = simulate_commission_change_bps is not None
    if simulated:
        # Real validator addresses never match a candidate's
        # allowed_targets in this project, so build the "changed" entry
        # directly on the candidate's own allowed target instead of the
        # real global validator set — see check_stake_trigger's docstring.
        reported_validators = [
            {
                "address": target,
                "name": "(simulated opportunity)",
                "commission_rate_change_bps": simulate_commission_change_bps,
            }
            for target in detail.allowed_targets
        ]
    else:
        reported_validators = [
            {
                "address": v.address,
                "name": v.name,
                "commission_rate": v.commission_rate,
                "voting_power": v.voting_power,
            }
            for v in changed_validators
        ]

    context = {
        "trigger": {
            "type": "validator_set_change",
            "epoch": state.epoch,
            "changed_validators": reported_validators,
            "simulated": simulated,
        },
        "agent": {
            "cap_id": detail.cap_id,
            "vault_balance": detail.vault_balance,
            "spending_limit_per_tx": detail.spending_limit_per_tx,
            "spending_limit_period": detail.spending_limit_period,
            "period_spent": detail.period_spent,
            "allowed_targets": detail.allowed_targets,
            "risk_threshold": detail.risk_threshold,
        },
        "recent_activity": [
            {
                "decision": row["decision"],
                "reasoning": row["reasoning"],
                "created_at": row["created_at"],
            }
            for row in recent
        ],
    }

    result = decide_agent_action(context)

    if result["decision"] != "act":
        activity_log.log_decision(
            cap_id=candidate.cap_id,
            action_type=ActionType.STAKE,
            decision="no_action",
            reasoning=result["reasoning"],
        )
        agent_index.mark_decision(candidate.cap_id)
        return

    target = result["target"]
    if target not in detail.allowed_targets:
        activity_log.log_decision(
            cap_id=candidate.cap_id,
            action_type=ActionType.STAKE,
            decision="no_action",
            reasoning=f"LLM proposed disallowed validator {target}, skipped.",
        )
        agent_index.mark_decision(candidate.cap_id)
        return

    amount_mist = int(result["amount_mist"])
    if amount_mist > detail.vault_balance:
        activity_log.log_decision(
            cap_id=candidate.cap_id,
            action_type=ActionType.STAKE,
            decision="no_action",
            reasoning=(
                f"LLM proposed {amount_mist} MIST, exceeding vault_balance "
                f"{detail.vault_balance}, skipped."
            ),
        )
        agent_index.mark_decision(candidate.cap_id)
        return

    decision = StakeDecision(
        type="stake",
        capId=detail.cap_id,
        vaultId=detail.vault_id,
        amountMist=str(result["amount_mist"]),
        riskScore=int(result["risk_score"]),
        validator=target,
    )

    try:
        exec_result = await executor.execute_agent_action(decision)
    except Exception:
        logger.exception(
            "stake_trigger: executor submission failed for cap %s, logging as failed act attempt",
            candidate.cap_id,
        )
        activity_log.log_decision(
            cap_id=candidate.cap_id,
            action_type=ActionType.STAKE,
            decision="act_failed",
            reasoning=result["reasoning"],
            target=target,
            amount_mist=decision.amount_mist,
            risk_score=decision.risk_score,
        )
        agent_index.mark_decision(candidate.cap_id)
        return

    tx_digest = exec_result.get("txDigest") if isinstance(exec_result, dict) else None

    activity_log.log_decision(
        cap_id=candidate.cap_id,
        action_type=ActionType.STAKE,
        decision="act",
        reasoning=result["reasoning"],
        target=target,
        amount_mist=decision.amount_mist,
        risk_score=decision.risk_score,
        tx_digest=tx_digest,
    )
    agent_index.mark_decision(candidate.cap_id)
