import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

export const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";
export const KOSHIRAE_PACKAGE_ID = process.env.KOSHIRAE_PACKAGE_ID!;
export const KOSHIRAE_ORIGINAL_PACKAGE_ID = process.env.KOSHIRAE_ORIGINAL_PACKAGE_ID!;
export const SUI_NETWORK = process.env.SUI_NETWORK ?? "testnet";

export const suiClient = new SuiGrpcClient({
  network: SUI_NETWORK,
  baseUrl: process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443",
});

export const ownerKeypair = Ed25519Keypair.fromSecretKey(process.env.OWNER_PRIVATE_KEY!);
export const operatorKeypair = Ed25519Keypair.fromSecretKey(process.env.OPERATOR_PRIVATE_KEY!);
