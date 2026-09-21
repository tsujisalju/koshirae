#[test_only]
module koshirae::mock_dex_tests;

use koshirae::mock_dex::{Self, MockPool};
use koshirae::mock_usdc::MOCK_USDC;
use sui:: test_scenario as ts;
use sui::coin;
use sui::sui::SUI;
use std::unit_test::{assert_eq, destroy};

const EInsufficientPoolLiquidity: u64 = 0;

const DEPLOYER: address = @0xA;
const TRADER: address = @0xB;

const INITIAL_SUI: u64 = 10_000_000_000; // 10 SUI
const INITIAL_MOCK_USDC: u64 = 9_500_000_000;
const RATE_USDC_PER_SUI: u64 = 950_000;

fun setup(scenario: &mut ts::Scenario) {
    let sui_coin = coin::mint_for_testing<SUI>(INITIAL_SUI, scenario.ctx());
    let mock_usdc_coin = coin::mint_for_testing<MOCK_USDC>(INITIAL_MOCK_USDC, scenario.ctx());

    mock_dex::create_pool(sui_coin, mock_usdc_coin, RATE_USDC_PER_SUI, scenario.ctx());
    scenario.next_tx(DEPLOYER);
}

#[test]
fun swap_sui_for_mock_usdc_applies_fixed_rate() {
    let mut scenario = ts::begin(DEPLOYER);
    setup(&mut scenario);

    scenario.next_tx(TRADER);
    let mut pool = scenario.take_shared<MockPool>();

    let payment = coin::mint_for_testing<SUI>(1_000_000_000, scenario.ctx()); // 1 SUI
    let out = mock_dex::swap_sui_for_mock_usdc(&mut pool, payment, scenario.ctx());

    // 1 SUI * rate(950_000) / 1e9 = 950_000 mock USDC smallest units
    assert_eq!(out.value(), 950_000);
    destroy(out);

    ts::return_shared(pool);
    scenario.end();
}

#[test]
fun swap_mock_usdc_for_sui_applies_inverse_rate() {
    let mut scenario = ts::begin(DEPLOYER);
    setup(&mut scenario);

    scenario.next_tx(TRADER);
    let mut pool = scenario.take_shared<MockPool>();

    let payment = coin::mint_for_testing<MOCK_USDC>(950_000, scenario.ctx());
    let out = mock_dex::swap_mock_usdc_for_sui(&mut pool, payment, scenario.ctx());

    // 950_000 * 1e9 / 950_000 = 1_000_000_000 (1 SUI) — exact at this
    // rate/amount combination.
    assert_eq!(out.value(), 1_000_000_000);
    destroy(out);

    ts::return_shared(pool);
    scenario.end();
}

#[test]
fun round_trip_returns_to_original_amount_at_this_rate() {
    let mut scenario = ts::begin(DEPLOYER);
    setup(&mut scenario);

    scenario.next_tx(TRADER);
    let mut pool = scenario.take_shared<MockPool>();

    let original = coin::mint_for_testing<SUI>(2_000_000_000, scenario.ctx()); // 2 SUI
    let mid = mock_dex::swap_sui_for_mock_usdc(&mut pool, original, scenario.ctx());
    let back = mock_dex::swap_mock_usdc_for_sui(&mut pool, mid, scenario.ctx());

    assert_eq!(back.value(), 2_000_000_000);
    destroy(back);

    ts::return_shared(pool);
    scenario.end();
}

#[test]
fun pool_rate_matches_creation_value() {
    let mut scenario = ts::begin(DEPLOYER);
    setup(&mut scenario);

    scenario.next_tx(TRADER);
    let pool = scenario.take_shared<MockPool>();
    assert_eq!(mock_dex::rate_for_testing(&pool), RATE_USDC_PER_SUI);
    ts::return_shared(pool);
    scenario.end();
}

#[test, expected_failure(abort_code = EInsufficientPoolLiquidity, location = mock_dex)]
fun swap_aborts_when_pool_lacks_mock_usdc_liquidity() {
    let mut scenario = ts::begin(DEPLOYER);
    setup(&mut scenario);

    scenario.next_tx(TRADER);
    let mut pool = scenario.take_shared<MockPool>();

    // Far more than the pool's mock_usdc_balance can cover at this rate without overflowing u64.
    let payment = coin::mint_for_testing<SUI>(11_000_000_000_000, scenario.ctx());
    let out = mock_dex::swap_sui_for_mock_usdc(&mut pool, payment, scenario.ctx());
    destroy(out);
    ts::return_shared(pool);
    scenario.end();
}

#[test, expected_failure(abort_code = EInsufficientPoolLiquidity, location = mock_dex)]
fun swap_aborts_when_pool_lacks_sui_liquidity() {
    let mut scenario = ts::begin(DEPLOYER);
    setup(&mut scenario);

    scenario.next_tx(TRADER);
    let mut pool = scenario.take_shared<MockPool>();

    // Far more MOCK_USDC than the pool's sui_balance can cover at this rate without overflowing u64.
    let payment = coin::mint_for_testing<MOCK_USDC>(1_000_000_000, scenario.ctx());
    let out = mock_dex::swap_mock_usdc_for_sui(&mut pool, payment, scenario.ctx());
    destroy(out);
    ts::return_shared(pool);
    scenario.end();
}
