-- b839_party_contact.sql — SEC-130 residual (7 Nov 2026): the e-mail a shop keeps for a party gets its own shop-scoped home.
--
-- ⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres), BEFORE b840. Run once (a second run stops at CREATE TABLE, harmlessly). Touches no existing row.
--    The code deploys before or after it: while the table is absent nothing is written to identities either (lib/party-contact.js ready()), and the
--    party e-mail reads fall back to identities.email.
--
-- WHY. A party e-mail was written to identities.email, one global UNIQUE column, so a second shop typing an address the first had saved was refused,
--    and the refusal told it that address exists elsewhere (SEC-130, proven on SIT 2026-11-01). The address is the shop's contact data, not a sign-in:
--    here it is per shop and NOT unique. party_tax_id is the pattern (owner, party, key, value; FORCE RLS; rls_entity); its value is unique per
--    shop, which is right for a tax id and wrong for an e-mail, so this is a table of its own. `channel` lets a later second contact widen it.
--
-- ROLL BACK: DROP TABLE party_contact;   (nothing reads it until the code is deployed; b840 keeps the copy before it clears identities.email.)
-- CHECK (read-only): SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'party_contact';   Expect true, true.
-- RLS: ENABLE + FORCE, policy rls_entity on app.current_entity, exactly as party_tax_id. Grants as party_tax_id: cb_app SELECT/INSERT/UPDATE/DELETE, cb_backup SELECT.
-- PERSONAL DATA: an e-mail address. Held for the shop that typed it, removed with the party's row at erase time (the privacy erase list takes this table).

-- OWNER: lib/party-contact.js
CREATE TABLE party_contact (
  owner_entity_id uuid NOT NULL,
  party_id        uuid NOT NULL REFERENCES identities (identity_id),
  channel         text NOT NULL CHECK (channel IN ('email')),
  value           text NOT NULL CHECK (char_length(value) BETWEEN 3 AND 254),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_entity_id, party_id, channel)
);

CREATE INDEX IF NOT EXISTS ix_fk_party_contact_party ON party_contact (party_id);
-- NOT unique: a household or an accountant may share one address; the within-shop "same address" note reads this index.
CREATE INDEX IF NOT EXISTS party_contact_value_ix ON party_contact (owner_entity_id, lower(value));

ALTER TABLE party_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_contact FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON party_contact;
CREATE POLICY rls_entity ON party_contact
  USING (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON party_contact TO cb_app;
GRANT SELECT ON party_contact TO cb_backup;
