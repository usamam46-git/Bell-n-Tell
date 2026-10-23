ALTER TABLE "businesses" ADD COLUMN "creation_key_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "creation_payload_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_creation_key_hash_unique" UNIQUE("creation_key_hash");