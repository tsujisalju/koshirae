"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpDown,
  BotOff,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Agent, agentFromDetail, agentFromSummary } from "@/lib/agents";
import { AgentSummary, getAgent, listAgents } from "@/lib/agent-service";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import AgentCard from "./agent-card";
import { Spinner } from "@/components/ui/spinner";

type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE";

type SortOption =
  | "default"
  | "name-asc"
  | "name-desc"
  | "risk-high"
  | "risk-low"
  | "balance-high"
  | "active-first";

function getVaultBalance(balance: string) {
  const parsed = Number.parseFloat(balance);

  return Number.isFinite(parsed) ? parsed : 0;
}

function AgentsListSkeleton() {
  return (
    <div className="mt-10 flex flex-col items-center gap-3 text-muted-foreground">
      <Spinner />
      <p className="text-sm">Loading agents…</p>
    </div>
  );
}

function AgentsList({
  agents,
  hasFilters,
  onClearFilters,
}: {
  agents: Agent[];
  hasFilters: boolean;
  onClearFilters: () => void;
}) {
  if (agents.length > 0) {
    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    );
  }

  if (hasFilters) {
    return (
      <Empty className="mt-6 border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Search />
          </EmptyMedia>

          <EmptyTitle>No matching agents</EmptyTitle>

          <EmptyDescription>
            No agents match your current search or filters. Try adjusting your
            criteria.
          </EmptyDescription>

          <EmptyContent className="flex flex-row justify-center gap-2">
            <Button variant="outline" onClick={onClearFilters}>
              <X className="size-4" />
              Clear Filters
            </Button>
          </EmptyContent>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Empty className="mt-10 border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BotOff />
        </EmptyMedia>

        <EmptyTitle>No Agents Yet</EmptyTitle>

        <EmptyDescription>
          You haven&apos;t created any agents yet. Start automating your
          finances by creating your first agent.
        </EmptyDescription>

        <EmptyContent className="flex flex-row justify-center gap-2">
          <Link
            href="/agents/new"
            className={cn(buttonVariants({ size: "lg" }), "rounded-lg")}
          >
            <Plus className="size-4" />
            Create Agent
          </Link>
        </EmptyContent>
      </EmptyHeader>
    </Empty>
  );
}

