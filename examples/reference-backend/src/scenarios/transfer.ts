import { randomUUID } from "crypto";
import { submitIntent } from "../api";
import { operatorKeypair } from "../client";
import { setupAgentCap } from "./setup";
import { signSubmitAndReport } from "../sign-and-submit";

const SUI_TYPE = "0x2::sui::SUI";

export async function runTransferScenario() {
  const recipient = operatorKeypair.toSuiAddress();
  const { agentCapId, operatorCapId } = await setupAgentCap([recipient]);

  const intent = await submitIntent(agentCapId, {
    actionType: "transfer",
    coinType: SUI_TYPE,
    target: recipient,
    amount: "1000000",
    operatorCapId,
    idempotencyKey: randomUUID(),
  });
  console.log(`Intent ${intent.id} status: ${intent.status}`);

  const digest = await signSubmitAndReport(
    intent.unsignedTransaction,
    operatorKeypair,
    intent.id,
  );
  console.log(`Submitted: ${digest}`);
}
