// FLOW      request or PUBLIC_API_BASE / PUBLIC_WEB_BASE env → trimmed base → callers build absolute links (relative when webBase is empty)
// OWNS      where this installation is reached from outside, from config: apiBase(req) and webBase()
// CALLED BY lib/catalogue-blueprint.js, routes/connectors.js, routes/health.js, routes/integrations.js
// CARD      28-platform-and-operations/api-standard
/**
 * lib/public-base.js — WHERE THIS INSTALLATION IS REACHED FROM OUTSIDE, FROM CONFIG (HX1). Never a platform's host name in code
 * (docs/HOSTING-COUPLING.md; tests/hosting-neutral.test.cjs fails on a new *.railway.app / *.vercel.app literal).
 *   apiBase(req) — PUBLIC_API_BASE (the one allow-listed origin), else, only for a loopback Host (a developer's own machine), that address; else '' (callers then use a RELATIVE path).
 *                SEC-114 (OWASP host-header injection, WSTG-INPV-17; ASVS 14.5.3): the Host header is the caller's to forge, so it never names a link, a redirect or a connector kit's api address — only config does.
 *   webBase()    — PUBLIC_WEB_BASE (the site people open, e.g. https://app.example.com), else '' — callers then use a RELATIVE path
 * routes/openapi.js and routes/products.js (PUBLIC_API_URL) still read their own env inline — the same rule, not yet moved here.
 */
'use strict';
const trim = (s) =>
  String(s || '')
    .trim()
    .replace(/\/+$/, '');
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
function apiBase(req) {
  const configured = trim(process.env.PUBLIC_API_BASE);
  if (configured) return configured;
  const host = req && typeof req.get === 'function' ? String(req.get('host') || '') : '';
  return LOOPBACK.test(host) ? 'http://' + host : ''; /* http: a loopback address has no certificate; the scheme is never taken from X-Forwarded-Proto here */
}
function webBase() {
  return trim(process.env.PUBLIC_WEB_BASE);
}
module.exports = { apiBase, webBase };
