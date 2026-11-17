VERDICT: BUILD WITH CHANGES (chitbridge-engines docs/critique/ENG-R1.md). Lands AFTER the engines PR (tag v1.43.0), BEFORE the web PR.
Adopts tax v1.43.0 (`tools/adopt.cjs`; only the `tax` pin moves; `--check` ✓): a tax-inclusive line totals exactly qty × price; the till master is unchanged.
Bill harness (`tests/tax-truth.test.cjs`) + 2 checks: the walk's cart (2 × 65 @ 5%, 3 × 40 @ 18%) — lines 130.00 / 120.00, and the printed slip and reprint rate rows 123.80+3.10+3.10 / 101.70+9.15+9.15, TOTAL 250.00 (fails on the old engine, which printed 123.81 / 101.69).
Changed expectations: tax-truth IGST variant 995.77 / 998.21 / 1118.16 → 995.76 / 998.20 / 1118.15 (it was a paisa above the line nets); tax.test splitLineTax ×2. No route, no SQL, no new dependency.
Checks: guards.cjs ✓ (5011). `tax.test.js` (3) and `bill-checks.test.js` fail identically on main.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
