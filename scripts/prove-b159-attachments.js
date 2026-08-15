#!/usr/bin/env node
/**
 * prove-b159-attachments.js — b159 added `object_key`; prove attachments still work.
 *
 * ⚠️ THIS IS THE CHECK THAT MATTERS AFTER b159, and it is not obvious why.
 *
 * The migration is additive and nullable, so it looks like it cannot break anything. But `lib/storage.js` now
 * BRANCHES on whether the column exists (`hasObjectKey()`), and the branch changes the SELECT in `getBlob`:
 *
 *     SELECT name, mime, size, data, chit_id, message_id, entity_id[, object_key] FROM cb_attachment …
 *
 * Before b159 that read one shape; after b159 it reads another. A mistake there does not fail loudly — it fails
 * as "attachments stopped opening", which is the single worst silent failure this table can have, because the
 * whole point of an attachment is being the evidence somebody relies on later.
 *
 * So: upload a real file through the real route, read it back, and compare BYTES — not "did it 200".
 *
 * Run: node scripts/prove-b159-attachments.js
 */
'use strict';
const P = require('./_proof');
const crypto = require('crypto');

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (got === undefined ? '' : '  → ' + JSON.stringify(got))); }
};

async function login(email, name) {
  const r = await P.j('/api/entities/register', { method: 'POST', body: { email, display_name: name } });
  const v = await P.j('/api/entities/verify', { method: 'POST', body: { email, otp: (r.b && r.b.dev_otp) || '123456' } });
  return { token: v.b.token, entity: v.b.entity };
}

(async () => {
  console.log('\nb159 · attachments still round-trip with object_key present\n');

  const me = await login('mytest@email.com', 'mytest');

  /* A chit to hang it on. Self-chit: one party, so this proves the plain path without dragging in fan-out. */
  const chit = await P.j('/api/chits/send', {
    method: 'POST', ...me,
    body: {
      manual_subject: 'b159 attachment proof ' + Date.now(),
      recipients: [{ name: 'mytest', role: 'to' }],
      line_items: [{ particulars: 'proof line', quantity: 1, unit: 'unit', price: 1 }]
    }
  });
  ok('a chit to attach to', chit.status === 200 || chit.status === 201, chit.status);
  const chit_id = chit.b && (chit.b.chit_id || (chit.b.chit && chit.b.chit.chit_id));
  if (!chit_id) { console.log('\n  cannot continue without a chit_id — ' + JSON.stringify(chit.b).slice(0, 200)); process.exit(1); }

  /* Deterministic bytes, so "identical" is provable rather than plausible. */
  const bytes = Buffer.from('b159 proof · ' + 'x'.repeat(500) + ' · end');
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');

  const up = await P.j('/api/attachments', {
    method: 'POST', ...me,
    body: { chit_id, name: 'b159-proof.txt', mime: 'text/plain', data_base64: bytes.toString('base64') }
  });
  ok('upload accepted', up.status === 200 || up.status === 201, { status: up.status, body: JSON.stringify(up.b).slice(0, 160) });
  const attId = up.b && (up.b.id || up.b.attachment_id);
  ok('an attachment id came back', !!attId, up.b);

  if (attId) {
    /* ⭐ THE ACTUAL PROOF — read the bytes back through the same route the app uses, and hash them. */
    const got = await P.raw ? await P.raw('/api/attachments/' + attId, me) : null;
    if (got && got.buffer) {
      const back = crypto.createHash('sha256').update(got.buffer).digest('hex');
      ok('⭐ the bytes come back BYTE-IDENTICAL after b159', back === sha, { sent: sha.slice(0, 16), got: back.slice(0, 16) });
      ok('…and the length matches', got.buffer.length === bytes.length, { sent: bytes.length, got: got.buffer.length });
    } else {
      /* _proof has no binary helper — fall back to a plain fetch with the same auth. */
      const base = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';
      const r = await fetch(base + '/api/attachments/' + attId, { headers: { Authorization: 'Bearer ' + me.token } });
      ok('read returns 200', r.ok, r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      const back = crypto.createHash('sha256').update(buf).digest('hex');
      ok('⭐ the bytes come back BYTE-IDENTICAL after b159', back === sha, { sent: sha.slice(0, 16), got: back.slice(0, 16), len: buf.length });
    }

    /**
     * The listing path also selects from this table (storage.listForChit), so it gets its own assertion.
     * ⚠️ The field is `attachments` — routes/chits.js:1422. My first version of this test looked for `atts`,
     * which is the CLIENT-side name in app.html, and reported 0 as though the listing were broken. Naming a
     * response field by what the UI calls it is how a test invents a bug.
     */
    const det = await P.j('/api/chits/' + chit_id, me);
    const atts = (det.b && det.b.attachments) || [];
    ok('the attachment is listed on the chit', atts.some((a) => a.id === attId),
       { count: atts.length, ids: atts.map((a) => a.id).slice(0, 3) });
  }

  console.log('\n⚠️  STORAGE_ADAPTER is still `db` — these bytes are in the ROW, not a bucket.');
  console.log('    That is the point: b159 must change NOTHING until a bucket and env exist.\n');
  console.log('== RESULT ==  PASS ' + pass + '  ·  FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nthrew: ' + e.message); process.exit(1); });
