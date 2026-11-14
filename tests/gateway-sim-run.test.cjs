'use strict';
// @type: integration
/**
 * tests/gateway-sim-run.test.cjs - what the stand-in IoT gateway (scripts/connector-gateway-sim.js) SENDS, run as a child process against a local stand-in api.
 *
 * OWNS      the proof of the two paths the simulator takes: the device-key path (POST /api/connectors/ingest with the X-Bridge-Key header, the signal,
 *           value, unit, device and bridge in the body, no bearer) and the token path (POST /api/chits/send with a bearer, one recipient role "to",
 *           the subject "Signal: <signal> = <value><unit>" and a device_signal business_json); an api refusal ends the run with exit 1 and [FAIL];
 *           a run with neither key nor recipient is refused before any request. Target safety (apiBase) stays with tests/sec3-device-keys.test.cjs.
 * CALLED BY scripts/guards.cjs (offline: the api is a 127.0.0.1 stand-in on a free port; no database).
 * CARD      docs/24-iot-and-devices/functions/gateway-simulation.md
 */
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const SIM = path.join(__dirname, '..', 'scripts', 'connector-gateway-sim.js');
let pass = 0, fail = 0, seen = [], status = 200;
const server = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: b ? JSON.parse(b) : null });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status >= 400 ? { message: 'KEY_REFUSED' } : req.url === '/api/connectors/ingest' ? { chit_id: 'CH-INGEST-1' } : { chit_id: 'CH-SEND-1' }));
  });
});
const run = (env) => new Promise((resolve) => {
  const base = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, API_BASE: 'http://127.0.0.1:' + server.address().port, VALUE: '42' };
  const c = spawn(process.execPath, [SIM], { env: Object.assign(base, env) }); let out = '';
  c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (out += d)); c.on('close', (code) => resolve({ code, out }));
});
const t = async (name, fn) => { seen = []; status = 200; try { await fn(); console.log('  PASS  ' + name); pass++; } catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; } };

server.listen(0, '127.0.0.1', async () => {
  await t('device-key path: one POST /api/connectors/ingest, key in X-Bridge-Key, no bearer, the signal in the body', async () => {
    const r = await run({ BRIDGE_KEY: 'KEY-1', BRIDGE_ID: 'BR-9', DEVICE_ID: 'pi4-lab-01', SIGNAL: 'temperature', UNIT: 'C' });
    assert.strictEqual(r.code, 0, r.out); assert.strictEqual(seen.length, 1);
    const q = seen[0]; assert.deepStrictEqual([q.method, q.url], ['POST', '/api/connectors/ingest']);
    assert.strictEqual(q.headers['x-bridge-key'], 'KEY-1'); assert.strictEqual(q.headers.authorization, undefined);
    assert.deepStrictEqual(q.body, { bridge_id: 'BR-9', signal: 'temperature', value: '42', unit: 'C', device_id: 'pi4-lab-01' });
    assert.ok(/chit_id: CH-INGEST-1/.test(r.out), r.out);
  });
  await t('device-key path: SUB_TYPE and TO ride along when given', async () => {
    const r = await run({ BRIDGE_KEY: 'KEY-1', SUB_TYPE: 'tanker', TO: 'ENT-5' }); assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(seen[0].body.sub_type, 'tanker'); assert.strictEqual(seen[0].body.to, 'ENT-5'); assert.strictEqual(seen[0].body.device_id, 'edge-gw-01', 'DEVICE_ID defaults to edge-gw-01');
  });
  await t('token path: POST /api/chits/send with the bearer, one recipient role "to", the subject and a device_signal body', async () => {
    const r = await run({ TOKEN: 'TOK-1', TO: 'ENT-5', DEVICE_ID: 'gw-2', SIGNAL: 'humidity', VALUE: '61', UNIT: '%' });
    assert.strictEqual(r.code, 0, r.out); assert.strictEqual(seen.length, 1);
    const q = seen[0]; assert.deepStrictEqual([q.method, q.url, q.headers.authorization], ['POST', '/api/chits/send', 'Bearer TOK-1']);
    assert.deepStrictEqual(q.body.recipients, [{ entity_id: 'ENT-5', role: 'to' }]); assert.strictEqual(q.body.manual_subject, 'Signal: humidity = 61%'); assert.strictEqual(q.body.purpose, 'general');
    const bj = q.body.business_json; assert.deepStrictEqual([bj.kind, bj.device_id, bj.signal, bj.value, bj.unit], ['device_signal', 'gw-2', 'humidity', '61', '%']);
  });
  await t('an api refusal ends the run: exit 1, [FAIL] with the status and words', async () => {
    status = 401; const r = await run({ BRIDGE_KEY: 'BAD' });
    assert.strictEqual(r.code, 1); assert.ok(/\[FAIL\] HTTP 401 .* KEY_REFUSED/.test(r.out), r.out);
  });
  await t('neither a key nor a recipient: refused before any request, exit 1, says what to set', async () => {
    const r = await run({}); assert.strictEqual(r.code, 1); assert.strictEqual(seen.length, 0); assert.ok(/BRIDGE_KEY=<ActorKey>.*TO=<counterparty entity_id>/.test(r.out), r.out);
  });
  await t('a recipient but no token and no dev mailbox: refused before any request', async () => {
    const r = await run({ TO: 'ENT-5' }); assert.strictEqual(r.code, 1); assert.strictEqual(seen.length, 0); assert.ok(/TOKEN=<bearer>/.test(r.out), r.out);
  });
  server.close(); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
});
