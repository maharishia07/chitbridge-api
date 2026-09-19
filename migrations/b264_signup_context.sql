-- b264 · signup_context — WHAT WAS TRUE WHEN AN IDENTITY WAS CREATED, AND WHAT IT AGREED TO.
--
-- Athi, 2026-09-18: *"anything else to be captured like device information, device type, ip and so on or
-- anything else which we can capture and make meaning out of it"*, and *"possibly we have to ask for agree
-- message"*.
--
-- ⚠️⚠️ WHY A TABLE AND NOT MORE COLUMNS ON identities. The four settings the browser derives — country,
-- currency_code, timezone, locale_prefs — are already columns there, and they belong there: they are the
-- shop's CURRENT configuration, read on every boot, and a shopkeeper may change any of them tomorrow.
--
-- What is below is different in kind. It is EVIDENCE: what the browser reported, what IP the request arrived
-- from, and the moment somebody ticked a box to say the derived values were right. It is written once, never
-- edited, and read only when a question is asked — which is the shape of an audit record, not a setting.
-- Putting it on identities would add bytes to the hottest read on the platform to store facts nothing reads.
--
-- ⚠️ AND IT IS APPEND-ONLY BY INTENT. An owner verifies again on every sign-in, so there will be many rows per
-- identity over time. That is the point: "what did this shop agree to, and from where, on the day it signed
-- up" is a different question from "what did it agree to last Tuesday", and a single mutable row could answer
-- only the second.
--
-- ⚠️⚠️ WHAT IS DELIBERATELY *NOT* HERE: no latitude, no longitude, no address. The engine that feeds this
-- (public/app/govcontext.js) never asks the browser for permission to anything — the whole design rule is
-- DERIVE, NEVER PROMPT. An IP and a timezone are what a web server already receives; a location is not, and a
-- shop signing up must never meet a permission dialog on its first screen.
--
-- ⚠️ RLS. This table is written by the API under the service role at verification time, when there is not yet a
-- session to scope by. It is read only by support, never by the app. So it carries NO policy and the API must
-- never expose it on a tenant-facing route. Stated here because "WITH or WITHOUT RLS" is a question this
-- project asks of every table, and the honest answer for this one is WITHOUT, for that reason.
--
-- Run: Supabase SQL editor (Athi). Safe to re-run.

CREATE TABLE IF NOT EXISTS signup_context (
  signup_context_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id        UUID NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,

  -- what the browser worked out, exactly as it was claimed, before any COALESCE on identities
  claimed_country    VARCHAR(2),
  claimed_currency   VARCHAR(3),
  claimed_timezone   TEXT,
  claimed_locale     TEXT,
  claimed_languages  JSONB,

  -- what kind of machine it was: {type, screen, dpr, platform, touch}
  device             JSONB,

  -- what only the server can see
  ip                 INET,
  user_agent         TEXT,

  -- ⭐ THE AGREEMENT IS A TIMESTAMP, NOT A BOOLEAN. A flag says somebody ticked a box; a time says when, which
  --   is the only form of it worth keeping.
  agreed_at          TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- the only question this table is ever asked: what did this identity agree to, most recent first
CREATE INDEX IF NOT EXISTS signup_context_identity_idx
  ON signup_context (identity_id, created_at DESC);

COMMENT ON TABLE signup_context IS
  'Append-only evidence of what was derived and agreed when an identity verified. Settings live on identities; '
  'this is the audit record behind them. No location is ever collected — the deriving engine never prompts.';
COMMENT ON COLUMN signup_context.agreed_at IS
  'When the person ticked to say the derived governance values were right. NULL means they were never asked.';
COMMENT ON COLUMN signup_context.claimed_country IS
  'What the browser reported, BEFORE identities.country was filled — kept so a later correction can be explained.';
