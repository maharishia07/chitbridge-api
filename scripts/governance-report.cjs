#!/usr/bin/env node
/**
 * scripts/governance-report.cjs — E04, THE NIGHTLY GOVERNANCE REPORT.
 *
 * Takes the facts the workflow gathered (env vars, or --facts <file.json>) and writes JUnit with ONE testcase,
 * `governance.nightly` (the board's own key, posted with key_from 'name' like the guards). Red names each failing
 * line in plain words. Exit 1 when red, so the nightly run is red too.
 *
 * THE INVARIANT: it never passes while `main` is unprotected, or while /health does not say production.
 * ⚠️ "unknown" is never a pass: a fact we could not read is a red line that says so.
 *
 * Facts (env, or JSON keys in lower case without the GOV_ prefix):
 *   GOV_PROTECT_API / GOV_PROTECT_WEB   protected | unprotected | unknown     (branch protection of main)
 *   GOV_ENFORCE_API / GOV_ENFORCE_WEB   true | false | unknown                (enforce admins)
 *   GOV_ALERTS                          number of open Dependabot/audit alerts, or unknown
 *   GOV_CI_MAIN                         conclusion of the latest completed CI run of main (success | failure | unknown ...)
 *   GOV_HEALTH_ENV                      the raw "environment" string from /health (leading space and all), or unreachable
 */
'use strict';
const fs = require('fs'), path = require('path');

const KEY = 'governance.nightly';

function evaluate(f) {
  const lines = [];          // every line checked: { ok, text }
  const add = (ok, good, bad) => lines.push({ ok: !!ok, text: ok ? good : bad });

  ['api', 'web'].forEach((item) => {
    const p = String(f['protect_' + item] || 'unknown').trim().toLowerCase();
    const e = String(f['enforce_' + item] || 'unknown').trim().toLowerCase();
    add(p === 'protected', 'main is protected on chitbridge-' + item,
      p === 'unprotected' ? 'main is NOT protected on chitbridge-' + item + ' — anyone with write access can push straight to it'
        : 'protection: unknown on chitbridge-' + item + ' (needs a token that may read branch protection)');
    if (p === 'protected') {
      add(e === 'true', 'admins are held to the same rules on chitbridge-' + item,
        e === 'false' ? 'admins can skip the rules on chitbridge-' + item : 'admin enforcement: unknown on chitbridge-' + item);
    }
  });

  const n = String(f.alerts == null ? 'unknown' : f.alerts).trim();
  add(/^\d+$/.test(n) && Number(n) === 0, 'no open Dependabot or audit alerts',
    /^\d+$/.test(n) ? n + ' open Dependabot or audit alert' + (Number(n) === 1 ? '' : 's') : 'open alerts: unknown (the token cannot read them)');

  const ci = String(f.ci_main || 'unknown').trim().toLowerCase();
  add(ci === 'success', 'the latest CI run on main passed',
    ci === 'unknown' || ci === '' ? 'CI status of main: unknown' : 'the latest CI run on main did not pass (' + ci + ')');

  /* ⚠️ EXACT match, no trim: " development" (leading space, production today — H1) must read red. */
  const raw = f.health_env == null ? 'unreachable' : String(f.health_env);
  add(raw === 'production', 'the live server says it is in production',
    raw === 'unreachable' || raw === '' ? 'the live server could not be reached, so DEV_OTP posture is unknown'
      : 'the live server says environment "' + raw + '", not "production" — development mode is on (DEV_OTP could be open)');

  return { lines, red: lines.filter((item) => !item.ok) };
}

function junit(res) {
  const { write } = require('../lib/junitresults');
  const summary = res.lines.map((item) => (item.ok ? 'ok: ' : 'RED: ') + item.text).join('\n');
  return write('governance', [{ name: KEY, classname: 'governance', status: res.red.length ? 'fail' : 'pass',
    message: res.red.map((item) => item.text).join('\n'), output: summary }]);
}

function factsFromEnv(env) {
  const f = {};
  Object.keys(env).forEach((item) => { if (item.indexOf('GOV_') === 0) f[item.slice(4).toLowerCase()] = env[item]; });
  return f;
}

module.exports = { evaluate, junit, factsFromEnv, KEY };

if (require.main === module) {
  const a = process.argv, fi = a.indexOf('--facts'), oi = a.indexOf('--out');
  const facts = fi >= 0 ? JSON.parse(fs.readFileSync(a[fi + 1], 'utf8')) : factsFromEnv(process.env);
  const out = path.resolve(oi >= 0 ? a[oi + 1] : 'test-results/governance.xml');
  const res = evaluate(facts);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, junit(res));
  res.lines.forEach((item) => console.log((item.ok ? '  ok   ' : '  RED  ') + item.text));
  console.log('  ' + (res.red.length ? res.red.length + ' red of ' + res.lines.length : 'all ' + res.lines.length + ' green') + ' · JUnit → ' + out);
  if (res.red.length) console.log('::error::governance.nightly is red — ' + res.red.map((item) => item.text).join('; '));
  process.exit(res.red.length ? 1 : 0);
}
