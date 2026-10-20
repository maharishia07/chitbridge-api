# Critique · TILL-FIX-18OCT (CTR-144/145/146)
(a) Assumptions checked: slip Share falls back to cbHome() (till.html shareSlip, TRUE); Labs + "This device" use root-relative links (openProductLab/OfferLab/ComboLab, tvHere, TRUE); header pill shows the prefix code (counterPill, TRUE); index-not-app misses cbHome() (it only greps the literal, TRUE).
(b) Conflicts: none. cbRoot() is the one web-root reader (reused, no new helper). Chip "Off the shelf 0" keeps its zero on purpose (till.html ~11172, "0 is itself the answer"), the "Line good" chip is a decided M-item; neither is changed.
(c) Simpler: omit the link rather than grey + sentence (the bill text is still worth sharing; nothing to explain).
(d) Risks: till is a master + byte copy, twin PRs (web guard + vendored copy; the api vendor check reads web main, so web first or paired). counterName() now returns plain "Counter" for a code-like prefix (slip shows the same) — tests run.
(e) VERDICT: BUILD AS BRIEFED (with (c)).
