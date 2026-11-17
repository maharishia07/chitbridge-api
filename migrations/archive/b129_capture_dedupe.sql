-- b129: THE SAME MESSAGE MUST NOT BECOME TWO CHITS.
--
-- Athi, 2026-08-09: *"and also proving that same message is not again create another chit"*. Half of that was
-- already true and half was not.
--
-- ALREADY SAFE: converting one capture twice is refused — markConverted carries `AND status = 'pending'`, so the
-- second attempt matches nothing and 404s.
--
-- ⚠️ NOT SAFE, UNTIL NOW: the same message DELIVERED twice made two captures. The provider's own message id was
-- never stored, so nothing could tell a redelivery from a new order — and providers redeliver. Meta retries a
-- webhook it believes failed, and a retry that arrives after we have already recorded the message is
-- indistinguishable from a customer sending the same words again. A human working the intake inbox then sees two
-- identical requests, converts both in good faith, and the shop ships twice.
--
-- The provider's message id is the only thing that can tell them apart: it is stable across redeliveries and
-- different for a genuinely repeated message. So we store it and make it unique per channel.
ALTER TABLE capture ADD COLUMN IF NOT EXISTS provider_msg_id text;

-- ⚠️ PARTIAL, on purpose. Captures created by hand (/simulate, the web intake form) have no provider id, and a
-- plain unique index would let exactly ONE of them exist per channel — turning "record a message" into a feature
-- that works once. NULLs are excluded so only real provider deliveries are deduplicated.
CREATE UNIQUE INDEX IF NOT EXISTS capture_provider_msg
  ON capture (channel, provider_msg_id) WHERE provider_msg_id IS NOT NULL;
