import "dotenv/config";
import CetusClmmSDK from "@cetusprotocol/sui-clmm-sdk";
import { Percentage, adjustForSlippage, d } from "@cetusprotocol/common-sdk";
import BN from "bn.js";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

/**
 * Standalone test: proves the Cetus testnet SDK works end-to-end,
 * completely isolated from capability.move / the vault / AgentCap.
 * Run with a funded testnet keypair (get SUI from the testnet faucet).
 *
 * Usage:
 *   ORONYX_OPERATOR_KEY=suiprivkey1... npm run dev -- src/testCetusSwap.ts
 * (or add a "test:cetus": "tsx src/testCetusSwap.ts" script)
 */

const OPERATOR_PRIVATE_KEY = process.env.ORONYX_OPERATOR_KEY!;
const FULLNODE_BASE_URL =
  process.env.ORONYX_FULLNODE_URL ?? "https://fullnode.testnet.sui.io:443";
const NETWORK = "testnet" as const;

async function main() {
  if (!OPERATOR_PRIVATE_KEY) {
    throw new Error(
      "Set ORONYX_OPERATOR_KEY to a funded testnet keypair (suiprivkey1...) first.",
    );
  }

  const client = new SuiGrpcClient({
    baseUrl: FULLNODE_BASE_URL,
    network: NETWORK,
  });
  const keypair = Ed25519Keypair.fromSecretKey(
    decodeSuiPrivateKey(OPERATOR_PRIVATE_KEY).secretKey,
  );
  const address = keypair.getPublicKey().toSuiAddress();
  console.log("Testing as:", address);

  const sdk = CetusClmmSDK.createSDK({ env: NETWORK });
  const wallet = process.env.ORONYX_OPERATOR_ADDR!;
  sdk.setSenderAddress(wallet);

  // --- Discover a real testnet pool instead of hardcoding an address ---
  const poolsPage = await sdk.Pool.getPoolsWithPage();
  const pools = poolsPage.data ?? [];
  if (pools.length === 0) {
    throw new Error(
      "No pools returned — testnet indexer may be empty/down; check Cetus's status.",
    );
  }

  // Prefer a pool that actually has liquidity so the swap doesn't fail on
  // an empty/abandoned test pool.
  const hasSui = (p: (typeof pools)[number]) =>
    p.coin_type_a?.includes("::sui::SUI") ||
    p.coin_type_b?.includes("::sui::SUI");
  const hasLiquidity = (p: (typeof pools)[number]) => p.liquidity > 0;

  // Try SUI-paired, liquid candidates in descending order of liquidity —
  // some testnet pools (e.g. junk/abandoned ones) report liquidity > 0
  // but have such a skewed price that any reasonably small test amount
  // rounds down to a 0-token quote. Cetus's pool::flash_swap_internal
  // aborts (code 18) rather than execute a zero-output swap, so we
  // pre-flight each candidate with `preSwap` and skip ones that quote 0
  // instead of submitting a doomed transaction.
  const candidates = pools
    .filter((p) => hasSui(p) && hasLiquidity(p))
    .sort((a, b) => b.liquidity - a.liquidity);

  if (candidates.length === 0) {
    throw new Error(
      "No SUI-paired pool with liquidity found — consider the mock DEX fallback instead.",
    );
  }

  const testAmount = "1000000"; // 0.001 of the input coin's smallest unit, adjust as needed
  const byAmountIn = true;

  let pool: Awaited<ReturnType<typeof sdk.Pool.getPool>> | undefined;
  let a2b = true;
  let preSwapRes: any;

  for (const candidate of candidates) {
    const candidatePool = await sdk.Pool.getPool(candidate.id);
    const suiIsCoinA = candidatePool.coin_type_a?.includes("::sui::SUI");
    const suiIsCoinB = candidatePool.coin_type_b?.includes("::sui::SUI");
    if (!suiIsCoinA && !suiIsCoinB) continue;

    // a2b=true means "spend coin_type_a to receive coin_type_b" — so if
    // SUI is coin_type_a, we want a2b=true (spend SUI); if SUI is
    // coin_type_b, we want a2b=false (still spending SUI, just from the
    // other side).
    const candidateA2b = suiIsCoinA;

    const [metadataA, metadataB] = await Promise.all([
      sdk.FullClient.getCoinMetadata({ coinType: candidatePool.coin_type_a }),
      sdk.FullClient.getCoinMetadata({ coinType: candidatePool.coin_type_b }),
    ]);

    const candidatePreSwap: any = await sdk.Swap.preSwap({
      pool: candidatePool,
      current_sqrt_price: candidatePool.current_sqrt_price,
      coin_type_a: candidatePool.coin_type_a,
      coin_type_b: candidatePool.coin_type_b,
      decimals_a: metadataA.coinMetadata?.decimals ?? 9,
      decimals_b: metadataB.coinMetadata?.decimals ?? 9,
      a2b: candidateA2b,
      by_amount_in: byAmountIn,
      amount: testAmount,
    });

    console.log("Checked pool:", candidate.id, {
      coin_type_a: candidatePool.coin_type_a,
      coin_type_b: candidatePool.coin_type_b,
      estimated_amount_out: candidatePreSwap.estimated_amount_out,
    });

    if (BigInt(candidatePreSwap.estimated_amount_out ?? "0") > 0n) {
      pool = candidatePool;
      a2b = candidateA2b;
      preSwapRes = candidatePreSwap;
      break;
    }

    console.warn(
      `Skipping pool ${candidate.id} — quotes a 0-token output for this test amount ` +
        "(price is too skewed relative to the amount, or the pool is junk/abandoned).",
    );
  }

  if (!pool) {
    throw new Error(
      "No SUI-paired pool quoted a non-zero output for this test amount — " +
        "consider the mock DEX fallback instead of continuing to search testnet.",
    );
  }

  console.log("Using pool:", pool.id, {
    coin_type_a: pool.coin_type_a,
    coin_type_b: pool.coin_type_b,
  });
  console.log("preSwap result:", preSwapRes);

  const slippage = Percentage.fromDecimal(d(5)); // 5% for a test run
  const toAmount = byAmountIn
    ? preSwapRes.estimated_amount_out
    : preSwapRes.estimated_amount_in;
  const amountLimit = adjustForSlippage(
    new BN(toAmount),
    slippage,
    !byAmountIn,
  );

  const swapTx = await sdk.Swap.createSwapPayload({
    pool_id: pool.id,
    coin_type_a: pool.coin_type_a,
    coin_type_b: pool.coin_type_b,
    a2b,
    by_amount_in: byAmountIn,
    amount: preSwapRes.amount.toString(),
    amount_limit: amountLimit.toString(),
  });

  console.log("Submitting swap transaction...");
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: swapTx,
  });

  console.log("Swap result:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
