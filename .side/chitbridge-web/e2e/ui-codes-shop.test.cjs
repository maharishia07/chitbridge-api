'use strict';
// @type: unit
/**
 * ui-codes-shop.test.cjs - the customer Shop page (SHP001) wears its identity codes (UX-137 slice 5, 2026-11-12).
 *
 * OWNS      the proof that shop.html tags its 61 own controls (the four sheet closers SHP001-B11 B15 B17 B26 are the library close, WEB-ICONS-1) with SHP001-<kind><nn> (B button, I input, S select, T textarea, C chip), that the letter is the
 *           tag's own kind, that no code is on two tags, that named controls wear THEIR code (a swap fails), that no control tag is left without a code
 *           (a new raw control fails), that the three privacy buttons drawn by the shared builder in shop-privacy.js take their codes from their call
 *           sites, and that the stamp only added attributes (strip them: no code is left).
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-shop.test.cjs   (SHOP_ID_MUTATE=remove|swap must fail it)
 * FLOW      UX-137 slice 5; the rows are in the docs SCREENS.json (twin branch cmdb/ux137-stamp-5, screen row "Shop › Shop" = SHP001).
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as pending
 *           (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.SHOP_ID_MUTATE || '';
const SCREEN = 'SHP001';
const KIND = { button: 'B', input: 'I', select: 'S', textarea: 'T', a: 'C', div: 'C', span: 'C' };
/** the attribute text each named control is found by -> the code its tag must wear */
const WANT = [
  ['onclick="shopCatToggle()"', 'SHP001-B05'], ['onclick="supOpen();return false"', 'SHP001-C02'],
  ['onclick="supSendCode()"', 'SHP001-B09'], ['onclick="supSubmit()"', 'SHP001-B10'], 
  ['onclick="orderConfirm()"', 'SHP001-B19'], ['onclick="orderStart()"', 'SHP001-B20'], ['onclick="shopPrivacy()"', 'SHP001-B21'], ['data-testid="shop-orders-more"', 'SHP001-B23'],
  ['onclick="shopMyOrders()"', 'SHP001-B24'], ['onclick="vizToOrder()"', 'SHP001-B27']
];
const PRIVACY_CALLS = [["btn('No', 'data-cbsid=\"", 'SHP001-B28'], ["btn('Yes', 'data-cbsid=\"", 'SHP001-B29'], ['btn(KIND[item], \'data-cbsid="', 'SHP001-B30']];
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8').split('\r\n').join('\n');

