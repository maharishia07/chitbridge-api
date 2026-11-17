/* Skeleton guard (P1d): static — no browser. Every small-app page wears the ONE standard page skeleton: a left sidebar (app name + icon · sections · Collapse)
   and a full-width main pane. Finance / CRM / Accounts write that markup themselves; the CBFrame pages (Employees, Network) ask CBFrame.mount for it
   (skeleton: {...}) and link /app/page-skeleton.css. A NEW app page (one that loads the shell frame or the list control) that is in neither list FAILS —
   so "employees and network are not in the standard layout" cannot come back a third time. Run: node e2e/skeleton-guard.cjs */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), pub = path.join(root, 'public');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let fail = 0; const bad = (m) => { fail++; console.log('FAIL ' + m); }; const ok = (m) => console.log('  ok  ' + m);

/* the small apps — add a new one HERE, and give it the skeleton */
const OWN = ['finance.html', 'crm.html', 'accounts.html'];      /* the page draws <aside class="side"> + <main class="main"> itself */
/* SHELL-ONE: pages that wear the frame's BAR only (CBFrame.mount({ bar: true }) — header: mark · name · chip · ⌂ Home · avatar) over their own body: the storefront
   (the shop's own brand row and cart under it), the shop screen, the labs; standards.html mounts the frame in app mode above its own two panes (host) */
const BAR = ['shop.html', 'network-shop.html', 'store.html', 'embed.html', 'promo.html', 'standards.html', 'chart-sample.html'];
const FRAMED = ['employees.html', 'network.html', 'tasks.html', 'settings.html', 'operations.html', 'catalogue.html'];   /* CBFrame.mount({ skeleton }) draws it (the Country lab: CL3, public — signin:false · CB Settings: SET1 · CB Operations: T3-OPS · CB Catalogue: T3-CATALOGUE) */
/* UX-90: every lab wears the Finance frame through CBFrame.lab (skeleton + the Labs switcher in the left menu, one background); the list only grows with a new lab */
const LABS = ['product-lab.html', 'offer-lab-next.html', 'conversion-lab.html', 'country-lab.html', 'network-design.html', 'list-lab.html', 'signin-lab.html', 'shell-lab.html', 'ui-standard.html'];
/* pages that load the frame or the list control but are not small apps: the app itself, the labs and the standards page, and two older single-purpose pages (their own round) */
/* testing.html: the test board's printable report — it loads list-ctl.js only for CBList.every (every page of a paged list, T2-PAGING), it mounts no list */
const NOT_APPS = ['app.html', 'standards.html', 'authority-forms.html', 'know-your-business.html', 'testing.html', 'bank-demo.html'];   /* bank-demo.html: the no-login showcase mounts the frame's bar from app/bank-demo.js (anonymous, CSP script-src self), so the page carries no inline CBFrame.mount */

