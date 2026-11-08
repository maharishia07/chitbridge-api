#!/usr/bin/env node
/* tools/cur1-census-read.cjs — turns the pasted output of migrations/READ-2026-11-09-1-cur1-census.sql into the decisions CUR-1 needs.
 * OWNS: the reading of the census output (unknown codes, rows each slice touches, review-list size, Q3/Q4/Q5 answers). It reads a file
 *       or stdin and writes words to stdout. It never connects to a database and writes nothing.
 * CALLED BY: Athi or Claude after the census is run (SIT now, production by Athi).  CARD: PM/CUR-1-PLAN-2026-11-08.md section 2.0 and slice 2.
 * FLOW: finance, money type (CUR-1 slice 2).
 * Usage: node tools/cur1-census-read.cjs census.csv      (or: ... < census.csv)    Add --json for the facts as JSON.
 * Accepted input: the CSV the Supabase editor downloads, a tab-separated copy of the grid, or psql -A output ('|' separated).
 * Exit code: 0 when the release gate (Q3) is clear and the checks agree, 1 when it is not, 2 when the input is not a census. */
'use strict';
const fs = require('fs');

const REVIEW_BUCKETS = ['stated_disagrees', 'detail_rows_disagree', 'detail_vs_stated', 'detail_partly_null', 'money_without_currency'];
const BACKFILL_BUCKETS = { stated: 'backfill_stated', detail: 'backfill_detail', none: 'backfill_none' };
const NOT_A_CODE_CLASSES = ['ISO', 'NULL', 'EMPTY', 'NON_STRING'];
/* slots that hold WORDS under a currency-like key (where Country setup took the answer from), not codes: listed, never counted as unknown codes */
const WORD_SLOTS = ['entity_governance.setup_source:currency'];

/** split one line of CSV (RFC 4180 quotes), tab or pipe output into cells */
function cellsOf(line, sep) {
  if (sep !== ',') return line.split(sep).map((x) => x.trim());
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** which separator the header line uses */
function separatorOf(header) {
  if (header.includes('\t')) return '\t';
  if (header.includes('|')) return '|';
  return ',';
}

/** the rows of the output as objects {section,a,b,c,d,n}; null when the text is not a census */
function parse(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !/^[-+\s|]+$/.test(l) && !/^\(\d+ rows?\)/.test(l));
  const start = lines.findIndex((l) => /^\s*"?section"?\s*[,\t|]/i.test(l));
  if (start < 0) return null;
  const sep = separatorOf(lines[start]);
  const head = cellsOf(lines[start], sep).map((x) => x.toLowerCase());
  const rows = lines.slice(start + 1).map((l) => {
    const cells = cellsOf(l, sep);
    const row = {};
    head.forEach((h, i) => { row[h] = cells[i] === undefined ? '' : cells[i]; });
    return row;
  });
  return rows.filter((r) => r.section);
}

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const sum = (rows) => rows.reduce((t, r) => t + num(r.n), 0);

/** the meta facts and the checks the output must pass before anything is concluded from it */
function checksOf(rows) {
  const meta = {};
  rows.filter((r) => r.section === 'meta').forEach((r) => { meta[r.a] = r.n; });
  const check = {};
  rows.filter((r) => r.section === 'check').forEach((r) => { check[r.a] = num(r.n); });
  const buckets = rows.filter((r) => r.section === 'bucket');
  const problems = [];
  if (meta.role_bypasses_rls !== 'true' && meta.is_superuser !== 'on' && num(meta.chit_header_rows_visible) === 0) {
    problems.push('the role was filtered by row-level security (0 chit headers visible): run the census as postgres');
  }
  if (sum(buckets) !== check.chit_headers) problems.push('the bucket rows add up to ' + sum(buckets) + ' but chit_header has ' + check.chit_headers);
  if (check.bucket_rows_total !== check.chit_headers) problems.push('bucket_rows_total ' + check.bucket_rows_total + ' differs from chit_headers ' + check.chit_headers);
  const reviewRow = rows.find((r) => r.section === 'review' && r.a === 'review_copies_total');
  const reviewByBuckets = sum(buckets.filter((r) => REVIEW_BUCKETS.includes(r.a) || r.d === 'copies_disagree'));
  if (reviewRow && num(reviewRow.n) !== reviewByBuckets) problems.push('review_copies_total ' + reviewRow.n + ' differs from the bucket rows read the same way (' + reviewByBuckets + ')');
  if (!reviewRow) problems.push('the review rows are missing');
  return { meta, check, problems };
}

