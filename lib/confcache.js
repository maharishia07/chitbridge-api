/**
 * lib/confcache.js — PLATFORM CONFIG, asked once and remembered for a minute.
 *
 * ⚠️⚠️ WHY THIS EXISTS. Measured 2026-08-23: `/entities/me` takes 3.2 s against a 0.5 s floor, and ~2.7 s of
 * that is round trips at ~250 ms each (Railway↔Supabase). `resolveEntityGovernance()` alone makes up to EIGHT:
 * four for the entity's own RLS stamp, then `constitution` (base), `constitution` (the entity's vertical),
 * `installation`, and `capability` — four sequential SELECTs against tables that change ~never.
 *
 * ⭐ THE TEST FOR "SAFE TO CACHE" IS NOT "IT LOOKS STATIC", IT IS "NOTHING WRITES IT". Grepped the whole API:
 * there is no INSERT, UPDATE or DELETE against `constitution`, `installation`, `capability` or
 * `platform_constitution` in any route or lib. They are written by migrations only. `entity_governance` IS
 * written (routes/entities.js registration) and is per-entity under FORCE RLS — it is deliberately NOT cached
 * here, and the four trips it costs stay.
 *
 * ⚠️ SIXTY SECONDS, NOT FOREVER, AND FOR THE REASON `lib/schema.js` LEARNED THE HARD WAY. Migrations do not
 * land at restart here — Athi runs them by hand in the Supabase editor against a running server. b178 was
 * deployed and then run, and every request in between cached the pre-migration answer. A forever-cache would
 * repeat that: run a constitution migration, and the live process serves the old envelope until someone
 * redeploys. A minute bounds it, and costs one read per key per minute.
 *
 * ⭐⭐ AND A GUARD MAY REFUSE THE CACHE. `fresh` skips the read and still writes the result. It exists because
 * the read path and the WRITE-PATH GUARD do not want the same trade: painting a profile can happily use a
 * minute-old envelope, but "may this entity price in AED?" must answer from what the constitution says NOW.
 * Governance is the one thing this product claims is absolute; a tightening that takes up to a minute to bite
 * is a weakening, and it would be invisible. Latency is bought on the read path only — see
 * `resolveEntityGovernance(id, { fresh: true })` in lib/govresolve.js.
 *
 * ⚠️ A FAILURE IS NEVER CACHED. The database being briefly unreachable is not evidence about the config. The
 * callers here already degrade to a fallback on error; caching that fallback would engage it for a full minute
 * after the database came back — turning a blink into an outage-shaped one.
 */
const TTL_MS = 60000;

const cache = new Map();          // key -> { value, exp }

/**
 * Resolve `key` from cache, else call `fn()` and remember what it returns.
 *
 * ⚠️ Only a RESOLVED value is stored. A rejection propagates to the caller untouched and leaves the cache
 * empty, so the next request asks the database again.
 */
async function memo(key, fn, ttlMs, fresh) {
  if (!fresh) {
    const hit = cache.get(key);
    if (hit && hit.exp > Date.now()) return hit.value;
  }
  const value = await fn();                       // throws → nothing is written below
  cache.set(key, { value, exp: Date.now() + (ttlMs || TTL_MS) });
  return value;
}

/** Drop everything (or one key). For tests, and for a future admin write path that must not wait a minute. */
function invalidate(key) { if (key == null) cache.clear(); else cache.delete(key); }

/** What is held right now — for the round-trip tests, which assert on trips rather than on timings. */
function size() { return cache.size; }

module.exports = { memo, invalidate, size, TTL_MS };
