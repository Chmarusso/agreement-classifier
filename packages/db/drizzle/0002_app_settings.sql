CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
