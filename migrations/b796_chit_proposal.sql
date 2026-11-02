-- b796_chit_proposal.sql — RAIL-106 part 4 (25 Oct 2026): ONE proposal mechanism for the seller's pro-forma, the buyer's counter and an amendment after agreement.
--
-- ⚠️⚠️ DRAFT — NOT RUN IN PRODUCTION · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (IF NOT EXISTS, DROP POLICY IF EXISTS then CREATE, DROP CONSTRAINT IF EXISTS then ADD).
--    The SIT kit's migrate job runs it on the SIT VMs. Touches no existing rows. Code checks the table (schema.hasTable) and refuses a proposal in words until this has run.
-- OWNER: lib/chit-proposal.js (chit_proposal)
-- schema-lint: allow R5 tax_note is a sentence ("Tax not decided: …"), not an amount
--
-- WHY A TABLE, AND WHY NOT chit_line_amendment. A proposal is a whole version of the chit's lines AND its priced invoice, in a round, waiting for the other party to accept, counter or reject.
-- chit_line_amendment is the APPLIED correction of one line (a row per line, the latest seq is live, every reader — liveSet, the work list, the delivery guards — treats every row as true now);
-- a proposed row there would read as agreed. It has no status, no round, no invoice. So a proposal waits in its own table and, on acceptance, is applied THROUGH chit_line_amendment
-- (lib/amend record, the one writer of corrections) and the header's invoice and money are set from the proposal, byte for byte.
-- Per copy, like every chit table: each party holds its own row of the same proposal_id (the other installation writes its own through the return path; one installation writes both).
--
-- RLS: ENABLE + FORCE, the rls_entity shape every chit table has (entity_id = app.current_entity).
-- Also widens ctp_event_out_kind_check (b791..b793) with the two kinds the return path carries for it: proposal, proposal_decide.

BEGIN;

CREATE TABLE IF NOT EXISTS chit_proposal (
  proposal_id      uuid        NOT NULL,
  entity_id        uuid        NOT NULL,                       -- whose copy of the proposal this row is (the RLS key)
  chit_id          uuid        NOT NULL,
  round            integer     NOT NULL CHECK (round >= 1),     -- ONE chit per deal: the chit (the buyer's request) is round 1, every version after it is the next round (2 = the seller's priced reply, 3 = a counter…)
  kind             text        NOT NULL CHECK (kind IN ('pro_forma', 'change', 'request', 'terms')),
                                                                -- terms = a money-free round · pro_forma = the seller prices the buyer's request · change = an amendment after agreement · request = the buyer asks (items, quantities, wanted price as text): never a computation
  from_entity_id   uuid        NOT NULL,                       -- who proposed it, as a row of THIS database (a stub when the proposer is on another installation)
  from_bridge_id   text        NOT NULL,
  from_name        text,
  status           text        NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'rejected', 'countered', 'superseded')),
  edits            jsonb,                                      -- the lines as corrections (lib/amend prepare shape): applied on acceptance
  terms            jsonb,                                      -- a MONEY-FREE round (a date, a scope, a note): agreed by either party with the other, it becomes business_json.agreed — no price, currency or tax involved
  request          jsonb,                                      -- a buyer's counter: what is asked, as text or numbers, never priced
  invoice          jsonb,                                      -- the INV-01 invoice the SELLER's installation issued for these lines (null when the tax was not decided)
  summary          jsonb,                                      -- { money, total_value } mapped off the invoice by the seller's installation
  currency_code    text,
  tax_note         text,                                       -- 'Tax not decided: …' in words when the seller has no country; never a guessed tax
  base_hash        text,                                       -- a hash of the lines and invoice this was proposed against: a different one at acceptance is STALE
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  decided_by       text,
  PRIMARY KEY (proposal_id, entity_id)
);
CREATE INDEX IF NOT EXISTS chit_proposal_chit_idx ON chit_proposal (entity_id, chit_id, round, created_at);
COMMENT ON TABLE chit_proposal IS 'RAIL-106 b796: a round of the pro-forma negotiation or a change order. Per copy. Applied through lib/amend on acceptance; the invoice is the seller''s, carried byte for byte.';

ALTER TABLE chit_proposal ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_proposal FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON chit_proposal;
CREATE POLICY rls_entity ON chit_proposal TO cb_app
  USING (entity_id = (NULLIF(current_setting('app.current_entity', true), ''))::uuid)
  WITH CHECK (entity_id = (NULLIF(current_setting('app.current_entity', true), ''))::uuid);
DROP POLICY IF EXISTS chit_proposal_owner ON chit_proposal;
CREATE POLICY chit_proposal_owner ON chit_proposal USING (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text)) WITH CHECK (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text));

GRANT SELECT, INSERT, UPDATE ON chit_proposal TO cb_app;

ALTER TABLE ctp_event_out DROP CONSTRAINT IF EXISTS ctp_event_out_kind_check;
ALTER TABLE ctp_event_out ADD CONSTRAINT ctp_event_out_kind_check
  CHECK (kind IN ('status', 'message', 'dispute_raise', 'dispute_message', 'dispute_resolve', 'cancel_request', 'cancel_confirm', 'attachment', 'proposal', 'proposal_decide'));

COMMIT;
