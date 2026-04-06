DO $$
BEGIN
  ALTER TYPE "public"."notification_type" ADD VALUE 'vip_group_usage';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
