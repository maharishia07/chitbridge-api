'use strict';
// @type: unit
/**
 * ui-codes-w2-crm.test.cjs - the one-pass CRM lane: the three SHARED scripts wear their identity codes, and the lane's headers say who calls them (UX-137, 13 Nov).
 *
 * OWNS      the proof that app/cap-quotes.js (SCR060), app/cap-showcase.js (SCR061) and app/showcase-templates.js (SCR062) carry their data-cbsid codes INSIDE the
 *           tag of the control they name (a swap of two codes, or a removed code, fails it), that the two library controls of cap-quotes wear their component
 *           code (Try again CMP009, Cancel CMP003), that no code sits on two element definitions, and that every file of the lane keeps ONE module header
 *           with OWNS, CALLED BY, FLOW and exactly one CARD line (cap-intake.js and cap-messages.js are SUPPORT, app.html only, and trip the readability test-minimums on old debt: left as they are) (cap-showcase no longer names cart.js: nothing there calls CBShowcasePick).
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-w2-crm.test.cjs   (W2CRM_MUTATE=remove or swap must fail it)
 * FLOW      read each script, find every code, read from the '<' before it to the next '>' and compare with the control it names, then the headers
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as pending
 *           (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.W2CRM_MUTATE || '';
const PUB = path.join(__dirname, '..', 'public');

/** [file, code, the tag it must sit in, a marker that tag carries] */
const CODES = [
  ['app/cap-quotes.js', 'CMP009', 'button', 'data-testid="quotes-retry"'],
  ['app/cap-quotes.js', 'SCR060-B01', 'button', 'data-testid="quote-accept-'],
  ['app/cap-quotes.js', 'SCR060-B02', 'button', 'data-testid="quote-counter-'],
  ['app/cap-quotes.js', 'SCR060-B03', 'button', 'data-testid="quote-reject-'],
  ['app/cap-quotes.js', 'SCR060-I01', 'input', 'data-f="quantity"'],
  ['app/cap-quotes.js', 'SCR060-I02', 'input', 'data-testid="quote-price-'],
  ['app/cap-quotes.js', 'SCR060-T01', 'textarea', 'data-testid="quote-note"'],
  ['app/cap-quotes.js', 'SCR060-B04', 'button', 'data-testid="quote-send"'],
  ['app/cap-quotes.js', 'CMP003', 'button', 'data-testid="quote-cancel"'],
  ['app/cap-quotes.js', 'SCR060-B05', 'button', 'data-testid="quote-price-new"'],
  ['app/cap-quotes.js', 'SCR060-B06', 'button', 'data-testid="quote-ask-again"'],
  ['app/cap-showcase.js', 'SCR061-B01', 'button', 'type="button"'],
  ['app/showcase-templates.js', 'SCR062-B01', 'button', 'data-sc="share"'],
  ['app/showcase-templates.js', 'SCR062-I01', 'input', 'data-sc="search"'],
  ['app/showcase-templates.js', 'SCR062-B02', 'button', 'data-sc-cat='],
  ['app/showcase-templates.js', 'SCR062-B03', 'button', 'data-sc="copy"'],
  ['app/showcase-templates.js', 'SCR062-B04', 'button', 'data-sc-add=']
];
/** the lane's files: each must keep one header with these four labels, and say what it must (or must not) name */
const HEADERS = [
  ['app/cap-crm-leads.js', [/cap-crm-record\.js/, /cap-crm-calls\.js/]],
  ['app/cap-crm-privacy.js', [/cap-crm-record\.js/, /crmPrivacy/]],
  ['app/cap-crm-calls.js', [/crmCallClick/]],
  ['app/cap-marketing.js', [/crmFaceNav/, /crmMarketingClick/]],
  ['app/cap-showcase.js', [/cap-crm-groups\.js/, /cap-admin\.js/], [/cart\.js/]],
  ['app/showcase-templates.js', [/shop\.html/, /cap-showcase\.js/], [/cap-definitions/, /cap-mis-trend/]],
  ['app/cap-quotes.js', [/chit-sheet\.js/, /tasks\.html/]],
  ['app/cap-tasks.js', [/cap-dispute\.js/, /cap-assist\.js/]],
  ['app/shop-privacy.js', [/shop\.html/]],
  ['crm.html', [/manifest/, /Marketing/]]
];

