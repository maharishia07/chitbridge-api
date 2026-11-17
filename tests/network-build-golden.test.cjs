/**
 * tests/network-build-golden.test.cjs — POST /api/network-design/build (and /validate) DO EXACTLY WHAT THEY DID BEFORE THE SPLIT.
 *
 * Round T2-SPLIT (2026-10-14). The build handler was one 507-line function; it is now named steps — the pure ones beside the
 * planner in lib/network-build.js (still Tier A: no DB), the ones that write in lib/network-build-run.js — REFACTOR-ONLY.
 * Proof: every scenario through the real router (db and auth stubbed, tests/support/route-golden.cjs), every SQL statement,
 * parameter and response recorded and compared with tests/fixtures/network-build-golden.json, frozen BEFORE the split.
 *
 *   node tests/network-build-golden.test.cjs           compare (the gate)
 *   node tests/network-build-golden.test.cjs --write   re-freeze — ONLY for a deliberate behaviour change, said in the PR
 * No DB, no network.
 */
'use strict';
const path = require('path');
const G = require('./support/route-golden.cjs');
const API = G.API;

const ME = '11111111-1111-4111-8111-111111111111', PARTNER = '22222222-2222-4222-8222-222222222222';
const known = { [ME]: 'ME', [PARTNER]: 'PARTNER' };

function rows(s, p, ctx) {
  if (/SELECT identity_id, bridge_id, display_name, user_id, country, currency_code, catalogue_visibility FROM identities WHERE identity_id = \$1/.test(s)) return ctx.me ? [ctx.me] : [];
  if (/SELECT user_id FROM identities WHERE identity_id = \$1/.test(s)) return ctx.me ? [{ user_id: ctx.me.user_id }] : [];
  if (/SELECT 1 FROM identities WHERE LOWER\(user_id\) = \$1/.test(s)) return ctx.clash ? [{ '?column?': 1 }] : [];
  if (/SELECT draft FROM network_design/.test(s)) return ctx.draft ? [{ draft: JSON.parse(JSON.stringify(ctx.draft)) }] : [];
  if (/LOWER\(user_id\) LIKE \$1/.test(s)) return (ctx.taken || []).map((h) => ({ h }));
  if (/SELECT bridge_id, catalogue_visibility, purpose/.test(s)) return (ctx.live || []).filter((r) => (p[0] || []).includes(r.bridge_id));
  if (/SELECT plan, params_override FROM identities/.test(s)) return [{ plan: null, params_override: ctx.capPrivate ? { caps: { catalogue_visibility: 'network' } } : {} }];
  if (/SELECT path::text AS path FROM cb_entity WHERE bridge_id = \$1/.test(s)) return ctx.noRoot ? [] : [{ path: 'CBROOT00001' }];
  if (/SELECT bridge_id, path::text AS path FROM cb_entity WHERE bridge_id = ANY/.test(s)) return (ctx.paths || []).filter((r) => (p[0] || []).includes(r.bridge_id));
  if (/^UPDATE identities SET catalogue_visibility/.test(s)) { if (ctx.updThrows) { const e = new Error('x'); e.code = ctx.updThrows; throw e; } return (ctx.mine || []).includes(p[1]) ? [{ bridge_id: p[1] }] : []; }
  if (/FROM identities WHERE \(LOWER\(user_id\) = LOWER\(\$1\) OR UPPER\(bridge_id\) = UPPER\(\$1\)\)/.test(s)) return (ctx.partners || []).filter((r) => r.user_id === String(p[0]).toLowerCase());
  if (/^select identity_id, bridge_id, display_name from identities where identity_id = \$1/i.test(s)) return (ctx.partners || []).filter((r) => r.identity_id === p[0]);
  if (/^select \* from cb_entity where bridge_id = \$1/i.test(s) || /^SELECT \* FROM cb_entity WHERE bridge_id = \$1/.test(s)) return [{ id: 'node-' + p[0], bridge_id: p[0] }];
  if (/SELECT id, state FROM cb_edge/.test(s)) return ctx.edge ? [ctx.edge] : [];
  if (/INSERT INTO cb_edge/.test(s)) return [{ id: 'edge-new' }];
  if (/INSERT INTO identities/.test(s) && ctx.insThrows) { const e = new Error('dup'); e.code = ctx.insThrows; throw e; }
  return [];
}

