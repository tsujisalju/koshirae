import { toBase64 } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";

import { dAppKit } from "./dapp-kit";

const EXECUTOR_URL = process.env.NEXT_PUBLIC_EXECUTOR_URL!;

interface SignAndExecuteSponsoredTransactionArgs {
  transaction: Transaction;
  sender: string;
  allowedMoveCallTargets?: string[];
  allowedAddresses?: string[];
}

/**
 * Builds `transaction`'s kind bytes (no sender/gas) and sends them to the
 * executor's /sponsor endpoint, which calls Enoki's gas station on our
 * behalf. Enoki's createSponsoredTransaction/executeSponsoredTransaction
 * require a PRIVATE API key (confirmed via a live 403 when this was
 * previously called directly from the browser with the public key) — that
 * key lives only in the executor's environment, never in the frontend
 * bundle. The connected wallet signs the exact sponsored bytes the executor
 * returns (dAppKit.signTransaction is passed the raw bytes string
 * precisely so it can't overwrite the sponsor's gas config), then the
 * signature is sent back to the executor's /execute-sponsored endpoint to
 * submit. This is the reference path any user-signed transaction in this
 * app should go through instead of a plain dAppKit.signAndExecuteTransaction.
 */
export async function signAndExecuteSponsoredTransaction({
  transaction,
  sender,
  allowedMoveCallTargets,
  allowedAddresses,
}: SignAndExecuteSponsoredTransactionArgs) {
  const network = "testnet" as const;
  const client = dAppKit.getClient(network);

  const transactionKindBytes = await transaction.build({
    onlyTransactionKind: true,
    client,
  });
  const transactionKindBytesBase64 = toBase64(transactionKindBytes);

  const sponsorResponse = await fetch(`${EXECUTOR_URL}/sponsor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      network,
      transactionKindBytes: transactionKindBytesBase64,
      sender,
      allowedMoveCallTargets,
      allowedAddresses,
    }),
  });
  if (!sponsorResponse.ok) {
    throw new Error(`Failed to sponsor transaction: ${await sponsorResponse.text()}`);
  }
  const sponsored: { bytes: string; digest: string } = await sponsorResponse.json();

  const { signature } = await dAppKit.signTransaction({
    transaction: sponsored.bytes,
  });

  const executeResponse = await fetch(`${EXECUTOR_URL}/execute-sponsored`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ digest: sponsored.digest, signature }),
  });
  if (!executeResponse.ok) {
    throw new Error(
      `Failed to execute sponsored transaction: ${await executeResponse.text()}`,
    );
  }
  const { digest }: { digest: string } = await executeResponse.json();

  return client.waitForTransaction({
    digest,
    include: { effects: true, objectTypes: true },
  });
}
