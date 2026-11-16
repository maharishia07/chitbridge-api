'use strict';
/**
 * tests/onerule-practice-page.realstack.cjs — l16 onerule: on a REAL Postgres (a SIT box, cb_app, RLS on) the practice row of EVERY client equals the client's own page for the same fact.
 * Practice side: lib/books-practice.practice(FIRM) (the one batch read). Page side: bound as the client — the Month lock page's functions (store periods + periodFigures → books.periodAdvice) and the Bank home's (bank-rec-log.unexplained).
 * STRICT facts (a difference fails the run): months_unlocked, bank.unexplained_minor / currency / reconciled_to / state.
 * INFO facts (printed, never fail; the rest of the fact table in the l16 onerule report): queries.open vs review-mark.openList total_open, checked.n/of vs review-mark coverage.
 * Run: DATABASE_URL=postgres://cb_app:...@<sit host>/... FIRM_ID=<the firm entity with the 150 clients> node tests/onerule-practice-page.realstack.cjs   (sit-grund only; never sit-au, never production)
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
if (!process.env.FIRM_ID) { console.error('REFUSED: FIRM_ID (the firm entity holding the client grants) is required'); process.exit(3); }
process.env.NODE_ENV = 'test';
const path = require('path');
const API = path.join(__dirname, '..');
const B = require(path.join(API, 'lib', 'books.js'));
const S = require(path.join(API, 'lib', 'books-store.js'));
const BR = require(path.join(API, 'lib', 'bank-rec-log.js'));
const P = require(path.join(API, 'lib', 'books-practice.js'));
const grants = require(path.join(API, 'lib', 'books-grant.js'));

(async () => {
  const t0 = Date.now();
  const answer = await P.practice(process.env.FIRM_ID, { roles: [grants.AUDITOR, grants.ADVISER] });
  const ms = Date.now() - t0;
  console.log('practice read: ' + answer.clients.length + ' clients in ' + ms + ' ms');
  let strict = 0, info = 0, checks = 0;
  for (const row of answer.clients) {
    const page = await grants.asEntity(row.entity_id, async (h) => {
      const rows = await S.periods(h, row.entity_id, null);
      const figures = await S.periodFigures(h, row.entity_id, null);
      const dated = rows.map((r) => Object.assign({}, r, { start_date: String(r.start_date).slice(0, 10), end_date: require(path.join(API, 'lib', 'books-engines.js')).ymd(r.end_date) }));
      const advice = B.periodAdvice(dated, figures, answer.today, [], null);
      const months = advice.filter((x) => Number(x.period) >= 1 && !B.isLockedStatus(x.status) && x.lock.why !== 'This month is not over yet.').length;
      const bank = await BR.unexplained(h, row.entity_id);
      let open = null;
      try { open = await require(path.join(API, 'lib', 'review-mark.js')).openList(h, 'acc.audit', row.entity_id, {}, { from: '1900-01-01', to: '2999-12-31' }); } catch (_) { open = null; }
      return { months, bank, open };
    });
    const strictPairs = [
      ['months_unlocked', row.months_unlocked, page.months],
      ['bank.unexplained_minor', row.bank.unexplained_minor, page.bank.unexplained_minor],
      ['bank.currency', row.bank.currency, page.bank.currency],
      ['bank.reconciled_to', row.bank.reconciled_to, page.bank.to]
    ];
    for (const [fact, practice, pageValue] of strictPairs) {
      checks++;
      if (JSON.stringify(practice) !== JSON.stringify(pageValue)) { strict++; console.log('  FAIL ' + row.name + ' · ' + fact + ': practice ' + JSON.stringify(practice) + ' ≠ page ' + JSON.stringify(pageValue)); }
    }
    if (page.open && Number(page.open.total_open) !== row.queries.open) { info++; console.log('  info ' + row.name + ' · queries.open: practice ' + row.queries.open + ' vs marks page ' + page.open.total_open); }
  }
  console.log(checks + ' strict checks over ' + answer.clients.length + ' clients, ' + strict + ' differ; ' + info + ' info lines (queries)');
  process.exit(strict ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
