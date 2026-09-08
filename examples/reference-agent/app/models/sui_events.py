from pydantic import BaseModel


class CapCreatedPayload(BaseModel):
    cap_id: str
    vault_id: str
    owner: str
    operator: str


class CapDeactivatedPayload(BaseModel):
    cap_id: str
