import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { reportSubmitted, submitIntent } from "../api";
import { KOSHIRAE_PACKAGE_ID, operatorKeypair, suiClient } from "../client";
import { setupAgentCap } from "./setup";
import { randomUUID } from "crypto";
import { signAndSubmit } from "@koshirae/sdk";

const MOCK_USDC_TYPE = `${KOSHIRAE_PACKAGE_ID}::mock_usdc::MOCK_USDC`;
const MOCK_POOL_ID = process.env.MOCK_POOL_ID!;
const DEFAULT_LIMITS = {
    spendingLimitPerTx: "1000000000",
    spendingLimitPeriod: "5000000000",
};

export async function runMockSwapScenario() {
    const { agentCapId, operatorCapId, lastDigest } = await setupAgentCap(
        [MOCK_POOL_ID],
        [{ coinType: MOCK_USDC_TYPE, limits: DEFAULT_LIMITS }],
    );

    const leg1 = await submitIntent(
        agentCapId,
        {
            actionType: "mockSwap",
            coinType: SUI_TYPE_ARG,
            target: MOCK_POOL_ID,
            amount: "50000000",
            operatorCapId,
            idempotencyKey: randomUUID(),
        },
        lastDigest,
    );
    const leg1Digest = await signAndSubmit(
        leg1.unsignedTransaction,
        operatorKeypair,
        suiClient,
    );
    await reportSubmitted(leg1.id, leg1Digest);
    console.log(`Leg 1 (SUI -> mUSDC) submitted: ${leg1Digest}`);

    // Leg 2 is reachable now as the output of leg 1 now stays in the vault,
    // rather than leaving to the owner, thanks to the multi-asset vault redesign.
    const usdcOut = (50_000_000n * 950_000n) / 1_000_000_000n;
    const leg2 = await submitIntent(
        agentCapId,
        {
            actionType: "mockSwap",
            coinType: MOCK_USDC_TYPE,
            target: MOCK_POOL_ID,
            amount: usdcOut.toString(),
            operatorCapId,
            idempotencyKey: randomUUID(),
        },
        leg1Digest,
    );
    const leg2Digest = await signAndSubmit(
        leg2.unsignedTransaction,
        operatorKeypair,
        suiClient,
    );
    await reportSubmitted(leg2.id, leg2Digest);
    console.log(`Leg 2 (mUSDC -> SUI) submitted: ${leg2Digest}`);
}
