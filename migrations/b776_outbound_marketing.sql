-- b776_outbound_marketing.sql — MKT first slice (22 Oct 2026): every offer sent is tied to a person, a purpose, one send and the consent behind it.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (ADD COLUMN / CREATE INDEX IF NOT EXISTS). Touches no
--    rows: the four columns are nullable with no default, so rows written before this read NULL ("not recorded") and the ALTERs are catalogue changes.
--
-- WHY. channel_outbound (b126) records what was said back on a channel but not to WHOM (party), WHY (service update or offer), which send it was
--    part of, or the consent that allowed it. Offers sent and Who came back (Marketing) need all four, and the consent proof per send (MKT-17)
--    costs nothing extra once the row is there. No new table: one more reader of the same receipts.
--   party_id  uuid   the person in the one party list (a customer identity); NULL for a message about a chit.
--   purpose   text   'service' | 'marketing' — what the privacy gate was asked.
--   send_ref  text   one value per group send, so the 10 rows of one send (sent AND refused) belong together.
--   basis     jsonb  the consent proof: the gate's code, the preference id and its time (MKT-17).
-- Until this runs the code checks the column (42703) and writes the receipt as before; the Marketing screens say "arrives after the next update".
-- RLS: unchanged (channel_outbound keeps FORCE RLS and its rls_entity policy). Grants: cb_app already holds table-level INSERT/SELECT/UPDATE
--    on channel_outbound (baseline), which covers new columns; nothing added.

BEGIN;
ALTER TABLE channel_outbound ADD COLUMN IF NOT EXISTS party_id uuid;
ALTER TABLE channel_outbound ADD COLUMN IF NOT EXISTS purpose text;
ALTER TABLE channel_outbound ADD COLUMN IF NOT EXISTS send_ref text;
ALTER TABLE channel_outbound ADD COLUMN IF NOT EXISTS basis jsonb;
CREATE INDEX IF NOT EXISTS channel_outbound_purpose ON channel_outbound (entity_id, purpose, created_at DESC);
COMMENT ON COLUMN channel_outbound.party_id IS 'MKT b776: the person (identity) the message went to; NULL = not recorded or about a chit';
COMMENT ON COLUMN channel_outbound.purpose IS 'MKT b776: service | marketing — what the consent gate was asked';
COMMENT ON COLUMN channel_outbound.send_ref IS 'MKT b776: one id per group send, shared by its sent and refused rows';
COMMENT ON COLUMN channel_outbound.basis IS 'MKT-17 b776: consent proof for this send {code, pref_id, at}';
COMMIT;
