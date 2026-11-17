/* standards-page.cjs — THE STANDARDS PAGE, PROVED (docs/design/standards-page/README.md · docs/design/standards/REQUIREMENT.md · docs/design/SYSTEM.md).
 * Pattern: cb-accounts.cjs + crm-themes.cjs — Playwright, a stand-in API answering INSIDE the page; the static server takes a free port from the OS.
 * Nothing here reaches localhost:3000, port 7351 or the live site: every /api/** call is fulfilled by ctx.route before it can leave the browser (and the
 * page is made to refuse any other host). The Standards page itself reads NO API (the register is cap-standards.js), so the stand-in's job is to PROVE that.
 *
 *  1  the register (cap-standards.js), COUNTED FROM THE SOURCE (STDREG1: never a fixed number — e2e/standards-one-list.cjs guards it): every row has an id,
 *     area · product area · kind · applies-in · plain words; every Partly and Planned row says what is missing; each round's rows are named by id (CO3 · CO1 ·
 *     CO2 · STDREG1) and carry their stated statuses; an In force row added since STDREG1 names its proof; no second WCAG contrast row
 *  2  laptop 1366×768: title · "checked <STD_CHECKED>" · the matrix beside the list; the matrix's All row IS the register's counts; the list is a CBList mount
 *     (three columns, a resize handle on each, only the rows scroll) with the head at most 20% of the window; no sideways scroll
 *  3  THE CELL IS THE LIST'S FILTER: Money & GST × Partly → its rows, two of the unit's own chips, one lit cell; a row heading filters the row, a column heading the
 *     status; a "—" cell does nothing; clearing a chip clears the cell; changing the unit's Filters popover moves the lit cell; Count by Country and Kind
 *  4  search · no match · Group by · a row opens with label : value and the two buttons; Copy puts the standard, clause, status and what is missing on the clipboard;
 *     Open in the app goes to the app's own door; a row with no place in the app has no such button; a New row says so
 *  5  the two sheets (Why follow standards · One record, every standard) render the register's own renderers; a planned field is dimmed by ink, not by opacity
 *  6  the Standards door on the index page: the register's own counts, the date, Read me opens the sheet; Settings › Standards keeps What you follow and the door
 *  7  phone 390×844: the matrix is page one, the list page two with ‹ back; document.scrollWidth === 390 on every view, with a row open and with a sheet open
 *  8  EVERY THEME, MEASURED: all 16 themes of CBScreen.APP_THEMES + Cream, on the laptop and the phone, on the matrix, a chosen cell with a row opened, and both
 *     sheets — every visible text pair clears WCAG AA (lib/theme-measure.cjs, the measurement e2e/crm-themes.cjs uses)
 *  +  no alert(), no "accounting" / "books of account", no page error, nothing leaves the browser, the page makes no /api call
 * Screenshots: e2e/shots/standards-{laptop,cell,row,phone-matrix,phone-list,sheet-why,sheet-record}.png, standards-dark-laptop.png, standards-terminal-phone.png
 * Playwright is not in the cloud image: `npm i @playwright/test` in a temp dir and NODE_PATH at it.                                                             */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const PUB = process.env.STP_PUB || path.join(ROOT, 'public');        /* STP_PUB=<dir> runs against another copy */
const SHOTS = path.join(__dirname, 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const { measure } = require('./lib/theme-measure.cjs');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const J = (r, status, o) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });

/* ── the register, read the way a page reads it: the file itself, run with the two helpers it asks its page for ── */
function readRegister(file) {
  const ctx = { tx: (s) => s, esc: (s) => String(s) };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8') + fs.readFileSync(path.join(path.dirname(file), 'cap-standards-build.js'), 'utf8') /* CAP-STD-1: the register's build rows, loaded after it as the page does */ + ';this.R = { S: STANDARDS, A: STD_AREAS, PA: STD_PRODUCT_AREAS, K: STD_KINDS, C: STD_COUNTRIES, ST: STD_STATUS, CH: STD_CHECKED, WHY: STD_WHY, REC: STD_RECORD, compat: stdCompatRows, abbrs: stdAbbrs, gl: stdGlossary, GL: STD_GLOSSARY };', ctx);
  return ctx.R;
}
const REG = readRegister(path.join(PUB, 'app', 'cap-standards.js'));
/* each round's rows, BY ID (STDREG1, 14 Oct 2026: rows were sliced by position — 61, 62, 63 … — so a row added mid-list moved every round's slice; ids do not
   move). CO is the compliance rounds' rows (CO3 · CO1 · CO2), proved by their own rule (section 1, last block). */
