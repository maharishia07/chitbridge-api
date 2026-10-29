'use strict';
/**
 * tests/sec100-truth.realstack.cjs — SEC-100 TRUTH, on the REAL stack: real Postgres, real api. No write stores another shop's folder through a folder foreign key.
 *
 * OWNS      the T2 proof of the four writes that put a folder id into a column with a foreign key to folder(folder_id): POST /api/folders/:id/rules (folder_rule.folder_id) ·
 *           PATCH /api/folders/:id with parent_id and POST /api/folders with parent_id (folder.parent_id) · PUT /api/entities/routing with folder_id (entity_work_routing.folder_id).
 *           Postgres checks a foreign key WITHOUT row security, so a stand-in db can never show the defect (the paid-for lesson of api #321 and #356): here shop B asks with shop A's
 *           folder id and with an id nobody owns, and the database is READ afterwards. The offline twin (the same cases on a stand-in that models the key) is tests/sec100-folder-fk.test.cjs.
 * CALLED BY the S41 job of .github/workflows/ci.yml (every tests/*-truth.realstack.cjs, one file at a time); locally: node tests/sec100-truth.realstack.cjs (one realstack file at a time on :3100).
 * FLOW      two fresh shops (A owns the folders, B asks as another shop) → B asks for A's folder / an unknown folder in each of the four writes → both answers equal → the rows are read back,
 *           nothing of B points at A → A deletes its folder → B's folders, rules and routing are untouched.
 * CARD      28-platform-and-operations/api-standard
 *
 * SEC100-01 rules · SEC100-02 PATCH parent · SEC100-03 create with a parent · SEC100-04 routing folder · SEC100-05 CASCADE: A deletes its folder, B is untouched · SEC100-06 own-shop success paths.
 * Every unknown id is its own constant: two cases sharing one uuid collided once (api #394, BELL-02).
 * NOT RUN where this was written (no Docker there): the S41 job is its first run. LOCAL ONLY.
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, freshShop, finish } = H;
const RUN = 's1' + (Date.now() % 1e10).toString(36);
const GHOST_RULES = '00000000-0000-4000-8000-0000000100a1'; /* well-formed ids nobody owns, one per case */
const GHOST_PATCH = '00000000-0000-4000-8000-0000000100a2';
const GHOST_CREATE = '00000000-0000-4000-8000-0000000100a3';
const GHOST_ROUTING = '00000000-0000-4000-8000-0000000100a4';
const KIND = 'incident';
let pg = null;

/** an answer without the request id (it differs on every request), to compare two answers word for word */
const plain = (reply) => JSON.stringify({ status: reply.status, body: Object.assign({}, reply.b, { request_id: null }) });
const sameAnswer = (left, right) => plain(left) === plain(right);
const rowsOf = async (sql, args) => (await pg.query(sql, args)).rows;
const folderOf = async (shop, name, parent) => ok(await j('/api/folders', { method: 'POST', token: shop.token, body: parent ? { name, parent_id: parent } : { name } }), 'folder ' + name).b.folder.folder_id;
const routingOf = async (shop) => (await rowsOf('SELECT folder_id FROM entity_work_routing WHERE entity_id = $1 AND kind = $2', [shop.entity, KIND]))[0];
const setRouting = (shop, folder) => j('/api/entities/routing', { method: 'PUT', token: shop.token, body: { kind: KIND, folder_id: folder, assignee_actor_id: null, route_to_entity_id: null } });
const ruleBody = { name: 'Cross', when: { doc: 'invoice' } };
/** how many rows of shop B point at a folder of shop A, through the three columns */
async function pointingAtA(B, A) {
  const parents = await rowsOf('SELECT count(*)::int AS n FROM folder c JOIN folder p ON p.folder_id = c.parent_id WHERE c.entity_id = $1 AND p.entity_id = $2', [B.entity, A.entity]);
  const rules = await rowsOf('SELECT count(*)::int AS n FROM folder_rule r JOIN folder f ON f.folder_id = r.folder_id WHERE r.entity_id = $1 AND f.entity_id = $2', [B.entity, A.entity]);
  const routes = await rowsOf('SELECT count(*)::int AS n FROM entity_work_routing w JOIN folder f ON f.folder_id = w.folder_id WHERE w.entity_id = $1 AND f.entity_id = $2', [B.entity, A.entity]);
  return parents[0].n + rules[0].n + routes[0].n;
}

