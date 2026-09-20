import { suiClient } from "./client";

export async function extractCreatedObjectId(
  digest: string,
  typePrefix: string,
): Promise<string | undefined> {
  const result = await suiClient.core.getTransaction({
    digest,
    include: { effects: true, objectTypes: true },
  });
  const tx = result.Transaction ?? result.FailedTransaction;
  const created = (tx?.effects?.changedObjects ?? []).find(
    (c: any) =>
      c.idOperation === "Created" &&
      typeof c.objectType === "string" &&
      c.objectType.startsWith(typePrefix),
  );
  return created?.objectId;
}
