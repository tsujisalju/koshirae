import { suiClient } from "./client";

export async function waitForAfterDigest(afterDigest: unknown): Promise<void> {
  if (typeof afterDigest !== "string") return;
  await suiClient.core.waitForTransaction({ digest: afterDigest });
}
