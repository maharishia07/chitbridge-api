#!/usr/bin/env node
/**
 * e2e/walk-locale.cjs — EVERY CUSTOMER SCREEN IN THE PSEUDO-LOCALE, MEASURED (round LOC0, 2026-10-13).
 *
 * Owner, 2026-10-13: *"when we change the language, does every entry in the menu, chip, icon change according to language?"*
 * This walk answers with a number per screen instead of an opinion. It opens each screen with the language `qps` — the
 * pseudo-locale pack (public/app/strings-qps.js): every string that goes through the catalogue comes back as "[!! Ŝàļéš !!]" —
 * at 1366 and at 390, and counts:
 *   untranslated   rendered text nodes still in plain English = hard-wired, no translator can reach them
 *   clipped        boxes whose text no longer fits at +40 % (scrollWidth > clientWidth with overflow hidden, or past the viewport)
 * Per screen the pair is held in e2e/locale-baseline.json. ⭐ A RATCHET: the walk FAILS when either number goes UP (new code
 * must use the catalogue); when a number falls, it says so — run `--write` to lower the bar. docs/design/standards/LOCALE-STANDARD.md.
 *
 * ⚠️ WHAT IS NOT COUNTED, by the standard: user data (the fixture's shop, party, product and person names — listed below as
 * DATA, never translated), identifiers (.mono · code · kbd · [translate=no]), digits and glyphs, text in another script, and build
 * chrome marked [data-dev-only] (the Build-preview ribbon: its API URL carries this run's random port — a tester on the product never sees it).
 * Server sentences (may/why) ARE counted: the standard wants them keyed, so today they are honestly untranslated.
 *
 * ⚠️ STAND-IN, NOT A SERVER: the site is served from this checkout (e2e/lib/walk.cjs), the API answered inside the page with the
 * shapes the other walks use (walk-home · walk-finance · walk-tasks · walk-employees · cb-accounts · the CRM golden parties).
 * Answers are delayed 300 ms so the pack — fetched on the language switch, asynchronously, as every pack is — lands before the
 * screens paint their lists, as it does on a real connection; and the pack is held until the page's boot script is over (its first
 * /api call), so what boot paints before any pack can arrive (the Assistant button) counts the same way every run.
 *
 *   NODE_PATH=e2e/node_modules node e2e/walk-locale.cjs            ratchet against the baseline (CI, run-shard.cjs)
 *   NODE_PATH=e2e/node_modules node e2e/walk-locale.cjs --write    re-measure and rewrite e2e/locale-baseline.json
 * Screenshots: e2e/shots/walk-locale-<screen>-<width>.png (one per screen × width).
 */
'use strict';
const TD = require('./lib/today.cjs');
const fs = require('fs'), path = require('path');
const W = require('./lib/walk.cjs');
const books = require('./lib/books-api.cjs'), crmApi = require('./lib/crm-api.cjs');
const C = require('./lib/contract.cjs');   /* M43: every /api/books, /api/crm and /api/work answer this stand-in serves is held to the API contract */

const WRITE = process.argv.includes('--write');
const BASE_FILE = path.join(__dirname, 'locale-baseline.json');
const DELAY = 300;
const PACK_CAP = 2500;   /* the pack is held until the page's first /api call (see the route below), at most this long */
const WIDTHS = [{ w: 1366, h: 800 }, { w: 390, h: 844, phone: true }];
const SHOP = 'CBXK3RPTTR';

