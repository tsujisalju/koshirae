"""SUI pool price reads for the swap trigger.

Noodles.fi's retail price API was suspended (2026-08-31), so this reads
price directly from DeepBook's on-chain `pool::mid_price` view function
instead of an external HTTP API — the same approach
@mysten/deepbook-v3's PoolQueries.midPrice() uses (confirmed against the
published package source, v2.1.4):

    mid_price<Base, Quote>(self: &Pool<Base, Quote>, clock: &Clock): u64

raw_mid_price is scaled by 1e9 (FLOAT_SCALAR in the SDK); the actual
price is `raw_mid_price * base_scalar / quote_scalar / 1e9`.

This is a read-only "dev-inspect"-style call (SimulateTransactionKind),
not a plain object read, so it's built as a one-command Programmable
Transaction by hand at the BCS level — pysui 1.4.1's gRPC-only build has
no high-level transaction-builder module (no `pysui.sui.sui_txn`), but
does expose everything needed at `pysui.sui.sui_bcs.bcs`.
"""

from decimal import Decimal

from app.config import settings
from app.services.sui_grpc import get_client
from pysui.sui.sui_bcs import bcs
from pysui.sui.sui_grpc.pgrpc_requests import GetObjectSC, SimulateTransactionKind

# mid_price's raw return value is scaled by this factor before the
# base/quote scalar adjustment — matches @mysten/deepbook-v3's FLOAT_SCALAR.
FLOAT_SCALAR = Decimal(1_000_000_000)

# Any valid-looking address works as the simulate sender — mid_price is a
# pure view function, nothing is signed or charged.
_SIMULATE_SENDER = "0x0000000000000000000000000000000000000000000000000000000000000000"

_last_seen_price: dict[str, Decimal] = {}


async def _get_shared_object_ref(object_id: str) -> bcs.SharedObjectReference:
    client = get_client()

    result = await client.execute_grpc_request(
        request=GetObjectSC(object_id=object_id, field_mask=["object_id", "owner"])
    )
    if not result.is_ok():
        raise RuntimeError(f"GetObject({object_id}) failed: {result.result_string}")

    grpc_object = result.result_data
    if grpc_object is None:
        raise RuntimeError(f"Object {object_id} not found")

    return bcs.SharedObjectReference.from_grpc_ref(grpc_object, is_mutable=False)


async def get_pool_price(pool_id: str) -> Decimal:
    """Fetch the current mid price for a DeepBook pool, as
    quote-per-base (matching the pool's own base/quote coin ordering).
    """
    pool_ref = await _get_shared_object_ref(pool_id)
    clock_ref = await _get_shared_object_ref("0x6")

    move_call = bcs.ProgrammableMoveCall(
        bcs.Address.from_str(settings.deepbook_package_id),
        "pool",
        "mid_price",
        [
            bcs.TypeTag.type_tag_from(settings.deepbook_base_coin_type),
            bcs.TypeTag.type_tag_from(settings.deepbook_quote_coin_type),
        ],
        [bcs.Argument("Input", 0), bcs.Argument("Input", 1)],
    )

    programmable_txn = bcs.ProgrammableTransaction(
        [
            bcs.CallArg("Object", bcs.ObjectArg("SharedObject", pool_ref)),
            bcs.CallArg("Object", bcs.ObjectArg("SharedObject", clock_ref)),
        ],
        [bcs.Command("MoveCall", move_call)],
    )

    client = get_client()
    result = await client.execute_grpc_request(
        request=SimulateTransactionKind(
            transaction=bcs.TransactionKind("ProgrammableTransaction", programmable_txn),
            sender=_SIMULATE_SENDER,
            checks_enabled=False,
            gas_selection=False,
        )
    )
    if not result.is_ok():
        raise RuntimeError(f"SimulateTransactionKind(mid_price) failed: {result.result_string}")

    response = result.result_data
    if not response.command_outputs or not response.command_outputs[0].return_values:
        status = response.transaction.effects.status if response.transaction else None
        if status is not None and not status.success:
            raise RuntimeError(
                f"mid_price aborted on-chain for pool {pool_id}: "
                f"{status.error.description if status.error else status}. "
                "Likely cause: the pool's order book is currently empty "
                "(no live bids/asks to compute a mid price from) — this is "
                "a testnet liquidity issue, not a code bug."
            )
        raise RuntimeError(f"mid_price returned no value for pool {pool_id}")

    return_bytes = response.command_outputs[0].return_values[0].value.value
    raw_mid_price = int.from_bytes(return_bytes, byteorder="little", signed=False)

    return (
        Decimal(raw_mid_price)
        * Decimal(settings.deepbook_base_coin_scalar)
        / Decimal(settings.deepbook_quote_coin_scalar)
        / FLOAT_SCALAR
    )


def get_last_seen_price(pool_id: str) -> Decimal | None:
    return _last_seen_price.get(pool_id)


def set_last_seen_price(pool_id: str, price: Decimal) -> None:
    _last_seen_price[pool_id] = price
