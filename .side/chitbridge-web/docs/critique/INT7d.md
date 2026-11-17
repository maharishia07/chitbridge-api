# INT7d critique — integrate/1016b (web half), written before any merge
(a) Assumptions: web #309 (CRM-FIX: 3 files) and #308 (ORD-FIX: public/till.html only) are open, unmerged — TRUE (gh pr list).
    Stacked on integrate/1016a (#310 open) — TRUE, branch exists; origin/main merged in: already up to date.
    Contract fixture is a byte copy of api docs/contracts/web-api.json — api #262 changes it; re-copy after the api merges (--write + copy).
    till.html is vendored: ORD-FIX's copy must equal the api master after api #260 lands — vendor-till.cjs re-copy decides, not the PR's copy.
(b) Conflicts with rules: none new. No new function/field/screen; edits are the PRs' own. §6 readability guard applies to touched files.
(c) Simpler: none — the brief fixes the order (web half first).
(d) Risks: contract fixture and till.html can conflict between the PRs and the api re-gen (take the api master, then byte copy);
    landing after integrate/1016a; no migration numbers expected from the web half; engines untouched.
(e) VERDICT: BUILD AS BRIEFED.
