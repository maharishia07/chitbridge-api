/* index-not-app (IX0, 2026-10-13): static — no browser. NO CUSTOMER PATH LANDS IN THE WORKSHOP (app.html).
 * CARD  19-onboarding-and-shop-setup/home-and-doors
   Customers go Home (index.html) → the small apps (the manifest's routes: till · accounts · finance · crm · tasks · employees · network ·
   shop · the labs …). This reads Home, every page the manifest routes to, and the scripts EACH of those pages actually loads, strips the
   comments, and fails on any door into app.html (`app.html`, `#/app`, `#/welcome`, `#/country`) that is not on the ALLOW list below.
   The ALLOW list is the gaps table of docs/design/INDEX-NOT-APP.md — each with the round that builds its small-app home. It may only
   SHRINK: an entry that no longer matches anything FAILS too, so a door that was closed is struck from the list (and the doc) the same day.
   Run: node e2e/index-not-app.cjs */
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), pub = path.join(root, 'public');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let fail = 0; const bad = (m) => { fail++; console.log('FAIL ' + m); }; const ok = (m) => console.log('  ok  ' + m);

/* a bare hash is the workshop's router; the same hash after a small app's page (settings.html#/country, SET1) is that page's own */
/* CTR-144: cbHome() HIDES the literal (it returns <web>/app.html), so a CALL to it is a door too — the slip Share fell back to it unseen */
const DOOR = /(?<!function )cbHome\(|app\.html|(?<!\.html)#\/app\b|(?<!\.html)#\/welcome\b|(?<!\.html)#\/country\b/;

/* ── THE GAPS: a door that still opens the workshop, its small-app home, and the round that moves the screen (docs/design/INDEX-NOT-APP.md) ── */
const ALLOW = [
  /* TASKS-NEW row struck at INT6c: TOUR-FIX1 made ＋ New a "New task" sheet in tasks.html (a self-chit) — no workshop door */
  { file: 'public/app/network-app.js',  re: /nw-builder.*\/app\.html#\/network|\/app\.html#\/network.*nw-builder/, round: 'NET2', app: 'network', what: 'Open the builder (make the network the design checked)' },
  { file: 'public/till.html',           re: /cbHome\(\)\.replace/, round: 'IX0', app: 'home', what: 'cbRoot(): the one trim of cbHome() to the web root' },
  { file: 'public/till.html',           re: /\(window\.CB_WEB \|\| 'https:\/\/chitbridge-web\.vercel\.app'\) \+ '\/app\.html'\)/, round: 'SET2', app: 'settings', what: 'cbHome()\'s own literal' },
  { file: 'public/till.html',           re: /window\.open\(cbHome\(\) \+ '#\/app', '_blank', 'noopener'\)/, round: 'SET2', app: 'settings', what: 'whoseShopFix: pair this PC to the right counter (Counters & keys)' },
  { file: 'public/till.html',           re: /cbHome\(\) \+ '#\/app\/catalogue'/,               round: 'CAT1', app: 'catalogue', what: 'billWarnFix: an item\'s tax rate (the state half opens Settings › Your shop since SET1)' },
];

/* ── the pages a customer reaches from Home: index.html + every manifest route / via + the pages those link to ── */
const manifest = JSON.parse(read('public/app/manifest.json'));
const pageOf = (r) => String(r || '').replace(/\{bridge_id\}/g, 'x').split(/[?#]/)[0].replace(/^\//, '');
const PAGES = new Set(['index.html']);   /* an absolute http(s) route (TEMPORARY Coverage card, UX-141) is no page of ours */
manifest.entries.forEach((e) => { if (e.route && e.route.indexOf('app.html') >= 0) bad('manifest: ' + e.id + ' routes into the workshop (' + e.route + ')'); [e.route, e.via].forEach((r) => { if (r && !/^https?:\/\//.test(r)) PAGES.add('public/' + pageOf(r)); }); });
if (manifest.rail && manifest.rail.route) PAGES.add('public/' + pageOf(manifest.rail.route));
['public/country-lab.html', 'public/conversion-lab.html'].forEach((p) => PAGES.add(p));   /* Country lab (the brief's list) and the lab it links to */

/* comments out, line numbers kept (each comment becomes its newlines) */
const nl = (s) => s.replace(/[^\n]/g, '');
function stripJs(s) { return s.replace(/\/\*[\s\S]*?\*\//g, nl).replace(/^[ \t]*\/\/.*$/gm, '').replace(/^[ \t]*\*.*$/gm, '').replace(/[ \t]\/\/[ \t].*$/gm, ''); }
function stripHtml(s) { return stripJs(s.replace(/<!--[\s\S]*?-->/g, nl)); }
function scriptsOf(html, pageFile) {
  const out = []; const re = /<script[^>]*\ssrc="([^"]+)"/g; let m;
  while ((m = re.exec(html))) {
    const src = m[1]; if (/^https?:|^'|\$\{|\+/.test(src)) continue;                 /* a CDN or a built-up src is not a repo file */
    const f = src.charAt(0) === '/' ? 'public' + src : path.posix.join(path.posix.dirname(pageFile === 'index.html' ? 'public/index.html' : pageFile), src);
    if (fs.existsSync(path.join(root, f))) out.push(f);
  }
  return out;
}

const seen = new Map();   /* file → hits [{line, text}] */
function scan(file, html) {
  if (seen.has(file)) return;
  const raw = read(file), code = html ? stripHtml(raw) : stripJs(raw), hits = [];
  code.split('\n').forEach((l, i) => { if (DOOR.test(l)) hits.push({ line: i + 1, text: l.trim().slice(0, 160) }); });
  seen.set(file, hits);
}
Array.from(PAGES).forEach((p) => {
  if (!fs.existsSync(path.join(root, p))) return bad(p + ': the manifest routes to a page that does not exist');
  scan(p, true);
  scriptsOf(read(p), p).forEach((f) => scan(f, false));
});

/* every hit is on the ALLOW list; every ALLOW row still matches something */
const used = new Set();
seen.forEach((hits, file) => {
  hits.forEach((h) => {
    const row = ALLOW.findIndex((a) => a.file === file && a.re.test(h.text));
    if (row < 0) bad(file + ':' + h.line + ' opens the workshop — repoint it to the small app that does the job, or add the gap to docs/design/INDEX-NOT-APP.md and this ALLOW list with its round: ' + h.text);
    else used.add(row);
  });
});
ALLOW.forEach((a, i) => {
  if (!seen.has(a.file)) return bad('ALLOW: ' + a.file + ' is not a page a customer reaches (or not loaded by one) — strike the row');
  if (!used.has(i)) bad('ALLOW: ' + a.file + ' no longer opens the workshop for "' + a.what + '" — strike the row here and in docs/design/INDEX-NOT-APP.md (the list only shrinks)');
});
/* the doc and the list agree on the rounds */
const doc = fs.existsSync(path.join(root, 'docs/design/INDEX-NOT-APP.md')) ? read('docs/design/INDEX-NOT-APP.md') : '';
if (!doc) bad('docs/design/INDEX-NOT-APP.md is missing — the gaps table lives there');
else Array.from(new Set(ALLOW.map((a) => a.round))).forEach((r) => { if (doc.indexOf(r) < 0) bad('docs/design/INDEX-NOT-APP.md does not name round ' + r + ', which the ALLOW list uses'); });

const doors = Array.from(seen.values()).reduce((n, h) => n + h.length, 0);
ok(seen.size + ' files read for ' + PAGES.size + ' customer pages; ' + doors + ' workshop doors, all on the gaps list (' + ALLOW.length + ' rows)');
if (fail) { console.log('\nindex-not-app: ' + fail + ' failure(s)'); process.exit(1); }
console.log('\nindex-not-app: ok');
