#[test_only]
module koshirae::capability_tests;

use koshirae::capability::{Self, Vault, AgentCap, PendingAction};
use koshirae::operator_cap::OperatorCap;
use koshirae::mock_dex::{Self, MockPool};
use koshirae::mock_usdc::MOCK_USDC;
use sui::test_scenario as ts;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::clock;
use std::unit_test::{assert_eq, destroy};
use sui_system::sui_system::SuiSystemState;
use sui_system::staking_pool::StakedSui;
use sui_system::governance_test_utils;

/* Mirrors capability.move's private error constants — kept in sync manually. */
const EInactive: u64 = 0;
const ETargetNotAllowed: u64 = 3;
const EOverTxLimit: u64 = 4;
const EOverPeriodLimit: u64 = 5;
const ENotOwner: u64 = 6;
const ECannotRemoveProtocolTarget: u64 = 9;
const ECoinTypeNotAllowed: u64 = 10;
const ECoinTypeNotInVault: u64 = 11;
const ECoinTypeAlreadyAllowed: u64 = 12;
const EWrongAgentCap: u64 = 13;
const EStaleGeneration: u64 = 14;
//const EOverVaultTxLimit: u64 = 15;
const EOverVaultPeriodLimit: u64 = 16;
const EStaleNonce: u64 = 17;
const EPendingExpired: u64 = 18;
const ENotExpiredYet: u64 = 19;

/* Mirrors capability.move's private action-type codes. */
const ACTION_TRANSFER: u8 = 0;
const ACTION_MOCK_SWAP: u8 = 1;
const ACTION_STAKE: u8 = 2;
const ACTION_CETUS_SWAP: u8 = 3;

const OWNER: address = @0xA;
const OPERATOR: address = @0xB;
const ATTACKER: address = @0xC;
const TARGET: address = @0xD;
const VALIDATOR: address = @0xE;

const DEPOSIT_AMOUNT: u64 = 1_000_000;
const TX_LIMIT: u64 = 100_000;
const PERIOD_LIMIT: u64 = 300_000;
const PERIOD_LENGTH_MS: u64 = 86_400_000; // 1 day
const RISK_THRESHOLD: u8 = 50;
const EXPIRY_MS: u64 = 999_999_999_999;
const MAX_PENDING_WINDOW_MS: u64 = 3_600_000; // 1 hour ceiling on AgentCap's pending window
const MOCK_RATE_USDC_PER_SUI: u64 = 950_000;

/// Standalone vault (own lifecycle now, per the shared-treasury redesign),
/// one AgentCap attached authorizing OPERATOR for transfer/mock-swap/cetus
/// against TARGET, SUI limits configured, DEPOSIT_AMOUNT already funded.
fun setup(scenario: &mut ts::Scenario) {
    let clock = clock::create_for_testing(scenario.ctx());

    let vault = capability::new_vault(PERIOD_LENGTH_MS, scenario.ctx());
    capability::create_agent_cap_for_vault(
        &vault,
        PERIOD_LENGTH_MS,
        vector[ACTION_TRANSFER, ACTION_MOCK_SWAP, ACTION_CETUS_SWAP],
        vector[TARGET],
        vector[],
        RISK_THRESHOLD,
        EXPIRY_MS,
        MAX_PENDING_WINDOW_MS,
        scenario.ctx(),
    );
    capability::share_vault(vault);

    scenario.next_tx(OWNER);
    let mut cap = scenario.take_shared<AgentCap>();
    capability::mint_operator_cap(&cap, OPERATOR, scenario.ctx());
    capability::add_coin_limits<SUI>(&mut cap, TX_LIMIT, PERIOD_LIMIT, &clock, scenario.ctx());
    ts::return_shared(cap);

    scenario.next_tx(OWNER);
    let mut vault = scenario.take_shared<Vault>();
    let funding = coin::mint_for_testing<SUI>(DEPOSIT_AMOUNT, scenario.ctx());
    capability::deposit(&mut vault, funding, scenario.ctx());
    ts::return_shared(vault);

    clock.destroy_for_testing();
}

/* ===== Core execution + risk flagging ===== */

#[test]
fun low_risk_action_releases_coin_to_recipient() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    capability::execute_transfer<SUI>(
        &mut cap, &op_cap, &mut vault, TARGET, 50_000, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault);
    ts::return_shared(cap);
    destroy(op_cap);
    clock.destroy_for_testing();

    scenario.next_tx(TARGET);
    let released = scenario.take_from_sender<Coin<SUI>>();
    assert_eq!(released.value(), 50_000);
    destroy(released);

    scenario.end();
}

#[test]
fun high_risk_action_is_flagged_and_approve_pending_releases_funds() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    let maybe_coin = capability::execute_action<SUI>(
        &mut cap, &op_cap, &mut vault, ACTION_MOCK_SWAP, TARGET, 50_000,
        RISK_THRESHOLD + 1, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );
    assert!(maybe_coin.is_none());
    maybe_coin.destroy_none();

    ts::return_shared(cap);
    destroy(op_cap);

    scenario.next_tx(OWNER);
    assert!(scenario.has_most_recent_for_sender<PendingAction<SUI>>());
    let pending = scenario.take_from_sender<PendingAction<SUI>>();
    let mut cap = scenario.take_shared<AgentCap>();

    let released = capability::approve_pending(pending, &mut cap, &mut vault, &clock, scenario.ctx());
    assert_eq!(released.value(), 50_000);
    destroy(released);

    ts::return_shared(vault);
    ts::return_shared(cap);
    clock.destroy_for_testing();
    scenario.end();
}

