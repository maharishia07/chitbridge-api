'use strict';
/**
 * tests/attachments-truth.realstack.cjs — ATTACHMENTS TRUTH, on the LOCAL stack (API-4 sweep of routes/attachments.js, T2: the real Postgres, the real RLS).
 *
 * The two doors of /api/attachments driven through the api's own routes on FRESH shops made for this run. Three cases, one per id the sweep looked at:
 *   AT-01  the id in the path of GET /:id     — the owner opens its own copy; an id nobody holds and another shop's real id answer the same 404, byte for byte (S35)
 *   AT-02  chit_id in the body of POST /      — a chit another shop holds and a chit nobody holds answer the same 403, and nothing is filed
 *   AT-03  message_id in the body of POST /   — cb_attachment has no foreign key and no policy lets one shop see another's message, so a made-up and a foreign message id answer alike
 * A case whose expected result is the PRINCIPLE (not today's code) carries `gap:` — a FAIL there is a RECORDED finding, never fixed inside this file. AT-01's foreign half needs row-level security to
 * apply to the api's connection: the local api runs as postgres, which bypasses it (RAIL-80, the same note as rail-truth RL-50a); where the api connects as cb_app (FORCE ROW LEVEL SECURITY, baseline) it holds.
 * The tier-1 twin is tests/api-problem-attachments.test.cjs (stand-in database; the fan-out, the internal-message rule and the download headers are proved there).
 *
 * Shares tests/lib/truth-harness.cjs (one harness). Run: node tests/attachments-truth.realstack.cjs   (one at a time on :3100; the S41 job picks every *-truth.realstack.cjs up). Written, not run on the laptop (no Docker).
 * ⚠️ Writes go through routes; the database is read with SELECT only.
 * CARD 01-rail-core-the-chit/attachments
 */
const { Client } = require('pg');
const crypto = require('crypto');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, pause, kase, expect, freshShop, finish } = H;
const RUN = 'at' + (Date.now() % 1e10).toString(36);
const MASK_REQUEST_ID = /"request_id":"[^"]*"/;
let pg = null;

