-- b101: AI/wallet/vault SECURITY HARDENING (from reviewer critique 2026-07-13). Additive + idempotent; Athi's gate.
-- Closes F2 (money table writable by entity role), F3 (three tables missed FORCE RLS), F4b (no platform-wide ceiling).
-- F1 (vault column encryption) is a SEPARATE, larger change — see SPEC-vault-encryption.md — NOT in this migration.

-- ── F3 · restore the platform's own FORCE-RLS standard on the three newest tables (the sensitive + financial ones) ──
ALTER TABLE entity_profile FORCE ROW LEVEL SECURITY;
ALTER TABLE entity_wallet  FORCE ROW LEVEL SECURITY;
ALTER TABLE usage_ledger   FORCE ROW LEVEL SECURITY;

-- ── F2 · the money table must NOT be writable by the entity-scoped app role ──
-- Reads stay RLS-scoped (an entity sees only its own balance). Writes go ONLY through the definer below.
REVOKE INSERT, UPDATE, DELETE ON entity_wallet FROM cb_app;

-- Top-ups are a SECURITY DEFINER function (runs as owner, bypasses the REVOKE) that the entity CANNOT invoke to mint
-- its own credit — it is called by an admin/billing path, not from inside withEntity(). Amount must be positive; it
-- ADDS (never sets), so it can't be abused to zero someone out. Wire real billing/authorisation before exposing it.
CREATE OR REPLACE FUNCTION wallet_topup(p_entity uuid, p_amount numeric)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'top-up amount must be positive'; END IF;
  INSERT INTO entity_wallet (entity_id, credits_usd, updated_at)
    VALUES (p_entity, p_amount, now())
    ON CONFLICT (entity_id) DO UPDATE SET credits_usd = entity_wallet.credits_usd + EXCLUDED.credits_usd, updated_at = now()
    RETURNING credits_usd INTO new_balance;
  RETURN new_balance;
END $$;
REVOKE ALL ON FUNCTION wallet_topup(uuid, numeric) FROM PUBLIC;
-- deliberately NOT granted to cb_app → the entity-scoped role cannot call it. Grant to a billing/admin role only.

-- ── F4b · platform-wide daily AI-spend ceiling. A definer fn so it can sum ACROSS all entities (usage_ledger is RLS'd
-- per-entity, so cb_app cannot see the global total directly). lib/ai.js checkBudget() calls this FIRST; self-heals
-- (no-ops) until this migration runs. Bounds TOTAL loss on the platform-shared key. ──
CREATE OR REPLACE FUNCTION ai_global_spend_today()
RETURNS numeric
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(cost_usd), 0)::numeric
  FROM usage_ledger
  WHERE meter = 'ai.draft' AND created_at >= date_trunc('day', now());
$$;
GRANT EXECUTE ON FUNCTION ai_global_spend_today() TO cb_app;   -- read-only aggregate, safe for the app role to call
