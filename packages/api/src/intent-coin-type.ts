import { SUI_COIN_TYPE, SubmitIntentRequest } from "@koshirae/core";

// Resolves the coin type an intent's policy/limit checks should key off:
// - stake is always SUI, has no coinType field at all
// - cetusSwap only carries coinTypeIn (which side of the pool pair is being sold),
//   the sums resulting from the swap being the other coin type of the pool
// - transfer/mockSwap carry coinType directly
// Requests are normalized on ingress (routes/intents.ts), so these already
// match the normalized on-chain limit keys.
export function resolveIntentCoinType(request: SubmitIntentRequest): string {
  switch (request.actionType) {
    case "stake":
      return SUI_COIN_TYPE;
    case "cetusSwap":
      return request.coinTypeIn;
    default:
      return request.coinType;
  }
}
