# Koshirae
<img width="432" height="144" alt="koshirae-logomark-bg" src="https://github.com/user-attachments/assets/06187a0d-4f7c-46d1-ab5d-67ec7ad2f286" />

Scoped Agent Wallets on Sui — a Move-based trust layer for autonomous
financial agents, letting a user define exactly what an agent is allowed to
do with their funds, then enforcing that boundary on-chain.

Team Evernight — MUBA Blockchain Hackathon 2026

- Qayyum Yazid (tsujisalju)
- Muiz Yazid (cikti)
- Waiz Yazid (waizizzy)

## Problem Statement

AI agents are becoming capable enough to trade, stake, and move funds on a
user's behalf — but giving an agent that kind of access today means one of
two bad options: hand it a private key and hope it behaves, or keep it
locked out of funds entirely and lose the automation. There's no middle
ground where a user can say "you may spend up to X per transaction, only on
these actions, only with these counterparties" and have that boundary
actually hold — enforced by something other than the agent's own backend
code, which could be buggy, compromised, or simply wrong. Koshirae exists to
close that gap: policy enforcement that lives on-chain, not in a server the
user has to trust.

## What this is

An agent shouldn't need a blank check to be useful. Koshirae lets a user set
spending limits, allowed actions, allowed targets, and a risk threshold for
an AI agent acting on their behalf — encoded as an on-chain capability
object, not just a UI promise. Actions within policy execute automatically;
anything riskier is flagged and held for the user to approve or reject
themselves. The user can deactivate the agent at any time, independent of
whether the backend is trusted, online, or even compromised. A dashboard
surfaces a live audit trail of every action an agent has taken or attempted,
and agents can be created and configured from a plain natural-language
description of the intended policy rather than a raw parameter form.

## Blockchain Technology

**Sui / Move.** Policy enforcement happens inside a Move smart contract, not
application code — an agent's spending limits, allowed actions, and allowed
targets are checked with `assert!`s inside the same transaction that moves
funds, so there's no window where a backend could skip the check. See
`move/sources/capability.move`.

**Capability object pattern.** The `AgentCap` object encodes what an agent
is allowed to do — spending limits, an action allowlist, a target allowlist,
and a risk threshold — and every fund-moving call requires the caller to
present it, in the classic Move capability style. Koshirae makes one
deliberate departure from the textbook version: `AgentCap` is a **shared**
object with explicit `owner` and `operator` address fields, rather than an
object owned outright by the operator. That's because the operator (the
executor service's keypair) needs to act on the agent's behalf without the
user co-signing every transaction, while the user still needs to be able to
reach in and deactivate or reconfigure it at any time. Access is enforced by
comparing the transaction sender against `owner`/`operator` fields rather
than relying on Sui's native ownership-transfer model. See
`move/sources/capability.move` (`Vault`, `AgentCap`, `PendingAction`) and
`move/README.md` ("Why shared objects, not owned objects") for the full
rationale.

**zkLogin.** Wallet onboarding on the frontend goes through
[Enoki](https://portal.enoki.mystenlabs.com) (`@mysten/enoki`), which offers
zkLogin-backed sign-in (Google) as a connect option alongside standard Sui
wallets — so a user can get a Sui address without installing a wallet
extension first.

**Sponsored transactions.** Users never pay gas directly. Every user-signed
transaction — creating an agent, editing its policy, depositing or
withdrawing from the vault — is built as a sponsored transaction: the
executor asks Enoki's gas station to sponsor it (`POST /sponsor`), the
user's wallet signs only the transaction bytes without touching gas
payment, and the executor submits the fully-signed bundle
(`POST /execute-sponsored`). The private Enoki API key required for the gas
station never reaches the browser — it lives only in the executor service.
See `frontend/lib/sponsored-transaction.ts` and `executor/src/enoki.ts`.

**External DeFi platform integrations.** Koshirae implements a swap action on Cetus
DEX and reads pool price changes on Sui DeepBook, supplying them as market triggers
for agent decisions.

## Structure

| Directory        | What's in it                                                                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/move`          | The Sui Move contract — vaults, agent capabilities, policy enforcement, and the supported action types (transfer, stake, mock swap, Cetus swap). See `move/README.md`.                                     |
| `/executor`      | TypeScript service that builds and submits the actual Sui transactions an agent takes, signed by a dedicated operator keypair, and proxies sponsored-transaction calls to Enoki. See `executor/README.md`. |
| `/agent-service` | Python/FastAPI service responsible for the agent's decision-making — parsing user policy from natural language, deciding what action to take and how risky it is.                                          |
| `/frontend`      | Next.js dApp — agent creation, policy setup, and the audit/approval dashboard.                                                                                                                             |

## Smart Contracts (Testnet)

| Item               | Value                                                                |
| ------------------ | -------------------------------------------------------------------- |
| Package ID         | `0x5ee5b401f1a2568ca7904b28f44494308c6b956aafb36e4c2759e7ffe47d2115` |
| Upgrade Capability | `0x4219edeca77bbd2453c543fb365d4303fe65e14374d5559e92d702268f17a0f1` |
| Chain ID           | `4c78adac`                                                           |

These are the canonical deployment IDs from `move/Published.toml`. Per-deployment
runtime objects — a specific `Vault`, `AgentCap`, or `MockPool` instance — are
created after publishing (see `move/post-deploy.sh`) and aren't fixed addresses.

## Setup & Installation

The quickest path is `docker compose up --build` from the repo root, which
builds and runs all three services together: `frontend` (port 3000),
`agent-service` (port 8000), and `executor` (port 4000). Each service reads
its own `.env` file (`frontend/.env`, `agent-service/.env`,
`executor/.env`) — copy the corresponding `.env.example` in each directory
before starting.

To run components individually instead:

**Move contracts**

```bash
cd move
sui move build
sui move test

# Deploy to testnet
sui client switch --env testnet
sui client publish --gas-budget 200000000
# then follow move/post-deploy.sh to mint mock USDC, fund the mock pool,
# and create an AgentCap
```

See `move/README.md` for the full contract design and testnet deployment notes.

**Executor**

```bash
cd executor
npm install
cp .env.example .env   # fill in the values below
npm run dev             # runs src/executeAgentAction.ts via tsx
```

Required env vars: `KOSHIRAE_PACKAGE_ID`, `KOSHIRAE_OPERATOR_KEY`,
`KOSHIRAE_ENOKI_PRIVATE_API_KEY` (required for the `/sponsor` and
`/execute-sponsored` endpoints), and optionally `KOSHIRAE_FULLNODE_URL`. See
`executor/README.md`.

**Frontend**

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Required env vars (see `frontend/.env.example`): `NEXT_PUBLIC_ENOKI_API_KEY`,
`NEXT_PUBLIC_GOOGLE_CLIENT_ID` (zkLogin Google sign-in),
`NEXT_PUBLIC_KOSHIRAE_PACKAGE_ID`, `NEXT_PUBLIC_KOSHIRAE_OPERATOR_ADDR`,
`NEXT_PUBLIC_KOSHIRAE_MOCK_POOL_ID`, `NEXT_PUBLIC_EXECUTOR_URL`,
`NEXT_PUBLIC_AGENT_SERVICE_URL`.

**Agent service**

```bash
cd agent-service
pip install -r requirements.txt   # or requirements-windows.txt on Windows
cp .env.example .env
```

Then run it the same way `docker-compose.yml` does for the `agent-service`
container.
