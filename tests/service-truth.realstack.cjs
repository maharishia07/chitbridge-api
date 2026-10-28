'use strict';
/**
 * tests/service-truth.realstack.cjs — SERVICE CLOCK TRUTH, on the LOCAL stack (API-4 sweep of routes/service.js; PM/API-SWEEP-TEST-PLAN-2026-10-23 §1 rows 10, 16 and the id routes of section 3).
 *
 * A service request has one clock the two parties both read. SV-01 the clock starts and its answer is the 15 b147 columns, no more · SV-02 the first response is the one that counts ·
 * SV-03 one open pause at a time, ended once · SV-04 a party cannot answer its own pause (the SQL function's rule, not the route's) · SV-05 another shop's chit answers exactly as an unknown one on all
 * seven routes (the 9th world, on real rows and real RLS) · SV-06 an unknown body key is refused by name · SV-07 a database fault says nothing of its cause.
 * Shares tests/lib/truth-harness.cjs. LOCAL ONLY. Run: node tests/service-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 02-tasks-orders-and-workflow/README
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, bill, freshShop, finish } = H;
const RUN = 'sv' + (Date.now() % 1e10).toString(36);
const UNKNOWN = '00000000-0000-4000-8000-0000000005e1';
const RECORD_KEYS = ['chit_id', 'entity_id', 'impact', 'urgency', 'priority', 'raised_at', 'responded_at', 'resolved_at', 'closed_at', 'resolution_code', 'resolution_note', 'closed_by_counterparty', 'policy', 'created_at', 'updated_at'];
const sameKeys = (found, wanted) => JSON.stringify(Object.keys(found)) === JSON.stringify(wanted);
let pg = null;

/** a request the shop holds: one counter bill to itself (the harness's own, known to send), whose chit id the clock is started on */
async function aRequest(shop) {
  const product = { id: null, name: 'Repair visit', unit: 'piece', price: 500 };
  const made = ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: { name: product.name, unit: product.unit, price: product.price } } }), 'product').b;
  product.id = made.item.item_id;
  return ok(await j('/api/chits/send', { method: 'POST', token: shop.token, body: bill(RUN + '-S', [[product, 1]]) }), 'send the request').b.chit_id;
}

/** the seven routes of the clock for one chit, as [method, path suffix, body] (the pause id is a fixed unknown: the chit decides first) */
const ROUTES = (chit) => [['GET', '', undefined], ['PUT', '', { impact: 'high', urgency: 'high' }], ['POST', '/respond', {}], ['POST', '/resolve', { resolution_code: 'fixed' }], ['POST', '/pause', { reason: 'waiting_on_counterparty' }],
  ['POST', '/pause/' + UNKNOWN + '/end', {}], ['POST', '/pause/' + UNKNOWN + '/answer', { accepted: true }]].map(([method, tail, body]) => ({ method, url: '/api/service/' + chit + tail, body }));
const seen = (reply) => JSON.stringify({ status: reply.status, body: Object.assign({}, reply.b, { request_id: null }) });

