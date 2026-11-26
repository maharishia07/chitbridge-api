'use strict';
/**
 * list-paging-guard.test.cjs — ⭐ T2-PAGING RATCHET: no NEW list route without the one clamp (DISCIPLINES §2).
 *
 * A GET handler in routes/*.js that answers `res.json(...)` with rows read off a statement (`.rows`, other than
 * `.rows[0]` / `.rows.length`) is a LIST route. A list route is PAGED when it reads its size through
 * lib/page-limit.js (`limitOf(`) — a sensible default, a server-side max, top-level total · page · limit.
 *
 * ⭐ THE RATCHET: the unpaged list routes not in ALLOWED below may never number more than MAX_UNPAGED. Move one onto
 * page-limit and lower MAX_UNPAGED in the same change; never raise it. ALLOWED is for reads that are not a growing
 * list — one record, a fixed vocabulary, a summary — each with its reason.
 *
 *   node tests/list-paging-guard.test.cjs           the gate
 *   node tests/list-paging-guard.test.cjs --list    every unpaged list route (the work left)
 *
 * Measured 14 Oct (T2-PAGING): 98 list GETs, 17 allowed with a reason. BEFORE (main) 81 unpaged, 0 on page-limit →
 * AFTER 76 unpaged (/api/testing cases · results · runs · requirements · incidents moved). The MAINT-1 baseline (62) counts differently; this
 * file's scan is the one the gate holds.
 * W1-PLAT (15 Oct, LIM2): 99 list GETs · 51 paged (pageArgs/pageOut — lib/page-limit, the one pager) · 49 allowed with a reason · 0 left.
 * The ratchet is now a gate: a new list GET pages or says why it is not a list.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROUTES = path.join(__dirname, '..', 'routes');

const MAX_UNPAGED = 0;   /* W1-PLAT (15 Oct, LIM2): every growing list reads the one pager; what is left is allowed below with its reason */

const { ALLOWED } = require('../lib/list-allowance');

function scan() {
  const out = [];
  for (const f of fs.readdirSync(ROUTES).filter((x) => x.endsWith('.js')).sort()) {
    const src = fs.readFileSync(path.join(ROUTES, f), 'utf8');
    const re = /router\.(get|post|put|patch|delete|use|all)\(\s*(['"`])([^'"`]*)\2/g;
    const hits = []; let m;
    while ((m = re.exec(src))) hits.push({ verb: m[1], p: m[3], at: m.index });
    /* a file's own page reader counts as the clamp when its body calls limitOf or pageArgs (routes/testing.js readPage, catalogue.js myPage) */
    const readers = ['limitOf', 'pageArgs'];
    const fre = /(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g;
    /* a page reader may live in a lib part the route requires (size split: books-daybook.pageQ), read the same way from that lib file */
    const libs = [...src.matchAll(/require\('\.\.\/lib\/([\w-]+)'\)/g)].map((r) => path.join(ROUTES, '..', 'lib', r[1] + '.js')).filter((p) => fs.existsSync(p)).map((p) => fs.readFileSync(p, 'utf8'));
    for (const text of [src].concat(libs)) { fre.lastIndex = 0; while ((m = fre.exec(text))) if (/\b(limitOf|pageArgs)\(/.test(m[2])) readers.push(m[1]); }
    const pagedRe = new RegExp('\\b(' + readers.join('|') + ')\\(');
    hits.forEach((h, i) => {
      if (h.verb !== 'get') return;
      const body = src.slice(h.at, i + 1 < hits.length ? hits[i + 1].at : src.length);
      if (!/\.rows(?!\s*\[\s*0\s*\])(?!\s*\.\s*length)/.test(body) || !/res\.json\(/.test(body)) return;
      out.push({ key: f + ' ' + h.p, paged: pagedRe.test(body) });
    });
  }
  return out;
}

const all = scan();
const unpaged = all.filter((x) => !x.paged && !ALLOWED[x.key]);
if (process.argv.includes('--list')) { unpaged.forEach((x) => console.log(x.key)); }
let fail = 0, n = 0;
const ok = (what, fn) => { n++; try { fn(); console.log('  ok  ' + what); } catch (e) { fail++; console.log('  FAIL ' + what + '\n      ' + e.message); } };

console.log(`\nEVERY LIST ON THE ONE PAGER — ${all.length} list GETs · ${all.filter((x) => x.paged).length} paged · ${Object.keys(ALLOWED).length} allowed · ${unpaged.length} left\n`);
ok(`unpaged list routes ≤ ${MAX_UNPAGED} (the ratchet — lower it when one moves, never raise it)`, () =>
  assert.ok(unpaged.length <= MAX_UNPAGED, `${unpaged.length} unpaged list routes (max ${MAX_UNPAGED}). The new one: page it with lib/page-limit.js (limitOf/pageOf), or add it to ALLOWED with the reason it is not a growing list.\n      ` + unpaged.map((x) => x.key).join('\n      ')));
ok('every ALLOWED entry still names a list GET (a stale allowance hides nothing — remove it)', () => {
  const keys = new Set(all.map((x) => x.key));
  const stale = Object.keys(ALLOWED).filter((k) => !keys.has(k));
  assert.deepStrictEqual(stale, []);
});
ok('the test board\'s five lists stay paged (T2-PAGING)', () => {
  ['cases', 'results', 'runs', 'requirements', 'incidents'].forEach((p) => {
    const r = all.find((x) => x.key === 'testing.js /' + p);
    assert.ok(r && r.paged, 'testing.js /' + p + ' no longer reads lib/page-limit');
  });
});
ok('ONE clamp: no route spells its own Math.min(…parseInt(…limit…)) beside page-limit (W1-PLAT: every routes/*.js, was testing.js alone)', () => {
  const byHand = fs.readdirSync(ROUTES).filter((f) => f.endsWith('.js') && /Math\.min\([^)]*parseInt\([^)]*limit/.test(fs.readFileSync(path.join(ROUTES, f), 'utf8')));
  assert.deepStrictEqual(byHand, [], 'these route files clamp a limit by hand');
});
console.log('\n' + n + ' checks');
if (fail) process.exitCode = 1;
