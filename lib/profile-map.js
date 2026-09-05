/**
 * lib/profile-map.js — WHAT WE LOOK FOR ABOUT A STORE, WHERE IT COMES FROM, AND HOW MUCH TO TRUST IT.
 *
 * Athi, 2026-09-05: "how do we build our profile from Tally or any other system — name, GSTIN, state and other things;
 * how do we map our governance layer against Tally; do we have a map of what we look for, how do we fill it, and
 * what is the authenticity?" This file IS the map. Three things per field:
 *   WHAT and WHY — the governance layer that needs it (identity · tax · contact · jurisdiction · banking)
 *   WHERE — the key each outside system holds it under (Tally company master · Zoho organisation · a profile.csv)
 *   HOW TRUSTED — the rung the value sits on:
 *       declared   the person typed it
 *       copied     read from the store's OWN system, stamped with source + as_of (still the store's word, but a
 *                  record it keeps for the tax office — better than a typed box, and it moves when their books move)
 *       checked    passes a check we can do alone: GSTIN structure + CHECK DIGIT, PAN embedded in the GSTIN, state
 *                  code vs the address state, PIN vs state range
 *       verified   confirmed against the authority's registry (lib/verify.js — key-ready; CB_KYB_PROVIDER)
 *   A lower rung NEVER overwrites a higher one. Equal rungs: the newer as_of wins.
 *
 * ── ZERO DEPENDENCIES · PURE — the routes read and write; this decides ─────────────────────────────────────
 */
'use strict';
const RUNGS = ['declared', 'copied', 'checked', 'verified'];
const rank = (r) => Math.max(0, RUNGS.indexOf(String(r || 'declared')));

/** the map: what we look for. `sources` name the key in each outside system; `derive` says what fills it when the source does not. */
const FIELDS = [
  { key: 'legal_name', label: 'Legal name', layer: 'identity', why: 'the name on the registration — the invoice and every attestation carry it', sources: { tally: 'BASICCOMPANYFORMALNAME (else NAME)', zoho: 'organization.name', csv: 'legal_name' }, check: 'registry' },
  { key: 'trade_name', label: 'Trade / brand name', layer: 'identity', why: 'what the storefront and the chit show', sources: { tally: 'NAME', zoho: 'organization.name', csv: 'trade_name' } },
  { key: 'gstin', label: 'GSTIN', layer: 'tax', why: 'the tax identity: state (2 digits), PAN (10), entity code, check digit — the invoice, the ledger and the GSTR need it', sources: { tally: 'GSTREGISTRATIONNUMBER', zoho: 'organization.gst_no / tax_settings', csv: 'gstin' }, check: 'checksum+registry' },
  { key: 'pan', label: 'PAN', layer: 'tax', why: 'the income-tax identity; embedded in the GSTIN (characters 3–12)', sources: { tally: 'INCOMETAXNUMBER', zoho: 'organization.pan_no', csv: 'pan' }, derive: 'from GSTIN', check: 'consistency' },
  { key: 'reg_type', label: 'GST registration type', layer: 'tax', why: 'regular charges tax and passes credit; composition charges none; unregistered charges none', sources: { tally: 'GSTREGISTRATIONTYPE', zoho: 'tax_settings.tax_reg_type', csv: 'reg_type' } },
  { key: 'state', label: 'State', layer: 'jurisdiction', why: 'intra vs inter-state supply — CGST/SGST vs IGST', sources: { tally: 'STATENAME', zoho: 'address.state', csv: 'state' }, derive: 'from GSTIN state code', check: 'consistency' },
  { key: 'address', label: 'Address', layer: 'contact', why: 'the invoice header; the place of supply when goods are handed over here', sources: { tally: 'ADDRESS.LIST', zoho: 'address.street_address1/2', csv: 'address' } },
  { key: 'city', label: 'City', layer: 'contact', why: 'the invoice header', sources: { tally: 'ADDRESS.LIST (last line) / city', zoho: 'address.city', csv: 'city' } },
  { key: 'pincode', label: 'PIN', layer: 'jurisdiction', why: 'delivery zones; the first digits agree with the state', sources: { tally: 'PINCODE', zoho: 'address.zip', csv: 'pincode' }, check: 'consistency' },
  { key: 'country', label: 'Country', layer: 'jurisdiction', why: 'the scheme (GST vs VAT-type) and the border for cross-border supply', sources: { tally: 'COUNTRYNAME', zoho: 'address.country', csv: 'country' }, derive: 'IN when a GSTIN exists' },
  { key: 'phone', label: 'Phone', layer: 'contact', why: 'the customer\'s way back; the invoice header', sources: { tally: 'PHONENUMBER / MOBILENUMBERS', zoho: 'organization.phone', csv: 'phone' } },
  { key: 'email', label: 'Email', layer: 'contact', why: 'the invoice header; notices', sources: { tally: 'EMAIL', zoho: 'organization.email', csv: 'email' } },
  { key: 'currency', label: 'Currency', layer: 'jurisdiction', why: 'every price is stated in it', sources: { tally: 'BASECURRENCYSYMBOL / ISO', zoho: 'organization.currency_code', csv: 'currency' }, derive: 'INR when the country is IN' },
  { key: 'upi_id', label: 'UPI id', layer: 'banking', why: 'the QR on an order (payment loop, level 1 — LIVE)', sources: { tally: '—', zoho: '—', csv: 'upi_id' } },
  { key: 'bank_account', label: 'Bank account', layer: 'banking', why: 'the invoice footer; settlement', sources: { tally: 'bank ledger (BANKDETAILS)', zoho: 'bank_accounts', csv: 'bank_account' } },
  { key: 'ifsc', label: 'IFSC', layer: 'banking', why: 'with the account', sources: { tally: 'bank ledger IFSCODE', zoho: 'bank_accounts.ifsc', csv: 'ifsc' } },
];
const STATE_NAMES = { '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh' };
const PIN_STATE = [['11', '07'], ['12', '06'], ['13', '06'], ['14', '06'], ['15', '03'], ['16', '03'], ['17', '02'], ['18', '09'], ['19', '09'], ['20', '09'], ['21', '09'], ['22', '09'], ['23', '09'], ['24', '09'], ['25', '09'], ['26', '09'], ['27', '09'], ['28', '09'], ['30', '08'], ['31', '08'], ['32', '08'], ['33', '08'], ['34', '08'], ['36', '24'], ['37', '24'], ['38', '24'], ['39', '24'], ['40', '27'], ['41', '27'], ['42', '27'], ['43', '27'], ['44', '27'], ['45', '23'], ['46', '23'], ['47', '23'], ['48', '23'], ['49', '22'], ['50', '36'], ['51', '37'], ['52', '37'], ['53', '37'], ['56', '29'], ['57', '29'], ['58', '29'], ['59', '29'], ['60', '33'], ['61', '33'], ['62', '33'], ['63', '33'], ['64', '33'], ['67', '32'], ['68', '32'], ['69', '32'], ['70', '19'], ['71', '19'], ['72', '19'], ['73', '19'], ['74', '19'], ['75', '21'], ['76', '21'], ['77', '21'], ['78', '18'], ['79', '18'], ['80', '10'], ['81', '10'], ['82', '20'], ['83', '20'], ['84', '10'], ['85', '10']];

