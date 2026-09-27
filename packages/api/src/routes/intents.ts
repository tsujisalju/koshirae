import {
    AgentCap,
    Intent,
    normalizeCoinType,
    SubmitIntentRequest,
} from "@koshirae/core";
import { randomUUID } from "crypto";
import { Router } from "express";
import { db } from "../db/client";
import {
    fetchAgentCap,
    fetchOperatorCap,
    findCreatedObjectId,
} from "../chain/reads";
import { reportedRisk } from "../risk/evaluate";
import { buildIntentTransaction } from "../ptb/build-intent";
import { KOSHIRAE_PACKAGE_ID, suiClient } from "../chain/client";
import { intents } from "../db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { buildApprovalTransaction } from "../ptb/build-approval";
import { resolveIntentCoinType } from "../intent-coin-type";
import { Transaction } from "@mysten/sui/transactions";
import { waitForAfterDigest } from "../chain/wait";
import { ApiError } from "../errors";

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
        pendingActionId: row.pendingActionId ?? undefined,
    };
}

async function buildAndSignIntentTxBytes(params: {
    agentCap: AgentCap;
    request: SubmitIntentRequest;
    nonce: number;
}): Promise<Uint8Array> {
    const { agentCap, request, nonce } = params;
    const tx = await buildIntentTransaction({
        agentCapId: agentCap.id,
        vaultId: agentCap.vaultId,
        request,
        reportedRisk: reportedRisk({ agentCap, request }),
        nonce,
    });
    const { cap: _operatorCap, owner: operatorAddress } =
        await fetchOperatorCap(request.operatorCapId);
    tx.setSender(operatorAddress);
    return tx.build({ client: suiClient });
}

// Whether the intent executes or gets flagged is decided on-chain, so read it
// from a simulation of the built tx instead of re-implementing the risk floor.
// `tx.build` has already surfaced any Move abort by the time this runs.
async function simulateIntentOutcome(
    txBytes: Uint8Array,
): Promise<{ status: "ready" | "pending_approval"; riskScore: number }> {
    const result = await suiClient.core.simulateTransaction({
        transaction: txBytes,
        include: { events: true },
    });
    const tx = result.Transaction ?? result.FailedTransaction;
    if (!tx.status.success)
        throw new Error(tx.status.error?.message ?? "simulation failed");
    for (const event of tx.events) {
        const flagged = event.eventType.endsWith("::capability::ActionFlagged");
        const executed = event.eventType.endsWith(
            "::capability::ActionExecuted",
        );
        if (!flagged && !executed) continue;
        const riskScore = Number(event.json?.risk_score);
        if (!Number.isInteger(riskScore))
            throw new Error("simulated action event has no risk_score");
        return { status: flagged ? "pending_approval" : "ready", riskScore };
    }
    throw new Error("simulation emitted no ActionExecuted/ActionFlagged event");
}

function normalizeIntentRequest(
    request: SubmitIntentRequest,
): SubmitIntentRequest {
    switch (request.actionType) {
        case "stake":
            return request;
        case "cetusSwap":
            return {
                ...request,
                coinTypeIn: normalizeCoinType(request.coinTypeIn),
            };
        default: //transfer, mockSwap
            return {
                ...request,
                coinType: normalizeCoinType(request.coinType),
            };
    }
}

