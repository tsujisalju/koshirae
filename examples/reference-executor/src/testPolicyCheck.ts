import "dotenv/config";
import { Transaction } from "@mysten/sui/transactions";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

const PACKAGE_ID = process.env.ORONYX_PACKAGE_ID!;
const OPERATOR_PRIVATE_KEY = process.env.ORONYX_OPERATOR_KEY!;
const VAULT_ID = process.env.ORONYX_VAULT_ID!;
const CAP_ID = process.env.ORONYX_CAP_ID!;
const TARGET_ADDRESS = process.env.ORONYX_TARGET_ADDRESS!; // must match allowed_targets from create_agent_cap
const CLOCK_ID = "0x6";

async function main() {
  const client = new SuiGrpcClient({
    baseUrl: "https://fullnode.testnet.sui.io:443",
    network: "testnet",
  });
  const keypair = Ed25519Keypair.fromSecretKey(
    decodeSuiPrivateKey(OPERATOR_PRIVATE_KEY).secretKey,
  );

  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::capability::execute_action_and_transfer_to_operator`,
    arguments: [
      tx.object(CAP_ID),
      tx.object(VAULT_ID),
      tx.pure.u8(1), // ACTION_SWAP
      tx.pure.address(TARGET_ADDRESS),
      tx.pure.u64(50_000_000), // well within your per-tx limit
      tx.pure.u8(10), // well below risk_threshold — should auto-execute
      tx.object(CLOCK_ID),
    ],
  });

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    include: { effects: true, events: true },
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
