import { randomUUID } from "crypto";
import { withVersionRaceRetry } from "@koshirae/sdk";
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

  const idempotencyKey = randomUUID();
  // submitIntent is idempotent on this key, so requestFreshTx below is safe
  // to call again on retry — same intent id, freshly built (current object
  // versions) unsignedTransaction each time.
  let intentId: string | undefined;

  const digest = await withVersionRaceRetry(
    async () => {
      const intent = await submitIntent(
        agentCapId,
        {
          actionType: "transfer",
          coinType: SUI_TYPE_ARG,
          target: recipient,
          amount: "1000000",
          operatorCapId,
          idempotencyKey,
        },
        lastDigest,
      );
      intentId = intent.id;
      console.log(`Intent ${intent.id} status: ${intent.status}`);
      if (!intent.unsignedTransaction)
        throw new Error(
          `Intent ${intent.id} has no transaction to sign (status: ${intent.status})`,
        );
      return intent as typeof intent & { unsignedTransaction: string };
    },
    (base64Tx) => signSubmitAndReport(base64Tx, operatorKeypair, intentId),
  );

  console.log(`Submitted: ${digest}`);
}