intentsRouter.post("/agent-caps/:agentCapId/intents", async (req, res) => {
    const { agentCapId } = req.params;
    const parsed = SubmitIntentRequest.safeParse(req.body);
    if (!parsed.success) {
        throw new ApiError(
            "invalid_request",
            "Invalid intent request",
            z.treeifyError(parsed.error),
        );
    }
    await waitForAfterDigest(req.query.afterDigest);

    const request = normalizeIntentRequest(parsed.data);

    const existing = await db.query.intents.findFirst({
        where: {
            agentCapId,
            idempotencyKey: request.idempotencyKey,
        },
    });
    if (existing) {
        const intent = rowToIntent(existing);
        // Object versions the first build referenced may be stale by now (this
        // is also how a caller's version-race retry gets here), so a not-yet-
        // submitted intent needs a fresh build rather than reusing old bytes —
        // there are none stored anyway, buildIntentTransaction needs current
        // chain state regardless.
        if (intent.status !== "ready" && intent.status !== "pending_approval")
            return res.status(200).json(intent);

        const agentCap = await fetchAgentCap(agentCapId);
        const txBytes = await buildAndSignIntentTxBytes({
            agentCap,
            request: intent.request,
            nonce: agentCap.lastNonce + 1,
        });
        return res.status(200).json({
            ...intent,
            unsignedTransaction: Buffer.from(txBytes).toString("base64"),
        });
    }

    const [agentCap, operatorCap] = await Promise.all([
        fetchAgentCap(agentCapId),
        fetchOperatorCap(request.operatorCapId),
    ]);
    if (operatorCap.cap.agentCapId !== agentCapId)
        throw new ApiError(
            "operator_cap_wrong_agent_cap",
            "Operator cap does not belong to this agent cap",
        );
    if (operatorCap.cap.generation !== agentCap.generation)
        throw new ApiError(
            "operator_cap_revoked",
            "Operator cap generation is stale",
        );
    if (!agentCap.active)
        throw new ApiError("agent_cap_inactive", "Agent cap is inactive");
    if (!agentCap.allowedActions.includes(request.actionType))
        throw new ApiError("action_not_allowed", "Action type not allowed");
    if (!agentCap.allowedTargets.includes(request.target))
        throw new ApiError("target_not_allowed", "Target not allowed");

    const coinType = resolveIntentCoinType(request);
    if (!agentCap.limits[coinType])
        throw new ApiError("coin_type_not_allowed", "Coin type not allowed");

    const txBytes = await buildAndSignIntentTxBytes({
        agentCap,
        request,
        nonce: agentCap.lastNonce + 1,
    });
    const { status, riskScore } = await simulateIntentOutcome(txBytes);

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
    if (!row) throw new ApiError("not_found", "Intent not found");
    return res.status(200).json(rowToIntent(row));
});

intentsRouter.post("/intents/:id/submitted", async (req, res) => {
    const { txDigest } = req.body ?? {};
    if (typeof txDigest !== "string")
        throw new ApiError("invalid_request", "txDigest required");

    const row = await db.query.intents.findFirst({
        where: {
            id: req.params.id,
        },
    });
    if (!row) throw new ApiError("not_found", "Intent not found");

    const result = await suiClient.waitForTransaction({ digest: txDigest });
    const transaction = result.Transaction ?? result.FailedTransaction;
    const succeeded = transaction.status.success;

    let pendingActionId: string | undefined;
    if (succeeded && row.status === "pending_approval") {
        const coinType = resolveIntentCoinType(row.request);
        pendingActionId = await findCreatedObjectId(
            txDigest,
            `::capability::PendingAction<${coinType}>`,
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
    return res.json({
        id: row.id,
        status: newStatus,
        txDigest,
        pendingActionId,
    });
});

intentsRouter.post("/intents/:id/approve", async (req, res) => {
    const row = await db.query.intents.findFirst({
        where: {
            id: req.params.id,
        },
    });
    if (!row) throw new ApiError("not_found", "Intent not found");
    if (row.status !== "pending_approval")
        throw new ApiError(
            "intent_not_pending_approval",
            "Intent is not pending approval",
        );
    if (!row.pendingActionId)
        throw new ApiError(
            "pending_action_not_recorded",
            "Pending action has not been recorded yet",
        );

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
    if (!row) throw new ApiError("not_found", "Intent not found");
    if (row.status !== "pending_approval")
        throw new ApiError(
            "intent_not_pending_approval",
            "Intent is not pending approval",
        );
    if (!row.pendingActionId)
        throw new ApiError(
            "pending_action_not_recorded",
            "Pending action has not been recorded yet",
        );

    const intent = rowToIntent(row);
    const pendingActionId = row.pendingActionId;
    const coinType = resolveIntentCoinType(intent.request);

    const agentCap = await fetchAgentCap(intent.agentCapId);
    const tx = new Transaction();
    tx.setSender(agentCap.owner);
    tx.moveCall({
        target: `${KOSHIRAE_PACKAGE_ID}::capability::reject_pending`,
        typeArguments: [coinType],
        arguments: [tx.object(pendingActionId), tx.object(intent.agentCapId)],
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
