'use strict';
const { shopToday, shopDayAt } = require('./lib/shop-day.cjs'); /* the shop's own day, never the UTC day (tzsweep) */
/**
 * tests/bank-split-card.realstack.cjs — BB-04 on a REAL Postgres as cb_app (RLS on), through the real routes (routes/books.js, routes/books-grants.js) and the real grant front: a card settlement that arrived net
 * of the acquirer's fee posts as ONE contra with a fee through POST /api/books/events, for the owner and for an adviser who may post; the auditor and an adviser who may not are refused. Only the sign-in is a stand-in
 * (a header names who calls, as tests/adviser-bank.realstack.cjs, whose harness this follows). Run it on a SIT box's throwaway database only (the guard below refuses anything else).
 * HAND-COMPUTED  AU shop (GST regular, AUD): two settlements. A: 12 Oct style line, bank 2,640.00 for 2,700.00 of card sales, no GST answer: Dr Bank 264000 · Dr 6090 6000 · Cr Card 270000.
 *   B: the same with "GST on the fee": fee 54.55 net + 545 tax: Dr Bank 264000 · Dr 6090 5455 · Dr 2210 545 · Cr Card 270000.
 *   BB04-1 A and B post (200), every stored line in AUD, Dr = Cr per entry, Cr card is the gross card sales (270000) in each.   BB04-2 the ledger is re-read through GET /ledger: bank closing 528000 is the statement's two lines carried (264000 + 264000), difference 0 (BRS 0); card clearing 540000 Cr.
 *   BB04-3 a duplicate press (same client_ref) answers the first entry, duplicate:true, one entry.   BB04-4 the owner locks the month: the line is refused with the ledger's own words (period locked), nothing posted.
 *   BB04-5 access: the owner and an adviser with adviser_posts post (the adviser's entry stamped with the grant and the firm); the auditor (GRANT_READ_ONLY), an adviser whose grant is owner_approves (ADVISER_POSTING_NOT_ALLOWED) are refused, nothing posted.
 * Run: DATABASE_URL=postgres://cb_app:...@<db host>/<throwaway db> node tests/bank-split-card.realstack.cjs
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'banksplit_test_secret_at_least_32_chars_pad';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const API = path.join(__dirname, '..');

const authPath = require.resolve(path.join(API, 'middleware', 'auth.js'));
const { query, withEntity } = require(path.join(API, 'db'));
const fakeAuth = async (req, res, next) => {
  if (req.identity) return next();
  let who;
  try { who = JSON.parse(String(req.headers['x-test-as'] || '')); } catch (_) { return res.status(401).json({ error: 'no test identity' }); }
  if (who.identity_type === 'actor' && /^[0-9a-f-]{36}$/i.test(String(who.identity_id))) {
    const row = (await query('SELECT break_status, access_level, whole_entity, can_see_costs FROM identities WHERE identity_id = $1', [who.identity_id])).rows[0];
    if (!row || ['removed', 'deactivated'].includes(row.break_status)) return res.status(401).json({ code: 'ACCESS_REVOKED' });
    Object.assign(who, { access_level: row.access_level, whole_entity: row.whole_entity === true, can_see_costs: row.can_see_costs === true });
  }
  req.identity = who;
  return next();
};
fakeAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const net = require(path.join(API, 'src', 'services', 'network'));
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 700) : '')); } };
const RUN = 'bs' + (Date.now() % 1e10).toString(36).padStart(6, '0');
const code = (r) => r.body && r.body.code;

async function business(tag) {
  const bridgeId = 'CB' + RUN + tag;
  const { rows: [identity] } = await query("INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code, user_id) VALUES ($1, $2, 'entity', 'AU', 'AUD', $3) RETURNING identity_id, display_name", [bridgeId, 'Card split ' + tag + ' ' + RUN, bridgeId.toLowerCase()]);
  return { tag, bridgeId, id: identity.identity_id, name: identity.display_name, node: await net.nodeOf(identity.identity_id, { ensure: true }) };
}
async function join(parent, member) {
  const asked = await net.requestConnect({ parentId: parent.node.id, childId: member.node.id }, parent.node);
  await net.approve({ edgeId: asked.id }, member.node);
}
const ownerOf = (biz) => ({ identity_id: biz.id, bridge_id: biz.bridgeId, identity_type: 'entity', parent_entity_id: null, display_name: biz.name });
async function person(biz, tag, level) {
  const { rows: [row] } = await query("INSERT INTO identities (bridge_id, display_name, identity_type, parent_entity_id, country, currency_code, user_id, access_level, whole_entity, can_see_costs, hat) VALUES ($1, $2, 'actor', $3, 'AU', 'AUD', $4, $5, true, true, 'act') RETURNING identity_id, display_name", [biz.bridgeId + tag, 'Person ' + tag + ' ' + RUN, biz.id, (biz.bridgeId + tag).toLowerCase(), level]);
  return { identity_id: row.identity_id, identity_type: 'actor', parent_entity_id: biz.id, bridge_id: biz.bridgeId, display_name: row.display_name };
}
let base = '';
async function call(who, method, route, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json', 'x-test-as': JSON.stringify(who), 'idempotency-key': 'bs-' + crypto.randomUUID() };
  if (o.member) headers['x-books-for'] = o.member;
  if (o.role) headers['x-books-role'] = o.role;
  const res = await fetch(base + route, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}
const give = (P, M, extra) => call(ownerOf(M), 'POST', '/api/books-grants', { body: Object.assign({ grantee: P.id, purpose: 'bank reconciliation', consent: true }, extra) });
const adv = (who, M, method, route, body) => call(who, method, '/api/books' + route, { member: M.id, role: 'adviser', body });
const day = shopToday();
const FP = (RUN.replace(/[^0-9a-f]/g, 'a') + 'a'.repeat(24)).slice(0, 24);
const ref = (n) => 'bank:' + FP + '-' + n;
/** the card settlement as the Bank sheet's adapter sends it (cap-bank-post.js bodyOf): contra, amount the bank figure, fee the NET of its tax, fee_tax_minor the tax inside */
const settle = (n, extra) => Object.assign({ kind: 'contra', from: 'card', to: 'bank', date: day, amount: 2640, narration: 'EFTPOS SETTLEMENT', fee: 60, client_ref: ref(n) }, extra);
const stored = (M, like) => withEntity(M.id, (h) => h.query(
  `SELECT e.entry_id, e.source_ref, e.grant_id, e.by_firm, a.code, a.name, l.dr_minor::bigint AS dr, l.cr_minor::bigint AS cr, l.currency
     FROM journal_entry e JOIN journal_line l ON l.entry_id = e.entry_id AND l.entity_id = e.entity_id JOIN ledger_account a ON a.account_id = l.account_id AND a.entity_id = l.entity_id
    WHERE e.entity_id = $1 AND e.source_ref LIKE $2 ORDER BY e.entry_no, l.line_no`, [M.id, like])).then((r) => r.rows.map((x) => Object.assign(x, { dr: Number(x.dr), cr: Number(x.cr) })));
