module oronyx::capability;

use oronyx::operator_cap::{Self, OperatorCap};
use std::type_name::{Self, TypeName};
use sui::balance::{Balance};
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::clock::Clock;
use sui::vec_set::{Self, VecSet};
use sui::vec_map::{Self, VecMap};
use sui::event;
use sui::bag::{Self, Bag};
use sui_system::sui_system::{Self, SuiSystemState};
use oronyx::mock_dex::{Self, MockPool};
use oronyx::mock_usdc::MOCK_USDC;

/* Errors */
const EInactive: u64 = 0;
const EExpired: u64 = 1;
const EActionNotAllowed: u64 = 2;
const ETargetNotAllowed: u64 = 3;
const EOverTxLimit: u64 = 4;
const EOverPeriodLimit: u64 = 5;
const ENotOwner: u64 = 6;
const EWrongVault: u64 = 7;
const EWrongCap: u64 = 8;
const ECannotRemoveProtocolTarget: u64 = 9;
const ECoinTypeNotAllowed: u64 = 10;
const ECoinTypeNotInVault: u64 = 11;
const ECoinTypeAlreadyAllowed: u64 = 12;
const EWrongAgentCap: u64 = 13;
const EStaleGeneration: u64 = 14;
const EOverVaultTxLimit: u64 = 15;
const EOverVaultPeriodLimit: u64 = 16;
const EStaleNonce: u64 = 17;

/* Action type codes */
const ACTION_TRANSFER: u8 = 0;
const ACTION_MOCK_SWAP: u8 = 1;
const ACTION_STAKE: u8 = 2;
const ACTION_CETUS_SWAP: u8 = 3;

/* Structs */

/// Shared object that holds the user's funds.
/// Per-vault limits added to track total vault spending across multiple agents
/// Limits not required for single agent setup
public struct Vault has key {
    id: UID,
    owner: address,
    balances: Bag,
    limits: VecMap<TypeName, CoinLimits>,
    period_length_ms: u64,
}

public struct CoinLimits has store {
    spending_limit_per_tx: u64,
    spending_limit_period: u64,
    period_spent: u64,
    period_start_ms: u64,
}

/// Shared capability object describing the user-defined policy for one agent.
/// Access is enforced via owner and operator fields instead of Sui's
/// object-ownership system since the backend operator must be able to reference
/// this object without the user co-signing every transaction
public struct AgentCap has key {
    id: UID,
    vault_id: ID,
    owner: address,
    generation: u64,
    period_length_ms: u64,
    limits: VecMap<TypeName, CoinLimits>,
    allowed_actions: VecSet<u8>,
    allowed_targets: VecSet<address>,
    protocol_targets: VecSet<address>, //subset of allowed_targets for action-depending targets
    risk_threshold: u8,
    expiry_ms: u64,
    active: bool,
    last_nonce: u64,
}


/// User-owned object representing an action flagged for manual review.
/// Owned by the user so approve/reject can rely on Sui's ownership check
/// rather than manual assert
public struct PendingAction<phantom T> has key {
    id: UID,
    cap_id: ID,
    vault_id: ID,
    action_type: u8,
    target: address,
    amount: u64,
    risk_score: u8,
    created_at_ms: u64,
}

/* Events */

public struct CapCreated has copy, drop {
    cap_id: ID,
    vault_id: ID,
    owner: address,
}

public struct OperatorCapMinted has copy, drop {
    operator_cap_id: ID,
    agent_cap_id: ID,
    operator: address,
    generation: u64,
}

public struct OperatorRevoked has copy, drop {
    cap_id: ID,
    new_generation: u64,
}

public struct ActionExecuted has copy, drop {
    cap_id: ID,
    action_type: u8,
    target: address,
    amount: u64,
    risk_score: u8,
}

public struct ActionFlagged has copy, drop {
    cap_id: ID,
    pending_id: ID,
    action_type: u8,
    target: address,
    amount: u64,
    risk_score: u8,
}

public struct PendingApproved has copy, drop {
    pending_id: ID,
    cap_id: ID,
}

public struct PendingRejected has copy, drop {
    pending_id: ID,
    cap_id: ID,
}

public struct CapDeactivated has copy, drop {
    cap_id: ID,
}

public struct ProceedsReturned has copy, drop {
    cap_id: ID,
    vault_id: ID,
    coin_type: TypeName,
    amount: u64,
}

/* Vault Functions */

