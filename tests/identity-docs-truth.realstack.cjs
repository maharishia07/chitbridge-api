'use strict';
/**
 * tests/identity-docs-truth.realstack.cjs — IDENTITY DOCUMENTS TRUTH, on the LOCAL stack (T2: real Postgres; API-STANDARD R2-10, API-4 sweep of routes/identity-docs.js).
 *
 * ⚠️ PERSONAL DATA: every number below is an obviously made-up placeholder (zeros, AAAAA0000A); nothing real-looking is written to the database or printed.
 *
 * The four routes of /api/identity read the person from the token: `:scheme` is a scheme NAME (PHONE, PAN ...), never another person's id. Two kinds of case, one per write and per route
 * that reads a record by its scheme:
 *   PUT /documents/:scheme  a number is sealed (the database holds a mask, a hash and ciphertext, never the number); Aadhaar is never stored, only its last four digits.
 *   POST /documents/:scheme/code and /verify  another shop's record answers as no record (404, the same bytes); the own record is reached; a wrong code is counted.
 * ID-01 PHONE: the answer is the mask, the row holds the mask and ciphertext, not the number · ID-02 AADHAAR: no ciphertext at all, only XXXX XXXX 0000 · ID-03 foreign record: shop B
 * asks for a code and a verify on a scheme only shop A holds, and gets what an unknown scheme gets (404 IDOC_NOT_FOUND, the same body) · ID-04 an owner may not name another shop's person:
 * a 403 that is the same for a stranger and an unknown id · ID-05 a wrong code is counted and the pending code is never in the answer.
 * Not here: sending a real SMS or e-mail (no provider is connected on a laptop), and the verified stamp of a right code (the code is random unless DEV_OTP_IN_RESPONSE is on).
 * A `gap:` FAIL is a RECORDED finding, never fixed here. LOCAL ONLY; the database is only ever SELECTed. Needs DEV_OTP armed (lib/dev-otp.js) and VAULT_ENC_KEY set on the local api.
 * Run: node tests/identity-docs-truth.realstack.cjs   (one realstack file at a time on :3100; picked up by the S41 job in CI, not run on a laptop without Docker)
 * CARD 18-identity-sign-in-and-access/README
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'id' + (Date.now() % 1e10).toString(36);
const PHONE = '0000000000';
const AADHAAR = '000000000000';
const STRANGER_ID = '00000000-0000-4000-8000-000000000000';
let pg = null;

/** the row of a scheme for a shop, read-only: what the database holds, never the answer of a route */
async function held(shop, scheme) {
  const r = await pg.query('SELECT value_masked, value_hash, value_enc, status, verification_ref FROM identity_documents WHERE identity_id = $1 AND scheme = $2', [shop.entity, scheme]);
  return r.rows[0] || null;
}
const put = (shop, scheme, body) => j('/api/identity/documents/' + scheme, { method: 'PUT', token: shop.token, body });
const post = (shop, scheme, last, body) => j('/api/identity/documents/' + scheme + '/' + last, { method: 'POST', token: shop.token, body: body || {} });

