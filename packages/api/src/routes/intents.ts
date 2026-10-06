import {
  type AgentCap,
  BuildOptions,
  type Intent,
  type IntentWithTransaction,
  ListIntentsQuery,
  normalizeCoinType,
  type PredictedOutcome,
  SubmitIntentRequest,
  SubmittedRequest,
  type UnsignedTransaction,
} from "@koshirae/core";
import { Transaction } from "@mysten/sui/transactions";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { KOSHIRAE_PACKAGE_ID, suiClient } from "../chain/client";
import { classifyEvents } from "../chain/events";
import { capabilityAbortCode } from "../chain/move-error";
import { fetchAgentCap, fetchOperatorCap, objectIdParam } from "../chain/reads";
import { waitForAfterDigest } from "../chain/wait";
import { db } from "../db/client";
import { intents } from "../db/schema";
import { ApiError } from "../errors";
import { resolveIntentCoinType } from "../intent-coin-type";
import { buildForIssue, type BuiltTransaction, recordIssued, toUnsigned } from "../intents/issue";
import { reconcileUnreportedSubmits, settleIssued } from "../intents/settle";
import {
  allocateNonce,
  findIntentRow,
  listIntents,
  loadIntent,
  rowToIntent,
  uniqueViolation,
} from "../intents/store";
import { buildApprovalTransaction } from "../ptb/build-approval";
import { buildIntentTransaction } from "../ptb/build-intent";
import { reportedRisk } from "../risk/evaluate";

export const intentsRouter = Router();

/* ---------- helpers ---------- */

function normalizeIntentRequest(request: SubmitIntentRequest): SubmitIntentRequest {
  switch (request.actionType) {
    case "stake":
      return request;
    case "cetusSwap":
      return { ...request, coinTypeIn: normalizeCoinType(request.coinTypeIn) };
    default: // transfer, mockSwap
      return { ...request, coinType: normalizeCoinType(request.coinType) };
  }
}

// buildOptions travels alongside the request in the body. SubmitIntentRequest
// strips unknown keys, so it never ends up stored with the intent.
function parseBuildOptions(body: unknown): BuildOptions {
  const raw = (body as { buildOptions?: unknown } | undefined)?.buildOptions;
  if (raw === undefined) return {};
  const parsed = BuildOptions.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("invalid_request", "Invalid buildOptions", z.treeifyError(parsed.error));
  }
  return parsed.data;
}

async function buildSubmitTransaction(params: {
  agentCap: AgentCap;
  request: SubmitIntentRequest;
  nonce: number;
  operatorAddress: string;
  buildOptions: BuildOptions;
}): Promise<BuiltTransaction> {
  const { agentCap, request, nonce, operatorAddress, buildOptions } = params;
  const tx = await buildIntentTransaction({
    agentCapId: agentCap.id,
    vaultId: agentCap.vaultId,
    request,
    reportedRisk: reportedRisk({ agentCap, request }),
    nonce,
  });
  tx.setSender(operatorAddress);
  return buildForIssue(tx, buildOptions);
}

// Whether the intent executes or gets flagged is decided on-chain; simulate
// the exact bytes we're about to hand out and read our own events. tx.build
// has already surfaced any Move abort by the time this runs.
async function predictOutcome(
  bytes: Uint8Array,
  agentCapId: string,
): Promise<{ predictedOutcome: PredictedOutcome; riskScore: number }> {
  const result = await suiClient.core.simulateTransaction({
    transaction: bytes,
    include: { events: true },
  });
  const tx = result.Transaction ?? result.FailedTransaction;
  if (!tx.status.success) throw new Error(tx.status.error?.message ?? "simulation failed");
  const outcome = classifyEvents(tx.events ?? [], agentCapId);
  if (outcome.kind === "executed")
    return { predictedOutcome: "execute", riskScore: outcome.riskScore };
  if (outcome.kind === "flagged") return { predictedOutcome: "flag", riskScore: outcome.riskScore };
  throw new Error("simulation emitted no ActionExecuted/ActionFlagged event for this cap");
}

function withTransaction(intent: Intent, unsigned: UnsignedTransaction): IntentWithTransaction {
  return { ...intent, ...unsigned };
}

const submitStatusCode = (predicted: PredictedOutcome) => (predicted === "flag" ? 202 : 200);

/* ---------- replay of an existing idempotency key ---------- */

