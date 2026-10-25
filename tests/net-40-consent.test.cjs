/**
 * tests/net-40-consent.test.cjs — NET-40: BECOMING A CUSTOMER NEEDS THE CUSTOMER'S WILL (Athi, 2026-10-25: "adding someone as a supplier is fine,
 * but to be a customer, customer should be willing").
 *
 * The seller INVITES a business (an ordinary chit: purpose general, business_json.invite); the seller's customer_list row is written by ONE hook
 * (lib/customer-invite.afterStatus) when the invitee's copy reaches `accepted` - called after the one status writer (moveStatus) on one installation, and
 * after the status event is applied (lib/ctpreturn) when the invitee answered on another. The hook is the same function either way.
 *
 *   1  inviting: a business on the rail is never added - no row, an invitation is sent (and answered in words); a walk-in name still adds at once
 *   2  the invitation held by both; re-inviting while one waits -> 409 in words
 *   3  accept -> a row on the seller only; accept twice -> one row; decline -> no row, said in words; withdrawn invitation -> no row
 *   4  the same hook on one installation and on two (the status event path), identical rows
 *   5  the sender's own writes: an ordinary send to a non-customer makes no row (it counts a customer that exists); the buyer's order still gives the seller a row
 *   6  before b795 the row is written as 'manual' (the CHECK refuses the new word), never lost
 *
 * Offline: database, address book, transport are stubs. Run: node tests/net-40-consent.test.cjs
 */
'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-net-40';
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
process.env.INSTALLATION_KEY = 'sit-in';
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

const SELLER = '11111111-1111-4111-8111-111111111111'; /* the business that invites (sit-in) */
const BUYER = '22222222-2222-4222-8222-222222222222'; /* a business on the same installation */
const STUB = '33333333-3333-4333-8333-333333333333'; /* the stub, here, of a business on sit-au */
const OTHER = '44444444-4444-4444-8444-444444444444'; /* a business that was never invited */
const CHIT = 'c0000000-0000-4000-8000-0000000000c1';
const B_SELLER = 'CBSELL001A',
  B_BUYER = 'CBBUYR001B',
  B_STUB = 'CBAU00001C',
  B_OTHER = 'CBOTHR001D';
const INVITE_BJ = { kind: 'customer_invite', invite: { for: 'customer', words: 'Mayur invites you to be their customer.' } };

let W;
let ENT = null;
const resetWorld = () => {
  W = {
    rec: [],
    ident: {
      [SELLER]: { identity_id: SELLER, bridge_id: B_SELLER, display_name: 'Mayur Traders', user_id: 'mayur' },
      [BUYER]: { identity_id: BUYER, bridge_id: B_BUYER, display_name: 'Chola Auto Care', user_id: 'chola' },
      [STUB]: { identity_id: STUB, bridge_id: B_STUB, display_name: 'AU Pumps', user_id: 'aupumps' },
      [OTHER]: { identity_id: OTHER, bridge_id: B_OTHER, display_name: 'Ravi Stores', user_id: 'ravi' }
    },
    customers: {} /* `${owner}|${customer}` -> { added_via, txn_count } */,
    suppliers: new Set(),
    headers: [] /* { chit_id, entity_id, sender_entity_id, purpose, business_json, all_recipients } */,
    status: [] /* { chit_id, entity_id, direction, current_status } */,
    out: [],
    inw: [],
    place: {},
    sent: [] /* what the invitation sender was asked to send */,
    noInviteWord: false /* b795 not run: the CHECK refuses 'invite' */
  };
};
resetWorld();
const one = (s) => String(s).replace(/\s+/g, ' ').trim();
const custKey = (o, c) => o + '|' + c;
const headerOf = (chit, entity) => W.headers.find((h) => h.chit_id === chit && h.entity_id === entity);
const statusOf = (chit, entity, dir) => W.status.find((r) => r.chit_id === chit && r.entity_id === entity && (!dir || r.direction === dir));

