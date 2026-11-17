'use strict';
/**
 * tests/d3-dispute-route-backfill.realstack.cjs — D3 T5: migrations/b884_dispute_handler_to_routing.sql run TWICE on a throwaway database: one routing row per shop with a handler,
 * none for a shop without, other kinds untouched, the second run adds 0. The file binds app.current_entity per shop (entity_work_routing is FORCE RLS).
 * Needs the database the api runs on (the truth harness's TRUTH_DB, an owner connection); makes its own two shops, removes the routing rows it made. LOCAL / throwaway box only.
 * Run: node tests/d3-dispute-route-backfill.realstack.cjs
 */
const fs = require('fs'), path = require('path');
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { ok, kase, expect, freshShop, finish, j } = H;
const RUN = 'd3b' + (Date.now() % 1e8).toString(36).padStart(5, '0');
const SQL = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'b884_dispute_handler_to_routing.sql'), 'utf8');

(async () => {
  const pg = new Client({ connectionString: H.DB });
  await pg.connect();
  const A = await freshShop('a' + RUN, 'Backfill'), B = await freshShop('b' + RUN, 'Backfill');
  const key = ('q' + RUN).slice(0, 12);
  const actor = ok(await j('/api/actors', { method: 'POST', token: A.token, body: { display_name: 'Handler ' + RUN, actor_key: key, email: key + '@local.test', access_level: 'editor', hat: 'act' } }), 'add').b.actor;
  const who = actor.identity_id || actor.actor_id;
  /* the legacy state: a column set, no routing row (a shop before b884); plus an unrelated kind on A that must stay */
  await pg.query('UPDATE identities SET dispute_handler_actor_id = $2 WHERE identity_id = $1', [A.entity, who]);
  await pg.query(`DELETE FROM entity_work_routing WHERE entity_id = ANY($1) AND kind = 'dispute'`, [[A.entity, B.entity]]);
  await pg.query(`INSERT INTO entity_work_routing (entity_id, kind, assignee_actor_id) VALUES ($1,'incident',$2) ON CONFLICT DO NOTHING`, [A.entity, who]);
  const mine = async () => (await pg.query(`SELECT entity_id, kind, assignee_actor_id FROM entity_work_routing WHERE entity_id = ANY($1) ORDER BY entity_id, kind`, [[A.entity, B.entity]])).rows;

  await kase('T5-1', 'the file run once: shop A gets one dispute row for its handler, shop B (no handler) none, the incident row is untouched', async () => {
    await pg.query(SQL);
    const r = await mine();
    const d = r.filter((x) => x.kind === 'dispute'), i = r.filter((x) => x.kind === 'incident');
    expect(d.length === 1 && d[0].entity_id === A.entity && d[0].assignee_actor_id === who && i.length === 1 && i[0].assignee_actor_id === who, JSON.stringify(r));
  });
  await kase('T5-2', 'run again: still one row per shop (idempotent), nothing else moved', async () => {
    const before = JSON.stringify(await mine());
    await pg.query(SQL);
    expect(JSON.stringify(await mine()) === before, 'rows changed on the second run');
  });
  await pg.query(`DELETE FROM entity_work_routing WHERE entity_id = ANY($1)`, [[A.entity, B.entity]]);
  await pg.end();
  finish('d3-dispute-route-backfill');
})().catch((e) => { console.error(e); process.exit(1); });