#[test]
fun high_risk_action_reject_pending_deletes_it_without_moving_funds() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    let maybe_coin = capability::execute_action<SUI>(
        &mut cap, &op_cap, &mut vault, ACTION_MOCK_SWAP, TARGET, 50_000,
        RISK_THRESHOLD + 1, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );
    maybe_coin.destroy_none();
    ts::return_shared(cap);
    destroy(op_cap);
    clock.destroy_for_testing();

    scenario.next_tx(OWNER);
    let pending = scenario.take_from_sender<PendingAction<SUI>>();
    let cap = scenario.take_shared<AgentCap>();

    capability::reject_pending(pending, &cap, scenario.ctx());

    ts::return_shared(vault);
    ts::return_shared(cap);
    scenario.end();
}

/// Owner may have removed a coin type's limits since an action was
/// flagged — approval is itself the owner's authorization and should
/// still release funds, per the graceful-skip design in approve_pending.
#[test]
fun approve_pending_still_releases_funds_after_coin_type_limits_removed() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    let maybe_coin = capability::execute_action<SUI>(
        &mut cap, &op_cap, &mut vault, ACTION_MOCK_SWAP, TARGET, 50_000,
        RISK_THRESHOLD + 1, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );
    maybe_coin.destroy_none();
    destroy(op_cap);
    ts::return_shared(cap);

    scenario.next_tx(OWNER);
    let pending = scenario.take_from_sender<PendingAction<SUI>>();
    let mut cap = scenario.take_shared<AgentCap>();
    capability::remove_coin_limits<SUI>(&mut cap, scenario.ctx());

    let released = capability::approve_pending(pending, &mut cap, &mut vault, &clock, scenario.ctx());
    assert_eq!(released.value(), 50_000);
    destroy(released);

    ts::return_shared(vault);
    ts::return_shared(cap);
    clock.destroy_for_testing();
    scenario.end();
}

/* ===== Pending action expiry window ===== */

#[test, expected_failure(abort_code = EPendingExpired, location = capability)]
fun approve_pending_after_expiry_window_aborts() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let mut clock = clock::create_for_testing(scenario.ctx());

    let maybe_coin = capability::execute_action<SUI>(
        &mut cap, &op_cap, &mut vault, ACTION_MOCK_SWAP, TARGET, 50_000,
        RISK_THRESHOLD + 1, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );
    maybe_coin.destroy_none();
    ts::return_shared(cap);
    destroy(op_cap);

    scenario.next_tx(OWNER);
    let pending = scenario.take_from_sender<PendingAction<SUI>>();
    let mut cap = scenario.take_shared<AgentCap>();
    clock.increment_for_testing(MAX_PENDING_WINDOW_MS + 1);

    let released = capability::approve_pending(pending, &mut cap, &mut vault, &clock, scenario.ctx());
    destroy(released);

    ts::return_shared(vault);
    ts::return_shared(cap);
    clock.destroy_for_testing();
    scenario.end();
}

/// The AgentCap's max_pending_window_ms is a ceiling the agent cannot
/// exceed by simply asking for a larger window — confirms `execute_action`
/// takes the min of the two rather than trusting the caller's request.
#[test, expected_failure(abort_code = EPendingExpired, location = capability)]
fun requested_pending_window_is_capped_by_agent_cap_max() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario); // cap's max_pending_window_ms == MAX_PENDING_WINDOW_MS

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let mut clock = clock::create_for_testing(scenario.ctx());

    // Requested window is far larger than the cap's ceiling — if the
    // ceiling weren't enforced, this pending action would still be valid
    // at the timestamp we advance to below.
    let maybe_coin = capability::execute_action<SUI>(
        &mut cap, &op_cap, &mut vault, ACTION_MOCK_SWAP, TARGET, 50_000,
        RISK_THRESHOLD + 1, 1, MAX_PENDING_WINDOW_MS * 100, &clock, scenario.ctx(),
    );
    maybe_coin.destroy_none();
    ts::return_shared(cap);
    destroy(op_cap);

    scenario.next_tx(OWNER);
    let pending = scenario.take_from_sender<PendingAction<SUI>>();
    let mut cap = scenario.take_shared<AgentCap>();
    clock.increment_for_testing(MAX_PENDING_WINDOW_MS + 1);

    let released = capability::approve_pending(pending, &mut cap, &mut vault, &clock, scenario.ctx());
    destroy(released);

    ts::return_shared(vault);
    ts::return_shared(cap);
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = ENotExpiredYet, location = capability)]
fun reject_expired_pending_before_expiry_aborts() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    let maybe_coin = capability::execute_action<SUI>(
        &mut cap, &op_cap, &mut vault, ACTION_MOCK_SWAP, TARGET, 50_000,
        RISK_THRESHOLD + 1, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );
    maybe_coin.destroy_none();
    ts::return_shared(vault);
    ts::return_shared(cap);
    destroy(op_cap);

    scenario.next_tx(OWNER);
    let pending = scenario.take_from_sender<PendingAction<SUI>>();
    capability::reject_expired_pending(pending, &clock);

    clock.destroy_for_testing();
    scenario.end();
}

