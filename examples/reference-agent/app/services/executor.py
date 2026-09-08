import os

import httpx

from app.models.policy import AgentActionDecision


EXECUTOR_URL = os.getenv(
    "ORONYX_EXECUTOR_URL",
    "http://localhost:4000",
)


async def execute_agent_action(
    decision: AgentActionDecision,
) -> dict[str, object]:
    """
    Send an agent decision to the TypeScript executor.

    The executor is responsible for signing and submitting
    the actual Sui transaction.
    """

    payload = decision.model_dump(by_alias=True)

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{EXECUTOR_URL}/execute",
            json=payload,
        )

    response.raise_for_status()

    return response.json()