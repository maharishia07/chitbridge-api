-- RUN-2026-11-16-identities-read-grant-party.sql — l16 integ2c-ident (cb-security). NOT auto-applied (RUN- prefix). Run AFTER RUN-2026-11-14-b860-identities-rls.sql, by Athi, in the editor.
-- WHY  b860 opens an identity row to its own tree, its creator and its counterparties. The firm (and the firm's people) that holds or HELD a books_access_grant on a shop are none of those,
--      so once b860 is on, the owner could no longer see WHO on the firm acted on their books (by_name on an entry or a bank mark): the audit trail would read blank.
--      This arm lets a shop READ (SELECT only) the firm's identity row and the firm's people, for any grant row it is the grantor of; a revoked grant still counts (past actions stay named). No write arm.
-- RISK a SELECT policy only; books_access_grant is read under the same binding (the grantor sees its own grants). Rollback: DROP POLICY identities_read_grant_party ON identities;
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP POLICY IF EXISTS identities_read_grant_party ON identities;
CREATE POLICY identities_read_grant_party ON identities FOR SELECT
  USING (identity_id IN (SELECT g.grantee_entity FROM books_access_grant g WHERE g.grantor_entity = NULLIF(current_setting('app.current_entity', true), '')::uuid)
         OR parent_entity_id IN (SELECT g.grantee_entity FROM books_access_grant g WHERE g.grantor_entity = NULLIF(current_setting('app.current_entity', true), '')::uuid));
COMMIT;