const h = G.harness({ rows, known });
/* a minted bridge id and a claim code are random — one fixed sequence, every run */
const crypto = require('crypto');
let seq = 0;
crypto.randomInt = (a, b) => { seq++; return b === undefined ? (seq * 7) % a : a + ((seq * 7919) % (b - a)); };

/* the currency envelope (lib/govresolve) refuses one made-up code, so both refusal branches — create and update — run */
require(path.join(API, 'lib', 'govresolve')).currencyRefusal = async (eid, cur) => (cur === 'ZZZ' ? { message: 'ZZZ is not a currency this business may price in.' } : null);
const app = h.app('/api/network-design', require(path.join(API, 'routes', 'network-design')));

const OWNER = { identity_id: ME, identity_type: 'entity', bridge_id: 'CBROOT00001', display_name: 'Athi Group' };
const meRow = (extra) => Object.assign({ identity_id: ME, bridge_id: 'CBROOT00001', display_name: 'Athi Group', user_id: 'athi', country: 'IN', currency_code: 'INR', catalogue_visibility: 'public' }, extra || {});
const ROOT = { key: 'r', name: 'Athi', root: true, owned: true, parent_key: null, holds: [] };
const owned = (key, name, extra) => Object.assign({ key, name, parent_key: 'r', owned: true, holds: ['catalogue', 'storefront'], exposure: 'public' }, extra || {});
const partner = (key, name, ref) => ({ key, name, parent_key: 'r', owned: false, partner_ref: ref, holds: ['catalogue'] });
const built = (bridge, handle, vis) => ({ built: { bridge_id: bridge, user_id: handle, visibility: vis } });
const LIVE_A = { bridge_id: 'CBBUILT0001', catalogue_visibility: 'public', purpose: 'Retail', sort_order: 1, address: null, city: null, country: 'IN', currency_code: 'INR', lat: null, lng: null, service_km: null, dispatch_days: null, ship_within_days: null, ship_beyond_days: null };
const PARTNERS = [{ identity_id: PARTNER, bridge_id: 'CBPART0001', display_name: 'Ravi Timbers', user_id: 'ravi.timbers' }, { identity_id: ME, bridge_id: 'CBROOT00001', display_name: 'Athi Group', user_id: 'athi' }];
const FULL = { nodes: [ROOT,
  owned('a', 'Clothing', { purpose: 'Retail', place: { city: 'Chennai', currency: 'INR', lat: 13, lng: 80, km: 20 } }),
  owned('b', 'Mens', { parent_key: 'a', exposure: 'protected' }),
  owned('c', 'Warehouse', { exposure: 'private', place: { currency: 'zzz' } }),
  owned('d', 'Outlet', Object.assign({ exposure: 'protected', purpose: 'Factory outlet', place: { city: 'Madurai' } }, built('CBBUILT0001', 'athi.outlet', 'public'))),
  owned('e', 'Kiosk', Object.assign({ exposure: 'private' }, built('CBBUILT0002', 'athi.kiosk', 'public'))),
  owned('g', 'Export desk', Object.assign({ purpose: 'Retail', sort_order: 1, place: { currency: 'zzz' } }, built('CBBUILT0003', 'athi.export', 'public'))),
  partner('p', 'Ravi Timbers', 'ravi.timbers'), partner('q', 'Ghost', 'nobody.here'), partner('s', 'Myself', 'athi'), partner('t', 'No ref', ''),
] };
const LIVE_E = Object.assign({}, LIVE_A, { bridge_id: 'CBBUILT0002', purpose: null, sort_order: null });
const LIVE_G = Object.assign({}, LIVE_A, { bridge_id: 'CBBUILT0003' });

