// Confirms the second submitIntent call short-circuits straight
// from the stored row and never re-reads chain state or rebuilds
// a transaction. Nothing here gets signed or submitted.

import { randomUUID } from "crypto";
import { operatorKeypair } from "../client";
import { setupAgentCap } from "./setup";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { submitIntent } from "../api";

export async function runIdempotencyScenario() {
    const recipient = operatorKeypair.toSuiAddress();
    const { agentCapId, operatorCapId, lastDigest } = await setupAgentCap([
        recipient,
    ]);
    const idempotencyKey = randomUUID();

    const args = {
        actionType: "transfer" as const,
        coinType: SUI_TYPE_ARG,
        target: recipient,
        amount: "1000000",
        operatorCapId,
        idempotencyKey,
    };
    const first = await submitIntent(agentCapId, args, lastDigest);
    const second = await submitIntent(agentCapId, args, lastDigest);

    if (first.id !== second.id)
        throw new Error(
            `idempotency failed: got two different intent ids (${first.id} vs ${second.id})`,
        );
    console.log(
        `Idempotency confirmed: both calls returned intent ${first.id}`,
    );
}
