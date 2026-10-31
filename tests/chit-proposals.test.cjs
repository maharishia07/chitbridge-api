/**
 * tests/chit-proposals.test.cjs — RAIL-106 part 4: ONE proposal mechanism on ONE chit (Athi, 25 Oct 2026, DECISIONS 11:15 / 12:05 / 13:10).
 * The buyer's request is round 1 (the chit itself); the SELLER's priced reply — currency and tax by its own pack, computed at the seller — is round 2 on the SAME chit; the buyer accepts,
 * counters (a request, never a computation: round 3) or rejects; acceptance makes that round the pro-forma on BOTH copies, byte for byte. An amendment after agreement is the same flow.
 *
 *   H  THE GATE (DECISIONS 14:10): only an international deal (a party on another installation) or a chit composed as an RFQ uses rounds; a default domestic chit is amended directly as before
 *   A  ONE installation (two local parties, on a chit that also has a party elsewhere): the seller prices, the buyer's list shows it waiting, nothing of the agreed record moves until acceptance, accept switches both copies identically,
 *      a counter is never priced, reject changes nothing, a stale or replaced round is refused in words, the buyer's side never calls the tax engine
 *   B  TWO installations: the same flow, the proposal and the decision travel as events (lib/ctpreturn), the receiver stores the seller's invoice as issued, the invoices are byte-identical
 *   C  the fallback: a seller with no country states price and currency as entered and "Tax not decided", never a guessed tax
 *   D  the two jurisdictions: a quotation until accepted, the pro-forma after; the buyer's duty and taxes are never computed
 *   E  the bell: a proposal, accept, reject and counter ring the other party once, here and on arrival
 *
 * Offline: the database is an in-memory world per installation, the tax engine a recording stub. Run: node tests/chit-proposals.test.cjs
 */
'use strict';
const assert = require('assert');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.INSTALLATION_KEY = 'inst-A';
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
    console.log('   FAIL ' + name + '\n          ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n          ') : e));
  }
};

const BUY = 'b1111111-1111-4111-8111-111111111111';
const SELL = '5e111111-1111-4111-8111-111111111111';
const BUY_STUB = 'b2222222-2222-4222-8222-222222222222';
const SELL_STUB = '5e222222-2222-4222-8222-222222222222';
const CH = 'c0000000-0000-4000-8000-0000000000c1';
const L1 = 'e0000000-0000-4000-8000-0000000000e1';
const L2 = 'e0000000-0000-4000-8000-0000000000e2';
const B_BUY = 'CBBUY00001',
  B_SELL = 'CBSEL00001';

/* ── the worlds ────────────────────────────────────────────────────────────────────────────────────────── */
let CUR = null;
let CLOCK = 0;
const newWorld = (name, inst) => ({ name, inst, ident: {}, place: {}, header: {}, detail: {}, amend: [], lineIds: {}, props: [], log: [], out: [], inw: [], taxCalls: [] });
const one = (s) => String(s).replace(/\s+/g, ' ').trim();
const clone = (x) => JSON.parse(JSON.stringify(x));