const SCENARIOS = [
  ['build · a co-assist may not build → 403', { identity: Object.assign({}, OWNER, { parent_entity_id: ME }) }],
  ['build · the account cannot be read → 404', { ctx: {} }],
  ['build · a User ID that cannot be a root → 409', { ctx: { me: meRow({ user_id: 'a@b.com' }) } }],
  ['build · no User ID and no root named → 409 ROOT_HANDLE_NEEDED', { ctx: { me: meRow({ user_id: null }) } }],
  ['build · a named root that will not do → 400', { body: { root_handle: 'A B' }, ctx: { me: meRow({ user_id: null }) } }],
  ['build · a named root already taken → 409', { body: { root_handle: 'athi' }, ctx: { me: meRow({ user_id: null }), clash: true } }],
  ['build · nothing designed → 400', { ctx: { me: meRow() } }],
  ['build · dry run of the full design', { body: { dry_run: true }, ctx: { me: meRow(), draft: FULL, live: [LIVE_A, LIVE_E, LIVE_G], taken: ['athi.mens'] } }],
  ['build · dry run under a private network (the cap narrows)', { body: { dry_run: true }, ctx: { me: meRow({ catalogue_visibility: 'private' }), draft: FULL, live: [LIVE_A, LIVE_E, LIVE_G] } }],
  ['build · the network already matches', { ctx: { me: meRow(), draft: { nodes: [ROOT, owned('d', 'Outlet', Object.assign({ purpose: 'Retail', sort_order: 1 }, built('CBBUILT0001', 'athi.outlet', 'public')))] }, live: [LIVE_A] } }],
  ['build · the full design, root claimed', { body: { root_handle: 'athi' }, ctx: { me: meRow({ user_id: null }), draft: FULL, live: [LIVE_A, LIVE_E, LIVE_G], paths: [{ bridge_id: 'CBBUILT0001', path: 'CBROOT00001.CBBUILT0001' }], mine: ['CBBUILT0001'], partners: PARTNERS } }],
  ['build · the full design, partner already asked', { ctx: { me: meRow(), draft: FULL, live: [LIVE_A, LIVE_E, LIVE_G], mine: ['CBBUILT0001', 'CBBUILT0002'], partners: PARTNERS, edge: { id: 'edge-old', state: 'active' } } }],
  ['build · the root cannot be placed → 500', { ctx: { me: meRow(), draft: FULL, noRoot: true } }],
  ['build · a name taken mid-build → 409', { ctx: { me: meRow(), draft: FULL, insThrows: '23505' } }],
  ['build · network visibility not migrated → 409', { ctx: { me: meRow(), draft: FULL, live: [LIVE_A, LIVE_E, LIVE_G], mine: ['CBBUILT0001'], updThrows: '23514' } }],
  ['validate · a lab sketch (no reads)', { url: '/validate', body: { sample: true, draft: FULL } }],
  ['validate · the saved design', { url: '/validate', body: { ceiling: 'network' }, ctx: { me: meRow(), draft: FULL, taken: ['athi.clothing'] } }],
  ['validate · a draft that is not an object → 400', { url: '/validate', body: { draft: [1] } }],
];

(async () => {
  console.log('\n══ T2-SPLIT · POST /api/network-design/build — the same trace before and after the split ══\n');
  const recs = {};
  for (const [name, sc] of SCENARIOS) {
    seq = 0;
    recs[name] = await h.run(app, { url: '/api/network-design' + (sc.url || '/build'), body: sc.body || {}, identity: sc.identity || OWNER, ctx: sc.ctx || {} });
  }
  const bad = G.compare(recs, path.join(__dirname, 'fixtures', 'network-build-golden.json'));
  let pass = 0;
  for (const [name] of SCENARIOS) {
    const b = bad.find((x) => x.name === name);
    if (b) console.log('   FAIL ' + name + '\n          ' + G.firstDiff(b.got, b.want));
    else { pass++; console.log('   ok   ' + name + '  (' + recs[name].status + ', ' + recs[name].calls.length + ' calls)'); }
  }
  console.log('\n  ' + pass + ' passed, ' + bad.length + ' failed');
  console.log('  ' + pass + ' checks');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