/// Create vault with no limits and no agents attached
/// Returned by value, to be composed with create_agent_cap_for_vault
/// or direct to share_vault at the end in one PTB.
public fun new_vault(period_length_ms: u64, ctx: &mut TxContext): Vault {
    Vault {
        id: object::new(ctx),
        owner: ctx.sender(),
        balances: bag::new(ctx),
        limits: vec_map::empty(),
        period_length_ms,
    }
}

public fun share_vault(vault: Vault) {
    transfer::share_object(vault);
}

/// Shared logic for actions to put assets into vault.
fun put_into_vault<T>(vault: &mut Vault, payment: Coin<T>) {
    let key = type_name::with_defining_ids<T>();
    if (bag::contains(&vault.balances, key)) {
        let bal: &mut Balance<T> = bag::borrow_mut(&mut vault.balances, key);
        coin::put(bal, payment);
    } else {
        bag::add(&mut vault.balances, key, coin::into_balance(payment));
    }
}

/// Lets the user deposit funds to the shared vault. The agent can only make
/// use of funds in the vault, not directly from the user's wallet.
public fun deposit<T>(vault: &mut Vault, payment: Coin<T>, ctx: &TxContext) {
    assert!(vault.owner == ctx.sender(), ENotOwner);
    put_into_vault(vault, payment);
}

/// Lets the user reclaim funds directly, independent of any agent action
/// or policy. Deliberately takes no AgentCap, this is the owner exercising
/// ownership of their own vault, not something an agent policy governs.
public fun withdraw<T>(vault: &mut Vault, amount: u64, ctx: &mut TxContext): Coin<T> {
    assert!(vault.owner == ctx.sender(), ENotOwner);
    let key = type_name::with_defining_ids<T>();
    assert!(bag::contains(&vault.balances, key), ECoinTypeNotInVault);
    let bal: &mut Balance<T> = bag::borrow_mut(&mut vault.balances, key);
    coin::take(bal, amount, ctx)
}

public fun add_vault_coin_limits<T>(
    vault: &mut Vault,
    spending_limit_per_tx: u64,
    spending_limit_period: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(vault.owner == ctx.sender(), ENotOwner);
    let key = type_name::with_defining_ids<T>();
    assert!(!vault.limits.contains(&key), ECoinTypeAlreadyAllowed);
    vault.limits.insert(key, CoinLimits {
        spending_limit_per_tx,
        spending_limit_period,
        period_spent: 0,
        period_start_ms: clock.timestamp_ms(),
    });
}

public fun update_vault_spending_limit_per_tx<T>(vault: &mut Vault, spending_limit_per_tx: u64, ctx: &TxContext) {
    assert!(vault.owner == ctx.sender(), ENotOwner);
    let key = type_name::with_defining_ids<T>();
    assert!(vault.limits.contains(&key), ECoinTypeNotAllowed);
    vault.limits.get_mut(&key).spending_limit_per_tx = spending_limit_per_tx;
}

public fun update_vault_spending_limit_period<T>(vault: &mut Vault, spending_limit_period: u64, ctx: &TxContext) {
    assert!(vault.owner == ctx.sender(), ENotOwner);
    let key = type_name::with_defining_ids<T>();
    assert!(vault.limits.contains(&key), ECoinTypeNotAllowed);
    vault.limits.get_mut(&key).spending_limit_period = spending_limit_period;
}

public fun remove_vault_coin_limits<T>(vault: &mut Vault, ctx: &TxContext) {
    assert!(vault.owner == ctx.sender(), ENotOwner);
    let key = type_name::with_defining_ids<T>();
    assert!(vault.limits.contains(&key), ECoinTypeNotAllowed);
    let (_, limits) = vault.limits.remove(&key);
    let CoinLimits { .. } = limits;
}

public fun update_vault_period_length_ms(vault: &mut Vault, period_length_ms: u64, ctx: &TxContext) {
    assert!(vault.owner == ctx.sender(), ENotOwner);
    vault.period_length_ms = period_length_ms;
}

/* AgentCap Lifecycle */

