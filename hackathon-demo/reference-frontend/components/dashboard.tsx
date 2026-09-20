"use client";

import { useEffect, useMemo, useState } from "react";
import { BotOff } from "lucide-react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";

import StatCard from "./stat-card";
import ExecutionTable from "./execution-table";
import ExecutionChart from "./execution-chart";
import RiskChart from "./risk-chart";
import AgentPerformance from "./agent-performance";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./ui/empty";
import { Spinner } from "./ui/spinner";
import {
  ActivityRecord,
  AgentDetail,
  getActivity,
  getAgent,
  listAgents,
} from "@/lib/agent-service";

type ExecutionStatus = "APPROVED" | "FLAGGED" | "FAILED";
type ExecutionAction = "SWAP" | "STAKE" | "TRANSFER";

type Execution = {
  id: string;
  capId: string;
  agent: string;
  action: ExecutionAction;
  amount: number;
  risk: number;
  status: ExecutionStatus;
  time: string;
};

type Period = "24H" | "7D" | "30D" | "ALL";

const PERIOD_WINDOW_MS: Record<Period, number | null> = {
  "24H": 24 * 60 * 60 * 1000,
  "7D": 7 * 24 * 60 * 60 * 1000,
  "30D": 30 * 24 * 60 * 60 * 1000,
  ALL: null,
};

const ALL_AGENTS = "All Agents";

function actionTypeToAction(actionType: number): ExecutionAction {
  if (actionType === 2) return "STAKE";
  if (actionType === 0) return "TRANSFER";
  return "SWAP"; // 1 = MOCK_SWAP, 3 = CETUS_SWAP
}

// e.g. "14:00" — same shape 24H always used, so ExecutionChart's grouping
// keeps working unchanged for the default view.
function hourBucket(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  return `${date.getHours().toString().padStart(2, "0")}:00`;
}

