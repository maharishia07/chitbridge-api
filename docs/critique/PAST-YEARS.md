# PAST-YEARS critique (written before code, 2026-11-16; owner cb-accounting; nothing pushed)
(a) Brief assumptions vs code
- "BAS close accepts only FY-1 and FY": TRUE, lib/books-period.js closeSpan -> returnPeriods(pack, body, today) = prev + current FY (:1331). The year GATE itself (returnStateFor/yearReturnPeriods) already builds any year's table, so it names periods the close can never take.
- "months locked before BAS close refuse it": TRUE (lockCovered re-stamps only soft locks of an open close; a seed that hard-locks first cannot be undone in order).
- "?period ignored": TRUE for old codes: choosePeriod finds the code only in the two-year table, else falls back to the latest ended period.
- "auditor refused party ledgers": TRUE, middleware/books-grant.js GRANT_HELD_BACK['/party/:id/statement'] ("C6: after cb-country confirms").
- "b873 carry equals each close": carry is COMPUTED (books.js yearBalances, never stored); closeYear returns carry.balanced. UNKNOWN until compared on real rows.
(b) Conflicts: one writer (closeYear stays the only closer); one payment-mode list and "buyer paid" untouched; law is not a switch - the lodged declaration is a RECORDED FACT by the owner (reason on the month rows + change log), default absent = today's refusal; no new table, no migration.
(c) Simpler way: widening gstClose to every old quarter would make the practice re-prepare 28 returns - refused by the brief. A declaration on the year close is the smallest change; closeSpan stays as it is.
(d) Risks: books.js / books-period.js are on the file-size ratchet (new logic goes in lib/books-year-past.js); oldest-first rule only for years older than FY-1 so current-year answers do not move; GET /returns gets more periods (list grows to the years the books hold, capped 31 like the carry); an auditor party read touches names -> cb-security verdict; web must send returns_lodged (twin note, no web edit here).
(e) VERDICT: BUILD WITH CHANGES - (1) declaration instead of re-preparing, (2) order rule only for past years, (3) old BAS read-only via the period code, (4) party statement into GRANT_READS only (bills stay held back).
