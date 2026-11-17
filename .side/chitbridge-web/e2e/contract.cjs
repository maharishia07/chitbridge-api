/* contract.cjs — THE WEB'S SIDE OF THE API CONTRACT (e2e/fixtures/web-api.contract.json), node only, ~1 s.
 *
 * The CRM list failed live (2026-10-03) because the API sends `roles` as an OBJECT and this repo's stand-in sent a list: the page and its stand-in agreed with
 * each other and with nothing else. The contract is the API's own answers; chitbridge-api's tests/web-api-contract.test.cjs keeps it true on that side. HERE:
 *
 *  1  the file is whole, and this repo's matcher (e2e/lib/contract.cjs) answers the file's own `_selftest` cases the way the API's matcher does
 *  2  the copy is the master's: when ../chitbridge-api sits beside this repo, docs/contracts/web-api.json and this file are identical (line endings aside)
 *  3  the CRM stand-in's builders (e2e/lib/crm-api.cjs: the golden parties, as the API would send them) conform to every CRM route in the file
 *  4  no harness answers a /api/books or /api/crm call without wrapping its route in C.wrap() - a stand-in cannot opt out of the check
 *  5  every route the contract lists is answered by some harness at all (a route nobody serves is a route nobody tests)
 *
 * The runtime half is in each harness: its last check is "every answer the stand-in served matches the contract" (C.finish()).
 * Run: node e2e/contract.cjs        exit 1 when anything fails
 */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./lib/contract.cjs');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };

/* ── 1 · the file, and the matcher against its self-test ── */
const raw = JSON.parse(fs.readFileSync(C.FILE, 'utf8'));
const routes = Object.keys(raw.routes || {});
ok(routes.length > 30, 'the contract lists ' + routes.length + ' routes');
/* the families are ONE list (e2e/lib/contract.cjs FAMILIES — RAIL-LAB-SRV1 added `facts` for GET /api/facts/rail); repeat: RI1 (/api/repeat itself has no tail) */
const FAM = C.FAMILIES.join('|');
ok(routes.every((k) => new RegExp('^(GET|POST|PATCH|PUT|DELETE) /api/(' + FAM + ')(/|$| )').test(k) && raw.routes[k].status > 0 && 'example' in raw.routes[k]), 'every entry is "METHOD /api/(' + FAM + ')/…" with a status and an example');
(raw._selftest || []).forEach((c, i) => {
  const p = C.problems(c.example, c.actual, c.optional || [], '', c.free || []);
  ok((p.length === 0) === c.conforms, 'selftest ' + (i + 1) + ': ' + c.name + (p.length ? ' [' + p[0] + ']' : ''));
});
ok((raw._selftest || []).length >= 8, 'the self-test has cases');

/* ── 2 · the copy is the master's ── */
const API = process.env.CB_API_REPO || path.join(__dirname, '..', '..', 'chitbridge-api');
const master = path.join(API, 'docs', 'contracts', 'web-api.json');
if (fs.existsSync(master)) {
  const norm = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').trim();
  ok(norm(master) === norm(C.FILE), 'e2e/fixtures/web-api.contract.json is identical to the API\'s docs/contracts/web-api.json (the API\'s copy is the master)');
} else console.log('  --  chitbridge-api is not beside this repo (' + API + '): the two copies were not compared');

