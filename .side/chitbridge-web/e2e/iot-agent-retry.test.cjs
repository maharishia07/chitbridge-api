/**
 * iot-agent-retry.test.cjs — SEC3: the generated Pi agent never loses a device event.
 *   node e2e/iot-agent-retry.test.cjs   (no browser, no network)
 * The agent text is the one public/app/cap-connector.js `_agentJs()` writes into install.sh. It runs here in a sandbox with a
 * temp spool and a stand-in https that answers a chosen status: only a 2xx moves the event to sent/; a 503 (chit not
 * delivered), a 403 (refused) or a 302 keeps it in the spool for the next drain.
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), EventEmitter = require('events');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'cap-connector.js'), 'utf8');
const m = src.match(/function _agentJs\(\) ?\{\s*return \[[\s\S]*?\]\.join\('\\n'\);\s*\}/);
let pass = 0, fail = 0; const ok = (c, msg, x) => { if (c) { pass++; console.log('PASS ' + msg); } else { fail++; console.log('FAIL ' + msg + (x ? ' ' + JSON.stringify(x) : '')); } };
if (!m) { console.log('FAIL _agentJs not found in cap-connector.js'); process.exit(1); }
const agent = new Function(m[0] + '; return _agentJs();')().replace(/^#!.*\n/, '');

function run(status, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-agent-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ endpoint: 'https://api.example', key: 'k', devices: [] }));
  fs.mkdirSync(path.join(dir, 'spool'));
  fs.writeFileSync(path.join(dir, 'spool', 'ev1.json'), JSON.stringify({ bridge_id: 'CB1', value: '1' }));
  const https = { request(opts, cb) {
    const req = new EventEmitter(); req.write = () => {};
    req.end = () => setImmediate(() => { const res = new EventEmitter(); res.statusCode = status; cb(res); res.emit('data', JSON.stringify(body || {})); res.emit('end'); });
    return req; } };
  const logs = [];
  const sandbox = { require: (n) => (n === 'https' ? https : require(n)), __dirname: dir, console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
    setInterval: () => 0, Buffer, JSON, String };
  vm.runInNewContext(agent, sandbox);
  return new Promise((r) => setTimeout(() => r({ spool: fs.readdirSync(path.join(dir, 'spool')), sent: fs.readdirSync(path.join(dir, 'sent')), logs }), 50));
}

(async () => {
  let r = await run(200, { chit_id: 'c1' });
  ok(r.sent.includes('ev1.json') && !r.spool.includes('ev1.json'), '200 → the event moves to sent/', r);
  r = await run(503, { code: 'CHIT_NOT_DELIVERED', message: 'Health updated, but the signal chit could not be delivered.' });
  ok(r.spool.includes('ev1.json') && !r.sent.includes('ev1.json'), '503 CHIT_NOT_DELIVERED → the event stays in the spool', r);
  ok(r.logs.some((l) => /kept for retry/.test(l) && /CHIT_NOT_DELIVERED/.test(l)), '… and the log names the code', r.logs);
  r = await run(403, { code: 'DEVICE_TO_REFUSED' });
  ok(r.spool.includes('ev1.json') && !r.sent.includes('ev1.json'), '403 refused → the event stays in the spool', r);
  r = await run(302, {});
  ok(r.spool.includes('ev1.json') && !r.sent.includes('ev1.json'), '302 (not 2xx) → the event stays in the spool', r);
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
