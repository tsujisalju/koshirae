/// Retries the whole request-build-sign-submit sequence, not just
/// resubmission of the signed bytes — the staleness lives in what api
/// already built, so resubmitting those exact bytes fails identically.
/// Only re-requesting a fresh build (against, by then, hopefully
/// caught-up state) can actually recover.
export async function withVersionRaceRetry<
  T extends { unsignedTransaction: string },
>(
  requestFreshTx: () => Promise<T>,
  signAndSubmitFn: (base64Tx: string) => Promise<string>,
  {
    maxAttempts = 4,
    baseDelayMs = 500,
  }: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { unsignedTransaction } = await requestFreshTx();
      return await signAndSubmitFn(unsignedTransaction);
    } catch (err) {
      lastError = err;
      if (!isRetriableVersionRace(err) || attempt === maxAttempts) throw err;
      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)),
      );
    }
  }
  throw lastError;
}

// Observed shape (ExecuteTransaction, testnet): a @protobuf-ts RpcError with
// code "INVALID_ARGUMENT" and message
//   "Transaction processing aborted (retriable with another submission).
//    Non-retriable errors: [Transaction needs to be rebuilt because object
//    0x.. version 0x.. is unavailable for consumption, current version: ..]"
// The grpc-status-details-bin trailer carries only that same text (no
// structured ErrorInfo), and INVALID_ARGUMENT is also used for genuinely
// bad requests, so the code alone can't discriminate — match on the code
// plus the stale-object phrases. The "Non-retriable errors" wording is
// misleading: it just lists the per-validator cause.
function isRetriableVersionRace(err: unknown): boolean {
  for (let e = err, depth = 0; e && depth < 5; depth++) {
    if (e instanceof Error) {
      const code = (e as { code?: unknown }).code;
      const m = e.message;
      if (
        (code === undefined || code === "INVALID_ARGUMENT") &&
        m.includes("retriable with another submission") &&
        (m.includes("needs to be rebuilt") ||
          m.includes("unavailable for consumption"))
      )
        return true;
      e = (e as { cause?: unknown }).cause;
    } else break;
  }
  return false;
}
