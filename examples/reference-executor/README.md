# Oronyx — Executor

TypeScript service responsible for constructing and submitting Sui
transactions on behalf of an agent. This is the only part of Oronyx that
signs and submits on-chain transactions — `agent-service` (Python) decides
_what_ an agent should do; this service decides _how_ to actually do it
on-chain and executes it.

## Role in the architecture

`agent-service` outputs a decision — which action type, and whatever data
that action type needs. This service takes that decision and constructs +
submits whatever Sui transaction(s) it requires, signed with the **operator
keypair**: a real Sui keypair this service controls, distinct from any
user's wallet. The contract checks this signer against each `AgentCap`'s
`operator` field.

Most action types are atomic: one Move call, one transaction, funds go
straight to their real destination. Only the Cetus swap path is two
transactions, because Cetus's own SDK forces it (see below).

## Decision shape

`AgentActionDecision` is a discriminated union, not one generic shape —
different action types need genuinely different data (a validator address
for staking, a pool object for swaps), and TypeScript's exhaustiveness
checking means adding a new variant without handling it in `executeAgentAction`'s
`switch` is a compile error, not a silent bug:

```ts
type AgentActionDecision =
  | { type: "transfer"; capId; vaultId; recipient; amountMist; riskScore }
  | { type: "stake"; capId; vaultId; validator; amountMist; riskScore }
  | { type: "mock_swap"; capId; vaultId; mockPoolId; amountMist; riskScore }
  | {
      type: "cetus_swap";
      capId;
      vaultId;
      poolId;
      decimalsA;
      decimalsB;
      amountMist;
      riskScore;
      slippagePercent;
    };
```

`agent-service`'s output should be shaped to match this directly — a `type`
discriminator plus whatever fields that action actually needs, not a flat
object with unused fields for the action types it doesn't apply to.

`CLOCK_ID` (`0x6`) and `SUI_SYSTEM_STATE_ID` (`0x5`) are Sui's well-known
shared system objects, hardcoded as constants rather than passed through
`decision` — they're the same on every network, no reason for the caller to
supply them.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values below
npm run dev            # runs src/executeAgentAction.ts via tsx
```

Required environment variables:

| Variable                       | Description                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `ORONYX_PACKAGE_ID`            | Published package ID from `sui move publish` (see `/move/README.md`)                 |
| `ORONYX_OPERATOR_KEY`          | Operator's private key, `suiprivkey1...` format                                       |
| `ORONYX_ENOKI_PRIVATE_API_KEY` | Enoki private API key, required by `/sponsor` and `/execute-sponsored` (see `src/enoki.ts`) |
| `ORONYX_FULLNODE_URL`          | Optional override; defaults to Sui testnet fullnode                                   |

## Why Cetus alone is two transactions

The original design assumed a released `Coin<SUI>` could be chained
directly into a Cetus swap `moveCall` within a single Programmable
Transaction Block. Checking Cetus's actual installed SDK type definitions
(`@cetusprotocol/sui-clmm-sdk`) showed this isn't supported:
`createSwapPayload` always constructs its own `Transaction` internally, with
no parameter accepting an existing transaction or a specific input coin —
Cetus selects input coins itself from whatever the signer address owns
on-chain at build time.

Given that, `runCetusPolicyCheck` releases funds to the operator's own
address, and `runCetusSwap` runs an ordinary swap against whatever the
operator now holds — two sequential transactions, not one atomic PTB.

**This is not atomic.** If `runCetusSwap` fails after `runCetusPolicyCheck`
succeeds, funds sit in the operator's wallet rather than being returned to
the vault. There is currently no automatic reconciliation for this case.
Before proceeding past the first transaction, check its effects/events for
`ActionFlagged` vs `ActionExecuted` and stop if the action was flagged
rather than approved (currently a `TODO` in the code, not yet implemented).

All other action types (`execute_transfer`, `execute_stake`,
`execute_mock_swap`) don't have this problem — they're single Move calls
that complete atomically on-chain, with no equivalent orchestration needed
in this service beyond building and submitting one transaction.

## Why Cetus is disabled for demos (but not removed)

Cetus's testnet pools were systematically checked via `testCetusSwap.ts`:
pool discovery filtered for real, SUI-paired pools with nonzero liquidity,
swap direction was corrected to match which side of the pool SUI actually
sits on, and coin decimals were verified against actual pool metadata.
Despite all of that, every available pool rejected the swap with Cetus's
own abort code 18 (zero-output swap) — the price ratios were too skewed for
reasonable test amounts to produce a usable, nonzero output.

Given that, `oronyx::mock_dex` (a fixed-rate swap pool this project fully
controls) is the primary swap path for demos. The Cetus integration remains
fully implemented and reachable via the `cetus_swap` decision type — it's a
deliberate demo-reliability choice, not an abandoned feature, and is worth
stating plainly rather than glossing over if asked about it.

## Files

- `executeAgentAction.ts` — the real entry point. Dispatches on
  `decision.type`: `runTransfer`, `runStake`, and `runMockSwap` are each a
  single atomic transaction; `cetus_swap` runs `runCetusPolicyCheck` then
  `runCetusSwap` as the two-step exception.
- `testPolicyCheck.ts` — isolated smoke test for a policy-check transaction
  alone, with no Cetus dependency. Useful for verifying the contract-side
  logic works on live testnet independent of DeFi integration issues.
- `testCetusSwap.ts` — isolated smoke test for the Cetus SDK alone, with no
  dependency on `capability.move`. Discovers a real testnet pool via
  `getPoolsWithPage()` rather than a hardcoded address, filters for a
  SUI-paired pool with real liquidity, and determines swap direction from
  which side of the pool SUI actually sits on (an earlier version
  hardcoded the direction, which silently tried to spend a coin we didn't
  hold).

## Current status and open items

- `runTransfer`, `runStake`, `runMockSwap`: implemented, not yet covered by
  executor-level tests (Move-level tests for the corresponding contract
  functions exist in `/move/tests/capability_tests.move`, except staking —
  see `/move/README.md`).
- `runCetusPolicyCheck`/`runCetusSwap`: confirmed working end-to-end against
  live testnet for the policy-check half; the swap half is blocked on
  testnet liquidity as described above, not on integration correctness.
- `agent-service` integration is not yet wired — `AgentActionDecision` is
  the contract boundary between the two services; `agent-service`'s output
  shape should be updated to match the discriminated union above.
- No reconciliation path yet for a `runCetusSwap` failure after
  `runCetusPolicyCheck` succeeds.
