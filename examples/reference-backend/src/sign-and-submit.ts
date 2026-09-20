import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { suiClient } from "./client";
import { reportSubmitted } from "./api";

export async function signSubmitAndReport(
  base64Tx: string,
  signer: Ed25519Keypair,
  intentId?: string,
): Promise<string> {
  const tx = Transaction.from(Buffer.from(base64Tx, "base64"));
  const result = await suiClient.core.signAndExecuteTransaction({
    transaction: tx,
    signer,
  });
  // result is a $kind discriminated union — on a FailedTransaction (e.g.
  // the tx didn't make it into a checkpoint), `Transaction` is undefined
  // and the digest lives under `FailedTransaction` instead.
  const digest = result.Transaction?.digest ?? result.FailedTransaction?.digest;
  if (!digest) {
    throw new Error("signAndExecuteTransaction returned no digest");
  }
  if (intentId) await reportSubmitted(intentId, digest);
  return digest;
}
