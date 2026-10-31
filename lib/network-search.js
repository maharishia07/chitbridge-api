'use strict';
/*
 * OWNS      "find a business or a product" across installations (NET-39): Here (this installation) and There (one other installation, or every one we
 *           deal with), in ONE result shape. Both run lib/business-search.find; There asks it over the signed `search` question (lib/ctpquery).
 * CALLED BY routes/entities.js GET /entities/search (?where=) and GET /entities/search/places
 * FLOW      where → places (active remote installations) → [here: exact handle/bridge id, then find()] [there: ctpquery.ask search, one installation at a time, 5 s each]
 *           → results[] + answers[] (who answered, who did not, in words)
 * CARD      04-network/directory-and-search
 */
/**
 * ⚠️ Adding a supplier from a result is NOT here: the result carries `address` (ctpaddress.format, never a join), and the existing
 * POST /relationships/suppliers { supplier_bridge_id: address } → remote-party.adopt does the add. No second add path.
 * ⚠️ A far answer is trimmed to the public fields again on arrival (rowOf): what we show is what a visitor there could see, whatever the peer sent.
 */
const { query: defaultQuery } = require('../db');
const businessSearch = require('./business-search');
const addressBook = require('./ctpaddress');
const log = require('./logger');

const ASK_TIMEOUT_MS = 5000;
const HERE = 'here';
const ALL = 'all';
const HITS_SHOWN = 6;

/** the installations we may ask: remote and ACTIVE (a suspended or retired one drops out, by design); each with a name a person can pick */
async function places() {
  const remote = await addressBook.remoteInstallations();
  const found = [];
  for (const [key, row] of remote) {
    if (row && row.active) found.push({ installation_key: key, domain: row.domain || null, label: row.label || row.domain || key });
  }
  return found.sort((left, right) => left.label.localeCompare(right.label));
}

/** where → { here, targets } | { error } : 'here' (default), 'all', or one installation_key */
async function resolveWhere(where) {
  const wanted = String(where || HERE).trim() || HERE;
  if (wanted === HERE) return { here: true, targets: [] };
  const active = await places();
  if (wanted === ALL) return { here: true, targets: active };
  const chosen = active.find((place) => place.installation_key === wanted);
  /* the register's sentence (SEARCH_PLACE_UNKNOWN), never the asked value: a query parameter echoed into detail reaches pages that render it as HTML (cb-api 31 Oct) */
  if (!chosen) return { error: 'We do not deal with that installation, so there is nothing to search there.' };
  return { here: false, targets: [chosen] };
}

/** a hit as the public view shows it, whatever else the sender attached */
const hitOf = (matched) => ({ name: String(matched.name || ''), unit: String(matched.unit || ''), price: matched.price == null ? null : matched.price, currency: matched.currency || null });

const hitsOf = (source) => (Array.isArray(source.hits) ? source.hits.slice(0, HITS_SHOWN).map(hitOf) : []);

/** the ONE row shape, Here and There: public fields, plus where it lives and the address that adds it */
function rowOf(source, place) {
  return {
    bridge_id: String(source.bridge_id),
    display_name: String(source.display_name || source.bridge_id),
    user_id: source.user_id ? String(source.user_id) : null,
    kind: source.kind === 'product' ? 'product' : 'business',
    hits: hitsOf(source),
    /* ⚠️ built by ctpaddress.format, never joined here; a business on THIS installation has no domain of ours to assert */
    address: addressBook.format(source.bridge_id, place.domain),
    installation_key: place.installation_key,
    domain: place.domain,
    where: place.label
  };
}

/** an exact handle or bridge id still resolves (a person who knows the address finds the business); a private shop only by its whole handle */
async function exactHere(text, asker, runQuery) {
  const read = await runQuery(
    `SELECT bridge_id, display_name, user_id FROM identities
      WHERE (LOWER(user_id) = LOWER($1) OR bridge_id = UPPER($1))
        AND identity_type = 'entity' AND status = 'active' AND COALESCE(sealed, false) = false
        AND COALESCE(user_id, '') NOT LIKE '~%' AND identity_id <> $2
        AND (COALESCE(entity_visibility, 'public') NOT IN ('internal', 'private')
             OR (COALESCE(entity_visibility, 'public') = 'private' AND LOWER(user_id) = LOWER($1)))
      LIMIT 5`,
    [text, asker.identity_id]
  );
  return read.rows;
}

