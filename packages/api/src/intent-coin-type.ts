import { SUI_TYPE_ARG, normalizeStructTag } from "@mysten/sui/utils";
import { SubmitIntentRequest } from "@koshirae/core";

// Resolves the coin type an intent's policy/limit checks should key off:
// - stake is always SUI, has no coinType field at all
// - cetusSwap only carries coinTypeIn (which side of the pool pair is being sold),
//   the sums resulting from the swap being the other coin type of the pool
// - transfer/mockSwap carry coinType directly
// Always normalized (full zero-padded address) — on-chain limit keys come
// back that way, so "0x2::sui::SUI" would otherwise never match.
export function resolveIntentCoinType(request: SubmitIntentRequest): string {
  switch (request.actionType) {
    case "stake":
      return normalizeStructTag(SUI_TYPE_ARG);
    case "cetusSwap":
      return normalizeStructTag(request.coinTypeIn);
    default:
      return normalizeStructTag(request.coinType);
  }
}
