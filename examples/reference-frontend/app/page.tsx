"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import OronyxLogomark from "@/components/icons/oronyx-logomark";
import { useWalletConnection } from "@mysten/dapp-kit-react";
import { ConnectButton } from "./dapp-kit-client-provider";
import LandingHeader from "@/components/landing-header";

export default function Home() {
  const connection = useWalletConnection();
  return (
    <>
      <LandingHeader />
      <main>
        <div className="mx-auto grid h-full max-w-7xl place-items-center px-8 py-16 lg:px-16">
          <Card className="w-full max-w-5xl border-border/70 bg-card/70 shadow-xl">
            <CardContent className="grid gap-8 p-8 md:p-12">
              <OronyxLogomark />
              <div className="max-w-3xl">
                <h1 className="font-display text-4xl tracking-tight md:text-6xl">
                  Agentic DeFi on Your Terms
                </h1>
                <p className="mt-5 text-lg leading-8 text-muted-foreground">
                  Oronyx enables autonomous asset management on Sui with scoped,
                  policy-enforced agent wallets and a comprehensive audit trail.
                </p>
              </div>

              {connection.status == "connected" ? (
                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/agents"
                    className={cn(buttonVariants({ size: "lg" }), "rounded-lg")}
                  >
                    Manage Agents
                    <ArrowRight className="size-4" />
                  </Link>
                  <Link
                    href="/dashboard"
                    className={cn(
                      buttonVariants({ variant: "outline", size: "lg" }),
                      "rounded-lg",
                    )}
                  >
                    Open Dashboard
                  </Link>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <ConnectButton>
                    <span>Get Started</span>
                  </ConnectButton>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="w-full max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 px-8 py-16 text-center lg:text-left">
          <div className="flex flex-col gap-4">
            <small className="text-lg font-bold">THE PROBLEM</small>
            <h1 className="text-4xl lg:text-5xl font-display">
              AI agents can move money. But should they have unlimited
              authority?
            </h1>
            <p className="text-lg text-muted-foreground">
              AI agents are increasingly trusted to act autonomously with real
              money, making trades, rebalancing portfolios and yield farming on
              your behalf. But almost every &quot;agentic finance&quot; demo
              today relies on the same weak guarantee: a system prompt that
              tells the agent what it&apos;s{" "}
              <span className="italic">supposed</span> to do.
            </p>
            <p className="text-lg text-muted-foreground">
              If the agent misbehaves, prompt-injected, or the backend is
              compromised, there&apos;s nothing structurally stopping it from
              moving funds outside the user&apos;s intent.
            </p>
          </div>
        </div>
        <div className="w-full max-w-5xl mx-auto grid order grid-cols-1 lg:grid-cols-2 px-8 py-16 text-center lg:text-left">
          <div className="order-last lg:order-1"></div>
          <div className="flex flex-col gap-4 order-2">
            <small className="text-lg font-bold">THE SOLUTION</small>
            <h1 className="text-4xl lg:text-5xl font-display">
              The AI provides the intelligence. Move controls the authority.
            </h1>
            <p className="text-lg text-muted-foreground">
              Oronyx solves this by moving policy enforcement on-chain. When a
              user sets up an agent, they describe their rules in plain language
              — spending limits, which actions are allowed, which targets are
              whitelisted, how risk-averse the agent should be.
            </p>

            <p className="text-lg text-muted-foreground">
              This gets compiled into a Move capability object on Sui that
              structurally gates every action the agent can take. The
              agent&apos;s backend never holds a blank check — it holds a
              scoped, revocable, on-chain-enforced permission slip.
            </p>
          </div>
        </div>
        <div className="w-full max-w-5xl mx-auto flex flex-col justify-center px-8 py-16 text-center">
          <div className="flex flex-col gap-4 order-2">
            <small className="text-lg font-bold">THE FLOW</small>
            <h1 className="text-4xl lg:text-5xl font-display">
              Here&apos;s how it works.
            </h1>
            {/* TODO: Oronyx architecture flow using React Flow */}
          </div>
        </div>
      </main>
    </>
  );
}