/** an answer as it is compared: the status, the content type and the body without its request id */
async function asked(path, token, options) {
  const given = options || {};
  const got = await fetch(H.API + path, { method: given.method, body: given.body, headers: Object.assign({ authorization: 'Bearer ' + token }, given.headers || {}) });
  const bytes = Buffer.from(await got.arrayBuffer());
  return { status: got.status, type: String(got.headers.get('content-type') || ''), bytes, same: JSON.stringify({ status: got.status, type: got.headers.get('content-type'), body: bytes.toString('utf8').replace(MASK_REQUEST_ID, '"request_id":null') }) };
}
const upload = (shop, body) => asked('/api/attachments', shop.token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** a chit from A to B (the two participants); C stays outside it */
async function chitOfAandB(A, B) {
  const body = { recipients: [{ display_name: B.name, bridge_id: B.bridge, kind: 'to' }], purpose: 'general', subject: 'Attachments truth ' + RUN, manual_subject: 'Attachments truth ' + RUN, client_ref: RUN + '-at', line_items: [] };
  const sent = ok(await j('/api/chits/send', { method: 'POST', token: A.token, body }), 'chit A to B').b;
  await pause(1200);
  return sent.chit_id;
}

async function idCases(A, B, C, chit) {
  const bytes = Buffer.from('attachments truth bytes ' + RUN);
  const b64 = bytes.toString('base64');
  let held = null;
  await kase('AT-01', 'GET /:id — the owner opens its own copy; an id nobody holds and another shop\'s real id answer the same 404, byte for byte', async () => {
    const put = await upload(A, { chit_id: chit, name: 'truth.txt', mime: 'text/plain', data_base64: b64 });
    expect(put.status === 200, 'upload answered HTTP ' + put.status);
    held = JSON.parse(put.bytes.toString('utf8')).id;
    const own = await asked('/api/attachments/' + held, A.token);
    expect(own.status === 200 && own.bytes.equals(bytes), 'the owner\'s own copy: HTTP ' + own.status + ', ' + own.bytes.length + ' bytes back of ' + bytes.length);
    const unknown = await asked('/api/attachments/' + crypto.randomUUID(), C.token);
    expect(unknown.status === 404, 'an id nobody holds answered HTTP ' + unknown.status);
    const foreign = await asked('/api/attachments/' + held, C.token);
    expect(foreign.status === 404 && !foreign.bytes.equals(bytes), 'another shop\'s id answered HTTP ' + foreign.status + (foreign.bytes.equals(bytes) ? ' WITH THE BYTES' : ''));
    expect(foreign.same === unknown.same, 'another shop\'s id answered differently from an unknown one: ' + foreign.same.slice(0, 160) + ' vs ' + unknown.same.slice(0, 160));
    return 'own 200 · unknown 404 · foreign ' + foreign.status + ' (same body: ' + (foreign.same === unknown.same) + ')';
  }, 'getBlob relies on RLS alone and the local api runs as postgres, which bypasses it (RAIL-80); the query has no entity_id predicate of its own');
  await kase('AT-02', 'POST / chit_id — a chit another shop holds and a chit nobody holds answer the same 403, and nothing is filed', async () => {
    const send = (chit_id) => upload(C, { chit_id, name: 'probe.txt', mime: 'text/plain', data_base64: b64 });
    const foreign = await send(chit);
    const unknown = await send(crypto.randomUUID());
    expect(foreign.status === 403 && unknown.status === 403, 'foreign chit HTTP ' + foreign.status + ' · unknown chit HTTP ' + unknown.status);
    expect(foreign.same === unknown.same, 'the two 403s differ: ' + foreign.same.slice(0, 160) + ' vs ' + unknown.same.slice(0, 160));
    const rows = (await pg.query(`SELECT count(*)::int AS n FROM cb_attachment WHERE name = 'probe.txt' AND entity_id = $1`, [C.entity])).rows[0].n;
    expect(rows === 0, 'the outsider filed ' + rows + ' copies of probe.txt');
    return 'foreign 403 = unknown 403 · 0 rows';
  });
  await kase('AT-03', 'POST / message_id — no foreign key on cb_attachment, and a made-up message id is a 200 like any other (no existence oracle)', async () => {
    const fks = (await pg.query(`SELECT count(*)::int AS n FROM information_schema.table_constraints WHERE table_name = 'cb_attachment' AND constraint_type = 'FOREIGN KEY'`)).rows[0].n;
    expect(fks === 0, 'cb_attachment holds ' + fks + ' foreign keys; the sweep\'s reading of the baseline said none');
    const policies = (await pg.query(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'cb_attachment' AND policyname = 'rls_entity'`)).rows[0].n;
    expect(policies === 1, 'cb_attachment has ' + policies + ' rls_entity policies, expected 1');
    const one = await upload(A, { chit_id: chit, message_id: crypto.randomUUID(), name: 'msg-one.txt', mime: 'text/plain', data_base64: b64 });
    const two = await upload(A, { chit_id: chit, message_id: crypto.randomUUID(), name: 'msg-two.txt', mime: 'text/plain', data_base64: b64 });
    expect(one.status === 200 && two.status === 200, 'made-up message ids answered HTTP ' + one.status + ' and ' + two.status);
    const copies = (await pg.query(`SELECT entity_id FROM cb_attachment WHERE chit_id = $1 AND name = 'msg-one.txt'`, [chit])).rows.map((row) => row.entity_id);
    expect(copies.includes(A.entity) && copies.includes(B.entity) && !copies.includes(C.entity), 'a message the caller cannot see fans out to the whole roster (finding F2, listed): copies held by ' + JSON.stringify(copies));
    return 'no FK · rls_entity present · made-up message id = 200 · copies for the roster only';
  });
}

(async () => {
  console.log('\n── attachments truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Attach A'), B = await freshShop(RUN + 'b', 'Attach B'), C = await freshShop(RUN + 'c', 'Outsider C');
    console.log('  shops ' + A.bridge + ' · ' + B.bridge + ' · ' + C.bridge);
    await idCases(A, B, C, await chitOfAandB(A, B));
  } finally {
    await pg.end();
  }
  finish('attachments-truth', process.env.ATTACHMENTS_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('attachments truth could not run:', e && e.message); process.exit(2); });
