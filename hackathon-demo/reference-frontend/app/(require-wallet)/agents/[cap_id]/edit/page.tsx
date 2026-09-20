"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Lock, Plus, Save, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { isValidSuiAddress } from "@mysten/sui/utils";

import { saveAgentPolicy } from "@/lib/transactions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { AgentDetail, getAgent } from "@/lib/agent-service";
import {
  ACTION_LABELS,
  agentFromDetail,
  DURATION_MS,
  EXPIRY_OPTIONS,
  MIST_PER_SUI,
  PERIOD_OPTIONS,
} from "@/lib/agents";

// Finds the PERIOD_OPTIONS/EXPIRY_OPTIONS entry whose DURATION_MS value
// matches an on-chain ms value, falling back to the closest option so a cap
// created with a non-standard duration still seeds a valid Select value.
function closestDurationOption(options: string[], ms: number): string {
  const exact = options.find((option) => DURATION_MS[option] === ms);
  if (exact) return exact;

  return options.reduce((closest, option) =>
    Math.abs(DURATION_MS[option] - ms) < Math.abs(DURATION_MS[closest] - ms)
      ? option
      : closest,
  );
}

function EditSkeleton() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-8 py-10">
        <Button variant="ghost" className="mb-6 -ml-3 rounded-lg">
          <ArrowLeft className="size-4" />
          Back to Agent
        </Button>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Agent Policy</p>
            <h1 className="mt-1 text-3xl font-semibold">Edit Policy</h1>
            <p className="mt-2 text-muted-foreground">
              Update the limits and permissions that control{" "}
              <span className="font-skeleton">Agent 0x1234</span>
            </p>
          </div>
          <Badge
            variant="outline"
            className={"border-gray-500/30 bg-gray-500/10 text-gray-400"}
          >
            LOADING
          </Badge>
        </div>
        <Card className="mt-10">
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-5 text-muted-foreground" />
              <div>
                <CardTitle>Policy Configuration</CardTitle>
                <CardDescription>
                  Changes are submitted directly to the AgentCap on-chain, in a
                  single sponsored transaction.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-2">
              <Label htmlFor="spending-limit">Per-Tx Spending Limit</Label>
              <div className="relative">
                <Input
                  id="spending-limit"
                  type="number"
                  className="pr-14"
                  disabled
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  SUI
                </span>
              </div>
            </div>

            {/* PERIOD LIMIT */}

            <div className="grid gap-2">
              <Label htmlFor="period-limit">Period Spending Limit</Label>

              <div className="relative">
                <Input
                  id="period-limit"
                  type="number"
                  className="pr-14"
                  disabled
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  SUI
                </span>
              </div>
            </div>

            {/* PERIOD LENGTH */}

            <div className="grid gap-2">
              <Label>Period Length</Label>
              <Select disabled>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {PERIOD_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The spending limit resets after this period.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="risk-threshold">Risk Threshold</Label>
              <Input id="risk-threshold" type="number" disabled />

              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Actions above this score may be flagged for review.
                </p>

                <span className="text-sm font-medium">0 / 100</span>
              </div>
            </div>

            {/* EXPIRY */}

            <div className="grid gap-2">
              <Label>Policy Expiry</Label>
              <Select disabled>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select expiry" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {EXPIRY_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Resets to now + the selected duration when saved.
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Allowed Actions</Label>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="opacity-60">
                  LOADING
                </Badge>
              </div>

              <p className="text-xs text-muted-foreground">
                Fixed at creation — the contract has no way to change allowed
                actions after the agent is created.
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Allowed Targets</Label>
              <div className="flex flex-wrap gap-2">
                <Badge variant={"outline"} className="gap-1">
                  LOADING
                </Badge>
              </div>
              <div className="flex gap-2">
                <Input placeholder="0x..." disabled />

                <Button
                  type="button"
                  variant="outline"
                  className="rounded-lg"
                  disabled
                >
                  <Plus className="size-4" />
                  Add
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Addresses marked with a lock are required by an enabled action
                and can&apos;t be removed here.
              </p>
            </div>
          </CardContent>

          <CardFooter className="justify-end gap-3 border-t pt-5">
            <Button variant="outline" className="rounded-lg" disabled>
              Cancel
            </Button>

            <Button className="rounded-lg" disabled>
              <Save className="size-4" />
              Save Policy
            </Button>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}

