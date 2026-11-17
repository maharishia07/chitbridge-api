#!/usr/bin/env node
/**
 * acc-168-freeze-no-second-read.test.cjs — ACC-168 (proof 2026-11-14): completing a chit opens NO second chit_header read; freezeOnComplete takes the row the transaction already holds.
 * @type regression
 * OWNS      the proof on lib/tax-copy.freezeOnComplete(chit_id, me, pre): with `pre` (the copy the caller already read) the database is never asked for the copy again — the only statements
 *           are the identities read the invoice needs and the one UPDATE that stamps business_json.invoice; a carried invoice is returned untouched with NO statement at all; `pre = null` (an honest
 *           "no such copy") is NOT turned into a second read; and only `pre` undefined reads the copy (the control: the read this fix removed still exists for the callers that have no row).
 *           tests/money-origin.test.cjs only checks that a carried invoice is never re-stamped.
 * CALLED BY scripts/guards.cjs · CI. No database: a stand-in that keeps every statement it is asked.
 * FLOW      freezeOnComplete(chit, shop, pre) -> (copyOf only when pre === undefined) -> entryFor -> UPDATE chit_header ... invoice -> the frozen block
 *
 * THE HAND CASE (IN shop, INR, counter bill, 18%): one line Brake pad 1 x 100.00, price excludes tax -> taxable 100.00 + CGST 9.00 + SGST 9.00 = total 118.00.
 *   The frozen invoice carries AssVal 100, TotInvVal 118 (carried, not recomputed here), a frozen_at moment, and is written once.
 * Run: node tests/acc-168-freeze-no-second-read.test.cjs
 */
'use strict';
const path = require('path');
process.env.NODE_ENV = 'test';
const { API, ok, done, mock } = require('./lib/cat-proof-kit.cjs');

const SHOP = '11111111-1111-4111-8111-111111111111';
const IDS = { [SHOP]: { identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Traders', country: 'IN', policy_flags: { price_includes_tax: 'no' } } };
let statements = [];
const query = async (sql, params) => {
  statements.push(String(sql));
  if (/FROM identities WHERE identity_id = ANY/.test(sql)) return { rows: params[0].map((id) => IDS[id]).filter(Boolean) };
  throw new Error('unstubbed query: ' + String(sql).slice(0, 80));
};
const reads = [];
mock('db/index.js', { query, withEntity: async (id, fn) => fn({ query: async (sql, params) => { statements.push(String(sql)); if (/FROM chit_header h/.test(sql)) { reads.push(params); return { rows: [] }; } return { rows: [], rowCount: 1 }; } }) });
const TC = require(path.join(API, 'lib', 'tax-copy'));

const counterBj = { customer: { name: 'Ravi' }, till: { id: 'C1', name: 'Counter 1', host: 'browser' }, bill_no: 'C1/26-27/0041', billed_at: '2026-10-01T05:00:00.000Z', client_ref: 'C1/26-27/0041', slip: 'cash' };
const lines = [{ line_id: 'l1', particulars: 'Brake pad', quantity: 1, price: 100, total: 100, gst_rate: 18 }];
const copyRow = (bj) => ({ chit_id: 'cb1', sender_entity_id: SHOP, purpose: 'order', all_recipients: [{ role: 'sender', entity_id: SHOP, bridge_id: 'b-1111', display_name: 'Mayur Traders' }],
  business_json: bj, summary_json: {}, sent_at: '2026-10-01T05:00:01.000Z', created_at: '2026-10-01T05:00:01.000Z', line_items: lines, currency_code: 'INR' });
const headerReads = () => statements.filter((s) => /FROM chit_header/.test(s)).length;
const updates = () => statements.filter((s) => /^\s*UPDATE chit_header/.test(s));

(async () => {
  /* a - pre given, no invoice yet: stamped from the row in hand, no second read of chit_header */
  statements = [];
  const block = await TC.freezeOnComplete('cb1', SHOP, copyRow(counterBj));
  ok('with `pre`, the copy is NOT read again: no statement selects from chit_header (0 reads)', headerReads() === 0, statements.map((s) => s.slice(0, 50)).join(' | '));
  ok('the invoice is stamped once: exactly one UPDATE chit_header ... jsonb_build_object(\'invoice\')', updates().length === 1 && /jsonb_build_object\('invoice'/.test(updates()[0]), String(updates().length));
  ok('the frozen block carries taxable 100 and total 118 (100 + CGST 9 + SGST 9), with its moment', !!block && block.ValDtls && block.ValDtls.AssVal === 100 && block.ValDtls.TotInvVal === 118 && /^\d{4}-\d\d-\d\dT/.test(block.frozen_at), JSON.stringify(block && block.ValDtls));

  /* b - a carried invoice is returned as is, with no statement at all */
  statements = [];
  const carried = { ValDtls: { AssVal: 100, TotInvVal: 118 } };
  const same = await TC.freezeOnComplete('cb1', SHOP, copyRow({ invoice: carried }));
  ok('a carried invoice is returned untouched with 0 statements (no read, no UPDATE)', same === carried && statements.length === 0, statements.length + ' statements');

  /* c - pre null is an honest "no such copy": answered null, not turned into a second read */
  statements = [];
  const none = await TC.freezeOnComplete('cb1', SHOP, null);
  ok('pre = null answers null with 0 statements (a falsy pre is not a second read)', none === null && statements.length === 0, statements.length + ' statements');

  /* d - control: pre undefined DOES read the copy once (copyOf), so the three zeros above mean something */
  statements = []; reads.length = 0;
  const control = await TC.freezeOnComplete('cb1', SHOP);
  ok('control: with no `pre` the copy is read exactly once (1 read of chit_header)', headerReads() === 1 && reads.length === 1 && control === null, headerReads() + ' reads');
  done();
})().catch((x) => { console.error(x); process.exit(1); });
