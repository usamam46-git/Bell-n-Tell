CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"provider_item_id" text,
	"input_turn_id" uuid,
	"role" varchar(12) NOT NULL,
	"redacted_text" text NOT NULL,
	"sequence" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_tenant_id" UNIQUE("business_id","id"),
	CONSTRAINT "messages_sequence" UNIQUE("session_id","sequence"),
	CONSTRAINT "messages_provider_item" UNIQUE("session_id","provider_item_id"),
	CONSTRAINT "message_values" CHECK ("conversation_messages"."sequence">0 and "conversation_messages"."role" in ('user','assistant','system'))
);
--> statement-breakpoint
CREATE TABLE "receptionist_config_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"version_no" integer,
	"draft_revision" integer DEFAULT 1 NOT NULL,
	"source_draft_id" uuid,
	"source_draft_revision" integer,
	"status" varchar(20) NOT NULL,
	"flow" jsonb NOT NULL,
	"policy" jsonb NOT NULL,
	"content" jsonb NOT NULL,
	"test_fixture" jsonb,
	"checksum" varchar(64) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "config_versions_tenant_id" UNIQUE("business_id","id"),
	CONSTRAINT "config_version_number" UNIQUE("business_id","version_no"),
	CONSTRAINT "config_version_values" CHECK ("receptionist_config_versions"."draft_revision">0 and "receptionist_config_versions"."status" in ('draft','test_snapshot','published','archived') and ("receptionist_config_versions"."version_no" is null or "receptionist_config_versions"."version_no">0) and ("receptionist_config_versions"."status"<>'test_snapshot' or "receptionist_config_versions"."test_fixture" is not null))
);
--> statement-breakpoint
CREATE TABLE "receptionist_configs" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"draft_version_id" uuid NOT NULL,
	"published_version_id" uuid
);
--> statement-breakpoint
CREATE TABLE "tool_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"provider_function_call_id" text,
	"provider_response_id" text,
	"input_turn_id" uuid NOT NULL,
	"expected_state_revision" integer NOT NULL,
	"requested_operation" varchar(40) NOT NULL,
	"proposal_id" uuid,
	"redacted_args" jsonb NOT NULL,
	"redacted_result" jsonb,
	"status" varchar(12) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tools_tenant_id" UNIQUE("business_id","id"),
	CONSTRAINT "tools_event" UNIQUE("session_id","event_id"),
	CONSTRAINT "tools_call" UNIQUE("session_id","provider_function_call_id"),
	CONSTRAINT "tool_values" CHECK ("tool_executions"."expected_state_revision">0 and "tool_executions"."status" in ('pending','succeeded','rejected','failed'))
);
--> statement-breakpoint
CREATE TABLE "voice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"config_version_id" uuid NOT NULL,
	"restart_of_session_id" uuid,
	"provider_realtime_call_id" text,
	"created_by" uuid NOT NULL,
	"capability_hash" text NOT NULL,
	"mode" varchar(12) NOT NULL,
	"transport" varchar(12) NOT NULL,
	"status" varchar(24) NOT NULL,
	"state_revision" integer DEFAULT 1 NOT NULL,
	"engine_state" jsonb NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"consent_at" timestamp with time zone,
	"consent_text_version" varchar(40),
	"admission_expires_at" timestamp with time zone,
	"max_end_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"reserved_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"usage_complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"outcome" varchar(80),
	CONSTRAINT "voice_sessions_provider_realtime_call_id_unique" UNIQUE("provider_realtime_call_id"),
	CONSTRAINT "sessions_tenant_id" UNIQUE("business_id","id"),
	CONSTRAINT "session_values" CHECK ("voice_sessions"."state_revision">0 and "voice_sessions"."sequence">=0 and "voice_sessions"."reserved_usd">=0 and "voice_sessions"."mode" in ('preview','real_test','integration','public') and "voice_sessions"."transport" in ('simulator','realtime') and "voice_sessions"."status" in ('admitted','connecting','active','closing','closed','failed','termination_unknown'))
);
--> statement-breakpoint
ALTER TABLE "action_proposals" DROP CONSTRAINT "proposal_values";--> statement-breakpoint
ALTER TABLE "action_proposals" ADD COLUMN "voice_session_id" uuid;--> statement-breakpoint
ALTER TABLE "action_proposals" ADD COLUMN "expected_state_revision" integer;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "voice_session_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_business_id_session_id_voice_sessions_business_id_id_fk" FOREIGN KEY ("business_id","session_id") REFERENCES "public"."voice_sessions"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptionist_config_versions" ADD CONSTRAINT "receptionist_config_versions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptionist_config_versions" ADD CONSTRAINT "receptionist_config_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptionist_configs" ADD CONSTRAINT "receptionist_configs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptionist_configs" ADD CONSTRAINT "receptionist_configs_business_id_draft_version_id_receptionist_config_versions_business_id_id_fk" FOREIGN KEY ("business_id","draft_version_id") REFERENCES "public"."receptionist_config_versions"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptionist_configs" ADD CONSTRAINT "receptionist_configs_business_id_published_version_id_receptionist_config_versions_business_id_id_fk" FOREIGN KEY ("business_id","published_version_id") REFERENCES "public"."receptionist_config_versions"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_business_id_session_id_voice_sessions_business_id_id_fk" FOREIGN KEY ("business_id","session_id") REFERENCES "public"."voice_sessions"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_business_id_proposal_id_action_proposals_business_id_id_fk" FOREIGN KEY ("business_id","proposal_id") REFERENCES "public"."action_proposals"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_business_id_config_version_id_receptionist_config_versions_business_id_id_fk" FOREIGN KEY ("business_id","config_version_id") REFERENCES "public"."receptionist_config_versions"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "config_one_draft" ON "receptionist_config_versions" USING btree ("business_id") WHERE "receptionist_config_versions"."status"='draft';--> statement-breakpoint
CREATE INDEX "tools_session_time" ON "tool_executions" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_business_time" ON "voice_sessions" USING btree ("business_id","created_at");--> statement-breakpoint
ALTER TABLE "action_proposals" ADD CONSTRAINT "proposal_values" CHECK ("action_proposals"."revision">0 and "action_proposals"."actor_kind" in ('owner','form','management','session') and "action_proposals"."status" in ('prepared','awaiting_confirmation','confirmed','committed','rejected','expired'));
--> statement-breakpoint
ALTER TABLE action_proposals ADD CONSTRAINT proposals_session_tenant_fk FOREIGN KEY (business_id,voice_session_id) REFERENCES voice_sessions(business_id,id);
--> statement-breakpoint
ALTER TABLE inquiries ADD CONSTRAINT inquiries_session_tenant_fk FOREIGN KEY (business_id,voice_session_id) REFERENCES voice_sessions(business_id,id);
--> statement-breakpoint
ALTER TABLE voice_sessions ADD CONSTRAINT session_restart_tenant_fk FOREIGN KEY (business_id,restart_of_session_id) REFERENCES voice_sessions(business_id,id);
--> statement-breakpoint
ALTER TABLE receptionist_config_versions ADD CONSTRAINT config_source_tenant_fk FOREIGN KEY (business_id,source_draft_id) REFERENCES receptionist_config_versions(business_id,id);
--> statement-breakpoint
CREATE FUNCTION immutable_config_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'draft' THEN RAISE EXCEPTION 'Configuration snapshots are immutable' USING ERRCODE='23514'; END IF;
 IF NEW.status<>'draft' THEN RAISE EXCEPTION 'Copy a draft to create a snapshot' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER immutable_configuration BEFORE UPDATE ON receptionist_config_versions FOR EACH ROW EXECUTE FUNCTION immutable_config_snapshot();
