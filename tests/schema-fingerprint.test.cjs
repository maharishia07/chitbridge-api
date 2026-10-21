#!/usr/bin/env node
/**
 * tests/schema-fingerprint.test.cjs — THE ONE BASELINE AND ITS PROOF TOOL (DB-REBASE, 18 Oct 2026). No database, no network.
 *
 * OWNS     the offline half of the re-baseline: the baseline file is the one migrate.cjs runs, LF only (a CRLF checkout put \r into
 *          every function body), never run on production by its own words; the paste-back query is one read-only statement; the
 *          comparison finds a changed object in a fingerprint AND in a production answer. The database half is by hand:
 *          tools/schema-fingerprint.cjs --db on a fresh build (MANIFEST.md "Proven").
 * FLOW     baseline file checks → prodQuery shape → compare on synthetic fingerprints and answers
 */
'use strict';
const fs = require('fs'), path = require('path');
const mig = require('../tools/migrate.cjs');
const { prodQuery, compare, CORE } = require('../tools/schema-fingerprint.cjs');

let checks = 0, failed = 0;
const check = (what, ok, extra) => { checks++; if (!ok) failed++; console.log((ok ? '  ✓ ' : '  ✗ ') + what + (ok || !extra ? '' : '   ' + extra)); };

console.log('\n── the one baseline ──');
const baselinePath = path.join(__dirname, '..', 'migrations', mig.BASELINE[0]);
const baseline = fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath, 'utf8') : '';
check('migrate.cjs runs exactly one baseline, and it exists', mig.BASELINE.length === 1 && baseline.length > 100000, mig.BASELINE.join(', '));
check('the baseline is LF only (CRLF would put \\r inside every function body it makes)', !baseline.includes('\r'));
check('the baseline says production must not run it', /do NOT run this file there/.test(baseline));
check('the baseline keeps pg_catalog first on its search_path (gen_random_uuid binds to core)', /set_config\('search_path', 'pg_catalog, public', false\)/.test(baseline));
check('no psql-only \\restrict line is left in it', !/^\\(un)?restrict /m.test(baseline));
check('the baseline makes the ledger table', /CREATE TABLE public\.schema_migrations \(/.test(baseline));

console.log('\n── the paste-back query ──');
const expected = { 'tab:a:col': ['h1', ['id uuid NN']], 'fn:f()': ['h2', 'CREATE FUNCTION f'] };
const query = prodQuery(expected, 'a test', 'rebase-1.sql');
const outsideQuotes = query.replace(/'(?:[^']|'')*'/g, "''");
check('one statement: a single ; at the very end', (outsideQuotes.match(/;/g) || []).length === 1 && /AS fingerprint;\n$/.test(query));
check('read-only: no write or DDL keyword outside quotes', !/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE)\b/i.test(outsideQuotes.replace(/^--.*$/gm, '')));
check('it embeds every expected hash', query.includes("('tab:a:col','h1')") && query.includes("('fn:f()','h2')"));
check('the fingerprint covers public, metrics and ops, and strips CR from function text', /'public','metrics','ops'/.test(CORE) && /chr\(13\)/.test(CORE));

console.log('\n── compare ──');
check('a fingerprint against itself: nothing', compare(expected, expected).length === 0);
const changed = { 'tab:a:col': ['h9', ['id uuid NN', 'name text']], 'fn:f()': ['h2', 'CREATE FUNCTION f'] };
const lines = compare(expected, changed);
check('an added column is named with a + line', lines[0] === 'tab:a:col' && lines.includes('    + name text'), lines.join(' | '));
const answer = { same: 1, diff: { 'tab:a:col': ['id uuid NN', 'name text'], 'view:v': 'v x' }, missing: ['fn:f()'] };
const fromAnswer = compare(expected, answer);
check('a production answer: its diff, its extra object and its missing object are all reported',
  fromAnswer.includes('tab:a:col') && fromAnswer.includes('view:v   (only in the second)') && fromAnswer.includes('fn:f()   (missing from the second)'), fromAnswer.join(' | '));
check('an answer with no differences reads as the same', compare(expected, { same: 2, diff: null, missing: null }).length === 0);

console.log('\n  ' + checks + ' checks');
process.exit(failed ? 1 : 0);