/// Creates an AgentCap and attach to a vault, either a freshly created
/// one in the same PTB, or an already-shared vault the caller owns.
/// A vault can have any number of AgentCaps, while an AgentCap always
/// belongs to exactly one vault.
public fun create_agent_cap_for_vault(
    vault: &Vault,
    period_length_ms: u64,
    allowed_actions: vector<u8>,
    allowed_targets: vector<address>,
    protocol_targets: vector<address>,
    risk_threshold: u8,
    expiry_ms: u64,
    ctx: &mut TxContext,
) {
    assert!(vault.owner == ctx.sender(), ENotOwner);
    let vault_id = object::id(vault);

    let mut targets = vec_set::from_keys(allowed_targets);
    let mut i = 0;
    let n = protocol_targets.length();
    while (i < n) {
        let addr = protocol_targets[i];
        if (!targets.contains(&addr)) {
            targets.insert(addr);
        };
        i = i + 1;
    };
    let protocol_targets_set = vec_set::from_keys(protocol_targets);

    let cap = AgentCap {
        id: object::new(ctx),
        vault_id,
        owner: ctx.sender(),
        generation: 0,
        period_length_ms,
        limits: vec_map::empty(), //populated via add_coin_limits<T>, once per type, in the same PTB right after
        allowed_actions: vec_set::from_keys(allowed_actions),
        allowed_targets: targets,
        protocol_targets: protocol_targets_set,
        risk_threshold,
        expiry_ms,
        active: true,
        last_nonce: 0,
    };

    event::emit(CapCreated {
        cap_id: object::id(&cap),
        vault_id,
        owner: cap.owner,
    });
    transfer::share_object(cap);
    // Next, in the same PTB
    // 1. Owner calls mint_operator_cap() to delegate to an operator
    // 2. add_coin_limits<T>() to add limits to allowed coin types.
    // 3. share_vault() if the vault is still a locally created in the PTB.
}

public fun mint_operator_cap(
    cap: &AgentCap,
    operator: address,
    ctx: &mut TxContext
) {
    assert!(cap.owner == ctx.sender(), ENotOwner);
    let op_cap = operator_cap::new(object::id(cap), cap.generation, ctx);

    event::emit(OperatorCapMinted {
        operator_cap_id: object::id(&op_cap),
        agent_cap_id: object::id(cap),
        operator,
        generation: cap.generation,
    });
    operator_cap::transfer_to(op_cap, operator);
}

/// Owner-only. Bumps generation to invalidate every OperatorCap referencing
/// this AgentCap at once. Rotating operators is revoke + mint
public fun revoke_operator(cap: &mut AgentCap, ctx: &mut TxContext) {
    assert!(cap.owner == ctx.sender(), ENotOwner);
    cap.generation = cap.generation + 1;
    event::emit(OperatorRevoked {
        cap_id: object::id(cap),
        new_generation: cap.generation,
    })
}

fun assert_valid_operator(op_cap: &OperatorCap, cap: &AgentCap) {
    assert!(op_cap.agent_cap_id() == object::id(cap), EWrongAgentCap);
    assert!(op_cap.generation() == cap.generation, EStaleGeneration);
}

public fun add_coin_limits<T>(
    cap: &mut AgentCap,
    spending_limit_per_tx: u64,
    spending_limit_period: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(cap.owner == ctx.sender(), ENotOwner);
    let key = type_name::with_defining_ids<T>();
    assert!(!cap.limits.contains(&key), ECoinTypeAlreadyAllowed);
    cap.limits.insert(key, CoinLimits {
        spending_limit_per_tx,
        spending_limit_period,
        period_spent: 0,
        period_start_ms: clock.timestamp_ms(),
    });
}

public fun remove_coin_limits<T>(
    cap: &mut AgentCap,
    ctx: &TxContext,
) {
    assert!(cap.owner == ctx.sender(), ENotOwner);
    let key = type_name::with_defining_ids<T>();
    assert!(cap.limits.contains(&key), ECoinTypeNotAllowed);
    let (_, limits) = cap.limits.remove(&key);
    let CoinLimits { .. } = limits;
}

public fun add_allowed_target(
    cap: &mut AgentCap,
    target: address,
    ctx: &TxContext,
) {
    assert!(cap.owner == ctx.sender(), ENotOwner);
    cap.allowed_targets.insert(target);
}


public fun remove_allowed_target(
    cap: &mut AgentCap,
    target: address,
    ctx: &TxContext,
) {
    assert!(cap.owner == ctx.sender(), ENotOwner);
    assert!(!cap.protocol_targets.contains(&target), ECannotRemoveProtocolTarget);
    cap.allowed_targets.remove(&target);
}

