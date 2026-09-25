import { signAndSubmit, withVersionRaceRetry } from "@koshirae/sdk";
import {
    KOSHIRAE_PACKAGE_ID,
    operatorKeypair,
    ownerKeypair,
    suiClient,
} from "../client";
import {
    ApiError,
    addAgentCapCoinLimits,
    addVaultCoinLimits,
    createAgentCapForVault,
    createAgentCapWithVault,
    mintOperatorCap,
    submitIntent,
} from "../api";
import { extractCreatedObjectId } from "../extract-created-id";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";
import { randomUUID } from "crypto";

const AGENT_LIMITS = {
    spendingLimitPerTx: "100000000",
    spendingLimitPeriod: "200000000",
};
const VAULT_LIMIT = {
    spendingLimitPerTx: "100000000",
    spendingLimitPeriod: "150000000",
};
const TRANSFER_AMOUNT = "100000000";

const ownerSign = (b64: string) => signAndSubmit(b64, ownerKeypair, suiClient);
const capParams = (recipient: string) => ({
    periodLengthMs: 86_400_00,
    allowedActions: ["transfer" as const],
    allowedTargets: [recipient],
    protocolTargets: [],
    riskThreshold: 200,
    expiryMs: Date.now() + 86_400_000,
    maxPendingWindowMs: 3_600_000,
});

export async function runSharedVaultScenario() {
    const recipient = ownerKeypair.toSuiAddress();
    const createDigest = await withVersionRaceRetry(
        () =>
            createAgentCapWithVault({
                owner: ownerKeypair.toSuiAddress(),
                vault: { periodLengthMs: 86_400_000 },
                agentCap: capParams(recipient),
            }),
        ownerSign,
    );
    const [agentCapAId, vaultId] = await Promise.all([
        extractCreatedObjectId(createDigest, "::capability::AgentCap"),
        extractCreatedObjectId(createDigest, "::capability::Vault"),
    ]);
    if (!agentCapAId || !vaultId)
        throw new Error("Agent A / vault creation failed");

    const attachDigest = await withVersionRaceRetry(
        () =>
            createAgentCapForVault(vaultId, capParams(recipient), createDigest),
        ownerSign,
    );
    const agentCapBId = await extractCreatedObjectId(
        attachDigest,
        "::capability::AgentCap",
    );
    if (!agentCapBId) throw new Error("Agent B creation failed");

    // Same operator address holds a distinct OperatorCap for AgentCap A and B
    // This scenario tests whether the vault ceiling constrains their combined spending, not operator identity
    const mintADigest = await withVersionRaceRetry(
        () =>
            mintOperatorCap(
                agentCapAId,
                operatorKeypair.toSuiAddress(),
                attachDigest,
            ),
        ownerSign,
    );
    const operatorCapAId = await extractCreatedObjectId(
        mintADigest,
        "::operator_cap::OperatorCap",
    );
    const mintBDigest = await withVersionRaceRetry(
        () =>
            mintOperatorCap(
                agentCapBId,
                operatorKeypair.toSuiAddress(),
                attachDigest,
            ),
        ownerSign,
    );
    const operatorCapBId = await extractCreatedObjectId(
        mintBDigest,
        "::operator_cap::OperatorCap",
    );
    if (!operatorCapAId || !operatorCapBId)
        throw new Error("Operator cap minting failed");

    await withVersionRaceRetry(
        () =>
            addAgentCapCoinLimits(
                agentCapAId,
                SUI_TYPE_ARG,
                AGENT_LIMITS,
                mintADigest,
            ),
        ownerSign,
    );
    await withVersionRaceRetry(
        () =>
            addAgentCapCoinLimits(
                agentCapBId,
                SUI_TYPE_ARG,
                AGENT_LIMITS,
                mintBDigest,
            ),
        ownerSign,
    );
    const vaultLimitDigest = await withVersionRaceRetry(
        () =>
            addVaultCoinLimits(
                vaultId,
                SUI_TYPE_ARG,
                VAULT_LIMIT,
                createDigest,
            ),
        ownerSign,
    );

    const depositDigest = await withVersionRaceRetry(async () => {
        const tx = new Transaction();
        tx.setSender(ownerKeypair.toSuiAddress());
        const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(300_000_000)]);
        tx.moveCall({
            target: `${KOSHIRAE_PACKAGE_ID}::capability::deposit`,
            typeArguments: [SUI_TYPE_ARG],
            arguments: [tx.object(vaultId), coin],
        });
        const bytes = await tx.build({ client: suiClient });
        return { unsignedTransaction: Buffer.from(bytes).toString("base64") };
    }, ownerSign);

    // Agent A spends its full allowance within its own limits, and within
    // the vault's ceiling so far (100M of 150M used).
    const intentA = await submitIntent(
        agentCapAId,
        {
            actionType: "transfer",
            coinType: SUI_TYPE_ARG,
            target: recipient,
            amount: TRANSFER_AMOUNT,
            operatorCapId: operatorCapAId,
            idempotencyKey: randomUUID(),
        },
        depositDigest,
    );
    const digestA = await signAndSubmit(
        intentA.unsignedTransaction,
        operatorKeypair,
        suiClient,
    );
    console.log(`Agent A transfer succeeded: ${digestA}`);

    // Agent B attempts the same, well within its own limit, but only
    // 50M of vault's ceiling remains. Should fail with EOverVaultPeriodLimit.
    // The API dry-runs the tx while building it, so the abort surfaces here as
    // a mapped error (403 over_vault_period_limit) via the error middleware.
    // afterDigest = digestA so the build sees Agent A's spend.
    try {
        await submitIntent(
            agentCapBId,
            {
                actionType: "transfer",
                coinType: SUI_TYPE_ARG,
                target: recipient,
                amount: TRANSFER_AMOUNT,
                operatorCapId: operatorCapBId,
                idempotencyKey: randomUUID(),
            },
            digestA,
        );
        console.error(
            "UNEXPECTED: Agent B succeeded despite the shared vault ceiling",
        );
    } catch (err) {
        if (
            err instanceof ApiError &&
            err.errorCode === "over_vault_period_limit"
        )
            console.log(
                `Expected failure, vault-level ceiling correctly blocked Agent B: ${err.message}`,
            );
        else throw err;
    }
}
