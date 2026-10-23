CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "business_memberships" (
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(10) NOT NULL,
	"status" varchar(10) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_memberships_business_id_user_id_pk" PRIMARY KEY("business_id","user_id"),
	CONSTRAINT "business_memberships_role_check" CHECK ("business_memberships"."role" in ('owner','manager','viewer')),
	CONSTRAINT "business_memberships_status_check" CHECK ("business_memberships"."status" in ('active','disabled'))
);
--> statement-breakpoint
CREATE TABLE "business_settings" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"public_email" varchar(254),
	"public_phone" varchar(40),
	"public_address" varchar(500),
	"public_website" varchar(500),
	"public_description" varchar(2000) DEFAULT '' NOT NULL,
	"faqs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"greeting" varchar(500) DEFAULT '' NOT NULL,
	"consent_source_copy" varchar(2000) DEFAULT '' NOT NULL,
	"transcript_retention_days" integer DEFAULT 30 NOT NULL,
	CONSTRAINT "business_settings_revision_positive" CHECK ("business_settings"."revision" > 0),
	CONSTRAINT "business_settings_retention_range" CHECK ("business_settings"."transcript_retention_days" between 1 and 30)
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"timezone" varchar(100) NOT NULL,
	"status" varchar(10) DEFAULT 'setup' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_slug_unique" UNIQUE("slug"),
	CONSTRAINT "businesses_status_check" CHECK ("businesses"."status" in ('setup','active','paused')),
	CONSTRAINT "businesses_revision_positive" CHECK ("businesses"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "security_throttles" (
	"scope" varchar(40) NOT NULL,
	"hashed_subject_key" varchar(64) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone,
	CONSTRAINT "security_throttles_scope_hashed_subject_key_window_start_pk" PRIMARY KEY("scope","hashed_subject_key","window_start"),
	CONSTRAINT "security_throttles_count_positive" CHECK ("security_throttles"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"recovery_code_hash" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_user_expiry_idx" ON "auth_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "security_throttles_expiry_idx" ON "security_throttles" USING btree ("blocked_until");