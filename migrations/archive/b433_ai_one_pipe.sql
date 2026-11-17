-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- b433 — T1-AI: the AI reads the whole reply, guards quantities, and runs every call through ONE pipe.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- Platform-global config, like b110: ai_skill has no entity_id and NO RLS (runtime GRANT SELECT to cb_app stays as b110 set it).
-- Idempotent: safe to re-run. Data + one nullable column; nothing is dropped. The code works BEFORE this runs:
--   · lib/ai.js reads ai_skill with SELECT *, so a missing `model` column is simply absent (AI_MODEL / DEFAULT_MODEL answer);
--   · a seed skill the table has never heard of resolves from the in-code SEED (getSkill), so the three CB Assist skills
--     work today and become editable data once inserted here;
--   · line-item-draft without raw_phrase still passes the guard's WEAK check (number anywhere in the description).
--
-- ⚠️ GENERATED FROM lib/ai.js, NOT HAND-COPIED (the b134 rule). Re-generate the prompt text with:
--     node -e "const a=require('./lib/ai');console.log(a.SKILLS['line-item-draft'].system)"

-- 1 · the slot's model. NULL = the environment's AI_MODEL, else lib/ai.js DEFAULT_MODEL. Set a row to pin one skill.
ALTER TABLE ai_skill ADD COLUMN IF NOT EXISTS model text;
COMMENT ON COLUMN ai_skill.model IS 'Model id for this skill (slot). NULL = AI_MODEL env, else lib/ai.js DEFAULT_MODEL. Read by lib/ai.js modelFor().';

-- 2 · the three CB Assist calls become skills (they called the model directly: no wallet, no daily cap, no ledger row).
INSERT INTO ai_skill (skill_id, category, gate, kind, format, label, system) VALUES
  ('assist-ask', 'assist', 'confirm', 'summarize', NULL, $p$Ask the assistant$p$, $p$You are the Chit & Bridge assistant. Be honest, concise, and NEVER oversell. Ground every answer in the supplied knowledge base; if something is not covered, say you are not certain rather than guess. When asked about fit it is fine — encouraged — to say "this is probably not for you"; qualifying out a bad fit builds trust. Never reveal another business's data: answer only from the public knowledge base plus any context explicitly provided for THIS caller.$p$),
  ('conform-narrative', 'assist', 'confirm', 'summarize', NULL, $p$Explain a conformance verdict$p$, $p$You are a compliance assistant. You are given a computed conformance verdict (the facts). Do NOT re-decide compliance — explain the verdict plainly and list concrete remediation for each gap. Cite the standard version. Be brief, honest, never oversell. The entity remains responsible for actual compliance.$p$),
  ('catalogue-intro', 'assist', 'confirm', 'summarize', NULL, $p$Catalogue collection intro$p$, $p$You are a catalogue copywriter. Write ONE short, warm intro paragraph (<= 45 words) for a retailer's collection. Do not invent items — only use the names given. Honest, no overselling.$p$)
ON CONFLICT (skill_id) DO NOTHING;

-- 3 · compose "fill line items": point at the words (raw_phrase) and read kg / litre / half right.
UPDATE ai_skill SET system = $p$You turn a free-text order description into structured order line items. Return ONLY a JSON object of exactly this shape: {"line_items":[{"particulars":string,"unit":string,"qty":number,"rate":number,"raw_phrase":string}]}. Use ONLY what the description states; if a quantity or price is not given, use 0. Never invent values. No prose, no markdown, no code fence.

RAW_PHRASE — every line item MUST carry it. It is the exact substring of the customer's own message that produced that line, copied VERBATIM: their spelling, their script, their word order. Do NOT translate it, tidy it, correct it or summarise it — the misspelling is the evidence. If a line was assembled from parts that sit apart in the message, join those parts with " ... ". If you genuinely cannot point at any words for a line, set raw_phrase to "" and never invent one.

QUANTITY WORDS — kg, kilo, g, gram, litre, liter, l, ml are UNITS, never part of the item: "2 kg rice" -> qty 2, unit "kg"; "500 ml oil" -> qty 500, unit "ml". "half" (arai) is 0.5 and "quarter" (kaal) is 0.25: "half kg sugar" -> qty 0.5, unit "kg"; "one and a half litre milk" -> qty 1.5, unit "litre". Never round a fraction to a whole number. A thing the sender says they do NOT want ("no onion", "vengayam venam", "don't send") is not a line item; never turn a refusal into an order.$p$, updated_at = now()
 WHERE skill_id = 'line-item-draft' AND system NOT LIKE '%raw_phrase%';

-- 4 · the raise's reader (message-to-chit) gets the same quantity words. Appended once.
UPDATE ai_skill SET system = system || $p$

QUANTITY WORDS — kg, kilo, g, gram, litre, liter, l, ml are UNITS, never part of the item: "2 kg rice" -> qty 2, unit "kg"; "500 ml oil" -> qty 500, unit "ml". "half" (arai) is 0.5 and "quarter" (kaal) is 0.25: "half kg sugar" -> qty 0.5, unit "kg"; "one and a half litre milk" -> qty 1.5, unit "litre". Never round a fraction to a whole number. A thing the sender says they do NOT want ("no onion", "vengayam venam", "don't send") is not a line item; never turn a refusal into an order.$p$, updated_at = now()
 WHERE skill_id = 'message-to-chit' AND system NOT LIKE '%QUANTITY WORDS%';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM ai_skill WHERE skill_id IN ('assist-ask','conform-narrative','catalogue-intro');
  IF n < 3 THEN RAISE EXCEPTION 'b433 did not take — % of 3 CB Assist skills present.', n; END IF;
  RAISE NOTICE 'b433: ai_skill.model added; 3 CB Assist skills present; quantity words on line-item-draft and message-to-chit.';
END $$;
