#!/usr/bin/env node
'use strict';
/**
 * prove-nothing-dropped.js — every fact the sender gives ends up SOMEWHERE on the chit.
 *
 * Athi, 2026-08-10: *"all the data captured is not coming as chit, it has to capture unit name, unit size and unit
 * price separately, similarly any other adjective etc should be captured as a comment for the same line item"* and
 * *"need to see each data the user provides, which data item in the js schema it can fit in, if not keep it as a
 * note or a comment."*
 *
 * ⚠️ THE FAILURE THIS GUARDS AGAINST IS INVISIBLE. A chit reading "Briyani × 4" is not obviously wrong — it is
 * only wrong if you know the customer also said extra leg piece, extra spicy, schezwan, and 7pm. The chit looks
 * perfectly correct while the kitchen cooks the wrong food and it arrives at the wrong time. So the assertion is
 * not "did it produce a chit" but "is every stated fact still findable".
 *
 * ⚠️ IT COSTS A REAL AI CALL (a few tenths of a cent) — it is reading an actual message with an actual model,
 * because a mock would only prove that my own parser agrees with itself.
 *
 * RUN:  node scripts/prove-nothing-dropped.js
 */
const crypto = require('crypto');
const { j, signIn, run } = require('./_proof');

const SECRET = process.env.WHATSAPP_APP_SECRET;
const ADMIN = process.env.CB_ADMIN_KEY;
const LINE = '+919000004444', CUST = '+919000005555';

/* Athi's own example, kept verbatim — a real customer message, messy, with the qualifiers that matter. */
const MESSAGE = 'Briyani 4 with extra 4 leg piece, extra spicy, schezwan, and 2 crate thakkali 20kg each at 340, '
              + 'deliver at 7.00 PM at my house, 12 Ramnagar main road, call before coming';