const sum = (rows, k) => rows.reduce((t, r) => t + r[k], 0);

async function ledgerOn(M) {
  await withEntity(M.id, (h) => require(path.join(API, 'lib', 'country-setup.js')).save(h, M.id, { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: true, number: '51824753556', scheme: 'regular' }, source: { tax: 'typed' } }, M.id));
  const on = await call(ownerOf(M), 'POST', '/api/books/enable', { body: {} });
  ok('the ledger of ' + M.tag + ' is on', on.status === 200, JSON.stringify(on));
}
const bankCodeOf = async (M) => { const a = (await call(ownerOf(M), 'GET', '/api/books/accounts')).body; const l = a.accounts || a.rows || a; return (l.find((x) => x.role === 'bank') || {}).code; };

async function main() {
  const P = await business('p'); const M1 = await business('1'); const M2 = await business('2');
  for (const M of [M1, M2]) await join(P, M);
  const A = await person(P, 'a', 'editor'); const U = await person(P, 'u', 'commenter');
  const app = express();
  app.use(express.json());
  app.use('/api/books', require(path.join(API, 'routes', 'books.js')));
  app.use('/api/books-grants', require(path.join(API, 'routes', 'books-grants.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const M of [M1, M2]) await ledgerOn(M);
    const bank = await bankCodeOf(M1);
    const g1 = await give(P, M1, { preset: 'adviser', posting: 'adviser_posts' });
    const g1a = await give(P, M1, { preset: 'auditor' });
    const g2 = await give(P, M2, { preset: 'adviser', posting: 'owner_approves' });
    ok('grants given: M1 adviser_posts + auditor, M2 owner_approves', [g1, g1a, g2].every((g) => g.status === 201), JSON.stringify([g1, g1a, g2].map((g) => g.status + ' ' + (g.body.code || ''))));
    ok('a bank ledger exists', !!bank, bank);

    /* BB04-1: the owner posts A (no GST answer) and B (GST on the fee) */
    const own = (b) => call(ownerOf(M1), 'POST', '/api/books/events', { body: b });
    const a = await own(settle(1));
    const b = await own(settle(2, { fee: 54.55, fee_tax_minor: 545, fee_currency: 'AUD' }));
    ok('BB04-1 A (fee 60.00, no GST answer) and B (fee 54.55 + 545 tax) post: 200 each', a.status === 200 && a.body.ok && b.status === 200 && b.body.ok, JSON.stringify([a.status, a.body, b.status, b.body]));
    const la = await stored(M1, '%' + ref(1)); const lb = await stored(M1, '%' + ref(2));
    const shape = (rows) => rows.map((r) => [r.dr, r.cr]);
    ok('BB04-1 A is Dr bank 264000 · Dr bank charges 6000 · Cr card 270000, all AUD, Dr = Cr', JSON.stringify(shape(la)) === JSON.stringify([[264000, 0], [6000, 0], [0, 270000]]) && la.every((r) => r.currency === 'AUD') && sum(la, 'dr') === sum(la, 'cr'), JSON.stringify(la));
    ok('BB04-1 B is Dr bank 264000 · Dr fees 5455 · Dr GST paid 545 · Cr card 270000, all AUD, Dr = Cr; the tax on the pack input-tax ledger 2210', JSON.stringify(shape(lb)) === JSON.stringify([[264000, 0], [5455, 0], [545, 0], [0, 270000]]) && lb.every((r) => r.currency === 'AUD') && sum(lb, 'dr') === sum(lb, 'cr') && lb.some((r) => r.code === '2210' && r.dr === 545), JSON.stringify(lb));

    /* BB04-2: re-read the ledger, BRS 0 (the statement's two lines carried against the books' bank balance, two carried totals) */
    const statementClosing = 264000 + 264000;
    const led = await call(ownerOf(M1), 'GET', '/api/books/ledger/' + bank);
    const closing = led.body && (led.body.closing_minor != null ? led.body.closing_minor : (led.body.balance_minor != null ? led.body.balance_minor : (led.body.closing && led.body.closing.balance_minor)));
    console.log('       (ledger answer keys: ' + Object.keys(led.body || {}).join(',') + ' closing=' + closing + ')');
    const booksBank = Number(closing);
    const diff = statementClosing - booksBank;
    ok('BB04-2 the bank ledger re-read: closing per books ' + booksBank + ' = closing per statement ' + statementClosing + ', BRS difference 0', led.status === 200 && diff === 0, JSON.stringify(led.body).slice(0, 500));
    const tb = await call(ownerOf(M1), 'GET', '/api/books/trial-balance');
    const tbRows = (tb.body && (tb.body.rows || tb.body.accounts || tb.body.lines)) || [];
    const tbDr = tbRows.reduce((t, r) => t + (Number(r.dr_minor) || 0), 0), tbCr = tbRows.reduce((t, r) => t + (Number(r.cr_minor) || 0), 0);
    ok('BB04-2 the trial balance re-read: total Dr = total Cr (' + tbDr + ' / ' + tbCr + ')', tb.status === 200 && tbRows.length > 0 && tbDr === tbCr, JSON.stringify(tb.body).slice(0, 400));
    const cardRows = (await stored(M1, '%')).filter((r) => r.cr === 270000);
    ok('BB04-2 card clearing carries 270000 Cr in each of the two entries (the gross card sales, 540000 in all)', cardRows.length === 2 && new Set(cardRows.map((r) => r.code)).size === 1, JSON.stringify(cardRows));

    /* BB04-3: a duplicate press answers the first entry */
    const again = await own(settle(2, { fee: 54.55, fee_tax_minor: 545 }));
    const n2 = (await stored(M1, '%' + ref(2))).length;
    ok('BB04-3 a duplicate press (same client_ref) answers duplicate:true with the first entry, still four lines', again.status === 200 && again.body.duplicate === true && again.body.entry_id === b.body.entry_id && n2 === 4, JSON.stringify([again.status, again.body, n2]));

    /* BB04-5: access, both ways (before the lock) */
    const advPost = await adv(A, M1, 'POST', '/events', settle(3, { fee: 54.55, fee_tax_minor: 545 }));
    const ae = await stored(M1, '%' + ref(3));
    ok('BB04-5 an adviser who may post (adviser_posts): 200, one 4-line entry stamped with the grant and the firm', advPost.status === 200 && ae.length === 4 && ae.every((r) => r.grant_id === g1.body.grant_id && r.by_firm === P.name), JSON.stringify([advPost.status, advPost.body, ae.slice(0, 1)]));
    const before = (await stored(M1, '%')).length;
    const aud = await call(U, 'POST', '/api/books/events', { member: M1.id, role: 'auditor', body: settle(4) });
    ok('BB04-5 the auditor is refused (403 GRANT_READ_ONLY), nothing posted', aud.status === 403 && code(aud) === 'GRANT_READ_ONLY' && (await stored(M1, '%')).length === before, JSON.stringify(aud));
    const w2 = await adv(A, M2, 'POST', '/events', settle(1));
    ok('BB04-5 an adviser without posting (owner_approves) is refused (403 ADVISER_POSTING_NOT_ALLOWED), nothing posted', w2.status === 403 && code(w2) === 'ADVISER_POSTING_NOT_ALLOWED' && (await stored(M2, '%')).length === 0, JSON.stringify(w2));
    const noRole = await call(A, 'POST', '/api/books/events', { member: M1.id, body: settle(5) });
    const nr = await stored(M1, '%' + ref(5));
    ok('BB04-5 the same person with no role header gets the ADVISER seat (SEC-117: the seat is the default grant, as tests/adviser-bank.realstack.cjs step 5): 200, stamped with the grant', noRole.status === 200 && nr.length === 3 && nr.every((r) => r.grant_id === g1.body.grant_id), JSON.stringify([noRole.status, noRole.body, nr.slice(0, 1)]));

    /* BB04-4: a locked month is refused (last: it locks the month) */
    const periods = (await call(ownerOf(M1), 'GET', '/api/books/periods')).body;
    const rows = Array.isArray(periods.periods || periods.rows || periods) ? (periods.periods || periods.rows || periods) : [];
    /* K-F-01: a month still running is never locked, so the month locked here is the latest OPEN one that has ended, and the settlements are dated inside it */
    const todayRow = rows.filter((r) => Number(r.period) >= 1 && r.status === 'open' && String(r.end_date).slice(0, 10) < day).sort((x, y) => String(y.end_date).localeCompare(String(x.end_date)))[0];
    const inLocked = todayRow ? { date: String(todayRow.start_date).slice(0, 10) } : {};
    if (!todayRow) ok('BB04-4 an open period that has ended was found', false, JSON.stringify(periods).slice(0, 300));
    else {
      const fy = todayRow.fiscal_year || periods.fiscal_year;
      const lk = await call(ownerOf(M1), 'POST', '/api/books/periods/' + fy + '/' + Number(todayRow.period) + '/lock', { body: {} });
      const locked = await own(settle(6, { fee: 54.55, fee_tax_minor: 545, ...inLocked }));
      ok('BB04-4 the owner locks the month; the settlement is refused in the ledger\'s words (409 PERIOD_LOCKED), nothing posted', lk.status === 200 && locked.status === 409 && /lock/i.test(JSON.stringify(locked.body)) && (await stored(M1, '%' + ref(6))).length === 0, JSON.stringify([lk.status, locked.status, locked.body]));
      const viaAdv = await adv(A, M1, 'POST', '/events', settle(7, inLocked));
      ok('BB04-4 the adviser who may post meets the same refusal, same code', viaAdv.status === 409 && code(viaAdv) === code(locked), JSON.stringify([viaAdv.status, viaAdv.body]));
    }
  } finally { server.close(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
