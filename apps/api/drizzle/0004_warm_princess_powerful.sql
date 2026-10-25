CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"source" varchar(16) NOT NULL,
	"provider_event_key" text NOT NULL,
	"model" varchar(100) NOT NULL,
	"raw_usage" jsonb NOT NULL,
	"rate_snapshot" jsonb NOT NULL,
	"estimated_usd" numeric(12, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_event_key" UNIQUE("session_id","source","provider_event_key"),
	CONSTRAINT "usage_event_values" CHECK ("usage_events"."source" in ('response','transcription') and "usage_events"."estimated_usd">=0)
);
--> statement-breakpoint
CREATE TABLE "usage_guard_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"lifetime_observed_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"unresolved_reserve_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"reconciled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_guard_singleton" CHECK ("usage_guard_state"."id"=1 and "usage_guard_state"."lifetime_observed_usd">=0 and "usage_guard_state"."unresolved_reserve_usd">=0)
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_business_id_session_id_voice_sessions_business_id_id_fk" FOREIGN KEY ("business_id","session_id") REFERENCES "public"."voice_sessions"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_session_time" ON "usage_events" USING btree ("session_id","created_at");