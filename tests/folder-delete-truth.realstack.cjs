'use strict';
/**
 * tests/folder-delete-truth.realstack.cjs — DELETING A FOLDER UNFILES EVERY CHIT IN ITS WHOLE SUBTREE, on the REAL stack (RAIL-137 b).
 *
 * OWNS      the T2 proof that DELETE /api/folders/:id leaves no chit_status row pointing at a folder that no longer exists: the foreign key
 *           folder.parent_id ON DELETE CASCADE removes every descendant, and chit_status.folder_id has no key, so only the route can unfile them.
 *           A stand-in db cannot show this (the cascade and the recursive walk are Postgres's), so the database is READ afterwards.
 * CALLED BY the S41 job of .github/workflows/ci.yml (every tests/*-truth.realstack.cjs, one file at a time); locally: node tests/folder-delete-truth.realstack.cjs on :3100.
 * FLOW      a fresh shop → folders top > child > grandchild, a chit filed in each → DELETE top → the three folders are gone and no copy of the
 *           shop points at a folder that does not exist; the chits are unfiled, not lost
 * CARD      docs/01-rail-core-the-chit/functions/user-folders-and-auto-file-rules.md
 *
 * FOLD-01 a grandchild's chit is unfiled with the rest · FOLD-02 nothing points at a missing folder · FOLD-03 the chits still exist.
 * NOT RUN where this was written (no local stack): the S41 job is its first run.
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, freshShop, finish, receipt } = H;
const RUN = 'fd' + (Date.now() % 1e10).toString(36);
let pg = null;

const rowsOf = async (sql, args) => (await pg.query(sql, args)).rows;
const folderOf = async (shop, name, parent) => ok(await j('/api/folders', { method: 'POST', token: shop.token, body: parent ? { name, parent_id: parent } : { name } }), 'folder ' + name).b.folder.folder_id;
const chitIdOf = (sent) => sent.chit_id || (sent.chit && sent.chit.chit_id);
const BOLT = { name: 'Bolt', unit: 'pc' };
async function filedChit(shop, no, folder) {
  const chit = chitIdOf(ok(await j('/api/chits/send', { method: 'POST', token: shop.token, body: receipt(no, [[BOLT, 1, 10]]) }), 'chit ' + no).b);
  ok(await j('/api/folders/move', { method: 'POST', token: shop.token, body: { chit_id: chit, folder_id: folder } }), 'file ' + no);
  return chit;
}

(async () => {
  console.log('\n── folder delete truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Folders A');
    const top = await folderOf(A, 'Top ' + RUN);
    const child = await folderOf(A, 'Child ' + RUN, top);
    const grand = await folderOf(A, 'Grandchild ' + RUN, child);
    const chits = [await filedChit(A, RUN + '-1', top), await filedChit(A, RUN + '-2', child), await filedChit(A, RUN + '-3', grand)];
    const filedBefore = (await rowsOf('SELECT count(*)::int AS n FROM chit_status WHERE entity_id = $1 AND folder_id = ANY($2::uuid[])', [A.entity, [top, child, grand]]))[0].n;
    const gone = await j('/api/folders/' + top, { method: 'DELETE', token: A.token });

    await kase('FOLD-01', 'DELETE a folder with a grandchild: the three folders are gone, and the chit filed in the grandchild is unfiled with the rest', async () => {
      const left = (await rowsOf('SELECT count(*)::int AS n FROM folder WHERE folder_id = ANY($1::uuid[])', [[top, child, grand]]))[0].n;
      const stillFiled = (await rowsOf('SELECT count(*)::int AS n FROM chit_status WHERE entity_id = $1 AND folder_id = ANY($2::uuid[])', [A.entity, [top, child, grand]]))[0].n;
      expect(gone.status === 200 && filedBefore >= 3 && left === 0 && stillFiled === 0, 'answer ' + gone.status + ' · filed before ' + filedBefore + ' · folders left ' + left + ' · copies still filed in them ' + stillFiled);
    });
    await kase('FOLD-02', 'no copy of the shop points at a folder that does not exist', async () => {
      const orphans = (await rowsOf('SELECT count(*)::int AS n FROM chit_status cs WHERE cs.entity_id = $1 AND cs.folder_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folder f WHERE f.folder_id = cs.folder_id)', [A.entity]))[0].n;
      expect(orphans === 0, 'copies filed in a missing folder: ' + orphans);
    });
    await kase('FOLD-03', 'the chits are unfiled, not lost: every one is still held by the shop', async () => {
      const held = (await rowsOf('SELECT count(DISTINCT chit_id)::int AS n FROM chit_status WHERE entity_id = $1 AND chit_id = ANY($2::uuid[])', [A.entity, chits]))[0].n;
      expect(held === 3, 'chits still held: ' + held + ' of 3');
    });
  } catch (e) {
    console.log('   FAIL threw: ' + (e && e.stack));
    process.exitCode = 1;
  } finally {
    await pg.end();
    finish('folder-delete');
  }
})();
