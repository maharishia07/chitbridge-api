'use strict';
// @type: unit
/**
 * ui-codes-w2-fin.test.cjs - the shared accounts shell, the tax-slab picker and the bill-print slip wear their identity codes (UX-137 one-pass, lane w2-fin, 2026-11-13).
 *
 * OWNS      the proof that the nine controls of app/accounts-shell.js (SCR045), app/tax-slab-ui.js (SCR046) and bill-print.html (SCR047) each carry THEIR OWN code
 *           INSIDE their own tag (read from the tag's '<' to the code: no '>' closes the tag in between), that no code is on two tags, that the letter is the
 *           tag's kind, and that the stamp only added attributes (strip them: the markup is the same).
 * CALLED BY by hand and ci.yml: node e2e/ui-codes-w2-fin.test.cjs   (W2FIN_MUTATE=remove|swap must fail it)
 * FLOW      UX-137 one-pass; the rows are in the docs SCREENS.json (twin branch cmdb/w2-fin, screens "Inside a screen" Accounts shell / Tax slab / Bill print).
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as pending (the docs PR lands the rows).
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.W2FIN_MUTATE || '';
const KIND = { button: 'B', input: 'I', select: 'S', textarea: 'T' };
/** file -> [the attribute text the control is found by, the tag it is, the code its own tag must wear] */
const WANT = {
  'app/accounts-shell.js': [['data-use="', 'button', 'SCR045-B01'], ['id="undoBtn"', 'button', 'SCR045-B02'], ['data-testid="confirm-ok"', 'button', 'SCR045-B03']],
  'app/tax-slab-ui.js': [['data-testid="catg-slab"', 'select', 'SCR046-S01'], ["opts.onclick || ''", 'button', 'SCR046-B01'], ['data-testid="rate-pick-', 'button', 'SCR046-B02']],
  'bill-print.html': [['id="w"', 'select', 'SCR047-S01'], ['id="kind"', 'select', 'SCR047-S02'], ['onclick="window.print()"', 'button', 'SCR047-B01']]
};
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8').split('\r\n').join('\n');
const SWAPPED = { 'SCR045-B01': 'SCR045-B02', 'SCR045-B02': 'SCR045-B01', 'SCR046-B01': 'SCR046-B02', 'SCR046-B02': 'SCR046-B01', 'SCR047-S01': 'SCR047-S02', 'SCR047-S02': 'SCR047-S01' };

/** the text of the tag that holds `needle`: from its own '<' forward to the code (or to its '>' when it has none), so a code outside its tag is not found */
function tagUpToCode(src, needle, tagName) {
  const at = src.indexOf(needle);
  if (at < 0) return null;
  const open = src.lastIndexOf('<' + tagName, at);
  const codeAt = src.indexOf('data-cbsid="', at);
  const slice = src.slice(open, codeAt < 0 ? at : codeAt);
  return { slice, closedEarly: /[^=]>/.test(slice), code: codeAt < 0 ? null : src.slice(codeAt + 12, codeAt + 22).replace(/".*/s, '') };
}

for (const file of Object.keys(WANT)) {
  let src = read(file);
  console.log(file);
  if (mutate === 'remove') src = src.split(' data-cbsid="' + WANT[file][0][2] + '"').join('');
  if (mutate === 'swap') src = src.replace(/data-cbsid="(SCR0[0-9]{2}-[A-Z][0-9]{2})"/g, (m, c) => 'data-cbsid="' + (SWAPPED[c] || c) + '"');
  const all = [...src.matchAll(/data-cbsid="(SCR0(?:45|46|47)-[A-Z][0-9]{2})"/g)].map((m) => m[1]);
  check(all.length === WANT[file].length, file + ' carries ' + WANT[file].length + ' codes, found ' + all.length);
  check(new Set(all).size === all.length, 'no code is on two tags');
  for (const [needle, tagName, code] of WANT[file]) {
    const tag = tagUpToCode(src, needle, tagName);
    check(!!tag && !tag.closedEarly && tag.code === code, needle + ' wears ' + code + ' inside its own <' + tagName + '> tag' + (tag ? ' (found ' + tag.code + ')' : ''));
    check(KIND[tagName] === code.charAt(7), code + ' letter is the tag kind');
  }
  check(!/data-cbsid="SCR0(45|46|47)-/.test(src.replace(/ data-cbsid="SCR0(45|46|47)-[A-Z][0-9]{2}"/g, '')), 'stripped: no code is left, the markup is the same');
}

const regPath = [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json'].filter(Boolean).find((p) => fs.existsSync(p));
const reg = regPath ? fs.readFileSync(regPath, 'utf8') : '';
for (const file of Object.keys(WANT)) for (const w of WANT[file]) console.log(reg.indexOf('"' + w[2] + '"') >= 0 || reg.indexOf(w[2]) >= 0 ? '  ok register has ' + w[2] : '  pending ' + w[2] + ' (the docs PR lands the row)');
console.log(failures ? failures + ' FAILED' : 'all ok');
process.exit(failures ? 1 : 0);
