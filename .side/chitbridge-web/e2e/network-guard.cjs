/* Network guard (P2): static — no browser. The small app's pieces agree with each other:
   · cap-network.js is split by job: the member half lives in cap-network-member.js, every function in ONE of them, app.html loads both (CAP_WITH);
   · network.html wears the ONE frame (CBFrame → CBShell header · CBAvatar · the kural band · CBList), loads what network-app.js reaches for, and the old ?bridge= link lands on network-shop.html;
   · every write in network-app.js is a CBAction.run; the only calls are the network routes; a refused Design is greyed with the server's sentence and nothing here decides who may;
   · the Home door is built and the Network Lab is on the Labs row, and the lab posts only sample:true (nothing real is made). */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let fail = 0; const bad = (m) => { fail++; console.log('FAIL ' + m); }; const ok = (m) => console.log('  ok  ' + m);

const design = read('public/app/cap-network.js'), member = read('public/app/cap-network-member.js'), app = read('public/app.html');
const page = read('public/network.html'), na = read('public/app/network-app.js'), lab = read('public/network-design.html');
const man = JSON.parse(read('public/app/manifest.json')), kur = JSON.parse(read('public/app/kurals.json'));

/* the split: no function is defined in both halves */
const names = (s) => new Set([...s.matchAll(/^(?:async )?function (\w+)\(/gm)].map((m) => m[1]));
const a = names(design), b = names(member);
const both = [...b].filter((n) => a.has(n));
if (both.length) bad('defined in both cap-network.js and cap-network-member.js: ' + both.join(', ')); else ok('split by job — ' + a.size + ' design functions, ' + b.size + ' member functions, none twice');
if (!b.has('_netMemberScreen') || !b.has('netBrowse') || !b.has('netAvailSearch')) bad('the member half must hold _netMemberScreen · netBrowse · netAvailSearch');
if (!/CAP_WITH\s*=\s*\{\s*network:\s*\['network-member'\]/.test(app)) bad('app.html must load network-member with network (CAP_WITH)'); else ok('app.html loads both halves');

/* the frame */
['/engine/screen.js', '/app/avatar.js', '/app/page-frame.js', '/app/shell.js', '/app/list-ctl.js', '/app/kural.js', '/app/network-app.js'].forEach((s) => { if (page.indexOf('src="' + s + '"') < 0) bad('network.html must load ' + s); });
if (!/CBFrame\.mount\(\{\s*app: 'network',\s*kural: 'network'/.test(page)) bad('network.html must mount CBFrame with the kural band');
if (!kur.kurals.some((k) => k.route === 'network')) bad('kurals.json needs a network route for the band');
if (!/network-shop\.html/.test(page) || !/get\('bridge'\)/.test(page)) bad('?bridge= must still land on the public shopfront (network-shop.html)');
if (!fs.existsSync(path.join(root, 'public/network-shop.html'))) bad('network-shop.html is missing');
ok('network.html: one frame, kural band, old link kept');

/* the app: only network routes, writes through CBAction, nothing decides who may */
const calls = [...na.matchAll(/call\('(GET|POST|PUT|PATCH|DELETE)',\s*'(\/api\/[^']*)'/g)].map((m) => m[1] + ' ' + m[2]);
const allowed = /^(GET \/api\/network-offers|GET \/api\/network-design(\/stores)?|POST \/api\/network-design\/validate|POST \/api\/network-offers\/)/;
calls.forEach((c) => { if (!allowed.test(c)) bad('unexpected call ' + c); });
ok(calls.length + ' calls, all on the network routes');
if ((na.match(/CBAction\.run\(/g) || []).length < 2) bad('the offer choice and the check must go through CBAction.run');
if (/\bconfirm\(|\balert\(/.test(na)) bad('no browser confirm/alert');
if (!/may\.why/.test(na) || !/aria-disabled="true"/.test(na)) bad('Design must be greyed with the server\'s sentence'); else ok('Design is greyed with the server\'s sentence');
if (/identity_type|hat ===|role ===|isOwner|parent_entity_id/.test(na)) bad('network-app.js must not decide who may do what');

/* the door and the lab */
const door = man.entries.filter((e) => e.id === 'network')[0], nl = man.entries.filter((e) => e.id === 'network-lab')[0];
if (!door || door.route !== '/network.html' || door.state !== 'built') bad('the Network door must open /network.html as built');
if (!nl || nl.route !== '/network-design.html' || nl.area !== 'labs' || nl.state !== 'built') bad('the Network Lab must be on the Labs row, built');
/* comments are not calls: strip HTML, block and line comments (a line comment starts at // not after a colon) before looking for a call to build or a PUT */
const code = (t) => t.replace(/<!--[^]*?-->/g, '').replace(/\/\*[^]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const callsBuild = (t) => /fetch\([^)]*\/api\/network-design\/build|method:\s*'PUT'/.test(code(t));
if (!/sample:\s*true/.test(code(lab)) || !/\/api\/network-design\/validate/.test(code(lab)) || callsBuild(lab)) bad('the lab may only post sample:true to validate - never build or save');
if (callsBuild('<!-- POST /api/network-design/build -->\n/* fetch(a + "/api/network-design/build") */\n// method: \'PUT\'')) bad('self-test: a comment that names build is not a call');
if (!callsBuild("fetch(api + '/api/network-design/build', {method: 'POST'})") || !callsBuild("x({ method: 'PUT' })")) bad('self-test: a real call to build or a PUT is caught');
else ok('door built · Network Lab on the Labs row · the lab posts nothing real');

console.log(fail ? '\nnetwork-guard: ' + fail + ' FAILED' : '\nnetwork-guard: all passed');
process.exit(fail ? 1 : 0);
