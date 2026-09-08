"""Move event queries against Sui, via gRPC (pysui).

Public fullnodes have deprecated suix_queryEvents over JSON-RPC (confirmed
live: "-32601 Method not found... migrate to gRPC or GraphQL"), so this
uses pysui's gRPC ListEvents instead, matching the gRPC convention already
used on the TypeScript side (executor/, frontend/).
"""

from typing import TypeVar

from app.config import settings
from app.models.sui_events import CapCreatedPayload, CapDeactivatedPayload
from app.services.sui_grpc import get_client, pb_value_to_dict
from pydantic import BaseModel
from pysui.sui.sui_grpc.pgrpc_filters import Literal, build_event_filter
from pysui.sui.sui_grpc.pgrpc_requests import ListEvents

CAP_CREATED_EVENT_TYPE = f"{settings.oronyx_package_id}::capability::CapCreated"
CAP_DEACTIVATED_EVENT_TYPE = f"{settings.oronyx_package_id}::capability::CapDeactivated"

T = TypeVar("T", bound=BaseModel)


async def _query_events_by_type(event_type: str, payload_model: type[T]) -> list[T]:
    client = get_client()
    event_filter = build_event_filter(terms=[[Literal(predicate="event_type", value=event_type)]])

    payloads: list[T] = []
    # Without an explicit field_mask, the server omits expensive fields
    # like the JSON-rendered payload by default (confirmed live: omitting
    # it returns an empty dict for every event).
    result = await client.execute_grpc_request(
        request=ListEvents(
            event_filter=event_filter,
            field_mask=["event_type", "json"],
        )
    )
    if not result.is_ok():
        raise RuntimeError(f"ListEvents failed: {result.result_string}")

    async for frame in result.result_data:
        if frame.event is None:
            continue
        payloads.append(
            payload_model.model_validate(pb_value_to_dict(frame.event.json))
        )

    return payloads


async def get_all_created_caps() -> list[CapCreatedPayload]:
    return await _query_events_by_type(CAP_CREATED_EVENT_TYPE, CapCreatedPayload)


async def get_created_caps_for_owner(owner: str) -> list[CapCreatedPayload]:
    events = await get_all_created_caps()
    return [event for event in events if event.owner == owner]


async def get_deactivated_cap_ids() -> set[str]:
    events = await _query_events_by_type(CAP_DEACTIVATED_EVENT_TYPE, CapDeactivatedPayload)
    return {event.cap_id for event in events}
