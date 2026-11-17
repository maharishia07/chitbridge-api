/**
 * e2e/render-smoke.cjs — actually CALL the profile renderers and see whether they throw.
 *
 * ⚠️⚠️ WHY THIS EXISTS. `node --check` proves a file PARSES. It cannot see that a function reads a variable
 * belonging to a different function — that is a ReferenceError at render time, and today I shipped three of
 * that class in one session: SESSION.identity_type (never assigned), PURPOSE.profile (computed at parse time),
 * and `capped`/`cap` borrowed from storefrontCardHTML into iamMeHTML. All three parsed. All three ran. All
 * three were wrong, and only one was noticed by a person looking at a screen.
 *
 * ⭐ CALLING THE FUNCTION IS THE ONLY CHECK THAT FINDS THEM. A grep cannot tell a variable from a word in a
 * comment — my first attempt at this returned "before, it, input, loose, id…" from prose. So: stub the
 * browser thinly, run the renderer, and fail if it throws or returns nothing.
 *
 * The stubs are deliberately DUMB. Anything that has to be faked cleverly to make a render pass is a renderer
 * doing too much, and the test would then be testing the stub.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeDocument } = require('./lib/dom-stub.cjs');

const ROOT = path.join(__dirname, '..', 'public');

/* A thin browser. Every stub returns something inert and truthful about its own emptiness. */
const el = () => ({ value: '', checked: false, disabled: false, innerHTML: '', style: {}, textContent: '',
                    remove(){}, appendChild(){}, addEventListener(){} });
const sandbox = {
  console,
  document: makeDocument({ createElement: el, head: el(), body: el() }),
  window: {}, localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  location: { origin: 'http://localhost:5173', host: 'localhost:5173', hostname: 'localhost' },
  setTimeout: () => 0, fetch: async () => ({ ok: false, json: async () => ({}) }),
  /* app globals the renderers lean on */
  SESSION: { token: null, role: null, name: 'Test', actorId: null, entityId: 'ent-1' },
  UI: { _iamOpen: {}, _idocs: [], _me: null },
  CFG: { API_BASE: '' },
  esc: (s) => String(s == null ? '' : s),
  tx: (s) => s, txf: (s) => s,
  val: () => '',
  opt: (list, sel) => list.map(o => '<option' + (o === sel ? ' selected' : '') + '>' + o + '</option>').join(''),
  /* ⚠️ apGet/apSet ARE REAL GLOBALS FROM app.html, and their absence here was not caught until a render
     started using one. A harness missing a global the app always has does not fail honestly — it fails as a
     ReferenceError in twenty unrelated cases and looks like the feature broke. */
  apGet: (k, d) => d, apSet(){},
  toast(){}, renderApp(){}, loadProfile(){}, loadVault(){}, ensureCap: async () => {}, api: async () => ({}),
  _capShowDetail(){}, _capEnd: () => '', menuAssist: () => '', navTo(){}, setSetSec(){}, profSetSec(){},
  jwtPayload: () => ({}), MSG: { profileSaved: () => 'saved' },
  /* ⚠️ timezone + datetime ARE REQUIRED by the Country/Currency/Time zone/Timestamp block. A stub missing them
     would let the block render two rows instead of four and still pass — the test would be measuring the stub. */
  CBLocale: { region: () => 'IN', regionInfo: () => ({ name: 'India' }),
              timezone: () => 'Asia/Calcutta', datetime: () => '20 Aug 2026, 5:45 pm',
              number: (n) => '1,23,45,678.9', locale: () => 'en-IN',
              /* ⚠️ langs/lang/dir ARE REQUIRED by the "How you read it" group. A stub without them renders two
                 rows instead of five and passes — the fourth time today a test would have measured the stub. */
              langs: () => ['ta', 'hi', 'en'], lang: () => 'ta', dir: () => 'ltr' },
  /* ⚠️ THEMES + TEXT_SIZES ARE REQUIRED by "How you read it". A stub without them renders two fewer rows and
     still passes — the FIFTH time a test would have measured the stub rather than the code. */
  THEMES: { cream: { name: 'Cream', a11y: { level: 'AA' } } }, themeGet: () => 'cream',
  TEXT_SIZES: [['s','Small',0.92],['m','Default',1],['l','Large',1.15]], textSize: () => 'l',
  ACCESS_LABEL: { viewer: 'Viewer', commenter: 'Commenter', editor: 'Editor' },
  ACCESS_CHOICES: [['editor', 'Editor'], ['commenter', 'Commenter'], ['viewer', 'Viewer']],
  accessLevelOf: () => 'editor', hatLabel: () => 'Editor', hatAssignable: () => true,
  govCardHTML: () => '<div>rights</div>', _CARD: '', _misHead: () => '',
  /* ⚠️ scrErr RETURNED '' AND THAT MADE EVERY ERROR PATH LOOK DEAD. A renderer whose failure branch is "show
     the error" correctly returns only what scrErr gives it, so an empty stub turns a working branch into
     "returned nothing" — the harness reporting its own stub as a defect. It now returns the message, which is
     what the real one does. */
  scrErr: (m) => '<div class="err">' + String(m == null ? 'error' : m) + '</div>',
  MIS_BANDS: [], PLAN: { chitsPerDay: 1 }, GOV: {}, ACTOR_TYPES: {}, AC_TYPE: {},
  inr: (n) => String(n), CAP_LOADED: {},
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;

const ctx = vm.createContext(sandbox);
/* Load the capability the same way the browser does: a classic script into shared global scope. */
try {
  /* CAP_WITH.admin (app.html): helpers.js (taxIdWord · packWord), cap-shop.js (SET1) and cap-settings.js (T3-SETTINGS) load before cap-admin.js — it calls what they hold */
  for (const f of ['helpers.js', 'cap-shop.js', 'cap-settings.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'), ctx, { filename: f });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'cap-admin.js'), 'utf8'), ctx, { filename: 'cap-admin.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'cap-iddocs.js'), 'utf8'), ctx, { filename: 'cap-iddocs.js' });
  /* "What you sell" moved from the profile block to the Country step (cap-country.js csuSuppliesRow) */
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'cap-country.js'), 'utf8'), ctx, { filename: 'cap-country.js' });
} catch (e) {
  console.error('✗ a capability failed to LOAD: ' + e.message);
  process.exit(1);
}

