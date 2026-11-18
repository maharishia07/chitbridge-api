-- READ-2026-11-17-reserved-words-census.sql · SEC-112 P0 · READ-ONLY census for Athi, BEFORE the reserved provider words land (lib/handle.js RESERVED_FIXED gains google, gmail, microsoft, outlook, entra, okta, sso).
--
-- WHAT IT DOES: counts, per word, how many identities.user_id already equal it (case-insensitive) or start a handle with it (the part before the first '.'), and lists the ids that would collide.
--    It changes nothing and reads no secret. Run it AS postgres on production and on each SIT database; paste the result back.
-- WHY: a reserved word is refused for a NEW registration only (handle.checkRoot). An existing business that already holds the word keeps its name (nothing rewrites a user_id), but the owner and cb-security
--    should know the list before it lands: handle.check() also runs on existing handles (network-design reads the current id), so a held word shows up there as "reserved".
-- EXPECTED: zero rows is the good answer. A row = a business to talk to first (rename by the owner through the set-once path, or leave it and say so in the DECISIONS note).
-- ROLL BACK: nothing to roll back (read-only).

SELECT w.word,
       count(*) FILTER (WHERE lower(i.user_id) = w.word)                                  AS exact_matches,
       count(*) FILTER (WHERE lower(split_part(i.user_id, '.', 1)) = w.word)              AS root_matches,
       array_agg(i.user_id ORDER BY i.user_id) FILTER (WHERE lower(split_part(i.user_id, '.', 1)) = w.word) AS user_ids
  FROM unnest(ARRAY['google', 'gmail', 'microsoft', 'outlook', 'entra', 'okta', 'sso']) AS w(word)
  LEFT JOIN public.identities i ON lower(split_part(i.user_id, '.', 1)) = w.word
 GROUP BY w.word
 ORDER BY w.word;
