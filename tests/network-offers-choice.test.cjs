'use strict';
/**
 * tests/network-offers-choice.test.cjs — NET-98: POST /api/network-offers/:id/choice answers 404 for an offer the caller cannot see, and writes nothing.
 * OWNS      the member M of BR1: a valid offer is saved (200); an unknown id, BR2's offer (another network) and a withdrawn offer (a NEW choice) are 404 and nothing is written;
 *           a stale record of a withdrawn or unknown offer is still CLEARED (null, 200); an outsider is refused too.
 * CALLED BY scripts/guards.cjs (the list of tests). Reuses routes/network-offers.js (readStoreSide, the one rule GET lists by) and tests/support/route-golden.cjs. No DB, no network.
 * CARD      network-and-trade/network-offers
 * Run: node tests/network-offers-choice.test.cjs
 */
const path = require('path');
const G = require('./support/route-golden.cjs');
const id = (n) => '00000000-0000-4000-8000-0000000000' + n;
const BR1 = id('b1'),
  BR2 = id('b2'),
  M = id('a1'),
  N = id('a2'),
  Z = id('a3'),
  O1 = id('c1'),
  O2 = id('c2');
const AT = '2026-10-01T00:00:00.000Z';
const released = (o, until) => ({ network_offers: { policy: 'opt_in', released: { [o]: { version: 1, at: AT, until: until || null } } } });
const O3 = id('c3');
const flagsOf = { [BR1]: released(O1), [BR2]: released(O2), [M]: { network_choices: { [O3]: 'in' } } };
const offerOf = {
  [BR1]: { definition_id: O1, name: 'Alpha deal', sub_kind: 'discount', status: 'live', current_version: 1 },
  [BR2]: { definition_id: O2, name: 'Beta deal', sub_kind: 'discount', status: 'live', current_version: 1 }
};
const brandsOf = { [M]: [BR1], [N]: [BR2], [Z]: [] };
const CANARY = { leak_canary: 'planted' };
const standingRow = (me, brand) => ({
  brand_id: brand,
  brand_node: 'n-' + brand,
  store_node: 'n-' + me,
  brand_bridge_id: 'bb-' + brand,
  root_bridge_id: 'bb-' + brand,
  tree_parent: null,
  built: false,
  tree_state: null,
  tree_edge: null,
  edge_id: 'e-' + me,
  edge_state: me === M ? 'active' : 'requested',
  asked_by: 'store'
});
const first = (params) => String((params || [])[0] || '');
const rows = (sql, params) => {
  if (/FROM identities WHERE identity_id = ANY/.test(sql))
    return [BR1, BR2]
      .filter((b) => (params[0] || []).includes(b))
      .map((b) => ({ id: b, display_name: b === BR1 ? 'Brand One' : 'Brand Two', policy_flags: flagsOf[b] }));
  if (/^SELECT display_name(, gstn)?.* FROM identities WHERE identity_id = \$1/.test(sql))
    return [{ display_name: 'Caller', policy_flags: flagsOf[first(params)] || {}, country: 'IN' }];
  if (/FROM definition/.test(sql) && /status IN \('live', 'draft'\)/.test(sql)) return offerOf[first(params)] ? [offerOf[first(params)]] : [];
  if (/FROM definition/.test(sql) && /definition_id::text = ANY/.test(sql)) return offerOf[first(params)] ? [offerOf[first(params)]] : [];
  if (/AS owns/.test(sql))
    return [{ owns: !!offerOf[first(params)], node: 'n-' + first(params), bridge_id: 'bb-' + first(params), root_bridge_id: 'bb-' + first(params) }];
  if (/'built' AS via/.test(sql))
    return first(params) === BR1
      ? [Object.assign({ id: M, via: 'joined', state: 'active', edge_id: 'e1', asked_by: 'store', node_id: 'n-' + M, parent_node: 'n-' + BR1 }, CANARY)]
      : [];
  if (/AS brand_id/.test(sql) && /cb_edge e ON e.child_id/.test(sql)) return (brandsOf[first(params)] || []).map((b) => ({ brand_id: b }));
  if (/AS tree_parent/.test(sql)) return (brandsOf[first(params)] || []).map((b) => standingRow(first(params), b));
  if (/DISTINCT ON \(owner_entity_id\)/.test(sql))
    return [
      { id: BR1, title: 'Brand One' },
      { id: BR2, title: 'Brand Two' }
    ];
  if (/^SELECT b FROM unnest/.test(sql)) return (String(params[1]) === M ? brandsOf[M] : []).map((b) => ({ b }));
  return [];
};
const h = G.harness({ rows, known: { [BR1]: 'BR1', [BR2]: 'BR2', [M]: 'M', [N]: 'N', [Z]: 'Z', [O1]: 'O1', [O2]: 'O2' } });
h.db.readBatch = async (who, actor, stmts) => Promise.all(stmts.map((s) => h.db.query(s.text, s.params)));
const app = h.app('/api/network-offers', require(path.join(G.API, 'routes', 'network-offers')));
let pass = 0,
  fail = 0;
