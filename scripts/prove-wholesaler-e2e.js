#!/usr/bin/env node
'use strict';
/**
 * prove-wholesaler-e2e.js — W-1 … W-11 END TO END, against the live API.
 *
 * CB-CLI-DIRECTIVE-wholesaler-consolidation.md, definition of done: *"Several messy text/voice requests from
 * different stores become attributed chits (store resolved from the sender's number, date resolved, variants
 * preserved, synonyms collapsed). The wholesaler picks a fulfilment date and sees one consolidated requirement per
 * item and variant — correctly totalled, with unmatched, variant-unspecified, date-unspecified and unit-split lines
 * flagged rather than fudged — and can drill into who asked for how much and where it must go, tracing every line
 * back to the original message."*
 *
 * ⚠️ THIS IS THE REAL PIPELINE. Signed webhook → capture → the actual AI reading the actual prose → chit → store
 * resolution → consolidation. prove-wholesaler.js proves the RULES in isolation and cheaply; this proves they
 * survive contact with a real message and a real model, which is the only way to know the seams hold.
 *
 * ⚠️ IT COSTS A FEW AI CALLS (a fraction of a cent each). Deliberate: mocking the reader would only prove my own
 * parser agrees with itself, and every interesting failure so far has been at a seam, not inside a function.
 *
 * RUN:  node scripts/prove-wholesaler-e2e.js
 */
const crypto = require('crypto');
const { j, signIn, run } = require('./_proof');

const SECRET = process.env.WHATSAPP_APP_SECRET;
const ADMIN = process.env.CB_ADMIN_KEY;
/**
 * ⚠️ A FRESH WHOLESALER PER RUN. The first version reused one entity, so the SECOND run consolidated its own
 * messages together with the previous run's — and 'the last date' (used to pick Friday) silently became the Monday
 * that the W-10 test had just created. Every downstream assertion then measured the wrong day and failed for a
 * reason that had nothing to do with the code. Same class of fault as prove-autoraise had: a proof that only works
 * once is a proof you stop believing.
 */
const RUN = String(process.pid).slice(-5);
const WHOLESALER = 'veg-wholesaler-' + RUN + '@test-cb.com';
const LINE = '+9190' + RUN + '90';                       // the wholesaler's own WhatsApp line

const TAG = 'W' + String(process.pid).slice(-4);
/* Three real shops, messy prose, in their own words. The spellings, units and gaps are the point. */
const SHOPS = [
  { phone: '+91 90000 11111', name: 'Selvam Veg Stall', addr: '12 Ramnagar main road',
    msg: '2 crate thakkali and 5 kg vengayam by friday ' + TAG },
  { phone: '+919000022222',   name: 'Amma Stores',      addr: '48 Gandhi bazaar',
    msg: 'need 25 kg tomator, 10 kg onion friday please. deliver to 90 Market street this time ' + TAG },
  { phone: '09000033333',     name: 'Kumar Fruits',     addr: '7 Anna salai',
    msg: 'tommotto 3 kg and orange grade 1 4 kg on friday, also 2 kg dragonfruit ' + TAG },
];

