-- b213 · THE REWARD LEDGER — where a customer's points actually live
-- ============================================================================================================
-- Athi, 2026-09-10: "it should be exactly like offer — for some item, instead of discount you add reward, so the
-- reward can be encashed during next visit, so a repeated customer can be invented." And then the rules:
--   "walk-ins skip earning, points expire after 12 months as a declarable stuff, and for walk-in we can keep it
--    against the phone number. For online we can keep it against the customer id — the bridge id or the user id.
--    If it is walk-in customer, still are we creating the user id? I guess not."
--
-- ⭐⭐ NOTHING NEW IS INVENTED HERE. The PROGRAMME is a `definition` of kind 'reward', versioned exactly like an
-- offer, because it is the same kind of thing: a rule a shop declares that has to be quotable months later
-- against a bill it priced. Only the LEDGER is new, because points accumulate and an offer does not.
--
-- ── ⭐⭐ WHO HOLDS THE POINTS: (holder_scheme, holder_value) ────────────────────────────────────────────────────
--   ('identity', <uuid>)   a registered customer — the bridge id
--   ('phone',    '+91…')   a walk-in who gave a number
-- The same (scheme, value) pair used for identifiers and for payee addresses, for the same reason: there is no
-- one way to name a person. And it is why NO user_id is minted for a walk-in — Athi guessed right. customer_list
-- REQUIRES a customer_identity_id, so a walk-in cannot be in it at all; and minting an account for somebody who
-- bought soap would pre-empt a choice that is theirs, leaving them a name they never picked.
--
-- ⚠️⚠️ A PHONE-HELD BALANCE IS CLAIMABLE BY WHOEVER KNOWS THE NUMBER. Said out loud now rather than discovered
-- later: the shop is extending the same trust it already extends to whoever stands at the cash drawer. The
-- mitigation is not cryptography — it is that a walk-in balance is small, and that moving one onto an account is
-- a deliberate act by a person at the counter (see 'claimed' below).
--
-- ── ⭐ APPEND-ONLY BY GRANT, like definition_version ────────────────────────────────────────────────────────────
-- cb_app may INSERT and SELECT. It may not UPDATE and may not DELETE. A points balance is a liability the shop
-- owes a customer, and a liability you can edit is not a liability, it is a suggestion. A mistake is corrected by
-- writing the opposite entry ('adjusted'), which leaves both the error and the correction readable.
-- This is also why expiry is an ENTRY and not a filter: a balance that quietly stopped counting old rows would be
-- unexplainable to the person holding it. A -100 'expired' row can be read, argued with, and reversed.
--
-- ⭐ WITH RLS — entity-isolated on app.current_entity, ENABLE + FORCE, like every other entity-data table.
-- Supabase -> SQL Editor -> paste -> Run. Step 1 only looks. Idempotent; safe to re-run.
-- ============================================================================================================

-- ── 1 · LOOK FIRST. Expect 0 rows the first time; one row named reward_ledger on a re-run.
SELECT c.relname AS table_name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'reward_ledger';

-- ── 2 · THE TABLE.
BEGIN;

CREATE TABLE IF NOT EXISTS reward_ledger (
  entry_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      uuid NOT NULL,                    -- the SHOP. Points are owed by one shop, never platform-wide.
  holder_scheme  text NOT NULL,                    -- 'identity' | 'phone'
  holder_value   text NOT NULL,
  points         bigint NOT NULL,                  -- signed: + earned/claimed-in, - spent/expired/claimed-out
  why            text NOT NULL,
  ref            text,                             -- the bill (client_ref) or the claim that caused it
  note           text,                             -- what a customer would be told, in words
  definition_id  uuid,                             -- WHICH programme awarded it — the rules stay quotable later
  at             timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  CONSTRAINT reward_ledger_holder_scheme_chk CHECK (holder_scheme IN ('identity', 'phone')),
  CONSTRAINT reward_ledger_why_chk           CHECK (why IN ('earned','spent','adjusted','expired','reversed','claimed')),
  -- ⚠️ a zero entry records nothing and would only make a statement harder to read
  CONSTRAINT reward_ledger_points_chk        CHECK (points <> 0),
  CONSTRAINT reward_ledger_holder_value_chk  CHECK (length(btrim(holder_value)) > 0)
);

-- ⚠️⚠️ A BILL THAT SYNCS TWICE MUST NOT AWARD TWICE. The counter bills offline and replays its queue when the
-- network returns, so the SAME bill number arrives more than once as a matter of routine — chits already handle
-- that by client_ref, and points have to handle it here or a customer earns for every retry. One entry per
-- (shop, bill, reason, holder); the insert says ON CONFLICT DO NOTHING and a replay is a quiet no-op.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reward_ledger_once
  ON reward_ledger (entity_id, ref, why, holder_scheme, holder_value) WHERE ref IS NOT NULL;

