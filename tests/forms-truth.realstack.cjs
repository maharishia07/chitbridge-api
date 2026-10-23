'use strict';
/**
 * tests/forms-truth.realstack.cjs — AUTHORITY FORMS TRUTH, on the LOCAL stack (T2: real Postgres; API-STANDARD R2-10, API-4 stage-2 sweep of routes/forms.js).
 *
 * The three routes that name an issued form in the path (GET /instances/:id, POST /instances/:id/sign, POST /instances/:id/attach) are the id routes; issue is the write.
 * FM-01 issue freezes a form by value and the shop lists it · FM-02 another shop's form id answers exactly as an unknown id on all three id routes (404, never 403, never the row)
 * · FM-03 sign stamps once and refuses the second signature (409) · FM-04 an id that is not a uuid is READ, not judged: the real database raises on the cast, the answer is recorded
 * (a finding for the forms owner if it is a 500) · FM-05 a form named by a key the registry never held (including a name an object inherits) is recorded the same way.
 * Not here: attaching to a real chit (needs a sent chit and the object store), and the day a signature is stamped (it moves with the clock).
 * A `gap:` FAIL is a RECORDED finding, never fixed here. LOCAL ONLY; the database is only ever SELECTed. Needs DEV_OTP armed (lib/dev-otp.js).
 * Run: node tests/forms-truth.realstack.cjs   (one realstack file at a time on :3100; picked up by the S41 job in CI, not run on a laptop without Docker)
 * CARD 21-compliance-attestation-and-trade/functions/authority-forms
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'fm' + (Date.now() % 1e10).toString(36);
const NOBODY = '00000000-0000-4000-8000-000000000000';
const FULL = { applicant: 'Forms truth shop', address: '1 High Street', signatory: 'R Kumar', purpose: 'Trade licence renewal' };
let pg = null;

/** the issued forms of a shop, read-only */
async function held(shop) {
  const r = await pg.query('SELECT form_id, form_key, ready, signed_at FROM form_instance WHERE entity_id = $1 ORDER BY created_at', [shop.entity]);
  return r.rows;
}
const issue = (shop) => j('/api/forms/authority-application/issue', { method: 'POST', token: shop.token, body: { manual: FULL } });

async function cases(A, B) {
  let formId = null;
  await kase('FM-01', 'issue freezes a form by value, the shop lists it and opens it', async () => {
    const made = ok(await issue(A), 'issue').b;
    formId = made.form_id;
    expect(formId && made.ready === true && made.content_hash, 'answer ' + JSON.stringify(made));
    const rows = await held(A);
    expect(rows.length === 1 && rows[0].form_id === formId && rows[0].ready === true && rows[0].signed_at === null, 'row ' + JSON.stringify(rows));
    const listed = ok(await j('/api/forms/instances/all', { token: A.token }), 'list').b;
    expect((listed.instances || []).some((one) => one.form_id === formId), 'the list does not hold the form: ' + JSON.stringify(listed).slice(0, 200));
    const opened = ok(await j('/api/forms/instances/' + formId, { token: A.token }), 'open').b;
    expect(opened.form_id === formId && opened.entity_id === A.entity, 'opened ' + JSON.stringify(opened).slice(0, 200));
  });
  await kase('FM-02', "another shop's form id answers exactly as an unknown id: 404, the same body, on read, sign and attach", async () => {
    const ask = (shop, id) => [
      j('/api/forms/instances/' + id, { token: shop.token }),
      j('/api/forms/instances/' + id + '/sign', { method: 'POST', token: shop.token, body: { name: 'R Kumar' } }),
      j('/api/forms/instances/' + id + '/attach', { method: 'POST', token: shop.token, body: { chit_id: NOBODY } })
    ];
    const foreign = await Promise.all(ask(B, formId));
    const unknown = await Promise.all(ask(B, NOBODY));
    foreign.forEach((reply, index) => {
      expect(reply.status === 404 && unknown[index].status === 404, 'route ' + index + ' answered ' + reply.status + ' and ' + unknown[index].status + ', not 404');
      const same = (body) => JSON.stringify(Object.assign({}, body, { request_id: null }));
      expect(same(reply.b) === same(unknown[index].b), 'route ' + index + ' answered a different body for a foreign id: ' + JSON.stringify([reply.b, unknown[index].b]));
    });
    expect((await held(A))[0].signed_at === null, 'the foreign sign stamped the other shop\'s form');
  });
  await kase('FM-03', 'sign stamps once; the second signature is refused 409 and changes nothing', async () => {
    const first = ok(await j('/api/forms/instances/' + formId + '/sign', { method: 'POST', token: A.token, body: { name: 'R Kumar', designation: 'Partner' } }), 'sign').b;
    expect(first.form_id === formId && first.signed_at && first.signatory && first.signatory.name === 'R Kumar', 'answer ' + JSON.stringify(first));
    const again = await j('/api/forms/instances/' + formId + '/sign', { method: 'POST', token: A.token, body: { name: 'Someone else' } });
    expect(again.status === 409, 'the second signature answered ' + again.status + ' ' + JSON.stringify(again.b));
    const rows = await held(A);
    expect(rows[0].signed_at, 'the form is not signed');
    const stamped = await pg.query('SELECT signatory FROM form_instance WHERE form_id = $1', [formId]);
    expect(stamped.rows[0].signatory.name === 'R Kumar', 'the second signature replaced the first: ' + JSON.stringify(stamped.rows[0]));
  });
  await kase('FM-04', 'an id that is not a uuid is recorded: what the real database makes of it', async () => {
    const reply = await j('/api/forms/instances/nope', { token: A.token });
    expect([404, 422, 500].includes(reply.status), 'answered ' + reply.status + ' ' + JSON.stringify(reply.b));
    return 'GET /instances/nope answered ' + reply.status;
  });
  await kase('FM-05', 'a form key the registry never held (an inherited object name) is recorded', async () => {
    const reply = await j('/api/forms/constructor', { token: A.token });
    const resolved = await j('/api/forms/constructor/resolve', { method: 'POST', token: A.token, body: {} });
    expect(reply.status < 600 && resolved.status < 600, 'no answer');
    return 'GET /constructor answered ' + reply.status + ', POST /constructor/resolve answered ' + resolved.status;
  });
}

(async () => {
  console.log('\n── forms truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Forms truth');
    const B = await freshShop(RUN + 'b', 'Forms truth');
    await cases(A, B);
  } finally {
    await pg.end();
  }
  finish('forms truth', process.env.FORMS_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('forms truth could not run:', e && e.message); process.exit(2); });
