'use strict';
/**
 * e2e/screen-id-guard.cjs — A PAGE, A SECTION OR A SHEET WITHOUT A SCREEN CODE FAILS (round SCREEN-ID, 2026-10-14).
 *
 * Athi, 2026-10-14: *"if we have not numbered each screen it has to be numbered."* The register is ONE (public/app/screens.js for the
 * workshop + the declared rows of public/app/screen-id.js, merged into CBSCREENS in the browser). This guard reads the PRODUCT, not the
 * register — the frames and their sections as the pages declare them, and the chit sheet's kinds — and fails on any that has no code.
 * ⚠️ A source check: it proves every screen HAS a code and that the chip is wired; e2e/walk-screen-id.cjs proves the chip is SEEN.
 *
 * Run: node e2e/screen-id-guard.cjs
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WEB = path.join(__dirname, '..');
const PUB = path.join(WEB, 'public');
const rd = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');
let pass = 0;
const fails = [];
const ok = (what, cond) => { if (cond) { pass++; console.log('  ✓ ' + what); } else { fails.push(what); console.error('  ✗ ' + what); } };
const evalWindow = (f) => { const w = {}; new Function('window', 'globalThis', rd(f))(w, w); return w; };

console.log('\n══ every screen has its code (SCREEN-ID) ══');
const SID = evalWindow('public/app/screen-id.js');
const ID = SID.CBScreenId, REG = ID;
const has = (app, key) => !!(REG.byApp[app] && REG.byApp[app][key == null ? '' : key]);

/* ── 1 · every frame a page mounts is a registered app, and the page loads the chip before the frame ── */
const pages = fs.readdirSync(PUB).filter((f) => f.endsWith('.html')).map((f) => 'public/' + f).concat(['index.html']);
const frameApps = {};
for (const f of pages) {
  const src = rd(f);
  /* UX-90 (#352): a Lab wears the Finance frame through CBFrame.lab({ app: … }) — the same register as CBFrame.mount */
  for (const m of src.matchAll(/CBFrame\.(?:mount|lab)\(\{\s*app:\s*'([a-z-]+)'/g)) frameApps[m[1]] = f;
}
frameApps.home = 'index.html';   /* SHELL-ONE: accounts · finance · crm mount CBFrame like every other page — found by the regex above, no own header any more */
const missingApps = Object.keys(frameApps).filter((a) => !REG.byApp[a]);
ok('every app frame has its screens in the register (' + Object.keys(frameApps).length + ')' + (missingApps.length ? ': ' + missingApps.join(' · ') : ''), missingApps.length === 0);
const unloaded = Object.entries(frameApps).filter(([, f]) => {
  const s = rd(f), i = s.indexOf('<script src="/app/screen-id.js"'), j = Math.min(...['<script src="/app/shell.js"', '<script src="/app/chit-sheet.js"'].map((t) => s.indexOf(t)).filter((x) => x >= 0));
  return i < 0 || i > j;
}).map(([a]) => a);
ok('every one of those pages loads app/screen-id.js before its frame' + (unloaded.length ? ': ' + unloaded.join(' · ') : ''), unloaded.length === 0);
const declaredApps = ID.DECLARED.apps.map((a) => a.app).filter((a) => !frameApps[a]);
ok('no declared app is a page that no longer mounts a frame' + (declaredApps.length ? ': ' + declaredApps.join(' · ') : ''), declaredApps.length === 0);

/* ── 2 · every section of every frame has its own code ── */
const sections = [];
for (const [app, f] of Object.entries(frameApps)) {
  const s = rd(f);
  const mi = s.indexOf("CBFrame.mount({ app: '" + app + "'") >= 0 ? s.indexOf("CBFrame.mount({ app: '" + app + "'") : s.indexOf("CBFrame.mount({app:'" + app + "'");
  if (mi >= 0) {
    const call = s.slice(mi, s.indexOf('onSection', mi) > 0 ? s.indexOf('onSection', mi) : mi + 1500);
    for (const m of call.matchAll(/\{\s*k:\s*'([a-z_-]+)'/g)) sections.push([app, m[1]]);
  }
}
{ const s = rd('public/settings.html'); for (const m of s.matchAll(/\{\s*k:\s*'([a-z_-]+)',\s*label:/g)) sections.push(['settings', m[1]]); }
{ const m = /var VIEWS = \[([^\]]+)\]/.exec(rd('public/app/cap-tasks.js')); (m ? m[1].match(/'([a-z_]+)'/g) : []).forEach((x) => sections.push(['tasks', x.slice(1, -1)])); }
{ const s = rd('public/accounts.html'), a = s.indexOf('const NAV = ['), b = s.indexOf('];', a); for (const m of s.slice(a, b).matchAll(/^\s*\['([a-z]+)', '/gm)) sections.push(['accounts', m[1]]); }
for (const app of ['finance', 'crm']) { const s = rd('public/' + app + '.html'); for (const m of s.matchAll(/class="nav-btn[^"]*" href="#\/([a-z-]+)"/g)) sections.push([app, m[1]]); }
{ const s = rd('public/app/cap-crm.js'), a = s.indexOf('function crmRoute'), b = s.indexOf('\n}', a); for (const m of s.slice(a, b).matchAll(/seg\[0\] === '([a-z]+)'/g)) sections.push(['crm', m[1]]); }
const uniq = [...new Set(sections.map((x) => x.join('#')))].map((x) => x.split('#'));
const noCode = uniq.filter(([a, k]) => !has(a, k)).map((x) => x.join(' › '));
ok('every section a frame draws has a code (' + uniq.length + ' found in the pages)' + (noCode.length ? ': ' + noCode.join(' · ') : ''), uniq.length > 40 && noCode.length === 0);

/* ── 3 · every kind of the chit sheet has a code, and the sheet shows it in its own title row ── */
const cs = rd('public/app/chit-sheet.js');
const fk = /function sheetKind\(m\) \{([^}]+)\}/.exec(cs);
const kinds = fk ? [...fk[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]) : [];
ok('the chit sheet names its kinds in ONE function (sheetKind: ' + kinds.join(' · ') + ')', kinds.length >= 3);
const noKind = kinds.filter((k) => !REG.bySheet[k]);
ok('every sheet kind has a code' + (noKind.length ? ': ' + noKind.join(' · ') : ''), noKind.length === 0);
ok('the popup has a chip slot in its title row and fills it from CBScreenId.sheetHTML(sheetKind(m))',
  /class="cs-top"><button[\s\S]{0,400}?<\/button><span class="cs-ttl" data-testid="cs-title">[\s\S]{0,160}?data-testid="cs-screen-id"/.test(cs) && cs.indexOf('CBScreenId.sheetHTML(sheetKind(m))') > 0);

/* ── 4 · the codes: AAA###, one screen each, never a workshop code or prefix ── */
const rows = REG.rows;
const ws = evalWindow('public/app/screens.js').CBSCREENS;
const wsCodes = new Set((ws.rows || []).map((r) => r.code).concat((ws.withdrawn || []).map((r) => r.code)));
const wsPrefixes = new Set([...wsCodes].map((c) => c.slice(0, 3)));
const shape = rows.filter((r) => !/^[A-Z]{3}[0-9]{3}$/.test(r.code)).map((r) => r.code);
ok('every code is AAA### like the workshop\'s' + (shape.length ? ': ' + shape.join(' · ') : ''), shape.length === 0);
const seen = {}, dup = [];
rows.forEach((r) => { if (seen[r.code]) dup.push(r.code); seen[r.code] = 1; });
ok('no code is claimed by two screens' + (dup.length ? ': ' + dup.join(' · ') : ''), dup.length === 0);
const clash = rows.filter((r) => wsCodes.has(r.code) || wsPrefixes.has(r.code.slice(0, 3))).map((r) => r.code);
ok('no code or prefix is one screens.cjs mints (' + [...wsPrefixes].join(' ') + ')' + (clash.length ? ': ' + clash.join(' · ') : ''), clash.length === 0);

/* ── 5 · ONE chip: built in one file, placed by the frames ── */
const placers = pages.concat(fs.readdirSync(path.join(PUB, 'app')).filter((f) => f.endsWith('.js')).map((f) => 'public/app/' + f))
  .filter((f) => f !== 'public/app/screen-id.js' && /className = 'cbsid'|class="cbsid"|class=\\?'cbsid/.test(rd(f)));
ok('the chip is built only in app/screen-id.js' + (placers.length ? ': also ' + placers.join(' · ') : ''), placers.length === 0);
const shell = rd('public/app/shell.js'), frame = rd('public/app/page-frame.js');
ok('the CBShell bar places the chip (every CBFrame page and Home)', /\$\('\.cbsh-sid'\)\.appendChild\(root\.CBScreenId\.chip\(\)\)/.test(shell));
ok('the skeleton\'s section is the screen the chip names (setActive → CBScreenId.here)', /function setActive\(k\)[\s\S]{0,400}?CBScreenId\.here\(appId, k\)/.test(frame));
const own = ['accounts', 'finance', 'crm', 'standards'].filter((a) => /CBScreenId\.chip\(\)|class="who"[^\n]*cb-avatar|CBAvatar\.mount\(/.test(rd('public/' + a + '.html')));
ok('no page draws its own header any more — the chip, the Home and the avatar are the frame\'s (SHELL-ONE)' + (own.length ? ': still ' + own.join(' · ') : ''), own.length === 0);

/* ── 6 · the inventory is what the register says ── */
const r = spawnSync(process.execPath, [path.join(WEB, 'tools', 'screen-list.cjs'), '--check'], { encoding: 'utf8' });
ok('docs/SCREEN-LIST.md is generated from the register and current', r.status === 0);
const SL = require('../tools/screen-list.cjs').load();
const multi = SL.rows.filter((x) => x.kind === 'sheet').filter((x) => new Set(SL.opens.filter((o) => o.to === x.code).map((o) => o.page)).size >= 2);
ok('the list shows each sheet opened from two or more pages as ONE screen (' + multi.map((x) => x.code).join(' · ') + ')', multi.length >= 3);

console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
process.exit(fails.length ? 1 : 0);
