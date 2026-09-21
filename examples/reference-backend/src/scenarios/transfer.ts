import { randomUUID } from "crypto";
import { submitIntent } from "../api";
import { operatorKeypair } from "../client";
import { setupAgentCap } from "./setup";
import { signSubmitAndReport } from "../sign-and-submit";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";

export async function runTransferScenario() {
  const recipient = operatorKeypair.toSuiAddress();
  const { agentCapId, operatorCapId, lastDigest } = await setupAgentCap([
    recipient,
  ]);

  const intent = await submitIntent(
    agentCapId,
    {
      actionType: "transfer",
      coinType: SUI_TYPE_ARG,
      target: recipient,
      amount: "1000000",
      operatorCapId,
      idempotencyKey: randomUUID(),
    },
    lastDigest,
  );
  console.log(`Intent ${intent.id} status: ${intent.status}`);

  const digest = await signSubmitAndReport(
    intent.unsignedTransaction,
    operatorKeypair,
    intent.id,
  );
  console.log(`Submitted: ${digest}`);
}