export default function AgentsPage() {
  const account = useCurrentAccount();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!account) {
      Promise.resolve().then(() => {
        if (!cancelled) {
          setAgents([]);
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
      .then(async (summaries: AgentSummary[]) => {
        const enriched = await Promise.all(
          summaries.map((summary) =>
            getAgent(summary.cap_id)
              .then((detail) =>
                detail ? agentFromDetail(detail) : agentFromSummary(summary),
              )
              .catch(() => agentFromSummary(summary)),
          ),
        );
        if (!cancelled) {
          setAgents(enriched);
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

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [sortOption, setSortOption] = useState<SortOption>("default");

  const activeCount = agents.filter(
    (agent) => agent.status === "ACTIVE",
  ).length;

  const inactiveCount = agents.filter(
    (agent) => agent.status === "INACTIVE",
  ).length;

  const filteredAgents = useMemo(() => {
    let result = [...agents];

    // SEARCH
    const normalizedSearch = searchQuery.trim().toLowerCase();

    if (normalizedSearch) {
      result = result.filter((agent) =>
        agent.name.toLowerCase().includes(normalizedSearch),
      );
    }

    // STATUS FILTER
    if (statusFilter !== "ALL") {
      result = result.filter((agent) => agent.status === statusFilter);
    }

    // SORTING
    switch (sortOption) {
      case "name-asc":
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;

      case "name-desc":
        result.sort((a, b) => b.name.localeCompare(a.name));
        break;

      case "risk-high":
        result.sort((a, b) => b.riskThreshold - a.riskThreshold);
        break;

      case "risk-low":
        result.sort((a, b) => a.riskThreshold - b.riskThreshold);
        break;

      case "balance-high":
        result.sort(
          (a, b) =>
            getVaultBalance(b.vaultBalance) - getVaultBalance(a.vaultBalance),
        );
        break;

      case "active-first":
        result.sort((a, b) => {
          if (a.status === b.status) {
            return 0;
          }

          return a.status === "ACTIVE" ? -1 : 1;
        });
        break;

      default:
        break;
    }

    return result;
  }, [agents, searchQuery, statusFilter, sortOption]);

  const hasFilters =
    searchQuery.trim() !== "" ||
    statusFilter !== "ALL" ||
    sortOption !== "default";

  function clearFilters() {
    setSearchQuery("");
    setStatusFilter("ALL");
    setSortOption("default");
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-8 py-10">
        {/* HEADER */}

        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-display">Agents</h1>

            <p className="mt-2 text-muted-foreground">
              Manage the autonomous agents powering your assets.
            </p>
          </div>

          <Link
            href="/agents/new"
            className={cn(buttonVariants({ size: "lg" }), "rounded-lg")}
          >
            <Plus className="size-4" />
            Create Agent
          </Link>
        </div>

        <Card className="mt-6 py-0">
          <CardContent className="p-2.5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              {/* SEARCH */}

              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search agents..."
                  className="h-9 pl-9"
                />

                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>

              {/* STATUS */}

              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  if (
                    value === "ALL" ||
                    value === "ACTIVE" ||
                    value === "INACTIVE"
                  ) {
                    setStatusFilter(value);
                  }
                }}
              >
                <SelectTrigger className="h-9 w-full lg:w-44">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="size-4 text-muted-foreground" />
                    <SelectValue placeholder="Status" />
                  </div>
                </SelectTrigger>

                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="ALL">All Status</SelectItem>

                    <SelectItem value="ACTIVE">Active</SelectItem>

                    <SelectItem value="INACTIVE">Inactive</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>

              {/* SORT */}

              <Select
                value={sortOption}
                onValueChange={(value) => {
                  if (
                    value === "default" ||
                    value === "name-asc" ||
                    value === "name-desc" ||
                    value === "risk-high" ||
                    value === "risk-low" ||
                    value === "balance-high" ||
                    value === "active-first"
                  ) {
                    setSortOption(value);
                  }
                }}
              >
                <SelectTrigger className="h-9 w-full lg:w-52">
                  <div className="flex items-center gap-2">
                    <ArrowUpDown className="size-4 text-muted-foreground" />
                    <SelectValue placeholder="Sort by" />
                  </div>
                </SelectTrigger>

                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="default">Default Order</SelectItem>

                    <SelectItem value="name-asc">Name: A → Z</SelectItem>

                    <SelectItem value="name-desc">Name: Z → A</SelectItem>

                    <SelectItem value="risk-high">Highest Risk</SelectItem>

                    <SelectItem value="risk-low">Lowest Risk</SelectItem>

                    <SelectItem value="balance-high">
                      Highest Balance
                    </SelectItem>

                    <SelectItem value="active-first">Active First</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>

              {/* RESET */}

              {hasFilters && (
                <Button
                  variant="ghost"
                  onClick={clearFilters}
                  className="shrink-0"
                >
                  <X className="size-4" />
                  Reset
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* STATUS SUMMARY */}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant={statusFilter === "ALL" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-full"
            onClick={() => setStatusFilter("ALL")}
          >
            All
            <span className="ml-1 text-muted-foreground">{agents.length}</span>
          </Button>

          <Button
            variant={statusFilter === "ACTIVE" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-full"
            onClick={() => setStatusFilter("ACTIVE")}
          >
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Active
            <span className="ml-1 text-muted-foreground">{activeCount}</span>
          </Button>

          <Button
            variant={statusFilter === "INACTIVE" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-full"
            onClick={() => setStatusFilter("INACTIVE")}
          >
            <span className="size-1.5 rounded-full bg-destructive" />
            Inactive
            <span className="ml-1 text-muted-foreground">{inactiveCount}</span>
          </Button>

          <div className="ml-auto text-sm text-muted-foreground">
            Showing{" "}
            <span className="font-medium text-foreground">
              {filteredAgents.length}
            </span>{" "}
            of {agents.length}
          </div>
        </div>

        {isLoading ? (
          <AgentsListSkeleton />
        ) : loadError ? (
          <Empty className="mt-10 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BotOff />
              </EmptyMedia>

              <EmptyTitle>Failed to load agents</EmptyTitle>

              <EmptyDescription>{loadError}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <AgentsList
            agents={filteredAgents}
            hasFilters={hasFilters}
            onClearFilters={clearFilters}
          />
        )}
      </div>
    </main>
  );
}
