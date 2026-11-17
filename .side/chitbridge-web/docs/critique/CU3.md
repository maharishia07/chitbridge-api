# CU3 critique — timezone · workdays · font · bold reach the server (audit CUSTODIAN-AUDIT-2026-10-13 row CU3)
Stacked on CU2 (api #142, web #188). Written before any code.

**(a) What the brief assumes, checked**
- tz/workdays are sent and dropped — TRUE: CBLocale.KEYS has them (public/app/locale.js:313), api PREF_SETS.locale.keys does not (api routes/entities.js:584); prefPatch walks set.keys only (:637), so they vanish.
- font/weight never leave the device — TRUE: avatar.js push body is theme·fs·motion·stripes (avatar.js:163), set() pushes only those (:214), hydrate reads only those (:179); ui.keys lacks them (entities.js:617).
- cap-admin reads localStorage beside CBLocale — TRUE: cap-admin.js:4176 (`cb_locale`) and :4209 (`cb_tz`); CBLocale.getExt('locale'|'tz') returns the same raw value.
- "the ONE prefs write" exists — TRUE: savePrefSet + MERGE_PATCH_SQL (CU2); CBPrefs.push (core.js:272) is the one web door.

**(b) Conflicts / hidden traps**
- A tz is `Area/City` and workdays is `1,2,3` — the generic value pattern (entities.js:642) rejects `/` and `,`, and a rejected key 400s the WHOLE locale save (the language too). Each needs its own pattern; tz is checked by ICU (`Intl.DateTimeFormat(…,{timeZone})`), like the other locale keys — not a hand list.
- CU2 made writes merge-patches, but CBLocale.push sends prefs() — non-empty keys only — so "use my device's zone" / "regional default" (clearing an override) would never reach the server and another device would keep the old override. Push must send snapshot() (empties = drop) — the same rule avatar.js already follows.
- font/weight are OUR enumerations → closed lists, as theme/fs/motion are (FONTS in avatar.js; normal|bold).

**(c) Simpler way** — none smaller: four keys on two existing whitelists, the two existing pushes/hydrates widened. No new store, route, column or migration (jsonb columns already exist; b334–b336 unused).

**(d) Risks** — data: none lost (merge-patch). Twin landing: web before api is harmless (an old server ignores unknown keys, as today); api first is preferred. Not in this row: the shop's `identities.timezone` vs the person's `tz` (audit row 38, "no rule says which a bill uses") — left for a rule round.

**(e) VERDICT: BUILD WITH CHANGES** — (1) tz/workdays get their own patterns + an ICU tz check; (2) CBLocale.push sends every key so a cleared override reaches the server.
