import { Transaction } from "@mysten/sui/transactions";
import { signAndSubmit } from "@koshirae/sdk";
import { ownerKeypair, suiClient, KOSHIRAE_PACKAGE_ID } from "../client";
import { extractCreatedObjectId } from "../extract-created-id";

const MOCK_USDC_TREASURY_CAP_ID = process.env.MOCK_USDC_TREASURY_CAP_ID!;

async function main() {
    const tx = new Transaction();
    tx.setSender(ownerKeypair.toSuiAddress());

    const mockUsdc = tx.moveCall({
        target: `${KOSHIRAE_PACKAGE_ID}::mock_usdc::mint_mock_usdc`,
        arguments: [
            tx.object(MOCK_USDC_TREASURY_CAP_ID),
            tx.pure.u64(1_000_000_000),
        ],
    });
    const [sui] = tx.splitCoins(tx.gas, [tx.pure.u64(1_000_000_000)]);
    tx.moveCall({
        target: `${KOSHIRAE_PACKAGE_ID}::mock_dex::create_pool`,
        arguments: [sui, mockUsdc, tx.pure.u64(950_000)], // matches the rate used throughout the Move test suite
    });

    const bytes = await tx.build({ client: suiClient });
    const digest = await signAndSubmit(
        Buffer.from(bytes).toString("base64"),
        ownerKeypair,
        suiClient,
    );
    const poolId = await extractCreatedObjectId(
        digest,
        `${KOSHIRAE_PACKAGE_ID}::mock_dex::MockPool`,
    );
    console.log(`Mock pool created — set MOCK_POOL_ID=${poolId}`);
}
main();