const BYID = {}; REG.S.forEach((r) => { BYID[r.id] = r; });
const IDS = {
  CO3: ['in-records-retention', 'in-books-in-india', 'au-records-retention', 'ae-records-retention'],
  CO1: ['privacy-processors', 'it-act-43a', 'it-intermediary-rules', 'dpdp-children', 'au-privacy-apps', 'ae-pdpl-rights', 'ae-pdpl-ropa'],
  CO2: ['cert-in', 'dpdp-breach', 'au-ndb', 'ae-pdpl-breach', 'iso27001-a8-15', 'csp3', 'iso27001-a8-5'],
};
const ROWS = (k) => IDS[k].map((id) => BYID[id]).filter(Boolean);
const CO = ROWS('CO3').concat(ROWS('CO1'), ROWS('CO2'));
const NEW = REG.S.filter((r) => r.added === '2026-10-14');   /* STDREG1's rows */
const COUNT = { live: 0, part: 0, plan: 0 }; REG.S.forEach((r) => { COUNT[r.s]++; });
/* M41: the page lists the register AND the Compatibility rows of public/data/compat.json (the 4th Kind); ALL is what the list and the matrix hold */
const COMPAT_JSON = JSON.parse(fs.readFileSync(path.join(PUB, 'data', 'compat.json'), 'utf8'));
const CROWS = REG.compat(COMPAT_JSON);
const cjHas = (sys) => (COMPAT_JSON.rows || []).some((x) => x.system === sys);
const ALL = REG.S.concat(CROWS), N = ALL.length;
const CA = { live: 0, part: 0, plan: 0 }; ALL.forEach((r) => { CA[r.s]++; });
const shownAll = () => new RegExp('^' + N + ' shown');
/* the design's data.js is DERIVED from the register (STDREG1): load it the way its index.html does — data.js, then the register — and read what it built */
const DESIGN_DERIVED = (() => { const g = {}; g.window = g; vm.createContext(g); vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs', 'design', 'standards-page', 'data.js'), 'utf8'), g); vm.runInContext(fs.readFileSync(path.join(PUB, 'app', 'cap-standards.js'), 'utf8') + fs.readFileSync(path.join(PUB, 'app', 'cap-standards-build.js'), 'utf8'), g); return vm.runInContext('window.STD_PAGE', g); })();
const CHECKED = new Date(REG.CH + 'T12:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });   /* "14 Oct 2026" — as the page says it */

/* the stand-in: every /api call is recorded and answered with nothing — the page is expected to ask for none */
async function route(S, r) { const q = r.request(), u = new URL(q.url()); S.calls.push(q.method() + ' ' + u.pathname); return J(r, 200, {}); }

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? path.join(ROOT, 'index.html') : path.join(PUB, rel);
    if (((!f.startsWith(PUB)) && f !== path.join(ROOT, 'index.html')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const threw = [], offHost = [];
  const tokFor = (c) => { const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return b64({ alg: 'none' }) + '.' + b64(Object.assign({ exp: Math.floor(Date.now() / 1000) + 3600 }, c)) + '.x'; };
  const OWNER = { token: tokFor({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Mayur', entity: 'Mayur Bhavan' };

  async function open(S, o) {
    o = o || {};
    const ctx = await b.newContext({ viewport: o.viewport || { width: 1366, height: 768 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
    /* Playwright runs the LAST-registered matching route first: the catch-all goes in first so the stand-in below wins for /api/** */
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { offHost.push(r.request().url()); return r.abort(); });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => route(S, r));
    /* the app's own door is not loaded here: "Open in the app" is proved by WHERE it goes */
    await ctx.route('**/till.html**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>till</title>the till' }));
    await ctx.route('**/app.html**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>app</title>the app' }));
    if (o.failCompat) await ctx.route('**/data/compat.json', (r) => r.fulfill({ status: 404, contentType: 'text/plain', body: 'no' }));
    if (o.session !== null) await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, o.session || OWNER);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => threw.push(e.message));
    await p.goto(base + (o.path || '/standards.html'));
    if (!o.noWait) await p.waitForSelector('[data-testid="std-matrix"] .mx .mx-all', { timeout: 15000 });
    await p.waitForFunction(() => window.CBScreen && window.CBAvatar);
    await p.waitForTimeout(250);
    return { ctx, p };
  }
  const width = (p) => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  const count = (p) => p.evaluate(() => (document.querySelector('.cbl-count') || {}).textContent || '');
  const rowIds = (p) => p.$$eval('[data-testid^="std-row-"]', (n) => n.map((x) => x.getAttribute('data-testid').replace('std-row-', '')));
  const chips = (p) => p.$$eval('.cbl-fchip', (n) => n.map((x) => x.textContent.replace('×', '').trim()));
  const pressed = (p) => p.$$eval('#mxBody [aria-pressed="true"]:not([data-dim]), #mxBody [aria-selected="true"]', (n) => n.map((x) => x.getAttribute('data-testid')));
  const idx = (name) => REG.S.findIndex((r) => r.n === name);

  /* ── 1 · the register ───────────────────────────────────────────────────────────────────────────────────── */
  {
    /* CO3 (2026-10-13): four record-keeping rows (IN · AU · AE), after CPS1's and LOC0's, named here — every one Partly */
    const CO3 = ['Companies Act 2013 s.128(5) · CGST Act s.36, Rules 56–57', 'Companies (Accounts) Rules r.3(5)–(6)',
      'TAA 1953 Sch 1 s.382-5 · Corporations Act 2001 s.286', 'Tax Procedures Decree-Law 28/2022 · Corporate Tax Decree-Law 47/2022 Art. 56'];
    const CO1 = ROWS('CO1'), CO2 = ROWS('CO2');
    ok(ROWS('CO3').length === 4 && ROWS('CO3').map((r) => r.n).join('|') === CO3.join('|') && ROWS('CO3').every((r) => r.s === 'part' && r.added === '2026-10-13'),
      'CO3\'s 4 record-keeping rows are on the register by id, each Partly');
    ok(COUNT.live + COUNT.part + COUNT.plan === REG.S.length && REG.S.length >= 109, 'the register holds ' + REG.S.length + ' standards, counted from the source: in force ' + COUNT.live + ' · partly ' + COUNT.part + ' · planned ' + COUNT.plan);
    const fields = REG.S.filter((r) => !r.id || !r.a || !r.pa || !r.k || !Array.isArray(r.c) || !r.c.length || !r.p);
    ok(fields.length === 0, 'every row has an id, an area, a product area, a kind, an applies-in and the plain-words line' + (fields.length ? ' — missing on ' + fields.map((r) => r.n).join('; ') : ''));
    const areas = REG.A.map((a) => a[0]), kinds = REG.K.map((k) => k[0]), ctry = REG.C.map((c) => c[0]);
    const pas = REG.PA.map((a) => a[0]);
    ok(REG.S.every((r) => areas.indexOf(r.a) >= 0 && pas.indexOf(r.pa) >= 0 && kinds.indexOf(r.k) >= 0 && r.c.every((c) => ctry.indexOf(c) >= 0)), 'every area, product area, kind and country code is one the vocabularies define');
    const noMiss = REG.S.filter((r) => r.s !== 'live' && !(r.m && r.m.length > 3));
    ok(noMiss.length === 0, 'every Partly and Planned row says what is missing' + (noMiss.length ? ' — ' + noMiss.map((r) => r.n).join('; ') : ''));
    ok(REG.S.every((r) => r.s !== 'live' || !r.m), 'an In force row carries no "missing" line (a stated limit is `limit`, shown as Limit:)');
    ok(REG.S.filter((r) => r.limit).every((r) => r.s === 'live') && ['schedule-iii', 'as2-inventories', 'gst-rcm', 'iso8601', 'country-standard'].every((id) => BYID[id] && BYID[id].limit), 'a stated limit sits only on an In force row; Schedule III, AS 2, reverse charge, ISO 8601 (N11) and the Country Standard (CPS1) still carry theirs');
    /* the design's data.js is derived from the register, row for row (STDREG1: it held a 61-row copy, compared field for field — a second list) */
    ok(DESIGN_DERIVED.rows.length === REG.S.length && DESIGN_DERIVED.rows.every((d, i) => d.key === REG.S[i].id && d.n === REG.S[i].n && d.s === REG.S[i].s), 'the design\'s data.js builds its ' + DESIGN_DERIVED.rows.length + ' rows from the register itself — no copy to drift');
    const added = REG.S.filter((r) => r.added === '2026-10-03');
    ok(added.length === 17 && added.filter((r) => r.s === 'live').length === 11 && added.filter((r) => r.s === 'part').length === 4 && added.filter((r) => r.s === 'plan').length === 2, 'the 17 adopted 2–3 Oct 2026 carry their stated statuses: 11 in force, 4 partly, 2 planned');
    const cm = REG.S.filter((r) => r.matrix === 'country');
    ok(cm.length === 1 && cm[0].c.join() === 'IN,AU,AE' && cm[0].s === 'live' && cm[0].limit, 'ONE Country Standard row (CPS1): applies in IN · AU · AE, In force with a stated limit, its opened row paints the matrix');
    const CMXJ = JSON.parse(fs.readFileSync(path.join(PUB, 'data', 'country-matrix.json'), 'utf8'));
    ok(Array.isArray(CMXJ.rows) && CMXJ.rows.length > 80 && CMXJ.packs.map((x) => x.id).join() === 'IN,AU,AE' && CMXJ.packs.every((x) => CMXJ.missing[x.id] && CMXJ.counts[x.id]), 'data/country-matrix.json is the engines\' generated matrix: ' + CMXJ.rows.length + ' members × IN · AU · AE, with counts and the ❌ list per pack (engines v' + CMXJ.engines + ')');
    ok(CO1.length === 7 && CO1.every((r) => r.a === 'people' && r.k === 'law' && r.s !== 'live' && r.added === '2026-10-13') && ['IN', 'AU', 'AE'].every((c) => CO1.some((r) => r.c.indexOf(c) >= 0)), 'CO1: 7 privacy rows for India, Australia and the UAE — none claims In force (the owner acts and the ◐ citations come first)');
    ok(REG.S.filter((r) => /WCAG/.test(r.n) && /1\.4\.3/.test(r.n)).length === 1 && /16 themes/.test(BYID['wcag-1.4.3'].note), 'no second WCAG contrast row: the existing one now says all 16 themes');
    ok(/^\d{4}-\d{2}-\d{2}$/.test(REG.CH) && REG.CH >= '2026-10-14', 'the register says when it was last checked (STD_CHECKED ' + REG.CH + ')');
    ok(CO1.length === 7 && CO1.every((r) => r.a === 'people' && r.k === 'law' && r.s !== 'live') && ['IN', 'AU', 'AE'].every((c) => CO1.some((r) => r.c.indexOf(c) >= 0)), 'CO1: 7 privacy rows for India, Australia and the UAE — none claims In force (the owner acts and the ◐ citations come first)');
    ok(new Set(REG.S.map((r) => r.n)).size === REG.S.length, 'no standard is listed twice');
    /* M41 · Compatibility: ONE file, every row a valid register row, honest about proof */
    const cj = COMPAT_JSON.rows || [];
    ok(cj.length > 0 && CROWS.length === cj.length, 'every row of data/compat.json maps onto a register row (' + CROWS.length + '/' + cj.length + ')');
    ok(new Set(cj.map((x) => x.id)).size === cj.length, 'no compatibility row is listed twice');
    ok(cj.every((x) => ['one-to-one', 'alongside', 'gap'].indexOf(x.fit) >= 0 && ['works', 'partly', 'planned'].indexOf(x.status) >= 0 && ['live', 'stand-in', 'not-yet'].indexOf(x.proof) >= 0), 'every row has a fit, a status and a proof from the three words each');
    ok(cj.filter((x) => x.status === 'works').every((x) => x.proof !== 'not-yet' && x.proof_ref && x.proof_ref.length > 8), 'no row says works without naming its proof (a test or a live run)');
    ok(cj.filter((x) => x.proof === 'live').every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.proof_at || '')), 'every live proof carries its date');
    ok(CROWS.every((r) => r.s === 'live' || (r.m && r.m.length > 3)), 'every compatibility row that is not working says what is missing');
    ok(['NetSuite', 'Tally', 'Zoho Books'].every((n) => cj.some((x) => x.system.indexOf(n) >= 0)), 'NetSuite, Tally and Zoho Books are on it (decision M-D9: the first three)');
    /* M41 · T2 the glossary: every abbreviation any row, sheet or record can show has an entry */
    const txt = []; ALL.forEach((r) => ['p', 'm', 'n', 'w', 'limit', 'eq', 'note', 'why', 'exWhy', 'at', 'proof', 'fit'].forEach((k) => r[k] && txt.push(r[k])));
    ['pleasure', 'pain'].forEach((k) => REG.WHY[k].forEach((x) => txt.push(x[0], x[1]))); REG.WHY.proof.forEach((x) => txt.push(x)); REG.REC.forEach((x) => txt.push(x.std, x.c));
    const noGl = {}; txt.forEach((t) => REG.abbrs(t).forEach((a) => { if (!REG.gl(a)) noGl[a] = 1; }));
    ok(Object.keys(noGl).length === 0, 'every abbreviation on the page has a glossary entry' + (Object.keys(noGl).length ? ' — none for: ' + Object.keys(noGl).join(' ') : ' (' + REG.GL.length + ' entries)'));
    ok(REG.GL.every((g) => g[0] && g[1] && g[2]), 'every entry has its full name and one line of meaning');
    /* CO2 · the compliance additions: each a law or a standard, with what is in force and not (note), where the proof is (at), and — unless In force — what is missing */
    ok(CO2.length === 7 && CO2.every((r) => (r.k === 'law' || r.k === 'std') && r.note && r.note.length > 80 && r.at && r.why && r.added === '2026-10-13'), 'CO2\'s 7 security rows each say what is in force, what is not, and where the proof is');
    ok(CO.length === 18 && CO.every((r) => (r.k === 'law' || r.k === 'std') && r.s !== 'live' && r.at && r.why && (r.s === 'plan' || (r.note && r.note.length > 80))), 'the ' + CO.length + ' compliance rows (CO3 · CO1 · CO2) are laws or standards, none In force, each with where the proof is and why — and, unless Planned, what is in force and what is not');
    ok(['IN', 'AU', 'AE'].every((c) => CO.some((r) => r.c.indexOf(c) >= 0 && r.k === 'law')), 'India, Australia and the UAE each have a law row from the compliance rounds');
    ok(CO2.filter((r) => r.k === 'law').every((r) => /\b(Act|Decree-Law|Directions|Rules)\b/.test(r.n)), 'every CO2 law row names its legal reference in its title');
    /* STDREG1 (14 Oct 2026) · what was missing, and the rows that said more than the code does */
    const want = ['beckn-core', 'ondc-registry', 'ondc-igm', 'ondc-rsf', 'ondc-taxonomy', 'au-gst-bas', 'aasb-101', 'aasb-102', 'au-div40', 'au-abn', 'ae-vat-201', 'pint-ae', 'ae-trn', 'hsn-sac', 'gstin-check', 'fx-ias21', 'openapi', 'gs1-ai', 'wcag-1.4.6'];
    ok(want.every((id) => BYID[id] && BYID[id].added === '2026-10-14'), 'STDREG1\'s rows are on the register (' + NEW.length + ' added 14 Oct 2026): Beckn · ONDC registry, IGM, RSF, taxonomy · BAS · AASB 101/102 · Division 40 · ABN · VAT 201 · PINT-AE · TRN · HSN/SAC · GSTIN · IAS 21 · OpenAPI · GS1 batch/expiry/serial · WCAG 1.4.6');
    ok(NEW.filter((r) => r.s === 'live').every((r) => /Proof: |tests?\//.test(r.note || '')), 'every In force row STDREG1 added names the test that proves it (' + NEW.filter((r) => r.s === 'live').map((r) => r.id).join(' · ') + ')');
    ok(BYID['ondc-registry'].s === 'plan' && /Beckn-compatible, not ONDC-registered/.test(BYID['ondc-registry'].note) && /Beckn-compatible, not ONDC-registered/.test(BYID['beckn-core'].note), 'the recorded decision stands, on both rows: Beckn-compatible, not ONDC-registered');
    ok(/200%/.test(BYID['wcag-1.4.4'].w) && BYID['wcag-1.4.4'].s !== 'live' && /132%/.test(BYID['wcag-1.4.4'].m), 'WCAG 1.4.4 says 200%, and says what we test (132%) — not In force');
    ok(BYID['wcag-1.4.6'].s !== 'live' && !/1\.4\.6/.test(BYID['wcag-1.4.3'].n), 'WCAG 1.4.6 is its own row and not In force: the contrast test measures AA only');
    ok(/AAL1/.test(BYID['nist-800-63b'].m) && !/about AAL2/i.test(BYID['nist-800-63b'].m), 'NIST SP 800-63B: one factor is AAL1');
    ok(BYID['wco-hs'].s === 'part' && BYID['oauth2-oidc'].s === 'live' && BYID['oauth2-oidc'].limit && /Zoho/.test(BYID['oauth2-oidc'].note), 'HS codes and OAuth 2 are up to what exists: HSN filed (Partly); Zoho reached with OAuth 2 — In force, the OIDC decision a stated Limit (STD-COMPARE)');
    /* STD-COMPARE (15 Oct 2026): the five audit fixes, each proved against the code (docs/critique/STD-COMPARE.md a) */
    ok(BYID['wcag-1.4.6'].s === 'part' && /High Contrast/.test(BYID['wcag-1.4.6'].m) && BYID['css-logical'].s === 'part' && /physical/.test(BYID['css-logical'].m), 'WCAG 1.4.6 is Partly (one theme measured at 7:1) and CSS logical properties Partly (the small apps still carry physical ones)');
    ok(['gherkin', 'oauth2-oidc', 'medusa-model'].every((id) => BYID[id].s === 'live' && BYID[id].limit && !BYID[id].m && /Proof: /.test(BYID[id].note)), 'Gherkin, OAuth 2 and the Medusa model are In force with nothing missing: the decision not to adopt more is a Limit, the proof is named');
    ok(cjHas('Xero'), 'compat.json names Xero (the Australian launch depends on it)');
  }

  /* ── the page's own source ── */
  {
    const src = fs.readFileSync(path.join(PUB, 'standards.html'), 'utf8');
    ok(!/\balert\s*\(/.test(src), 'no alert() anywhere in the page');
    ok(!/accounting|books of account/i.test(src), 'the source carries neither forbidden string');
    ok(/<title>Standards<\/title>/.test(src), 'the page is named Standards');
    ok(/CBList\.mount\(/.test(src) && /src="\/app\/list-ctl\.js"/.test(src) && /src="\/app\/cap-standards\.js"/.test(src), 'the list is a CBList mount and the register is cap-standards.js');
    ok(/stdWhyHTML\(/.test(src) && /stdRecordHTML\(/.test(src) && /HOME\[/.test(src), 'the sheets are the register' + String.fromCharCode(39) + 's stdWhyHTML / stdRecordHTML and the door is the HOME map');
    ok(!/PROTOTYPE|kbar/i.test(src) && src.indexOf("CBKural.mount({ route: 'planning' })") > 0 && src.indexOf('cbkural') < 0, 'no purple prototype strip; the kural band is CBKural itself, mounted once (Round U: the one frame — it sits below the page, never in the head)');
    ok(!/\bSTANDARDS\s*=\s*\[|window\.STD_PAGE/.test(src), 'the page holds no copy of the register');
    ok(/fetch\('\/data\/compat\.json'/.test(src) && /stdCompatRows\(/.test(src) && !/"system"\s*:/.test(src), 'the Compatibility rows are read from data/compat.json through stdCompatRows — the page holds none');
  }

  /* ── 2 · LAPTOP ──────────────────────────────────────────────────────────────────────────────────────────── */
  const S = { calls: [] };
  {
    const { ctx, p } = await open(S);
    ok(/^Standards$/.test((await p.textContent('.cbl-title h1')).trim()), 'the title row says Standards');
    ok(new RegExp('checked ' + CHECKED).test(await p.textContent('[data-testid="std-checked"]')), 'and "checked ' + CHECKED + '" — once; the counts are in the matrix, not repeated up here');
    ok(await p.locator('.cbl-title').innerText().then((t) => !/\b33\b/.test(t)), 'the title row does not repeat the totals the matrix\'s All row says');
    ok((await p.textContent('[data-testid="shop-name"]')).trim() === 'Mayur Bhavan', 'the signed-in shop is named in the title row');
    ok(await p.locator('#std_list.cbl').count() === 1 && await p.locator('#std_list .cbl-hdr').count() === 1, 'the list is a CBList mount (its header, its tools)');
    const heads = await p.$$eval('#std_list .cbl-hc', (h) => h.map((x) => x.innerText.replace(/[▲▼⇅]/g, '').trim()));
    ok(heads.join('|') === 'WHAT IT DOES FOR YOU|REFERENCE|KIND|APPLIES IN|STATUS', 'four columns (Kind is one of them) and the status: ' + heads.join(' · '));
    ok(await p.locator('#std_list .cbl-rz').count() === 5, 'every column has a resize handle (the unit\'s)');
    ok(shownAll().test(await count(p)), 'all ' + N + ' are listed (' + REG.S.length + ' standards + ' + CROWS.length + ' compatibility rows): ' + (await count(p)));
    const mxAll = await p.$$eval('[data-testid^="std-cell-*-"]', (n) => n.map((x) => x.textContent.trim()));
    ok(mxAll.join(' ') === CA.live + ' ' + CA.part + ' ' + CA.plan, 'the matrix\'s All row is the counts of every row listed: ' + mxAll.join(' · '));
    const areaRows = await p.$$eval('#mxBody .mx-rh', (n) => n.map((x) => x.textContent.trim()));
    ok(areaRows.join('|') === 'Selling|Buying|Money & GST|Books|People & privacy|Look & access|How we build|All', 'Count by Area: seven areas and All');
    /* every matrix cell is the register's own count */
    let cellsOk = true;
    for (const a of REG.A) for (const st of ['live', 'part', 'plan']) {
      const want = ALL.filter((r) => r.a === a[0] && r.s === st).length;
      const el = p.locator('[data-testid="std-cell-' + a[0] + '-' + st + '"]');
      const got = want ? (await el.count() ? (await el.textContent()).trim() : 'missing') : (await p.locator('#mxBody [aria-label="' + a[1] + ', ' + REG.ST.filter((x) => x[0] === st)[0][1] + ': none"]').count() ? '0' : 'missing');
      if (String(want) !== got) { cellsOk = false; console.log('     cell ' + a[0] + '/' + st + ' want ' + want + ' got ' + got); }
    }
    ok(cellsOk, 'all 21 area × status cells equal the register\'s own count (and a nothing is "—")');
    /* SHELL-ONE: the frame (the one header, 56 px) sits above the list on every page; the list's own head — title · tools · column header — is what the 20% holds */
    const frameB = () => p.evaluate(() => (document.querySelector('[data-testid="shell-header"]') || { getBoundingClientRect: () => ({ bottom: 0 }) }).getBoundingClientRect().bottom);
    const hdrB = await p.evaluate(() => document.querySelector('#std_list .cbl-hdr').getBoundingClientRect().bottom) - await frameB(), ih = 768;
    ok(hdrB / ih <= 0.20, 'the head (title · tools · column header, under the frame) is ' + Math.round(hdrB / ih * 100) + '% of the window (limit 20%)');
    ok(await p.evaluate(() => { const l = document.querySelector('#std_list .cbl-list'); return l.scrollHeight > l.clientHeight && getComputedStyle(l).overflowY !== 'visible'; }), 'only the rows scroll (the list is its own scroller; the head stays)');
    const w = await width(p);
    ok(w.sw <= w.iw, 'no sideways scroll on the laptop (' + w.sw + '/' + w.iw + ')');
    ok(await p.locator('.cbl-hc [data-sort]').count() >= 3 && await p.locator('[data-testid="cbl-filters-standards"]').count() === 1, 'sortable columns and a Filters button (the unit\'s)');
    await p.screenshot({ path: path.join(SHOTS, 'standards-laptop.png') });

    /* ── 3 · THE CELL IS THE LIST'S FILTER ── */
    await p.click('[data-testid="std-cell-money-part"]'); await p.waitForTimeout(250);
    const want3 = ALL.map((r, i) => [r, i]).filter(([r]) => r.a === 'money' && r.s === 'part').map(([, i]) => String(i)).sort();
    ok((await rowIds(p)).sort().join() === want3.join() && want3.length >= 3, 'Money & GST × Partly: the list shows exactly those ' + want3.length + ' (' + (await count(p)) + ')');
    ok(new RegExp(want3.length + ' shown of ' + N).test(await count(p)), 'and says "' + want3.length + ' shown of ' + N + '"');
    const ch = await chips(p);
    ok(ch.length === 2 && ch.indexOf('Status: Partly') >= 0 && ch.indexOf('Area: Money & GST') >= 0, 'the unit\'s own chips carry the choice (' + ch.join(' · ') + ')');
    ok((await pressed(p)).join() === 'std-cell-money-part', 'exactly one cell is lit');
    const missing = await p.$$eval('[data-testid^="std-row-"] [data-testid="std-status-more"]', (n) => n.map((x) => x.parentElement.textContent.replace(/\s+/g, ' ').trim()));
    ok(missing.length === want3.length && missing.every((t) => /^[^a-z]*Partly — ./.test(t)), 'each of the ' + want3.length + ' rows says what is missing IN its Status cell, after the word: ' + missing[0]);
    ok(await p.locator('[data-testid^="std-row-"] .miss').count() === 0, 'and no "Missing:" text sits in the title any more');
    /* TIDY 1 · Kind is a column of its own: the same four words as the Kind filter, no tag inside the Reference text */
    const kinds = await p.$$eval('[data-testid^="std-row-"] [data-testid="std-kind"]', (n) => n.map((x) => x.textContent.trim()));
    ok(kinds.length === want3.length && kinds.every((k) => ['Law', 'Standard', 'Practice', 'Compatibility'].indexOf(k) >= 0), 'the Kind column holds one of Law · Standard · Practice · Compatibility: ' + kinds.join(' · '));
    ok(await p.locator('[data-testid^="std-row-"] .sn .kind').count() === 0, 'and the kind tag is gone from the Reference text');
    /* TIDY 2 · ONE LINE per row on the laptop: every row is as tall as one line of text, and the table fills the width */
    const geo = await p.evaluate(() => { const rs = Array.from(document.querySelectorAll('#std_list .cbl-row')); const hs = rs.map((r) => r.getBoundingClientRect().height); const row = rs[0].getBoundingClientRect(), box = document.querySelector('#std_list .cbl-list').getBoundingClientRect(); return { max: Math.max.apply(null, hs), n: rs.length, fill: row.width / box.width }; });
    ok(geo.n > 0 && geo.max <= 44, 'one line per row at 1366: the tallest of ' + geo.n + ' rows is ' + Math.round(geo.max) + ' px (limit 44)');
    ok(geo.fill >= 0.97, 'and the table fills the width of the list (' + Math.round(geo.fill * 100) + '%)');
    const hdrB2 = await p.evaluate(() => document.querySelector('#std_list .cbl-hdr').getBoundingClientRect().bottom) - await frameB();
    console.log('     head with a cell chosen: ' + Math.round(hdrB2 / ih * 100) + '% (two chips; the unit wraps them to a line of their own)');
    ok(hdrB2 / ih <= 0.25, 'the head with a cell chosen stays within 25% (' + Math.round(hdrB2 / ih * 100) + '%)');
    await p.screenshot({ path: path.join(SHOTS, 'standards-cell.png') });
    /* the same cell again clears it */
    await p.click('[data-testid="std-cell-money-part"]'); await p.waitForTimeout(200);
    ok(shownAll().test(await count(p)) && (await chips(p)).length === 0 && (await pressed(p)).join() === 'std-mx-row-*', 'choosing the lit cell again clears it (the All row is lit, no chips)');
    /* a row heading filters the row */
    await p.click('[data-testid="std-mx-row-books"]'); await p.waitForTimeout(200);
    ok(ALL.filter((r) => r.a === 'books').length + ' shown of ' + N === (await count(p)).trim() && (await chips(p)).join() === 'Area: Books', 'a row heading filters the row: Books → ' + (await count(p)));
    /* a column heading filters the status */
    await p.click('[data-testid="std-mx-col-plan"]'); await p.waitForTimeout(200);
    ok((await count(p)).indexOf(CA.plan + ' shown of ' + N) === 0 && (await chips(p)).join() === 'Status: Planned' && (await pressed(p)).join() === 'std-mx-col-plan,std-cell-*-plan', 'a column heading filters the status: Planned → ' + (await count(p)) + ', one chip, that heading lit with the All × Planned cell (the same filter)');
    /* a "—" cell does nothing */
    const nilSel = '#mxBody .mx-c.nil';
    const before = await count(p), nilTag = await p.$eval(nilSel, (e) => e.tagName.toLowerCase());
    await p.click(nilSel, { force: true }); await p.waitForTimeout(150);
    ok(nilTag === 'span' && before === await count(p), 'a cell with nothing in it ("—") is not a control and does nothing');
    /* clearing the chip clears the cell */
    await p.click('.cbl-fchip button'); await p.waitForTimeout(200);
    ok(shownAll().test(await count(p)), 'removing the unit\'s chip returns all ' + N);
    /* the unit's Filters popover and the matrix are one state */
    await p.click('[data-testid="cbl-filters-standards"]');
    await p.selectOption('[data-testid="cbl-filters-pop-standards"] select[data-filt="status"]', 'part'); await p.waitForTimeout(250);
    await p.keyboard.press('Escape');
    ok((await pressed(p)).join() === 'std-mx-col-part,std-cell-*-part', 'choosing Status: Partly in the Filters popover lights the matrix\'s Partly heading (one state, shown twice)');
    await p.click('[data-testid="std-mx-row-*"]'); await p.waitForTimeout(150);
    ok(shownAll().test(await count(p)), 'the All row clears everything');

    /* Count by Country and Kind */
    await p.click('[data-testid="cbl-group-standards"] [data-group="country"]'); await p.waitForTimeout(150);
    const crows = await p.$$eval('#mxBody .mx-rh', (n) => n.map((x) => x.textContent.trim()));
    ok(crows.join('|') === 'India|Australia|UAE|Global|All', 'Count by Country: India, Australia, UAE (CPS1: the registered packs), Global, All');
    await p.click('[data-testid="std-cell-IN-part"]'); await p.waitForTimeout(250);
    const inPart = ALL.filter((r) => r.c.indexOf('IN') >= 0 && r.s === 'part').length;
    ok((await count(p)).indexOf(inPart + ' shown') === 0 && (await chips(p)).join('|').indexOf('Applies in: India') >= 0, 'India × Partly filters by Applies in: India → ' + (await count(p)) + ' (' + (await chips(p)).join(' · ') + ')');
    await p.screenshot({ path: path.join(SHOTS, 'standards-country.png') });
    await p.click('[data-testid="cbl-group-standards"] [data-group="kind"]'); await p.waitForTimeout(250);
    const krows = await p.$$eval('#mxBody .mx-rh', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    ok(krows.join('|') === 'Lawyou must|Standardagreed worldwide|Practicethe common way|Compatibilityworks with|Build rulewe hold ourselves to it|All', 'Count by Kind: Law, Standard, Practice, Compatibility, Build rule (with what each means), All');
    ok(shownAll().test(await count(p)) && (await chips(p)).length === 0, 'ONE choice: the Group by in the toolbar moved the left table (Counted by Kind); it cleared the cell choice (a cell of one view means nothing in another)');
    ok(/Counted by Kind/.test(await p.textContent('[data-testid="std-mx-by"]')) && await p.locator('[data-dim]').count() === 0, 'there is no second Count by control — the table follows Group by');
    await p.click('[data-testid="cbl-group-standards"] [data-group="none"]'); await p.waitForTimeout(250);
    ok((await p.$$eval('#mxBody .mx-rh', (n) => n.map((x) => x.textContent.trim()))).join('|') === 'All', 'Group by None: the table is the All row only');
    await p.click('[data-testid="cbl-group-standards"] [data-group="kind"]'); await p.waitForTimeout(250);
    await p.click('[data-testid="std-cell-law-live"]'); await p.waitForTimeout(250);
    ok((await count(p)).indexOf(REG.S.filter((r) => r.k === 'law' && r.s === 'live').length + ' shown') === 0, 'Law × In force filters by Kind → ' + (await count(p)));
    /* M41 · the 4th Kind: Compatibility × In force lists the compat.json rows that work, each with its proof when opened */
    await p.click('[data-testid="std-cell-compat-live"]'); await p.waitForTimeout(250);
    const cl = CROWS.filter((r) => r.s === 'live').length;
    ok(cl > 0 && (await count(p)).indexOf(cl + ' shown') === 0 && (await chips(p)).join('|').indexOf('Kind: Compatibility') >= 0, 'Compatibility × In force lists the ' + cl + ' working rows of data/compat.json → ' + (await count(p)));
    const cIds = await rowIds(p);
    ok(cIds.length === cl && cIds.every((i) => +i >= REG.S.length && ALL[+i].k === 'compat'), 'they are the compatibility rows, after the register\'s ' + REG.S.length);
    await p.click('[data-testid="std-row-' + cIds[0] + '"]'); await p.waitForTimeout(250);
    const cdl = await p.textContent('[data-testid="std-detail-' + cIds[0] + '"]');
    ok(/Proof/.test(cdl) && /Tested live|Proven on a stand-in/.test(cdl) && /Fit/.test(cdl) && /compatibility register \(data\/compat\.json\)/.test(cdl), 'an opened compatibility row says its fit, its proof and where it comes from: ' + cdl.replace(/\s+/g, ' ').slice(0, 160));
    await p.screenshot({ path: path.join(SHOTS, 'standards-compat.png') });
    await p.click('[data-testid="std-row-' + cIds[0] + '"]'); await p.waitForTimeout(150);
    await p.click('[data-testid="std-mx-row-*"]'); await p.waitForTimeout(150);
    await p.click('[data-testid="cbl-group-standards"] [data-group="area"]'); await p.waitForTimeout(200);

    /* ── 4 · search · no match · group · a row opens ── */
    await p.fill('[data-testid="listctl-search-standards"]', 'privacy'); await p.waitForTimeout(300);
    const privIds = await rowIds(p);
    ok(privIds.length > 0 && privIds.every((i) => JSON.stringify(ALL[+i]).toLowerCase().indexOf('privacy') >= 0 || /privacy/i.test(REG.A.filter((a) => a[0] === ALL[+i].a)[0][1])), 'search "privacy" lists only standards that say it (' + privIds.length + ')');
    ok(await p.locator('[data-testid="std-mx-note"]').count() === 1, 'and the matrix says it still counts the whole register while a search is on');
    await p.screenshot({ path: path.join(SHOTS, 'standards-search.png') });
    await p.fill('[data-testid="listctl-search-standards"]', 'zzzz'); await p.waitForTimeout(300);
    ok(await p.locator('[data-testid="cbl-nomatch-standards"]').count() === 1 && /Nothing matches/.test(await p.textContent('[data-testid="cbl-nomatch-standards"]')), 'a search with no match says so and offers Clear');
    await p.click('[data-testid="cbl-nomatch-standards"] button'); await p.waitForTimeout(250);
    ok(shownAll().test(await count(p)), 'Clear brings all ' + N + ' back');
    await p.click('[data-testid="cbl-group-standards"] [data-group="kind"]'); await p.waitForTimeout(200);
    await p.evaluate(() => { const l = document.querySelector('#std_list .cbl-list'); l.scrollTop = l.scrollHeight; }); await p.waitForTimeout(500);   /* the unit draws 50 rows at a time; the last group's head arrives with its rows */
    await p.evaluate(() => { const l = document.querySelector('#std_list .cbl-list'); l.scrollTop = l.scrollHeight; }); await p.waitForTimeout(300);
    const gk = await p.$$eval('#std_list .cbl-group', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    console.log('     groups: ' + JSON.stringify(gk));
    ok(gk.length === 5 && /Law/.test(gk[0]) && /Standard/.test(gk[1]) && /Practice/.test(gk[2]) && /Compatibility/.test(gk[3]) && /Build rule/.test(gk[4]), 'Group by Kind: Law · Standard · Practice · Compatibility · Build rule, in that order, each with its count: ' + gk[0]);
    await p.click('[data-testid="cbl-group-standards"] [data-group="country"]'); await p.waitForTimeout(200);
    /* the unit draws 50 rows at a time: scroll until every row is drawn, so the last group's head is there (STDREG1: more rows than two pages) */
    for (let k = 0; k < Math.ceil(N / 50) + 1; k++) { await p.evaluate(() => { const l = document.querySelector('#std_list .cbl-list'); l.scrollTop = l.scrollHeight; }); await p.waitForTimeout(300); }
    const gc = await p.$$eval('#std_list .cbl-group', (n) => n.map((x) => x.textContent.replace(/^[^A-Za-z]+/, '').replace(/\s+/g, ' ').trim().split(' ·')[0].replace(/\s*\d+$/, '').trim()));
    ok(gc.join('|') === 'India|Australia|UAE|India and global|Australia and global|Global|India, Australia, UAE', 'Group by Country: one country alone (India · Australia · UAE), India and global, Australia and global (Xero, STDREG1), Global, then the rows that apply in all three (' + gc.join(' | ') + ')');
    await p.click('[data-testid="cbl-group-standards"] [data-group="area"]'); await p.waitForTimeout(200);

    /* CPS1: the Country Standard row opens to the GENERATED matrix — the engines' counts, painted, not computed here */
    {
      const ci = REG.S.findIndex((r) => r.matrix === 'country');
      const CMXJ = JSON.parse(fs.readFileSync(path.join(PUB, 'data', 'country-matrix.json'), 'utf8'));
      await p.fill('[data-testid="listctl-search-standards"]', 'Country Standard'); await p.waitForTimeout(300);
      await p.click('[data-testid="std-row-' + ci + '"]'); await p.waitForTimeout(300);
      const cm = p.locator('[data-testid="std-country-matrix"]');
      ok(await cm.locator('.mx[role="table"]').count() === 1 && await cm.locator('[data-testid="std-country-matrix-err"]').count() === 0, 'the opened Country Standard row paints the matrix with the pane\'s own grid');
      const miss = {}; for (const id of ['IN', 'AU', 'AE']) miss[id] = (await p.textContent('[data-testid="std-cmx-' + id + '-missing"]')).trim();
      ok(['IN', 'AU', 'AE'].every((id) => miss[id] === String(CMXJ.counts[id].missing)), 'its ❌ counts are the engines\' own: IN ' + miss.IN + ' · AU ' + miss.AU + ' · AE ' + miss.AE);
      ok(await cm.locator('.mx-r').count() > 100 && /Generated from the packs chitbridge-engines v/.test(await p.textContent('[data-testid="std-detail-' + ci + '"]')), 'every member is a row, and the Source line names the engines version the matrix came from');
      await p.screenshot({ path: path.join(SHOTS, 'standards-country-matrix.png') });
      await p.click('[data-testid="std-row-' + ci + '"]'); await p.waitForTimeout(150);
    }
    /* a row opens: the GSTR row (Partly, Money & GST) */
    const gi = idx('GSTR-1 / GSTR-3B (GSTN schema)');
    await p.fill('[data-testid="listctl-search-standards"]', 'GSTR-1'); await p.waitForTimeout(300);
    await p.click('[data-testid="std-row-' + gi + '"]'); await p.waitForTimeout(250);
    const dl = await p.textContent('[data-testid="std-detail-' + gi + '"]');
    console.log('     dl: ' + dl.replace(/\s+/g, ' ').slice(0, 400));
    ok(/Covers/.test(dl) && /Kind\s*Law\s*you must/.test(dl) && /Source/.test(dl) && !/Missing:/.test(dl), 'the row opens to label : value — Covers · Kind · Source (what is missing is already in the row, not said twice)');
    ok(/New\s*Adopted 2–3 Oct 2026; not yet in the register/.test(dl), 'a 2–3 Oct 2026 addition says it is New and not yet in the register');
    ok(/Why it matters|Elsewhere|In the app/.test(dl), 'and the rest of what a buyer or CA checks (why it matters · in the app)');
    ok(await p.locator('[data-testid="std-go"]').count() === 1 && await p.locator('[data-testid="std-copy"]').count() === 1, 'UX-99 · a returns row opens its home, Accounts › Tax close (Open in the app ›), and still offers Copy');
    ok(/Copy for a buyer or CA/.test(await p.textContent('[data-testid="std-copy"]')), 'its words are the design' + String.fromCharCode(39) + 's');
    /* M41 · T2: the opened row's terms explain themselves on a tap; on the closed row a tap still opens the row */
    const dab = p.locator('[data-testid="std-detail-' + gi + '"] abbr.gl').first();
    const dT = await dab.getAttribute('data-gl');
    await dab.click(); await p.waitForTimeout(150);
    ok(await p.locator('[data-testid="std-gloss-pop"]').isVisible() && (await p.textContent('[data-testid="std-gloss-pop"]')).indexOf(dT + ' — ' + REG.gl(dT)[1]) === 0 && await p.locator('[data-testid="std-detail-' + gi + '"]').count() === 1, 'tapping ' + dT + ' in the opened row shows "' + dT + ' — ' + REG.gl(dT)[1] + '" and the row stays open');
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    ok(!(await p.locator('[data-testid="std-gloss-pop"]').isVisible()), 'Escape hides it');
    ok(await p.locator('[data-testid="std-row-' + gi + '"] abbr.gl[title]').count() > 0 && await p.locator('[data-testid="std-row-' + gi + '"] abbr.gl[tabindex]').count() === 0, 'the row\'s own terms carry their full name as a title, without a tab stop each');
    await p.screenshot({ path: path.join(SHOTS, 'standards-row.png') });
    await p.click('[data-testid="std-copy"]'); await p.waitForTimeout(250);
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    ok(/GSTR-1 \/ GSTR-3B/.test(clip) && /Status: Partly/.test(clip) && /Missing: /.test(clip) && /Kind: Law/.test(clip) && new RegExp('Checked ' + CHECKED).test(clip), 'Copy puts the standard, kind, status, what is missing and the date on the clipboard');
    ok(!/<[a-z]/i.test(clip) && clip.indexOf('⭐') < 0, 'and it is plain text — no markup, no code-comment markers');
    ok(/Copied/.test(await p.textContent('#toast')), 'and says Copied');
    /* a row with a long note says what is missing IN FULL when opened */
    const gs1 = idx('GS1');
    await p.fill('[data-testid="listctl-search-standards"]', 'GS1'); await p.waitForTimeout(300);
    const gsRow = p.locator('[data-testid="std-row-' + gs1 + '"]');
    await gsRow.click(); await p.waitForTimeout(250);
    const gdl = await p.textContent('[data-testid="std-detail-' + gs1 + '"]');
    ok(/What is missing, in full/.test(gdl) && /check-digit validation is not enforced/.test(gdl) && /In the register/.test(gdl) && !/New/.test(gdl), 'a Partly row from the register opens to "What is missing, in full" (the register\'s own note) and says it is In the register');
    await gsRow.click(); await p.waitForTimeout(150);
    await p.fill('[data-testid="listctl-search-standards"]', 'GSTR-1'); await p.waitForTimeout(300);
    /* TIDY 6 · "Open in the app" is offered only where a CUSTOMER home exists (the till); never the workshop, app.html */
    const till = REG.S.findIndex((r) => r.go === 'till');
    await p.fill('[data-testid="listctl-search-standards"]', REG.S[till].n); await p.waitForTimeout(300);
    await p.click('[data-testid="std-row-' + till + '"]'); await p.waitForTimeout(200);
    await Promise.all([p.waitForURL(/till[.]html/), p.click('[data-testid="std-go"]')]);
    ok(p.url().indexOf('/till.html') > 0 && p.url().indexOf('app.html') < 0, 'Open in the app › on a till row goes to the till, not the workshop (' + p.url().replace(base, '') + ')');
    const srcP = fs.readFileSync(path.join(PUB, 'standards.html'), 'utf8');
    ok(/var HOME = [{][^}]*[}]/.test(srcP) && !/HOME = [{][^}]*app[.]html/.test(srcP), 'the page HOME map names customer pages only');
    await ctx.close();
  }
  {
    /* a row whose place in the app is not named has no Open button */
    const { ctx, p } = await open(S);
    const noGo = REG.S.map((r, i) => [r, i]).filter(([r]) => !r.go)[0];
    ok(!!noGo, 'the register has a row with no place in the app: ' + (noGo && noGo[0].n));
    await p.fill('[data-testid="listctl-search-standards"]', noGo[0].n); await p.waitForTimeout(300);
    await p.click('[data-testid="std-row-' + noGo[1] + '"]'); await p.waitForTimeout(200);
    ok(await p.locator('[data-testid="std-go"]').count() === 0 && await p.locator('[data-testid="std-copy"]').count() === 1, 'it offers Copy only — never a button that goes nowhere');
    await ctx.close();
  }

  /* ── 5 · THE TWO SHEETS ── */
  {
    const { ctx, p } = await open(S);
    await p.click('[data-testid="std-open-why"]'); await p.waitForSelector('dialog[open] [data-testid="std-sheet-why"]'); await p.waitForTimeout(200);
    const why = await p.textContent('[data-testid="std-sheet-why"]');
    ok(/crosses a boundary/i.test(why) && /What it buys/i.test(why) && /What it costs/i.test(why) && /What it has actually caught here/i.test(why), 'Why follow standards: the structural claim · what it buys · what it costs · what it has actually caught');
    ok(/117 real failures/.test(why) && /broken promise/.test(why), 'with the evidence and the obligation it creates, in the register\'s own words');
    /* M41 · T3: the gist leads (each bold line), the story is folded under it, Expand all / Collapse all */
    const folds = await p.$$eval('[data-testid="std-why-fold"]', (n) => n.map((d) => ({ open: d.open, h: d.getBoundingClientRect().height })));
    ok(folds.length === REG.WHY.pleasure.length + REG.WHY.pain.length && folds.every((x) => !x.open), 'Why follow: ' + folds.length + ' points, each its one bold line, the story folded');
    await p.click('[data-testid="std-sheet-why"] [data-testid="std-fold-all"]'); await p.waitForTimeout(100);
    ok(await p.$$eval('[data-testid="std-why-fold"]', (n) => n.every((d) => d.open)), 'Expand all opens every story');
    await p.click('[data-testid="std-sheet-why"] [data-testid="std-fold-none"]'); await p.waitForTimeout(100);
    ok(await p.$$eval('[data-testid="std-why-fold"]', (n) => n.every((d) => !d.open)), 'Collapse all folds them again');
    /* M41 · T2 inside a sheet: a term explains itself over the sheet */
    const ab = p.locator('[data-testid="std-sheet-why"] abbr.gl').first();
    const abT = await ab.getAttribute('data-gl');
    await p.click('[data-testid="std-sheet-why"] [data-testid="std-fold-all"]'); await ab.click(); await p.waitForTimeout(150);
    ok(await p.locator('dialog[open] [data-testid="std-gloss-pop"]').isVisible() && (await p.textContent('[data-testid="std-gloss-pop"]')).indexOf(abT + ' — ' + REG.gl(abT)[1]) === 0, 'in a sheet, tapping ' + abT + ' shows its full name over the sheet');
    const sb = await p.evaluate(() => { const r = document.getElementById('sheet').getBoundingClientRect(); return { w: r.width, l: r.left, iw: window.innerWidth }; });
    ok(sb.w <= 560 && sb.l > 700, 'on a laptop it is a side sheet (' + Math.round(sb.w) + ' px wide, from ' + Math.round(sb.l) + ')');
    await p.screenshot({ path: path.join(SHOTS, 'standards-sheet-why.png') });
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    ok(await p.locator('dialog[open]').count() === 0, 'Esc closes the sheet');
    await p.click('[data-testid="std-open-record"]'); await p.waitForSelector('dialog[open] [data-testid="std-sheet-record"]'); await p.waitForTimeout(200);
    const rec = await p.textContent('[data-testid="std-sheet-record"]');
    ok(/One chit, every standard in it/i.test(rec) && rec.indexOf('0904.11') > 0 && rec.indexOf('08901234567894') > 0, 'One record, every standard: the pepper chit, a real HS code and a real GTIN');
    ok(/ISO 6523 · planned/i.test(rec) && /Greyed fields are not built yet/i.test(rec) && /never translated/i.test(rec), 'planned fields are labelled planned, "not built yet" is said, and the product name is marked never translated');
    const dim = await p.evaluate(() => {
      const planned = Array.from(document.querySelectorAll('[data-testid="std-rec-field"]')).filter((d) => /ISO 6523 · planned/.test(d.textContent)).pop();
      const live = Array.from(document.querySelectorAll('[data-testid="std-rec-field"]')).filter((d) => /ISO 4217 · in force/.test(d.textContent)).pop();
      const op = (n) => { let a = 1; for (; n && n !== document.body; n = n.parentElement) a *= Number(getComputedStyle(n).opacity); return a; };
      const val = (d) => getComputedStyle(d.querySelector('span:nth-child(2)')).color;
      return { opP: op(planned), opL: op(live), cP: val(planned), cL: val(live) };
    });
    ok(dim.opP === 1 && dim.opL === 1 && dim.cP !== dim.cL, 'a planned field is dimmed by the theme\'s muted ink (' + dim.cP + ' vs ' + dim.cL + '), not by opacity (' + dim.opP + ')');
    /* M41 · T4: each standard on the pepper chit is a block — closed, its name showing; open, what the standard is and why it applies */
    const blocks = await p.$$eval('[data-testid="std-rec-field"]', (n) => n.map((d) => d.open));
    ok(blocks.length === REG.REC.length && blocks.every((o) => !o), 'One record: ' + blocks.length + ' fields, each a closed block');
    const iso = p.locator('[data-testid="std-rec-field"]', { hasText: 'ISO 6523 · planned' });
    await iso.locator('summary').click(); await p.waitForTimeout(150);
    ok(await iso.evaluate((d) => d.open) && /ISO 6523/.test(await iso.innerText()) && /Scheme first/.test(await iso.innerText()), 'tapping ISO 6523 opens what it is (the register\'s line) and why it applies here');
    await p.click('[data-testid="std-sheet-record"] [data-testid="std-fold-all"]'); await p.waitForTimeout(100);
    ok((await p.$$eval('[data-testid="std-rec-field"]', (n) => n.every((d) => d.open))), 'Expand all opens every block');
    await p.click('[data-testid="std-sheet-record"] [data-testid="std-fold-none"]'); await p.waitForTimeout(100);
    ok((await p.$$eval('[data-testid="std-rec-field"]', (n) => n.every((d) => !d.open))), 'Collapse all closes them');
    await p.screenshot({ path: path.join(SHOTS, 'standards-sheet-record.png') });
    await p.click('[data-testid="std-sheet-x"]'); await p.waitForTimeout(150);
    ok(await p.locator('dialog[open]').count() === 0, 'the ✕ closes it');
    await ctx.close();
    const o2 = await open(S, { path: '/standards.html?sheet=why' });
    ok(await o2.p.locator('dialog[open] [data-testid="std-sheet-why"]').count() === 1, '/standards.html?sheet=why opens the first sheet (the door\'s Read me)');
    await o2.ctx.close();
    /* M41: data/compat.json cannot be read → the register still lists in full, and the matrix SAYS the compatibility rows are missing */
    const o3 = await open(S, { failCompat: true });
    ok(new RegExp('^' + REG.S.length + ' shown').test(await count(o3.p)) && await o3.p.locator('[data-testid="std-compat-err"]').isVisible() && /could not be read/.test(await o3.p.textContent('[data-testid="std-compat-err"]')), 'compat.json unreadable: the 61 standards still list and the matrix says the compatibility rows could not be read');
    await o3.ctx.close();
  }

  /* ── 6 · THE WAY IN from the index page (N18: Home is the shell; Standards is a Setup card of the manifest), and Settings ── */
  {
    const SI = { calls: [] };
    const { ctx, p } = await open(SI, { path: '/', noWait: true });
    await p.waitForSelector('[data-testid="shell-card-standards"]', { timeout: 15000 });
    ok(await p.getAttribute('[data-testid="shell-card-standards"]', 'href') === '/standards.html', 'the index page (the shell\'s Home) links Standards');
    ok(await p.getAttribute('[data-testid="shell-card-crm"]', 'href') === '/crm.html', 'and CRM as a Running card');
    ok(await p.locator('[data-testid="shell-pillar-accounting"] [data-testid="shell-card-standards"]').count() === 1, 'Standards sits in the Accounts pillar (Home pillars, 2026-10-09)');
    await ctx.close();
  }
  {
    /* Settings › Standards: run the function as the app does, with the helpers it needs */
    const src = fs.readFileSync(path.join(PUB, 'app', 'cap-admin.js'), 'utf8');
    const a = src.indexOf('function standardsSettingsHTML(){'), z = src.indexOf('function appearanceSettingsHTML(){');
    const fnSrc = src.slice(a, z);
    ok(a > 0 && z > a, 'cap-admin.js still has standardsSettingsHTML');
    ok(!/setStdTab|std-tab-|groupsOf|BADGE/.test(fnSrc) && !/function stdTab\(|function setStdTab\(/.test(src), 'Settings no longer lists the register: its tabs, rows and badges are gone from cap-admin.js');
    const g = { _CARD: '', _misHead: (t) => '<h2>' + t + '</h2>', esc: (s) => String(s), tx: (s) => s, stdCounts: null,
      CBLocale: { regionInfo: () => ({ name: 'India' }), langs: () => ['en'], langName: (x) => x, dir: () => 'ltr', tag: () => 'en-IN', number: () => '1,23,45,678.5', money: () => '₹1,23,456.50', date: () => '3 Oct 2026', time: () => '10:00', timezone: () => 'Asia/Kolkata', workdays: () => [1, 2, 3, 4, 5, 6], hasWorkdayOverride: () => false } };
    vm.createContext(g);
    vm.runInContext(fs.readFileSync(path.join(PUB, 'app', 'cap-standards.js'), 'utf8'), g);
    const html = vm.runInContext(fnSrc + ';standardsSettingsHTML()', g);
    ok(/data-testid="std-yours"/.test(html) && /Region/.test(html) && /Reading order/.test(html), 'Settings › Standards keeps What you follow — the live reading of the person\'s own settings');
    ok(/href="\/standards\.html"/.test(html) && new RegExp(REG.S.filter((r) => r.s === 'live').length + ' in force').test(html) && new RegExp(REG.S.filter((r) => r.s === 'part').length + ' partly').test(html), 'and the door to the page, with the register\'s own counts (all rows, the compliance additions too)');
    ok(!/Incoterms|BCP 47|GS1|What we follow<|Your trade|Why bother/.test(html), 'and lists no standard (the register is read on the page)');
  }

  /* ── 7 · PHONE ───────────────────────────────────────────────────────────────────────────────────────────── */
  {
    const { ctx, p } = await open(S, { viewport: { width: 390, height: 844 } });
    let w = await width(p);
    ok(w.sw === 390, 'phone, matrix page: document.scrollWidth === 390 (' + w.sw + ')');
    ok(await p.locator('#mxp').isVisible() && !(await p.locator('#main').isVisible()), 'the matrix is page one (the list is not on it)');
    ok(await p.locator('[data-testid="std-back"]').isHidden(), 'and it has no ‹ back');
    const mb = await p.evaluate(() => document.querySelector('#mxBody .mx').getBoundingClientRect().right);
    ok(mb <= 390, 'the matrix fits the width (right edge ' + Math.round(mb) + ')');
    await p.screenshot({ path: path.join(SHOTS, 'standards-phone-matrix.png') });
    await p.click('[data-testid="std-cell-money-part"]'); await p.waitForTimeout(300);
    ok(await p.locator('#main').isVisible() && !(await p.locator('#mxp').isVisible()), 'a cell opens page two: the list');
    const mp = ALL.filter((r) => r.a === 'money' && r.s === 'part').length;
    ok((await rowIds(p)).length === mp, 'with the ' + mp + ' rows of the cell (counted from the source)');
    ok(await p.locator('[data-testid="std-back"]').isVisible(), 'and a ‹ back');
    w = await width(p);
    ok(w.sw === 390, 'phone, list page: document.scrollWidth === 390 (' + w.sw + ')');
    const cards = await p.evaluate(() => { const r = document.querySelector('[data-testid^="std-row-"]'); return { card: !!r.closest('.cbl-card, .cbl-row') && getComputedStyle(r).display, w: r.getBoundingClientRect().width, labs: Array.from(r.querySelectorAll('.cbl-cell')).length }; });
    ok(cards.w <= 390 && cards.labs <= 4, 'each row is a card within the width, at most plain words · reference · applies in · status (' + cards.labs + ' fields)');
    const head = await p.evaluate(() => document.querySelector('#std_list .cbl-hdr, #std_list .cbl-list').getBoundingClientRect().top - (document.querySelector('[data-testid="shell-header"]') || { getBoundingClientRect: () => ({ bottom: 0 }) }).getBoundingClientRect().bottom);   /* under the frame (SHELL-ONE) */
    ok(head / 844 <= 0.35, 'the head on the list page is ' + Math.round(head / 844 * 100) + '% of the phone (limit 35% with a cell chosen)');
    await p.click('[data-testid^="std-row-"]'); await p.waitForTimeout(250);
    ok(await p.locator('[data-testid^="std-detail-"]').count() === 1, 'a card opens');
    w = await width(p);
    ok(w.sw === 390, 'phone, a row open: document.scrollWidth === 390 (' + w.sw + ')');
    await p.screenshot({ path: path.join(SHOTS, 'standards-phone-list.png') });
    await p.click('[data-testid="std-back"]'); await p.waitForTimeout(200);
    ok(await p.locator('#mxp').isVisible() && !(await p.locator('#main').isVisible()), '‹ back returns to the matrix');
    await p.click('[data-testid="std-open-record"]'); await p.waitForSelector('dialog[open]'); await p.waitForTimeout(200);
    const sb = await p.evaluate(() => { const r = document.getElementById('sheet').getBoundingClientRect(); return { w: r.width, h: r.height }; });
    w = await width(p);
    ok(sb.w >= 389 && sb.h >= 843 && w.sw === 390, 'on a phone a sheet fills the screen and nothing scrolls sideways (' + Math.round(sb.w) + '×' + Math.round(sb.h) + ', scrollWidth ' + w.sw + ')');
    await p.keyboard.press('Escape');
    await p.click('[data-testid="std-open-why"]'); await p.waitForSelector('dialog[open]'); await p.waitForTimeout(200);
    w = await width(p);
    ok(w.sw === 390, 'Why follow standards on the phone: scrollWidth === 390 (' + w.sw + ')');
    await ctx.close();
  }

  /* ── 8 · EVERY THEME, MEASURED ───────────────────────────────────────────────────────────────────────────── */
  {
    const probe = await open(S);
    const keys = await probe.p.evaluate(() => Object.keys(CBScreen.APP_THEMES));
    await probe.ctx.close();
    ok(keys.length === 16 && keys.indexOf('terminal') >= 0 && keys.indexOf('dark') >= 0, 'APP_THEMES has all 16 themes (' + keys.join(' ') + ')');
    const th = ['cream'].concat(keys.filter((k) => k !== 'cream'));
    const fails = [], table = {};
    const VIEWPORTS = [['laptop', { width: 1366, height: 768 }], ['phone', { width: 390, height: 844 }]];
    for (const [vname, vp] of VIEWPORTS) {
      const { ctx, p } = await open(S, { viewport: vp });
      const states = [];
      /* [name, how to reach it from the clean matrix page] */
      states.push(['matrix', async () => {}]);
      states.push(['cell + row opened', async () => {
        await p.click('[data-testid="std-cell-money-part"]'); await p.waitForTimeout(150);
        await p.click('[data-testid^="std-row-"]'); await p.waitForTimeout(150);
      }]);
      states.push(['why sheet', async () => { await p.click('[data-testid="std-open-why"]'); await p.waitForSelector('dialog[open]'); await p.waitForTimeout(100); }]);
      states.push(['record sheet', async () => { await p.click('[data-testid="std-open-record"]'); await p.waitForSelector('dialog[open]'); await p.waitForTimeout(100); }]);
      for (const [sname, go] of states) {
        /* a fresh page for each state: the cell choice and the sheets are state */
        await p.goto(base + '/standards.html'); await p.waitForSelector('#mxBody .mx-all'); await p.waitForFunction(() => window.CBScreen && window.CBAvatar);
        if (sname === 'cell + row opened') { await go(); } else if (/sheet/.test(sname)) { await p.goto(base + '/standards.html?view=matrix'); await p.waitForSelector('#mxBody .mx-all'); await go(); } else { await go(); }
        const key = vname + ' · ' + sname; table[key] = {};
        for (const k of th) {
          await p.evaluate((kk) => { CBAvatar.applyTheme(kk); }, k);
          await p.waitForTimeout(40);
          const pairs = await p.evaluate(measure);
          const bad = pairs.filter((x) => x.ratio < x.need);
          table[key][k] = [pairs.length, bad.length];
          bad.forEach((x) => fails.push(Object.assign({ screen: key, theme: k }, x)));
          if (k === 'dark' && sname === 'cell + row opened' && vname === 'laptop') await p.screenshot({ path: path.join(SHOTS, 'standards-dark-laptop.png') });
          if (k === 'terminal' && sname === 'cell + row opened' && vname === 'phone') await p.screenshot({ path: path.join(SHOTS, 'standards-terminal-phone.png') });
        }
        await p.evaluate(() => { try { CBAvatar.applyTheme('cream'); } catch (_) {} });
      }
      await ctx.close();
    }
    const total = Object.keys(table).reduce((a, s) => a + th.reduce((c, k) => c + table[s][k][0], 0), 0);
    console.log('\n  PAGE-STATE × THEME (failing pairs; . = none)');
    console.log('   ' + ''.padEnd(28) + th.map((k) => k.slice(0, 4).padStart(5)).join(''));
    Object.keys(table).forEach((s) => console.log('   ' + s.padEnd(28) + th.map((k) => String(table[s][k][1] || '.').padStart(5)).join('')));
    if (fails.length) {
      const grouped = {};
      fails.forEach((f) => { const g = f.screen + ' | ' + f.theme + ' | ' + f.cat; (grouped[g] = grouped[g] || []).push(f); });
      console.log('\n  FAILING PAIRS (' + fails.length + '):');
      Object.keys(grouped).slice(0, 60).forEach((g) => { const a = grouped[g]; console.log('   ' + g + ' | ' + a.length + 'x | worst ' + Math.min.apply(null, a.map((f) => f.ratio)) + ' (need ' + a[0].need + ') e.g. "' + a[0].text + '" ' + a[0].html); });
    }
    ok(total > 2000, 'a measurement of something: ' + total + ' text pairs measured across ' + Object.keys(table).length + ' views × ' + th.length + ' themes');
    ok(fails.length === 0, 'every visible text pair, in all 16 themes + Cream, on the laptop and the phone, on the matrix · a chosen cell with a row open · both sheets, clears WCAG AA (' + fails.length + ' failing)');
  }

  /* ── TIDY (2026-10-09) · tap-tips on every reference with a glossary entry · the left table's label whole · screenshots at 1366 and 390 ── */
  {
    const TS = path.join(SHOTS, 'standards-tidy'); fs.mkdirSync(TS, { recursive: true });
    const { ctx, p } = await open(S);
    await p.screenshot({ path: path.join(TS, 'standards-1366.png') });
    /* tap-tips: the Reference cell carries an abbr.gl with the meaning as its title */
    for (const [ref, want] of [['ISO 4217', /currency codes/], ['GS1', /barcodes/], ['BCP 47', /language tags/]]) {
      const ix = REG.S.findIndex((r) => r.n === ref || r.n.indexOf(ref) === 0);
      await p.fill('[data-testid="listctl-search-standards"]', REG.S[ix].n); await p.waitForTimeout(300);
      const tips = await p.$$eval('[data-testid="std-row-' + ix + '"] .sn abbr.gl', (n) => n.map((x) => x.getAttribute('data-gl') + '=' + x.getAttribute('title')));
      ok(tips.length > 0 && tips.some((t) => want.test(t)), ref + ' shows its tap-tip in the Reference cell: ' + tips.join(' | ').slice(0, 110));
    }
    await p.fill('[data-testid="listctl-search-standards"]', ''); await p.waitForTimeout(250);
    /* the left table: no label cut, no two count heads touching */
    const mx = await p.evaluate(() => { const cut = Array.from(document.querySelectorAll('#mxBody .mx-rh')).filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim()); const hs = Array.from(document.querySelectorAll('#mxBody .mx-ch')).map((e) => e.getBoundingClientRect()); let hit = 0; for (let k = 1; k < hs.length; k++) if (hs[k].left < hs[k - 1].right) hit++; const w = Array.from(document.querySelectorAll('#mxBody .mx-ch')).filter((e) => e.scrollWidth > e.clientWidth + 1).length; return { cut, hit, w }; });
    ok(mx.cut.length === 0 && mx.hit === 0 && mx.w === 0, 'the left table: no row label cut, no count head touching its neighbour (' + JSON.stringify(mx) + ')');
    await p.click('[data-testid="cbl-group-standards"] [data-group="kind"]'); await p.waitForTimeout(300);
    const mk = await p.evaluate(() => Array.from(document.querySelectorAll('#mxBody .mx-rh')).filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim()));
    ok(mk.length === 0, 'Counted by Kind: "Compatibility" is whole (' + JSON.stringify(mk) + ')');
    await p.screenshot({ path: path.join(TS, 'standards-1366-kind.png') });
    await ctx.close();
  }
  {
    const { ctx, p } = await open(S, { viewport: { width: 390, height: 844 } });
    await p.screenshot({ path: path.join(SHOTS, 'standards-tidy', 'standards-390-matrix.png') });
    await p.evaluate(() => { document.getElementById('app').setAttribute('data-view', 'list'); }); await p.waitForTimeout(300);
    const w = await width(p);
    ok(w.sw === 390, 'phone, list page after the tidy: document.scrollWidth === 390 (' + w.sw + ')');
    await p.screenshot({ path: path.join(SHOTS, 'standards-tidy', 'standards-390-list.png') });
    await ctx.close();
  }

  const other = S.calls.filter((c) => c !== 'GET /api/entities/me' && c !== 'GET /api/entities/header' && c !== 'GET /api/notifications' && c !== 'GET /api/events/ticket' && c !== 'POST /api/events/ticket');   /* SHELL-ONE: the frame's sheet reads /entities/header (one trip) */   /* the header's bell (Round U: the one frame) reads the notifications; the register is still the file */
  ok(other.length === 0, 'the Standards page reads nothing from the API — the register is the file; the only call is the avatar\'s own GET /api/entities/me (' + S.calls.length + ' of it' + (other.length ? '; ALSO ' + other[0] : '') + ')');
  ok(threw.length === 0, 'no page error' + (threw.length ? ': ' + threw[0] : ''));
  ok(offHost.length === 0, 'nothing tried to leave the browser' + (offHost.length ? ': ' + offHost[0] : ''));
  await b.close(); srv.close();
  console.log('\nstandards-page: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
