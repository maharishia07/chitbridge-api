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
