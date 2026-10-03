import { type BuildOptions, type UnsignedTransaction } from "@koshirae/core";
import { type Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { suiClient } from "../chain/client";
import { intentTransactions, type IssuedKind } from "../db/schema";
import type { Db, DbTx } from "./store";

export interface BuiltTransaction {
  bytes: Uint8Array;
  digest: string;
}

// Builds a transaction and computes the digest it will have once signed.
// The digest hashes the transaction data only, not signatures, so the API
// knows it before anyone signs. Runs outside any DB transaction on purpose:
// tx.build makes RPC calls and shouldn't hold a DB transaction open.
export async function buildForIssue(
  tx: Transaction,
  options: BuildOptions,
): Promise<BuiltTransaction> {
  if (options.gasPayment) tx.setGasPayment(options.gasPayment);
  const bytes = await tx.build({ client: suiClient });
  return { bytes, digest: TransactionDataBuilder.getDigestFromBytes(bytes) };
}

// Every transaction handed to a client must be recorded here, or its report
// to /submitted will be refused. Rebuilding identical bytes yields the same
// digest, so a conflict just means it's already recorded.
export async function recordIssued(
  exec: Db | DbTx,
  meta: { digest: string; intentId: string; agentCapId: string; kind: IssuedKind },
): Promise<void> {
  await exec.insert(intentTransactions).values(meta).onConflictDoNothing();
}

export function toUnsigned(built: BuiltTransaction): UnsignedTransaction {
  return { unsignedTransaction: toBase64(built.bytes), digest: built.digest };
}
