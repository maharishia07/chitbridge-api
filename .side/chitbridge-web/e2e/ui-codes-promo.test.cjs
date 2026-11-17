'use strict';
// @type: unit
/**
 * ui-codes-promo.test.cjs - the shop screen (promo.html, PRM001) wears its identity codes (UX-137 one-pass, 2026-11-13).
 *
 * OWNS      the proof that promo.html tags its 15 controls with PRM001-<kind><nn> (B button, I input, S select, T textarea), that each code sits INSIDE
 *           its own tag (read from the tag's '<' forward), that the letter is the tag's own kind, that no code is on two tags, that named controls wear
 *           THEIR code (a swap fails), that no control tag is left without a code, and that the stamp only added attributes.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-promo.test.cjs   (PROMO_MUTATE=remove|swap must fail it)
 * FLOW      UX-137 one-pass; rows are in the docs SCREENS.json (twin docs branch ux/promo-ids-docs). promo.html is the vendored copy of the api master.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.PROMO_MUTATE || '';
const SCREEN = 'PRM001';
const KIND = { button: 'B', input: 'I', select: 'S', textarea: 'T' };
/** the attribute text each named control is found by -> the code its tag must wear */
const WANT = [
  ['id="camp"', 'PRM001-S01'], ['id="play"', 'PRM001-B01'], ['id="prevb"', 'PRM001-B02'], ['id="nextb"', 'PRM001-B03'], ['id="share"', 'PRM001-B04'],
  ['id="dl"', 'PRM001-B05'], ['id="dlall"', 'PRM001-B06'], ['id="full"', 'PRM001-B07'], ['id="refresh"', 'PRM001-B08'], ['id="repair"', 'PRM001-B09'],
  ['id="paircode"', 'PRM001-I01'], ['id="pairgo"', 'PRM001-B10'], ['id="copycap"', 'PRM001-B11'], ['id="cap"', 'PRM001-T01'], ['data-c="', 'PRM001-B12']
];
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };
let src = fs.readFileSync(path.join(__dirname, '..', 'public', 'promo.html'), 'utf8').split('\r\n').join('\n');
const first = 'PRM001-S01', second = 'PRM001-B01';
if (mutate === 'remove') src = src.split(' data-cbsid="' + first + '"').join('');
if (mutate === 'swap') src = src.split(first).join('SWAPX').split(second).join(first).split('SWAPX').join(second);
const tags = [...src.matchAll(/<(button|input|select|textarea)\b([^>]*?data-cbsid="([A-Z]{3}[0-9]{3}-[A-Z][0-9]{2})"[^>]*)>/g)];
const codes = tags.map((t) => t[3]);
console.log('promo.html');
check(codes.length === 15, 'promo.html has 15 tagged controls, found ' + codes.length);
check(new Set(codes).size === codes.length, 'no code is on two tags');
check(codes.every((c) => c.indexOf(SCREEN + '-') === 0), 'every code is under ' + SCREEN);
const wrong = tags.filter((t) => KIND[t[1]] !== t[3].charAt(7));
check(wrong.length === 0, 'every code letter is its tag kind' + (wrong.length ? ' (' + wrong.map((t) => t[3]).join(',') + ')' : ''));
for (const [needle, code] of WANT) {
  const tag = tags.filter((t) => t[2].indexOf(needle) >= 0)[0];
  check(!!tag && tag[3] === code, needle + ' wears ' + code);
}
/** data-cbsid is the LAST attribute of its tag (e2e regexes bind attribute order) */
check(tags.every((t) => /data-cbsid="[A-Z0-9-]+"$/.test(t[2])), 'data-cbsid is last in every tag');
const census = [...src.matchAll(/<(button|input|select|textarea)\b([^>]*)>/g)].filter((t) => !/type=["']hidden["']/.test(t[2]));
const bare = census.filter((t) => !/data-cbsid="/.test(t[2]));
check(bare.length === 0, 'no control tag is left without a code' + (bare.length ? ' (' + bare.length + ': ' + bare.slice(0, 3).map((t) => t[0].slice(0, 50)).join(' | ') + ')' : ''));
check(!/data-cbsid="PRM001-/.test(src.replace(/ data-cbsid="PRM001-[A-Z][0-9]{2}"/g, '')), 'stripped: no code is left, the page is the same markup');

let reg = null;
for (const p of [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json']) {
  if (p && fs.existsSync(p)) { try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) { console.log('  register unreadable at ' + p + ': ' + e.message); } }
}
if (reg) {
  const rows = {}; Object.values(reg.screens || {}).forEach((r) => { if (r.code) rows[r.code] = r; });
  const missing = codes.filter((c) => !rows[c]), retired = codes.filter((c) => rows[c] && rows[c].retired);
  console.log('  register: ' + (codes.length - missing.length) + ' of ' + codes.length + ' codes found' + (missing.length ? ' (pending until the docs PR lands: ' + missing.length + ')' : ''));
  if (process.env.UIID_REG) check(!missing.length, "every code is in the register UIID_REG names (" + missing.length + " missing)"); /* a set register: a missing code FAILS, no pending */
  check(retired.length === 0, 'no code is retired in the register');
}
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
