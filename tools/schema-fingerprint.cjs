#!/usr/bin/env node
/**
 * tools/schema-fingerprint.cjs — IS THIS DATABASE'S SCHEMA THE SAME AS THAT ONE? (DB-REBASE, Athi 18 Oct 2026)
 * CARD 28-platform-and-operations/migrations-and-schema
 *
 *   node tools/schema-fingerprint.cjs --db <url> [--out fp.json]          the fingerprint of a LOCAL database: { key: [hash, detail] } (reads only)
 *   node tools/schema-fingerprint.cjs --prod-query <fp.json> --out <file.sql> [--label "…"]
 *                                                                          the ONE read-only query Athi runs on production: it embeds
 *                                                                          fp.json's hashes and answers only what differs (+ prod's ledger)
 *   node tools/schema-fingerprint.cjs --compare <a.json> <b.json>          a fingerprint, or a production answer, against a fingerprint
 *
 * OWNS       the comparison of two schemas object by object (key = 'tab:<t>:col|con|idx|pol|trg|rls|acl', 'fn:…', 'view:…', 'seq:…',
 *            'enum:…', 'ext:…', 'role:…'). The SQL is tools/schema-fingerprint.sql — ONE text on both sides, so the hashes agree.
 * CALLED BY  by hand: the re-baseline proof (fresh baseline = chain-built DB = production) and any later drift check;
 *            tests/schema-fingerprint.test.cjs. Never connects to production: production is read only through the query file the
 *            owner runs and pastes back.
 * FLOW       --db: SQL + jsonb_object_agg → file · --prod-query: SQL + VALUES(expected) + diff SELECT → .sql · --compare: diff lines
 */
'use strict';
const fs = require('fs'), path = require('path');
const CORE = fs.readFileSync(path.join(__dirname, 'schema-fingerprint.sql'), 'utf8').replace(/^--.*\n/gm, '').trim();
const LOCAL_SELECT = 'SELECT jsonb_object_agg(k, jsonb_build_array(h, d))::text AS fingerprint FROM fph;';
const DETAIL_SHOWN = 400;

/** the fingerprint of a local database, as { key: [hash, detail] } */
async function fingerprint(url) {
  const { Pool } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
  const pool = new Pool({ connectionString: url, max: 1 });
  try { return JSON.parse((await pool.query(CORE + '\n' + LOCAL_SELECT)).rows[0].fingerprint); } finally { await pool.end(); }
}

