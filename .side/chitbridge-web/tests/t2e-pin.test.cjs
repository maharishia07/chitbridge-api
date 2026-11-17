'use strict';
/* T2e (L-2): no PIN / code box may take a browser's saved password. Run: node tests/t2e-pin.test.cjs */
const fs = require('fs'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const rd = (f) => fs.readFileSync(__dirname + '/../public/' + f, 'utf8');
const ui = rd('app/signin-ui.js');
ok(!/current-password/.test(ui) && !/current-password/.test(rd('app.html')), 'no PIN/code box says current-password');
ok(/name="cred"[^>]*autocomplete="one-time-code"/.test(ui), 'the code / PIN box is one-time-code');
ok((ui.match(/autocomplete="new-password"/g) || []).length === 2, 'both new-PIN boxes are new-password');
ok(/id="l_pin"[^>]*autocomplete="one-time-code"/.test(rd('app.html')) && /id="l_setpin"[^>]*autocomplete="new-password"/.test(rd('app.html')), 'app.html PIN boxes carry autocomplete');
console.log(n + ' passed');
