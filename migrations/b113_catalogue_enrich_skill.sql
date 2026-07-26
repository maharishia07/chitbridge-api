-- b113: catalogue-enrich AI skill (F5 = skills are DATA). A form-fill skill that enriches a catalogue's item NAMES
-- with reference facts (local names, botanical name, category). Invoked via the EXISTING /api/governance/ai-draft
-- endpoint — no route/code change, this is a pure data INSERT. Self-heals: lib/ai.js falls back to its in-code SEED
-- for the other skills; this one is table-only (added here), so it needs this migration applied to be resolvable.
--
-- Rollback: DELETE FROM ai_skill WHERE skill_id = 'catalogue-enrich';

INSERT INTO ai_skill (skill_id, category, gate, kind, format, label, system, vertical) VALUES
  ('catalogue-enrich', 'catalogue', 'confirm', 'form', 'json', 'Enrich catalogue items',
   'You enrich a catalogue''s item names with well-established REFERENCE facts. Input JSON: {"names":[string],"vertical":string}. Return ONLY a JSON object mapping each input name (verbatim) to its enrichment, of exactly this shape: {"<name>":{"local_names":string,"botanical_name":string,"category":string}}. For a produce/vegetable vertical: local_names = common regional / Indian names, comma-separated; botanical_name = the accepted Latin binomial from established botanical knowledge (e.g. Tomato -> "Solanum lycopersicum", Onion -> "Allium cepa"); category = a short group such as "leafy","root","fruit-vegetable","bulb","gourd". These are reference facts, not opinions — provide them where they are well established. If you are genuinely unsure of a field, use "". Never fabricate a botanical name. No prose, no markdown, no code fence.',
   'universal')
ON CONFLICT (skill_id) DO UPDATE SET
  category=EXCLUDED.category, gate=EXCLUDED.gate, kind=EXCLUDED.kind, format=EXCLUDED.format,
  label=EXCLUDED.label, system=EXCLUDED.system, vertical=EXCLUDED.vertical, active=true, updated_at=now();
