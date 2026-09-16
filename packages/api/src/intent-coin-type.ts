import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { SubmitIntentRequest } from "@koshirae/core";

// Resolves the coin type an intent's policy/limit checks should key off:
// - stake is always SUI, has no coinType field at all
// - cetusSwap only carries coinTypeIn (which side of the pool pair is being sold),
//   the sums resulting from the swap being the other coin type of the pool
// - transfer/mockSwap carry coinType directly
export function resolveIntentCoinType(request: SubmitIntentRequest): string {
  switch (request.actionType) {
    case "stake":
      return SUI_TYPE_ARG;
    case "cetusSwap":
      return request.coinTypeIn;
    default:
      return request.coinType;
  }
}