/* ── the fixture's USER DATA: the author's own words, never translated, never counted ─────────────────────────────── */
const PEOPLE = [{ id: 'p1', name: 'Asha Kumar', state: 'on' }, { id: 'p2', name: 'Ravi Nair', state: 'on' }, { id: 'p3', name: 'Meena Iyer', state: 'off' }];
const PARTIES = ['Sri Hardware', 'Lakshmi Stores', 'Kumar Traders', 'Bharat Steel', 'Settled Sons', 'Ravi Stores', 'Chola Auto Care', 'Agro Mills', 'Kavi Traders', 'Fresh Farms', 'Kumar Stores', 'Meena', 'Lakshmi'];
const TILL_ITEMS = [];
for (let i = 0; i < 24; i++) TILL_ITEMS.push({ item_id: 'p' + i, name: 'Product number ' + i, code: 'P' + i, category: ['Tiffin', 'Drinks', 'Sweets'][i % 3], unit: 'plate', price: 20 + i });
const FX = crmApi.resolve(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'golden-parties.json'), 'utf8')), TD.nowMs());
const SHOP_FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'shop-catalogue.json'), 'utf8'));
const DATA_KEYS = /^(name|display_name|legal_name|nickname|subject|manual_subject|auto_subject|particulars|party|counterparty_name|brand_name|user_id|email|phone|address|city|role|remark|note|ref|bill_no|party_no|code|category|unit|gstn|gstin)$/;
/** every string value under a data-ish key, anywhere in a fixture object */
function dataStrings(o, into) {
  into = into || new Set();
  if (Array.isArray(o)) { o.forEach((x) => dataStrings(x, into)); return into; }
  if (o && typeof o === 'object') { Object.keys(o).forEach((k) => { const v = o[k]; if (typeof v === 'string' && DATA_KEYS.test(k) && v.trim()) into.add(v.trim()); else if (v && typeof v === 'object') dataStrings(v, into); }); }
  return into;
}
const DATA = dataStrings([PEOPLE, TILL_ITEMS, FX.list, FX.records, SHOP_FIX]);
/* the brand is a name too (Microsoft does not translate "Excel"); the product AREAS (CB Accounts, Tasks & Orders) are words, and count */
['Fixture Shop', 'Fixture Owner', 'Mayur Bhavan', 'Walk Shop', 'ChitBridge', 'Chit & Bridge', 'Order SO-1', 'Order SO-2', 'Purchase to Fresh Farms', 'Clean the cold room', 'Order SO-0', 'Tomato', 'Onion', 'Rice 25 kg bag', 'Potato', 'Ring first', 'Tiffin', 'Drinks', 'Sweets', 'Fresh Mart', 'Big Brand', 'Chennai', 'Festival 10% off'].concat(PARTIES).forEach((s) => DATA.add(s));

/* ── the stand-in API, one handler for every screen ─────────────────────────────────────────────────────────────────── */
const ME = { entity: { display_name: 'Fixture Shop', currency_code: 'INR', country: 'IN', locale_prefs: { lang: 'qps', langs: 'qps' } } };
const fin = (o) => Object.assign({ credit_limit_minor: null, over_limit: false, interest_minor: 0, last_remind: null }, o);
const DUES = [
  fin({ party_id: 'pa', party_no: 'P-00001', name: 'Sri Hardware', side: 'customer', balance_minor: 12000000, oldest_due: '2026-06-01', credit_limit_minor: 10000000, over_limit: true, interest_minor: 150000, buckets: { lt_6m: 12000000 } }),
  fin({ party_id: 'pb', party_no: 'P-00002', name: 'Lakshmi Stores', side: 'customer', balance_minor: 4500000, oldest_due: '2026-08-15', credit_limit_minor: 10000000, interest_minor: 20000, last_remind: '2026-09-20', buckets: { lt_6m: 4500000 } }),
  fin({ party_id: 'pc', party_no: 'P-00003', name: 'Kumar Traders', side: 'customer', balance_minor: 800000, oldest_due: '2026-10-30', buckets: { not_due: 800000 } }),
  fin({ party_id: 'ps', party_no: 'P-00004', name: 'Bharat Steel', side: 'supplier', balance_minor: -300000, oldest_due: '2026-07-10', buckets: { lt_1y: 300000 } }),
];
const line = (id, what, qty, unit, price, delivered, who) => ({ line_id: id, particulars: what, qty, unit, price_minor: price, delivered, removed: false,
  assignment: who ? { assignee_actor_id: who.id, assignee_name: who.name, assignee_type: 'human', history: [] } : null, settings: { due: null, task: null, note: null, state: 'open' } });