// e.g. "Sep 3" — for 7D/30D/ALL, where bucketing by hour-of-day alone
// would collapse different days' executions into the same bar.
function dateBucket(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function Dashboard() {
  const account = useCurrentAccount();

  const [activityRecords, setActivityRecords] = useState<ActivityRecord[]>([]);
  const [agentDetails, setAgentDetails] = useState<Record<string, AgentDetail>>(
    {},
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!account) {
      Promise.resolve().then(() => {
        if (!cancelled) {
          setActivityRecords([]);
          setAgentDetails({});
          setIsLoading(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }

    Promise.resolve().then(() => {
      if (!cancelled) {
        setIsLoading(true);
        setLoadError(null);
      }
    });

    listAgents(account.address)
      .then(async (summaries) => {
        const details = await Promise.all(
          summaries.map((summary) =>
            getAgent(summary.cap_id).catch(() => null),
          ),
        );

        const detailMap: Record<string, AgentDetail> = {};
        details.forEach((detail) => {
          if (detail) {
            detailMap[detail.cap_id] = detail;
          }
        });

        const activity = await getActivity(account.address);

        if (!cancelled) {
          setAgentDetails(detailMap);
          setActivityRecords(activity);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [account]);

  function agentName(capId: string): string {
    return (
      agentDetails[capId]?.name ??
      `Agent ${capId.slice(0, 6)}…${capId.slice(-4)}`
    );
  }

  // --------------------------------
  // FILTERS
  // --------------------------------

  const [selectedAgentId, setSelectedAgentId] = useState(ALL_AGENTS);
  const [selectedPeriod, setSelectedPeriod] = useState<Period>("24H");

  const agentOptions = useMemo(
    () => [
      { id: ALL_AGENTS, name: ALL_AGENTS },
      ...Object.values(agentDetails).map((detail) => ({
        id: detail.cap_id,
        name: agentName(detail.cap_id),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentDetails],
  );

  // --------------------------------
  // EXECUTIONS
  // --------------------------------

  // Date.now() must not be called during render (React purity rule) — the
  // cutoff is recomputed in an effect whenever the selected period changes
  // instead of inline inside the executions useMemo below.
  const [cutoff, setCutoff] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const windowMs = PERIOD_WINDOW_MS[selectedPeriod];

    Promise.resolve().then(() => {
      if (!cancelled) {
        setCutoff(windowMs === null ? null : Date.now() - windowMs);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedPeriod]);

  const executions: Execution[] = useMemo(() => {
    const bucket = selectedPeriod === "24H" ? hourBucket : dateBucket;

    return activityRecords
      .filter(
        (record) =>
          record.decision === "act" || record.decision === "act_failed",
      )
      .filter(
        (record) =>
          cutoff === null || new Date(record.created_at).getTime() >= cutoff,
      )
      .filter(
        (record) =>
          selectedAgentId === ALL_AGENTS || record.cap_id === selectedAgentId,
      )
      .map((record): Execution => {
        const threshold = agentDetails[record.cap_id]?.risk_threshold ?? null;
        const risk = record.risk_score ?? 0;

        let status: ExecutionStatus;
        if (record.decision === "act_failed") {
          status = "FAILED";
        } else {
          status =
            threshold != null && risk > threshold ? "FLAGGED" : "APPROVED";
        }

        return {
          id: String(record.id),
          capId: record.cap_id,
          agent: agentName(record.cap_id),
          action: actionTypeToAction(record.action_type),
          amount: record.amount_mist
            ? Number(record.amount_mist) / 1_000_000_000
            : 0,
          risk,
          status,
          time: bucket(record.created_at),
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityRecords, agentDetails, selectedAgentId, selectedPeriod, cutoff]);

  // --------------------------------
  // ANALYTICS
  // --------------------------------

  const totalExecutions = executions.length;

  const approvedExecutions = executions.filter(
    (execution) => execution.status === "APPROVED",
  ).length;

  const flaggedExecutions = executions.filter(
    (execution) => execution.status === "FLAGGED",
  ).length;

  const approvalRate =
    totalExecutions === 0
      ? 0
      : Math.round((approvedExecutions / totalExecutions) * 100);

  const averageRisk =
    totalExecutions === 0
      ? 0
      : Math.round(
          executions.reduce((total, execution) => total + execution.risk, 0) /
            totalExecutions,
        );

  const riskBand =
    averageRisk < 30 ? "Low" : averageRisk < 60 ? "Medium" : "High";

  const activeAgentCount = Object.values(agentDetails).filter(
    (detail) => detail.active,
  ).length;

  // --------------------------------
  // DASHBOARD
  // --------------------------------

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-display">Dashboard</h1>
            <p className="mt-2 text-zinc-400">
              Autonomous agent control center
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="mb-2 text-xs font-medium text-zinc-400">Period</p>
              <div className="flex rounded-xl border border-border/70 bg-card p-1">
                {(["24H", "7D", "30D", "ALL"] as const).map((period) => (
                  <button
                    key={period}
                    onClick={() => setSelectedPeriod(period)}
                    className={
                      period === selectedPeriod
                        ? "rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                        : "rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-white"
                    }
                  >
                    {period}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-w-48">
              <p className="mb-2 text-xs font-medium text-zinc-400">Agent</p>
              <Select
                value={selectedAgentId}
                onValueChange={(value) => {
                  if (typeof value === "string") setSelectedAgentId(value);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {agentOptions.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="mt-16 flex flex-col items-center gap-3 text-muted-foreground">
            <Spinner />
            <p className="text-sm">Loading dashboard…</p>
          </div>
        ) : loadError ? (
          <Empty className="mt-16 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BotOff />
              </EmptyMedia>
              <EmptyTitle>Failed to load dashboard data</EmptyTitle>
              <EmptyDescription>{loadError}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                title="Active Agents"
                value={selectedAgentId === ALL_AGENTS ? activeAgentCount : 1}
                description={
                  selectedAgentId === ALL_AGENTS
                    ? `${activeAgentCount} agents reporting activity`
                    : "Filtered agent"
                }
              />
              <StatCard
                title="Executions"
                value={totalExecutions}
                description={`${approvedExecutions} approved · ${flaggedExecutions} flagged`}
              />
              <StatCard
                title="Approval Rate"
                value={`${approvalRate}%`}
                description={`${approvedExecutions} of ${totalExecutions} actions approved`}
              />
              <StatCard
                title="Average Risk"
                value={averageRisk}
                description={`${riskBand} risk profile`}
              />
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
              <ExecutionChart executions={executions} />
              <RiskChart executions={executions} />
            </div>

            <AgentPerformance executions={executions} />
            <ExecutionTable executions={executions} />
          </>
        )}
      </div>
    </main>
  );
}
