'use strict';
/**
 * tests/connector-state.test.cjs - ERR-8+7 (B5) · ERR-R5 (B6): the ONE registry of outside services (lib/connector-state.js).
 *   · mail down  → the send answers delivered:false with the NAMED reason MAIL_SEND_FAILED, the registry says "down" with the register's sentence + hint; one good send clears it
 *   · WhatsApp down → the receipt is still written (status failed, our sentence, one row: nothing lost, nothing sent twice) and the registry says "down"
 *   · AI with no key → the thrown error carries the named code AI_NOT_CONNECTED and a 503; GOV_NOT_AVAILABLE is untouched (still in the register)
 *   · not set up (no key) is its own state with its own register sentence; connected carries no code
 *   · GET /health: degraded flips when a connector that is set up goes down, and back; counts only, no names; a connector not set up is not a fault
 * Run: node tests/connector-state.test.cjs · offline: no database, no network (fetch, the db door and the provider SDK are stubbed) · MIN refusal-path
 */
const assert = require('assert'), path = require('path'), Module = require('module');
const API = path.join(__dirname, '..');
let pass = 0;
const it = async (what, run) => { try { await run(); pass++; console.log('  ok  ' + what); } catch (e) { process.exitCode = 1; console.log('  FAIL ' + what + '\n      ' + e.message); } };

/* stubs, installed before any lib loads: the db door records each receipt; the mail SDK fails on demand */
const receipts = [];
const stub = (rel, exports) => { const id = require.resolve(path.join(API, rel)); require.cache[id] = { id, filename: id, loaded: true, exports }; };
stub('db/index.js', {
  query: async () => ({ rows: [] }),
  withEntity: async (_id, run) => run({ query: async (sql, vals) => { if (/INSERT INTO channel_outbound/.test(sql)) { receipts.push(vals); return { rows: [{ id: receipts.length, status: vals[6] }] }; } return { rows: [{ last_in: new Date() }] }; } })
});
stub('lib/schema.js', { hasColumn: async () => false, hasTable: async () => false });
let mailBroken = true;
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'resend') return { Resend: class { constructor() { this.emails = { send: async () => { if (mailBroken) throw new Error('fetch failed'); return {}; } }; } } };
  return load.call(this, request, ...rest);
};
for (const k of ['ANTHROPIC_API_KEY', 'RESEND_API_KEY', 'WHATSAPP_TOKEN', 'OPENAI_API_KEY', 'OTP_EMAIL_ENABLED', 'DEV_OTP']) delete process.env[k];

const state = require('../lib/connector-state');
const rows = require('../docs/error-codes.json').codes;
const row = (code) => rows.find((r) => r.code === code);

