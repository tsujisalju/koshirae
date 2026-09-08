"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentClient } from "@mysten/dapp-kit-react";

const PACKAGE_ID = process.env.NEXT_PUBLIC_ORONYX_PACKAGE_ID!;
const PENDING_ACTION_TYPE = `${PACKAGE_ID}::capability::PendingAction`;

export interface PendingAction {
  objectId: string;
  capId: string;
  vaultId: string;
  actionType: number;
  target: string;
  amount: string;
  riskScore: number;
  createdAtMs: number;
}

// Mirrors useSuiBalance's hook shape (lib/use-sui-balance.ts) — this app
// has no React Query, so wallet-owned-object reads are plain
// useState/useEffect + a manual refetch, called again after
// approve/reject transactions to drop resolved rows.
export function usePendingActions(address?: string) {
  const client = useCurrentClient();
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!address) {
      setPendingActions([]);
      return;
    }

    setIsLoading(true);
    try {
      const result = await client.listOwnedObjects({
        owner: address,
        type: PENDING_ACTION_TYPE,
        include: { json: true },
      });

      const parsed = result.objects
        .filter((object) => object.json != null)
        .map((object) => {
          const json = object.json as Record<string, unknown>;
          return {
            objectId: object.objectId,
            capId: String(json.cap_id),
            vaultId: String(json.vault_id),
            actionType: Number(json.action_type),
            target: String(json.target),
            amount: String(json.amount),
            riskScore: Number(json.risk_score),
            createdAtMs: Number(json.created_at_ms),
          };
        });

      setPendingActions(parsed);
    } catch (error) {
      console.error("Failed to fetch pending actions:", error);
      setPendingActions([]);
    } finally {
      setIsLoading(false);
    }
  }, [client, address]);

  useEffect(() => {
    Promise.resolve().then(() => refetch());
  }, [refetch]);

  return { pendingActions, isLoading, refetch };
}
