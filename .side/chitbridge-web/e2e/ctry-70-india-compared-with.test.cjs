/**
 * e2e/ctry-70-india-compared-with.test.cjs — CTRY-70 (proof 2026-11-14): every India "Compared with" row is held against the VENDOR's own page, with a checked date.
 * @type regression
 * OWNS      the proof, on public/data/compare.json (the one file the Standards page's Compared-with tab reads) and the REAL stdCompareRows mapper
 *           (public/app/cap-standards.js, lifted into a vm sandbox), that for country IN: there are 16 rows (hand-computed: 2 packages, Tally Prime and Zoho
 *           Books, x 8 capabilities); each says verified = "source" (the claim is in the cited source, never "memory"); each carries `checked` as a real
 *           ISO date between 2026-10-24 (the India verification) and today; each has a source and a source_url that is its FIRST https link; each link is on
 *           the vendor's own host (Tally rows: help.tallysolutions.com, Zoho rows: www.zoho.com); ids are unique; and the mapper keeps all 16 (a row the file
 *           gets wrong is dropped, so 16 in = 16 painted).
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network (the vendor pages are NOT fetched here: the check is that each row names one and a date).
 * FLOW      compare.json → IN rows → field checks; → stdCompareRows(json) → painted rows
 *   node e2e/ctry-70-india-compared-with.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const json = JSON.parse(fs.readFileSync(path.join(root, 'public', 'data', 'compare.json'), 'utf8'));
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (info ? '\n          ' + String(info).slice(0, 400) : '')); } };

const IN = json.rows.filter((r) => r.country === 'IN');
const bad = (fn) => IN.filter((r) => !fn(r)).map((r) => r.id);
ok('India has 16 rows: 2 packages (Tally Prime, Zoho Books) x 8 capabilities', IN.length === 16 && new Set(IN.map((r) => r.package)).size === 2 && ['Tally Prime', 'Zoho Books'].every((p) => IN.filter((r) => r.package === p).length === 8), IN.length + ' rows');
ok('every row is verified = "source" (in the cited vendor page), none "memory"', bad((r) => r.verified === 'source').length === 0, bad((r) => r.verified === 'source').join(','));
const today = new Date().toISOString().slice(0, 10);
const realDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !isNaN(Date.parse(s)) && new Date(Date.parse(s)).toISOString().slice(0, 10) === s;
ok('every row has its own `checked` date: a real ISO date, not before 2026-10-24 (the India verification) and not in the future', bad((r) => realDate(r.checked) && r.checked >= '2026-10-24' && r.checked <= today).length === 0, bad((r) => realDate(r.checked) && r.checked >= '2026-10-24' && r.checked <= today).join(','));
const urls = (r) => String(r.source || '').split(';').map((s) => s.trim()).filter((s) => /^https:\/\//.test(s));
ok('every row names a source with at least one https link, and source_url is the FIRST of them', bad((r) => urls(r).length >= 1 && r.source_url === urls(r)[0]).length === 0, bad((r) => urls(r).length >= 1 && r.source_url === urls(r)[0]).join(','));
const host = (u) => { try { return new URL(u).hostname; } catch (_) { return ''; } };
const vendorHost = { 'Tally Prime': (h) => h === 'help.tallysolutions.com', 'Zoho Books': (h) => h === 'www.zoho.com' };
ok('every link is on the vendor\'s own host (Tally: help.tallysolutions.com · Zoho: www.zoho.com)', bad((r) => urls(r).every((u) => vendorHost[r.package](host(u)))).length === 0, bad((r) => urls(r).every((u) => vendorHost[r.package](host(u)))).join(','));
ok('ids are unique and say country-package-capability (in-...)', new Set(IN.map((r) => r.id)).size === 16 && IN.every((r) => /^in-(tally-prime|zoho-books)-/.test(r.id)));
ok('what they claim is not empty: theirs, ours and a status of ahead|level|behind|n/a', bad((r) => r.theirs && r.ours && ['ahead', 'level', 'behind', 'n/a'].includes(r.status)).length === 0);

/* the real mapper */
const cs = fs.readFileSync(path.join(root, 'public', 'app', 'cap-standards.js'), 'utf8');
const a = cs.indexOf('var STD_COMPARE_STATUS'), endMark = '\n}\n', z = cs.indexOf(endMark, cs.indexOf('function stdCompareRows(json)')) + endMark.length;
const map = vm.runInNewContext(cs.slice(a, z) + '; stdCompareRows', {});
const painted = map(json).filter((r) => r.c[0] === 'IN');
ok('the Compared-with tab paints all 16 India rows (none dropped for a missing field)', painted.length === 16, String(painted.length));
ok('…each painted row keeps verified = source and its vendor link(s) as { url }', painted.every((r) => r.verified === 'source' && r.src.some((s) => /^https:\/\//.test(s.url || ''))));
const mutated = JSON.parse(JSON.stringify(json)); mutated.rows.find((r) => r.id === 'in-zoho-books-core-books').verified = 'guess';
ok('a row with a verified value the page does not know is DROPPED, not guessed (mapper: 15 of 16)', map(mutated).filter((r) => r.c[0] === 'IN').length === 15);

console.log('\n' + pass + ' ok, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
