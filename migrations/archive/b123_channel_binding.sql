-- b123: CHANNEL BINDING — which inbound number / address belongs to which entity.
--
-- This is the missing half of the capture connector (b104). The WhatsApp and email webhooks have been wired and
-- inert for a month for exactly one reason, stated in routes/capture.js: "the entity comes from the number→entity
-- MAP, NEVER the payload (else it is S1 on a public endpoint)". This table is that map.
--
-- ⚠️ THE UNIQUE IS GLOBAL, NOT PER-ENTITY. (channel, address) is unique across the whole platform, deliberately:
-- an inbound message arrives with nothing but a destination number, so if two entities could both claim
-- +9198…, the webhook would have no way to decide whose intake inbox it belongs in — and "guess" is not an
-- option when the answer decides who receives an obligation. First claim wins; a second claim is refused.
--
-- ⚠️ `status` IS A RUNG, NOT A BOOLEAN. A binding starts `declared` — somebody typed a number in. It becomes
-- `verified` only when the provider has confirmed the entity really controls that address (the Meta handshake, a
-- round-trip email). Captures arriving on a declared binding are still captures: they are pending items a human
-- confirms, never obligations. Same trust ladder as the attestation layer — asserted is not verified.
--
-- Additive + self-healing: /api/channels answers 503 "channels not migrated (b123)" until this runs. Athi's gate.
CREATE TABLE IF NOT EXISTS channel_binding (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL,
  channel      text NOT NULL,                          -- whatsapp | email | sms | web
  address      text NOT NULL,                          -- the number / inbound address, NORMALISED (see lib/channels.js)
  label        text,                                   -- what the owner calls it ("shop line", "orders@")
  status       text NOT NULL DEFAULT 'declared',       -- declared | verified
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ⚠️ Global, on purpose — see the note above. An index is not RLS-filtered, so this really does stop a second
-- entity claiming a number even though it cannot SEE the row that blocks it.
CREATE UNIQUE INDEX IF NOT EXISTS channel_binding_addr ON channel_binding (channel, lower(address));
CREATE INDEX IF NOT EXISTS channel_binding_entity ON channel_binding (entity_id, channel);

ALTER TABLE channel_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_binding FORCE  ROW LEVEL SECURITY;   -- the platform's isolation standard
DROP POLICY IF EXISTS rls_entity ON channel_binding;
CREATE POLICY rls_entity ON channel_binding
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON channel_binding TO cb_app;

-- ⚠️ THE WEBHOOK CANNOT READ THIS TABLE, AND THAT IS THE WHOLE PROBLEM THIS FUNCTION SOLVES.
--
-- An inbound provider POST carries no session — there is no `app.current_entity` to set, so under FORCE RLS the
-- lookup returns zero rows and every message would be dropped. The resolution therefore has to happen on the
-- SECURITY DEFINER rail, exactly like chit_deliver: a narrow function that does ONE thing the caller could not
-- otherwise do, rather than a role that can read everything.
--
-- It answers exactly one question — "who owns this address?" — and returns a uuid or nothing. It cannot list,
-- cannot filter by entity, and exposes no message, name or label. That is the smallest possible hole, and it is
-- the same shape the reviewer asked for in routes/capture.js: the entity comes from the MAP, never the payload.
CREATE OR REPLACE FUNCTION channel_owner(p_channel text, p_address text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT entity_id FROM channel_binding
   WHERE channel = p_channel AND lower(address) = lower(p_address)
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION channel_owner(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION channel_owner(text, text) TO cb_app;
