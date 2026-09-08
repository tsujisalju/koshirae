import os
import sqlite3

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
        CREATE TABLE IF NOT EXISTS agent_metadata (
            cap_id TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            name TEXT NOT NULL
        )
        """
    )

    connection.commit()

    return connection


def save_agent_metadata(
    cap_id: str,
    owner: str,
    name: str,
):
    print("SAVING METADATA:", cap_id, owner, name)

    connection = _connect()

    try:
        _ = connection.execute(
            """
            INSERT INTO agent_metadata (cap_id, owner, name)
            VALUES (?, ?, ?)
            ON CONFLICT(cap_id)
            DO UPDATE SET
                owner = excluded.owner,
                name = excluded.name
            """,
            (cap_id, owner, name),
        )

        connection.commit()
    finally:
        connection.close()


def get_agent_name(cap_id: str) -> str | None:
    print("LOOKING UP NAME FOR:", cap_id)

    connection = _connect()

    try:
        row = connection.execute(
            """
            SELECT name
            FROM agent_metadata
            WHERE cap_id = ?
            """,
            (cap_id,),
        ).fetchone()

        print("FOUND:", row["name"] if row else None)

        return row["name"] if row else None
    finally:
        connection.close()