#[test]
fun reject_expired_pending_after_expiry_succeeds() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let mut clock = clock::create_for_testing(scenario.ctx());

    let maybe_coin = capability::execute_action<SUI>(
        &mut cap, &op_cap, &mut vault, ACTION_MOCK_SWAP, TARGET, 50_000,
        RISK_THRESHOLD + 1, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );
    maybe_coin.destroy_none();
    ts::return_shared(vault);
    ts::return_shared(cap);
    destroy(op_cap);

    scenario.next_tx(OWNER);
    let pending = scenario.take_from_sender<PendingAction<SUI>>();
    clock.increment_for_testing(MAX_PENDING_WINDOW_MS + 1);
    capability::reject_expired_pending(pending, &clock);

    clock.destroy_for_testing();
    scenario.end();
}

/* ===== OperatorCap delegation and revocation ===== */

#[test, expected_failure(abort_code = EStaleGeneration, location = capability)]
fun revoked_operator_cap_rejects_execute_action() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OPERATOR);
    let op_cap = scenario.take_from_sender<OperatorCap>();

    scenario.next_tx(OWNER);
    let mut cap = scenario.take_shared<AgentCap>();
    capability::revoke_operator(&mut cap, scenario.ctx());
    ts::return_shared(cap);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    capability::execute_transfer<SUI>(
        &mut cap, &op_cap, &mut vault, TARGET, 50_000, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault);
    ts::return_shared(cap);
    destroy(op_cap);
    clock.destroy_for_testing();
    scenario.end();
}

#[test]
fun owner_can_rotate_operator_by_revoke_then_mint() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    let new_operator = @0xF00D;

    scenario.next_tx(OWNER);
    let mut cap = scenario.take_shared<AgentCap>();
    capability::revoke_operator(&mut cap, scenario.ctx());
    capability::mint_operator_cap(&cap, new_operator, scenario.ctx());
    ts::return_shared(cap);

    scenario.next_tx(new_operator);
    let new_op_cap = scenario.take_from_sender<OperatorCap>();
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    capability::execute_transfer<SUI>(
        &mut cap, &new_op_cap, &mut vault, TARGET, 50_000, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault);
    ts::return_shared(cap);
    destroy(new_op_cap);
    clock.destroy_for_testing();
    scenario.end();
}

/// A live OperatorCap for one AgentCap must never authorize action on a
/// different one — this is the actual cross-tenant isolation guarantee
/// OperatorCap exists to provide.
#[test, expected_failure(abort_code = EWrongAgentCap, location = capability)]
fun operator_cap_for_wrong_agent_cap_rejects_execute_action() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OWNER);
    let vault_a_id = ts::most_recent_id_shared<Vault>().destroy_some();
    let cap_a_id = ts::most_recent_id_shared<AgentCap>().destroy_some();

    let vault_b = capability::new_vault(PERIOD_LENGTH_MS, scenario.ctx());
    capability::create_agent_cap_for_vault(
        &vault_b, PERIOD_LENGTH_MS,
        vector[ACTION_TRANSFER], vector[TARGET], vector[],
        RISK_THRESHOLD, EXPIRY_MS, MAX_PENDING_WINDOW_MS, scenario.ctx(),
    );
    capability::share_vault(vault_b);

    scenario.next_tx(OWNER);
    let cap_b_id = ts::most_recent_id_shared<AgentCap>().destroy_some();
    let cap_b = ts::take_shared_by_id<AgentCap>(&scenario, cap_b_id);
    capability::mint_operator_cap(&cap_b, @0xF00D, scenario.ctx());
    ts::return_shared(cap_b);

    scenario.next_tx(@0xF00D);
    let op_cap_b = scenario.take_from_sender<OperatorCap>();

    scenario.next_tx(OPERATOR);
    let mut vault_a = ts::take_shared_by_id<Vault>(&scenario, vault_a_id);
    let mut cap_a = ts::take_shared_by_id<AgentCap>(&scenario, cap_a_id);
    let clock = clock::create_for_testing(scenario.ctx());

    capability::execute_transfer<SUI>(
        &mut cap_a, &op_cap_b, &mut vault_a, TARGET, 50_000, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault_a);
    ts::return_shared(cap_a);
    destroy(op_cap_b);
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = ENotOwner, location = capability)]
fun non_owner_cannot_mint_operator_cap() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(ATTACKER);
    let cap = scenario.take_shared<AgentCap>();
    capability::mint_operator_cap(&cap, ATTACKER, scenario.ctx());

    ts::return_shared(cap);
    scenario.end();
}

#[test, expected_failure(abort_code = ENotOwner, location = capability)]
fun non_owner_cannot_revoke_operator() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(ATTACKER);
    let mut cap = scenario.take_shared<AgentCap>();
    capability::revoke_operator(&mut cap, scenario.ctx());

    ts::return_shared(cap);
    scenario.end();
}

/* ===== Multi-asset coin limits on AgentCap ===== */

#[test, expected_failure(abort_code = ECoinTypeAlreadyAllowed, location = capability)]
fun add_coin_limits_twice_for_same_type_aborts() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    let clock = clock::create_for_testing(scenario.ctx());

    scenario.next_tx(OWNER);
    let mut cap = scenario.take_shared<AgentCap>();
    capability::add_coin_limits<SUI>(&mut cap, TX_LIMIT, PERIOD_LIMIT, &clock, scenario.ctx());

    ts::return_shared(cap);
    clock.destroy_for_testing();
    scenario.end();
}

