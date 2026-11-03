-- =============================================================================
-- Row-Level Security (RLS): database-enforced tenant isolation
--
-- The API connects as `app_user`, a role WITHOUT superuser/BYPASSRLS rights.
-- Every request runs inside a transaction that first sets:
--     set_config('app.tenant_id', '<tenant uuid>', true)   -- transaction-local
-- The policies below then make rows of every other tenant invisible, even if
-- application code forgets a `where: { tenantId }` filter.
-- =============================================================================

-- 1. Application role (created without a password here; the password is set by
--    the deployment, e.g. docker/postgres/init.sql, never committed in a migration)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- Global tables: plans are read-only for the app
REVOKE INSERT, UPDATE, DELETE ON "Plan" FROM app_user;

-- Audit log is APPEND-ONLY for the app: it can write and read, never edit or erase history
REVOKE UPDATE, DELETE ON "AuditLog" FROM app_user;

-- 2. Helper functions that read the per-transaction context
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '') $$;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '') $$;

CREATE OR REPLACE FUNCTION app_current_invite_token() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.invite_token', true), '') $$;

-- 3. Standard tenant isolation policy on purely tenant-owned tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Subscription', 'Customer', 'Invoice', 'InvoiceItem', 'Payment', 'AuditLog']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING ("tenantId" = app_current_tenant())
         WITH CHECK ("tenantId" = app_current_tenant())', t);
  END LOOP;
END
$$;

-- 4. Membership: visible inside the current tenant, OR the signed-in user's own
--    memberships (needed for login / "switch company"). Writes only in current tenant.
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON "Membership" FOR SELECT
  USING ("tenantId" = app_current_tenant() OR "userId" = app_current_user());
CREATE POLICY membership_write ON "Membership" FOR INSERT
  WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY membership_update ON "Membership" FOR UPDATE
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY membership_delete ON "Membership" FOR DELETE
  USING ("tenantId" = app_current_tenant());

-- 5. Invitation: visible inside the current tenant, OR by its secret token
--    (the public "accept invitation" page knows only the token).
ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation" FORCE ROW LEVEL SECURITY;
CREATE POLICY invitation_read ON "Invitation" FOR SELECT
  USING ("tenantId" = app_current_tenant() OR "token" = app_current_invite_token());
CREATE POLICY invitation_insert ON "Invitation" FOR INSERT
  WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY invitation_update ON "Invitation" FOR UPDATE
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
CREATE POLICY invitation_delete ON "Invitation" FOR DELETE
  USING ("tenantId" = app_current_tenant());

-- 6. Tables created by future migrations get the same base grants
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