run('prove-nothing-dropped', async (t) => {
  console.log('\n  nothing the sender said may be dropped\n');
  if (!SECRET || !ADMIN) { t.note('needs WHATSAPP_APP_SECRET / CB_ADMIN_KEY'); return; }

  const unsigned = await j('/api/capture/webhook/whatsapp', { method: 'POST', body: '{}', headers: { 'X-Hub-Signature-256': 'sha256=deadbeef' } });
  if (unsigned.status !== 401) { t.ok(false, 'ABORT — server not enforcing signatures'); return; }

  const tok = await signIn('beta@test-cb.com', 'Beta Fresh');
  const list = await j('/api/channels', { token: tok });
  const wa = (list.b.channels || []).find((c) => c.key === 'whatsapp') || { bindings: [] };
  let bind = (wa.bindings || []).find((b) => b.address === LINE);
  if (!bind) { const made = await j('/api/channels', { method: 'POST', token: tok, body: { channel: 'whatsapp', address: LINE, label: 'drop proof' } }); bind = made.b; }
  if (bind && bind.status !== 'verified') await j('/api/channels/' + bind.id + '/approve', { method: 'POST', headers: { 'x-cb-admin-key': ADMIN }, body: {} });

  const tag = 'DROP' + String(process.pid).slice(-4);
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
    metadata: { display_phone_number: LINE, phone_number_id: '000' },
    contacts: [{ wa_id: CUST.replace(/^\+/, ''), profile: { name: 'Hungry customer' } }],
    messages: [{ from: CUST.replace(/^\+/, ''), id: 'wamid.' + tag, type: 'text', text: { body: MESSAGE + ' ref ' + tag } }],
  } }] }] });
  await j('/api/capture/webhook/whatsapp', { method: 'POST', body: payload,
    headers: { 'X-Hub-Signature-256': 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex') } });

  const cap = (((await j('/api/capture/pending', { token: tok })).b || {}).captures || []).find((c) => (c.raw_text || '').includes(tag));
  t.ok(!!cap, 'the message arrived');
  if (!cap) return;

  await j('/api/capture/' + cap.id + '/structure', { method: 'POST', token: tok, body: {} });
  const raise = await j('/api/capture/' + cap.id + '/raise', { method: 'POST', token: tok, body: {} });
  t.ok(raise.status === 200, 'it raised', JSON.stringify(raise.b).slice(0, 160));
  if (raise.status !== 200) return;

  const li = raise.b.line_items || [];
  const via = (raise.b.business_json || {}).via || {};
  const blob = JSON.stringify(raise.b).toLowerCase();

  console.log('\n  ── what the chit actually holds ──');
  li.forEach((l) => console.log('   • ' + l.particulars + ' × ' + l.quantity + (l.unit ? ' ' + l.unit : '')
    + (l.unit_size ? ' (' + l.unit_size + ')' : '') + (l.unit_price ? ' @' + l.unit_price : '')
    + (l.comment ? '\n       ↳ ' + l.comment : '')));
  ['delivery_at', 'delivery_address', 'notes', 'unplaced'].forEach((k) => { if (via[k]) console.log('   ' + k + ': ' + via[k]); });
  console.log('');

  /* ── the ITEMS themselves ──────────────────────────────────────────────────────────────────────────────────── */
  const bir = li.find((l) => /briyani|biryani/i.test(l.particulars || ''));
  const tom = li.find((l) => /thakkali|tomato/i.test(l.particulars || ''));
  t.ok(!!bir, '★ the biryani became a line');
  t.ok(!!tom, '★ the thakkali became a line');
  t.ok(bir && bir.quantity === 4, '★ …with the quantity the customer said (4)', bir && String(bir.quantity));

  /* ── the QUALIFIERS — the part that used to vanish ─────────────────────────────────────────────────────────── */
  const birComment = (bir && bir.comment || '').toLowerCase();
  t.ok(/leg/.test(birComment), '★★★ "extra leg piece" survived onto the LINE it belongs to', birComment || '(no comment)');
  t.ok(/spic/.test(birComment), '★★★ "extra spicy" survived — cooking the wrong food off a correct-looking chit is the failure');
  t.ok(/schezwan|schswan|sch/.test(birComment), '★★ "schezwan" survived');
  t.ok(!/spicy|leg piece/i.test(bir ? bir.particulars : ''), '★★ …and the qualifiers are NOT jammed into the item name — "briyani" is the item',
    bir && bir.particulars);

  /* ── UNIT NAME · SIZE · PRICE, three separate facts ────────────────────────────────────────────────────────── */
  t.ok(tom && /crate/i.test(tom.unit || ''), '★★ unit NAME captured (crate)', tom && tom.unit);
  t.ok(tom && /20/.test(tom.unit_size || ''), '★★★ unit SIZE captured separately (20kg) — without it "2 crates" cannot honestly be totalled against kg',
    tom && (tom.unit_size || '(none)'));
  t.ok(tom && Number(tom.unit_price) === 340, '★★★ unit PRICE captured separately (340)', tom && String(tom.unit_price));

  /* ── ORDER-LEVEL facts that have no column of their own ────────────────────────────────────────────────────── */
  t.ok(/7/.test(via.delivery_at || ''), '★★★ "7.00 PM" survived as delivery_at — a request that loses its time looks correct and is not',
    via.delivery_at || '(none)');
  t.ok(/ramnagar/i.test(via.delivery_address || ''), '★★★ the address survived', via.delivery_address || '(none)');
  t.ok(/call before/i.test(JSON.stringify(via)), '★★ "call before coming" is somewhere — notes, comment or unplaced, but NOT gone',
    JSON.stringify({ notes: via.notes, unplaced: via.unplaced }));

  /* ⚠️ THE WHOLE-MESSAGE SWEEP. Field-by-field checks only test what I remembered to check. This asks the harder
     question: is every meaningful word from the message findable anywhere in the chit? */
  const STOP = new Set(['with','and','at','my','the','for','of','a','an','to','each','before','coming','ref']);
  const words = MESSAGE.toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
  const lost = [...new Set(words)].filter((w) => !blob.includes(w));
  t.ok(lost.length === 0, '★★★ EVERY meaningful word from the message is findable on the chit',
    lost.length ? 'LOST: ' + lost.join(', ') : '');
  if (lost.length) console.log('      (a lost word is a fact nobody will ever know was said)');

  t.ok(!!via.raw_excerpt, '★ and the original words are on the chit regardless, so any miss is checkable');
});
