'use strict';
/**
 * tests/network-offers-visibility.test.cjs — SEC-134: GET /api/network-offers tells a caller only the offers it may see, and carries no column nobody named.
 * OWNS      two networks (BR1 and BR2, one released offer each), a member of BR1 (M), an outsider who only ASKED BR2 (N), a shop with no edge (Z) and the brand owner (BR1):
 *           the member reads BR1's offer and nothing of BR2's; the outsider and the stranger read no offer at all (an empty list, never a 404: the contract's answer for this list);
 *           the brand reads its own roster with the named columns only. Every roster row of the stand-in carries a leak_canary column: it must not reach any answer.
 * CALLED BY scripts/guards.cjs (the list of tests).  Reuses routes/network-offers.js (the rule: lib/network-membership standing + the brand's own released flags) and tests/support/route-golden.cjs. No DB, no network.
 * Run: node tests/network-offers-visibility.test.cjs
 */
const path = require('path');
const G = require('./support/route-golden.cjs');
const id = (n) => '00000000-0000-4000-8000-0000000000' + n;
const BR1 = id('b1'), BR2 = id('b2'), M = id('a1'), N = id('a2'), Z = id('a3'), O1 = id('c1'), O2 = id('c2');
const AT = '2026-10-01T00:00:00.000Z';
const released = (o) => ({ network_offers: { policy: 'opt_in', released: { [o]: { version: 1, at: AT, until: null } } } });
const flagsOf = { [BR1]: released(O1), [BR2]: released(O2) };
const offerOf = { [BR1]: { definition_id: O1, name: 'Alpha deal', sub_kind: 'discount', status: 'live', current_version: 1 }, [BR2]: { definition_id: O2, name: 'Beta deal', sub_kind: 'discount', status: 'live', current_version: 1 } };
const brandsOf = { [M]: [BR1], [N]: [BR2], [Z]: [] };
const CANARY = { leak_canary: 'planted' };
const standingRow = (me, brand) => ({ brand_id: brand, brand_node: 'n-' + brand, store_node: 'n-' + me, brand_bridge_id: 'bb-' + brand, root_bridge_id: 'bb-' + brand, tree_parent: null, built: false, tree_state: null, tree_edge: null,
  edge_id: 'e-' + me, edge_state: me === M ? 'active' : 'requested', asked_by: 'store' });
const first = (params) => String((params || [])[0] || '');
const rows = (sql, params) => {
  if (/FROM identities WHERE identity_id = ANY/.test(sql)) return [BR1, BR2].filter((b) => (params[0] || []).includes(b)).map((b) => ({ id: b, display_name: b === BR1 ? 'Brand One' : 'Brand Two', policy_flags: flagsOf[b] }));
  if (/^SELECT display_name(, gstn)?.* FROM identities WHERE identity_id = \$1/.test(sql)) return [{ display_name: 'Caller', policy_flags: flagsOf[first(params)] || {}, country: 'IN' }];
  if (/FROM definition/.test(sql) && /status IN \('live', 'draft'\)/.test(sql)) return offerOf[first(params)] ? [offerOf[first(params)]] : [];
  if (/FROM definition/.test(sql) && /definition_id::text = ANY/.test(sql)) return offerOf[first(params)] ? [offerOf[first(params)]] : [];
  if (/AS owns/.test(sql)) return [{ owns: !!offerOf[first(params)], node: 'n-' + first(params), bridge_id: 'bb-' + first(params), root_bridge_id: 'bb-' + first(params) }];
  if (/'built' AS via/.test(sql)) return first(params) === BR1 ? [Object.assign({ id: M, via: 'joined', state: 'active', edge_id: 'e1', asked_by: 'store', node_id: 'n-' + M, parent_node: 'n-' + BR1 }, CANARY)] : [];
  if (/AS brand_id/.test(sql) && /cb_edge e ON e.child_id/.test(sql)) return (brandsOf[first(params)] || []).map((b) => ({ brand_id: b }));
  if (/AS tree_parent/.test(sql)) return (brandsOf[first(params)] || []).map((b) => standingRow(first(params), b));
  if (/DISTINCT ON \(owner_entity_id\)/.test(sql)) return [{ id: BR1, title: 'Brand One' }, { id: BR2, title: 'Brand Two' }];
  if (/^SELECT b FROM unnest/.test(sql)) return (String(params[1]) === M ? brandsOf[M] : []).map((b) => ({ b }));
  return [];
};
const h = G.harness({ rows, known: { [BR1]: 'BR1', [BR2]: 'BR2', [M]: 'M', [N]: 'N', [Z]: 'Z', [O1]: 'O1', [O2]: 'O2' } });
h.db.readBatch = async (who, actor, stmts) => Promise.all(stmts.map((s) => h.db.query(s.text, s.params)));
const app = h.app('/api/network-offers', require(path.join(G.API, 'routes', 'network-offers')));
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '   ' + extra : '')); } };
const get = (who) => h.run(app, { method: 'GET', url: '/api/network-offers', identity: { identity_id: who, identity_type: 'entity', entity_id: who } });
const namesIn = (r) => ((r.body.store || {}).networks || []).flatMap((n) => n.offers.map((o) => o.name));
(async () => {
  const member = await get(M), outsider = await get(N), stranger = await get(Z), brand = await get(BR1);
  const all = [member, outsider, stranger, brand];
  t('every caller is answered 200', all.every((r) => r.status === 200), all.map((r) => r.status).join());
  t('the member of BR1 reads BR1\'s offer and not BR2\'s', namesIn(member).join() === 'Alpha deal' && !JSON.stringify(member.body).includes('Beta'), JSON.stringify(namesIn(member)));
  t('the outsider who only asked BR2 reads no offer (an empty list)', namesIn(outsider).length === 0 && !JSON.stringify(outsider.body).includes('Beta') && !JSON.stringify(outsider.body).includes('Alpha'), JSON.stringify(outsider.body.store));
  t('the shop with no edge reads no network and no offer', stranger.body.store.networks.length === 0 && !JSON.stringify(stranger.body).includes('deal'));
  t('the brand owner reads its own offer and none of BR2', brand.body.brand.offers.map((o) => o.name).join() === 'Alpha deal' && !JSON.stringify(brand.body).includes('Beta'));
  const keys = Object.keys(brand.body.brand.members[0] || {}).sort().join();
  t('a roster row carries the named columns only', keys === 'asked_by,edge_id,id,may,name,node_id,parent_node,state,via', keys);
  t('no planted column reaches any answer', all.every((r) => !JSON.stringify(r.body).includes('leak_canary')));
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
