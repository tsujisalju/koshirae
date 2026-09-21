import { signAndSubmit as sdkSignAndSubmit } from "@koshirae/sdk";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { suiClient } from "./client";
import { reportSubmitted } from "./api";

export async function signSubmitAndReport(
  base64Tx: string,
  signer: Ed25519Keypair,
  intentId?: string,
): Promise<string> {
  const digest = await sdkSignAndSubmit(base64Tx, signer, suiClient);
  if (intentId) await reportSubmitted(intentId, digest);
  return digest;
}
