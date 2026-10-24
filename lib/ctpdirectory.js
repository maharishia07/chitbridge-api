'use strict';
// @stage poc
// OWNS manifestFor / publicKeyFor (a peer's signed manifest, cached) · CALLED BY routes/ctp.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
// FLOW domain → wellKnown url → safe-url guard (https + public address only) → fetch → shape check → cache      CARD 01-rail-core-the-chit/ctp-outbound-guard
// @stage-note CTP step 4 (docs/CTP-DESIGN.md §5.1). Fetches and caches another installation's signed manifest
//             from its OWN domain. Nothing calls it until an installation is hosted elsewhere, which nothing is.
// @stage-why  Discovery is the piece that decides whether the rail is federated or hub-and-spoke, so it exists
//             as its own file with its own boundary rather than as a helper inside the transport.
/**
 * ── ⭐⭐⭐ NOBODY RUNS THE NAMESPACE ─────────────────────────────────────────────────────────────────────────────
 *
 * Athi first said CBINC should run the directory, then said, in the same breath:
 *
 *   *"we are thinking of creating something like SMTP? we can ride on this for cross border… that will find the
 *    other end, and when the data is reaching, we can literally check, is he the member of me."*
 *
 * The second instinct won, and the reason is positioning rather than engineering: **an installation whose
 * address book we control is not sovereign**, and sovereignty is exactly what b74 called `root_key_ref` an
 * anchor for. So, MX-style: every installation publishes its own manifest at a well-known path on its own
 * domain, and we hold a CACHE and a member registry — never the namespace.
 *
 *   https://<domain>/.well-known/ctp.json
 *
 * ⭐ AND "IS HE A MEMBER OF ME" STILL HAPPENS. Discovery being open does not make delivery open: the manifest
 * says who an installation IS, and routes/ctp.js still decides whether it is anybody we deal with.
 *
 * ── ⚠️⚠️ THE MANIFEST IS A CLAIM, NOT A FACT ────────────────────────────────────────────────────────────────────
 *
 * Anyone can publish one. It is trusted for exactly one thing: the public key that later verifies envelopes
 * signed by that installation. It is NOT trusted to tell us which populations exist here, what we accept, or who
 * we deal with — all of which are ours to decide. A directory that is believed about our own rules is a
 * directory that can rewrite them.
 *
 * ⚠️ AND A CACHED KEY IS A SECURITY DECISION, NOT A PERFORMANCE ONE. Too long and a rotated-away key keeps
 * verifying; too short and a slow domain stalls delivery. Fifteen minutes, and `invalidate()` for when an
 * operator knows better.
 */

const safeUrl = require('./safe-url'); /* SEC-80: refuse private/internal hosts before any fetch; loopback http now needs CB_CTP_ALLOW_PRIVATE=1 */
const TTL_MS = 15 * 60 * 1000;
/* RAIL-104: a FAILED read is kept only this long. At 15 minutes a peer that was down for a second looked broken for a quarter of an hour (SIT run 2, E9). */
const FAILURE_TTL_MS = 20 * 1000;
/* RAIL-104: a fresh re-read (a key that no longer verifies) is allowed at most this often per domain, so a stream of bad envelopes cannot make us dial the peer each time */
const REREAD_MIN_MS = 30 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 64 * 1024; /* a manifest is a few hundred bytes; anything larger is not one */

const cache = new Map(); /* domain -> { at, manifest, why } */

/**
 * ⚠️⚠️ HTTPS, WITH ONE BOUNDED EXCEPTION, AND IT IS NOT A CONVENIENCE.
 *
 * A manifest is fetched to learn the key that will verify a peer's envelopes. Over plain HTTP anyone on the path
 * substitutes the key and signs whatever they like — so http is refused, always, for a real domain.
 *
 * ⭐ THE EXCEPTION IS `127.0.0.1` / `localhost` ONLY, and it is safe for a reason that does not generalise: a
 * loopback address cannot be a peer. Nothing outside this machine can be reached at it, so there is no path for
 * anyone to be on. It exists so the conformance proof (docs/CTP-DESIGN.md §8.2) can run a real HTTP hop without
 * a second machine — which is the difference between testing the wiring and asserting that it probably works.
 *
 * ⚠️ It is matched on the HOST, not on a substring: `127.0.0.1.evil.com` is not loopback and must not pass.
 */
