'use strict';
/**
 * tests/definitions-truth.realstack.cjs — DEFINITIONS TRUTH, on the LOCAL stack (API-4 sweep of routes/definitions.js, 2026-10-23; the T2 line of tests/api-problem-definitions.test.cjs).
 *
 * The offline test proves the handlers over a stand-in database that hides a row from another shop the way row-level security does. This file asks the REAL database: the one case per id route
 * (GET · PUT · DELETE /api/definitions/:id answer another shop's id exactly as an unknown id) and the frozen-by-value rules a stand-in cannot prove (an edit of the rules is a new version and
 * the old one stays; a retired definition still freezes; a repeated retire is one log row). A `gap:` FAIL is a RECORDED finding, never a quiet fix inside the test.
 * Shares tests/lib/truth-harness.cjs. LOCAL ONLY. Run: node tests/definitions-truth.realstack.cjs   (one realstack file at a time on :3100). CI step pending: not run by the sweep.
 * CARD 07-catalogue-and-pricing/definitions
 */
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'df' + (Date.now() % 1e10).toString(36);
const UNKNOWN_ID = '00000000-0000-4000-8000-0000000000aa';
const STAMP_FIELDS = ['request_id'];
/** an answer without the parts that differ on every request */
const sameAnswer = (left, right) => left.status === right.status && JSON.stringify(strip(left.b)) === JSON.stringify(strip(right.b));
const strip = (body) => Object.fromEntries(Object.entries(body || {}).filter(([key]) => !STAMP_FIELDS.includes(key)));

(async () => {
  console.log('\n── definitions truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const A = await freshShop(RUN + 'a', 'Definitions truth');
  const B = await freshShop(RUN + 'b', 'Definitions truth');
  const make = (more) => j('/api/definitions', { method: 'POST', token: A.token, body: Object.assign({ kind: 'pricing', name: 'Carton ' + Date.now() + Math.random(), rules: { qty: 6 } }, more) });
  const mine = ok(await make(), 'create').b.definition;
  const id = mine.definition_id;

  await kase('DF-01', 'GET /:id by the owner answers the definition with its version history', async () => {
    const r = ok(await j('/api/definitions/' + id, { token: A.token }), 'read').b;
    expect(r.definition.definition_id === id && r.versions.length === 1 && r.versions[0].version === 1, JSON.stringify(r).slice(0, 200));
  });
  await kase('DF-02', 'GET /:id: another shop\'s id answers exactly as an unknown id (404, same body)', async () => {
    const foreign = await j('/api/definitions/' + id, { token: B.token });
    const unknown = await j('/api/definitions/' + UNKNOWN_ID, { token: B.token });
    expect(foreign.status === 404 && sameAnswer(foreign, unknown), 'foreign ' + foreign.status + ' ' + JSON.stringify(foreign.b).slice(0, 120) + ' · unknown ' + unknown.status);
  });
  await kase('DF-03', 'PUT /:id: another shop\'s id answers as an unknown id, and nothing of the owner\'s changed', async () => {
    const foreign = await j('/api/definitions/' + id, { method: 'PUT', token: B.token, body: { name: 'Taken over', rules: { qty: 99 } } });
    const unknown = await j('/api/definitions/' + UNKNOWN_ID, { method: 'PUT', token: B.token, body: { name: 'Taken over', rules: { qty: 99 } } });
    const after = ok(await j('/api/definitions/' + id, { token: A.token }), 'read').b;
    expect(foreign.status === 404 && sameAnswer(foreign, unknown) && after.definition.name === mine.name && after.versions.length === 1, 'foreign ' + foreign.status + ' · versions ' + after.versions.length);
  });
  await kase('DF-04', 'DELETE /:id: another shop\'s id answers as an unknown id, and the definition is still live for its owner', async () => {
    const foreign = await j('/api/definitions/' + id, { method: 'DELETE', token: B.token });
    const unknown = await j('/api/definitions/' + UNKNOWN_ID, { method: 'DELETE', token: B.token });
    const after = ok(await j('/api/definitions/' + id, { token: A.token }), 'read').b;
    expect(foreign.status === 404 && sameAnswer(foreign, unknown) && after.definition.status !== 'retired', 'foreign ' + foreign.status + ' · status ' + after.definition.status);
  });
  await kase('DF-05', 'an edit of the rules is a NEW version and the old one stays; a rename mints none', async () => {
    const renamed = ok(await j('/api/definitions/' + id, { method: 'PUT', token: A.token, body: { name: mine.name + ' (box)' } }), 'rename').b;
    const edited = ok(await j('/api/definitions/' + id, { method: 'PUT', token: A.token, body: { rules: { qty: 12 } } }), 'edit').b;
    const history = ok(await j('/api/definitions/' + id, { token: A.token }), 'read').b.versions;
    expect(renamed.new_version === false && edited.new_version === true && edited.version === 2 && history.length === 2 && history.find((v) => v.version === 1).rules.qty === 6, JSON.stringify(history).slice(0, 200));
  });
  await kase('DF-06', 'POST /freeze: the snapshot carries the copy and the pointer; another shop\'s id is "missing", not a leak', async () => {
    const own = ok(await j('/api/definitions/freeze', { method: 'POST', token: A.token, body: { definition_ids: [id] } }), 'freeze').b;
    const foreign = ok(await j('/api/definitions/freeze', { method: 'POST', token: B.token, body: { definition_ids: [id] } }), 'freeze').b;
    expect(own.frozen.length === 1 && own.frozen[0].version === 2 && own.frozen[0].rules.qty === 12 && foreign.frozen.length === 0 && foreign.missing[0] === id, JSON.stringify({ own, foreign }).slice(0, 240));
  });
  await kase('DF-07', 'DELETE retires and does not delete: it still freezes, and a second retire writes no second log row', async () => {
    const first = ok(await j('/api/definitions/' + id, { method: 'DELETE', token: A.token }), 'retire').b;
    const second = ok(await j('/api/definitions/' + id, { method: 'DELETE', token: A.token }), 'retire again').b;
    const read = ok(await j('/api/definitions/' + id, { token: A.token }), 'read').b;
    const frozen = ok(await j('/api/definitions/freeze', { method: 'POST', token: A.token, body: { definition_ids: [id] } }), 'freeze').b;
    expect(first.retired && second.retired && read.definition.status === 'retired' && read.status_log.filter((row) => row.status === 'retired').length === 1 && frozen.frozen.length === 1, JSON.stringify(read.status_log));
  });
  await kase('DF-08', 'POST /: the same name twice in a kind is 409 in the shop\'s words, and the first stays', async () => {
    const name = 'Twice ' + RUN;
    ok(await make({ name }), 'first');
    const again = await make({ name });
    expect(again.status === 409 && again.b.error === 'Name taken', 'HTTP ' + again.status + ' ' + JSON.stringify(again.b).slice(0, 160));
  });
  await kase('DF-09', 'an id that is not a uuid is a 400/404 in words, not a fault', async () => {
    const r = await j('/api/definitions/not-an-id', { token: A.token });
    expect(r.status === 400 || r.status === 404, 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 120));
  }, 'API-4c (cb-catalogue): the database cast refuses the id and the route answers 500 Failed');
  finish('definitions-truth', process.env.DEFINITIONS_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('definitions truth could not run:', e && e.message); process.exit(2); });
