"""Hourly global price-trigger check for the mock-swap decision path.

Fires get_candidate_agents(MOCK_SWAP) + a per-agent LLM decision only
when the DeepBook price signal has moved past SWAP_TRIGGER_THRESHOLD_PCT
since last check — cheap no-op otherwise.
"""

import logging
from decimal import Decimal

from app.config import settings
from app.models.policy import ActionType, MockSwapDecision
from app.services import (
    activity_log,
    agent_index,
    executor,
    market_data,
    sui_objects,
)
from app.services.llm import decide_agent_action

logger = logging.getLogger(__name__)

SWAP_TRIGGER_THRESHOLD_PCT = Decimal("2.0")


async def check_swap_trigger(
    force: bool = False, simulate_pct_change: float | None = None
) -> None:
    """
    :param force: Skip the price-move threshold gate and run the candidate
        decision pass regardless — for manual testing via the /agents/dev
        endpoints, not used by the scheduled job.
    :param simulate_pct_change: Only used when force=True. Reports a
        synthetic price move to the LLM (last_price scaled by this
        percent) instead of the real one, so a genuinely flat real price
        can still produce a legitimate "act" decision during testing.
        Never written to market_data's real last-seen-price cache, so it
        can't corrupt the next real (non-forced) scheduled run.
    """
    pool_id = settings.deepbook_price_pool_id
    if not pool_id:
        logger.info("swap_trigger: DEEPBOOK_PRICE_POOL_ID not configured, skipping")
        return

    if simulate_pct_change is not None:
        # Simulated moves don't need a live price read at all — the whole
        # point is to fabricate the move, not observe a real one. This
        # also means simulate mode keeps working even when the pool's
        # order book is empty and mid_price reverts on-chain (a real,
        # observed testnet liquidity issue, not a bug in this service).
        last_price = market_data.get_last_seen_price(pool_id) or Decimal("1.0")
        current_price = last_price * (1 + Decimal(str(simulate_pct_change)) / 100)
        pct_change = abs(Decimal(str(simulate_pct_change)))
    else:
        try:
            current_price = await market_data.get_pool_price(pool_id)
        except Exception:
            logger.exception(
                "swap_trigger: price read failed for pool %s, skipping this cycle", pool_id
            )
            return

        last_price = market_data.get_last_seen_price(pool_id)
        market_data.set_last_seen_price(pool_id, current_price)

        if not force:
            if last_price is None or last_price == 0:
                return

            pct_change = abs((current_price - last_price) / last_price) * 100
            if pct_change < SWAP_TRIGGER_THRESHOLD_PCT:
                return
        else:
            last_price = last_price if last_price is not None else current_price
            pct_change = (
                abs((current_price - last_price) / last_price) * 100
                if last_price
                else Decimal(0)
            )

    candidates = agent_index.get_candidate_agents(ActionType.MOCK_SWAP)
    for candidate in candidates:
        try:
            await _decide_for_candidate(candidate, current_price, last_price, pct_change)
        except Exception:
            logger.exception(
                "swap_trigger: decision pass failed for cap %s, continuing with remaining candidates",
                candidate.cap_id,
            )


async def _decide_for_candidate(
    candidate,
    current_price: Decimal,
    last_price: Decimal,
    pct_change: Decimal,
) -> None:
    detail = await sui_objects.get_agent_detail(candidate.cap_id)
    if detail is None or not detail.active:
        return

    if not detail.allowed_targets:
        activity_log.log_decision(
            cap_id=candidate.cap_id,
            action_type=ActionType.MOCK_SWAP,
            decision="no_action",
            reasoning="Agent has no allowed targets for mock_swap.",
        )
        return

    recent = activity_log.get_recent_activity(
        candidate.cap_id, ActionType.MOCK_SWAP, limit=10
    )

    context = {
        "trigger": {
            "type": "price_move",
            "pool_id": settings.deepbook_price_pool_id,
            "last_price": str(last_price),
            "current_price": str(current_price),
            "pct_change": str(pct_change),
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
            action_type=ActionType.MOCK_SWAP,
            decision="no_action",
            reasoning=result["reasoning"],
        )
        agent_index.mark_decision(candidate.cap_id)
        return

    target = result["target"]

    # The DeepBook pool is only a price signal source (market_data.py) —
    # structurally never a valid mock_swap target (not a MockPool object).
    # It can end up in allowed_targets on-chain by mistake, so this can't
    # rely on the allowed_targets membership check alone.
    if target == settings.deepbook_price_pool_id:
        activity_log.log_decision(
            cap_id=candidate.cap_id,
            action_type=ActionType.MOCK_SWAP,
            decision="no_action",
            reasoning=(
                f"LLM proposed the DeepBook price-signal pool ({target}) as "
                "the swap target — that pool is only a market-data source, "
                "never a valid mock_swap execution target, skipped."
            ),
        )
        agent_index.mark_decision(candidate.cap_id)
        return

    if target not in detail.allowed_targets:
        activity_log.log_decision(
            cap_id=candidate.cap_id,
            action_type=ActionType.MOCK_SWAP,
            decision="no_action",
            reasoning=f"LLM proposed disallowed target {target}, skipped.",
        )
        agent_index.mark_decision(candidate.cap_id)
        return

    amount_mist = int(result["amount_mist"])
    if amount_mist > detail.vault_balance:
        activity_log.log_decision(
            cap_id=candidate.cap_id,
            action_type=ActionType.MOCK_SWAP,
            decision="no_action",
            reasoning=(
                f"LLM proposed {amount_mist} MIST, exceeding vault_balance "
                f"{detail.vault_balance}, skipped."
            ),
        )
        agent_index.mark_decision(candidate.cap_id)
        return

    decision = MockSwapDecision(
        type="mock_swap",
        capId=detail.cap_id,
        vaultId=detail.vault_id,
        amountMist=str(result["amount_mist"]),
        riskScore=int(result["risk_score"]),
        mockPoolId=target,
    )

    try:
        exec_result = await executor.execute_agent_action(decision)
    except Exception:
        logger.exception(
            "swap_trigger: executor submission failed for cap %s, logging as failed act attempt",
            candidate.cap_id,
        )
        activity_log.log_decision(
            cap_id=candidate.cap_id,
            action_type=ActionType.MOCK_SWAP,
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
        action_type=ActionType.MOCK_SWAP,
        decision="act",
        reasoning=result["reasoning"],
        target=target,
        amount_mist=decision.amount_mist,
        risk_score=decision.risk_score,
        tx_digest=tx_digest,
    )
    agent_index.mark_decision(candidate.cap_id)
