/**
 * acc-198-tax-unknown.test.cjs — ACC-198 (lifecycle B3 S5-1; DECISIONS 29 Oct, R13): A TAX REGISTRATION NOBODY STATED IS A QUESTION.
 *
 *   The one reader (country-setup.registrationOf) answers 'regular' | 'composition' | 'unregistered' | 'unknown'; the readers that lean on
 *   it (tax-shelf.registrationMayCharge / chargesTax, tax-lines.partyOf, books-hooks' seller gate) answer unknown with the code
 *   TAX_REGISTRATION_UNKNOWN and the question, never 'regular' and never 'no'. A sale of a freshShop with no tax (IN and AU) WAITS on the
 *   books' Waiting list with the question, and nothing posts. A stated registration behaves as before.
 *   Runs on the in-memory twin (tests/support/books-harness.cjs → books-memory.cjs). No database.
 * Run: node tests/acc-198-tax-unknown.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const safe = (fn) => { try { return fn(); } catch (e) { return 'threw: ' + e.message; } };
const ASK = /^Is this business registered for GST\? Answer it in Settings → Country setup/;

const IN_SHOP = '11111111-1111-4111-8111-198198198198', AU_SHOP = 'aaaaaaaa-2222-4111-8111-198198198198';
const IN_UNREG = '11111111-3333-4111-8111-198198198198', IN_REG = '11111111-4444-4111-8111-198198198198';

(async () => {
  console.log('\n══ ACC-198 · tax registration unknown is a question, never a yes, never a no ══\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why + '\n\n0 checks'); return; }
  /* the twin's db: b299 is there (information_schema answers), and each shop's identity + governance rows are this test's */
  const ROWS = {}, GOV = {};
  const q0 = X.db.query;
  X.db.query = async (t, v) => {
    const s = String(t);
    if (/information_schema\.columns/.test(s)) return { rows: [{ '?column?': 1 }] };
    if (s.includes('country-setup') && s.includes('FROM identities')) return { rows: ROWS[v[0]] ? [ROWS[v[0]]] : [] };
    if (s.includes('country-setup') && s.includes('FROM entity_governance')) return { rows: v[0] in GOV ? [{ fy_start_month: 4, tax_registration: GOV[v[0]], setup_source: {}, country_setup_at: null }] : [] };
    return q0(t, v);
  };
  const CS = require(path.join(H.API, 'lib', 'country-setup'));
  const TS = require(path.join(H.API, 'lib', 'tax-shelf'));
  const TL = require(path.join(H.API, 'lib', 'tax-lines'));
  const K = require(path.join(H.API, 'lib', 'books-hooks'));

  /* ── 1. the one reader: country-setup.registrationOf ── */
  const reg = (f) => safe(() => (CS.registrationOf ? CS.registrationOf(f) : 'no reader'));
  eq('country-setup · no number, nothing said → unknown', reg({ number: null, scheme: null, tax_registration: null }), 'unknown');
  eq('country-setup · no number, a scheme flag "regular" alone → unknown (a scheme is not a registration)', reg({ number: '', scheme: 'regular', tax_registration: null }), 'unknown');
  eq('country-setup · the owner said "not registered" → unregistered', reg({ number: null, tax_registration: { registered: false } }), 'unregistered');
  eq('country-setup · a GSTIN, no flag → regular (as today)', reg({ number: '33AAAPL1234C1ZL', scheme: null, tax_registration: null }), 'regular');
  eq('country-setup · a GSTIN on composition → composition', reg({ number: '33AAAPL1234C1ZL', scheme: 'composition', tax_registration: null }), 'composition');
  eq('country-setup · "registered" said with its scheme → that scheme', reg({ number: null, tax_registration: { registered: true, number: 'X', scheme: 'composition' } }), 'composition');
  eq('country-setup · flag "unregistered" → unregistered (as today)', reg({ number: '33AAAPL1234C1ZL', scheme: 'unregistered', tax_registration: null }), 'unregistered');
  const askIn = safe(() => CS.registrationAsk('IN')), askAu = safe(() => CS.registrationAsk('AU'));
  eq('country-setup · unknown carries a code and the question in the pack\'s tax word (IN)', askIn, { code: 'TAX_REGISTRATION_UNKNOWN', question: 'Is this business registered for GST?' });
  eq('country-setup · … and for AU', askAu, { code: 'TAX_REGISTRATION_UNKNOWN', question: 'Is this business registered for GST?' });
  ROWS[IN_SHOP] = { country: 'IN', currency_code: 'INR', gstn: null, timezone: 'Asia/Kolkata', policy_flags: {} };
  GOV[IN_SHOP] = null;
  const prof = await CS.profile(X.db, IN_SHOP, { constitution: false }).catch((e) => ({ tax: 'threw: ' + e.message }));
  eq('country-setup · a freshShop with no tax: the step reads registered null, never false', prof.tax, { registered: null, number: null, scheme: null });
  eq('country-setup · registrationOfShop(freshShop) → unknown', await Promise.resolve(CS.registrationOfShop ? CS.registrationOfShop(IN_SHOP) : 'no reader').catch((e) => 'threw: ' + e.message), 'unknown');

  /* ── 2. tax-shelf ── */
  eq('tax-shelf · registrationMayCharge(unknown) → null (ask), not true', safe(() => TS.registrationMayCharge('unknown')), null);
  eq('tax-shelf · chargesTax(unknown) → null (ask), not false', safe(() => TS.chargesTax({ gstin: null, reg_type: 'unknown' }, null)), null);
  eq('tax-shelf · stated: regular · composition · unregistered · unset flag → true · false · false · true (unchanged)',
    ['regular', 'composition', 'unregistered', undefined].map((x) => TS.registrationMayCharge(x)), [true, false, false, true]);
  eq('tax-shelf · chargesTax with a GSTIN and no flag → true; without one → false (unchanged)',
    [TS.chargesTax({ gstin: '33AAAPL1234C1ZL' }, null), TS.chargesTax({ gstin: null }, null)], [true, false]);

  /* ── 3. tax-lines.partyOf ── */
  eq('tax-lines · partyOf a row read with its governance, nothing said, no number → RegType unknown',
    TL.partyOf({ gstn: null, country: 'IN', policy_flags: {}, tax_registration: null }).RegType, 'unknown');
  eq('tax-lines · … the owner said no → unregistered', TL.partyOf({ gstn: null, country: 'IN', policy_flags: {}, tax_registration: { registered: false } }).RegType, 'unregistered');
  eq('tax-lines · … a GSTIN → regular; composition stays composition',
    [TL.partyOf({ gstn: '33AAAPL1234C1ZL', country: 'IN', policy_flags: {}, tax_registration: null }).RegType,
      TL.partyOf({ gstn: '33AAAPL1234C1ZL', country: 'IN', policy_flags: { gst_registration: 'composition' }, tax_registration: null }).RegType], ['regular', 'composition']);
  eq('tax-lines · a row read without governance keeps the flag as today (regular when none)', TL.partyOf({ gstn: null, policy_flags: {} }).RegType, 'regular');

  /* ── 4. books-hooks: the seller gate (classify) ── */
  const invIn = { currency: 'INR', _cb: { supply: 'unknown' }, ItemList: [{ GstRt: 0, AssAmt: 100, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, CesAmt: 0 }] };
  const S_IN = { enabled: true, walkin_grain: 'bill', country: 'IN', functional_currency: 'INR' };
  const sale = (RegType, Country, inv, set) => K.classify({ chit: { chit_id: 'k1', purpose: 'order', currency_code: inv.currency,
    business_json: { bill_no: 'C1-0001', till: { id: 'C1' }, billed_at: '2026-10-17T05:00:00Z', payment: { parts: [{ how: 'Cash', amount: 100 }] } } },
  entry: { sells: true, seller: { Gstin: null, RegType, Country }, invoice: inv }, setting: set || S_IN });
  const kU = sale('unknown', 'IN', invIn);
  eq('books-hooks · a sale by a seller of unknown registration → queue, coded, with the question', [kU.kind, kU.code, ASK.test(kU.why || '')], ['queue', 'TAX_REGISTRATION_UNKNOWN', true]);
  eq('books-hooks · stated unregistered · composition · regular (no number) → posts as today, never this wait',
    ['unregistered', 'composition', 'regular'].map((r) => { const k = sale(r, 'IN', invIn); return [k.kind, k.code || null]; }), [['post', null], ['post', null], ['post', null]]);

  /* ── 5. through postChit on the twin: IN and AU freshShops with no tax wait; stated shops post ── */
  const TC = require(path.join(H.API, 'lib', 'tax-copy')); const wasC = TC.copyOf, wasE = TC.entryFor;
  let copyNow = null, entryNow = null;
  TC.copyOf = async () => copyNow; TC.entryFor = async () => entryNow;
  const copy = (id, cur, amount) => ({ chit_id: id, purpose: 'order', currency_code: cur, created_at: '2026-10-17T05:00:00Z',
    business_json: { bill_no: 'C1-' + id, till: { id: 'C1' }, billed_at: '2026-10-17T05:00:00Z', payment: { parts: [{ how: 'Cash', amount }] } } });
  const shop = async (id, s, row, gov) => { ROWS[id] = row; GOV[id] = gov; X.T.identities.push(Object.assign({ identity_id: id, display_name: 'Shop ' + id.slice(-4) }, row));
    await X.store.saveSetting(X.db, id, s); await X.B.enable(X.db, id, { by: id, today: '2026-10-17' }); K.forget(id); CS.forget(id); };
  const seller = (row) => TL.partyOf(row, {});
  const posted = (id, ref) => X.T.entries.filter((e) => e.entity_id === id && e.source_ref === ref).length;
  const waiting = (id) => X.T.outbox.find((o) => o.source_chit_id === id && !o.done_at);

  await shop(IN_SHOP, S_IN, ROWS[IN_SHOP], null);
  copyNow = copy('fin1', 'INR', 100); entryNow = { sells: true, seller: seller(ROWS[IN_SHOP]), invoice: invIn };
  const r1 = await K.postChit(IN_SHOP, 'fin1', {});
  const w1 = waiting('fin1');
  eq('IN freshShop, no tax · a counter bill (no rate on any line) WAITS with the question; nothing posts',
    [!!r1.queued, !!(w1 && ASK.test(w1.why)), posted(IN_SHOP, 'bill:fin1')], [true, true, 0]);
  const invRated = { currency: 'INR', _cb: { supply: 'unknown' }, ItemList: [{ GstRt: 18, AssAmt: 100, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, CesAmt: 0 }] };
  copyNow = copy('fin2', 'INR', 100); entryNow = { sells: true, seller: seller(ROWS[IN_SHOP]), invoice: invRated };
  const r2 = await K.postChit(IN_SHOP, 'fin2', {});
  const w2 = waiting('fin2');
  eq('IN freshShop, no tax · a line rated 18% WAITS with the registration question (not "state unknown"); never at 0',
    [!!r2.queued, !!(w2 && ASK.test(w2.why)), posted(IN_SHOP, 'bill:fin2')], [true, true, 0]);

  const S_AU = { enabled: true, walkin_grain: 'bill', country: 'AU', functional_currency: 'AUD', fy_start_month: 7 };
  await shop(AU_SHOP, S_AU, { country: 'AU', currency_code: 'AUD', gstn: null, timezone: 'Australia/Sydney', policy_flags: {} }, null);
  const invAu = { currency: 'AUD', _cb: { scheme: 'GST' }, ItemList: [{ GstRt: 0, AssAmt: 10, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, TaxAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 10 } };
  copyNow = copy('fau1', 'AUD', 10); entryNow = { sells: true, seller: seller(ROWS[AU_SHOP]), invoice: invAu };
  const r3 = await K.postChit(AU_SHOP, 'fau1', {});
  const w3 = waiting('fau1');
  eq('AU freshShop, no tax · a counter bill WAITS with "Is this business registered for GST?"; nothing posts',
    [!!r3.queued, !!(w3 && ASK.test(w3.why)), posted(AU_SHOP, 'bill:fau1')], [true, true, 0]);

  await shop(IN_UNREG, S_IN, { country: 'IN', currency_code: 'INR', gstn: null, timezone: 'Asia/Kolkata', policy_flags: {} }, { registered: false });
  copyNow = copy('fun1', 'INR', 100); entryNow = { sells: true, seller: seller(ROWS[IN_UNREG]), invoice: invIn };
  const r4 = await K.postChit(IN_UNREG, 'fun1', {});
  ok('IN, the owner said "not registered" · the bill posts as today (no wait)', !r4.queued && posted(IN_UNREG, 'bill:fun1') === 1, JSON.stringify(r4));

  const invReg = { currency: 'INR', _cb: { supply: 'intra' }, ItemList: [{ GstRt: 18, AssAmt: 100, CgstAmt: 9, SgstAmt: 9, IgstAmt: 0, CesAmt: 0 }] };
  await shop(IN_REG, S_IN, { country: 'IN', currency_code: 'INR', gstn: '33AAAPL1234C1ZL', timezone: 'Asia/Kolkata', policy_flags: { gst_registration: 'regular' } }, null);
  copyNow = copy('freg1', 'INR', 118); entryNow = { sells: true, seller: seller(ROWS[IN_REG]), invoice: invReg };
  const r5 = await K.postChit(IN_REG, 'freg1', {});
  ok('IN, registered (a GSTIN) · the bill posts with its tax as today', !r5.queued && posted(IN_REG, 'bill:freg1') === 1, JSON.stringify(r5));
  TC.copyOf = wasC; TC.entryFor = wasE;

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n\n' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
