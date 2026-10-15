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
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROUTES = path.join(__dirname, '..', 'routes');

const MAX_UNPAGED = 76;

/** file + path → why it is not a growing list. */
const ALLOWED = {
  'adopt.js /:chit_id': 'one chit',
  'chits.js /:chit_id': 'one chit and its lines',
  'chits.js /:chit_id/diagnosis': 'one chit\'s diagnosis',
  'service.js /:chit_id': 'one service chit',
  'crm.js /parties/:id': 'one party',
  'definitions.js /:id': 'one definition and its versions',
  'entities.js /me': 'the caller\'s own entity bundle',
  'entities.js /usage': 'one entity\'s usage summary',
  'entities.js /constitutions': 'the fixed constitution vocabulary of the installation',
  'assist.js /regions': 'the fixed region vocabulary (region_layer)',
  'schemas.js /fields': 'the shop\'s field dictionary — bounded by its schema',
  'connectors.js /:actorId/provisioning': 'one connector\'s provisioning',
  'till.js /snapshot': 'one counter\'s snapshot (its own round-trip budget, round-trips-till)',
  'till.js /summary': 'one day\'s summary',
  'till.js /verify': 'the counter\'s sign-in check',
  'folders.js /:id/metrics': 'one folder\'s metrics',
  'testing.js /report': 'one report document over the whole board',
};

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
    while ((m = fre.exec(src))) if (/\b(limitOf|pageArgs)\(/.test(m[2])) readers.push(m[1]);
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
ok('ONE clamp: no route spells its own Math.min(…parseInt(…limit…)) beside page-limit in a moved route', () => {
  const src = fs.readFileSync(path.join(ROUTES, 'testing.js'), 'utf8');
  assert.ok(!/Math\.min\([^)]*parseInt\([^)]*limit/.test(src), 'routes/testing.js clamps a limit by hand');
});
console.log('\n' + n + ' checks');
if (fail) process.exitCode = 1;
