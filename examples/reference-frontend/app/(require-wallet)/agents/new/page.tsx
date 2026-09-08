"use client";
import {
  parsePolicy,
  saveAgentMetadata,
  ParsedAgentPolicy,
} from "@/lib/agent-service";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Lock,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { isValidSuiAddress } from "@mysten/sui/utils";

import { createAgentCap } from "@/lib/transactions";

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
import { Checkbox } from "@/components/ui/checkbox";
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
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import {
  Agent,
  ACTION_CODES,
  ACTION_LABELS,
  DurationUnit,
  durationInputToMs,
  formatDuration,
  formatExpiry,
  msToDurationInput,
} from "@/lib/agents";

const AVAILABLE_ACTIONS = ["SWAP", "STAKE", "TRANSFER"];
const CETUS_SWAP_CODE = 3;

type ConfigMode = "natural" | "advanced";

const MIST_PER_SUI = 1_000_000_000;
const MOCK_POOL_ID = process.env.NEXT_PUBLIC_ORONYX_MOCK_POOL_ID!;

export default function NewAgentPage() {
  const router = useRouter();
  const account = useCurrentAccount();

  const [agentName, setAgentName] = useState("");

  const [configMode, setConfigMode] = useState<ConfigMode>("natural");

  const [instructions, setInstructions] = useState("");

  const [isParsing, setIsParsing] = useState(false);

  const [selectedActions, setSelectedActions] = useState<string[]>([
    "SWAP",
    "STAKE",
  ]);

  const [spendingLimit, setSpendingLimit] = useState("0.50");

  const [periodLimit, setPeriodLimit] = useState("5.00");

  const [periodLengthValue, setPeriodLengthValue] = useState(24);
  const [periodLengthUnit, setPeriodLengthUnit] =
    useState<DurationUnit>("hours");

  const [riskThreshold, setRiskThreshold] = useState(60);

  const [noExpiry, setNoExpiry] = useState(false);
  const [expiryValue, setExpiryValue] = useState(30);
  const [expiryUnit, setExpiryUnit] = useState<DurationUnit>("days");

  const [cetusSwapEnabled, setCetusSwapEnabled] = useState(false);

  const [targets, setTargets] = useState<string[]>([]);
  const [newTarget, setNewTarget] = useState("");

  const [generatedPolicy, setGeneratedPolicy] =
    useState<ParsedAgentPolicy | null>(null);

  const [isCreating, setIsCreating] = useState(false);

  const [created, setCreated] = useState(false);

  const [policyGenerated, setPolicyGenerated] = useState(false);

  const numericSpendingLimit = Number(spendingLimit);

  const numericPeriodLimit = Number(periodLimit);

  const spendingInvalid =
    !Number.isFinite(numericSpendingLimit) || numericSpendingLimit <= 0;

  const periodLimitInvalid =
    !Number.isFinite(numericPeriodLimit) || numericPeriodLimit <= 0;

  const periodLengthInvalid =
    !Number.isFinite(periodLengthValue) || periodLengthValue <= 0;

  const expiryInvalid =
    !noExpiry && (!Number.isFinite(expiryValue) || expiryValue <= 0);

  const policyInvalid =
    selectedActions.length === 0 ||
    spendingInvalid ||
    periodLimitInvalid ||
    periodLengthInvalid ||
    expiryInvalid;

  const naturalLanguageInvalid = !instructions.trim() || !policyGenerated;

  const formInvalid =
    !agentName.trim() ||
    policyInvalid ||
    (configMode === "natural" && naturalLanguageInvalid);

  function toggleAction(action: string) {
    setSelectedActions((current) =>
      current.includes(action)
        ? current.filter((item) => item !== action)
        : [...current, action],
    );
  }

  function handleAddTarget() {
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
    setTargets((current) => current.filter((item) => item !== target));
  }

  async function handleGeneratePolicy() {
    if (!agentName.trim()) {
      toast.error("Agent name required");

      return;
    }

    if (!instructions.trim()) {
      toast.error("Describe the policy first");

      return;
    }

    setIsParsing(true);

    try {
      const result = await parsePolicy(instructions);

      setSpendingLimit(
        (result.spending_limit_per_tx / MIST_PER_SUI).toFixed(2),
      );
      setPeriodLimit((result.spending_limit_period / MIST_PER_SUI).toFixed(2));

      const period = msToDurationInput(result.period_length_ms);
      setPeriodLengthValue(period.value);
      setPeriodLengthUnit(period.unit);

      if (result.expiry_ms === 0) {
        setNoExpiry(true);
      } else {
        const expiryDuration = msToDurationInput(
          Math.max(0, result.expiry_ms - Date.now()),
        );
        setNoExpiry(false);
        setExpiryValue(expiryDuration.value);
        setExpiryUnit(expiryDuration.unit);
      }

      setSelectedActions(
        result.allowed_actions
          .filter((code) => code !== CETUS_SWAP_CODE)
          .map((code) => ACTION_LABELS[code] ?? `ACTION_${code}`),
      );
      setCetusSwapEnabled(result.allowed_actions.includes(CETUS_SWAP_CODE));

      setRiskThreshold(result.risk_threshold);

      const validTargets = result.allowed_targets.filter(isValidSuiAddress);
      if (validTargets.length !== result.allowed_targets.length) {
        toast.warning("Some generated targets were skipped", {
          description: "They weren't valid Sui addresses.",
        });
      }
      setTargets(validTargets);

      setGeneratedPolicy(result);
      setPolicyGenerated(true);

      toast.success("Policy generated", {
        description: "Review the generated policy before creating your agent.",
      });
    } catch (error) {
      toast.error("Failed to generate policy", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsParsing(false);
    }
  }

  async function handleCreateAgent() {
    if (formInvalid) return;

    if (!account) {
      toast.error("Connect a wallet first");
      return;
    }

    setIsCreating(true);

    try {
      const actionCodes = selectedActions
        .map((action) => ACTION_CODES[action])
        .concat(cetusSwapEnabled ? [CETUS_SWAP_CODE] : []);
      // Only "SWAP" structurally depends on a protocol object today (the
      // mock pool); "STAKE" needs no protocol_targets entry yet since
      // there's no validator-picker field in this form — a stake-capable
      // cap created here can have a validator added later via
      // add_allowed_target.
      const protocolTargets = selectedActions.includes("SWAP")
        ? [MOCK_POOL_ID]
        : [];

      const periodLengthMs = durationInputToMs(
        periodLengthValue,
        periodLengthUnit,
      );
      const expiryAbsoluteMs = noExpiry
        ? 0
        : Date.now() + durationInputToMs(expiryValue, expiryUnit);

      const result = await createAgentCap({
        sender: account.address,
        spendingLimitPerTxMist: Math.round(numericSpendingLimit * MIST_PER_SUI),
        spendingLimitPeriodMist: Math.round(numericPeriodLimit * MIST_PER_SUI),
        periodLengthMs,
        actionCodes,
        targets,
        protocolTargets,
        riskThreshold,
        expiryAbsoluteMs,
      });

      if (result.$kind !== "Transaction") {
        throw new Error("Sponsored transaction failed");
      }

      const objectTypes = result.Transaction.objectTypes ?? {};
      const createdVaultId = Object.entries(objectTypes).find(([, type]) =>
        type.endsWith("::capability::Vault"),
      )?.[0];
      const createdCapId = Object.entries(objectTypes).find(([, type]) =>
        type.endsWith("::capability::AgentCap"),
      )?.[0];

      if (!createdVaultId || !createdCapId) {
        throw new Error(
          "Could not find created Vault/AgentCap in transaction result",
        );
      }
      try {
        await saveAgentMetadata({
          capId: createdCapId,
          owner: account.address,
          name: agentName.trim(),
        });
      } catch (metadataError) {
        console.error("Failed to save agent metadata:", metadataError);

        toast.warning(
          "Agent created, but its display name could not be saved",
          {
            description:
              "The on-chain agent was created successfully. You can still access it from the Agents page.",
          },
        );
      }

      const newAgent: Agent = {
        id: createdCapId,
        capId: createdCapId,
        vaultId: createdVaultId,
        name: agentName.trim(),
        status: "ACTIVE",
        vaultBalance: "0.00 SUI",

        riskThreshold,

        spendingLimit: `${numericSpendingLimit.toFixed(2)} SUI`,

        allowedActions: cetusSwapEnabled
          ? [...selectedActions, "CETUS_SWAP"]
          : selectedActions,

        periodLimit: `${numericPeriodLimit.toFixed(2)} SUI`,

        periodLength: formatDuration(periodLengthMs),

        expiry: noExpiry ? "No expiry" : formatExpiry(expiryAbsoluteMs),

        allowedTargets: targets,
        protocolTargets,
      };

      setCreated(true);

      toast.success("Agent created", {
        description: `${newAgent.name} has been created with the selected policy.`,
      });
    } catch (error) {
      console.error(error);
      toast.error("Failed to create agent", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-8 py-10">
        {/* BACK */}

        <Button
          variant="ghost"
          className="mb-6 -ml-3 rounded-lg"
          onClick={() => router.push("/agents")}
        >
          <ArrowLeft className="size-4" />
          Back to Agents
        </Button>

        {/* HEADER */}

        <div>
          <p className="text-sm text-muted-foreground">Autonomous Agent</p>

          <h1 className="mt-1 text-3xl font-display">Create New Agent</h1>

          <p className="mt-2 text-muted-foreground">
            Configure the permissions and limits that control your agent.
          </p>
        </div>

        {/* AGENT INFORMATION */}

        <Card className="mt-10">
          <CardHeader>
            <CardTitle>Agent Information</CardTitle>

            <CardDescription>
              Give your autonomous agent a recognizable name.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className="grid gap-2">
              <Label htmlFor="agent-name">
                Agent Name<span className="text-destructive">*</span>
              </Label>

              <Input
                id="agent-name"
                value={agentName}
                onChange={(event) => setAgentName(event.target.value)}
                placeholder="Example: Yield Optimizer"
              />
            </div>
          </CardContent>
        </Card>

        {/* CONFIGURATION MODE */}

        <Card className="mt-8">
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-5 text-muted-foreground" />

              <div>
                <CardTitle>Policy Configuration</CardTitle>

                <CardDescription>
                  Create your policy using natural language or configure every
                  rule manually.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <Tabs
              value={configMode}
              onValueChange={(value) => {
                if (value === "natural" || value === "advanced") {
                  setConfigMode(value);
                }
              }}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="natural">
                  <Sparkles className="size-4" />
                  Natural Language
                </TabsTrigger>

                <TabsTrigger value="advanced">
                  <ShieldCheck className="size-4" />
                  Advanced
                </TabsTrigger>
              </TabsList>

              {/* NATURAL LANGUAGE */}

              <TabsContent value="natural" className="mt-6">
                <div className="grid gap-5">
                  <div>
                    <Label htmlFor="instructions">Describe Your Policy</Label>

                    <p className="mt-1 text-xs text-muted-foreground">
                      Explain what the agent is allowed to do using plain
                      language.
                    </p>
                  </div>

                  <Textarea
                    id="instructions"
                    value={instructions}
                    onChange={(event) => {
                      setInstructions(event.target.value);
                      setPolicyGenerated(false);
                      setGeneratedPolicy(null);
                    }}
                    disabled={isParsing}
                    placeholder="Example: Allow this agent to swap and stake. Limit each transaction to 0.5 SUI, with a total limit of 5 SUI every 24 hours. Flag anything with a risk score above 60."
                    className="min-h-40 resize-none"
                  />

                  <div className="rounded-lg border bg-muted/20 p-4">
                    <p className="text-sm font-medium">How it works</p>

                    <p className="mt-1 text-sm text-muted-foreground">
                      {policyGenerated
                        ? "Policy generated. Edit your description and regenerate to make changes, or switch to the Advanced tab to fine-tune individual fields."
                        : "Oronyx interprets your instructions and converts them into a structured policy. You can review and edit every field before the agent is created."}
                    </p>
                  </div>

                  <div className="flex items-center justify-end gap-3">
                    {isParsing && (
                      <span className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Spinner />
                        Generating policy...
                      </span>
                    )}

                    <Button
                      onClick={handleGeneratePolicy}
                      disabled={
                        isParsing || !agentName.trim() || !instructions.trim()
                      }
                    >
                      <Sparkles className="size-4" />

                      {isParsing ? "Generating..." : "Generate Policy"}
                    </Button>
                  </div>

                  {policyGenerated && generatedPolicy && !isParsing && (
                    <Card className="bg-muted/20">
                      <CardHeader>
                        <CardTitle className="text-base">
                          Generated Policy Preview
                        </CardTitle>
                        <CardDescription>
                          Review the extracted policy below, or fine-tune it in
                          the Advanced tab.
                        </CardDescription>
                      </CardHeader>

                      <CardContent className="grid gap-4 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Allowed Actions
                          </p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {selectedActions.map((action) => (
                              <Badge key={action} variant="secondary">
                                {action}
                              </Badge>
                            ))}
                            {cetusSwapEnabled && (
                              <Badge variant="secondary">CETUS_SWAP</Badge>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Per-Tx Limit
                            </p>
                            <p>{numericSpendingLimit.toFixed(2)} SUI</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Period Limit
                            </p>
                            <p>{numericPeriodLimit.toFixed(2)} SUI</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Period Length
                            </p>
                            <p>
                              {periodLengthValue} {periodLengthUnit}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Risk Threshold
                            </p>
                            <p>{riskThreshold}%</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">
                              Expiry
                            </p>
                            <p>
                              {noExpiry
                                ? "No expiry"
                                : `${expiryValue} ${expiryUnit}`}
                            </p>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs text-muted-foreground">
                            Allowed Targets
                          </p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {targets.length === 0 && (
                              <span className="text-sm text-muted-foreground">
                                None specified.
                              </span>
                            )}
                            {targets.map((target) => (
                              <Badge
                                key={target}
                                variant="outline"
                                title={target}
                              >
                                {`${target.slice(0, 6)}…${target.slice(-4)}`}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>

              {/* ADVANCED */}

              <TabsContent value="advanced" className="mt-6">
                <div className="space-y-8">
                  {/* ALLOWED ACTIONS */}

                  <div className="grid gap-4">
                    <div>
                      <Label>Allowed Actions</Label>

                      <p className="mt-1 text-xs text-muted-foreground">
                        Select which actions this agent is allowed to execute.
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      {AVAILABLE_ACTIONS.map((action) => {
                        const checked = selectedActions.includes(action);

                        return (
                          <label
                            key={action}
                            className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors ${
                              checked
                                ? "border-primary/40 bg-primary/5"
                                : "bg-muted/20 hover:bg-muted/40"
                            }`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleAction(action)}
                            />

                            <span className="font-medium">{action}</span>
                          </label>
                        );
                      })}
                    </div>

                    <label
                      className={`flex items-center gap-3 rounded-lg border p-4 opacity-60 ${
                        cetusSwapEnabled
                          ? "border-primary/40 bg-primary/5"
                          : "bg-muted/20"
                      }`}
                    >
                      <Checkbox checked={cetusSwapEnabled} disabled />
                      <span className="font-medium">CETUS_SWAP</span>
                    </label>

                    <p className="text-xs text-muted-foreground">
                      CETUS_SWAP is set automatically from a generated policy
                      and can&apos;t be toggled manually.
                    </p>

                    <div className="flex flex-wrap gap-2">
                      {selectedActions.map((action) => (
                        <Badge key={action} variant="secondary">
                          {action}
                        </Badge>
                      ))}
                      {cetusSwapEnabled && (
                        <Badge variant="secondary">CETUS_SWAP</Badge>
                      )}
                    </div>

                    {selectedActions.length === 0 && (
                      <p className="text-sm text-destructive">
                        Select at least one allowed action.
                      </p>
                    )}
                  </div>

                  {/* ALLOWED TARGETS */}

                  <div className="grid gap-2">
                    <Label>Allowed Targets</Label>

                    <p className="text-xs text-muted-foreground">
                      Recipients, validators, pools, or other addresses this
                      agent may act against.
                    </p>

                    <div className="flex flex-wrap gap-2">
                      {targets.length === 0 && (
                        <span className="text-sm text-muted-foreground">
                          No targets allowed yet.
                        </span>
                      )}

                      {targets.map((target) => (
                        <Badge
                          key={target}
                          variant="secondary"
                          title={target}
                          className="gap-1"
                        >
                          {`${target.slice(0, 6)}…${target.slice(-4)}`}
                          <button
                            type="button"
                            onClick={() => handleRemoveTarget(target)}
                            aria-label={`Remove ${target}`}
                          >
                            <X className="size-3" />
                          </button>
                        </Badge>
                      ))}

                      {selectedActions.includes("SWAP") && (
                        <Badge variant="outline" className="gap-1">
                          <Lock className="size-3" />
                          {`${MOCK_POOL_ID.slice(0, 6)}…${MOCK_POOL_ID.slice(-4)}`}
                        </Badge>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Input
                        value={newTarget}
                        onChange={(event) => setNewTarget(event.target.value)}
                        placeholder="0x..."
                      />

                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-lg"
                        disabled={!newTarget.trim()}
                        onClick={handleAddTarget}
                      >
                        <Plus className="size-4" />
                        Add
                      </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Addresses marked with a lock are required by the SWAP
                      action.
                    </p>
                  </div>

                  {/* SPENDING LIMITS */}

                  <div className="grid gap-6 md:grid-cols-2">
                    {/* PER TX */}

                    <div className="grid gap-2">
                      <Label htmlFor="spending-limit">
                        Per-Tx Spending Limit
                      </Label>

                      <div className="relative">
                        <Input
                          id="spending-limit"
                          type="number"
                          min="0"
                          step="0.01"
                          value={spendingLimit}
                          onChange={(event) =>
                            setSpendingLimit(event.target.value)
                          }
                          className="pr-14"
                        />

                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          SUI
                        </span>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Maximum amount allowed in a single transaction.
                      </p>

                      {spendingInvalid && (
                        <p className="text-sm text-destructive">
                          Must be greater than 0 SUI.
                        </p>
                      )}
                    </div>

                    {/* PERIOD LIMIT */}

                    <div className="grid gap-2">
                      <Label htmlFor="period-limit">
                        Period Spending Limit
                      </Label>

                      <div className="relative">
                        <Input
                          id="period-limit"
                          type="number"
                          min="0"
                          step="0.01"
                          value={periodLimit}
                          onChange={(event) =>
                            setPeriodLimit(event.target.value)
                          }
                          className="pr-14"
                        />

                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          SUI
                        </span>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Total spending allowed during the selected period.
                      </p>

                      {periodLimitInvalid && (
                        <p className="text-sm text-destructive">
                          Must be greater than 0 SUI.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* PERIOD LENGTH */}

                  <div className="grid gap-2">
                    <Label htmlFor="period-length">Period Length</Label>

                    <div className="flex gap-2">
                      <Input
                        id="period-length"
                        type="number"
                        min="0"
                        step="1"
                        value={periodLengthValue}
                        onChange={(event) =>
                          setPeriodLengthValue(Number(event.target.value))
                        }
                        className="flex-1"
                      />

                      <Select
                        value={periodLengthUnit}
                        onValueChange={(value) => {
                          if (value === "hours" || value === "days") {
                            setPeriodLengthUnit(value);
                          }
                        }}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>

                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="hours">Hours</SelectItem>
                            <SelectItem value="days">Days</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      The spending limit resets after this period.
                    </p>

                    {periodLengthInvalid && (
                      <p className="text-sm text-destructive">
                        Must be greater than 0.
                      </p>
                    )}
                  </div>

                  {/* RISK THRESHOLD */}

                  <div className="grid gap-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <Label htmlFor="risk-threshold">Risk Threshold</Label>

                        <p className="mt-1 text-xs text-muted-foreground">
                          Actions above this score may be flagged for review.
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Input
                          id="risk-threshold"
                          type="number"
                          min={0}
                          max={100}
                          step={5}
                          value={riskThreshold}
                          onChange={(event) => {
                            const value = Number(event.target.value);

                            if (
                              Number.isFinite(value) &&
                              value >= 0 &&
                              value <= 100
                            ) {
                              setRiskThreshold(value);
                            }
                          }}
                          onBlur={() => {
                            const snapped = Math.round(riskThreshold / 5) * 5;

                            setRiskThreshold(
                              Math.min(100, Math.max(0, snapped)),
                            );
                          }}
                          className="w-20 text-center"
                        />

                        <Badge variant="secondary">%</Badge>
                      </div>
                    </div>

                    <Slider
                      value={[riskThreshold]}
                      onValueChange={(value) => {
                        const nextValue =
                          typeof value === "number" ? value : (value[0] ?? 60);

                        setRiskThreshold(nextValue);
                      }}
                      min={0}
                      max={100}
                      step={5}
                    />

                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0%</span>
                      <span>25%</span>
                      <span>50%</span>
                      <span>75%</span>
                      <span>100%</span>
                    </div>
                  </div>

                  {/* EXPIRY */}

                  <div className="grid gap-2">
                    <Label>Policy Expiry</Label>

                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={noExpiry}
                        onCheckedChange={(checked) =>
                          setNoExpiry(checked === true)
                        }
                      />
                      No expiry
                    </label>

                    {!noExpiry && (
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={expiryValue}
                          onChange={(event) =>
                            setExpiryValue(Number(event.target.value))
                          }
                          className="flex-1"
                        />

                        <Select
                          value={expiryUnit}
                          onValueChange={(value) => {
                            if (value === "hours" || value === "days") {
                              setExpiryUnit(value);
                            }
                          }}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>

                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="hours">Hours</SelectItem>
                              <SelectItem value="days">Days</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                      The agent policy becomes invalid after this duration.
                    </p>

                    {expiryInvalid && (
                      <p className="text-sm text-destructive">
                        Must be greater than 0.
                      </p>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>

          {/* ACTIONS */}

          <CardFooter className="justify-end gap-3 border-t pt-5">
            <Button
              variant="outline"
              className="rounded-lg"
              onClick={() => router.push("/agents")}
            >
              Cancel
            </Button>

            <Button
              className="rounded-lg"
              disabled={formInvalid || isCreating || created}
              onClick={handleCreateAgent}
            >
              <Save className="size-4" />

              {isCreating
                ? "Creating..."
                : created
                  ? "Agent Created"
                  : configMode === "natural" && !policyGenerated
                    ? "Generate Policy First"
                    : "Create Agent"}
            </Button>
          </CardFooter>
        </Card>

        {/* SUCCESS */}

        {created && (
          <Card className="mt-8 border-emerald-500/30 bg-emerald-500/5">
            <CardHeader>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="size-5 text-emerald-400" />

                <CardTitle className="text-emerald-400">
                  Agent Created
                </CardTitle>
              </div>

              <CardDescription>
                {agentName} has been created with its configured policy.
              </CardDescription>
            </CardHeader>

            <CardFooter>
              <Button
                onClick={() => router.push("/agents")}
                className="rounded-lg"
              >
                View Agents
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </main>
  );
}
