'use strict';
/* ── e2e/session.cjs — GIVE A PAGE THE SAVED SESSION, WHATEVER ORIGIN IT WAS SAVED FOR ─────────────────────────
 *
 * ⚠️⚠️ WHY THIS EXISTS. `.auth/user.json` is a Playwright storageState, and storageState is keyed BY ORIGIN.
 * The shared setup mints against whichever baseURL the config points at — which on 2026-09-02 was
 * `https://chitbridge-web.vercel.app`. A standalone probe loading `http://localhost:5173` therefore got an
 * EMPTY localStorage, sat on the login screen, and every assertion failed with `modalhost` missing. That reads
 * as "the screen you just built is broken" and is really "this page was never signed in".
 *
 * ⚠️ AND THE API BASE RIDES ALONG. On localhost the app defaults to a LOCAL api on :3000; only a stored
 * `cb_api_base` sends it to the cloud. So which backend a probe tested depended on whatever the auth file
 * happened to carry that day — refresh the file and everything silently repoints at a port with nothing
 * listening. Pinning it here makes the target a declared fact instead of an inherited accident.
 *
 * ⭐ Both are one-line facts, and both cost an afternoon when they are implicit. Use before the first goto():
 *
 *     const { attachSession } = require('./session.cjs');
 *     await attachSession(context);              // cloud API by default; CB_API_BASE overrides
 */
const fs = require('fs');
const path = require('path');

const AUTH = path.join(__dirname, '.auth', 'user.json');
const CLOUD = 'https://chitbridge-api-production.up.railway.app';

/** The session blob, from whichever origin the setup happened to save it under. */
function savedSession(file) {
  const j = JSON.parse(fs.readFileSync(file || AUTH, 'utf8'));
  for (const o of j.origins || []) {
    const hit = (o.localStorage || []).find((e) => e.name === 'cb_sess');
    if (hit) return { value: hit.value, origin: o.origin };
  }
  return null;
}

/**
 * ⚠️ addInitScript, NOT an evaluate after load — the app reads the session while it boots, so setting it
 * afterwards means the first render already decided you were signed out and painted the login screen.
 */
async function attachSession(context, opts) {
  opts = opts || {};
  const s = savedSession(opts.authFile);
  if (!s) throw new Error('no cb_sess in ' + (opts.authFile || AUTH) + ' — run: npx playwright test auth.setup.js');
  const base = opts.apiBase || process.env.CB_API_BASE || CLOUD;
  await context.addInitScript(([sess, api]) => {
    try { localStorage.setItem('cb_sess', sess); localStorage.setItem('cb_api_base', api); } catch (e) {}
  }, [s.value, base]);
  return { origin: s.origin, apiBase: base };
}

module.exports = { attachSession, savedSession, CLOUD };