/** GSTIN check digit — base-36 Luhn-style (the official algorithm): the 15th character must equal the computed digit */
function gstinChecksum(g) {
  const s = String(g || '').trim().toUpperCase(); if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)) return { ok: false, reason: 'format' };
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let sum = 0;
  for (let i = 0; i < 14; i++) { const v = chars.indexOf(s[i]); const f = (i % 2 === 0) ? 1 : 2; let p = v * f; p = Math.floor(p / 36) + (p % 36); sum += p; }
  const check = chars[(36 - (sum % 36)) % 36];
  return { ok: check === s[14], reason: check === s[14] ? null : 'check digit', expected: check };
}
function stateOfGstin(g) { const s = String(g || '').trim(); return /^\d{2}/.test(s) ? s.slice(0, 2) : null; }
function panOfGstin(g) { const s = String(g || '').trim().toUpperCase(); return /^\d{2}[A-Z]{5}\d{4}[A-Z]/.test(s) ? s.slice(2, 12) : null; }
function stateCodeOfName(name) { const n = String(name || '').trim().toLowerCase(); for (const [code, nm] of Object.entries(STATE_NAMES)) if (nm.toLowerCase() === n) return code; return /^\d{2}$/.test(n) ? n : null; }
function stateOfPin(pin) { const p = String(pin || '').trim(); if (!/^\d{6}$/.test(p)) return null; const row = PIN_STATE.find(([pre]) => p.startsWith(pre)); return row ? row[1] : null; }

/**
 * assess(values) — values: { key: { value, source?, as_of?, rung? } } → per field: value · rung (raised to 'checked' when a
 * check passes) · issues[] (a check that fails) · derived (filled from another field). Pure.
 */