/* ── 3 · the CRM stand-in's own builders ── */
let crmApi = null;
try { crmApi = require('./lib/crm-api.cjs'); } catch (e) { ok(false, 'e2e/lib/crm-api.cjs loads: ' + e.message); }
if (crmApi) {
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'golden-parties.json'), 'utf8'));
  const now = Date.now();
  const res = (x) => crmApi.resolve(x, now);
  const fx = res(golden);
  const one = (m, p, s, b) => { const q = C.check(m, p, s, b, 'crm-api.cjs '); return q; };
  const before = C.STATE.bad.length;
  one('GET', '/api/crm/parties', 200, crmApi.list(fx.list));
  fx.list.filter((x) => x.kind !== 'walk-in').slice(0, 8).forEach((x) => one('GET', '/api/crm/parties/' + x.party_id, 200, crmApi.record(fx.list, x.party_id, fx.records[x.party_id], fx.followups)));
  Object.keys(fx.timelines).forEach((id) => one('GET', '/api/crm/parties/' + id + '/timeline', 200, crmApi.timeline(fx.timelines[id], id)));
  one('GET', '/api/crm/followups', 200, crmApi.followups(fx.followups));
  one('POST', '/api/crm/followups', 201, { followup: crmApi.followupOne(fx.followups[0]) });
  one('PATCH', '/api/crm/followups/' + fx.followups[0].followup_id, 200, { followup: crmApi.followupOne(fx.followups[0]) });
  one('POST', '/api/crm/parties/pid-1/interactions', 201, crmApi.interaction({ kind: 'call', direction: 'out', body: 'x' }));
  /* RAIL-LAB-SRV1: the Home rail card (GET /api/facts/rail) — the one builder every harness serves it from, in both of the server's answers */
  one('GET', '/api/facts/rail', 200, crmApi.railFacts({ in: 24, out: 0, stuck: 21 }));
  one('GET', '/api/facts/rail', 200, crmApi.railFacts({ lab: true }));
  ok(C.STATE.bad.length === before, 'the CRM stand-in\'s builders (list, record, timeline, follow-ups, interaction) conform to the contract' + (C.STATE.bad.length > before ? ' - ' + C.STATE.bad.slice(before).slice(0, 4).map((b) => b.where + ': ' + b.problems.slice(0, 3).join('; ')).join(' | ') : ''));
  ok(C.STATE.routes.size >= 5, 'those builders reached ' + C.STATE.routes.size + ' contract routes');
}

/* ── 4 · no harness opts out ── */
const files = fs.readdirSync(__dirname).filter((f) => /\.cjs$/.test(f) && f !== 'contract.cjs');
/* INT5b: a harness SERVES when one of its .route( patterns is an /api path — a real-stack walk (walk-x-o2c --real) only CALLS the api and
   routes nothing but fonts (whose host, googleapis, once matched a bare "api") */
/* a real-stack proof routes /api only to hold one read back (it never answers one), so it has no stand-in to hold to the contract */
const REAL_STACK = ['frame-proof-sit.cjs'];
const serves = files.filter((f) => { const s = fs.readFileSync(path.join(__dirname, f), 'utf8'); return REAL_STACK.indexOf(f) < 0 && /\.route\([^,\n]*\/api\b/.test(s) && new RegExp('[\'"`]/api/(' + FAM + ')(/|[\'"`])').test(s); });
const unwrapped = serves.filter((f) => !/lib\/contract\.cjs/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
ok(unwrapped.length === 0, serves.length + ' harnesses answer /api/books, /api/crm, /api/work or /api/repeat calls; each holds its answers to the contract' + (unwrapped.length ? ' - NOT: ' + unwrapped.join(', ') : ''));

/* ── 5 · every contract route is answered by some harness (the path appears in a harness that serves it) ── */
const text = serves.map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n') + '\n' + fs.readFileSync(path.join(__dirname, 'lib', 'crm-api.cjs'), 'utf8');
const seen = (pattern) => {
  const parts = pattern.split('/').filter(Boolean).filter((s) => s[0] !== ':');
  const tail = parts.slice(2).join('/');                               /* books/ledger/:account → "ledger" */
  return !tail || text.indexOf('/' + parts.slice(1).join('/')) >= 0 || text.indexOf(parts[parts.length - 1]) >= 0;
};
/* TO1-UI: the /api/work routes are served by e2e/walk-tasks.cjs (the Tasks & Orders page's stand-in), so the W1 exemption is lifted */
const unserved = Array.from(new Set(routes.map((k) => k.replace(/ #.*$/, '')))).filter((k) => !seen(k.split(' ')[1]));
ok(unserved.length === 0, 'every route the contract lists is answered by at least one harness' + (unserved.length ? ' - NOT: ' + unserved.join(', ') : ''));

console.log('\n  contract: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
