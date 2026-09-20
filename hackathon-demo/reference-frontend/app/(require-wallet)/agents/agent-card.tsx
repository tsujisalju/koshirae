import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Agent } from "@/lib/agents";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import EditableAgentName from "@/components/editable-agent-name";

export default function AgentCard({ agent: initialAgent }: { agent: Agent }) {
  const router = useRouter();
  const [agent, setAgent] = useState(initialAgent);
  const handleOnClick = () => {
    router.push(`agents/${agent.id}`);
  };

  return (
    <Card
      key={agent.id}
      className="border-border/80 bg-card/80 hover:border-primary/70 transition-colors"
      onClick={handleOnClick}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="grid gap-1">
          <CardDescription>Autonomous Agent</CardDescription>
          <CardTitle className="text-xl">
            <EditableAgentName
              name={agent.name}
              capId={agent.capId}
              owner={agent.owner}
              onSaved={(newName) =>
                setAgent((current) => ({
                  ...current,
                  name: newName,
                  hasName: true,
                }))
              }
            />
          </CardTitle>
          {agent.hasName && agent.capId && (
  <p className="font-mono text-xs text-muted-foreground">
    {agent.capId.slice(0, 8)}…{agent.capId.slice(-6)}
  </p>
)}
        </div>

        <Badge
          variant="outline"
          className={
            agent.status === "ACTIVE"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }
        >
          {agent.status}
        </Badge>
      </CardHeader>

      <CardContent>
        <p className="text-sm text-muted-foreground">Vault Balance</p>
        <p className="mt-1 text-3xl font-semibold">{agent.vaultBalance}</p>

        <div className="mt-6 grid grid-cols-2 gap-4 border-t pt-5">
          <div>
            <p className="text-sm text-muted-foreground">Risk Threshold</p>
            <p className="mt-1 font-medium">
              {agent.riskThreshold >= 0 ? agent.riskThreshold : "—"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Per-Tx Limit</p>
            <p className="mt-1 font-medium">{agent.spendingLimit}</p>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2 border-t pt-5">
        <Link
          href={`/agents/${agent.id}`}
          className={cn(buttonVariants({ size: "default" }), "rounded-lg")}
        >
          View Agent
        </Link>
      </CardFooter>
    </Card>
  );
}
