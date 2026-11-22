/**
 * books-money-1128.test.cjs — the books' money rounding and the carried invoice total (batch 1128, lane fixBooks).
 *   F2 (EL-MONEY): roundMoney rounds to the CURRENCY's minor unit (KWD 3, JPY 0, INR 2) and refuses a value that is there and not a number, by name.
 *   F1 (GF-MONEY): a carried invoice total (TotInvVal) is a round-off only within one minor unit per line (AU: or half its 5c cash step); a bigger gap WAITS with both figures
 *      and posts nothing — never a Dr/Cr Round-off line that books the difference.
 * Hand-computed, in minor units. No database. Run: node tests/books-money-1128.test.cjs
 */
'use strict';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x:x@127.0.0.1:1/x';
const H = require('../lib/books-hooks');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const minor = (major, dec) => Math.round(major * Math.pow(10, dec));

console.log('\n══ F2 · roundMoney: the currency\'s own minor unit, NaN refused ══\n');
ok('KWD 12.345 stays 12.345 = 12,345 fils (a fixed 2 dp gave 12.35 = 12,350, 5 fils on the bill)', minor(H.roundMoney(12.345, 'KWD'), 3) === 12345, String(H.roundMoney(12.345, 'KWD')));
ok('KWD 12.3456 rounds half away at 3 dp to 12.346 = 12,346 fils', minor(H.roundMoney(12.3456, 'KWD'), 3) === 12346);
ok('JPY 100.5 is 101 yen (0 dp, half away from zero)', H.roundMoney(100.5, 'JPY') === 101);
ok('INR 1.005 is 1.01 = 101 paise (the toPrecision(15) rule: 1.005 x 100 is 100.49999999999999 in binary)', minor(H.roundMoney(1.005, 'INR'), 2) === 101);
ok('INR -1.005 is -1.01 = -101 paise (negatives round away from zero too)', minor(H.roundMoney(-1.005, 'INR'), 2) === -101);
ok('no currency stays at 2 dp (AU, IN, AE unchanged): 12.345 -> 12.35', H.roundMoney(12.345) === 12.35);
ok('an absent value (undefined, null, empty) is 0, as before', H.roundMoney(undefined, 'INR') === 0 && H.roundMoney(null, 'INR') === 0 && H.roundMoney('', 'INR') === 0);
let said = null; try { H.roundMoney(NaN, 'INR'); } catch (e) { said = e; }
ok('NaN is refused by name (MONEY_NOT_A_NUMBER), never swallowed into 0.00', said && said.code === 'MONEY_NOT_A_NUMBER' && said.status === 422, String(said));
said = null; try { H.roundMoney('abc', 'INR'); } catch (e) { said = e; }
ok('text that is not an amount is refused the same way', said && said.code === 'MONEY_NOT_A_NUMBER');
const kwdRows = H.byRateOf({ ItemList: [{ GstRt: 0, AssAmt: 12.345, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0 }] }, 'KWD');
ok('byRateOf(invoice, KWD): a 12.345 line keeps its 3rd decimal in the row and the total', kwdRows.rows[0].taxable === 12.345 && kwdRows.total === 12.345, JSON.stringify(kwdRows));

console.log('\n══ F1 · a carried TotInvVal is a round-off only within the rounding rule ══\n');
const inv = (lines, tot) => ({ ItemList: lines.map(() => ({})), ValDtls: { TotInvVal: tot } });
const one = { total: 1000 }; /* the lines add to 1,000.00 = 100,000 paise */
const inr = { country: 'IN' }, au = { country: 'AU' };
let r = H.carriedRoundOff(inv([1], 50000), one, 'INR', inr);
ok('lines 1,000.00 but TotInvVal 50,000.00: waits (no round-off of 49,000.00), the gap 4,900,000 paise named', r.wait && r.wait.kind === 'queue' && r.wait.gap_minor === 4900000 && r.round_off === undefined, JSON.stringify(r));
r = H.carriedRoundOff(inv([1], 1000.01), one, 'INR', inr);
ok('one line, TotInvVal 1,000.01: a 1 paisa round-off, posts', r.round_off === 0.01 && !r.wait, JSON.stringify(r));
r = H.carriedRoundOff(inv([1], 1000.02), one, 'INR', inr);
ok('one line, TotInvVal 1,000.02: 2 paise is more than 1 per line, waits', !!r.wait && r.wait.gap_minor === 2, JSON.stringify(r));
r = H.carriedRoundOff(inv([1, 2, 3], 1000.03), one, 'INR', inr);
ok('three lines may carry 3 paise: 1,000.03 posts a round-off of 0.03', r.round_off === 0.03, JSON.stringify(r));
r = H.carriedRoundOff(inv([1], 1000), one, 'INR', inr);
ok('TotInvVal equal to the lines: round-off 0', r.round_off === 0);
r = H.carriedRoundOff({ ItemList: [{}], ValDtls: {} }, one, 'INR', inr);
ok('no carried total: the lines are the total, round-off 0', r.round_off === 0);
r = H.carriedRoundOff(inv([1], 1000.02), one, 'AUD', au);
ok('AU (cash step 5c, half = 3c): one line, 1,000.02 posts as 2 cents of round-off', r.round_off === 0.02 && !r.wait, JSON.stringify(r));
r = H.carriedRoundOff(inv([1], 1000.04), one, 'AUD', au);
ok('AU: 4 cents is more than half the 5c step (3c) and more than one line: waits', !!r.wait && r.wait.gap_minor === 4, JSON.stringify(r));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
