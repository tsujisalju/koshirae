import { AgentDetail, AgentSummary } from "./agent-service";

export type Agent = {
  id: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  vaultBalance: string;
  // Raw MIST value backing `vaultBalance`'s formatted string — needed for
  // percentage-of-balance calculations (e.g. the withdraw slider).
  vaultBalanceMist?: number;
  riskThreshold: number;
  spendingLimit: string;

  allowedActions?: string[];
  periodLimit?: string;
  periodLength?: string;
  expiry?: string;

  // Addresses the agent may act against, and the subset of those a
  // currently-enabled action structurally depends on (e.g. a DeFi pool) —
  // protocolTargets is always a subset of allowedTargets and can't be
  // removed via remove_allowed_target.
  allowedTargets?: string[];
  protocolTargets?: string[];

  // Real on-chain object IDs from oronyx::capability::create_agent_cap.
  // `id` is set equal to `capId` once an agent is chain-backed, since
  // app/(require-wallet)/agents/[cap_id]/page.tsx already routes on
  // `cap_id`. Optional for the still-present mock seed agents.
  capId?: string;
  vaultId?: string;
  owner?: string;

  // True when `name` came from saved agent-service metadata rather than
  // being synthesized from capId — controls whether AgentCard shows the
  // capId subtitle.
  hasName?: boolean;
};

// GET /agents (agent-service) only returns identity/active-status today —
// no name/riskThreshold/spendingLimit/vaultBalance yet. These placeholders
// are interim until a dedicated agent-details endpoint fills them in;
// riskThreshold's -1 sentinel signals "not yet available" to AgentCard
// (a real threshold is always 0-100).
export function agentFromSummary(summary: AgentSummary): Agent {
  return {
    id: summary.cap_id,
    capId: summary.cap_id,
    vaultId: summary.vault_id,
    owner: summary.owner,
    name:
      summary.name ??
      `Agent ${summary.cap_id.slice(0, 6)}…${summary.cap_id.slice(-4)}`,
    hasName: summary.name != null,
    status: summary.active ? "ACTIVE" : "INACTIVE",
    vaultBalance: "—",
    riskThreshold: -1,
    spendingLimit: "—",
  };
}

export const MIST_PER_SUI = 1_000_000_000;

export function formatMist(mist: number): string {
  return `${(mist / MIST_PER_SUI).toFixed(2)} SUI`;
}

// The executor is hardcoded to testnet (see executor/src/executeAgentAction.ts),
// so the explorer link is too — no need to thread network config through the stack.
export function suiExplorerTxUrl(digest: string): string {
  return `https://testnet.suivision.xyz/txblock/${digest}`;
}

// e.g. "2 minutes ago" — for the audit-trail activity feed, where
// timestamps come from activity_log's ISO created_at strings.
export function formatRelativeTime(isoTimestamp: string): string {
  const deltaMs = Date.now() - new Date(isoTimestamp).getTime();
  const deltaSeconds = Math.round(deltaMs / 1000);

  if (deltaSeconds < 60) return "Just now";

  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return `${deltaMinutes} minute${deltaMinutes === 1 ? "" : "s"} ago`;
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours} hour${deltaHours === 1 ? "" : "s"} ago`;
  }

  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays} day${deltaDays === 1 ? "" : "s"} ago`;
}

// Mirrors oronyx::capability's action-type codes (see move/sources/capability.move
// and the ACTION_CODES map below, which only exposes SWAP/STAKE/TRANSFER in its
// UI — CETUS_SWAP is included here since a cap can still carry it).
export const ACTION_LABELS: Record<number, string> = {
  0: "TRANSFER",
  1: "SWAP",
  2: "STAKE",
  3: "CETUS_SWAP",
};

// Mirrors oronyx::capability's private action-type codes. "SWAP" maps to
// ACTION_MOCK_SWAP (not ACTION_CETUS_SWAP), consistent with this project's
// established default of the mock DEX over Cetus for demo reliability.
// Only used at cap creation — there is no on-chain way to change
// allowed_actions after create_agent_cap.
export const ACTION_CODES: Record<string, number> = {
  TRANSFER: 0,
  SWAP: 1,
  STAKE: 2,
};

export const PERIOD_OPTIONS = [
  "1 hour",
  "6 hours",
  "12 hours",
  "24 hours",
  "7 days",
  "30 days",
];

export const EXPIRY_OPTIONS = [
  "7 days",
  "14 days",
  "30 days",
  "60 days",
  "90 days",
];

