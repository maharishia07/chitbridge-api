/**
 * db/connect-config.js — WHERE THE API CONNECTS, AND WITH WHAT TLS, DECIDED BY CONFIG ALONE (HX1).
 *
 * Before HX1 db/index.js guessed: TLS for any host that was not localhost, then — on a failed connect — the database password was
 * sent, TLS-unverified, to ten hard-coded Supabase pooler endpoints (docs/HOSTING-COUPLING.md, Database). Now:
 *   · the attempts are DATABASE_URL, then DB_POOLER_URL if it is set — nothing else, ever. Each attempt carries ONLY the
 *     credentials written in its own URL: DATABASE_URL's password is never copied anywhere (tests/hosting-neutral.test.cjs).
 *   · TLS: the URL's `sslmode` wins (pg reads it: disable · no-verify · require · verify-full); else PGSSLMODE; else the
 *     environment's default — a SEALED env (lib/dev-otp.js: production · uat · staging · live · prod) keeps today's
 *     "TLS on, certificate not verified" for EVERY host, any other env connects as pg does by default (no TLS). No host is guessed.
 * Pure: no pool is opened here, so the plan can be proven without a database. src/db.js reuses sslFor for its own pool.
 */
'use strict';

const { SEALED_ENVS } = require('../lib/dev-otp');           /* ONE definition of a sealed environment */
const MODES = { disable: false, 'no-verify': { rejectUnauthorized: false }, require: { rejectUnauthorized: false },
                prefer: { rejectUnauthorized: false }, 'verify-ca': {}, 'verify-full': {} };

function urlSslmode(url) { try { return new URL(url).searchParams.get('sslmode'); } catch (_) { return null; } }

/** the `ssl` option for a pool on `url` — undefined when the URL's own sslmode decides (pg parses it and it overrides `ssl`) */
function sslFor(url, env) {
  env = env || process.env;
  if (urlSslmode(url)) return undefined;
  const m = String(env.PGSSLMODE || '').trim().toLowerCase();
  if (m) { if (!(m in MODES)) throw new Error('PGSSLMODE=' + m + ' is not one of ' + Object.keys(MODES).join(' · ')); return MODES[m]; }
  if (String(env.PGSSL || '').trim().toLowerCase() === 'disable') return false;               /* src/db.js's old switch, still honoured */
  return SEALED_ENVS.includes(String(env.NODE_ENV || '').trim().toLowerCase()) ? { rejectUnauthorized: false } : false;
}

/** host:port of a URL, never its credentials — for the log */
function where(url) { try { const u = new URL(url); return u.hostname + ':' + (u.port || '5432'); } catch (_) { return '(unparseable url)'; } }

/** the connection attempts, in order: [{ label, where, config }] — config is what new pg.Pool() receives */
function connectPlan(env) {
  env = env || process.env;
  const plan = [];
  for (const [label, name] of [['DATABASE_URL', 'DATABASE_URL'], ['DB_POOLER_URL', 'DB_POOLER_URL']]) {
    const url = String(env[name] || '').trim();
    if (!url) continue;
    try { new URL(url); } catch (_) { throw new Error('Invalid ' + name); }
    const ssl = sslFor(url, env);
    plan.push({ label, where: where(url), config: ssl === undefined ? { connectionString: url } : { connectionString: url, ssl } });
  }
  if (!plan.length || plan[0].label !== 'DATABASE_URL') throw new Error('Invalid DATABASE_URL');
  return plan;
}

/** the pool size: DB_POOL_MAX (a whole number 1-100), else 10. PLT-64: a 1 GB server runs Postgres with max_connections 20, so its api asks for fewer.
 *  A value that is not a whole number in range is refused at boot, never quietly replaced. */
function poolMax(env) {
  env = env || process.env;
  const raw = String(env.DB_POOL_MAX == null ? '' : env.DB_POOL_MAX).trim();
  if (!raw) return 10;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error('Invalid DB_POOL_MAX (a whole number from 1 to 100): ' + raw);
  return n;
}

module.exports = { connectPlan, sslFor, where, poolMax };