public fun update_spending_limit_per_tx<T>(
    cap: &mut AgentCap,
    spending_limit_per_tx: u64,
    ctx: &TxContext,
) {
    assert!(cap.owner == ctx.sender(), ENotOwner);
    let key = type_name::with_defining_ids<T>();
    assert!(cap.limits.contains(&key), ECoinTypeNotAllowed);
    cap.limits.get_mut(&key).spending_limit_per_tx = spending_limit_per_tx;
}

public fun update_spending_limit_period<T>(
    cap: &mut AgentCap,
    spending_limit_period: u64,
    ctx: &TxContext,
) {
    assert!(cap.owner == ctx.sender(), ENotOwner);
    let key = type_name::with_defining_ids<T>();
    assert!(cap.limits.contains(&key), ECoinTypeNotAllowed);
    cap.limits.get_mut(&key).spending_limit_period = spending_limit_period;
}

public fun update_period_length_ms(
    cap: &mut AgentCap,
    period_length_ms: u64,
    ctx: &TxContext,
) {
    assert!(cap.owner == ctx.sender(), ENotOwner);
    cap.period_length_ms = period_length_ms;
}

public fun update_risk_threshold(
    cap: &mut AgentCap,
    risk_threshold: u8,
    ctx: &TxContext,
) {
    assert!(cap.owner == ctx.sender(), ENotOwner);
    cap.risk_threshold = risk_threshold;
}

public fun update_expiry_ms(
    cap: &mut AgentCap,
    expiry_ms: u64,
    ctx: &TxContext,
) {
    assert!(cap.owner == ctx.sender(), ENotOwner);
    cap.expiry_ms = expiry_ms;
}

public fun deactivate(cap: &mut AgentCap, ctx: &TxContext) {
    assert!(cap.owner == ctx.sender(), ENotOwner);
    cap.active = false;
    event::emit(CapDeactivated { cap_id: object::id(cap) });
}

/* Policy Helpers */

/// Rolls the spending window forward id the current period has elapsed.
/// Must be called before checking `period_spent` against the limit.
fun roll_period_if_needed(limits: &mut CoinLimits, period_length_ms: u64, now_ms: u64) {
    if (now_ms >= limits.period_start_ms + period_length_ms) {
        limits.period_start_ms = now_ms;
        limits.period_spent = 0;
    }
}

/* Core execution entrypoint */

/// Called by agent backend (signed by operator), never by the user directly.
/// Check against policy on cap, if action is within risk boundary, it executes immediately against vault.
/// If it exceeds risk threshold, set as PendingAction owned by user instead of touching the vault.
public fun execute_action<T>(
    cap: &mut AgentCap,
    op_cap: &OperatorCap,
    vault: &mut Vault,
    action_type: u8,
    target: address,
    amount: u64,
    risk_score: u8,
    nonce: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): Option<Coin<T>> {
    assert_valid_operator(op_cap, cap);
    assert!(cap.vault_id == object::id(vault), EWrongVault);
    assert!(cap.active, EInactive);
    assert!(nonce > cap.last_nonce, EStaleNonce);
    cap.last_nonce = nonce;

    let now_ms = clock.timestamp_ms();
    assert!(now_ms < cap.expiry_ms, EExpired);
    assert!(cap.allowed_actions.contains(&action_type), EActionNotAllowed);
    assert!(cap.allowed_targets.contains(&target), ETargetNotAllowed);

    let coin_key = type_name::with_defining_ids<T>();
    assert!(cap.limits.contains(&coin_key), ECoinTypeNotAllowed);

    // Captured before borrowing into cap.limits below — object::id(cap)
    // needs an immutable borrow of the whole AgentCap, which the field-level
    // borrow via `limits` would otherwise conflict with for the rest of
    // this function.
    let cap_id = object::id(cap);
    let owner = cap.owner;
    let vault_id = cap.vault_id;
    let risk_threshold = cap.risk_threshold;
    let period_length_ms = cap.period_length_ms;

    let limits = cap.limits.get_mut(&coin_key);
    assert!(amount <= limits.spending_limit_per_tx, EOverTxLimit);

    roll_period_if_needed(limits, period_length_ms, now_ms);
    assert!(limits.period_spent + amount <= limits.spending_limit_period, EOverPeriodLimit);

    let vault_period_length_ms = vault.period_length_ms;
    if (vault.limits.contains(&coin_key)) {
        let vault_limits = vault.limits.get_mut(&coin_key);
        assert!(amount <= vault_limits.spending_limit_per_tx, EOverVaultTxLimit);
        roll_period_if_needed(vault_limits, vault_period_length_ms, now_ms);
        assert!(vault_limits.period_spent + amount <= vault_limits.spending_limit_period, EOverVaultPeriodLimit);
    };

    if (risk_score > risk_threshold) {
        let pending = PendingAction<T> {
            id: object::new(ctx),
            cap_id,
            vault_id,
            action_type,
            target,
            amount,
            risk_score,
            created_at_ms: now_ms,
        };
        event::emit(ActionFlagged {
            cap_id,
            pending_id: object::id(&pending),
            action_type,
            target,
            amount,
            risk_score,
        });
        transfer::transfer(pending, owner);
        option::none()
    } else {
        limits.period_spent = limits.period_spent + amount;
        if (vault.limits.contains(&coin_key)) {
            let vault_limits = vault.limits.get_mut(&coin_key);
            vault_limits.period_spent = vault_limits.period_spent + amount;
        };
        let bal: &mut Balance<T> = bag::borrow_mut(&mut vault.balances, coin_key);
        let out_coin = coin::take(bal, amount, ctx);
        event::emit(ActionExecuted { cap_id, action_type, target, amount, risk_score });
        option::some(out_coin)
    }
}