/**
 * ⭐⭐ THE SUPPLIER CATALOGUE SCREEN, ADDED 2026-08-22 BECAUSE THIS FILE'S OWN PREMISE PROVED ITSELF AGAIN — on
 * me. I wrote `supName(x)` inside `supCartHTML()`, which takes NO ARGUMENTS. A ReferenceError, live for twenty
 * minutes, and it would have blanked the entire supplier catalogue the moment Athi opened one. `node -c`
 * passed. `check-syntax` passed. The tx/token guards passed. **Only calling the function finds this**, which is
 * exactly what the header above says, and the coverage simply had not reached this screen.
 *
 * ⚠️ It is also the SECOND of this class in one day: the `chit.send` meter passed an `entity_id` that does not
 * exist in that handler. Two in a day is a pattern, not bad luck — an undefined identifier is legal JavaScript
 * until the line runs, so every screen that nothing calls is a screen where this is waiting.
 */
try {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'engine', 'locale.js'), 'utf8'), ctx, { filename: 'locale.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'catalogue-lines.js'), 'utf8'), ctx, { filename: 'catalogue-lines.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'cart.js'), 'utf8'), ctx, { filename: 'cart.js' });
} catch (e) {
  console.error('✗ a shared module failed to LOAD: ' + e.message);
  process.exit(1);
}

/**
 * Lifted from app.html rather than stubbed — a stub of the thing under test proves the stub. Same approach, and
 * the same reason, as scripts/check-adoption.js.
 */
