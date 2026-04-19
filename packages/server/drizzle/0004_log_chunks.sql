CREATE TABLE "log_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"seq" integer NOT NULL,
	"stream" text NOT NULL,
	"data" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"persisted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "log_chunks" ADD CONSTRAINT "log_chunks_run_id_task_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."task_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "log_chunks_run_seq_unique" ON "log_chunks" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "log_chunks_persisted_at_idx" ON "log_chunks" USING btree ("persisted_at");