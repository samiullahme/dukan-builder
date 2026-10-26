-- DO NOT APPLY until the DB role is verified by the owner.
-- Run as the trusted schema owner used to create future public tables.
BEGIN;

DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT c.relname
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', 'public', table_name);
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM anon, authenticated',
      'public',
      table_name
    );
  END LOOP;
END
$$;

-- Applies to tables created later by the role running this migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;

COMMIT;
