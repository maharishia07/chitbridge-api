# BKP1 critique — written before any code (rule 00)

(a) What the brief assumes, checked
- TRUE: `.github/workflows/backup-restore.yml:82-87` uploads `cb-*.dump` (plain `pg_dump --format=custom`) as an artifact; api repo is PUBLIC (`gh repo view` → PUBLIC).
- TRUE: the job exits 1 at "Is the secret set?" (:37-41) when BACKUP_DATABASE_URL is unset → no dump was ever taken.
- FALSE (on this runner): "move the job to maharishia07/chitbridge-docs" — `../chitbridge-docs` is an empty clone and `git ls-remote` → 403;
  `gh repo view` cannot resolve it. chitbridge-engines IS private (`isPrivate:true`) and pushable → the nightly goes THERE (brief's own alternative).
- TRUE: the 5 tables exist — chit_header/identities/catalogue_items `migrations/000_baseline.sql`, books_setting `b272_books_ledger.sql`,
  journal_entry `b273_books_journal.sql`. (The old job counted `products`/`chit_status`; replaced by the brief's 5.)
- FALSE: "deploy/HOSTING.md + DEPLOY-RUNBOOK backup section" — HOSTING lives at `docs/HOSTING.md` (no backup row); DEPLOY-RUNBOOK has no
  backup section (only git bundles, :10). The only backup doc is `docs/HOSTING-COUPLING.md:111,239`. `deploy/proof-*.cjs` are HTTP probes — not reusable here.
- UNKNOWN: whether a read-only DB role exists — none in migrations (grep "backup" role) → the runbook says how to create one.
(b) Conflicts: one backup path — the dump/encrypt/restore/count logic moves into ONE script (`deploy/backup.sh`) in the api; the api's
  dry-run test AND the engines nightly both run that file (engines checks out the public api), so there is no second copy to drift.
  Engines rule 12 (serial): this adds only `.github/workflows/` — no engine code, no version bump, no tag.
(c) Simpler: `pg_dump --format=custom` is already compressed, so `| gzip` is dropped (custom format keeps pg_restore selective). Decrypt is
  piped straight into `pg_restore` → plaintext never touches disk at all, not even runner temp.
(d) Risks: SECURITY — the passphrase is the only key; lost = every backup unreadable (said in the runbook). pg_dump against RLS tables needs
  BYPASSRLS on the read-only role, or it fails loudly (fine: red, not silent). Pushing a workflow file may need the token's `workflows`
  scope (if refused, the file is in the report for the owner). No migration (role created by hand: it carries a password) → b415-b417 unused.
  Data residency: artifacts sit in GitHub storage (US) — same as before; India copy stays the open row in HOSTING-COUPLING:239.
(e) VERDICT: BUILD WITH CHANGES — nightly in chitbridge-ENGINES (docs repo unreachable); no gzip (custom format); one script shared by both repos.
