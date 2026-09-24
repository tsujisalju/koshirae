import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { rejectIntent, reportSubmitted, submitIntent } from "../api";
import { operatorKeypair, ownerKeypair, suiClient } from "../client";
import { setupAgentCap } from "./setup";
import { randomUUID } from "crypto";
import { signAndSubmit } from "@koshirae/sdk";

export async function runFlaggedAndRejectScenario() {
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
        },
        lastDigest,
    );
    console.log(`Intent ${intent.id} status: ${intent.status}`); // expect pending_approval

    const submitDigest = await signAndSubmit(
        intent.unsignedTransaction,
        operatorKeypair,
        suiClient,
    );
    await reportSubmitted(intent.id, submitDigest);

    const rejected = await rejectIntent(intent.id, submitDigest);
    const rejectDigest = await signAndSubmit(
        rejected.unsignedTransaction,
        ownerKeypair,
        suiClient,
    );
    await reportSubmitted(intent.id, rejectDigest);
    console.log(`Rejected: ${rejectDigest}`);
}
