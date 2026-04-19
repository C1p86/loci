CREATE TABLE "task_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"task_id" text NOT NULL,
	"task_snapshot" jsonb NOT NULL,
	"param_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"agent_id" text,
	"exit_code" integer,
	"triggered_by_user_id" text,
	"trigger_source" text DEFAULT 'manual' NOT NULL,
	"timeout_seconds" integer DEFAULT 3600 NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "max_concurrent" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "default_timeout_seconds" integer;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_runs_org_state_idx" ON "task_runs" USING btree ("org_id","state");--> statement-breakpoint
CREATE INDEX "task_runs_agent_state_idx" ON "task_runs" USING btree ("agent_id","state");--> statement-breakpoint
CREATE INDEX "task_runs_state_queued_idx" ON "task_runs" USING btree ("state","queued_at");--> statement-breakpoint
CREATE INDEX "task_runs_state_dispatched_idx" ON "task_runs" USING btree ("state","dispatched_at");