const APP_HTML = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
/* supName moved from app.html to cap-suppliers.js: still lifted from real source, never stubbed */
const SUP_JS = fs.readFileSync(path.join(ROOT, 'app', 'cap-suppliers.js'), 'utf8');
for (const fn of ['supName', 'supEmptyAllWords', 'supCartHTML']) {
  const re = new RegExp('^function ' + fn + '\\b[\\s\\S]*?(?=^function |^var |^const |^\\/\\*\\*)', 'm');
  const m = re.exec(APP_HTML) || re.exec(SUP_JS);
  if (!m) { console.error('✗ could not lift ' + fn + '() out of app.html or cap-suppliers.js'); process.exit(1); }
  try { vm.runInContext(m[0], ctx, { filename: 'app.html:' + fn }); }
  catch (e) { console.error('✗ lifting ' + fn + ' failed: ' + e.message); process.exit(1); }
}

const ENTITY = {
  identity_id: 'ent-1', bridge_id: 'CBTEST0001', display_name: 'mystorex', user_id: 'mystorex',
  gstn: null, address: null, business_status: 'open', catalogue_visibility: 'private',
  identity_type: 'entity', governance: {},
};
const ACTOR = {
  identity_id: 'act-1', bridge_id: 'CBTEST0002', display_name: 'Raman', actor_key: 'raman',
  parent_user_id: 'mystorex', identity_type: 'actor', access_level: 'commenter', whole_entity: false,
};

/**
 * srvChannels — build the payload the SERVER actually sends, then flatten it exactly as iamLoadChannels does.
 * lib/channels.js returns { channels: [ {key, name, bindings:[…]} ] } — a catalogue of TYPES, each carrying
 * its bindings. Reading j.channels as the rows is what made this feature show nothing.
 */
function srvChannels(rows){
  const byType = { whatsapp: [], email: [], sms: [], web: [] };
  rows.forEach(r => (byType[r.channel] = byType[r.channel] || []).push(r));
  const payload = { channels: Object.keys(byType).map(k => ({ key: k, name: k, bindings: byType[k] })) };
  return payload.channels.reduce((all, t) => all.concat(t.bindings || []), []);
}

/** A supplier whose catalogue has arrived, so the picker renders rather than short-circuiting on a null cart. */
const SUP_CAT = {
  shop: { bridge_id: 'CBSUP0001', display_name: 'alpha timers' },
  groups: [{ label: 'Tussar', lines: [{ item_id: 't1', variant: '1L' }] }],
  items: [{ item_id: 't1', item_data: { name: 'Tussar', unit: '1L', price: 950 } }],
};

