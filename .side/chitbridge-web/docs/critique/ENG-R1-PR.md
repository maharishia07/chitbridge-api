VERDICT: BUILD WITH CHANGES (chitbridge-engines docs/critique/ENG-R1.md). Lands LAST: engines (tag v1.43.0) → api → this.
Adopts tax v1.43.0 (public/engine/tax.js, public/app/tax.js via tools/adopt.cjs; only the `tax` pin moves). The till re-vendored with CB_WEB_DIR — current, no master change.
Effect: a tax-inclusive line on the bill sheet, the counter slip and the reprint is exactly qty × price (2 × 65 = 130.00, not 130.01); the screens paint what CBTax computed.
Checks: guard-static · token-guard · dup-functions · contract · check-syntax · check-app-parses ✓.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