function rowsFor(sql, p) {
  const s = one(sql);
  p = p || [];
  W.rec.push({ s, p, ent: ENT });
  if (/to_regprocedure/.test(s)) return [{ ok: true }];
  /* the route: who is the handle, are they listed, who am I */
  if (/^SELECT identity_id, display_name, user_id, bridge_id FROM identities WHERE \(bridge_id = \$1/.test(s))
    return Object.values(W.ident).filter((i) => i.bridge_id === p[0] || String(i.user_id).toLowerCase() === String(p[0]).toLowerCase());
  if (/^SELECT display_name FROM identities WHERE identity_id = \$1$/.test(s)) return W.ident[p[0]] ? [{ display_name: W.ident[p[0]].display_name }] : [];
  if (/^SELECT 1 FROM customer_list WHERE owner_entity_id = \$1 AND customer_identity_id = \$2$/.test(s)) return W.customers[custKey(p[0], p[1])] ? [{ '?column?': 1 }] : [];
  if (/^SELECT 1 FROM supplier_list WHERE owner_entity_id = \$1 AND supplier_entity_id = \$2/.test(s)) return W.suppliers.has(custKey(p[0], p[1])) ? [{}] : [];
  /* the invitations a seller sent, with the invitee's status */
  if (/FROM \(SELECT chit_id, created_at FROM chit_header/.test(s)) {
    const out = [];
    for (const h of W.headers.filter((x) => x.entity_id === p[0] && x.sender_entity_id === p[0] && x.purpose === 'general' && x.business_json && x.business_json.invite)) {
      for (const st of W.status.filter((r) => r.chit_id === h.chit_id && r.entity_id !== p[0])) {
        out.push({ chit_id: h.chit_id, created_at: new Date(), customer_id: st.entity_id, display_name: W.ident[st.entity_id].display_name, bridge_id: W.ident[st.entity_id].bridge_id, current_status: st.current_status });
      }
    }
    return out;
  }
  /* the hook's one read of the seller's own copy */
  if (/FROM chit_header h JOIN chit_status s ON s.chit_id = h.chit_id AND s.entity_id = h.entity_id/.test(s)) {
    const h = headerOf(p[0], p[1]);
    const st = statusOf(p[0], p[1]);
    return h && st ? [{ sender_entity_id: h.sender_entity_id, purpose: h.purpose, business_json: h.business_json, all_recipients: h.all_recipients, current_status: st.current_status }] : [];
  }
  /* the customer row */
  if (/^INSERT INTO customer_list/.test(s)) {
    const via = (s.match(/'entity', '(\w+)'/) || [])[1];
    if (via === 'invite' && W.noInviteWord) throw Object.assign(new Error('customer_list_added_via_check'), { code: '23514' });
    if (W.customers[custKey(p[0], p[1])]) return [];
    W.customers[custKey(p[0], p[1])] = { added_via: via, txn_count: 0 };
    return [{ customer_list_id: 1 }];
  }
  if (/^UPDATE customer_list SET txn_count = txn_count \+ 1/.test(s)) {
    const row = W.customers[custKey(p[0], p[1])];
    if (row) row.txn_count++;
    return [];
  }
  /* the status writer (shapes shared with the RAIL-106 tests) */
  const dir = (s.match(/direction = '(received|sent)'/) || [])[1];
  if (/^SELECT current_status FROM chit_status WHERE chit_id = \$1 AND entity_id = \$2 AND direction/.test(s)) return W.status.filter((r) => r.chit_id === p[0] && r.entity_id === p[1] && r.direction === dir).map((r) => ({ current_status: r.current_status }));
  if (/^UPDATE chit_status SET current_status = \$1/.test(s)) {
    const hit = W.status.filter((r) => r.chit_id === p[1] && r.entity_id === p[2] && r.direction === dir && r.current_status === p[3]);
    hit.forEach((r) => (r.current_status = p[0]));
    return hit.map((r) => ({ chit_id: r.chit_id }));
  }
  if (/^SELECT sender_entity_id, purpose, business_json FROM chit_header/.test(s)) {
    const h = headerOf(p[0], p[1]);
    return h ? [{ sender_entity_id: h.sender_entity_id, purpose: h.purpose, business_json: h.business_json }] : [];
  }
  /* the return path */
  if (/^SELECT last_seq FROM ctp_event_in/.test(s)) return W.inw.filter((r) => r.chit_id === p[0] && r.remote_entity_id === p[1] && r.entity_id === p[2]).map((r) => ({ last_seq: r.last_seq }));
  if (/^INSERT INTO ctp_event_in/.test(s)) {
    const cur = W.inw.find((r) => r.chit_id === p[0] && r.remote_entity_id === p[1] && r.entity_id === p[2]);
    if (cur && cur.last_seq >= p[3]) return [];
    if (cur) cur.last_seq = p[3];
    else W.inw.push({ chit_id: p[0], remote_entity_id: p[1], entity_id: p[2], last_seq: p[3] });
    return [{ last_seq: p[3] }];
  }
  if (/^SELECT sender_entity_bridge_id, all_recipients FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2 LIMIT 1/.test(s)) {
    const h = headerOf(p[0], p[1]);
    return h ? [{ sender_entity_bridge_id: W.ident[h.sender_entity_id].bridge_id, all_recipients: h.all_recipients }] : [];
  }
  if (/FROM identities WHERE bridge_id = \$1 AND identity_type = 'entity'/.test(s)) return Object.values(W.ident).filter((i) => i.bridge_id === p[0]);
  if (/FROM identities WHERE bridge_id = ANY/.test(s)) return Object.values(W.ident).filter((i) => p[0].includes(i.bridge_id));
  if (/^SELECT 1 FROM chit_status WHERE chit_id/.test(s) || /^SELECT entity_id FROM chit_status WHERE chit_id = \$1 AND entity_id = \$2/.test(s)) return [];
  if (/^INSERT INTO chit_status \(chit_id, entity_id, current_status, direction\)/.test(s)) {
    if (!statusOf(p[0], p[1], p[3])) W.status.push({ chit_id: p[0], entity_id: p[1], current_status: p[2], direction: p[3] });
    return [];
  }
  if (/FROM chit_participants/.test(s)) return [...new Set(W.status.map((r) => r.entity_id))].map((entity_id) => ({ entity_id }));
  if (/pg_advisory_xact_lock/.test(s)) return [{}];
  if (/coalesce\(max\(seq\), 0\) \+ 1 AS seq FROM ctp_event_out/.test(s)) return [{ seq: Math.max(0, ...W.out.filter((r) => r.chit_id === p[0] && r.from_entity_id === p[1]).map((r) => r.seq)) + 1 }];
  if (/^INSERT INTO ctp_event_out/.test(s)) {
    W.out.push({ chit_id: p[0], from_entity_id: p[1], seq: p[2], kind: p[3], event: JSON.parse(p[4]), to_entity_id: p[5], to_bridge_id: p[6] });
    return [];
  }
  return [];
}
const q = async (sql, p) => {
  const rows = rowsFor(sql, p);
  return { rows, rowCount: rows.length };
};
const stub = (file, exp) => {
  const id = require.resolve(root(file));
  require.cache[id] = { id, filename: id, loaded: true, exports: exp };
};
const tx = { query: q };
stub('db/index.js', {
  query: q,
  pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) },
  withEntity: async (id, fn) => {
    ENT = id;
    return fn(tx);
  },
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
  remoteInstallations: async () => (Object.keys(W.place).length ? new Map([['sit-au', { endpoint: 'x', active: true }]]) : new Map()),
  resolve: async (id) => W.place[id] || { entity_id: id, local: true, installation_key: null, endpoint: null },
  resolveAll: async () => new Map(),
  peerByKey: async () => ({ peer: null, status: 403, why: 'stub' }),
  invalidate() {}
});
const sc = require(root('lib/schema'));
sc.hasTable = async () => true;
sc.hasColumn = async () => false;
require(root('lib/books-hooks')).afterChit = () => Promise.resolve({});
try {
  require(root('lib/whatsapp-out')).notifyChitStatus = async () => null;
} catch (_) {
  /* optional */
}
const origErr = console.error;
console.error = () => {};
require(root('lib/istest')).mayTrade = async () => ({ ok: true });
const NUMBERED = [];
require(root('lib/party-fields')).ensureNo = async (db, owner, party) => {
  NUMBERED.push([owner, party]);
  return 'P-0042';
};