const row = (id, o) => Object.assign({ chit_id: id, kind: 'order_in', side: 'sell', status: 'pending', subject: 'Order', ref: null, party: null, party_id: null, channel: null, fulfilment: null,
  address: null, requested_for: null, remark: null, total_minor: null, currency: 'INR', billed: false, despatched: false, assignee: null, created_at: new Date(TD.nowMs() - 2 * 3600e3).toISOString(), age_days: 0, lines: [] }, o);
const WORK = [
  row('c1', { subject: 'Order SO-1', ref: 'SO-1', party: 'Meena', party_id: 'cust-1', channel: 'online', fulfilment: 'pickup', requested_for: '2026-10-13', remark: 'Ring first', total_minor: 120050, lines: [line('l1', 'Tomato', 5, 'kg', 10000, 0, null), line('l2', 'Onion', 3, 'kg', 23350, 1, PEOPLE[0])] }),
  row('c2', { subject: 'Order SO-2', ref: 'SO-2', party: 'Kumar Stores', party_id: 'cust-2', status: 'accepted', total_minor: 48000, assignee: { id: 'p1', name: 'Asha Kumar' }, age_days: 3, lines: [line('l3', 'Rice 25 kg bag', 2, 'bag', 24000, 0, null)] }),
  row('c3', { kind: 'order_out', side: 'buy', subject: 'Purchase to Fresh Farms', party: 'Fresh Farms', party_id: 'sup-1', status: 'accepted', total_minor: 900000, age_days: 1, lines: [line('l4', 'Potato', 100, 'kg', 9000, 40, null)] }),
  row('t1', { kind: 'task', side: null, subject: 'Clean the cold room', party: 'Fixture Shop', assignee: { id: 'p2', name: 'Ravi Nair' }, age_days: 1 }),
];
const OK = { ok: true };
/* a list row, in the shape the API's contract holds (walk-tasks.cjs rowOut): counts of lines, never the lines themselves */
const workOut = (r) => ({ chit_id: r.chit_id, kind: r.kind, tab: r.kind === 'order_in' ? 'orders_in' : r.kind === 'order_out' ? 'orders_out' : 'tasks', stage: r.status === 'accepted' ? 'accepted' : 'new', word: r.status === 'accepted' ? 'Accepted' : 'New',
  status: r.status, side: r.side, subject: r.subject, ref: r.ref, party: r.party, party_id: r.party_id, channel: r.channel, fulfilment: r.fulfilment, address: r.address, requested_for: r.requested_for, remark: r.remark, total_minor: r.total_minor, currency: r.currency,
  lines_n: r.lines.length, lines_open_n: r.lines.filter((l) => l.qty - l.delivered > 0).length, billed: r.billed, despatched: r.despatched, assignee: r.assignee, lines_assigned_n: r.lines.filter((l) => l.assignment).length || null, created_at: r.created_at, age_days: r.age_days,
  actions: { accept: r.status === 'accepted' ? { ok: false, why: 'already_done', say: 'This chit is already at that step.' } : OK, reject: OK, complete: OK, cancel: OK, reopen: OK, assign_task: OK, assign_line: OK, deliver_line: OK, amend: OK } });
