/**
 * tests/money-paths.test.cjs — ACC-206 A: THE ENGINE'S TOTAL IS THE CHIT'S TOTAL, ON EVERY PATH A CHIT TAKES (Athi, 2026-10-30:
 * "if it is computer, it will be correct and no one rechecks, and if they found a loophole then we will be responsible").
 * A single-path proof is rejected (PM/RULE-MATRIX.md): this drives the REAL POST /api/chits/send (db stubbed, the real tax engine) for
 *   purpose × how it is made × country × copy × reader, and reads every stored figure back off the copies the route hands the definer.
 *
 *   MATRIX ROWS (PM/RULE-MATRIX.md columns; R6 = one invoice everywhere, R7 = compute once / readers read, R8 = the engine is always engaged)
 *     C1 counter cash · C2 counter named · C3 counter credit note ... carried invoice, byte-identical header (no recompute)
 *     C5 / C6 B2B invoice, seller's copy and buyer's copy ........... IN (5% IGST) · AU (10% GST) · AE (5% VAT), ex-tax and tax-inclusive
 *     C7 order (the buyer sends) · C8 credit note composed · C9..C11 expense / receipt / general / delivery note / offer → NOT APPLICABLE (null)
 *   PATHS: no named buyer (walk-in of the shop's country) · self chit · several recipients (null) · a draft (provisional, no invoice) · captured sale
 *   THE STOP: a negative line breaks the engine's bridge at `gross` → 409 MONEY_UNBALANCED { step, unexplained_minor }; the owner's login or a counter key
 *             WITH a typed reason lets it through and the chit says so (money_override); a co-assist's, or no reason → 409; an override on a balanced bill is dropped
 *   THE REFUSALS: an unreadable line → 422 · the engine not read → 503 MONEY_NOT_COMPUTED, and nothing is delivered either time
 *   READERS: owner · cost-blind (lib/cost-view) — a cost-blind reader sees no money, stamps, bridge or override
 * Run: node tests/money-paths.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';

let pass = 0,
  fail = 0;
const ok = (name, cond, why) => {
  if (cond) {
    pass++;
    console.log('   ok   ' + name);
  } else {
    fail++;
    console.log('   FAIL ' + name + (why ? '\n          ' + why : ''));
  }
};
const J = (x) => JSON.stringify(x);

const SHOP = '11111111-1111-4111-8111-111111111111';
const BUYER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
/** the shop and its buyer for each country — the SELLER's country decides the pack; the buyer is a registered business in the same country (IN: another state) */
const WORLD = {
  IN: { shop: { country: 'IN', gstn: '33AABCK1234F1Z6' }, buyer: { country: 'IN', gstn: '29BBBBB0000B1Z5' }, rate: 5, currency: 'INR' },
  AU: { shop: { country: 'AU', gstn: '51824753556' }, buyer: { country: 'AU', gstn: '53004085616' }, rate: 10, currency: 'AUD' },
  AE: { shop: { country: 'AE', gstn: '100123456700003' }, buyer: { country: 'AE', gstn: '100765432100003' }, rate: 5, currency: 'AED' }
};
let ACTIVE = 'IN';
let INCLUSIVE = false;
const rowOf = (id) => {
  const w = WORLD[ACTIVE];
  const base = { status: 'active', identity_type: 'entity' };
  if (id === SHOP)
    return { ...base, identity_id: SHOP, bridge_id: 'CB-SHOP', display_name: 'Test Shop', ...w.shop, policy_flags: { price_includes_tax: INCLUSIVE ? 'yes' : 'no' } };
  if (id === BUYER) return { ...base, identity_id: BUYER, bridge_id: 'CB-BUYER', display_name: 'Test Buyer', ...w.buyer, policy_flags: {} };
  if (id === OTHER) return { ...base, identity_id: OTHER, bridge_id: 'CB-OTHER', display_name: 'Other Buyer', ...w.buyer, policy_flags: {} };
  return null;
};
let IDENTITIES_FAIL = false;
function rowsFor(sql, params) {
  const s = String(sql);
  if (/to_regprocedure\('chit_deliver/.test(s)) return [{ ok: true }];
  if (/business_json->>'client_ref' = \$2/.test(s)) return [];
  if (/FROM customer_list/.test(s) && /customer_identity_id = \$2/.test(s)) return [{ ok: 1 }];
  if (/FROM supplier_list/.test(s)) return [{ ok: 1 }];
  if (/SELECT self_copy_pref/.test(s)) return [{ self_copy_pref: null }];
  if (/FROM identities/.test(s) && /identity_id = ANY/.test(s)) {
    if (IDENTITIES_FAIL) throw new Error('identities read failed');
    return (params[0] || []).map(rowOf).filter(Boolean);
  }
  if (/FROM identities/.test(s) && /identity_id = \$1/.test(s)) {
    const r = rowOf(params && params[0]);
    return r ? [r] : [];
  }
  return [];
}
const dbPath = require.resolve(path.join(API, 'db'));
const tx = { query: async (s, p) => ({ rows: rowsFor(s, p) }) };
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (s, p) => ({ rows: rowsFor(s, p) }),
    withEntity: async (id, fn) => fn(tx),
    withTransaction: async (fn) => fn(tx),
    trySavepoint: async (db, fn, fb) => {
      try {
        return await fn(db);
      } catch (_) {
        return fb;
      }
    },
    onEntity: async (id, db, fn) => fn(tx)
  }
};
/** who is calling: the owner's login, a counter key, or a co-assist — each is a different `req` for the override helper */
let CALLER = 'owner';
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: Object.assign(
    (req, res, next) => {
      const holder = require(path.join(API, 'lib', 'holder')).holderOf;
      const sender = req.headers['x-sender'] === 'buyer' ? BUYER : SHOP;
      req.identity = { identity_id: sender, identity_type: 'entity', bridge_id: 'CB-X', display_name: 'Caller' };
      if (CALLER === 'key') {
        req.api_key = { scopes: ['till'] };
        req.till = holder({ kind: 'api_key', jti: 'k1', scopes: ['till'] }, { till: { id: 'C1' } });
      } else if (CALLER === 'coassist') {
        req.identity = { identity_id: 'actor-1', identity_type: 'actor', parent_entity_id: sender, display_name: 'Asha' };
        req.till = holder({ identity_type: 'actor' }, null);
      } else req.till = holder({ identity_type: 'entity' }, null);
      next();
    },
    {
      entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
      requireScope: () => (q, s, n) => n(),
      userOf: (req) => req.identity,
      forgetKey: () => {},
      keyAlive: async () => true
    }
  )
};
const mint = require(path.join(API, 'lib', 'mint'));
let COPIES = null;
mint.deliver = async (sender, chit_id, copies) => {
  COPIES = copies;
  return { ok: true };
};
try {
  require(path.join(API, 'lib', 'books-hooks')).afterChit = () => Promise.resolve({});
  require(path.join(API, 'lib', 'meter')).meter = async () => {};
  require(path.join(API, 'lib', 'stock-from-chit')).postFor = async () => ({ failed: [], skipped: [] });
} catch (_) {
  /* a hook that is not loaded in this harness needs no stub */
}
require(path.join(API, 'lib', 'tax-shelf')).readShelf = async () => null;
const taxLines = require(path.join(API, 'lib', 'tax-lines'));
const realInvoiceFor = taxLines.invoiceFor;
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));
const costView = require(path.join(API, 'lib', 'cost-view'));