const deliver = async (from, text) => {
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
    metadata: { display_phone_number: LINE, phone_number_id: '000' },
    contacts: [{ wa_id: String(from).replace(/\D/g, ''), profile: { name: 'shop' } }],
    messages: [{ from: String(from).replace(/\D/g, ''), id: 'wamid.' + TAG + '.' + Math.random().toString(36).slice(2, 8),
      type: 'text', text: { body: text } }],
  } }] }] });
  return j('/api/capture/webhook/whatsapp', { method: 'POST', body: payload,
    headers: { 'X-Hub-Signature-256': 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex') } });
};

run('prove-wholesaler-e2e', async (t) => {
  console.log('\n  W-1 … W-11 · three shops, one wholesaler, one fulfilment date\n');
  if (!SECRET || !ADMIN) { t.note('needs WHATSAPP_APP_SECRET / CB_ADMIN_KEY'); return; }
  const canary = await j('/api/capture/webhook/whatsapp', { method: 'POST', body: '{}', headers: { 'X-Hub-Signature-256': 'sha256=deadbeef' } });
  if (canary.status !== 401) { t.ok(false, 'ABORT — server not enforcing signatures'); return; }

  const tok = await signIn(WHOLESALER, 'Veg Wholesaler');
  if (!tok) throw new Error('could not sign in');

  /* ── the wholesaler's CATALOGUE — the authority (W-8). Synonyms per item; orange has two grades; tomato
        declares crate→kg, ONION DOES NOT (that is the W-6 case). ─────────────────────────────────────────────── */
  const want = [
    { name: 'Tomato', unit: 'kg', synonyms: ['thakkali', 'tomator', 'tommotto'], conversions: { crate: 20 }, price: 30 },
    { name: 'Onion',  unit: 'kg', synonyms: ['vengayam'], price: 40 },
    { name: 'Orange', variant: 'grade 1', unit: 'kg', synonyms: ['orange'], price: 90 },
    { name: 'Orange', variant: 'grade 2', unit: 'kg', synonyms: ['orange'], price: 60 },
  ];
  const have = JSON.stringify(((await j('/api/products', { token: tok })).b || {}).items || []);
  for (const w of want) {
    if (!have.includes('"' + w.name + '"') || (w.variant && !have.includes(w.variant))) {
      await j('/api/products', { method: 'POST', token: tok, body: { item_data: w } });
    }
  }
  t.ok(true, 'catalogue ready — tomato(crate=20kg) · onion(NO conversion) · orange grade 1 + grade 2');

  /* ── the shops are known contacts with default addresses (W-1, W-11) ──────────────────────────────────────── */
  for (const s of SHOPS) await j('/api/capture/stores', { method: 'POST', token: tok, body: { phone: s.phone, display_name: s.name, address: s.addr } });
  const stores = ((await j('/api/capture/stores', { token: tok })).b || {}).stores || [];
  t.ok(stores.length >= 3, 'W-1 · three shops are on file with default addresses', String(stores.length));

  /* ── bind the wholesaler's line and deliver the three messages ────────────────────────────────────────────── */
  const chl = await j('/api/channels', { token: tok });
  const wa = ((chl.b || {}).channels || []).find((c) => c.key === 'whatsapp') || { bindings: [] };
  let bind = (wa.bindings || []).find((b) => b.address === LINE);
  if (!bind) { const m = await j('/api/channels', { method: 'POST', token: tok, body: { channel: 'whatsapp', address: LINE, label: 'wholesaler line' } }); bind = m.b; }
  if (bind && bind.status !== 'verified') await j('/api/channels/' + bind.id + '/approve', { method: 'POST', headers: { 'x-cb-admin-key': ADMIN }, body: {} });

  for (const s of SHOPS) { const r = await deliver(s.phone, s.msg); t.ok(r.b && r.b.captured >= 1, '  · ' + s.name + ' messaged', JSON.stringify(r.b)); }

  /* ── read → raise → chit, for each (W-1) ──────────────────────────────────────────────────────────────────── */
  const caps = (((await j('/api/capture/pending', { token: tok })).b || {}).captures || []).filter((c) => (c.raw_text || '').includes(TAG));
  t.ok(caps.length === 3, 'W-1 · three messages arrived as three captures', String(caps.length));
  const chits = [];
  for (const c of caps) {
    await j('/api/capture/' + c.id + '/structure', { method: 'POST', token: tok, body: {} });
    const p = await j('/api/capture/' + c.id + '/raise', { method: 'POST', token: tok, body: {} });
    if (p.status !== 200) { t.ok(false, 'raise failed for a capture', JSON.stringify(p.b).slice(0, 140)); continue; }
    const sent = await j('/api/chits/send', { method: 'POST', token: tok, body: {
      recipients: p.b.recipients, subject: p.b.subject, line_items: p.b.line_items,
      purpose: p.b.purpose, business_json: p.b.business_json, self_copy: p.b.self_copy } });
    if (sent.b && sent.b.chit_id) { chits.push(sent.b.chit_id); await j('/api/capture/' + c.id + '/convert', { method: 'POST', token: tok, body: { chit_id: sent.b.chit_id } }); }
  }
  t.ok(chits.length === 3, '★★★ W-1 · three messages became THREE attributed chits', String(chits.length));

  /* ── W-2 · the voice seam ─────────────────────────────────────────────────────────────────────────────────── */
  const tr = require('../lib/transcribe');
  t.ok(typeof tr.transcribe === 'function' && typeof tr.isVoice === 'function', 'W-2 · the transcription seam exists');
  const noEngine = await tr.transcribe({ bytes: Buffer.from('x'), mime: 'audio/ogg' });
  t.ok(!tr.configured() ? (noEngine.ok === false && noEngine.reason === 'no-engine') : true,
    '★★★ W-2 · with no engine it REFUSES — audio never leaves CB by falling back to a cloud API',
    JSON.stringify(noEngine));
  t.note('W-2 transcription itself needs WHISPER_URL (self-hosted). The audio + transcript columns are live (b135).');

  /* ── the two outputs ──────────────────────────────────────────────────────────────────────────────────────── */
  const con = await j('/api/capture/consolidate', { token: tok });
  t.ok(con.status === 200, 'the consolidation answers', JSON.stringify(con.b).slice(0, 160));
  const R = con.b || {};
  /* ⚠️ THE EARLIEST date, not the last: the W-10 test deliberately adds a LATER one, and 'last' would then point at
     it. Naming which day is meant is the difference between a stable assertion and a lucky one. */
  const fri = (R.dates || []).slice().sort()[0];
  const lines = (R.requirement || []).filter((l) => l.date === fri);

  console.log('\n  ══ A · CONSOLIDATED REQUIREMENT for ' + fri + ' ══════════════════════════════════');
  lines.forEach((l) => console.log('   ' + (l.item + (l.variant ? ' ' + l.variant : '')).padEnd(20)
    + String(l.total).padStart(6) + ' ' + (l.canonical_unit || '').padEnd(5)
    + ' · ' + l.stores + ' shop(s)'
    + (l.conversions_applied ? '  ⚙ converted: ' + l.conversions_applied.map((c) => c.qty + ' ' + c.from_unit + '×' + c.factor).join(', ') : '')
    + (l.unit_split ? '  ⚠️ SPLIT: ' + l.unit_split.map((u) => u.qty + ' ' + u.unit).join(' + ') : '')));
  console.log('\n  ══ B · ATTRIBUTION ═════════════════════════════════════════════════════════════');
  lines.forEach((l) => console.log('   ' + (l.item + (l.variant ? ' ' + l.variant : '')).padEnd(20)
    + l.breakdown.map((b) => b.store_name + ' ' + b.qty + (b.unit ? b.unit : '')).join(' · ')));
  console.log('\n  ══ FLAGGED — shown, never folded into a total ══════════════════════════════════');
  ['unmatched', 'variant_unspecified', 'date_unspecified', 'unit_split'].forEach((k) => {
    (R.flags[k] || []).forEach((f) => console.log('   ' + k.padEnd(20) + JSON.stringify(f).slice(0, 110)));
  });
  console.log('');

  /* ── W-3 synonyms · W-4 arithmetic · W-6 units · W-9 variants · W-10 dates · W-7 attribution ──────────────── */
  const tomato = lines.find((l) => /tomato/i.test(l.item));
  t.ok(!!tomato, '★★★ W-3 · thakkali + tomator + tommotto collapsed into ONE tomato line', JSON.stringify(lines.map((l) => l.item)));
  t.ok(tomato && tomato.stores === 3, 'W-3 · …and all three shops are in it', tomato && String(tomato.stores));
  /* 2 crate ×20 = 40, + 25 kg + 3 kg = 68 kg */
  t.ok(tomato && tomato.total === 68, '★★★ W-4/W-6 · 2 crate(×20) + 25 kg + 3 kg = 68 kg — conversion applied',
    tomato && String(tomato.total));
  t.ok(tomato && (tomato.conversions_applied || []).length === 1,
    '★★★ W-6 · …and the conversion is RECORDED, not silent', JSON.stringify(tomato && tomato.conversions_applied));

  const onion = lines.find((l) => /onion/i.test(l.item));
  t.ok(onion && onion.total === 15, '★★ W-3 · vengayam + onion collapsed (5 + 10 = 15 kg)', onion && String(onion.total));

  const g1 = lines.find((l) => /orange/i.test(l.item) && /grade 1/i.test(l.variant || ''));
  t.ok(g1 && g1.total === 4, '★★★ W-9 · orange grade 1 totals on its own', g1 && String(g1.total));
  t.ok(!lines.some((l) => /orange/i.test(l.item) && !l.variant), '★★★ W-9 · no variant-less orange line was invented');

  t.ok((R.flags.unmatched || []).some((f) => /dragon/i.test(f.phrase || '')),
    '★★★ W-5 · dragonfruit is FLAGGED unmatched', JSON.stringify(R.flags.unmatched));
  t.ok(!lines.some((l) => /dragon/i.test(l.item)), '★★★ W-5 · …and appears in NO total');

  /* W-4 arithmetically, across every line */
  const bad = lines.filter((l) => !l.unit_split && Math.abs(l.breakdown.reduce((n, b) => n + b.qty, 0) - l.total) > 0.001
    && !(l.conversions_applied || []).length);
  t.ok(bad.length === 0, '★★★ W-4 · every un-converted total EQUALS the sum of its shop lines',
    JSON.stringify(bad.map((l) => l.item)));

  t.ok(lines.every((l) => l.breakdown.every((b) => b.chit_id)), '★★ W-7 · every attribution line traces to its chit');

  /* W-10 · a second date must not join the first */
  await deliver(SHOPS[0].phone, '10 kg tomato on monday ' + TAG);
  const c2 = (((await j('/api/capture/pending', { token: tok })).b || {}).captures || []).find((c) => /monday/i.test(c.raw_text || ''));
  if (c2) {
    await j('/api/capture/' + c2.id + '/structure', { method: 'POST', token: tok, body: {} });
    const p2 = await j('/api/capture/' + c2.id + '/raise', { method: 'POST', token: tok, body: {} });
    if (p2.status === 200) {
      const s2 = await j('/api/chits/send', { method: 'POST', token: tok, body: { recipients: p2.b.recipients, subject: p2.b.subject,
        line_items: p2.b.line_items, purpose: p2.b.purpose, business_json: p2.b.business_json, self_copy: p2.b.self_copy } });
      if (s2.b && s2.b.chit_id) await j('/api/capture/' + c2.id + '/convert', { method: 'POST', token: tok, body: { chit_id: s2.b.chit_id } });
    }
  }
  const con2 = await j('/api/capture/consolidate', { token: tok });
  const dates2 = (con2.b || {}).dates || [];
  const friAfter = ((con2.b || {}).requirement || []).find((l) => l.date === fri && /tomato/i.test(l.item));
  t.ok(dates2.length >= 2, '★★★ W-10 · a second fulfilment date appears as its OWN date', JSON.stringify(dates2));
  t.ok(friAfter && friAfter.total === 68, '★★★ W-10 · …and Friday is UNCHANGED — Monday never joined it',
    friAfter && String(friAfter.total));

  /**
   * ⚠️ W-6, THE MONEY-ERROR CASE, ON REAL DATA. The run above reported "no invented conversion: none needed" —
   * true, and not good enough: both shops happened to ask for onion in kg, so the split path never fired. A rule
   * that is only proved in a unit test is proved against my own fixtures, and this is the one the directive asks
   * to be handed back. So: a shop orders onion in CRATES, for which the catalogue declares NO conversion.
   */
  await deliver(SHOPS[2].phone, '4 crate vengayam by friday ' + TAG);
  const c3 = (((await j('/api/capture/pending', { token: tok })).b || {}).captures || []).find((c) => /crate vengayam/i.test(c.raw_text || ''));
  if (c3) {
    await j('/api/capture/' + c3.id + '/structure', { method: 'POST', token: tok, body: {} });
    const p3 = await j('/api/capture/' + c3.id + '/raise', { method: 'POST', token: tok, body: {} });
    if (p3.status === 200) {
      const s3 = await j('/api/chits/send', { method: 'POST', token: tok, body: { recipients: p3.b.recipients, subject: p3.b.subject,
        line_items: p3.b.line_items, purpose: p3.b.purpose, business_json: p3.b.business_json, self_copy: p3.b.self_copy } });
      if (s3.b && s3.b.chit_id) await j('/api/capture/' + c3.id + '/convert', { method: 'POST', token: tok, body: { chit_id: s3.b.chit_id } });
    }
  }
  const con3 = await j('/api/capture/consolidate', { token: tok });
  const onion3 = ((con3.b || {}).requirement || []).find((l) => l.date === fri && /onion/i.test(l.item));
  console.log('\n  ── W-6 on real data: onion in crates, no declared conversion ───────────────────');
  console.log('   ' + JSON.stringify({ total: onion3 && onion3.total, unit_split: onion3 && onion3.unit_split, flagged: onion3 && onion3.flagged }));
  t.ok(onion3 && Array.isArray(onion3.unit_split),
    '★★★ W-6 · crates with NO declared conversion produce a SPLIT total, never an invented one',
    JSON.stringify(onion3 && { total: onion3.total, split: onion3.unit_split }));
  t.ok(onion3 && onion3.total === 15,
    '★★★ W-6 · …and the kg total is STILL 15 — no crate figure was folded into it', onion3 && String(onion3.total));
  t.ok(((con3.b || {}).flags || {}).unit_split && con3.b.flags.unit_split.length >= 1,
    '★★★ W-6 · …and it is flagged for the wholesaler to resolve', JSON.stringify((con3.b.flags || {}).unit_split));

  /* W-11 · the address override */
  const amma = lines.flatMap((l) => l.breakdown).find((b) => /Amma/i.test(b.store_name || ''));
  t.ok(!!amma, 'W-11 · the shop that named a different address is attributable', amma && amma.store_name);
  t.note('W-11 · deliver_to / address_overridden ride on each request (consolidationInput) — surfaced next to the shop.');

  console.log('\n  ── HAND-BACK NUMBERS ───────────────────────────────────────────────────────────');
  console.log('   item phrases that failed to match the catalogue: ' + (R.unmatched_phrase_count || 0)
    + '   ← how much catalogue/synonym work real deployment needs');
  console.log('   W-4 totals reconcile      : ' + (bad.length === 0 ? 'YES' : 'NO'));
  console.log('   W-9 variants never merged : ' + (!lines.some((l) => /orange/i.test(l.item) && !l.variant) ? 'YES' : 'NO'));
  const uf = ((con3.b || {}).flags || {}).unit_split || [];
  console.log('   W-6 no invented conversion: ' + (uf.length ? 'YES — split + flagged, proved on real data' : 'NOT EXERCISED'));
});