function assess(values) {
  const v = Object.assign({}, values || {}); const out = {}; const issues = [];
  const get = (k) => (v[k] && v[k].value != null && String(v[k].value).trim() !== '') ? String(v[k].value).trim() : null;
  const gst = get('gstin'); const gstState = stateOfGstin(gst); const gstPan = panOfGstin(gst);
  let gstCheck = null;
  if (gst) { gstCheck = gstinChecksum(gst); if (!gstCheck.ok) issues.push({ key: 'gstin', issue: gstCheck.reason === 'format' ? 'not a GSTIN shape' : 'check digit does not match — one character is wrong' }); }
  const derived = {};
  if (!get('pan') && gstPan) derived.pan = { value: gstPan, from: 'gstin' };
  if (!get('state') && gstState) derived.state = { value: gstState, from: 'gstin' };
  if (!get('country') && gst) derived.country = { value: 'IN', from: 'gstin' };
  if (!get('currency') && (get('country') === 'IN' || (!get('country') && gst))) derived.currency = { value: 'INR', from: 'country' };
  const pan = get('pan'); if (pan && gstPan && pan.toUpperCase() !== gstPan) issues.push({ key: 'pan', issue: 'PAN ' + pan + ' differs from the PAN inside the GSTIN (' + gstPan + ')' });
  const stateCode = stateCodeOfName(get('state')); if (stateCode && gstState && stateCode !== gstState) issues.push({ key: 'state', issue: 'state ' + get('state') + ' is not the GSTIN\'s state (' + gstState + ' ' + (STATE_NAMES[gstState] || '') + ')' });
  const pinState = stateOfPin(get('pincode')); const st = stateCode || gstState; if (pinState && st && pinState !== st) issues.push({ key: 'pincode', issue: 'PIN ' + get('pincode') + ' belongs to ' + (STATE_NAMES[pinState] || pinState) + ', not ' + (STATE_NAMES[st] || st) });
  for (const f of FIELDS) {
    const cur = v[f.key] || {}; const val = get(f.key) != null ? get(f.key) : (derived[f.key] ? derived[f.key].value : null);
    let rung = val == null ? null : (cur.value != null && String(cur.value).trim() !== '' ? (cur.rung || 'declared') : 'declared');
    const bad = issues.some((i) => i.key === f.key);
    if (val != null && !bad && rank(rung) < rank('checked')) {
      if (f.key === 'gstin' && gstCheck && gstCheck.ok) rung = 'checked';
      if (f.key === 'pan' && gstPan && val.toUpperCase() === gstPan) rung = 'checked';
      if (f.key === 'state' && gstState && (stateCodeOfName(val) === gstState || val === gstState)) rung = 'checked';
      if (f.key === 'pincode' && pinState && st && pinState === st) rung = 'checked';
    }
    out[f.key] = { key: f.key, label: f.label, layer: f.layer, why: f.why, sources: f.sources, value: val, rung, source: cur.source || (derived[f.key] ? 'derived:' + derived[f.key].from : null), as_of: cur.as_of || null,
                   derived: !!derived[f.key] && get(f.key) == null, issues: issues.filter((i) => i.key === f.key).map((i) => i.issue), missing: val == null };
  }
  const filled = FIELDS.filter((f) => out[f.key].value != null).length;
  return { fields: out, order: FIELDS.map((f) => f.key), issues, filled, total: FIELDS.length, rungs: RUNGS, state_name: st ? (STATE_NAMES[st] || null) : null };
}

/** merge(current, incoming) — incoming rows { key, value, source, as_of, rung } land only where they outrank or tie-and-are-newer */
function merge(current, incoming) {
  const cur = Object.assign({}, current || {}); const written = [], kept = [];
  for (const inc of incoming || []) {
    if (!inc || !inc.key || inc.value == null || String(inc.value).trim() === '') continue;
    const have = cur[inc.key]; const rIn = rank(inc.rung || 'declared');
    if (have && have.value != null && String(have.value).trim() !== '') {
      const rHave = rank(have.rung || 'declared');
      if (rHave > rIn) { kept.push({ key: inc.key, why: 'a ' + (have.rung || 'declared') + ' value stands above a ' + (inc.rung || 'declared') + ' one' }); continue; }
      if (rHave === rIn && have.as_of && inc.as_of && new Date(inc.as_of) <= new Date(have.as_of) && String(have.value) !== String(inc.value)) { kept.push({ key: inc.key, why: 'the held value is newer' }); continue; }
    }
    cur[inc.key] = { value: String(inc.value).trim(), source: inc.source || null, as_of: inc.as_of || new Date().toISOString(), rung: inc.rung || 'declared' };
    written.push(inc.key);
  }
  return { values: cur, written, kept };
}
module.exports = { FIELDS, RUNGS, STATE_NAMES, gstinChecksum, stateOfGstin, panOfGstin, stateCodeOfName, stateOfPin, assess, merge, rank };
