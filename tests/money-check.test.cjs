/**
 * tests/money-check.test.cjs — ACC-206 B: THE ONE PICK, THE RAISE THAT REACHES US, AND NO ARITHMETIC OUTSIDE THE ENGINE.
 *   1 · counter-bill.pickOf — every shape a chit's three stored copies can take (withheld · invoice · money · legacy_net · agree false · legacy · none)
 *   2 · lib/money-check.raise — a disagreement becomes ONE support ticket to the platform desk (client_ref 'mismatch:<chit>:total', the unique index is the dedupe),
 *       the /health counter, one log line, one mail per NEW ticket, a digest past five an hour; SUPPORT_ALERT_TO unset → ticket + counter still stand;
 *       the other party is never told (the ticket's audience is 'platform', nothing is sent on the chit)
 *   3 · billTotalOf — the shop's plain sentence, the help desk number from the operator's row
 *   4 · the files that decide money hold no money arithmetic (lib/send-money.js, lib/money-check.js, the pick in lib/counter-bill.js) — a scan
 * Run: node tests/money-check.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
let pass = 0,
  fail = 0;
const ok = (name, cond, why) => {
  if (cond) {
    pass++;
    console.log('   ok   ' + name);
  } else {
    fail++;
    console.log('   FAIL ' + name + (why ? '\n          ' + why : ''));
  }
};
const J = (x) => JSON.stringify(x);

const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { query: async () => ({ rows: [{ bridge_id: 'CB-SHOP', display_name: 'Test Shop', population: 'live' }] }), withEntity: async (id, fn) => fn({ query: async () => ({ rows: [] }) }) }
};
const CB = require('../lib/counter-bill');
const inv = (total) => ({ ValDtls: { TotInvVal: total } });
const pick = (summary_json, business_json) => CB.pickOf({ summary_json, business_json });
const STAMPS = { money: { by: 'chits send' }, total_value: { by: 'chits send' } };

console.log('\n══ 1 · THE ONE PICK ══\n');
let p = pick({ total_value: 189, money: { total: 189 }, stamps: STAMPS }, { invoice: inv(189) });
ok('invoice = money = total_value → the invoice, agree', p.source === 'invoice' && p.total === 189 && p.agree === true, J(p));
p = pick({ total_value: 189, money: { total: 189 } }, { invoice: inv(189) });
ok('…agree with NO stamps (a chit sent by #440 before stamps existed is not a mismatch)', p.agree === true && p.source === 'invoice', J(p));
p = pick({ total_value: 180, money: { total: 189 } }, { invoice: inv(189) });
ok('a pre-ACC-206 B2B chit (no stamps, total_value the route\'s net 180, invoice 189, money 189) → 189, legacy_net, agree, nothing to raise', p.total === 189 && p.agree === true && p.legacy_net === true, J(p));
p = pick({ total_value: 180, money: { total: 189 } }, undefined);
ok('…the same without a frozen invoice → money 189, legacy_net', p.total === 189 && p.source === 'money' && p.legacy_net === true && p.agree, J(p));
p = pick({ total_value: 180, money: { total: 189 }, stamps: STAMPS }, { invoice: inv(189) });
ok('a STAMPED chit whose total_value differs → the engine\'s 189 is answered with agree FALSE and differs [total_value]', p.total === 189 && p.agree === false && J(p.differs) === '["total_value"]', J(p));
p = pick({ total_value: 189, money: { total: 190 }, stamps: STAMPS }, { invoice: inv(189) });
ok('invoice ≠ money.total → agree false (differs money)', p.agree === false && J(p.differs) === '["money"]', J(p));
p = pick({ total_value: 1180, money: { total: 1180 } }, { invoice: inv(1180) });
ok('a counter bill 1,180 / 1,180 / 1,180 → unchanged', p.total === 1180 && p.agree, J(p));
p = pick({ total_value: 180 }, {});
ok('neither invoice nor money → total_value, source legacy', p.total === 180 && p.source === 'legacy' && p.agree, J(p));
p = pick({ total_value: null, oversight: true }, {});
ok('the TR-6 operator copy (oversight) → withheld, no figure, never a mismatch', p.source === 'withheld' && p.total === null && p.agree === true, J(p));
p = pick({ total_value: null }, {});
ok('a chit with no money at all → none (not applicable), agree', p.source === 'none' && p.total === null && p.agree, J(p));
ok('paidOf keeps its callers: money.total, else money.net, else total_value', CB.paidOf({ money: { total: 5, net: 4 } }) === 5 && CB.paidOf({ money: { net: 4 } }) === 4 && CB.paidOf({ total_value: 3 }) === 3);

console.log('\n══ 2 · THE RAISE THAT REACHES US ══\n');
const raiseticket = require('../lib/raiseticket');
const notify = require('../lib/notify');
const tickets = [];
const mails = [];
const seen = new Set();
raiseticket.raise = async (from, who, t) => {
  tickets.push({ from, who, t });
  if (t.client_ref && seen.has(t.client_ref)) return { raised: false, duplicate: true, why: 'already raised' }; /* what the unique index does: 23505 → duplicate */
  seen.add(t.client_ref);
  return { raised: true, chit_id: 'ticket-' + tickets.length };
};
notify.sendSupportAlert = async (to, ticket) => {
  mails.push({ to, ticket });
  return { delivered: false };
};
const MC = require('../lib/money-check'); /* a failed raise is refused in words and logged, never swallowed (503-class: the desk or the database unavailable → { raised: false, why }) */
const SHOP = '11111111-1111-4111-8111-111111111111';
const header = (id) => ({ chit_id: id, summary_json: { total_value: 180, money: { total: 189 }, stamps: { money: { by: 'chits send', engine: 'tax@1.74.0', where: 'send' }, total_value: { by: 'chits send', from: 'money.total', at: 'T' } } }, business_json: { invoice: inv(189) } });
(async () => {
  process.env.SUPPORT_ALERT_TO = 'support@example.test';
  const h1 = header('aaaaaaaa-0000-4000-8000-000000000001');
  const first = await MC.raise(SHOP, h1, CB.pickOf(h1), 'books-hooks classify');
  ok('a mismatch raises ONE ticket from the shop to the platform desk, naming a client_ref that is unique per chit and field', first.raised === true && tickets[0].t.audience === 'platform' && tickets[0].t.client_ref === 'mismatch:' + h1.chit_id + ':total' && tickets[0].from.entity_id === SHOP && tickets[0].t.severity === 'Sev-2', J(tickets[0]));
  const facts = tickets[0].t.money_mismatch;
  ok('…it names the chit, the field, EACH value with its field and WRITER, the reader that saw it, and the time', facts.chit_id === h1.chit_id && facts.reader === 'books-hooks classify' && facts.values.length === 2 && facts.values.some((v) => v.value === 180 && v.field === 'summary_json.total_value' && v.writer.by === 'chits send') && facts.values.some((v) => v.value === 189 && v.field === 'business_json.invoice.ValDtls.TotInvVal' && v.writer.by === 'tax engine') && !!facts.at, J(facts));
  ok('…the subject reads "Figures disagree on chit …: TotInvVal 189 (tax engine) ≠ total_value 180 (chits send)"', /^Figures disagree on chit aaaaaaaa: TotInvVal 189 \(tax engine\) ≠ total_value 180 \(chits send\)$/.test(tickets[0].t.subject), tickets[0].t.subject);
  ok('…the /health counter reads 1 and ONE mail went to SUPPORT_ALERT_TO carrying the ticket id', MC.count() === 1 && mails.length === 1 && mails[0].to === 'support@example.test' && mails[0].ticket.ticket_id === 'ticket-1' && mails[0].ticket.chit_id === h1.chit_id, J([MC.count(), mails.length]));
  const again = await MC.raise(SHOP, h1, CB.pickOf(h1), 'GET /api/chits');
  ok('a SECOND sighting of the same fault raises nothing (the database says duplicate): same count, no second mail', again.duplicate === true && MC.count() === 1 && mails.length === 1, J([again, MC.count(), mails.length]));
  for (let i = 2; i <= 7; i++) await MC.raise(SHOP, header('aaaaaaaa-0000-4000-8000-00000000000' + i), CB.pickOf(header('x')), 'books-nightly');
  ok('more than five new tickets in an hour → the first five mail, the sixth sends ONE digest, the seventh sends nothing', MC.count() === 7 && mails.length === 6 && mails[5].ticket.digest === true, J([MC.count(), mails.length, mails.map((m) => !!m.ticket.digest)]));
  delete process.env.SUPPORT_ALERT_TO;
  const quiet = await MC.raise(SHOP, header('bbbbbbbb-0000-4000-8000-000000000001'), CB.pickOf(header('x')), 'books-hooks classify');
  ok('SUPPORT_ALERT_TO unset: the ticket and the counter still fire, no mail', quiet.raised === true && MC.count() === 8 && mails.length === 6, J([quiet, MC.count(), mails.length]));
  ok('nothing is ever sent to the other party: the ticket is the shop\'s chit to OUR desk (audience platform) and no dispute is opened', tickets.every((x) => x.t.audience === 'platform' && x.t.kind === 'incident'));

  console.log('\n══ 3 · WHAT THE SHOP IS TOLD ══\n');
  const said = MC.billTotalOf(h1, '+91 44 0000 0000');
  ok('billTotalOf: agree false, the figure answered is the ENGINE\'s, and the sentence says we have been told and gives the help desk number', said.agree === false && said.total === 189 && /did not get the right value for this figure/.test(said.says) && /We have been told and are on it/.test(said.says) && /\+91 44 0000 0000/.test(said.says), J(said));
  ok('…a chit that agrees carries no sentence', MC.billTotalOf({ summary_json: { total_value: 189, money: { total: 189 } } }).says === undefined);

  console.log('\n══ 4 · NO MONEY ARITHMETIC OUTSIDE THE ENGINE ══\n');
  const code = (f) => fs.readFileSync(path.join(API, f), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const suspects = [/\.reduce\(/, /\bMath\.(round|floor|ceil|abs)\(/, /\*\s*100\b/, /\/\s*100\b/, /\.toFixed\(/, /(total|net|gross|tax|amount|price|taxable)\w*\s*[-+*]\s*\w*(total|net|gross|tax|amount|price|taxable)/i];
  for (const f of ['lib/send-money.js', 'lib/money-check.js']) {
    const text = code(f);
    ok(f + ' holds no sum, difference, rounding or percentage', suspects.every((re) => !re.test(text)), suspects.filter((re) => re.test(text)).join(' '));
  }
  const pickBody = (() => {
    const t = code('lib/counter-bill.js');
    return t.slice(t.indexOf('function pickOf'), t.indexOf('function basketOf'));
  })();
  ok('counter-bill.pickOf / paidOf hold no sum, difference, rounding or percentage (equality only)', suspects.every((re) => !re.test(pickBody)), suspects.filter((re) => re.test(pickBody)).join(' '));
  const chits = code('routes/chits.js');
  const calc = chits.slice(chits.indexOf('const calculateSummary'), chits.indexOf('const calculateSummary') + 160);
  ok('routes/chits.js: calculateSummary counts lines and nothing else; sendMoney has no gross / net / savings / total arithmetic', /line_item_count/.test(calc) && !/reduce|total_value/.test(calc) && !/gross - net|net \+ tax|savings: r2m|listOf\(|netOf\(/.test(chits));
  console.log(`\n  ${pass} passed, ${fail} failed · ${pass + fail} checks\n`);
  process.exit(fail ? 1 : 0);
})();
