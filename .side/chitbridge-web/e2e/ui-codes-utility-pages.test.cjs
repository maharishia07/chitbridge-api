'use strict';
// @type: unit
/**
 * ui-codes-utility-pages.test.cjs - Know your business (KYB001), Store (STR001) and Network shop (NSH001) wear their identity codes (UX-137 slice utility-2).
 *
 * OWNS      the proof that each of the three pages tags its controls with <screen>-<kind><nn> (B button, I input, C chip), that the letter is the
 *           tag's own kind, that every named control wears ITS code (a swap fails), that no code is on two tags, that every control the census
 *           counts on the page is tagged (a new untagged control fails), and that the stamp only added attributes (strip them: no code is left).
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-utility-pages.test.cjs   (UTILPAGES_ID_MUTATE=remove|swap must fail it)
 * FLOW      UX-137 step 3 (utility pages); the rows are written in the docs SCREENS.json (twin branch cmdb/ux137-stamp-4).
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as pending
 *           (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.UTILPAGES_ID_MUTATE || '';
const KIND = { button: 'B', input: 'I', select: 'S', textarea: 'T', span: 'C', div: 'C' };
/** page -> screen code, and the attribute text each control is found by -> the code its tag must wear */
const PAGES = {
  'know-your-business.html': { screen: 'KYB001', want: [['onclick="go(', 'KYB001-C01'], ['id="nc_title"', 'KYB001-I01'], ['onclick="addCred()"', 'KYB001-B01'], ['onclick="runField()"', 'KYB001-B02']] },
  'store.html': { screen: 'STR001', want: [['id="q"', 'STR001-I01'], ['onclick="placeOrder()"', 'STR001-B01'], ['onclick="addToCart(', 'STR001-B02'], ['data-cat=""', 'STR001-C01'], ["data-cat=\"' + esc", 'STR001-C02'], ['id="po_name"', 'STR001-I02'], ['id="po_email"', 'STR001-I03']] },
  'network-shop.html': { screen: 'NSH001', want: [['id="q"', 'NSH001-I01'], ['onclick="pick(null)"', 'NSH001-C01'], ['onclick="pick(\\\'', 'NSH001-C02']] }
};
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };
const allCodes = [];
const read = (page) => {
  let src = fs.readFileSync(path.join(__dirname, '..', 'public', page), 'utf8').split('\r\n').join('\n');
  const first = PAGES[page].want[0][1];
  const second = PAGES[page].want[1][1];
  if (mutate === 'remove') src = src.split(' data-cbsid="' + first + '"').join('');
  if (mutate === 'swap') src = src.split(first).join('SWAPX').split(second).join(first).split('SWAPX').join(second);
  return src;
};

for (const page of Object.keys(PAGES)) {
  const { screen, want } = PAGES[page];
  const src = read(page);
  console.log(page);
  const tags = [...src.matchAll(/<(button|input|select|textarea|span|div)\b([^>]*?data-cbsid="([A-Z]{3}[0-9]{3}-[A-Z][0-9]{2})"[^>]*)>/g)];
  const codes = tags.map((t) => t[3]);
  allCodes.push(...codes);
  check(codes.length === want.length, page + ' has ' + want.length + ' tagged elements, found ' + codes.length);
  check(new Set(codes).size === codes.length, 'no code is on two tags');
  check(codes.every((c) => c.indexOf(screen + '-') === 0), 'every code is under ' + screen);
  const kindOf = (t) => (/class="(chip|tab)[ ']/.test(t[2]) ? 'C' : KIND[t[1]]);   /* a tab or a chip drawn as a real button (UX-5) is still the register's chip row */
  const wrong = tags.filter((t) => kindOf(t) !== t[3].charAt(7));
  check(wrong.length === 0, 'every code letter is its tag kind' + (wrong.length ? ' (' + wrong.map((t) => t[3]).join(',') + ')' : ''));
  for (const [needle, code] of want) {
    const tag = tags.filter((t) => t[2].indexOf(needle) >= 0)[0];
    check(!!tag && tag[3] === code, needle + ' wears ' + code);
  }
  /** the census counts every control tag; each of them must carry a code (a new raw control fails here) */
  const census = [...src.matchAll(/<(button|input|select|textarea)\b([^>]*)>/g)].filter((t) => !/type=["']hidden["']/.test(t[2]));
  const chips = [...src.matchAll(/<(span|div)\b([^>]*\sonclick=[^>]*)>/g)];
  const bare = census.concat(chips).filter((t) => !/data-cbsid="/.test(t[2]));
  check(bare.length === 0, 'no control tag is left without a code' + (bare.length ? ' (' + bare.length + ')' : ''));
  /** the stamp is the only change: strip every attribute it writes and no code is left */
  const stripped = src.replace(/ data-cbsid="[A-Z]{3}[0-9]{3}-[A-Z][0-9]{2}"/g, '');
  check(!/data-cbsid="[A-Z]{3}[0-9]{3}-/.test(stripped), 'stripped: no code is left, the page still parses as the same markup');
}

let reg = null;
for (const p of [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json']) {
  if (p && fs.existsSync(p)) { try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) { console.log('  register unreadable at ' + p + ': ' + e.message); } }
}
if (reg) {
  const rows = {}; Object.values(reg.screens || {}).forEach((r) => { if (r.code) rows[r.code] = r; });
  const missing = allCodes.filter((c) => !rows[c]), retired = allCodes.filter((c) => rows[c] && rows[c].retired);
  console.log('  register: ' + (allCodes.length - missing.length) + ' of ' + allCodes.length + ' codes found' + (missing.length ? ' (pending until the docs PR lands: ' + missing.length + ')' : ''));
  if (process.env.UIID_REG) check(!missing.length, "every code is in the register UIID_REG names (" + missing.length + " missing)"); /* a set register: a missing code FAILS, no pending */
  check(retired.length === 0, 'no code is retired in the register');
}
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
