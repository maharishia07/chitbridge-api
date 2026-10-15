'use strict';
/**
 * pack-words.test.cjs — AU-WORDS (2026-10-15): the words a screen says for a shop's country come from ONE reader (lib/pack-words), per pack.
 *  - wordsFor: IN GSTIN · GST · GSTR-3B; AU ABN · GST · BAS; AE TRN · VAT · VAT return; no pack / unknown country → neutral words, never India's
 *  - registrationKindsFor: the STORED enum is unchanged (every key is one of policy.FLAGS.gst_registration.options); IN offers four, AU and AE two;
 *    the thresholds in the help are the pack's own numbers (AUD 75,000 · AED 375,000), never typed
 *  - tradeChecksFor: IN asks for a PAN, AU does not, AE asks for the trade licence; the tax id's label is the pack's word
 *  - retentionWordsFor: the pack's retentionYears in words, else the platform's floor
 *  - policy.schemaFor: the registration row's options · labels · help · label are the pack's; retention's 0 is a word; nothing else changes
 *  - policy.kindRefusal: a kind the pack does not offer is refused with the pack's choices
 * Run: node tests/pack-words.test.cjs   · no DB, no network.
 */
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + name + (extra ? '   ' + extra : '')); } else { fail++; console.log('  FAIL ' + name + (extra ? '   ' + extra : '')); } };

const words = require(path.join(API, 'lib', 'pack-words'));
const policy = require(path.join(API, 'lib', 'policy'));
const INDIA = /GSTIN|PAN|₹|GSTR|composition|SEZ/i;

/* ── wordsFor ── */
const w = (c) => words.wordsFor(c);
t('IN: GSTIN · GST · GST registration · GSTR-3B · INR', w('IN').taxId === 'GSTIN' && w('IN').taxName === 'GST' && w('IN').registration === 'GST registration' && w('IN').returnShort === 'GSTR-3B' && w('IN').currency === 'INR');
t('AU: ABN · GST · BAS · AUD (the return name is the pack\'s returns.short)', w('AU').taxId === 'ABN' && w('AU').taxName === 'GST' && w('AU').returnShort === 'BAS' && w('AU').currency === 'AUD');
t('AE: TRN · VAT · VAT registration · VAT return · AED', w('AE').taxId === 'TRN' && w('AE').taxName === 'VAT' && w('AE').registration === 'VAT registration' && w('AE').returnShort === 'VAT return' && w('AE').currency === 'AED');
t('no country / unknown country / lower case: neutral words, never India\'s', [w(''), w(null), w('US')].every((x) => x.taxId === 'Tax number' && x.registration === 'Tax registration' && x.returnShort === null && !x.hasPack) && w('au').taxId === 'ABN');
t('a pack object may be handed in (what sides and the header hold)', w(require(path.join(API, 'lib', 'regulation')).packFor('AE')).taxId === 'TRN');

/* ── registrationKindsFor: the stored enum never changes ── */
const stored = policy.FLAGS.gst_registration.options;
for (const c of ['IN', 'AU', 'AE', '']) {
  const kinds = words.registrationKindsFor(c);
  t('kinds for ' + (c || 'no pack') + ' are all STORED enum values (' + kinds.map((k) => k.key).join(' · ') + ')', kinds.length >= 2 && kinds.every((k) => stored.includes(k.key) && k.label && k.help));
}
t('IN offers the four India has: regular · composition · unregistered · sez', words.registrationKindsFor('IN').map((k) => k.key).join() === 'regular,composition,unregistered,sez');
const auKinds = words.registrationKindsFor('AU'), aeKinds = words.registrationKindsFor('AE');
t('AU offers two: GST registered · Not registered — never composition or SEZ', auKinds.map((k) => k.label).join() === 'GST registered,Not registered' && !auKinds.some((k) => /composition|sez/.test(k.key)));
t('AU: the threshold is the pack\'s own number (AUD 75,000) and GST-free is said to be on the item', /AUD 75,000/.test(auKinds[1].help) && /GST-free/.test(auKinds[0].help));
t('AE offers two: VAT registered · Not registered, the threshold AED 375,000 from the pack', aeKinds.map((k) => k.label).join() === 'VAT registered,Not registered' && /AED 375,000/.test(aeKinds[1].help));
t('AU / AE kinds carry no India word', !INDIA.test(JSON.stringify(auKinds)) && !INDIA.test(JSON.stringify(aeKinds)));
t('thresholdWords: the pack\'s minor units in its money; null with no pack', words.thresholdWords(require(path.join(API, 'lib', 'regulation')).packFor('AU')) === 'AUD 75,000' && words.thresholdWords(null) === null);

