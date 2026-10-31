/**
 * tests/ctp-return-path.test.cjs — RAIL-106 (takes in RAIL-114): THE CTP RETURN PATH. A change to a chit that already crossed (a status move, an external message) reaches the party on
 * the other installation as a signed EVENT through the same door; the receiver applies it to its OWN rows; a queue resends until accepted; a dispute across installations is refused in words.
 *
 *   A  the envelope kind: build/seal/open round trip over a real socket-shaped JSON trip; a tampered event, an unknown kind and an event with no event are refused; an old deliver envelope
 *      still hashes exactly as before (the signature made yesterday verifies today)
 *   B  ordering and idempotency at the receiver: newer wins, an older or repeated status is acknowledged and ignored; one message id is kept once; a stranger's party, an unknown chit and a party
 *      that is not on the chit are refused in words; the sender's installation must be the stub's installation
 *   C  the queue: a change is queued once per remote party with a shared sequence per (chit, sender); a local-only chit queues nothing; the resend accepts, backs off, gives up in words,
 *      and goes oldest first; an accepted row clears the "not yet confirmed" mark
 *   D  moveStatus (the ONE status writer) emits for a remote party and not for a local one, and a bill step never crosses
 *   E  the dispute refusal is retired (disputes now cross: tests/ctp-return-disputes.test.cjs)
 *   F  the new codes are registered (the door itself is tests/ctp-return-door.test.cjs)
 *
 * Offline: the database, the address book and the transport are stubs. Run: node tests/ctp-return-path.test.cjs
 */
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-ctp-return';
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

/* ── ids ─────────────────────────────────────────────────────────────────────────────────────────────────── */
const ME = '11111111-1111-4111-8111-111111111111'; /* my business here (sit-in) */
const STUB = '22222222-2222-4222-8222-222222222222'; /* the stub of the business on sit-au */
const OTHER_LOCAL = '33333333-3333-4333-8333-333333333333'; /* a second business here */
const CHIT = 'c0000000-0000-4000-8000-0000000000c1';
const MSG = 'a0000000-0000-4000-8000-0000000000a1';
const B_ME = 'CBME00001A',
  B_STUB = 'CBAU00001B',
  B_LOCAL2 = 'CBLO00001C';

