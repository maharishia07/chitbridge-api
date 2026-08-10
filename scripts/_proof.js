'use strict';
/**
 * scripts/_proof.js — THE proof harness. Every prove-*.js talks to the API through this.
 *
 * ── ⚠️ WHY IT EXISTS: A FALSE RED COST A NIGHT ──────────────────────────────────────────────────────────────────
 * On 2026-08-09 `prove-outbound` reported "4 passed, 1 FAILED — an outbound attempt was RECORDED … rows now 9 (was
 * 9)". It was written up as an open defect, with leads, and left for the morning. There was no defect: Railway had
 * been intermittently answering 502 all evening, one request in the middle of the run did not arrive, and the
 * script read that as the product failing. The same run reported 5 checks where a healthy run reports 9 — it had
 * been truncated, and nothing said so.
 *
 * ⚠️ "COULD NOT TEST" AND "TEST FAILED" ARE DIFFERENT ANSWERS AND MUST NEVER SHARE AN EXIT CODE.
 *   exit 0 — everything passed
 *   exit 1 — a check genuinely failed. Act on it.
 *   exit 2 — the platform did not answer. Nothing was proved either way; re-run.
 * A red that means "the server was down" is worse than no result, because it is believed and acted on.
 *
 * ── ⚠️ AND IT EXISTS BECAUSE THERE WERE 33 SCRIPTS AND NO ONE PLACE ─────────────────────────────────────────────
 * j() had 9 copies, loadEnvFile 9, ok() 14, the API base URL 31. Retry-on-blip could not be "added" because there
 * was nowhere to add it — it would have meant 9 edits and the 10th script written next week would still be wrong.
 * That is the same shape as the OTP fix that reached one of three call sites (lib/otp.js).
 */
const fs = require('fs');
const path = require('path');

/**
 * Load .env.proof / .env.proof.txt / .env — environment always wins.
 *
 * ⚠️ `.env.proof.txt` IS ACCEPTED ON PURPOSE. Notepad appends `.txt` unless you fight the Save dialog, so asking
 * for a dotfile on Windows reliably produces `.env.proof.txt` — and then the script says "missing" about a file
 * sitting right there with the right contents.
 *
 * ⚠️ AND THE VALUE IS TRIMMED. `(.*)\s*$` looks like it strips trailing whitespace and does not: `.*` is greedy and
 * eats the spaces first. One invisible trailing space on the secret line once produced a signature computed with a
 * different key than the server held — every delivery came back 401 and the failure surfaced four checks later as
 * "A did not receive A's message", pointing at routing rather than at a space.
 */
