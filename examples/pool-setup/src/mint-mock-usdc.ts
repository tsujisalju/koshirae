// examples/pool-setup/src/mint-mock-usdc.ts
//
// One-off utility: mint mock USDC from the treasury cap to the signer's
// own address. Not part of the app build — run manually via
// `pnpm --filter pool-setup mint-mock-usdc`.

import { Transaction } from "@mysten/sui/transactions";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const SUI_RPC_URL =
  process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443";
const KOSHIRAE_PACKAGE_ID = process.env.KOSHIRAE_PACKAGE_ID!;
const MOCK_USDC_TREASURY_CAP_ID = process.env.MOCK_USDC_TREASURY_CAP_ID!;
const SIGNER_PRIVATE_KEY = process.env.SCRIPT_SIGNER_KEY!;
const MINT_AMOUNT = 10_000_000_000n; // 10,000 mUSDC (6dp)

const client = new SuiGrpcClient({ network: "testnet", baseUrl: SUI_RPC_URL });
const signer = Ed25519Keypair.fromSecretKey(SIGNER_PRIVATE_KEY);

async function main() {
  const tx = new Transaction();
  const mockUsdc = tx.moveCall({
    target: `${KOSHIRAE_PACKAGE_ID}::mock_usdc::mint_mock_usdc`,
    arguments: [tx.object(MOCK_USDC_TREASURY_CAP_ID), tx.pure.u64(MINT_AMOUNT)],
  });
  tx.transferObjects([mockUsdc], tx.pure.address(signer.toSuiAddress()));

  const result = await client.core.signAndExecuteTransaction({
    transaction: tx,
    signer,
    include: { effects: true, objectTypes: true },
  });
  console.log("Minted mock USDC:", JSON.stringify(result, null, 2));
}

main();