/// A coin type never added to limits at all — distinct from the
/// "removed after being added" case below.
#[test, expected_failure(abort_code = ECoinTypeNotAllowed, location = capability)]
fun execute_action_for_coin_type_without_limits_aborts() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    capability::execute_transfer<MOCK_USDC>(
        &mut cap, &op_cap, &mut vault, TARGET, 50_000, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault);
    ts::return_shared(cap);
    destroy(op_cap);
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = ECoinTypeNotAllowed, location = capability)]
fun remove_coin_limits_then_execute_action_aborts() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OWNER);
    let mut cap = scenario.take_shared<AgentCap>();
    capability::remove_coin_limits<SUI>(&mut cap, scenario.ctx());
    ts::return_shared(cap);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    capability::execute_transfer<SUI>(
        &mut cap, &op_cap, &mut vault, TARGET, 50_000, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault);
    ts::return_shared(cap);
    destroy(op_cap);
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = ECoinTypeNotInVault, location = capability)]
fun withdraw_for_coin_type_never_deposited_aborts() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OWNER);
    let mut vault = scenario.take_shared<Vault>();
    let withdrawn = capability::withdraw<MOCK_USDC>(&mut vault, 1, scenario.ctx());
    destroy(withdrawn);

    ts::return_shared(vault);
    scenario.end();
}

#[test]
fun deposit_and_withdraw_roundtrip_for_non_sui_coin() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OWNER);
    let mut vault = scenario.take_shared<Vault>();
    let funding = coin::mint_for_testing<MOCK_USDC>(500_000, scenario.ctx());
    capability::deposit(&mut vault, funding, scenario.ctx());

    let withdrawn = capability::withdraw<MOCK_USDC>(&mut vault, 200_000, scenario.ctx());
    assert_eq!(withdrawn.value(), 200_000);
    destroy(withdrawn);

    ts::return_shared(vault);
    scenario.end();
}

/* ===== Multi-asset vault: the mock-swap round trip ===== */

/// This is the scenario the multi-asset redesign exists for — proceeds
/// from a swap land back in the vault, not the owner's wallet, so the
/// agent can act on either leg of a rebalance.
#[test]
fun mock_swap_sui_to_usdc_deposits_output_into_vault() {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());

    let pool_sui = coin::mint_for_testing<SUI>(10_000_000_000, scenario.ctx());
    let pool_usdc = coin::mint_for_testing<MOCK_USDC>(9_500_000_000, scenario.ctx());
    mock_dex::create_pool(pool_sui, pool_usdc, MOCK_RATE_USDC_PER_SUI, scenario.ctx());
    scenario.next_tx(OWNER);
    let mut pool = scenario.take_shared<MockPool>();
    let pool_address = object::id(&pool).to_address();

    let vault = capability::new_vault(PERIOD_LENGTH_MS, scenario.ctx());
    capability::create_agent_cap_for_vault(
        &vault, PERIOD_LENGTH_MS,
        vector[ACTION_MOCK_SWAP], vector[pool_address], vector[pool_address],
        RISK_THRESHOLD, EXPIRY_MS, MAX_PENDING_WINDOW_MS, scenario.ctx(),
    );
    capability::share_vault(vault);

    scenario.next_tx(OWNER);
    let mut cap = scenario.take_shared<AgentCap>();
    capability::mint_operator_cap(&cap, OPERATOR, scenario.ctx());
    capability::add_coin_limits<SUI>(&mut cap, TX_LIMIT, PERIOD_LIMIT, &clock, scenario.ctx());
    ts::return_shared(cap);

    scenario.next_tx(OWNER);
    let mut vault = scenario.take_shared<Vault>();
    let funding = coin::mint_for_testing<SUI>(DEPOSIT_AMOUNT, scenario.ctx());
    capability::deposit(&mut vault, funding, scenario.ctx());
    ts::return_shared(vault);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();

    capability::execute_mock_swap_sui_to_usdc(
        &mut cap, &op_cap, &mut vault, &mut pool, pool_address, 50_000, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    // 50_000 * rate(950_000) / 1e9, per mock_dex's fixed-rate formula —
    // and critically, checked against the VAULT's balance, not the
    // owner's wallet.
    assert_eq!(capability::balance_for_testing<MOCK_USDC>(&vault), 47);

    ts::return_shared(vault);
    ts::return_shared(cap);
    ts::return_shared(pool);
    destroy(op_cap);
    clock.destroy_for_testing();
    scenario.end();
}

