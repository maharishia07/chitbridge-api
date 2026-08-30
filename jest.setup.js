// jest.setup.js (A3) — environment for the DB-backed jest suites. Loaded by jest (setupFiles) BEFORE each test
// file requires src/app / src/db, so these env vars are in effect when the pool + routers initialise.
// The suites need a reachable Postgres via DATABASE_URL (CI provides one; locally export your own test DB).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-32-characters-long-xx';
// The cb_* network/catalogue suites exercise WRITE routes, which are gated off by default (gateWrite). Tests run
// with writes enabled — this is the dev/test config, not prod.
process.env.NETWORK_WRITE_ENABLED = 'true';
// Local/CI Postgres has no SSL; src/db honours PGSSL=disable.
process.env.PGSSL = process.env.PGSSL || 'disable';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

/**
 * ⚠️⚠️ THESE SUITES TRUNCATE TABLES, AND NOTHING STOPPED THEM POINTING AT PRODUCTION.
 * catalogue.spec.js opens with
 *     truncate cb_catalogue_item, cb_catalogue_category, cb_entity restart identity cascade
 * against whatever DATABASE_URL happens to say.
 *
 * ⚠️ TODAY IT IS SAFE BY ACCIDENT. Neither this file nor src/db.js loads dotenv, so under jest
 * DATABASE_URL is simply undefined and the connection fails. That safety is ONE
 * `require('dotenv').config()` away from being untrue — and the obvious way for someone to "make the
 * tests work locally" is to add exactly that line, at which point a truncate runs against the
 * production Supabase URL sitting in .env.
 *
 * ⭐ So the rule is explicit now rather than incidental: a destructive suite runs against a LOCAL
 * database, or it does not run. CI's postgres://postgres:postgres@localhost:5432/cb_test passes.
 * Someone who genuinely means to point at a remote test database sets CB_ALLOW_REMOTE_TEST_DB=1 and
 * owns that decision.
 */
const _dbUrl = process.env.DATABASE_URL || '';
const _isLocal = /@(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal|postgres|db)(:\d+)?\//.test(_dbUrl);
if (_dbUrl && !_isLocal && process.env.CB_ALLOW_REMOTE_TEST_DB !== '1') {
  throw new Error(
    'Refusing to run the jest suites: they TRUNCATE cb_* tables and DATABASE_URL is not a local host.\n' +
    'Point DATABASE_URL at a local test database, or set CB_ALLOW_REMOTE_TEST_DB=1 if you truly mean it.'
  );
}
