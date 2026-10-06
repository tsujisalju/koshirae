import {
  ErrorResponse,
  IntentsPage,
  IntentStatus,
  Vault,
  type AgentCap,
  type AgentCapPolicyInput,
  type BuildOptions,
  type CoinLimitsInput,
  type ErrorCode,
  type Intent,
  type IntentWithTransaction,
  type SubmitIntentRequest,
  type UnsignedTransaction,
  type VaultInput,
} from "@koshirae/core";
import { API_BASE_URL } from "./client";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    let code: ErrorCode | undefined;
    let message = body;
    try {
      const parsed = ErrorResponse.safeParse(JSON.parse(body));
      if (parsed.success) {
        code = parsed.data.error.code;
        message = parsed.data.error.message;
      }
    } catch {}
    throw new ApiError(
      res.status,
      code,
      `${init?.method ?? "GET"} ${path} -> ${res.status}: ${message}`,
    );
  }
  return res.json() as Promise<T>;
}

const withAfter = (path: string, afterDigest?: string) =>
  afterDigest ? `${path}?afterDigest=${encodeURIComponent(afterDigest)}` : path;

export const createAgentCapWithVault = (
  body: {
    owner: string;
    vault: VaultInput;
    agentCap: Omit<AgentCapPolicyInput, "vaultId">;
  },
  afterDigest?: string,
) =>
  apiFetch<{ unsignedTransaction: string }>(withAfter("/agent-caps", afterDigest), {
    method: "POST",
    body: JSON.stringify(body),
  });

export const createAgentCapForVault = (
  vaultId: string,
  body: Omit<AgentCapPolicyInput, "vaultId">,
  afterDigest?: string,
) =>
  apiFetch<{ unsignedTransaction: string }>(
    withAfter(`/vaults/${vaultId}/agent-caps`, afterDigest),
    { method: "POST", body: JSON.stringify(body) },
  );

export const mintOperatorCap = (agentCapId: string, operator: string, afterDigest?: string) =>
  apiFetch<{ unsignedTransaction: string }>(
    withAfter(`/agent-caps/${agentCapId}/operators`, afterDigest),
    { method: "POST", body: JSON.stringify({ operator }) },
  );

export const addAgentCapCoinLimits = (
  agentCapId: string,
  coinType: string,
  body: CoinLimitsInput,
  afterDigest?: string,
) =>
  apiFetch<{ unsignedTransaction: string }>(
    withAfter(`/agent-caps/${agentCapId}/coin-limits/${encodeURIComponent(coinType)}`, afterDigest),
    { method: "POST", body: JSON.stringify(body) },
  );

export const addVaultCoinLimits = (
  vaultId: string,
  coinType: string,
  body: CoinLimitsInput,
  afterDigest?: string,
) =>
  apiFetch<{ unsignedTransaction: string }>(
    withAfter(`/vaults/${vaultId}/coin-limits/${encodeURIComponent(coinType)}`, afterDigest),
    { method: "POST", body: JSON.stringify(body) },
  );

export const submitIntent = (
  agentCapId: string,
  request: SubmitIntentRequest,
  afterDigest?: string,
  buildOptions?: BuildOptions,
) =>
  apiFetch<IntentWithTransaction>(withAfter(`/agent-caps/${agentCapId}/intents`, afterDigest), {
    method: "POST",
    body: JSON.stringify({ ...request, buildOptions }),
  });

export const approveIntent = (intentId: string, buildOptions?: BuildOptions) =>
  apiFetch<UnsignedTransaction>(`/intents/${intentId}/approve`, {
    method: "POST",
    body: JSON.stringify({ buildOptions }),
  });

export const rejectIntent = (intentId: string, buildOptions?: BuildOptions) =>
  apiFetch<UnsignedTransaction>(`/intents/${intentId}/reject`, {
    method: "POST",
    body: JSON.stringify({ buildOptions }),
  });

// Returns the intent as it stands after the reported transaction settled.
export const reportSubmitted = (intentId: string, txDigest: string) =>
  apiFetch<Intent>(`/intents/${intentId}/submitted`, {
    method: "POST",
    body: JSON.stringify({ txDigest }),
  });

export const getIntent = (intentId: string, afterDigest?: string) =>
  apiFetch<Intent>(withAfter(`/intents/${intentId}`, afterDigest));

export const getAgentCap = (agentCapId: string, afterDigest?: string) =>
  apiFetch<AgentCap>(withAfter(`/agent-caps/${agentCapId}`, afterDigest));

export const getVault = (vaultId: string) => apiFetch<Vault>(`/vaults/${vaultId}`);

export const listIntents = (
  agentCapId: string,
  query: { status?: IntentStatus; limit?: number; cursor?: string } = {},
) => {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  const qs = params.toString();
  return apiFetch<IntentsPage>(`/agent-caps/${agentCapId}/intents${qs ? `?${qs}` : ""}`);
};
