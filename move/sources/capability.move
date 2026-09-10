module oronyx::capability;

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
const ENotOperator: u64 = 7;
const EWrongVault: u64 = 8;
const EWrongCap: u64 = 9;
const ECannotRemoveProtocolTarget: u64 = 10;
const ECoinTypeNotAllowed: u64 = 11;
const ECoinTypeNotInVault: u64 = 12;
const ECoinTypeAlreadyAllowed: u64 = 13;

/* Action type codes */
const ACTION_TRANSFER: u8 = 0;
const ACTION_MOCK_SWAP: u8 = 1;
const ACTION_STAKE: u8 = 2;
const ACTION_CETUS_SWAP: u8 = 3;

/* Structs */

/// Shared object that holds the user's funds.
/// The vault does not enforce the policy.
/// All policy checks live on AgentCap
public struct Vault has key {
    id: UID,
    owner: address,
    balances: Bag,
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
    operator: address,
    period_length_ms: u64,
    limits: VecMap<TypeName, CoinLimits>,
    allowed_actions: VecSet<u8>,
    allowed_targets: VecSet<address>,
    /// Subset of allowed_targets that a currently-enabled action type
    /// structurally depends on (a DeFi pool, a validator address) —
    /// protected from removal via remove_allowed_target so the user can't
    /// accidentally break an action by editing their target whitelist.
    /// Populated once at cap creation; not independently user-editable.
    protocol_targets: VecSet<address>,
    risk_threshold: u8,
    expiry_ms: u64,
    active: bool,
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
    operator: address,
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

/// Shared logic for actions to put assets into vault
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

/* AgentCap Lifecycle */

/// Creates a vault and its governing AgentCap together, in one call, one
/// signature. Vaults are 1:1 with agents — there is no standalone
/// vault-creation entrypoint, so a vault can never exist without a cap
/// already governing it.
public fun create_agent_cap(
    operator: address,
    period_length_ms: u64,
    allowed_actions: vector<u8>,
    allowed_targets: vector<address>,
    protocol_targets: vector<address>,
    risk_threshold: u8,
    expiry_ms: u64,
    ctx: &mut TxContext,
) {
    let vault = Vault {
        id: object::new(ctx),
        owner: ctx.sender(),
        balances: bag::new(ctx),
    };
    let vault_id = object::id(&vault);

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
        operator,
        period_length_ms,
        limits: vec_map::empty(), //populated via add_coin_limits<T>, once per type, in the same PTB right after
        allowed_actions: vec_set::from_keys(allowed_actions),
        allowed_targets: targets,
        protocol_targets: protocol_targets_set,
        risk_threshold,
        expiry_ms,
        active: true,
    };

    event::emit(CapCreated {
        cap_id: object::id(&cap),
        vault_id,
        owner: cap.owner,
        operator: cap.operator,
    });

    transfer::share_object(vault);
    transfer::share_object(cap);
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
    vault: &mut Vault,
    action_type: u8,
    target: address,
    amount: u64,
    risk_score: u8,
    clock: &Clock,
    ctx: &mut TxContext,
): Option<Coin<T>> {
    assert!(cap.operator == ctx.sender(), ENotOperator);
    assert!(cap.vault_id == object::id(vault), EWrongVault);
    assert!(cap.active, EInactive);

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
    vault: &mut Vault,
    cetus_pool_address: address,
    amount: u64, // MIST
    risk_score: u8,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let maybe_coin = execute_action<T>(cap, vault, ACTION_CETUS_SWAP, cetus_pool_address, amount, risk_score, clock, ctx);
    if(maybe_coin.is_some()) {
        transfer::public_transfer(maybe_coin.destroy_some(), ctx.sender());
    } else {
        maybe_coin.destroy_none();
    }
}

public fun return_proceeds<T>(
    cap: &AgentCap,
    vault: &mut Vault,
    payment: Coin<T>,
    ctx: &TxContext,
) {
    assert!(cap.operator == ctx.sender(), ENotOperator);
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
    vault: &mut Vault,
    recipient: address,
    amount: u64, // MIST
    risk_score: u8,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let maybe_coin = execute_action<T>(cap, vault, ACTION_TRANSFER, recipient, amount, risk_score, clock, ctx);
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
    vault: &mut Vault,
    system_state: &mut SuiSystemState,
    validator: address,
    amount: u64, // MIST
    risk_score: u8,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let maybe_coin = execute_action<SUI>(cap, vault, ACTION_STAKE, validator, amount, risk_score, clock, ctx);
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
    vault: &mut Vault,
    pool: &mut MockPool,
    pool_address: address,
    amount: u64, // MIST
    risk_score: u8,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let maybe_coin = execute_action<SUI>(cap, vault, ACTION_MOCK_SWAP, pool_address, amount, risk_score, clock, ctx);
    if (maybe_coin.is_some()) {
        let out: Coin<MOCK_USDC> = mock_dex::swap_sui_for_mock_usdc(pool, maybe_coin.destroy_some(), ctx);
        transfer::public_transfer(out, cap.owner);
    } else {
        maybe_coin.destroy_none();
    }
}

public fun execute_mock_swap_usdc_to_sui(
    cap: &mut AgentCap,
    vault: &mut Vault,
    pool: &mut MockPool,
    pool_address: address,
    amount: u64, // MOCK_USDC smallest unit
    risk_score: u8,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let maybe_coin = execute_action<MOCK_USDC>(cap, vault, ACTION_MOCK_SWAP, pool_address, amount, risk_score, clock, ctx);
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
