import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { Intent } from "@oronyx/core";
import { Transaction } from "@mysten/sui/transactions";
import { CETUS_GLOBAL_CONFIG_ID, ORONYX_PACKAGE_ID } from "../chain/client";
import { fetchPoolCoinTypes } from "../chain/reads";

const SUI_SYSTEM_STATE_ID = "0x5";
const SUI_STAKING_PACKAGE_ID = "0x3";

interface BuildApprovalParams {
  intent: Intent;
  agentCapId: string;
  vaultId: string;
}
// approve_pending only releases funds, where they go next mirrors
// the execute_* wrapper the original intent would have used.
export async function buildApprovalTransaction({
  intent,
  agentCapId,
  vaultId,
}: BuildApprovalParams) {
  if (!intent.pendingActionId)
    throw new Error("Intent has no recorded PendingAction id");
  const { request } = intent;
  const tx = new Transaction();
  const pendingArg = tx.object(intent.pendingActionId);

  switch (request.actionType) {
    case "transfer":
      tx.moveCall({
        target: `${ORONYX_PACKAGE_ID}::capability::approve_pending_and_send`,
        typeArguments: [request.coinType],
        arguments: [
          pendingArg,
          tx.object(agentCapId),
          tx.object(vaultId),
          tx.object.clock(),
        ],
      });
      break;
    case "mockSwap":
      const isSuiIn = request.coinType === SUI_TYPE_ARG;
      tx.moveCall({
        target: `${ORONYX_PACKAGE_ID}::capability::${isSuiIn ? "approve_and_finish_mock_swap_sui_to_usdc" : "approve_and_finish_mock_swap_usdc_to_sui"}`,
        arguments: [
          pendingArg,
          tx.object(agentCapId),
          tx.object(vaultId),
          tx.object(request.target),
          tx.object.clock(),
        ],
      });
      break;
    case "cetusSwap":
      const { coinTypeA, coinTypeB } = await fetchPoolCoinTypes(request.target);
      const inIsA = request.coinTypeIn === coinTypeA;
      tx.moveCall({
        target: `${ORONYX_PACKAGE_ID}::capability::${inIsA ? "approve_and_finish_cetus_swap_a_to_b" : "approve_and_finish_cetus_swap_b_to_a"}`,
        arguments: [
          pendingArg,
          tx.object(agentCapId),
          tx.object(vaultId),
          tx.object(CETUS_GLOBAL_CONFIG_ID!),
          tx.object(request.target),
          tx.object.clock(),
        ],
      });
      break;
    case "stake": {
      tx.moveCall({
        target: `${ORONYX_PACKAGE_ID}::capability::approve_and_finish_stake`,
        arguments: [
          pendingArg,
          tx.object(agentCapId),
          tx.object(vaultId),
          tx.object(SUI_SYSTEM_STATE_ID),
          tx.object.clock(),
        ],
      });
      break;
    }
  }

  return tx;
}
