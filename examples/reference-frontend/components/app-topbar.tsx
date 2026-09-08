"use client";

import dynamic from "next/dynamic";
import { useCurrentAccount } from "@mysten/dapp-kit-react";

import { Button } from "@/components/ui/button";
import { useSuiBalance } from "@/lib/use-sui-balance";
import { formatMist } from "@/lib/agents";
import { Wallet } from "lucide-react";

const ConnectButton = dynamic(
  () =>
    import("@/app/dapp-kit-client-provider").then((mod) => mod.ConnectButton),
  {
    ssr: false,
    loading: () => <Button disabled>Loading...</Button>,
  },
);

export default function AppTopbar() {
  const account = useCurrentAccount();
  const { balanceMist } = useSuiBalance(account?.address);

  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-end gap-3 border-b border-border/40 px-8">
      {account && balanceMist !== null && (
        <div className="flex flex-row gap-2 px-3 py-2 border border-card rounded-lg">
          <Wallet className="size-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {formatMist(balanceMist)}
          </span>
        </div>
      )}

      <ConnectButton />
    </header>
  );
}