const CHOICES = [
  { key: 'counter', label: 'Counter only', why: 'Bills and sells. Cannot see costs.', level: 'editor', whole_entity: false, can_see_costs: false },
  { key: 'manager', label: 'Manager', why: 'Sees the whole shop. Cannot see costs.', level: 'editor', whole_entity: true, can_see_costs: false },
];
const may = (o) => Object.assign({ access: OK, reset_pin: OK, switch: { ok: true, to: 'off' }, cover: OK }, o || {});
const STAFF = [
  { id: 'p1', name: 'Asha Kumar', user_id: 'asha01@walk-shop.br', role: 'Cashier', phone: '9840000001', state: 'on', jobs: 0, last_at: TD.nowIso(), access: CHOICES[0], may: may(), cover: null, cover_options: [{ id: 'p2', name: 'Ravi Nair' }] },
  { id: 'p2', name: 'Ravi Nair', user_id: 'ravi02@walk-shop.br', role: 'Manager', phone: '9840000002', state: 'on', jobs: 2, last_at: null, access: CHOICES[1], may: may({ reset_pin: { ok: false, why: "Only the owner can reset a manager's code." } }), cover: null, cover_options: [] },
  { id: 'p3', name: 'Meena Iyer', user_id: 'meena03@walk-shop.br', role: 'Helper', phone: '', state: 'off', jobs: 0, last_at: null, access: CHOICES[0], may: may({ switch: { ok: true, to: 'on' } }), cover: null, cover_options: [] },
];
/* GET /api/network-offers as the API's contract holds it (NET-SRV1): the store half under `store`, each network with its membership, the
   server's may/why per action and the brand's / its root's bridge id; the brand half empty for a plain store. The old stand-in sent keys the
   API never had (offer_id · title · state · starts · ends) — the contract now catches that. */
const NO = (why, code) => ({ ok: false, code: code || 'BAD_STATE', why });
const NETWORK = { brand: { members: [], is_brand: false, bridge_id: 'shop.cb', root_bridge_id: 'brand.cb', policy: 'opt_in', stores: 0, offers: [], catalogue: null },
  store: { networks: [{ brand_id: 'b1', brand_name: 'Big Brand', policy: 'opt_in', brand_bridge_id: 'CBBRAND0001', root_bridge_id: 'CBBRAND0001',
    membership: { state: 'active', via: 'joined', edge_id: 'edge-1', brand_node: 'node-b1' },
    may: { request: NO('Already in this network, or already asked.'), approve: NO('Nothing is waiting for an answer.'), decline: NO('Nothing is waiting for an answer.'), suspend: NO('Only the network can suspend or resume a member.', 'NOT_ALLOWED'), resume: NO('Only a suspended member can be resumed.'), disconnect: { ok: true, code: null, why: null } },
    offers: [{ id: 'o1', name: 'Festival 10% off', kind: 'percent_off', live: true, at: '2026-10-20T00:00:00.000Z', until: '2026-11-05T00:00:00.000Z', choice: null, applies: false }] }], price_notices: [] },
  may_design: { ok: false, why: 'Only the owner may design a network.' } };
const STORES = { stores: [{ entity_id: 'e1', name: 'Fresh Mart', city: 'Chennai', status: 'member' }] };
const COUNTRY = { migrated: true, done: false, required: true, country: { code: 'IN', name: 'India' }, currency: 'INR', fy_start_month: 4, tax: { registered: false, number: null, scheme: null }, source: { country: 'time zone', currency: 'country', fy_start_month: 'country' }, pack: { id: 'IN', version: '1.0.0', books: true, code: null, why: null } };
const TODAY = TD.TODAY;

