'use strict';
/**
 * cors-headers.test.cjs — EVERY HEADER THE CLIENT SENDS IS ONE THE SERVER ALLOWS.
 *
 * Athi, 2026-08-22, testing the product lifecycle with someone: *"I couldn't create or sign in a store, and it
 * says Sign-in failed: You're offline — this needs a connection."* He was online, and the API was up.
 *
 * ⚠️⚠️ THE WHOLE APP WAS DOWN IN THE BROWSER AND THE ONLY SYMPTOM WAS THE WORD "OFFLINE". `X-Request-Id` had
 * been added to core.js hours earlier for log correlation; it is not a CORS-safelisted header, so it turned
 * every request — GETs included — into a preflighted one, and the preflight was refused because server.js did
 * not list it. A refused preflight fails `fetch()` with a bare TypeError carrying no reason, and the offline
 * layer cannot tell that apart from a dead network. Correct handling of an unknowable error, reporting a cause
 * that was not true.
 *
 * ⭐⭐ THE BUG CLASS IS THE COUPLING: adding a header in the WEB repo silently changes what the API repo must
 * allow, and nothing connected the two. Two repos, one contract, no link — so the only thing that could catch
 * it was a person using the product. That is the most expensive detector available, and Athi was it.
 *
 * ⚠️ This test reads the web repo from a sibling path. When that checkout is absent (CI on the API alone), it
 * SKIPS rather than fails — a cross-repo test that breaks a single-repo build gets deleted, and then it guards
 * nothing.
 */
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..');
const WEB = path.join(API, '..', 'chitbridge-web');
const CORE = path.join(WEB, 'public', 'app', 'core.js');

let pass = 0;
const fails = [];

const server = fs.readFileSync(path.join(API, 'server.js'), 'utf8');
const m = server.match(/allowedHeaders:\s*\[([^\]]*)\]/);
if (!m) { console.error('  x could not find allowedHeaders in server.js'); process.exit(1); }
const allowed = new Set([...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => (x[1] || x[2]).toLowerCase()));

/** The headers a browser sends without a preflight. Anything outside this set MUST be declared server-side. */
const SAFELISTED = new Set(['accept', 'accept-language', 'content-language', 'content-type', 'range']);

if (!fs.existsSync(CORE)) {
  console.log('\n── cors headers ──\n  skipped: ../chitbridge-web not checked out\n');
  process.exit(0);
}

const core = fs.readFileSync(CORE, 'utf8');

/**
 * Every literal header key in a fetch headers object. Deliberately broad — a false positive costs one line in
 * server.js, and a false negative costs the whole application.
 */
const sent = new Set();
for (const h of core.matchAll(/["']([A-Za-z][A-Za-z0-9-]{2,})["']\s*:\s*(?!\s*\{)/g)) {
  const k = h[1].toLowerCase();
  if (/^(x-|authorization$|idempotency)/.test(k)) sent.add(k);
}

console.log('\n── every header core.js sends is allowed by server.js ──');
console.log('  client sends: ' + [...sent].sort().join(', '));
console.log('  server allows: ' + [...allowed].sort().join(', '));

for (const h of sent) {
  if (SAFELISTED.has(h)) { pass++; continue; }
  if (allowed.has(h)) { pass++; continue; }
  fails.push(`core.js sends "${h}" and server.js does not allow it — every request will fail preflight, ` +
    'and the app will report "You\'re offline" on a working connection');
}

fails.forEach((f) => console.error('  x ' + f));
if (!fails.length) console.log(`  OK — ${pass} header(s) declared on both sides\n`);
process.exit(fails.length ? 1 : 0);
