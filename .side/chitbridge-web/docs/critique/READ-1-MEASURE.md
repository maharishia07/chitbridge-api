# Critique · READ-1-MEASURE (baseline, read-only)
(a) Assumptions
- api/web branch `integrate/1014d` exists — TRUE (origin/integrate/1014d in both). Engines has only `main` — TRUE, measured at main.
- "web tools/graph KG1 has function names + line spans" — PARTLY: tools/graph/scan.cjs is a hand lexer (README: "acorn/espree are in no lockfile; no new dependency"); it gives names and spans but not params, declarations, nesting or comments.
- "prims.cjs / lists.cjs style counters" — FALSE here: neither file exists in any of the three repos (find). MAINT-1 baseline doc — UNKNOWN: ../chitbridge-docs is empty on this runner, scope rule taken from the brief text.
- acorn/espree via npx — TRUE for npm (installs); not in any lockfile, so the tool loads it from NODE_PATH or a temp dir and adds NO dependency.
(b) Conflicts: none. Read-only; no screen, no money, no route, no migration (b661–b663 unused). Reuse: scope exclusions copied from the ADOPTED-header rule that graph.cjs already uses (`vendors`).
(c) Simpler: widening scan.cjs would force a second lexer to learn params/nesting; an AST script is smaller and exact. scan.cjs stays untouched; the tool reuses its file-scope idea only.
(d) Risks: HTML <script> blocks need line offsets (handled); app.html is 18k lines (acorn handles it); a parse failure is reported, never hidden; other rounds touch no file I add (tools/readability.cjs, docs/planning/READ-1-*, this file).
(e) VERDICT: BUILD WITH CHANGES — own AST script instead of widening KG1; prims/lists counters absent, so R1–R6 are counted from scratch; engines measured from main.
