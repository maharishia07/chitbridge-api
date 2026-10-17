'use strict';
/**
 * routes/sandbox.js — the accounting-platform sandbox trial's three doors, LOCAL STACK ONLY (Athi, 2026-10-17).
 * OWNS      GET /api/sandbox (one Connect per vendor, connected / not) · GET /api/sandbox/:vendor/connect (to the vendor's consent, least scopes)
 *           · GET /api/sandbox/:vendor/callback (the code → the token file, outside every repo)
 * CALLED BY server.js through mount(app) — which mounts NOTHING unless the environment is not sealed AND is a local stack
 *           (lib/dev-otp isSealed + isLocalStack: NODE_ENV once read " development" in production, so "not sealed" alone is not enough)
 * WHO MAY CALL  whoever reaches this machine's api (the local stack listens on 127.0.0.1); no shop data is read or written — 0 DB trips.
 * FLOW      page → connect (state kept 10 minutes) → vendor consent → callback (state checked) → lib/sandbox-oauth exchange → page says connected
 * CARD      23-connectors-and-integrations/xero-quickbooks-myob · docs/23-connectors-and-integrations/SANDBOX-TRIAL-REQUIREMENT.md
 */
const crypto = require('crypto');
const express = require('express');
const devOtp = require('../lib/dev-otp');
const oauth = require('../lib/sandbox-oauth');
const log = require('../lib/logger');

const STATE_TTL_MS = 10 * 60 * 1000;
const states = new Map();   /* state → { vendor, at }; one process, one person, a consent at a time */
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeHtml = (text) => String(text == null ? '' : text).replace(/[&<>"]/g, (char) => HTML_ESCAPES[char]);

/** may these doors exist here? Both tests, never one */
const mayMount = () => !devOtp.isSealed() && devOtp.isLocalStack();

function newState(vendor) {
  const now = Date.now();
  for (const [state, held] of states) if (now - held.at > STATE_TTL_MS) states.delete(state);
  const state = crypto.randomBytes(16).toString('hex');
  states.set(state, { vendor, at: now });
  return state;
}
/** a callback's state: ours, for this vendor, not stale — used once */
function takeState(given, vendor) {
  const held = states.get(String(given || ''));
  states.delete(String(given || ''));
  return !!held && held.vendor === vendor && Date.now() - held.at <= STATE_TTL_MS;
}

/** one vendor's row: name · connected or not · the button, greyed with its reason when the keys are missing */
function rowHTML(vendorStatus) {
  const ready = !vendorStatus.missing.length;
  const when = vendorStatus.saved_at ? ' · ' + escapeHtml(vendorStatus.saved_at.slice(0, 16).replace('T', ' ')) : '';
  const label = vendorStatus.connected ? 'Connected' + when : 'Not connected';
  const button = ready ? '<a class="b" href="/api/sandbox/' + vendorStatus.vendor + '/connect">' + (vendorStatus.connected ? 'Connect again' : 'Connect') + '</a>'
    : '<span class="b off" aria-disabled="true">Connect</span><small>Missing: ' + escapeHtml(vendorStatus.missing.join(', ')) + '</small>';
  return '<li><strong>' + escapeHtml(vendorStatus.name) + '</strong><span class="' + (vendorStatus.connected ? 'ok' : 'no') + '">' + label + '</span>' + button + '</li>';
}
const PAGE_STYLE = '<style>body{font:16px system-ui,sans-serif;margin:0 auto;padding:16px;max-width:560px;background:#fff;color:#1a1a1a}ul{list-style:none;padding:0}'
  + 'li{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:12px 0;border-bottom:1px solid #ddd}strong{flex:1 1 140px}.ok{color:#1b6e2e}.no{color:#555}'
  + '.b{background:#1f4fd1;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none}.off{background:#bbb;color:#333}small{flex-basis:100%;color:#555}'
  + '@media (prefers-color-scheme:dark){body{background:#121212;color:#eee}li{border-color:#333}.no,small{color:#bbb}.ok{color:#6fd08a}}</style>';
/** the page — our own words only; a vendor's text never reaches it */
function pageHTML(note) {
  const rows = oauth.VENDOR_KEYS.map((vendor) => rowHTML(oauth.status(vendor))).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sandbox connect</title>'
    + PAGE_STYLE + '</head><body><h1>Sandbox connect</h1><p>Press Connect, then Allow. Local only.</p>'
    + (note ? '<p role="status">' + escapeHtml(note) + '</p>' : '') + '<ul>' + rows + '</ul></body></html>';
}

function vendorParam(req, res) {
  const vendor = oauth.vendorOf(req.params.vendor);
  if (!vendor) res.status(404).type('html').send(pageHTML('No such sandbox.'));
  return vendor;
}

const router = express.Router();
router.get('/', (req, res) => {
  const done = oauth.vendorOf(req.query.done);
  res.type('html').send(pageHTML(done ? oauth.VENDORS[done].name + ' is connected.' : null));
});
router.get('/:vendor/connect', (req, res) => {
  const vendor = vendorParam(req, res); if (!vendor) return;
  const gaps = oauth.missing(vendor);
  if (gaps.length) return res.status(422).type('html').send(pageHTML(oauth.VENDORS[vendor].name + ' needs its ' + gaps.join(', ') + ' in .env.sandboxes first.'));
  res.redirect(oauth.authorizeUrl(vendor, newState(vendor)));
});
router.get('/:vendor/callback', async (req, res) => {
  const vendor = vendorParam(req, res); if (!vendor) return;
  const name = oauth.VENDORS[vendor].name;
  if (req.query.error) return res.status(400).type('html').send(pageHTML(name + ' did not allow it. Press Connect to try again.'));
  if (!takeState(req.query.state, vendor)) return res.status(400).type('html').send(pageHTML('That link is old. Press Connect again.'));
  try {
    await oauth.exchange(vendor, req.query.code, vendor === 'qbo' && req.query.realmId ? { realm_id: String(req.query.realmId) } : null);
    res.redirect('/api/sandbox?done=' + vendor);
  } catch (e) {
    log.warn('sandbox callback: the token exchange failed', { vendor, code: e.code || null });
    res.status(502).type('html').send(pageHTML(name + ' did not give a key. Press Connect again.'));
  }
});

/** server.js calls this ONCE; true when the doors were mounted. Keys come from .env.sandboxes, read here and only here. */
function mount(app) {
  if (!mayMount()) return false;
  oauth.loadKeys();
  app.use('/api/sandbox', router);
  return true;
}

module.exports = { mount, mayMount, router, pageHTML };
