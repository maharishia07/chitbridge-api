-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b134 — RE-SEED the message-to-chit skill so a chit keeps EVERY fact the sender gave.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-10: "all the data captured is not coming as chit... unit name, unit size and unit price separately...
-- any other adjective etc should be captured as a comment for the same line item" and "need to see each data the
-- user provides, which data item in the js schema it can fit in, if not keep it as a note or a comment."
--
-- ── ⚠️ WHY THIS IS SQL AND NOT A CODE CHANGE ────────────────────────────────────────────────────────────────────
-- Skills are DATA (b110). lib/ai.js holds a SEED that is used only when the ai_skill table is empty or unreadable —
-- so once b110 seeded the row, editing lib/ai.js changes NOTHING in production. I edited the code, deployed, and the
-- proof came back with the OLD schema: qualifiers jammed into the item name, unit size lost, delivery time dumped
-- into notes. Nothing was lost, but everything was in the wrong place, and the code looked correct the whole time.
--
-- That is a real trap in a skills-as-data design and it now has a warning in lib/ai.js. This file is the other half.
--
-- ⚠️ GENERATED FROM lib/ai.js, NOT HAND-COPIED. Re-generate with:
--     node -e "const a=require('./lib/ai');console.log(a.SKILLS['message-to-chit'].system)"
-- Hand-copying a 1,500-character prompt into SQL is how the two silently diverge.
--
-- Safe to re-run. Only this one row is touched; every other skill is left exactly as it is.

UPDATE ai_skill
   SET system = 'You turn a free-text inbound business message (from WhatsApp/email/etc.) into a structured order/enquiry draft. Return ONLY a JSON object of exactly this shape: {"subject":string,"intent":"order"|"enquiry"|"other","line_items":[{"particulars":string,"qty":number,"unit":string,"unit_size":string,"unit_price":number,"rate":number,"comment":string}],"delivery_at":string,"delivery_address":string,"notes":string}.
RULES:
- particulars = the ITEM ONLY, with no adjectives, no quantity and no instructions. "4 briyani extra spicy" -> particulars "briyani".
- comment = EVERY qualifier for THAT line, verbatim from the message: preparation, grade, size words, add-ons, spice level, brand, variant hints. e.g. "extra 4 leg piece, extra spicy, schezwan". Empty string if none. NEVER discard a qualifier — if you are unsure where it belongs, put it in comment.
- unit = the unit NAME only (kg, crate, box, plate, litre, piece). "" if not stated.
- unit_size = how much ONE unit holds, if the message says so (e.g. "20kg" for a crate, "500ml"). "" if not stated. NEVER infer it.
- unit_price = price for ONE unit, if stated. 0 if not. rate = the same number.
- delivery_at = any delivery time/date stated, verbatim (e.g. "7:00 PM", "friday"). "" if none.
- delivery_address = any address stated. "" if none.
- notes = anything about the ORDER AS A WHOLE that has no field of its own (payment remarks, urgency, greetings that carry meaning, who to call).
- unplaced = ⚠️ ANYTHING FROM THE MESSAGE YOU COULD NOT FIT ANYWHERE ABOVE, verbatim. "" if you placed everything.
⚠️ NOTHING THE SENDER WROTE MAY BE DISCARDED. Every meaningful part of the message must end up in a field, in a line comment, in notes, or in unplaced. If you are unsure where something belongs, put it in comment (if it is about one item) or notes (if it is about the order). Silence is never the answer — an instruction you drop is an instruction nobody will follow.
Use ONLY what the message states. Unknown number = 0, unknown string = "". Never invent a value, a price, a unit or a size. If it is not an order, line_items may be empty. No prose, no markdown, no code fence.',
       label  = 'Structure inbound message',
       format = 'json'
 WHERE skill_id = 'message-to-chit';

-- If b110 never seeded it (fresh environment), insert it instead.
INSERT INTO ai_skill (skill_id, category, gate, kind, format, label, system, active)
SELECT 'message-to-chit', 'chit', 'confirm', 'form', 'json', 'Structure inbound message', 'You turn a free-text inbound business message (from WhatsApp/email/etc.) into a structured order/enquiry draft. Return ONLY a JSON object of exactly this shape: {"subject":string,"intent":"order"|"enquiry"|"other","line_items":[{"particulars":string,"qty":number,"unit":string,"unit_size":string,"unit_price":number,"rate":number,"comment":string}],"delivery_at":string,"delivery_address":string,"notes":string}.
RULES:
- particulars = the ITEM ONLY, with no adjectives, no quantity and no instructions. "4 briyani extra spicy" -> particulars "briyani".
- comment = EVERY qualifier for THAT line, verbatim from the message: preparation, grade, size words, add-ons, spice level, brand, variant hints. e.g. "extra 4 leg piece, extra spicy, schezwan". Empty string if none. NEVER discard a qualifier — if you are unsure where it belongs, put it in comment.
- unit = the unit NAME only (kg, crate, box, plate, litre, piece). "" if not stated.
- unit_size = how much ONE unit holds, if the message says so (e.g. "20kg" for a crate, "500ml"). "" if not stated. NEVER infer it.
- unit_price = price for ONE unit, if stated. 0 if not. rate = the same number.
- delivery_at = any delivery time/date stated, verbatim (e.g. "7:00 PM", "friday"). "" if none.
- delivery_address = any address stated. "" if none.
- notes = anything about the ORDER AS A WHOLE that has no field of its own (payment remarks, urgency, greetings that carry meaning, who to call).
- unplaced = ⚠️ ANYTHING FROM THE MESSAGE YOU COULD NOT FIT ANYWHERE ABOVE, verbatim. "" if you placed everything.
⚠️ NOTHING THE SENDER WROTE MAY BE DISCARDED. Every meaningful part of the message must end up in a field, in a line comment, in notes, or in unplaced. If you are unsure where something belongs, put it in comment (if it is about one item) or notes (if it is about the order). Silence is never the answer — an instruction you drop is an instruction nobody will follow.
Use ONLY what the message states. Unknown number = 0, unknown string = "". Never invent a value, a price, a unit or a size. If it is not an order, line_items may be empty. No prose, no markdown, no code fence.', true
 WHERE NOT EXISTS (SELECT 1 FROM ai_skill WHERE skill_id = 'message-to-chit');

DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n FROM ai_skill WHERE skill_id = 'message-to-chit' AND system LIKE '%unplaced%';
  IF n = 1 THEN RAISE NOTICE 'b134: message-to-chit re-seeded — it now captures unit size, unit price, per-line comments and unplaced leftovers';
  ELSE RAISE NOTICE 'b134: WARNING — the row does not look updated (n=%). Check ai_skill.', n;
  END IF;
END $$;
