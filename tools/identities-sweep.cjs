#!/usr/bin/env node
/**
 * tools/identities-sweep.cjs — EVERY read and write of `identities`, `entity_schemas` and `schema_fields` in the api, classified (SEC-185 step B of SEC-184; widened for SEC-75: one tool, one baseline, per-table counts).
 * OWNS  the classification of every identities statement · CALLED BY  tests/sec-185-identities-sweep.test.cjs, the PR body (--md), Athi before b860
 * FLOW  files() → sweep() (one row per statement that names identities) → classify() → count() → table | check | save; one row per statement that names identities: class, file:line, the call that carries it; the ratchet in db/identities-sweep.baseline.json only falls
 * CARD 18-identity-sign-in-and-access/row-level-security-and-shop-scoped-data
 *
 *   node tools/identities-sweep.cjs            the counts by class
 *   node tools/identities-sweep.cjs --md       the table (class, file:line, callee it is called, the statement), for a PR body
 *   node tools/identities-sweep.cjs --check    exit 1 when the OPEN or in-tx count of ANY of the three tables is above db/identities-sweep.baseline.json (the ratchet: it may only fall) — and 0 lets b860 (identities) and b862 (the two schema tables) run
 *   node tools/identities-sweep.cjs --save     write the baseline from the tree as it is now
 *
 * CLASSES  (row security on identities, b860: a row opens under app.current_entity = its own id, its shop's id, or a connected shop's id; unbound = no row)
 *   bound         the statement runs through boundRead / boundEach / db.queryAs (bound to the identity's own id, ONE trip): works under the policy
 *   signin        the pre-binding lookup (lib/signin-lookup.js → ops.signin_candidates, SECURITY DEFINER): works under the policy
 *   in-tx         inside a handle the caller owns (db.query, client.query, h.query ...): works when that handle came from withEntity / onEntity / readBatch for the right shop; the sweep cannot see that, a human reads it
 *   open          the module-level query() with no binding: returns NO row once b860 runs. Each one moves to queryAs (by id), withEntity (a shop's own work) or a named platform path
 *   public        (entity_schemas, schema_fields only) an unbound read that the public-read policy serves on purpose, marked in the source with `sweep:public` within 14 lines above it
 *   injected      (entity_schemas, schema_fields only) lib/catalogue-columns.js takes its reader as a parameter; tests/sec-75-entity-schemas.test.cjs fails when any caller passes it unbound
 *   job           scripts/ and tools/: run as the owner role (postgres), which bypasses row security; not the api's runtime
 * A heuristic over text, not a parser: the ratchet is the guard, the review is the proof (the realstack gate tests/sec-185-identities-rls.realstack.cjs is the behaviour).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HOME_ROOT = path.join(__dirname, '..');
let ROOT = HOME_ROOT; /* sweep(root) points it at a temp copy for the break checks */
const BASELINE = path.join(HOME_ROOT, 'db', 'identities-sweep.baseline.json');
const TABLES = ['identities', 'entity_schemas', 'schema_fields'];
const touchOf = (table) => new RegExp('\\b(FROM|JOIN|INTO|UPDATE)\\s+(public\\.)?' + table + '\\b', 'i');
const INJECTED_READERS = ['lib/catalogue-columns.js'];
const CALL = /(\b[\w.]*query|\breadBatch|\bexecute|\bboundRead|\bboundEach|\bqueryAs|\bqueryAsEach|\bqueryFor|\bonEntity|\bwithEntity|\bwithTransaction|\brun|\bq)\s*\(/;
const RUNTIME = ['lib', 'routes', 'middleware', 'server.js'];
const JOBS = ['scripts', 'tools'];

/** every .js / .cjs file under `dir` (or `dir` itself when it is one), skipping node_modules and .git */
function files(dir) {
  const absPath = path.join(ROOT, dir);
  if (!fs.existsSync(absPath)) return [];
  if (fs.statSync(absPath).isFile()) return [dir];
  return fs.readdirSync(absPath).flatMap((name) => {
    const relPath = dir + '/' + name;
    if (name === 'node_modules' || name === '.git') return [];
    return fs.statSync(path.join(ROOT, relPath)).isDirectory() ? files(relPath) : /\.(js|cjs)$/.test(name) ? [relPath] : [];
  });
}
/** the nearest call that opens the statement at line `at`, looking back up to 14 lines ('' when none) */
function calleeOf(lines, at) {
  for (let back = at; back >= Math.max(0, at - 14); back--) {
    const found = lines[back].match(CALL);
    if (found) return found[1];
  }
  return '';
}
/** the class of a callee: bound doors, a plain module query (open), or a handle the caller owns (in-tx) */
function classOfCallee(callee) {
  if (/^(boundRead|boundEach|queryAs|queryAsEach|queryFor)$/.test(callee) || /\.as(Each)?$/.test(callee)) return 'bound';
  if (/(^|\.)pool\.query$/.test(callee)) return 'open'; /* the module pool is never bound to a shop */
  return ['query', '', 'q', 'run', 'execute'].indexOf(callee) !== -1 ? 'open' : 'in-tx';
}
/** a `sweep:public` marker within 14 lines above the statement: an unbound read the public-read policy serves on purpose */
const markedPublic = (lines, at) => lines.slice(Math.max(0, at - 14), at + 1).some((text) => /sweep:public\b/.test(text));
/** the class of one matching line, by the call that opens its statement (`table` decides the special cases) */
function classify(relPath, lines, at, table) {
  if (table && table !== 'identities') {
    if (INJECTED_READERS.includes(relPath)) return { cls: 'injected', callee: '(injected)' };
    if (markedPublic(lines, at)) return { cls: 'public', callee: 'sweep:public' };
  }
  if (relPath === 'lib/signin-lookup.js') return { cls: 'signin', callee: 'ops.signin_candidates' };
  const callee = calleeOf(lines, at);
  const siteClass = classOfCallee(callee);
  if (siteClass !== 'bound' && JOBS.some((jobDir) => relPath.startsWith(jobDir + '/'))) return { cls: 'job', callee };
  return { cls: siteClass, callee: callee || '(none)' };
}
/** every statement that names `table` (default identities), as { file, line, text, cls, callee } */
function sweep(root, table) {
  const touch = touchOf(table || 'identities');
  ROOT = root || HOME_ROOT;
  const out = [];
  for (const relPath of RUNTIME.concat(JOBS).flatMap(files)) {
    const lines = fs.readFileSync(path.join(ROOT, relPath), 'utf8').split('\n');
    lines.forEach((text, at) => {
      if (!touch.test(text) || /^\s*(\/\/|\*|\/\*)/.test(text)) return;
      out.push(Object.assign({ file: relPath, line: at + 1, text: text.trim().slice(0, 100) }, classify(relPath, lines, at, table)));
    });
  }
  return out;
}
/**
 * the ratchet: neither the open count (module query(), pool.query) NOR the in-tx count (every other query alias: db.query, client.query, h.query, a renamed import)
 * may rise above the baseline. A read through an alias is a read through the same door, so it is counted, not trusted.
 */
function judge(counts, base) {
  const problems = [];
  if ((counts.open || 0) > base.open) problems.push('a new unbound read or write of identities (open ' + (counts.open || 0) + ' > ' + base.open + '): use db.queryAs(id, ...) / boundRead, or withEntity(shop, ...)');
  if ((counts['in-tx'] || 0) > base.inTx) problems.push('a new read or write of identities through a handle (in-tx ' + (counts['in-tx'] || 0) + ' > ' + base.inTx + '): db.query / client.query only inside withEntity / onEntity, otherwise db.queryAs');
  return { ok: problems.length === 0, problems };
}
/** SEC-75: the ratchet for the two schema tables (baseline.tables[table] = { open, inTx }); the same two rules as judge() */
function judgeTables(base) {
  const problems = [];
  for (const table of TABLES.slice(1)) {
    const have = count(sweep(null, table));
    const allowed = (base.tables && base.tables[table]) || { open: 0, inTx: 0 };
    const verdict = judge(have, allowed);
    verdict.problems.forEach((line) => problems.push(table + ': ' + line));
  }
  sweep();
  return { ok: problems.length === 0, problems };
}
/** how many sites per class */
const count = (sites) => sites.reduce((tally, site) => { tally[site.cls] = (tally[site.cls] || 0) + 1; return tally; }, {});

if (require.main === module) {
  const sites = sweep();
  const by = count(sites);
  const arg = process.argv[2];
  if (arg === '--md') {
    console.log('| class | file:line | called as | statement |\n|---|---|---|---|');
    sites.forEach((site) => console.log('| ' + site.cls + ' | ' + site.file + ':' + site.line + ' | `' + site.callee + '` | `' + site.text.replace(/\|/g, '\\|').replace(/`/g, "'") + '` |'));
  } else if (arg === '--save') {
    const tables = {};
    TABLES.slice(1).forEach((table) => { const have = count(sweep(null, table)); tables[table] = { open: have.open || 0, inTx: have['in-tx'] || 0, counts: have }; });
    sweep();
    fs.writeFileSync(BASELINE, JSON.stringify({ at: new Date().toISOString().slice(0, 10), open: by.open || 0, inTx: by['in-tx'] || 0, counts: by, tables }, null, 1) + '\n');
    console.log('saved', JSON.stringify(by));
  } else if (arg === '--check') {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const verdict = judge(by, base);
    const schemas = judgeTables(base);
    verdict.problems.push(...schemas.problems);
    verdict.ok = verdict.ok && schemas.ok;
    TABLES.slice(1).forEach((table) => console.log(table + ': ' + JSON.stringify(count(sweep(null, table)))));
    sweep();
    console.log('context-free sites: ' + (by.open || 0) + ' · in a handle (every other query alias: db.query, client.query, h.query ...): ' + (by['in-tx'] || 0) + ' · ' + JSON.stringify(by));
    verdict.problems.forEach((line) => console.log('FAIL: ' + line));
    process.exit(verdict.ok ? 0 : 1);
  } else console.log(JSON.stringify(by), '· total', sites.length);
}
module.exports = { sweep, classify, count, judge, judgeTables, TABLES };