/* ── the world: in-memory rows, every statement recorded ─────────────────────────────────────────────────── */
let W;
const resetWorld = () => {
  W = {
    sent: [],
    status: [], // { chit_id, entity_id, direction, current_status }
    out: [], // ctp_event_out rows
    inw: [], // ctp_event_in rows
    log: [], // state_log inserts
    msgs: [], // chit_messages held
    nextId: 1,
    headers: {
      [ME]: { sender_entity_bridge_id: B_ME, all_recipients: [{ bridge_id: B_ME, role: 'sender' }, { bridge_id: B_STUB, role: 'to' }] }
    },
    ident: {
      [B_ME]: { identity_id: ME, bridge_id: B_ME, display_name: 'IN Plant' },
      [B_STUB]: { identity_id: STUB, bridge_id: B_STUB, display_name: 'AU Pumps' },
      [B_LOCAL2]: { identity_id: OTHER_LOCAL, bridge_id: B_LOCAL2, display_name: 'IN Neighbour' }
    },
    place: { [STUB]: { local: false, installation_key: 'sit-au', endpoint: 'https://au.example/api/ctp/deliver' } }
  };
};
resetWorld();
const one = (s) => String(s).replace(/\s+/g, ' ').trim();
function rowsFor(sql, p) {
  const s = one(sql);
  p = p || [];
  W.sent.push(s);
  if (/FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2 LIMIT 1/.test(s) && /all_recipients/.test(s)) {
    const h = W.headers[p[1]];
    return h ? [h] : [];
  }
  if (/FROM identities WHERE bridge_id = ANY/.test(s)) return p[0].map((b) => W.ident[b]).filter(Boolean);
  if (/FROM identities WHERE bridge_id = \$1 AND identity_type = 'entity'/.test(s)) return W.ident[p[0]] ? [W.ident[p[0]]] : [];
  if (/pg_advisory_xact_lock/.test(s)) return [{}];
  if (/coalesce\(max\(seq\), 0\) \+ 1 AS seq FROM ctp_event_out/.test(s)) {
    const mine = W.out.filter((r) => r.chit_id === p[0] && r.from_entity_id === p[1]);
    return [{ seq: Math.max(0, ...mine.map((r) => r.seq)) + 1 }];
  }
  if (/^INSERT INTO ctp_event_out/.test(s)) {
    W.out.push({ id: W.nextId++, chit_id: p[0], from_entity_id: p[1], seq: p[2], kind: p[3], event: JSON.parse(p[4]), to_entity_id: p[5], to_bridge_id: p[6], to_installation_key: p[7], status: 'pending', attempts: 0, last_error: null, created_at: new Date() });
    return [{}];
  }
  if (/FROM ctp_event_out WHERE chit_id = \$1 AND from_entity_id = \$2 AND status <> 'accepted'/.test(s))
    return W.out.filter((r) => r.chit_id === p[0] && r.from_entity_id === p[1] && r.status !== 'accepted').map((r) => Object.assign({ message_id: r.event.message_id }, r));
  if (/^UPDATE ctp_event_out/.test(s)) {
    const r = W.out.find((x) => x.id === p[0]);
    Object.assign(r, { status: p[1], attempts: p[2], last_error: p[3], backoff: p[4] });
    return [{}];
  }
  if (/^SELECT \* FROM ops\.f_ctp_event_due/.test(s)) {
    /* what the SQL function does: the head of each stream, due */
    const heads = new Map();
    for (const r of W.out.filter((x) => x.status === 'pending').sort((a, b) => a.seq - b.seq)) {
      const k = r.chit_id + r.from_entity_id + r.to_bridge_id;
      if (!heads.has(k)) heads.set(k, r);
    }
    return [...heads.values()].filter((r) => !r.hold);
  }
  if (/^SELECT last_seq FROM ctp_event_in/.test(s)) return W.inw.filter((r) => r.chit_id === p[0] && r.remote_entity_id === p[1] && r.entity_id === p[2]).map((r) => ({ last_seq: r.last_seq }));
  if (/^INSERT INTO ctp_event_in/.test(s)) {
    const cur = W.inw.find((r) => r.chit_id === p[0] && r.remote_entity_id === p[1] && r.entity_id === p[2]);
    if (cur && cur.last_seq >= p[3]) return [];
    if (cur) cur.last_seq = p[3];
    else W.inw.push({ chit_id: p[0], remote_entity_id: p[1], entity_id: p[2], last_seq: p[3] });
    return [{ last_seq: p[3] }];
  }
  if (/^INSERT INTO state_log/.test(s)) {
    W.log.push(p);
    return [{}];
  }
  const dir = (s.match(/direction = '(received|sent)'/) || [])[1];
  if (/^SELECT current_status FROM chit_status/.test(s)) return W.status.filter((r) => r.chit_id === p[0] && r.entity_id === p[1] && (!dir || r.direction === dir)).map((r) => ({ current_status: r.current_status }));
  if (/^UPDATE chit_status SET current_status = \$1/.test(s)) {
    const hit = W.status.filter((r) => r.chit_id === p[1] && r.entity_id === p[2] && r.direction === dir && r.current_status === p[3]);
    hit.forEach((r) => (r.current_status = p[0]));
    return hit.map((r) => ({ chit_id: r.chit_id }));
  }
  if (/^INSERT INTO chit_status \(chit_id, entity_id, current_status, direction\) VALUES \(\$1, \$2, \$3, \$4\)/.test(s)) {
    const dup = W.status.find((r) => r.chit_id === p[0] && r.entity_id === p[1] && r.direction === p[3]);
    if (!dup) W.status.push({ chit_id: p[0], entity_id: p[1], current_status: p[2], direction: p[3] });
    return dup ? [] : [{}];
  }
  if (/^SELECT 1 FROM chit_messages WHERE message_id/.test(s)) return W.msgs.filter((m) => m.message_id === p[0] && m.entity_id === p[1]).map(() => ({ '?column?': 1 }));
  if (/SELECT sender_entity_id, purpose, business_json FROM chit_header/.test(s)) return [{ sender_entity_id: STUB, purpose: 'order', business_json: {} }];
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
/* the address book: the stub of the AU business is on sit-au, everybody else is here */
const book = {
  remoteInstallations: async () => (W.place && Object.keys(W.place).length ? new Map([['sit-au', { endpoint: 'x', active: true }]]) : new Map()),
  resolve: async (id) => W.place[id] || { entity_id: id, local: true, installation_key: null, endpoint: null },
  resolveAll: async () => new Map(),
  peerByKey: async () => ({ peer: null, status: 403, why: 'stub' }),
  invalidate() {}
};
stub('lib/ctpaddress.js', book);
const sc = require(root('lib/schema'));
sc.hasTable = async () => true;
sc.hasColumn = async () => false;

const envelope = require(root('lib/ctpenvelope'));
const canon = require(root('lib/canon'));
const railStatus = require(root('lib/rail-status'));
const ret = require(root('lib/ctpreturn'));

/* the transport: records, and answers as told */
const transport = require(root('lib/ctptransport'));
let TRANSPORT_ANSWER = { accepted: true, status: 200, why: 'accepted' };
const SENT_ENV = [];
transport.send = async (endpoint, env) => {
  SENT_ENV.push({ endpoint, env });
  return TRANSPORT_ANSWER;
};
const mint = require(root('lib/mint'));
mint.senderAddress = async (id) => ({ installation_key: 'sit-in', population: 'live', bridge_id: id === ME ? B_ME : B_STUB, display_name: 'IN Plant' });

const FROM = { installation_key: 'sit-au', population: 'live', bridge_id: B_STUB, display_name: 'AU Pumps' };
const TO = { identity_id: ME };
const wire = (env) => JSON.parse(JSON.stringify(env));
const statusEv = (seq, status) => ({ kind: 'status', seq, status, previous_status: 'pending', copy: 'received', by_name: 'Raj', note: null });
const msgEv = (id, text) => ({ kind: 'message', seq: 1, message_id: id, message_text: text, msg_type: 'info', sender_display_name: 'Raj' });
const apply = (event, over) => ret.apply(Object.assign({ chit_id: CHIT, event, from: FROM, to: TO }, over || {}));

(async () => {
  console.log('\n== A · the event envelope ==\n');
  await t('an event seals, crosses JSON and opens; it carries the event and no copy', async () => {
    const env = envelope.buildEvent(FROM, { bridge_id: B_ME }, { chit_id: CHIT, event: statusEv(1, 'accepted') });
    assert.strictEqual(env.kind, 'event');
    assert.strictEqual(env.copy, undefined);
    /* RAIL-141 a (main): an envelope with no way to check its seal is refused, so the event is sealed with a real key and opened with its verifier */
    const kp = crypto.generateKeyPairSync('ed25519');
    const signer = { alg: 'ed25519', sign: (h) => crypto.sign(null, Buffer.from(h, 'utf8'), kp.privateKey).toString('base64') };
    const verify = (hash, sig) => crypto.verify(null, Buffer.from(hash, 'utf8'), kp.publicKey, Buffer.from(sig, 'base64'));
    const out = envelope.open(wire(envelope.sign(env, signer)), { population: 'live', verify });
    assert.strictEqual(envelope.open(wire(envelope.sign(env, null)), { population: 'live', verify: undefined }).ok, false, 'no verifier = refused (RAIL-141 a)');
    assert.ok(out.ok, out.why);
    assert.strictEqual(out.kind, 'event');
    assert.strictEqual(out.event.status, 'accepted');
    assert.strictEqual(out.copy, undefined);
  });
  await t('a tampered event no longer opens (the event is sealed)', async () => {
    const kp = crypto.generateKeyPairSync('ed25519');
    const signer = { alg: 'ed25519', sign: (h) => crypto.sign(null, Buffer.from(h, 'utf8'), kp.privateKey).toString('base64') };
    const verify = (hash, sig) => crypto.verify(null, Buffer.from(hash, 'utf8'), kp.publicKey, Buffer.from(sig, 'base64'));
    const sealed = wire(envelope.sign(envelope.buildEvent(FROM, { bridge_id: B_ME }, { chit_id: CHIT, event: statusEv(1, 'accepted') }), signer));
    assert.ok(envelope.open(sealed, { population: 'live', verify }).ok, 'the honest one opens');
    sealed.event.status = 'completed';
    const out = envelope.open(sealed, { population: 'live', verify });
    assert.ok(!out.ok && /seal does not match/.test(out.why), out.why);
    const swapped = wire(envelope.sign(envelope.buildEvent(FROM, { bridge_id: B_ME }, { chit_id: CHIT, event: statusEv(1, 'accepted') }), signer));
    delete swapped.kind; /* an event stripped of its kind is not a delivery either: no copy, and the seal breaks */
    assert.ok(!envelope.open(swapped, { population: 'live', verify }).ok);
  });
  await t('an unknown kind and an event with no event are refused in words', async () => {
    const base = wire(envelope.sign(envelope.buildEvent(FROM, { bridge_id: B_ME }, { chit_id: CHIT, event: statusEv(1, 'accepted') }), null));
    assert.ok(/not a kind/.test(envelope.open(Object.assign({}, base, { kind: 'forward' }), { population: 'live' }).why));
    const none = Object.assign({}, base);
    delete none.event;
    assert.ok(/missing a required part/.test(envelope.open(none, { population: 'live' }).why));
    assert.throws(() => envelope.buildEvent(FROM, { bridge_id: B_ME }, { chit_id: CHIT, event: {} }), /event with a kind/);
  });
  await t('an envelope sealed before the event kind existed hashes exactly as before', async () => {
    const old = envelope.build(FROM, { bridge_id: B_ME }, { chit_id: CHIT, header: { a: 1 }, copy: { entity_id: ME, x: 'y' }, attachments: [] });
    const thenHash = canon.hash(JSON.parse(JSON.stringify({ ctp: old.ctp, chit_id: old.chit_id, from: old.from, to: old.to, header: old.header, copy: old.copy, attachments: old.attachments })));
    assert.strictEqual(envelope.digest(old), thenHash);
  });

  console.log('\n== B · the receiver: newer wins, repeats are ignored, strangers are refused ==\n');
  resetWorld();
  await t('a status event creates the shadow of the other party and mirrors the word; the timeline gets a row', async () => {
    const r = await apply(statusEv(1, 'accepted'));
    assert.ok(r.ok && r.applied, JSON.stringify(r));
    const shadow = W.status.find((x) => x.entity_id === STUB);
    assert.ok(shadow && shadow.current_status === 'accepted' && shadow.direction === 'received', JSON.stringify(W.status));
    assert.strictEqual(W.log.length, 1);
    assert.strictEqual(W.log[0][2], 'status_accepted');
  });
  await t('the same event again is acknowledged and ignored (idempotent): no second timeline row', async () => {
    const r = await apply(statusEv(1, 'accepted'));
    assert.ok(r.ok && r.applied === false, JSON.stringify(r));
    assert.strictEqual(W.log.length, 1);
  });
  await t('a newer event moves the shadow; an OLDER one that arrives late is ignored and does not move it back', async () => {
    assert.ok((await apply(statusEv(3, 'completed'))).applied);
    assert.strictEqual(W.status.find((x) => x.entity_id === STUB).current_status, 'completed');
    const late = await apply(statusEv(2, 'in_progress'));
    assert.ok(late.ok && late.applied === false);
    assert.strictEqual(W.status.find((x) => x.entity_id === STUB).current_status, 'completed');
    assert.strictEqual(W.inw[0].last_seq, 3);
  });
  await t('the statuses go through the ONE status UPDATE (rail-status), never a SET of their own', async () => {
    assert.ok(typeof railStatus.mirror === 'function');
    assert.ok(W.sent.some((s) => /^UPDATE chit_status SET current_status = \$1/.test(s) && /direction = 'received'/.test(s)));
  });
  await t('a message is kept once: our own copy through postMessageCopies with the id it was sent with; the same id again is ignored', async () => {
    const posted = [];
    /* sit/run6: lib/ctpreturn posts an arrived message through lib/chit-crossing postMessageCopies (the function the routes use; routes/chits no longer re-exports it) */
    const chitsPath = require.resolve(root('lib/chit-crossing.js'));
    const hadChits = require.cache[chitsPath];
    require.cache[chitsPath] = {
      id: chitsPath,
      filename: chitsPath,
      loaded: true,
      exports: {
        postMessageCopies: async (m) => {
          posted.push(m);
          W.msgs.push({ message_id: m.message_id, entity_id: ME });
          return { message_id: m.message_id };
        }
      }
    };
    try {
      const first = await apply(msgEv(MSG, 'Please confirm the date'));
      assert.ok(first.ok && first.applied, JSON.stringify(first));
      assert.strictEqual(posted.length, 1);
      assert.strictEqual(posted[0].message_id, MSG);
      assert.strictEqual(posted[0].sender_entity_id, STUB);
      assert.strictEqual(posted[0].thread_type, 'external');
      assert.strictEqual(posted[0].arrived, true, 'ARRIVAL IS NOT A ROUTING DECISION — it must not be queued onward');
      const again = await apply(msgEv(MSG, 'Please confirm the date'));
      assert.ok(again.ok && again.applied === false);
      assert.strictEqual(posted.length, 1);
      /* an earlier message that arrives AFTER a later one is still kept (messages are keyed by id, not by sequence) */
      const earlier = await apply(msgEv('a0000000-0000-4000-8000-0000000000a2', 'and the invoice'));
      assert.ok(earlier.applied);
    } finally {
      if (hadChits) require.cache[chitsPath] = hadChits;
      else delete require.cache[chitsPath];
    }
  });
  await t('a business we hold no stub for is refused 404 CTP_EVENT_PARTY_UNKNOWN', async () => {
    const r = await apply(statusEv(9, 'accepted'), { from: Object.assign({}, FROM, { bridge_id: 'CBNOBODY01' }) });
    assert.ok(!r.ok && r.status === 404 && r.code === 'CTP_EVENT_PARTY_UNKNOWN', JSON.stringify(r));
  });
  await t('an installation speaking for a business that lives on another installation is refused 409 CTP_EVENT_PARTY_MISMATCH', async () => {
    const r = await apply(statusEv(9, 'accepted'), { from: Object.assign({}, FROM, { installation_key: 'sit-evil' }) });
    assert.ok(!r.ok && r.status === 409 && r.code === 'CTP_EVENT_PARTY_MISMATCH', JSON.stringify(r));
  });
  await t('a chit this business does not hold is refused 404 CTP_EVENT_NO_CHIT; a sender who is not on the chit is refused 409', async () => {
    const r = await apply(statusEv(9, 'accepted'), { to: { identity_id: OTHER_LOCAL } });
    assert.ok(!r.ok && r.status === 404 && r.code === 'CTP_EVENT_NO_CHIT', JSON.stringify(r));
    W.headers[ME] = { sender_entity_bridge_id: B_ME, all_recipients: [{ bridge_id: B_ME }, { bridge_id: B_LOCAL2 }] };
    const r2 = await apply(statusEv(9, 'accepted'));
    assert.ok(!r2.ok && r2.status === 409 && r2.code === 'CTP_EVENT_PARTY_MISMATCH', JSON.stringify(r2));
  });
  await t('a malformed event is refused 400 CTP_EVENT_BAD', async () => {
    for (const bad of [{ kind: 'status', seq: 0, status: 'accepted' }, { kind: 'status', seq: 1, status: 'DROP TABLE' }, { kind: 'message', message_id: 'x', message_text: 'hi' }, { kind: 'message', message_id: MSG, message_text: '  ' }, { kind: 'forward' }]) {
      const r = await apply(bad);
      assert.ok(!r.ok && r.status === 400 && r.code === 'CTP_EVENT_BAD', JSON.stringify(bad) + ' -> ' + JSON.stringify(r));
    }
  });

  console.log('\n== C · the queue and its resend ==\n');
  resetWorld();
  await t('a status change on a chit with a remote party is queued once for that party', async () => {
    const r = await ret.onStatusMoved(ME, CHIT, { status: 'accepted', previous_status: 'pending', by_name: 'Asha', note: 'ok' });
    assert.deepStrictEqual({ queued: r.queued, seq: r.seq }, { queued: 1, seq: 1 });
    assert.strictEqual(W.out.length, 1);
    assert.strictEqual(W.out[0].to_bridge_id, B_STUB);
    assert.strictEqual(W.out[0].to_installation_key, 'sit-au');
    assert.strictEqual(W.out[0].event.status, 'accepted');
    assert.strictEqual(W.out[0].event.copy, 'received');
  });
  await t('the sequence runs per (chit, sender): the next change is 2', async () => {
    assert.strictEqual((await ret.onStatusMoved(ME, CHIT, { status: 'completed', previous_status: 'accepted', by_name: 'Asha' })).seq, 2);
  });
  await t('a chit whose parties are all here queues nothing and reads nothing past the memoised answer', async () => {
    resetWorld();
    W.headers[ME].all_recipients = [{ bridge_id: B_ME }, { bridge_id: B_LOCAL2 }];
    const r = await ret.onStatusMoved(ME, CHIT, { status: 'accepted' });
    assert.deepStrictEqual(r, { queued: 0 });
    assert.strictEqual(W.out.length, 0);
    resetWorld();
    W.place = {}; /* nothing hosted elsewhere at all: the fast path */
    const before = W.sent.length;
    assert.deepStrictEqual(await ret.onStatusMoved(ME, CHIT, { status: 'accepted' }), { queued: 0 });
    assert.strictEqual(W.sent.length, before, 'not one statement was sent');
  });
  await t('an internal note and a dispute message never queue; an external message does, with its id', async () => {
    resetWorld();
    assert.strictEqual((await ret.onMessagePosted(ME, { chit_id: CHIT, thread_type: 'internal', message_text: 'x' }, { message_id: MSG })).queued, 0);
    assert.strictEqual((await ret.onMessagePosted(ME, { chit_id: CHIT, thread_type: 'external', is_dispute: true, message_text: 'x' }, { message_id: MSG })).queued, 0);
    assert.strictEqual((await ret.onMessagePosted(ME, { chit_id: CHIT, thread_type: 'external', arrived: true, message_text: 'x' }, { message_id: MSG })).queued, 0, 'what arrived is not sent on');
    const r = await ret.onMessagePosted(ME, { chit_id: CHIT, thread_type: 'external', message_text: 'Is it ready?', msg_type: 'query' }, { message_id: MSG });
    assert.strictEqual(r.queued, 1);
    assert.strictEqual(W.out[0].event.message_id, MSG);
    assert.strictEqual(W.out[0].event.message_text, 'Is it ready?');
  });
  await t('a queue that cannot be written says so in the answer (queued 0 + words), never silence', async () => {
    resetWorld();
    sc.hasTable = async () => false;
    const r = await ret.onStatusMoved(ME, CHIT, { status: 'accepted' });
    sc.hasTable = async () => true;
    assert.strictEqual(r.queued, 0);
    assert.ok(/could not be queued/.test(r.why), r.why);
  });
  await t('the resend sends the OLDEST of the stream, signs nothing itself, and an accepted row is marked accepted', async () => {
    resetWorld();
    await ret.onStatusMoved(ME, CHIT, { status: 'accepted', by_name: 'A' });
    await ret.onStatusMoved(ME, CHIT, { status: 'completed', by_name: 'A' });
    SENT_ENV.length = 0;
    TRANSPORT_ANSWER = { accepted: true, status: 200, why: 'accepted' };
    const out = await ret.drain({});
    assert.strictEqual(out.accepted, 2, JSON.stringify(out));
    assert.deepStrictEqual(SENT_ENV.map((x) => x.env.event.seq), [1, 2], 'in order');
    assert.ok(SENT_ENV.every((x) => x.endpoint === 'https://au.example/api/ctp/deliver' && x.env.kind === 'event' && x.env.to.bridge_id === B_STUB && x.env.from.bridge_id === B_ME));
    assert.ok(W.out.every((r) => r.status === 'accepted'));
    assert.strictEqual(await ret.unconfirmed(ME, CHIT), null, 'nothing left to say');
  });
  await t('the far side down: the row stays pending with the reason and a longer wait; the mark says so; the next change waits behind it', async () => {
    resetWorld();
    await ret.onStatusMoved(ME, CHIT, { status: 'accepted', by_name: 'A' });
    await ret.onMessagePosted(ME, { chit_id: CHIT, thread_type: 'external', message_text: 'hello' }, { message_id: MSG });
    SENT_ENV.length = 0;
    TRANSPORT_ANSWER = { accepted: false, status: null, why: 'could not reach https://au.example/api/ctp/deliver: timed out' };
    const out = await ret.drain({});
    assert.deepStrictEqual({ tried: out.tried, still: out.still, accepted: out.accepted }, { tried: 1, still: 1, accepted: 0 }, 'only the head of the stream was tried');
    assert.strictEqual(SENT_ENV.length, 1);
    assert.strictEqual(SENT_ENV[0].env.event.kind, 'status');
    assert.strictEqual(W.out[0].status, 'pending');
    assert.strictEqual(W.out[0].attempts, 1);
    assert.ok(/timed out/.test(W.out[0].last_error));
    assert.strictEqual(W.out[0].backoff, '60');
    assert.strictEqual(W.out[1].attempts, 0, 'the message did not overtake the status');
    const mark = await ret.unconfirmed(ME, CHIT);
    assert.strictEqual(mark.count, 2);
    assert.strictEqual(mark.failed, false);
    assert.strictEqual(mark.words, 'Not yet confirmed to the other side');
    assert.deepStrictEqual(mark.message_ids, [MSG]);
    /* the far side comes back */
    TRANSPORT_ANSWER = { accepted: true, status: 200, why: 'accepted' };
    SENT_ENV.length = 0;
    const back = await ret.drain({});
    assert.strictEqual(back.accepted, 2, JSON.stringify(back));
    assert.strictEqual(await ret.unconfirmed(ME, CHIT), null);
  });
  await t('retries spent: the row says failed in words and stops; the backoff doubles to a ceiling', async () => {
    resetWorld();
    await ret.onStatusMoved(ME, CHIT, { status: 'accepted', by_name: 'A' });
    W.out[0].attempts = ret.MAX_ATTEMPTS - 1;
    TRANSPORT_ANSWER = { accepted: false, status: 409, why: 'refused for a reason' };
    await ret.drain({});
    assert.strictEqual(W.out[0].status, 'failed');
    const mark = await ret.unconfirmed(ME, CHIT);
    assert.ok(mark.failed && mark.words === 'Could not be confirmed to the other side' && /refused for a reason/.test(mark.why));
    assert.deepStrictEqual([1, 2, 3, 10, 40].map(ret.backoff), [60, 120, 240, 900, 900]);
  });
  await t('the answers a route gives: nothing extra when nothing crossed; the queue note when it did; the mark on the messages still waiting', async () => {
    assert.deepStrictEqual(ret.answerOf({ queued: 0 }), {});
    assert.deepStrictEqual(ret.answerOf(undefined), {});
    assert.deepStrictEqual(ret.answerOf({ queued: 1, seq: 4 }), { ctp: { queued: 1, seq: 4 } });
    assert.deepStrictEqual(ret.answerOf({ queued: 0, why: 'could not be queued' }), { ctp: { queued: 0, why: 'could not be queued' } });
    assert.deepStrictEqual(ret.markOf(null), {});
    const mark = { count: 2, since: 'then', failed: false, why: null, words: ret.UNCONFIRMED_WORDS, message_ids: [MSG] };
    assert.strictEqual(ret.markOf(mark).ctp_unconfirmed.words, 'Not yet confirmed to the other side');
    const rows = [{ message_id: MSG }, { message_id: 'other' }];
    ret.markMessages(rows, mark);
    assert.strictEqual(rows[0].ctp_unconfirmed, 'Not yet confirmed to the other side');
    assert.strictEqual(rows[1].ctp_unconfirmed, undefined);
  });
  await t('a business that has become local is not sent to: failed at once, in words', async () => {
    resetWorld();
    await ret.onStatusMoved(ME, CHIT, { status: 'accepted', by_name: 'A' });
    W.place = { [STUB]: { local: true } };
    SENT_ENV.length = 0;
    await ret.drain({});
    assert.strictEqual(SENT_ENV.length, 0);
    assert.strictEqual(W.out[0].status, 'failed');
    assert.ok(/no longer on another installation/.test(W.out[0].last_error));
  });

  console.log('\n== D · moveStatus emits for a remote party and not for a local one ==\n');
  const jwt = require('jsonwebtoken');
  void jwt;
  const hooks = require(root('lib/books-hooks'));
  hooks.afterChit = () => Promise.resolve({});
  try {
    require(root('lib/whatsapp-out')).notifyChitStatus = async () => null;
  } catch (_) {
    /* optional */
  }
  const origErr = console.error;
  console.error = () => {};
  const chits = require(root('routes/chits'));
  const EDITOR = { level: 'editor' };
  const seed = () => {
    W.status.push({ chit_id: CHIT, entity_id: ME, direction: 'received', current_status: 'pending' });
  };
  await t('moveStatus on a chit with a party on another installation queues the move once, and says so in its answer', async () => {
    resetWorld();
    seed();
    const mv = await require(root('lib/chit-move')).moveStatus(ME, CHIT, 'accepted', { id: ME, name: 'Asha' }, '', EDITOR);
    assert.strictEqual(mv.code, 200, JSON.stringify(mv.body));
    assert.strictEqual(W.out.length, 1);
    assert.strictEqual(W.out[0].event.status, 'accepted');
    assert.strictEqual(W.out[0].event.previous_status, 'pending');
    assert.strictEqual(W.out[0].event.by_name, 'Asha');
    assert.deepStrictEqual(mv.body.ctp, { queued: 1, seq: 1 });
  });
  await t('…and for a chit whose parties are all here it queues nothing and the answer is exactly what it was', async () => {
    resetWorld();
    seed();
    W.headers[ME].all_recipients = [{ bridge_id: B_ME }, { bridge_id: B_LOCAL2 }];
    const mv = await require(root('lib/chit-move')).moveStatus(ME, CHIT, 'accepted', { id: ME, name: 'Asha' }, '', EDITOR);
    assert.strictEqual(mv.code, 200);
    assert.strictEqual(W.out.length, 0);
    assert.strictEqual(mv.body.ctp, undefined);
  });
  await t('…a refused step, and a move to the status it already holds, queue nothing', async () => {
    resetWorld();
    seed();
    const same = await require(root('lib/chit-move')).moveStatus(ME, CHIT, 'pending', { id: ME, name: 'Asha' }, '', EDITOR);
    assert.ok(same.noop);
    W.status[0].current_status = 'completed';
    const refused = await require(root('lib/chit-move')).moveStatus(ME, CHIT, 'cancelled', { id: ME, name: 'Asha' }, '', EDITOR);
    assert.ok(refused.code >= 400 && !refused.moved, JSON.stringify(refused));
    assert.strictEqual(W.out.length, 0);
  });
  console.error = origErr;

  console.log('\n== E · disputes now cross (tests/ctp-return-disputes.test.cjs); the retired refusal is gone ==\n');
  await t('CTP_CROSS_DISPUTE is retired in the register, not raised by any code', async () => {
    const row = require(root('docs/error-codes.json')).codes.find((c) => c.code === 'CTP_CROSS_DISPUTE');
    assert.ok(row && /RETIRED/.test(row.shopkeeper), 'kept in the register, marked retired');
    assert.ok(!/CTP_CROSS_DISPUTE/.test(require(root('tools/chits-files.cjs')).read(root('.')) + require('fs').readFileSync(root('lib/ctpreturn.js'), 'utf8')));
  });

  console.log('\n== F · the registered words ==\n');
  await t('the new refusal codes are registered (docs/ERROR-CODES.md)', async () => {
    const codes = require(root('docs/error-codes.json')).codes.map((c) => c.code);
    for (const c of ['CTP_EVENT_NO_DISPUTE', 'CTP_EVENT_BAD', 'CTP_EVENT_NO_CHIT', 'CTP_EVENT_PARTY_MISMATCH', 'CTP_EVENT_PARTY_UNKNOWN']) assert.ok(codes.indexOf(c) >= 0, c + ' is registered');
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
