/**
 * middleware/auth-first.js — WHO YOU ARE is decided before WHAT YOU SENT is read (M04, IAM §35, 2026-10-07).
 *
 * ⚠️ THE GLOBAL BODY PARSER RAN BEFORE EVERY ROUTE'S auth. So an unauthenticated POST /api/chits/send with a broken
 * body was answered 400 (malformed JSON) or 413 (too large) — the server read, and talked about, the body of a caller it
 * had not identified. Moving `auth` ahead of the validator chain inside the route (routes/chits.js) is not enough on its
 * own: the stream has already been parsed by then.
 *
 * ⭐ THE FIX, AND WHY IT CHANGES NO ALLOW/DENY OUTCOME. For the paths in AUTH_FIRST (POST only):
 *   1. the global parsers step aside (`parsers`, mounted where express.json used to be);
 *   2. after the rate limiters, `authThenParse` runs auth, THEN the same two parsers with the same limits;
 *   3. idempotency and the router follow exactly as before, and the route's own `auth` reuses the decision
 *      (middleware/auth.js DECIDED) — one token check, one revocation read per request.
 * A caller auth admits gets the same body, parsed by the same parser, before the same idempotency and route code.
 * A caller auth refuses was refused before too — the only difference is that it is now refused WITHOUT its body being
 * read, so a broken body gets 401 instead of 400/413.
 *
 * ⚠️ ONE REGEX DECIDES BOTH SIDES. The parsers skip exactly the requests authThenParse parses — the same test, from
 * the same constant — so no request can fall between them and reach a route with no body.
 *
 * Proven by tests/auth-first.test.cjs.
 */
'use strict';
const express = require('express');
const auth = require('./auth');

/* ⚠️ add a path here only together with a case in tests/auth-first.test.cjs */
const AUTH_FIRST = /^\/api\/chits\/send\/?$/i;
const isAuthFirst = (req) => req.method === 'POST' && AUTH_FIRST.test(req.path || '');

/* the same parsers, same limits, as server.js always used */
const json = express.json({ limit: '8mb' });   // raised for base64 attachment uploads
const form = express.urlencoded({ extended: true, limit: '8mb' });

/** the global parsers — every request except an auth-first one, unchanged */
const parsers = [
  (req, res, next) => (isAuthFirst(req) ? next() : json(req, res, next)),
  (req, res, next) => (isAuthFirst(req) ? next() : form(req, res, next)),
];

/** auth, then the body — for the auth-first requests only; mount after the rate limiters, before idempotency */
const authThenParse = (req, res, next) => {
  if (!isAuthFirst(req)) return next();
  return auth(req, res, (err) => {
    if (err) return next(err);
    json(req, res, (e1) => (e1 ? next(e1) : form(req, res, next)));
  });
};

module.exports = { AUTH_FIRST, isAuthFirst, parsers, authThenParse };