const t = (name, cond, extra) => {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + (extra ? '   ' + extra : ''));
  }
};
const get = (who) => h.run(app, { method: 'GET', url: '/api/network-offers', identity: { identity_id: who, identity_type: 'entity', entity_id: who } });
const namesIn = (r) => ((r.body.store || {}).networks || []).flatMap((n) => n.offers.map((o) => o.name));
const wrote = [];
const net = require(path.join(G.API, 'lib', 'network-offers'));
net.setIn = async (who, section, key, value) => {
  wrote.push([who, section, key, value]);
};
require(path.join(G.API, 'lib', 'shopchanged')).shopChanged = () => {};
const post = (who, offer, choice) => {
  wrote.length = 0;
  return h.run(app, {
    method: 'POST',
    url: '/api/network-offers/' + offer + '/choice',
    body: { choice },
    identity: { identity_id: who, identity_type: 'entity', entity_id: who }
  });
};
(async () => {
  const ok = await post(M, O1, 'in');
  t(
    'a valid offer of the shop own network is saved (200)',
    ok.status === 200 && wrote.length === 1 && wrote[0][2] === O1 && wrote[0][3] === 'in',
    ok.status + JSON.stringify(wrote)
  );
  const unknown = await post(M, id('ff'), 'in');
  t('an unknown well-formed id is 404 and nothing is written', unknown.status === 404 && wrote.length === 0, unknown.status + JSON.stringify(wrote));
  const unknownClear = await post(M, id('ff'), null);
  t('clearing an id the shop holds no record of is 404 too', unknownClear.status === 404 && wrote.length === 0, unknownClear.status);
  const other = await post(M, O2, 'in');
  t('another network offer is 404 and nothing is written', other.status === 404 && wrote.length === 0, other.status + JSON.stringify(wrote));
  const outsider = await post(N, O2, 'in');
  t('a shop that only asked the network is 404 and nothing is written', outsider.status === 404 && wrote.length === 0, outsider.status);
  flagsOf[BR1] = released(O1, '2026-10-02T00:00:00.000Z');
  const ended = await post(M, O1, 'in');
  t('a withdrawn (ended) offer takes no NEW choice: 404, nothing written', ended.status === 404 && wrote.length === 0, ended.status + JSON.stringify(wrote));
  flagsOf[BR1] = released(O1);
  const stale = await post(M, O3, null);
  t(
    'a stale record of an offer no longer listed is cleared (200, the key removed)',
    stale.status === 200 && wrote.length === 1 && wrote[0][2] === O3 && wrote[0][3] === null,
    stale.status + JSON.stringify(wrote)
  );
  const staleNew = await post(M, O3, 'out');
  t('...but a new choice on it is refused: 404', staleNew.status === 404 && wrote.length === 0, staleNew.status);
  const bad = await post(M, 'nope', 'in');
  t('a malformed id stays 400 OFFER_UNKNOWN', bad.status === 400 && bad.body.code === 'OFFER_UNKNOWN' && wrote.length === 0, bad.status);
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
