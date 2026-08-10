#!/usr/bin/env node
'use strict';
/**
 * mint-shape.test.js — CHARACTERISATION. Proves lib/mint.js reproduces, byte for byte, what each of the four mint
 * paths built by hand before it existed.
 *
 * ⚠️ THE EXPECTED OBJECTS BELOW ARE COPIED FROM THE PRE-REFACTOR CODE, NOT DERIVED FROM lib/mint.js. That is the
 * whole point: a characterisation test written FROM the new code proves only that the new code equals itself. Each
 * literal here is what routes/chits.js, routes/connectors.js and routes/catalogue.js were producing on
 * 2026-08-10 before a line was moved. If a key changes, this goes red — which is exactly what should happen, since
 * two copies of one chit disagreeing about what that chit is is the failure the rail exists to prevent.
 *
 * Pure: no network, no database, no API key. Run it before and after the migration; the answer must not move.
 *
 * RUN:  node scripts/mint-shape.test.js
 */
const assert = require('assert');
const mint = require('../lib/mint');

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  try { assert.deepStrictEqual(actual, expected); pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (e) {
    fail++;
    console.log('  \x1b[31m✗ ' + name + '\x1b[0m');
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    console.log('      built:    ' + a);
    console.log('      expected: ' + b);
    // Name the exact keys that differ — "objects are not equal" costs a manual diff every time.
    const ks = new Set([...Object.keys(actual || {}), ...Object.keys(expected || {})]);
    const bad = [...ks].filter((k) => JSON.stringify((actual || {})[k]) !== JSON.stringify((expected || {})[k]));
    if (bad.length) console.log('      differing keys: ' + bad.join(', '));
  }
}

console.log('\n  mint-shape — lib/mint.js must reproduce the pre-refactor shapes exactly\n');

/* ── 1. THE SUMMARY SKELETON (all four paths) ─────────────────────────────────────────────────────────────────── */
// routes/chits.js built: {...summary, currency_code, priority_external, purpose, is_promotion, forwarded_from, riders}
eq('summary · the seven-key skeleton with /send defaults',
  mint.summary({ line_item_count: 2, total_value: 680, currency_code: 'INR', purpose: 'order' }),
  { line_item_count: 2, total_value: 680, currency_code: 'INR', priority_external: 'normal',
    purpose: 'order', is_promotion: false, forwarded_from: null });

// routes/connectors.js emitSignalChit built exactly this, with copy_policy always present.
eq('summary · emitSignalChit (no line items, IoT copy_policy)',
  mint.summary({ line_item_count: 0, total_value: 0, currency_code: 'INR', purpose: 'general',
    copy_policy: { scope: 'self', kept: ['received'], suppressed: ['sent'], reason: 'Order copy suppressed — IoT self-chit (Task only)', source: 'iot' } }),
  { line_item_count: 0, total_value: 0, currency_code: 'INR', priority_external: 'normal', purpose: 'general',
    is_promotion: false, forwarded_from: null,
    copy_policy: { scope: 'self', kept: ['received'], suppressed: ['sent'], reason: 'Order copy suppressed — IoT self-chit (Task only)', source: 'iot' } });

// routes/catalogue.js deliverEdge: total_value may be NULL (not applicable), and carries a trace rider.
eq('summary · deliverEdge (null total is NOT zero, trace rider)',
  mint.summary({ line_item_count: 0, total_value: null, currency_code: 'AED', purpose: 'order', trace: { parents: ['x'] } }),
  { line_item_count: 0, total_value: null, currency_code: 'AED', priority_external: 'normal', purpose: 'order',
    is_promotion: false, forwarded_from: null, trace: { parents: ['x'] } });

// ⚠️ An ABSENT rider must not appear as a key at all — `key: undefined` is dropped by JSON.stringify on the way in,
//    and a reader then cannot tell "absent" from "null".
eq('summary · absent riders are absent, not undefined',
  Object.keys(mint.summary({ purpose: 'order', trace: null, copy_policy: undefined })).sort(),
  ['currency_code', 'forwarded_from', 'is_promotion', 'line_item_count', 'priority_external', 'purpose', 'total_value']);

/* ── 2. THE HEADER (the co-held key-set) ──────────────────────────────────────────────────────────────────────── */
const S = { line_item_count: 1, total_value: 340, currency_code: 'INR', priority_external: 'normal', purpose: 'order', is_promotion: false, forwarded_from: null };
const RCPT = [{ entity_id: 'E1', bridge_id: 'CBAAA', display_name: 'Alpha', role: 'sender' },
              { entity_id: 'E2', bridge_id: 'CBBBB', display_name: 'Beta', role: 'receiver' }];