export const DURATION_MS: Record<string, number> = {
  "1 hour": 3_600_000,
  "6 hours": 6 * 3_600_000,
  "12 hours": 12 * 3_600_000,
  "24 hours": 24 * 3_600_000,
  "7 days": 7 * 24 * 3_600_000,
  "14 days": 14 * 24 * 3_600_000,
  "30 days": 30 * 24 * 3_600_000,
  "60 days": 60 * 24 * 3_600_000,
  "90 days": 90 * 24 * 3_600_000,
};

// Generic duration formatter — period_length_ms can be any value, not just
// the fixed set of options agents/new/page.tsx's form offers, so this
// computes whole days/hours directly rather than reverse-looking-up that
// form's private DURATION_MS table.
export function formatDuration(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (Number.isInteger(hours)) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${Math.round(ms / 60_000)} minutes`;
}

// expiry_ms is an absolute epoch timestamp, not a duration — must be
// formatted as a date, not passed through formatDuration.
export function formatExpiry(expiryMs: number): string {
  return new Date(expiryMs).toLocaleString();
}

export type DurationUnit = "hours" | "days";

// Decomposes a ms duration into a value+unit pair for free-form period/expiry
// inputs — used to reflect LLM-generated durations that don't land on a
// fixed preset (e.g. "every 10 hours").
export function msToDurationInput(ms: number): {
  value: number;
  unit: DurationUnit;
} {
  const hours = ms / 3_600_000;
  if (hours >= 24 && hours % 24 === 0) {
    return { value: hours / 24, unit: "days" };
  }
  return { value: Math.round(hours * 100) / 100, unit: "hours" };
}

export function durationInputToMs(value: number, unit: DurationUnit): number {
  return unit === "days" ? value * 24 * 3_600_000 : value * 3_600_000;
}

export function agentFromDetail(detail: AgentDetail): Agent {
  return {
    id: detail.cap_id,
    capId: detail.cap_id,
    vaultId: detail.vault_id,
    owner: detail.owner,
    name:
      detail.name ??
      `Agent ${detail.cap_id.slice(0, 6)}…${detail.cap_id.slice(-4)}`,
    hasName: detail.name != null,
    status: detail.active ? "ACTIVE" : "INACTIVE",
    vaultBalance: formatMist(detail.vault_balance),
    vaultBalanceMist: detail.vault_balance,
    riskThreshold: detail.risk_threshold,
    spendingLimit: formatMist(detail.spending_limit_per_tx),
    allowedActions: detail.allowed_actions.map(
      (code) => ACTION_LABELS[code] ?? `ACTION_${code}`,
    ),
    periodLimit: formatMist(detail.spending_limit_period),
    periodLength: formatDuration(detail.period_length_ms),
    expiry: formatExpiry(detail.expiry_ms),
    allowedTargets: detail.allowed_targets,
    protocolTargets: detail.protocol_targets,
  };
}

export const mockAgents: Agent[] = [
  {
    id: "agent-1",
    name: "Yield Optimizer",
    status: "ACTIVE",
    vaultBalance: "2.45 SUI",
    riskThreshold: 60,
    spendingLimit: "0.50 SUI",

    allowedActions: ["SWAP", "STAKE"],
    periodLimit: "5.00 SUI",
    periodLength: "24 hours",
    expiry: "30 days",
  },
  {
    id: "agent-2",
    name: "Trading Assistant",
    status: "ACTIVE",
    vaultBalance: "1.20 SUI",
    riskThreshold: 75,
    spendingLimit: "0.30 SUI",

    allowedActions: ["SWAP", "TRANSFER"],
    periodLimit: "3.00 SUI",
    periodLength: "24 hours",
    expiry: "14 days",
  },
];

export function loadMockAgents(): Agent[] {
  const storedAgents: Agent[] = JSON.parse(
    localStorage.getItem("oronyx-agents") || "[]",
  );

  const storedIds = new Set(storedAgents.map((agent) => agent.id));
  const unchangedDefaults = mockAgents.filter(
    (agent) => !storedIds.has(agent.id),
  );

  return [...unchangedDefaults, ...storedAgents];
}

export function saveMockAgent(updatedAgent: Agent) {
  const storedAgents: Agent[] = JSON.parse(
    localStorage.getItem("oronyx-agents") || "[]",
  );

  const exists = storedAgents.some((agent) => agent.id === updatedAgent.id);
  const nextAgents = exists
    ? storedAgents.map((agent) =>
        agent.id === updatedAgent.id ? updatedAgent : agent,
      )
    : [...storedAgents, updatedAgent];

  localStorage.setItem("oronyx-agents", JSON.stringify(nextAgents));
}
