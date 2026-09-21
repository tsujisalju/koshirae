# Koshirae — Move Contract

Sui Move package implementing scoped, policy-enforced agent wallets. This is
the on-chain trust layer for Koshirae: it defines what an autonomous agent is
allowed to do with a user's funds, and enforces that boundary at the
transaction level rather than relying on off-chain promises.

## Concepts

**Vault** — a shared object holding a user's deposited `SUI` balance. The
vault itself has no policy logic; it only tracks ownership and balance.
Vaults are 1:1 with agents — see "Vault lifecycle" below.

**AgentCap** — a shared object encoding one agent's authorization: which
actions it may perform, on which targets, up to what spending limits, until
what expiry, and above what risk score an action must be flagged for manual
review instead of auto-executed.

**PendingAction** — a user-owned object representing an action that exceeded
the agent's risk threshold. Created automatically by `execute_action`;
resolved later by the user calling `approve_pending` or `reject_pending`.

## Vault lifecycle: 1:1 with agents

There is no standalone vault-creation entrypoint. `create_agent_cap` creates
a `Vault` and its governing `AgentCap` together, in one call, one user
signature — a vault can never exist without a cap already governing it, and
an agent can never reference a vault it doesn't own.

This was a deliberate scope decision, not an oversight. A shared vault
usable by multiple agents was considered and rejected for now: two agents
could each individually respect their own `spending_limit_period` while
collectively draining a shared vault faster than either policy alone
implies, since neither cap's accounting is aware of the other. Multi-agent
vaults may be worth revisiting later, but the conflict-of-decisions problem
needs a real answer first, not just a UI that allows it.

`withdraw(vault, amount, ctx) -> Coin<SUI>` lets the owner reclaim funds
directly — no `AgentCap` involved, deliberately kept outside the
policy-enforcement path since it's the user exercising ownership of their
own vault, not an agent action. Combined with `deactivate`, this gives the
user a full exit path independent of whether the agent or backend is
trusted, online, or even compromised.

## Why shared objects, not owned objects

`AgentCap` is a shared object rather than being owned by the user's address.
This was a deliberate design correction: an address-owned object can only be
referenced by a transaction that address itself signs. Since the whole point
of an agent is to act without the user co-signing every transaction, the cap
has to be shared — access control is enforced by explicit `assert!` checks
against `owner` and `operator` fields instead of Sui's object-ownership
system.

- `owner` — the user. Can deactivate the cap, approve or reject a
  `PendingAction`, withdraw from the vault, and edit policy fields.
- `operator` — the backend's own address (see `/executor`). The only address
  allowed to call any of the `execute_*` functions.

`PendingAction`, by contrast, genuinely is user-owned — approval/rejection is
naturally gated by Sui's ownership model, so no extra authorization field is
needed there.

## Action types: atomic by default

`execute_action` is the shared policy engine — it checks `active`,
`expiry_ms`, `allowed_actions`, `allowed_targets`, `spending_limit_per_tx`,
and the rolling `spending_limit_period` window, then either releases a
`Coin<SUI>` (`Option::some`) or parks a `PendingAction` for the user
(`Option::none`). It stays `public` (used directly in tests and by the one
two-step exception below), but application code should call one of the
dedicated wrappers below rather than `execute_action` itself.

Each supported action type gets its own entry function, because Move doesn't
support optional or variadic arguments — an action that needs an extra
object (a `MockPool`, a `SuiSystemState`) needs its own signature to accept
it. **Atomicity is the default**: a new action type should complete in a
single Move call, single PTB, funds never leaving the vault's custody
boundary until they land at their real destination. A two-step
release-to-operator pattern is only justified when an external protocol's
SDK genuinely forces it (see the Cetus exception below) — that's a
per-integration exception, not a general architecture.

