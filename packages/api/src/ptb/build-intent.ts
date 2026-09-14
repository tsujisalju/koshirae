import { Transaction } from "@mysten/sui/transactions";
import { SubmitIntentRequest } from "@oronyx/core";
import { ORONYX_PACKAGE_ID } from "../chain/client";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";

const SUI_SYSTEM_STATE_ID = "0x5";

interface BuildParams {
  agentCapId: string;
  vaultId: string;
  request: SubmitIntentRequest;
  riskScore: number;
  nonce: number;
}

export function buildIntentTransaction({
  agentCapId,
  vaultId,
  request,
  riskScore,
  nonce,
}: BuildParams) {
  const tx = new Transaction();
  const shared = [
    tx.object(agentCapId),
    tx.object(request.operatorCapId),
    tx.object(vaultId),
  ];

  switch (request.actionType) {
    case "transfer":
      tx.moveCall({
        target: `${ORONYX_PACKAGE_ID}::capability::execute_transfer`,
        typeArguments: [request.coinType],
        arguments: [
          ...shared,
          tx.pure.address(request.target),
          tx.pure.u64(request.amount),
          tx.pure.u8(riskScore),
          tx.pure.u64(nonce),
          tx.object.clock(),
        ],
      });
      break;
    case "mockSwap": {
      const isSuiIn = request.coinType === SUI_TYPE_ARG;
      tx.moveCall({
        target: `${ORONYX_PACKAGE_ID}::capability::${isSuiIn ? "execute_mock_swap_sui_to_usdc" : "execute_mock_swap_usdc_to_sui"}`,
        arguments: [
          ...shared,
          tx.object(request.target),
          tx.pure.address(request.target),
          tx.pure.u64(request.amount),
          tx.pure.u8(riskScore),
          tx.pure.u64(nonce),
          tx.object.clock(),
        ],
      });
      break;
    }
    case "stake":
      tx.moveCall({
        target: `${ORONYX_PACKAGE_ID}::capability::execute_stake`,
        arguments: [
          ...shared,
          tx.object(SUI_SYSTEM_STATE_ID),
          tx.pure.address(request.target),
          tx.pure.u64(request.amount),
          tx.pure.u8(riskScore),
          tx.pure.u64(nonce),
          tx.object.clock(),
        ],
      });
      break;
    case "cetusSwap":
      tx.moveCall({
        target: `${ORONYX_PACKAGE_ID}::capability::execute_cetus_swap_and_transfer_to_operator`,
        typeArguments: [request.coinType],
        arguments: [
          ...shared,
          tx.pure.address(request.target),
          tx.pure.u64(request.amount),
          tx.pure.u8(riskScore),
          tx.pure.u64(nonce),
          tx.object.clock(),
        ],
      });
      break;
  }
  return tx;
}