/** every distinct value found in a currency slot, with its class, rows and where */
function codesOf(rows) {
  const byValue = new Map();
  rows.filter((r) => r.section === 'code').forEach((r) => {
    const key = r.b + '\u0000' + r.c;
    const slot = byValue.get(key) || { value: r.b, cls: r.c, rows: 0, slots: new Map() };
    slot.rows += num(r.n);
    slot.slots.set(r.a, (slot.slots.get(r.a) || 0) + num(r.n));
    byValue.set(key, slot);
  });
  const all = [...byValue.values()];
  const wordOnly = (s) => [...s.slots.keys()].every((k) => WORD_SLOTS.includes(k));
  return {
    iso: all.filter((s) => s.cls === 'ISO').sort((x, y) => y.rows - x.rows),
    unknown: all.filter((s) => !NOT_A_CODE_CLASSES.includes(s.cls) && !wordOnly(s)).sort((x, y) => y.rows - x.rows),
    words: all.filter((s) => !NOT_A_CODE_CLASSES.includes(s.cls) && wordOnly(s)),
    nullish: all.filter((s) => ['NULL', 'EMPTY', 'NON_STRING'].includes(s.cls))
  };
}

/** the b846 buckets, how many chit copies each slice-3 branch touches, and the Q4 stamp split of the unstated money */
function bucketsOf(rows) {
  const buckets = rows.filter((r) => r.section === 'bucket');
  const total = (pred) => sum(buckets.filter(pred));
  const money = buckets.filter((r) => r.a === 'money_without_currency');
  const stampOf = (cls) => sum(money.filter((r) => r.c === cls));
  const stampClasses = [...new Set(money.map((r) => r.c))].sort();
  return {
    all: total(() => true),
    backfill: Object.fromEntries(Object.entries(BACKFILL_BUCKETS).map(([bucket, source]) => [source, total((r) => r.a === bucket)])),
    review: Object.fromEntries(REVIEW_BUCKETS.map((b) => [b, total((r) => r.a === b)])),
    copiesDisagreeOutsideReview: total((r) => r.d === 'copies_disagree' && !REVIEW_BUCKETS.includes(r.a)),
    moneyWithoutCurrencyByStamp: Object.fromEntries(stampClasses.map((c) => [c, stampOf(c)])),
    stampUsable: stampOf('stamp_before_chit')
  };
}

/** the facts, as one object */
function factsOf(rows) {
  const checks = checksOf(rows);
  const codes = codesOf(rows);
  const buckets = bucketsOf(rows);
  const pick = (section, a) => { const r = rows.find((x) => x.section === section && x.a === a); return r ? num(r.n) : null; };
  const stamp = {};
  rows.filter((r) => r.section === 'stamp').forEach((r) => { stamp[r.a] = r.n; });
  const nocur = rows.filter((r) => r.section === 'nocur' && r.c === 'money').map((r) => ({ table: r.a, money_rows: num(r.n) }));
  return {
    checks, codes, buckets, stamp, nocur,
    review: {
      total: pick('review', 'review_copies_total'),
      test_held: pick('review', 'review_copies_test_held'),
      chits_with_test_and_real_copy: pick('review', 'review_chits_with_a_test_copy_and_a_real_copy')
    },
    detail: {
      money_rows_currency_null: pick('detail', 'chit_detail_money_rows_currency_null'),
      money_rows_currency_empty: pick('detail', 'chit_detail_money_rows_currency_empty'),
      chit_ids_copies_in_different_currencies: pick('detail', 'chit_ids_copies_in_different_currencies')
    }
  };
}

const list = (arr) => arr.map((s) => '  ' + s).join('\n');

