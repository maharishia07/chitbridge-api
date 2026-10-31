/**
 * tests/ctp-return-gaps.test.cjs — RAIL-106 part 3: THE REMAINING CROSSING GAPS, each by the one approach (decided at the origin, emitted from inside the existing writer, applied through the
 * same writer, never re-decided at the receiver).
 *
 *   1  CANCEL / WITHDRAW: the void route and the sender's cancel move a SENT copy through the rail gate and tell the parties elsewhere by the status event (copy 'sent'); the flag
 *      "cancel requested" (b195) and "cancel confirmed" (b197) are set where the copy is, by the same stamps; assigning back to pending is a status move and crosses
 *   2  AMENDMENT: first pinned private to the amender (part 3); Athi then decided it is a change order — the proposal mechanism (tests/chit-proposals.test.cjs)
 *   3  ATTACHMENTS: carried by reference, pulled over the CTP door, size-capped
 *   4  THE BELL on the receiver, through lib/events (no res)
 *   5  a second local party gets its timeline row
 *   6  the message size limit, in the one message writer
 *
 * Offline: database, address book, transport are stubs. Run: node tests/ctp-return-gaps.test.cjs
 */
'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-ctp-gaps';
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

const ME = '11111111-1111-4111-8111-111111111111'; /* the business that acts here (sit-in) */
const STUB = '22222222-2222-4222-8222-222222222222'; /* the stub of the business on sit-au */
const LOCAL2 = '33333333-3333-4333-8333-333333333333';
const CHIT = 'c0000000-0000-4000-8000-0000000000c1';
const DISPUTE = 'd0000000-0000-4000-8000-0000000000d1';
const MSG = 'a0000000-0000-4000-8000-0000000000a1';
const B_ME = 'CBME00001A',
  B_STUB = 'CBAU00001B',
  B_LOCAL2 = 'CBLO00001C';