function loadEnv() {
  for (const name of ['.env.proof', '.env.proof.txt', '.env']) {
    const f = path.join(__dirname, '..', name);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const v = m[2].trim().replace(/^['"]|['"]$/g, '').trim();
      if (!process.env[m[1]] && v) process.env[m[1]] = v;
    }
  }
}
loadEnv();

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const OTP = process.env.DEV_OTP || '123456';

/** Thrown when the PLATFORM is unreachable. Never means a check failed — see the exit-code note above. */
class PlatformDown extends Error {
  constructor(msg) { super(msg); this.name = 'PlatformDown'; this.platformDown = true; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* 502/503/504 are the edge saying "the app did not answer me" — the request never reached our code, so retrying is
   safe whatever the verb. A 500 is NOT here: that is our own code failing and is a real result. */
const PLATFORM_STATUS = new Set([502, 503, 504]);

/**
 * j(path, opts) — one request, retried past a platform blip, never past a real answer.
 *
 * opts: { method, token, body, headers, retries }
 */
async function j(p, o = {}) {
  const retries = o.retries === undefined ? 3 : o.retries;
  let lastWhy = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(1500 * attempt);                 // 1.5s, 3s, 4.5s — a Railway cold start fits inside
    let r;
    try {
      r = await fetch(API + p, {
        method: o.method || 'GET',
        headers: Object.assign({ 'Content-Type': 'application/json' },
          o.token ? { Authorization: 'Bearer ' + o.token } : {}, o.headers || {}),
        body: o.body === undefined ? undefined : (typeof o.body === 'string' ? o.body : JSON.stringify(o.body)),
      });
    } catch (e) {                                             // DNS / socket / reset — never reached the app
      lastWhy = (e && e.message) || 'network error';
      continue;
    }
    let b = null; try { b = await r.json(); } catch (_) {}
    /**
     * ⚠️ A 503 FROM OUR OWN CODE IS AN ANSWER, NOT AN OUTAGE — and this guard got that wrong on its first real
     * outing. The API returns 503 with a JSON body to mean "that migration has not been run"; the edge returns 503
     * with no JSON at all to mean "the app never replied". Treating both as platform-down aborted a proof at 23/23
     * on the very check that was verifying the migration-absent path.
     *
     * The discriminator is the BODY: our handlers always answer JSON with an `error` field. If one parsed, the app
     * spoke — return it and let the check judge. Only a 502/503/504 with nothing readable is really the platform.
     */
    if (PLATFORM_STATUS.has(r.status) && !(b && (b.error || b.message))) { lastWhy = 'HTTP ' + r.status; continue; }
    return { status: r.status, b };
  }
  /* ⚠️ ONE ARGUMENT. Passing (method, path, why) silently produced the message "GET" — the two facts that say
     WHICH request died and WHY were dropped, leaving exactly the uninformative red this file exists to prevent. */
  throw new PlatformDown((o.method || 'GET') + ' ' + p + ' — ' + lastWhy + ', after ' + (retries + 1) + ' attempts');
}

/**
 * run(name, fn) — the wrapper every proof's main body goes through.
 *
 * ⚠️ IT IS THE ONLY PLACE THAT DECIDES AN EXIT CODE, so "could not test" cannot be reported as "failed" by a script
 * that forgot the distinction.
 */
async function run(name, fn) {
  const t = tally();
  try {
    await fn(t);
  } catch (e) {
    if (e && e.platformDown) {
      console.log('\n  \x1b[33m⊘ COULD NOT TEST\x1b[0m — the platform did not answer (' + e.message + ').');
      console.log('    Nothing was proved either way. This is NOT a failure of the code — re-run it.');
      console.log('    ' + t.passed + ' check(s) had passed before it stopped.\n');
      process.exitCode = 2; return;
    }
    console.log('\n  \x1b[31m' + name + ' crashed:\x1b[0m ' + ((e && e.message) || e) + '\n');
    process.exitCode = 1; return;
  }
  console.log('\n  ' + t.passed + ' passed, ' + t.failed + ' failed\n');
  process.exitCode = t.failed ? 1 : 0;
}

/** The check counter + printer. `ok(cond, message, detail)` — detail is shown only on failure. */
function tally() {
  const t = {
    passed: 0, failed: 0,
    ok(cond, msg, detail) {
      if (cond) { t.passed++; console.log('  \x1b[32m✓\x1b[0m ' + msg); }
      else { t.failed++; console.log('  \x1b[31m✗ ' + msg + '\x1b[0m' + (detail ? '\n      ' + detail : '')); }
      return !!cond;
    },
    note(msg) { console.log('  \x1b[36m·\x1b[0m ' + msg); },
  };
  return t;
}

/** Sign in (registering if needed) and return a token, or null. */
async function signIn(email, display_name) {
  await j('/api/entities/register', { method: 'POST', body: { email, display_name: display_name || 'Proof Co' } });
  const v = await j('/api/entities/verify', { method: 'POST', body: { email, otp: OTP } });
  return (v.b && (v.b.token || (v.b.entity && v.b.entity.token))) || null;
}

/**
 * requireSignedWebhook() — the precondition every channel proof needs.
 *
 * ⚠️ IF THE SERVER IS NOT ENFORCING SIGNATURES, half the checks in those files pass for the wrong reason: "a
 * declared binding receives nothing" is trivially true when nothing is ever received. Aborts as COULD-NOT-TEST.
 */
async function requireSignedWebhook() {
  const r = await j('/api/capture/webhook/whatsapp', {
    method: 'POST', body: '{}', headers: { 'X-Hub-Signature-256': 'sha256=deadbeef' } });
  if (r.status !== 401) throw new PlatformDown('webhook signatures are not being enforced (got ' + r.status + ') — set WHATSAPP_APP_SECRET on the server');
  return true;
}

module.exports = { API, OTP, j, run, tally, signIn, requireSignedWebhook, loadEnv, sleep, PlatformDown };
