-- b126: NOTIFY BACK — the other half of the capture connector. A chit's status change reaches the customer on the
-- channel they wrote in on. One paste; everything outbound needs.
--
-- SPEC-capture-connector.md: "channel → CAPTURE → AI STRUCTURE → HUMAN CONFIRM → CHIT on rail → notify back to
-- channel". Inbound has been live since b123/b124. This is the return leg.
--
-- ⚠️ A REPLY IS A NOTICE, NOT THE RECORD. The chit stays the record; a WhatsApp message saying "accepted" is a
-- courtesy copy to someone who lives in WhatsApp. If the two ever disagree the chit is right — which is exactly
-- why what we sent is logged separately below rather than written back onto the chit as if it were an event.

-- 1 ── WHICH OF OUR NUMBERS DID THEY WRITE TO?
-- The webhook knows (metadata.display_phone_number) and threw it away. To reply we must send FROM the same line
-- the customer messaged, or the reply arrives from a stranger. With one bound number it is guessable; with two it
-- is a coin toss, and guessing which of your businesses is talking to a customer is not acceptable.
ALTER TABLE capture ADD COLUMN IF NOT EXISTS to_ref text;

-- 2 ── HOW TO SEND FROM IT.
-- Meta addresses sends by phone_number_id, not by the human number: POST /{phone_number_id}/messages. It is not
-- derivable from the display number, so the binding has to carry it.
ALTER TABLE channel_binding ADD COLUMN IF NOT EXISTS provider_ref text;

-- 3 ── WHAT WE ACTUALLY SENT.
-- ⚠️ RECEIPTS, NOT A MESSAGE STORE. This is not a chat log and must not become one: it records that we attempted
-- to notify, what we said, and what the provider answered. Same receipt-only ethos as the connectors framework —
-- keep the provenance, not the correspondence.
CREATE TABLE IF NOT EXISTS channel_outbound (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid NOT NULL,
  chit_id         uuid,                                   -- what it was about (null for a manual note)
  capture_id      uuid,                                   -- the inbound it answers, when there is one
  channel         text NOT NULL,
  from_ref        text,                                   -- our line
  to_ref          text NOT NULL,                          -- the customer
  body            text,
  -- queued | sent | failed | refused.  ⚠️ `refused` is OURS, not the provider's: we declined to send because the
  -- 24-hour window had closed and no approved template covers it. It is a real outcome and must be visible —
  -- a notification that was never attempted is not the same as one that failed.
  status          text NOT NULL DEFAULT 'queued',
  reason          text,                                   -- why refused / how it failed
  provider_msg_id text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channel_outbound_entity ON channel_outbound (entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS channel_outbound_chit   ON channel_outbound (chit_id);

ALTER TABLE channel_outbound ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_outbound FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON channel_outbound;
CREATE POLICY rls_entity ON channel_outbound
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON channel_outbound TO cb_app;
