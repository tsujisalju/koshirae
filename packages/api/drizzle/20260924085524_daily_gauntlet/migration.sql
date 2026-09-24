CREATE TABLE "intents" (
	"id" text PRIMARY KEY,
	"agent_cap_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"request" jsonb NOT NULL,
	"risk_score" integer,
	"tx_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pending_action_id" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "intents_agent_cap_idempotency_idx" ON "intents" ("agent_cap_id","idempotency_key");