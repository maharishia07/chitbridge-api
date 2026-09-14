-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b237 — WHAT DOES THIS BUSINESS SUPPLY? goods · service · both. The fourth axis.
--
-- ⚠️⚠️ SUPERSEDED BY b239. KEPT FOR THE RECORD, DO NOT RUN.
--
-- Everything below was written against a column I had not read. identities.supplies ALREADY EXISTED, so the
-- ADD COLUMN IF NOT EXISTS did nothing -- including the DEFAULT it carried -- and both seed UPDATEs, guarded by
-- WHERE supplies = 'unknown', matched nothing.
--
-- The one thing it DID do was add a CHECK beside the one already on the column (ADD CONSTRAINT has no IF NOT
-- EXISTS), with the wrong spelling. Postgres applies every CHECK, so the writable set became the INTERSECTION:
-- goods and both only. A shop choosing "services" passed the validator and was refused by the database.
--
-- b238 tried to fix it by dropping one constraint BY NAME and missed the other (_check vs _chk).
-- b239 drops every constraint mentioning the column, by what it SAYS rather than what it is called, and adds
-- exactly one. Run b239.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"if we can distinguish between goods, service, both, it will be good. pure service is
-- helpdesk, incident management, testlab etc, both is bike service, car service etc.. it makes the distinction
-- better."*
--
-- ── ⭐⭐ WHY THIS IS NOT A FIFTH VISIBILITY, AND NOT THE TAX FIELD EITHER ────────────────────────────────────────
--
-- Three things were confused with each other earlier today and they are all different questions:
--
--   catalogue_visibility   is my item list a shop window          ← publication
--   HSN / SAC              is THIS LINE goods or a service        ← tax, per item, GST law
--   supplies (this)        what does this BUSINESS deal in        ← what kind of company it is
--
-- ⚠️ The tempting shortcut was "catalogue private means service". It fails on row 7 of ACCESS-MATRIX.md: the
-- counter-only shop sells GOODS and publishes nothing. Publication and product-type are independent, and a
-- garage proves it from the other side — it is BOTH, and publishes neither its labour rates nor its parts.
--
-- ⭐ And Tally and Zoho classify the ITEM (HSN for goods, SAC for services) because an invoice needs the right
-- tax on each line. That is per-line and stays per-line. THIS column is about the company, for understanding
-- and segmentation — the operator's question, not the taxman's.
--
-- ── THE VALUES ─────────────────────────────────────────────────────────────────────────────────────────────────
--
--   goods     sells things            a grocer, a hardware shop
--   service   sells only work         ⭐ Athi: helpdesk · incident management · testlab
--   both      work AND parts          ⭐ Athi: bike service · car service
--   none      supplies nothing        the ISO/ICC standards — reference objects, never a party
--   unknown   nobody has said         THE DEFAULT
--
-- ⚠️⚠️ 'unknown' IS THE DEFAULT AND IT IS NOT LAZINESS. Defaulting to 'goods' would assert something false
-- about 2,498 entities nobody has asked. Every other column added today took the same line: entity_kind
-- defaults to the recoverable answer, plan to 'test' rather than a tier nobody bought, entity_visibility to
-- what is already true. ⭐ A column that cannot tell "not asked" from "asked, and the answer is goods" is a
-- column whose counts can never be trusted — exactly what 'free' did to `plan` before b230.
--
-- Supabase → SQL Editor → SELECT ALL → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE identities ADD COLUMN IF NOT EXISTS supplies varchar(12) NOT NULL DEFAULT 'unknown';

ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_supplies_chk;
ALTER TABLE identities ADD  CONSTRAINT identities_supplies_chk CHECK (supplies IN (
  'goods', 'service', 'both', 'none', 'unknown'
));

COMMENT ON COLUMN identities.supplies IS
  'What this business deals in: goods · service · both · none · unknown. NOT a visibility, and NOT the tax '
  'classification — HSN/SAC stays per ITEM because an invoice needs the right tax per line. b237.';

COMMIT;

-- ── THE ONLY ROWS WE CAN HONESTLY DECLARE TODAY ────────────────────────────────────────────────────────────────
-- ⚠️ Two, and both by a STRUCTURAL fact rather than a guess about a name. Everything else stays 'unknown' until
--    somebody says — which is the whole point of having that value.
BEGIN;

-- a reference object supplies nothing. It is not a party to trade at all.
UPDATE identities SET supplies = 'none'
 WHERE entity_kind = 'internal' AND sealed = true AND supplies = 'unknown';

-- ⭐ and the operator supplies a SERVICE — the platform itself. Athi's own examples are CBINC's service lines:
--    helpdesk, incident management, test lab.
UPDATE identities SET supplies = 'service'
 WHERE user_id = 'cbincroot' AND supplies = 'unknown';

COMMIT;

-- ── WHAT YOU SHOULD SEE ────────────────────────────────────────────────────────────────────────────────────────
SELECT supplies, entity_kind, count(*) AS n
  FROM identities
 WHERE identity_type = 'entity' AND coalesce(status,'active') <> 'erased'
 GROUP BY 1, 2 ORDER BY 3 DESC;

-- ⭐ EXPECTED: service 1 (cbincroot) · none 8 (the sealed standards and GOV-01-Help) · unknown 2,497.
--
-- ⚠️ AND 2,497 'unknown' IS THE HONEST ANSWER, not a gap to be filled by inference. The nine real customers can
--    be asked; the 2,163 fixtures never will be. A guess here would be a number that looks like knowledge.