/// The actual motivating scenario from the vault redesign: an agent
/// swaps SUI to USDC, then swaps that USDC back to SUI — proving it can
/// act on both legs of a rebalance, not just spend once.
#[test]
fun agent_can_round_trip_sui_to_usdc_and_back() {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());

    let pool_sui = coin::mint_for_testing<SUI>(10_000_000_000, scenario.ctx());
    let pool_usdc = coin::mint_for_testing<MOCK_USDC>(9_500_000_000, scenario.ctx());
    mock_dex::create_pool(pool_sui, pool_usdc, MOCK_RATE_USDC_PER_SUI, scenario.ctx());
    scenario.next_tx(OWNER);
    let mut pool = scenario.take_shared<MockPool>();
    let pool_address = object::id(&pool).to_address();

    let vault = capability::new_vault(PERIOD_LENGTH_MS, scenario.ctx());
    capability::create_agent_cap_for_vault(
        &vault, PERIOD_LENGTH_MS,
        vector[ACTION_MOCK_SWAP], vector[pool_address], vector[pool_address],
        RISK_THRESHOLD, EXPIRY_MS, MAX_PENDING_WINDOW_MS, scenario.ctx(),
    );
    capability::share_vault(vault);

    scenario.next_tx(OWNER);
    let mut cap = scenario.take_shared<AgentCap>();
    capability::mint_operator_cap(&cap, OPERATOR, scenario.ctx());
    capability::add_coin_limits<SUI>(&mut cap, TX_LIMIT, PERIOD_LIMIT, &clock, scenario.ctx());
    capability::add_coin_limits<MOCK_USDC>(&mut cap, TX_LIMIT, PERIOD_LIMIT, &clock, scenario.ctx());
    ts::return_shared(cap);

    scenario.next_tx(OWNER);
    let mut vault = scenario.take_shared<Vault>();
    let funding = coin::mint_for_testing<SUI>(DEPOSIT_AMOUNT, scenario.ctx());
    capability::deposit(&mut vault, funding, scenario.ctx());
    ts::return_shared(vault);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();

    // Leg 1: SUI -> MOCK_USDC.
    capability::execute_mock_swap_sui_to_usdc(
        &mut cap, &op_cap, &mut vault, &mut pool, pool_address, 50_000, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );
    let usdc_received = capability::balance_for_testing<MOCK_USDC>(&vault);
    assert_eq!(usdc_received, 47);

    // Leg 2: MOCK_USDC -> SUI — only reachable because the first leg's
    // output stayed in the vault instead of leaving to the owner.
    capability::execute_mock_swap_usdc_to_sui(
        &mut cap, &op_cap, &mut vault, &mut pool, pool_address, usdc_received, RISK_THRESHOLD, 2, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );
    assert_eq!(capability::balance_for_testing<MOCK_USDC>(&vault), 0);

    ts::return_shared(vault);
    ts::return_shared(cap);
    ts::return_shared(pool);
    destroy(op_cap);
    clock.destroy_for_testing();
    scenario.end();
}

/* ===== Shared-treasury: vault-level aggregate limits ===== */

#[allow(unused_variable)]
/// Two independently-scoped AgentCaps drawing on one shared Vault — the
/// core cardinality of the shared-treasury model.
#[test]
fun two_agent_caps_can_share_one_vault() {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());
    let operator_b = @0xF00D;

    // Vault + first agent cap, then share — all in the same tx, since a
    // shared object must be shared in the tx that creates it.
    let vault = capability::new_vault(PERIOD_LENGTH_MS, scenario.ctx());
    capability::create_agent_cap_for_vault(
        &vault, PERIOD_LENGTH_MS, vector[ACTION_TRANSFER], vector[TARGET], vector[],
        RISK_THRESHOLD, EXPIRY_MS, MAX_PENDING_WINDOW_MS, scenario.ctx(),
    );
    capability::share_vault(vault);

    scenario.next_tx(OWNER);
    let cap_a_id = ts::most_recent_id_shared<AgentCap>().destroy_some();
    let vault_id = ts::most_recent_id_shared<Vault>().destroy_some();

    // Second AgentCap attached to the already-shared vault, in a later
    // tx — proving a vault can pick up more agents after creation, not
    // just at the moment it's first shared.
    let vault_ref = ts::take_shared_by_id<Vault>(&scenario, vault_id);
    capability::create_agent_cap_for_vault(
        &vault_ref, PERIOD_LENGTH_MS, vector[ACTION_TRANSFER], vector[TARGET], vector[],
        RISK_THRESHOLD, EXPIRY_MS, MAX_PENDING_WINDOW_MS, scenario.ctx(),
    );
    ts::return_shared(vault_ref);

    scenario.next_tx(OWNER);
    let mut cap_a = ts::take_shared_by_id<AgentCap>(&scenario, cap_a_id);
    capability::mint_operator_cap(&cap_a, OPERATOR, scenario.ctx());
    capability::add_coin_limits<SUI>(&mut cap_a, TX_LIMIT, PERIOD_LIMIT, &clock, scenario.ctx());
    ts::return_shared(cap_a);

    let mut vault = ts::take_shared_by_id<Vault>(&scenario, vault_id);
    let funding = coin::mint_for_testing<SUI>(DEPOSIT_AMOUNT, scenario.ctx());
    capability::deposit(&mut vault, funding, scenario.ctx());
    ts::return_shared(vault);

    clock.destroy_for_testing();
    scenario.end();
}