#[allow(lint(self_transfer))]
/// Entry function for Cetus swap, this action type has an external SDK that
/// require a two-step hand-off. Cetus' swap builder always constructs its own tx
/// and selects input coins from the signer's on-chain balance, with no way to
/// accept a specific coin object or an existing transaction to append to.
///
/// Releases the approved coin to `ctx.sender()` (the operator), so the executor's
/// second transaction (an ordinary Cetus swap) can pick it up from the operator's
/// own balance. Not atomic, if the second transaction fails, funds remain with the
/// the operator rather than returning to the vault.
public fun execute_cetus_swap_and_transfer_to_operator<T>(
    cap: &mut AgentCap,
    op_cap: &OperatorCap,
    vault: &mut Vault,
    cetus_pool_address: address,
    amount: u64, // MIST
    risk_score: u8,
    nonce: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let maybe_coin = execute_action<T>(cap, op_cap, vault, ACTION_CETUS_SWAP, cetus_pool_address, amount, risk_score, nonce, clock, ctx);
    if(maybe_coin.is_some()) {
        transfer::public_transfer(maybe_coin.destroy_some(), ctx.sender());
    } else {
        maybe_coin.destroy_none();
    }
}

public fun return_proceeds<T>(
    cap: &AgentCap,
    op_cap: &OperatorCap,
    vault: &mut Vault,
    payment: Coin<T>,
) {
    assert_valid_operator(op_cap, cap);
    assert!(cap.vault_id == object::id(vault), EWrongVault);

    let amount = payment.value();
    let coin_type = type_name::with_defining_ids<T>();
    put_into_vault(vault,payment);

    event::emit(ProceedsReturned {
        cap_id: object::id(cap),
        vault_id: object::id(vault),
        coin_type,
        amount,
    });
}

/* Atomic action types */
// Funds never leave vault custody boundary until they land
// at their real destination, all within one PTB. Each has its
// own entry function because Move does not support optional args,
// so each action type's extra required objects (a MockPool,
// a SuiSystemState, etc.) need their iwn dedicated signature. Only
// actions whose external SDK forces a two-step hand-off (such as Cetus)
// use execute_action_and_tranfer_to_operator instead.

public fun execute_transfer<T>(
    cap: &mut AgentCap,
    op_cap: &OperatorCap,
    vault: &mut Vault,
    recipient: address,
    amount: u64, // MIST
    risk_score: u8,
    nonce: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let maybe_coin = execute_action<T>(cap, op_cap, vault, ACTION_TRANSFER, recipient, amount, risk_score, nonce, clock, ctx);
    if (maybe_coin.is_some()) {
        transfer::public_transfer(maybe_coin.destroy_some(), recipient);
    } else {
        maybe_coin.destroy_none();
    }
}