function rowsFor(sql, p) {
  const w = CUR;
  const s = one(sql);
  p = p || [];
  if (/^SELECT sender_entity_id, purpose, business_json, summary_json, all_recipients FROM chit_header/.test(s)) return w.header[p[1]] ? [clone(w.header[p[1]])] : [];
  if (/^SELECT line_items, currency_code FROM chit_detail/.test(s)) return w.detail[p[1]] ? [clone(w.detail[p[1]])] : [];
  if (/^SELECT line_index, line_id, seq, line FROM chit_line_amendment WHERE entity_id = \$1 AND chit_id = \$2/.test(s)) return clone(w.amend.filter((a) => a.entity_id === p[0] && a.chit_id === p[1]));
  if (/^SELECT line_id FROM chit_line WHERE entity_id = \$1/.test(s)) return (w.lineIds[p[0]] || []).map((line_id) => ({ line_id }));
  if (/^SELECT \* FROM chit_proposal WHERE entity_id = \$1 AND chit_id = \$2 ORDER BY/.test(s)) return clone(w.props.filter((r) => r.entity_id === p[0] && r.chit_id === p[1]).sort((a, b) => a.created - b.created));
  if (/^SELECT \* FROM chit_proposal WHERE entity_id = \$1 AND chit_id = \$2 AND proposal_id = \$3/.test(s)) return clone(w.props.filter((r) => r.entity_id === p[0] && r.chit_id === p[1] && r.proposal_id === p[2]));
  if (/^INSERT INTO chit_proposal/.test(s)) {
    if (w.props.find((r) => r.proposal_id === p[0] && r.entity_id === p[1])) return [];
    const j = (x) => (x == null ? null : JSON.parse(x));
    w.props.push({ proposal_id: p[0], entity_id: p[1], chit_id: p[2], round: p[3], kind: p[4], from_entity_id: p[5], from_bridge_id: p[6], from_name: p[7], status: 'proposed', edits: j(p[8]), request: j(p[9]), invoice: j(p[10]), summary: j(p[11]), currency_code: p[12], tax_note: p[13], base_hash: p[14], note: p[15], terms: j(p[16]), created: ++CLOCK });
    return [];
  }
  if (/^UPDATE chit_proposal SET status = \$3, decided_at = now\(\), decided_by = \$4 WHERE entity_id = \$1 AND proposal_id = \$2 AND status = 'proposed'/.test(s)) {
    w.props.filter((r) => r.entity_id === p[0] && r.proposal_id === p[1] && r.status === 'proposed').forEach((r) => Object.assign(r, { status: p[2], decided_by: p[3] }));
    return [];
  }
  if (/^UPDATE chit_proposal SET status = 'accepted'/.test(s)) {
    w.props.filter((r) => r.entity_id === p[0] && r.chit_id === p[1] && r.proposal_id === p[2] && r.status === 'proposed').forEach((r) => Object.assign(r, { status: 'accepted', decided_by: p[3] }));
    return [];
  }
  if (/^UPDATE chit_proposal SET status = 'superseded', decided_at = now\(\) WHERE entity_id = \$1 AND chit_id = \$2 AND proposal_id <> \$3/.test(s)) {
    w.props.filter((r) => r.entity_id === p[0] && r.chit_id === p[1] && r.proposal_id !== p[2] && r.status === 'proposed').forEach((r) => (r.status = 'superseded'));
    return [];
  }
  if (/^UPDATE chit_header SET business_json = COALESCE\(business_json, '\{\}'::jsonb\) - 'invoice'/.test(s)) {
    const h = w.header[p[1]];
    const bj = Object.assign({}, h.business_json);
    if (p[2] == null) delete bj.invoice;
    else bj.invoice = JSON.parse(p[2]);
    h.business_json = bj;
    h.summary_json = Object.assign({}, h.summary_json, p[3] ? JSON.parse(p[3]) : {});
    return [];
  }
  if (/^UPDATE chit_header SET business_json = COALESCE\(business_json, '\{\}'::jsonb\) \|\| jsonb_build_object\('jurisdiction'/.test(s)) {
    const h = w.header[p[1]];
    h.business_json = Object.assign({}, h.business_json, { jurisdiction: Object.assign({}, (h.business_json || {}).jurisdiction, JSON.parse(p[2])) });
    return [];
  }
  if (/^UPDATE chit_header SET business_json = COALESCE\(business_json, '\{\}'::jsonb\) \|\| jsonb_build_object\('agreed'/.test(s)) {
    const h = w.header[p[1]];
    h.business_json = Object.assign({}, h.business_json, { agreed: JSON.parse(p[2]) });
    return [];
  }
  if (/^UPDATE chit_detail SET total_value/.test(s)) {
    Object.assign(w.detail[p[1]], { total_value: p[2], currency_code: p[3] || w.detail[p[1]].currency_code });
    return [];
  }
  if (/^INSERT INTO state_log/.test(s)) {
    w.log.push({ entity: p[1], action: p[2], detail: p[5] });
    return [];
  }
  if (/^INSERT INTO chit_line_amendment/.test(s)) {
    const seq = Math.max(0, ...w.amend.filter((a) => a.entity_id === p[1] && a.chit_id === p[0] && a.line_index === p[2]).map((a) => a.seq)) + 1;
    const row = { chit_id: p[0], entity_id: p[1], line_index: p[2], line_id: p[3], seq, line: p[4] == null ? null : JSON.parse(p[4]), reason_code: p[5], reason: p[6], actor_name: p[8] };
    w.amend.push(row);
    return [Object.assign({ amendment_id: 'am-' + w.amend.length, created_at: new Date() }, clone(row))];
  }
  if (/^SELECT COALESCE\(flags/.test(s)) return [{ flags: {}, particulars: 'x' }];
  if (/^UPDATE chit_line /.test(s)) return [];
  if (/chit_line_delivered_qty/.test(s)) return [];
  if (/^SELECT business_json FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2 LIMIT 1/.test(s)) return w.header[p[1]] ? [{ business_json: clone(w.header[p[1]].business_json) }] : [];
  if (/^SELECT role FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2$/.test(s)) return [{ role: 'sender' }];
  /* sit/run6 (RAIL-128, main): the amend door first asks whether I hold a copy (holdsCopy), before the rail's verdict */
  if (/^SELECT 1 FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2$/.test(s)) return w.header[p[1]] ? [{ held: 1 }] : [];
  if (/^SELECT bridge_id, display_name FROM identities WHERE identity_id = \$1/.test(s)) return w.ident[p[0]] ? [w.ident[p[0]]] : [];
  if (/^SELECT country, gstn FROM identities WHERE identity_id = \$1/.test(s)) return w.ident[p[0]] ? [{ country: w.ident[p[0]].country || null, gstn: null }] : [];
  if (/^SELECT identity_id, gstn, display_name, policy_flags, country FROM identities WHERE identity_id = ANY/.test(s)) return p[0][0] ? p[0].map((id) => w.ident[id]).filter(Boolean) : [];
  /* the return path */
  if (/^SELECT sender_entity_bridge_id, all_recipients FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2 LIMIT 1/.test(s)) return w.header[p[1]] ? [clone(w.header[p[1]])] : [];
  if (/FROM identities WHERE bridge_id = ANY/.test(s)) return Object.values(w.ident).filter((i) => p[0].includes(i.bridge_id));
  if (/^SELECT identity_id, display_name FROM identities WHERE bridge_id = \$1 AND identity_type = 'entity'/.test(s)) return Object.values(w.ident).filter((i) => i.bridge_id === p[0]);
  if (/pg_advisory_xact_lock/.test(s)) return [{}];
  if (/coalesce\(max\(seq\), 0\) \+ 1 AS seq FROM ctp_event_out/.test(s)) return [{ seq: Math.max(0, ...w.out.filter((r) => r.chit_id === p[0] && r.from_entity_id === p[1]).map((r) => r.seq)) + 1 }];
  if (/^INSERT INTO ctp_event_out/.test(s)) {
    w.out.push({ chit_id: p[0], from_entity_id: p[1], seq: p[2], kind: p[3], event: JSON.parse(p[4]), to_entity_id: p[5], to_bridge_id: p[6], status: 'pending' });
    return [];
  }
  if (/^SELECT last_seq FROM ctp_event_in/.test(s)) return w.inw.filter((r) => r.chit_id === p[0] && r.remote === p[1] && r.entity === p[2]).map((r) => ({ last_seq: r.last_seq }));
  if (/^INSERT INTO ctp_event_in/.test(s)) {
    const cur = w.inw.find((r) => r.chit_id === p[0] && r.remote === p[1] && r.entity === p[2]);
    if (cur && cur.last_seq >= p[3]) return [];
    if (cur) cur.last_seq = p[3];
    else w.inw.push({ chit_id: p[0], remote: p[1], entity: p[2], last_seq: p[3] });
    return [{ last_seq: p[3] }];
  }
  if (/^SELECT entity_id FROM chit_participants/.test(s)) return Object.keys(w.header).map((entity_id) => ({ entity_id }));
  return [];
}
const q = async (sql, p) => {
  const rows = rowsFor(sql, p);
  return { rows, rowCount: rows.length };
};
const tx = { query: q };
const stub = (file, exp) => {
  const id = require.resolve(root(file));
  require.cache[id] = { id, filename: id, loaded: true, exports: exp };
};
stub('db/index.js', {
  query: q,
  pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) },
  withEntity: async (id, fn) => fn(tx),
  withTransaction: async (fn) => fn(tx),
  onEntity: async (id, db, fn) => fn(tx),
  readBatch: async () => ({}),
  trySavepoint: async (db, fn, fb) => {
    try {
      return await fn(db);
    } catch (_) {
      return fb;
    }
  }
});
stub('lib/ctpaddress.js', {
  remoteInstallations: async () => (Object.keys(CUR.place).length ? new Map([['x', {}]]) : new Map()),
  resolve: async (id) => CUR.place[id] || { entity_id: id, local: true, installation_key: null, endpoint: null },
  resolveAll: async () => new Map(),
  peerByKey: async () => ({ peer: null, status: 403, why: 'stub' }),
  invalidate() {}
});
const sc = require(root('lib/schema'));
sc.hasTable = async () => true;
sc.hasColumn = async () => false;
const regional = require(root('lib/regional'));
regional.currencyFor = async (id) => (CUR.ident[id] && CUR.ident[id].currency) || null;
require(root('lib/books-hooks')).afterChit = () => Promise.resolve({});
const origErr = console.error;
console.error = () => {};

/* the tax engine: a recording stub — WHO asked is what is under test, not the rates */
const taxLines = require(root('lib/tax-lines'));
taxLines.invoiceFor = (inp) => {
  CUR.taxCalls.push({ world: CUR.name, seller: inp.seller && inp.seller.LglNm, buyer: inp.buyer && inp.buyer.LglNm });
  if (!(inp.seller && inp.seller.Country)) return { invoice: undefined };
  const net = inp.lines.reduce((sum, l) => sum + (Number(l.total != null ? l.total : l.price * l.quantity) || 0), 0);
  const tax = Math.round(net * 18) / 100;
  return {
    invoice: { stamped_by: inp.seller.LglNm, currency: inp.currency, ValDtls: { AssVal: net, Discount: 0, TaxVal: tax, TotInvVal: Math.round((net + tax) * 100) / 100 }, ItemList: inp.lines.map((l) => ({ TotAmt: Number(l.total != null ? l.total : l.price * l.quantity) })), _cb: { scheme: 'GST', supply: 'domestic', slabs: [] } }
  };
};
const chits = require(root('routes/chits'));
const ret = require(root('lib/ctpreturn'));
const proposals = require(root('lib/chit-proposal'));
const events = require(root('lib/events'));
const RUNG = [];
events.emit = (ids, evt) => {
  RUNG.push({ ids: [].concat(ids), evt });
  return ids.length;
};
const countCalls = () => ({ tax: [].concat(...Object.values(WORLDS).map((w) => w.taxCalls)).length });

/* ── scenes ────────────────────────────────────────────────────────────────────────────────────────────── */
const ITEMS = [
  { particulars: 'Pump seal', quantity: 10, unit: 'pc', price: 100, total: 1000, list_price: 100, gst_rate: 18 },
  { particulars: 'Gasket', quantity: 5, unit: 'pc', price: 20, total: 100, list_price: 20, gst_rate: 18 }
];
const WORLDS = {};
function copyOf(w, entity_id, recipients, senderId, senderBridge, extraBj) {
  w.header[entity_id] = {
    sender_entity_id: senderId,
    sender_entity_bridge_id: senderBridge,
    purpose: 'order',
    business_json: Object.assign({}, extraBj || {}),
    summary_json: { total_value: 1100, money: { gross: 1100, net: 1100, tax: null, total: null, provisional: true, currency_code: 'INR' } },
    all_recipients: recipients
  };
  w.detail[entity_id] = { line_items: clone(ITEMS), currency_code: 'INR', total_value: 1100 };
  w.lineIds[entity_id] = [L1, L2];
}
const person = (id, bridge, name, country, currency) => ({ identity_id: id, bridge_id: bridge, display_name: name, country, currency, policy_flags: {}, gstn: null });
const CC_STUB = 'cc222222-2222-4222-8222-222222222222';
/** ONE installation: both parties are rows of the same database. By default the chit ALSO names a party on another installation (so it is an international deal and uses rounds);
 *  opts.domestic leaves it between the two local parties; opts.dealType composes it as a proposal deal */
function oneInstallation(sellerCountry, opts) {
  const o = opts || {};
  const w = (WORLDS.one = newWorld('one', 'inst-A'));
  w.ident[BUY] = person(BUY, B_BUY, 'Chennai Stores', 'IN', 'INR');
  w.ident[SELL] = person(SELL, B_SELL, 'Sydney Spice', sellerCountry === undefined ? 'IN' : sellerCountry, 'INR');
  const recipients = [{ entity_id: BUY, bridge_id: B_BUY, role: 'sender' }, { entity_id: SELL, bridge_id: B_SELL, role: 'receiver' }];
  if (!o.domestic) {
    w.ident[CC_STUB] = person(CC_STUB, 'CBCC00001', 'Overseas Auditor', null, null);
    w.place[CC_STUB] = { local: false, installation_key: 'inst-C', endpoint: 'https://c.example/api/ctp/deliver' };
    recipients.push({ entity_id: CC_STUB, bridge_id: 'CBCC00001', role: 'cc' });
  }
  const extra = o.dealType ? { deal_type: o.dealType } : undefined;
  copyOf(w, BUY, recipients, BUY, B_BUY, extra);
  copyOf(w, SELL, recipients, BUY, B_BUY, extra);
  CUR = w;
  return w;
}
/** TWO installations: A holds the buyer, B the seller; each holds a stub of the other */
function twoInstallations(sellerCountry) {
  const A = (WORLDS.A = newWorld('A', 'inst-A'));
  const B = (WORLDS.B = newWorld('B', 'inst-B'));
  A.ident[BUY] = person(BUY, B_BUY, 'Chennai Stores', 'IN', 'INR');
  A.ident[SELL_STUB] = person(SELL_STUB, B_SELL, 'Sydney Spice', null, null);
  A.place[SELL_STUB] = { local: false, installation_key: 'inst-B', endpoint: 'https://b.example/api/ctp/deliver' };
  B.ident[SELL] = person(SELL, B_SELL, 'Sydney Spice', sellerCountry === undefined ? 'AU' : sellerCountry, 'AUD');
  B.ident[BUY_STUB] = person(BUY_STUB, B_BUY, 'Chennai Stores', null, null);
  B.place[BUY_STUB] = { local: false, installation_key: 'inst-A', endpoint: 'https://a.example/api/ctp/deliver' };
  const jur = { document: 'quotation', buyer_country: 'IN', buyer_installation: 'inst-A', seller_installation: 'inst-B', buyer_duty_and_taxes: 'not_included' };
  copyOf(A, BUY, [{ entity_id: BUY, bridge_id: B_BUY, role: 'sender' }, { entity_id: SELL_STUB, bridge_id: B_SELL, role: 'receiver' }], BUY, B_BUY, { jurisdiction: jur });
  copyOf(B, SELL, [{ entity_id: BUY_STUB, bridge_id: B_BUY, role: 'sender' }, { entity_id: SELL, bridge_id: B_SELL, role: 'receiver' }], BUY_STUB, B_BUY, { jurisdiction: jur });
  CUR = A;
  return { A, B };
}
/** carry every pending event of world `from` to world `to`, through the real applier (lib/ctpreturn apply), in order */
async function ship(from, to) {
  const results = [];
  for (const row of from.out.filter((r) => r.status === 'pending').sort((a, b) => a.seq - b.seq)) {
    CUR = to;
    const fromIdent = from.ident[row.from_entity_id];
    const local = Object.values(to.ident).find((i) => i.bridge_id === row.to_bridge_id);
    const result = await ret.apply({ chit_id: row.chit_id, event: Object.assign({}, row.event, { seq: row.seq }), from: { installation_key: from.inst, bridge_id: fromIdent.bridge_id, display_name: fromIdent.display_name }, to: { identity_id: local.identity_id } });
    results.push(result);
    if (result.ok) row.status = 'accepted';
  }
  CUR = from;
  return results;
}
const as = (w, fn) => {
  CUR = w;
  return fn();
};
const SELLER = { id: SELL, name: 'Sydney Spice' };
const BUYER = { id: BUY, name: 'Chennai Stores' };
const rowsOf = (w, entity) => w.props.filter((r) => r.entity_id === entity).sort((a, b) => a.created - b.created);
const price = (lines) => ({ lines, note: 'our price list' });

const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-proposals';
const app = express();
app.use(express.json());
app.use('/api/chits', chits);
const call = (method, url, id, body) =>
  new Promise((done) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      const data = JSON.stringify(body || {});
      const token = jwt.sign({ identity_id: id, identity_type: 'entity', display_name: 'who' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
      const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          srv.close();
          let j = {};
          try {
            j = JSON.parse(b);
          } catch (_) {
            /* not json */
          }
          done({ status: res.statusCode, body: j });
        });
      });
      r.end(data);
    });
  });

