import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { SubmitIntentRequest } from "@oronyx/core";

export const intents = pgTable(
  "intents",
  {
    id: text("id").primaryKey(),
    agentCapId: text("agent_cap_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    request: jsonb("request").$type<SubmitIntentRequest>().notNull(),
    riskScore: integer("risk_score"),
    txDigest: text("tx_digest"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    pendingActionId: text("pending_action_id"),
  },
  (table) => [
    uniqueIndex("intents_agent_cap_idempotency_idx").on(
      table.agentCapId,
      table.idempotencyKey,
    ),
  ],
);
