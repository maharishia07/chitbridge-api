/**
 * co2-controls.test.cjs — round CO2 (security controls + evidence; web docs/research/COMPLIANCE-OBLIGATIONS-2026-10.md K5 · K6).
 * The evidence a reviewer can RUN for two rows of the Standards register (web public/app/cap-standards.js):
 *   1  K5 · a critical line reaches a person: with CB_ALERT_WEBHOOK set, log.critical POSTs the record; warn/error do not; a
 *      webhook that fails never throws into the caller.
 *   2  K6 · state_log is append-only: b315 revokes UPDATE from cb_app and refuses DELETE unless the copy is a Draft — and no code
 *      UPDATEs state_log, and the only DELETEs are the draft paths it was written around (a new one fails here, to be looked at).
 * Offline: no DB, no network (fetch is a stub).
 */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '   ' + extra : '')); }
}
const API = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(API, p), 'utf8');

(async () => {
  /* ── 1 · K5 the critical sink ─────────────────────────────────────────────────────────────────────────────── */
  const posted = [];
  const realFetch = global.fetch, realErr = console.error, realLog = console.log;
  const errs = [];
  global.fetch = (url, opt) => { posted.push({ url, opt }); return url.indexOf('down') >= 0 ? Promise.reject(new Error('refused')) : Promise.resolve({ ok: true }); };
  console.error = (l) => errs.push(String(l)); console.log = () => {};
  process.env.CB_ALERT_WEBHOOK = 'https://alerts.example/hook';
  const P = require.resolve(path.join(API, 'lib', 'logger'));
  delete require.cache[P];
  const log = require(P);
  log.warn('w'); log.error('e', { id: 'r1' });
  log.critical('database unreachable', { id: 'r2' });
  await new Promise((r) => setTimeout(r, 10));
  console.error = realErr; console.log = realLog;
  check('a critical line is POSTed to CB_ALERT_WEBHOOK as JSON', posted.length === 1 && posted[0].url === 'https://alerts.example/hook' && posted[0].opt.method === 'POST' && JSON.parse(posted[0].opt.body).msg === 'database unreachable' && JSON.parse(posted[0].opt.body).id === 'r2');
  check('warn and error do not wake anyone', posted.length === 1);

  process.env.CB_ALERT_WEBHOOK = 'https://down.example/hook';
  delete require.cache[P];
  const log2 = require(P);
  const errs2 = []; console.error = (l) => errs2.push(String(l)); console.log = () => {};
  let threw = false;
  try { log2.critical('x'); } catch (e) { threw = true; }
  await new Promise((r) => setTimeout(r, 10));
  console.error = realErr; console.log = realLog;
  check('a webhook that fails never throws into the caller, and is SAID', !threw && errs2.some((l) => /critical alert not delivered/.test(l)));

  delete process.env.CB_ALERT_WEBHOOK;
  delete require.cache[P];
  const before = posted.length;
  console.error = () => {};
  require(P).critical('y');
  await new Promise((r) => setTimeout(r, 10));
  console.error = realErr;
  check('unset → no sink, as before', posted.length === before);
  global.fetch = realFetch;
  delete require.cache[P];

  /* ── 2 · K6 state_log append-only ─────────────────────────────────────────────────────────────────────────── */
  const sql = read('migrations/b303_state_log_append_only.sql');
  const body = sql.replace(/--[^\n]*/g, '');
  check('b315 revokes UPDATE on state_log from cb_app', /REVOKE\s+UPDATE\s+ON\s+state_log\s+FROM\s+cb_app/i.test(body));
  check('b315 does NOT revoke DELETE (sending a draft clears its rows)', !/REVOKE[^;]*DELETE[^;]*state_log/i.test(body));
  check('b315 guards DELETE with a BEFORE DELETE trigger that allows only a Draft copy',
    /BEFORE\s+DELETE\s+ON\s+state_log/i.test(body) && /h\.role\s*=\s*'Draft'/.test(body) && /RAISE\s+EXCEPTION/i.test(body));
  check('b315 is re-runnable (CREATE OR REPLACE · DROP TRIGGER IF EXISTS) and one transaction', /CREATE OR REPLACE FUNCTION/.test(body) && /DROP TRIGGER IF EXISTS/.test(body) && /BEGIN;[\s\S]*COMMIT;/.test(body));

  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.js$/.test(f.name)) files.push(p); } })(path.join(API, 'lib'));
  (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.js$/.test(f.name)) files.push(p); } })(path.join(API, 'routes'));
  files.push(path.join(API, 'server.js'));
  const upd = [], del = [];
  files.forEach((f) => { const t = fs.readFileSync(f, 'utf8'); if (/UPDATE\s+state_log\b/i.test(t)) upd.push(path.relative(API, f)); (t.match(/DELETE\s+FROM\s+state_log\b/gi) || []).forEach(() => del.push(path.relative(API, f))); });
  check('no code UPDATEs state_log', upd.length === 0, upd.join(' '));
  const chits = read('routes/chits.js');
  const draftDel = (chits.match(/DELETE FROM state_log[^\n]*/g) || []).length;
  check('the only state_log DELETEs are the two draft paths in routes/chits.js (promote · purge) — a new one is looked at here',
    del.length === 2 && del.every((f) => f === path.join('routes', 'chits.js')) && draftDel === 2 && /role !== 'Draft'/.test(chits) && /promote_draft_id\)\s*\{\s*\/\/ promoting/.test(chits), del.join(' '));

  console.log('\n' + (fail ? '  ✗ FAIL' : '  ✓ CO2 controls') + ' · ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
