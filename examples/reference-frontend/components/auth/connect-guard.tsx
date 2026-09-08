"use client";

import { AUTO_CONNECT_TIMEOUT_MS } from "@/lib/dapp-kit";
import { useWalletConnection } from "@mysten/dapp-kit-react";
import { useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { Spinner } from "../ui/spinner";

function ConnectSkeleton() {
  return (
    <div className="flex flex-col items-center gap-4">
      <Spinner />
      <p className="text-sm text-muted-foreground font-medium">
        Checking connection…
      </p>
    </div>
  );
}

export default function ConnectGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { isConnecting, isReconnecting, isConnected } = useWalletConnection();

  useEffect(() => {
    if (isConnected || isConnecting || isReconnecting) return;
    const timer = setTimeout(
      () => router.replace("/"),
      AUTO_CONNECT_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [isConnected, isConnecting, isReconnecting, router]);

  if (!isConnected) {
    return <ConnectSkeleton />;
  }

  return <>{children}</>;
}
