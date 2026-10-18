-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b141 — RE-SEED message-to-chit: every line carries the customer's OWN WORDS.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ THIS IS WHAT TURNS THE NUMERAL CHECK FROM A HINT INTO A GUARD.
--
-- lib/numerals.js can already read `pathu` as 10. But to REJECT a wrong quantity it has to compare against the
-- words that produced THAT LINE, and today the reader returns no such field. So the check is currently
-- message-level: "does this number appear anywhere in the message?" That can never produce a false rejection, but
-- it is partial — with several lines, a wrong quantity that happens to match another line's number slips through.
--
-- With `raw_phrase` on each line the comparison becomes per-line and exact:
--     raw_phrase "pathu kilo thakkali" + qty 5   →  REJECT, quantity := null, needs_human
-- which is the handover doc's T-1, properly.
--
-- ⚠️ IT IS ALSO THE FIELD A HUMAN READS. Athi's design puts the original words beside the extracted values at
-- review time — that is the only reason someone can catch `pathu → 5` in two seconds. Without it the reviewer is
-- checking the machine's answer against the machine's other answer.
--
-- ⚠️ VERBATIM, NOT TIDIED. The point is what they typed, including the spelling that made it hard.
--
-- Safe to re-run. Data-only: adds a field to the skill's output contract, changes no schema.

-- ⚠️ PATCHED, NOT RESTATED. b136's prompt declares "a JSON object of EXACTLY this shape" and then lists the line
-- keys. Appending a new required field as a trailing paragraph would contradict that sentence, and a model told
-- two different things about the same contract picks one. So the shape itself is edited, and the instruction
-- follows it.
UPDATE ai_skill
   SET system = replace(system, '"comment":string}', '"comment":string,"raw_phrase":string}')
                || E'\n\nRAW_PHRASE — every line item MUST carry it. It is the exact substring of the customer''s own message that produced that line, copied VERBATIM: their spelling, their script, their word order. Do NOT translate it, tidy it, correct it or summarise it — the misspelling is the evidence. If a line was assembled from parts that sit apart in the message, join those parts with " ... ". If you genuinely cannot point at any words for a line, set raw_phrase to "" and never invent one.'
 WHERE skill_id = 'message-to-chit'
   AND system NOT LIKE '%raw_phrase%';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM ai_skill WHERE skill_id = 'message-to-chit' AND system LIKE '%raw_phrase%';
  IF n = 0 THEN
    RAISE EXCEPTION 'b141 did not take — no message-to-chit skill row was updated. Check the skill_id.';
  END IF;
  RAISE NOTICE 'b141: message-to-chit now emits raw_phrase per line. The numeral check can go per-line and start REJECTING.';
END $$;