async function cases(A, B) {
  let vaultOn = true;
  await kase('ID-01', 'a phone is sealed: the answer and the row hold the mask, never the number', async () => {
    const r = await put(A, 'PHONE', { value: PHONE });
    if (r.status === 503 && r.b.code === 'VAULT_ENC_UNCONFIGURED') { vaultOn = false; return 'skipped: no VAULT_ENC_KEY on this api'; }
    ok(r, 'put phone');
    expect(r.b.document && r.b.document.value_masked === '•••••0000' && !JSON.stringify(r.b).includes(PHONE), 'answer ' + JSON.stringify(r.b));
    const row = await held(A, 'PHONE');
    expect(row && row.value_masked === '•••••0000' && row.status === 'pending' && typeof row.value_enc === 'string' && !row.value_enc.includes(PHONE) && /^[0-9a-f]{64}$/.test(row.value_hash), 'row ' + JSON.stringify(row && Object.assign({}, row, { value_enc: typeof row.value_enc })));
    const list = ok(await j('/api/identity/documents', { token: A.token }), 'list').b;
    expect(list.documents.some((d) => d.scheme === 'PHONE' && d.verified === false) && !JSON.stringify(list).includes(PHONE) && !JSON.stringify(list).includes('verification_ref'), 'list ' + JSON.stringify(list).slice(0, 200));
  });
  await kase('ID-02', 'Aadhaar is never stored: only its last four digits', async () => {
    const r = ok(await put(A, 'AADHAAR', { value: AADHAAR }), 'put aadhaar');
    expect(r.b.document && r.b.document.value_masked === 'XXXX XXXX 0000' && !JSON.stringify(r.b).includes(AADHAAR), 'answer ' + JSON.stringify(r.b));
    const row = await held(A, 'AADHAAR');
    expect(row && row.value_masked === 'XXXX XXXX 0000' && row.value_enc === null, 'row ' + JSON.stringify(row && Object.assign({}, row, { value_hash: typeof row.value_hash })));
  });
  await kase('ID-03', "another shop's record answers as no record: a code and a verify both say 404, the same bytes as an unknown scheme", async () => {
    if (!vaultOn) return 'skipped: no VAULT_ENC_KEY on this api';
    for (const last of ['code', 'verify']) {
      const foreign = await post(B, 'PHONE', last, { code: '000000' });
      const unknown = await post(B, 'PASSPORT', last, { code: '000000' });
      expect(foreign.status === 404 && unknown.status === 404 && foreign.b.code === 'IDOC_NOT_FOUND' && unknown.b.code === 'IDOC_NOT_FOUND', last + ' answers ' + foreign.status + '/' + unknown.status + ' ' + JSON.stringify(foreign.b));
      expect(JSON.stringify(Object.assign({}, foreign.b, { request_id: null })) === JSON.stringify(Object.assign({}, unknown.b, { request_id: null })), last + ': the bodies differ');
    }
    const own = await post(A, 'PHONE', 'code');
    expect(own.status !== 404, 'the owner asking for a code on its own record answered 404: the case proved nothing');
  });
  await kase('ID-04', "an owner naming a person who is not its co-assist is refused with one 403, whoever that person is", async () => {
    const strangerShop = await put(A, 'PHONE', { value: PHONE, identity_id: B.entity });
    const unknown = await put(A, 'PHONE', { value: PHONE, identity_id: STRANGER_ID });
    expect(strangerShop.status === 403 && unknown.status === 403 && strangerShop.b.code === 'IDOC_SUBJECT_FORBIDDEN', 'answers ' + strangerShop.status + '/' + unknown.status);
    expect(JSON.stringify(Object.assign({}, strangerShop.b, { request_id: null })) === JSON.stringify(Object.assign({}, unknown.b, { request_id: null })), 'a shop and an unknown id are told apart');
    expect((await held(B, 'PHONE')) === null, "a document was written against another shop's identity");
  });
  await kase('ID-05', 'a wrong code is counted, and the pending code is never in an answer', async () => {
    if (!vaultOn) return 'skipped: no VAULT_ENC_KEY on this api';
    const asked = ok(await post(A, 'PHONE', 'code'), 'code');
    expect(['sent', 'not_sent'].includes(asked.b.delivery) && asked.b.sent_to === '*****0000', 'answer ' + JSON.stringify(asked.b));
    const wrong = await post(A, 'PHONE', 'verify', { code: '000000' });
    expect(wrong.status === 400 && wrong.b.code === 'OTP_WRONG' && /4 attempts left/.test(wrong.b.message), 'wrong code ' + JSON.stringify(wrong.b));
    const row = await held(A, 'PHONE');
    expect(row && /^otp:[0-9a-f]{64}:\d+:1$/.test(row.verification_ref), 'what is kept is not otp:<hash>:<expiry>:1');
  });
}

(async () => {
  console.log('\n── identity documents truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Identity truth');
    const B = await freshShop(RUN + 'b', 'Identity truth');
    await cases(A, B);
  } finally {
    await pg.end();
  }
  finish('identity docs truth', process.env.IDDOCS_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('identity docs truth could not run:', e && e.message); process.exit(2); });