(async () => {
  console.log('\n── SEC-100 truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Sec100 A');
    const B = await freshShop(RUN + 'b', 'Sec100 B');
    const fA = await folderOf(A, 'A only ' + RUN);
    const fB = await folderOf(B, 'B own ' + RUN);
    const fB2 = await folderOf(B, 'B second ' + RUN);

    await kase('SEC100-01', "POST /api/folders/:id/rules: another shop's folder is refused (404) exactly as an unknown folder is; no rule of B's is stored against it", async () => {
      const asForeign = await j('/api/folders/' + fA + '/rules', { method: 'POST', token: B.token, body: ruleBody });
      const asGhost = await j('/api/folders/' + GHOST_RULES + '/rules', { method: 'POST', token: B.token, body: ruleBody });
      const stored = (await rowsOf('SELECT 1 FROM folder_rule WHERE entity_id = $1 AND folder_id = $2', [B.entity, fA])).length;
      expect(stored === 0 && asForeign.status === 404 && asGhost.status === 404 && sameAnswer(asForeign, asGhost), "B's rules against A's folder: " + stored + ' · A folder ' + plain(asForeign).slice(0, 160) + ' · unknown ' + plain(asGhost).slice(0, 160));
    });
    await kase('SEC100-02', "PATCH /api/folders/:id parent_id: another shop's folder as the parent is refused (404) exactly as an unknown parent is; the parent is not set", async () => {
      const asForeign = await j('/api/folders/' + fB2, { method: 'PATCH', token: B.token, body: { parent_id: fA } });
      const asGhost = await j('/api/folders/' + fB2, { method: 'PATCH', token: B.token, body: { parent_id: GHOST_PATCH } });
      const parent = (await rowsOf('SELECT parent_id FROM folder WHERE folder_id = $1', [fB2]))[0].parent_id;
      expect(parent === null && asForeign.status === 404 && asGhost.status === 404 && sameAnswer(asForeign, asGhost), 'parent now ' + parent + " · A's folder " + plain(asForeign).slice(0, 160) + ' · unknown ' + plain(asGhost).slice(0, 160));
    });
    await kase('SEC100-03', "POST /api/folders with parent_id: another shop's folder as the parent is refused (400) exactly as an unknown parent is; no folder is made under it", async () => {
      const asForeign = await j('/api/folders', { method: 'POST', token: B.token, body: { name: 'Cross ' + RUN, parent_id: fA } });
      const asGhost = await j('/api/folders', { method: 'POST', token: B.token, body: { name: 'Cross ' + RUN, parent_id: GHOST_CREATE } });
      const made = (await rowsOf('SELECT 1 FROM folder WHERE entity_id = $1 AND parent_id = $2', [B.entity, fA])).length;
      expect(made === 0 && asForeign.status === 400 && asGhost.status === 400 && sameAnswer(asForeign, asGhost), 'folders of B under A\'s folder: ' + made + " · A's folder " + plain(asForeign).slice(0, 160) + ' · unknown ' + plain(asGhost).slice(0, 160));
    });
    await kase('SEC100-04', "PUT /api/entities/routing folder_id: another shop's folder is refused (404) exactly as an unknown folder is; the routing does not point at it", async () => {
      const asForeign = await setRouting(B, fA);
      const asGhost = await setRouting(B, GHOST_ROUTING);
      const row = await routingOf(B);
      expect((!row || row.folder_id === null) && asForeign.status === 404 && asGhost.status === 404 && sameAnswer(asForeign, asGhost), 'routing row ' + JSON.stringify(row) + " · A's folder " + plain(asForeign).slice(0, 160) + ' · unknown ' + plain(asGhost).slice(0, 160));
    });

    await kase('SEC100-05', "CASCADE: shop A deletes its folder (with a rule, a child, a routing on it); shop B's folders, rules and routing are untouched and nothing of B pointed at A", async () => {
      const childA = await folderOf(A, 'A child ' + RUN, fA);
      ok(await j('/api/folders/' + fA + '/rules', { method: 'POST', token: A.token, body: { name: 'A rule', when: { doc: 'invoice' } } }), 'A rule');
      ok(await setRouting(A, fA), 'A routing');
      const ruleB = ok(await j('/api/folders/' + fB + '/rules', { method: 'POST', token: B.token, body: ruleBody }), 'B rule').b.rule_id;
      ok(await setRouting(B, fB), 'B routing');
      const linked = await pointingAtA(B, A);
      const before = { folders: (await rowsOf('SELECT folder_id FROM folder WHERE entity_id = $1 ORDER BY folder_id', [B.entity])).map((r) => r.folder_id).join(), rule: (await rowsOf('SELECT 1 FROM folder_rule WHERE rule_id = $1', [ruleB])).length, route: (await routingOf(B)).folder_id };
      ok(await j('/api/folders/' + fA, { method: 'DELETE', token: A.token }), 'A deletes its folder');
      const after = { folders: (await rowsOf('SELECT folder_id FROM folder WHERE entity_id = $1 ORDER BY folder_id', [B.entity])).map((r) => r.folder_id).join(), rule: (await rowsOf('SELECT 1 FROM folder_rule WHERE rule_id = $1', [ruleB])).length, route: (await routingOf(B)).folder_id };
      const aGone = (await rowsOf('SELECT 1 FROM folder WHERE folder_id = ANY($1::uuid[])', [[fA, childA]])).length;
      expect(linked === 0 && aGone === 0 && JSON.stringify(before) === JSON.stringify(after) && after.rule === 1 && after.route === fB, 'rows of B pointing at A: ' + linked + ' · A folders left ' + aGone + ' · B before ' + JSON.stringify(before) + ' · after ' + JSON.stringify(after));
    });
    await kase('SEC100-06', 'own-shop success paths: a child folder, a rule in it, a move to the root, the routing set and cleared all work', async () => {
      const child = await folderOf(B, 'B child ' + RUN, fB);
      const rule = await j('/api/folders/' + child + '/rules', { method: 'POST', token: B.token, body: ruleBody });
      const moved = await j('/api/folders/' + child, { method: 'PATCH', token: B.token, body: { parent_id: fB2 } });
      const root = await j('/api/folders/' + child, { method: 'PATCH', token: B.token, body: { parent_id: '' } });
      const set = await setRouting(B, fB2);
      const setRow = await routingOf(B);
      const clear = await setRouting(B, null);
      const clearRow = await routingOf(B);
      const parent = (await rowsOf('SELECT parent_id FROM folder WHERE folder_id = $1', [child]))[0].parent_id;
      expect(rule.status === 200 && moved.status === 200 && root.status === 200 && parent === null && set.status === 200 && setRow.folder_id === fB2 && clear.status === 200 && clearRow.folder_id === null,
        'rule ' + rule.status + ' · move ' + moved.status + ' · root ' + root.status + ' (parent ' + parent + ') · routing set ' + set.status + ' ' + JSON.stringify(setRow) + ' · cleared ' + clear.status + ' ' + JSON.stringify(clearRow));
    });
  } finally {
    await pg.end();
  }
  finish('sec100-truth', process.env.TRUTH_JSON);
})().catch((failure) => {
  console.error('sec100-truth crashed:', failure.message);
  process.exit(2);
});
