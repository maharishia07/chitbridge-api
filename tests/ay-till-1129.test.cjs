/**
 * tests/ay-till-1129.test.cjs - AY-F-01, the TILL half (22 Nov 2026): a credit note the till carries takes its supply from the ORIGINAL bill, never the walk-in's.
 * OWNS      the proof of the till master's retOriginalOf (supply, place of supply, heads read off the held bill, or its frozen invoice) · chitOfCN carrying them · retSlipHTML saying it in words when the copy does not hold them ·
 *           and the real server steps (routes/chits.js SEND_STEPS through sendMoney, lib/credit-original.inherit) taking the till's note: inter-state bill -> IGST, intra -> CGST+SGST.
 * CALLED BY scripts/guards.cjs . CI. No browser, no database (a stand-in answers the one read of the bill).
 * HAND (AY-C05): 100 jugs x 118.00 incl 18%: note taxable 10,000.00, IGST 1,800.00, CGST 0, SGST 0 (inter); an intra bill's note CGST 900.00 + SGST 900.00.
 * Break check: take retOriginalOf out of retIssue (supply null on a bill read back) or the unpriced line out of retSlipHTML.
 * Run: node tests/ay-till-1129.test.cjs
 * CARD      09-counter/returns
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const till = fs.readFileSync(path.join(HERE, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
function sourceOf(name) {
  let start = till.indexOf('\nfunction ' + name + '(');
  if (start < 0) start = till.indexOf('\nasync function ' + name + '(');
  if (start < 0) throw new Error('till has no function ' + name);
  let depth = 0, i = till.indexOf('{', start);
  for (; i < till.length; i++) { if (till[i] === '{') depth++; else if (till[i] === '}' && --depth === 0) break; }
  return till.slice(start + 1, i + 1);
}
const ctx = { esc: String, money: (x) => 'M' + Math.round(x * 100), rmoney: (x) => Math.round(Number(x) * 100) / 100, tillStamp: () => ({ id: 'C1' }), slipHeadHTML: () => '', creditNoteTitle: () => 'CREDIT NOTE', counterName: () => 'C1', atShop: () => 'x', retTaxRowsHTML: () => '' };
vm.createContext(ctx);
vm.runInContext(['retOriginalOf', 'chitOfCN', 'retSlipHTML'].map(sourceOf).join('\n'), ctx);
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

/* the till's side: what a held bill says about its supply */
const rungHere = { no: 'C/C1/26-27/0003', supply: 'inter', pos_state: '27', heads: [{ name: 'IGST', rate: 18, amount: 18000 }], invoice: { _cb: { supply: 'inter' } } };
const readBack = { no: 'C/C1/26-27/0003', invoice: { _cb: { supply: 'inter' }, BuyerDtls: { Pos: '27' } } };
const bare = { no: 'C/C1/26-27/0003' };
let o = ctx.retOriginalOf(rungHere);
ok('a bill rung here: its own supply (inter), place (27) and heads', o.supply === 'inter' && o.pos_state === '27' && o.heads && o.heads[0].name === 'IGST' && o.known === true, JSON.stringify(o));
o = ctx.retOriginalOf(readBack);
ok('a bill read back from ChitBridge: supply and place read from its frozen invoice', o.supply === 'inter' && o.pos_state === '27' && o.known === true, JSON.stringify(o));
o = ctx.retOriginalOf(bare);
ok('a copy with neither: not known (the server prices it from the original)', o.known === false && o.supply === null && o.pos_state === null, JSON.stringify(o));
const issue = sourceOf('retIssue');
ok('retIssue builds the note from retOriginalOf (not the stale against.supply / against.heads)', /retOriginalOf\(against\)\.supply/.test(issue) && !/against\.supply \|\| null/.test(issue));
const cn = (supply) => ({ no: 'C/C1/26-27/0001', at: '2026-11-21T10:00:00+05:30', till: 'C1', kind: 'credit_note', against: { bill_no: 'C/C1/26-27/0003', chit_id: '22222222-2222-4222-8222-222222222222', billed_at: '2026-11-19T11:00:00+05:30' }, reason: 'damaged', reason_words: 'Damaged', refunds: [{ how: 'Cash', amount: 11800 }], customer: { name: 'Big retail MH' }, supply, heads: null, by_rate: { 18: { taxable: -10000, tax: -1800 } }, taxable: -10000, tax: -1800, total: -11800, lines: [{ name: 'Steel jug', qty: -100, net: -11800, price: 118, hsn: '7323', gst_rate: 18 }] });
ok('chitOfCN carries the original\'s supply', ctx.chitOfCN(cn('inter')).business_json.supply === 'inter');
const slip = (u) => ctx.retSlipHTML(Object.assign(cn(null), { unpriced: u, lines: [] }));
ok('an unpriced note says so on the paper, in words', /worked out from the original bill/.test(slip(true)), slip(true));
ok('a priced note does not', !/worked out from the original bill/.test(slip(false)));