async function replayIntent(
  existingId: string,
  operatorAddress: string,
  buildOptions: BuildOptions,
): Promise<{ code: number; body: Intent | IntentWithTransaction }> {
  const before = await loadIntent(existingId);
  if (before.status === "ready") await reconcileUnreportedSubmits(existingId);

  const intent = await loadIntent(existingId);
  if (intent.status !== "ready") return { code: 200, body: intent };

  // Still unsettled: rebuild against current object versions, but with the
  // nonce pinned at creation, so every build of this intent shares one nonce
  // and the chain lets at most one of them execute.
  const agentCap = await fetchAgentCap(intent.agentCapId);
  let built: BuiltTransaction;
  try {
    built = await buildSubmitTransaction({
      agentCap,
      request: intent.request,
      nonce: intent.nonce,
      operatorAddress,
      buildOptions,
    });
  } catch (err) {
    // The pinned nonce was consumed by a different intent; this one can
    // never land now. Mark it so it stops showing up as ready.
    if (capabilityAbortCode(err) === "stale_nonce") {
      await db.update(intents).set({ status: "failed" }).where(eq(intents.id, intent.id));
    }
    throw err;
  }
  await recordIssued(db, {
    digest: built.digest,
    intentId: intent.id,
    agentCapId: intent.agentCapId,
    kind: "submit",
  });
  return {
    code: submitStatusCode(intent.predictedOutcome),
    body: withTransaction(intent, toUnsigned(built)),
  };
}

/* ---------- routes ---------- */

intentsRouter.post("/agent-caps/:agentCapId/intents", async (req, res) => {
  const agentCapId = objectIdParam(req.params.agentCapId, "agentCapId");
  const parsed = SubmitIntentRequest.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError("invalid_request", "Invalid intent request", z.treeifyError(parsed.error));
  }
  const buildOptions = parseBuildOptions(req.body);
  await waitForAfterDigest(req.query.afterDigest);
  const request = normalizeIntentRequest(parsed.data);

  const [agentCap, operator] = await Promise.all([
    fetchAgentCap(agentCapId),
    fetchOperatorCap(request.operatorCapId),
  ]);

  const existing = await db.query.intents.findFirst({
    where: { agentCapId, idempotencyKey: request.idempotencyKey },
  });
  if (existing) {
    const { code, body } = await replayIntent(existing.id, operator.owner, buildOptions);
    return res.status(code).json(body);
  }

  // Pre-flight checks: same conditions execute_action enforces on-chain,
  // checked here first for a clear error instead of a dry-run abort.
  if (operator.cap.agentCapId !== agentCap.id)
    throw new ApiError(
      "operator_cap_wrong_agent_cap",
      "Operator cap does not belong to this agent cap",
    );
  if (operator.cap.generation !== agentCap.generation)
    throw new ApiError("operator_cap_revoked", "Operator cap generation is stale");
  if (!agentCap.active) throw new ApiError("agent_cap_inactive", "Agent cap is inactive");
  if (!agentCap.allowedActions.includes(request.actionType))
    throw new ApiError("action_not_allowed", "Action type not allowed");
  if (!agentCap.allowedTargets.includes(request.target))
    throw new ApiError("target_not_allowed", "Target not allowed");
  if (!agentCap.limits[resolveIntentCoinType(request)])
    throw new ApiError("coin_type_not_allowed", "Coin type not allowed");

  const nonce = await allocateNonce(agentCap);
  const built = await buildSubmitTransaction({
    agentCap,
    request,
    nonce,
    operatorAddress: operator.owner,
    buildOptions,
  });
  const { predictedOutcome, riskScore } = await predictOutcome(built.bytes, agentCap.id);

  const id = randomUUID();
  try {
    await db.transaction(async (trx) => {
      await trx.insert(intents).values({
        id,
        agentCapId,
        idempotencyKey: request.idempotencyKey,
        status: "ready",
        predictedOutcome,
        request,
        nonce,
        riskScore,
      });
      await recordIssued(trx, {
        digest: built.digest,
        intentId: id,
        agentCapId,
        kind: "submit",
      });
    });
  } catch (err) {
    const constraint = uniqueViolation(err);
    // A concurrent request with the same idempotency key won the insert:
    // answer as a replay of that one.
    if (constraint === "intents_agent_cap_idempotency_idx") {
      const winner = await db.query.intents.findFirst({
        where: { agentCapId, idempotencyKey: request.idempotencyKey },
      });
      if (winner) {
        const { code, body } = await replayIntent(winner.id, operator.owner, buildOptions);
        return res.status(code).json(body);
      }
    }
    // A concurrent intent for this cap took the same nonce. Retrying the
    // request allocates a fresh one.
    if (constraint === "intents_agent_cap_nonce_idx") {
      throw new ApiError(
        "stale_nonce",
        "Nonce was taken by a concurrent intent; retry the request",
      );
    }
    throw err;
  }

  const intent = await loadIntent(id);
  return res
    .status(submitStatusCode(predictedOutcome))
    .json(withTransaction(intent, toUnsigned(built)));
});

