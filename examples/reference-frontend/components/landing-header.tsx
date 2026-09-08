"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";

import OronyxLogomark from "./icons/oronyx-logomark";
import { Button, buttonVariants } from "./ui/button";
import { useWalletConnection } from "@mysten/dapp-kit-react";
import { cn } from "@/lib/utils";
import { LogIn } from "lucide-react";

const ConnectButton = dynamic(
  () =>
    import("@/app/dapp-kit-client-provider").then((mod) => mod.ConnectButton),
  {
    ssr: false,
    loading: () => <Button disabled>Loading...</Button>,
  },
);

export default function LandingHeader() {
  const connection = useWalletConnection();

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-lg">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-8 py-4">
        <Link href="/">
          <OronyxLogomark />
        </Link>
        <div className="flex flex-row gap-4 items-center">
          {connection.isConnected && (
            <Link
              href="/agents"
              className={cn(
                buttonVariants({ variant: "ghost", size: "lg" }),
                "rounded-lg",
              )}
            >
              <LogIn />
              Go to Agents
            </Link>
          )}
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
