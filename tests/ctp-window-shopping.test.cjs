/**
 * tests/ctp-window-shopping.test.cjs — RAIL-107: A CHIT FROM A BUSINESS THIS INSTALLATION HOLDS NO ROW FOR (the buyer added the seller by address; the seller never added the buyer).
 * The copy names its sender by an id from the SENDER's database. The door now finds the sender by BRIDGE ID, makes the stub when there is none (lib/remote-party stubFor: placed on the sending
 * installation, in the recipient's world, no relationship), writes the copy with the LOCAL stub as sender and every party it names, and the reply has an address.
 *
 *   A  the door: a window-shopping delivery makes the stub linked to the sending installation; the copy handed to the writer names the stub and our recipient, never the foreign uuid
 *      (a third party this installation does not know keeps its bridge id and no id); a repeat reuses the stub; a different business holding the bridge id is refused in words
 *   B  the reply: with the parties as the door left them, a status move queues an event to the sending installation
 *   C  the repair (tools/ctp-repair-senders.cjs): dry run changes nothing; --apply repoints an old row; run again, nothing is left; a clash is refused and left alone
 *
 * Offline: the database, the key directory and the writer are stubs. Run: node tests/ctp-window-shopping.test.cjs
 */
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const G = require('./support/route-golden.cjs');
const API = G.API;

const pair = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { priv: privateKey, pem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
};
const signerOf = (kp) => ({ alg: 'ed25519', sign: (hash) => crypto.sign(null, Buffer.from(hash, 'utf8'), kp.priv).toString('base64') });
const SENDER = pair();
const TO = '11111111-1111-4111-8111-111111111111';
const STUBID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const FOREIGN = '3e9651b8-08c8-4496-8784-d32b80febb70'; /* the sender's own uuid, from the SENDER's database */
const CHIT = 'c0000000-0000-4000-8000-0000000000c1';
const B_FROM = 'CBTM75MZQX',
  B_TO = 'CBMZ5MN34G',
  B_THIRD = 'CBTHIRD000';

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

