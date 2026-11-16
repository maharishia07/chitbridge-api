#!/usr/bin/env node
'use strict';
/**
 * tools/speed17-marks-explain.cjs — l17 speed proof: EXPLAIN ANALYZE of the marks key statements (mark-detect.nowSql, review-mark.coverageSql cleared) for one client on a seeded depth database.
 * usage: ADMIN=postgres://… (superuser, to find the client) APP=postgres://… (the api's own role: the explain runs UNDER ROW SECURITY, where a non-leakproof cast in a join cannot be an index condition) ROOT=/path/to/api-tree FIRM=<firm id> node tools/speed17-marks-explain.cjs   (ROOT defaults to this tree; run it once per tree to compare)
 * Prints per statement: execution ms (median of 7), the indexes read, and whether journal_entry_pkey served the key compare. Exit 1 when journal_entry is Seq Scanned or its key index (journal_entry_pkey) is not used by a statement (the cast is back).
 * OWNS the on-database proof of the marks key rule.   CALLED BY hand on a SIT box (never production).
 */
const { Client } = require('pg');
const root = process.env.ROOT || require('path').join(__dirname, '..');
const detect = require(root + '/lib/mark-detect.js'), RM = require(root + '/lib/review-mark.js'), A = require(root + '/lib/mark-adopters.js');
const adopter = A.adopterOf('acc.audit');
/* every index a node reads, plus a marker for a journal_entry Seq Scan */
const scans = (n, out = []) => { if (n['Node Type'] === 'Seq Scan' && n['Relation Name'] === 'journal_entry') out.push('Seq Scan journal_entry'); if (n['Index Name']) out.push(n['Index Name']); (n.Plans || []).forEach((p) => scans(p, out)); return out; };
(async () => {
  const a = new Client({ connectionString: process.env.ADMIN }); await a.connect();
  const c = new Client({ connectionString: process.env.APP || process.env.ADMIN }); await c.connect();
  const client = (await a.query("SELECT identity_id id FROM identities WHERE bridge_id = 'BR-MISD-77'")).rows[0].id;
  const ids = (await a.query("SELECT subject_id FROM review_mark WHERE entity_id = $1 LIMIT 60", [client])).rows.map((r) => r.subject_id);
  const stmts = [['nowSql (40 marked ids)', detect.nowSql(adopter), [client, ids]], ['coverage cleared', RM.coverageSql(adopter).cleared, [client, 'acc.audit', '2020-01-01', '2026-11-16']]];
  let bad = 0;
  for (const [name, sql, params] of stmts) {
    const ms = [], seen = new Set(); let rows = 0;
    for (let i = 0; i < 8; i++) {
      await c.query('BEGIN'); await c.query("SELECT set_config('app.current_entity', $1, true)", [client]);
      const r = await c.query('EXPLAIN (ANALYZE, FORMAT JSON) ' + sql, params); await c.query('ROLLBACK');
      const j = r.rows[0]['QUERY PLAN'][0]; if (i) ms.push(j['Execution Time']); scans(j.Plan).forEach((s) => seen.add(s));
    }
    ms.sort((a, b) => a - b);
    const seq = [...seen].some((s) => /^Seq Scan/.test(s)), pk = seen.has('journal_entry_pkey'); if (seq || !pk) bad++;
    console.log(JSON.stringify({ stmt: name, exec_ms_median: Math.round(ms[3] * 100) / 100, indexes: [...seen], seq_scan: seq, key_index_used: pk }));
  }
  await c.end(); await a.end(); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e.stack); process.exit(2); });
