import { Signer } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";

// Carries the digest so callers can still report a failed on-chain execution
// (e.g. POST /intents/:id/submitted) before propagating the failure.
export class TransactionFailedError extends Error {
  constructor(
    readonly digest: string,
    readonly executionMessage: string,
  ) {
    super(`Transaction ${digest} failed on-chain: ${executionMessage}`);
    this.name = "TransactionFailedError";
  }
}

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
  if (result.FailedTransaction) {
    const { digest, status } = result.FailedTransaction;
    throw new TransactionFailedError(digest, status.error?.message ?? "unknown execution error");
  }
  const digest = result.Transaction?.digest;
  if (!digest) throw new Error("signAndExecuteTransaction returned no digest");
  // Execution returns before the node's read side catches up, so the next
  // build can pick this tx's gas coin at a stale version and be rejected
  // (or, on shared objects, stall until the node's 60s finality timeout).
  await client.core.waitForTransaction({ digest });
  return digest;
}