function rows(s, p, ctx) {
  if (/to_jsonb\(i\) ->> 'network_role'/.test(s)) return [{ network_role: 'standalone' }];
  if (/FROM installation WHERE installation_key = \$1/.test(s)) return ctx.peer ? [ctx.peer] : [];
  if (/f_installation_of/.test(s) && /FROM identities WHERE bridge_id/.test(s)) return ctx.sender ? [ctx.sender] : [];
  if (/^INSERT INTO identities/.test(s)) return [{ identity_id: STUBID, display_name: 'Chennai Stores' }];
  if (/f_place_entity/.test(s)) return [];
  if (/FROM identities WHERE bridge_id = ANY/.test(s)) return ctx.known || [];
  if (/^SELECT bridge_id FROM identities WHERE identity_id = \$1/.test(s)) return [{ bridge_id: B_TO }];
  if (/FROM identities WHERE bridge_id = \$1/.test(s)) return ctx.to ? [ctx.to] : [];
  if (/f_ctp_may_deliver/.test(s)) return [{ ok: true }];
  if (/information_schema\.tables/.test(s)) return [{}];
  /* B: the reply */
  if (/FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2 LIMIT 1/.test(s)) return ctx.header ? [ctx.header] : [];
  if (/FROM installation\s+WHERE hosted_locally = false/.test(s) || /FROM installation WHERE hosted_locally = false/.test(s)) return [{ installation_key: 'mx-1', ctp_endpoint: 'https://mx.example/api/ctp/deliver', region: null, active: true }];
  /* sit/run6 (RAIL-142, main): the topology reads EVERY installation row (hosted_locally, domain, label too) and keeps the remote ones */
  if (/^SELECT installation_key, ctp_endpoint, region, active, hosted_locally, domain, label FROM installation$/.test(s.trim())) return [{ installation_key: 'mx-1', ctp_endpoint: 'https://mx.example/api/ctp/deliver', region: null, active: true, hosted_locally: false, domain: 'mx.example.com', label: null }];
  if (/ops\.f_installation_of/.test(s)) return [{ installation_key: 'mx-1' }];
  if (/coalesce\(max\(seq\), 0\) \+ 1/.test(s)) return [{ seq: 1 }];
  return [];
}
const h = G.harness({ rows, known: { [TO]: 'TO', [STUBID]: 'STUB', [FOREIGN]: 'FOREIGN' } });
const directory = require(path.join(API, 'lib', 'ctpdirectory'));
const mint = require(path.join(API, 'lib', 'mint'));
mint.deliver = async (sender, chit_id, copies) => {
  h.note('mint.deliver', { sender, copy: copies[0] });
  return { ok: true };
};
require(path.join(API, 'lib', 'govresolve')).resolveInstallationGovernance = async () => null;
const keys = require(path.join(API, 'lib', 'ctpkeys'));
const envelope = require(path.join(API, 'lib', 'ctpenvelope'));
const app = h.app('/api/ctp', require(path.join(API, 'routes', 'ctp')));
process.env.INSTALLATION_KEY = 'sit-au';
keys._reset();
const PEER = { installation_key: 'mx-1', domain: 'mx.example.com', hosted_locally: false, active: true };
directory.publicKeyFor = async () => ({ ok: true, public_key: SENDER.pem, manifest: { ctp: '1', installation_key: 'mx-1', public_key: SENDER.pem } });
const FROM = { installation_key: 'mx-1', population: 'live', bridge_id: B_FROM, display_name: 'Chennai Stores' };
const delivery = () =>
  envelope.sign(
    envelope.build(FROM, { bridge_id: B_TO }, {
      chit_id: CHIT,
      copy: {
        sender_entity_id: FOREIGN,
        sender_entity_bridge_id: B_FROM,
        created_by_actor_id: 'a1111111-1111-4111-8111-111111111111',
        all_recipients: [
          { entity_id: FOREIGN, bridge_id: B_FROM, role: 'sender' },
          { entity_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', bridge_id: B_TO, role: 'receiver' },
          { entity_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', bridge_id: B_THIRD, role: 'cc' }
        ],
        business_json: {}
      }
    }),
    signerOf(SENDER)
  );
const LIVE_TO = { identity_id: TO, population: 'live' };
const sql = (r, re) => r.calls.filter((c) => re.test(c.sql || ''));
const note = (r, kind) => (r.calls.find((c) => c.via === kind) || {}).payload;

(async () => {
  console.log('\n== A · the door ==\n');
  await t('a window-shopping delivery makes the stub linked to the sending installation, in the recipient’s world, and writes the copy with the LOCAL stub as sender', async () => {
    const r = await h.run(app, { url: '/api/ctp/deliver', body: delivery(), identity: {}, ctx: { peer: PEER, to: LIVE_TO } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const made = sql(r, /^INSERT INTO identities/);
    assert.strictEqual(made.length, 1);
    assert.deepStrictEqual([made[0].params[0], made[0].params[1], made[0].params[2]], [B_FROM, 'Chennai Stores', 'TO'], 'bridge id + name from the signed envelope, the recipient’s world');
    const placed = sql(r, /f_place_entity/);
    assert.deepStrictEqual(placed[0].params, ['STUB', 'mx-1'], 'placed on the sending installation');
    assert.ok(!sql(r, /customer_list|party_item|relationship/i).length, 'no customer, no supplier: no relationship written');
    const out = note(r, 'mint.deliver');
    assert.strictEqual(out.sender, 'STUB');
    assert.strictEqual(out.copy.sender_entity_id, 'STUB');
    assert.strictEqual(out.copy.created_by_actor_id, null, 'the sending person’s id is theirs, not ours');
    assert.ok(!JSON.stringify(out).includes('FOREIGN'), 'the foreign uuid is stored nowhere');
    assert.deepStrictEqual(out.copy.all_recipients.map((x) => [x.bridge_id, x.entity_id]), [[B_FROM, 'STUB'], [B_TO, 'TO'], [B_THIRD, null]], 'every party: ours by bridge id, a stranger keeps its bridge id and no id');
  });
  await t('a repeat delivery reuses the stub (nothing made twice) and a known third party is mapped to its own row', async () => {
    const known = [{ identity_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', bridge_id: B_THIRD }];
    const r = await h.run(app, { url: '/api/ctp/deliver', body: delivery(), identity: {}, ctx: { peer: PEER, to: LIVE_TO, sender: { identity_id: STUBID, display_name: 'Chennai Stores', installation_key: 'mx-1' }, known } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(sql(r, /^INSERT INTO identities/).length, 0);
    assert.strictEqual(sql(r, /f_place_entity/).length, 0);
    const out = note(r, 'mint.deliver');
    assert.strictEqual(out.sender, 'STUB');
    assert.ok(out.copy.all_recipients.find((x) => x.bridge_id === B_THIRD).entity_id !== null, 'the third party we do hold is mapped to our row');
  });
  await t('a different business here holding the same bridge id is refused 409 in words, never linked to, nothing written', async () => {
    for (const holder of [{ identity_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', display_name: 'A local shop', installation_key: 'other-9' }, { identity_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', display_name: 'A local shop', installation_key: null }]) {
      const r = await h.run(app, { url: '/api/ctp/deliver', body: delivery(), identity: {}, ctx: { peer: PEER, to: LIVE_TO, sender: holder } });
      assert.strictEqual(r.status, 409, JSON.stringify(r.body));
      assert.strictEqual(r.body.code, 'CTP_ADDRESS_CLASH');
      assert.ok(/already uses the id CBTM75MZQX/.test(r.body.why), r.body.why);
      assert.ok(!r.calls.some((c) => c.via === 'mint.deliver') && !sql(r, /^INSERT INTO identities/).length);
    }
  });

  console.log('\n== B · the reply has an address ==\n');
  await t('after the delivery the seller’s status move queues an event to the sending installation (the sender is a party it can find by bridge id)', async () => {
    const ctpreturn = require(path.join(API, 'lib', 'ctpreturn'));
    const address = require(path.join(API, 'lib', 'ctpaddress'));
    address.invalidate();
    const sc = require(path.join(API, 'lib', 'schema'));
    sc.hasTable = async () => true;
    h.state.ctx = {
      header: { sender_entity_bridge_id: B_FROM, all_recipients: [{ entity_id: STUBID, bridge_id: B_FROM, role: 'sender' }, { entity_id: TO, bridge_id: B_TO, role: 'receiver' }] },
      known: [{ identity_id: STUBID, bridge_id: B_FROM, display_name: 'Chennai Stores' }, { identity_id: TO, bridge_id: B_TO, display_name: 'Sydney Spice' }]
    };
    h.state.calls = [];
    const queued = await ctpreturn.onStatusMoved(TO, CHIT, { status: 'accepted', previous_status: 'pending', by_name: 'Sydney' });
    const inserts = h.state.calls.filter((c) => /^INSERT INTO ctp_event_out/.test(c.sql || ''));
    h.state.calls = null;
    assert.strictEqual(queued.queued, 1, JSON.stringify(queued));
    assert.strictEqual(inserts.length, 1);
    assert.strictEqual(inserts[0].params[6], B_FROM, 'addressed to the sender by bridge id');
    assert.strictEqual(inserts[0].params[7], 'mx-1');
  });

  console.log('\n== C · the repair ==\n');
  await t('dry run changes nothing; --apply repoints an old row to the stub; run again and nothing is left; a clash is refused and left alone', async () => {
    const { repairSenders } = require(path.join(API, 'lib', 'ctp-repair'));
    const party = require(path.join(API, 'lib', 'remote-party'));
    const old = {
      chit_id: CHIT,
      sender_entity_id: FOREIGN,
      sender_entity_bridge_id: B_FROM,
      sender_entity_display_name: 'Chennai Stores',
      all_recipients: [{ entity_id: FOREIGN, bridge_id: B_FROM, role: 'sender' }, { entity_id: TO, bridge_id: B_TO, role: 'receiver' }],
      arrival: { via_ctp: true, from_installation: 'mx-1', from_domain: 'mx.example.com', sender_bridge_id: B_FROM }
    };
    let pending = [old];
    const updates = [];
    const db = {
      query: async () => ({ rows: [{ identity_id: TO, bridge_id: B_TO }] }),
      withEntity: async (id, fn) =>
        fn({
          query: async (text, params) => {
            if (/^UPDATE chit_header/.test(text.trim())) {
              updates.push(params);
              pending = [];
              return { rows: [] };
            }
            return { rows: pending };
          }
        })
    };
    let clash = false;
    const fakeParty = {
      stubFor: async () => (clash ? { ok: false, status: 409, code: 'CTP_ADDRESS_CLASH', why: 'A different business here already uses the id ' + B_FROM } : { ok: true, identity_id: STUBID, created: true }),
      holdersOf: async () => ({}),
      localizeParties: party.localizeParties
    };
    const dry = await repairSenders({ db, party: fakeParty }, {});
    assert.deepStrictEqual([dry.apply, dry.found, dry.repaired, updates.length], [false, 1, 0, 0]);
    assert.strictEqual(dry.rows[0].result, 'would repair');
    clash = true;
    const refused = await repairSenders({ db, party: fakeParty }, { apply: true });
    assert.deepStrictEqual([refused.found, refused.repaired, refused.refused, updates.length], [1, 0, 1, 0]);
    assert.ok(/already uses the id/.test(refused.rows[0].result));
    clash = false;
    const done = await repairSenders({ db, party: fakeParty }, { apply: true });
    assert.deepStrictEqual([done.found, done.repaired], [1, 1]);
    assert.strictEqual(updates.length, 1);
    assert.strictEqual(updates[0][2], STUBID);
    assert.deepStrictEqual(JSON.parse(updates[0][3]).map((x) => [x.bridge_id, x.entity_id]), [[B_FROM, STUBID], [B_TO, TO]]);
    const again = await repairSenders({ db, party: fakeParty }, { apply: true });
    assert.deepStrictEqual([again.found, again.repaired, updates.length], [0, 0, 1], 'idempotent');
    pending = [Object.assign({}, old, { arrival: {} })];
    const unknown = await repairSenders({ db, party: fakeParty }, { apply: true });
    assert.ok(unknown.refused === 1 && /does not say which installation/.test(unknown.rows[0].result), 'a copy that does not name its installation is skipped in words');
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
