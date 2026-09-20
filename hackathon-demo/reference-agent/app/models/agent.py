from pydantic import BaseModel


class AgentSummary(BaseModel):
    cap_id: str
    vault_id: str
    owner: str
    operator: str
    active: bool
    name: str | None = None


class AgentMetadataCreate(BaseModel):
    cap_id: str
    owner: str
    name: str


class ActivityRecord(BaseModel):
    id: int
    cap_id: str
    action_type: int
    decision: str
    reasoning: str
    target: str | None = None
    amount_mist: str | None = None
    risk_score: int | None = None
    tx_digest: str | None = None
    created_at: str


class AgentDetail(BaseModel):
    cap_id: str
    vault_id: str
    owner: str
    operator: str
    active: bool
    spending_limit_per_tx: int
    spending_limit_period: int
    period_spent: int
    period_start_ms: int
    period_length_ms: int
    allowed_actions: list[int]
    allowed_targets: list[str]
    protocol_targets: list[str]
    risk_threshold: int
    expiry_ms: int
    vault_balance: int
    name: str | None = None
