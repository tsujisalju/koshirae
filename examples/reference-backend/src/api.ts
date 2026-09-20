import type {
  AgentCapPolicyInput,
  VaultInput,
  CoinLimitsInput,
  SubmitIntentRequest,
  Intent,
  AgentCap,
} from "@koshirae/core";
import { API_BASE_URL } from "./client";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok)
    throw new Error(
      `${init?.method ?? "GET"} ${path} -> ${res.status}: ${await res.text()}`,
    );
  return res.json() as Promise<T>;
}

export const createAgentCapWithVault = (body: {
  owner: string;
  vault: VaultInput;
  agentCap: Omit<AgentCapPolicyInput, "vaultId">;
}) =>
  apiFetch<{ unsignedTransaction: string }>("/agent-caps", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const mintOperatorCap = (agentCapId: string, operator: string) =>
  apiFetch<{ unsignedTransaction: string }>(
    `/agent-caps/${agentCapId}/operators`,
    { method: "POST", body: JSON.stringify({ operator }) },
  );

export const addAgentCapCoinLimits = (
  agentCapId: string,
  coinType: string,
  body: CoinLimitsInput,
) =>
  apiFetch<{ unsignedTransaction: string }>(
    `/agent-caps/${agentCapId}/coin-limits/${encodeURIComponent(coinType)}`,
    { method: "POST", body: JSON.stringify(body) },
  );

export const addVaultCoinLimits = (
  vaultId: string,
  coinType: string,
  body: CoinLimitsInput,
) =>
  apiFetch<{ unsignedTransaction: string }>(
    `/vaults/${vaultId}/coin-limits/${encodeURIComponent(coinType)}`,
    { method: "POST", body: JSON.stringify(body) },
  );

export const submitIntent = (
  agentCapId: string,
  request: SubmitIntentRequest,
) =>
  apiFetch<Intent & { unsignedTransaction: string }>(
    `/agent-caps/${agentCapId}/intents`,
    { method: "POST", body: JSON.stringify(request) },
  );

export const approveIntent = (intentId: string) =>
  apiFetch<{ unsignedTransaction: string }>(`/intents/${intentId}/approve`, {
    method: "POST",
  });
export const approveReject = (intentId: string) =>
  apiFetch<{ unsignedTransaction: string }>(`/intents/${intentId}/reject`, {
    method: "POST",
  });
export const reportSubmitted = (intentId: string, txDigest: string) =>
  apiFetch<{ status: string }>(`/intents/${intentId}/submitted`, {
    method: "POST",
    body: JSON.stringify({ txDigest }),
  });
export const getIntent = (intentId: string) =>
  apiFetch<Intent>(`/intents/${intentId}`);
export const getAgentCap = (agentCapId: string) =>
  apiFetch<AgentCap>(`/agent-caps/${agentCapId}`);