/// A vault-level aggregate limit stacks on top of each cap's own limit —
/// two agents each individually within their own per-tx/period limit can
/// still be jointly capped by the vault's shared ceiling.
#[test, expected_failure(abort_code = EOverVaultPeriodLimit, location = capability)]
fun vault_level_limit_caps_combined_spend_across_agents() {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());
    let operator_b = @0xF00D;

    // Vault + first agent cap, then share — same tx, since a shared
    // object must be shared in the tx that creates it.
    let vault = capability::new_vault(PERIOD_LENGTH_MS, scenario.ctx());
    capability::create_agent_cap_for_vault(
        &vault, PERIOD_LENGTH_MS, vector[ACTION_TRANSFER], vector[TARGET], vector[],
        RISK_THRESHOLD, EXPIRY_MS, MAX_PENDING_WINDOW_MS, scenario.ctx(),
    );
    capability::share_vault(vault);

    scenario.next_tx(OWNER);
    let cap_a_id = ts::most_recent_id_shared<AgentCap>().destroy_some();
    let vault_id = ts::most_recent_id_shared<Vault>().destroy_some();

    // Vault-level ceiling lower than what the two caps' own limits would
    // jointly allow (each gets TX_LIMIT/PERIOD_LIMIT below; the vault
    // only tolerates 150_000 total per period). Second AgentCap attached
    // to the same already-shared vault, in a later tx.
    let mut vault = ts::take_shared_by_id<Vault>(&scenario, vault_id);
    capability::add_vault_coin_limits<SUI>(&mut vault, TX_LIMIT, 150_000, &clock, scenario.ctx());
    capability::create_agent_cap_for_vault(
        &vault, PERIOD_LENGTH_MS, vector[ACTION_TRANSFER], vector[TARGET], vector[],
        RISK_THRESHOLD, EXPIRY_MS, MAX_PENDING_WINDOW_MS, scenario.ctx(),
    );
    ts::return_shared(vault);

    scenario.next_tx(OWNER);
    let cap_b_id = ts::most_recent_id_shared<AgentCap>().destroy_some();
    let mut cap_a = ts::take_shared_by_id<AgentCap>(&scenario, cap_a_id);
    capability::mint_operator_cap(&cap_a, OPERATOR, scenario.ctx());
    capability::add_coin_limits<SUI>(&mut cap_a, TX_LIMIT, PERIOD_LIMIT, &clock, scenario.ctx());
    ts::return_shared(cap_a);

    let mut cap_b = ts::take_shared_by_id<AgentCap>(&scenario, cap_b_id);
    capability::mint_operator_cap(&cap_b, operator_b, scenario.ctx());
    capability::add_coin_limits<SUI>(&mut cap_b, TX_LIMIT, PERIOD_LIMIT, &clock, scenario.ctx());
    ts::return_shared(cap_b);

    scenario.next_tx(OWNER);
    let mut vault = ts::take_shared_by_id<Vault>(&scenario, vault_id);
    let funding = coin::mint_for_testing<SUI>(DEPOSIT_AMOUNT, scenario.ctx());
    capability::deposit(&mut vault, funding, scenario.ctx());
    ts::return_shared(vault);

    scenario.next_tx(OPERATOR);
    let mut vault = ts::take_shared_by_id<Vault>(&scenario, vault_id);
    let mut cap_a = ts::take_shared_by_id<AgentCap>(&scenario, cap_a_id);
    let op_cap_a = scenario.take_from_sender<OperatorCap>();
    capability::execute_transfer<SUI>(
        &mut cap_a, &op_cap_a, &mut vault, TARGET, TX_LIMIT, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );
    ts::return_shared(cap_a);
    destroy(op_cap_a);

    scenario.next_tx(operator_b);
    let mut cap_b = ts::take_shared_by_id<AgentCap>(&scenario, cap_b_id);
    let op_cap_b = scenario.take_from_sender<OperatorCap>();
    // cap_b's own limits are nowhere near exhausted — but agent A already
    // spent TX_LIMIT (100_000) against the shared 150_000 vault ceiling,
    // leaving only 50_000; this second TX_LIMIT-sized transfer pushes the
    // combined total to 200_000, over the vault's period limit.
    capability::execute_transfer<SUI>(
        &mut cap_b, &op_cap_b, &mut vault, TARGET, TX_LIMIT, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault);
    ts::return_shared(cap_b);
    destroy(op_cap_b);
    clock.destroy_for_testing();
    scenario.end();
}

/// Confirms the "none by default" design decision: a single-agent vault
/// with no vault-level limits configured behaves exactly as before,
/// unconstrained by any aggregate ceiling.
#[test]
fun vault_without_configured_limits_has_no_aggregate_cap() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario); // never calls add_vault_coin_limits

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    capability::execute_transfer<SUI>(
        &mut cap, &op_cap, &mut vault, TARGET, TX_LIMIT, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault);
    ts::return_shared(cap);
    destroy(op_cap);
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = ENotOwner, location = capability)]
fun add_vault_coin_limits_by_non_owner_aborts() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);
    let clock = clock::create_for_testing(scenario.ctx());

    scenario.next_tx(ATTACKER);
    let mut vault = scenario.take_shared<Vault>();
    capability::add_vault_coin_limits<SUI>(&mut vault, TX_LIMIT, PERIOD_LIMIT, &clock, scenario.ctx());

    ts::return_shared(vault);
    clock.destroy_for_testing();
    scenario.end();
}

/* ===== Nonce / replay protection ===== */

#[test, expected_failure(abort_code = EStaleNonce, location = capability)]
fun replayed_exact_same_nonce_aborts_on_resubmission() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    capability::execute_transfer<SUI>(
        &mut cap, &op_cap, &mut vault, TARGET, 10_000, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );
    // Same nonce again — must abort, regardless of amount/target.
    capability::execute_transfer<SUI>(
        &mut cap, &op_cap, &mut vault, TARGET, 10_000, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault);
    ts::return_shared(cap);
    destroy(op_cap);
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = EStaleNonce, location = capability)]
fun nonce_not_greater_than_last_used_aborts() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    capability::execute_transfer<SUI>(
        &mut cap, &op_cap, &mut vault, TARGET, 10_000, RISK_THRESHOLD, 5, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );
    // Lower than the last-used nonce (5), not just a repeat of it.
    capability::execute_transfer<SUI>(
        &mut cap, &op_cap, &mut vault, TARGET, 10_000, RISK_THRESHOLD, 3, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault);
    ts::return_shared(cap);
    destroy(op_cap);
    clock.destroy_for_testing();
    scenario.end();
}

