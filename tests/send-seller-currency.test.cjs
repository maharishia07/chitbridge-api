/**
 * tests/send-seller-currency.test.cjs — DECISIONS 2026-10-25 14:50, walk W24: "always use the seller currency". Sydney (AUD) ordered 20 x INR 650 from Chennai (INR) and the chit was stored as 13000.00 AUD on
 * both copies, because the send took the SENDER's money. An order-like send (seller != sender) is priced in the SELLER's money, in one place (routes/chits sellerMoney, called by sendSeller, the step that
 * decides who sells): the seller's identities.currency_code, else lib/regional.currencyFor for a seller on THIS installation, else — a seller on another installation is a stub with NULL money on purpose —
 * what the buyer’s screen stated (business_json.currency); with none stated the send is refused (sendMoney), never filed in the sender’s money.
 *
 *   a local seller in another currency · a local seller whose row holds none (the regional resolver) · a remote seller with a stated currency · a remote seller with NONE stated (REFUSED 400 CURRENCY_REQUIRED,
 *   F7 25 Oct: nothing here knows the far seller’s money and it must not be filed in the sender’s) · same currency / domestic unchanged · a self-chit, a counter bill and a non-order never ask for the seller's money
 *
 * Offline: the database, the address book and the regional resolver are stubs. Run: node tests/send-seller-currency.test.cjs
 */
'use strict';
const assert = require('assert');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const API = path.join(__dirname, '..');
const root = (p) => path.join(API, p);

let pass = 0,
  fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('   ok   ' + name);
  } catch (e) {
    fail++;
    console.log('   FAIL ' + name + '\n          ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n          ') : e));
  }
};

const SYD = '5d111111-1111-4111-8111-111111111111'; /* the buyer, AUD */
const CHE_LOCAL = 'c1111111-1111-4111-8111-111111111111'; /* a seller on this installation, INR */
const CHE_BARE = 'c2222222-2222-4222-8222-222222222222'; /* a local seller whose row holds no currency */
const CHE_REMOTE = 'c3333333-3333-4333-8333-333333333333'; /* the stub of a seller on another installation: NULL money, on purpose */

const MONEY = { [SYD]: 'AUD', [CHE_LOCAL]: 'INR', [CHE_BARE]: null, [CHE_REMOTE]: null };
const asked = { rows: [], regional: [], resolve: [] };
const rowsFor = (sql, p) => {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  asked.rows.push(s);
  if (/^SELECT currency_code FROM identities WHERE identity_id = \$1/.test(s)) return [{ currency_code: MONEY[p[0]] || null }];
  return [];
};
const q = async (sql, p) => {
  const rows = rowsFor(sql, p);
  return { rows, rowCount: rows.length };
};
const dbId = require.resolve(root('db/index.js'));
require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { query: q, pool: { query: q }, withEntity: async (id, fn) => fn({ query: q }), withTransaction: async (fn) => fn({ query: q }), onEntity: async (id, db, fn) => fn({ query: q }), readBatch: async () => ({}), trySavepoint: async (db, fn, fb) => fn(db).catch(() => fb) } };
const bookId = require.resolve(root('lib/ctpaddress.js'));
require.cache[bookId] = {
  id: bookId,
  filename: bookId,
  loaded: true,
  exports: {
    remoteInstallations: async () => new Map(),
    resolve: async (id) => {
      asked.resolve.push(id);
      return id === CHE_REMOTE ? { local: false, installation_key: 'sit-in' } : { local: true };
    },
    resolveAll: async () => new Map(),
    peerByKey: async () => ({}),
    invalidate() {}
  }
};
const regional = require(root('lib/regional'));
regional.currencyFor = async (id) => {
  asked.regional.push(id);
  return id === CHE_BARE ? 'inr' : null;
};
const sc = require(root('lib/schema'));
sc.hasTable = async () => false;
sc.hasColumn = async () => false;
const chits = require(root('routes/chits'));

/** run the send step that decides who sells, on a minimal send state; → the state it leaves */
async function send({ seller, purpose = 'order', stated, sender = SYD, business_json, senderMoney = 'AUD' }) {
  asked.rows.length = 0;
  asked.regional.length = 0;
  asked.resolve.length = 0;
  const st = {
    sender_id: sender,
    purpose,
    business_json: business_json || (stated ? { currency: stated } : {}),
    line_items: [{ particulars: 'Pump seal', quantity: 20, price: 650 }],
    receiverDetails: [{ kind: 'to', entity_id: seller, bridge_id: 'CB', display_name: 'x', all_role: 'receiver' }],
    /* what sendPrefs (which runs first) left: the buyer's stated money, else the SENDER's */
    currency_code: stated ? String(stated).toUpperCase() : senderMoney
  };
  await chits.sendSeller(st, { body: {} }, {});
  return st;
}
/**
 * seller + money steps in the order the pipeline runs them (sendSeller decides who sells and the money; sendMoney prices the header and may refuse) → { st, res, refused }.
 * `res` is a bare double that records the one problem answer the step gave.
 */