/** the place "Here" is: no domain of ours to assert, our own installation key */
const herePlace = (deps) => ({ installation_key: deps.ownKey || process.env.INSTALLATION_KEY || null, domain: null, label: 'Here' });

/** each business once (the exact match was listed first and keeps its place), and never the asker itself */
function firstOfEach(sources, askerBridgeId) {
  const seen = new Set([askerBridgeId]);
  return sources.filter((source) => !seen.has(source.bridge_id) && seen.add(source.bridge_id));
}

/** Here: the exact match first, then the listed shops by name (or by product), never the asker itself */
async function searchHere(args, asker, wired) {
  const deps = wired || {};
  const found = await (deps.find || businessSearch.find)({ q: args.q, kind: args.kind, limit: args.limit }, deps);
  if (!found.ok) return found;
  const exact = args.kind === 'product' ? [] : await exactHere(String(args.q).trim(), asker, deps.query || defaultQuery);
  const sources = exact.map((row) => Object.assign({ kind: 'business' }, row)).concat(found.results);
  const rows = firstOfEach(sources, asker.bridge_id).map((source) => rowOf(source, herePlace(deps)));
  return { ok: true, results: rows.slice(0, Math.max(args.limit || 10, exact.length)), searched: found.searched };
}

/** a far installation's refusal or silence, in the words a shopkeeper reads */
function wordsFor(place, reply) {
  const reason = String((reply && reply.why) || 'no answer');
  if (/timed out/i.test(reason)) return place.label + ' did not answer in ' + ASK_TIMEOUT_MS / 1000 + ' seconds.';
  return place.label + ' could not be searched: ' + reason;
}

const failedAnswer = (place, reason) => ({ answer: { installation_key: place.installation_key, ok: false, why: reason }, rows: [] });

/** the rows a far installation sent, each trimmed to the public shape */
const rowsFrom = (reply, place) => (Array.isArray(reply.results) ? reply.results : []).filter((row) => row && row.bridge_id).map((row) => rowOf(row, place));

/** the signed question to one installation; a thrown failure is an answer that says so */
async function askFar(place, args, deps) {
  try {
    return await (deps.ask || require('./ctpquery').ask)({ domain: place.domain }, { want: 'search', q: args.q, kind: args.kind, limit: args.limit }, { timeout: ASK_TIMEOUT_MS });
  } catch (failure) {
    log.fellBack('network-search: a far installation could not be asked — said in words, the others still answer', failure);
    return { ok: false, why: 'could not be asked' };
  }
}

/** one installation, one signed question; a failure is an answer row, never an exception */
async function searchThere(place, args, wired) {
  if (!place.domain) return failedAnswer(place, place.label + ' has no address here, so it cannot be asked.');
  const reply = await askFar(place, args, wired || {});
  if (!reply || !reply.ok) return failedAnswer(place, wordsFor(place, reply));
  const rows = rowsFrom(reply, place);
  return { answer: { installation_key: place.installation_key, ok: true, why: rows.length ? null : place.label + ' has no listed match.' }, rows };
}

/** the whole question: Here and/or There, one installation after another (a burst of parallel asks strained the VMs) */
async function search(args, asker, where, wired) {
  const scope = await resolveWhere(where);
  if (scope.error) return { ok: false, code: 'SEARCH_PLACE_UNKNOWN', why: scope.error };
  const results = [];
  const answers = [];
  if (scope.here) {
    const local = await searchHere(args, asker, wired);
    if (!local.ok) return local;
    results.push(...local.results);
  }
  for (const place of scope.targets) {
    const farSide = await searchThere(place, args, wired);
    answers.push(farSide.answer);
    results.push(...farSide.rows);
  }
  return { ok: true, results, answers, count: results.length };
}

module.exports = { search, places, searchHere, searchThere, resolveWhere, rowOf, ASK_TIMEOUT_MS, HERE, ALL };
