// creates a Cetus pool meant to be used across many runs
// run this manually once, capture resulting ID into .env

import { SUI_TYPE_ARG, normalizeSuiAddress } from "@mysten/sui/utils";
import { KOSHIRAE_PACKAGE_ID, ownerKeypair, suiClient } from "../client";
import { Transaction } from "@mysten/sui/transactions";
import {
    TickMath,
    d,
    asUintN,
    MIN_TICK_INDEX,
    MAX_TICK_INDEX,
} from "@cetusprotocol/common-sdk";
import { signAndSubmit } from "@koshirae/sdk";
import { extractCreatedObjectId } from "../extract-created-id";

const CETUS_PACKAGE_ID = process.env.CETUS_PACKAGE_ID!;
const CETUS_GLOBAL_CONFIG_ID = process.env.CETUS_GLOBAL_CONFIG_ID!;
const CETUS_POOLS_ID = process.env.CETUS_POOLS_ID!;
const MOCK_USDC_TREASURY_CAP_ID = process.env.MOCK_USDC_TREASURY_CAP_ID!; // fresh object post-deploy

const MOCK_USDC_TYPE = `${KOSHIRAE_PACKAGE_ID}::mock_usdc::MOCK_USDC`;

function normalizeCoinType(type: string): string {
  const [address, ...rest] = type.split("::");
  return [normalizeSuiAddress(address), ...rest].join("::");
}

// Cetus convention: coinTypeA is the coin type with the LARGER normalized address.
function isCoinA(candidate: string, other: string): boolean {
  return normalizeCoinType(candidate) > normalizeCoinType(other);
}

async function main() {
    const suiIsA = isCoinA(SUI_TYPE_ARG, MOCK_USDC_TYPE);
    const [coinTypeA, coinTypeB] = suiIsA
        ? [SUI_TYPE_ARG, MOCK_USDC_TYPE]
        : [MOCK_USDC_TYPE, SUI_TYPE_ARG];

    const tx = new Transaction();
    tx.setSender(ownerKeypair.toSuiAddress());

    const mockUsdc = tx.moveCall({
        target: `${KOSHIRAE_PACKAGE_ID}::mock_usdc::mint_mock_usdc`,
        arguments: [
            tx.object(MOCK_USDC_TREASURY_CAP_ID),
            tx.pure.u64(10_000_000_000),
        ],
    });
    const [suiForPool] = tx.splitCoins(tx.gas, [tx.pure.u64(1_000_000_000)]);
    const coinA = suiIsA ? suiForPool : mockUsdc;
    const coinB = suiIsA ? mockUsdc : suiForPool;

    // Cetus price = how much of coinB one unit of coinA is worth.
    const price = suiIsA ? d(0.72) : d(1).div(d(0.72));
    const sqrtPrice = TickMath.priceToSqrtPriceX64(
        price,
        suiIsA ? 9 : 6,
        suiIsA ? 6 : 9,
    );
    const tickSpacing = 60;
    const tickLower = TickMath.getInitializeTickIndex(
        MIN_TICK_INDEX,
        tickSpacing,
    );
    const tickUpper = TickMath.getInitializeTickIndex(
        MAX_TICK_INDEX,
        tickSpacing,
    );

    const [position, leftoverA, leftoverB] = tx.moveCall({
        target: `${CETUS_PACKAGE_ID}::pool_creator::create_pool_v3`,
        typeArguments: [coinTypeA, coinTypeB],
        arguments: [
            tx.object(CETUS_GLOBAL_CONFIG_ID),
            tx.object(CETUS_POOLS_ID),
            tx.pure.u32(tickSpacing),
            tx.pure.u128(BigInt(sqrtPrice.toString())),
            tx.pure.string(""),
            tx.pure.u32(Number(asUintN(BigInt(tickLower)))),
            tx.pure.u32(Number(asUintN(BigInt(tickUpper)))),
            coinA,
            coinB,
            tx.pure.bool(suiIsA), // SUI is the fixed side regardless of slot
            tx.object.clock(),
        ],
    });
    tx.transferObjects(
        [position, leftoverA, leftoverB],
        tx.pure.address(ownerKeypair.toSuiAddress()),
    );

    const bytes = await tx.build({ client: suiClient });
    const digest = await signAndSubmit(
        Buffer.from(bytes).toString("base64"),
        ownerKeypair,
        suiClient,
    );
    const poolId = await extractCreatedObjectId(
        digest,
        // Cetus types use its original package id, not CETUS_PACKAGE_ID
        "::pool::Pool<",
    );
    if (!poolId)
        throw new Error(`Could not find created Pool (digest: ${digest})`);
    console.log(
        `Pool created: CETUS_POOL_ID=${poolId} (coin ordering A=${coinTypeA}, B=${coinTypeB})`,
    );
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