/// Confirms it's a strictly-increasing ordering guarantee, not a
/// sequential-by-one requirement — gaps are fine.
#[test]
fun nonces_may_skip_values_as_long_as_increasing() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    capability::execute_transfer<SUI>(
        &mut cap, &op_cap, &mut vault, TARGET, 10_000, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );
    capability::execute_transfer<SUI>(
        &mut cap, &op_cap, &mut vault, TARGET, 10_000, RISK_THRESHOLD, 100, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault);
    ts::return_shared(cap);
    destroy(op_cap);
    clock.destroy_for_testing();
    scenario.end();
}

/* ===== Policy: target and action authorization ===== */

#[test, expected_failure(abort_code = ETargetNotAllowed, location = capability)]
fun disallowed_target_aborts() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    capability::execute_transfer<SUI>(
        &mut cap, &op_cap, &mut vault, @0xBAD, 50_000, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault);
    ts::return_shared(cap);
    destroy(op_cap);
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = EOverTxLimit, location = capability)]
fun over_per_tx_limit_aborts() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    capability::execute_transfer<SUI>(
        &mut cap, &op_cap, &mut vault, TARGET, TX_LIMIT + 1, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault);
    ts::return_shared(cap);
    destroy(op_cap);
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = EOverPeriodLimit, location = capability)]
fun over_period_limit_aborts_within_same_period() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    let mut i: u64 = 0;
    while (i < 3) {
        capability::execute_transfer<SUI>(
            &mut cap, &op_cap, &mut vault, TARGET, TX_LIMIT, RISK_THRESHOLD, i + 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
        );
        i = i + 1;
    };
    capability::execute_transfer<SUI>(
        &mut cap, &op_cap, &mut vault, TARGET, TX_LIMIT, RISK_THRESHOLD, 4, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault);
    ts::return_shared(cap);
    destroy(op_cap);
    clock.destroy_for_testing();
    scenario.end();
}

#[test]
fun period_rolls_over_after_period_length_elapses() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let mut clock = clock::create_for_testing(scenario.ctx());

    let mut i: u64 = 0;
    while (i < 3) {
        capability::execute_transfer<SUI>(
            &mut cap, &op_cap, &mut vault, TARGET, TX_LIMIT, RISK_THRESHOLD, i + 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
        );
        i = i + 1;
    };

    clock.increment_for_testing(PERIOD_LENGTH_MS + 1);
    capability::execute_transfer<SUI>(
        &mut cap, &op_cap, &mut vault, TARGET, TX_LIMIT, RISK_THRESHOLD, 4, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault);
    ts::return_shared(cap);
    destroy(op_cap);
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = EInactive, location = capability)]
fun deactivated_cap_rejects_execute_action() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OWNER);
    let mut cap = scenario.take_shared<AgentCap>();
    capability::deactivate(&mut cap, scenario.ctx());
    ts::return_shared(cap);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    capability::execute_transfer<SUI>(
        &mut cap, &op_cap, &mut vault, TARGET, 50_000, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault);
    ts::return_shared(cap);
    destroy(op_cap);
    clock.destroy_for_testing();
    scenario.end();
}

/* ===== Target management ===== */

#[test]
fun add_and_remove_allowed_target_by_owner_succeeds() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OWNER);
    let mut cap = scenario.take_shared<AgentCap>();
    capability::add_allowed_target(&mut cap, @0xF00D, scenario.ctx());
    capability::remove_allowed_target(&mut cap, @0xF00D, scenario.ctx());

    ts::return_shared(cap);
    scenario.end();
}

#[test, expected_failure(abort_code = ENotOwner, location = capability)]
fun add_allowed_target_by_non_owner_aborts() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(ATTACKER);
    let mut cap = scenario.take_shared<AgentCap>();
    capability::add_allowed_target(&mut cap, @0xF00D, scenario.ctx());

    ts::return_shared(cap);
    scenario.end();
}

/// A protocol-required target can't be removed even by the legitimate
/// owner — uses a mock-swap cap since setup()'s generic cap has no
/// protocol targets.
#[test, expected_failure(abort_code = ECannotRemoveProtocolTarget, location = capability)]
fun remove_protocol_required_target_aborts_even_for_owner() {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());

    let pool_sui = coin::mint_for_testing<SUI>(10_000_000_000, scenario.ctx());
    let pool_usdc = coin::mint_for_testing<MOCK_USDC>(9_500_000_000, scenario.ctx());
    mock_dex::create_pool(pool_sui, pool_usdc, MOCK_RATE_USDC_PER_SUI, scenario.ctx());
    scenario.next_tx(OWNER);
    let pool = scenario.take_shared<MockPool>();
    let pool_address = object::id(&pool).to_address();
    ts::return_shared(pool);

    let vault = capability::new_vault(PERIOD_LENGTH_MS, scenario.ctx());
    capability::create_agent_cap_for_vault(
        &vault, PERIOD_LENGTH_MS,
        vector[ACTION_MOCK_SWAP], vector[pool_address], vector[pool_address],
        RISK_THRESHOLD, EXPIRY_MS, MAX_PENDING_WINDOW_MS, scenario.ctx(),
    );
    capability::share_vault(vault);
    clock.destroy_for_testing();

    scenario.next_tx(OWNER);
    let mut cap = scenario.take_shared<AgentCap>();
    capability::remove_allowed_target(&mut cap, pool_address, scenario.ctx());

    ts::return_shared(cap);
    scenario.end();
}

