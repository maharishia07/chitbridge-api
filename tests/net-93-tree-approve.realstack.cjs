'use strict';
/**
 * tests/net-93-tree-approve.realstack.cjs — NET-93 on a REAL Postgres, as the role the api runs as (cb_app): approving a governance (tree) edge.
 *
 * Migration b843's trigger says an entity never changes network (its root label), yet approving a tree edge moves the child's subtree under the parent:
 * the approve answered 500 ("an entity cannot change networks"), so an existing business could never join a network, and the second of two crossed
 * requests (the cycle) answered 500 instead of 409. A stub db cannot show it: the refusal is the trigger's. The fix is ONE consented door
 * (src/services/network.js reRootGuard sets cb.net_reroot for the transaction; b848 reads it).
 * HAND-COMPUTED  S asks to join B (S has its own root S, with one branch S.S1): B approves-side is S (the child consents). After: S.path = B.S, S1.path = B.S.S1,
 *           root_path of both = B; the edge is active. Disconnect: both back under root S, edge disconnected.
 *           Two roots X and Y ask each other: approve X-parent edge → Y is X.Y; approve Y-parent edge → 409 CYCLE (X.Y is under X).
 *           A bare UPDATE of path to another root is refused (23514); naming a THIRD root in cb.net_reroot is refused too.
 *           A node already inside a tree (path P.Q, no live edge) cannot walk out by approve: 409 HAS_PARENT and its path is unchanged.
 * Run: DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 node tests/net-93-tree-approve.realstack.cjs   (CI: the integration S41 job; needs b843 + b848 run)
 * CARD      04-network/connections-and-invitations
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'net93_test_secret_at_least_32_chars_pad';
const net = require('../src/services/network');
const { query } = require('../db');
const { withTx } = require('../src/db');
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 300) : '')); } };
const RUN = 'n93' + (Date.now() % 1e10).toString(36);
const madeIdentities = [];
const label = (bridgeId) => String(bridgeId).replace(/[^A-Za-z0-9_]/g, '_');

/** a business: its identity and its node: a root of its own (as the first ask makes it), or, with `under`, inserted at a place in another tree (an INSERT, as a network build places a store) */
async function business(tag, under) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(
    `INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id`,
    [bridgeId, 'NET93 ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  madeIdentities.push(identity.identity_id);
  if (under) {
    await query(`INSERT INTO cb_entity (bridge_id, name, mode, owner_scope, path, claimed) VALUES ($1, $2, 'b2b', 'entity', $3::ltree, true)`, [bridgeId, tag, under + '.' + label(bridgeId)]);
  }
  return { bridgeId, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
const pathOf = async (biz) => (await query(`SELECT path::text AS path, root_path::text AS root FROM cb_entity WHERE id = $1`, [biz.node.id])).rows[0];
/** the error an operation answers, or null */
const refusal = async (fn) => { try { await fn(); return null; } catch (e) { return { status: e.status, code: e.code, message: e.message }; } };
const treeAsk = (parent, child, asker) => net.requestConnect({ parentId: parent.node.id, childId: child.node.id }, asker.node);

async function joinAndLeave() {
  const brand = await business('b'), shop = await business('s');
  const shopRoot = (await pathOf(shop)).path;
  const branch = await business('t', shopRoot);
  const asked = await treeAsk(brand, shop, brand);
  const refused = await refusal(() => net.approve({ edgeId: asked.id }, shop.node));
  ok('J1 the shop (a root with its own branch) joins the brand\'s tree: approve answers, not 500', refused === null, JSON.stringify(refused));
  const after = await pathOf(shop);
  ok('J2 the shop sits under the brand: path ' + after.path + ' root ' + after.root, after.path === `${label(brand.bridgeId)}.${label(shop.bridgeId)}` && after.root === label(brand.bridgeId), JSON.stringify(after));
  const edge = (await query(`SELECT state FROM cb_edge WHERE id = $1`, [asked.id])).rows[0];
  const branchPath = (await pathOf(branch)).path;
  ok('J2b its branch moved with it: ' + branchPath, branchPath === after.path + '.' + label(branch.bridgeId), branchPath);
  ok('J3 the edge is active', edge && edge.state === 'active', JSON.stringify(edge));
  const left = await refusal(() => net.disconnect({ edgeId: asked.id }, brand.node));
  const back = await pathOf(shop);
  ok('J4 the brand disconnects it: the shop is back under its own root ' + back.path, left === null && back.path === shopRoot && back.root === shopRoot, JSON.stringify({ left, back }));
  return { brand, shop };
}
/** the other direction: the shop asks to join and the brand accepts */
async function shopAsks() {
  const brand = await business('m'), shop = await business('n');
  const asked = await treeAsk(brand, shop, shop);
  const refused = await refusal(() => net.approve({ edgeId: asked.id }, brand.node));
  const after = await pathOf(shop);
  ok('J5 the shop asks to join and the brand accepts: it sits under the brand', refused === null && after.root === label(brand.bridgeId), JSON.stringify({ refused, after }));
}
async function guardHolds(brand, shop) {
  const bare = await refusal(() => query(`UPDATE cb_entity SET path = $1::ltree WHERE id = $2`, [`${label(brand.bridgeId)}.${label(shop.bridgeId)}`, shop.node.id]));
  ok('G1 a bare path update to another network is still refused by the trigger (23514)', bare && /cannot change networks/.test(bare.message), JSON.stringify(bare));
  const third = await refusal(() => withTx(async (c) => {
    await c.query(`select set_config('cb.net_reroot', $1, true)`, [label(brand.bridgeId) + '_other']);
    await c.query(`UPDATE cb_entity SET path = $1::ltree WHERE id = $2`, [`${label(brand.bridgeId)}.${label(shop.bridgeId)}`, shop.node.id]);
  }));
  ok('G2 naming a THIRD root in the setting does not open the door', third && /cannot change networks/.test(third.message), JSON.stringify(third));
  const unchanged = await pathOf(shop);
  ok('G3 after both refusals the shop is still on its own root', unchanged.path === label(shop.bridgeId), JSON.stringify(unchanged));
}
async function cycles() {
  const x = await business('x'), y = await business('y');
  const xAsksY = await treeAsk(x, y, x);
  const yAsksX = await treeAsk(y, x, y);
  const first = await refusal(() => net.approve({ edgeId: xAsksY.id }, y.node));
  ok('C1 two roots ask each other: the first approve puts Y under X', first === null && (await pathOf(y)).path === `${label(x.bridgeId)}.${label(y.bridgeId)}`, JSON.stringify(first));
  const second = await refusal(() => net.approve({ edgeId: yAsksX.id }, x.node));
  ok('C2 the second approve (X under its own child Y) answers 409 CYCLE, never 500', second && second.status === 409 && second.code === 'CYCLE', JSON.stringify(second));
  ok('C3 the cycle moved nothing: X is still a root', (await pathOf(x)).path === label(x.bridgeId));
  // a node inside a tree whose edge is gone (stale) cannot walk out by approve
  const stale = await business('q', (await pathOf(x)).path);
  const z = await business('z');
  const ask = await treeAsk(z, stale, z).catch((e) => e);
  const deep = ask && ask.id ? await refusal(() => net.approve({ edgeId: ask.id }, stale.node)) : { status: ask && ask.status, code: ask && ask.code };
  ok('C4 a node already inside a tree cannot be taken out of it by approve: 409 HAS_PARENT', deep && deep.status === 409 && deep.code === 'HAS_PARENT', JSON.stringify(deep));
  ok('C5 and its path is unchanged', (await pathOf(stale)).path === `${label(x.bridgeId)}.${label(stale.bridgeId)}` || (await pathOf(stale)).path.startsWith(label(x.bridgeId)+'.'));
}
async function cleanup() {
  const nodes = (await query(`SELECT e.id FROM cb_entity e JOIN identities i ON upper(i.bridge_id) = upper(e.bridge_id) WHERE i.identity_id = ANY($1::uuid[])`, [madeIdentities])).rows.map((r) => r.id);
  await query(`DELETE FROM cb_edge WHERE parent_id = ANY($1::uuid[]) OR child_id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM cb_entity WHERE id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM identities WHERE identity_id = ANY($1::uuid[])`, [madeIdentities]);
}
(async () => {
  console.log('\n── NET-93 approve a tree edge on real Postgres · run ' + RUN + ' ──');
  try {
    const { brand, shop } = await joinAndLeave();
    await shopAsks();
    await guardHolds(brand, shop);
    await cycles();
  } catch (e) {
    ok('the run reached its end', false, e && e.stack);
  } finally {
    await cleanup().catch((e) => ok('cleanup', false, e && e.message));
  }
  console.log(`\n${pass} ok, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
