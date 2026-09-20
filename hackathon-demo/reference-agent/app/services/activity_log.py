"""Audit trail for every decision the agent pipeline makes, act or skip.

This is the off-chain complement to on-chain ActionExecuted/ActionFlagged
events (not yet indexed) — reasoning has no on-chain equivalent, so this
table is the only place it's captured.
"""

import os
import sqlite3
from datetime import datetime, timezone

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
        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cap_id TEXT NOT NULL,
            action_type INTEGER NOT NULL,
            decision TEXT NOT NULL,
            reasoning TEXT NOT NULL,
            target TEXT,
            amount_mist TEXT,
            risk_score INTEGER,
            created_at TEXT NOT NULL
        )
        """
    )

    connection.commit()

    try:
        connection.execute("ALTER TABLE activity_log ADD COLUMN tx_digest TEXT")
        connection.commit()
    except sqlite3.OperationalError:
        pass  # column already exists

    return connection


def log_decision(
    cap_id: str,
    action_type: int,
    decision: str,
    reasoning: str,
    target: str | None = None,
    amount_mist: str | None = None,
    risk_score: int | None = None,
    tx_digest: str | None = None,
) -> None:
    connection = _connect()
    try:
        _ = connection.execute(
            """
            INSERT INTO activity_log (
                cap_id, action_type, decision, reasoning,
                target, amount_mist, risk_score, tx_digest, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                cap_id,
                action_type,
                decision,
                reasoning,
                target,
                amount_mist,
                risk_score,
                tx_digest,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        connection.commit()
    finally:
        connection.close()


def get_activity_for_caps(cap_ids: list[str], limit: int = 50) -> list[sqlite3.Row]:
    """Merged, time-ordered activity feed across every action_type for a
    set of caps — for the audit-trail UI, unlike get_recent_activity
    below which is deliberately scoped to one (cap_id, action_type) pair
    for LLM context.
    """
    if not cap_ids:
        return []

    connection = _connect()
    try:
        placeholders = ",".join("?" for _ in cap_ids)
        return connection.execute(
            f"""
            SELECT * FROM activity_log
            WHERE cap_id IN ({placeholders})
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (*cap_ids, limit),
        ).fetchall()
    finally:
        connection.close()


def get_recent_activity(cap_id: str, action_type: int, limit: int = 10) -> list[sqlite3.Row]:
    """Recent decisions for this cap, scoped to a single action_type —
    a candidate can allow multiple actions (e.g. MOCK_SWAP and STAKE), and
    mixing their histories in one LLM context causes cross-contamination
    (confirmed live: a stake-specific constraint leaking into swap
    reasoning).

    Excludes "no_action" rows — this feeds the LLM's own decision context
    (unlike get_activity_for_caps, which is for the audit-trail UI and
    needs everything), and skip reasoning tends to self-reinforce across
    cycles rather than inform them (confirmed live: repeated "no_action"
    rows citing prior "no_action" rows, escalating into stale, circular
    justifications). "act_failed" is kept — a real on-chain failure is
    useful signal against blindly retrying an identical proposal, unlike
    a plain skip.
    """
    connection = _connect()
    try:
        return connection.execute(
            """
            SELECT * FROM activity_log
            WHERE cap_id = ? AND action_type = ? AND decision != 'no_action'
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (cap_id, action_type, limit),
        ).fetchall()
    finally:
        connection.close()