-- the only query that runs hot: this shop, this customer, in order
CREATE INDEX IF NOT EXISTS idx_reward_ledger_holder
  ON reward_ledger (entity_id, holder_scheme, holder_value, at DESC);
-- and the one the bill needs: everything a single bill did to a balance
CREATE INDEX IF NOT EXISTS idx_reward_ledger_ref ON reward_ledger (entity_id, ref);
-- ⚠️ the expiry sweep reads only earnings, and would otherwise scan the whole shop
CREATE INDEX IF NOT EXISTS idx_reward_ledger_earned
  ON reward_ledger (entity_id, at) WHERE why = 'earned';

ALTER TABLE reward_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_ledger FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_entity ON reward_ledger;
CREATE POLICY rls_entity ON reward_ledger
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- ⭐⭐ THE APPEND-ONLY GRANT. This is the line that makes the balance trustworthy.
GRANT SELECT, INSERT ON reward_ledger TO cb_app;
REVOKE UPDATE, DELETE ON reward_ledger FROM cb_app;

DO $$
BEGIN
  RAISE NOTICE 'b213: reward_ledger created — append-only for cb_app, entity-isolated, FORCE RLS.';
  RAISE NOTICE 'b213: a mistake is corrected by writing the opposite entry, never by editing one.';
END $$;

COMMIT;

-- ── 3 · A PROGRAMME FOR tallytest, so the counter has something to award.
--
-- ⚠️ THE SHOP DECLARES THE MECHANISM, WE DO NOT. Athi: "we only build the mechanism of accumulating and
-- distributing the points, and how the point has to be converted should depend on the parameter." So the rules
-- below are ONE shop's choice out of the five earning kinds the engine supports (per_amount, value_as_points,
-- per_visit, per_item, on_items) — not a default anybody else inherits.
--
-- ⭐ RUN IT WITH THE ENTITY CONTEXT SET, for the reason b209 gives: WITH CHECK then verifies the row lands in
--    THIS shop, so a wrong id is REFUSED rather than quietly written into somebody else's.
SELECT set_config('app.current_entity', 'c2837d52-47f2-47e2-9fcd-b98c68a49e45', false);

BEGIN;

WITH shop AS (SELECT 'c2837d52-47f2-47e2-9fcd-b98c68a49e45'::uuid AS id),
new_prog AS (
  SELECT * FROM (VALUES
    ('Shop points', 'points',
     -- 1 point per Rs 100 · 100 points = Rs 1 off · 12-month expiry, DECLARED (silence would have meant never)
     '{"earn":{"kind":"per_amount","per":100,"points":1},
       "redeem":[{"kind":"money","points":100,"amount":1}],
       "expires_months":12,
       "walk_in_earns":false,
       "min_balance_to_spend":100}'::jsonb)
  ) AS t(name, sub_kind, rules)
  -- ⚠️ b160 declares UNIQUE (entity_id, kind, name) regardless of status — match what the DATABASE forbids
  WHERE NOT EXISTS (
    SELECT 1 FROM definition d
     WHERE d.entity_id = 'c2837d52-47f2-47e2-9fcd-b98c68a49e45'
       AND d.kind = 'reward' AND d.name = t.name)
),
made AS (
  INSERT INTO definition (entity_id, kind, sub_kind, name, note, status, current_version, created_by)
  SELECT shop.id, 'reward', n.sub_kind, n.name,
         'seeded so the counter can award and encash points', 'live', 1, NULL
  FROM new_prog n, shop
  RETURNING definition_id, entity_id, name
)
INSERT INTO definition_version (definition_id, version, entity_id, rules, note, created_by)
SELECT made.definition_id, 1, made.entity_id, n.rules, 'seeded', NULL
FROM made JOIN new_prog n ON n.name = made.name;

-- ⚠️ Expect "INSERT 0 1" the first time and "INSERT 0 0" on a re-run — both correct. Anything else -> ROLLBACK;
COMMIT;

-- ── 4 · PROVE IT. Expect the table forced, and one live programme with its rules.
SELECT c.relname AS table_name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'reward_ledger';

SELECT d.name, d.sub_kind, d.status, v.rules
FROM definition d
LEFT JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
WHERE d.entity_id = 'c2837d52-47f2-47e2-9fcd-b98c68a49e45' AND d.kind = 'reward';

-- ── AFTERWARDS: the counter shows "Shop points · 1 point for every ₹100 spent" beside the customer box, awards on
--    a named customer, and offers to encash on the next bill. A walk-in with no number earns nothing and is told
--    so in one line, rather than silently.
