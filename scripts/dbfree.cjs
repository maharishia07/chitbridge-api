'use strict';
/**
 * dbfree.cjs — WHICH MODULES COULD RUN INSIDE AN INSTALLABLE TILL, MEASURED.
 *
 * Athi, 2026-09-19: *"the till is the best thing that we came up with which people can understand… if we can
 * keep the till as an installable application which can use the local database as its own data, the people may
 * start using it… any module which are completely independent of db and if that can be used here, we can bring
 * it."*
 *
 * ⭐⭐ THE AXIS ALREADY EXISTS AND ATHI CREATED IT. engine-boundary.test.js, from his question of 2026-08-04:
 *     TIER A · PURE   zero dependencies. Liftable as FILES into any Node project, today.
 *     TIER B · BOUND  CB's logic, but needs a database handle.
 * "Liftable as files, today" IS "can go in the installable till". What is missing is not a new idea; it is
 * that only 10 of ~156 lib files have ever been held to it. The rest have never been measured.
 *
 * ⚠️⚠️ SO THIS MEASURES RATHER THAN ASKS. A file is DB-free when its TRANSITIVE requires never reach the
 * database, the network or the filesystem — computed, not declared, because a declaration is a promise and the
 * whole point of engine-boundary.test.js is that promises rot: *"nothing stopped the next commit from adding
 * require('../db') … with no test failing and nobody noticing for months."*
 *
 * ⚠️ WHAT THIS IS NOT. A DB-free module is PORTABLE, not automatically WANTED. Whether the till should carry
 * it is a product decision; this only says which ones it could carry at all. The list is an input to that
 * decision, never the decision.
 *
 *   node scripts/dbfree.cjs            the summary
 *   node scripts/dbfree.cjs --list     every file with its verdict
 *   node scripts/dbfree.cjs --why x.js why one file is bound, with the chain that binds it
 */
const fs = require('fs'), path = require('path');
const LIB = path.join(__dirname, '..', 'lib');
const WEB = path.join(__dirname, '..', '..', 'chitbridge-web', 'public', 'engine');

/**
 * ⚠️ WHAT COUNTS AS "BOUND". Not a guess at names: these are the things that cannot exist in a browser or in a
 * process with no server. `fs` and `path` are listed because a till is a PAGE — a module that reads the disk
 * cannot be vendored into it, however pure its arithmetic is.
 */
const BOUND_MODULES = ['pg', 'pg-pool', 'ioredis', 'redis', 'node-fetch', 'axios', 'aws-sdk', '@aws-sdk',
  'nodemailer', 'twilio', 'fs', 'fs/promises', 'path', 'child_process', 'http', 'https', 'net', 'dns',
  'crypto', 'os', 'worker_threads', 'cluster'];
/* ⚠️ a local file whose NAME is the database is bound whatever it requires — db.js IS the handle */
const BOUND_LOCAL = ['db', 'pool', 'supabase'];

function requiresOf(file) {
  let src = '';
  try { src = fs.readFileSync(file, 'utf8'); } catch (_) { return []; }
  /* ⚠️ COMMENTS STRIPPED. Half these files DOCUMENT the rule by quoting require('../db') — a scan that cannot
     tell prose from code reports the warning as the offence. The same trap the --sk-ph guard fell into. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
  const out = [];
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(code))) out.push(m[1]);
  return out;
}

const cache = new Map();
/** the chain that binds a file, or null when nothing does */
function bindsBy(rel, seen) {
  if (cache.has(rel)) return cache.get(rel);
  seen = seen || new Set();
  if (seen.has(rel)) return null;                 /* a cycle binds nothing by itself */
  seen.add(rel);
  const file = path.join(LIB, rel);
  let verdict = null;
  for (const r of requiresOf(file)) {
    const bare = r.replace(/^node:/, '');
    if (BOUND_MODULES.indexOf(bare) >= 0 || BOUND_MODULES.some((b) => bare === b || bare.startsWith(b + '/'))) {
      verdict = [rel + ' → ' + r]; break;
    }
    if (r.startsWith('.')) {
      const base = path.basename(r).replace(/\.js$/, '');
      if (BOUND_LOCAL.indexOf(base) >= 0) { verdict = [rel + ' → ' + r]; break; }
      const next = base + '.js';
      if (!fs.existsSync(path.join(LIB, next))) continue;   /* outside lib/ — not ours to chase */
      const deeper = bindsBy(next, seen);
      if (deeper) { verdict = [rel + ' → ' + r].concat(deeper); break; }
    }
  }
  cache.set(rel, verdict);
  return verdict;
}

const files = fs.readdirSync(LIB).filter((f) => f.endsWith('.js')).sort();
const free = [], bound = [];
for (const f of files) (bindsBy(f) ? bound : free).push(f);

/* what the counter already carries, so "could" can be told from "does" */
const vendored = fs.existsSync(WEB)
  ? fs.readdirSync(WEB).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''))
  : [];
const page = path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html');
const loaded = fs.existsSync(page)
  ? (fs.readFileSync(page, 'utf8').match(/engine\/([a-z0-9-]+)\.js/g) || [])
      .map((s) => s.replace('engine/', '').replace('.js', ''))
  : [];
const uniqLoaded = [...new Set(loaded)];

const args = process.argv.slice(2);
if (args[0] === '--why') {
  const want = (args[1] || '').replace(/^lib\//, '');
  const chain = bindsBy(want.endsWith('.js') ? want : want + '.js');
  console.log(chain ? '  bound:\n    ' + chain.join('\n    ') : '  DB-free — nothing in its chain reaches a database, the network or the disk');
  process.exit(0);
}

console.log('\n══ WHAT COULD RUN INSIDE AN INSTALLABLE TILL ══\n');
console.log('  lib/ files        ' + files.length);
console.log('  DB-free           ' + free.length + '   ← portable: liftable into the till as files');
console.log('  bound             ' + bound.length + '   need a database, the network or the disk');
console.log('  the counter loads ' + uniqLoaded.length + ' engines today (of ' + vendored.length + ' vendored)\n');

if (args.indexOf('--list') >= 0) {
  console.log('  ── DB-free ' + '─'.repeat(46));
  free.forEach((f) => {
    const nm = f.replace(/\.js$/, '');
    const inTill = uniqLoaded.some((l) => l === nm || nm.indexOf(l) >= 0 || l.indexOf(nm) >= 0);
    console.log('    ' + (inTill ? '●' : '○') + ' ' + f);
  });
  console.log('\n  ● already in the counter   ○ DB-free and not carried yet\n');
  console.log('  ── bound ' + '─'.repeat(48));
  bound.forEach((f) => console.log('    ✗ ' + f + '   ' + (bindsBy(f) || []).slice(-1)[0]));
  console.log('');
} else {
  console.log('  run with --list to see every file, or --why <file.js> for one chain\n');
}
