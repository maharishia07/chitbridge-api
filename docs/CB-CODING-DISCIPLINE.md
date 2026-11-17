# CB Coding Discipline — load this EVERY CLI session

Standing rules for working on Chit & Bridge, in force from the v9 reviewer sign-off (dev-cleared, not prod).
Read this first; it governs how work lands. Pairs with `AMENDMENT-CHECKLIST.md` (per-change gate), `CB-SYNC.md`
(spine), `THREAT-MODEL.md`, and `CORE-STABILISATION-BACKLOG.md` (the hardening order).

## The non-negotiables
1. **P0 tenant isolation.** Every query that touches a tenant table scopes on **`req.identity`** (the verified
   JWT) — **never** a client-supplied `entity_id`/id from body/params/query — and filters by `entity_id`. Treat
   any cross-entity leak as **drop-everything P0**. (Until RLS lands — B1 — this is the only net.)
2. **One change = one commit, held.** Each backlog item lands as its own commit on its feature branch. **Do NOT
   push past any red.** Never push to prod. Pushing to dev is Athi's authenticated action.
3. **"Done" means the DB-backed test/smoke passes — not `node --check`.** Static verification (syntax, diff-read,
   logic) is *necessary, not sufficient*. An item is only closed when its integration test / smoke is GREEN
   against a real DB. Say "static-verified, not run" honestly when that's the case.
4. **Keep TRUST/KB claims TRUE as features land.** Never assert a capability that isn't built (`assist-kb.js`,
   `TRUST.md`, web `ASSIST_LIB`). When a feature ships, re-true the claim; when it's only planned, say so.
5. **Re-stamp `CB-SYNC.md` each round** — true HEAD + a one-line summary of what landed.
6. **Bring back results per item** for the reviewer to re-verify before anything is considered closed.

## This phase (dev + experimentation, NOT prod)
- Keep **dormant**: `ASSIST_LLM` (assistant runs on the library floor), the **SMS** adapter, and any
  **customer-facing storefront**. These do not turn on in the dev/experiment phase.
- The prod gate (≥1 month out): **dev-smoke GREEN + migrations confirmed + the P0 stabilisation items landed**
  (A1/A2, B1, A4/A5, C1/C2, E1/E2). The smoke is the gate the reviewer holds.

## Mechanics (this workspace)
- Repos live at **`C:\dev\chitbridge-api`** and **`C:\dev\chitbridge-web`** (off the indexer-plagued Downloads).
- Shell scripts are **LF** (`.gitattributes` pins `*.sh eol=lf`); verify `bash -n` before trusting a `.sh`.
- After writing a file, confirm it's on disk **and** in `git ls-tree HEAD` before trusting a commit (the deleter
  history). Bundles: `C:\dev\cb-api-backup.bundle` / `cb-web-backup.bundle`.
- Run `AMENDMENT-CHECKLIST.md` before each change: tenant scope · `esc()` · `safeErr` · transactions ·
  void/terminal · circular-ref · MSG copy · demo segregation · leveled logging · loop/runaway guard · bounded reads.

## Definition of done, restated
`node --check` / `bash -n` / diff-read  →  *ready to test*.
DB-backed test or smoke GREEN  →  *done*.  Reviewer re-verify  →  *closed*.
