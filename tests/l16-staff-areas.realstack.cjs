'use strict';
/**
 * tests/l16-staff-areas.realstack.cjs — W15-66 on a REAL Postgres through the REAL sign-in (cb_app, RLS on): staff see no books unless the owner opened the accounts for them.
 * Two modes, read from the database itself: with identities.area_grants (b868 applied) the pass tests 1-8, 10, 11, 12 run; WITHOUT it the old-schema path runs (no grants, staff closed, the owner's PATCH says "arrives after the next update" in words, 503 never 500).
 * Run: DATABASE_URL=postgres://cb_app:...@<host>:5432/<throwaway db> node tests/l16-staff-areas.realstack.cjs
 * OWNS the real-database half of middleware/books-area-gate.js, lib/areas.js and lib/actor-areas.js.   CARD  18-identity-sign-in-and-access/access-levels
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|l16sa-db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'l16_areas_realstack_secret_at_least_32_chars_padding';
const path = require('path');
const express = require('express');
const jsonWebToken = require('jsonwebtoken');
const API = path.join(__dirname, '..');
const net = require(path.join(API, 'src', 'services', 'network'));
const { query, withEntity } = require(path.join(API, 'db'));

let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 500) : '')); } };
const RUN = 'l16a' + (Date.now() % 1e10).toString(36);
const madeIdentities = [];
const code = (r) => r.body && r.body.code;
const FUTURE = '2999-12-31';
const PAST = '2000-01-01';

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'IN', 'INR', $3) RETURNING identity_id, display_name`, [bridgeId, 'L16A ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  madeIdentities.push(identity.identity_id);
  return { tag, bridgeId, id: identity.identity_id, name: identity.display_name, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
const tokenFor = (claims) => jsonWebToken.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const ownerToken = (biz) => tokenFor({ identity_id: biz.id, identity_type: 'entity', bridge_id: biz.bridgeId, display_name: biz.name });
async function person(biz, tag, level, whole, costs) {
  const { rows: [row] } = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'IN', 'INR', $4, $5, $6, $7, 'act') RETURNING identity_id, display_name`,
    [biz.bridgeId + tag, 'Person ' + tag + ' ' + RUN, biz.id, (biz.bridgeId + tag).toLowerCase(), level, whole, costs]);
  madeIdentities.push(row.identity_id);
  return { id: row.identity_id, name: row.display_name, token: tokenFor({ identity_id: row.identity_id, identity_type: 'actor', bridge_id: biz.bridgeId, display_name: row.display_name, parent_entity_id: biz.id }) };
}
let base = '';
async function call(token, method, route, body, headers) {
  const h = Object.assign({ 'content-type': 'application/json' }, headers || {});
  if (token) h.authorization = 'Bearer ' + token;
  const res = await fetch(base + route, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let parsed = null;
  try { parsed = await res.json(); } catch (_) { parsed = null; }
  if (process.env.CB_TRIPS) console.log('  trips ' + method + ' ' + route.split('?')[0].replace(/[0-9a-f-]{36}/, ':id') + ' → ' + res.headers.get('x-db-trips') + ' trips, ' + res.status);
  return { status: res.status, body: parsed };
}
const closed = (r) => r.status === 403 && code(r) === 'BOOKS_AREA_CLOSED' && /Your access does not include the books/.test(r.body.detail || '');
const KEYED = () => ({ 'idempotency-key': 'l16a-' + Math.random().toString(36).slice(2) });

async function main() {
  const hasColumn = (await query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'identities' AND column_name = 'area_grants'`)).rows.length > 0;
  console.log('  mode  ' + (hasColumn ? 'WITH identities.area_grants (b868 applied)' : 'WITHOUT identities.area_grants (old schema)'));
  const S = await business('s');
  const sam = await person(S, 'c', 'editor', false, false);
  const view = await person(S, 'v', 'viewer', false, false);
  const aud = await person(S, 'a', 'commenter', true, true);
  const mis = await person(S, 'm', 'commenter', true, false);
  const reg = await person(S, 'r', 'editor', true, true);
  const app = express();
  if (process.env.CB_TRIPS) app.use(require(path.join(API, 'lib', 'trips')).middleware()); /* CB_TRIPS=1: the answers carry X-DB-Trips and the run prints them for the two new routes (round-trips.budget.json) */
  app.use(express.json());
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books', require(path.join(API, 'routes', 'books-money.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  app.use('/api/actors', require(path.join(API, 'routes', 'actors.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    const owner = ownerToken(S);
    await withEntity(S.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, S.id, { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: true, number: '33AAAAA0000A1Z9', scheme: 'regular' }, source: { tax: 'typed' } }, S.id));
    const enabled = await call(owner, 'POST', '/api/books/enable', {});
    ok('0 the owner switches the ledger on', enabled.status === 200, JSON.stringify(enabled));
    const reads = ['/api/books/daybook', '/api/books/trial-balance', '/api/books/pl', '/api/books/bs', '/api/books/bank/log'];
    const before = {};
    for (const route of reads) before[route] = (await call(owner, 'GET', route)).status;
    ok('8a the owner reads every one of them as before (no 403)', reads.every((route) => before[route] !== 403 && before[route] !== 401), JSON.stringify(before));

    /* 1 and 2 — Counter staff and View-only are closed by default, on the real sign-in and the real database */
    for (const who of [sam, view]) {
      const out = [];
      for (const route of reads) out.push(closed(await call(who.token, 'GET', route)));
      ok('1 ' + who.name + ' opens Day book, TB, P&L, BS and Bank: the sentence, no figures', out.every(Boolean), JSON.stringify(out));
      const writes = [await call(who.token, 'POST', '/api/books/bank/marks', { account: 'x', marks: [] }), await call(who.token, 'POST', '/api/books/bank/statements', {})];
      /* a View-only person is refused by the hat gate (read-only level) before the areas gate: still 403, still nothing stored; Counter staff hear the areas sentence */
      ok('2 ' + who.name + ' posts a bank mark or statement: refused 403, nothing stored' + (who === sam ? ', in the areas sentence' : ''), writes.every((r) => (who === sam ? closed(r) : r.status === 403)), JSON.stringify(writes));
    }
    const payments = await call(sam.token, 'POST', '/api/books/payments', {}, KEYED());
    ok('1b Counter staff on a payment: refused', payments.status === 403, JSON.stringify(payments));
    const grantsList = await call(sam.token, 'GET', '/api/books-grants');
    const grantsMake = await call(sam.token, 'POST', '/api/books-grants', {});
    ok('7a Counter staff cannot use /api/books-grants (stays owner-only)', grantsList.status === 403 && grantsMake.status === 403, JSON.stringify([grantsList.status, grantsMake.status]));
    const selfGrant = await call(sam.token, 'PATCH', '/api/actors/' + sam.id + '/areas', { area: 'accounts', level: 'work' });
    ok('7 Sam cannot grant himself anything: 403 OWNER_ONLY', selfGrant.status === 403 && code(selfGrant) === 'OWNER_ONLY', JSON.stringify(selfGrant));

    /* 8 — the owner-side presets read what they read before */
    for (const [name, who] of [['Auditor', aud], ['Reports/MIS', mis], ['Regional manager', reg]]) {
      const statuses = [];
      for (const route of reads) statuses.push((await call(who.token, 'GET', route)).status);
      ok('8 ' + name + ' reads exactly what the owner reads (same statuses)', JSON.stringify(statuses) === JSON.stringify(reads.map((route) => before[route])), JSON.stringify([statuses, before]));
    }
    const regPay = await call(reg.token, 'POST', '/api/books/payments', {}, KEYED());
    ok('payments: even the Regional manager is refused (owner only)', regPay.status === 403 && code(regPay) === 'OWNER_ONLY', JSON.stringify(regPay));
    const regMark = await call(reg.token, 'POST', '/api/books/bank/marks', { account: 'x', marks: [] });
    ok('the Regional manager keeps the bank work (not the area refusal)', regMark.status !== 403, JSON.stringify(regMark));
    const entry = await call(aud.token, 'POST', '/api/books/entries', {});
    ok('the Auditor still cannot post a journal (403: a comment-only level never writes)', entry.status === 403, JSON.stringify(entry));

    const grant = (who, level, until, extra) => call(owner, 'PATCH', '/api/actors/' + who.id + '/areas', Object.assign({ area: 'accounts', level }, until === undefined ? {} : { until }, extra || {}));
    const wrongArea = await grant(sam, 'see', undefined, { area: 'stock' });
    ok('12a a grant for any area but accounts: 400 "cannot be opened for a person yet"', wrongArea.status === 400 && code(wrongArea) === 'AREA_NOT_AVAILABLE', JSON.stringify(wrongArea));
    const mineClosed = await call(sam.token, 'GET', '/api/actors/areas');
    ok('Sam reads what he holds: nothing', mineClosed.status === 200 && mineClosed.body.mine.accounts === null && mineClosed.body.people.length === 0, JSON.stringify(mineClosed));
    const listed = await call(owner, 'GET', '/api/actors/areas');
    ok('10 the owner sees the notice naming the people the books closed on', listed.status === 200 && listed.body.available === hasColumn && listed.body.notice && listed.body.notice.people.some((p) => p.identity_id === sam.id) && listed.body.notice.people.some((p) => p.identity_id === view.id) && !listed.body.notice.people.some((p) => p.identity_id === aud.id), JSON.stringify(listed.body.notice));

    if (!hasColumn) {
      const early = await grant(sam, 'see', FUTURE);
      ok('12 before the SQL is run the PATCH says "arrives after the next update", 503, no 500', early.status === 503 && code(early) === 'AREAS_NOT_MIGRATED' && /arrives after the next update/.test(early.body.detail), JSON.stringify(early));
      const still = await call(sam.token, 'GET', '/api/books/daybook');
      ok('without the column Sam stays closed (no grants) and the rest still answers', closed(still), JSON.stringify(still));
      return;
    }

    /* with the column: 3 4 5 6 and the trail */
    const open = await grant(sam, 'see', FUTURE, { reason: 'month-end help' });
    ok('3a the owner opens Accounts for Sam until a future day: 200', open.status === 200 && open.body.level === 'see' && open.body.until === FUTURE && open.body.audit.recorded === 1, JSON.stringify(open));
    const readsNow = [];
    for (const route of reads) readsNow.push((await call(sam.token, 'GET', route)).status);
    ok('3 Sam now reads the books like the owner', JSON.stringify(readsNow) === JSON.stringify(reads.map((route) => before[route])), JSON.stringify([readsNow, before]));
    const journal = await call(sam.token, 'POST', '/api/books/entries', {});
    const yearClose = await call(sam.token, 'POST', '/api/books/year/2026/close', {});
    const seeMark = await call(sam.token, 'POST', '/api/books/bank/marks', { account: 'x', marks: [] });
    ok('3 but cannot post a journal, close a year, or write the bank at see', journal.status === 403 && code(journal) === 'OWNER_ONLY' && yearClose.status === 403 && code(yearClose) === 'OWNER_ONLY' && seeMark.status === 403, JSON.stringify([journal.status, yearClose.status, seeMark.status]));
    const mineOpen = await call(sam.token, 'GET', '/api/actors/areas');
    ok('Sam reads what he holds: see until the day, from a grant', mineOpen.body.mine.accounts.level === 'see' && mineOpen.body.mine.accounts.source === 'grant' && mineOpen.body.mine.accounts.until === FUTURE, JSON.stringify(mineOpen.body.mine));
    const work = await grant(sam, 'work', FUTURE);
    const workMark = await call(sam.token, 'POST', '/api/books/bank/marks', { account: 'x', marks: [] });
    ok('4 set to work, Sam passes the bank gate (the route answers its own words, not the area refusal)', work.status === 200 && workMark.status !== 403, JSON.stringify([work.status, workMark]));
    const payAgain = await call(sam.token, 'POST', '/api/books/payments', {}, KEYED());
    ok('4b work does not include payments', payAgain.status === 403 && code(payAgain) === 'OWNER_ONLY', JSON.stringify(payAgain));
    const trail = await call(owner, 'GET', '/api/actors/access-events?subject=' + sam.id);
    const rows = (trail.body.events || []).filter((e) => e.action === 'area_changed');
    ok('4c the history shows who, when, before and after', rows.length >= 2 && rows.some((e) => e.changed_by === S.id && e.before_value && e.after_value && e.after_value.level === 'work' && e.before_value.level === 'see') && rows.some((e) => e.reason === 'month-end help'), JSON.stringify(rows.slice(0, 3)));
    /* 5 — a lapsed end day (set straight in the database: the owner's PATCH refuses a past day) */
    await withEntity(S.id, (h) => h.query(`UPDATE identities SET area_grants = jsonb_build_object('accounts', jsonb_build_object('level', 'work', 'until', $2::text)) WHERE identity_id = $1`, [sam.id, PAST]));
    const lapsed = await call(sam.token, 'GET', '/api/books/daybook');
    ok('5 after the last day with nobody acting, Sam is refused again', closed(lapsed), JSON.stringify(lapsed));
    const seen = await call(owner, 'GET', '/api/actors/areas');
    const ended = (seen.body.people || []).find((p) => p.identity_id === sam.id);
    ok('5b the owner sees the grant ended, and the lapse is on the trail once', ended && ended.ended.length === 1 && ended.access.accounts === null, JSON.stringify(ended));
    const again = await call(owner, 'GET', '/api/actors/areas');
    const lapses = ((await call(owner, 'GET', '/api/actors/access-events?subject=' + sam.id)).body.events || []).filter((e) => /^ended /.test(e.reason || ''));
    ok('5c a second read does not write the lapse twice', again.status === 200 && lapses.length === 1, JSON.stringify(lapses));
    /* 6 — View-only granted work */
    await grant(view, 'work', FUTURE);
    const viewRead = await call(view.token, 'GET', '/api/books/daybook');
    const viewWrite = await call(view.token, 'POST', '/api/books/bank/marks', { account: 'x', marks: [] });
    ok('6 View-only granted work reads, and still cannot write', viewRead.status === 200 && viewWrite.status === 403, JSON.stringify([viewRead.status, viewWrite]));
    /* the past day and the close */
    const past = await grant(sam, 'see', PAST);
    ok('an end day already past is 400 in words', past.status === 400 && code(past) === 'AREA_DATE_PAST', JSON.stringify(past));
    const shut = await grant(view, 'none');
    const viewShut = await call(view.token, 'GET', '/api/books/daybook');
    ok('closing an area takes it away at once', shut.status === 200 && shut.body.level === 'none' && closed(viewShut), JSON.stringify([shut, viewShut]));
    const stranger = await person(await business('x'), 'z', 'editor', false, false);
    const foreign = await call(owner, 'PATCH', '/api/actors/' + stranger.id + '/areas', { area: 'accounts', level: 'see' });
    ok('a person of another business is 404 and unchanged', foreign.status === 404, JSON.stringify(foreign));
    const notice = await call(owner, 'GET', '/api/actors/areas');
    ok('10 the notice no longer names the people the owner acted on (none left: null)', notice.body.notice === null || !notice.body.notice.people.some((p) => p.identity_id === sam.id || p.identity_id === view.id), JSON.stringify(notice.body.notice));
    const unknown = await call(sam.token, 'GET', '/api/books/a-new-route');
    ok('11 a route nobody classified is closed (403, not 404) to a person', unknown.status === 403, JSON.stringify(unknown));
    const nobody = await call(null, 'GET', '/api/books/daybook');
    ok('no token: 401 from the real sign-in, not the area gate', nobody.status === 401, JSON.stringify(nobody));
  } finally {
    server.close();
  }
}

async function cleanup() {
  const nodes = (await query(`SELECT e.id FROM cb_entity e JOIN identities i ON upper(i.bridge_id) = upper(e.bridge_id) WHERE i.identity_id = ANY($1::uuid[])`, [madeIdentities])).rows.map((row) => row.id);
  await query(`DELETE FROM cb_edge WHERE parent_id = ANY($1::uuid[]) OR child_id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM cb_entity WHERE id = ANY($1::uuid[])`, [nodes]);
  await query(`DELETE FROM identities WHERE identity_id = ANY($1::uuid[])`, [madeIdentities]);
}
(async () => {
  console.log('\n── W15-66 staff areas through the REAL sign-in (cb_app, RLS on) · run ' + RUN + ' ──');
  try { await main(); } catch (failure) { ok('the run reached its end', false, failure && failure.stack); } finally { await cleanup().catch((failure) => console.log('  note  the throwaway businesses stay (insert-only rows keep them): ' + String(failure.message).slice(0, 120))); }
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
