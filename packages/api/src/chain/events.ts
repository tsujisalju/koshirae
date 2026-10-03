import { bcs } from "@mysten/sui/bcs";
import { normalizeStructTag, normalizeSuiObjectId } from "@mysten/sui/utils";
import type { SuiClientTypes } from "@mysten/sui/client";
import { KOSHIRAE_ORIGINAL_PACKAGE_ID } from "./client";

// Event type tags carry the package's ORIGINAL id, like object types do.
const capabilityType = (name: string) =>
  normalizeStructTag(`${KOSHIRAE_ORIGINAL_PACKAGE_ID}::capability::${name}`);

const EVENT_TYPES = {
  executed: capabilityType("ActionExecuted"),
  flagged: capabilityType("ActionFlagged"),
  approved: capabilityType("PendingApproved"),
  rejected: capabilityType("PendingRejected"),
};
const OUR_EVENT_TYPES = new Set(Object.values(EVENT_TYPES));

// Field order mirrors capability.move exactly: BCS decoding is positional.
// Update these in the same commit as any change to the Move event structs.
const ActionExecutedBcs = bcs.struct("ActionExecuted", {
  capId: bcs.Address,
  actionType: bcs.u8(),
  target: bcs.Address,
  amount: bcs.u64(),
  onchainFloor: bcs.u8(),
  reportedRisk: bcs.u8(),
  riskScore: bcs.u8(),
});

const ActionFlaggedBcs = bcs.struct("ActionFlagged", {
  capId: bcs.Address,
  pendingId: bcs.Address,
  actionType: bcs.u8(),
  target: bcs.Address,
  amount: bcs.u64(),
  onchainFloor: bcs.u8(),
  reportedRisk: bcs.u8(),
  riskScore: bcs.u8(),
});

// PendingApproved and PendingRejected share this layout.
const PendingResolvedBcs = bcs.struct("PendingResolved", {
  pendingId: bcs.Address,
  capId: bcs.Address,
});

export type Outcome =
  | { kind: "executed"; riskScore: number }
  | { kind: "flagged"; pendingActionId: string; riskScore: number }
  | { kind: "approved"; pendingActionId: string }
  | { kind: "rejected"; pendingActionId: string }
  | { kind: "none" };

// Classifies a transaction by the Koshirae events it emitted for one AgentCap.
// Exact type matching (with our original package id) rules out look-alike
// events from other packages; the capId check rules out our own events for a
// different cap in the same transaction.
export function classifyEvents(
  events: readonly SuiClientTypes.Event[],
  agentCapId: string,
): Outcome {
  const capId = normalizeSuiObjectId(agentCapId);
  const ours = events
    .map((e) => ({ type: normalizeStructTag(e.eventType), bcs: e.bcs }))
    .filter((e) => OUR_EVENT_TYPES.has(e.type));

  // approve_pending emits PendingApproved AND ActionExecuted, so resolutions
  // must be checked before plain execution.
  for (const e of ours) {
    if (e.type !== EVENT_TYPES.approved && e.type !== EVENT_TYPES.rejected) continue;
    const ev = PendingResolvedBcs.parse(e.bcs);
    if (normalizeSuiObjectId(ev.capId) !== capId) continue;
    return {
      kind: e.type === EVENT_TYPES.approved ? "approved" : "rejected",
      pendingActionId: normalizeSuiObjectId(ev.pendingId),
    };
  }
  for (const e of ours) {
    if (e.type === EVENT_TYPES.flagged) {
      const ev = ActionFlaggedBcs.parse(e.bcs);
      if (normalizeSuiObjectId(ev.capId) === capId)
        return {
          kind: "flagged",
          pendingActionId: normalizeSuiObjectId(ev.pendingId),
          riskScore: ev.riskScore,
        };
    }
    if (e.type === EVENT_TYPES.executed) {
      const ev = ActionExecutedBcs.parse(e.bcs);
      if (normalizeSuiObjectId(ev.capId) === capId)
        return { kind: "executed", riskScore: ev.riskScore };
    }
  }
  return { kind: "none" };
}
