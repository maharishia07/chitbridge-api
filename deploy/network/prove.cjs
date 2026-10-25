#!/usr/bin/env node
/**
 * deploy/network/prove.cjs — drive the PRODUCT API of the SIT installations over HTTPS, the way a shopkeeper's screen does (no SQL): sign up a shop, add a supplier by
 * address (id@domain), send a chit, read your own data. Used for the Run 3 proof (docs/28-platform-and-operations/SIT-RUN-2026-10-25.md).
 *
 *   TESTER_CODE_<ALIAS>=<today's code on that installation>  node prove.cjs signup <alias> <host> <user_id> "<Shop name>"
 *   node prove.cjs add  <aliasA> <aliasB>            A adds B as a supplier by B's address (bridge_id@domain-of-B)
 *   node prove.cjs send <aliasA> <aliasB> [subject]  A sends B a chit through POST /api/chits/send
 *   node prove.cjs me   <alias>                      the owner reads their own record (proves they keep access)
 *   node prove.cjs list <alias>                      the chits this shop holds (id, status, subject)
 *
 * State (tokens, ids) lives in $PROVE_STATE (default ./prove-state.json), never printed. The tester code is a secret of each VM's .env: pass it in the environment, not on a command line.
 * OWNS: nothing. CALLED BY: the operator running a SIT proof. CARD 28-platform-and-operations/network-control-panel
 */
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const STATE = process.env.PROVE_STATE || 'prove-state.json';
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

async function call(alias, method, path, body, extra) {
  const s = state[alias];
  const headers = Object.assign({ 'Content-Type': 'application/json' }, s && s.token ? { Authorization: 'Bearer ' + s.token } : {}, extra || {});
  const res = await fetch('https://' + (s ? s.host : alias) + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, body: json };
}
const brief = (r) => JSON.stringify({ status: r.status, ...pick(r.body) });
const pick = (b) => {
  const o = {};
  for (const k of ['error', 'message', 'code', 'why', 'detail', 'chit_id', 'status', 'created', 'party', 'address', 'delivered', 'ok', 'found']) if (b && b[k] !== undefined) o[k === 'status' ? 'chit_status' : k] = b[k];
  return o;
};

const CMD = {
  async signup([alias, host, user_id, name]) {
    const code = process.env['TESTER_CODE_' + alias.toUpperCase()];
    if (!code) throw new Error('set TESTER_CODE_' + alias.toUpperCase());
    const email = user_id + '@sit.example.org';
    state[alias] = { host };
    const reg = await call(alias, 'POST', '/api/entities/register', { email, display_name: name, user_id });
    console.log('register', brief(reg));
    const ver = await call(alias, 'POST', '/api/entities/verify', { email, otp: code });
    if (!ver.body.token) throw new Error('verify refused: ' + brief(ver));
    Object.assign(state[alias], { token: ver.body.token, bridge_id: ver.body.entity.bridge_id, user_id, name });
    save();
    console.log('signed up', alias, 'bridge_id', state[alias].bridge_id, 'at', host);
  },
  async add([a, b]) {
    const addr = state[b].bridge_id + '@' + state[b].host;
    const r = await call(a, 'POST', '/api/relationships/suppliers', { supplier_bridge_id: addr });
    console.log('add supplier', addr, 'to', a, brief(r));
  },
  async send([a, b, subject]) {
    const recipients = [{ display_name: state[b].name, bridge_id: state[b].bridge_id, kind: 'to' }];
    const ref = 'net-' + a + '-' + b + '-' + Date.now();
    const r = await call(a, 'POST', '/api/chits/send', {
      recipients, purpose: 'general', subject: subject || 'Network proof ' + a + ' to ' + b, manual_subject: subject || 'Network proof ' + a + ' to ' + b, client_ref: ref,
      business_json: { note: 'sent through the product by prove.cjs' }
    }, { 'Idempotency-Key': crypto.randomUUID() });
    console.log('send', a, '->', b, brief(r));
  },
  async me([alias]) {
    const r = await call(alias, 'GET', '/api/entities/me');
    console.log('me', alias, JSON.stringify({ status: r.status, user_id: r.body.user_id || (r.body.entity && r.body.entity.user_id), bridge_id: r.body.bridge_id || (r.body.entity && r.body.entity.bridge_id) }));
  },
  async list([alias]) {
    for (const box of ['inbox', 'sent']) {
      const r = await call(alias, 'GET', '/api/chits/' + box + '?limit=20');
      const rows = r.body.chits || r.body.rows || r.body.items || [];
      console.log(box, 'of', alias, 'status', r.status, 'count', rows.length);
      for (const c of rows.slice(0, 20)) console.log('  ', c.chit_id || c.id, c.current_status || c.status, c.subject || '');
    }
  }
};

(async () => {
  const [cmd, ...args] = process.argv.slice(2);
  if (!CMD[cmd]) { console.error('usage: prove.cjs ' + Object.keys(CMD).join(' | ')); process.exit(2); }
  try { await CMD[cmd](args); } catch (e) { console.error('prove: ' + e.message); process.exit(1); }
})();
