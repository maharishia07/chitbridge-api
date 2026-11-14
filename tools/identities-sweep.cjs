#!/usr/bin/env node
/**
 * tools/identities-sweep.cjs — EVERY read and write of `identities` in the api, classified (SEC-185, step B of SEC-184).
 * OWNS  the classification of every identities statement · CALLED BY  tests/sec-185-identities-sweep.test.cjs, the PR body (--md), Athi before b860
 * FLOW  files() → sweep() (one row per statement that names identities) → classify() → count() → table | check | save; one row per statement that names identities: class, file:line, the call that carries it; the ratchet in db/identities-sweep.baseline.json only falls
 * CARD 18-identity-sign-in-and-access/row-level-security-and-shop-scoped-data
 *
 *   node tools/identities-sweep.cjs            the counts by class
 *   node tools/identities-sweep.cjs --md       the table (class, file:line, callee it is called, the statement), for a PR body
 *   node tools/identities-sweep.cjs --check    exit 1 when the OPEN count is above db/identities-sweep.baseline.json (the ratchet: it may only fall) — and 0 lets migrations/RUN-2026-11-14-b860 run
 *   node tools/identities-sweep.cjs --save     write the baseline from the tree as it is now
 *
 * CLASSES  (row security on identities, b860: a row opens under app.current_entity = its own id, its shop's id, or a connected shop's id; unbound = no row)
 *   bound         the statement runs through boundRead / boundEach / db.queryAs (bound to the identity's own id, ONE trip): works under the policy
 *   signin        the pre-binding lookup (lib/signin-lookup.js → ops.signin_candidates, SECURITY DEFINER): works under the policy
 *   in-tx         inside a handle the caller owns (db.query, client.query, h.query ...): works when that handle came from withEntity / onEntity / readBatch for the right shop; the sweep cannot see that, a human reads it
 *   open          the module-level query() with no binding: returns NO row once b860 runs. Each one moves to queryAs (by id), withEntity (a shop's own work) or a named platform path
 *   job           scripts/ and tools/: run as the owner role (postgres), which bypasses row security; not the api's runtime
 * A heuristic over text, not a parser: the ratchet is the guard, the review is the proof (the realstack gate tests/sec-185-identities-rls.realstack.cjs is the behaviour).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(ROOT, 'db', 'identities-sweep.baseline.json');
const TOUCH = /\b(FROM|JOIN|INTO|UPDATE)\s+(public\.)?identities\b/i;
const CALL = /(\b[\w.]*query|\breadBatch|\bexecute|\bboundRead|\bboundEach|\bqueryAs|\bqueryAsEach|\bonEntity|\bwithEntity|\bwithTransaction|\brun|\bq)\s*\(/;
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
  if (/^(boundRead|boundEach|queryAs|queryAsEach)$/.test(callee) || /.as(Each)?$/.test(callee)) return 'bound';
  return ['query', '', 'q', 'run', 'execute'].indexOf(callee) !== -1 ? 'open' : 'in-tx';
}
/** the class of one matching line, by the call that opens its statement */
function classify(relPath, lines, at) {
  if (relPath === 'lib/signin-lookup.js') return { cls: 'signin', callee: 'ops.signin_candidates' };
  const callee = calleeOf(lines, at);
  const siteClass = classOfCallee(callee);
  if (siteClass !== 'bound' && JOBS.some((jobDir) => relPath.startsWith(jobDir + '/'))) return { cls: 'job', callee };
  return { cls: siteClass, callee: callee || '(none)' };
}
/** every statement that names identities, as { file, line, text, cls, callee } */
function sweep() {
  const out = [];
  for (const relPath of RUNTIME.concat(JOBS).flatMap(files)) {
    const lines = fs.readFileSync(path.join(ROOT, relPath), 'utf8').split('\n');
    lines.forEach((text, at) => {
      if (!TOUCH.test(text) || /^\s*(\/\/|\*|\/\*)/.test(text)) return;
      out.push(Object.assign({ file: relPath, line: at + 1, text: text.trim().slice(0, 100) }, classify(relPath, lines, at)));
    });
  }
  return out;
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
    fs.writeFileSync(BASELINE, JSON.stringify({ at: new Date().toISOString().slice(0, 10), open: by.open || 0, counts: by }, null, 1) + '\n');
    console.log('saved', JSON.stringify(by));
  } else if (arg === '--check') {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const open = by.open || 0;
    console.log('context-free sites: ' + open + ' (baseline ' + base.open + ') · ' + JSON.stringify(by));
    if (open > base.open) { console.log('FAIL: a new unbound read or write of identities (the count may only fall). Use db.queryAs(id, ...) / boundRead, or withEntity(shop, ...).'); process.exit(1); }
    if (open < base.open) console.log('note: the count fell; run --save to lower the baseline.');
    process.exit(0);
  } else console.log(JSON.stringify(by), '· total', sites.length);
}
module.exports = { sweep, classify, count };
