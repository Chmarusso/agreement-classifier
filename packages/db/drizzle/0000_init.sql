CREATE TABLE "audit_log" (
	"global_position" bigint PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_id" uuid,
	"actor_label" text NOT NULL,
	"actor_type" text NOT NULL,
	"event_type" text NOT NULL,
	"stream_type" text NOT NULL,
	"stream_id" uuid NOT NULL,
	"entity_label" text,
	"summary" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"payload" jsonb NOT NULL,
	"metadata" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"global_position" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"stream_type" text NOT NULL,
	"stream_id" uuid NOT NULL,
	"stream_version" integer NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"metadata" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_event_id_uq" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"source_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection_checkpoints" (
	"name" text PRIMARY KEY NOT NULL,
	"last_position" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"version" integer NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"hostname" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_time_idx" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_type_idx" ON "audit_log" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "audit_log_stream_idx" ON "audit_log" USING btree ("stream_type","stream_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_stream_version_uq" ON "events" USING btree ("stream_type","stream_id","stream_version");--> statement-breakpoint
CREATE INDEX "events_stream_idx" ON "events" USING btree ("stream_type","stream_id");--> statement-breakpoint
CREATE INDEX "events_type_time_idx" ON "events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "events_time_idx" ON "events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "events_metadata_gin" ON "events" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "jobs_pending_idx" ON "jobs" USING btree ("run_after") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "jobs_running_idx" ON "jobs" USING btree ("locked_until") WHERE status = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");