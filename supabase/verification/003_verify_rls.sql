-- Run this through the same trusted database role used by the application.
-- The first result must show the expected role with rolbypassrls = true.
SELECT current_user AS connected_role, rolbypassrls
FROM pg_roles
WHERE rolname = current_user;

-- This query must return no rows: every public table must have RLS enabled.
SELECT n.nspname AS schema_name, c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relrowsecurity IS NOT TRUE
ORDER BY c.relname;

-- This query must return no rows: anon/authenticated must have no table grants.
SELECT g.table_name, g.grantee, g.privilege_type
FROM information_schema.role_table_grants AS g
JOIN pg_class AS c ON c.relname = g.table_name
JOIN pg_namespace AS n ON n.oid = c.relnamespace AND n.nspname = g.table_schema
WHERE g.table_schema = 'public'
  AND g.grantee IN ('anon', 'authenticated')
  AND c.relkind IN ('r', 'p')
ORDER BY g.table_name, g.grantee, g.privilege_type;

-- This query must return no rows: future public tables get no grants either.
SELECT d.defaclrole::regrole AS creator_role, r.rolname AS grantee, a.privilege_type
FROM pg_default_acl AS d
CROSS JOIN LATERAL aclexplode(d.defaclacl) AS a
JOIN pg_roles AS r ON r.oid = a.grantee
WHERE d.defaclnamespace = 'public'::regnamespace
  AND d.defaclobjtype = 'r'
  AND r.rolname IN ('anon', 'authenticated')
ORDER BY creator_role, grantee, a.privilege_type;