/* the server's side: the till's own note body through the real send steps, one read of the original bill (lib/credit-original.inherit) */
const dbFile = require.resolve(path.join(HERE, 'db'));
const real = require(dbFile);
let billPos = '27';
const read = async (sql) => {
  if (/FROM identities WHERE identity_id = ANY/.test(sql)) return { rows: [{ identity_id: 'shop-IN', gstn: '33AAAAA0000A1Z5', display_name: 'Shop', policy_flags: { price_includes_tax: 'yes' }, country: 'IN', address: null, timezone: 'Asia/Kolkata' }] };
  if (/FROM chit_header h/.test(sql) && /PrecDocDtls|AS pos/.test(sql)) return { rows: [{ no: 'C/C1/26-27/0003', at: '2026-11-19T11:00:00+05:30', zone: 'Asia/Kolkata', pos: billPos, invoice_total: 106200 }] };
  if (/SELECT country FROM identities WHERE identity_id = $1/.test(sql)) return { rows: [{ country: 'IN' }] };
  if (/SELECT country, currency_code, timezone/.test(sql)) return { rows: [{ country: 'IN', currency_code: 'INR', timezone: 'Asia/Kolkata' }] };
  if (/FROM identities/.test(sql)) return { rows: [{ bridge_id: 'b-1', display_name: 'Shop' }] };
  return { rows: [], rowCount: 0 };
};
require.cache[dbFile].exports = Object.assign({}, real, { query: read, withEntity: async (entity, work) => work({ query: read }) });
require('../lib/country-setup').registrationOfShop = async () => 'regular';
const chits = require(path.join(HERE, 'routes', 'chits.js'));
async function drive(body) {
  const req = { body, headers: {}, user: {}, identity: { bridge_id: 'b-1', display_name: 'Shop', entity_id: 'shop-IN', identity_id: 'shop-IN', identity_type: 'entity' } };
  const res = { locals: { kind: undefined }, headersSent: false, statusCode: 200, status(c) { this.code = c; this.statusCode = c; return this; }, set() { return this; }, setHeader() {}, type() { return this; }, once() {}, json(b) { this.headersSent = true; this.body = b; return this; }, send(b) { this.headersSent = true; this.body = b; return this; } };
  const state = {};
  const last = chits.SEND_STEPS.indexOf(chits.sendMoney);
  for (let i = 0; i <= last; i++) { const out = await chits.SEND_STEPS[i](state, req, res); if (out || res.headersSent) return { stoppedAt: chits.SEND_STEPS[i].name, status: res.code, body: res.body, state }; }
  return { stoppedAt: null, state };
}
const taxLines = require('../lib/tax-lines'), taxCopy = require('../lib/tax-copy');
const seller = taxLines.partyOf({ identity_id: 'shop-IN', gstn: '33AAAAA0000A1Z5', display_name: 'Shop', country: 'IN' });
/** the till's note, as the till sends it, priced the way the server's tax record reads it (live copy off the lines and the recorded place of supply) */
async function liveOf(note) {
  const r = await drive(note);
  const bj = r.state.business_json || {};
  const buyer = taxCopy.withRecordedPos(taxCopy.counterBuyerOf(bj.customer, seller), bj);
  return taxLines.invoiceFor({ lines: r.state.line_items, seller, buyer, currency: 'INR', at: '2026-11-21T10:00:00+05:30', priceIncludesTax: true, purpose: 'credit_note' }).invoice.ValDtls;
}
(async () => {
  billPos = '27';
  let v = await liveOf(ctx.chitOfCN(cn('inter')));
  ok('the till\'s note on an INTER-state bill: taxable 10,000.00, IGST 1,800.00, CGST and SGST 0', v.AssVal === 10000 && v.IgstVal === 1800 && !v.CgstVal && !v.SgstVal, JSON.stringify(v));
  billPos = '33';
  v = await liveOf(ctx.chitOfCN(cn('intra')));
  ok('the till\'s note on an INTRA-state bill: CGST 900.00 + SGST 900.00, no IGST', v.CgstVal === 900 && v.SgstVal === 900 && !v.IgstVal, JSON.stringify(v));
  console.log(String(pass) + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });
