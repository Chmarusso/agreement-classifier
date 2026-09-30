ALTER TABLE "rule_versions" ADD COLUMN "languages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "languages" jsonb DEFAULT '[]'::jsonb NOT NULL;