const literal = (text) => "'" + String(text).replace(/'/g, "''") + "'";
const ANSWER_SELECT = [
  'SELECT jsonb_build_object(',
  "  'pg', current_setting('server_version'), 'at', now(),",
  "  'same', (SELECT count(*) FROM fph JOIN expected e USING (k) WHERE fph.h = e.h),",
  "  'diff', (SELECT jsonb_object_agg(f.k, f.d) FROM fph f LEFT JOIN expected e USING (k) WHERE e.h IS DISTINCT FROM f.h),",
  "  'missing', (SELECT jsonb_agg(e.k ORDER BY e.k) FROM expected e WHERE NOT EXISTS (SELECT 1 FROM fph f WHERE f.k = e.k)),",
  "  'ledger', CASE WHEN to_regclass('public.schema_migrations') IS NOT NULL THEN",
  "     (xpath('/row/x/text()', query_to_xml('SELECT string_agg(filename || ''|'' || coalesce(source, ''''), '','' ORDER BY filename) AS x FROM public.schema_migrations', false, true, '')))[1]::text END",
  ')::text AS fingerprint;'];
/** the paste-back query: production's fingerprint against `expected`'s hashes; answers same · diff · missing · ledger */
function prodQuery(expected, label, fileName) {
  const rows = Object.keys(expected).sort().map((key) => '(' + literal(key) + ',' + literal(expected[key][0]) + ')');
  return [
    '-- ' + fileName + ' — READ-ONLY. One statement, one row, one column ("fingerprint"): copy that JSON value back to Claude.',
    "-- It builds production's schema fingerprint (tools/schema-fingerprint.sql) and compares it with " + label + ',',
    '-- embedded below as hashes, so it returns ONLY what differs: same = objects that match · diff = {object: prod detail} for each that',
    "-- differs or exists only in prod · missing = objects prod lacks · ledger = prod's schema_migrations file names (null without the table).",
    '-- It writes nothing, creates nothing, and reads no business rows.',
    CORE + ',', 'expected(k, h) AS (VALUES', rows.join(',\n'), ')'].concat(ANSWER_SELECT, ['']).join('\n');
}

const isAnswer = (json) => 'same' in json || 'diff' in json || 'missing' in json;
/** a production answer ({ diff, missing }) read against the fingerprint it was made from → the same { key: [hash|null, detail] } shape */
function asFingerprint(json, reference) {
  if (!isAnswer(json)) return json;
  const out = Object.assign({}, reference);
  for (const key of json.missing || []) delete out[key];
  for (const [key, detail] of Object.entries(json.diff || {})) out[key] = [null, detail];
  return out;
}
/** two entries agree: same hash, or (an answer carries no hash) the same detail */
const agree = (first, second) => first && second && (second[0] === null ? JSON.stringify(first[1]) === JSON.stringify(second[1]) : first[0] === second[0]);
/** the -/+ lines of one differing object: members for a list, the values otherwise */
function detailLines(first, second) {
  const before = first ? first[1] : null, after = second ? second[1] : null;
  if (Array.isArray(before) && Array.isArray(after)) {
    return before.filter((member) => !after.includes(member)).map((member) => '    - ' + member)
      .concat(after.filter((member) => !before.includes(member)).map((member) => '    + ' + member));
  }
  if (!first || !second) return [];
  return ['    - ' + JSON.stringify(before).slice(0, DETAIL_SHOWN), '    + ' + JSON.stringify(after).slice(0, DETAIL_SHOWN)];
}
/** the lines that differ between `expected` (a fingerprint) and `other` (a fingerprint or an answer); empty = the same */
function compare(expected, other) {
  const second = asFingerprint(other, expected), lines = [];
  for (const key of [...new Set(Object.keys(expected).concat(Object.keys(second)))].sort()) {
    if (agree(expected[key], second[key])) continue;
    const where = !expected[key] ? '   (only in the second)' : (!second[key] ? '   (missing from the second)' : '');
    lines.push(key + where, ...detailLines(expected[key], second[key]));
  }
  return lines;
}

module.exports = { fingerprint, prodQuery, compare, CORE };

/** the command line: --db · --prod-query · --compare */
async function main(argv) {
  const option = (name) => { const at = argv.indexOf('--' + name); return at >= 0 ? argv[at + 1] : undefined; };
  const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
  if (option('db')) {
    const result = await fingerprint(option('db')), text = JSON.stringify(result);
    if (!option('out')) return process.stdout.write(text);
    fs.writeFileSync(option('out'), text); return console.log('  ' + Object.keys(result).length + ' objects → ' + option('out'));
  }
  if (option('prod-query')) {
    if (!option('out')) throw new Error('--prod-query needs --out <file.sql>');
    fs.writeFileSync(option('out'), prodQuery(readJson(option('prod-query')), option('label') || 'the expected fingerprint', path.basename(option('out'))));
    return console.log('  wrote ' + option('out'));
  }
  if (option('compare')) {
    const at = argv.indexOf('--compare'), lines = compare(readJson(argv[at + 1]), readJson(argv[at + 2]));
    console.log(lines.length ? lines.join('\n') : '  the same');
    process.exitCode = lines.length ? 1 : 0; return undefined;
  }
  console.error('  say --db <url> | --prod-query <fp.json> --out <file.sql> | --compare <a.json> <b.json>'); process.exitCode = 2;
  return undefined;
}
if (require.main === module) main(process.argv.slice(2)).catch((error) => { console.error('  ✗ schema-fingerprint: ' + error.message); process.exitCode = 1; });
