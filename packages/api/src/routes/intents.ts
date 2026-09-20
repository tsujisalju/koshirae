import { Intent, SubmitIntentRequest } from "@koshirae/core";
import { randomUUID } from "crypto";
import { Router } from "express";
import { db } from "../db/client";
import {
  fetchAgentCap,
  fetchOperatorCap,
  fetchOperatorCapOwner,
  findCreatedObjectId,
} from "../chain/reads";
import { mechanicalRiskEvaluator } from "../risk/evaluate";
import { buildIntentTransaction } from "../ptb/build-intent";
import { KOSHIRAE_PACKAGE_ID, suiClient } from "../chain/client";
import { intents } from "../db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { buildApprovalTransaction } from "../ptb/build-approval";
import { resolveIntentCoinType } from "../intent-coin-type";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";

export const intentsRouter = Router();

function nextStatus(currentStatus: string, succeeded: boolean): string {
  if (!succeeded) {
    return currentStatus === "approved" || currentStatus === "denied"
      ? "pending_approval"
      : "failed";
  }
  if (currentStatus === "ready" || currentStatus === "approved")
    return "executed";
  return currentStatus;
}

function rowToIntent(row: typeof intents.$inferSelect): Intent {
  return {
    id: row.id,
    agentCapId: row.agentCapId,
    status: row.status as Intent["status"],
    request: SubmitIntentRequest.parse(row.request),
    riskScore: row.riskScore ?? undefined,
    txDigest: row.txDigest ?? undefined,
    createdAt: row.createdAt.getTime(),
  };
}

intentsRouter.post("/agent-caps/:agentCapId/intents", async (req, res) => {
  const { agentCapId } = req.params;
  const parsed = SubmitIntentRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_request",
      details: z.treeifyError(parsed.error),
    });
  }
  const request = parsed.data;

  const existing = await db.query.intents.findFirst({
    where: {
      agentCapId,
      idempotencyKey: request.idempotencyKey,
    },
  });
  if (existing) return res.status(200).json(rowToIntent(existing));

  const [agentCap, operatorCap] = await Promise.all([
    fetchAgentCap(agentCapId),
    fetchOperatorCap(request.operatorCapId),
  ]);
  if (operatorCap.agentCapId !== agentCapId)
    return res.status(403).json({ error: "wrong_agent_cap" });
  if (operatorCap.generation !== agentCap.generation)
    return res.status(403).json({ error: "stale_operator_cap" });
  if (!agentCap.active)
    return res.status(403).json({ error: "inactive_agent_cap" });
  if (!agentCap.allowedActions.includes(request.actionType))
    return res.status(403).json({ error: "action_not_allowed" });
  if (!agentCap.allowedTargets.includes(request.target))
    return res.status(403).json({ error: "target_not_allowed" });

  const coinType = resolveIntentCoinType(request);
  if (!agentCap.limits[coinType])
    return res.status(403).json({ error: "coin_type_not_allowed" });

  const riskScore = mechanicalRiskEvaluator({ agentCap, request });
  const nonce = agentCap.lastNonce + 1;
  const status =
    riskScore > agentCap.riskThreshold ? "pending_approval" : "ready";

  const tx = await buildIntentTransaction({
    agentCapId,
    vaultId: agentCap.vaultId,
    request,
    riskScore,
    nonce,
  });
  tx.setSender(await fetchOperatorCapOwner(request.operatorCapId));
  const txBytes = await tx.build({ client: suiClient });

  const id = randomUUID();
  await db.insert(intents).values({
    id,
    agentCapId,
    idempotencyKey: request.idempotencyKey,
    status,
    request,
    riskScore,
    createdAt: new Date(),
  });

  const record: Intent = {
    id,
    agentCapId,
    status,
    request,
    riskScore,
    createdAt: Date.now(),
  };
  return res.status(status === "ready" ? 200 : 202).json({
    ...record,
    unsignedTransaction: Buffer.from(txBytes).toString("base64"),
  });
});

