/**
 * books-manual-modes.test.cjs — ACC-300: the owner's everyday events offer the payment modes of the shop's COUNTRY PACK, and every mode offered posts.
 *
 * Proves, for India, Australia and the UAE through one code path: GET /events lists, in picks.mode and in the mode pick of every event, EXACTLY the pack's
 * chart.paymentModes keys (a cheque left out: it posts when it clears) · a mode the pack does not name (UPI in Australia and the UAE) is refused with the
 * same words as before, listing the pack's own modes · each offered mode posts an expense and a capital entry (no offer, then refuse) and the entry's money
 * line lands on the account the pack names for the mode (never India's table) · India keeps UPI · the asset register and POST /payments read the same one list
 * (a payment may also name a cheque; the asset-posting case itself writes fixed_asset rows, so it runs on the real Postgres in CI / SIT).
 * Run: node tests/books-manual-modes.test.cjs   (BOOKS_ENGINES_SRC=<lib/ or chitbridge-engines/src>)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';
const { rig, counter, SHOP, SUPP } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();

(async () => {
  console.log('\n══ GET /api/books/events — the modes are the country pack\'s ══\n');
  const R = await rig(); if (!R) return;
  const { X, q } = R, T = X.T;
  const E = require('../lib/books-engines');
  const port = R.srv.address().port;
  /* a money write takes the Idempotency-Key header (the rig's call sends none) */
  const withKey = (route, body, key) => new Promise((resolve) => {
    const text = JSON.stringify(body);
    const request = require('http').request({ host: '127.0.0.1', port, path: '/api/books' + route, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), 'Idempotency-Key': key } },
      (res) => { let raw = ''; res.on('data', (chunk) => { raw += chunk; }); res.on('end', () => { let json = {}; try { json = JSON.parse(raw || '{}'); } catch (_) { json = {}; } resolve({ status: res.statusCode, body: json }); }); });
    request.end(text);
  });
  const D = '2026-10-05';
  const packModes = (country) => Object.keys(E.packs().packFor(country).chart.paymentModes).filter((mode) => mode !== 'cheque');
  const accountOf = (country, mode) => E.packs().packFor(country).chart.paymentModes[mode];

  /* what the pack says each mode lands on, written out by hand from the AU chart (reg-au CHART.paymentModes) — before ACC-300 modeAcct read India's table: eft/bpay/payid/eftpos were unknown there */
  const AU_ROLE = { cash: 'cash', bank: 'bank', eft: 'bank', bpay: 'bank', payid: 'bank', card: 'card', eftpos: 'card' };
  const table = [];
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
      if (country === 'AU') { eq('AU: ' + mode + ' lands on the role the AU chart names', money, AU_ROLE[mode]); table.push([mode, money, debit && debit.code]); }
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
  console.log('   AU mode → role → ledger code: ' + JSON.stringify(table));

  /* the other doors read the same one list (ACC-300): the asset register, and a payment (which may also record a cheque) */
  for (const country of ['IN', 'AU', 'AE']) {
    console.log('\n   ── ' + country + ' · assets and payments ──');
    const want = packModes(country);
    await X.store.saveSetting(X.db, SHOP, { enabled: false, country });
    await q('POST', '/enable', {});
    const klass = E.packs().packFor(country).asset_classes[0].class;
    /* an asset that IS paid by an offered mode writes fixed_asset rows (real SQL): that case runs on the real Postgres in CI / SIT, not in this in-memory harness */
    const stranger = want.includes('upi') ? 'zelle' : 'upi';
    const noAsset = await q('POST', '/assets', { name: 'Desk', class: klass, cost: 5000, date: D, how: stranger, client_ref: country + '-a-no' });
    ok(country + ': an asset paid by ' + stranger + ' is refused, listing the pack modes', noAsset.status >= 400 && noAsset.status < 500 && JSON.stringify(noAsset.body).includes(want[want.length - 1]), JSON.stringify(noAsset.body).slice(0, 200));
    const payment = (mode) => withKey('/payments', { party_id: SUPP, direction: 'out', amount_minor: 1000, currency: country === 'IN' ? 'INR' : country === 'AU' ? 'AUD' : 'AED', mode, received_at: D, allocate: 'none', client_ref: country + '-p-' + mode }, country + '-p-' + mode);
    const noPay = await payment(stranger);
    ok(country + ': a payment by ' + stranger + ' is refused with the pack modes', noPay.status === 400 && JSON.stringify(noPay.body).includes('Paid how') && JSON.stringify(noPay.body).includes('cheque'), JSON.stringify(noPay.body).slice(0, 200));
    const chequePay = await payment('cheque');
    ok(country + ': a payment may still name a cheque (not a mode refusal)', !JSON.stringify(chequePay.body).includes('Paid how'), JSON.stringify(chequePay.body).slice(0, 200));
  }
  R.close();
  done();
})().catch((error) => { console.error(error); process.exit(1); });