const isLoopback = (host) => /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host);

const wellKnown = (domain) => {
  const host = String(domain)
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  return (isLoopback(host) ? 'http://' : 'https://') + host + '/.well-known/ctp.json';
};

/* a failure IS cached, briefly (see the catch below), and answered in the one shape */
function cacheFailure(key, reason) {
  cache.set(key, { ok: false, at: Date.now(), why: reason });
  return { ok: false, why: reason };
}

/* a still-fresh cached answer (success or failure), or null; opts.fresh skips the cache */
function cachedAnswer(key, opts) {
  const hit = cache.get(key);
  if (!hit) return null;
  const heldFor = Date.now() - hit.at;
  const wantsFresh = !!(opts && opts.fresh) && heldFor >= REREAD_MIN_MS;
  const usable = !wantsFresh && heldFor < (hit.ok ? TTL_MS : FAILURE_TTL_MS);
  if (!usable) return null;
  return hit.ok ? hit : { ok: false, why: hit.why };
}

/* SEC-80: the one guard before any dial; null = fine to fetch */
async function refuseUnsafe(key, url) {
  const safe = await safeUrl.assertPublicHttps(url);
  return safe.ok ? null : cacheFailure(key, safe.why);
}

/**
 * Read an installation's manifest.
 * @returns {Promise<{ok:boolean, why:string, manifest?:object}>}  ⚠️ never throws
 */
async function manifestFor(domain, opts) {
  const key = String(domain || '').toLowerCase();
  if (!key) return { ok: false, why: 'no domain' };

  const cached = cachedAnswer(key, opts);
  if (cached) return cached;

  const url = wellKnown(key);
  const refused = await refuseUnsafe(key, url);
  if (refused) return refused;
  try {
    /* ⚠️ a timeout, always. A domain that accepts a connection and never answers would otherwise hold a
       delivery open for as long as the far end feels like — which is a denial of service we invited. */
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { signal: ctl.signal, redirect: 'error' });
    } finally {
      clearTimeout(t);
    }

    if (!res.ok) {
      return cacheFailure(key, 'manifest at ' + url + ' answered ' + res.status);
    }
    const text = (await res.text()).slice(0, MAX_BYTES + 1);
    if (text.length > MAX_BYTES) {
      return cacheFailure(key, 'manifest is too large to be one');
    }
    let m;
    try {
      m = JSON.parse(text);
    } catch (_) {
      return cacheFailure(key, 'manifest is not JSON');
    }
    /* the shape we will actually rely on — refuse early rather than at verification time */
    if (m.ctp !== '1' || !m.installation_key || !m.public_key) {
      return cacheFailure(key, 'manifest is missing ctp/installation_key/public_key');
    }
    const out = { ok: true, at: Date.now(), manifest: m, why: 'fetched' };
    cache.set(key, out);
    return { ok: true, manifest: m, why: 'fetched' };
  } catch (e) {
    /* ⚠️ a failure IS cached, briefly, or a dead domain is re-dialled on every single delivery attempt. It is
       cached as a failure, never as "no key", so nothing reads it as permission. */
    const out = { ok: false, at: Date.now(), why: 'could not reach ' + url + ': ' + (e.name || e.message) };
    cache.set(key, out);
    return { ok: false, why: out.why };
  }
}

/**
 * The public key to verify envelopes claiming to come from `installation_key` at `domain`.
 * ⚠️ BOTH must match. A manifest that answers for a different installation than the envelope claims is either a
 * misconfiguration or somebody trying it on, and the two are indistinguishable from here.
 */
async function publicKeyFor(domain, installation_key, opts) {
  const r = await manifestFor(domain, opts);
  if (!r.ok) return { ok: false, why: r.why };
  if (String(r.manifest.installation_key) !== String(installation_key)) {
    return { ok: false, why: 'the manifest at ' + domain + ' is for ' + r.manifest.installation_key + ', not ' + installation_key };
  }
  return { ok: true, public_key: r.manifest.public_key, manifest: r.manifest };
}

function invalidate(domain) {
  if (!domain) {
    cache.clear();
    return;
  }
  cache.delete(String(domain).toLowerCase());
}

module.exports = { manifestFor, publicKeyFor, invalidate, wellKnown, TTL_MS, FAILURE_TTL_MS, REREAD_MIN_MS };
