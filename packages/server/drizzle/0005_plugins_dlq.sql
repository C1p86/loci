CREATE TABLE "dlq_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"plugin_name" text NOT NULL,
	"delivery_id" text,
	"failure_reason" text NOT NULL,
	"scrubbed_body" jsonb NOT NULL,
	"scrubbed_headers" jsonb NOT NULL,
	"http_status" integer,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retried_at" timestamp with time zone,
	"retry_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"plugin_name" text NOT NULL,
	"delivery_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"plugin_name" text NOT NULL,
	"token_hash" text NOT NULL,
	"plugin_secret_encrypted" "bytea",
	"plugin_secret_iv" "bytea",
	"plugin_secret_tag" "bytea",
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "trigger_configs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "dlq_entries" ADD CONSTRAINT "dlq_entries_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_tokens" ADD CONSTRAINT "webhook_tokens_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_tokens" ADD CONSTRAINT "webhook_tokens_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dlq_entries_org_received_idx" ON "dlq_entries" USING btree ("org_id","received_at" desc);--> statement-breakpoint
CREATE INDEX "dlq_entries_plugin_delivery_idx" ON "dlq_entries" USING btree ("plugin_name","delivery_id") WHERE delivery_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_plugin_delivery_unique" ON "webhook_deliveries" USING btree ("plugin_name","delivery_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_received_idx" ON "webhook_deliveries" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_tokens_hash_active" ON "webhook_tokens" USING btree ("token_hash") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "webhook_tokens_org_plugin_idx" ON "webhook_tokens" USING btree ("org_id","plugin_name");