-- b911_signin_provider_link_identity_bind.sql — M2 of review GF-platform-01 (22 Nov 2026): a provider link may only name an identity that BELONGS to the link's own entity.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first. RUN AFTER b878 (it adds a trigger to public.signin_provider_link) and before any code writes a link. Safe to repeat
--    (CREATE OR REPLACE, DROP TRIGGER IF EXISTS). Touches no row and no column. If b878 has not run, the file does nothing and says so (NOTICE).
-- FIXES. b878's policy checked only entity_id = app.current_entity and its FK only that identity_id exists. A shop session could INSERT (its own entity_id, ANOTHER shop's identity_id, its own Google subject);
--    ops.signin_provider_links() then answers (victim identity, attacker entity) for the attacker's Google sign-in. LATENT today: no api route writes a link yet (lib/signin-provider-store.js only reads it),
--    so nothing on SIT or production is exploited; this closes it in the database before the writing route lands.
-- WHAT. A BEFORE INSERT OR UPDATE OF (entity_id, identity_id) trigger refuses a row unless the identity is the entity itself (identities.identity_id = entity_id) or one of its people (identities.parent_entity_id = entity_id).
--    SECURITY DEFINER with an empty search_path so the check reads identities whatever the caller's grants are. A refusal is SQLSTATE 23514 'signin_provider_link: identity does not belong to the entity'.
--    The duplicate-key oracle (insert answers "already linked" for another shop's identity) closes too: the bind check runs before the unique index is tried.
-- ROLL BACK: DROP TRIGGER IF EXISTS signin_provider_link_identity_bind ON public.signin_provider_link;  DROP FUNCTION IF EXISTS public.signin_provider_link_identity_bind();
-- CHECK 1 (read-only, any database; true = in place): SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'signin_provider_link_identity_bind' AND NOT tgisinternal) AS ok;
-- CHECK 2 (read-only; run on production BEFORE b911 if b878 ran there: any row listed is a link already pointing across shops, report it to cb-security, do not delete):
--    SELECT l.link_id, l.entity_id, l.identity_id FROM public.signin_provider_link l LEFT JOIN public.identities i ON i.identity_id = l.identity_id
--     WHERE i.identity_id IS NULL OR NOT (i.identity_id = l.entity_id OR i.parent_entity_id = l.entity_id);   (0 rows)
-- RLS: unchanged (b878: enabled + forced, entity policy).

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $b911$
BEGIN
  IF to_regclass('public.signin_provider_link') IS NULL THEN
    RAISE NOTICE 'b911: public.signin_provider_link is absent (b878 has not run): nothing to guard yet; run b878, then this file again';
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION public.signin_provider_link_identity_bind() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.identities i
                    WHERE i.identity_id = NEW.identity_id
                      AND (i.identity_id = NEW.entity_id OR i.parent_entity_id = NEW.entity_id)) THEN
      RAISE EXCEPTION 'signin_provider_link: identity does not belong to the entity' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $fn$;
  REVOKE ALL ON FUNCTION public.signin_provider_link_identity_bind() FROM PUBLIC;

  DROP TRIGGER IF EXISTS signin_provider_link_identity_bind ON public.signin_provider_link;
  CREATE TRIGGER signin_provider_link_identity_bind
    BEFORE INSERT OR UPDATE OF entity_id, identity_id ON public.signin_provider_link
    FOR EACH ROW EXECUTE FUNCTION public.signin_provider_link_identity_bind();
END
$b911$;

COMMIT;
