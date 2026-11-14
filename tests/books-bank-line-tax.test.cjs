/**
 * books-bank-line-tax.test.cjs — FIN-116: a bank line's own tax answer on POST /api/books/events (kind expense), through real express and the in-memory ledger.
 *
 * The Bank sheet posts a GST-registered Australian shop's bank charge as a flat body { kind, class, date, amount, narration, paid_from, client_ref } and, when the line has tax inside,
 * `input_tax_minor`. `amount` is then the NET and the tax is posted as sent (this door computes nothing): Dr 6090 bank charges 20.00 · Dr 2210 GST paid 2.00 · Cr 1500 Bank 22.00, so
 * the entry is exactly the bank's figure (before this key it was 2.00 short: the tax had no way in). Hand-worked: 22.00 fee, 10% GST inside = 2.00, net 20.00.
 * Proves: the flat body without the key is unchanged · the key posts the three lines (amount in major and amount_minor alike) · a repeat of the client_ref answers duplicate:true and posts
 * nothing more · the preview shows the same lines · every refusal in words with no entry (0, negative, fraction, text, null, true, tax above net, a bill, a supplier, another entry kind,
 * a shop whose registration is unknown or unregistered or composition, a country with several tax heads) · an unknown key is still refused (the web sends kind, never type, and no ref/currency).
 * Run: node tests/books-bank-line-tax.test.cjs   (BOOKS_ENGINES_SRC=<chitbridge-engines/src>)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';
const { rig, counter, SUPP, SHOP } = require('./support/books-manual-rig.cjs');
const { ok, eq, done } = counter();

const REGISTERED = { country: 'AU', currency_code: 'AUD', gstn: '51824753556', timezone: 'Australia/Sydney', policy_flags: { gst_registration: 'regular' } };

(async () => {
  console.log('\n══ POST /api/books/events — a bank line\'s tax (FIN-116) ══\n');
  const R = await rig(REGISTERED);
  if (!R) return;
  const { X, q } = R, T = X.T;
  const D = '2026-10-05';
  const setup = require('../lib/country-setup');
  /* the in-memory store has no b299 columns (country-setup.migrated() answers no), so the one reader's SQL read (registrationOfShop) is stood in by the same rule over the same row: registrationOf is the real one, the SQL is unrun here */
  setup.registrationOfShop = async () => setup.registrationOf({ number: X.db.countryRow.gstn, scheme: X.db.countryRow.policy_flags.gst_registration, tax_registration: null });
  const asShop = (row) => { X.db.countryRow = row; setup.forget(SHOP); };
  const entryOf = (ref) => T.entries.find((e) => e.source_ref === ref);
  const linesOf = (e) => T.lines.filter((l) => l.entry_id === e.entry_id).sort((a, b) => a.line_no - b.line_no).map((l) => [l.code, l.dr_minor, l.cr_minor]);
  const fee = (extra) => Object.assign({ kind: 'expense', class: 'bank_charges', date: D, amount: 20, narration: 'Monthly account fee', paid_from: 'bank' }, extra);
  const before = () => T.entries.length;

  /* ── what the web sends today: no tax key — unchanged ── */
  const plain = await q('POST', '/events', fee({ amount: 22, client_ref: 'bt-plain' }));
  ok('the flat body with no tax key posts (200)', plain.status === 200 && plain.body.ok && plain.body.kind === 'expense', JSON.stringify(plain.body));
  eq('…Dr 6090 bank charges 22.00 · Cr 1500 Bank 22.00, nothing more', linesOf(entryOf('ev:expense:bt-plain')), [['6090', 2200, 0], ['1500', 0, 2200]]);

  /* ── the tax answer: amount is the NET, the tax is inside the bank's 22.00 ── */
  const taxed = await q('POST', '/events', fee({ client_ref: 'bt-1', input_tax_minor: 200 }));
  ok('net 20.00 + input_tax_minor 200 posts (200)', taxed.status === 200 && taxed.body.ok && !taxed.body.duplicate, JSON.stringify(taxed.body));
  const entry = entryOf('ev:expense:bt-1');
  eq('…Dr 6090 20.00 · Dr 2210 GST paid 2.00 · Cr 1500 Bank 22.00 (the bank figure, to the cent)', linesOf(entry), [['6090', 2000, 0], ['2210', 200, 0], ['1500', 0, 2200]]);
  const ls = linesOf(entry);
  eq('…Dr = Cr', ls.reduce((t, l) => t + l[1], 0), ls.reduce((t, l) => t + l[2], 0));

  const minor = await q('POST', '/events', fee({ client_ref: 'bt-2', amount: undefined, amount_minor: 2000, input_tax_minor: 200 }));
  ok('amount_minor 2000 + input_tax_minor 200 posts the same lines', minor.status === 200 && JSON.stringify(linesOf(entryOf('ev:expense:bt-2'))) === JSON.stringify(ls), JSON.stringify(minor.body));

  /* ── a replay: the same client_ref answers the first entry ── */
  const count = before();
  const again = await q('POST', '/events', fee({ client_ref: 'bt-1', input_tax_minor: 200 }));
  ok('a repeat of the client_ref answers duplicate:true with the first entry', again.status === 200 && again.body.duplicate === true && again.body.entry_id === taxed.body.entry_id, JSON.stringify(again.body));
  eq('…and posted nothing more', before(), count);

  /* ── the preview is the same composition ── */
  const view = await q('POST', '/preview', fee({ client_ref: 'bt-3', input_tax_minor: 200 }));
  ok('the preview shows Dr 6090 · Dr 2210 · Cr 1500, balanced, with the as-sent note', view.status === 200 && view.body.ok && view.body.balanced
    && JSON.stringify(view.body.lines.map((l) => [l.code, l.dr_minor, l.cr_minor])) === JSON.stringify(ls) && view.body.flags.length === 1, JSON.stringify(view.body));
  ok('…and wrote nothing', !entryOf('ev:expense:bt-3'));

  /* ── refusals: in words, nothing posted ── */
  const refused = async (name, body, codes) => {
    const n = before(), r = await q('POST', '/events', body);
    ok(name + ' → ' + r.status, codes.indexOf(r.status) >= 0 && before() === n && !r.body.ok, JSON.stringify(r.body));
    return r;
  };
  for (const [name, value] of [['zero', 0], ['negative', -200], ['a fraction', 1.5], ['text', '200'], ['null', null], ['true', true]])
    await refused('input_tax_minor ' + name + ' is refused', fee({ client_ref: 'bt-bad-' + name, input_tax_minor: value }), [400, 422]);
  const over = await refused('tax above the net (2100 on 20.00) is refused', fee({ client_ref: 'bt-over', input_tax_minor: 2100 }), [422]);
  ok('…in words, naming nothing posted', /Nothing was posted/.test(JSON.stringify(over.body)), JSON.stringify(over.body));
  await refused('a bill beside the tax is refused', fee({ client_ref: 'bt-bill', input_tax_minor: 200, bill: { supplier_gstin: '33AAAAA0000A1Z5', lines: [{ name: 'x', qty: 1, unit_price: 10, gst_rate: 10 }] } }), [422]);
  await refused('a supplier beside the tax is refused', fee({ client_ref: 'bt-supplier', input_tax_minor: 200, supplier: SUPP }), [422]);
  await refused('the key on another kind (other_income) is refused, not ignored', { kind: 'other_income', class: 'interest_received', into: 'bank', date: D, amount: 20, client_ref: 'bt-inc', input_tax_minor: 200 }, [422]);
  await refused('an unknown key (currency) is still refused: the web sends none', fee({ client_ref: 'bt-cur', currency: 'AUD', input_tax_minor: 200 }), [400, 422]);

  /* ── registration: unknown is unknown ── */
  asShop(Object.assign({}, REGISTERED, { gstn: null, policy_flags: {} }));
  const unknown = await refused('a shop that never said it is registered is refused', fee({ client_ref: 'bt-unk', input_tax_minor: 200 }), [422]);
  ok('…it asks the owner to say (not "unregistered")', /Nobody has said/.test(JSON.stringify(unknown.body)), JSON.stringify(unknown.body));
  const noKey = await q('POST', '/events', fee({ client_ref: 'bt-unk-plain', amount: 22 }));
  ok('…while the same shop still records the line without a tax key', noKey.status === 200 && noKey.body.ok, JSON.stringify(noKey.body));
  asShop(Object.assign({}, REGISTERED, { gstn: null, policy_flags: { gst_registration: 'unregistered' } }));
  const not = await refused('a shop that said it is not registered is refused', fee({ client_ref: 'bt-not', input_tax_minor: 200 }), [422]);
  ok('…naming the credit it cannot claim', /not registered/.test(JSON.stringify(not.body)), JSON.stringify(not.body));
  asShop(Object.assign({}, REGISTERED, { policy_flags: { gst_registration: 'composition' } }));
  await refused('a composition shop claims no credit', fee({ client_ref: 'bt-comp', input_tax_minor: 200 }), [422]);
  asShop(REGISTERED);

  /* ── a country with several tax heads (India: cgst · sgst · igst · cess) has no single head to post to ── */
  await X.store.saveSetting(X.db, SHOP, { enabled: true, country: 'IN' });
  const india = await refused('a pack with four tax heads is refused', fee({ client_ref: 'bt-in', input_tax_minor: 200 }), [422]);
  ok('…naming the tax it cannot post', /no single tax/.test(JSON.stringify(india.body)), JSON.stringify(india.body));

  /* ── a single-head pack with NO input-credit ledger (US sales tax, MY): the engine's expense would drop the tax line onto the class ledger and post short — refused, never posted ── */
  const US = { country: 'US', currency_code: 'USD', gstn: '123456789', timezone: 'America/New_York', policy_flags: { gst_registration: 'regular' } };
  asShop(US);
  await X.store.saveSetting(X.db, SHOP, { enabled: true, country: 'US' });
  const noCredit = await refused('a pack with no input-credit ledger (US) is refused', fee({ client_ref: 'bt-us', input_tax_minor: 200 }), [422]);
  ok('…naming the cost, nothing posted', /part of the cost/.test(JSON.stringify(noCredit.body)), JSON.stringify(noCredit.body));

  R.close();
  done();
})();
