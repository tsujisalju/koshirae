"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Execution {
  agent: string;
  amount: number;
  risk: number;
  status: "APPROVED" | "FLAGGED" | "FAILED";
}

interface AgentPerformanceProps {
  executions: Execution[];
}

function riskLabel(risk: number) {
  if (risk < 30) return { label: "Low", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" };
  if (risk < 60) return { label: "Medium", className: "border-amber-500/30 bg-amber-500/10 text-amber-400" };
  return { label: "High", className: "border-red-500/30 bg-red-500/10 text-red-400" };
}

export default function AgentPerformance({ executions }: AgentPerformanceProps) {
  const agents = [...new Set(executions.map((execution) => execution.agent))];

  const performance = agents.map((agent) => {
    const agentExecutions = executions.filter(
      (execution) => execution.agent === agent,
    );

    const totalExecutions = agentExecutions.length;
    const approved = agentExecutions.filter(
      (execution) => execution.status === "APPROVED",
    ).length;
    const approvalRate =
      totalExecutions === 0 ? 0 : Math.round((approved / totalExecutions) * 100);
    const averageRisk =
      totalExecutions === 0
        ? 0
        : Math.round(
            agentExecutions.reduce(
              (total, execution) => total + execution.risk,
              0,
            ) / totalExecutions,
          );
    const totalVolume = agentExecutions.reduce(
      (total, execution) => total + execution.amount,
      0,
    );

    return { agent, totalExecutions, approvalRate, averageRisk, totalVolume };
  });

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-xl">Agent Performance</CardTitle>
        <CardDescription>
          Performance and risk metrics by autonomous agent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead className="text-right">Executions</TableHead>
              <TableHead className="text-right">Approval Rate</TableHead>
              <TableHead className="text-right">Avg Risk</TableHead>
              <TableHead className="text-right">Volume</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {performance.map((agent) => {
              const risk = riskLabel(agent.averageRisk);
              return (
                <TableRow key={agent.agent}>
                  <TableCell className="font-medium">{agent.agent}</TableCell>
                  <TableCell className="text-right tabular-nums">{agent.totalExecutions}</TableCell>
                  <TableCell className="text-right tabular-nums">{agent.approvalRate}%</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="tabular-nums">{agent.averageRisk}</span>
                      <Badge variant="outline" className={risk.className}>{risk.label}</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{agent.totalVolume.toLocaleString()} SUI</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