const express = require('express');
const jwt = require('jsonwebtoken');
const ret = require(root('lib/ctpreturn'));
const chits = require(root('routes/chits'));
const invite = require(root('lib/customer-invite'));
const L = require(root('lib/local-identity'));
const app = express();
app.use(express.json());
app.use('/api/relationships', require(root('routes/relationships')));
const tok = (id) => jwt.sign({ identity_id: id, identity_type: 'entity', display_name: W.ident[id].display_name }, process.env.JWT_SECRET, { algorithm: 'HS256' });
function call(method, url, token, body) {
  return new Promise((done) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      const data = body ? JSON.stringify(body) : '';
      const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
      const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method, headers }, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          srv.close();
          let j = null;
          try {
            j = JSON.parse(b);
          } catch (_) {
            /* not json */
          }
          done({ status: res.statusCode, body: j || {} });
        });
      });
      r.on('error', (e) => {
        srv.close();
        done({ status: 'ERR ' + e.code, body: {} });
      });
      r.end(data);
    });
  });
}

/* the loopback send, stood in for: the invitation chit lands with BOTH parties (the real send of a no-line general chit is send-golden's new scenario) */
let SENDS = 0;
invite.setSender(async (seller, body) => {
  SENDS++;
  W.sent.push({ seller, body });
  const chit_id = SENDS === 1 ? CHIT : 'c0000000-0000-4000-8000-00000000c' + String(SENDS).padStart(3, '0');
  const to = body.recipients[0].entity_id;
  const recipients = [
    { entity_id: seller, bridge_id: W.ident[seller].bridge_id, role: 'sender' },
    { entity_id: to, bridge_id: W.ident[to].bridge_id, role: 'receiver' }
  ];
  W.headers.push({ chit_id, entity_id: seller, sender_entity_id: seller, purpose: body.purpose, business_json: body.business_json, all_recipients: recipients });
  W.headers.push({ chit_id, entity_id: to, sender_entity_id: seller, purpose: body.purpose, business_json: body.business_json, all_recipients: recipients });
  W.status.push({ chit_id, entity_id: seller, direction: 'sent', current_status: 'delivered' });
  W.status.push({ chit_id, entity_id: to, direction: 'received', current_status: 'pending' });
  return { ok: true, status: 200, body: { chit_id } };
});

