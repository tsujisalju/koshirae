import { and, eq } from "drizzle-orm";
import type { IntentStatus } from "@koshirae/core";
import { suiClient } from "../chain/client";
import { classifyEvents, type Outcome } from "../chain/events";
import { fetchPendingActionExpiry, isTimeoutError, transactionExistsOnChain } from "../chain/reads";
import { db } from "../db/client";
import { type IntentTransactionRow, intents, intentTransactions } from "../db/schema";
import { ApiError } from "../errors";

// How long /submitted waits for a reported digest to become visible.
const SETTLE_TIMEOUT_MS = 15_000;

type Transition = {
  from: IntentStatus;
  set: Partial<typeof intents.$inferInsert>;
} | null;

async function transitionFor(
  issued: IntentTransactionRow,
  succeeded: boolean,
  outcome: Outcome,
): Promise<Transition> {
  if (issued.kind === "submit") {
    if (!succeeded) {
      return { from: "ready", set: { status: "failed", submitDigest: issued.digest } };
    }
    if (outcome.kind === "executed") {
      return {
        from: "ready",
        set: { status: "executed", riskScore: outcome.riskScore, submitDigest: issued.digest },
      };
    }
    if (outcome.kind === "flagged") {
      return {
        from: "ready",
        set: {
          status: "pending_approval",
          riskScore: outcome.riskScore,
          submitDigest: issued.digest,
          pendingActionId: outcome.pendingActionId,
          expiresAt: await fetchPendingActionExpiry(outcome.pendingActionId),
        },
      };
    }
    // A submit the API built succeeded without an action event for this cap.
    // That can only be a bug on our side, so fail loudly.
    throw new Error(`Issued submit ${issued.digest} succeeded without an action event`);
  }

  // approve / reject. A failed attempt leaves the intent in pending_approval
  // (or derived expired) so the owner can try again.
  const expected = issued.kind === "approve" ? "approved" : "rejected";
  if (!succeeded) return null;
  if (outcome.kind !== expected) {
    throw new Error(`Issued ${issued.kind} ${issued.digest} succeeded without ${expected} event`);
  }
  return {
    from: "pending_approval",
    set: {
      status: issued.kind === "approve" ? "executed" : "denied",
      resolutionDigest: issued.digest,
    },
  };
}

// Reads an issued transaction's outcome from the chain and applies it.
// Safe to call more than once for the same digest: the intent update is
// conditional on the status it transitions from.
export async function settleIssued(issued: IntentTransactionRow): Promise<void> {
  let result;
  try {
    result = await suiClient.core.waitForTransaction({
      digest: issued.digest,
      include: { effects: true, events: true },
      timeout: SETTLE_TIMEOUT_MS,
    });
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new ApiError(
        "transaction_not_found",
        `Transaction ${issued.digest} is not visible on-chain yet`,
      );
    }
    throw err;
  }

  const tx = result.Transaction ?? result.FailedTransaction;
  const succeeded = tx.status.success;
  const outcome: Outcome = succeeded
    ? classifyEvents(tx.events ?? [], issued.agentCapId)
    : { kind: "none" };
  const transition = await transitionFor(issued, succeeded, outcome);

  await db.transaction(async (trx) => {
    await trx
      .update(intentTransactions)
      .set({ status: succeeded ? "succeeded" : "failed" })
      .where(eq(intentTransactions.digest, issued.digest));
    if (transition) {
      await trx
        .update(intents)
        .set(transition.set)
        .where(and(eq(intents.id, issued.intentId), eq(intents.status, transition.from)));
    }
  });
}

// For idempotent replays of a still-ready intent: a submit may have executed
// without its report ever arriving. Settle any issued submit that is
// already on-chain before deciding whether to rebuild.
export async function reconcileUnreportedSubmits(intentId: string): Promise<void> {
  const pending = await db.query.intentTransactions.findMany({
    where: { intentId, kind: "submit", status: "issued" },
  });
  for (const issued of pending) {
    if (await transactionExistsOnChain(issued.digest)) {
      await settleIssued(issued);
    }
  }
}
