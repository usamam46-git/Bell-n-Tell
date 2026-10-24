CREATE TABLE "action_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"actor_kind" varchar(12) NOT NULL,
	"actor_id" text NOT NULL,
	"kind" varchar(30) NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"scheduling_revision" integer,
	"appointment_id" uuid,
	"appointment_revision" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"status" varchar(24) DEFAULT 'prepared' NOT NULL,
	"confirmation" jsonb,
	"request_key" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	CONSTRAINT "proposals_tenant_id" UNIQUE("business_id","id"),
	CONSTRAINT "proposal_values" CHECK ("action_proposals"."revision">0 and "action_proposals"."actor_kind" in ('owner','form','management') and "action_proposals"."status" in ('prepared','awaiting_confirmation','confirmed','committed','rejected','expired'))
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"customer_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" varchar(100) NOT NULL,
	"service_name" varchar(100) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"price_text" varchar(200) NOT NULL,
	"status" varchar(12) DEFAULT 'confirmed' NOT NULL,
	"source" varchar(12) NOT NULL,
	"booking_ref" varchar(60) NOT NULL,
	"manage_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_tenant_id" UNIQUE("business_id","id"),
	CONSTRAINT "appointments_reference" UNIQUE("business_id","booking_ref"),
	CONSTRAINT "appointment_values" CHECK ("appointments"."revision">0 and "appointments"."ends_at">"appointments"."starts_at" and "appointments"."duration_minutes" between 5 and 480 and "appointments"."duration_minutes"%5=0 and "appointments"."status" in ('confirmed','cancelled','completed','no_show') and "appointments"."source" in ('voice','owner','owner_test'))
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_kind" varchar(12) NOT NULL,
	"actor_id" text NOT NULL,
	"operation" varchar(80) NOT NULL,
	"target_type" varchar(40) NOT NULL,
	"target_id" uuid,
	"safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outcome" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_tenant_id" UNIQUE("business_id","id")
);
--> statement-breakpoint
CREATE TABLE "availability_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"resource_id" uuid,
	"local_date" date NOT NULL,
	"kind" varchar(6) NOT NULL,
	"start" time,
	"end" time,
	CONSTRAINT "overrides_tenant_id" UNIQUE("business_id","id"),
	CONSTRAINT "overrides_values" CHECK (("availability_overrides"."kind"='closed' and "availability_overrides"."start" is null and "availability_overrides"."end" is null) or ("availability_overrides"."kind"='open' and "availability_overrides"."start" is not null and "availability_overrides"."end" is not null and "availability_overrides"."start"<"availability_overrides"."end"))
);
--> statement-breakpoint
CREATE TABLE "business_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start" time NOT NULL,
	"end" time NOT NULL,
	CONSTRAINT "hours_tenant_id" UNIQUE("business_id","id"),
	CONSTRAINT "hours_values" CHECK ("business_hours"."weekday" between 0 and 6 and "business_hours"."start"<"business_hours"."end")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"name" varchar(100) NOT NULL,
	"phone_e164" varchar(16),
	"email" varchar(254),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_tenant_id" UNIQUE("business_id","id"),
	CONSTRAINT "customer_values" CHECK ("customers"."revision">0 and length(trim("customers"."name"))>0 and ("customers"."phone_e164" is not null or "customers"."email" is not null) and ("customers"."phone_e164" is null or "customers"."phone_e164" ~ '^[+][1-9][0-9]{7,14}$') and ("customers"."email" is null or length(trim("customers"."email"))>0))
);
--> statement-breakpoint
CREATE TABLE "inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"customer_id" uuid,
	"type" varchar(8) NOT NULL,
	"summary" varchar(2000) NOT NULL,
	"owner_note" varchar(2000),
	"status" varchar(12) DEFAULT 'new' NOT NULL,
	"source" varchar(12) NOT NULL,
	"consent_version" varchar(30) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inquiries_tenant_id" UNIQUE("business_id","id"),
	CONSTRAINT "inquiry_values" CHECK ("inquiries"."revision">0 and "inquiries"."type" in ('lead','callback') and "inquiries"."status" in ('new','in_progress','resolved') and length(trim("inquiries"."summary"))>0 and "inquiries"."source" in ('form','owner','voice'))
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "resources_tenant_id" UNIQUE("business_id","id"),
	CONSTRAINT "resource_values" CHECK ("resources"."revision">0 and length(trim("resources"."display_name"))>0)
);
--> statement-breakpoint
CREATE TABLE "scheduling_policies" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"slot_minutes" integer DEFAULT 15 NOT NULL,
	"notice_minutes" integer DEFAULT 60 NOT NULL,
	"horizon_days" integer DEFAULT 60 NOT NULL,
	"cutoff_minutes" integer DEFAULT 1440 NOT NULL,
	CONSTRAINT "policy_values" CHECK ("scheduling_policies"."revision">0 and "scheduling_policies"."slot_minutes" in (5,10,15,30,60) and "scheduling_policies"."notice_minutes" between 0 and 10080 and "scheduling_policies"."horizon_days" between 1 and 180 and "scheduling_policies"."cutoff_minutes" between 0 and 10080)
);
--> statement-breakpoint
CREATE TABLE "service_resources" (
	"business_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	CONSTRAINT "service_resources_business_id_service_id_resource_id_pk" PRIMARY KEY("business_id","service_id","resource_id")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"name" varchar(100) NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"public_description" varchar(2000) DEFAULT '' NOT NULL,
	"price_text" varchar(200) DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "services_tenant_id" UNIQUE("business_id","id"),
	CONSTRAINT "service_values" CHECK ("services"."revision">0 and length(trim("services"."name"))>0 and "services"."duration_minutes" between 5 and 480 and "services"."duration_minutes"%5=0)
);
--> statement-breakpoint
ALTER TABLE "action_proposals" ADD CONSTRAINT "action_proposals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposals" ADD CONSTRAINT "action_proposals_business_id_appointment_id_appointments_business_id_id_fk" FOREIGN KEY ("business_id","appointment_id") REFERENCES "public"."appointments"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_customer_id_customers_business_id_id_fk" FOREIGN KEY ("business_id","customer_id") REFERENCES "public"."customers"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_service_id_services_business_id_id_fk" FOREIGN KEY ("business_id","service_id") REFERENCES "public"."services"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_resource_id_resources_business_id_id_fk" FOREIGN KEY ("business_id","resource_id") REFERENCES "public"."resources"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_overrides" ADD CONSTRAINT "availability_overrides_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_overrides" ADD CONSTRAINT "availability_overrides_business_id_resource_id_resources_business_id_id_fk" FOREIGN KEY ("business_id","resource_id") REFERENCES "public"."resources"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_business_id_customer_id_customers_business_id_id_fk" FOREIGN KEY ("business_id","customer_id") REFERENCES "public"."customers"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_policies" ADD CONSTRAINT "scheduling_policies_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_business_id_service_id_services_business_id_id_fk" FOREIGN KEY ("business_id","service_id") REFERENCES "public"."services"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_business_id_resource_id_resources_business_id_id_fk" FOREIGN KEY ("business_id","resource_id") REFERENCES "public"."resources"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_request_key" ON "action_proposals" USING btree ("business_id","request_key") WHERE "action_proposals"."request_key" is not null;--> statement-breakpoint
CREATE INDEX "proposals_expiry" ON "action_proposals" USING btree ("business_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "appointments_schedule" ON "appointments" USING btree ("business_id","starts_at","status");--> statement-breakpoint
CREATE INDEX "appointments_customer" ON "appointments" USING btree ("business_id","customer_id");--> statement-breakpoint
CREATE INDEX "audit_business_time" ON "audit_events" USING btree ("business_id","created_at","operation");--> statement-breakpoint
CREATE INDEX "overrides_date" ON "availability_overrides" USING btree ("business_id","local_date","resource_id");--> statement-breakpoint
CREATE INDEX "customers_phone" ON "customers" USING btree ("business_id","phone_e164");--> statement-breakpoint
CREATE INDEX "customers_email" ON "customers" USING btree ("business_id","email");--> statement-breakpoint
CREATE INDEX "inquiries_status" ON "inquiries" USING btree ("business_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "resources_active_name" ON "resources" USING btree ("business_id",lower(trim("display_name"))) WHERE "resources"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "services_active_name" ON "services" USING btree ("business_id",lower(trim("name"))) WHERE "services"."active";
--> statement-breakpoint
INSERT INTO scheduling_policies (business_id) SELECT id FROM businesses ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap EXCLUDE USING gist
 (business_id WITH =, resource_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&)
 WHERE (status='confirmed');
--> statement-breakpoint
ALTER TABLE business_hours ADD CONSTRAINT hours_no_overlap EXCLUDE USING gist
 (business_id WITH =, weekday WITH =, int4range(extract(epoch from start)::integer,extract(epoch from "end")::integer,'[)') WITH &&);
--> statement-breakpoint
ALTER TABLE availability_overrides ADD CONSTRAINT overrides_no_overlap EXCLUDE USING gist
 (business_id WITH =, (coalesce(resource_id,'00000000-0000-0000-0000-000000000000'::uuid)) WITH =, local_date WITH =,
 int4range(extract(epoch from start)::integer,extract(epoch from "end")::integer,'[)') WITH &&) WHERE (kind='open');
--> statement-breakpoint
CREATE UNIQUE INDEX overrides_one_closed ON availability_overrides
 (business_id,coalesce(resource_id,'00000000-0000-0000-0000-000000000000'::uuid),local_date) WHERE kind='closed';
--> statement-breakpoint
CREATE FUNCTION enforce_override_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM business_id FROM scheduling_policies WHERE business_id=NEW.business_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM availability_overrides WHERE business_id=NEW.business_id
  AND resource_id IS NOT DISTINCT FROM NEW.resource_id AND local_date=NEW.local_date AND id<>NEW.id AND kind<>NEW.kind) THEN
  RAISE EXCEPTION 'Date scope cannot be both closed and open' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER override_scope_consistency BEFORE INSERT OR UPDATE ON availability_overrides FOR EACH ROW EXECUTE FUNCTION enforce_override_scope();
