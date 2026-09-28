// Two intents on the same cap get consecutive nonces (A = n+1, B = n+2), and
// both pass the API's dry-run because neither has landed yet. Executing B
// first moves the cap's last_nonce past A's, so A then aborts on-chain with
// EStaleNonce. Confirms signAndSubmit throws TransactionFailedError and that
// reporting the failed digest marks the intent "failed".
//
// Each intent uses its own OperatorCap (owned inputs are versioned on use, so
// sharing one would make the second tx fail for an unrelated reason) and its
// own gas coin, chosen through buildOptions.gasPayment. Clients can't swap
// gas after the API builds a tx: any change alters the digest it recorded.

import { randomUUID } from "crypto";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";
import { signAndSubmit, TransactionFailedError, withVersionRaceRetry } from "@koshirae/sdk";
import { mintOperatorCap, reportSubmitted, submitIntent } from "../api";
import { operatorKeypair, ownerKeypair, suiClient } from "../client";
import { extractCreatedObjectId } from "../extract-created-id";
import { expectStatus } from "./assert";
import { setupAgentCap } from "./setup";

export async function runFailedOnChainScenario() {
  const operator = operatorKeypair.toSuiAddress();
  const { agentCapId, operatorCapId, lastDigest } = await setupAgentCap([operator]);

  const mintDigest = await withVersionRaceRetry(
    () => mintOperatorCap(agentCapId, operator, lastDigest),
    (b64) => signAndSubmit(b64, ownerKeypair, suiClient),
  );
  const operatorCapBId = await extractCreatedObjectId(mintDigest, "::operator_cap::OperatorCap");
  if (!operatorCapBId) throw new Error("Second OperatorCap mint failed");

  // A second operator gas coin, so A and B don't share gas.
  const splitTx = new Transaction();
  splitTx.setSender(operator);
  const [extra] = splitTx.splitCoins(splitTx.gas, [splitTx.pure.u64(300_000_000)]);
  splitTx.transferObjects([extra], splitTx.pure.address(operator));
  const splitDigest = await signAndSubmit(
    Buffer.from(await splitTx.build({ client: suiClient })).toString("base64"),
    operatorKeypair,
    suiClient,
  );
  await suiClient.core.waitForTransaction({ digest: splitDigest });

  const { objects: coins } = await suiClient.core.listCoins({
    owner: operator,
    coinType: SUI_TYPE_ARG,
  });
  const gasCoins = coins.filter((c) => BigInt(c.balance) >= 100_000_000n);
  if (gasCoins.length < 2) throw new Error("Need two operator gas coins with >= 0.1 SUI");
  const gasRef = (c: (typeof gasCoins)[number]) => ({
    gasPayment: [{ objectId: c.objectId, version: c.version, digest: c.digest }],
  });

  const request = (capId: string) => ({
    actionType: "transfer" as const,
    coinType: SUI_TYPE_ARG,
    target: operator,
    amount: "1000000",
    operatorCapId: capId,
    idempotencyKey: randomUUID(),
  });
  const intentA = await submitIntent(
    agentCapId,
    request(operatorCapId),
    splitDigest,
    gasRef(gasCoins[0]),
  );
  const intentB = await submitIntent(
    agentCapId,
    request(operatorCapBId),
    splitDigest,
    gasRef(gasCoins[1]),
  );
  if (intentB.nonce <= intentA.nonce)
    throw new Error(`Expected B's nonce above A's, got A=${intentA.nonce} B=${intentB.nonce}`);

  // Out of order on purpose: B (higher nonce) lands first.
  const digestB = await signAndSubmit(intentB.unsignedTransaction, operatorKeypair, suiClient);
  expectStatus(await reportSubmitted(intentB.id, digestB), "executed", "intent B");

  try {
    await signAndSubmit(intentA.unsignedTransaction, operatorKeypair, suiClient);
    throw new Error("UNEXPECTED: intent A succeeded despite a stale nonce");
  } catch (err) {
    if (!(err instanceof TransactionFailedError)) throw err;
    console.log(`Expected on-chain failure: ${err.message}`);
    expectStatus(await reportSubmitted(intentA.id, err.digest), "failed", "intent A");
  }
}
