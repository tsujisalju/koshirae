import { suiClient } from "./client";

export async function extractCreatedObjectId(
  digest: string,
  typePrefix: string,
): Promise<string | undefined> {
  // getTransaction can race the RPC node's own indexing right after a
  // fresh submit; waitForTransaction polls until it's actually available.
  const result = await suiClient.core.waitForTransaction({
    digest,
    include: { effects: true, objectTypes: true },
  });
  const tx = result.Transaction ?? result.FailedTransaction;
  const objectTypes = tx?.objectTypes ?? {};
  const created = (tx?.effects?.changedObjects ?? []).find(
    (c) =>
      c.idOperation === "Created" &&
      objectTypes[c.objectId]?.startsWith(typePrefix),
  );
  return created?.objectId;
}
