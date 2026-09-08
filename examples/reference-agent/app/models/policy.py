from enum import IntEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ActionType(IntEnum):
    TRANSFER = 0
    MOCK_SWAP = 1
    STAKE = 2
    CETUS_SWAP = 3


class AgentPolicy(BaseModel):
    spending_limit_per_tx: int = Field(ge=0)
    spending_limit_period: int = Field(ge=0)
    period_length_ms: int = Field(gt=0)

    allowed_actions: list[ActionType]
    allowed_targets: list[str]

    risk_threshold: int = Field(ge=0, le=100)
    expiry_ms: int = Field(ge=0)


class BaseDecision(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    cap_id: str = Field(alias="capId")
    vault_id: str = Field(alias="vaultId")
    amount_mist: str = Field(alias="amountMist")
    risk_score: int = Field(alias="riskScore", ge=0, le=100)


class TransferDecision(BaseDecision):
    type: Literal["transfer"]
    recipient: str


class StakeDecision(BaseDecision):
    type: Literal["stake"]
    validator: str


class MockSwapDecision(BaseDecision):
    type: Literal["mock_swap"]
    mock_pool_id: str = Field(alias="mockPoolId")


class CetusSwapDecision(BaseDecision):
    type: Literal["cetus_swap"]
    pool_id: str = Field(alias="poolId")
    decimals_a: int = Field(alias="decimalsA")
    decimals_b: int = Field(alias="decimalsB")
    slippage_percent: float = Field(alias="slippagePercent")


AgentActionDecision = (
    TransferDecision | StakeDecision | MockSwapDecision | CetusSwapDecision
)