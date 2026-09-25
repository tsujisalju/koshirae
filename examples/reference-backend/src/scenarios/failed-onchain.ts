// Two intents (each with its own OperatorCap, since owned inputs are versioned
// on use) built against the same nonce both pass the API's dry-run. The
// first executes; the second then aborts on-chain with EStaleNonce. Confirms
// signAndSubmit throws TransactionFailedError and the failed digest, once
// reported, marks the intent "failed".

import { randomUUID } from "crypto";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";
import {
    signAndSubmit,
    TransactionFailedError,
    withVersionRaceRetry,
} from "@koshirae/sdk";
import {
    getIntent,
    mintOperatorCap,
    reportSubmitted,
    submitIntent,
} from "../api";
import {
    KOSHIRAE_PACKAGE_ID,
    operatorKeypair,
    ownerKeypair,
    suiClient,
} from "../client";
import { extractCreatedObjectId } from "../extract-created-id";
import { setupAgentCap } from "./setup";

export async function runFailedOnChainScenario() {
    const operator = operatorKeypair.toSuiAddress();
    const { agentCapId, operatorCapId, lastDigest } = await setupAgentCap([
        operator,
    ]);

    const mintDigest = await withVersionRaceRetry(
        () => mintOperatorCap(agentCapId, operator, lastDigest),
        (b64) => signAndSubmit(b64, ownerKeypair, suiClient),
    );
    const operatorCapBId = await extractCreatedObjectId(
        mintDigest,
        "::operator_cap::OperatorCap",
    );
    if (!operatorCapBId) throw new Error("Second OperatorCap mint failed");

    // A second operator gas coin (see withGasCoin below).
    const splitTx = new Transaction();
    splitTx.setSender(operator);
    const [extra] = splitTx.splitCoins(splitTx.gas, [
        splitTx.pure.u64(300_000_000),
    ]);
    splitTx.transferObjects([extra], splitTx.pure.address(operator));
    const splitDigest = await signAndSubmit(
        Buffer.from(await splitTx.build({ client: suiClient })).toString(
            "base64",
        ),
        operatorKeypair,
        suiClient,
    );
    await suiClient.core.waitForTransaction({ digest: splitDigest });

    const request = (capId: string) => ({
        actionType: "transfer" as const,
        coinType: SUI_TYPE_ARG,
        target: operator,
        amount: "1000000",
        operatorCapId: capId,
        idempotencyKey: randomUUID(),
    });
    const intentA = await submitIntent(
        agentCapId,
        request(operatorCapId),
        mintDigest,
    );
    const intentB = await submitIntent(
        agentCapId,
        request(operatorCapBId),
        mintDigest,
    );

    const { objects: coins } = await suiClient.core.listCoins({
        owner: operator,
        coinType: SUI_TYPE_ARG,
    });
    const gasCoins = coins.filter((c) => BigInt(c.balance) >= 100_000_000n);
    if (gasCoins.length < 2)
        throw new Error("Need two operator gas coins with >= 0.1 SUI");

    // The API attaches every operator coin as gas; give each intent its own
    // single coin so executing A doesn't invalidate B's gas payment.
    const withGasCoin = async (
        unsignedTransaction: string,
        coin: (typeof gasCoins)[number],
    ) => {
        const tx = Transaction.from(unsignedTransaction);
        tx.setGasPayment([
            {
                objectId: coin.objectId,
                version: coin.version,
                digest: coin.digest,
            },
        ]);
        return Buffer.from(await tx.build({ client: suiClient })).toString(
            "base64",
        );
    };
    const txA = await withGasCoin(intentA.unsignedTransaction, gasCoins[0]);
    const txB = await withGasCoin(intentB.unsignedTransaction, gasCoins[1]);

    const digestA = await signAndSubmit(txA, operatorKeypair, suiClient);
    await reportSubmitted(intentA.id, digestA);
    console.log(`Intent A executed: ${digestA}`);

    try {
        await signAndSubmit(txB, operatorKeypair, suiClient);
        console.error("UNEXPECTED: Intent B succeeded despite stale nonce");
        return;
    } catch (err) {
        if (!(err instanceof TransactionFailedError)) throw err;
        console.log(`Expected on-chain failure: ${err.message}`);
        await reportSubmitted(intentB.id, err.digest);
    }

    const { status } = await getIntent(intentB.id);
    if (status !== "failed")
        throw new Error(`Expected intent B status "failed", got "${status}"`);
    console.log(`Intent B status after report: ${status}`);
}