(async () => {
  await it('not set up: no key → state not_set_up with the register sentence and hint; connected has no code', async () => {
    const mail = state.stateOf('mail');
    assert.strictEqual(mail.state, 'not_set_up');
    assert.strictEqual(mail.code, 'CONNECTOR_NOT_SET_UP');
    assert.strictEqual(mail.sentence, row('CONNECTOR_NOT_SET_UP').shopkeeper);
    assert.strictEqual(mail.hint, row('CONNECTOR_NOT_SET_UP').hint);
    assert.strictEqual(state.stateOf('ai').code, 'AI_NOT_CONNECTED', 'AI has its own code for the no-key case');
    process.env.WHATSAPP_TOKEN = 't';
    const ok = state.stateOf('whatsapp');
    assert.deepStrictEqual([ok.state, ok.code, ok.sentence, ok.hint], ['connected', null, null, null]);
  });

  await it('mail down: the send names its reason, the registry says down; one good send clears it', async () => {
    process.env.OTP_EMAIL_ENABLED = 'true'; process.env.RESEND_API_KEY = 'k';
    const notify = require('../lib/notify');
    const sent = await notify.sendEmail('a@b.test', 'hello', '<p>x</p>');
    assert.deepStrictEqual([sent.delivered, sent.reason], [false, 'MAIL_SEND_FAILED']);
    const down = state.stateOf('mail');
    assert.strictEqual(down.state, 'down');
    assert.strictEqual(down.code, 'CONNECTOR_DOWN');
    assert.strictEqual(down.last_failure.reason, 'MAIL_SEND_FAILED');
    assert.ok(!JSON.stringify(down).includes('fetch failed'), 'the provider text never reaches the answer');
    mailBroken = false;
    assert.strictEqual((await notify.sendEmail('a@b.test', 'hello', '<p>x</p>')).delivered, true);
    assert.strictEqual(state.stateOf('mail').state, 'connected');
  });

  await it('WhatsApp down: the receipt row is kept (failed, our sentence, one row), the registry says down', async () => {
    const realFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'secret provider text' } }) });
    const privacy = require('../lib/privacy');
    privacy.gate = async () => ({ may: true, code: 'OK', pref: {} });
    try {
      const wa = require('../lib/whatsapp-out');
      const out = await wa.notify('e1', { to_ref: '+919800000001', from_ref: '+919800000002', provider_ref: '123', text: 'order ready' });
      assert.strictEqual(receipts.length, 1, 'exactly one receipt: nothing lost, nothing sent twice');
      assert.strictEqual(out.status, 'failed');
      assert.ok(!String(out.reason).includes('secret'), 'our sentence, never the provider text');
      assert.strictEqual(state.stateOf('whatsapp').state, 'down');
    } finally { global.fetch = realFetch; }
  });

  await it('AI with no key: a 503 carrying AI_NOT_CONNECTED; GOV_NOT_AVAILABLE stays in the register', async () => {
    const ai = require('../lib/ai');
    const skill = (await ai.listSkills())[0];
    let err = null;
    try { await ai.invokeSkill('11111111-1111-4111-8111-111111111111', skill.id, {}); } catch (e) { err = e; }
    assert.ok(err, 'it must refuse');
    assert.deepStrictEqual([err.status, err.code], [503, 'AI_NOT_CONNECTED']);
    assert.ok(row('GOV_NOT_AVAILABLE') && row('AI_NOT_CONNECTED'));
    const { thrownAs } = require('../lib/governance-contract');
    assert.strictEqual(thrownAs(err, { id: 'r1' }, 'AI draft failed', true).code, 'AI_NOT_CONNECTED');
  });

  await it('the down state does NOT lapse by age: it stays until a send works (break test 21 Nov)', () => {
    state.note.reset(); state.note.failed('mail', 'MAIL_SEND_FAILED', 1000);
    assert.strictEqual(state.stateOf('mail', 1000 + 24 * 3600 * 1000).state, 'down');
    assert.strictEqual(state.counts(1000 + 24 * 3600 * 1000).down, 1);
    state.note.worked('mail', 2000);
    assert.strictEqual(state.stateOf('mail', 3000).state, 'connected');
  });

  await it('/health: degraded flips when a set-up connector goes down and back; counts only; not set up is no fault', async () => {
    state.note.reset();
    for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) delete process.env[k];
    const router = require('../routes/health');
    const call = () => new Promise((resolve, reject) => {
      const layer = router.stack.find((l) => l.route && l.route.path === '/');
      layer.route.stack[layer.route.stack.length - 1].handle({}, { json: resolve }, reject);
    });
    const before = await call();
    assert.strictEqual(before.degraded, false, JSON.stringify(before.connectors));
    assert.ok(before.connectors.not_set_up >= 2 && before.connectors.down === 0);
    state.note.failed('mail', 'MAIL_SEND_FAILED');
    const hurt = await call();
    assert.strictEqual(hurt.degraded, true);
    assert.strictEqual(hurt.connectors.down, 1);
    assert.deepStrictEqual(Object.keys(hurt.connectors).sort(), ['connected', 'down', 'not_set_up', 'total'], 'counts only, no names');
    state.note.worked('mail', Date.now() + 1);
    assert.strictEqual((await call()).degraded, false);
  });
  await it('/health: a database that does not answer makes degraded true and status not OK, still one 200 answer (break test 21 Nov)', async () => {
    state.note.reset();
    const db = require('../db');
    const was = db.query;
    db.query = async () => { throw new Error('EAI_AGAIN'); };
    try {
      const router = require('../routes/health');
      const layer = router.stack.find((l) => l.route && l.route.path === '/');
      const body = await new Promise((resolve, reject) => layer.route.stack[layer.route.stack.length - 1].handle({}, { json: resolve }, reject));
      assert.strictEqual(body.db, 'down');
      assert.strictEqual(body.degraded, true);
      assert.notStrictEqual(body.status, 'OK');
    } finally { db.query = was; }
  });

  await it('business status unread throws BUSINESS_STATUS_UNREAD (a 503 at the door), never answers ended', async () => {
    const bs = require('../lib/business-status');
    let err = null;
    try { await bs.businessEnded('unreadable-shop', async () => { throw new Error('db down'); }); } catch (e) { err = e; }
    assert.ok(err && err.code === 'BUSINESS_STATUS_UNREAD');
    assert.strictEqual(await bs.businessEnded('ok-shop', async () => ({ rows: [{ status: 'active' }] })), false);
  });


  console.log('\n  ' + pass + ' passed');
  process.exit(process.exitCode || 0);
})();
