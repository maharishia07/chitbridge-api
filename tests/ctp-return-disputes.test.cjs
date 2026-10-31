/**
 * tests/ctp-return-disputes.test.cjs — RAIL-106 part 2: DISPUTES CROSS INSTALLATIONS, DECIDED ONCE WHERE THEY ORIGINATE (Athi, 25 Oct 2026: "the computation happens in only one place where it
 * originates, rest of the places it just displays it as a record").
 *
 *   A  ORIGIN (the real routes, the database stubbed): a raise tells the roster's installation(s) after the route decided; a chit-wide raise tells every party elsewhere; a dispute reply goes
 *      only to the roster (targeted) and to everyone elsewhere (chit-wide); a resolve by the raiser is told; a resolve the local rule refuses is refused 403 and NOTHING is queued; a dispute
 *      between parties who are all here queues nothing and costs no query
 *   B  RECEIVER (lib/ctpreturn apply, the real writers recordRaise / recordResolve / postMessageCopies): the dispute is recorded on OUR copy as the remote raiser, with the roster mapped to our
 *      own rows and the audience made of the parties we hold; a repeat is ignored; a reply is held once and only if the dispute is held; a resolve is recorded once, only by the raiser's side;
 *      no permission is decided here
 *   C  the events are shaped (a dispute event with no dispute id, reason or note is refused 400)
 *
 * Offline: database, address book, transport are stubs. Run: node tests/ctp-return-disputes.test.cjs
 */
'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-ctp-disputes';
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
    msgs: [],
    nextId: 1,
    header: { sender_entity_bridge_id: B_ME, all_recipients: [{ bridge_id: B_ME, role: 'sender' }, { bridge_id: B_STUB, role: 'to' }] },
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

const FROM = { installation_key: 'sit-au', population: 'live', bridge_id: B_STUB, display_name: 'AU Pumps' };
const raiseEv = (over) =>
  Object.assign(
    {
      kind: 'dispute_raise', seq: 1, dispute_id: DISPUTE, category: 'quantity', reason: 'Short by 40 units', scope: 'targeted', mode: 'two_sided', answerable: true, parity_state: 'present', via: 'chit',
      evidence: { via: 'chit' }, actor_name: 'Raj', raiser: { bridge_id: B_STUB, display_name: 'AU Pumps' }, target: { bridge_id: B_ME, display_name: 'IN Plant', target_name: 'IN Plant' },
      roster: [{ bridge_id: B_STUB, display_name: 'AU Pumps', role: 'raiser' }, { bridge_id: B_ME, display_name: 'IN Plant', role: 'party' }], reason_message_id: 'a0000000-0000-4000-8000-0000000000b1'
    },
    over || {}
  );
const apply = (event, over) => ret.apply(Object.assign({ chit_id: CHIT, event, from: FROM, to: { identity_id: ME } }, over || {}));

