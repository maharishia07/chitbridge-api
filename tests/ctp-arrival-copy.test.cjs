/**
 * tests/ctp-arrival-copy.test.cjs — R3-03: THE RECEIVING DOOR SETS THE PER-COPY FACTS ITSELF (Fable rail review 3, 14 Nov 2026).
 *
 * A copy is co-held, never shared: each party keeps its own status, direction and books marks. The door used to hand mint.deliver the peer's `current_status`, `direction`, `role` and
 * every key of its business_json, so a peer could send an invoice born `accepted`, a copy that says `paid`, or the recipient's own bill number. Pinned here, through the REAL router
 * (db, key directory, envelope opener and deliverer stubbed; no DB, no network) and the unit under it:
 *   A  a hostile copy: the copy mint.deliver is given says received · the recipient's own role · the arrival status · a fixed first log row · and none of the owned business_json keys
 *   B  the shared record is untouched: lines, money, invoice, the parties, and the ctp_arrival stamp
 *   C  the good case: an honest copy (To, CC, For) is born exactly as a local send is born (rail-actions arrivalStatus + HEADER_ROLE)
 * CARD      05-ctp-and-cross-installation/ctp-return-path
 */
'use strict';
const assert = require('assert');
const path = require('path');
const G = require('./support/route-golden.cjs');
const API = G.API;

