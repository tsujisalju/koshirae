"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BotOff,
  Check,
  CircleCheck,
  CircleQuestionMark,
  CircleX,
  History,
  ShieldAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useCurrentAccount } from "@mysten/dapp-kit-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { formatMist, formatRelativeTime, suiExplorerTxUrl } from "@/lib/agents";
import {
  ActivityRecord,
  AgentDetail,
  getActivity,
  getAgent,
  listAgents,
} from "@/lib/agent-service";
import { approvePendingAction, rejectPendingAction } from "@/lib/transactions";
import { usePendingActions, PendingAction } from "@/lib/use-pending-actions";
import { useMediaQuery } from "@/lib/use-media-query";

type AuditStatus =
  | "FLAGGED"
  | "APPROVED"
  | "REJECTED"
  | "EXECUTED"
  | "SKIPPED"
  | "FAILED";

type AuditAction = "SWAP" | "STAKE" | "TRANSFER";

type AuditRecord = {
  id: string;
  agentName: string;
  capId: string;
  vaultId: string | null;
  action: AuditAction;
  amount: string;
  riskScore: number;
  riskThreshold: number | null;
  reason: string;
  targetAddress: string | null;
  txDigest: string | null;
  status: AuditStatus;
  timestamp: string;
  timestampIso: string;
  // Set only for FLAGGED rows sourced from a live on-chain PendingAction —
  // needed to build the approve/reject transaction.
  pendingObjectId?: string;
};

function actionTypeToAuditAction(actionType: number): AuditAction {
  if (actionType === 2) return "STAKE";
  if (actionType === 0) return "TRANSFER";
  return "SWAP"; // 1 = MOCK_SWAP, 3 = CETUS_SWAP
}

function getRiskVariant(
  score: number,
): "default" | "secondary" | "destructive" | "outline" {
  if (score >= 75) return "destructive";
  if (score >= 50) return "outline";
  return "secondary";
}

function getStatusVariant(
  status: AuditStatus,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "APPROVED":
    case "EXECUTED":
      return "default";
    case "REJECTED":
    case "FAILED":
      return "destructive";
    case "SKIPPED":
      return "secondary";
    case "FLAGGED":
    default:
      return "outline";
  }
}

