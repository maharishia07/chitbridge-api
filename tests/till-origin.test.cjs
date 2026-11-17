'use strict';
/**
 * till-origin.test.cjs — ⚠️⚠️⚠️ ONLY THE COUNTER'S OWN PAGE MAY WRITE TO THE SHOP-PC PROGRAM (critic review C1, 2026-09-29).
 *
 * The review posted a ₹9,999 bill into a shop's books and signed its counter out — from an ordinary web page open in
 * the same browser. till.js listened on 127.0.0.1 (so no other MACHINE could reach it) and trusted every request that
 * got there. This drives the REAL program, from a copy of the kit, and tries both attacks:
 *   · a write from a foreign Origin                          → refused, and the key is still in connector.json
 *   · any request whose Host is not the program's own (DNS rebinding) → refused
 * and proves the page's own calls, and a local tool with no Origin, still work.
 *
 * Run: node tests/till-origin.test.cjs   · no network (the program's API is unreachable on purpose — it stays offline).
 */
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), net = require('net');
const { spawn } = require('child_process');

const KIT = path.join(__dirname, '..', 'tools', 'tally-connector');
let pass = 0;
const it = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function freePort() { return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
/** a raw request — node's fetch will not let a test set Host, and Host is the whole point */
function req(port, method, pth, headers) {
  return new Promise((res) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: pth, headers: headers || {} }, (x) => {
      let b = ''; x.on('data', (d) => { b += d; }); x.on('end', () => res({ status: x.statusCode, body: b }));
    });
    r.on('error', (e) => res({ status: 0, body: String(e) }));
    r.end(method === 'GET' ? undefined : '{}');
  });
}

(async () => {
  console.log('\nONLY THE COUNTER’S OWN PAGE MAY WRITE TO IT (C1)\n');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cborigin-'));
  const kit = path.join(home, 'kit'); fs.mkdirSync(kit);
  for (const n of fs.readdirSync(KIT)) if (/\.(js|html)$/.test(n) && fs.statSync(path.join(KIT, n)).isFile()) fs.copyFileSync(path.join(KIT, n), path.join(kit, n));
  const key = b64({ alg: 'HS256' }) + '.' + b64({ identity_id: 'ent-o', bridge_id: 'CB-ORIGIN', display_name: 'Origin Test', kind: 'api_key', scopes: ['till'] }) + '.stub';
  const cfg = path.join(home, 'connector.json');
  fs.writeFileSync(cfg, JSON.stringify({ api: 'http://127.0.0.1:9', key, till: { id: 'C1' } }, null, 2));
  const port = await freePort();
  const pr = spawn(process.execPath, [path.join(kit, 'till.js'), '--config', cfg, '--port', String(port)], { cwd: kit, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; pr.stdout.on('data', (d) => { out += d; }); pr.stderr.on('data', (d) => { out += d; });
  const own = '127.0.0.1:' + port;
  let up = false;
  for (let i = 0; i < 100 && !up; i++) { const r = await req(port, 'GET', '/api/state', { host: own }); up = r.status === 200; if (!up) await sleep(150); }

  try {
    await it('the program is up and answers its own page', async () => { assert.ok(up, 'the counter never answered\n' + out.slice(-800)); });

    await it('⚠️⚠️ a sign-out from ANOTHER website is refused — and the key is still on this PC', async () => {
      const r = await req(port, 'POST', '/api/signout', { host: own, origin: 'https://evil.example', 'content-type': 'text/plain' });
      assert.strictEqual(r.status, 403, 'a foreign page signed the counter out: ' + r.status + ' ' + r.body);
      assert.ok(JSON.parse(fs.readFileSync(cfg, 'utf8')).key, 'the key was removed from connector.json');
    });

    await it('⚠️⚠️ a bill from ANOTHER website never reaches the program (refused before any route)', async () => {
      const r = await req(port, 'POST', '/api/bill', { host: own, origin: 'https://evil.example', 'content-type': 'text/plain' });
      assert.strictEqual(r.status, 403, 'a foreign POST reached a route: ' + r.status);
    });

    await it('⚠️ a DNS-rebinding request (a Host that is not this program) is refused — even a read', async () => {
      const r = await req(port, 'GET', '/api/state', { host: 'evil.example:' + port });
      assert.strictEqual(r.status, 403, 'a foreign Host was answered: ' + r.status);
    });

    await it('the counter’s OWN page may write (same origin)', async () => {
      const r = await req(port, 'POST', '/api/refresh', { host: own, origin: 'http://' + own });
      assert.notStrictEqual(r.status, 403, 'the page’s own call was refused');
    });

    await it('a local tool with no Origin (a test, curl) still works; "localhost" is its own name too', async () => {
      const a = await req(port, 'POST', '/api/refresh', { host: own });
      const b = await req(port, 'GET', '/api/state', { host: 'localhost:' + port });
      assert.notStrictEqual(a.status, 403, 'a local tool was refused');
      assert.strictEqual(b.status, 200, 'localhost was refused');
    });

    await it('a refusal is said out loud in the program’s log', async () => {
      assert.ok(/refused a request from outside this counter/.test(out), 'nothing logged');
    });
  } finally {
    pr.kill();
  }
  console.log('\n' + pass + ' checks passed\n');
})();