const TO = '11111111-1111-4111-8111-111111111111';
function rows(s, p, ctx) {
  if (/SELECT identity_id FROM identities WHERE bridge_id = \$1/.test(s)) return [];
  if (/FROM installation WHERE installation_key = \$1/.test(s)) return [ctx.peer];
  if (/f_installation_of/.test(s) && /FROM identities WHERE bridge_id/.test(s)) return [];
  if (/^INSERT INTO identities/.test(s)) return [{ identity_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', display_name: 'MX Pumps' }];
  if (/f_place_entity/.test(s)) return [];
  if (/FROM identities WHERE bridge_id = \$1/.test(s)) return [ctx.to];
  if (/^SELECT bridge_id FROM identities WHERE identity_id = \$1/.test(s)) return [{ bridge_id: 'CBRECV0001' }];
  if (/FROM identities WHERE identity_id = \$1/.test(s)) return [];
  if (/f_installation_of/.test(s)) return [{ installation_key: null }];
  if (/f_ctp_may_deliver/.test(s)) return [{ ok: true }];
  return [];
}
const h = G.harness({ rows, known: { [TO]: 'TO' } });
const directory = require(path.join(API, 'lib', 'ctpdirectory'));
directory.publicKeyFor = async (domain, ik) => ({ ok: true, public_key: 'PK-' + ik });
const envelope = require(path.join(API, 'lib', 'ctpenvelope'));
envelope.open = () => ({ ok: true, chit_id: 'chit-1', copy: h.state.ctx.copy, header: {} });
envelope.digest = () => 'H-1';
require(path.join(API, 'lib', 'ctpkeys')).verifyWith = () => true;
const mint = require(path.join(API, 'lib', 'mint'));
mint.deliver = async (sender, chit_id, copies) => {
  h.note('mint.deliver', { copy: copies[0] });
  return { ok: true };
};
require(path.join(API, 'lib', 'govresolve')).resolveInstallationGovernance = async () => null;
const app = h.app('/api/ctp', require(path.join(API, 'routes', 'ctp')));
const arrival = require(path.join(API, 'lib', 'ctp-arrival'));
const railActions = require(path.join(API, 'lib', 'rail-actions'));

const PEER = { installation_key: 'mx-1', domain: 'mx.example.com', hosted_locally: false, active: true };
const ENV = { ctp: '1', from: { installation_key: 'mx-1', bridge_id: 'CBSEND0001' }, to: { bridge_id: 'CBRECV0001' }, sealed: { hash: 'H-1', sig: 'S-1' } };
const LINES = [{ particulars: 'Pump seal', quantity: 10, price: 100 }];
const INVOICE = { ValDtls: { TotInvVal: 1180 } };
/** what the sender's copy says: the shared record, plus whatever per-copy facts the sender dresses it in */
const sentCopy = (over, role) =>
  Object.assign(
    {
      entity_id: 'THEIRS',
      sender_entity_id: '22222222-2222-4222-8222-222222222222',
      sender_entity_bridge_id: 'CBSEND0001',
      sender_entity_display_name: 'MX Pumps',
      purpose: 'invoice',
      all_recipients: [{ bridge_id: 'CBSEND0001', role: 'sender' }, { bridge_id: 'CBRECV0001', role }],
      line_items: LINES,
      business_json: { invoice: INVOICE, deal: 'x' }
    },
    over || {}
  );
async function arrives(copy) {
  const r = await h.run(app, { url: '/api/ctp/deliver', body: ENV, identity: {}, ctx: { peer: PEER, to: { identity_id: TO, population: 'live' }, copy } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  return r.calls.find((c) => c.via === 'mint.deliver').payload.copy;
}
let pass = 0;
let fail = 0;
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

(async () => {
  console.log('\n== A · a hostile copy: the door says what it is to its holder ==\n');
  await t('an invoice sent as accepted, sent-direction, paid, with the recipient’s own bill number: born received, pending, Act, with none of the owned keys', async () => {
    const hostile = sentCopy(
      {
        current_status: 'accepted',
        direction: 'sent',
        role: 'For',
        priority_flag: 'urgent',
        log: { action: 'accepted', new_status: 'accepted', detail: 'bought already' },
        business_json: { invoice: INVOICE, client_ref: 'THEIR-BILL-7', payment: { method: 'bank', at: '2026-11-01' }, use: { kind: 'stock' }, books: { posted: true }, books_log: [1], books_skip: { by: 'x' }, books_request: { at: 'y' }, party: { note: 'z' } }
      },
      'receiver'
    );
    const got = await arrives(hostile);
    assert.deepStrictEqual([got.direction, got.role, got.current_status, got.priority_flag], ['received', 'Act', 'pending', 'normal']);
    assert.deepStrictEqual([got.log.action, got.log.new_status, got.log.detail], ['delivered', 'pending', 'Chit received from MX Pumps (TO)']);
    for (const key of arrival.OWNED_KEYS) assert.ok(!(key in got.business_json), key + ' is the holder’s own and was dropped');
  });
  await t('every owned key is covered by the test above (a new owned key is added to the list and to this check)', () => {
    assert.deepStrictEqual([...arrival.OWNED_KEYS].sort(), ['books', 'books_log', 'books_request', 'books_skip', 'client_ref', 'party', 'payment', 'use']);
  });

  console.log('\n== B · the shared record is untouched ==\n');
  await t('lines, money, invoice and parties arrive as sent; the arrival stamp is added; the sender’s own object is not mutated', async () => {
    const sent = sentCopy({ business_json: { invoice: INVOICE, deal: 'x', client_ref: 'R' } }, 'receiver');
    const before = JSON.stringify(sent);
    const got = await arrives(sent);
    assert.deepStrictEqual(got.line_items, LINES);
    assert.deepStrictEqual(got.business_json.invoice, INVOICE);
    assert.strictEqual(got.business_json.deal, 'x');
    assert.strictEqual(got.business_json.ctp_arrival.from_installation, 'mx-1');
    assert.strictEqual(got.entity_id, TO, 'written as OUR recipient, never the entity the envelope carried');
    assert.strictEqual(got.all_recipients.find((x) => x.role === 'receiver').entity_id, TO, 'the recipient is localised');
    assert.strictEqual(JSON.stringify(sent), before, 'the opened copy is not changed');
  });

  console.log('\n== C · the good case: born exactly as a local send is born ==\n');
  for (const [word, kind] of [['receiver', 'to'], ['cc', 'cc'], ['for', 'for']]) {
    await t('an honest copy to a ' + kind.toUpperCase() + ' party: status ' + railActions.arrivalStatus(kind) + ', role ' + railActions.HEADER_ROLE[kind], async () => {
      const got = await arrives(sentCopy({ current_status: 'pending', direction: 'received' }, word));
      assert.deepStrictEqual([got.direction, got.role, got.current_status], ['received', railActions.HEADER_ROLE[kind], railActions.arrivalStatus(kind)]);
    });
  }
  await t('a recipient the header does not name is only told (never asked to act)', async () => {
    const got = await arrives(sentCopy({ all_recipients: [{ bridge_id: 'CBSEND0001', role: 'sender' }], current_status: 'accepted' }, 'receiver'));
    assert.deepStrictEqual([got.current_status, got.role], ['delivered', 'Info']);
  });

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
