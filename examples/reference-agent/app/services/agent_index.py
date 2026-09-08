"""Local candidate index for agent decision triggers.

Answers "which active agents allow action X" from a local SQLite cache
instead of a chain read per agent per tick. Populated from CapCreated/
CapDeactivated events (agent discovery, ownership, active flag) plus a
live AgentCap read per known agent (allowed_actions, risk_threshold) —
the live read is required because capability.move's policy-update
functions (update_risk_threshold, add_allowed_target, etc.) emit no
events, so there is no event-only way to keep those fields fresh. This
means the index is only as fresh as its last sync cycle; policy edits
are not reflected instantly.
"""

import json
import os
import sqlite3
from datetime import datetime, timezone

from app.models.agent_index import AgentCandidate
from app.services import sui_events, sui_objects

DB_PATH = os.getenv(
    "AGENT_METADATA_DB",
    "/app/data/agent_metadata.db",
)


def _connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row

    _ = connection.execute(
        """
        CREATE TABLE IF NOT EXISTS agent_index (
            cap_id TEXT PRIMARY KEY,
            vault_id TEXT NOT NULL,
            owner TEXT NOT NULL,
            operator TEXT NOT NULL,
            allowed_actions TEXT NOT NULL,
            risk_threshold INTEGER NOT NULL,
            active INTEGER NOT NULL,
            last_decision_at TEXT,
            last_synced_at TEXT NOT NULL
        )
        """
    )

    connection.commit()

    return connection


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def sync_agent_index() -> None:
    """Full re-sync: discover agents from events, then live-read each
    AgentCap for the policy fields that have no event trail.
    """
    deactivated_ids = await sui_events.get_deactivated_cap_ids()

    connection = _connect()
    try:
        existing_ids = {
            row["cap_id"] for row in connection.execute("SELECT cap_id FROM agent_index")
        }

        all_created = await sui_events.get_all_created_caps()

        known_cap_ids = existing_ids | {cap.cap_id for cap in all_created}

        for cap in all_created:
            if cap.cap_id in existing_ids:
                continue
            _ = connection.execute(
                """
                INSERT INTO agent_index (
                    cap_id, vault_id, owner, operator,
                    allowed_actions, risk_threshold, active,
                    last_synced_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(cap_id) DO NOTHING
                """,
                (cap.cap_id, cap.vault_id, cap.owner, cap.operator, "[]", 0, 0, _now()),
            )

        connection.commit()

        for cap_id in known_cap_ids:
            detail = await sui_objects.get_agent_detail(cap_id)
            if detail is None:
                continue

            active = detail.active and cap_id not in deactivated_ids

            _ = connection.execute(
                """
                UPDATE agent_index
                SET vault_id = ?,
                    owner = ?,
                    operator = ?,
                    allowed_actions = ?,
                    risk_threshold = ?,
                    active = ?,
                    last_synced_at = ?
                WHERE cap_id = ?
                """,
                (
                    detail.vault_id,
                    detail.owner,
                    detail.operator,
                    json.dumps(detail.allowed_actions),
                    detail.risk_threshold,
                    1 if active else 0,
                    _now(),
                    cap_id,
                ),
            )

        connection.commit()
    finally:
        connection.close()


def get_candidate_agents(action_type: int) -> list[AgentCandidate]:
    connection = _connect()
    try:
        rows = connection.execute(
            """
            SELECT cap_id, vault_id, owner, operator, allowed_actions, risk_threshold
            FROM agent_index
            WHERE active = 1
            """
        ).fetchall()

        candidates: list[AgentCandidate] = []
        for row in rows:
            allowed_actions = json.loads(row["allowed_actions"])
            if action_type not in allowed_actions:
                continue

            candidates.append(
                AgentCandidate(
                    cap_id=row["cap_id"],
                    vault_id=row["vault_id"],
                    owner=row["owner"],
                    operator=row["operator"],
                    risk_threshold=row["risk_threshold"],
                )
            )

        return candidates
    finally:
        connection.close()


def mark_decision(cap_id: str) -> None:
    connection = _connect()
    try:
        _ = connection.execute(
            "UPDATE agent_index SET last_decision_at = ? WHERE cap_id = ?",
            (_now(), cap_id),
        )
        connection.commit()
    finally:
        connection.close()
