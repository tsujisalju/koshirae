import { SUI_COIN_TYPE } from "@koshirae/core";
import { getVault, listIntents, submitIntent } from "../api";
import { operatorKeypair, ownerKeypair } from "../client";
import { setupAgentCap } from "./setup";
import { randomUUID } from "crypto";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
  console.log(`ok: ${message}`);
}

export async function runReadEndpointsScenario() {
  const recipient = operatorKeypair.toSuiAddress();
  const { agentCapId, vaultId, operatorCapId, lastDigest } = await setupAgentCap([recipient]);

  const vault = await getVault(vaultId);
  check(vault.id === vaultId, "vault read returns the requested vault");
  check(vault.owner === ownerKeypair.toSuiAddress(), "vault owner is the owner address");
  check(SUI_COIN_TYPE in vault.limits, "vault carries its SUI limits");

  const created: string[] = [];
  for (let i = 0; i < 3; i++) {
    const intent = await submitIntent(
      agentCapId,
      {
        actionType: "transfer",
        coinType: SUI_COIN_TYPE,
        target: recipient,
        amount: "1000000",
        operatorCapId,
        idempotencyKey: randomUUID(),
      },
      lastDigest,
    );
    created.push(intent.id);
  }
  const newestFirst = [...created].reverse();

  const first = await listIntents(agentCapId, { limit: 2 });
  check(
    first.items.length === 2 && first.nextCursor !== null,
    "first page has 2 items and a cursor",
  );
  const second = await listIntents(agentCapId, { limit: 2, cursor: first.nextCursor! });
  check(
    second.items.length === 1 && second.nextCursor === null,
    "second page has 1 item and no cursor",
  );
  const listed = [...first.items, ...second.items].map((i) => i.id);
  check(listed.join() === newestFirst.join(), "pages cover all three intents, newest first");

  check(
    (await listIntents(agentCapId, { status: "ready" })).items.length === 3,
    "status = ready returns all three",
  );
  check(
    (await listIntents(agentCapId, { status: "executed" })).items.length === 0,
    "status = executed returns none",
  );
}
