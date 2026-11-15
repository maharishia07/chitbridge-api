/**
 * books-manual-modes.test.cjs — ACC-300: the owner's everyday events offer the payment modes of the shop's COUNTRY PACK, and every mode offered posts.
 *
 * Proves, for India, Australia and the UAE through one code path: GET /events lists, in picks.mode and in the mode pick of every event, EXACTLY the pack's
 * chart.paymentModes keys (a cheque left out: it posts when it clears) · a mode the pack does not name (UPI in Australia and the UAE) is refused with the
 * same words as before, listing the pack's own modes · each offered mode posts an expense and a capital entry (no offer, then refuse) and the entry's money
 * line lands on the account the pack names for the mode (never India's table) · India keeps UPI.
 * Run: node tests/books-manual-modes.test.cjs   (BOOKS_ENGINES_SRC=<lib/ or chitbridge-engines/src>)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';
const { rig, counter, SHOP } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();

(async () => {
  console.log('\n══ GET /api/books/events — the modes are the country pack\'s ══\n');
  const R = await rig(); if (!R) return;
  const { X, q } = R, T = X.T;
  const E = require('../lib/books-engines');
  const D = '2026-10-05';
  const packModes = (country) => Object.keys(E.packs().packFor(country).chart.paymentModes).filter((mode) => mode !== 'cheque');
  const accountOf = (country, mode) => E.packs().packFor(country).chart.paymentModes[mode];

  for (const country of ['IN', 'AU', 'AE']) {
    console.log('\n   ── ' + country + ' ──');
    const want = packModes(country);
    await X.store.saveSetting(X.db, SHOP, { enabled: false, country });
    ok(country + ': the ledger is on', (await q('POST', '/enable', {})).body.ok === true);

    const grid = (await q('GET', '/events')).body;
    eq(country + ': picks.mode = the pack\'s modes', grid.picks.mode, want);
    const picked = grid.events.filter((e) => e.fields).flatMap((e) => e.fields.filter((f) => f.pick === 'mode').map((f) => [e.kind, f.options]));
    ok(country + ': the grid has events that ask for a mode', picked.length >= 3, 'found ' + picked.length);
    for (const [kind, options] of picked) eq(country + ': ' + kind + ' offers the pack\'s modes', options, want);
    ok(country + ': UPI is ' + (country === 'IN' ? 'offered' : 'not offered'), grid.picks.mode.includes('upi') === (country === 'IN'));

    const codeOfRole = {};
    const expenseClass = grid.picks.expense_class[0].role;
    for (const mode of want) {
      const money = accountOf(country, mode); /* the role the pack names for the mode */
      const spent = await q('POST', '/events', { kind: 'expense', class: expenseClass, amount: 100, paid_from: mode, date: D, client_ref: country + '-x-' + mode });
      ok(country + ': an offered mode posts an expense: ' + mode, spent.status === 200 && spent.body.ok !== false, JSON.stringify(spent.body).slice(0, 200));
      const capital = await q('POST', '/events', { kind: 'capital', into: mode, amount: 250, date: D, client_ref: country + '-c-' + mode });
      ok(country + ': an offered mode posts a capital entry: ' + mode, capital.status === 200 && capital.body.ok !== false, JSON.stringify(capital.body).slice(0, 200));
      const entry = T.entries.find((item) => item.source_ref === 'ev:capital:' + country + '-c-' + mode);
      const lines = entry ? T.lines.filter((line) => line.entry_id === entry.entry_id) : [];
      const debit = lines.find((line) => line.dr_minor === 25000);
      ok(country + ': ' + mode + ' is Dr the money account, Cr capital', lines.length === 2 && !!debit && lines.some((line) => line.cr_minor === 25000));
      const seen = codeOfRole[money];
      if (debit && seen) eq(country + ': ' + mode + ' and the other modes of role ' + money + ' share one ledger', debit.code, seen);
      if (debit) codeOfRole[money] = debit.code;
    }

    for (const stranger of ['upi', 'eft', 'transfer', 'zelle'].filter((mode) => !want.includes(mode))) {
      const refused = await q('POST', '/events', { kind: 'expense', class: expenseClass, amount: 100, paid_from: stranger, date: D, client_ref: country + '-no-' + stranger });
      ok(country + ': ' + stranger + ' is refused (not in the pack)', refused.status >= 400 && refused.status < 500, 'status ' + refused.status);
      const words = JSON.stringify(refused.body);
      ok(country + ': the refusal keeps its words and lists the pack\'s modes', words.includes('How was it paid?') && words.includes(want[want.length - 1]), words.slice(0, 200));
    }
  }
  R.close();
  done();
})().catch((error) => { console.error(error); process.exit(1); });
