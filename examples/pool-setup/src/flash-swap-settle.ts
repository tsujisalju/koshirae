// examples/pool-setup/src/flash-swap-settle.ts
//
// Confirmation smoke test (not discovery this time — the accounting here
// was already verified against the pre-rename pool): exercise
// flash_swap/repay_flash_swap against the pool created by create-pool.ts
// to confirm the settlement mechanics still hold after the redeploy.
// Not part of the app build — run manually via `pnpm --filter pool-setup
// flash-swap-settle`.

import { Transaction } from "@mysten/sui/transactions";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fixSuiObjectId, isSortedSymbols } from "@cetusprotocol/common-sdk";

const SUI_RPC_URL =
  process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443";
const KOSHIRAE_PACKAGE_ID = process.env.KOSHIRAE_PACKAGE_ID!;
const SIGNER_PRIVATE_KEY = process.env.SCRIPT_SIGNER_KEY!;
// Set after running create-pool.ts.
const POOL_ID = process.env.CETUS_POOL_ID!;

const CETUS_PACKAGE_ID =
  "0x6bbdf09f9fa0baa1524080a5b8991042e95061c4e1206217279aec51ba08edf7";
const CETUS_GLOBAL_CONFIG_ID =
  "0xc6273f844b4bc258952c4e477697aa12c918c8e08106fac6b934811298c9820a";

const SUI_TYPE = "0x2::sui::SUI";
const MOCK_USDC_TYPE = `${KOSHIRAE_PACKAGE_ID}::mock_usdc::MOCK_USDC`;
const SWAP_AMOUNT_IN = 100_000_000n; // 0.1 SUI, exact input

const client = new SuiGrpcClient({ network: "testnet", baseUrl: SUI_RPC_URL });
const signer = Ed25519Keypair.fromSecretKey(SIGNER_PRIVATE_KEY);

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

  // We're always paying in SUI and receiving mUSDC — a2b (selling A into
  // the pool) exactly when SUI is coinA.
  const a2b = aIsSui;

  const tx = new Transaction();

  const [outA, outB, receipt] = tx.moveCall({
    target: `${CETUS_PACKAGE_ID}::pool::flash_swap`,
    typeArguments: [coinTypeA, coinTypeB],
    arguments: [
      tx.object(CETUS_GLOBAL_CONFIG_ID),
      tx.object(POOL_ID),
      tx.pure.bool(a2b),
      tx.pure.bool(true), // by_amount_in — exact input, so what we owe is exactly SWAP_AMOUNT_IN
      tx.pure.u64(SWAP_AMOUNT_IN),
      // MAX/MIN_SQRT_PRICE-equivalent "no limit" sentinel — same values
      // baked into capability.move's finish_cetus_swap_* functions.
      tx.pure.u128(
        a2b ? 4295048016n : 79226673515401279992447579055n,
      ),
      tx.object.clock(),
    ],
  });

  // Whichever slot SUI landed in is the side we still owe (empty
  // placeholder); the other slot is the real mUSDC proceeds to keep.
  const [suiIn] = tx.splitCoins(tx.gas, [tx.pure.u64(SWAP_AMOUNT_IN)]);
  const suiInBalance = tx.moveCall({
    target: "0x2::coin::into_balance",
    typeArguments: [SUI_TYPE],
    arguments: [suiIn],
  });
  const zeroForCoinA = tx.moveCall({
    target: "0x2::balance::zero",
    typeArguments: [coinTypeA],
  });

  const repayBalanceA = aIsSui ? suiInBalance : zeroForCoinA;
  const repayBalanceB = aIsSui ? zeroForCoinA : suiInBalance;

  tx.moveCall({
    target: `${CETUS_PACKAGE_ID}::pool::repay_flash_swap`,
    typeArguments: [coinTypeA, coinTypeB],
    arguments: [
      tx.object(CETUS_GLOBAL_CONFIG_ID),
      tx.object(POOL_ID),
      repayBalanceA,
      repayBalanceB,
      receipt,
    ],
  });

  const owedOutput = aIsSui ? outA : outB; // empty placeholder for SUI's slot — confirmed zero, destroy
  const proceedsOutput = aIsSui ? outB : outA; // real mUSDC proceeds — keep
  const proceedsType = MOCK_USDC_TYPE;

  tx.moveCall({
    target: "0x2::balance::destroy_zero",
    typeArguments: [SUI_TYPE],
    arguments: [owedOutput],
  });
  const proceeds = tx.moveCall({
    target: "0x2::coin::from_balance",
    typeArguments: [proceedsType],
    arguments: [proceedsOutput],
  });
  tx.transferObjects([proceeds], tx.pure.address(signer.toSuiAddress()));

  const result = await client.core.signAndExecuteTransaction({
    transaction: tx,
    signer,
    include: { effects: true, balanceChanges: true },
  });
  console.log(JSON.stringify(result, null, 2));
}

main();
