import { Signer } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";

export async function signAndSubmit(
  base64Tx: string,
  signer: Signer,
  client: SuiGrpcClient,
): Promise<string> {
  const tx = Transaction.from(Buffer.from(base64Tx, "base64"));
  const result = await client.core.signAndExecuteTransaction({
    transaction: tx,
    signer,
  });
  const digest = result.Transaction?.digest ?? result.FailedTransaction?.digest;
  if (!digest) throw new Error("signAndExecuteTransaction returned no digest");
  return digest;
}
