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

// Observed shapes (ExecuteTransaction, testnet), both @protobuf-ts RpcErrors
// with code "INVALID_ARGUMENT" — the outer wrapper text varies with how many
// validators had already voted by the time our tx landed:
//   "Transaction processing aborted (retriable with another submission).
//    Non-retriable errors: [Transaction needs to be rebuilt because object
//    0x.. version 0x.. is unavailable for consumption, current version: ..]"
// or, once enough validators (>1/3 stake) had already locked the newer
// version, the *same* condition gets a "non-retriable" outer label instead:
//   "Transaction is rejected as invalid by more than 1/3 of validators by
//    stake (non-retriable). Non-retriable errors: [Transaction needs to be
//    rebuilt because object 0x.. version 0x.. is unavailable for
//    consumption, current version: ..]"
// "(non-retriable)" there means resubmitting the *same signed bytes* is
// futile — it says nothing about whether a fresh rebuild would succeed,
// which is exactly what withVersionRaceRetry does. So don't gate on the
// outer wrapper text at all; key only on the inner cause, which is specific
// enough on its own not to false-positive on unrelated INVALID_ARGUMENT
// errors. The grpc-status-details-bin trailer carries only this same text
// (no structured ErrorInfo to key on instead).
function isRetriableVersionRace(err: unknown): boolean {
  for (let e = err, depth = 0; e && depth < 5; depth++) {
    if (e instanceof Error) {
      const code = (e as { code?: unknown }).code;
      const m = e.message;
      if (
        (code === undefined || code === "INVALID_ARGUMENT") &&
        m.includes("needs to be rebuilt") &&
        m.includes("unavailable for consumption")
      )
        return true;
      e = (e as { cause?: unknown }).cause;
    } else break;
  }
  return false;
}
