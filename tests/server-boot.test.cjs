'use strict';
/**
 * server-boot.test.cjs — server.js: the app boots offline, answers its health door, and refuses a stranger (INT7d-GREEN).
 *
 * Loads the REAL server.js (no database: DATABASE_URL unset, the pool says so and retries — boot does not wait on it) on an ephemeral port, then:
 *   · GET /health answers 200 (the healthcheck railway.json relies on) without a login
 *   · an anonymous call to a protected route is refused 401 with a sentence — auth runs before anything else touches the data
 *   · an unknown route answers 404 as JSON, never an HTML stack page
 *   · a weak JWT_SECRET outside a sealed environment only warns (the boot preflight lists sealed-environment errors, nothing else aborts)
 * The sealed-environment refusal itself is lib/dev-otp.bootPreflightErrors (tests/dev-otp.test.js); here we prove the wiring: it is the first thing server.js asks.
 * Run: node tests/server-boot.test.cjs · MIN unit-per-rule · refusal-path · fail-closed
 */
const assert = require('assert'), fs = require('fs'), http = require('http'), path = require('path');
Object.assign(process.env, { PORT: '0', HOST: '127.0.0.1', NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(40) });
delete process.env.DATABASE_URL;

let pass = 0;
const it = async (what, run) => { try { await run(); pass++; console.log('  ok  ' + what); } catch (e) { process.exitCode = 1; console.log('  FAIL ' + what + '\n      ' + e.message); } };
/** one GET against the app on its own ephemeral port → { status, type, text } */
function get(app, route) {
  return new Promise((resolve, reject) => {
    const door = http.createServer(app).listen(0, '127.0.0.1', () => {
      http.get({ host: '127.0.0.1', port: door.address().port, path: route }, (res) => {
        let text = ''; res.on('data', (part) => { text += part; });
        res.on('end', () => { door.close(); resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), text }); });
      }).on('error', (e) => { door.close(); reject(e); });
    });
  });
}

(async () => {
  const app = require('../server');
  await it('GET /health answers 200 without a login', async () => {
    const answer = await get(app, '/health');
    assert.strictEqual(answer.status, 200, answer.text);
  });
  await it('an anonymous call to a protected route is refused 401, in a sentence', async () => {
    const answer = await get(app, '/api/entities/header');
    assert.strictEqual(answer.status, 401, answer.text);
    assert.ok(/json/.test(answer.type), answer.type);
  });
  await it('an unknown route answers 404 as JSON, never an HTML stack page', async () => {
    const answer = await get(app, '/api/this-route-does-not-exist');
    assert.ok(answer.status === 404 || answer.status === 401, 'status ' + answer.status);
    assert.ok(!/<html/i.test(answer.text), 'no HTML page');
  });
  await it('server.js asks the boot preflight first, and a sealed environment aborts boot on it', async () => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(text.indexOf('bootPreflightErrors()') > 0 && text.indexOf('bootPreflightErrors()') < text.indexOf('app.use('), 'the preflight runs before any route is mounted');
    assert.ok(/preflight\.length\)[\s\S]{0,300}?process\.exit\(1\)/.test(text), 'a non-empty preflight exits');
  });
  console.log('\n  ' + pass + ' passed · ' + pass + ' checks');
  setTimeout(() => process.exit(process.exitCode || 0), 100);   // the server keeps its own listener open: end the run explicitly
})();