async function priced(opts) {
  const st = await send(opts);
  const res = {
    locals: {},
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    set() { return this; },
    json(body) { this.body = body; return this; }
  };
  const answered = await chits.sendMoney(st, { body: { is_draft: !!opts.isDraft }, id: 'req-1' }, res);
  return { st, res, refused: !!answered };
}
const askedSellerMoney = () => asked.rows.some((s) => /^SELECT currency_code FROM identities/.test(s));

(async () => {
  console.log('\n== the seller’s currency, in one place ==\n');
  await t('a local seller in another currency: Sydney (AUD) orders from Chennai (INR) — the chit is INR, whatever the sender’s money is', async () => {
    const st = await send({ seller: CHE_LOCAL });
    assert.strictEqual(st.currency_code, 'INR');
    assert.strictEqual(st.sellerId, CHE_LOCAL);
  });
  await t('…and the seller’s money beats a currency the buyer’s screen stated for itself (the seller’s price list is the seller’s)', async () => {
    const st = await send({ seller: CHE_LOCAL, stated: 'aud' });
    assert.strictEqual(st.currency_code, 'INR');
  });
  await t('a local seller whose row holds no currency: lib/regional.currencyFor, the one resolver, answers', async () => {
    const st = await send({ seller: CHE_BARE });
    assert.strictEqual(st.currency_code, 'INR');
    assert.deepStrictEqual(asked.regional, [CHE_BARE]);
  });
  await t('a REMOTE seller with a currency stated by the buyer’s screen: that currency (the seller’s, as its price list showed it) — the regional resolver is never asked about a stub', async () => {
    const st = await send({ seller: CHE_REMOTE, stated: 'inr' });
    assert.strictEqual(st.currency_code, 'INR');
    assert.deepStrictEqual(asked.regional, [], 'a stub holds no money on purpose: regional would invent this installation’s default');
    assert.deepStrictEqual(asked.resolve, [CHE_REMOTE]);
  });
  await t('a REMOTE seller with NO currency stated: REFUSED 400 CURRENCY_REQUIRED in a sentence, one problem shape — never filed in the SENDER’s money (F7, Athi 25 Oct: "if the stuff is not there, reject, do not fall back")', async () => {
    const out = await priced({ seller: CHE_REMOTE });
    assert.strictEqual(out.res.statusCode, 400);
    assert.strictEqual(out.res.body.code, 'CURRENCY_REQUIRED');
    assert.strictEqual(out.res.body.status, 400, 'the one problem shape carries its status');
    assert.strictEqual(out.res.body.detail, 'Say which money their price list is in, then send again.');
    assert.strictEqual(out.refused, true, 'the step answered, so the send pipeline stops before anything is written');
    assert.ok(!out.st.moneyBlock, 'no money block was filed for the chit');
    assert.deepStrictEqual(asked.regional, []);
  });
  await t('…a blank or whitespace currency is "not stated" too, and a business_json that is not an object states nothing', async () => {
    for (const bj of [{ currency: '' }, { currency: '   ' }, {}, null]) {
      const out = await priced({ seller: CHE_REMOTE, business_json: bj });
      assert.strictEqual(out.res.statusCode, 400, JSON.stringify(bj));
      assert.strictEqual(out.res.body.code, 'CURRENCY_REQUIRED');
    }
  });
  await t('…a draft is the author’s own copy and is let through; a REMOTE seller with a stated currency is NOT refused and the money block carries it', async () => {
    const draft = await priced({ seller: CHE_REMOTE, isDraft: true });
    assert.strictEqual(draft.refused, false);
    const stated = await priced({ seller: CHE_REMOTE, stated: 'inr' });
    assert.strictEqual(stated.refused, false);
    assert.strictEqual(stated.st.moneyBlock.currency_code, 'INR');
  });
  await t('…a LOCAL seller and a self-chit are never refused for want of a stated currency (this installation knows their money)', async () => {
    assert.strictEqual((await priced({ seller: CHE_LOCAL })).refused, false);
    assert.strictEqual((await priced({ seller: SYD })).refused, false);
  });
  await t('same currency and domestic sends are unchanged: an INR buyer ordering from an INR seller is INR', async () => {
    const st = await send({ seller: CHE_LOCAL, sender: CHE_BARE, senderMoney: 'INR' });
    assert.strictEqual(st.currency_code, 'INR');
  });
  await t('a self-chit, a counter bill and anything that is not an order never ask for a seller’s money (the till sends no currency and must not change)', async () => {
    const self = await send({ seller: SYD });
    assert.strictEqual(self.currency_code, 'AUD');
    assert.ok(!askedSellerMoney(), 'a self-chit: the sender sells to itself');
    const counter = await send({ seller: CHE_LOCAL, business_json: { bill_no: 'C2/26-27/0007', till: { id: 'T1' } }, senderMoney: 'AUD' });
    assert.strictEqual(counter.currency_code, 'AUD', 'a counter bill is sold by the counter’s shop, in its money');
    assert.ok(!askedSellerMoney());
    const bill = await send({ seller: CHE_LOCAL, purpose: 'invoice' });
    assert.strictEqual(bill.currency_code, 'AUD', 'an invoice is sold by its sender');
    assert.ok(!askedSellerMoney());
  });

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
