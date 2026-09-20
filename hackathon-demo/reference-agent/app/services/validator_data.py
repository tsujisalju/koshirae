"""Active validator set reads for the stake trigger.

Reuses the shared gRPC client from sui_grpc.py — no second RPC setup.
"""

from decimal import Decimal

from app.services.sui_grpc import get_client
from pydantic import BaseModel
from pysui.sui.sui_grpc.pgrpc_requests import GetLatestSuiSystemStateSC


class ValidatorInfo(BaseModel):
    address: str
    name: str
    commission_rate: int  # basis points, per SystemState (10000 = 100%)
    voting_power: int
    staking_pool_sui_balance: int


class SystemState(BaseModel):
    epoch: int
    validators: list[ValidatorInfo]


async def get_system_state() -> SystemState:
    client = get_client()

    result = await client.execute_grpc_request(request=GetLatestSuiSystemStateSC())
    if not result.is_ok():
        raise RuntimeError(f"GetLatestSuiSystemState failed: {result.result_string}")

    state = result.result_data
    validators = state.validators.active_validators if state.validators else []

    return SystemState(
        epoch=state.epoch or 0,
        validators=[
            ValidatorInfo(
                address=v.address or "",
                name=v.name or "",
                commission_rate=v.commission_rate or 0,
                voting_power=v.voting_power or 0,
                staking_pool_sui_balance=(
                    v.staking_pool.sui_balance
                    if v.staking_pool and v.staking_pool.sui_balance is not None
                    else 0
                ),
            )
            for v in validators
        ],
    )


def estimate_apy(validator: ValidatorInfo, reference_gas_price: int) -> Decimal:
    """Rough relative APY proxy: reward rate implied by stake vs. gas
    price, net of commission. Not a precise APY calculation (that needs
    epoch-over-epoch reward history) — good enough as a comparative signal
    for the trigger, not for display to end users.
    """
    if validator.staking_pool_sui_balance == 0:
        return Decimal(0)

    commission_factor = Decimal(10000 - validator.commission_rate) / Decimal(10000)
    return Decimal(reference_gas_price) * commission_factor


_last_seen_state: SystemState | None = None


def get_last_seen_state() -> SystemState | None:
    return _last_seen_state


def set_last_seen_state(state: SystemState) -> None:
    global _last_seen_state
    _last_seen_state = state
