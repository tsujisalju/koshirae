"""Single-object reads against Sui, via gRPC (pysui).

Backs GET /agents/{cap_id} — reads the full AgentCap object directly
(rather than deriving state from events, as the list endpoint does),
plus its linked Vault for balance.
"""

import base64

from app.config import settings
from app.models.agent import AgentDetail
from app.services.sui_grpc import get_client, pb_value_to_dict
from pysui.sui.sui_grpc.pgrpc_requests import GetObjectSC

AGENT_CAP_TYPE = f"{settings.oronyx_package_id}::capability::AgentCap"
VAULT_TYPE = f"{settings.oronyx_package_id}::capability::Vault"


class _GetObjectOrNone(GetObjectSC):
    """GetObjectSC, but a nonexistent object resolves to a clean `None`
    result instead of a hard NOT_FOUND gRPC error.

    Unlike GetTransactionSC, GetObjectSC doesn't set not_found_as_none by
    default (confirmed against the installed package's source) — mirrors
    the library's own GetTransactionSC pattern for enabling it.
    """

    not_found_as_none: bool = True


async def get_agent_detail(cap_id: str) -> AgentDetail | None:
    client = get_client()

    cap_result = await client.execute_grpc_request(
        request=_GetObjectOrNone(object_id=cap_id, field_mask=["object_id", "object_type", "json"])
    )
    if not cap_result.is_ok():
        raise RuntimeError(f"GetObject(cap) failed: {cap_result.result_string}")

    cap_obj = cap_result.result_data
    if cap_obj is None or cap_obj.object_type != AGENT_CAP_TYPE:
        return None

    cap_json = pb_value_to_dict(cap_obj.json)
    vault_id = cap_json["vault_id"]

    # A valid AgentCap always has a corresponding Vault (created together
    # by capability.move's create_agent_cap) — a missing/failed Vault
    # fetch here is a genuine data-integrity error, not a normal 404.
    vault_result = await client.execute_grpc_request(
        request=GetObjectSC(object_id=vault_id, field_mask=["object_id", "object_type", "json"])
    )
    if not vault_result.is_ok():
        raise RuntimeError(f"GetObject(vault) failed: {vault_result.result_string}")

    vault_obj = vault_result.result_data
    if vault_obj is None or vault_obj.object_type != VAULT_TYPE:
        raise RuntimeError(f"Vault {vault_id} for AgentCap {cap_id} not found or wrong type")

    vault_json = pb_value_to_dict(vault_obj.json)

    # VecSet<address> fields render as {"contents": ["0x...", ...]}, but
    # VecSet<u8> (allowed_actions) renders as {"contents": "<base64>"} —
    # confirmed empirically against a real deployed AgentCap, not assumed.
    allowed_actions = list(base64.b64decode(cap_json["allowed_actions"]["contents"]))

    return AgentDetail(
        cap_id=cap_id,
        vault_id=vault_id,
        owner=cap_json["owner"],
        operator=cap_json["operator"],
        active=cap_json["active"],
        spending_limit_per_tx=int(cap_json["spending_limit_per_tx"]),
        spending_limit_period=int(cap_json["spending_limit_period"]),
        period_spent=int(cap_json["period_spent"]),
        period_start_ms=int(cap_json["period_start_ms"]),
        period_length_ms=int(cap_json["period_length_ms"]),
        allowed_actions=allowed_actions,
        allowed_targets=cap_json["allowed_targets"]["contents"],
        protocol_targets=cap_json["protocol_targets"]["contents"],
        risk_threshold=int(cap_json["risk_threshold"]),
        expiry_ms=int(cap_json["expiry_ms"]),
        vault_balance=int(vault_json["balance"]),
    )
