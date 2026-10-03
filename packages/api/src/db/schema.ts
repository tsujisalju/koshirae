import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { SubmitIntentRequest } from "@koshirae/core";

export const intents = pgTable(
  "intents",
  {
    id: text("id").primaryKey(),
    agentCapId: text("agent_cap_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    // ready | pending_approval | executed | denied | failed ("expired" is derived on read)
    status: text("status").notNull(),
    predictedOutcome: text("predicted_outcome").notNull(), // execute | flag
    request: jsonb("request").$type<SubmitIntentRequest>().notNull(),
    // Allocated once at creation and reused by every rebuild, so at most one
    // build of this intent can ever execute on-chain.
    nonce: bigint("nonce", { mode: "number" }).notNull(),
    riskScore: integer("risk_score"),
    pendingActionId: text("pending_action_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    submitDigest: text("submit_digest"),
    resolutionDigest: text("resolution_digest"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("intents_agent_cap_idempotency_idx").on(table.agentCapId, table.idempotencyKey),
    uniqueIndex("intents_agent_cap_nonce_idx").on(table.agentCapId, table.nonce),
  ],
);

// Every transaction the API has built for an intent. /intents/:id/submitted
// only accepts digests recorded here.
export const intentTransactions = pgTable(
  "intent_transactions",
  {
    digest: text("digest").primaryKey(),
    intentId: text("intent_id")
      .notNull()
      .references(() => intents.id),
    agentCapId: text("agent_cap_id").notNull(),
    kind: text("kind").notNull(), // submit | approve | reject
    status: text("status").notNull().default("issued"), // issued | succeeded | failed
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("intent_transactions_intent_idx").on(table.intentId)],
);

export type IntentRow = typeof intents.$inferSelect;
export type IntentTransactionRow = typeof intentTransactions.$inferSelect;
export type IssuedKind = "submit" | "approve" | "reject";
