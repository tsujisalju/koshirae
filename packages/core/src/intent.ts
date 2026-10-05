import { z } from "zod";
import { CoinAmount, CoinType, SuiAddress, SuiObjectID } from "./primitives";
import { pageOf, PageQuery } from "./pagination";

const baseIntentFields = {
  target: SuiAddress,
  amount: CoinAmount,
  operatorCapId: SuiObjectID,
  agentReportedRisk: z.number().int().min(0).max(255).optional(),
  requestedPendingWindowMs: z.number().int().positive().optional(), // if omitted, defer entirely to cap's own ceiling
};

export const SubmitIntentRequest = z.discriminatedUnion("actionType", [
  z.object({
    actionType: z.literal("transfer"),
    coinType: CoinType,
    idempotencyKey: z.string(),
    ...baseIntentFields,
  }),
  z.object({
    actionType: z.literal("mockSwap"),
    coinType: CoinType,
    idempotencyKey: z.string(),
    ...baseIntentFields,
  }),
  z.object({
    actionType: z.literal("stake"),
    idempotencyKey: z.string(),
    ...baseIntentFields,
  }), //No coinType, always SUI
  z.object({
    actionType: z.literal("cetusSwap"),
    coinTypeIn: CoinType, // which side of the coin type pair they are selling, api derives pair from pool object itself
    idempotencyKey: z.string(),
    ...baseIntentFields,
  }),
]);
export type SubmitIntentRequest = z.infer<typeof SubmitIntentRequest>;

// Status reflects confirmed chain state only. `ready` covers everything from
// "built" to "submitted but not yet reported"; the predicted outcome lives in
// predictedOutcome. `expired` is never stored, it is derived on read from a
// pending_approval intent whose PendingAction expiry has passed.
export const IntentStatus = z.enum([
  "ready",
  "pending_approval",
  "executed",
  "denied",
  "expired",
  "failed",
]);
export type IntentStatus = z.infer<typeof IntentStatus>;

export const PredictedOutcome = z.enum(["execute", "flag"]);
export type PredictedOutcome = z.infer<typeof PredictedOutcome>;

export const Intent = z.object({
  id: z.string(),
  agentCapId: SuiObjectID,
  status: IntentStatus,
  predictedOutcome: PredictedOutcome,
  request: SubmitIntentRequest,
  nonce: z.number().int().positive(),
  riskScore: z.number().int().min(0).max(255).optional(),
  pendingActionId: SuiObjectID.optional(),
  expiresAt: z.number().int().optional(), // ms epoch, set once flagged on-chain
  submitDigest: z.string().optional(),
  resolutionDigest: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
});
export type Intent = z.infer<typeof Intent>;

// Every route that builds a transaction returns this. `digest` is what the
// signed transaction's digest will be (it hashes the tx data, not the
// signatures) and is what /intents/:id/submitted accepts.
export const UnsignedTransaction = z.object({
  unsignedTransaction: z.string(),
  digest: z.string(),
});
export type UnsignedTransaction = z.infer<typeof UnsignedTransaction>;

export const IntentWithTransaction = Intent.extend(UnsignedTransaction.shape);
export type IntentWithTransaction = z.infer<typeof IntentWithTransaction>;

export const ObjectRef = z.object({
  objectId: SuiObjectID,
  version: z.string(),
  digest: z.string(),
});
export type ObjectRef = z.infer<typeof ObjectRef>;

// Build-time options, sent under `buildOptions` in a request body. Clients
// can't modify a transaction after the API builds it (any change alters the
// digest), so anything they need to control goes here instead.
export const BuildOptions = z.object({
  gasPayment: z.array(ObjectRef).min(1).optional(),
});
export type BuildOptions = z.infer<typeof BuildOptions>;

export const SubmittedRequest = z.object({ txDigest: z.string().min(1) });
export type SubmittedRequest = z.infer<typeof SubmittedRequest>;

export const ListIntentsQuery = PageQuery.extend({ status: IntentStatus.optional() });
export type ListIntentsQuery = z.infer<typeof ListIntentsQuery>;

export const IntentPage = pageOf(Intent);
export type IntentsPage = z.infer<typeof IntentPage>;
