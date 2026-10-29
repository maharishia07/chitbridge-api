'use strict';
/**
 * tests/folder-cycle-truth.realstack.cjs — A FOLDER CANNOT BE MOVED UNDER ITS OWN DESCENDANT, on the REAL stack (RAIL-137 c).
 *
 * OWNS      the T2 proof that PATCH /api/folders/:id with a parent_id below the folder is refused 400 and the tree is unchanged: the walk up
 *           is Postgres's (WITH RECURSIVE), so the database is READ afterwards. The offline case is parent-below-itself in tests/api-problem-finance.test.cjs.
 * CALLED BY the S41 job of .github/workflows/ci.yml (every tests/*-truth.realstack.cjs, one file at a time); locally: node tests/folder-cycle-truth.realstack.cjs on :3100.
 * FLOW      a fresh shop → top > child > grandchild → PATCH top under grandchild (400) and under child (400) → the parents read back unchanged
 *           → PATCH grandchild under top (an ordinary move up) still works
 * CARD      docs/01-rail-core-the-chit/functions/user-folders-and-auto-file-rules.md
 *
 * CYCLE-01 under a grandchild is refused · CYCLE-02 under a child is refused · CYCLE-03 the tree is unchanged · CYCLE-04 a move up still works.
 * NOT RUN where this was written (no local stack): the S41 job is its first run.
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'fc' + (Date.now() % 1e10).toString(36);
let pg = null;

const parentOf = async (folder) => (await pg.query('SELECT parent_id FROM folder WHERE folder_id = $1', [folder])).rows[0].parent_id;
const folderOf = async (shop, name, parent) => ok(await j('/api/folders', { method: 'POST', token: shop.token, body: parent ? { name, parent_id: parent } : { name } }), 'folder ' + name).b.folder.folder_id;
const moveUnder = (shop, folder, parent) => j('/api/folders/' + folder, { method: 'PATCH', token: shop.token, body: { parent_id: parent } });

(async () => {
  console.log('\n── folder cycle truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Cycle A');
    const top = await folderOf(A, 'Top ' + RUN);
    const child = await folderOf(A, 'Child ' + RUN, top);
    const grand = await folderOf(A, 'Grandchild ' + RUN, child);

    await kase('CYCLE-01', 'PATCH top with parent_id = its grandchild is refused 400 in words', async () => {
      const r = await moveUnder(A, top, grand);
      expect(r.status === 400 && /inside a folder that is inside it/.test(String(r.b.detail || r.b.message || '')), r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    });
    await kase('CYCLE-02', 'PATCH top with parent_id = its child is refused 400', async () => {
      const r = await moveUnder(A, top, child);
      expect(r.status === 400, r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    });
    await kase('CYCLE-03', 'the tree is unchanged: top has no parent, child is under top, grandchild under child', async () => {
      const parents = [await parentOf(top), await parentOf(child), await parentOf(grand)];
      expect(parents[0] === null && parents[1] === top && parents[2] === child, JSON.stringify(parents));
    });
    await kase('CYCLE-04', 'an ordinary move still works: grandchild moves up under top (200)', async () => {
      const r = await moveUnder(A, grand, top);
      expect(r.status === 200 && (await parentOf(grand)) === top, r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    });
  } catch (e) {
    console.log('   FAIL threw: ' + (e && e.stack));
    process.exitCode = 1;
  } finally {
    await pg.end();
    finish('folder-cycle');
  }
})();