/* ===== Policy update functions ===== */

#[test]
fun update_functions_apply_new_values_by_owner() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OWNER);
    let mut cap = scenario.take_shared<AgentCap>();
    capability::update_spending_limit_per_tx<SUI>(&mut cap, TX_LIMIT * 2, scenario.ctx());
    capability::update_spending_limit_period<SUI>(&mut cap, PERIOD_LIMIT * 2, scenario.ctx());
    capability::update_period_length_ms(&mut cap, PERIOD_LENGTH_MS * 2, scenario.ctx());
    capability::update_risk_threshold(&mut cap, RISK_THRESHOLD + 10, scenario.ctx());
    capability::update_expiry_ms(&mut cap, EXPIRY_MS - 1, scenario.ctx());

    ts::return_shared(cap);
    scenario.end();
}

#[test, expected_failure(abort_code = EOverTxLimit, location = capability)]
fun updated_spending_limit_is_enforced_on_next_execution() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OWNER);
    let mut cap = scenario.take_shared<AgentCap>();
    capability::update_spending_limit_per_tx<SUI>(&mut cap, 10_000, scenario.ctx());
    ts::return_shared(cap);

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let clock = clock::create_for_testing(scenario.ctx());

    capability::execute_transfer<SUI>(
        &mut cap, &op_cap, &mut vault, TARGET, 50_000, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault);
    ts::return_shared(cap);
    destroy(op_cap);
    clock.destroy_for_testing();
    scenario.end();
}

/* ===== execute_stake — atomic staking, always SUI ===== */

const STAKE_AMOUNT: u64 = 1_000_000_000;

#[test]
#[allow(deprecated_usage)]
fun execute_stake_delivers_staked_sui_to_owner() {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());

    let vault = capability::new_vault(PERIOD_LENGTH_MS, scenario.ctx());
    capability::create_agent_cap_for_vault(
        &vault, PERIOD_LENGTH_MS,
        vector[ACTION_STAKE], vector[VALIDATOR], vector[VALIDATOR],
        RISK_THRESHOLD, EXPIRY_MS, MAX_PENDING_WINDOW_MS, scenario.ctx(),
    );
    capability::share_vault(vault);

    scenario.next_tx(OWNER);
    let mut cap = scenario.take_shared<AgentCap>();
    capability::mint_operator_cap(&cap, OPERATOR, scenario.ctx());
    capability::add_coin_limits<SUI>(&mut cap, STAKE_AMOUNT, STAKE_AMOUNT, &clock, scenario.ctx());
    ts::return_shared(cap);

    scenario.next_tx(OWNER);
    let mut vault = scenario.take_shared<Vault>();
    let funding = coin::mint_for_testing<SUI>(STAKE_AMOUNT, scenario.ctx());
    capability::deposit(&mut vault, funding, scenario.ctx());
    ts::return_shared(vault);

    scenario.next_tx(@0x0);
    let validator = governance_test_utils::create_validator_for_testing(VALIDATOR, 100, scenario.ctx());
    governance_test_utils::create_sui_system_state_for_testing(vector[validator], 1000, 0, scenario.ctx());

    scenario.next_tx(OPERATOR);
    let mut vault = scenario.take_shared<Vault>();
    let mut cap = scenario.take_shared<AgentCap>();
    let op_cap = scenario.take_from_sender<OperatorCap>();
    let mut system_state = scenario.take_shared<SuiSystemState>();

    capability::execute_stake(
        &mut cap, &op_cap, &mut vault, &mut system_state, VALIDATOR, STAKE_AMOUNT, RISK_THRESHOLD, 1, MAX_PENDING_WINDOW_MS, &clock, scenario.ctx(),
    );

    ts::return_shared(vault);
    ts::return_shared(cap);
    ts::return_shared(system_state);
    destroy(op_cap);
    clock.destroy_for_testing();

    scenario.next_tx(OWNER);
    let staked = scenario.take_from_sender<StakedSui>();
    assert_eq!(staked.staked_sui_amount(), STAKE_AMOUNT);
    destroy(staked);

    scenario.end();
}

/* ===== withdraw — owner reclaiming vault funds directly, no cap involved ===== */

#[test]
fun withdraw_returns_coin_to_owner() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(OWNER);
    let mut vault = scenario.take_shared<Vault>();
    let withdrawn = capability::withdraw<SUI>(&mut vault, 100_000, scenario.ctx());
    assert_eq!(withdrawn.value(), 100_000);
    destroy(withdrawn);

    ts::return_shared(vault);
    scenario.end();
}

#[test, expected_failure(abort_code = ENotOwner, location = capability)]
fun withdraw_by_non_owner_aborts() {
    let mut scenario = ts::begin(OWNER);
    setup(&mut scenario);

    scenario.next_tx(ATTACKER);
    let mut vault = scenario.take_shared<Vault>();
    let withdrawn = capability::withdraw<SUI>(&mut vault, 100_000, scenario.ctx());
    destroy(withdrawn);
    ts::return_shared(vault);
    scenario.end();
}
