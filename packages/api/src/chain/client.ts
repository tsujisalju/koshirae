import { SuiGrpcClient } from "@mysten/sui/grpc";

const SUI_RPC_URL = process.env.SUI_RPC_URL;
if (!SUI_RPC_URL) {
  throw new Error("SUI_RPC_URL is not set");
}

export const suiClient = new SuiGrpcClient({
  network: "testnet",
  baseUrl: SUI_RPC_URL,
});

export const KOSHIRAE_PACKAGE_ID = process.env.KOSHIRAE_PACKAGE_ID;
if (!KOSHIRAE_PACKAGE_ID) {
  throw new Error("KOSHIRAE_PACKAGE_ID is not set");
}

export const CETUS_PACKAGE_ID = process.env.CETUS_PACKAGE_ID;
export const CETUS_GLOBAL_CONFIG_ID = process.env.CETUS_GLOBAL_CONFIG_ID;
if (!CETUS_PACKAGE_ID || !CETUS_GLOBAL_CONFIG_ID) {
  throw new Error("CETUS_PACKAGE_ID or CETUS_GLOBAL_CONFIG_ID is not set");
}
