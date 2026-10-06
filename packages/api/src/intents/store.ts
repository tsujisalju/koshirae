import { and, desc, eq, gt, isNull, lt, lte, or } from "drizzle-orm";
import {
  type AgentCap,
  Intent,
  IntentsPage,
  type IntentStatus,
  PredictedOutcome,
  SubmitIntentRequest,
} from "@koshirae/core";
import { db } from "../db/client";
import { type IntentRow, intents } from "../db/schema";
import { ApiError } from "../errors";

export type Db = typeof db;
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// `expired` is never stored. A flagged intent whose PendingAction expiry has
// passed reads as expired until something resolves it.
export function effectiveStatus(row: IntentRow, now: number = Date.now()): IntentStatus {
  // expiresAt was set from Sui's on-chain clock, but this compares it against
  // the API server's clock, so status can flip a moment early or late
  // relative to what the chain would actually accept for an approval.
  if (
    row.status === "pending_approval" &&
    row.expiresAt !== null &&
    row.expiresAt.getTime() <= now
  ) {
    return "expired";
  }
  return row.status as IntentStatus;
}

export function rowToIntent(row: IntentRow, now?: number): Intent {
  return Intent.parse({
    id: row.id,
    agentCapId: row.agentCapId,
    status: effectiveStatus(row, now),
    predictedOutcome: PredictedOutcome.parse(row.predictedOutcome),
    // jsonb is only typed at compile time; validate what actually came back.
    request: SubmitIntentRequest.parse(row.request),
    nonce: row.nonce,
    riskScore: row.riskScore ?? undefined,
    pendingActionId: row.pendingActionId ?? undefined,
    expiresAt: row.expiresAt?.getTime(),
    submitDigest: row.submitDigest ?? undefined,
    resolutionDigest: row.resolutionDigest ?? undefined,
    createdAt: row.createdAt.getTime(),
  });
}

export async function findIntentRow(id: string): Promise<IntentRow | undefined> {
  return db.query.intents.findFirst({ where: { id } });
}

export async function loadIntent(id: string): Promise<Intent> {
  const row = await findIntentRow(id);
  if (!row) throw new ApiError("not_found", `Intent ${id} not found`);
  return rowToIntent(row);
}

// The contract only requires nonce > last_nonce, so gaps are fine. Taking
// the max of the chain value and what's already been handed out lets an
// agent build several intents before signing any, without them colliding.
// Trade-off: intents that land out of order fail with stale_nonce.
export async function allocateNonce(agentCap: AgentCap): Promise<number> {
  const [latest] = await db
    .select({ nonce: intents.nonce })
    .from(intents)
    .where(eq(intents.agentCapId, agentCap.id))
    .orderBy(desc(intents.nonce))
    .limit(1);
  return Math.max(agentCap.lastNonce, latest?.nonce ?? 0) + 1;
}

// Drizzle wraps driver errors in DrizzleQueryError with the postgres.js
// error as `cause`. Unique violations are SQLSTATE 23505.
export function uniqueViolation(err: unknown): string | null {
  const cause = (err as { cause?: { code?: unknown; constraint_name?: unknown } })?.cause;
  if (cause?.code !== "23505") return null;
  return typeof cause.constraint_name === "string" ? cause.constraint_name : "unknown";
}

export async function listIntents(
  agentCapId: string,
  opts: { status?: IntentStatus; limit: number; beforeNonce?: number },
): Promise<IntentsPage> {
  const now = new Date();
  const conditions = [eq(intents.agentCapId, agentCapId)];
  if (opts.beforeNonce !== undefined) conditions.push(lt(intents.nonce, opts.beforeNonce));

  if (opts.status === "expired") {
    conditions.push(eq(intents.status, "pending_approval"), lte(intents.expiresAt, now));
  } else if (opts.status === "pending_approval") {
    conditions.push(
      eq(intents.status, "pending_approval"),
      or(isNull(intents.expiresAt), gt(intents.expiresAt, now))!,
    );
  } else if (opts.status) {
    conditions.push(eq(intents.status, opts.status));
  }

  const rows = await db
    .select()
    .from(intents)
    .where(and(...conditions))
    .orderBy(desc(intents.nonce))
    .limit(opts.limit + 1);

  const page = rows.slice(0, opts.limit);

  return {
    items: page.map((row) => rowToIntent(row, now.getTime())),
    nextCursor: rows.length > opts.limit ? String(page[page.length - 1].nonce) : null,
  };
}
