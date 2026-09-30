CREATE TABLE "agreement_texts" (
	"agreement_id" uuid PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"text_sha256" text NOT NULL,
	"extractor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agreements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"format" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"agreement_type" text NOT NULL,
	"extraction_status" text NOT NULL,
	"extraction_error" text,
	"char_count" integer,
	"page_count" integer,
	"uploaded_by" uuid,
	"latest_run_id" uuid,
	"latest_run_status" text,
	"latest_verdict" text,
	"total_cost_usd" double precision DEFAULT 0 NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_run_prompts" (
	"run_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"model" text NOT NULL,
	"system_prompt" text NOT NULL,
	"prompt" text NOT NULL,
	"prompt_sha256" text NOT NULL,
	"raw_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_run_prompts_run_id_attempt_no_pk" PRIMARY KEY("run_id","attempt_no")
);
--> statement-breakpoint
CREATE TABLE "audit_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agreement_id" uuid NOT NULL,
	"status" text NOT NULL,
	"model" text NOT NULL,
	"rule_snapshot" jsonb NOT NULL,
	"verdict" text,
	"summary" text,
	"findings" jsonb,
	"agreement_metadata" jsonb,
	"failure_reason" text,
	"model_calls" integer DEFAULT 0 NOT NULL,
	"rejected_outputs" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" double precision DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"model_duration_ms" integer DEFAULT 0 NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_versions" (
	"rule_id" uuid NOT NULL,
	"content_version" integer NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"severity" text NOT NULL,
	"category" text NOT NULL,
	"applies_to" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rule_versions_rule_id_content_version_pk" PRIMARY KEY("rule_id","content_version")
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"severity" text NOT NULL,
	"category" text NOT NULL,
	"applies_to" jsonb NOT NULL,
	"status" text NOT NULL,
	"version" integer NOT NULL,
	"content_version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agreements_created_idx" ON "agreements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_runs_agreement_idx" ON "audit_runs" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX "audit_runs_requested_idx" ON "audit_runs" USING btree ("requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rules_slug_uq" ON "rules" USING btree ("slug");