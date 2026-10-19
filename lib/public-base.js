/**
 * lib/public-base.js — WHERE THIS INSTALLATION IS REACHED FROM OUTSIDE, FROM CONFIG (HX1). Never a platform's host name in code
 * (docs/HOSTING-COUPLING.md; tests/hosting-neutral.test.cjs fails on a new *.railway.app / *.vercel.app literal).
 *   apiBase(req) — PUBLIC_API_BASE, else the address the request came in on (correct behind a proxy when `trust proxy` matches)
 *   webBase()    — PUBLIC_WEB_BASE (the site people open, e.g. https://app.example.com), else '' — callers then use a RELATIVE path
 * routes/openapi.js and routes/products.js (PUBLIC_API_URL) still read their own env inline — the same rule, not yet moved here.
 */
'use strict';
const trim = (s) =>
  String(s || '')
    .trim()
    .replace(/\/+$/, '');
function apiBase(req) {
  return trim(process.env.PUBLIC_API_BASE) || (req ? req.protocol + '://' + req.get('host') : '');
}
function webBase() {
  return trim(process.env.PUBLIC_WEB_BASE);
}
module.exports = { apiBase, webBase };