function answer(p, u, m) {
  if (p === '/api/entities/me') return ME;
  if (p === '/api/entities/header') return { business: { display_name: 'Fixture Shop', bridge_id: 'CBWALK0001' }, licences: [], trade_ready: true };
  if (p === '/api/facts/rail') return crmApi.railFacts({ suppliers: 1, customers: 3, in: 24, out: 2, stuck: 3 });
  if (p === '/api/facts/rail/chits') return { overdue_days: 7, truncated: false, items: [] };
  if (p === '/api/books/health') return books.health({ waiting: [books.waitingRow({ id: 1, chit_id: 'ch7', ref: 'bill:ch7', reason: 'September is locked.', tries: 3, since: '2026-09-28T10:00:00Z' })] });
  if (p === '/api/books/todo') return [books.todoRow({ kind: 'months_not_locked', count: 2, words: '2 months are over but still open: August 2026, September 2026.', action: { label: 'Lock the months', screen: 'periods', call: 'POST /api/books/periods/:fy/:period/lock' } })];
  if (p === '/api/books/dues') return books.dues(DUES.map((x) => books.dueRow({ party_no: x.party_no, name: x.name, party_id: x.party_id, side: x.side, balance_minor: x.balance_minor, oldest_due: x.oldest_due, buckets: x.buckets })), { asOf: TODAY });
  if (p === '/api/books/periods') return books.periods([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => books.periodRow('2026-27', n, n === 5 ? 'soft_locked' : 'open')));
  if (p === '/api/books/accounts') return { accounts: [books.accountRow({ account_id: 'acc-1400', code: '1400', name: 'Cash', tally_group: 'Cash-in-Hand', nature: 'asset' }), books.accountRow({ account_id: 'acc-4000', code: '4000', name: 'Sales', tally_group: 'Sales Accounts', nature: 'income' })] };
  if (p === '/api/books/packs') return { packs: [] };
  if (p === '/api/folders') return { folders: [] };
  if (p === '/api/crm/parties') return crmApi.list(FX.list, { records: FX.records });
  if (p === '/api/crm/followups') return crmApi.followups([]);
  if (p === '/api/work/facts') return { truncated: false, counts: { orders_in: 2, orders_out: 1, tasks: 1, done: 0 }, lines: [{ text: '1 new order', value: 1, tone: 'dn' }], figures: { orders_new: 1, tasks_mine: 0, orders_in: 2, orders_out: 1, tasks: 1, done: 0 } };
  if (p === '/api/work/list') { const view = u.searchParams.get('view') || 'orders_in'; const rows = WORK.map(workOut).filter((r) => view === 'all' || r.tab === view); return { view, page: 1, limit: 50, truncated: false, counts: { orders_in: 2, orders_out: 1, tasks: 1, done: 0 }, total: rows.length, rows }; }
  if (p === '/api/people') return { people: STAFF, may: { add: OK }, access_choices: CHOICES, counts: { on: 2, off: 1 } };
  if (p === '/api/network-offers') return NETWORK;
  if (p === '/api/network-design/stores') return STORES;
  if (p === '/api/network-design') return { draft: null };
  if (p === '/api/governance/country-setup') return COUNTRY;
  /* the counter's plain summary, as routes/till.js sends it (no summary yet: no rows, no counters) - held to the contract's GET /api/till/summary */
  if (p === '/api/till/summary') return { period: u.searchParams.get('period') || 'day', rows: [], counters: [], live_capped: false };
  if (p === '/api/catalogue/' + SHOP) return SHOP_FIX;
  if (/^\/api\/(assist|integrations)\//.test(p)) return {};
  return m === 'GET' ? {} : { ok: true };
}

/* ── the screens (the brief's list), how each is opened and when it is ready ─────────────────────────────────────── */
const SCREENS = [
  { id: 'home', url: '/', ready: '[data-testid="cbshell"]' },
  { id: 'till', url: '/till.html', ready: null, seed: async (page) => {
    await page.waitForFunction(() => typeof window.screenSet === 'function' && typeof window.setMode === 'function', null, { timeout: 30000 });
    await page.evaluate((items) => { window.S = { shop: { name: 'Fixture Shop', currency: 'INR' }, items, offers: [], at: new Date().toISOString() /* clock-ok: in the page, whose clock is CB_TODAY */ }; setMode('sell'); try { applyLook(); } catch (_) {} try { paintChips(); } catch (_) {} items.slice(0, 3).forEach((i) => addItem(i, 1)); try { price(); } catch (_) {} }, TILL_ITEMS);
  } },
  { id: 'shop', url: '/shop.html?s=' + SHOP, ready: null },
  { id: 'accounts', url: '/accounts.html', ready: '[data-testid="shell-header"], header, h1' },
  { id: 'finance', url: '/finance.html', ready: '[data-testid^="fin-row-"]' },
  { id: 'crm', url: '/crm.html', ready: '[data-testid="shell-header"], header, h1' },
  { id: 'tasks', url: '/tasks.html', ready: '[data-testid="shell-header"], header, h1' },
  { id: 'employees', url: '/employees.html', ready: '[data-testid="shell-header"], header, h1' },
  { id: 'network', url: '/network.html', ready: '[data-testid="shell-header"], header, h1' },
  { id: 'country-lab', url: '/app.html#/country', ready: '[data-testid="cs-rows"]' },
];

/** in the page: every rendered text node that is still plain English, and every text box that no longer fits */
function measureInPage(dataList) {
  const DATA = dataList.slice().sort((a, b) => b.length - a.length);               /* longest first, so "Ravi Stores" goes before "Ravi" */
  /* [data-dev-only]: build chrome (app.html's Build-preview ribbon — the API URL carries this run's RANDOM port) — never product copy, never counted (LOC0b) */
  const SKIP = 'script,style,noscript,template,code,kbd,pre,.mono,[translate="no"],[data-dev-only],#__walkbanner';
  const docLang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
  /* what the locale LAYER wrote: a date, a time, a money figure — localised by construction, in the FORMAT locale, not the language */
  const FORMATTED = /\b\d{1,2} [A-Z][a-z]{2}( \d{4})?\b|\b\d{1,2}:\d{2}( ?[ap]m)?\b|[A-Z]{3} ?\d/g;
  const IDENT = /\b[A-Z][A-Z0-9]*(?:[\/\-_.:][A-Z0-9]+)+\b|\b[A-Z]{2,}\d+\b|\b\d{2,}…\d+\b|^[A-Z]{3}$|^[A-Z]$/g;   /* SO-1 · C1/26-27/0041 · 91…21 · a bare ISO code · an avatar initial */
  /** the text with the author's words, identifiers and formatted figures taken out — what is left is the product's own copy */
  const chrome = (t) => { let s = t.replace(/https?:\/\/\S+/g, ' '); DATA.forEach((d) => { if (s.indexOf(d) >= 0) s = s.split(d).join(' '); }); return s.replace(FORMATTED, ' ').replace(IDENT, ' '); };
  const scrolls = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  const untranslated = [], clipped = [], seenEl = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const t = node.nodeValue.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const el = node.parentElement;
    if (!el || el.closest(SKIP)) continue;
    /* an element that DECLARES its own language holds content in that language (the kural's Tamil verse, its English meaning) — not chrome */
    const own = el.closest('[lang]');
    if (own && own !== document.documentElement && (own.getAttribute('lang') || '').toLowerCase() !== docLang) continue;
    const r = (() => { const rg = document.createRange(); rg.selectNodeContents(node); return rg.getBoundingClientRect(); })();
    if (!(r.width > 0 && r.height > 0)) continue;                                   /* not rendered: display:none, empty, collapsed */
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const pseudo = /\[!+ /.test(t) || / !+\]/.test(t);                               /* it went through the catalogue */
    const rest = pseudo ? '' : chrome(t);
    const isChrome = pseudo || /[A-Za-z]/.test(rest);                                /* product copy (translated or not) — as against a name, a figure, a glyph */
    /* clipping is a property of the BOX, measured once per element that holds product copy — a NAME shortened with an ellipsis is by design */
    if (isChrome && !seenEl.has(el)) {
      seenEl.add(el);
      const b = el.getBoundingClientRect();
      if (cs.display !== 'inline' && b.width > 1 && b.height > 1 && !/^(rect|inset)\(/.test(cs.clip + cs.clipPath)) {
        const over = el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible';
        const past = b.right > window.innerWidth + 1 && b.left < window.innerWidth && !scrolls(el);
        if (over || past) clipped.push((el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '')) + ' "' + t.slice(0, 40) + '"' + (over ? ' clips' : ' past-edge'));
      }
    }
    if (!pseudo && isChrome) untranslated.push(t);
  }
  return { untranslated, clipped, pack: !!(window.CBSTR && window.CBSTR.qps), locale: !!window.CBLocale, lang: docLang };
}

