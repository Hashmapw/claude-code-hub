DO $$ BEGIN
  ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'vip_group_usage';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN IF NOT EXISTS "vip_group_usage_enabled" boolean DEFAULT false NOT NULL;
