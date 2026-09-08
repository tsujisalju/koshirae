"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentClient } from "@mysten/dapp-kit-react";

const BALANCE_CHANGED_EVENT = "oronyx:sui-balance-changed";

// Call after any transaction that moves SUI in or out of the connected
// wallet (e.g. a vault deposit/withdraw). Every mounted useSuiBalance()
// instance listens for this — including the topbar's, which has no other
// link to whichever page triggered the transaction — and refetches.
export function notifyBalanceChanged() {
  window.dispatchEvent(new Event(BALANCE_CHANGED_EVENT));
}

export function useSuiBalance(address?: string) {
  const client = useCurrentClient();
  const [balanceMist, setBalanceMist] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!address) {
      setBalanceMist(null);
      return;
    }

    setIsLoading(true);
    try {
      const result = await client.getBalance({ owner: address });
      setBalanceMist(Number(result.balance.balance));
    } catch (error) {
      console.error("Failed to fetch SUI balance:", error);
      setBalanceMist(null);
    } finally {
      setIsLoading(false);
    }
  }, [client, address]);

  useEffect(() => {
    Promise.resolve().then(() => refetch());
  }, [refetch]);

  useEffect(() => {
    window.addEventListener(BALANCE_CHANGED_EVENT, refetch);
    return () => window.removeEventListener(BALANCE_CHANGED_EVENT, refetch);
  }, [refetch]);

  return { balanceMist, isLoading, refetch };
}