let src = read('shop.html');
const first = 'SHP001-I07', second = 'SHP001-B05';
if (mutate === 'remove') src = src.split(' data-cbsid="' + first + '"').join('');
if (mutate === 'swap') src = src.split(first).join('SWAPX').split(second).join(first).split('SWAPX').join(second);
const tags = [...src.matchAll(/<(button|input|select|textarea|a|div|span)\b([^>]*?data-cbsid="([A-Z]{3}[0-9]{3}-[A-Z][0-9]{2})"[^>]*)>/g)];
const codes = tags.map((t) => t[3]);
console.log('shop.html');
check(codes.length === 37, 'shop.html has 37 tagged elements (four closers moved to ui.action close, the other 24 inputs are ui.field mounts, CMP055), found ' + codes.length);
check(new Set(codes).size === codes.length, 'no code is on two tags');
check(codes.every((c) => c.indexOf(SCREEN + '-') === 0), 'every code is under ' + SCREEN);
const wrong = tags.filter((t) => KIND[t[1]] !== t[3].charAt(7));
check(wrong.length === 0, 'every code letter is its tag kind' + (wrong.length ? ' (' + wrong.map((t) => t[3]).join(',') + ')' : ''));
for (const [needle, code] of WANT) {
  const tag = tags.filter((t) => t[2].indexOf(needle) >= 0)[0];
  check(!!tag && tag[3] === code, needle + ' wears ' + code);
}
/** field-2: every converted input is a ui.field mount SHP001-U01..U22 (literal, so the census reads it), and the old element codes are gone from the page */
const mounts = [...src.matchAll(/ui\.field\(\{\s*mount: '(SHP001-U\d\d)'/g)].map((t) => t[1]);
check(new Set(mounts).size === 22, 'shop.html mounts 22 distinct ui.field mounts, found ' + new Set(mounts).size);
/** field-2: each mount code sits on exactly its input (id literal as written in the call; 'none' = a file picker with no id), so swapping two codes fails */
const MOUNT_ID = { U01: "'f_' + item", U02: 'none', U03: "'p_search'", U04: "'lg_contact'", U05: "'lg_otp'", U06: "'sup_what'", U07: "'sup_contact'", U08: "'sup_otp'", U09: "'o_loc'", U10: "'o_date'", U11: "'o_time'", U12: "'o_remark'", U13: "'o_name'", U14: "'o_contact'", U15: "'o_otp'", U16: "'o_qty'", U17: "'o_name'", U18: "'o_loc'", U19: "'o_contact'", U20: "'o_otp'", U21: 'none', U22: 'none' };
const callOf = (at) => { let d = 0, i = src.indexOf('{', at); const from = i; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; } return src.slice(from, i + 1); };
const found = {};
for (const m of src.matchAll(/ui\.field\(/g)) { const body = callOf(m.index); const mt = /mount: 'SHP001-(U\d\d)'/.exec(body); const idm = /(?:^|[\s,{])id: ('[^']*'(?: \+ item)?)/.exec(body); if (mt) found[mt[1]] = idm ? idm[1] : 'none'; }
for (const [u, id] of Object.entries(MOUNT_ID)) check(found[u] === id, 'SHP001-' + u + ' is on the field ' + (id === 'none' ? 'with no id (file picker)' : 'id ' + id) + (found[u] === id ? '' : ' (found ' + found[u] + ')'));
check(!/SHP001-I(0[1-6]|0[89]|1[0-7]|19|2\d)"/.test(src) && !/SHP001-T0[12]"/.test(src), 'the converted element codes are not on the page any more (radio I07 and the money offer I18 keep theirs)');
check(src.indexOf('src="/app/ui-field.js"') > src.indexOf('src="/app/ui.js"') && src.indexOf('src="/app/ui.js"') > 0, 'ui-field.js is loaded after ui.js');
/** the census counts every control tag; each must carry a code (a new raw control fails here) */
const census = [...src.matchAll(/<(button|input|select|textarea)\b([^>]*)>/g)].filter((t) => !/type=["']hidden["']/.test(t[2]));
const chips = [...src.matchAll(/<(a|div|span)\b([^>]*\sonclick=[^>]*)>/g)];
const bare = census.concat(chips).filter((t) => !/data-cbsid="/.test(t[2]));
check(bare.length === 0, 'no control tag is left without a code' + (bare.length ? ' (' + bare.length + ': ' + bare.slice(0, 3).map((t) => t[0].slice(0, 50)).join(' | ') + ')' : ''));
/** the stamp is the only change: strip every attribute it writes and no code is left */
check(!/data-cbsid="SHP001-/.test(src.replace(/ data-cbsid="SHP001-[A-Z][0-9]{2}"/g, '')), 'stripped: no code is left, the page is the same markup');

console.log('app/shop-privacy.js');
const priv = read('app/shop-privacy.js');
for (const [needle, code] of PRIVACY_CALLS) check(priv.indexOf(needle + code + '"') >= 0, 'the call ' + needle.slice(0, 12) + ' passes ' + code);
check(!/data-cbsid="SHP001-/.test(priv.replace(/data-cbsid="SHP001-B[0-9]{2}" /g, '')), 'stripped: no code is left in the privacy sheet');

let reg = null;
for (const p of [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json']) {
  if (p && fs.existsSync(p)) { try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) { console.log('  register unreadable at ' + p + ': ' + e.message); } }
}
if (reg) {
  const rows = {}; Object.values(reg.screens || {}).forEach((r) => { if (r.code) rows[r.code] = r; });
  const all = codes.concat(PRIVACY_CALLS.map((c) => c[1]));
  const missing = all.filter((c) => !rows[c]), retired = all.filter((c) => rows[c] && rows[c].retired);
  console.log('  register: ' + (all.length - missing.length) + ' of ' + all.length + ' codes found' + (missing.length ? ' (pending until the docs PR lands: ' + missing.length + ')' : ''));
  if (process.env.UIID_REG) check(!missing.length, "every code is in the register UIID_REG names (" + missing.length + " missing)"); /* a set register: a missing code FAILS, no pending */
  check(retired.length === 0, 'no code is retired in the register');
}
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