/* ═══ 0 · lib/send-money, unit by unit (the route tests below drive it end to end) ═══ */
const SM = require('../lib/send-money');
{
  const base = { purpose: 'invoice', business_json: {}, counterBill: false, orderLike: false, toIds: ['b'], line_items: [{ name: 'x', price: 1 }] };
  const kind = (over) => SM.scopeOf(Object.assign({}, base, over)).kind;
  ok('scopeOf: an invoice to one buyer → engine; a carried invoice → carried; a counter bill without one → none (unknown, never a sum)', kind({}) === 'engine' && kind({ business_json: { invoice: { ValDtls: {} } } }) === 'carried' && kind({ counterBill: true }) === 'none');
  ok('scopeOf: no lines · a removed line only · an expense · several recipients → none (not applicable)', kind({ line_items: [] }) === 'none' && kind({ line_items: [{ removed: true }] }) === 'none' && kind({ purpose: 'expense' }) === 'none' && kind({ toIds: ['a', 'b'] }) === 'none');
  ok('scopeOf: an order with several recipients is still billed (the walk-in); a captured sale (general via a channel) is billed', kind({ purpose: 'order', orderLike: true, toIds: ['a', 'b'] }) === 'engine' && kind({ purpose: 'general', business_json: { via: 'whatsapp' } }) === 'engine');
  ok('unreadableLine: a blank is "no figure given" (fine); text where a number belongs is refused naming the line and the field', SM.unreadableLine([{ price: '' }, { price: null }, { price: '12.5' }]) === null && J(SM.unreadableLine([{ price: 1 }, { quantity: 'two' }])) === '{"line":1,"field":"quantity"}');
  ok('stopOf: a bridge that balanced, or an invoice from before v1.74.0 (no bridge), is not a stop — nothing to refuse', SM.stopOf({ _cb: { bridge: { ok: true } } }) === null && SM.stopOf({ _cb: {} }) === null && SM.stopOf(null) === null);
  const stop = SM.stopOf({ _cb: { bridge: { ok: false, step: 'tax', unexplained_minor: 7, words: 'Does not add up at tax', steps: [{ name: 'gross', amount_minor: 100 }, { name: 'total', amount_minor: 107 }] } } });
  ok('stopOf: refused in the engine own words — step, amount, gross and total READ off its steps (nothing worked out here)', stop.step === 'tax' && stop.unexplained_minor === 7 && stop.gross_minor === 100 && stop.total_minor === 107, J(stop));
  const stamps = SM.stampsOf('2026-10-30T00:00:00Z', 'send');
  ok('stampsOf: names the writer of each figure and the engine pin it came from', stamps.money.by === 'chits send' && /^tax@[0-9]/.test(stamps.money.engine) && stamps.money.where === 'send' && stamps.total_value.from === 'money.total', J(stamps));
}