/* ── tradeChecksFor ── */
const ck = (c) => words.tradeChecksFor(c).map((x) => x.key + ':' + x.label).join();
t('IN: address · phone · PAN on file · GSTIN', ck('IN') === 'address:Address proven,phone:Phone verified,pan:PAN on file,tax_id:GSTIN', ck('IN'));
t('AU: address · phone · ABN (no PAN)', ck('AU') === 'address:Address proven,phone:Phone verified,tax_id:ABN', ck('AU'));
t('AE: address · phone · TRN · Trade licence', ck('AE') === 'address:Address proven,phone:Phone verified,tax_id:TRN,trade_licence:Trade licence', ck('AE'));
t('no pack: address · phone · Tax number', ck('') === 'address:Address proven,phone:Phone verified,tax_id:Tax number', ck(''));

/* ── retentionWordsFor ── */
t('AU / AE: the pack\'s 5 years in words', words.retentionWordsFor('AU').years === 5 && /5 years/.test(words.retentionWordsFor('AU').words) && words.retentionWordsFor('AE').years === 5);
t('no pack: the platform floor (policy.RECORDS_FLOOR_YEARS)', words.retentionWordsFor('').years === policy.RECORDS_FLOOR_YEARS && new RegExp(policy.RECORDS_FLOOR_YEARS + ' years').test(words.retentionWordsFor('').words));

/* ── policy.schemaFor ── */
const sAU = policy.schemaFor('AU'), sAE = policy.schemaFor('AE'), sIN = policy.schemaFor('IN'), sNone = policy.schemaFor(null);
t('AU schema: the registration row offers regular · unregistered under "GST registration", labels + help the pack\'s', sAU.gst_registration.ui.options.join() === 'regular,unregistered' && sAU.gst_registration.ui.label === 'GST registration' && sAU.gst_registration.ui.labels.regular === 'GST registered' && /GST REGISTERED —/.test(sAU.gst_registration.ui.help));
t('AE schema: "VAT registration", VAT registered · Not registered', sAE.gst_registration.ui.label === 'VAT registration' && sAE.gst_registration.ui.labels.unregistered === 'Not registered' && sAE.gst_registration.ui.options.length === 2);
t('IN schema: the four kinds, as before', sIN.gst_registration.ui.options.join() === 'regular,composition,unregistered,sez' && sIN.gst_registration.ui.labels.sez === 'SEZ');
t('no country: neutral registration words, never India\'s', sNone.gst_registration.ui.label === 'Tax registration' && !INDIA.test(JSON.stringify(sNone.gst_registration.ui)));
t('the AU / AE registration rows and retention rows hold no India word', !INDIA.test(JSON.stringify([sAU.gst_registration.ui, sAE.gst_registration.ui, sAU.retention_days.ui, sAE.retention_days.ui])));
t('retention 0 is a word with the pack\'s floor; chit expiry 0 is "No expiry"', /5 years/.test(sAU.retention_days.ui.labels[0]) && sAU.chit_expiry_days.ui.labels[0] === 'No expiry' && policy.FLAGS.retention_days.ui.labels[0] === 'Keep');
t('schemaFor never mutates FLAGS (the registration row\'s own ui keeps India\'s words for the stored defaults)', policy.FLAGS.gst_registration.ui.options === undefined && policy.FLAGS.gst_registration.options.length === 4);
t('every other row is the same object as FLAGS', Object.keys(policy.FLAGS).filter((k) => k !== 'gst_registration' && k !== 'retention_days').every((k) => sAU[k] === policy.FLAGS[k]));
t('the stored enum is the same for every country: coerce accepts all four everywhere (the pack only says what is OFFERED)', policy.coerce('gst_registration', 'composition') === 'composition');

/* ── policy.kindRefusal ── */
t('AU: composition is refused with the pack\'s choices', /GST registered · Not registered/.test(policy.kindRefusal('AU', 'composition') || ''));
t('AU: regular is allowed; IN: composition is allowed; no country: unregistered is allowed', policy.kindRefusal('AU', 'regular') === null && policy.kindRefusal('IN', 'composition') === null && policy.kindRefusal(null, 'unregistered') === null);
t('no country: sez is refused in neutral words', policy.kindRefusal(null, 'sez') !== null && !INDIA.test(policy.kindRefusal(null, 'sez')));
t('the refusal code is exported for the route', policy.REG_KIND_NOT_OFFERED === 'REG_KIND_NOT_OFFERED');

console.log(`\n  ${pass} checks · ${fail} failed\n`);
process.exitCode = fail ? 1 : 0;