(async () => {
  console.log('\n== A · origin: decided once, then told ==\n');
  await t('a targeted raise (the real route) tells the roster’s installation: bridges, scope, reason and the same reason-message id; the answer says so', async () => {
    resetWorld();
    const r = await call('POST', '/api/chits/' + CHIT + '/disputes', tok(ME), { category: 'quantity', reason: 'Short by 40 units', target_entity_id: STUB });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.ctp && { queued: r.body.ctp.queued, seq: r.body.ctp.seq }, { queued: 1, seq: 1 });
    assert.strictEqual(W.out.length, 1);
    const ev = W.out[0].event;
    assert.strictEqual(W.out[0].kind, 'dispute_raise');
    assert.strictEqual(W.out[0].to_bridge_id, B_STUB);
    assert.strictEqual(ev.dispute_id, r.body.dispute_id);
    assert.strictEqual(ev.scope, 'targeted');
    assert.strictEqual(ev.raiser.bridge_id, B_ME);
    assert.strictEqual(ev.target.bridge_id, B_STUB);
    assert.deepStrictEqual(ev.roster.map((x) => [x.bridge_id, x.role]), [[B_ME, 'raiser'], [B_STUB, 'party']]);
    assert.ok(/^\[quantity\]/.test(sqlOf(/chit_message_deliver/)[0].p[5]), 'the local reason message was written too');
    assert.strictEqual(sqlOf(/chit_message_deliver/)[0].p[0], ev.reason_message_id, 'the same message id on both sides');
    assert.ok(W.status.some((x) => x.entity_id === STUB), 'the remote party is a participant here (its shadow row), so the roster can name it');
  });
  await t('a chit-wide raise with no named party still tells every party elsewhere; a targeted raise at a local party tells no one', async () => {
    resetWorld();
    const wide = await call('POST', '/api/chits/' + CHIT + '/disputes', tok(ME), { category: 'quantity', reason: 'None of it arrived at all', chit_wide: true });
    assert.strictEqual(wide.status, 200, JSON.stringify(wide.body));
    assert.strictEqual(W.out.length, 1);
    assert.strictEqual(W.out[0].event.scope, 'chit_wide');
    resetWorld();
    W.header = { sender_entity_bridge_id: B_ME, all_recipients: [{ bridge_id: B_ME }, { bridge_id: B_STUB }, { bridge_id: B_LOCAL2 }] };
    W.status.push({ chit_id: CHIT, entity_id: LOCAL2, direction: 'received', current_status: 'pending' });
    const local = await call('POST', '/api/chits/' + CHIT + '/disputes', tok(ME), { category: 'quantity', reason: 'Neighbour part missing here', target_entity_id: LOCAL2 });
    assert.strictEqual(local.status, 200, JSON.stringify(local.body));
    assert.strictEqual(W.out.length, 0, 'the roster holds nobody elsewhere');
    assert.strictEqual(local.body.ctp, undefined);
  });
  await t('a dispute reply goes to the roster only (targeted) and to every party elsewhere (chit-wide)', async () => {
    resetWorld();
    const base = { dispute_id: DISPUTE, message_id: MSG, message_text: 'see the delivery note', sender_display_name: 'IN Plant' };
    assert.strictEqual((await ret.onDisputeMessage(ME, CHIT, Object.assign({ to_ids: [ME, STUB] }, base))).queued, 1);
    assert.strictEqual(W.out[0].kind, 'dispute_message');
    assert.strictEqual(W.out[0].event.message_id, MSG);
    assert.strictEqual((await ret.onDisputeMessage(ME, CHIT, Object.assign({ to_ids: [ME, LOCAL2] }, base))).queued, 0, 'a party elsewhere who is not on the roster is not told');
    assert.strictEqual((await ret.onDisputeMessage(ME, CHIT, Object.assign({ to_ids: null }, base))).queued, 1, 'chit-wide: everyone elsewhere');
    assert.strictEqual(W.out.length, 2);
  });
  await t('one envelope per installation: two parties on sit-au get one dispute event', async () => {
    resetWorld();
    const STUB2 = '44444444-4444-4444-8444-444444444444';
    W.ident.CBAU00002D = { identity_id: STUB2, bridge_id: 'CBAU00002D', display_name: 'AU Two' };
    W.place[STUB2] = W.place[STUB];
    W.header.all_recipients.push({ bridge_id: 'CBAU00002D' });
    const r = await ret.onDisputeMessage(ME, CHIT, { dispute_id: DISPUTE, message_id: MSG, message_text: 'x', to_ids: null });
    assert.strictEqual(r.queued, 1);
    assert.strictEqual(W.out[0].to_bridge_id, B_STUB, 'the first by bridge id, every time');
  });
  await t('a resolve by the raiser (the real route) is recorded here and told; the answer says so', async () => {
    resetWorld();
    W.disputeRow = { dispute_id: DISPUTE, chit_id: CHIT, status: 'open', raised_by_entity_id: ME, category: 'quantity', scope: 'targeted' };
    W.roster = [{ entity_id: ME, role: 'raiser', status: 'open' }, { entity_id: STUB, role: 'party', status: 'open' }];
    const r = await call('PUT', '/api/chits/' + CHIT + '/disputes/' + DISPUTE + '/resolve', tok(ME), { resolution_note: 'Credit note issued' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(sqlOf(/SELECT chit_dispute_resolve/).length, 1, 'recorded locally by the one writer');
    assert.strictEqual(W.out.length, 1);
    assert.strictEqual(W.out[0].kind, 'dispute_resolve');
    assert.strictEqual(W.out[0].to_bridge_id, B_STUB);
    assert.strictEqual(W.out[0].event.resolution_note, 'Credit note issued');
    assert.strictEqual(W.out[0].event.target, null);
    assert.strictEqual(r.body.ctp.queued, 1);
  });
  await t('a resolve the local rule refuses (not the raiser) is refused 403 at the origin: nothing written, nothing queued', async () => {
    resetWorld();
    W.disputeRow = { dispute_id: DISPUTE, chit_id: CHIT, status: 'open', raised_by_entity_id: STUB, category: 'quantity', scope: 'targeted' };
    const r = await call('PUT', '/api/chits/' + CHIT + '/disputes/' + DISPUTE + '/resolve', tok(ME), { resolution_note: 'I say it is settled' });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
    assert.strictEqual(sqlOf(/SELECT chit_dispute_resolve/).length, 0);
    assert.strictEqual(W.out.length, 0);
  });
  await t('a dispute reply by the party (the real route) goes to the raiser’s installation', async () => {
    resetWorld();
    W.scope = 'targeted';
    W.roster = [{ entity_id: ME, role: 'party', status: 'open' }, { entity_id: STUB, role: 'raiser', status: 'open' }];
    W.disputeRow = { dispute_id: DISPUTE };
    const r = await call('POST', '/api/chits/' + CHIT + '/messages', tok(ME), { message_text: 'We shipped 200, see the note', thread_type: 'external', is_dispute: true, dispute_id: DISPUTE });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(W.out.length, 1);
    assert.strictEqual(W.out[0].kind, 'dispute_message');
    assert.strictEqual(W.out[0].event.dispute_id, DISPUTE);
    assert.strictEqual(r.body.ctp.queued, 1);
  });
  await t('all parties here: a dispute is exactly as it was — nothing queued, no extra answer key, not one extra statement', async () => {
    resetWorld();
    W.place = {};
    const before = W.rec.length;
    assert.deepStrictEqual(await ret.onDisputeMessage(ME, CHIT, { dispute_id: DISPUTE, message_id: MSG, message_text: 'x', to_ids: [ME] }), { queued: 0 });
    assert.deepStrictEqual(await ret.onDisputeRaised(ME, CHIT, { dispute_id: DISPUTE, scope: 'chit_wide', roster: [], partyIds: [] }), { queued: 0 });
    assert.deepStrictEqual(await ret.onDisputeResolved(ME, CHIT, { dispute_id: DISPUTE, scope: 'chit_wide' }), { queued: 0 });
    await ret.ensureShadows(ME, CHIT);
    assert.strictEqual(W.rec.length, before, 'nothing was even asked');
  });

  console.log('\n== B · receiver: recorded through the same writers, never re-decided ==\n');
  await t('a raise from the other installation is recorded on our copy as the remote raiser; the roster is mapped to our rows; the audience is the parties we hold', async () => {
    resetWorld();
    const r = await apply(raiseEv());
    assert.ok(r.ok && r.applied, JSON.stringify(r));
    const deliver = sqlOf(/SELECT chit_dispute_deliver/)[0];
    assert.ok(deliver, 'chit_dispute_deliver ran');
    assert.strictEqual(deliver.ent, STUB, 'as the remote raiser (the definer wants the raiser as the caller)');
    assert.strictEqual(deliver.p[0], DISPUTE);
    assert.strictEqual(deliver.p[2], STUB, 'raised_by is the stub of the other installation’s business');
    assert.strictEqual(deliver.p[4], ME, 'the target is OUR business, found by bridge id');
    assert.strictEqual(deliver.p[6], 'targeted');
    assert.deepStrictEqual(JSON.parse(deliver.p[14]).map((x) => [x.entity_id, x.role]), [[STUB, 'raiser'], [ME, 'party']]);
    assert.deepStrictEqual(deliver.p[15], [STUB, ME]);
    assert.ok(W.status.some((x) => x.entity_id === STUB), 'the raiser is a participant here (its shadow row)');
    assert.strictEqual(sqlOf(/SELECT chit_message_deliver/)[0].p[0], 'a0000000-0000-4000-8000-0000000000b1', 'the reason message keeps the id it was sent with');
    assert.ok(sqlOf(/chit_log_targets/).some((x) => x.p[1][0] === ME && x.p[2] === 'dispute_raised'), 'our party gets its notice');
  });
  await t('a raise we already hold is ignored; a raise from a sender who is not its raiser is refused 409', async () => {
    resetWorld();
    W.disputes = [DISPUTE];
    const again = await apply(raiseEv());
    assert.ok(again.ok && again.applied === false, JSON.stringify(again));
    assert.strictEqual(sqlOf(/SELECT chit_dispute_deliver/).length, 0);
    W.disputes = [];
    const forged = await apply(raiseEv({ raiser: { bridge_id: B_LOCAL2, display_name: 'x' } }));
    assert.ok(!forged.ok && forged.status === 409 && forged.code === 'CTP_EVENT_PARTY_MISMATCH', JSON.stringify(forged));
  });
  await t('a chit-wide raise gives us the raiser’s copy only; a party we hold no row for is not on a copy here', async () => {
    resetWorld();
    const r = await apply(raiseEv({ scope: 'chit_wide', target: null, roster: [{ bridge_id: B_STUB, display_name: 'AU Pumps', role: 'raiser' }, { bridge_id: 'CBNOROW000', display_name: 'Third', role: 'party' }] }));
    assert.ok(r.applied);
    const deliver = sqlOf(/SELECT chit_dispute_deliver/)[0];
    assert.deepStrictEqual(deliver.p[15], [STUB]);
    assert.strictEqual(deliver.p[4], null);
    assert.strictEqual(JSON.parse(deliver.p[14])[1].entity_id, null);
  });
  await t('a reply is held only if its dispute is, once, under the id it was sent with, as the remote sender, to the dispute’s roster here', async () => {
    resetWorld();
    const ev = { kind: 'dispute_message', seq: 2, dispute_id: DISPUTE, message_id: MSG, message_text: 'We shipped 200', msg_type: 'info', sender_display_name: 'AU Pumps' };
    const none = await apply(ev);
    assert.ok(!none.ok && none.status === 404 && none.code === 'CTP_EVENT_NO_DISPUTE', JSON.stringify(none));
    W.disputes = [DISPUTE];
    const first = await apply(ev);
    assert.ok(first.ok && first.applied, JSON.stringify(first));
    const deliver = sqlOf(/SELECT chit_message_deliver/)[0];
    assert.strictEqual(deliver.ent, STUB);
    assert.strictEqual(deliver.p[0], MSG);
    assert.strictEqual(deliver.p[7], true, 'a dispute-tagged message');
    assert.strictEqual(deliver.p[8], DISPUTE);
    W.msgs.push({ message_id: MSG, entity_id: ME });
    const again = await apply(ev);
    assert.ok(again.ok && again.applied === false);
    assert.strictEqual(sqlOf(/SELECT chit_message_deliver/).length, 1);
    assert.strictEqual(W.out.length, 0, 'what arrives is not sent on');
  });
  await t('a resolve by the raiser’s side is recorded through the one writer as the remote raiser; a repeat is ignored; a non-raiser copy refuses', async () => {
    resetWorld();
    W.disputes = [DISPUTE];
    W.roster = [{ entity_id: STUB, role: 'raiser', status: 'open' }, { entity_id: ME, role: 'party', status: 'open' }];
    const ev = { kind: 'dispute_resolve', seq: 3, dispute_id: DISPUTE, target: null, resolution_note: 'Credit note issued', category: 'quantity', actor_name: 'Raj', resolver_name: 'AU Pumps', resolve_message_id: 'a0000000-0000-4000-8000-0000000000c9' };
    const first = await apply(ev);
    assert.ok(first.ok && first.applied, JSON.stringify(first));
    const resolve = sqlOf(/SELECT chit_dispute_resolve/)[0];
    assert.strictEqual(resolve.ent, STUB);
    assert.deepStrictEqual([resolve.p[0], resolve.p[1], resolve.p[2], resolve.p[3]], [DISPUTE, STUB, null, 'Credit note issued']);
    assert.strictEqual(sqlOf(/SELECT chit_message_deliver/)[0].p[0], 'a0000000-0000-4000-8000-0000000000c9');
    assert.ok(sqlOf(/chit_log_targets/).some((x) => x.p[2] === 'dispute_resolved' && x.p[1][0] === ME));
    W.roster = [{ entity_id: STUB, role: 'raiser', status: 'resolved' }, { entity_id: ME, role: 'party', status: 'resolved' }];
    const again = await apply(ev);
    assert.ok(again.ok && again.applied === false);
    assert.strictEqual(sqlOf(/SELECT chit_dispute_resolve/).length, 1);
    W.disputeRole = 'party';
    const refused = await apply(ev);
    assert.ok(!refused.ok && refused.status === 409, JSON.stringify(refused));
  });
  await t('a resolve for one party names that party; one we hold no row for is ignored', async () => {
    resetWorld();
    W.disputes = [DISPUTE];
    W.roster = [{ entity_id: STUB, role: 'raiser', status: 'open' }, { entity_id: ME, role: 'party', status: 'open' }];
    const named = await apply({ kind: 'dispute_resolve', seq: 3, dispute_id: DISPUTE, target: { bridge_id: B_ME }, resolution_note: 'ok', category: 'quantity' });
    assert.ok(named.applied);
    assert.strictEqual(sqlOf(/SELECT chit_dispute_resolve/)[0].p[2], ME);
    const nobody = await apply({ kind: 'dispute_resolve', seq: 4, dispute_id: DISPUTE, target: { bridge_id: 'CBNOROW000' }, resolution_note: 'ok' });
    assert.ok(nobody.ok && nobody.applied === false);
  });

  console.log('\n== C · the events are shaped ==\n');
  await t('a dispute event with no dispute id, reason or note is refused 400', async () => {
    resetWorld();
    for (const bad of [raiseEv({ dispute_id: 'x' }), raiseEv({ reason: '  ' }), raiseEv({ roster: null }), { kind: 'dispute_resolve', dispute_id: DISPUTE, resolution_note: ' ' }, { kind: 'dispute_message', dispute_id: DISPUTE, message_id: 'x', message_text: 'hi' }]) {
      const r = await apply(bad);
      assert.ok(!r.ok && r.status === 400 && r.code === 'CTP_EVENT_BAD', JSON.stringify(bad).slice(0, 80) + ' -> ' + JSON.stringify(r));
    }
  });
  await t('the retired refusal is gone from both dispute doors', async () => {
    const src = require(root('tools/chits-files.cjs')).read(root('.')); /* the ONE list of chits files: the code may live in a lifted lib */
    assert.ok(!/answeredCrossDispute|crossDisputeRefusal/.test(src + require('fs').readFileSync(root('lib/ctpreturn.js'), 'utf8')));
  });

  console.error = origErr;
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
