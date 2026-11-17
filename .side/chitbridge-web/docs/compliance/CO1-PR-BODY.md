**VERDICT: BUILD WITH CHANGES** (`docs/critique/CO1.md`) — no new screen and no public policy page (policy text, officer, DPAs are owner acts → `docs/compliance/OWNER-ACTIONS.md`).
Register (`cap-standards.js`): 7 privacy rows for IN · AU · AE (sub-processors/transfers, SPDI r.4/r.5(9), Intermediary r.3(2), DPDP s.9, AU APPs + Spam Act, UAE PDPL rights, PDPL RoPA/DPIA) — 6 Partly, 1 Planned, none In force; DPDP row updated; `STD_COUNTRIES` + AU, AE; 10 glossary entries; checked 13 Oct.
`standards.html`: Group/Count by Country now reads STD_COUNTRIES (was hard-coded India/Global). Docs: `docs/compliance/ROPA.md`, `DPIA.md` (drafts to sign), `OWNER-ACTIONS.md` (O1 run b306/b307 · O2 policy · O3 officer · O4 lawyer · O5–O6 DPAs …). flows.json L2C step 6.
Evidence: api `GET /api/privacy/facts` + `tests/privacy.test.cjs` (twin PR, chitbridge-api round/CO1-38350590643 — land it first).
Checks: guard-static · token-guard · dup-functions · contract · check-syntax · check-app-parses all exit 0; `e2e/standards-page.cjs` 148/148 on this runner (counts re-pinned 68 = 61 designed + 7 CO1).
Conflict note: CO2/CO3 also append to cap-standards.js, OWNER-ACTIONS.md and the walk's counts.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