let W;
let ENT = null;
const resetWorld = () => {
  W = {
    rec: [],
    status: [{ chit_id: CHIT, entity_id: ME, direction: 'sent', current_status: 'delivered' }],
    out: [],
    inw: [],
    msgs: [],
    nextId: 1,
    header: { sender_entity_bridge_id: B_ME, all_recipients: [{ bridge_id: B_ME, entity_id: ME, role: 'sender' }, { bridge_id: B_STUB, entity_id: STUB, role: 'to' }] },
    ident: {
      [B_ME]: { identity_id: ME, bridge_id: B_ME, display_name: 'IN Plant' },
      [B_STUB]: { identity_id: STUB, bridge_id: B_STUB, display_name: 'AU Pumps' },
      [B_LOCAL2]: { identity_id: LOCAL2, bridge_id: B_LOCAL2, display_name: 'IN Neighbour' }
    },
    place: { [STUB]: { local: false, installation_key: 'sit-au', endpoint: 'https://au.example/api/ctp/deliver' } },
    disputes: [], // dispute ids held (by the acting copy)
    disputeRow: null, // what SELECT * FROM chit_disputes returns for the resolve route
    disputeRole: 'raiser',
    scope: 'targeted',
    roster: [] // chit_dispute_roster rows
  };
};
resetWorld();
const one = (s) => String(s).replace(/\s+/g, ' ').trim();
function rowsFor(sql, p) {
  const s = one(sql);
  p = p || [];
  W.rec.push({ s, p, ent: ENT });
  if (/to_regprocedure/.test(s)) return [{ ok: true }];
  if (/^SELECT 1 FROM cb_attachment WHERE id = \$1/.test(s)) return (W.heldAtt || []).includes(p[0]) ? [{}] : [];
  if (/^SELECT visibility_entity_id FROM chit_messages/.test(s)) return [{ visibility_entity_id: W.internalNote ? ME : null }];
  if (/^SELECT role FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2$/.test(s)) return [{ role: 'sender' }];
  if (/^INSERT INTO chit_line_amendment/.test(s)) return [{ amendment_id: 'am-1', line_index: p[2], line_id: p[3], seq: 1, line: p[4] === null ? null : JSON.parse(p[4]), reason_code: p[5], reason: p[6], actor_name: p[8], created_at: new Date() }];
  if (/^SELECT line_items FROM chit_detail/.test(s)) return [{ line_items: [{ particulars: 'Pump seal', quantity: 10 }] }];
  if (/^SELECT last_seq FROM ctp_event_in/.test(s)) return W.inw.filter((r) => r.chit_id === p[0] && r.remote_entity_id === p[1] && r.entity_id === p[2]).map((r) => ({ last_seq: r.last_seq }));
  if (/^INSERT INTO ctp_event_in/.test(s)) {
    const cur = W.inw.find((r) => r.chit_id === p[0] && r.remote_entity_id === p[1] && r.entity_id === p[2]);
    if (cur && cur.last_seq >= p[3]) return [];
    if (cur) cur.last_seq = p[3];
    else W.inw.push({ chit_id: p[0], remote_entity_id: p[1], entity_id: p[2], last_seq: p[3] });
    return [{ last_seq: p[3] }];
  }
  const dir = (s.match(/direction = '(received|sent)'/) || [])[1];
  if (/^SELECT current_status FROM chit_status WHERE chit_id = \$1 AND entity_id = \$2 AND direction/.test(s)) return W.status.filter((r) => r.chit_id === p[0] && r.entity_id === p[1] && r.direction === dir).map((r) => ({ current_status: r.current_status }));
  if (/^UPDATE chit_status SET current_status = \$1/.test(s)) {
    const hit = W.status.filter((r) => r.chit_id === p[1] && r.entity_id === p[2] && r.direction === dir && r.current_status === p[3]);
    hit.forEach((r) => (r.current_status = p[0]));
    return hit.map((r) => ({ chit_id: r.chit_id }));
  }
  if (/^SELECT sender_entity_id FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2$/.test(s)) return [{ sender_entity_id: W.senderId || ME }];
  if (/^SELECT sender_entity_id, purpose, business_json(, all_recipients)? FROM chit_header/.test(s)) return [{ sender_entity_id: W.senderId || STUB, purpose: 'order', business_json: W.businessJson || {}, all_recipients: W.header.all_recipients }];
  if (/^SELECT all_recipients FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2$/.test(s)) return [{ all_recipients: W.header.all_recipients.map((x) => ({ entity_id: (W.ident[x.bridge_id] || {}).identity_id })) }];
  if (/^SELECT cancel_requested_at FROM chit_status/.test(s)) return W.asked ? [{ cancel_requested_at: new Date() }] : [{}];
  if (/FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2 LIMIT 1/.test(s) && /all_recipients/.test(s)) return [W.header];
  if (/FROM identities WHERE bridge_id = ANY/.test(s)) return p[0].map((b) => W.ident[b]).filter(Boolean);
  if (/FROM identities WHERE identity_id = ANY/.test(s)) return Object.values(W.ident).filter((i) => p[0].includes(i.identity_id));
  if (/^SELECT display_name, status, is_erased FROM identities WHERE identity_id=\$1/.test(s)) return [{ display_name: 'AU Pumps', status: 'active', is_erased: false }];
  if (/FROM identities WHERE bridge_id = \$1 AND identity_type = 'entity'/.test(s)) return W.ident[p[0]] ? [W.ident[p[0]]] : [];
  if (/FROM chit_participants/.test(s)) return [...new Set(W.status.map((r) => r.entity_id))].map((entity_id) => ({ entity_id }));
  if (/chit_participant_parity/.test(s)) return [{ present: true, deleted_at: null }];
  if (/^SELECT current_status FROM chit_status WHERE chit_id=\$1 AND entity_id=\$2$/.test(s)) return W.status.filter((r) => r.chit_id === p[0] && r.entity_id === p[1]).map((r) => ({ current_status: r.current_status }));
  if (/^INSERT INTO chit_status \(chit_id, entity_id, current_status, direction\)/.test(s)) {
    if (!W.status.find((r) => r.chit_id === p[0] && r.entity_id === p[1] && r.direction === p[3])) W.status.push({ chit_id: p[0], entity_id: p[1], current_status: p[2], direction: p[3] });
    return [];
  }
  if (/^SELECT dispute_id FROM chit_disputes/.test(s)) return [];
  if (/^SELECT ch\.auto_subject/.test(s)) return [{ auto_subject: 'PO', summary_json: {}, my_status: 'pending' }];
  if (/^SELECT \* FROM chit_disputes WHERE dispute_id = \$1 AND chit_id = \$2/.test(s)) return W.disputeRow ? [W.disputeRow] : [];
  if (/^SELECT scope FROM chit_disputes/.test(s)) return [{ scope: W.scope }];
  if (/^SELECT 1 FROM chit_disputes WHERE dispute_id = \$1 AND chit_id = \$2/.test(s)) return W.disputes.includes(p[0]) ? [{}] : [];
  if (/^SELECT role, category FROM chit_disputes/.test(s)) return W.disputes.includes(p[0]) ? [{ role: W.disputeRole, category: 'quantity' }] : [];
  if (/FROM chit_dispute_roster/.test(s)) {
    let rows = W.roster;
    if (/role='party' AND status='open'/.test(s)) rows = rows.filter((r) => r.role === 'party' && r.status === 'open');
    return rows;
  }
  if (/chit_dispute_resolve/.test(s)) return [{ all_resolved: true }];
  if (/^SELECT entity_id FROM chit_status WHERE chit_id = \$1 AND entity_id = \$2/.test(s)) return W.status.filter((r) => r.entity_id === p[1]).map((r) => ({ entity_id: r.entity_id }));
  if (/pg_advisory_xact_lock/.test(s)) return [{}];
  if (/coalesce\(max\(seq\), 0\) \+ 1 AS seq FROM ctp_event_out/.test(s)) return [{ seq: Math.max(0, ...W.out.filter((r) => r.chit_id === p[0] && r.from_entity_id === p[1]).map((r) => r.seq)) + 1 }];
  if (/^INSERT INTO ctp_event_out/.test(s)) {
    W.out.push({ id: W.nextId++, chit_id: p[0], from_entity_id: p[1], seq: p[2], kind: p[3], event: JSON.parse(p[4]), to_entity_id: p[5], to_bridge_id: p[6], to_installation_key: p[7] });
    return [];
  }
  if (/^SELECT 1 FROM chit_messages WHERE message_id/.test(s)) return W.msgs.filter((m) => m.message_id === p[0] && m.entity_id === p[1]).map(() => ({}));
  if (/^SELECT chit_message_deliver/.test(s)) return [{ created_at: new Date() }];
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
const book = {
  remoteInstallations: async () => (Object.keys(W.place).length ? new Map([['sit-au', { endpoint: 'x', active: true }]]) : new Map()),
  resolve: async (id) => W.place[id] || { entity_id: id, local: true, installation_key: null, endpoint: null },
  resolveAll: async () => new Map(),
  peerByKey: async () => ({ peer: null, status: 403, why: 'stub' }),
  invalidate() {}
};
stub('lib/ctpaddress.js', book);
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

const ret = require(root('lib/ctpreturn'));
const chits = require(root('routes/chits'));
const express = require('express');
const jwt = require('jsonwebtoken');
const app = express();
app.use(express.json());
app.use('/api/chits', chits);
const tok = (id) => jwt.sign({ identity_id: id, identity_type: 'entity', display_name: 'who-' + id.slice(0, 5) }, process.env.JWT_SECRET, { algorithm: 'HS256' });
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
const sqlOf = (re) => W.rec.filter((x) => re.test(x.s));


const books = require(root('lib/books-hooks'));
books.chitWithdrawn = async () => null;
books.chitWithdrawnSaid = async () => null;
sc.hasColumn = async () => true;
const FROM = { installation_key: 'sit-au', population: 'live', bridge_id: B_STUB, display_name: 'AU Pumps' };
const apply = (event, over) => ret.apply(Object.assign({ chit_id: CHIT, event, from: FROM, to: { identity_id: ME } }, over || {}));
const EDITOR = { level: 'editor' };
const storage = require(root('lib/storage'));
const STORED = [];
storage.putForParticipants = async (args) => {
  STORED.push(args);
  return 'att-own-1';
};
const attachments = require(root('routes/attachments'));
app.use('/api/attachments', attachments);
const ctpquery = require(root('lib/ctpquery'));
const crypto = require('crypto');
const BYTES = Buffer.from('%PDF-1.4 a delivery note');
const SHA = crypto.createHash('sha256').update(BYTES).digest('hex');
const ATT = 'f0000000-0000-4000-8000-0000000000f1';
const attEv = (over) => Object.assign({ kind: 'attachment', seq: 4, attachment_id: ATT, name: 'delivery-note.pdf', mime: 'application/pdf', size: BYTES.length, sha256: SHA, message_id: null, line_index: null }, over || {});
const kinds = () => W.out.map((r) => r.kind + (r.kind === 'status' ? ':' + r.event.copy + ':' + r.event.status : ''));

(async () => {
  console.log('\n== 1 · cancel / withdraw / the flags / back to pending ==\n');
  await t('withdrawing a sent order (the real void route) tells the parties elsewhere: the sent copy cancelled, and the cancel request; the flag is stamped by the shared stamp', async () => {
    resetWorld();
    W.senderId = ME;
    const r = await call('PUT', '/api/chits/' + CHIT + '/void', tok(ME), { reason: 'Ordered twice by mistake' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(kinds().sort(), ['cancel_request', 'message', 'status:sent:cancelled'].sort());
    const status = W.out.find((x) => x.kind === 'status');
    assert.strictEqual(status.event.previous_status, 'delivered');
    assert.strictEqual(status.to_bridge_id, B_STUB);
    assert.strictEqual(W.out.find((x) => x.kind === 'cancel_request').event.reason, 'Ordered twice by mistake');
    assert.ok(sqlOf(/SET cancel_requested_at = NOW\(\)/).some((x) => x.ent === STUB), 'the flag on the shadow of the recipient, as in one database');
    assert.ok(r.body.ctp && r.body.ctp.queued >= 1, JSON.stringify(r.body));
    assert.strictEqual(sqlOf(/^UPDATE chit_status SET current_status/).length, 1, 'one status write, by the one writer');
  });
  await t('a withdrawal the rail refuses (the sent copy is completed) is refused 409 at the origin and nothing is queued', async () => {
    resetWorld();
    W.status[0].current_status = 'completed';
    const r = await call('PUT', '/api/chits/' + CHIT + '/void', tok(ME), { reason: 'Changed my mind later on' });
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(W.out.length, 0);
  });
  await t('a withdrawal between parties who are all here queues nothing and the answer has no ctp key', async () => {
    resetWorld();
    W.place = {};
    const r = await call('PUT', '/api/chits/' + CHIT + '/void', tok(ME), { reason: 'Ordered twice by mistake' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(W.out.length, 0);
    assert.strictEqual(r.body.ctp, undefined);
  });
  await t('a recipient that was asked cancels (moveStatus): its status, the confirmation flag for the sender elsewhere, and the "[cancel confirmed]" message all cross', async () => {
    resetWorld();
    W.status = [{ chit_id: CHIT, entity_id: ME, direction: 'received', current_status: 'pending' }];
    W.header = { sender_entity_bridge_id: B_STUB, all_recipients: [{ bridge_id: B_STUB, role: 'sender' }, { bridge_id: B_ME, role: 'to' }] };
    W.asked = true;
    const mv = await require(root('lib/chit-move')).moveStatus(ME, CHIT, 'cancelled', { id: ME, name: 'Asha' }, '', EDITOR);
    assert.strictEqual(mv.code, 200, JSON.stringify(mv.body));
    assert.deepStrictEqual(kinds().sort(), ['cancel_confirm', 'message', 'status:received:cancelled'].sort());
    assert.strictEqual(W.out.find((x) => x.kind === 'cancel_confirm').to_bridge_id, B_STUB);
  });
  await t('a recipient that was NOT asked cancels: no confirmation crosses (it would credit the sender with an agreement nobody made)', async () => {
    resetWorld();
    W.status = [{ chit_id: CHIT, entity_id: ME, direction: 'received', current_status: 'pending' }];
    W.header = { sender_entity_bridge_id: B_STUB, all_recipients: [{ bridge_id: B_STUB }, { bridge_id: B_ME }] };
    W.asked = false;
    await require(root('lib/chit-move')).moveStatus(ME, CHIT, 'cancelled', { id: ME, name: 'Asha' }, '', EDITOR);
    assert.ok(!kinds().includes('cancel_confirm'), kinds().join());
  });
  await t('assigning a chit back to pending is a status move and is told like one', async () => {
    resetWorld();
    W.status = [{ chit_id: CHIT, entity_id: ME, direction: 'received', current_status: 'accepted' }];
    const assign = require(root('lib/assign-chit'));
    const out = await assign.assignChit(tx, ME, CHIT, { identity_id: LOCAL2, display_name: 'Asha' }, 'push', { copy: 'received', me: EDITOR, from: 'accepted' });
    assert.ok(out.moved, JSON.stringify(out));
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepStrictEqual(kinds(), ['status:received:pending']);
  });
  await t('the receiver sets the flag "cancel requested" on OUR copy once, only for the chit’s sender', async () => {
    resetWorld();
    W.header = { sender_entity_bridge_id: B_STUB, all_recipients: [{ bridge_id: B_STUB }, { bridge_id: B_ME }] };
    const ev = { kind: 'cancel_request', seq: 2, by_name: 'Raj', reason: 'Ordered twice by mistake' };
    const first = await apply(ev);
    assert.ok(first.ok && first.applied, JSON.stringify(first));
    const stamp = sqlOf(/SET cancel_requested_at = NOW\(\)/)[0];
    assert.deepStrictEqual([stamp.p[0], stamp.p[1], stamp.p[2], stamp.p[3], stamp.ent], [CHIT, 'Raj', 'Ordered twice by mistake', ME, ME]);
    const again = await apply(ev);
    assert.ok(again.ok && again.applied === false);
    assert.strictEqual(sqlOf(/SET cancel_requested_at = NOW\(\)/).length, 1);
    resetWorld();
    W.header = { sender_entity_bridge_id: B_ME, all_recipients: [{ bridge_id: B_ME }, { bridge_id: B_STUB }] };
    const notSender = await apply(ev);
    assert.ok(!notSender.ok && notSender.status === 409, JSON.stringify(notSender));
  });
  await t('the receiver sets the flag "cancel confirmed" on the sender’s copy (ours), only from a recipient', async () => {
    resetWorld();
    W.header = { sender_entity_bridge_id: B_ME, all_recipients: [{ bridge_id: B_ME }, { bridge_id: B_STUB }] };
    const ok = await apply({ kind: 'cancel_confirm', seq: 3, by_name: 'Raj' });
    assert.ok(ok.ok && ok.applied, JSON.stringify(ok));
    const stamp = sqlOf(/SET cancel_confirmed_at = NOW\(\)/)[0];
    assert.deepStrictEqual([stamp.p[0], stamp.p[1], stamp.p[2]], [CHIT, 'Raj', ME]);
    resetWorld();
    W.header = { sender_entity_bridge_id: B_STUB, all_recipients: [{ bridge_id: B_STUB }, { bridge_id: B_ME }] };
    const wrong = await apply({ kind: 'cancel_confirm', seq: 3, by_name: 'Raj' });
    assert.ok(!wrong.ok && wrong.status === 409);
  });
  await t('a sent-copy status event mirrors the shadow of the sender’s SENT row', async () => {
    resetWorld();
    W.header = { sender_entity_bridge_id: B_STUB, all_recipients: [{ bridge_id: B_STUB }, { bridge_id: B_ME }] };
    W.status = [{ chit_id: CHIT, entity_id: ME, direction: 'received', current_status: 'pending' }, { chit_id: CHIT, entity_id: STUB, direction: 'sent', current_status: 'delivered' }];
    const r = await apply({ kind: 'status', seq: 2, status: 'cancelled', previous_status: 'delivered', copy: 'sent', by_name: 'Raj' });
    assert.ok(r.ok && r.applied, JSON.stringify(r));
    assert.strictEqual(W.status.find((x) => x.entity_id === STUB && x.direction === 'sent').current_status, 'cancelled');
  });

  console.log('\n== 2 · amendment: superseded by the proposal mechanism (tests/chit-proposals.test.cjs) ==\n');

  console.log('\n== 3 · attachments: by reference, pulled over the CTP door, capped ==\n');
  await t('a file put on a chit (the real upload route) is told BY REFERENCE: id, name, type, size and sha-256, never the bytes; one event per installation', async () => {
    resetWorld();
    STORED.length = 0;
    const r = await call('POST', '/api/attachments', tok(ME), { chit_id: CHIT, name: 'delivery-note.pdf', mime: 'application/pdf', data_base64: BYTES.toString('base64') });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(STORED.length, 1, 'stored for the participants here as before');
    assert.strictEqual(W.out.length, 1);
    const ev = W.out[0].event;
    assert.strictEqual(W.out[0].kind, 'attachment');
    assert.deepStrictEqual([ev.attachment_id, ev.name, ev.mime, ev.size, ev.sha256], ['att-own-1', 'delivery-note.pdf', 'application/pdf', BYTES.length, SHA]);
    assert.ok(!JSON.stringify(ev).includes(BYTES.toString('base64')), 'no bytes in the event');
    assert.strictEqual(r.body.ctp.queued, 1);
  });
  await t('an internal note’s file stays here; an all-local chit queues nothing; a file over the limit is refused 413 and nothing is queued', async () => {
    resetWorld();
    W.place = {};
    const local = await call('POST', '/api/attachments', tok(ME), { chit_id: CHIT, name: 'a.pdf', mime: 'application/pdf', data_base64: BYTES.toString('base64') });
    assert.strictEqual(local.status, 200);
    assert.strictEqual(W.out.length, 0);
    assert.strictEqual(local.body.ctp, undefined);
    resetWorld();
    const big = await call('POST', '/api/attachments', tok(ME), { chit_id: CHIT, name: 'big.bin', mime: 'application/octet-stream', data_base64: Buffer.alloc(storage.MAX_ATTACHMENT_BYTES + 1).toString('base64') });
    assert.strictEqual(big.status, 413, JSON.stringify(big.body).slice(0, 200));
    assert.strictEqual(W.out.length, 0);
  });
  await t('the answerer gives the file to a party of that chit only: the asking installation must host one; an internal note’s file and a stranger get "not found" in words', async () => {
    resetWorld();
    storage.getBlob = async () => ({ name: 'delivery-note.pdf', mime: 'application/pdf', size: BYTES.length, data: BYTES, chit_id: CHIT, message_id: null });
    const ask = { want: 'attachment', attachment_id: ATT, chit_id: CHIT, owner_bridge_id: B_ME };
    const ok = await ret.attachmentFor('sit-au', ask);
    assert.ok(ok.found && ok.sha256 === SHA && ok.size === BYTES.length && Buffer.from(ok.data_base64, 'base64').equals(BYTES), JSON.stringify(ok).slice(0, 200));
    const stranger = await ret.attachmentFor('sit-other', ask);
    assert.ok(stranger.ok && stranger.found === false && /not shared/.test(stranger.why), JSON.stringify(stranger));
    storage.getBlob = async () => ({ name: 'n.pdf', mime: 'application/pdf', size: 1, data: BYTES, chit_id: CHIT, message_id: MSG });
    W.internalNote = true;
    const note = await ret.attachmentFor('sit-au', ask);
    assert.ok(note.found === false && /internal note/.test(note.why), JSON.stringify(note));
    storage.getBlob = async () => ({ name: 'x', mime: 'x', size: 1, data: BYTES, chit_id: 'another-chit', message_id: null });
    W.internalNote = false;
    assert.strictEqual((await ret.attachmentFor('sit-au', ask)).found, false, 'a file of another chit is not given for this one');
    assert.strictEqual((await ret.attachmentFor('sit-au', Object.assign({}, ask, { owner_bridge_id: 'CBNOBODY01' }))).found, false);
  });
  await t('the receiver pulls the announced file, checks size and checksum, and stores OUR copy for each participant here under ids derived from the sender’s file (so twice stores once)', async () => {
    resetWorld();
    STORED.length = 0;
    W.header = { sender_entity_bridge_id: B_STUB, all_recipients: [{ bridge_id: B_STUB }, { bridge_id: B_ME }] };
    W.status = [{ chit_id: CHIT, entity_id: ME, direction: 'received', current_status: 'pending' }, { chit_id: CHIT, entity_id: STUB, direction: 'sent', current_status: 'delivered' }];
    const asked = [];
    ctpquery.ask = async (target, want) => {
      asked.push(want);
      return { ok: true, found: true, name: 'delivery-note.pdf', mime: 'application/pdf', size: BYTES.length, sha256: SHA, data_base64: BYTES.toString('base64') };
    };
    const first = await apply(attEv());
    assert.ok(first.ok && first.applied, JSON.stringify(first));
    assert.deepStrictEqual(asked, [{ want: 'attachment', attachment_id: ATT, chit_id: CHIT, owner_bridge_id: B_STUB }]);
    assert.strictEqual(STORED.length, 1);
    assert.deepStrictEqual(STORED[0].participants.sort(), [ME, STUB].sort());
    assert.ok(STORED[0].buffer.equals(BYTES) && STORED[0].name === 'delivery-note.pdf' && STORED[0].uploaded_by === STUB);
    assert.strictEqual(STORED[0].idFor(ME), STORED[0].idFor(ME), 'stable');
    assert.notStrictEqual(STORED[0].idFor(ME), STORED[0].idFor(STUB), 'one per holder');
    assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(STORED[0].idFor(ME)));
    const again = await apply(attEv());
    assert.ok(again.ok && again.applied === false);
    assert.strictEqual(STORED.length, 1, 'not fetched or stored twice');
    W.heldAtt = [STORED[0].idFor(ME)];
    const later = await apply(attEv({ seq: 9 }));
    assert.ok(later.ok, JSON.stringify(later));
    assert.strictEqual(STORED.length, 1, 'a copy already held is not fetched again');
  });
  await t('a file that arrives other than announced (checksum, size), cannot be fetched, is over the limit, or whose message has not arrived is refused in words and NOT stored', async () => {
    resetWorld();
    STORED.length = 0;
    W.header = { sender_entity_bridge_id: B_STUB, all_recipients: [{ bridge_id: B_STUB }, { bridge_id: B_ME }] };
    ctpquery.ask = async () => ({ ok: true, found: true, size: BYTES.length, sha256: SHA, data_base64: Buffer.from('%PDF-1.4 a forged note!!').toString('base64') }); /* same length, other bytes */
    const swapped = await apply(attEv());
    assert.ok(!swapped.ok && swapped.status === 502 && swapped.code === 'CTP_EVENT_ATTACHMENT_UNREADABLE' && /did not arrive as announced/.test(swapped.why), JSON.stringify(swapped));
    ctpquery.ask = async () => ({ ok: false, why: 'could not reach https://au.example/api/ctp/query: timed out' });
    const down = await apply(attEv({ seq: 5 }));
    assert.ok(!down.ok && down.code === 'CTP_EVENT_ATTACHMENT_UNREADABLE' && /timed out/.test(down.why), JSON.stringify(down));
    const huge = await apply(attEv({ seq: 6, size: storage.MAX_ATTACHMENT_BYTES + 1 }));
    assert.ok(!huge.ok && huge.status === 413 && huge.code === 'CTP_EVENT_TOO_LARGE' && /limit is 6 MB/.test(huge.why), JSON.stringify(huge));
    const early = await apply(attEv({ seq: 7, message_id: MSG }));
    assert.ok(!early.ok && early.status === 404 && early.code === 'CTP_EVENT_NOT_YET', JSON.stringify(early));
    assert.strictEqual(STORED.length, 0);
    for (const bad of [attEv({ sha256: 'zz' }), attEv({ size: 0 }), attEv({ attachment_id: 'x' }), attEv({ name: ' ' })]) {
      const r = await apply(bad);
      assert.ok(!r.ok && r.status === 400 && r.code === 'CTP_EVENT_BAD', JSON.stringify(bad));
    }
  });
  await t('the pull is a question the door knows: attachment is a want, sealed with its three ids', async () => {
    assert.ok(require(root('lib/ctpquery')).WANTS.includes('attachment'));
    const q = require(root('lib/ctpquery')).build({ installation_key: 'sit-in' }, { installation_key: 'sit-au', domain: 'au.example' }, { want: 'attachment', attachment_id: ATT, chit_id: CHIT, owner_bridge_id: B_ME, extra: 'dropped' });
    assert.deepStrictEqual(q.ask, { want: 'attachment', attachment_id: ATT, chit_id: CHIT, owner_bridge_id: B_ME });
    assert.throws(() => require(root('lib/ctpquery')).build({ installation_key: 'sit-in' }, { domain: 'au.example' }, { want: 'attachment', chit_id: CHIT }), /attachment needs/);
  });

  console.log('\n== 4 · the bell on the receiver, through lib/events (no res) ==\n');
  const events = require(root('lib/events'));
  const RUNG = [];
  events.emit = (ids, evt) => {
    RUNG.push({ ids, evt });
    return ids.length;
  };
  const stubMessages = () => {
    const chitsPath = require.resolve(root('routes/chits.js'));
    const real = require(root('lib/chit-crossing')).postMessageCopies;
    require(root('lib/chit-crossing')).postMessageCopies = async (m) => {
      W.msgs.push({ message_id: m.message_id, entity_id: ME }, { message_id: m.message_id, entity_id: LOCAL2 }); /* the fan-out writes a copy for every party here */
      return { message_id: m.message_id };
    };
    return () => (require(root('lib/chit-crossing')).postMessageCopies = real);
  };
  await t('an arrived external message rings the people on the chit who are not the sender, once, with the local message bell (kind message, chit id, who)', async () => {
    resetWorld();
    RUNG.length = 0;
    W.header = { sender_entity_bridge_id: B_STUB, all_recipients: [{ bridge_id: B_STUB }, { bridge_id: B_ME }, { bridge_id: B_LOCAL2 }] };
    W.status = [{ chit_id: CHIT, entity_id: ME, direction: 'received', current_status: 'pending' }, { chit_id: CHIT, entity_id: LOCAL2, direction: 'received', current_status: 'pending' }];
    const restore = stubMessages();
    try {
      const ev = { kind: 'message', seq: 2, message_id: MSG, message_text: 'Shipping tomorrow', msg_type: 'info', sender_display_name: 'Raj' };
      const first = await apply(ev);
      assert.ok(first.ok && first.applied, JSON.stringify(first));
      assert.strictEqual(RUNG.length, 1);
      assert.deepStrictEqual(RUNG[0].ids.sort(), [ME, LOCAL2].sort(), 'both people here, not the remote sender’s stub');
      assert.deepStrictEqual(RUNG[0].evt, { kind: 'message', id: CHIT, who: 'Raj' });
      await apply(ev);
      assert.strictEqual(RUNG.length, 1, 'a repeated event rings nothing');
    } finally {
      restore();
    }
  });
  await t('a dispute reply rings the dispute’s roster here when targeted, the whole chit when chit-wide', async () => {
    resetWorld();
    RUNG.length = 0;
    W.header = { sender_entity_bridge_id: B_STUB, all_recipients: [{ bridge_id: B_STUB }, { bridge_id: B_ME }, { bridge_id: B_LOCAL2 }] };
    W.status = [{ chit_id: CHIT, entity_id: ME, direction: 'received', current_status: 'pending' }, { chit_id: CHIT, entity_id: LOCAL2, direction: 'received', current_status: 'pending' }];
    W.disputes = [DISPUTE];
    W.roster = [{ entity_id: STUB, role: 'raiser', status: 'open' }, { entity_id: ME, role: 'party', status: 'open' }];
    const restore = stubMessages();
    try {
      W.scope = 'targeted';
      await apply({ kind: 'dispute_message', seq: 3, dispute_id: DISPUTE, message_id: MSG, message_text: 'We shipped 200', sender_display_name: 'Raj' });
      assert.deepStrictEqual(RUNG[0].ids, [ME], 'only the roster member here');
      RUNG.length = 0;
      W.scope = 'chit_wide';
      W.msgs.length = 0;
      await apply({ kind: 'dispute_message', seq: 4, dispute_id: DISPUTE, message_id: 'a0000000-0000-4000-8000-0000000000a2', message_text: 'And the rest', sender_display_name: 'Raj' });
      assert.deepStrictEqual(RUNG[0].ids.sort(), [ME, LOCAL2].sort());
    } finally {
      restore();
    }
  });
  await t('a chit that arrives over the wire rings the recipient the way a local send does (kind chit, who, note)', async () => {
    RUNG.length = 0;
    ret.onChitArrived(ME, CHIT, { sender_entity_display_name: 'AU Pumps', purpose: 'order' });
    assert.deepStrictEqual(RUNG, [{ ids: [ME], evt: { kind: 'chit', id: CHIT, who: 'AU Pumps', note: 'order' } }]);
  });
  await t('the bell is res-free: events.emit is the function, and routes/chits notifyAfter only defers it', async () => {
    const src = require('fs').readFileSync(root('lib/events.js'), 'utf8');
    assert.ok(/function notifyAfter\(res, entity_ids, evt\)[\s\S]*emit\(ids, e\)/.test(src), 'notifyAfter calls emit');
    assert.ok(!/\bres\b/.test(require('fs').readFileSync(root('lib/ctpreturn.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/'[^'\n]*'/g, '').replace(/`[^`]*`/g, '')), 'ctpreturn needs no response object');
  });

  console.log('\n== 5 · a second local party gets its own timeline row ==\n');
  const logRows = () => sqlOf(/^INSERT INTO state_log/).map((x) => ({ entity: x.p[1], action: /'message_sent'/.test(x.s) ? 'message_sent' : x.p[2] }));
  await t('a message for two people here: each one’s own event writes that person’s row (the message itself is held once)', async () => {
    resetWorld();
    W.header = { sender_entity_bridge_id: B_STUB, all_recipients: [{ bridge_id: B_STUB }, { bridge_id: B_ME }, { bridge_id: B_LOCAL2 }] };
    W.status = [{ chit_id: CHIT, entity_id: ME, direction: 'received', current_status: 'pending' }, { chit_id: CHIT, entity_id: LOCAL2, direction: 'received', current_status: 'pending' }];
    const restore = stubMessages();
    try {
      const ev = { kind: 'message', seq: 5, message_id: MSG, message_text: 'Shipping tomorrow', msg_type: 'info', sender_display_name: 'Raj' };
      const first = await apply(ev);
      const second = await apply(ev, { to: { identity_id: LOCAL2 } });
      assert.ok(first.applied && second.applied, JSON.stringify([first, second]));
      assert.deepStrictEqual(logRows().filter((x) => x.action === 'message_sent').map((x) => x.entity).sort(), [ME, LOCAL2].sort());
      const again = await apply(ev, { to: { identity_id: LOCAL2 } });
      assert.ok(again.ok && again.applied === false, 'the same event again writes nothing more');
      assert.strictEqual(logRows().filter((x) => x.action === 'message_sent').length, 2);
    } finally {
      restore();
    }
  });
  await t('a dispute reply writes the timeline row for the dispute’s whole audience here: the roster through chit_log_targets, the chit through chit_log_all', async () => {
    resetWorld();
    W.header = { sender_entity_bridge_id: B_STUB, all_recipients: [{ bridge_id: B_STUB }, { bridge_id: B_ME }, { bridge_id: B_LOCAL2 }] };
    W.status = [{ chit_id: CHIT, entity_id: ME, direction: 'received', current_status: 'pending' }, { chit_id: CHIT, entity_id: LOCAL2, direction: 'received', current_status: 'pending' }];
    W.disputes = [DISPUTE];
    W.roster = [{ entity_id: STUB, role: 'raiser', status: 'open' }, { entity_id: ME, role: 'party', status: 'open' }, { entity_id: LOCAL2, role: 'party', status: 'open' }];
    const restore = stubMessages();
    try {
      W.scope = 'targeted';
      const r = await apply({ kind: 'dispute_message', seq: 6, dispute_id: DISPUTE, message_id: MSG, message_text: 'We shipped 200', sender_display_name: 'Raj' });
      assert.ok(r.ok && r.applied, JSON.stringify(r));
      const targets = sqlOf(/SELECT chit_log_targets/).filter((x) => x.p[2] === 'message_sent');
      assert.strictEqual(targets.length, 1);
      assert.deepStrictEqual(targets[0].p[1].slice().sort(), [STUB, ME, LOCAL2].sort(), 'every roster member here, not only the one the event was addressed to');
      W.scope = 'chit_wide';
      const wide = await apply({ kind: 'dispute_message', seq: 7, dispute_id: DISPUTE, message_id: 'a0000000-0000-4000-8000-0000000000a3', message_text: 'And the rest', sender_display_name: 'Raj' });
      assert.ok(wide.applied);
      assert.strictEqual(sqlOf(/SELECT chit_log_all/).length, 1);
      const again = await apply({ kind: 'dispute_message', seq: 7, dispute_id: DISPUTE, message_id: 'a0000000-0000-4000-8000-0000000000a3', message_text: 'And the rest', sender_display_name: 'Raj' });
      assert.ok(again.ok && again.applied === false);
      assert.strictEqual(sqlOf(/SELECT chit_log_all/).length, 1, 'once');
    } finally {
      restore();
    }
  });

  console.log('\n== 6 · the message size limit, in the one writer ==\n');
  const limit = require(root('lib/message-limit'));
  await t('the limit is one number in one place: 10,000 characters fit, 10,001 are refused in words by the writer itself', async () => {
    assert.strictEqual(limit.MESSAGE_MAX_CHARS, 10000);
    assert.strictEqual(limit.tooLong('x'.repeat(10000)), null);
    const err = limit.tooLong('x'.repeat(10001));
    assert.ok(err && err.code === 'MESSAGE_TOO_LONG' && err.status === 413 && /10,001 characters/.test(err.message) && /10,000/.test(err.message) && /Nothing was sent/.test(err.message), err && err.message);
    resetWorld();
    let thrown = null;
    try {
      await require(root('lib/chit-crossing')).postMessageCopies({ chit_id: CHIT, sender_entity_id: ME, sender_display_name: 'IN Plant', thread_type: 'external', message_text: 'y'.repeat(100000) });
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown && thrown.code === 'MESSAGE_TOO_LONG', 'the writer refuses any door’s 100,000-character message');
    assert.strictEqual(sqlOf(/chit_message_deliver/).length, 0, 'nothing written');
  });
  await t('the message route answers 413 MESSAGE_TOO_LONG in words, writes nothing and queues nothing; a message at the limit goes and crosses', async () => {
    resetWorld();
    const big = await call('POST', '/api/chits/' + CHIT + '/messages', tok(ME), { message_text: 'z'.repeat(100000), thread_type: 'external' });
    assert.strictEqual(big.status, 413, JSON.stringify(big.body).slice(0, 300));
    assert.strictEqual(big.body.code, 'MESSAGE_TOO_LONG');
    assert.ok(/most one message can hold/.test(big.body.message || big.body.detail), JSON.stringify(big.body).slice(0, 300));
    assert.strictEqual(sqlOf(/chit_message_deliver/).length, 0);
    assert.strictEqual(W.out.length, 0);
    const ok = await call('POST', '/api/chits/' + CHIT + '/messages', tok(ME), { message_text: 'z'.repeat(10000), thread_type: 'external' });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body).slice(0, 300));
    assert.strictEqual(W.out.length, 1);
  });
  await t('a dispute reason over the limit is refused the same way and nothing is raised or queued', async () => {
    resetWorld();
    const r = await call('POST', '/api/chits/' + CHIT + '/disputes', tok(ME), { category: 'quantity', reason: 'q'.repeat(10001), target_entity_id: STUB });
    assert.strictEqual(r.status, 413, JSON.stringify(r.body).slice(0, 300));
    assert.strictEqual(r.body.code, 'MESSAGE_TOO_LONG');
    assert.strictEqual(W.out.length, 0);
  });
  await t('an event that arrives from another installation is held to the same limit (refused 400 in words, nothing posted)', async () => {
    resetWorld();
    W.header = { sender_entity_bridge_id: B_STUB, all_recipients: [{ bridge_id: B_STUB }, { bridge_id: B_ME }] };
    const r = await apply({ kind: 'message', seq: 2, message_id: MSG, message_text: 'm'.repeat(10001), msg_type: 'info' });
    assert.ok(!r.ok && r.status === 400 && r.code === 'CTP_EVENT_BAD' && /10000 characters/.test(r.why), JSON.stringify(r));
  });

  console.log('\n== 7 · the bell for accepted, rejected, cancelled and for a dispute raised or resolved ==\n');
  const rungKinds = () => RUNG.map((x) => [x.ids.slice().sort(), x.evt.kind, x.evt.status || x.evt.what]);
  await t('a status move to accepted, rejected or cancelled rings the OTHER parties once (here); any other move pushes QUIETLY (F15: it repaints an open chit, rings no bell)', async () => {
    for (const status of ['accepted', 'rejected', 'cancelled']) {
      resetWorld();
      RUNG.length = 0;
      W.status = [{ chit_id: CHIT, entity_id: ME, direction: 'received', current_status: 'pending' }];
      W.header = { sender_entity_bridge_id: B_STUB, all_recipients: [{ bridge_id: B_STUB, entity_id: STUB, role: 'sender' }, { bridge_id: B_ME, entity_id: ME, role: 'receiver' }, { bridge_id: B_LOCAL2, entity_id: LOCAL2, role: 'cc' }] };
      W.senderId = STUB;
      const mv = await require(root('lib/chit-move')).moveStatus(ME, CHIT, status, { id: ME, name: 'Asha' }, status === 'rejected' ? 'wrong item' : '', EDITOR);
      assert.strictEqual(mv.code, 200, status + ' ' + JSON.stringify(mv.body));
      const bells = RUNG.filter((x) => x.evt.kind === 'status');
      assert.strictEqual(bells.length, 1, status);
      assert.deepStrictEqual(bells[0].ids.slice().sort(), [STUB, LOCAL2].sort(), 'everyone named on the chit except the one who moved it');
      assert.deepStrictEqual([bells[0].evt.status, bells[0].evt.id], [status, CHIT]);
    }
    resetWorld();
    RUNG.length = 0;
    W.status = [{ chit_id: CHIT, entity_id: ME, direction: 'received', current_status: 'accepted' }];
    W.header = { sender_entity_bridge_id: B_STUB, all_recipients: [{ bridge_id: B_STUB, entity_id: STUB, role: 'sender' }, { bridge_id: B_ME, entity_id: ME, role: 'receiver' }, { bridge_id: B_LOCAL2, entity_id: LOCAL2, role: 'cc' }] };
    W.senderId = STUB;
    await require(root('lib/chit-move')).moveStatus(ME, CHIT, 'in_progress', { id: ME, name: 'Asha' }, '', EDITOR);
    const quiet = RUNG.filter((x) => x.evt.kind === 'status');
    assert.strictEqual(quiet.length, 1, 'in progress pushes once, to the same roster');
    assert.deepStrictEqual(quiet[0].ids.slice().sort(), [STUB, LOCAL2].sort());
    assert.strictEqual(quiet[0].evt.quiet, true, 'and quietly: no bell row, no toast');
    assert.strictEqual(quiet[0].evt.status, 'in_progress');
  });
  await t('a status that arrives from another installation rings the local people on the chit once; a repeat rings nothing', async () => {
    resetWorld();
    RUNG.length = 0;
    W.header = { sender_entity_bridge_id: B_ME, all_recipients: [{ bridge_id: B_ME, entity_id: ME, role: 'sender' }, { bridge_id: B_STUB, entity_id: STUB, role: 'receiver' }, { bridge_id: B_LOCAL2, entity_id: LOCAL2, role: 'cc' }] };
    W.status = [{ chit_id: CHIT, entity_id: ME, direction: 'sent', current_status: 'delivered' }, { chit_id: CHIT, entity_id: LOCAL2, direction: 'received', current_status: 'pending' }];
    const ev = { kind: 'status', seq: 4, status: 'accepted', previous_status: 'pending', copy: 'received', by_name: 'Raj' };
    const first = await apply(ev);
    assert.ok(first.ok && first.applied, JSON.stringify(first));
    assert.deepStrictEqual(rungKinds(), [[[ME, LOCAL2].sort(), 'status', 'accepted']]);
    RUNG.length = 0;
    await apply(ev);
    assert.strictEqual(RUNG.length, 0);
    await apply(Object.assign({}, ev, { seq: 5, status: 'in_progress' }));
    assert.deepStrictEqual(rungKinds(), [[[ME, LOCAL2].sort(), 'status', 'in_progress']], 'F15: a status that does not ring still pushes, to the same roster');
    assert.strictEqual(RUNG[0].evt.quiet, true, 'quietly');
    assert.ok(!RUNG.some((x) => x.evt.status === 'accepted' && x.evt.quiet), 'a bell status is never quiet');
  });
  await t('a dispute raised (the real route) rings the parties named on it — on an international deal only; a domestic chit rings nothing, exactly as before 25 Oct', async () => {
    for (const international of [false, true]) {
      resetWorld();
      RUNG.length = 0;
      W.header = { sender_entity_bridge_id: B_ME, all_recipients: [{ bridge_id: B_ME, entity_id: ME, role: 'sender' }, { bridge_id: B_LOCAL2, entity_id: LOCAL2, role: 'receiver' }].concat(international ? [{ bridge_id: B_STUB, entity_id: STUB, role: 'cc' }] : []) };
      if (!international) W.place = {};
      W.status = [{ chit_id: CHIT, entity_id: ME, direction: 'sent', current_status: 'delivered' }, { chit_id: CHIT, entity_id: LOCAL2, direction: 'received', current_status: 'pending' }];
      const r = await call('POST', '/api/chits/' + CHIT + '/disputes', tok(ME), { category: 'quantity', reason: 'Short by forty units', target_entity_id: LOCAL2 });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.deepStrictEqual(rungKinds().filter((x) => x[1] === 'dispute'), international ? [[[LOCAL2], 'dispute', 'raised']] : [], 'raised ' + (international ? 'international' : 'domestic'));
      RUNG.length = 0;
      W.disputeRow = { dispute_id: DISPUTE, chit_id: CHIT, status: 'open', raised_by_entity_id: ME, category: 'quantity', scope: 'targeted' };
      W.roster = [{ entity_id: ME, role: 'raiser', status: 'open' }, { entity_id: LOCAL2, role: 'party', status: 'open' }];
      const done = await call('PUT', '/api/chits/' + CHIT + '/disputes/' + DISPUTE + '/resolve', tok(ME), { resolution_note: 'Credit note issued' });
      assert.strictEqual(done.status, 200, JSON.stringify(done.body));
      assert.deepStrictEqual(rungKinds().filter((x) => x[1] === 'dispute'), international ? [[[LOCAL2], 'dispute', 'resolved']] : [], 'resolved ' + (international ? 'international' : 'domestic'));
    }
  });
  await t('a status move on a DOMESTIC chit (all parties here) rings nobody, as before; one composed as an RFQ rings like an international deal', async () => {
    for (const dealType of [undefined, 'rfq']) {
      resetWorld();
      RUNG.length = 0;
      W.place = {};
      W.status = [{ chit_id: CHIT, entity_id: ME, direction: 'received', current_status: 'pending' }];
      W.header = { sender_entity_bridge_id: B_LOCAL2, all_recipients: [{ bridge_id: B_LOCAL2, entity_id: LOCAL2, role: 'sender' }, { bridge_id: B_ME, entity_id: ME, role: 'receiver' }] };
      W.senderId = LOCAL2;
      W.businessJson = dealType ? { deal_type: dealType } : {};
      const mv = await require(root('lib/chit-move')).moveStatus(ME, CHIT, 'accepted', { id: ME, name: 'Asha' }, '', EDITOR);
      assert.strictEqual(mv.code, 200, JSON.stringify(mv.body));
      assert.strictEqual(RUNG.filter((x) => x.evt.kind === 'status').length, dealType ? 1 : 0, String(dealType));
    }
  });
  await t('a dispute raised or resolved on another installation rings the local parties on arrival, once', async () => {
    resetWorld();
    RUNG.length = 0;
    W.header = { sender_entity_bridge_id: B_STUB, all_recipients: [{ bridge_id: B_STUB, entity_id: STUB, role: 'sender' }, { bridge_id: B_ME, entity_id: ME, role: 'receiver' }] };
    const raise = {
      kind: 'dispute_raise', seq: 6, dispute_id: DISPUTE, category: 'quantity', reason: 'Short by forty units', scope: 'targeted', mode: 'two_sided', answerable: true, parity_state: 'present', via: 'chit', evidence: {}, actor_name: 'Raj',
      raiser: { bridge_id: B_STUB, display_name: 'AU Pumps' }, target: { bridge_id: B_ME, display_name: 'IN Plant', target_name: 'IN Plant' },
      roster: [{ bridge_id: B_STUB, display_name: 'AU Pumps', role: 'raiser' }, { bridge_id: B_ME, display_name: 'IN Plant', role: 'party' }], reason_message_id: 'a0000000-0000-4000-8000-0000000000b1'
    };
    const first = await apply(raise);
    assert.ok(first.ok && first.applied, JSON.stringify(first));
    assert.deepStrictEqual(rungKinds().filter((x) => x[1] === 'dispute'), [[[ME], 'dispute', 'raised']]);
    RUNG.length = 0;
    W.disputes = [DISPUTE]; /* the database now holds it */
    await apply(raise);
    assert.strictEqual(RUNG.length, 0, 'a repeat rings nothing');
    W.roster = [{ entity_id: STUB, role: 'raiser', status: 'open' }, { entity_id: ME, role: 'party', status: 'open' }];
    const resolved = await apply({ kind: 'dispute_resolve', seq: 7, dispute_id: DISPUTE, target: null, resolution_note: 'Credit note issued', category: 'quantity', actor_name: 'Raj', resolver_name: 'AU Pumps' });
    assert.ok(resolved.ok && resolved.applied, JSON.stringify(resolved));
    assert.deepStrictEqual(rungKinds().filter((x) => x[1] === 'dispute'), [[[ME], 'dispute', 'resolved']]);
  });

  //__END__
  console.error = origErr;
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