export default function AuditPage() {
  const account = useCurrentAccount();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const [activityRecords, setActivityRecords] = useState<ActivityRecord[]>([]);
  const [agentDetails, setAgentDetails] = useState<Record<string, AgentDetail>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const {
    pendingActions,
    isLoading: pendingLoading,
    refetch: refetchPending,
  } = usePendingActions(account?.address);

  const [selectedRecord, setSelectedRecord] = useState<AuditRecord | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

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

  // Matches a live PendingAction back to the activity_log row that
  // produced it — cap_id + target + amount_mist + risk_score are exactly
  // the values agent-service proposed and passed on-chain, so this is a
  // deterministic join key against the most recent matching "act" row.
  function findReasoningFor(pending: PendingAction): ActivityRecord | null {
    return (
      activityRecords.find(
        (record) =>
          record.cap_id === pending.capId &&
          record.decision === "act" &&
          record.target === pending.target &&
          record.amount_mist === pending.amount &&
          record.risk_score === pending.riskScore,
      ) ?? null
    );
  }

  const pendingRecords: AuditRecord[] = useMemo(
    () =>
      pendingActions.map((pending) => {
        const matched = findReasoningFor(pending);
        const createdAtIso = new Date(pending.createdAtMs).toISOString();

        return {
          id: pending.objectId,
          agentName: agentName(pending.capId),
          capId: pending.capId,
          vaultId: pending.vaultId,
          action: actionTypeToAuditAction(pending.actionType),
          amount: formatMist(Number(pending.amount)),
          riskScore: pending.riskScore,
          riskThreshold: agentDetails[pending.capId]?.risk_threshold ?? null,
          reason:
            matched?.reasoning ??
            "Flagged by the policy engine for exceeding the agent's risk threshold.",
          targetAddress: pending.target,
          txDigest: null,
          status: "FLAGGED",
          timestamp: formatRelativeTime(createdAtIso),
          timestampIso: createdAtIso,
          pendingObjectId: pending.objectId,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingActions, activityRecords, agentDetails],
  );

  const historyRecords: AuditRecord[] = useMemo(
    () =>
      activityRecords
        // Exclude rows that currently have a live matching PendingAction,
        // so a still-unresolved flagged decision isn't shown in both
        // sections at once.
        .filter((record) => {
          if (record.decision !== "act") return true;
          const threshold = agentDetails[record.cap_id]?.risk_threshold;
          const isFlagged =
            threshold != null &&
            record.risk_score != null &&
            record.risk_score > threshold;
          if (!isFlagged) return true;
          return !pendingActions.some(
            (pending) =>
              pending.capId === record.cap_id &&
              pending.target === record.target &&
              pending.amount === record.amount_mist &&
              pending.riskScore === record.risk_score,
          );
        })
        .map((record): AuditRecord => {
          const threshold = agentDetails[record.cap_id]?.risk_threshold ?? null;
          let status: AuditStatus;
          if (record.decision === "act_failed") {
            status = "FAILED";
          } else if (record.decision === "act") {
            status =
              threshold != null &&
              record.risk_score != null &&
              record.risk_score > threshold
                ? "FLAGGED"
                : "EXECUTED";
          } else {
            status = "SKIPPED";
          }

          return {
            id: String(record.id),
            agentName: agentName(record.cap_id),
            capId: record.cap_id,
            vaultId: agentDetails[record.cap_id]?.vault_id ?? null,
            action: actionTypeToAuditAction(record.action_type),
            amount: record.amount_mist
              ? formatMist(Number(record.amount_mist))
              : "—",
            riskScore: record.risk_score ?? 0,
            riskThreshold: threshold,
            reason: record.reasoning,
            targetAddress: record.target,
            txDigest: record.tx_digest,
            status,
            timestamp: formatRelativeTime(record.created_at),
            timestampIso: record.created_at,
          };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activityRecords, agentDetails, pendingActions],
  );

  // No PendingApproved/PendingRejected event indexing yet (documented
  // gap), so we can't report true approved/rejected counts — these cards
  // instead surface counts we do have real data for.
  const executedCount = historyRecords.filter(
    (record) => record.status === "EXECUTED",
  ).length;
  const skippedCount = historyRecords.filter(
    (record) => record.status === "SKIPPED",
  ).length;

  async function handleApprove(record: AuditRecord) {
    if (!account || !record.pendingObjectId || !record.vaultId) return;

    setProcessingId(record.id);
    try {
      await approvePendingAction({
        pendingObjectId: record.pendingObjectId,
        capId: record.capId,
        vaultId: record.vaultId,
        sender: account.address,
      });

      toast.success("Action approved", {
        description: "The flagged action has been executed on-chain.",
      });

      await refetchPending();
    } catch (error) {
      toast.error("Failed to approve action", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setProcessingId(null);
    }
  }

  async function handleReject(record: AuditRecord) {
    if (!account || !record.pendingObjectId) return;

    setProcessingId(record.id);
    try {
      await rejectPendingAction({
        pendingObjectId: record.pendingObjectId,
        capId: record.capId,
        sender: account.address,
      });

      toast.error("Action rejected", {
        description: "The flagged action has been rejected on-chain.",
      });

      await refetchPending();
    } catch (error) {
      toast.error("Failed to reject action", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setProcessingId(null);
    }
  }

  const showLoading = isLoading || pendingLoading;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-8 py-10">
        {/* HEADER */}
        <div>
          <h1 className="text-3xl font-display">Audit Trail</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Review high-risk autonomous actions, approve or reject flagged
            requests, and inspect recent agent activity.
          </p>
        </div>

        {/* SUMMARY CARDS */}

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Pending Review</CardDescription>

              <CardTitle className="text-3xl">
                {pendingRecords.length}
              </CardTitle>
              <CardAction>
                <CircleQuestionMark className="size-5 text-amber-400" />
              </CardAction>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Executed</CardDescription>

              <CardTitle className="text-3xl">{executedCount}</CardTitle>
              <CardAction>
                <CircleCheck className="size-5 text-emerald-400" />
              </CardAction>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Skipped</CardDescription>

              <CardTitle className="text-3xl">{skippedCount}</CardTitle>
              <CardAction>
                <CircleX className="size-5 text-muted-foreground" />
              </CardAction>
            </CardHeader>
          </Card>
        </div>

        {/* PENDING APPROVALS */}

        <Card className="mt-8">
          <CardHeader>
            <div className="flex items-center gap-3">
              <ShieldAlert className="size-5 text-muted-foreground" />

              <div>
                <CardTitle>Pending Approvals</CardTitle>

                <CardDescription>
                  These actions were flagged by the policy engine and require
                  human review.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {showLoading ? (
              <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
                <Spinner />
                <p className="text-sm">Loading pending approvals…</p>
              </div>
            ) : pendingRecords.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center">
                <Check className="mx-auto size-8 text-muted-foreground" />

                <p className="mt-3 font-medium">No pending approvals</p>

                <p className="mt-1 text-sm text-muted-foreground">
                  All flagged actions have been reviewed.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {pendingRecords.map((record) => (
                  <Card key={record.id} className="border-border/80">
                    <CardHeader className="flex flex-row items-start justify-between gap-4">
                      <div className="grid gap-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base">
                            {record.agentName}
                          </CardTitle>
                          <Badge variant="secondary">{record.action}</Badge>
                        </div>
                        <CardDescription>{record.timestamp}</CardDescription>
                      </div>

                      <Badge variant={getRiskVariant(record.riskScore)}>
                        {record.riskScore}
                        /100
                      </Badge>
                    </CardHeader>

                    <CardContent>
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />

                        <p className="text-sm text-muted-foreground">
                          {record.reason}
                        </p>
                      </div>
                    </CardContent>

                    <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                      <span className="text-sm font-medium">
                        {record.amount}
                      </span>

                      <div className="flex gap-2">
                        {/* REJECT */}

                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={processingId === record.id}
                              />
                            }
                          >
                            <X className="size-4" />
                            Reject
                          </AlertDialogTrigger>

                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Reject action?
                              </AlertDialogTitle>

                              <AlertDialogDescription>
                                This will reject the {record.action} request
                                from {record.agentName}.
                              </AlertDialogDescription>
                            </AlertDialogHeader>

                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>

                              <AlertDialogAction
                                variant="destructive"
                                onClick={() => handleReject(record)}
                              >
                                Reject Action
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>

                        {/* APPROVE */}

                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                size="sm"
                                disabled={processingId === record.id}
                              />
                            }
                          >
                            <Check className="size-4" />
                            Approve
                          </AlertDialogTrigger>

                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Approve action?
                              </AlertDialogTitle>

                              <AlertDialogDescription>
                                Approve this {record.action} request for{" "}
                                {record.amount}?
                              </AlertDialogDescription>
                            </AlertDialogHeader>

                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>

                              <AlertDialogAction
                                onClick={() => handleApprove(record)}
                              >
                                Approve Action
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* HISTORY */}

        <Card className="mt-8">
          <CardHeader>
            <div className="flex items-center gap-3">
              <History className="size-5 text-muted-foreground" />

              <div>
                <CardTitle>Recent Activity</CardTitle>

                <CardDescription>
                  Previously executed and reviewed autonomous actions. Click a
                  row for full details.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
                <Spinner />
                <p className="text-sm">Loading activity…</p>
              </div>
            ) : loadError ? (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <BotOff />
                  </EmptyMedia>

                  <EmptyTitle>Failed to load activity</EmptyTitle>

                  <EmptyDescription>{loadError}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : historyRecords.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center">
                <History className="mx-auto size-8 text-muted-foreground" />

                <p className="mt-3 font-medium">No activity yet</p>

                <p className="mt-1 text-sm text-muted-foreground">
                  Once your agents start making decisions, they&apos;ll show
                  up here.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>

                      <TableHead>Action</TableHead>

                      <TableHead>Amount</TableHead>

                      <TableHead>Risk</TableHead>

                      <TableHead>Status</TableHead>

                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {historyRecords.map((record) => (
                      <TableRow
                        key={record.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedRecord(record)}
                      >
                        <TableCell className="font-medium">
                          {record.agentName}
                        </TableCell>

                        <TableCell>
                          <Badge variant="secondary">{record.action}</Badge>
                        </TableCell>

                        <TableCell>{record.amount}</TableCell>

                        <TableCell>
                          <Badge variant={getRiskVariant(record.riskScore)}>
                            {record.riskScore}
                            /100
                          </Badge>
                        </TableCell>

                        <TableCell>
                          <Badge variant={getStatusVariant(record.status)}>
                            {record.status}
                          </Badge>
                        </TableCell>

                        <TableCell className="text-muted-foreground">
                          {record.timestamp}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* RECENT ACTIVITY DETAIL DRAWER */}

      <Drawer
        open={selectedRecord != null}
        onOpenChange={(open) => {
          if (!open) setSelectedRecord(null);
        }}
        swipeDirection={isDesktop ? "right" : "down"}
      >
        <DrawerContent>
          {selectedRecord && (
            <>
              <DrawerHeader>
                <div className="flex items-center gap-2">
                  <DrawerTitle>{selectedRecord.agentName}</DrawerTitle>
                  <Badge variant={getStatusVariant(selectedRecord.status)}>
                    {selectedRecord.status}
                  </Badge>
                </div>
                <DrawerDescription>
                  {selectedRecord.action} · {new Date(selectedRecord.timestampIso).toLocaleString()}
                </DrawerDescription>
              </DrawerHeader>

              <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    Reasoning
                  </p>
                  <p className="mt-1 text-sm">{selectedRecord.reason}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Amount
                    </p>
                    <p className="mt-1 text-sm">{selectedRecord.amount}</p>
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Risk Score
                    </p>
                    <p className="mt-1 text-sm">
                      {selectedRecord.riskScore}/100
                      {selectedRecord.riskThreshold != null && (
                        <span className="text-muted-foreground">
                          {" "}
                          (threshold {selectedRecord.riskThreshold})
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                {selectedRecord.targetAddress && (
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Target
                    </p>
                    <p className="mt-1 break-all font-mono text-sm">
                      {selectedRecord.targetAddress}
                    </p>
                  </div>
                )}

                {selectedRecord.txDigest && (
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Transaction
                    </p>
                    <a
                      href={suiExplorerTxUrl(selectedRecord.txDigest)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block break-all font-mono text-sm text-primary underline underline-offset-2"
                    >
                      {selectedRecord.txDigest}
                    </a>
                  </div>
                )}

                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    Agent Cap
                  </p>
                  <p className="mt-1 break-all font-mono text-sm">
                    {selectedRecord.capId}
                  </p>
                </div>
              </div>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </main>
  );
}
