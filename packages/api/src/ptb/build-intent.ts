import { Transaction } from "@mysten/sui/transactions";
import { SUI_COIN_TYPE, SubmitIntentRequest } from "@koshirae/core";
import { CETUS_GLOBAL_CONFIG_ID, KOSHIRAE_PACKAGE_ID } from "../chain/client";
import { fetchPoolCoinTypes } from "../chain/reads";

const SUI_SYSTEM_STATE_ID = "0x5";
const DEFAULT_PENDING_WINDOW_MS = Number.MAX_SAFE_INTEGER; // No preference, let the cap's own ceiling decide

interface BuildParams {
  agentCapId: string;
  vaultId: string;
  request: SubmitIntentRequest;
  reportedRisk: number;
  nonce: number;
}

export async function buildIntentTransaction({
  agentCapId,
  vaultId,
  request,
  reportedRisk,
  nonce,
}: BuildParams) {
  const tx = new Transaction();
  const shared = [
    tx.object(agentCapId),
    tx.object(request.operatorCapId),
    tx.object(vaultId),
  ];
  const window = request.requestedPendingWindowMs ?? DEFAULT_PENDING_WINDOW_MS;

  switch (request.actionType) {
    case "transfer":
      tx.moveCall({
        target: `${KOSHIRAE_PACKAGE_ID}::capability::execute_transfer`,
        typeArguments: [request.coinType],
        arguments: [
          ...shared,
          tx.pure.address(request.target),
          tx.pure.u64(request.amount),
          tx.pure.u8(reportedRisk),
          tx.pure.u64(nonce),
          tx.pure.u64(window),
          tx.object.clock(),
        ],
      });
      break;
    case "mockSwap": {
      const isSuiIn = request.coinType === SUI_COIN_TYPE;
      tx.moveCall({
        target: `${KOSHIRAE_PACKAGE_ID}::capability::${isSuiIn ? "execute_mock_swap_sui_to_usdc" : "execute_mock_swap_usdc_to_sui"}`,
        arguments: [
          ...shared,
          tx.object(request.target),
          tx.pure.address(request.target),
          tx.pure.u64(request.amount),
          tx.pure.u8(reportedRisk),
          tx.pure.u64(nonce),
          tx.pure.u64(window),
          tx.object.clock(),
        ],
      });
      break;
    }
    case "stake":
      tx.moveCall({
        target: `${KOSHIRAE_PACKAGE_ID}::capability::execute_stake`,
        arguments: [
          ...shared,
          tx.object(SUI_SYSTEM_STATE_ID),
          tx.pure.address(request.target),
          tx.pure.u64(request.amount),
          tx.pure.u8(reportedRisk),
          tx.pure.u64(nonce),
          tx.pure.u64(window),
          tx.object.clock(),
        ],
      });
      break;
    case "cetusSwap":
      const { coinTypeA, coinTypeB } = await fetchPoolCoinTypes(request.target);
      const inIsA = request.coinTypeIn === coinTypeA;
      if (!inIsA && request.coinTypeIn !== coinTypeB) {
        throw new Error(
          `coinTypeIn ${request.coinTypeIn} doesn't match pool ${request.target}'s actual coin types`,
        );
      }
      tx.moveCall({
        target: `${KOSHIRAE_PACKAGE_ID}::capability::${inIsA ? "execute_cetus_swap_a_to_b" : "execute_cetus_swap_b_to_a"}`,
        typeArguments: [coinTypeA, coinTypeB],
        arguments: [
          ...shared,
          tx.object(CETUS_GLOBAL_CONFIG_ID!),
          tx.object(request.target),
          tx.pure.address(request.target),
          tx.pure.u64(request.amount),
          tx.pure.u8(reportedRisk),
          tx.pure.u64(nonce),
          tx.pure.u64(window),
          tx.object.clock(),
        ],
      });
      break;
  }
  return tx;
}
