/* Icon guard (I1): docs/design/ICON-MAP.md has one icon per meaning and one meaning per icon; every icon button in the till and the
   online shop carries aria-label + title; no "QK" abbreviation is drawn on screen. Static — no browser. */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
let fail = 0; const bad = (m) => { fail++; console.log('FAIL ' + m); };
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const md = read('docs/design/ICON-MAP.md');
const table = md.split('## Conflicts')[0];
const rows = table.split('\n')
  .filter((l) => /^\|/.test(l) && !/^\|\s*(meaning|-)/.test(l))
  .map((l) => l.split('|').map((x) => x.trim())).filter((c) => c[2]);
const byIcon = {}, byMeaning = {};
rows.forEach((c) => {
  const meaning = c[1], icon = c[2].replace(/️/g, '');
  (byIcon[icon] = byIcon[icon] || []).push(meaning);
  (byMeaning[meaning] = byMeaning[meaning] || []).push(icon);
});
Object.keys(byIcon).forEach((i) => { if (byIcon[i].length > 1) bad('icon ' + i + ' means two things: ' + byIcon[i].join(' / ')); });
Object.keys(byMeaning).forEach((m) => { if (byMeaning[m].length > 1) bad('"' + m + '" has two icons: ' + byMeaning[m].join(' ')); });
if (rows.length < 30) bad('icon map looks empty (' + rows.length + ' rows)');

/* TILL_OPS: no two operations share a picture */
const till = read('public/till.html');
const seen = {};
(till.match(/\{ id: '[\w-]+',\s+icon: '[^']+'/g) || []).forEach((m) => {
  const id = /id: '([\w-]+)'/.exec(m)[1], ic = /icon: '([^']+)'/.exec(m)[1].replace(/️/g, '');
  const DOORS = { labs: 'pricing', pricing: 'labs', dayreport: 'today', today: 'dayreport', check: 'alerts', alerts: 'check', expense: 'moremoney', moremoney: 'expense' };   // a rail op and the Menu section it opens: one meaning
  if (seen[ic] && DOORS[seen[ic]] !== id) bad('till op icon ' + ic + ' used by both ' + seen[ic] + ' and ' + id); else if (!seen[ic]) seen[ic] = id;
});

/* every data-ic button names itself: aria-label and title inside the same tag */
['public/till.html', 'public/shop.html', 'public/app/step-flow.js'].forEach((f) => {
  const src = read(f);
  let n = 0, at = -1;
  while ((at = src.indexOf('data-ic=', at + 1)) >= 0) {
    n++;
    const open = src.lastIndexOf('<button', at);
    const seg = src.slice(open, at + 420);
    const tagEnd = seg.search(/>\s*(<span|[^\s<'"+;)])|>'\s*\n?\s*\+|>'\)|>['"]/);
    const tag = tagEnd > 0 ? seg.slice(0, tagEnd) : seg;
    const where = src.slice(at, at + 40).replace(/\s+/g, ' ');
    if (!/aria-label=/.test(tag)) bad(f + ': data-ic button without aria-label near "' + where + '"');
    if (!/title=/.test(tag)) bad(f + ': data-ic button without title near "' + where + '"');
  }
  console.log(f + ': ' + n + ' icon buttons checked');
});

/* no "QK" abbreviation drawn: not as visible text, not in a label/title/placeholder (comments are not on screen) */
const code = till.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
(code.match(/(?:aria-label|title|placeholder)="[^"]*\bQK\b[^"]*"|>[^<>{}]*\bQK\b[^<>{}]*</g) || [])
  .forEach((m) => bad('till.html: "QK" on screen: ' + m.slice(0, 60)));

console.log(fail ? fail + ' failure(s)' : 'icon-map guard: ok (' + rows.length + ' meanings)');
process.exit(fail ? 1 : 0);