intentsRouter.get("/intents/:id", async (req, res) => {
  return res.status(200).json(await loadIntent(req.params.id));
});

intentsRouter.get("/agent-caps/:agentCapId/intents", async (req, res) => {
  const agentCapId = objectIdParam(req.params.agentCapId, "agentCapId");
  const parsed = ListIntentsQuery.safeParse(req.query);
  if (!parsed.success) {
    throw new ApiError("invalid_request", "Invalid query", z.treeifyError(parsed.error));
  }
  const { status, limit, cursor } = parsed.data;
  if (cursor !== undefined && !/^\d+$/.test(cursor)) {
    throw new ApiError("invalid_request", "Invalid cursor");
  }
  const beforeNonce = cursor === undefined ? undefined : Number(cursor);
  return res.status(200).json(await listIntents(agentCapId, { status, limit, beforeNonce }));
});

intentsRouter.post("/intents/:id/submitted", async (req, res) => {
  const parsed = SubmittedRequest.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError("invalid_request", "txDigest required", z.treeifyError(parsed.error));
  }
  const issued = await db.query.intentTransactions.findFirst({
    where: { digest: parsed.data.txDigest },
  });
  // Only digests the API built for this intent are accepted, so a reporter
  // can't move an intent with an unrelated transaction.
  if (!issued || issued.intentId !== req.params.id) {
    throw new ApiError("digest_not_issued", "This digest was not issued for this intent");
  }
  await settleIssued(issued);
  return res.status(200).json(await loadIntent(req.params.id));
});

intentsRouter.post("/intents/:id/approve", async (req, res) => {
  const buildOptions = parseBuildOptions(req.body);
  const row = await findIntentRow(req.params.id);
  if (!row) throw new ApiError("not_found", `Intent ${req.params.id} not found`);
  const intent = rowToIntent(row);
  if (intent.status === "expired")
    throw new ApiError("pending_action_expired", "Pending action has expired");
  if (intent.status !== "pending_approval")
    throw new ApiError("intent_not_pending_approval", "Intent is not pending approval");

  const agentCap = await fetchAgentCap(intent.agentCapId);
  const tx = await buildApprovalTransaction({
    intent,
    agentCapId: intent.agentCapId,
    vaultId: agentCap.vaultId,
  });
  tx.setSender(agentCap.owner);
  const built = await buildForIssue(tx, buildOptions);
  await recordIssued(db, {
    digest: built.digest,
    intentId: intent.id,
    agentCapId: intent.agentCapId,
    kind: "approve",
  });
  return res.status(200).json(toUnsigned(built));
});

intentsRouter.post("/intents/:id/reject", async (req, res) => {
  const buildOptions = parseBuildOptions(req.body);
  const row = await findIntentRow(req.params.id);
  if (!row) throw new ApiError("not_found", `Intent ${req.params.id} not found`);
  const intent = rowToIntent(row);
  // reject_pending doesn't check expiry, so rejecting an expired action is
  // allowed and is how an owner cleans one up.
  if (intent.status !== "pending_approval" && intent.status !== "expired")
    throw new ApiError("intent_not_pending_approval", "Intent is not pending approval");
  if (!intent.pendingActionId)
    throw new Error(`Intent ${intent.id} is flagged without a PendingAction id`);

  const agentCap = await fetchAgentCap(intent.agentCapId);
  const tx = new Transaction();
  tx.setSender(agentCap.owner);
  tx.moveCall({
    target: `${KOSHIRAE_PACKAGE_ID}::capability::reject_pending`,
    typeArguments: [resolveIntentCoinType(intent.request)],
    arguments: [tx.object(intent.pendingActionId), tx.object(intent.agentCapId)],
  });
  const built = await buildForIssue(tx, buildOptions);
  await recordIssued(db, {
    digest: built.digest,
    intentId: intent.id,
    agentCapId: intent.agentCapId,
    kind: "reject",
  });
  return res.status(200).json(toUnsigned(built));
});
