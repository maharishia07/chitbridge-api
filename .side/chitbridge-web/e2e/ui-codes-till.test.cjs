'use strict';
// @type: unit
/**
 * ui-codes-till.test.cjs - the counter (public/till.html, vendored from the api master) wears ITS identity codes (UX-137, screens CTR002..CTR008).
 *
 * OWNS      the proof that every control of public/till.html (the census tag rule: button, input, select, textarea, a role-tab / menuitem / button, and any tag with
 *           onclick or data-act) carries a data-cbsid code, that no screen code is written twice (a component code CMP### is reused by design), that inside one screen
 *           and one kind the numbers run in reading order (a swap of two codes breaks the order), and that every code is in the register and none is retired.
 *           Every <dialog> of the till carries data-pop="POPnnn" (one code per dialog, 14 Nov) and the register holds a live Popup row for it; a showModal() reads the code of its dialog.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-till.test.cjs   (TILL_ID_MUTATE=swap or remove must fail it)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as pending
 *           (the docs PR lands the rows), a code the register calls retired fails.
 * NOTE      the tag rule is a copy of toolset/coverage/ui-identity.cjs CTLRE (the census); this test cannot import the docs toolset from the web repo.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.TILL_ID_MUTATE || '';
const BS = String.fromCharCode(92), NL = String.fromCharCode(10), CR = String.fromCharCode(13);
const PAGE = path.join(__dirname, '..', 'public', 'till.html');
let src = fs.readFileSync(PAGE, 'utf8').split(CR + NL).join(NL);
const CODE = /CTR00[2-8]-[A-Z][0-9][0-9]/;
if (mutate === 'remove') src = src.replace(new RegExp(' data-cbsid=(?:' + BS + BS + ')?"CTR004-B13(?:' + BS + BS + ')?"'), '');
if (mutate === 'swap') src = src.split('CTR002-B01').join('SWAPX').split('CTR002-B02').join('CTR002-B01').split('SWAPX').join('CTR002-B02');

let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok ' : '  FAIL ') + msg); if (!ok) failures++; };

/* the text without prose: comment-only lines and HTML comments go (the census does the same) */
const lines = src.replace(/<!--[\s\S]*?-->/g, (m) => m.split(NL).map(() => '').join(NL)).split(NL)
  .map((L) => { const t = L.trim(); return t.charAt(0) === '*' || t.slice(0, 2) === '//' || t.slice(0, 2) === '/*' ? '' : L; });
const text = lines.join(NL);
const TAG = /<(button|input|select|textarea|a|div|span|li|label|td|i|b|p)\b([^>]*)>([^<]{0,80})/g;
const kindOf = (tag, attrs) => {
  if (tag === 'button') return 'button';
  if (tag === 'input') return /type=["']hidden["']/.test(attrs) ? null : 'input';
  if (tag === 'select' || tag === 'textarea') return tag;
  if (/role=["']tab["']/.test(attrs)) return 'tab';
  if (/role=["']menuitem["']/.test(attrs)) return 'menuitem';
  if (/role=["'](button|switch|option)["']/.test(attrs)) return 'button';
  if (/\sonclick=|\sdata-act=/.test(' ' + attrs)) return 'chip';
  return null;
};
const found = [], untagged = [];
let m;
while ((m = TAG.exec(text))) {
  const attrs = m[2] || '', kind = kindOf(m[1], attrs);
  if (!kind) continue;
  const c = attrs.match(new RegExp(`data-cbsid=(?:${BS}${BS})?["']([A-Z]{3}[0-9]{3}(?:-[A-Z][0-9]{2})*)(?:${BS}${BS})?["']`));
  const line = text.slice(0, m.index).split(NL).length;
  if (c) found.push({ code: c[1], line }); else untagged.push(line + ' <' + m[1] + attrs.slice(0, 60));
}
check(found.length + untagged.length > 400, 'the scan sees the page: ' + (found.length + untagged.length) + ' controls');
check(untagged.length === 0, 'every control carries a code: ' + untagged.length + ' without' + (untagged.length ? ' (first: ' + untagged.slice(0, 3).join(' | ') + ')' : ''));

const mine = found.filter((f) => CODE.test(f.code)), comp = found.filter((f) => /^CMP[0-9]{3}$/.test(f.code));
check(mine.length + comp.length === found.length, 'every code is a till screen code (CTR002..CTR008) or a component code: ' + mine.length + ' + ' + comp.length + ' of ' + found.length);
const seen = {}; mine.forEach((f) => { (seen[f.code] = seen[f.code] || []).push(f.line); });
const dup = Object.keys(seen).filter((k) => seen[k].length > 1);
check(dup.length === 0, 'no screen code is written twice' + (dup.length ? ': ' + dup.slice(0, 5).join(', ') : ''));

/* reading order: inside one screen and kind the numbers rise (a swap of two codes fails) */
const last = {}; let order = 0;
mine.forEach((f) => { const k = f.code.slice(0, 8), n = +f.code.slice(8); if (last[k] && n < last[k].n) order++; last[k] = { n }; });
check(order === 0, 'inside a screen and kind the numbers run in reading order (' + order + ' out of order)');

/* the register */
const REGS = [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json'].filter(Boolean);
const regPath = REGS.find((p) => fs.existsSync(p));
if (regPath) {
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8')).screens, live = new Set(), retired = new Set();
  Object.values(reg).forEach((s) => (s.retired ? retired : live).add(s.code));
  const gone = mine.filter((f) => retired.has(f.code)), pending = mine.filter((f) => !live.has(f.code) && !retired.has(f.code));
  check(gone.length === 0, 'no code is retired in the register (' + gone.length + ')');
  console.log('  info ' + pending.length + ' of ' + mine.length + ' codes not in ' + regPath + ' yet (pending: the docs PR lands the rows)');
} else console.log('  info no register file found: codes not checked against it');

/* the popups: every <dialog> tag wears its data-pop, and the register knows the code */
const dialogs = text.match(/<dialog\b[^>]*>/g) || [], pops = dialogs.map((d) => (d.match(/data-pop="(POP[0-9]{3})"/) || [])[1]);
check(dialogs.length > 30, 'the scan sees the till dialogs: ' + dialogs.length);
check(pops.every(Boolean), 'every <dialog> carries a data-pop: ' + pops.filter((x) => !x).length + ' without');
const popDup = pops.filter((x, i) => x && pops.indexOf(x) !== i);
check(popDup.length === 0, 'no popup code is written twice' + (popDup.length ? ': ' + popDup.slice(0, 5).join(', ') : ''));
if (regPath) {
  const popRows = new Set(Object.entries(JSON.parse(fs.readFileSync(regPath, 'utf8')).screens).filter(([k, s]) => k.indexOf('Popup') === 0 && !s.retired).map(([, s]) => s.code));
  console.log('  info ' + pops.filter((x) => !popRows.has(x)).length + ' of ' + pops.length + ' popup codes not in ' + regPath + ' yet (pending: the docs PR lands the rows)');
}
console.log(failures ? '\nFAILED: ' + failures : '\n' + found.length + ' controls checked, all carry a code');
process.exit(failures ? 1 : 0);
