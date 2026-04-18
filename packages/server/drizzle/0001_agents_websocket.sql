CREATE TABLE "agent_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"org_id" text NOT NULL,
	"credential_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"hostname" text NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'offline' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_tokens" ADD CONSTRAINT "registration_tokens_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_tokens" ADD CONSTRAINT "registration_tokens_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_credentials_one_active_per_agent" ON "agent_credentials" USING btree ("agent_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "agent_credentials_org_agent_idx" ON "agent_credentials" USING btree ("org_id","agent_id");--> statement-breakpoint
CREATE INDEX "agents_org_state_idx" ON "agents" USING btree ("org_id","state");--> statement-breakpoint
CREATE INDEX "registration_tokens_org_idx" ON "registration_tokens" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "registration_tokens_active_idx" ON "registration_tokens" USING btree ("org_id") WHERE consumed_at IS NULL AND expires_at > now();