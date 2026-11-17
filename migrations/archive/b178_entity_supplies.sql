-- b178 — does this business supply GOODS, SERVICES, or both?
--
-- Athi, 2026-08-20: *"does this business do sales or service? Sale in general term, the service flip some of
-- the feature… currently we keep it as sale, any generic standard term available that has to be used."*
--
-- ⭐⭐ THE STANDARD TERM IS "GOODS AND SERVICES", AND IT IS ALREADY THE ONE HIS USERS FILE UNDER.
--
--   · INDIA GST — every return says "supply of GOODS OR SERVICES OR BOTH". That is the exact statutory phrase
--     an Indian business meets monthly, so the platform costs them nothing to learn.
--   · WTO       — GATT governs goods, GATS governs services. The split is the basis of world trade law.
--   · EU VAT / UN CPC — the same division, independently arrived at.
--
-- "Sales vs service" is the shop-floor phrasing and it does not survive translation: a SALE is the transaction,
-- and a service is sold too. Goods and services are the two kinds of THING supplied, which is the distinction
-- actually being drawn.
--
-- ⚠️⚠️ "BOTH" IS NOT A CONVENIENCE, IT IS THE COMMON CASE. GST names it explicitly, and for good reason: a
-- garage sells a part and fits it; a printer sells paper and design. A two-value flag would force half the
-- market to describe itself wrongly on the first screen it meets.
--
-- ⚠️ AND THE LINE LEVEL ALREADY KNOWS. b152 makes goods DRAW DOWN an ordered quantity while services ACCRUE
-- upward, and b145 types a cost as goods/labour/transport/other. This column does NOT override any of that —
-- a "services" business can still sell a part, and the line decides how the line behaves. This is a DEFAULT
-- and a DECLARATION about the business, not a rule about its lines. Making it a rule would break the garage.
--
-- ⚠️ DEFAULT 'goods' PRESERVES TODAY'S BEHAVIOUR EXACTLY. Every existing entity behaves as a seller of goods
-- now, so that is what they are declared to be — a migration must not silently re-classify a live business.
--
-- identities is WITHOUT ROW LEVEL SECURITY — the deliberate b54 cross-tenant carve-out.

ALTER TABLE identities ADD COLUMN IF NOT EXISTS supplies varchar(16) NOT NULL DEFAULT 'goods';

ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_supplies_check;
ALTER TABLE identities ADD CONSTRAINT identities_supplies_check
  CHECK (supplies IN ('goods', 'services', 'both'));

COMMENT ON COLUMN identities.supplies IS
  'What this business supplies: goods | services | both. GST/WTO vocabulary. A DECLARATION and a default for '
  'new lines — never a rule that overrides how an individual line behaves (see b152).';

-- What everyone is, now. ONE result set — the editor shows only the last.
SELECT 'b178' AS report, supplies, count(*) AS entities
  FROM identities
 WHERE identity_type = 'entity'
 GROUP BY supplies
 ORDER BY count(*) DESC;
