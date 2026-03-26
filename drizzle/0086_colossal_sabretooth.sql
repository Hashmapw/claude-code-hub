DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE t.typname = 'notification_type'
      AND n.nspname = 'public'
      AND e.enumlabel = 'vip_group_usage'
  ) THEN
    ALTER TYPE "public"."notification_type" ADD VALUE 'vip_group_usage';
  END IF;
END
$$;
