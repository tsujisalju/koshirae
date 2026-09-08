import time
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any

from app.models.agent import (
    ActivityRecord,
    AgentDetail,
    AgentMetadataCreate,
    AgentSummary,
)
from app.models.agent_index import AgentCandidate
from app.models.policy import ActionType, AgentPolicy
from app.services import (
    activity_log,
    agent_index,
    agent_metadata,
    sui_events,
    sui_objects,
)
from app.services.llm import parse_policy_with_llm
from app.services.triggers.stake_trigger import check_stake_trigger
from app.services.triggers.swap_trigger import check_swap_trigger
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter()


class ParsePolicyRequest(BaseModel):
    text: str


ACTION_MAP = {
    "transfer": ActionType.TRANSFER,
    "mock_swap": ActionType.MOCK_SWAP,
    "stake": ActionType.STAKE,
    "cetus_swap": ActionType.CETUS_SWAP,
}


RISK_THRESHOLD_MAP = {
    "low": 30,
    "medium": 60,
    "high": 85,
}


def sui_to_mist(amount_sui: float) -> int:
    """
    Convert SUI to MIST deterministically.

    1 SUI = 1,000,000,000 MIST.
    """

    try:
        amount = Decimal(str(amount_sui))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("Invalid SUI amount") from exc

    if amount < 0:
        raise ValueError("SUI amount cannot be negative")

    mist = amount * Decimal(1000000000)

    if mist != mist.to_integral_value():
        raise ValueError("SUI amount has more precision than MIST supports")

    return int(mist)


def build_agent_policy(llm_policy: dict[str, Any]) -> AgentPolicy:
    """
    Convert the LLM's human-readable policy into the
    exact fields required by AgentPolicy.
    """

    spending_limit_per_tx = sui_to_mist(llm_policy["spending_limit_per_tx_sui"])

    spending_limit_period = sui_to_mist(llm_policy["spending_limit_period_sui"])

    period_length_ms = int(
        Decimal(str(llm_policy["period_length_hours"])) * Decimal(3600000)
    )

    allowed_actions = []

    for action in llm_policy["allowed_actions"]:
        if action not in ACTION_MAP:
            raise ValueError(f"Unsupported action returned by LLM: {action}")

        allowed_actions.append(ACTION_MAP[action])

    risk_stance = llm_policy["risk_stance"]

    if risk_stance not in RISK_THRESHOLD_MAP:
        raise ValueError(f"Unsupported risk stance returned by LLM: {risk_stance}")

    risk_threshold = RISK_THRESHOLD_MAP[risk_stance]

    expiry_hours = llm_policy["expiry_hours"]

    if expiry_hours is None:
        expiry_ms = 0
    else:
        expiry_ms = int(time.time() * 1000 + float(expiry_hours) * 60 * 60 * 1000)

    return AgentPolicy(
        spending_limit_per_tx=spending_limit_per_tx,
        spending_limit_period=spending_limit_period,
        period_length_ms=period_length_ms,
        allowed_actions=allowed_actions,
        allowed_targets=llm_policy["allowed_targets"],
        risk_threshold=risk_threshold,
        expiry_ms=expiry_ms,
    )


@router.post("/parse-policy", response_model=AgentPolicy)
def parse_policy(request: ParsePolicyRequest):
    """
    Convert a natural-language policy into an AgentPolicy.
    """

    if not request.text.strip():
        raise HTTPException(
            status_code=400,
            detail="Policy text cannot be empty",
        )

    try:
        llm_policy = parse_policy_with_llm(request.text)

        return build_agent_policy(llm_policy)

    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"LLM policy parsing failed: {exc}",
        ) from exc


@router.get("", response_model=list[AgentSummary])
async def list_agents(
    owner: Annotated[str, Query(description="Sui address of the connected wallet")],
):
    created = await sui_events.get_created_caps_for_owner(owner)
    deactivated_ids = await sui_events.get_deactivated_cap_ids()

    return [
        AgentSummary(
            cap_id=cap.cap_id,
            vault_id=cap.vault_id,
            owner=cap.owner,
            operator=cap.operator,
            active=cap.cap_id not in deactivated_ids,
            name=agent_metadata.get_agent_name(cap.cap_id),
        )
        for cap in created
    ]


@router.post("/metadata")
def save_metadata(metadata: AgentMetadataCreate):
    name = metadata.name.strip()

    if not name:
        raise HTTPException(
            status_code=400,
            detail="Agent name cannot be empty",
        )

    agent_metadata.save_agent_metadata(
        cap_id=metadata.cap_id,
        owner=metadata.owner,
        name=name,
    )

    return {
        "status": "ok",
        "cap_id": metadata.cap_id,
        "name": name,
    }


@router.get("/activity", response_model=list[ActivityRecord])
async def get_activity(
    owner: Annotated[str, Query(description="Sui address of the connected wallet")],
):
    created = await sui_events.get_created_caps_for_owner(owner)
    cap_ids = [cap.cap_id for cap in created]
    rows = activity_log.get_activity_for_caps(cap_ids)
    return [
        ActivityRecord(
            id=row["id"],
            cap_id=row["cap_id"],
            action_type=row["action_type"],
            decision=row["decision"],
            reasoning=row["reasoning"],
            target=row["target"],
            amount_mist=row["amount_mist"],
            risk_score=row["risk_score"],
            tx_digest=row["tx_digest"],
            created_at=row["created_at"],
        )
        for row in rows
    ]


@router.get("/{cap_id}", response_model=AgentDetail)
async def get_agent(cap_id: str):
    detail = await sui_objects.get_agent_detail(cap_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    detail.name = agent_metadata.get_agent_name(cap_id)
    return detail


@router.post("/decide")
def decide():
    # Runtime decision logic will be implemented next.
    return {"status": "not implemented"}


@router.post("/dev/sync-index")
async def dev_sync_index():
    """Manually run the candidate-index sync, for testing outside the
    scheduled interval."""
    await agent_index.sync_agent_index()
    return {"status": "ok"}


@router.get("/dev/candidates", response_model=list[AgentCandidate])
def dev_candidates(action_type: Annotated[int, Query()]):
    return agent_index.get_candidate_agents(action_type)


@router.post("/dev/check-swap-trigger")
async def dev_check_swap_trigger(
    force: Annotated[bool, Query()] = False,
    simulate_pct_change: Annotated[
        float | None,
        Query(
            description="Only used with force=true. Reports this synthetic price move to the LLM instead of the real one."
        ),
    ] = None,
):
    """Manually run the swap trigger check, for testing outside the
    scheduled interval. force=true bypasses the price-move threshold so
    candidates get a decision pass regardless of the real market move."""
    await check_swap_trigger(force=force, simulate_pct_change=simulate_pct_change)
    return {"status": "ok"}


@router.post("/dev/check-stake-trigger")
async def dev_check_stake_trigger(
    force: Annotated[bool, Query()] = False,
    simulate_commission_change_bps: Annotated[
        int | None,
        Query(
            description="Only used with force=true. Synthesizes a commission-change opportunity on each candidate's own allowed target."
        ),
    ] = None,
):
    """Manually run the stake trigger check, for testing outside the
    scheduled interval. force=true bypasses the epoch/commission-move
    gates so candidates get a decision pass regardless."""
    await check_stake_trigger(
        force=force, simulate_commission_change_bps=simulate_commission_change_bps
    )
    return {"status": "ok"}
