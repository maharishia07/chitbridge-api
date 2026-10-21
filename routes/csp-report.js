'use strict';
/**
 * routes/csp-report.js — WHERE THE WEB'S REPORT-ONLY CSP REPORTS TO (K-SEC PR A, SEC-68, critic C11).
 *
 * The web (vercel.json) has carried a Content-Security-Policy-Report-Only header with nowhere to report, so nobody has ever
 * seen a violation and there is no evidence that enforcing it is safe. This is that somewhere: the browser POSTs a report,
 * we write ONE trimmed log line (lib/logger, level warn: "csp violation") and answer 204. No table, no read-back route.
 *
 * WHO MAY CALL IT: anyone — a browser sends a CSP report with no credential, so this door cannot ask for one. It is kept
 * small on purpose: a strict limiter of its own (REPORTS_PER_MIN per address), an 8 KB body cap, only the two report media
 * types parsed, and only short, shaped fields logged (the directive, the blocked origin, the page's path) — never the body,
 * a query string or a script sample, so the log cannot be used to store or replay what a stranger sends.
 *
 *   POST /api/csp-report   application/csp-report (report-uri) · application/reports+json (report-to)  → 204
 *
 * OWNS the report door · CALLED BY browsers loading the web (vercel.json report-uri / Reporting-Endpoints) · FLOW: platform ·
 * SEC-68 CSP evidence. Enforcement stays a later Vercel deploy, after a pass with zero violations (SECURITY-BACKLOG.md).
 * CARD 28-platform-and-operations/limits-idempotency-rate-limits
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const log = require('../lib/logger');

const router = express.Router();
const REPORTS_PER_MIN = 30;
const MAX_FIELD = 120;
const TYPES = ['application/csp-report', 'application/reports+json', 'application/json'];

const reportLimiter = rateLimit({ windowMs: 60 * 1000, max: REPORTS_PER_MIN, standardHeaders: true, legacyHeaders: false });

const MAX_REPORTS = 20; /* a Reporting API batch holds a handful; anything longer is not a browser */
/* each field under every name a browser uses for it: report-uri (kebab-case) first, then the Reporting API (camelCase) */
const NAMES = {
  directive: ['effective-directive', 'effectiveDirective', 'violated-directive', 'violatedDirective'],
  blocked: ['blocked-uri', 'blockedURL', 'blockedUri'],
  page: ['document-uri', 'documentURL', 'documentUri']
};

/** oneLine(value) → a plain one-line string of at most MAX_FIELD characters, or null */
function oneLine(value) {
  if (value == null) return null;
  const text = String(value).replace(/[\r\n\t]+/g, ' ').trim();
  return text ? text.slice(0, MAX_FIELD) : null;
}
/** fieldOf(report, names) → the first of those names the report carries, as one short line */
function fieldOf(report, names) {
  const found = names.find((name) => report[name] != null && report[name] !== '');
  return found ? oneLine(report[found]) : null;
}
const URL_PARTS = /^([a-z][a-z0-9+.-]*:\/\/[^/?#\s]+)([^?#\s]*)/i; /* 1 = origin · 2 = path; the query and fragment are never kept */
/** originOf(text) → the origin of a URL (no path, no query), or the keyword the browser used ('inline', 'eval', 'data'…) */
function originOf(text) {
  if (!text) return null;
  const parts = URL_PARTS.exec(text);
  if (parts) return parts[1].toLowerCase();
  return /^[a-z-]{2,20}$/i.test(text) ? text : 'other'; /* not a URL: a CSP keyword, kept only when it is a plain word */
}
/** pathOf(text) → a page's path, without its query or fragment */
function pathOf(text) {
  const parts = URL_PARTS.exec(text || '');
  return parts ? parts[2] || '/' : null;
}
/**
 * reportsOf(body) → [{ directive, blocked, page, disposition }] — both shapes in one reader: the old report-uri body
 * ({ "csp-report": { … } }) and the Reporting API list ([{ type:'csp-violation', body:{ … } }]).
 */
function reportsOf(body) {
  const list = Array.isArray(body) ? body : [body];
  return list.slice(0, MAX_REPORTS).map((item) => {
    const report = (item && (item['csp-report'] || item.body)) || {};
    return {
      directive: fieldOf(report, NAMES.directive),
      blocked: originOf(fieldOf(report, NAMES.blocked)),
      page: pathOf(fieldOf(report, NAMES.page)),
      disposition: oneLine(report.disposition)
    };
  });
}

router.post('/', reportLimiter, express.json({ type: TYPES, limit: '8kb' }), (req, res) => {
  reportsOf(req.body).forEach((item) => {
    if (item.directive || item.blocked) log.warn('csp violation', item);
  });
  res.status(204).end();
});

module.exports = router;
module.exports.reportsOf = reportsOf;
module.exports.REPORTS_PER_MIN = REPORTS_PER_MIN;
