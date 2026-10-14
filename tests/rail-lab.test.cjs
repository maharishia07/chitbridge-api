/**
 * rail-lab.test.cjs — ⭐ THE RAIL LAB'S SERVER GAPS (RAIL-LAB-SRV1, 2026-10-14): ONE lab rule, said by the facts card AND the send door.
 *
 *   G1  GET /api/facts/rail answers `may_sample` (tests/home-facts.test.cjs holds the card; here: the rule itself, lib/istest).
 *   G2  a chit DECLARED a lab chit (business_json.lab: true) is refused on a live shop — 409, a code the client branches on, a
 *       sentence a shopkeeper reads — BEFORE anything is written; a lab (test) shop keeps working and every copy carries summary_json.lab.
 *   An ordinary send runs no lab statement at all (tests/send-golden.test.cjs stays byte-identical; proven again here by the call count).
 *
 * Offline: the real POST /api/chits/send through tests/support/route-golden.cjs (db + auth stubbed), the same fixture rows send-golden uses.
 * Run: node tests/rail-lab.test.cjs
 */
'use strict';
const path = require('path');
const G = require('./support/route-golden.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

/* ── G1 · the one rule (lib/istest): a lab shop is a shop whose population is not live; unstated = live (fail safe) ── */
const istest = require(path.join(G.API, 'lib', 'istest'));
ok('isLab: test · sandbox are lab shops', istest.isLab('test') && istest.isLab('sandbox'));
ok('isLab: live, and an UNSTATED population (null / undefined — before b249, or the default), are live', !istest.isLab('live') && !istest.isLab(null) && !istest.isLab(undefined));
ok('maySample(test) → { ok: true }', JSON.stringify(istest.maySample('test')) === '{"ok":true}');
const no = istest.maySample('live');
ok('maySample(live) → { ok: false, why: "live_shop", say } — a code to branch on and a sentence to read', no.ok === false && no.why === 'live_shop' && no.say === istest.LAB_WHY.live_shop);
ok('…the sentence is a shopkeeper\'s, within the 20-word budget', no.say.split(/\s+/).length <= 20 && /live shop/.test(no.say), no.say);
ok('isLabChit: only business_json.lab === true marks a chit (a string "true", 1, or no business_json does not)',
  istest.isLabChit({ lab: true }) && !istest.isLabChit({ lab: 'true' }) && !istest.isLabChit({ lab: 1 }) && !istest.isLabChit(null) && !istest.isLabChit({}));

/* ── G2 · the send door ── */
const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const ROWS = {
  [SHOP]: { identity_id: SHOP, bridge_id: 'CBSHOP0001', display_name: 'Mayur Traders', country: 'IN', currency_code: 'INR', policy_flags: {}, status: 'active', user_id: 'mayur' },
  [CUST]: { identity_id: CUST, bridge_id: 'CBCUST0001', display_name: 'Chola Auto Care', country: 'IN', currency_code: 'INR', policy_flags: {}, status: 'active', user_id: 'chola' },
};
function rows(s, p, ctx) {
  if (/to_regprocedure\('chit_deliver/.test(s)) return [{ ok: true }];
  if (/to_jsonb\(i\)->>'population' AS population FROM identities i WHERE identity_id = \$1/.test(s)) { ctx.popReads = (ctx.popReads || 0) + 1; return [{ population: ctx.population === undefined ? null : ctx.population }]; }
  if (/SELECT self_copy_pref, currency_code FROM identities/.test(s)) return [{ self_copy_pref: null, currency_code: 'INR' }];
  if (/FROM identities WHERE identity_id = ANY\(\$1::uuid\[\]\)/.test(s)) return (p[0] || []).map((id) => ROWS[id]).filter(Boolean);
  if (/FROM identities/.test(s) && /identity_id = \$1/.test(s)) { const r = ROWS[p[0]]; return r ? [r] : []; }
  return [];
}
const h = G.harness({ rows, known: { [SHOP]: 'SHOP', [CUST]: 'CUST' } });
/* the deliverer, recorded: what every copy carries is the proof that summary_json.lab rides each one */
const mint = require(path.join(G.API, 'lib', 'mint'));
const delivered = [];
mint.deliver = async (sender, chit_id, copies) => { delivered.push(copies); return { ok: true }; };
/* the post-commit hooks own their own tests (as send-golden stubs them) */
require(path.join(G.API, 'lib', 'books-hooks')).afterChit = () => Promise.resolve({});
require(path.join(G.API, 'lib', 'meter')).meter = async () => {};
require(path.join(G.API, 'lib', 'tax-shelf')).readShelf = async () => null;
require(path.join(G.API, 'lib', 'stock-from-chit')).postFor = async () => ({ failed: [], skipped: [] });
require(path.join(G.API, 'lib', 'events')).notifyAfter = () => {};
const app = h.app('/api/chits', require(path.join(G.API, 'routes', 'chits')));
const ME = { identity_id: SHOP, identity_type: 'entity', bridge_id: 'CBSHOP0001', display_name: 'Mayur Traders' };
const order = (extra) => Object.assign({ purpose: 'order', recipients: [{ entity_id: CUST, name: 'Chola Auto Care', role: 'to' }],
  line_items: [{ particulars: 'Rice', quantity: 2, price: 50 }] }, extra || {});

(async () => {
  console.log('\n══ RAIL-LAB-SRV1 · one lab rule — the facts card\'s may_sample and the send door ══\n');

  /* a lab chit from a LIVE shop (population stated live) */
  let ctx = { population: 'live' };
  let r = await h.run(app, { url: '/api/chits/send', body: order({ business_json: { lab: true } }), identity: ME, ctx });
  ok('live shop · lab chit → 409', r.status === 409, JSON.stringify(r.body));
  ok('…with the code the client branches on and may:false', r.body && r.body.code === 'LAB_CHIT_LIVE_SHOP' && r.body.may === false && r.body.why === 'live_shop', JSON.stringify(r.body));
  ok('…and the SAME sentence the facts card says (istest.LAB_WHY)', r.body && r.body.message === istest.LAB_WHY.live_shop);
  ok('…refused BEFORE anything is written: no delivery, no transaction', delivered.length === 0 && !r.calls.some((c) => c.via === 'tx' || /INSERT/i.test(c.sql || '')), JSON.stringify(r.calls.map((c) => c.via)));
  ok('…one identities read for the population, no more', ctx.popReads === 1);

  /* a lab chit from a shop whose population is UNSTATED (before b249 / the default) — live, fail safe */
  ctx = {};
  r = await h.run(app, { url: '/api/chits/send', body: order({ business_json: { lab: true } }), identity: ME, ctx });
  ok('unstated population · lab chit → 409 (an unstated shop is live — fail safe)', r.status === 409 && r.body.code === 'LAB_CHIT_LIVE_SHOP', JSON.stringify(r.body));

  /* a lab chit from a LAB (test) shop keeps working, and every copy says what it is */
  ctx = { population: 'test' };
  r = await h.run(app, { url: '/api/chits/send', body: order({ business_json: { lab: true } }), identity: ME, ctx });
  ok('lab (test) shop · lab chit → sent (200/201)', r.status === 200 || r.status === 201, r.status + ' ' + JSON.stringify(r.body));
  const copies = delivered[0] || [];
  ok('…delivered: a copy for each side', copies.length === 2, JSON.stringify(copies.map((c) => c && c.direction)));
  ok('…EVERY co-held copy carries summary_json.lab: true (mint.summary whitelists the rider)', copies.length > 0 && copies.every((c) => c.summary_json && c.summary_json.lab === true), JSON.stringify(copies.map((c) => c.summary_json)));

  /* an ordinary chit from the same lab shop: no lab statement, no rider */
  delivered.length = 0; ctx = { population: 'test' };
  r = await h.run(app, { url: '/api/chits/send', body: order(), identity: ME, ctx });
  ok('an ordinary send asks nothing about the population and carries no lab rider', !ctx.popReads && r.status < 300 && (delivered[0] || []).every((c) => !('lab' in (c.summary_json || {}))), r.status + ' pop=' + ctx.popReads);
  ok('…a declared lab:"true" (a string) is an ordinary chit too — only the boolean marks it', (await (async () => { delivered.length = 0; const c2 = { population: 'live' }; const x = await h.run(app, { url: '/api/chits/send', body: order({ business_json: { lab: 'true' } }), identity: ME, ctx: c2 }); return x.status < 300 && !c2.popReads; })()));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n  ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
