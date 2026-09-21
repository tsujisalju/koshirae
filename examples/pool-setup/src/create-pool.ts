// examples/pool-setup/src/create-pool.ts
//
// One-time testnet verification: create our own SUI/MOCK_USDC Cetus CLMM
// pool with real seeded liquidity, then exercise flash_swap/repay_flash_swap
// against it (see flash-swap-settle.ts) to confirm the settlement mechanics.
// Not part of the app build — run manually via `pnpm --filter pool-setup
// create-pool`.

import { Transaction } from "@mysten/sui/transactions";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  TickMath,
  d,
  fixSuiObjectId,
  isSortedSymbols,
  asUintN,
  MIN_TICK_INDEX,
  MAX_TICK_INDEX,
} from "@cetusprotocol/common-sdk";

const SUI_RPC_URL =
  process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443";
const KOSHIRAE_PACKAGE_ID = process.env.KOSHIRAE_PACKAGE_ID!;
const MOCK_USDC_TREASURY_CAP_ID = process.env.MOCK_USDC_TREASURY_CAP_ID!;
const SIGNER_PRIVATE_KEY = process.env.SCRIPT_SIGNER_KEY!;

const CETUS_PACKAGE_ID =
  "0x6bbdf09f9fa0baa1524080a5b8991042e95061c4e1206217279aec51ba08edf7";
const CETUS_GLOBAL_CONFIG_ID =
  "0xc6273f844b4bc258952c4e477697aa12c918c8e08106fac6b934811298c9820a";
const CETUS_POOLS_ID =
  "0x20a086e6fa0741b3ca77d033a65faf0871349b986ddbdde6fa1d85d78a5f4222";

const SUI_TYPE = "0x2::sui::SUI";
const MOCK_USDC_TYPE = `${KOSHIRAE_PACKAGE_ID}::mock_usdc::MOCK_USDC`;
const SUI_DECIMALS = 9;
const MOCK_USDC_DECIMALS = 6;
const TICK_SPACING = 60;

const client = new SuiGrpcClient({ network: "testnet", baseUrl: SUI_RPC_URL });
const signer = Ed25519Keypair.fromSecretKey(SIGNER_PRIVATE_KEY);

// Cetus's own convention (see pool_creator docs): coinTypeA is whichever
// coin type has the LARGER address once both are complete — SUI's "0x2"
// shorthand must be zero-padded to its full 32-byte form before comparing.
function normalizeCoinType(type: string): string {
  const [address, ...rest] = type.split("::");
  return [fixSuiObjectId(address), ...rest].join("::");
}

async function main() {
  const suiIsSmaller = isSortedSymbols(
    normalizeCoinType(SUI_TYPE),
    normalizeCoinType(MOCK_USDC_TYPE),
  );
  const aIsSui = !suiIsSmaller;
  const coinTypeA = aIsSui ? SUI_TYPE : MOCK_USDC_TYPE;
  const coinTypeB = aIsSui ? MOCK_USDC_TYPE : SUI_TYPE;

  const tx = new Transaction();

  const mockUsdc = tx.moveCall({
    target: `${KOSHIRAE_PACKAGE_ID}::mock_usdc::mint_mock_usdc`,
    arguments: [
      tx.object(MOCK_USDC_TREASURY_CAP_ID),
      tx.pure.u64(10_000_000_000),
    ], // 10,000 mUSDC (6dp)
  });
  const [suiForPool] = tx.splitCoins(tx.gas, [tx.pure.u64(2_000_000_000)]); // 2 SUI

  const coinA = aIsSui ? suiForPool : mockUsdc;
  const coinB = aIsSui ? mockUsdc : suiForPool;

  // Cetus defines price as "how much of coinB one unit of coinA is worth",
  // so which side of the 0.72-mUSDC-per-1-SUI rate is the numerator flips
  // depending on which coin landed in slot A.
  const price = aIsSui ? d(0.72) : d(1).div(d(0.72));
  const decimalsA = aIsSui ? SUI_DECIMALS : MOCK_USDC_DECIMALS;
  const decimalsB = aIsSui ? MOCK_USDC_DECIMALS : SUI_DECIMALS;
  const initializeSqrtPrice = BigInt(
    TickMath.priceToSqrtPriceX64(price, decimalsA, decimalsB).toString(),
  );
  // Widest tick range valid at this spacing: Cetus requires
  // MIN_TICK_INDEX < tick_lower < tick_upper < MAX_TICK_INDEX, and both
  // bounds must be multiples of the tick spacing.
  const tickLowerIdx = TickMath.getInitializeTickIndex(
    MIN_TICK_INDEX,
    TICK_SPACING,
  );
  const tickUpperIdx = TickMath.getInitializeTickIndex(
    MAX_TICK_INDEX,
    TICK_SPACING,
  );

  const [position, leftoverA, leftoverB] = tx.moveCall({
    target: `${CETUS_PACKAGE_ID}::pool_creator::create_pool_v3`,
    typeArguments: [coinTypeA, coinTypeB],
    arguments: [
      tx.object(CETUS_GLOBAL_CONFIG_ID),
      tx.object(CETUS_POOLS_ID),
      tx.pure.u32(TICK_SPACING), // 0.25% fee tier, arbitrary reasonable choice for a test pool
      tx.pure.u128(initializeSqrtPrice),
      tx.pure.string(""), // no icon needed
      tx.pure.u32(Number(asUintN(BigInt(tickLowerIdx)))),
      tx.pure.u32(Number(asUintN(BigInt(tickUpperIdx)))),
      coinA,
      coinB,
      tx.pure.bool(aIsSui), // fix_amount_a — SUI's the fixed side regardless of which slot it landed in
      tx.object.clock(),
    ],
  });

  // Position and both leftover-change coins are non-drop values the PTB
  // must explicitly place somewhere.
  tx.transferObjects(
    [position, leftoverA, leftoverB],
    tx.pure.address(signer.toSuiAddress()),
  );

  const result = await client.core.signAndExecuteTransaction({
    transaction: tx,
    signer,
    include: { effects: true, objectTypes: true },
  });
  console.log("Pool created:", JSON.stringify(result, null, 2));
}

main();
