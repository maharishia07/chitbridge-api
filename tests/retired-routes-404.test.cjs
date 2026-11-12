'use strict';
// @type: contract
/**
 * retired-routes-404.test.cjs — the 7 routes Athi retired on 2026-11-12 (DECISIONS d05560bf) answer 404, as JSON, for every method and a signed-in caller.
 *
 * OWNS      the proof that GET /api/assist/gaps, POST /api/assist/gap, GET /api/connections/list, GET /api/connections/pending, GET /api/schemas/my,
 *           POST /api/actors/check-key and PATCH /api/entities/me/locale are gone: each answers 404 (never 401/405/200) with the real server.js and a valid token,
 *           while the doors that replaced or kept their neighbours still answer something else.
 * CALLED BY scripts/guards.cjs · CI. No database: the real server.js with DATABASE_URL unset; the 404 comes from the router finding no route, before any query.
 * FLOW      sign a token → request each retired path → 404 JSON; request a neighbour that stayed → not 404
 * CARD      28-platform-and-operations/api-surface
 * MIN       one case per retired route plus the neighbours that must stay
 */
const assert = require('assert'), http = require('http'), jwt = require('jsonwebtoken');
Object.assign(process.env, { PORT: '0', HOST: '127.0.0.1', NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(40) });
delete process.env.DATABASE_URL;

const RETIRED = [
  ['GET', '/api/assist/gaps'], ['POST', '/api/assist/gap'], ['GET', '/api/connections/list'], ['GET', '/api/connections/pending'],
  ['GET', '/api/schemas/my'], ['POST', '/api/actors/check-key'], ['PATCH', '/api/entities/me/locale']
];
const STAYED = [['PATCH', '/api/entities/me/prefs/locale'], ['PUT', '/api/connections/00000000-0000-4000-8000-000000000000/respond'], ['POST', '/api/actors/suggest-key'], ['POST', '/api/assist/publish']];

let pass = 0;
const it = async (what, run) => { try { await run(); pass++; console.log('  ok  ' + what); } catch (e) { process.exitCode = 1; console.log('  FAIL ' + what + '\n      ' + e.message); } };
function call(app, method, route, token) {
  return new Promise((resolve, reject) => {
    const door = http.createServer(app).listen(0, '127.0.0.1', () => {
      const req = http.request({ host: '127.0.0.1', port: door.address().port, path: route, method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token } }, (res) => {
        let text = ''; res.on('data', (part) => { text += part; });
        res.on('end', () => { door.close(); resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), text }); });
      });
      req.on('error', (e) => { door.close(); reject(e); });
      req.end(method === 'GET' ? undefined : '{}');
    });
  });
}

(async () => {
  const app = require('../server');
  const token = jwt.sign({ identity_id: '11111111-1111-4111-8111-111111111111', identity_type: 'entity' }, process.env.JWT_SECRET);
  for (const [method, route] of RETIRED) {
    await it(method + ' ' + route + ' answers 404 JSON (retired)', async () => {
      const answer = await call(app, method, route, token);
      assert.strictEqual(answer.status, 404, 'status ' + answer.status + ' ' + answer.text.slice(0, 120));
      assert.ok(/json/.test(answer.type) && !/<html/i.test(answer.text), 'JSON, got ' + answer.type);
    });
  }
  for (const [method, route] of STAYED) {
    await it(method + ' ' + route + ' is still a route (not 404)', async () => {
      const answer = await call(app, method, route, token);
      assert.notStrictEqual(answer.status, 404, answer.text.slice(0, 120));
    });
  }
  console.log(pass + ' passed' + (process.exitCode ? ', some FAILED' : ''));
  setTimeout(() => process.exit(process.exitCode || 0), 200);
})();
