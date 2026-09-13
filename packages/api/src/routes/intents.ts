import { Intent, SubmitIntentRequest } from "@oronyx/core";
import { randomUUID } from "crypto";
import { Router } from "express";
import { db } from "../db/client";
import { fetchAgentCap, fetchOperatorCap } from "../chain/reads";
import { mechanicalRiskEvaluator } from "../risk/evaluate";
import { buildIntentTransaction } from "../ptb/build-intent";
import { suiClient } from "../chain/client";
import { intents } from "../db/schema";
import { eq } from "drizzle-orm";

export const intentsRouter = Router();
const SUI_TYPE_ARG = "0x2::sui::SUI";

function rowToIntent(row: typeof intents.$inferSelect): Intent {
  return {
    id: row.id,
    agentCapId: row.agentCapId,
    status: row.status as Intent["status"],
    request: row.request,
    riskScore: row.riskScore ?? undefined,
    txDigest: row.txDigest ?? undefined,
    createdAt: row.createdAt.getTime(),
  };
}

intentsRouter.post("/agent-caps/:agentCapId/intents", async (req, res) => {
  const { agentCapId } = req.params;
  const parsed = SubmitIntentRequest.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_request", details: parsed.error.flatten() });
  }
  const request = parsed.data;

  const existing = await db.query.intents.findFirst({
    where: {
      agentCapId,
      idempotencyKey: request.idempotencyKey,
    },
  });
  if (existing) return res.status(409).json(rowToIntent(existing));

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

  const coinType =
    request.actionType === "stake" ? SUI_TYPE_ARG : request.coinType;
  if (!agentCap.limits[coinType])
    return res.status(403).json({ error: "coin_type_not_allowed" });

  const riskScore = mechanicalRiskEvaluator({ agentCap, request });
  const nonce = agentCap.lastNonce + 1;
  const status =
    riskScore > agentCap.riskThreshold ? "pending_approval" : "ready";

  const tx = buildIntentTransaction({
    agentCapId,
    vaultId: agentCap.vaultId,
    request,
    riskScore,
    nonce,
  });
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

  const result = await suiClient.getTransaction({
    digest: txDigest,
    include: { effects: true },
  });
  const succeeded = result.Transaction?.status.success;
  const newStatus = succeeded
    ? row.status === "pending_approval"
      ? "pending_approval"
      : "executed"
    : "failed";

  await db
    .update(intents)
    .set({ status: newStatus, txDigest })
    .where(eq(intents.id, req.params.id));
  return res.json({ id: row.id, status: newStatus, txDigest });
});
