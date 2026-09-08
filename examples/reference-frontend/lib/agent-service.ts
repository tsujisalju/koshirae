const AGENT_SERVICE_URL = process.env.NEXT_PUBLIC_AGENT_SERVICE_URL!;

export interface AgentSummary {
  cap_id: string;
  vault_id: string;
  owner: string;
  operator: string;
  active: boolean;
  name: string | null;
}

export async function listAgents(owner: string): Promise<AgentSummary[]> {
  const response = await fetch(
    `${AGENT_SERVICE_URL}/agents?owner=${owner}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to list agents: ${await response.text()}`);
  }
  return response.json();
}

export async function saveAgentMetadata({
  capId,
  owner,
  name,
}: {
  capId: string;
  owner: string;
  name: string;
}) {
  const response = await fetch(`${AGENT_SERVICE_URL}/agents/metadata`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      cap_id: capId,
      owner,
      name,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to save agent metadata: ${await response.text()}`,
    );
  }

  return response.json();
}

export interface ParsedAgentPolicy {
  spending_limit_per_tx: number;
  spending_limit_period: number;
  period_length_ms: number;
  allowed_actions: number[];
  allowed_targets: string[];
  risk_threshold: number;
  expiry_ms: number;
}

export async function parsePolicy(text: string): Promise<ParsedAgentPolicy> {
  const response = await fetch(`${AGENT_SERVICE_URL}/agents/parse-policy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Failed to generate policy: ${await response.text()}`);
  }

  return response.json();
}

export interface AgentDetail {
  cap_id: string;
  vault_id: string;
  owner: string;
  operator: string;
  active: boolean;
  spending_limit_per_tx: number;
  spending_limit_period: number;
  period_spent: number;
  period_start_ms: number;
  period_length_ms: number;
  allowed_actions: number[];
  allowed_targets: string[];
  protocol_targets: string[];
  risk_threshold: number;
  expiry_ms: number;
  vault_balance: number;
  name: string | null;
}

export async function getAgent(capId: string): Promise<AgentDetail | null> {
  const response = await fetch(`${AGENT_SERVICE_URL}/agents/${capId}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to get agent: ${await response.text()}`);
  }
  return response.json();
}

export interface ActivityRecord {
  id: number;
  cap_id: string;
  action_type: number;
  decision: string;
  reasoning: string;
  target: string | null;
  amount_mist: string | null;
  risk_score: number | null;
  tx_digest: string | null;
  created_at: string;
}

export async function getActivity(owner: string): Promise<ActivityRecord[]> {
  const response = await fetch(
    `${AGENT_SERVICE_URL}/agents/activity?owner=${owner}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to load activity: ${await response.text()}`);
  }
  return response.json();
}