intentsRouter.get("/intents/:id", async (req, res) => {
  const row = await db.query.intents.findFirst({
    where: { id: req.params.id },
  });
  if (!row) return res.status(404).json({ error: "intent_not_found" });
  return res.status(200).json(rowToIntent(row));
});

intentsRouter.post("/intents/:id/submitted", async (req, res) => {
  const { txDigest } = req.body ?? {};
  if (typeof txDigest !== "string")
    return res.status(400).json({ error: "txDigest required" });

  const row = await db.query.intents.findFirst({
    where: {
      id: req.params.id,
    },
  });
  if (!row) return res.status(404).json({ error: "intent_not_found" });

  const result = await suiClient.getTransaction({ digest: txDigest });
  const transaction = result.Transaction ?? result.FailedTransaction;
  const succeeded = transaction.status.success;

  let pendingActionId: string | undefined;
  if (succeeded && row.status === "pending_approval") {
    const coinType = resolveIntentCoinType(row.request);
    pendingActionId = await findCreatedObjectId(
      txDigest,
      `${KOSHIRAE_PACKAGE_ID}::capability::PendingAction<${coinType}>`,
    );
  }

  const newStatus = nextStatus(row.status, succeeded);

  await db
    .update(intents)
    .set({
      status: newStatus,
      txDigest,
      ...(pendingActionId ? { pendingActionId } : {}),
    })
    .where(eq(intents.id, req.params.id));
  return res.json({ id: row.id, status: newStatus, txDigest, pendingActionId });
});

intentsRouter.post("/intents/:id/approve", async (req, res) => {
  const row = await db.query.intents.findFirst({
    where: {
      id: req.params.id,
    },
  });
  if (!row) return res.status(404).json({ error: "intent_not_found" });
  if (row.status !== "pending_approval")
    return res.status(409).json({ error: "intent_not_pending_approval" });
  if (!row.pendingActionId)
    return res.status(400).json({ error: "pending_action_id_not_found" });

  const intent = rowToIntent(row);
  const agentCap = await fetchAgentCap(intent.agentCapId);

  const tx = await buildApprovalTransaction({
    intent,
    agentCapId: intent.agentCapId,
    vaultId: agentCap.vaultId,
  });
  tx.setSender(agentCap.owner);
  const txBytes = await tx.build({ client: suiClient });
  await db
    .update(intents)
    .set({ status: "approved" })
    .where(eq(intents.id, req.params.id));
  return res
    .status(200)
    .json({ unsignedTransaction: Buffer.from(txBytes).toString("base64") });
});

intentsRouter.post("/intents/:id/reject", async (req, res) => {
  const row = await db.query.intents.findFirst({
    where: {
      id: req.params.id,
    },
  });
  if (!row) return res.status(404).json({ error: "intent_not_found" });
  if (row.status !== "pending_approval")
    return res.status(409).json({ error: "intent_not_pending_approval" });
  if (!row.pendingActionId)
    return res.status(409).json({ error: "pending_action_not_yet_recorded" });

  const intent = rowToIntent(row);
  if (!intent.pendingActionId)
    throw new Error("Intent has no recorded PendingAction id");
  const coinType =
    intent.request.actionType === "stake"
      ? SUI_TYPE_ARG
      : intent.request.actionType === "cetusSwap"
        ? intent.request.coinTypeIn
        : intent.request.coinType;

  const agentCap = await fetchAgentCap(intent.agentCapId);
  const tx = new Transaction();
  tx.setSender(agentCap.owner);
  tx.moveCall({
    target: `${KOSHIRAE_PACKAGE_ID}::capability::reject_pending`,
    typeArguments: [coinType],
    arguments: [
      tx.object(intent.pendingActionId),
      tx.object(intent.agentCapId),
    ],
  });
  const txBytes = await tx.build({ client: suiClient });
  await db
    .update(intents)
    .set({ status: "denied" })
    .where(eq(intents.id, req.params.id));
  return res
    .status(200)
    .json({ unsignedTransaction: Buffer.from(txBytes).toString("base64") });
});
