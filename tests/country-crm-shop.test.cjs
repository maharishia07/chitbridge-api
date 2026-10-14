/**
 * country-crm-shop.test.cjs — CX4 (2026-10-13): CRM, shop and catalogue read the SHOP's pack for India, Australia and the UAE.
 *
 *   · R1 a party's GSTIN is checked with the one GSTIN check (profile-map.gstinChecksum) as ABN / TRN already were — a wrong one refused in words
 *   · R4 invoiceParty: a state and a PAN come off the number only under India's pack; the missing word is the pack's tax id; India unchanged
 *   · S1 taxIdWordOf: GSTIN · ABN · TRN from the pack (null with no pack — STD2)
 *   · C4 a "VAT %" column maps to the one rate column
 * Run: node tests/country-crm-shop.test.cjs — no database, no network (the db module is a stand-in answering one identities row).
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

let ROW = {};
require.cache[require.resolve(path.join(API, 'db'))] = { id: 'db', loaded: true, exports: {
  query: async (text) => (/FROM identities/.test(text) ? { rows: [ROW] } : { rows: [] }),
  withEntity: async (_e, fn) => fn({ query: async () => ({ rows: [] }) }),
} };

(async () => {
  const PF = require(path.join(API, 'lib', 'party-fields'));
  const P = require(path.join(API, 'lib', 'profile'));
  const CP = require(path.join(API, 'lib', 'csv-preflight'));

  /* R1 */
  const good = PF.cleanTaxIds([{ scheme: 'gstin', value: '27aapfu0939f1zv' }]);
  ok('R1 a right GSTIN is stored as before (upper, no spaces)', good.length === 1 && good[0].value === '27AAPFU0939F1ZV', JSON.stringify(good));
  let e1 = null; try { PF.cleanTaxIds([{ scheme: 'GSTIN', value: '27AAPFU0939F1Z1' }]); } catch (e) { e1 = e; }
  ok('R1 a wrong check digit → 400 in words', e1 && e1.status === 400 && /does not check out/.test(e1.message), e1 && e1.message);
  let e2 = null; try { PF.cleanTaxIds([{ scheme: 'GSTIN', value: 'HELLO' }]); } catch (e) { e2 = e; }
  ok('R1 not a GSTIN shape → 400 in words', e2 && e2.status === 400 && /does not look like a GSTIN/.test(e2.message), e2 && e2.message);
  let e3 = null; try { PF.cleanTaxIds([{ scheme: 'ABN', value: '51 824 753 556' }]); } catch (e) { e3 = e; }
  ok('R1 an ABN still goes through reg-au (unchanged)', !e3, e3 && e3.message);

  /* S1 */
  ok('S1 taxIdWordOf: IN GSTIN · AU ABN · AE TRN · none null (STD2: never GSTIN for an unstated country)', P.taxIdWordOf('IN') === 'GSTIN' && P.taxIdWordOf('AU') === 'ABN' && P.taxIdWordOf('ae') === 'TRN' && P.taxIdWordOf('') === null && P.taxIdWordOf('US') === null);

  /* R4 */
  ROW = { display_name: 'Sim Stores', gstn: '33AAPFU0939F1ZV', address: 'Anna Salai', phone: '9876543210', country: 'IN', currency_code: 'INR' };
  const inP = await P.invoiceParty('e-in');
  ok('R4 India: state and PAN off the GSTIN, as before', inP.state_code === '33' && inP.pan === 'AAPFU0939F' && inP.complete && /GSTIN on Profile$/.test(inP.fix), JSON.stringify(inP));
  ROW = { display_name: 'Sim Sydney', gstn: '51824753556', address: '1 George St', phone: '+61290000000', country: 'AU', currency_code: null };
  const auP = await P.invoiceParty('e-au');
  ok('R4 Australia: no state off an ABN ("51" is not a state), no PAN, the pack\'s money', auP.state_code === null && auP.pan === null && auP.currency === 'AUD', JSON.stringify(auP));
  ok('R4 Australia: what is missing is said, the fix names the ABN', auP.missing.indexOf('state') >= 0 && /ABN on Profile$/.test(auP.fix));
  ROW = { display_name: 'Sim Dubai', gstn: null, address: 'Deira', phone: '+97140000000', country: 'AE', currency_code: 'AED' };
  const aeP = await P.invoiceParty('e-ae');
  ok('R4 UAE: a missing tax id is called TRN, never gstin', aeP.missing.indexOf('TRN') >= 0 && aeP.missing.indexOf('gstin') < 0, JSON.stringify(aeP.missing));

  /* C4 */
  const cols = require(path.join(API, 'lib', 'csv')).templateFor({ orderInput: { preset: 'cart', pipeline: 'commerce' }, schema: { properties: {} } }).columns;
  for (const h of ['VAT %', 'vat rate', 'VAT']) { const m = CP.matchHeader(h, cols); ok('C4 "' + h + '" → gst_rate (the one rate column), as "GST %" is', m && m.suggest === 'gst_rate' && m.suggest === CP.matchHeader('GST %', cols).suggest, JSON.stringify(m)); }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