export default function EditAgentPolicyPage() {
  const params = useParams();
  const router = useRouter();
  const account = useCurrentAccount();

  const capId = params.cap_id as string;

  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [spendingLimit, setSpendingLimit] = useState("");
  const [periodLimit, setPeriodLimit] = useState("");
  const [periodLength, setPeriodLength] = useState(PERIOD_OPTIONS[3]);
  const [riskThreshold, setRiskThreshold] = useState("");
  const [expiry, setExpiry] = useState(EXPIRY_OPTIONS[2]);
  const [targets, setTargets] = useState<string[]>([]);
  const [newTarget, setNewTarget] = useState("");

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const result = await getAgent(capId);
        if (cancelled) return;

        if (!result) {
          setNotFound(true);
          return;
        }

        setDetail(result);
        setSpendingLimit(String(result.spending_limit_per_tx / MIST_PER_SUI));
        setPeriodLimit(String(result.spending_limit_period / MIST_PER_SUI));
        setPeriodLength(
          closestDurationOption(PERIOD_OPTIONS, result.period_length_ms),
        );
        setRiskThreshold(String(result.risk_threshold));
        setExpiry(
          closestDurationOption(
            EXPIRY_OPTIONS,
            Math.max(result.expiry_ms - Date.now(), 0),
          ),
        );
        setTargets(result.allowed_targets);
      } catch (error) {
        console.error("Failed to load agent:", error);
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [capId]);

  if (isLoading) {
    return <EditSkeleton />;
  }

  if (notFound || !detail) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto max-w-3xl px-8 py-10">
          <Card>
            <CardHeader>
              <CardTitle>Agent not found</CardTitle>

              <CardDescription>
                The requested agent does not exist.
              </CardDescription>
            </CardHeader>

            <CardFooter>
              <Button onClick={() => router.push("/agents")}>
                Back to Agents
              </Button>
            </CardFooter>
          </Card>
        </div>
      </main>
    );
  }

  const isOwner = account?.address === detail.owner;
  const agent = agentFromDetail(detail);

  const numericRisk = Number(riskThreshold);
  const numericSpendingLimit = Number(spendingLimit);
  const numericPeriodLimit = Number(periodLimit);

  const riskInvalid =
    !Number.isFinite(numericRisk) || numericRisk < 0 || numericRisk > 100;

  const spendingInvalid =
    !Number.isFinite(numericSpendingLimit) || numericSpendingLimit <= 0;

  const periodLimitInvalid =
    !Number.isFinite(numericPeriodLimit) || numericPeriodLimit <= 0;

  const formInvalid =
    riskInvalid || spendingInvalid || periodLimitInvalid || !isOwner;

  // Raw on-chain-unit values the form currently represents, for diffing
  // against `detail`'s original values.
  const nextSpendingLimitPerTx = Math.round(
    numericSpendingLimit * MIST_PER_SUI,
  );
  const nextSpendingLimitPeriod = Math.round(numericPeriodLimit * MIST_PER_SUI);
  const nextPeriodLengthMs = DURATION_MS[periodLength];
  const nextRiskThreshold = Math.round(numericRisk);

  function handleAddTarget() {
    if (!isOwner) return;

    const candidate = newTarget.trim();
    if (!isValidSuiAddress(candidate)) {
      toast.error("Invalid address", {
        description: "Enter a valid Sui address (0x...).",
      });
      return;
    }

    const normalized = candidate.toLowerCase();
    if (targets.some((target) => target.toLowerCase() === normalized)) {
      toast.error("Address already allowed");
      return;
    }

    setTargets((current) => [...current, candidate]);
    setNewTarget("");
  }

  function handleRemoveTarget(target: string) {
    if (!isOwner) return;
    setTargets((current) => current.filter((item) => item !== target));
  }

  async function handleSavePolicy() {
    if (!detail || !account || formInvalid) return;

    const nextExpiryMs = Date.now() + DURATION_MS[expiry];

    setIsSaving(true);

    try {
      const result = await saveAgentPolicy({
        sender: account.address,
        capId,
        current: detail,
        next: {
          spendingLimitPerTxMist: nextSpendingLimitPerTx,
          spendingLimitPeriodMist: nextSpendingLimitPeriod,
          periodLengthMs: nextPeriodLengthMs,
          riskThreshold: nextRiskThreshold,
          expiryAbsoluteMs: nextExpiryMs,
          targets,
        },
      });

      if (result === null) {
        toast.info("No changes to save");
        return;
      }

      if (result.$kind !== "Transaction") {
        throw new Error("Sponsored transaction failed");
      }

      toast.success("Policy updated", {
        description: `${agent.name}'s policy configuration has been saved.`,
      });

      router.push(`/agents/${capId}`);
    } catch (error) {
      console.error(error);
      toast.error("Failed to update policy", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-8 py-10">
        {/* BACK */}

        <Button
          variant="ghost"
          className="mb-6 -ml-3 rounded-lg"
          onClick={() => router.push(`/agents/${capId}`)}
        >
          <ArrowLeft className="size-4" />
          Back to Agent
        </Button>

        {/* HEADER */}

        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Agent Policy</p>

            <h1 className="mt-1 text-3xl font-semibold">Edit Policy</h1>

            <p className="mt-2 text-muted-foreground">
              Update the limits and permissions that control {agent.name}.
            </p>
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
        </div>

        {!isOwner && (
          <p className="mt-4 text-sm text-destructive">
            Only the agent&apos;s owner can edit its policy. Connect the owning
            wallet to make changes.
          </p>
        )}

        {/* POLICY FORM */}

        <Card className="mt-10">
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-5 text-muted-foreground" />

              <div>
                <CardTitle>Policy Configuration</CardTitle>

                <CardDescription>
                  Changes are submitted directly to the AgentCap on-chain, in a
                  single sponsored transaction.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* PER TX LIMIT */}

            <div className="grid gap-2">
              <Label htmlFor="spending-limit">Per-Tx Spending Limit</Label>

              <div className="relative">
                <Input
                  id="spending-limit"
                  type="number"
                  min="0"
                  step="0.01"
                  value={spendingLimit}
                  onChange={(event) => setSpendingLimit(event.target.value)}
                  className="pr-14"
                  disabled={!isOwner}
                />

                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  SUI
                </span>
              </div>

              {spendingInvalid && (
                <p className="text-sm text-destructive">
                  Spending limit must be greater than 0 SUI.
                </p>
              )}
            </div>

            {/* PERIOD LIMIT */}

            <div className="grid gap-2">
              <Label htmlFor="period-limit">Period Spending Limit</Label>

              <div className="relative">
                <Input
                  id="period-limit"
                  type="number"
                  min="0"
                  step="0.01"
                  value={periodLimit}
                  onChange={(event) => setPeriodLimit(event.target.value)}
                  className="pr-14"
                  disabled={!isOwner}
                />

                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  SUI
                </span>
              </div>

              {periodLimitInvalid && (
                <p className="text-sm text-destructive">
                  Period spending limit must be greater than 0 SUI.
                </p>
              )}
            </div>

            {/* PERIOD LENGTH */}

            <div className="grid gap-2">
              <Label>Period Length</Label>

              <Select
                value={periodLength}
                onValueChange={(value) => {
                  if (typeof value === "string") setPeriodLength(value);
                }}
                disabled={!isOwner}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>

                <SelectContent>
                  <SelectGroup>
                    {PERIOD_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              <p className="text-xs text-muted-foreground">
                The spending limit resets after this period.
              </p>
            </div>

            {/* RISK THRESHOLD */}

            <div className="grid gap-2">
              <Label htmlFor="risk-threshold">Risk Threshold</Label>

              <Input
                id="risk-threshold"
                type="number"
                min="0"
                max="100"
                value={riskThreshold}
                onChange={(event) => setRiskThreshold(event.target.value)}
                disabled={!isOwner}
              />

              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Actions above this score may be flagged for review.
                </p>

                <span className="text-sm font-medium">
                  {riskThreshold || "0"} / 100
                </span>
              </div>

              {riskInvalid && (
                <p className="text-sm text-destructive">
                  Risk threshold must be between 0 and 100.
                </p>
              )}
            </div>

            {/* EXPIRY */}

            <div className="grid gap-2">
              <Label>Policy Expiry</Label>

              <Select
                value={expiry}
                onValueChange={(value) => {
                  if (typeof value === "string") setExpiry(value);
                }}
                disabled={!isOwner}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select expiry" />
                </SelectTrigger>

                <SelectContent>
                  <SelectGroup>
                    {EXPIRY_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              <p className="text-xs text-muted-foreground">
                Resets to now + the selected duration when saved.
              </p>
            </div>

            {/* ALLOWED ACTIONS (read-only) */}

            <div className="grid gap-2">
              <Label>Allowed Actions</Label>

              <div className="flex flex-wrap gap-2">
                {detail.allowed_actions.map((code) => (
                  <Badge key={code} variant="secondary" className="opacity-60">
                    {ACTION_LABELS[code] ?? `ACTION_${code}`}
                  </Badge>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                Fixed at creation — the contract has no way to change allowed
                actions after the agent is created.
              </p>
            </div>

            {/* ALLOWED TARGETS */}

            <div className="grid gap-2">
              <Label>Allowed Targets</Label>

              <div className="flex flex-wrap gap-2">
                {targets.length === 0 && (
                  <span className="text-sm text-muted-foreground">
                    No targets allowed yet.
                  </span>
                )}

                {targets.map((target) => {
                  const isProtocol = detail.protocol_targets
                    .map((address) => address.toLowerCase())
                    .includes(target.toLowerCase());

                  return (
                    <Badge
                      key={target}
                      variant={isProtocol ? "outline" : "secondary"}
                      title={target}
                      className="gap-1"
                    >
                      {isProtocol && <Lock className="size-3" />}
                      {`${target.slice(0, 6)}…${target.slice(-4)}`}
                      {!isProtocol && (
                        <button
                          type="button"
                          onClick={() => handleRemoveTarget(target)}
                          disabled={!isOwner}
                          aria-label={`Remove ${target}`}
                          className="ml-1 disabled:pointer-events-none"
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </Badge>
                  );
                })}
              </div>

              <div className="flex gap-2">
                <Input
                  value={newTarget}
                  onChange={(event) => setNewTarget(event.target.value)}
                  placeholder="0x..."
                  disabled={!isOwner}
                />

                <Button
                  type="button"
                  variant="outline"
                  className="rounded-lg"
                  disabled={!isOwner || !newTarget.trim()}
                  onClick={handleAddTarget}
                >
                  <Plus className="size-4" />
                  Add
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Addresses marked with a lock are required by an enabled action
                and can&apos;t be removed here.
              </p>
            </div>
          </CardContent>

          <CardFooter className="justify-end gap-3 border-t pt-5">
            <Button
              variant="outline"
              className="rounded-lg"
              onClick={() => router.push(`/agents/${capId}`)}
            >
              Cancel
            </Button>

            <Button
              className="rounded-lg"
              disabled={formInvalid || isSaving}
              onClick={handleSavePolicy}
            >
              <Save className="size-4" />

              {isSaving ? "Saving..." : "Save Policy"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}
