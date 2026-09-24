import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { approveIntent, reportSubmitted, submitIntent } from "../api";
import { operatorKeypair, ownerKeypair, suiClient } from "../client";
import { setupAgentCap } from "./setup";
import { randomUUID } from "crypto";
import { signAndSubmit } from "@koshirae/sdk";

export async function runFlaggedAndExpiredScenario() {
    const recipient = operatorKeypair.toSuiAddress();
    const { agentCapId, operatorCapId, lastDigest } = await setupAgentCap([
        recipient,
    ]);

    const intent = await submitIntent(
        agentCapId,
        {
            actionType: "transfer",
            coinType: SUI_TYPE_ARG,
            target: recipient,
            amount: "1000000",
            operatorCapId,
            idempotencyKey: randomUUID(),
            agentReportedRisk: 255,
            requestedPendingWindowMs: 5_000, // inside 1 hr ceiling, deliberately short
        },
        lastDigest,
    );

    const submitDigest = await signAndSubmit(
        intent.unsignedTransaction,
        operatorKeypair,
        suiClient,
    );
    await reportSubmitted(intent.id, submitDigest);

    console.log("Waiting 6s for the pending window to lapse...");
    await new Promise((r) => setTimeout(r, 6_000));

    try {
        const approved = await approveIntent(intent.id, submitDigest);
        await signAndSubmit(
            approved.unsignedTransaction,
            ownerKeypair,
            suiClient,
        );
        console.error("UNEXPECTED: approval succeeded past expiry");
    } catch (err) {
        console.log(
            `Expected failure - correctly rejected past expiry: ${(err as Error).message}`,
        );
    }
}