const CASES = [
  /**
   * ⚠️ THE THREE STATES THAT PRODUCE AN EMPTY LIST, because they take different branches and one of them is
   * where `supName(x)` was hiding: a normal catalogue never reaches the empty-message code at all, so a case
   * that only tests the happy path would still have shipped the ReferenceError.
   */
  ['supCartHTML — a catalogue with items', () => {
    ctx.UI.supDet = { supplier: { display_name: 'alpha timers' }, cat: SUP_CAT };
    ctx.UI._supCart = ctx.CBCart.create(SUP_CAT, { ns: 'sup' });
    return ctx.supCartHTML();
  }],
  ['supCartHTML — nothing published (the emptyAll branch)', () => {
    ctx.UI.supDet = { supplier: { display_name: 'alpha timers' }, cat: { items: [], groups: [] } };
    ctx.UI._supCart = ctx.CBCart.create({ items: [], groups: [] }, { ns: 'sup' });
    return ctx.supCartHTML();
  }],
  ['supCartHTML — everything hidden for having no price (the emptyHidden branch)', () => {
    ctx.UI.supDet = { supplier: { display_name: 'alpha timers' }, cat: { items: [], groups: [], unpriced_hidden: 4 } };
    ctx.UI._supCart = ctx.CBCart.create({ items: [], groups: [] }, { ns: 'sup' });
    return ctx.supCartHTML();
  }],
  /**
   * ⭐ THE USAGE SECTION, COVERED THE DAY IT WAS WRITTEN rather than the day it breaks. Four states, because
   * three of them are the branches a happy-path case never reaches — and the ReferenceError of 2026-08-22 was
   * hiding in exactly such a branch.
   */
  /**
   * ⭐⭐ THE REACHABILITY CASE, added after the renderer shipped UNREACHABLE. The three cases below call
   * usageHTML() directly and all passed while nothing in the app could reach it, because it had been wired
   * into PROF_SECS whose rail no longer exists. A renderer test proves a renderer; only rendering the SCREEN
   * proves the screen.
   */
  ['iamMeHTML — the usage section is REACHABLE from the profile', () => {
    ctx.UI._iamOpen = {};
    const h = ctx.iamMeHTML(ENTITY);
    if (!/iam-sec-usage/.test(h)) throw new Error('no usage section in the rendered profile');
    return h;
  }],
  ['usageHTML — nothing read yet (kicks the loader)', () => { ctx.UI._usage = null; ctx.UI._usageBusy = false; return ctx.usageHTML(); }],
  ['usageHTML — a ledger with rows', () => {
    ctx.UI._usage = { window_days: 30, counts: { billed: 3 }, total_cost_usd: 0, rate_card: 'rc-2026-08-dev',
      by_meter: [{ meter: 'chit.send', events: 3, quantity: 3, cost: 0 }],
      daily: [{ day: '2026-08-23', events: 3, cost: 0 }],
      recent: [{ meter: 'chit.send', detail: 'abcdef12-3456', quantity: 1, cost_usd: 0,
                 meta: { basis: 12500, basis_currency: 'INR', rate: { card: 'rc-2026-08-dev', model: 'per-event' } },
                 created_at: '2026-08-23T04:10:00Z' }] };
    return ctx.usageHTML();
  }],
  ['usageHTML — the read failed', () => { ctx.UI._usage = { _err: 'Could not read your usage.' }; return ctx.usageHTML(); }],
  ['usageHTML — the ledger table is not applied here', () => { ctx.UI._usage = { not_enabled: true }; return ctx.usageHTML(); }],
  ['iamMeHTML — entity, private + open',    () => ctx.iamMeHTML(ENTITY)],
  ['iamMeHTML — public + away',             () => ctx.iamMeHTML({ ...ENTITY, catalogue_visibility: 'public', business_status: 'away' })],
  ['iamMeHTML — capped to private',         () => ctx.iamMeHTML({ ...ENTITY, visibility_cap: { max: 'private', reason: 'Set by your network.' } })],
  ['iamMeHTML — no user_id yet',            () => ctx.iamMeHTML({ ...ENTITY, user_id: null })],
  /* the Regional block — its OWN section since Athi went looking for it and found it as a footnote — two the business's, two the reader's, told apart by the message column */
  ['iamMeHTML — business timezone set',    () => { ctx.UI._iamOpen.regional = true; const h = ctx.iamMeHTML({ ...ENTITY, country: 'India', currency_code: 'INR', timezone: 'Asia/Kolkata' }); ctx.UI._iamOpen.regional = false; if (h.indexOf('Asia/Kolkata') < 0) throw new Error('entity zone not shown'); return h; }],
  ['iamMeHTML — country/currency/tz/timestamp', () => { ctx.UI._iamOpen.regional = true; const h = ctx.iamMeHTML({ ...ENTITY, country: 'India', currency_code: 'INR' }); ctx.UI._iamOpen.regional = false; if (!/Timestamp/.test(h) || !/Currency/.test(h)) throw new Error('block incomplete'); return h; }],
  /**
   * ⚠️ THE HINTS ARE THE FEATURE WHEN A SECTION IS CLOSED. Athi could not find channels or Regional because
   * both live inside sections that default to collapsed — shipped, correct, invisible. These assert the
   * answer is readable WITHOUT opening anything, which is the only state most readers ever see.
   */
  ['hints — closed sections still answer', () => { ctx.UI._chans = srvChannels([{channel:'whatsapp',address:'+91',label:'S',status:'verified'}]); ctx.UI._chansLoaded = true; ctx.UI._iamOpen = {}; const h = ctx.iamMeHTML({ ...ENTITY, country:'India', currency_code:'INR', catalogue_visibility:'public' }); if (h.indexOf('India · INR') < 0) throw new Error('Business hint missing country/currency'); if (h.indexOf('1 bound') < 0) throw new Error('Channels hint missing the count'); return h; }],
  ['channels — none yet still shows',      () => { ctx.UI._chans = []; ctx.UI._chansLoaded = true; ctx.UI._iamOpen = { channels: true }; const h = ctx.iamMeHTML({ ...ENTITY, catalogue_visibility:'public' }); if (h.indexOf('no channel yet') < 0) throw new Error('empty state hidden'); return h; }],
  /**
   * ⚠️ REGIONAL MUST NOT CONTRADICT RIGHTS › BASICS. Both name a currency and a time zone; Basics resolves
   * them from the INSTALLATION and Regional used to read the entity column — which is DEFAULT 'INR' and never
   * written, so a UAE installation showed AED on one section and INR on the other. The governed value wins.
   */
  ['regional — governed currency beats the column default', () => { ctx.UI._iamOpen = { regional: true }; const h = ctx.iamMeHTML({ ...ENTITY, country:'AE', currency_code:'INR', governance:{ basics:{ currency:'AED', timezone:'Asia/Dubai' } } }); if (h.indexOf('AED') < 0) throw new Error('governed currency did not win'); if (h.indexOf('>INR<') >= 0) throw new Error('stale column default still shown'); return h; }],
  ['regional — two groups, language chain, derived direction', () => { ctx.UI._iamOpen = { regional: true }; const h = ctx.iamMeHTML({ ...ENTITY, country:'India', currency_code:'INR', timezone:'Asia/Kolkata' }); ['How you read it','Language','Reads','Timestamp','Numbers'].forEach(function(w){ if (h.indexOf(w) < 0) throw new Error('missing: ' + w); }); return h; }],
  /* ⚠️ THE FLAG MUST FOLLOW THE ENTITY, NOT THE READER. The first version used regionInfo().code and showed a
     UAE business the Indian flag. The stub reader is IN, so this case only passes if the entity wins. */
  ['regional — flag follows the entity, not the reader', () => { ctx.UI._iamOpen = { regional: true }; const h = ctx.iamMeHTML({ ...ENTITY, country:'AE', currency_code:'AED' }); if (h.indexOf(String.fromCodePoint(127462,127466)) < 0) throw new Error('UAE flag missing'); if (h.indexOf(String.fromCodePoint(127470,127475)) >= 0) throw new Error("reader's IN flag leaked onto an AE entity"); return h; }],
  /* ⚠️ GOODS is the DEFAULT and must stay so — every existing entity behaves as a seller of goods today, and
     a migration must not silently re-classify a live business. */
  ['business — supplies defaults to goods',  () => { vm.runInContext('CSU.me = {}; CSU.p = null;', ctx); ctx.csuPrefill(); const h = ctx.csuSuppliesRow(ctx.CSU.edit); if (h.indexOf('value="goods" selected') < 0) throw new Error('goods is not the default'); return h; }],
  ['business — supplies both is offered',    () => { const h = ctx.csuSuppliesRow({ supplies:'both' }); if (h.indexOf('value="both" selected') < 0) throw new Error('both not selectable'); return h; }],
  ['regional — theme and text size, with the percentage', () => { ctx.UI._iamOpen = { regional: true }; const h = ctx.iamMeHTML({ ...ENTITY, country:'IN', currency_code:'INR' }); if (h.indexOf('115%') < 0) throw new Error('the percentage is the useful part and it is missing'); if (h.indexOf('Cream') < 0) throw new Error('theme missing'); if (h.indexOf('Theme and text size') < 0) throw new Error('no link to the screen that SETS them'); return h; }],
  /**
   * ⚠️ A ZONE ALIAS IS NOT A DIFFERENT ZONE. Asia/Calcutta === Asia/Kolkata. The note that explains a shifted
   * timestamp must stay SILENT when the two clocks agree, or it tells a reader they are somewhere they are
   * not — which is exactly what a string compare did.
   */
  ['regional — zone alias is not a difference', () => { ctx.UI._iamOpen = { regional: true }; const h = ctx.iamMeHTML({ ...ENTITY, timezone: 'Asia/Kolkata' }); if (h.indexOf('your device') >= 0 && ctx.CBLocale.timezone() === 'Asia/Calcutta') throw new Error('claimed a difference between two names for one zone'); return h; }],
  ['iamSelfEmployeeHTML — commenter',       () => ctx.iamSelfEmployeeHTML(ACTOR)],
  ['iamSelfEmployeeHTML — editor + reach',  () => ctx.iamSelfEmployeeHTML({ ...ACTOR, access_level: 'editor', whole_entity: true, can_see_costs: true })],
  ['CBIdDocs.html — self, empty',           () => ctx.CBIdDocs.html([], 'self')],
  ['CBIdDocs.html — self, with rows',       () => ctx.CBIdDocs.html([{ scheme: 'PAN', value_masked: 'ABC••••34F', status: 'verified', submitted_by: 'x' }], 'self')],
  /* Trade ready — the OUTWARD answer on the profile. Every state, because the difference between "nothing
     recorded" and "could not read" is a claim about a business that a counterparty will act on. */
  ['trade — nothing recorded',            () => { ctx.UI._rdSum = {total:0,met:0,verified:0,attested:0,documented:0,pending:0,expiring:0,expired:0}; return ctx.iamTradeBody(); }],
  ['trade — all clean',                   () => { ctx.UI._rdSum = {total:7,met:7,verified:5,attested:2,documented:0,pending:0,expiring:0,expired:0}; return ctx.iamTradeBody(); }],
  ['trade — expiring and expired',        () => { ctx.UI._rdSum = {total:7,met:4,verified:2,attested:1,documented:1,pending:2,expiring:1,expired:1}; return ctx.iamTradeBody(); }],
  ['trade — read failed is not zero',     () => { ctx.UI._rdSum = null; return ctx.iamTradeBody(); }],
  /**
   * Channels on the profile. ⚠️ THE FIXTURE IS THE SERVER SHAPE, NOT A FLAT LIST. lib/channels.js returns a
   * CATALOGUE OF TYPES each carrying its own bindings — and the first version of this feature read
   * j.channels as though it were the rows, so the profile silently showed nothing. A test built on the same
   * guess would have passed on the same mistake, which is why srvChannels() mirrors the real payload and the
   * flattening is exercised rather than assumed.
   */
  /* Channels on the profile — the OTHER half of "how is this store reached". A declared channel receives
     nothing, so it must never render as a working contact route. */
  ['channels — one verified',             () => { ctx.UI._chans = srvChannels([{channel:'whatsapp',address:'+919876543210',label:'Shop',status:'verified'}]); ctx.UI._chansLoaded = true; return ctx.iamMeHTML({ ...ENTITY, catalogue_visibility:'public' }); }],
  ['channels — declared says so',         () => { ctx.UI._chans = srvChannels([{channel:'whatsapp',address:'+919876543210',label:'Shop',status:'declared'}]); ctx.UI._chansLoaded = true; return ctx.iamMeHTML({ ...ENTITY, catalogue_visibility:'public' }); }],
  ['channels — read failed is silent',    () => { ctx.UI._chans = null; ctx.UI._chansLoaded = true; return ctx.iamMeHTML(ENTITY); }],
  ['CBIdDocs.html — owner',                 () => ctx.CBIdDocs.html([], 'owner', { subject: 'act-1' })],
];

let pass = 0, fail = 0;
for (const [name, fn] of CASES) {
  try {
    const out = fn();
    if (typeof out !== 'string' || out.length < 20) { fail++; console.error('  ✗ ' + name + '  → returned ' + JSON.stringify(String(out).slice(0, 40))); }
    else { pass++; console.log('  ✓ ' + name + '  (' + out.length + ' chars)'); }
  } catch (e) {
    fail++;
    console.error('  ✗ ' + name + '\n      ' + e.name + ': ' + e.message);
  }
}

console.log(`\n══ render smoke · ${pass} passed · ${fail} failed ══\n`);
process.exit(fail ? 1 : 0);