(async () => {
  console.log('\n== A · one installation, two local parties ==\n');
  await t('the seller prices the buyer’s request as round 2 on the SAME chit: both copies hold it, priced by the SELLER’s pack, and the agreed record has not moved', async () => {
    const w = oneInstallation();
    const out = await as(w, () => proposals.propose(SELL, CH, price([{ line_id: L1, price: 95 }, { line_id: L2, price: 22 }]), SELLER));
    assert.strictEqual(out.round, 2, 'the chit is round 1');
    assert.strictEqual(out.kind, 'pro_forma');
    assert.strictEqual(rowsOf(w, BUY).length, 1);
    assert.strictEqual(rowsOf(w, SELL).length, 1);
    assert.deepStrictEqual(rowsOf(w, BUY)[0].invoice, rowsOf(w, SELL)[0].invoice, 'one invoice, as the seller issued it');
    assert.strictEqual(rowsOf(w, BUY)[0].invoice.stamped_by, 'Sydney Spice');
    assert.deepStrictEqual(w.taxCalls.map((c) => [c.seller, c.buyer]), [['Sydney Spice', 'Chennai Stores']], 'the seller’s pack ran once, for the seller');
    assert.strictEqual(w.header[BUY].business_json.invoice, undefined, 'nothing is agreed yet');
    assert.strictEqual(w.header[BUY].summary_json.money.provisional, true);
    assert.strictEqual(w.amend.length, 0);
    const list = await as(w, () => proposals.list(BUY, CH));
    assert.strictEqual(list.proposals[0].awaiting_me, true);
    assert.strictEqual(list.proposals[0].label, 'Quotation');
    const mine = await as(w, () => proposals.list(SELL, CH));
    assert.strictEqual(mine.proposals[0].awaiting_me, false);
  });
  await t('the buyer COUNTERS (round 3): a request in text and numbers, never priced, the tax engine untouched; the seller prices round 4; the buyer accepts: both copies switch, byte for byte', async () => {
    const w = oneInstallation();
    await as(w, () => proposals.propose(SELL, CH, price([{ line_id: L1, price: 95 }, { line_id: L2, price: 22 }]), SELLER));
    const round2 = rowsOf(w, SELL)[0];
    const before = w.taxCalls.length;
    const counter = await as(w, () => proposals.propose(BUY, CH, { lines: [{ line_id: L1, quantity: 12, requested_price: 'about 90' }], note: 'can you do 90 for 12?' }, BUYER));
    assert.deepStrictEqual([counter.round, counter.kind], [3, 'request']);
    assert.strictEqual(w.taxCalls.length, before, 'a counter is a request, never a computation');
    assert.strictEqual(rowsOf(w, SELL).find((r) => r.proposal_id === round2.proposal_id).status, 'countered');
    assert.strictEqual(rowsOf(w, BUY).find((r) => r.proposal_id === round2.proposal_id).status, 'countered');
    const round4 = await as(w, () => proposals.propose(SELL, CH, price([{ line_id: L1, price: 90, quantity: 12 }, { line_id: L2, price: 22 }]), SELLER));
    assert.strictEqual(round4.round, 4);
    assert.strictEqual(rowsOf(w, BUY).find((r) => r.proposal_id === counter.proposal_id).status, 'superseded', 'the counter is answered');
    const taxBefore = w.taxCalls.length;
    const done = await as(w, () => proposals.decide(BUY, CH, round4.proposal_id, 'accept', BUYER, null));
    assert.deepStrictEqual([done.status, done.round], ['accepted', 4]);
    assert.strictEqual(w.taxCalls.length, taxBefore, '⭐ the buyer never calls the tax engine: accepting stores the seller’s version');
    const seller = w.header[SELL],
      buyer = w.header[BUY];
    assert.deepStrictEqual(buyer.business_json.invoice, seller.business_json.invoice, 'the invoice is byte for byte the same');
    assert.strictEqual(JSON.stringify(buyer.business_json.invoice), JSON.stringify(seller.business_json.invoice));
    assert.strictEqual(buyer.business_json.invoice.stamped_by, 'Sydney Spice');
    assert.deepStrictEqual(buyer.summary_json.money, seller.summary_json.money);
    assert.strictEqual(buyer.summary_json.money.issued, true);
    assert.strictEqual(buyer.summary_json.total_value, seller.summary_json.total_value);
    assert.strictEqual(w.detail[BUY].total_value, w.detail[SELL].total_value);
    for (const entity of [BUY, SELL]) {
      const chain = w.amend.filter((a) => a.entity_id === entity).map((a) => [a.line_index, a.line && a.line.price, a.line && a.line.quantity]);
      assert.deepStrictEqual(chain, [[0, 90, 12], [1, 22, 5]], 'both copies hold the accepted lines');
      assert.strictEqual(rowsOf(w, entity).find((r) => r.proposal_id === round4.proposal_id).status, 'accepted');
    }
    const list = await as(w, () => proposals.list(BUY, CH));
    assert.strictEqual(list.proposals.find((r) => r.round === 4).label, 'Pro-forma agreed');
    assert.ok(w.log.filter((x) => x.entity === BUY).some((x) => x.action === 'proposal_accepted'), 'every round is in the timeline');
  });
  await t('a rejection ends it: both copies say rejected and nothing of the agreed record changes', async () => {
    const w = oneInstallation();
    const round2 = await as(w, () => proposals.propose(SELL, CH, price([{ line_id: L1, price: 95 }]), SELLER));
    const header = clone(w.header[BUY]);
    const done = await as(w, () => proposals.decide(BUY, CH, round2.proposal_id, 'reject', BUYER, 'too dear'));
    assert.strictEqual(done.status, 'rejected');
    assert.deepStrictEqual([rowsOf(w, BUY)[0].status, rowsOf(w, SELL)[0].status], ['rejected', 'rejected']);
    assert.deepStrictEqual(w.header[BUY], header);
    assert.strictEqual(w.amend.length, 0);
    assert.ok(w.log.some((x) => x.action === 'proposal_rejected' && x.entity === SELL));
    const list = await as(w, () => proposals.list(SELL, CH));
    assert.strictEqual(list.proposals[0].label, 'Change rejected');
  });
  await t('a round that has been replaced, answered or whose lines moved is refused in words — a stale accept never goes through', async () => {
    const w = oneInstallation();
    const round2 = await as(w, () => proposals.propose(SELL, CH, price([{ line_id: L1, price: 95 }]), SELLER));
    const round3 = await as(w, () => proposals.propose(SELL, CH, price([{ line_id: L1, price: 93 }]), SELLER));
    await assert.rejects(as(w, () => proposals.decide(BUY, CH, round2.proposal_id, 'accept', BUYER)), (e) => e.status === 409 && e.code === 'PROPOSAL_CLOSED' && /already superseded/.test(e.message));
    /* the lines move under a proposal that is still open: the hash it was made against no longer matches */
    w.amend.push({ chit_id: CH, entity_id: BUY, line_index: 1, line_id: L2, seq: 1, line: { particulars: 'Gasket', quantity: 9, unit: 'pc', price: 20 } });
    await assert.rejects(as(w, () => proposals.decide(BUY, CH, round3.proposal_id, 'accept', BUYER)), (e) => e.status === 409 && e.code === 'PROPOSAL_STALE' && /changed since this was proposed/.test(e.message));
    assert.strictEqual(w.header[BUY].business_json.invoice, undefined, 'nothing was applied');
    await assert.rejects(as(w, () => proposals.decide(SELL, CH, round3.proposal_id, 'accept', SELLER)), (e) => e.status === 403 && e.code === 'PROPOSAL_NOT_YOURS');
    await assert.rejects(as(w, () => proposals.decide(BUY, CH, 'f0000000-0000-4000-8000-0000000000f0', 'accept', BUYER)), (e) => e.status === 404);
  });
  await t('a counter makes the priced round before it stale: accepting round 2 after a counter (round 3) is refused', async () => {
    const w = oneInstallation();
    const round2 = await as(w, () => proposals.propose(SELL, CH, price([{ line_id: L1, price: 95 }]), SELLER));
    await as(w, () => proposals.propose(BUY, CH, { lines: [{ line_id: L1, requested_price: '90' }] }, BUYER));
    await assert.rejects(as(w, () => proposals.decide(BUY, CH, round2.proposal_id, 'accept', BUYER)), (e) => e.status === 409 && /already countered/.test(e.message));
  });
  await t('a request is answered by pricing, not by accepting; an empty request and a bad price are refused in words', async () => {
    const w = oneInstallation();
    const asked = await as(w, () => proposals.propose(BUY, CH, { lines: [{ line_id: L1, quantity: 20 }] }, BUYER));
    await assert.rejects(as(w, () => proposals.decide(SELL, CH, asked.proposal_id, 'accept', SELLER)), (e) => e.status === 409 && /Answer it with a priced proposal/.test(e.message));
    await assert.rejects(as(w, () => proposals.propose(BUY, CH, { lines: [] }, BUYER)), (e) => e.status === 400 && e.code === 'PROPOSAL_BAD');
    await assert.rejects(as(w, () => proposals.propose(SELL, CH, price([{ line_id: L1, price: 'cheap' }]), SELLER)), (e) => e.status === 400);
  });
  console.log('\n== B · two installations: the same flow through the return path ==\n');
  await t('the seller on B prices; the proposal travels; A holds it as issued; the buyer accepts on A; the decision travels; both copies are byte-identical and the buyer’s installation never ran a tax rule', async () => {
    const { A, B } = twoInstallations();
    const round2 = await as(B, () => proposals.propose(SELL, CH, price([{ line_id: L1, price: 95 }, { line_id: L2, price: 22 }]), SELLER));
    assert.strictEqual(round2.round, 2);
    assert.strictEqual(B.out.filter((r) => r.kind === 'proposal').length, 1);
    assert.deepStrictEqual(A.props, []);
    const arrived = await ship(B, A);
    assert.ok(arrived[0].ok && arrived[0].applied, JSON.stringify(arrived));
    const onA = rowsOf(A, BUY)[0];
    assert.deepStrictEqual([onA.round, onA.kind, onA.status, onA.from_entity_id], [2, 'pro_forma', 'proposed', SELL_STUB], 'the proposer is the stub of the seller on A');
    assert.deepStrictEqual(onA.invoice, rowsOf(B, SELL)[0].invoice, 'stored as issued');
    assert.strictEqual(JSON.stringify(onA.summary), JSON.stringify(rowsOf(B, SELL)[0].summary));
    assert.strictEqual(A.taxCalls.length, 0, 'A ran no tax rule');
    assert.strictEqual(B.taxCalls.length, 1);
    assert.strictEqual(A.header[BUY].business_json.invoice, undefined, 'not agreed yet');
    const accepted = await as(A, () => proposals.decide(BUY, CH, onA.proposal_id, 'accept', BUYER));
    assert.strictEqual(accepted.status, 'accepted');
    assert.strictEqual(accepted.ctp.queued, 1);
    const back = await ship(A, B);
    assert.ok(back[0].ok && back[0].applied, JSON.stringify(back));
    assert.strictEqual(JSON.stringify(A.header[BUY].business_json.invoice), JSON.stringify(B.header[SELL].business_json.invoice), 'ValDtls and all: byte for byte');
    assert.deepStrictEqual(A.header[BUY].summary_json.money, B.header[SELL].summary_json.money);
    assert.strictEqual(A.header[BUY].summary_json.money.currency_code, 'AUD', 'the seller’s currency on BOTH copies; nothing converted');
    assert.strictEqual(A.detail[BUY].currency_code, 'AUD');
    assert.strictEqual(B.detail[SELL].currency_code, 'AUD');
    assert.deepStrictEqual(A.amend.map((x) => [x.line_index, x.line.price]), B.amend.map((x) => [x.line_index, x.line.price]));
    assert.strictEqual(A.taxCalls.length, 0, 'still none on A');
    assert.strictEqual(rowsOf(B, SELL)[0].status, 'accepted');
    assert.strictEqual(rowsOf(A, BUY)[0].status, 'accepted');
  });
  await t('rounds across the wire: seller round 2, buyer counter round 3 on A, seller round 4 on B, accept — each round in both timelines, the counter never priced on A', async () => {
    const { A, B } = twoInstallations();
    await as(B, () => proposals.propose(SELL, CH, price([{ line_id: L1, price: 95 }]), SELLER));
    await ship(B, A);
    const counter = await as(A, () => proposals.propose(BUY, CH, { lines: [{ line_id: L1, quantity: 12, requested_price: '90 AUD' }], note: 'for 12?' }, BUYER));
    assert.deepStrictEqual([counter.round, counter.kind], [3, 'request']);
    assert.strictEqual(A.taxCalls.length, 0);
    await ship(A, B);
    const onB = rowsOf(B, SELL);
    assert.deepStrictEqual(onB.map((r) => [r.round, r.kind, r.status]), [[2, 'pro_forma', 'countered'], [3, 'request', 'proposed']]);
    assert.deepStrictEqual(onB[1].request.lines[0].requested_price, '90 AUD', 'kept as text, as asked');
    const round4 = await as(B, () => proposals.propose(SELL, CH, price([{ line_id: L1, price: 90, quantity: 12 }]), SELLER));
    assert.strictEqual(round4.round, 4);
    await ship(B, A);
    assert.deepStrictEqual(rowsOf(A, BUY).map((r) => [r.round, r.status]), [[2, 'countered'], [3, 'superseded'], [4, 'proposed']]);
    await as(A, () => proposals.decide(BUY, CH, round4.proposal_id, 'accept', BUYER));
    await ship(A, B);
    assert.strictEqual(JSON.stringify(A.header[BUY].business_json.invoice), JSON.stringify(B.header[SELL].business_json.invoice));
    assert.strictEqual(A.taxCalls.length, 0);
    for (const [w, entity] of [[A, BUY], [B, SELL]]) assert.deepStrictEqual(w.log.filter((x) => x.entity === entity && /^proposal_/.test(x.action)).map((x) => x.action), w === A ? ['proposal_proposed', 'proposal_proposed', 'proposal_proposed', 'proposal_accepted'] : ['proposal_proposed', 'proposal_proposed', 'proposal_proposed', 'proposal_accepted']);
  });
  await t('a rejection across the wire closes it on both; a repeated event changes nothing; a decision that arrives before its proposal is refused so the sender tries again', async () => {
    const { A, B } = twoInstallations();
    const round2 = await as(B, () => proposals.propose(SELL, CH, price([{ line_id: L1, price: 95 }]), SELLER));
    const early = await as(A, () => ret.apply({ chit_id: CH, event: { kind: 'proposal_decide', seq: 9, proposal_id: round2.proposal_id, decision: 'reject' }, from: { installation_key: 'inst-B', bridge_id: B_SELL, display_name: 'Sydney Spice' }, to: { identity_id: BUY } }));
    assert.ok(!early.ok && early.status === 404 && early.code === 'CTP_EVENT_NOT_YET', JSON.stringify(early));
    await ship(B, A);
    const rejected = await as(A, () => proposals.decide(BUY, CH, round2.proposal_id, 'reject', BUYER, 'no'));
    assert.strictEqual(rejected.status, 'rejected');
    await ship(A, B);
    assert.deepStrictEqual([rowsOf(A, BUY)[0].status, rowsOf(B, SELL)[0].status], ['rejected', 'rejected']);
    const again = await as(B, () => ret.apply({ chit_id: CH, event: Object.assign({}, A.out[0].event, { seq: A.out[0].seq }), from: { installation_key: 'inst-A', bridge_id: B_BUY, display_name: 'Chennai Stores' }, to: { identity_id: SELL } }));
    assert.ok(again.ok && again.applied === false, 'older or repeated is ignored');
    assert.strictEqual(B.header[SELL].business_json.invoice, undefined);
  });

  console.log('\n== C · a seller with no country: price and currency as entered, tax not decided, in words ==\n');
  await t('no pack, no guess: the proposal carries the prices and the currency and says "Tax not decided"; the tax figure is null, never 0', async () => {
    const w = oneInstallation(null);
    const out = await as(w, () => proposals.propose(SELL, CH, Object.assign(price([{ line_id: L1, price: 95 }]), { currency_code: 'sgd' }), SELLER));
    assert.strictEqual(out.money.tax, null);
    assert.strictEqual(out.money.total, null);
    assert.strictEqual(out.money.tax_state, 'not_decided');
    assert.strictEqual(out.money.currency_code, 'SGD');
    assert.ok(/^Tax not decided: /.test(out.tax_note), out.tax_note);
    const row = rowsOf(w, BUY)[0];
    assert.strictEqual(row.invoice, null);
    assert.strictEqual(row.currency_code, 'SGD');
    await as(w, () => proposals.decide(BUY, CH, row.proposal_id, 'accept', BUYER));
    assert.strictEqual(w.header[BUY].business_json.invoice, undefined, 'no invoice is invented');
    assert.strictEqual(w.header[BUY].summary_json.money.tax, null);
    assert.strictEqual(w.detail[BUY].currency_code, 'SGD');
  });

  console.log('\n== D · two jurisdictions: a quotation until accepted, the pro-forma after ==\n');
  await t('the chit carries both countries; every round before acceptance is a quotation priced under the seller’s rules, with the buyer’s duty and taxes not included; the accepted round is the pro-forma', async () => {
    const { A, B } = twoInstallations();
    const round2 = await as(B, () => proposals.propose(SELL, CH, price([{ line_id: L1, price: 95 }]), SELLER));
    const list = await as(B, () => proposals.list(SELL, CH));
    assert.deepStrictEqual(
      { document: list.proposals[0].jurisdiction.document, seller_country: list.proposals[0].jurisdiction.seller_country, buyer_country: list.proposals[0].jurisdiction.buyer_country, duty: list.proposals[0].jurisdiction.buyer_duty_and_taxes, currency: list.proposals[0].jurisdiction.seller_currency },
      { document: 'quotation', seller_country: 'AU', buyer_country: 'IN', duty: 'not_included', currency: 'AUD' }
    );
    assert.strictEqual(B.header[SELL].business_json.jurisdiction.document, 'quotation');
    assert.strictEqual(A.header[BUY].business_json.jurisdiction.document, 'quotation');
    await ship(B, A);
    await as(A, () => proposals.decide(BUY, CH, round2.proposal_id, 'accept', BUYER));
    await ship(A, B);
    for (const [w, entity] of [[A, BUY], [B, SELL]]) {
      const j = w.header[entity].business_json.jurisdiction;
      assert.deepStrictEqual([j.document, j.seller_country, j.buyer_country, j.buyer_duty_and_taxes], ['pro_forma', 'AU', 'IN', 'not_included'], w.name);
      assert.ok(!('jurisdiction' in w.header[entity].summary_json), 'the jurisdiction is on business_json, not in the money');
    }
  });
  await t('at send, a seller on another installation is not priced by the buyer’s installation: no tax rule runs, and the request is stamped a quotation with the buyer’s country', async () => {
    const { A } = twoInstallations();
    /* F7: a seller elsewhere needs the money stated by the buyer's screen (else 400 CURRENCY_REQUIRED) */
    const st = { sender_id: BUY, line_items: clone(ITEMS), business_json: { currency: 'INR' }, currency_code: 'INR', orderLike: true, toIds: [SELL_STUB], counterBill: false, sellerId: SELL_STUB };
    CUR = A;
    await chits.sendMoney(st, { body: {} }, {});
    assert.strictEqual(A.taxCalls.length, 0, 'the buyer’s installation ran no tax of its own on someone else’s goods');
    assert.strictEqual(st.originInvoice, null);
    assert.strictEqual(st.moneyBlock.tax, null);
    assert.deepStrictEqual([st.business_json.jurisdiction.document, st.business_json.jurisdiction.seller_installation, st.business_json.jurisdiction.buyer_duty_and_taxes], ['quotation', 'inst-B', 'not_included']);
    const local = oneInstallation();
    const st2 = { sender_id: BUY, line_items: clone(ITEMS), business_json: {}, currency_code: 'INR', orderLike: true, toIds: [SELL], counterBill: false, sellerId: SELL };
    CUR = local;
    await chits.sendMoney(st2, { body: {} }, {});
    assert.strictEqual(local.taxCalls.length, 1, 'a seller on the same installation is priced at send as before');
    assert.strictEqual(st2.business_json.jurisdiction, undefined);
  });

  console.log('\n== H · the gate: international trade is a deal type (DECISIONS 14:10) ==\n');
  await t('a DEFAULT domestic chit (two local parties) takes no proposal: refused in words, no row written', async () => {
    const w = oneInstallation(undefined, { domestic: true });
    for (const input of [price([{ line_id: L1, price: 95 }]), { lines: [{ line_id: L1, quantity: 3 }] }, { terms: { date: '2026-11-03' } }]) {
      await assert.rejects(as(w, () => proposals.propose(SELL, CH, input, SELLER)), (e) => e.status === 409 && e.code === 'PROPOSAL_DOMESTIC' && /change it directly/.test(e.message));
    }
    assert.strictEqual(w.props.length, 0);
    assert.strictEqual(await as(w, () => proposals.usesRfq(BUY, CH)), false);
    assert.strictEqual(await as(w, () => proposals.isInternationalDeal(BUY, CH)), false);
  });
  await t('a DEFAULT domestic chit is amended DIRECTLY, as on main: the amendments are recorded on the amender’s copy, nothing proposed, the agreed record is the amended one', async () => {
    const w = oneInstallation(undefined, { domestic: true });
    const r = await call('POST', '/api/chits/' + CH + '/amend', SELL, { edits: [{ line_index: 0, line_id: L1, line: { particulars: 'Pump seal', quantity: 10, unit: 'pc', price: 96 }, reason_code: 'rate_agreed' }] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.proposed, undefined);
    assert.strictEqual(r.body.proposal, undefined);
    assert.strictEqual(r.body.amendments.length, 1, 'the direct answer: the amendment itself');
    assert.strictEqual(w.props.length, 0, 'no chit_proposal row');
    assert.deepStrictEqual(w.amend.map((x) => [x.entity_id, x.line_index, x.line.price]), [[SELL, 0, 96]], 'on the amender’s own copy only, exactly as before');
    assert.strictEqual(w.out.length, 0, 'nothing queued: nobody is elsewhere');
    assert.strictEqual(w.taxCalls.length, 0);
    const list = await call('POST', '/api/chits/' + CH + '/proposals', SELL, price([{ line_id: L1, price: 95 }]));
    assert.strictEqual(list.status, 409);
    assert.strictEqual(list.body.code, 'PROPOSAL_DOMESTIC');
  });
  await t('a domestic chit composed as an RFQ (business_json.deal_type rfq, "Ask for a quote") uses rounds like an international one: the amend door proposes, both local copies hold the round, accept switches both', async () => {
    const w = oneInstallation(undefined, { domestic: true, dealType: 'rfq' });
    assert.strictEqual(await as(w, () => proposals.usesRfq(BUY, CH)), true);
    assert.strictEqual(await as(w, () => proposals.isInternationalDeal(BUY, CH)), false, 'domestic, and still a proposal deal');
    const r = await call('POST', '/api/chits/' + CH + '/amend', SELL, { edits: [{ line_index: 0, line_id: L1, line: { particulars: 'Pump seal', quantity: 10, unit: 'pc', price: 96 }, reason_code: 'rate_agreed' }] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.proposed, r.body.proposal.round, r.body.proposal.kind], [true, 2, 'pro_forma']);
    assert.strictEqual(w.amend.length, 0);
    assert.deepStrictEqual([rowsOf(w, BUY).length, rowsOf(w, SELL).length], [1, 1]);
    const done = await as(w, () => proposals.decide(BUY, CH, r.body.proposal.proposal_id, 'accept', BUYER));
    assert.strictEqual(done.status, 'accepted');
    assert.strictEqual(JSON.stringify(w.header[BUY].business_json.invoice), JSON.stringify(w.header[SELL].business_json.invoice));
    assert.deepStrictEqual(w.amend.map((x) => x.entity_id).sort(), [BUY, SELL].sort());
    /* money-free too */
    const terms = await as(w, () => proposals.propose(BUY, CH, { terms: { date: '2026-11-03' } }, BUYER));
    assert.strictEqual(terms.kind, 'terms');
    /* the status and dispute bells ring on it, as on an international deal */
    RUNG.length = 0;
    const header = { rows: [w.header[BUY]] };
    void header;
  });
  await t('the gate reads the value exactly: any deal_type other than "rfq" is a default domestic chit', async () => {
    for (const dealType of ['RFQ', 'rfq ', 'proposal', 'quote', true]) {
      const w = oneInstallation(undefined, { domestic: true, dealType });
      assert.strictEqual(await as(w, () => proposals.usesRfq(BUY, CH)), false, String(dealType));
    }
  });
  await t('a chit with a party on another installation still proposes, with no deal_type at all; terms cross only there', async () => {
    const { A, B } = twoInstallations();
    assert.strictEqual(A.header[BUY].business_json.deal_type, undefined);
    assert.strictEqual(await as(A, () => proposals.isInternationalDeal(BUY, CH)), true);
    assert.strictEqual(await as(B, () => proposals.isInternationalDeal(SELL, CH)), true);
    const terms = await as(A, () => proposals.propose(BUY, CH, { terms: { date: '2026-11-03' } }, BUYER));
    assert.strictEqual(terms.kind, 'terms');
    await ship(A, B);
    assert.strictEqual(rowsOf(B, SELL).length, 1);
  });

  console.log('\n== F · money-free: a date and a scope between two teams ==\n');
  await t('two installations agree a task with NO money: either party proposes terms, the other counters, then agrees; business_json.agreed is identical; no tax, no currency, no seller, no jurisdiction', async () => {
    const { A, B } = twoInstallations();
    for (const w of [A, B]) {
      for (const h of Object.values(w.header)) {
        h.purpose = 'task';
        h.business_json = {};
        h.summary_json = {};
      }
      for (const d of Object.values(w.detail)) Object.assign(d, { line_items: [], currency_code: null, total_value: 0 });
    }
    const first = await as(A, () => proposals.propose(BUY, CH, { terms: { date: '2026-11-03', scope: 'Install the pump at the Pune plant' }, note: 'can your team do it Monday?' }, BUYER));
    assert.deepStrictEqual([first.round, first.kind, first.money, first.tax_note], [2, 'terms', null, null]);
    await ship(A, B);
    assert.deepStrictEqual(rowsOf(B, SELL).map((r) => [r.round, r.kind, r.status, r.terms.date]), [[2, 'terms', 'proposed', '2026-11-03']]);
    const counter = await as(B, () => proposals.propose(SELL, CH, { terms: { date: '2026-11-05', scope: 'Install the pump at the Pune plant' } }, SELLER));
    assert.strictEqual(counter.round, 3);
    assert.strictEqual(rowsOf(B, SELL)[0].status, 'countered', 'the other side’s round is answered');
    await ship(B, A);
    assert.deepStrictEqual(rowsOf(A, BUY).map((r) => [r.round, r.status]), [[2, 'countered'], [3, 'proposed']]);
    const done = await as(A, () => proposals.decide(BUY, CH, counter.proposal_id, 'accept', BUYER));
    assert.strictEqual(done.status, 'accepted');
    await ship(A, B);
    for (const [w, entity] of [[A, BUY], [B, SELL]]) {
      const agreed = w.header[entity].business_json.agreed;
      assert.deepStrictEqual([agreed.round, agreed.terms.date, agreed.terms.scope], [3, '2026-11-05', 'Install the pump at the Pune plant'], w.name);
      assert.strictEqual(w.header[entity].business_json.invoice, undefined);
      assert.strictEqual(w.header[entity].business_json.jurisdiction, undefined);
      assert.deepStrictEqual(w.header[entity].summary_json, {});
      assert.strictEqual(w.taxCalls.length, 0, 'no tax rule ran anywhere');
      assert.strictEqual(w.amend.length, 0);
      assert.strictEqual(rowsOf(w, entity).find((r) => r.round === 3).status, 'accepted');
    }
    assert.strictEqual(JSON.stringify(A.header[BUY].business_json.agreed.terms), JSON.stringify(B.header[SELL].business_json.agreed.terms));
    const list = await as(A, () => proposals.list(BUY, CH));
    assert.strictEqual(list.proposals.find((r) => r.round === 3).label, 'Terms agreed');
    assert.strictEqual(list.proposals.find((r) => r.round === 3).money, null);
  });
  await t('a money-free round can be rejected, an empty one is refused in words, and a stale one (the terms changed meanwhile) is refused', async () => {
    const { A, B } = twoInstallations();
    for (const w of [A, B]) for (const h of Object.values(w.header)) h.purpose = 'task';
    await assert.rejects(as(A, () => proposals.propose(BUY, CH, { terms: {} }, BUYER)), (e) => e.status === 400 && /Say what you are proposing/.test(e.message));
    const r2 = await as(A, () => proposals.propose(BUY, CH, { terms: { date: '2026-11-03' } }, BUYER));
    await ship(A, B);
    const rejected = await as(B, () => proposals.decide(SELL, CH, r2.proposal_id, 'reject', SELLER, 'not that week'));
    assert.strictEqual(rejected.status, 'rejected');
    await ship(B, A);
    assert.deepStrictEqual([rowsOf(A, BUY)[0].status, rowsOf(B, SELL)[0].status], ['rejected', 'rejected']);
    assert.strictEqual(A.header[BUY].business_json.agreed, undefined);
    const r3 = await as(A, () => proposals.propose(BUY, CH, { terms: { date: '2026-11-10' } }, BUYER));
    await ship(A, B);
    B.header[SELL].business_json = Object.assign({}, B.header[SELL].business_json, { agreed: { round: 99, terms: { date: 'other' } } });
    await assert.rejects(as(B, () => proposals.decide(SELL, CH, r3.proposal_id, 'accept', SELLER)), (e) => e.status === 409 && e.code === 'PROPOSAL_STALE');
  });

  console.log('\n== G · the amend door is the proposal mechanism ==\n');
  await t('POST /amend on a chit with another party PROPOSES (the seller prices it, the buyer asks) and the agreed record does not move; the proposals door lists, accepts and refuses in words', async () => {
    const w = oneInstallation();
    CUR = w;
    const seller = await call('POST', '/api/chits/' + CH + '/amend', SELL, { edits: [{ line_index: 0, line_id: L1, line: { particulars: 'Pump seal', quantity: 10, unit: 'pc', price: 96 }, reason_code: 'rate_agreed' }] });
    assert.strictEqual(seller.status, 200, JSON.stringify(seller.body));
    assert.deepStrictEqual([seller.body.proposed, seller.body.proposal.kind, seller.body.proposal.round, seller.body.amendments], [true, 'pro_forma', 2, []]);
    assert.strictEqual(w.amend.length, 0, 'the agreed lines have not moved');
    const listed = await call('GET', '/api/chits/' + CH + '/proposals', BUY);
    assert.strictEqual(listed.status, 200);
    assert.deepStrictEqual([listed.body.proposals.length, listed.body.proposals[0].awaiting_me, listed.body.proposals[0].label], [1, true, 'Quotation']);
    const asked = await call('POST', '/api/chits/' + CH + '/amend', BUY, { edits: [{ line_index: 1, line: { particulars: 'Gasket', quantity: 8, price: 18 }, reason_code: 'rate_agreed' }] });
    assert.strictEqual(asked.body.proposal.kind, 'request', JSON.stringify(asked.body));
    const stale = await call('POST', '/api/chits/' + CH + '/proposals/' + seller.body.proposal.proposal_id + '/accept', BUY, {});
    assert.strictEqual(stale.status, 409, JSON.stringify(stale.body));
    assert.strictEqual(stale.body.code, 'PROPOSAL_CLOSED');
    assert.ok(/already countered/.test(stale.body.message || stale.body.detail), JSON.stringify(stale.body));
    const missing = await call('POST', '/api/chits/' + CH + '/proposals/f0000000-0000-4000-8000-0000000000f0/reject', BUY, {});
    assert.strictEqual(missing.status, 404);
  });

  console.log('\n== E · the bell ==\n');
  await t('a proposal, an accept, a reject and a counter each ring the other party ONCE, here', async () => {
    const w = oneInstallation();
    RUNG.length = 0;
    const r2 = await as(w, () => proposals.propose(SELL, CH, price([{ line_id: L1, price: 95 }]), SELLER));
    assert.deepStrictEqual(RUNG.map((x) => [x.ids, x.evt.kind, x.evt.what]), [[[BUY], 'proposal', 'proposed']]);
    RUNG.length = 0;
    await as(w, () => proposals.propose(BUY, CH, { lines: [{ line_id: L1, requested_price: '90' }] }, BUYER));
    assert.deepStrictEqual(RUNG.map((x) => [x.ids, x.evt.what]), [[[SELL], 'countered']]);
    RUNG.length = 0;
    const r4 = await as(w, () => proposals.propose(SELL, CH, price([{ line_id: L1, price: 90 }]), SELLER));
    RUNG.length = 0;
    await as(w, () => proposals.decide(BUY, CH, r4.proposal_id, 'accept', BUYER));
    assert.deepStrictEqual(RUNG.map((x) => [x.ids, x.evt.what]), [[[SELL], 'accepted']]);
    const w2 = oneInstallation();
    const r = await as(w2, () => proposals.propose(SELL, CH, price([{ line_id: L1, price: 95 }]), SELLER));
    RUNG.length = 0;
    await as(w2, () => proposals.decide(BUY, CH, r.proposal_id, 'reject', BUYER));
    assert.deepStrictEqual(RUNG.map((x) => [x.ids, x.evt.what]), [[[SELL], 'rejected']]);
    void r2;
  });
  await t('…and on arrival from another installation, once (a repeated event rings nothing)', async () => {
    const { A, B } = twoInstallations();
    RUNG.length = 0;
    const r2 = await as(B, () => proposals.propose(SELL, CH, price([{ line_id: L1, price: 95 }]), SELLER));
    assert.strictEqual(RUNG.length, 0, 'nobody on B but the proposer');
    await ship(B, A);
    assert.deepStrictEqual(RUNG.map((x) => [x.ids, x.evt.kind, x.evt.what]), [[[BUY], 'proposal', 'proposed']]);
    B.out[0].status = 'pending';
    RUNG.length = 0;
    await ship(B, A);
    assert.strictEqual(RUNG.length, 0, 'older or repeated is ignored, and silent');
    RUNG.length = 0;
    await as(A, () => proposals.decide(BUY, CH, r2.proposal_id, 'accept', BUYER));
    await ship(A, B);
    assert.deepStrictEqual(RUNG.map((x) => [x.ids, x.evt.kind, x.evt.what]), [[[SELL], 'proposal', 'accepted']]);
  });

  console.error = origErr;
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  void countCalls;
  process.exit(fail ? 1 : 0);
})();