const read = (f) => {
  let t = fs.readFileSync(path.join(PUB, f), 'utf8').split('\r\n').join('\n');
  if (mutate === 'remove') t = t.split('data-cbsid="SCR060-B01"').join('');
  if (mutate === 'swap') t = t.split('SCR060-B01').join('SWAPX').split('SCR060-B02').join('SCR060-B01').split('SWAPX').join('SCR060-B02');
  return t;
};
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };
const src = {};
const text = (f) => (src[f] = src[f] || read(f));

/** the open tag around a code: from the '<' before it to the first '>' after it (the strings hold no '>' inside a tag here) */
function tagAround(f, code) {
  const t = text(f), at = t.indexOf('data-cbsid="' + code + '"');
  if (at < 0) return null;
  const open = t.lastIndexOf('<', at), end = t.indexOf('>', at);
  return { name: (t.slice(open + 1, at).match(/^[a-z]+/) || [''])[0], body: t.slice(open, end + 1) };
}
for (const [f, code, tag, marker] of CODES) {
  const found = tagAround(f, code);
  check(!!found && found.name === tag && found.body.indexOf(marker) >= 0, f + ' ' + code + ' sits in its own <' + tag + '> (' + marker + ')');
}
const seen = {};
for (const f of ['app/cap-quotes.js', 'app/cap-showcase.js', 'app/showcase-templates.js']) {
  for (const m of text(f).matchAll(/data-cbsid="((?:SCR|CMP)\d{3}(?:-[A-Z]\d{2})?)"/g)) seen[m[1]] = (seen[m[1]] || 0) + 1;
}
const dup = Object.keys(seen).filter((c) => seen[c] > 1);
check(dup.length === 0, 'no code is written on two element definitions' + (dup.length ? ' (' + dup.join(',') + ')' : ''));
check(Object.keys(seen).length === CODES.length, 'the three scripts carry exactly ' + CODES.length + ' coded element definitions: ' + Object.keys(seen).length);

for (const [f, must, mustNot] of HEADERS) {
  const t = text(f), head = t.slice(0, t.indexOf('*/') > 0 && f.slice(-3) === '.js' ? t.indexOf('*/') : t.indexOf('-->'));
  const labelled = ['OWNS', 'CALLED BY', 'FLOW', 'CARD'].every((l) => new RegExp('^[ *]*(<!--[ ]*)?' + l + '[ ]', 'm').test(head));
  check(labelled, f + ' header has OWNS, CALLED BY, FLOW and CARD lines');
  check((head.match(/\bCARD\s+[\w.-]+\/[\w.-]+/g) || []).length === 1, f + ' header has exactly one CARD line');
  must.forEach((re) => check(re.test(head), f + ' header names ' + re.source));
  (mustNot || []).forEach((re) => check(!re.test(head), f + ' header does not claim ' + re.source));
}

/** the register */
let reg = null;
for (const p of [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json']) {
  if (p && fs.existsSync(p)) { try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) { console.log('  register ' + p + ' not readable: ' + e.message); } }
}
if (reg) {
  const rows = {}; Object.values(reg.screens || {}).forEach((r) => { if (r.code) rows[r.code] = r; });
  const codes = Object.keys(seen), missing = codes.filter((c) => !rows[c]), retired = codes.filter((c) => rows[c] && rows[c].retired);
  console.log('  register: ' + (codes.length - missing.length) + ' of ' + codes.length + ' codes found' + (missing.length ? ' (pending until the docs PR lands: ' + missing.length + ')' : ''));
  if (process.env.UIID_REG) check(!missing.length, "every code is in the register UIID_REG names (" + missing.length + " missing)"); /* a set register: a missing code FAILS, no pending */
  check(retired.length === 0, 'no code is retired in the register');
}
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
