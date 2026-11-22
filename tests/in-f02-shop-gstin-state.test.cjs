// tests/in-f02-shop-gstin-state.test.cjs — IN-F-02 (the shop GSTIN state code).  node tests/in-f02-03-gstin-state.test.cjs
// Hand figures: GSTIN 33ABCPK1234L1ZZ opens with 33 = Tamil Nadu; 29AABCN4321M1ZB opens with 29 = Karnataka (the walk's made-up numbers, check character by the official base-36 rule);
// 99ABCPK1234L1ZH and 00ABCPK1234L1Z8 have a right shape and a right check character but 99 and 00 are not states.
const assert = require('node:assert/strict');
const profile = require('../lib/profile');
let n = 0;
const ok = (name, cond) => { n++; assert.ok(cond, name); };

/* IN-F-02: the shop */
ok('33ABCPK1234L1ZZ passes (Tamil Nadu)', profile.gstinCheck('33ABCPK1234L1ZZ').ok === true);
ok('27AAACW5678F1Z0 passes (Maharashtra)', profile.gstinCheck('27AAACW5678F1Z0').ok === true);
ok('99… is refused as a state', profile.gstinCheck('99ABCPK1234L1ZH').reason === 'state');
ok('00… is refused as a state', profile.gstinCheck('00ABCPK1234L1Z8').reason === 'state');
ok('39… is past the list', profile.gstinCheck('39ABCPK1234L1ZZ').reason === 'state');
ok('25… and 28… were retired codes, not on the list', profile.gstinCheck('25ABCPK1234L1ZZ').reason === 'state' && profile.gstinCheck('28ABCPK1234L1ZZ').reason === 'state');
ok('97 (other territory) is a state code; a wrong check character there is told as the check', profile.gstinCheck('97ABCPK1234L1ZX').reason === 'check');
ok('a wrong check character on a state is still refused as the check', profile.gstinCheck('33ABCPK1234L1Z1').reason === 'check');
ok('the shop refusal for 99 is in words naming the two digits', /first two digits/.test(profile.taxIdRefusal('IN', '99ABCPK1234L1ZH').why));
ok('the shop refusal for 99 has the code TAX_ID_BAD', profile.taxIdRefusal('IN', '99ABCPK1234L1ZH').code === 'TAX_ID_BAD');
ok('a good shop GSTIN is not refused', profile.taxIdRefusal('IN', '33ABCPK1234L1ZZ') === null);
ok('AU is untouched (an ABN has no state code)', profile.taxIdRefusal('AU', '51824753556') === null);

console.log(n + ' checks');