W.run('locale', async (w) => {
  const { browser } = w;
  let baseline = {};
  try { baseline = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8')); } catch (_) { baseline = {}; }
  const measured = {};
  const errsBy = {};

  for (const S of SCREENS) {
    for (const V of WIDTHS) {
      const key = String(V.w);
      const ctx = await browser.newContext(Object.assign({ viewport: { width: V.w, height: V.h }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' }, V.phone ? { isMobile: true, hasTouch: true } : {}));
      await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      /* ⭐ THE PACK LANDS AFTER BOOT, AS ON A REAL CONNECTION (LOC0b). Served from this checkout the pack script could land before
         app.html's boot script had finished — a race the runner lost one run in three: "💬 Assistant" is mounted by route() and never
         repainted, so it counted or not by luck. The pack is held until the page's FIRST /api call (boot is over by then — JS is
         single-threaded, so an async script runs only after the script that asked), then released at once; the API's answers take
         DELAY ms more, so the pack still lands before any list paints. A page that never calls the API gets it after PACK_CAP ms. */
      let release; const booted = new Promise((x) => { release = x; }); setTimeout(release, PACK_CAP);
      await ctx.route(/\/app\/strings-[a-z]+\.js(\?|$)/, async (r) => { await booted; return r.continue(); });
      await ctx.route('**/api/**', async (r) => {
        release();
        const q = r.request(), u = new URL(q.url());
        const body = answer(u.pathname, u, q.method());
        await new Promise((x) => setTimeout(x, DELAY));
        return C.json(r, 200, body);
      });
      /* the reader's choice, as the product stores it: the UI language is qps; the figures stay en-IN (language and format are two choices) */
      await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); localStorage.setItem('cb_lang', 'qps'); localStorage.setItem('cb_langs', 'qps'); localStorage.setItem('cb_locale', 'en-IN'); localStorage.setItem('cb_region', 'IN'); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));
      await ctx.addInitScript(() => { try { window.print = function () {}; } catch (_) {} });
      const page = await ctx.newPage();
      const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message || e).split('\n')[0].slice(0, 120)));

      await w.step('L-' + S.id + '-' + key, S.id + ' at ' + key + ' in qps -> every word from the catalogue, nothing clipped', async () => {
        await page.goto(w.base + S.url, { waitUntil: 'load' });
        if (S.seed) await S.seed(page);
        if (S.ready) await page.waitForSelector(S.ready, { timeout: 15000 }).catch(() => {});
        /* the pack arrives on the switch, asynchronously; wait for it where the page loads the locale layer at all */
        await page.waitForFunction(() => typeof window.CBSTR === 'undefined' || !window.CBLocale || window.CBSTR.qps, null, { timeout: 5000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        /* measure a screen that has stopped changing: the same text twice, 600 ms apart (a late pack, a late list, a toast fading) */
        for (let i = 0, last = ''; i < 8; i++) { await page.waitForTimeout(600); const now = await page.evaluate(() => document.body.innerText.length + ':' + document.querySelectorAll('*').length).catch(() => ''); if (now === last) break; last = now; }
        const m = await page.evaluate(measureInPage, [...DATA]);
        try { await page.screenshot({ path: path.join(__dirname, 'shots', 'walk-locale-' + S.id + '-' + key + '.png') }); } catch (_) {}
        const uniq = [...new Set(m.untranslated)].sort();
        const res = { untranslated: m.untranslated.length, clipped: m.clipped.length, pack: m.pack, locale: m.locale, strings: uniq, clippedSample: m.clipped.slice(0, 8) };
        (measured[S.id] = measured[S.id] || {})[key] = res;
        if (errs.length) errsBy[S.id + '@' + key] = errs;
        const b = baseline[S.id] && baseline[S.id][key];
        const up = b ? [res.untranslated > b.untranslated ? 'untranslated ' + b.untranslated + ' -> ' + res.untranslated : '', res.clipped > b.clipped ? 'clipped ' + b.clipped + ' -> ' + res.clipped : ''].filter(Boolean) : [];
        const down = b ? [res.untranslated < b.untranslated ? 'untranslated ' + b.untranslated + ' -> ' + res.untranslated : '', res.clipped < b.clipped ? 'clipped ' + b.clipped + ' -> ' + res.clipped : ''].filter(Boolean) : [];
        const facts = 'untranslated ' + res.untranslated + (b ? ' (baseline ' + b.untranslated + ')' : '') + ' · clipped ' + res.clipped + (b ? ' (baseline ' + b.clipped + ')' : '') + ' · pack ' + (m.pack ? 'landed' : m.locale ? 'NOT loaded' : 'no locale layer on this page');
        if (WRITE) return { ok: true, saw: facts + ' · written' };
        if (!b) return { ok: false, saw: facts + ' · NO BASELINE — run with --write' };
        if (up.length) { const fresh = uniq.filter((x) => (b.strings || []).indexOf(x) < 0); return { ok: false, saw: facts + ' · WENT UP: ' + up.join(', ') + ' — new words must go through tx()' + (fresh.length ? ' · new: ' + fresh.slice(0, 6).map((x) => JSON.stringify(x.slice(0, 50))).join(', ') : '') + (res.clipped > b.clipped ? ' · clipped: ' + res.clippedSample.join(', ') : '') }; }
        return { ok: true, saw: facts + (down.length ? ' · fell (' + down.join(', ') + ') — run --write to lower the bar' : '') };
      });
      await ctx.close();
    }
  }

  /* the pack itself, reached the way a screen reaches it — the standard's example, exactly */
  await w.step('L-pack', 'tx("Sales") in qps -> "[!! Ŝàļéš !!]" (accented, longer, bracketed; a placeholder and a tag survive)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
    await ctx.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await ctx.addInitScript(() => { try { localStorage.setItem('cb_lang', 'qps'); } catch (_) {} });
    const page = await ctx.newPage();
    await page.goto(w.base + '/accounts.html', { waitUntil: 'load' });
    await page.waitForFunction(() => window.CBSTR && window.CBSTR.qps, null, { timeout: 5000 }).catch(() => {});
    const got = await page.evaluate(() => [tx('Sales'), txf('Remove {name} from the list?', { name: 'Alpha' }), tx('A <b>shared</b> record'), txn('{count} product', '{count} products', 3), tx('Open', 'status')]);
    await ctx.close();
    const ok = got[0] === '[!! Ŝàļéš !!]' && /\[!+ .*\{name\}|Alpha/.test(got[1]) && got[1].indexOf('Alpha') > 0 && /<b>/.test(got[2]) && /3/.test(got[3]) && /^\[!+ /.test(got[4]);
    return { ok, saw: got.join('  ·  ') };
  });
  await w.step('M43', 'the stand-in answered every /api/books, /api/crm and /api/work call as the API contract says', async () => { const [ok, saw] = C.finish(); return { ok, saw }; });

  if (WRITE) {
    const out = { _what: 'walk-locale.cjs baseline — per screen × width: untranslated = rendered English text nodes not pseudo-localised (strings = the distinct ones, so a rise names the new words); clipped = text boxes that clip at +40 %. A ratchet: the walk fails when a number rises. Rewrite ONLY with --write after a conversion round.', _written: TD.TODAY };
    Object.keys(measured).forEach((id) => { out[id] = {}; Object.keys(measured[id]).forEach((k) => { const r = measured[id][k]; out[id][k] = { untranslated: r.untranslated, clipped: r.clipped, pack: r.pack, clipped_sample: r.clippedSample, strings: r.strings }; }); });
    fs.writeFileSync(BASE_FILE, JSON.stringify(out, null, 1) + '\n');
    console.log('\nbaseline written: e2e/locale-baseline.json');
  }
  console.log('\n  screen        width  untranslated  clipped  pack');
  Object.keys(measured).forEach((id) => Object.keys(measured[id]).forEach((k) => { const r = measured[id][k]; console.log('  ' + id.padEnd(13) + k.padEnd(7) + String(r.untranslated).padStart(12) + String(r.clipped).padStart(9) + '  ' + (r.pack ? 'yes' : r.locale ? 'no' : 'no locale layer')); }));
  const ek = Object.keys(errsBy);
  if (ek.length) console.log('\n  page errors (not asserted): ' + ek.map((k) => k + ': ' + errsBy[k][0]).join(' | '));
});
