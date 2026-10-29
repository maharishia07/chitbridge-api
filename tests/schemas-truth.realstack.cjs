'use strict';
/**
 * tests/schemas-truth.realstack.cjs — SCHEMA ENGINE TRUTH, on the LOCAL stack (API-4 sweep of routes/schemas.js, 2026-10-23; the T2 line of tests/api-problem-schemas.test.cjs).
 *
 * The offline test proves the handlers over a stand-in database that hides a row from another shop the way the WHERE on the entity does. This file asks the REAL database: the one case per
 * column-key route (PATCH and DELETE /api/schemas/fields/:field_key answer another shop's column key exactly as an unknown one) and the rules a stand-in cannot prove (a column a product
 * records cannot be removed or retyped and says how many; a label is always free; the definition is made once; visibility is stored). A `gap:` FAIL is a RECORDED finding, never a quiet fix.
 * Shares tests/lib/truth-harness.cjs. LOCAL ONLY. Run: node tests/schemas-truth.realstack.cjs   (one realstack file at a time on :3100). CI step pending: not run by the sweep.
 * CARD 07-catalogue-and-pricing/catalogue-setup
 */
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'sc' + (Date.now() % 1e10).toString(36);
const UNKNOWN_KEY = 'zz_no_such_column';
const STAMP_FIELDS = ['request_id'];
const strip = (body) => Object.fromEntries(Object.entries(body || {}).filter(([key]) => !STAMP_FIELDS.includes(key)));
/** an answer without the parts that differ on every request */
const sameAnswer = (left, right) => left.status === right.status && JSON.stringify(strip(left.b)) === JSON.stringify(strip(right.b));
const columns = async (shop) => ok(await j('/api/schemas/fields', { token: shop.token }), 'columns').b.fields;

(async () => {
  console.log('\n── schemas truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const A = await freshShop(RUN + 'a', 'Schemas truth');
  const B = await freshShop(RUN + 'b', 'Schemas truth');
  ok(await j('/api/schemas/create-default', { method: 'POST', token: A.token }), 'definition A');
  ok(await j('/api/schemas/create-default', { method: 'POST', token: B.token }), 'definition B');
  /* a product that records a value in a new key declares that column for its shop alone */
  ok(await j('/api/products', { method: 'POST', token: A.token, body: { item_data: { name: 'Truth item ' + RUN, unit: 'piece', price: 10, grade: 'A' } } }), 'a product that records grade');

  await kase('SC-01', 'GET /fields: the column a product recorded is declared, and the count of products that use it is real', async () => {
    const grade = (await columns(A)).find((one) => one.field_key === 'grade');
    expect(grade && grade.used_by === 1 && grade.removable === false, JSON.stringify(grade));
  });
  await kase('SC-02', 'PATCH /fields/:field_key: another shop\'s column key answers exactly as an unknown one (404, same body), and nothing of the owner\'s changed', async () => {
    const foreign = await j('/api/schemas/fields/grade', { method: 'PATCH', token: B.token, body: { field_name: 'Taken over' } });
    const unknown = await j('/api/schemas/fields/' + UNKNOWN_KEY, { method: 'PATCH', token: B.token, body: { field_name: 'Taken over' } });
    const after = (await columns(A)).find((one) => one.field_key === 'grade');
    expect(foreign.status === 404 && sameAnswer(foreign, unknown) && after.field_name !== 'Taken over', 'foreign ' + foreign.status + ' ' + JSON.stringify(foreign.b).slice(0, 120) + ' · unknown ' + unknown.status + ' · label ' + after.field_name);
  });
  await kase('SC-03', 'DELETE /fields/:field_key: another shop\'s column key answers as an unknown one, and the column is still there for its owner', async () => {
    const foreign = await j('/api/schemas/fields/grade', { method: 'DELETE', token: B.token });
    const unknown = await j('/api/schemas/fields/' + UNKNOWN_KEY, { method: 'DELETE', token: B.token });
    const after = (await columns(A)).find((one) => one.field_key === 'grade');
    expect(foreign.status === 404 && sameAnswer(foreign, unknown) && !!after, 'foreign ' + foreign.status + ' · unknown ' + unknown.status + ' · still there ' + !!after);
  });
  await kase('SC-04', 'DELETE of a column a product records is refused with the real count; one of the three every catalogue keeps is refused first', async () => {
    const used = await j('/api/schemas/fields/grade', { method: 'DELETE', token: A.token });
    const locked = await j('/api/schemas/fields/name', { method: 'DELETE', token: A.token });
    expect(used.status === 409 && used.b.code === 'IN_USE' && used.b.used_by === 1 && locked.status === 409 && locked.b.code === 'LOCKED', JSON.stringify({ used: used.b, locked: locked.b }).slice(0, 240));
  });
  await kase('SC-05', 'PATCH: a label is always free; a type change is refused while a product records a value, with the count', async () => {
    const renamed = ok(await j('/api/schemas/fields/grade', { method: 'PATCH', token: A.token, body: { field_name: 'Quality ' + RUN } }), 'rename').b;
    const retyped = await j('/api/schemas/fields/grade', { method: 'PATCH', token: A.token, body: { field_type: 'number' } });
    expect(/Quality/.test(renamed.message) && retyped.status === 409 && retyped.b.code === 'IN_USE' && retyped.b.used_by === 1, JSON.stringify({ renamed, retyped: retyped.b }).slice(0, 240));
  });
  await kase('SC-06', 'a key the handler never read is refused by name, and the web\'s own keys are accepted (the Q18 closing, on the real route)', async () => {
    const extra = await j('/api/schemas/fields/grade', { method: 'PATCH', token: A.token, body: { field_name: 'Quality ' + RUN, zz_unknown: 1 } });
    const known = await j('/api/schemas/fields/grade', { method: 'PATCH', token: A.token, body: { field_name: 'Quality ' + RUN, required: false } });
    expect(extra.status === 400 && (extra.b.errors || []).some((one) => one.field === 'zz_unknown') && known.status === 200, JSON.stringify({ extra: extra.b, known: known.status }).slice(0, 240));
  });
  await kase('SC-07', 'PATCH /visibility is stored and read back by GET /my; a value outside the three is refused in the old words', async () => {
    ok(await j('/api/schemas/visibility', { method: 'PATCH', token: A.token, body: { visibility: 'restricted' } }), 'set');
    const mine = ok(await j('/api/schemas/my', { token: A.token }), 'my').b.schema;
    const bad = await j('/api/schemas/visibility', { method: 'PATCH', token: A.token, body: { visibility: 'secret' } });
    expect(mine && mine.visibility === 'restricted' && bad.status === 400 && bad.b.error === 'Validation failed', JSON.stringify({ visibility: mine && mine.visibility, bad: bad.b }).slice(0, 200));
  });
  await kase('SC-08', 'POST /create-default makes the definition once: a second call answers the one it has, and a body key is refused', async () => {
    const again = ok(await j('/api/schemas/create-default', { method: 'POST', token: A.token }), 'again').b;
    const extra = await j('/api/schemas/create-default', { method: 'POST', token: A.token, body: { zz_unknown: 1 } });
    expect(again.message === 'Schema already exists' && extra.status === 422, JSON.stringify({ again: again.message, extra: extra.status }));
  });
  finish('schemas-truth', process.env.SCHEMAS_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('schemas truth could not run:', e && e.message); process.exit(2); });