let PORT = 0;
let N = 0;
/** one send through the real route; returns the answer and the copies the route handed to the definer */
async function send(body, opts) {
  COPIES = null;
  const headers = { 'Content-Type': 'application/json' };
  if (opts && opts.as) headers['x-sender'] = opts.as;
  const res = await fetch(`http://127.0.0.1:${PORT}/api/chits/send`, { method: 'POST', headers, body: J(Object.assign({ client_ref: 'mp-' + ++N }, body)) });
  const answer = await res.json().catch(() => ({}));
  const sentCopy = (COPIES || []).find((c) => c.direction === 'sent') || (COPIES || [])[0] || null;
  const receivedCopy = (COPIES || []).find((c) => c.direction === 'received') || null;
  return { status: res.status, answer, copies: COPIES, sentCopy, receivedCopy };
}
const line = (name, price, qty, rate) => ({ particulars: name, name, quantity: qty, price, total: price * qty, unit: 'each', gst_rate: rate });
const invoiceBody = (to, rows, extra) => Object.assign({ purpose: 'invoice', subject: 'Invoice', recipients: to ? [{ entity_id: to }] : [{ self: true, name: 'self' }], line_items: rows }, extra || {});
/** every stored copy of the money agrees: summary.total_value = money.total = invoice.TotInvVal = the copy's total_value column */
function agreeing(r) {
  const out = [];
  for (const c of r.copies || []) {
    const sj = c.summary_json || {};
    if (sj.oversight) continue;
    const inv = c.business_json && c.business_json.invoice;
    const t = sj.money && sj.money.total;
    if (!(sj.total_value === t && (!inv || inv.ValDtls.TotInvVal === t) && Number(c.total_value) === Number(t))) out.push(J([c.direction, sj.total_value, t, inv && inv.ValDtls.TotInvVal, c.total_value]));
  }
  return out.length ? out.join(' | ') : null;
}

