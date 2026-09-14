import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { Intent } from "@oronyx/core";
import { Transaction } from "@mysten/sui/transactions";
import { ORONYX_PACKAGE_ID } from "../chain/client";

const SUI_SYSTEM_STATE_ID = "0x5";
const SUI_STAKING_PACKAGE_ID = "0x3";

interface BuildApprovalParams {
  intent: Intent;
  agentCapId: string;
  vaultId: string;
  ownerAddress: string;
  operatorAddress?: string;
}
// approve_pending only releases funds, where they go next mirrors
// the execute_* wrapper the original intent would have used.
export function buildApprovalTransaction({
  intent,
  agentCapId,
  vaultId,
  ownerAddress,
  operatorAddress,
}: BuildApprovalParams) {
  if (!intent.pendingActionId)
    throw new Error("Intent has no recorded PendingAction id");
  const { request } = intent;
  const coinType =
    request.actionType === "stake" ? SUI_TYPE_ARG : request.coinType;

  const tx = new Transaction();
  const [released] = tx.moveCall({
    target: `${ORONYX_PACKAGE_ID}::capability::approve_pending`,
    typeArguments: [coinType],
    arguments: [
      tx.object(intent.pendingActionId),
      tx.object(agentCapId),
      tx.object(vaultId),
    ],
  });

  switch (request.actionType) {
    case "transfer":
      tx.transferObjects([released], tx.pure.address(request.target));
      break;
    case "mockSwap":
      tx.moveCall({
        target: `${ORONYX_PACKAGE_ID}::capability::deposit`,
        typeArguments: [coinType],
        arguments: [tx.object(vaultId), released],
      });
      break;
    case "cetusSwap":
      if (!operatorAddress)
        throw new Error("operatorAddress required for cetusSwap approval");
      tx.transferObjects([released], tx.pure.address(operatorAddress));
      break;
    case "stake": {
      const [staked] = tx.moveCall({
        target: `${SUI_STAKING_PACKAGE_ID}::sui_system::request_add_stake_non_entry`,
        arguments: [
          tx.object(SUI_SYSTEM_STATE_ID),
          released,
          tx.pure.address(request.target),
        ],
      });
      tx.transferObjects([staked], tx.pure.address(ownerAddress));
      break;
    }
  }

  return tx;
}
