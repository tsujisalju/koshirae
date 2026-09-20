from pydantic import BaseModel


class AgentCandidate(BaseModel):
    cap_id: str
    vault_id: str
    owner: str
    operator: str
    risk_threshold: int
