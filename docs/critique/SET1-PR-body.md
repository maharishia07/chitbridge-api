VERDICT: BUILD WITH CHANGES (critique: web docs/critique/SET1.md). Twin of the web PR of the same branch; LAND THIS FIRST, after IX0.
The till master's openGst and billWarnFix(state) now open CB Settings › Your shop (`settings.html#/shop`) instead of the workshop. The web's `public/till.html` is a byte copy of it.
No route, SQL or engines change, so no round-trips line. The `node scripts/guards.cjs` offline gate passes (5007 checks).
Flow: O2C · counter bill → fix the shop's state/GSTIN. Reuse: the till's existing cbRoot() door; no new function.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