(async () => {
  const server = app.listen(0);
  PORT = server.address().port;
  try {
    /* ═══ 1 · THE B2B INVOICE (C5 sender's copy, C6 buyer's copy) × IN / AU / AE × ex-tax / tax-inclusive ═══ */
    for (const cc of ['IN', 'AU', 'AE']) {
      for (const incl of [false, true]) {
        ACTIVE = cc;
        INCLUSIVE = incl;
        const w = WORLD[cc];
        const r = await send(invoiceBody(BUYER, [line('Item A', 180, 1, w.rate)]));
        const tag = cc + (incl ? ' tax-inclusive' : ' ex-tax');
        const sj = r.sentCopy && r.sentCopy.summary_json;
        const inv = r.sentCopy && r.sentCopy.business_json && r.sentCopy.business_json.invoice;
        ok(`C5 ${tag}: sent (200) with the engine's invoice carried`, r.status === 200 && !!inv, J([r.status, r.answer]));
        if (!inv) continue;
        const expectedTotal = incl ? 180 : 180 + (180 * w.rate) / 100;
        ok(`C5 ${tag}: total_value = money.total = invoice total = ${expectedTotal} on BOTH copies and the column`, !agreeing(r) && sj.total_value === expectedTotal, agreeing(r) + ' ' + J([sj.total_value, expectedTotal]));
        ok(`C6 ${tag}: the buyer's copy carries the same header (one summary, two copies)`, !!r.receivedCopy && J(r.receivedCopy.summary_json) === J(sj) && J(r.receivedCopy.business_json.invoice) === J(inv));
        ok(`C5 ${tag}: the bridge is copied (ok) and every stamp names its writer`, sj.money.bridge && sj.money.bridge.ok === true && sj.stamps.money.by === 'chits send' && /^tax@/.test(sj.stamps.money.engine) && sj.stamps.total_value.from === 'money.total', J([sj.money.bridge && sj.money.bridge.ok, sj.stamps]));
        ok(`C5 ${tag}: the header's net / tax / taxable are the engine's figures, copied (taxable + tax = total)`, sj.money.taxable === inv.ValDtls.AssVal && sj.money.total === inv.ValDtls.TotInvVal, J(sj.money));
      }
    }

    /* ═══ 2 · THE OTHER BILLING DOCUMENTS (C7 order · C8 credit note) × country ═══ */
    for (const cc of ['IN', 'AU', 'AE']) {
      ACTIVE = cc;
      INCLUSIVE = false;
      const w = WORLD[cc];
      const expect = 180 + (180 * w.rate) / 100;
      const order = await send({ purpose: 'order', subject: 'PO', recipients: [{ entity_id: SHOP }], line_items: [line('Item A', 180, 1, w.rate)] }, { as: 'buyer' });
      /* an order: the BUYER sends, the recipient is the SELLER — the seller's flags and the seller's country decide the tax */
      ok(`C7 ${cc}: a buyer's order carries the engine's total ${expect} on both copies`, order.status === 200 && !agreeing(order) && order.sentCopy.summary_json.total_value === expect, J([order.status, order.answer, agreeing(order)]));
      const note = await send({ purpose: 'credit_note', subject: 'CN', recipients: [{ entity_id: BUYER }], line_items: [line('Item A', 180, 1, w.rate)] });
      ok(`C8 ${cc}: a composed credit note carries the engine's total ${expect}`, note.status === 200 && !agreeing(note) && note.sentCopy.summary_json.total_value === expect, J([note.status, note.answer]));
    }

    /* ═══ 3 · WHO IS THE BUYER: nobody named · yourself · several ═══ */
    ACTIVE = 'IN';
    INCLUSIVE = false;
    const self = await send(invoiceBody(null, [line('Item A', 180, 1, 5)]));
    ok('a self chit (no named buyer: the walk-in of the shop country) carries figures too', self.status === 200 && self.sentCopy.summary_json.total_value === 189 && !agreeing(self), J([self.status, self.answer]));
    const nameless = await send({ purpose: 'order', subject: 'PO', recipients: [{ self: true, name: 'self' }], line_items: [line('Item A', 180, 1, 5)] });
    ok('an order with no other seller (to itself) is billed as the walk-in of the shop country, figures present', nameless.status === 200 && nameless.sentCopy.summary_json.total_value === 189 && !agreeing(nameless), J([nameless.status, nameless.answer]));
    const many = await send(invoiceBody(BUYER, [line('Item A', 180, 1, 5)], { recipients: [{ entity_id: BUYER }, { entity_id: OTHER }] }));
    ok('several recipients: no single buyer to bill → NOT APPLICABLE: total_value null, no money, no invoice (never 0, never a sum)', many.status === 200 && many.sentCopy.summary_json.total_value === null && !many.sentCopy.summary_json.money && !(many.sentCopy.business_json || {}).invoice, J(many.sentCopy && many.sentCopy.summary_json));

    /* ═══ 4 · NOT A BILLING DOCUMENT: null, never a line sum and never 0 (C9 · C10 · C11 · an offer) ═══ */
    for (const purpose of ['expense', 'receipt', 'general', 'delivery_note', 'inquiry']) {
      const r = await send({ purpose, subject: purpose, recipients: [{ entity_id: BUYER }], line_items: [line('Item A', 180, 1, 5)], business_json: purpose === 'receipt' ? { doc: 'receipt' } : {} });
      const sj = r.sentCopy && r.sentCopy.summary_json;
      ok(`purpose ${purpose}: sent, and total_value is NOT APPLICABLE (null), no money block, no invoice`, r.status === 200 && sj && sj.total_value === null && !sj.money && !sj.stamps && !(r.sentCopy.business_json || {}).invoice, J([r.status, r.answer, sj]));
    }
    const captured = await send({ purpose: 'general', subject: 'WhatsApp sale', recipients: [{ self: true, name: 'self' }], line_items: [line('Item A', 180, 1, 5)], business_json: { via: 'whatsapp', customer: { name: 'Walk' } } });
    ok('a captured sale (general, filed from a channel) is the seller\'s own sale: billed by the engine', captured.status === 200 && captured.sentCopy.summary_json.total_value === 189, J([captured.status, captured.answer]));

    /* ═══ 5 · A DRAFT: provisional figures, no invoice, never stopped ═══ */
    const draft = await send(invoiceBody(BUYER, [line('Item A', 180, 1, 5)], { is_draft: true }));
    const dj = draft.sentCopy && draft.sentCopy.summary_json;
    ok('a draft carries the engine\'s provisional money (not issued) and attaches no invoice', draft.status === 200 && dj.money && dj.money.provisional === true && dj.total_value === 189 && !(draft.sentCopy.business_json || {}).invoice, J([draft.status, dj]));

    /* ═══ 6 · THE COUNTER (C1 · C2 · C3): the invoice the counter computed is mapped, byte for byte, never recomputed ═══ */
    const counterInv = realInvoiceFor({ lines: [line('Tea', 100, 2, 5)], seller: taxLines.partyOf(rowOf(SHOP)), buyer: {}, currency: 'INR', at: '2026-10-30T05:00:00Z', priceIncludesTax: false }).invoice;
    const counterBody = (purpose, to, inv) => ({ purpose, subject: 'Bill', recipients: to ? [{ entity_id: to }] : [{ self: true, name: 'self' }], line_items: [line('Tea', 100, 2, 5)], business_json: { bill_no: 'C1-0001', till: { id: 'C1' }, billed_at: '2026-10-30T05:00:00Z', customer: to ? { name: 'Test Buyer', entity_id: to } : { name: 'Walk-in' }, ...(inv ? { invoice: inv } : {}) } });
    CALLER = 'key';
    for (const [id, purpose, to] of [['C1 cash', 'order', null], ['C2 named', 'order', BUYER], ['C3 credit note', 'credit_note', null]]) {
      const r = await send(counterBody(purpose, to, counterInv));
      const sj = r.sentCopy && r.sentCopy.summary_json;
      ok(`${id}: the header's total_value = the counter's TotInvVal (${counterInv.ValDtls.TotInvVal}) on every copy; the invoice is stored exactly as it came`, r.status === 200 && !agreeing(r) && sj.total_value === counterInv.ValDtls.TotInvVal && J(r.sentCopy.business_json.invoice) === J(counterInv), J([r.status, r.answer, agreeing(r)]));
    }
    const noInv = await send(counterBody('order', null, null));
    ok('a counter bill that carries NO invoice (an older till): total_value is UNKNOWN (null) — not the line sum, not a server-invented slip', noInv.status === 200 && noInv.sentCopy.summary_json.total_value === null && !noInv.sentCopy.summary_json.money && !noInv.sentCopy.business_json.invoice, J(noInv.sentCopy && noInv.sentCopy.summary_json));
    CALLER = 'owner';

    /* ═══ 7 · THE STOP: the bridge does not add up → 409; the owner may let it through, with a reason; it stays an open item ═══ */
    const bad = invoiceBody(BUYER, [line('Item A', 180, 1, 5), line('Broken', -50, 1, 5)]);
    const stopped = await send(bad);
    ok('a negative line breaks the engine\'s bridge at `gross`: 409 MONEY_UNBALANCED with step, unexplained_minor, words, gross_minor, total_minor — and NOTHING is delivered', stopped.status === 409 && stopped.answer.code === 'MONEY_UNBALANCED' && stopped.answer.step === 'gross' && stopped.answer.unexplained_minor === 5000 && /Does not add up at gross/.test(stopped.answer.words || '') && Number.isFinite(stopped.answer.total_minor) && stopped.copies === null, J(stopped.answer));
    const noWhy = await send({ ...bad, business_json: { money_override: { by: 'x' } } });
    ok('the owner\'s override WITHOUT a typed reason does not let it through (409)', noWhy.status === 409 && noWhy.copies === null, J(noWhy.status));
    const allowed = await send({ ...bad, business_json: { money_override: { by: 'ignored', why: 'Customer returned a damaged item; checked by hand' } } });
    const mo = allowed.sentCopy && allowed.sentCopy.business_json && allowed.sentCopy.business_json.money_override;
    ok('the owner\'s login WITH a reason sends it: money_override = { by: the session\'s id (never the body\'s), at, why, step, unexplained_minor }', allowed.status === 200 && mo && mo.by === SHOP && mo.step === 'gross' && mo.unexplained_minor === 5000 && /damaged/.test(mo.why) && !!mo.at, J([allowed.status, allowed.answer, mo]));
    ok('…the stored copy still says the bridge did not balance (the figure is not hidden): money.bridge.ok === false', allowed.sentCopy.summary_json.money.bridge.ok === false && allowed.sentCopy.summary_json.money.bridge.step === 'gross');
    CALLER = 'coassist';
    const co = await send({ ...bad, business_json: { money_override: { by: 'x', why: 'because' } } });
    ok('a co-assist\'s override is refused (409): the override is the owner\'s alone', co.status === 409 && co.copies === null, J(co.status));
    CALLER = 'key';
    const badInv = realInvoiceFor({ lines: bad.line_items, seller: taxLines.partyOf(rowOf(SHOP)), buyer: {}, currency: 'INR', at: '2026-10-30T05:00:00Z', priceIncludesTax: false }).invoice;
    const counterBad = counterBody('order', null, badInv);
    const keyNo = await send(counterBad);
    ok('a COUNTER bill whose carried invoice does not balance is stopped too (409 from the invoice the counter sent)', keyNo.status === 409 && keyNo.answer.code === 'MONEY_UNBALANCED' && keyNo.copies === null, J(keyNo.answer));
    const key = await send({ ...counterBad, business_json: { ...counterBad.business_json, money_override: { by: 'Asha (owner PIN at the counter)', why: 'counter PIN' } } });
    ok('a counter key carrying the owner\'s PIN override is accepted (the till checked the PIN)', key.status === 200 && key.sentCopy.business_json.money_override.by === 'Asha (owner PIN at the counter)', J([key.status, key.answer]));
    CALLER = 'owner';
    const spurious = await send({ ...invoiceBody(BUYER, [line('Item A', 180, 1, 5)]), business_json: { money_override: { by: 'x', why: 'not needed' } } });
    ok('an override claimed on a bill that BALANCES is dropped — it opens no item', spurious.status === 200 && !(spurious.sentCopy.business_json || {}).money_override, J(spurious.sentCopy && spurious.sentCopy.business_json));
    const draftBad = await send({ ...bad, is_draft: true });
    ok('a draft is never stopped', draftBad.status === 200, J([draftBad.status, draftBad.answer]));

    /* ═══ 8 · THE REFUSALS: an unreadable line (422), an engine that could not be read (503) — nothing is delivered either time ═══ */
    const unreadable = await send(invoiceBody(BUYER, [{ ...line('Item A', 180, 1, 5), price: 'abc' }]));
    ok('a price that is not a number: 422 MONEY_INPUT_UNREADABLE naming the line and field; nothing delivered', unreadable.status === 422 && unreadable.answer.code === 'MONEY_INPUT_UNREADABLE' && unreadable.answer.line === 0 && unreadable.answer.field === 'price' && unreadable.copies === null, J(unreadable.answer));
    IDENTITIES_FAIL = true;
    const down = await send(invoiceBody(BUYER, [line('Item A', 180, 1, 5)]));
    IDENTITIES_FAIL = false;
    ok('the parties could not be read: 503 MONEY_NOT_COMPUTED in words ("Try again; if it repeats, tell us"); nothing delivered, no chit with no money', down.status === 503 && down.answer.code === 'MONEY_NOT_COMPUTED' && /Try again/.test(down.answer.message || down.answer.detail || '') && down.copies === null, J(down.answer));
    taxLines.invoiceFor = () => {
      throw new Error('engine threw');
    };
    const threw = await send(invoiceBody(BUYER, [line('Item A', 180, 1, 5)]));
    taxLines.invoiceFor = realInvoiceFor;
    ok('the engine threw: 503 MONEY_NOT_COMPUTED, nothing delivered', threw.status === 503 && threw.answer.code === 'MONEY_NOT_COMPUTED' && threw.copies === null, J(threw.answer));

    /* ═══ 9 · THE READERS: the owner sees the figures; a cost-blind co-assist sees none of them ═══ */
    ACTIVE = 'IN';
    INCLUSIVE = false;
    const seen = await send({ ...bad, business_json: { money_override: { by: 'x', why: 'checked' } } });
    const header = { summary_json: seen.sentCopy.summary_json, business_json: seen.sentCopy.business_json, total_value: seen.sentCopy.total_value };
    const blind = JSON.parse(J(costView.dropMoneyKeys(header)));
    const text = J(blind);
    ok('a cost-blind reader of the stored copy sees no money, stamps, bridge, override or invoice', !/"stamps"|"bridge"|"money_override"|"money"|"invoice"|"total_value"|unexplained_minor|TotInvVal/.test(text), text.slice(0, 400));
  } catch (e) {
    fail++;
    console.log('   FAIL the harness threw: ' + (e && e.stack));
  }
  server.close();
  console.log(`\n  ${pass} passed, ${fail} failed · ${pass + fail} checks\n`);
  process.exit(fail ? 1 : 0);
})();