/** the answer in words: Q3 (release gate), the rows each slice touches, Q4 (stamp), Q5 (review list) */
function report(f) {
  const out = [];
  out.push('CUR-1 CENSUS · read at ' + (f.checks.meta.ran_at || '?') + ' · run as ' + (f.checks.meta.current_user || '?') + ' · server ' + (f.checks.meta.server_version || '?'));
  out.push(f.checks.problems.length ? 'CHECKS FAILED:\n' + list(f.checks.problems) : 'Checks agree: bucket rows add up to the ' + f.checks.check.chit_headers + ' chit headers; the review size matches its buckets.');
  const u = f.codes.unknown;
  out.push('\nQ3 · RELEASE GATE (strict ISO 4217 list, ' + (f.checks.meta.iso_list_size || '?') + ' codes): ' + (u.length ? 'NOT CLEAR, ' + u.length + ' value(s) are not on the list' : 'CLEAR, every code found is on the list'));
  out.push('Codes found: ' + f.codes.iso.map((s) => s.value + ' ' + s.rows).join(' · '));
  if (u.length) {
    out.push('Not on the list (athi decides: a read-only "withdrawn" list, or review):');
    out.push(list(u.map((s) => s.cls + ' "' + s.value + '" · ' + s.rows + ' rows · in ' + [...s.slots.entries()].map(([k, v]) => k + ' ' + v).join(', '))));
  }
  if (f.codes.words.length) out.push('Words, not codes, under a currency key (' + WORD_SLOTS.join(', ') + '): ' + f.codes.words.length + ' values, ' + sum(f.codes.words.map((s) => ({ n: s.rows }))) + ' rows. Not a currency; left out of the gate.');
  out.push('Null, empty or non-string values in a currency slot: ' + f.codes.nullish.map((s) => s.value + ' ' + s.rows + ' (' + [...s.slots.keys()].join(', ') + ')').join(' · '));
  out.push('\nMONEY WITH NO CURRENCY');
  out.push('  chit_detail money rows with currency null: ' + f.detail.money_rows_currency_null + ' · empty: ' + f.detail.money_rows_currency_empty + ' · chit ids whose copies differ in currency: ' + f.detail.chit_ids_copies_in_different_currencies);
  out.push('  chit copies with money and no currency anywhere (money_without_currency): ' + f.buckets.review.money_without_currency);
  out.push('  tables with money and no currency column (slice 7 pairs them): ' + f.nocur.filter((t) => t.money_rows > 0).map((t) => t.table + ' ' + t.money_rows).join(' · '));
  out.push('\nROWS EACH SLICE TOUCHES · slice 3 (b846), per chit copy (' + f.buckets.all + ' in all)');
  out.push(list(Object.entries(f.buckets.backfill).map(([k, v]) => k + ': ' + v).concat(Object.entries(f.buckets.review).map(([k, v]) => 'review ' + k + ': ' + v))));
  out.push('  copies in a chit whose copies disagree, outside the buckets above: ' + f.buckets.copiesDisagreeOutsideReview);
  out.push('\nQ4 · THE COUNTRY-SETUP STAMP (entity_governance.country_setup_at)');
  const s = f.stamp;
  out.push('  It has a date: ' + (s.stamp_set > 0 ? 'yes' : 'no') + ' · set on ' + s.stamp_set + ' of ' + s.entities_with_governance_row + ' entities, null on ' + s.stamp_null + ' · earliest ' + s.stamp_earliest + ' · latest ' + s.stamp_latest);
  out.push('  entities whose stamp is later than their own first sent chit: ' + s.entities_stamp_after_their_first_sent_chit + ' · entities with no identity currency: ' + s.entities_with_identity_currency_null_or_empty);
  out.push('  money_without_currency copies by stamp: ' + (Object.entries(f.buckets.moneyWithoutCurrencyByStamp).map(([k, v]) => k + ' ' + v).join(' · ') || 'none') + ' → ' + f.buckets.stampUsable + ' can take source "setup", the rest go to review');
  out.push('  chit copies of every bucket whose sender stamp is AFTER the chit or missing (predate rule fails): see the bucket rows with c = stamp_after_chit | stamp_null | no_governance_row');
  out.push('\nQ5 · REVIEW LIST: ' + f.review.total + ' chit copies (test-held ' + f.review.test_held + ', chits with a test copy and a real copy ' + f.review.chits_with_test_and_real_copy + ')');
  out.push('  Purge candidates are the test-held copies; a chit that also has a real copy must keep it (a shop\'s purge never removes another party\'s copy).');
  return out.join('\n');
}

/** the exit code: 0 clear, 1 not clear or checks failed */
function verdict(f) { return f.checks.problems.length || f.codes.unknown.length ? 1 : 0; }

function main(argv) {
  const json = argv.includes('--json');
  const file = argv.find((a) => !a.startsWith('--'));
  const text = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  const rows = parse(text);
  if (!rows) { process.stderr.write('This is not the census output (no header line starting with "section").\n'); return 2; }
  const f = factsOf(rows);
  const toJson = (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v);
  process.stdout.write((json ? JSON.stringify(f, toJson, 2) : report(f)) + '\n');
  return verdict(f);
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { parse, factsOf, report, verdict, checksOf, codesOf, bucketsOf };
