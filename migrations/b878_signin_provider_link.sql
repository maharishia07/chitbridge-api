-- b878_signin_provider_link.sql — SEC-112 P0 (17 Nov 2026): the link between a person's account and a provider identity (Google, Microsoft), and the ONE pre-binding door that finds it.
--
-- ⚠️ NOT RUN anywhere · Athi runs it AS postgres (Supabase SQL editor), SIT first. Safe to repeat. Additive: one table, one function, grants. No existing row or table is touched.
--    The api is correct BEFORE and AFTER it runs: until it runs, GET /api/signin/providers answers an empty list (the buttons stay hidden) and no provider door opens (lib/signin-provider-store.js checks, never a 500).
-- NUMBER. api main ends at b877 on the batch head 27820237; no branch holds b878 (git log --all over migrations/b87* to b9*, 17 Nov). cb-db reserves the final number on the day: rename before landing if another round took it.
-- LOOKED AT (DISCIPLINES 4a): identities (the FK; ON DELETE CASCADE so a removed account takes its links), signin_events (b282, same binding), ops.signin_candidates (b857, the template of the door below).
-- OWNER: lib/signin-provider-store.js (the pre-binding read of provider links); routes/signin-provider.js (the sign-in callback)
-- WHAT IT IS.
--    public.signin_provider_link  one row per (account, provider): issuer + tenant + subject is the link key (Google sub; Microsoft tid + oid). The e-mail is what the provider SAID, never an identifier.
--    ops.signin_provider_links    the sign-in callback has no shop yet (the person is not signed in): this SECURITY DEFINER door answers, for one exact (provider, issuer, tenant, subject), up to 10 rows of
--                                 (link_id, identity_id, entity_id). No wildcard; an empty or NULL argument answers nothing. Same shape and grants as b857.
-- UNIQUE. (identity_id, provider): one Google per account. (provider, issuer, tenant, subject, identity_id): the subject alone is NOT unique, one Google account may link two shops; identity_id is in the key so an
--    insert can never tell shop B that shop A holds the same subject (no existence oracle).
-- RLS: ENABLE + FORCE. One policy, USING and WITH CHECK: entity_id = app.current_entity (the binding of signin_events). An unbound connection sees no row. Writes go through withEntity(entity_id).
--    cb_app: SELECT, INSERT, DELETE (unlink deletes: nothing of the provider is kept) and UPDATE on the five columns a later sign-in refreshes only.
-- ROLL BACK:  DROP FUNCTION IF EXISTS ops.signin_provider_links(text, text, text, text);  DROP TABLE IF EXISTS public.signin_provider_link;   (nothing else reads either)
-- CHECK (read-only, every row ok = true):
--    SELECT 'table forced RLS' AS what, (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.signin_provider_link'::regclass) AS ok
--    UNION ALL SELECT 'door: definer, pinned path, closed to anon and authenticated, open to cb_app',
--           p.prosecdef AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c = 'search_path=""') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
--           AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND has_function_privilege('cb_app', p.oid, 'EXECUTE')
--      FROM pg_proc p WHERE p.oid = 'ops.signin_provider_links(text,text,text,text)'::regprocedure
--    UNION ALL SELECT 'cb_app: no table-wide UPDATE, the subject can never be changed', NOT has_table_privilege('cb_app', 'public.signin_provider_link', 'UPDATE')
--           AND has_column_privilege('cb_app', 'public.signin_provider_link', 'last_used_at', 'UPDATE') AND NOT has_column_privilege('cb_app', 'public.signin_provider_link', 'subject', 'UPDATE');

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.signin_provider_link (
  link_id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      uuid        NOT NULL,
  identity_id    uuid        NOT NULL,
  provider       text        NOT NULL CHECK (provider ~ '^[a-z0-9_]{2,32}$'),
  issuer         text        NOT NULL CHECK (length(issuer) BETWEEN 1 AND 300),
  tenant         text        NOT NULL DEFAULT '' CHECK (length(tenant) <= 100),
  subject        text        NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  subject_alt    text        CHECK (subject_alt IS NULL OR length(subject_alt) <= 255),
  org            text        CHECK (org IS NULL OR length(org) <= 255),
  email          text        CHECK (email IS NULL OR length(email) <= 320),
  email_verified boolean     NOT NULL DEFAULT false,
  display_name   text        CHECK (display_name IS NULL OR length(display_name) <= 200),
  linked_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz,
  linked_by      uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS signin_provider_link_one_per_provider_uq ON public.signin_provider_link (identity_id, provider);
CREATE UNIQUE INDEX IF NOT EXISTS signin_provider_link_key_uq ON public.signin_provider_link (provider, issuer, tenant, subject, identity_id);
-- the callback's lookup by (provider, issuer, tenant, subject) is served by the leading columns of signin_provider_link_key_uq above (a second index would be a prefix of it)
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signin_provider_link_identity_fk') THEN
    ALTER TABLE public.signin_provider_link ADD CONSTRAINT signin_provider_link_identity_fk FOREIGN KEY (identity_id) REFERENCES public.identities(identity_id) ON DELETE CASCADE;
  END IF;
END $fk$;
CREATE INDEX IF NOT EXISTS signin_provider_link_entity_idx ON public.signin_provider_link (entity_id, identity_id);

ALTER TABLE public.signin_provider_link ENABLE ROW LEVEL SECURITY;  ALTER TABLE public.signin_provider_link FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS signin_provider_link_entity ON public.signin_provider_link;
CREATE POLICY signin_provider_link_entity ON public.signin_provider_link
  USING (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

GRANT SELECT, INSERT, DELETE ON public.signin_provider_link TO cb_app;
GRANT UPDATE (email, email_verified, display_name, org, last_used_at) ON public.signin_provider_link TO cb_app;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'cb_backup') THEN
    GRANT SELECT ON public.signin_provider_link TO cb_backup;
  END IF;
END
$do$;

-- THE PRE-BINDING DOOR (template: b857). RETURNS TABLE cannot change its row type under CREATE OR REPLACE, so a re-run drops first; the grants go back in this transaction.
DROP FUNCTION IF EXISTS ops.signin_provider_links(text, text, text, text);
CREATE OR REPLACE FUNCTION ops.signin_provider_links(p_provider text, p_issuer text, p_tenant text, p_subject text)
RETURNS TABLE (link_id uuid, identity_id uuid, entity_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
#variable_conflict use_column
BEGIN
  IF p_provider IS NULL OR p_issuer IS NULL OR p_tenant IS NULL OR p_subject IS NULL
     OR pg_catalog.length(pg_catalog.btrim(p_provider)) = 0 OR pg_catalog.length(pg_catalog.btrim(p_issuer)) = 0 OR pg_catalog.length(pg_catalog.btrim(p_subject)) = 0 THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT l.link_id, l.identity_id, l.entity_id
    FROM public.signin_provider_link l
    WHERE l.provider = p_provider AND l.issuer = p_issuer AND l.tenant = p_tenant AND l.subject = p_subject
    ORDER BY l.identity_id LIMIT 10;
END
$fn$;

REVOKE ALL ON FUNCTION ops.signin_provider_links(text, text, text, text) FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION ops.signin_provider_links(text, text, text, text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION ops.signin_provider_links(text, text, text, text) FROM authenticated;
  END IF;
END
$do$;
GRANT USAGE ON SCHEMA ops TO cb_app;
GRANT EXECUTE ON FUNCTION ops.signin_provider_links(text, text, text, text) TO cb_app;

COMMIT;