(async () => {
  console.log('\n── service clock truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Service truth');
    const B = await freshShop(RUN + 'b', 'Service truth');
    const chit = await aRequest(A);
    const at = (tail) => '/api/service/' + chit + (tail || '');
    await kase('SV-01', 'the clock starts, and its answers carry the 15 b147 columns and nothing else', async () => {
      const started = ok(await j(at(), { method: 'PUT', token: A.token, body: { impact: 'high', urgency: 'high' } }), 'start').b;
      expect(sameKeys(started.record, RECORD_KEYS) && started.record.priority === 'P1', 'record ' + JSON.stringify(Object.keys(started.record)));
      const read = ok(await j(at(), { token: A.token }), 'read').b;
      expect(read.tracked === true && sameKeys(read.record, RECORD_KEYS) && read.clock && read.readable, 'read ' + JSON.stringify(Object.keys(read)));
    });
    await kase('SV-02', 'the first response is the one that counts: a second tap does not move it', async () => {
      const first = ok(await j(at('/respond'), { method: 'POST', token: A.token, body: {} }), 'respond').b;
      const again = ok(await j(at('/respond'), { method: 'POST', token: A.token, body: {} }), 'respond again').b;
      expect(first.responded_at && first.responded_at === again.responded_at, first.responded_at + ' then ' + again.responded_at);
      const rows = (await pg.query(`SELECT count(*)::int AS n FROM chit_sla WHERE chit_id = $1 AND entity_id = $2`, [chit, A.entity])).rows[0].n;
      expect(rows === 1, 'chit_sla rows ' + rows);
    });
    let pauseId = null;
    await kase('SV-03', 'one open pause at a time; ending it once works, ending it twice says it is already ended', async () => {
      const paused = ok(await j(at('/pause'), { method: 'POST', token: A.token, body: { reason: 'waiting_on_counterparty', on_counterparty: true } }), 'pause').b;
      pauseId = paused.pause_id;
      const second = await j(at('/pause'), { method: 'POST', token: A.token, body: { reason: 'waiting_on_counterparty' } });
      expect(second.status === 409 && second.b.code === 'SERVICE_ALREADY_PAUSED', 'second pause ' + second.status + ' ' + JSON.stringify(second.b).slice(0, 160));
      ok(await j(at('/pause/' + pauseId + '/end'), { method: 'POST', token: A.token, body: {} }), 'end');
      const twice = await j(at('/pause/' + pauseId + '/end'), { method: 'POST', token: A.token, body: {} });
      expect(twice.status === 409 && twice.b.code === 'SERVICE_PAUSE_NOT_OPEN', 'end twice ' + twice.status + ' ' + JSON.stringify(twice.b).slice(0, 160));
    });
    await kase('SV-04', 'a party cannot accept or reject the pause it raised itself', async () => {
      const mine = await j(at('/pause/' + pauseId + '/answer'), { method: 'POST', token: A.token, body: { accepted: true } });
      expect(mine.status === 409 && mine.b.code === 'SERVICE_OWN_CLAIM', 'own claim ' + mine.status + ' ' + JSON.stringify(mine.b).slice(0, 160));
    });
    await kase('SV-05', 'another shop asks for this chit on all seven routes and is answered exactly as for a chit that does not exist', async () => {
      const wrong = [];
      for (const route of ROUTES(chit)) {
        const foreign = await j(route.url, { method: route.method, token: B.token, body: route.body });
        const unknown = await j(route.url.replace(chit, UNKNOWN), { method: route.method, token: B.token, body: route.body });
        if (foreign.status !== 404 || seen(foreign) !== seen(unknown)) wrong.push(route.method + ' ' + route.url.replace(chit, ':chit_id') + ' -> ' + foreign.status);
      }
      expect(!wrong.length, wrong.join('; '));
      const own = await j(at(), { token: A.token });
      expect(own.status === 200, 'the owner is still answered: ' + own.status);
    });
    await kase('SV-06', 'a body key nobody reads is refused by name, before anything is written', async () => {
      const refused = await j(at(), { method: 'PUT', token: A.token, body: { impact: 'low', zz_unknown_field: 'x' } });
      expect(refused.status === 400 && refused.b.error === 'Validation failed' && (refused.b.errors || []).some((one) => one.field === 'zz_unknown_field'), refused.status + ' ' + JSON.stringify(refused.b).slice(0, 200));
      const record = (await pg.query(`SELECT impact FROM chit_sla WHERE chit_id = $1 AND entity_id = $2`, [chit, A.entity])).rows[0];
      expect(record.impact === 'high', 'the refused key changed the record: ' + record.impact);
    });
    await kase('SV-07', 'a malformed chit id says nothing of the database (the real driver raises on a non-uuid)', async () => {
      const bad = await j('/api/service/nope', { token: A.token });
      expect(bad.status >= 400 && !/uuid|syntax|relation|SELECT/i.test(JSON.stringify(bad.b)), bad.status + ' ' + JSON.stringify(bad.b).slice(0, 200));
    });
  } finally { await pg.end(); }
  finish('service clock truth');
})().catch((failure) => { console.error(failure); process.exit(1); });
