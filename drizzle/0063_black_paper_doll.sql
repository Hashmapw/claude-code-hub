ALTER TABLE "notification_settings" ADD COLUMN IF NOT EXISTS "vip_group_usage_cooldown" integer DEFAULT 300 NOT NULL;