eq('header · the 13 keys every copy carries',
  mint.header({ sender_entity_id: 'E1', sender_entity_bridge_id: 'CBAAA', sender_entity_display_name: 'Alpha',
    all_recipients: RCPT, purpose: 'order', auto_subject: 'auto', manual_subject: 'manual', summary_json: S,
    schema_version: 3, schema_id: 'SCH', created_by_actor_id: 'A1', detail_type: 'order',
    line_item_count: 1, total_value: 340, currency_code: 'INR' }),
  { sender_entity_id: 'E1', sender_entity_bridge_id: 'CBAAA', sender_entity_display_name: 'Alpha',
    all_recipients: RCPT, purpose: 'order', auto_subject: 'auto', manual_subject: 'manual', summary_json: S,
    schema_version: 3, schema_id: 'SCH', created_by_actor_id: 'A1', detail_type: 'order',
    line_item_count: 1, total_value: 340, currency_code: 'INR' });

// deliverEdge and emitSignalChit passed no schema and let detail_type follow purpose.
eq('header · defaults match the paths that omit schema/detail_type',
  mint.header({ sender_entity_id: 'E1', sender_entity_bridge_id: 'CBAAA', sender_entity_display_name: 'Alpha',
    all_recipients: RCPT, purpose: 'general', auto_subject: 'auto', manual_subject: 'm', summary_json: S }),
  { sender_entity_id: 'E1', sender_entity_bridge_id: 'CBAAA', sender_entity_display_name: 'Alpha',
    all_recipients: RCPT, purpose: 'general', auto_subject: 'auto', manual_subject: 'm', summary_json: S,
    schema_version: null, schema_id: null, created_by_actor_id: null, detail_type: 'general',
    line_item_count: 1, total_value: 340, currency_code: 'INR' });

/* ── 3. A COPY ────────────────────────────────────────────────────────────────────────────────────────────────── */
const H = mint.header({ sender_entity_id: 'E1', sender_entity_bridge_id: 'CBAAA', sender_entity_display_name: 'Alpha',
  all_recipients: RCPT, purpose: 'order', auto_subject: 'auto', manual_subject: 'm', summary_json: S });

const sent = mint.party(H, { entity_id: 'E1', direction: 'sent', role: 'Act', current_status: 'delivered',
  business_json: { k: 1 }, log: { action: 'created' } });
eq('party · the sender copy is the header plus five keys',
  Object.keys(sent).sort(),
  Object.keys(H).concat(['entity_id', 'direction', 'role', 'current_status', 'priority_flag', 'business_json', 'log']).sort());
eq('party · priority defaults to normal (every path wrote it by hand)', sent.priority_flag, 'normal');

// The storefront order copy carries line_items and payload_delivered; nothing else may be invented.
const shop = mint.party(H, { entity_id: 'E1', direction: 'sent', role: 'Act', current_status: 'delivered',
  payload_delivered: true, line_items: [{ particulars: 'cement' }], log: { action: 'created' } });
eq('party · storefront extras pass through untouched',
  { li: shop.line_items, pd: shop.payload_delivered, bj: shop.business_json },
  { li: [{ particulars: 'cement' }], pd: true, bj: undefined });

// ⚠️ THE TWO COPIES OF ONE CHIT MUST AGREE ON THE HEADER. This is the invariant the whole file exists to keep.
const recv = mint.party(H, { entity_id: 'E2', direction: 'received', role: 'Act', current_status: 'pending' });
const hdrOf = (c) => { const o = {}; for (const k of Object.keys(H)) o[k] = c[k]; return o; };
eq('★★★ both copies carry an IDENTICAL header — the co-held record', hdrOf(sent), hdrOf(recv));
eq('★★ …and differ only in who holds it and which way it points',
  { a: [sent.entity_id, sent.direction, sent.current_status], b: [recv.entity_id, recv.direction, recv.current_status] },
  { a: ['E1', 'sent', 'delivered'], b: ['E2', 'received', 'pending'] });

/* ── 4. DELIVERY ARGS ─────────────────────────────────────────────────────────────────────────────────────────── */
// deliver() must pass exactly (chit_id, is_draft, copies-json) — the argument order chit_deliver expects.
(async () => {
  let seen = null;
  const fakeClient = { query: (sql, args) => { seen = { sql, args }; return Promise.resolve({ rows: [] }); } };
  await mint.deliver('E1', 'CHIT-1', [sent, recv], { client: fakeClient });
  eq('deliver · calls chit_deliver with (chit_id, is_draft, copies)',
    { sql: seen.sql, id: seen.args[0], draft: seen.args[1], n: JSON.parse(seen.args[2]).length },
    { sql: 'SELECT chit_deliver($1,$2,$3::jsonb)', id: 'CHIT-1', draft: false, n: 2 });
  await mint.deliver('E1', 'CHIT-2', [sent], { client: fakeClient, is_draft: true });
  eq('deliver · a draft passes is_draft TRUE', seen.args[1], true);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exitCode = fail ? 1 : 0;
})();
