/* Employees guard (P1): static — no browser. The small app's pieces agree with each other:
   · employees.html loads what cap-employees.js reaches for, and the Home door points at it (state built);
   · every write in cap-employees.js is a CBAction.run (one press one write · ask first for the irreversible · say the outcome), and the only calls are the existing actors routes + GET /api/people;
   · the embed speaks one message shape on both ends (cb:'employees' · added|changed|close) and the host only hears its own iframe on its own origin;
   · the till's "Add a person" opens the embed and the web copy of till.html is the api master's (checked in the api repo). */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let fail = 0; const bad = (m) => { fail++; console.log('FAIL ' + m); }; const ok = (m) => console.log('  ok  ' + m);

const page = read('public/employees.html'), cap = read('public/app/cap-employees.js'), host = read('public/app/embed-host.js'), till = read('public/till.html');
const man = JSON.parse(read('public/app/manifest.json'));

['/app/accounts-shell.js', '/app/list-ctl.js', '/app/cap-employees.js', '/app/page-frame.js', '/app/shell.js'].forEach((s) => { if (page.indexOf('src="' + s + '"') < 0) bad('employees.html does not load ' + s); });
const door = man.entries.filter((e) => e.id === 'employees')[0];
if (!door || door.route !== '/employees.html' || door.state !== 'built') bad('the Employees door must open /employees.html as built'); else ok('Home door → /employees.html');

/* every call goes to a route that exists; every write sits inside a CBAction.run */
const calls = [...cap.matchAll(/call\('(GET|POST|PUT|PATCH|DELETE)',\s*'(\/api\/[^']*)'/g)].map((m) => m[1] + ' ' + m[2].replace(/\/' \+ [^)]*$/, ''));
const allowed = /^(GET \/api\/people|POST \/api\/actors\/suggest-key|POST \/api\/actors|PATCH \/api\/actors\/|DELETE \/api\/actors\/|PUT \/api\/actors\/)/;
calls.forEach((c) => { if (!allowed.test(c)) bad('unexpected call ' + c); });
ok(calls.length + ' calls, all on /api/people or the actors routes');
const runs = (cap.match(/CBAction\.run\(/g) || []).length + (cap.match(/\bask\(\{/g) || []).length;
if (runs < 5) bad('the five writes (add · access · reset · switch · cover) must each go through CBAction.run — found ' + runs);
else ok('writes through CBAction.run: ' + runs);
if (!/confirm: c/.test(cap) || !/Switch off\?/.test(cap) || !/Reset code\?/.test(cap)) bad('switch off and reset must ask first');
if (/\bconfirm\(|\balert\(/.test(cap)) bad('no browser confirm/alert');
if (/error\.message|e\.message/.test(cap.replace(/var e = new Error\(j\.message[^\n]*\n/, ''))) bad('a server message must not be painted raw');
if (!/may\.why|may\.ok|\.ok !== false/.test(cap) || !/aria-disabled="true"/.test(cap)) bad('refused actions must be drawn greyed with the server\'s sentence');
else ok('refused actions are greyed with the server\'s sentence');
/* nothing here decides who may — no role/hat test on the client */
if (/identity_type|hat ===|role ===|isOwner/.test(cap)) bad('cap-employees.js must not decide who may do what');

/* the embed: one message shape, both ends */
if (!/cb: 'employees'/.test(cap) || !/m\.cb !== o\.app/.test(host)) bad('embed message key differs between page and host');
if (!/e\.source !== f\.contentWindow/.test(host) || !/e\.origin !== root\.location\.origin/.test(host)) bad('the host must only hear its own iframe on its own origin');
['added', 'changed', 'close'].forEach((ev) => { if (cap.indexOf("'" + ev + "'") < 0) bad('embed never says ' + ev); });
ok('embed: cb:employees · added|changed|close · own iframe, own origin');

/* the till's caller */
if (!/whoAdd\(\)/.test(till) || !/CBEmbed\.open\(\{ app: 'employees', view: 'add'/.test(till) || till.indexOf('/app/embed-host.js') < 0) bad('till.html must open the Employees embed from "Who is at the counter?"');
else ok('till: ＋ Add a person opens the embed');

console.log(fail ? '\nemployees-guard: ' + fail + ' FAILED' : '\nemployees-guard: PASS'); process.exit(fail ? 1 : 0);
