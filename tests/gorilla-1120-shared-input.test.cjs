#!/usr/bin/env node
// @type: contract
/**
 * gorilla-1120-shared-input.test.cjs - the shared-input fixes from docs/walks/GORILLA-2026-11-20.md.
 * OWNS      GOR-02 (lone surrogate on POST /api/products -> 400 not 500), GOR-07 (name text, number not hex), GOR-08 (logo https public only),
 *           GOR-11/P4 (bidi refused, control characters stripped), the per-account sign-in code cap, Cache-Control: no-store on signed-in answers.
 * CALLED BY CI. No database, no network: the real server.js over tools/load-app.cjs.
 * Run: node tests/gorilla-1120-shared-input.test.cjs
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const path = require('path');
const http = require('http');
const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
let failed = 0; let total = 0;
const check = (label, ok, info) => { total++; if (!ok) failed++; console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (ok || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 300))); };
const send = (port, method, urlPath, body, headers) => new Promise((resolve) => {
  const h = Object.assign({}, headers || {});
  if (body !== undefined) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(body); }
  const request = http.request({ port, path: urlPath, method, headers: h }, (response) => {
    let text = ''; response.on('data', (p) => (text += p));
    response.on('end', () => { let json = null; try { json = JSON.parse(text); } catch (e) { json = null; } resolve({ status: response.statusCode, headers: response.headers, json, text }); });
  });
  if (body !== undefined) request.write(body);
  request.end();
});

const hygiene = require(path.join(HERE, 'lib', 'input-hygiene.js'));
/* GOR-11 / P4 */
check('hasNul: a right-to-left override (U+202E) and an isolate (U+2067) are refused', hygiene.hasNul('ab‮cd') && hygiene.hasNul({ name: 'x⁧y' }));
check('hasNul: Arabic text and a left-to-right mark are not refused', !hygiene.hasNul('مرحبا') && !hygiene.hasNul('a‎b'));
const body = { name: 'a\u0007b\u0085c\u007Fd', note: 'line1\nline2\ttab', deep: [{ x: 'p\u0001q' }] };
hygiene.stripControls(body);
check('stripControls: C0/C1 controls removed, tab and new line kept, nested too', body.name === 'abcd' && body.note === 'line1\nline2\ttab' && body.deep[0].x === 'pq', body);

/* GOR-07 */
const cw = require(path.join(HERE, 'lib', 'catalogue-write.js'));
const rules = [{ field_key: 'name', field_name: 'Name', field_type: 'text', required: true }, { field_key: 'price', field_name: 'Price', field_type: 'number', required: false }];
const judge = (item) => cw.validateAgainst(rules, item);
check('name: an object, a number and a list are refused', !!judge({ name: { a: 1 } }) && !!judge({ name: 123 }) && !!judge({ name: ['x'] }));
check('price: 0x10, 1e3, true, [5] are refused', !!judge({ name: 'a', price: '0x10' }) && !!judge({ name: 'a', price: '1e3' }) && !!judge({ name: 'a', price: true }) && !!judge({ name: 'a', price: [5] }));
check('price: 12.5 and "12.50" and "" pass', !judge({ name: 'a', price: 12.5 }) && !judge({ name: 'a', price: '12.50' }) && !judge({ name: 'a', price: '' }));
check('an undeclared price key (price_min) "0x10" is refused too', !!cw.validateAgainst([], { name: 'a', price_min: '0x10' }));

(async () => {
  /* GOR-08 */
  const safe = require(path.join(HERE, 'lib', 'safe-url.js'));
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'http://example.com/a.png', 'https://169.254.169.254/latest', 'https://127.0.0.1/x.png', 'https://[::1]/x.png']) {
    const verdict = await safe.assertPublicHttps(bad);
    check('logo guard refuses ' + bad, verdict.ok === false, verdict);
  }
  const good = await safe.assertPublicHttps('https://1.1.1.1/logo.png');
  check('logo guard accepts https on a public address', good.ok === true, good);

  /* the profile validator chain for logo_url, run on its own */
  const entities = require(path.join(HERE, 'routes', 'entities.js'));
  const layer = entities.stack.find((l) => l.route && l.route.path === '/profile' && l.route.methods.patch);
  const chains = layer.route.stack.map((s) => s.handle).filter((fn) => typeof fn.run === 'function');
  const logo = chains.find((c) => c.builder && JSON.stringify(c.builder.build().fields) === '["logo_url"]');
  const tryLogo = async (value) => (await logo.run({ body: { logo_url: value } })).isEmpty();
  check('profile logo: 100,000 characters refused', !!logo && !(await tryLogo('https://1.1.1.1/' + 'a'.repeat(100000))));
  check('profile logo: javascript: refused, public https accepted, empty clears', !!logo && !(await tryLogo('javascript:alert(1)')) && (await tryLogo('https://1.1.1.1/l.png')) && (await tryLogo('')));

  /* per-account code cap */
  const signin = require(path.join(HERE, 'routes', 'signin.js'));
  const answers = [];
  for (let i = 0; i < 7; i++) {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, getHeader() {}, status(c) { this.statusCode = c; return this; }, set() { return this; } };
    await new Promise((resolve) => {
      res.json = (b) => { res.body = b; resolve(); return res; };
      res.send = res.json; res.end = () => { resolve(); return res; };
      signin.askAccountCap({ ip: '9.9.9.' + i, headers: {}, body: { user_id: 'Same-Account' }, app: { get: () => false }, method: 'POST', path: '/ask' }, res, () => { res.passed = true; resolve(); });
    });
    answers.push(res);
  }
  check('code cap: five pass, the sixth and seventh are 429 in words', answers.slice(0, 5).every((r) => r.passed) && answers[5].statusCode === 429 && answers[6].statusCode === 429 && /Codes were asked/.test(JSON.stringify(answers[5].body)), answers.map((r) => r.statusCode));

  /* the server: surrogate -> 400, bidi -> 400, no-store on a signed-in answer */
  const loader = require(path.join(HERE, 'tools', 'load-app.cjs'));
  loader.stubDatabase(HERE);
  const server = http.createServer(loader.loadApp(HERE));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const lone = await send(port, 'POST', '/api/products', JSON.stringify({ item_data: { name: 'x\uD800y', description: 'ok' } }));
  check('POST /api/products with U+D800 in the name: 400 INVALID_CHARACTER, not 500', lone.status === 400 && lone.json && lone.json.code === 'INVALID_CHARACTER', { status: lone.status, text: lone.text });
  const desc = await send(port, 'POST', '/api/products', JSON.stringify({ item_data: { name: 'x', description: 'y\uDC00' } }));
  check('...and in the description', desc.status === 400 && desc.json && desc.json.code === 'INVALID_CHARACTER', { status: desc.status });
  const bidi = await send(port, 'POST', '/api/products', JSON.stringify({ item_data: { name: 'abc‮def' } }));
  check('POST /api/products with U+202E: 400 INVALID_CHARACTER', bidi.status === 400 && bidi.json && bidi.json.code === 'INVALID_CHARACTER', { status: bidi.status });
  const signed = await send(port, 'GET', '/api/products', undefined, { authorization: 'Bearer not-a-real-token' });
  check('a signed-in call carries Cache-Control: no-store (even when refused)', /no-store/.test(String(signed.headers['cache-control'])), signed.headers);
  server.close();
  console.log(total + ' checks' + (failed ? ', ' + failed + ' FAILED' : ', all ok'));
  process.exit(failed ? 1 : 0);
})();
