# CU2 critique — ui_prefs writes become merge-patches (written before any code, 2026-10-13)

**(a) What the brief assumes, checked**
- "The theme save REPLACES the whole ui_prefs store" — TRUE: routes/entities.js `savePrefSet` runs `UPDATE identities SET ${set.column} = $1` (the whole column) for both kinds; it serves PATCH /me/prefs/ui, /me/prefs/locale and the legacy /me/locale.
- "…and erases the product-rows choice" — TRUE for the owner (their identity row IS the entity row): app.html `prodRowsSave` writes `ui_prefs.product_rows` through PATCH /entities/profile; the next theme push (avatar.js `push` → CBPrefs → savePrefs) wipes it.
- "Server-side too" — the /profile writer already merges (`COALESCE(ui_prefs,'{}') || $1`, routes/entities.js:948) but a null cannot delete (not RFC 7386), and the web caller sends `Object.assign({}, me.ui_prefs, {product_rows})` — the WHOLE store from the /me snapshot, so a theme changed since page load is reverted by a product-rows save. FALSE that only the server is wrong: the web caller must send the patch only.
- avatar.js `push` always sends all four ui keys ('' = default) and CBLocale.push sends all its keys — so under merge-patch ('' / null = remove) their own keys behave exactly as today. TRUE (avatar.js:162, locale.js:414).
- FIELDS entries for ui_prefs keys — none exist (docs/FIELDS.md has no ui_prefs/locale_prefs section). TRUE.

**(b) Conflicts with rules/constructs** — none new: no new store, no new key, no new route. One handler stays one handler (savePrefSet); the merge lives in its one UPDATE. The audit also asks to MOVE `product_rows` to a policy flag: that adds an 18th policy_flags write site just before CU8 makes `mergeFlag` the one writer, and needs a data-copy migration — deferred to CU8 (named in the PR). The merge alone ends the data loss.

**(c) Simpler way** — no helper module: the merge-patch is one SQL expression `(COALESCE(col,'{}') - $drop::text[]) || $set::jsonb` used by both writers; the key split (set vs drop) is a small pure function in the route file, exported for the test.

**(d) Risks** — data: none destroyed; keys outside the whitelist already in the column now survive (intended). Locale gets merge too (same handler; its clients send every key, so no visible change; partial pushes stop erasing). Response `prefs` becomes the MERGED store (no client reads it — CBPrefs and avatar.js fire-and-forget). No migration (b322–b324 unused). No engines. Twin: api first, web after (web alone is also safe: /profile already merges). CU3 touches the same PREF_SETS keys — it adds keys only; no clash with the UPDATE.

**(e) VERDICT: BUILD WITH CHANGES** — merge-patch in savePrefSet + /profile ui_prefs (null deletes); web prodRowsSave sends `{product_rows}` only; FIELDS entries for every ui_prefs + locale_prefs key; api test that saving one pref keeps the others. product_rows → policy flag deferred to CU8.
