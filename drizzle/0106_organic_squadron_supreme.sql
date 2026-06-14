ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'vip_group_usage';--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "reject_streaming_content_length" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "reject_streaming_zero_usage" boolean DEFAULT false NOT NULL;
