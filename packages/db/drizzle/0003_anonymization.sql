ALTER TABLE "agreement_texts" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "agreement_texts" ADD COLUMN "anonymized_text" text;--> statement-breakpoint
ALTER TABLE "agreement_texts" ADD COLUMN "anonymization" jsonb;--> statement-breakpoint
ALTER TABLE "agreements" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "agreements" ADD COLUMN "anonymized_entity_count" integer;