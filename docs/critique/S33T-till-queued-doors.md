# Critique S33-T till · the counter's queued doors made provable (11 Nov 2026)
Written at the start of the build, from the code read (verdict below stands after the build).
(a) Assumptions checked
- "the doors are flags, stock, stock/bulk, reward, reward/claim, quick-keys x2, chits/send": TRUE as to the list, but quick-keys/hide and unhide were CLOSED (additionalProperties false, lib/till-contract.js, batch 2026-11-11) and are noQueue today; the FIRST counter versions queued them (till.html e5fe6136, 18 Sep), so an old queued body can exist. They move from strict to tolerant.
- "reward still gets net, gross, count, lines from the desktop connector": TRUE (tools/tally-connector/till.js:555; the handler does not read them, routes/till.js reward comment). They are declared (typed, unread) so they stay accepted.
- "a refused queued row may jam the queue": FALSE for 400/422. CloudHost.drain (till.html ~5900) stamps _status/_why/_code/_nextAt on the row, backs off 2 s to 5 min and goes on to the next row. It DOES stop the whole queue on 401/403 (unless TILL_SEND_REFUSED): a junk-value refusal must never use those.
(b) Conflicts: the ceiling (tolerant_outward_ceiling 8) is below 14; raised in this PR for cb-api to sign. POST /api/chits/send keys beyond its five schema keys (recipients, client_ref ...) are read by the handler but not in the schema: unchanged here, said in the PR.
(c) Simpler way: none for the typing (the schema is the one place). No web change: the drain already parks.
(d) Risks: a type narrower than what some old counter sent strands a queued row (parked, visible, set-aside-able, never lost). Types follow the git history (ids text, flags boolean, points number, null for none). The generated contract cases take a union's first kind, so no key lists both text and number.
(e) VERDICT: BUILD WITH CHANGES (hide/unhide moved from strict to tolerant; ceiling raised to 14; no web twin PR).
