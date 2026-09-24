/// A minimal fixed-rate swap pool for demo purposes. Exists purely so
/// the demo has a guaranteed-working swap path independent of third-party
/// testnet liquidity.
///
/// Holds SUI on one side and a mock USDC-like coin (`MOCK_USDC`, defined
/// in `koshirae::mock_usdc`) on the other, at a fixed rate set at creation
/// time. Meant to be funded once by whoever deploys it (team wallet),
/// then used read-only by the demo.
module koshirae::mock_dex;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::event;
use koshirae::mock_usdc::MOCK_USDC;

public struct MockPool has key {
    id: UID,
    sui_balance: Balance<SUI>,
    mock_usdc_balance: Balance<MOCK_USDC>,
    /// Fixed rate, not updated based on pool balance.
    /// Intentionally not a real AMM curve.
    rate_usdc_per_sui: u64,
}

public struct SwapExecuted has copy, drop {
    pool_id: ID,
    a2b: bool, //true = SUI -> MOCK_USDC, false MOCK_USDC -> SUI
    amount_in: u64,
    amount_out: u64,
}

const EInsufficientPoolLiquidity: u64 = 0;

public fun create_pool(
    initial_sui: Coin<SUI>,
    initial_mock_usdc: Coin<MOCK_USDC>,
    rate_usdc_per_sui: u64,
    ctx: &mut TxContext,
) {
    let pool = MockPool {
        id: object::new(ctx),
        sui_balance: initial_sui.into_balance(),
        mock_usdc_balance: initial_mock_usdc.into_balance(),
        rate_usdc_per_sui,
    };
    transfer::share_object(pool);
}

public fun swap_sui_for_mock_usdc(
    pool: &mut MockPool,
    payment: Coin<SUI>,
    ctx: &mut TxContext,
): Coin<MOCK_USDC> {
    let amount_in = payment.value();
    let amount_out = (amount_in * pool.rate_usdc_per_sui) / 1_000_000_000;
    assert!(pool.mock_usdc_balance.value() >= amount_out, EInsufficientPoolLiquidity);

    coin::put(&mut pool.sui_balance, payment);
    let out_coin = coin::take(&mut pool.mock_usdc_balance, amount_out, ctx);

    event::emit(SwapExecuted {
        pool_id: object::id(pool),
        a2b: true,
        amount_in,
        amount_out,
    });

    out_coin
}

/// Swaps MOCK_USDC back for SUI at the pool's fixed rate — included mainly
/// so a demo can show a round trip, not just one direction.
public fun swap_mock_usdc_for_sui(
    pool: &mut MockPool,
    payment: Coin<MOCK_USDC>,
    ctx: &mut TxContext,
): Coin<SUI> {
    let amount_in = payment.value();
    let amount_out = (amount_in * 1_000_000_000) / pool.rate_usdc_per_sui;

    assert!(pool.sui_balance.value() >= amount_out, EInsufficientPoolLiquidity);

    coin::put(&mut pool.mock_usdc_balance, payment);
    let out_coin = coin::take(&mut pool.sui_balance, amount_out, ctx);

    event::emit(SwapExecuted {
        pool_id: object::id(pool),
        a2b: false,
        amount_in,
        amount_out,
    });

    out_coin
}

#[test_only]
public fun rate_for_testing(pool: &MockPool): u64 {
    pool.rate_usdc_per_sui
}