| Function                                      | Action type             | Delivers result to        | Notes                                                                                                                                                                                                   |
| --------------------------------------------- | ----------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execute_transfer`                            | `ACTION_TRANSFER` (0)   | `recipient`               | Plain native SUI transfer. `recipient` must be in `allowed_targets`.                                                                                                                                    |
| `execute_stake`                               | `ACTION_STAKE` (2)      | `cap.owner`               | Calls `sui_system::request_add_stake_non_entry`, delivers the resulting `StakedSui` to the user — an ongoing position they should see and manage in their own wallet, not something the operator holds. |
| `execute_mock_swap`                           | `ACTION_MOCK_SWAP` (1)  | `cap.owner`               | Atomic call into `koshirae::mock_dex`. `pool_address` doubles as both the policy `target` and the actual pool object passed in — caller is responsible for keeping these consistent.                      |
| `execute_cetus_swap_and_transfer_to_operator` | `ACTION_CETUS_SWAP` (3) | `ctx.sender()` (operator) | **Not atomic.** See below.                                                                                                                                                                              |

## The one two-step exception: Cetus

`execute_cetus_swap_and_transfer_to_operator` is deliberately scoped to
Cetus specifically, not a generic two-step runner. It exists because
Cetus's SDK (`@cetusprotocol/sui-clmm-sdk`) always constructs its own
`Transaction` internally and selects input coins from the signer's on-chain
balance — there's no way to hand it an existing transaction to append to, or
a specific coin object as input. Given that constraint, the flow is split:

1. This function checks policy and releases the approved coin to the
   **operator's own address** (`ctx.sender()`), not the vault or the user.
2. A second, ordinary transaction (built in `/executor`) runs the actual
   Cetus swap against whatever the operator now holds.

**This is not atomic.** If step 2 fails after step 1 succeeds, funds sit in
the operator's wallet rather than returning to the vault, with no automatic
reconciliation currently implemented. Treat this as a known, documented
limitation of the Cetus integration specifically — not a precedent for how
future action types should be designed. As more DeFi integrations are
added, each one should be evaluated independently: if the protocol exposes
composable Move calls, integrate atomically like `execute_mock_swap` does;
only fall back to the two-step pattern if the protocol's SDK genuinely
leaves no other option.

As of this writing, Cetus's testnet pools were found to reject swaps with a
zero-output error for every available SUI-paired pool at reasonable test
amounts — see `/executor/README.md` for the verification process. The mock
DEX (`koshirae::mock_dex`) is the primary swap path used for demos; Cetus
integration remains implemented and reachable, not removed.

## Error codes

| Code | Constant            | Meaning                                                      |
| ---- | ------------------- | ------------------------------------------------------------ |
| 0    | `EInactive`         | Cap has been deactivated by the owner                        |
| 1    | `EExpired`          | Past `expiry_ms`                                             |
| 2    | `EActionNotAllowed` | `action_type` not in `allowed_actions`                       |
| 3    | `ETargetNotAllowed` | `target` not in `allowed_targets`                            |
| 4    | `EOverTxLimit`      | `amount` exceeds `spending_limit_per_tx`                     |
| 5    | `EOverPeriodLimit`  | Cumulative spend this period exceeds `spending_limit_period` |
| 6    | `ENotOwner`         | Caller is not `cap.owner`                                    |
| 7    | `ENotOperator`      | Caller is not `cap.operator`                                 |
| 8    | `EWrongVault`       | Vault passed doesn't match `cap.vault_id`                    |
| 9    | `EWrongCap`         | `PendingAction` doesn't belong to the cap passed in          |

## Building and testing

```bash
sui move build
sui move test
```

Tests live in `tests/capability_tests.move` (policy engine, Cetus path,
transfer, mock swap) and `tests/mock_dex_tests.move` (the mock DEX in
isolation). They use `sui::test_scenario` to simulate multi-transaction
flows and `sui::clock` test helpers to exercise period-rollover logic.

**`execute_stake` has no test coverage yet.** Constructing a fake
`SuiSystemState`/validator set for testing requires Sui's own test-utility
scaffolding (likely something under `sui_system::governance_test_utils`,
based on how Sui's own framework tests exercise staking), which hasn't been
verified against this project's framework revision. Confirm the correct
test-utility entrypoint before writing this test.

Error and action-type constants in the test modules are manually mirrored
from their source modules, since those don't expose them as `public`. If a
constant's value changes in the contract, update the mirrored copy in the
corresponding test module to match — this has already caused failures once
(see git history around the `execute_cetus_swap_and_transfer_to_operator`
rename) and will again if missed.

## Deployment (testnet)

```bash
sui client switch --env testnet
sui client publish --gas-budget 200000000
```

Record the resulting package ID from the publish output (also saved to
`Published.toml` under `[published.testnet]`). Post-publish setup — minting
`MOCK_USDC`, creating a `MockPool`, creating an agent cap (which creates its
paired vault in the same call), and depositing funds — is not part of
`publish`; see `post-deploy.sh` for the full sequence of `sui client call`
commands. Note that the `MockPool` must be created **before** the agent
cap if the cap is intended to use `execute_mock_swap`, since its object
address needs to go into both `allowed_targets` and `protocol_targets` at
cap-creation time.

`create_agent_cap` no longer takes a vault argument — it creates one
internally and shares both objects in the same transaction. Note both the
resulting `Vault` object ID and `AgentCap` object ID from the call's output;
the vault ID is needed for the subsequent `deposit` call.

The `create_agent_cap` and `execute_*` calls take a shared `Clock` object as
input — always `0x6` on any Sui network. `execute_stake` additionally takes
the shared `SuiSystemState` object — always `0x5`.

## Known limitations / open items

- Cetus swap path is not atomic and has no automatic reconciliation if the
  second transaction fails after funds reach the operator — see above.
- `execute_stake` has no test coverage yet.
- Period rollover is a simple reset-on-boundary counter, not a true rolling
  window. Acceptable for the current scope; a sliding window would need
  additional state if more precision is ever required.
- `allowed_targets`/`allowed_actions` are currently fixed at cap creation.
  Live-editable policy lists (add/remove a target or action type without
  disabling and recreating the whole cap) were discussed as a near-term
  improvement but not yet implemented.