const EDITOR = { level: 'editor' };
const move = (who, status, chit) => chits.moveStatus(who, chit || CHIT, status, { id: who, name: W.ident[who].display_name }, '', EDITOR);
const rowsOf = (owner) => Object.keys(W.customers).filter((k) => k.startsWith(owner + '|'));
const invitedBuyer = async () => {
  const r = await call('POST', '/api/relationships/customers', tok(SELLER), { handle: 'chola' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  return r;
};

(async () => {
  console.log('\n== 1 · inviting: a business on the rail is asked, never added ==\n');
  await t('a business on the rail: an invitation is sent, NO customer row is made, and the answer says so in words', async () => {
    resetWorld();
    SENDS = 0;
    const r = await invitedBuyer();
    assert.strictEqual(r.body.invited, true);
    assert.strictEqual(r.body.chit_id, CHIT);
    assert.strictEqual(r.body.message, 'Invitation sent. They become your customer when they accept.');
    assert.strictEqual(r.body.customer, undefined, 'no customer is claimed');
    assert.deepStrictEqual(rowsOf(SELLER), [], 'no customer_list row');
    assert.strictEqual(W.sent.length, 1);
    const b = W.sent[0].body;
    assert.strictEqual(b.purpose, 'general');
    assert.deepStrictEqual(b.line_items, []);
    assert.strictEqual(b.recipients[0].entity_id, BUYER);
    assert.ok(b.business_json.invite && b.business_json.invite.for === 'customer');
    assert.ok(/Mayur Traders invites you to be their customer/.test(b.manual_subject), b.manual_subject);
  });
  await t('the chit is held by both: the seller has the sent copy, the invitee the received one, and both carry the invitation', async () => {
    assert.ok(headerOf(CHIT, SELLER) && headerOf(CHIT, BUYER));
    assert.ok(invite.inviteOf(headerOf(CHIT, SELLER).business_json) && invite.inviteOf(headerOf(CHIT, BUYER).business_json));
    assert.strictEqual(statusOf(CHIT, BUYER, 'received').current_status, 'pending');
  });
  await t('the pending invitation is listed for the seller as "Invited · waiting"', async () => {
    const list = await invite.listFor(SELLER);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].state, 'waiting');
    assert.strictEqual(list[0].words, 'Invited · waiting');
    assert.strictEqual(list[0].name, 'Chola Auto Care');
  });
  await t('re-inviting while one is waiting is refused 409, in words, and nothing is sent', async () => {
    const before = W.sent.length;
    const r = await call('POST', '/api/relationships/customers', tok(SELLER), { handle: 'chola' });
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(r.body.code, 'CUSTOMER_INVITE_PENDING');
    assert.ok(/already invited Chola Auto Care/.test(r.body.message || r.body.detail), JSON.stringify(r.body));
    assert.strictEqual(W.sent.length, before);
  });
  await t('a business already on the customer list is told so (409), nothing is sent', async () => {
    resetWorld();
    SENDS = 0;
    W.customers[custKey(SELLER, BUYER)] = { added_via: 'transaction', txn_count: 2 };
    const r = await call('POST', '/api/relationships/customers', tok(SELLER), { handle: 'chola' });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(W.sent.length, 0);
  });
  await t('a walk-in NAME is added at once (nobody to ask) and no invitation is sent', async () => {
    resetWorld();
    SENDS = 0;
    const real = L.addCustomer;
    L.addCustomer = async (h, owner, d) => {
      W.customers[custKey(owner, 'walkin-1')] = { added_via: d.via, txn_count: 0 };
      return { local: { identity_id: 'walkin-1', display_name: d.name, user_id: '~m.cus-0001', bridge_id: null }, customer_list_id: 9, party_no: 'P1' };
    };
    try {
      const r = await call('POST', '/api/relationships/customers', tok(SELLER), { name: 'Corner Garage' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.invited, undefined);
      assert.strictEqual(r.body.customer.display_name, 'Corner Garage');
      assert.strictEqual(rowsOf(SELLER).length, 1, 'the row exists at once');
      assert.strictEqual(W.sent.length, 0);
    } finally {
      L.addCustomer = real;
    }
  });
  await t('an invitation that could not be sent adds nothing and says why (502 in words)', async () => {
    resetWorld();
    SENDS = 0;
    const keep = invite.setSender;
    invite.setSender(async () => ({ ok: false, status: 0, body: null }));
    const r = await call('POST', '/api/relationships/customers', tok(SELLER), { handle: 'chola' });
    assert.strictEqual(r.status, 502, JSON.stringify(r.body));
    assert.strictEqual(r.body.code, 'CUSTOMER_INVITE_NOT_SENT');
    assert.ok(/Nothing was added/.test(r.body.message || r.body.detail));
    assert.deepStrictEqual(rowsOf(SELLER), []);
    void keep;
  });

  /* put the stub sender back (setSender above replaced it) */
  const restoreSender = () =>
    invite.setSender(async (seller, body) => {
      SENDS++;
      W.sent.push({ seller, body });
      const chit_id = SENDS === 1 ? CHIT : 'c0000000-0000-4000-8000-00000000c' + String(SENDS).padStart(3, '0');
      const to = body.recipients[0].entity_id;
      const recipients = [
        { entity_id: seller, bridge_id: W.ident[seller].bridge_id, role: 'sender' },
        { entity_id: to, bridge_id: W.ident[to].bridge_id, role: 'receiver' }
      ];
      W.headers.push({ chit_id, entity_id: seller, sender_entity_id: seller, purpose: body.purpose, business_json: body.business_json, all_recipients: recipients });
      W.headers.push({ chit_id, entity_id: to, sender_entity_id: seller, purpose: body.purpose, business_json: body.business_json, all_recipients: recipients });
      W.status.push({ chit_id, entity_id: seller, direction: 'sent', current_status: 'delivered' });
      W.status.push({ chit_id, entity_id: to, direction: 'received', current_status: 'pending' });
      return { ok: true, status: 200, body: { chit_id } };
    });
  restoreSender();

  console.log('\n== 2 · the answer: accept, decline, twice, withdrawn ==\n');
  await t('ACCEPT: the seller has a customer row (added_via invite), the invitee has none, and the pending line is gone', async () => {
    resetWorld();
    SENDS = 0;
    await invitedBuyer();
    const mv = await move(BUYER, 'accepted');
    assert.strictEqual(mv.code, 200, JSON.stringify(mv.body));
    assert.strictEqual(mv.body.customer_added, true);
    assert.deepStrictEqual(rowsOf(SELLER), [custKey(SELLER, BUYER)]);
    assert.strictEqual(W.customers[custKey(SELLER, BUYER)].added_via, 'invite');
    assert.deepStrictEqual(NUMBERED.slice(-1), [[SELLER, BUYER]], 'numbered through the one numbering path, when they became a customer');
    assert.deepStrictEqual(rowsOf(BUYER), [], 'the invitee did not become anyone\'s customer');
    assert.deepStrictEqual(await invite.listFor(SELLER), []);
  });
  await t('ACCEPT TWICE: still one row (the second press changes nothing)', async () => {
    const again = await move(BUYER, 'accepted');
    assert.strictEqual(again.code, 200);
    assert.strictEqual(again.body.noop, true);
    assert.strictEqual(rowsOf(SELLER).length, 1);
    const direct = await invite.afterStatus(SELLER, BUYER, CHIT, 'accepted');
    assert.strictEqual(direct.made, false, 'the hook itself is idempotent too');
    assert.strictEqual(rowsOf(SELLER).length, 1);
  });
  await t('DECLINE: no row anywhere, and the seller reads "Declined your invitation"', async () => {
    resetWorld();
    SENDS = 0;
    await invitedBuyer();
    const mv = await move(BUYER, 'rejected');
    assert.strictEqual(mv.code, 200, JSON.stringify(mv.body));
    assert.strictEqual(mv.body.customer_added, undefined);
    assert.deepStrictEqual(rowsOf(SELLER), []);
    const list = await invite.listFor(SELLER);
    assert.strictEqual(list[0].state, 'declined');
    assert.strictEqual(list[0].words, 'Declined your invitation');
  });
  await t('after a decline the seller may invite again (a new chit)', async () => {
    const r = await call('POST', '/api/relationships/customers', tok(SELLER), { handle: 'chola' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(W.sent.length, 2);
  });
  await t('an invitation the seller withdrew (cancelled) makes no customer when it is accepted late', async () => {
    resetWorld();
    SENDS = 0;
    await invitedBuyer();
    statusOf(CHIT, SELLER, 'sent').current_status = 'cancelled';
    await move(BUYER, 'accepted');
    assert.deepStrictEqual(rowsOf(SELLER), []);
  });
  await t('a chit that is NOT an invitation never makes a customer, whatever its status (an ordinary general chit)', async () => {
    resetWorld();
    SENDS = 0;
    const recipients = [{ entity_id: SELLER, role: 'sender' }, { entity_id: BUYER, role: 'receiver' }];
    W.headers.push({ chit_id: CHIT, entity_id: SELLER, sender_entity_id: SELLER, purpose: 'general', business_json: { kind: 'note' }, all_recipients: recipients });
    W.headers.push({ chit_id: CHIT, entity_id: BUYER, sender_entity_id: SELLER, purpose: 'general', business_json: { kind: 'note' }, all_recipients: recipients });
    W.status.push({ chit_id: CHIT, entity_id: SELLER, direction: 'sent', current_status: 'delivered' }, { chit_id: CHIT, entity_id: BUYER, direction: 'received', current_status: 'pending' });
    await move(BUYER, 'accepted');
    assert.deepStrictEqual(rowsOf(SELLER), []);
    const forged = await invite.afterStatus(SELLER, OTHER, CHIT, 'accepted');
    assert.strictEqual(forged.made, false);
  });
  await t('only a guest of the invitation can make the row: someone else\'s Accept on the same chit id adds nobody', async () => {
    resetWorld();
    SENDS = 0;
    await invitedBuyer();
    const stranger = await invite.afterStatus(SELLER, OTHER, CHIT, 'accepted');
    assert.strictEqual(stranger.made, false);
    assert.deepStrictEqual(rowsOf(SELLER), []);
  });

  console.log('\n== 3 · one installation or two: the same hook ==\n');
  /* the proof the code is the same: the customer_list statement that ran is the same text on both paths */
  const writes = () => W.rec.filter((x) => /^INSERT INTO customer_list/.test(x.s));
  let oneWrite;
  await t('ONE installation: the invitee presses Accept - the hook runs with (seller, invitee, chit, accepted)', async () => {
    resetWorld();
    SENDS = 0;
    await invitedBuyer();
    await move(BUYER, 'accepted');
    oneWrite = writes();
    assert.strictEqual(oneWrite.length, 1);
    assert.deepStrictEqual(oneWrite[0].p, [SELLER, BUYER]);
    assert.strictEqual(oneWrite[0].ent, SELLER, "written in the seller's own context");
    assert.deepStrictEqual(rowsOf(SELLER), [custKey(SELLER, BUYER)]);
  });
  let oneInstallation;
  await t('TWO installations: the invitee is on sit-au, the seller here; the status EVENT arrives and the SAME hook runs at the seller - identical row', async () => {
    oneInstallation = JSON.stringify(W.customers);
    resetWorld();
    SENDS = 0;
    W.place = { [STUB]: { entity_id: STUB, local: false, installation_key: 'sit-au', endpoint: 'https://au.example/api/ctp/deliver' } };
    /* the invitation was sent to the stub of the business over there */
    const r = await call('POST', '/api/relationships/customers', tok(SELLER), { handle: 'aupumps' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const event = { kind: 'status', seq: 1, status: 'accepted', previous_status: 'pending', copy: 'received', by_name: 'AU Pumps' };
    const FROM = { installation_key: 'sit-au', population: 'live', bridge_id: B_STUB, display_name: 'AU Pumps' };
    assert.deepStrictEqual(rowsOf(SELLER), [], 'before the answer, no row');
    const applied = await ret.apply({ chit_id: CHIT, event, from: FROM, to: { identity_id: SELLER } });
    assert.strictEqual(applied.ok, true, JSON.stringify(applied));
    assert.strictEqual(writes().length, 1);
    assert.strictEqual(writes()[0].s, oneWrite[0].s, 'the very same statement as on one installation');
    assert.deepStrictEqual(writes()[0].p, [SELLER, STUB]);
    assert.strictEqual(writes()[0].ent, SELLER);
    assert.deepStrictEqual(rowsOf(SELLER), [custKey(SELLER, STUB)]);
    assert.strictEqual(W.customers[custKey(SELLER, STUB)].added_via, 'invite');
    /* the row is the same shape as on one installation */
    const two = JSON.parse(JSON.stringify(W.customers[custKey(SELLER, STUB)]));
    assert.deepStrictEqual(two, JSON.parse(oneInstallation)[custKey(SELLER, BUYER)]);
  });
  await t('the same event twice (a resend): still one row; a DECLINE event makes none', async () => {
    const event = { kind: 'status', seq: 1, status: 'accepted', copy: 'received' };
    const FROM = { installation_key: 'sit-au', population: 'live', bridge_id: B_STUB, display_name: 'AU Pumps' };
    const again = await ret.apply({ chit_id: CHIT, event, from: FROM, to: { identity_id: SELLER } });
    assert.strictEqual(again.ok, true);
    assert.strictEqual(rowsOf(SELLER).length, 1);
    resetWorld();
    SENDS = 0;
    W.place = { [STUB]: { entity_id: STUB, local: false, installation_key: 'sit-au', endpoint: 'x' } };
    await call('POST', '/api/relationships/customers', tok(SELLER), { handle: 'aupumps' });
    const declined = await ret.apply({ chit_id: CHIT, event: { kind: 'status', seq: 1, status: 'rejected', copy: 'received' }, from: FROM, to: { identity_id: SELLER } });
    assert.strictEqual(declined.ok, true);
    assert.deepStrictEqual(rowsOf(SELLER), []);
  });
  await t('the seller is on the OTHER installation: the invitee\'s Accept here writes no row here (the event carries it to the seller)', async () => {
    resetWorld();
    SENDS = 0;
    W.place = { [SELLER]: { entity_id: SELLER, local: false, installation_key: 'sit-au', endpoint: 'x' } };
    const recipients = [{ entity_id: SELLER, bridge_id: B_SELLER, role: 'sender' }, { entity_id: BUYER, bridge_id: B_BUYER, role: 'receiver' }];
    W.headers.push({ chit_id: CHIT, entity_id: BUYER, sender_entity_id: SELLER, purpose: 'general', business_json: INVITE_BJ, all_recipients: recipients });
    W.status.push({ chit_id: CHIT, entity_id: BUYER, direction: 'received', current_status: 'pending' });
    const mv = await move(BUYER, 'accepted');
    assert.strictEqual(mv.code, 200, JSON.stringify(mv.body));
    assert.deepStrictEqual(rowsOf(SELLER), [], 'nothing written for a seller this installation does not host');
    assert.ok(W.out.some((r) => r.kind === 'status' && r.event.status === 'accepted'), 'the status event is queued for the seller');
  });

  console.log('\n== 4 · what the sender\'s own writes do now ==\n');
  const st = (extra) => Object.assign({ sender_id: SELLER, is_draft: false, receiverDetails: [{ entity_id: BUYER, kind: 'to' }], orderLike: false, sellerId: SELLER }, extra || {});
  await t('a seller\'s ordinary send to a business that is NOT a customer no longer creates the row', async () => {
    resetWorld();
    await chits.sendCustomers(st(), {}, {});
    assert.deepStrictEqual(rowsOf(SELLER), []);
  });
  await t('a seller\'s bill to an EXISTING customer is unchanged: the row stays and its trade is counted', async () => {
    resetWorld();
    W.customers[custKey(SELLER, BUYER)] = { added_via: 'manual', txn_count: 3 };
    await chits.sendCustomers(st(), {}, {});
    assert.strictEqual(W.customers[custKey(SELLER, BUYER)].txn_count, 4);
    assert.strictEqual(rowsOf(SELLER).length, 1);
  });
  await t('the BUYER\'S ORDER still makes the seller\'s row (the buyer\'s own act: unchanged)', async () => {
    resetWorld();
    await chits.sendCustomers(st({ sender_id: BUYER, orderLike: true, sellerId: SELLER, receiverDetails: [{ entity_id: SELLER, kind: 'to' }] }), {}, {});
    assert.deepStrictEqual(rowsOf(SELLER), [custKey(SELLER, BUYER)]);
    assert.strictEqual(W.customers[custKey(SELLER, BUYER)].added_via, 'transaction');
  });
  await t('a draft makes nothing', async () => {
    resetWorld();
    W.customers[custKey(SELLER, BUYER)] = { added_via: 'manual', txn_count: 3 };
    await chits.sendCustomers(st({ is_draft: true }), {}, {});
    assert.strictEqual(W.customers[custKey(SELLER, BUYER)].txn_count, 3);
  });

  console.log('\n== 5 · before b795 ==\n');
  await t('b795 not run: the CHECK refuses the word invite, the row is written as manual - the customer is never lost', async () => {
    resetWorld();
    SENDS = 0;
    W.noInviteWord = true;
    await invitedBuyer();
    await move(BUYER, 'accepted');
    assert.strictEqual(W.customers[custKey(SELLER, BUYER)].added_via, 'manual');
  });

  console.error = origErr;
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  console.log('  ' + pass + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error = origErr;
  console.error(e);
  process.exit(1);
});
