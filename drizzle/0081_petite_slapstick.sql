ALTER TYPE "public"."notification_type" ADD VALUE 'vip_group_usage';--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "vip_group_usage_enabled" boolean DEFAULT false NOT NULL;