/// `validator` is both the policy's target (must be in allowed_targets)
/// and the actual validator address staked with.
///
/// Verified against the sui-system framework source:
/// `sui_system::request_add_stake_non_entry` returns a `StakedSui` object
/// (has `key, store`, not `drop`) rather than auto-transferring it, so the
/// result must be explicitly transferred here.
public fun execute_stake(
    cap: &mut AgentCap,
    op_cap: &OperatorCap,
    vault: &mut Vault,
    system_state: &mut SuiSystemState,
    validator: address,
    amount: u64, // MIST
    risk_score: u8,
    nonce: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let maybe_coin = execute_action<SUI>(cap, op_cap, vault, ACTION_STAKE, validator, amount, risk_score, nonce, clock, ctx);
    if (maybe_coin.is_some()) {
        let staked = sui_system::request_add_stake_non_entry(
            system_state,
            maybe_coin.destroy_some(),
            validator,
            ctx
        );
        transfer::public_transfer(staked, cap.owner);
    } else {
        maybe_coin.destroy_none();
    }
}

/// `pool_address` is both the policy's target (must be in allowed targets list)
/// and the actual `MockPool` object passed in. The caller is responsible for
/// making these consistent; a mismatch here is a caller bug.
public fun execute_mock_swap_sui_to_usdc(
    cap: &mut AgentCap,
    op_cap: &OperatorCap,
    vault: &mut Vault,
    pool: &mut MockPool,
    pool_address: address,
    amount: u64, // MIST
    risk_score: u8,
    nonce: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let maybe_coin = execute_action<SUI>(cap, op_cap, vault, ACTION_MOCK_SWAP, pool_address, amount, risk_score, nonce, clock, ctx);
    if (maybe_coin.is_some()) {
        let out: Coin<MOCK_USDC> = mock_dex::swap_sui_for_mock_usdc(pool, maybe_coin.destroy_some(), ctx);
        put_into_vault(vault, out);
    } else {
        maybe_coin.destroy_none();
    }
}

public fun execute_mock_swap_usdc_to_sui(
    cap: &mut AgentCap,
    op_cap: &OperatorCap,
    vault: &mut Vault,
    pool: &mut MockPool,
    pool_address: address,
    amount: u64, // MOCK_USDC smallest unit
    risk_score: u8,
    nonce: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let maybe_coin = execute_action<MOCK_USDC>(cap, op_cap, vault, ACTION_MOCK_SWAP, pool_address, amount, risk_score, nonce, clock, ctx);
    if (maybe_coin.is_some()) {
        let out: Coin<SUI> = mock_dex::swap_mock_usdc_for_sui(pool, maybe_coin.destroy_some(), ctx);
        put_into_vault(vault, out);
    } else {
        maybe_coin.destroy_none();
    }
}

/* Approval flow for flagged actions */

public fun approve_pending<T>(
    pending: PendingAction<T>,
    cap: &mut AgentCap,
    vault: &mut Vault,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(cap.owner == ctx.sender(), ENotOwner);
    assert!(pending.cap_id == object::id(cap), EWrongCap);
    assert!(pending.vault_id == object::id(vault), EWrongVault);

    let cap_id = object::id(cap);
    let PendingAction { id, cap_id: _, vault_id: _, action_type, target, amount, risk_score, created_at_ms: _ } = pending;

    let coin_key = type_name::with_defining_ids<T>();
    // Owner may have removed this coin type limits since the action was
    // flagged. Approving is itself the owner's authorization, so we still
    // release the funds, but skip bookkeeping for a limit that no longer
    // exists rather than aborting
    if (cap.limits.contains(&coin_key)) {
        let limits = cap.limits.get_mut(&coin_key);
        limits.period_spent = limits.period_spent + amount;
    };
    if (vault.limits.contains(&coin_key)) {
        let vault_limits = vault.limits.get_mut(&coin_key);
        vault_limits.period_spent = vault_limits.period_spent + amount;
    };

    let bal: &mut Balance<T> = bag::borrow_mut(&mut vault.balances, coin_key);
    let out_coin = coin::take(bal, amount, ctx);

    event::emit(PendingApproved { pending_id: object::uid_to_inner(&id), cap_id });
    event::emit(ActionExecuted { cap_id, action_type, target, amount, risk_score });

    object::delete(id);
    out_coin
}


public fun reject_pending<T>(pending: PendingAction<T>, cap: &AgentCap, ctx: &TxContext) {
    assert!(cap.owner == ctx.sender(), ENotOwner);
    assert!(pending.cap_id == object::id(cap), EWrongCap);

    let PendingAction { id, cap_id, .. } = pending;
    event::emit(PendingRejected { pending_id: object::uid_to_inner(&id), cap_id });
    object::delete(id);
}