OWN.forEach((f) => {
  const h = read('public/' + f);
  if (!/<aside[^>]*class="side"/.test(h)) bad(f + ': no sidebar (<aside class="side">)');
  else if (!/<main[^>]*class="main[" ]/.test(h)) bad(f + ': no main pane (<main class="main">)');
  else if (!/id="toggleNav"/.test(h)) bad(f + ': the sidebar has no Collapse button');
  else ok(f + ': sidebar + main pane + Collapse');
});
const frame = read('public/app/page-frame.js'), css = read('public/app/page-skeleton.css');
if (!/class="side"/.test(frame) || !/class="main"/.test(frame) || !/toggleNav/.test(frame) || !/Collapse/.test(frame)) bad('page-frame.js: skeleton() must draw the sidebar, main pane and Collapse');
else ok('page-frame.js draws the skeleton');
if (!/\.cbsk \.side\b/.test(css) || !/\.cbsk \.main\b/.test(css)) bad('page-skeleton.css lacks the .side / .main rules');
BAR.forEach((f) => {
  const h = read('public/' + f);
  if (f === 'standards.html' ? !/CBFrame\.mount\(\{\s*app:\s*'standards',\s*host:/.test(h) : !/CBFrame\.mount\(\{\s*app:\s*'[a-z-]+',\s*bar:\s*true/.test(h)) bad(f + ': must mount the frame (CBFrame.mount({ app, bar: true }) — or host: for standards)');
  else if (/<header[\s>]|class="top"|class="bar"|CBAvatar\.mount\(|id="cbav"/.test(h.replace(/<!--[\s\S]*?-->/g, ''))) bad(f + ': still draws a header of its own (<header>, .top, .bar, its own CBAvatar.mount) — the frame is the one header');
  else ok(f + ': the frame\'s bar over its own body');
});
LABS.forEach((f) => {
  const h = read('public/' + f).replace(/<!--[\s\S]*?-->/g, '');
  if (!/CBFrame\.lab\(/.test(h)) bad(f + ': a lab must wear the Finance frame — CBFrame.lab({ app, name, icon })');
  else if (!/href="\/app\/page-skeleton\.css"/.test(h) || !/src="\/app\/lab-kit\.js"/.test(h)) bad(f + ': a lab links /app/page-skeleton.css and loads /app/lab-kit.js (the Labs switcher)');
  else ok(f + ': the Finance frame + the Labs switcher');
});
FRAMED.forEach((f) => {
  const h = read('public/' + f);
  const m = /CBFrame\.mount\(\{[\s\S]*?skeleton:\s*\{[\s\S]*?sections:\s*(?:[A-Za-z_$][\w$]*\s*=\s*)?(\[|[A-Z_]+\b)/.exec(h);   /* a literal list (also kept in a name: network.html sideSections = [...]), or the page's own constant (settings.html SECTIONS) */
  if (!m) bad(f + ': CBFrame.mount must be given skeleton: { name, icon, sections }');
  else if (h.indexOf('href="/app/page-skeleton.css"') < 0) bad(f + ': must link /app/page-skeleton.css');
  else if (!/\.\.\/|<aside/.test('') && /<aside[^>]*class="side"/.test(h)) bad(f + ': draws its own sidebar — use the shared skeleton, never a copy');
  else ok(f + ': the shared skeleton (embed stays frameless)');
});
/* discovery: any other page that loads the frame or the list control must be listed above */
fs.readdirSync(pub).filter((f) => /\.html$/.test(f)).forEach((f) => {
  if (OWN.includes(f) || FRAMED.includes(f) || NOT_APPS.includes(f) || BAR.includes(f) || LABS.includes(f)) return;
  const h = read('public/' + f);
  if (/src="\/app\/(page-frame|list-ctl)\.js"/.test(h) || /<aside[^>]*class="side"/.test(h)) {
    if (f === 'till.html') return;   /* the till has its own sidebar; it is a counter, not a small app page */
    bad(f + ': an app page that is not in the skeleton guard — wear the standard skeleton and add it to OWN/FRAMED in e2e/skeleton-guard.cjs');
  }
});
/* ── ONE SHELL ON EVERY PAGE, EVEN WITHOUT A LOGIN (CL3, owner 13 Oct: "if login not required, still avatar, and font, and other things should be
   intact"; SHELL-ONE, 15 Oct: every small app, every public page and every lab wears it — the three own headers are gone). Every public/*.html loads
   the standard shell (/app/shell.js through CBFrame.mount — the header, avatar with Sign in, fonts, tokens, text size), or is on the list below WITH
   ITS REASON. The list only SHRINKS: a new page that skips the shell fails, and a listed page that now loads the shell fails until it is struck.
   What is left: the workshop (app.html — index-not-app keeps customers out of it), the vendored counter (till.html, the api's master: its bar is the
   api's round), the print surface, and the DESIGN REFERENCES (public/app/screen-id.js DECLARED.references — not customer navigation). ── */
const SHELL_NOT_YET_WHY = {
  'app.html': 'the workshop (IX0: no customer path lands in it)', 'till.html': 'VENDORED from chitbridge-api tools/tally-connector/till.html — its bar is the api\'s round',
  'bill-print.html': 'the printed bill: a print surface, single-theme by decision', 'cart-design.html': 'design reference', 'design-mock.html': 'design reference',
  'storefront-design.html': 'design reference', 'supplier-design.html': 'design reference', 'screen-gallery.html': 'the gallery of screen drawings', 'lifecycle-test.html': 'a tool board',
  'testing.html': 'the test board', 'intake.html': 'a prototype, no customer door', 'iot-howitworks.html': 'a showcase opened in the workshop\'s overlay',
  'offer-lab.html': 'forwards to offer-lab-next.html', 'combo-lab.html': 'forwards to offer-lab-next.html?mode=combo',
};   /* shell-lab.html mounts CBShell itself (the unit's pass mark, e2e/shell.cjs): it loads the shell, so it is not here */
const SHELL_NOT_YET = Object.keys(SHELL_NOT_YET_WHY);
/* every page on the no-shell list is a design reference in the register, or one of the named exceptions (the workshop · the counter · the print surface · the two forwards) */
const refs = (() => { const w = {}; new Function('window', 'globalThis', read('public/app/screen-id.js'))(w, w); return (w.CBScreenId.DECLARED.references || []).map((r) => r[0].replace(/^\//, '')); })();
const EXCEPTIONS = ['app.html', 'till.html'];
SHELL_NOT_YET.forEach((f) => { if (!refs.includes(f) && !EXCEPTIONS.includes(f)) bad(f + ': skips the shell but is neither a design reference in app/screen-id.js DECLARED.references nor the workshop / the counter'); });
refs.forEach((f) => { if (!SHELL_NOT_YET.includes(f)) bad(f + ': a design reference in the register must be on the no-shell list here (or stop being a reference)'); });
const shellPages = [];
fs.readdirSync(pub).filter((f) => /\.html$/.test(f)).sort().forEach((f) => {
  const loads = read('public/' + f).indexOf('src="/app/shell.js"') >= 0;
  if (loads && SHELL_NOT_YET.includes(f)) bad(f + ': now loads the standard shell — strike it from SHELL_NOT_YET in e2e/skeleton-guard.cjs (the list only shrinks)');
  else if (!loads && !SHELL_NOT_YET.includes(f)) bad(f + ': does not load the standard shell (/app/shell.js via CBFrame.mount) — every page wears it, even without a login');
  else if (loads) shellPages.push(f);
});
SHELL_NOT_YET.forEach((f) => { if (!fs.existsSync(path.join(pub, f))) bad(f + ': listed in SHELL_NOT_YET but gone — strike it'); });
ok('the standard shell: ' + shellPages.join(' · ') + ' (' + SHELL_NOT_YET.length + ' not yet, a list that only shrinks)');
/* the Country lab is public: CBFrame with signin:false (no sign-in window over it; the avatar's door says Sign in) */
if (!/CBFrame\.lab\(/.test(read('public/country-lab.html'))) bad('country-lab.html: a public lab wears CBFrame.lab (public: no sign-in window over it)');
else ok('country-lab.html: public (signin:false), the avatar still drawn');
if (fail) { console.log('\nskeleton-guard: ' + fail + ' failure(s)'); process.exit(1); }
console.log('\nskeleton-guard: ok');
