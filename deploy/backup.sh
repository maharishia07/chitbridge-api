#!/usr/bin/env bash
# backup.sh — THE ONE BACKUP PATH (BKP1, 2026-10-14). A backup nobody has restored is a rumour (Athi, 2026-09-07).
#
# Both workflows run THIS file, never a copy:
#   chitbridge-engines .github/workflows/backup-nightly.yml   (PRIVATE repo) — the real nightly, keeps the .enc 14 days
#   chitbridge-api     .github/workflows/backup-restore.yml   (PUBLIC repo)  — a dry run on a local Postgres, uploads nothing
#
#   bash deploy/backup.sh take    <out.enc>        BACKUP_DATABASE_URL + BACKUP_PASSPHRASE → an encrypted dump
#   bash deploy/backup.sh prove   <in.enc> <url>   BACKUP_PASSPHRASE → decrypt, restore into <url>, count the key tables
#   bash deploy/backup.sh prepare <url>            the Supabase roles + extensions a public-schema dump refers to
#
# ⚠️⚠️ THE PLAINTEXT NEVER TOUCHES A DISK. pg_dump is piped straight into openssl, and openssl -d straight into pg_restore.
#    No passphrase → `take` refuses BEFORE pg_dump starts, so there is nothing to upload by mistake.
# ⚠️ --format=custom is already compressed; a gzip in the pipe would only cost time (critique BKP1 (c)).
# ⚠️ The passphrase is the only key. Lose it and every backup is unreadable — docs/DEPLOY-RUNBOOK.md "Nightly backup".
set -euo pipefail

KEY_TABLES="chit_header journal_entry identities catalogue_items books_setting"
ENC=(-aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE)

die() { echo "backup: $*" >&2; exit 2; }
need_passphrase() {
  [ -n "${BACKUP_PASSPHRASE:-}" ] || die "BACKUP_PASSPHRASE is not set — refusing. Nothing was dumped, nothing can be uploaded."
  [ "${#BACKUP_PASSPHRASE}" -ge 20 ] || die "BACKUP_PASSPHRASE is shorter than 20 characters — refusing."
}
summary() { echo "$*"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$*" >> "$GITHUB_STEP_SUMMARY"; return 0; }

take() {
  local out="${1:?usage: take <out.enc>}"
  need_passphrase
  [ -n "${BACKUP_DATABASE_URL:-}" ] || die "BACKUP_DATABASE_URL is not set — nothing was backed up."
  local part="$out.part"
  rm -f "$part"
  pg_dump --no-owner --no-privileges --schema=public --format=custom "$BACKUP_DATABASE_URL" \
    | openssl enc "${ENC[@]}" -out "$part" \
    || { rm -f "$part"; die "the dump or its encryption failed — no file kept."; }
  # openssl's salted header is the proof the file is ciphertext; a custom-format dump would start PGDMP
  [ "$(head -c 8 "$part")" = "Salted__" ] || { rm -f "$part"; die "the output is not openssl ciphertext — refusing to keep it."; }
  mv "$part" "$out"
  summary "backup: $(basename "$out") $(du -h "$out" | cut -f1) encrypted (aes-256-cbc, pbkdf2 200000)"
}

prepare() {
  local url="${1:?usage: prepare <url>}"
  # Supabase policies name these roles and its columns default to extensions.*; without them a table can fail to restore
  psql -v ON_ERROR_STOP=1 -q "$url" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SQL
}

prove() {
  local in="${1:?usage: prove <in.enc> <url>}" url="${2:?usage: prove <in.enc> <url>}"
  need_passphrase
  prepare "$url"
  set +e
  openssl enc -d "${ENC[@]}" -in "$in" | pg_restore --no-owner --no-privileges --dbname "$url" 2> restore.log
  local st=("${PIPESTATUS[@]}")
  set -e
  [ "${st[0]}" = 0 ] || die "cannot DECRYPT $(basename "$in") — wrong passphrase or a damaged file. This backup is NOT restorable."
  # pg_restore carries on past objects a public-schema dump cannot recreate (grants to Supabase-only schemas); the counts decide
  [ "${st[1]}" = 0 ] || { echo "pg_restore finished with warnings (last 20):"; tail -20 restore.log; }
  local t n bad=0
  summary "restored $(basename "$in"):"
  for t in $KEY_TABLES; do
    n=$(psql "$url" -tAc "SELECT count(*) FROM public.$t" 2>/dev/null) || n=MISSING
    summary "  $t: $n"
    [ "$n" = MISSING ] && bad=1
  done
  [ "$bad" = 0 ] || die "a key table did not come back — this backup is NOT restorable."
  n=$(psql "$url" -tAc "SELECT count(*) FROM public.identities")
  [ "$n" -gt 0 ] || die "identities restored empty — the dump is not usable."
  summary "restore proof: OK"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  take) take "$@" ;;
  prove) prove "$@" ;;
  prepare) prepare "$@" ;;
  *) die "usage: backup.sh take <out.enc> | prove <in.enc> <url> | prepare <url>" ;;
esac
