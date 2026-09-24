import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { reportSubmitted, submitIntent } from "../api";
import { KOSHIRAE_PACKAGE_ID, operatorKeypair, suiClient } from "../client";
import { setupAgentCap } from "./setup";
import { randomUUID } from "crypto";
import { signAndSubmit } from "@koshirae/sdk";

const MOCK_USDC_TYPE = `${KOSHIRAE_PACKAGE_ID}::mock_usdc::MOCK_USDC`;
const CETUS_POOL_ID = process.env.CETUS_POOL_ID!;
const DEFAULT_LIMITS = { spendingLimitPerTx: "1000000000", spendingLimitPeriod: "5000000000" };

export async function runCetusSwapScenario() {
    const { agentCapId, operatorCapId, lastDigest } = await setupAgentCap(
        [CETUS_POOL_ID],
        [{ coinType: MOCK_USDC_TYPE, limits: DEFAULT_LIMITS }],
    );

    const intent = await submitIntent(agentCapId, {
        actionType: "cetusSwap",
        coinTypeIn: SUI_TYPE_ARG,
        target: CETUS_POOL_ID,
        amount: "50000000", // 0.05 SUI
        operatorCapId,
        idempotencyKey: randomUUID()
    }, lastDigest);

    console.log(`Intent ${intent.id} status: ${intent.status}`);
    const digest = await signAndSubmit(intent.unsignedTransaction, operatorKeypair, suiClient);
    await reportSubmitted(intent.id, digest);
    console.log(`Submitted: ${digest}`);
}
