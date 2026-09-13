import { SuiGrpcClient } from "@mysten/sui/grpc";

const SUI_RPC_URL = process.env.SUI_RPC_URL;
if (!SUI_RPC_URL) {
  throw new Error("SUI_RPC_URL is not set");
}

export const suiClient = new SuiGrpcClient({
  network: "testnet",
  baseUrl: SUI_RPC_URL,
});

export const ORONYX_PACKAGE_ID = process.env.ORONYX_PACKAGE_ID;
if (!ORONYX_PACKAGE_ID) {
  throw new Error("ORONYX_PACKAGE_ID is not set");
}
