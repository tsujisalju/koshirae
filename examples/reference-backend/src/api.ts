import type {
    AgentCapPolicyInput,
    VaultInput,
    CoinLimitsInput,
    SubmitIntentRequest,
    Intent,
    AgentCap,
} from "@koshirae/core";
import { API_BASE_URL } from "./client";

export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly errorCode: string | undefined,
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
        let errorCode: string | undefined;
        try {
            const parsed = JSON.parse(body);
            if (typeof parsed?.error === "string") errorCode = parsed.error;
        } catch {}
        throw new ApiError(
            res.status,
            errorCode,
            `${init?.method ?? "GET"} ${path} -> ${res.status}: ${body}`,
        );
    }
    return res.json() as Promise<T>;
}

const withAfter = (path: string, afterDigest?: string) =>
    afterDigest
        ? `${path}?afterDigest=${encodeURIComponent(afterDigest)}`
        : path;

export const createAgentCapWithVault = (
    body: {
        owner: string;
        vault: VaultInput;
        agentCap: Omit<AgentCapPolicyInput, "vaultId">;
    },
    afterDigest?: string,
) =>
    apiFetch<{ unsignedTransaction: string }>(
        withAfter("/agent-caps", afterDigest),
        { method: "POST", body: JSON.stringify(body) },
    );

export const createAgentCapForVault = (
    vaultId: string,
    body: Omit<AgentCapPolicyInput, "vaultId">,
    afterDigest?: string,
) =>
    apiFetch<{ unsignedTransaction: string }>(
        withAfter(`/vaults/${vaultId}/agent-caps`, afterDigest),
        { method: "POST", body: JSON.stringify(body) },
    );

export const mintOperatorCap = (
    agentCapId: string,
    operator: string,
    afterDigest?: string,
) =>
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
        withAfter(
            `/agent-caps/${agentCapId}/coin-limits/${encodeURIComponent(coinType)}`,
            afterDigest,
        ),
        { method: "POST", body: JSON.stringify(body) },
    );

export const addVaultCoinLimits = (
    vaultId: string,
    coinType: string,
    body: CoinLimitsInput,
    afterDigest?: string,
) =>
    apiFetch<{ unsignedTransaction: string }>(
        withAfter(
            `/vaults/${vaultId}/coin-limits/${encodeURIComponent(coinType)}`,
            afterDigest,
        ),
        { method: "POST", body: JSON.stringify(body) },
    );

export const submitIntent = (
    agentCapId: string,
    request: SubmitIntentRequest,
    afterDigest?: string,
) =>
    apiFetch<Intent & { unsignedTransaction: string }>(
        withAfter(`/agent-caps/${agentCapId}/intents`, afterDigest),
        { method: "POST", body: JSON.stringify(request) },
    );

export const approveIntent = (intentId: string, afterDigest?: string) =>
    apiFetch<{ unsignedTransaction: string }>(
        withAfter(`/intents/${intentId}/approve`, afterDigest),
        { method: "POST" },
    );

export const rejectIntent = (intentId: string, afterDigest?: string) =>
    apiFetch<{ unsignedTransaction: string }>(
        withAfter(`/intents/${intentId}/reject`, afterDigest),
        { method: "POST" },
    );

export const reportSubmitted = (
    intentId: string,
    txDigest: string,
    afterDigest?: string,
) =>
    apiFetch<{ status: string }>(
        withAfter(`/intents/${intentId}/submitted`, afterDigest),
        { method: "POST", body: JSON.stringify({ txDigest }) },
    );

export const getIntent = (intentId: string, afterDigest?: string) =>
    apiFetch<Intent>(withAfter(`/intents/${intentId}`, afterDigest));

export const getAgentCap = (agentCapId: string, afterDigest?: string) =>
    apiFetch<AgentCap>(withAfter(`/agent-caps/${agentCapId}`, afterDigest));
