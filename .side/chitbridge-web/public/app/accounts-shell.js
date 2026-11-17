/* accounts-shell.js — the small shared floor under every page that shows the Ledger (app.html, accounts.html, and the
 * Ledger tile on index.html). Loaded by app.html right after core.js and BEFORE its inline script; by accounts.html
 * before cap-books.js. Nothing here was written for CB Accounts alone: each piece was already in app.html and is MOVED
 * here, so that the app and the CB Accounts page run ONE implementation, not two copies (2026-10-01, docs/design/
 * cb-accounts/CLOUD-TASK.md).
 *
 * What lives here, and why it is not in app.html any more:
 *   · tx / txf / cbLang / CBSTR — the English-is-the-key string door (cap-books.js speaks through it)
 *   · friendlyErr, toast         — a failure's words, and the one-line toast (host: the page's <div id="toast"> or one it makes; a live region)
 *   · CB_BOOKS_EP                — the Ledger's boot endpoints (health · status · enable · setting · dues · statement);
 *                                  app.html adds them to its EP, accounts.html to its own. cap-books.js adds the rest.
 *   · CBAction                   — the action-state helper: busy · confirm for irreversible writes · outcome (M64)
 *   · CBLedger                   — the Ledger's SWITCH: the words, the confirm, the call, in one place. The Settings
 *                                  card (bizLedgerSwitch, cap-admin.js), the CB Accounts page and the index tile each
 *                                  paint their own box and hand this their own dialog and transport.
 *
 * ⚠️ Declares only `var` / function names the app does not declare with let/const (EP, CFG, SESSION, UI are the host
 * page's own). ⚠️ NEVER the banned words on a screen — it is the Ledger / CB Accounts.
 * OWNS      the shared floor: tx · txf · txn · cbLang · CBSTR (strings) · friendlyErr · toast · toastHost · CBConfirm (the question box) · CBAction · CBUnsaved · CBLedger · CB_HOMES · the CB_*_EP endpoint maps · billUseChoiceHTML
 * CALLED BY every page with <script src="/app/accounts-shell.js">: public/accounts.html · app.html · authority-forms.html · catalogue.html · crm.html · employees.html · finance.html · know-your-business.html · network.html ·
 *           operations.html · settings.html · shop.html · store.html · tasks.html · ui-standard.html · index.html (repo root)
 * FLOW      loaded right after core.js → tx / friendlyErr / toast → CBAction → CBUnsaved → CBLedger → the page's own script
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/small-app-shell-page-frame-cblist-list-controls
 */
'use strict';

/* ── IX0 (2026-10-13): THE SMALL APP THAT IS HOME FOR A WORKSHOP SCREEN KEY. A utility page never sends a customer into app.html
   (H34, "Utility apps, not app.html"); `navTo(key)` on CB Accounts · CB CRM · CB Finance resolves through this ONE map, the way
   standards.html's own `HOME` does. A key with no small-app home yet opens nothing and says so — never a door into the workshop.
   The gaps and the round that builds each: docs/design/INDEX-NOT-APP.md (e2e/index-not-app.cjs keeps the list shrinking). ── */
var CB_HOMES = {
  counter: '/till.html' /* the counter IS the till (the Day book's "close the day on the counter") */,
  task: '/tasks.html',
  order: '/tasks.html' /* CB Tasks & Orders */,
  customers: '/crm.html#/parties?role=customer',
  suppliers: '/crm.html#/parties?role=supplier',
  ledger: '/accounts.html',
  network: '/network.html',
  coassists: '/employees.html',
  profile: '/settings.html#/shop' /* the avatar's own choice for Profile: Settings › Your business (avatar.js, UX-96) */,
  shop: '/settings.html#/shop',
  country: '/settings.html#/country',
  settings: '/settings.html' /* CB Settings (SET1): Your shop · Country setup */,
  integrations: '/settings.html#/connectors',
  counters: '/settings.html#/counters',
  policy: '/settings.html#/policy',
  plan: '/settings.html#/plan' /* CB Settings (T3-SETTINGS) */,
  disputes: '/tasks.html?view=disputes&chit=' /* + the chit id: Tasks › Disputes with that chit's sheet open (RAIL-86) */,
  chit: '/crm.html#/chit/' /* + the chit id: the chit PAGE in CB CRM (CRM2) — chitPageHref(id) below */
};
/* the sheet's "Open page" (chit-sheet.js `page` → openChitPage on each ledger page): the chit page in CB CRM, never the workshop */
function chitPageHref(id) {
  return CB_HOMES.chit + encodeURIComponent(id);
}
/* the sheet's Dispute button on a page with no dispute form of its own: Tasks › Disputes on that chit (chit-sheet.js act 'dispute') */
function disputePageHref(id) {
  return CB_HOMES.disputes + encodeURIComponent(id);
}
/* ── the Ledger's boot endpoints ── */
var CB_BOOKS_EP = {
  booksHealth: { m: 'GET', p: '/api/books/health', ok: 'y' }, // 404 = the Ledger is off for this shop → the door stays hidden
  /* ⭐ T3-P1-MONEY: read by BOTH the workshop's Tax band (cap-admin.js misTaxExport) and CB Finance › Returns (cap-finance-returns.js) — one name, one place */
  taxGstr: { m: 'GET', p: '/api/tax/gstr', ok: '✓' }, // ?month=YYYY-MM&form=gstr1|gstr3b → the offline-tool JSON (tax-lines gstr1 · gstr3b), downloaded by helpers.js gstrDownload
  booksStatus: { m: 'GET', p: '/api/books/status', ok: 'y' }, // owner: { migrated, enabled, walkin_grain } — answers while off
  booksEnable: { m: 'POST', p: '/api/books/enable', ok: 'y' }, // owner: the switch (Settings › Your business › Ledger)
  booksSetting: { m: 'POST', p: '/api/books/setting', ok: 'y' }, // owner: { enabled:false } switches it off; nothing deleted
  booksDues: { m: 'GET', p: '/api/books/dues', ok: 'y' }, // every party's balance + oldest due in one read (the row chips)
  booksStatement: { m: 'GET', p: '/api/books/party/:id/statement', ok: 'y' },
  booksPartyBills: { m: 'GET', p: '/api/books/party/:id/bills', ok: 'y' }, // W15-107: one party's bills, open first, newest first, a page at a time (the row's sub-table)
  booksAttention: { m: 'GET', p: '/api/books/attention', ok: 'y' } // W15-102: the evidence counts of a range, or the entries behind one count
};
/* ── the party routes the app's Customers/Suppliers screens and CB CRM share (MOVED from app.html's EP, not copied: one name per endpoint,
   e2e/ep-aliases.cjs) — add a party, edit its fields, remove it, look someone up on ChitBridge ── */
var CB_PARTY_EP = {
  custGroup: { m: 'PATCH', p: '/api/relationships/customers/:id', ok: '✓' },
  custAdd: { m: 'POST', p: '/api/relationships/customers', ok: '✓' }, // { handle } on ChitBridge · { name, phone } a local party
  supList: { m: 'GET', p: '/api/relationships/suppliers', ok: '✓' }, // MOVED from app.html (T3-OPS): the workshop's Suppliers and CB Operations › Suppliers
  supAdd: { m: 'POST', p: '/api/relationships/suppliers', ok: '✓' }, // { supplier_bridge_id } · { name }
  supDel: { m: 'DELETE', p: '/api/relationships/suppliers/:id', ok: '✓' },
  supPatch: { m: 'PATCH', p: '/api/relationships/suppliers/:id', ok: 'y' }, // Stage B — owner-side fields (nickname/preferred/notes/category)
  entitySearch: { m: 'GET', p: '/api/entities/search', ok: '✓' }, // ?q=&where=here|<installation>|all — listed businesses by name (NET-39)
  entityPlaces: { m: 'GET', p: '/api/entities/search/places', ok: '✓' }, // the installations the Where picker offers (active only)
  custRewards: { m: 'GET', p: '/api/relationships/customers/:id/rewards', ok: '✓' }, // what this customer holds in points, and what it means — the ONE rewards pane (app/cap-rewards.js), read by the workshop's Customers pane and CB CRM's record (T3-P2-CRM; moved from app.html)
  /* ⭐ read by BOTH CB CRM and CB Finance — one name, one place (the registry guard fails a second declaration) */
  crmParties: { m: 'GET', p: '/api/crm/parties', ok: 'y' }, // { parties:[…], alerts:{…} } — one read, no per-row fetch; terms.customer per party
  booksTerms: { m: 'GET', p: '/api/books/terms', ok: 'y' }, // ?party_id&side → { terms_migrated, may_set, why_not, default, party, events } — CB Finance sets, CRM reads
  /* ⭐ T3-P1-MONEY: written by BOTH CB CRM (the follow-up sheet) and CB Finance › Cheques (Remind me = a follow-up due on the cheque's date) — one name, one place */
  crmFollowAdd: { m: 'POST', p: '/api/crm/followups', ok: 'y' } // { party_id, what, due_at, source: manual|dues|interaction, assignee_user_id? } → 201 { followup }
};

/* ── the shop's policy flags (b130) — the workshop's Settings › Policy AND CB CRM's Shop window (showcase_template, T3-P2-CRM) read and write them; MOVED from app.html's EP ── */
/* ── the shop's OWN particulars — what the workshop's Profile · Country setup AND CB Settings (settings.html, SET1 2026-10-13) read and write.
   MOVED from app.html's EP (one name per endpoint, e2e/ep-aliases.cjs): the profile (PATCH /entities/profile), the vault (GET /governance/profile),
   Country setup (CS1) ── */
var CB_SHOP_EP = {
  me: { m: 'GET', p: '/api/entities/me', ok: '✓' },
  saveProfile: { m: 'PATCH', p: '/api/entities/profile', ok: '✓' }, // {gstn,address,business_status}
  profileGet: { m: 'GET', p: '/api/governance/profile', ok: 'y' },
  countrySetup: { m: 'GET', p: '/api/governance/country-setup', ok: 'y' }, // CS1: the step after registration — country · money · year · tax, each with its source; pack { books, why }
  countrySetupSave: { m: 'PUT', p: '/api/governance/country-setup', ok: 'y' }, // CS1 (owner): set once; 503 before b299; 409 a different country (a new entity)
  /* a new shop is the shop's first setup (FX-UX2): the register form (app/register-form.js) on app.html #/register and CB Settings › New shop — MOVED from app.html's EP */
  register: { m: 'POST', p: '/api/entities/register', ok: '✓' }, // OTP request (register doubles as owner login)
  ownerVerify: { m: 'POST', p: '/api/entities/verify', ok: '✓' }, // verify OTP → token
  constitutions: { m: 'GET', p: '/api/entities/constitutions', ok: 'y' } // public: the verticals to choose at sign-up
};

/* ── CB SETTINGS › Counters & keys · Connectors · Policy · Plan & usage (T3-SETTINGS, 2026-10-14) — what the workshop's Settings › Integrations and the
   Profile's Usage read AND CB Settings reads (app/cap-settings.js). MOVED from cap-admin.js's EP and app.html's EP (one name per endpoint, e2e/ep-aliases.cjs).
   Who may write is the server's answer: counters writes are owner only (lib/owner.gate), GET /counters and GET /entities/policy say `may` ── */
var CB_SETTINGS_EP = {
  keysList: { m: 'GET', p: '/api/keys', ok: 'y' }, // API keys for other systems (routes/keys.js)
  keysMint: { m: 'POST', p: '/api/keys', ok: '✓' },
  keysRevoke: { m: 'DELETE', p: '/api/keys/:jti', ok: '✓' },
  /* ⭐ the shop's counters as standing identities (routes/counters.js, 2026-09-17) */
  counters: { m: 'GET', p: '/api/counters', ok: '✓' }, // { counters, free, may:{ manage } }
  counterAdd: { m: 'POST', p: '/api/counters', ok: '✓' },
  counterRename: { m: 'PATCH', p: '/api/counters/:id', ok: '✓' },
  counterOpen: { m: 'POST', p: '/api/counters/:id/open', ok: '✓' },
  counterRelease: { m: 'POST', p: '/api/counters/:id/release', ok: '✓' },
  intCatalogue: { m: 'GET', p: '/api/integrations/catalogue', ok: 'y' }, // the connectors that exist (routes/integrations.js), each with the pack's may/why
  intStatus: { m: 'GET', p: '/api/integrations/status', ok: 'y' }, // the connectors that have checked in
  intApprove: { m: 'POST', p: '/api/integrations/:id/approve', ok: '✓' }, // the owner approves a connector's PC (the handshake)
  policyGet: { m: 'GET', p: '/api/entities/policy', ok: '✓' }, // b130 — per-entity flags, on the ENTITY; + may per flag (T3-SETTINGS)
  policySet: { m: 'PATCH', p: '/api/entities/policy', ok: '✓' },
  /* The billing ledger for the CALLER's own entity — there is no entity parameter, so it cannot be asked about
     anyone else. Read on demand when the Usage section is opened, never as part of painting a profile. */
  entityUsage: { m: 'GET', p: '/api/entities/usage', ok: '✓' },
  entitlements: { m: 'GET', p: '/api/entities/entitlements', ok: 'y' }, // the plan and every quota as a STATE (unlimited · unset · capped) — reporting only (enforced:false)
  /* T3-P4-ACCOUNT: where this person is signed in (M05 sessions, routes/signin.js) — CB Settings › Account › Sessions; the first web reader of these routes */
  sessionsList: { m: 'GET', p: '/api/signin/sessions', ok: 'y' }, // { sessions:[{ jti, device_id, surface, iat, exp, current, device:{ label, kind, seen } }], legacy, may:{ devices } }
  devicesList: { m: 'GET', p: '/api/signin/devices', ok: 'y' }, // owner only (lib/owner.gate): every device of the shop with its live count
  sessionRevoke: { m: 'POST', p: '/api/signin/sessions/revoke', ok: '✓' } // { jti } my own (the owner: anyone's) · { device_id } the owner removes a device
};

/* ── the rail measured (T3-P4-ACCOUNT): ONE name for GET /api/folders/mis — CB Finance › Reports (app/cap-mis.js) and the workshop's MIS
   (cap-admin.js) read the server's measurement through it; MOVED here from cap-admin.js's own EP rows (ep-aliases: one endpoint, one name) ── */
var CB_MIS_EP = {
  misMetrics: { m: 'GET', p: '/api/folders/mis', ok: 'y' }, // { overdue_days, since, truncated, all, received, sent } — lib/measure, the rail's overdue rule
  tillTrend: { m: 'GET', p: '/api/till/summary', ok: 'y' } // RPT2 ?compare=1&period=week|month|quarter|year → { period, n, currency, fy_start_month, slots } — rollup.series; Reports › Trend (app/cap-mis-trend.js)
};
/* T3-P2-CRM: the policy slice of CB_SETTINGS_EP for crm.html's Shop window — the SAME entries (ep-aliases: one endpoint, one name), never a second declaration */
var CB_POLICY_EP = { policyGet: CB_SETTINGS_EP.policyGet, policySet: CB_SETTINGS_EP.policySet };

/* ── the chit sheet's three calls (chit-sheet.js reads one chit, moves its step, says what a bill's goods are for) —
   MOVED from app.html's EP so the app and CB Accounts open the same sheet through the same endpoints ── */
var CB_SHEET_EP = {
  chit: { m: 'GET', p: '/api/chits/:id', ok: '✓' },
  status: { m: 'PUT', p: '/api/chits/:id/status', ok: '✓' },
  billUse: { m: 'PUT', p: '/api/chits/:id/use', ok: '✓' }, // a bill I received: resale · use · asset (lib/bill-use), until accepted
  /* ⭐ ONE ENDPOINT, ONE NAME (e2e/ep-aliases.cjs): a LINE's holder · state and what went out on it. MOVED here from
     cap-worklist.js (TO1c) so the Task list (app.html → cap-worklist.js) and Tasks & Orders (tasks.html → cap-tasks.js)
     register each route ONCE, under the name the worklist already had; neither page needs the other's capability loaded. */
  wlAssign: { m: 'POST', p: '/api/chits/:id/assign-lines', ok: 'y' }, // { edits: [{ line_id, assignee_actor_id|null, assignee_name, assignee_type, state }] } (lib/assign)
  wlDeliver: { m: 'POST', p: '/api/chits/:id/deliver-lines', ok: 'y' }, // { rows: [{ line_id, quantity, unit }] } (lib/deliverline — events, never a stored total)
  /* the open chits behind Home's In · Out · Stuck, with the rail's why — MOVED here from cap-crm.js (TO1b) so CRM (cap-crm-chits.js) and
     Tasks & Orders (cap-tasks.js: the Stuck mark on an order) register it ONCE; not a /api/crm route */
  railChits: { m: 'GET', p: '/api/facts/rail/chits', ok: 'y' }
};
/* ⭐ T3-DISPUTES-ASSIST: the dispute routes and CB Assist's — MOVED here from app.html's EP (aiDraft from cap-readiness.js) so the workshop and
   CB Tasks & Orders (tasks.html: cap-dispute.js CBDispute · cap-assist.js CBAssistReview) register each route ONCE, under the name it had
   (e2e/ep-aliases.cjs; core.js OUTBOX_KEYS keeps resolveDispute by name). The queue pages and answers may/why (api T3); the chit's disputes
   answer actions.raise · raise_parties and each dispute's actions.resolve. */
var CB_DISPUTE_EP = {
  dispute: { m: 'POST', p: '/api/chits/:id/disputes', ok: '✓' }, // raise { category, reason, participant_entity_ids? }
  disputes: { m: 'GET', p: '/api/chits/:id/disputes', ok: '✓' }, // the chit's disputes + roster · actions.raise · raise_parties
  disputeQueue: { m: 'GET', p: '/api/chits/disputes/queue', ok: '✓' }, // ?status=&side=&q=&sort=&page=&limit= → rows · total · counts (no page = all open, as before)
  resolveDispute: { m: 'PUT', p: '/api/chits/:id/disputes/:disputeId/resolve', ok: '✓' } // { resolution_note, target_entity_id? }
};
var CB_ASSIST_EP = {
  assistQuestions: { m: 'GET', p: '/api/assist/questions', ok: 'y' }, // DB-backed Q&A library, context-filtered (?context=screen). Single source; feeds the AI too.
  assistPublish: { m: 'POST', p: '/api/assist/publish', ok: 'y' }, // help desk publishes a Q&A to its catalogue (serves live)
  assistWhoami: { m: 'GET', p: '/api/assist/whoami', ok: 'y' }, // is_helpdesk · actions.publish (may/why)
  aiDraft: { m: 'POST', p: '/api/governance/ai-draft', ok: 'y' } // { skill_id, context } → { draft } — CB Assist proposes, a person confirms
};

/* ── the chit-sheet helpers both pages share (MOVED from app.html, not copied) ── */
/** is this entity me? by id when the session knows it, else by the shop's name */
function chitIsSelf(e, n) {
  return (SESSION.entityId && e === SESSION.entityId) || (SESSION.entity && String(n || '') === String(SESSION.entity));
}
/**
 * ⭐ WHAT THE GOODS ARE FOR — one tap before Accept (Athi, 2026-10-01). Nothing tapped: the shop's own catalogue decides
 * line by line (resale if it sells the product, else for the shop). Shown only when every chosen row is a bill received.
 * `pick` names the global the chips call with the chosen use (app.html's pickBillUse; the chit sheet's CBSheet.use).
 */
var BILL_USES = [
  ['resale', 'For resale'],
  ['use', 'For the shop'],
  ['asset', 'An asset']
];
function billUseChoiceHTML(rows, pick) {
  var bills =
    rows.length > 0 &&
    rows.every(function (item) {
      return item && item.billRx;
    });
  if (!bills) return '';
  return (
    '<div data-testid="bill-use-choice" style="margin-top:10px"><div class="s">' +
    tx('What is it for?') +
    '</div>' +
    BILL_USES.map(function (item) {
      return (
        '<button type="button" class="optchip" data-testid="bill-use-' +
        item[0] +
        '" data-use="' +
        item[0] +
        '" onclick="' +
        (pick || 'pickBillUse') +
        '(this.dataset.use)" data-cbsid="SCR045-B01">' +
        tx(item[1]) +
        '</button>'
      );
    }).join(' ') +
    '<div class="s">' +
    tx('Not tapped: your catalogue decides') +
    '</div></div>'
  );
}
/** ⭐ ONE COUNTER, ONE NAME: the bill's series is the counter ("C2/26-27/0007" → C2), as the Day book says it. The popup and the Day book both read these two. */
function counterOfBill(no, till) {
  var m = /^([A-Za-z0-9]+)\//.exec(String(no || ''));
  return m ? m[1] : (till && (till.name || till.id)) || '';
}
function counterWord(c) {
  c = String(c == null ? '' : c).trim();
  return c ? (/^counter\b/i.test(c) ? c : tx('Counter') + ' ' + c) : '';
}
/** the one status a move sends: a bill's acceptance is `accepted` (the ledger posts the purchase on it), a task's Act stays in_progress */
function statusWordFor(to, row) {
  return { open: 'pending', act: row && row.billRx ? 'accepted' : 'in_progress', close: 'completed' }[to] || to;
}

/* ── the string door ── */
function cbLang() {
  try {
    return localStorage.getItem('cb_lang') || 'en';
  } catch (_) {
    return 'en';
  }
}

/**
 * The string catalogue, keyed by the English. Empty for now on purpose: wrapping the labels and TRANSLATING them
 * are two different jobs, and doing the first does not pretend to have done the second. A language with no
 * entries here renders English, which is honest — unlike a half-filled map, which renders a screen in two
 * languages at once and reads as a broken product rather than an untranslated one.
 */
var CBSTR = { en: {}, fr: {}, ta: {}, hi: {}, ar: {} };

/**
 * ⭐⭐ tx(english, context) — THE ENGLISH IS THE KEY. This is GNU gettext's model, adopted rather than invented.
 *
 * ⚠️ WHY NOT MORE NAMED KEYS LIKE t(). `t('nav.suppliers', 'Suppliers')` is right for the fourteen rail items,
 * because they are a closed set built in one place. It does not scale to the 449 labels this app actually has:
 * every one would need a key invented for it, every new label would need a naming decision, and the moment a
 * label's words change its key stops describing it — leaving names like `cat.hdr2` that nobody can match to
 * anything on screen. gettext solved this in 1995 by making the source string its own identifier.
 *
 * ⚠️ SO AN UNTRANSLATED LABEL IS ALWAYS CORRECT ENGLISH, never a key leaking onto the screen. That property is
 * why this is safe to apply broadly: wrapping a label can change nothing except when a translation exists.
 *
 * ⚠️ CONTEXT USES gettext's OWN SEPARATOR (\u0004, EOT). "Open" is a verb on a button and an adjective on a
 * status chip, and Tamil does not use one word for both; `tx('Open','status')` disambiguates them without
 * abandoning the English-as-key model. Same convention, so any gettext tooling reads our catalogue unchanged.
 *
 * The catalogue of every string reaching here is generated by e2e/strings-extract.cjs — that file, not this one,
 * is what a translator is handed.
 */
function tx(english, context) {
  var m = CBSTR[cbLang()];
  if (!m) return english;
  /* a stable key (tx(english, { key: 'CMP001.label' })): the pack's entry for the KEY wins, English stays the default and the fallback, so
     rewording English never breaks a translation. hasOwnProperty, because the pseudo-locale answers every name (it has no keys, only English). */
  if (context && typeof context === 'object') {
    var named = context.key && Object.prototype.hasOwnProperty.call(m, context.key) ? m[context.key] : '';
    if (named) return named;
    context = context.context;
  }
  if (context) {
    var c = m[context + '\u0004' + english];
    if (c) return c;
  }
  return m[english] || english;
}

/**
 * ⭐⭐ bidiWrap(v) — isolate a substituted VALUE from the sentence it lands in.
 *
 * ⚠️ THE BUG IT PREVENTS IS INVISIBLE IN ENGLISH AND WRONG IN ARABIC. Drop a Latin value into an Arabic sentence
 * and the Unicode bidi algorithm resolves the neutral characters around it — the comma, the dash, the question
 * mark — against the SENTENCE's direction rather than the value's:
 *
 *     txf('Remove {name} from your supplier list?', { name: 'Alpha Timers, Pvt' })
 *     in Arabic renders   Pvt ,Alpha Timers   — the comma has jumped to the wrong side of the name.
 *
 * ⭐ THE FIX IS TWO INVISIBLE CHARACTERS, NOT A RULE PER STRING. U+2068 FIRST STRONG ISOLATE opens a run whose
 * direction is decided by its own first strong character; U+2069 POP DIRECTIONAL ISOLATE closes it. This is
 * exactly what ICU MessageFormat does around its arguments — adopted rather than reinvented — and it means no
 * translator and no caller ever has to know the hazard exists.
 *
 * ⚠️ ONLY WHEN THE PAGE IS RTL. In a left-to-right page these characters change nothing a reader can see, but
 * they would still land inside every interpolated string — including any that reaches an HTML attribute or a
 * string comparison. Costing nothing to look at is not the same as being free, so they are added only where they
 * do work.
 */
function bidiWrap(v) {
  try {
    if (document.documentElement.getAttribute('dir') !== 'rtl') return String(v);
  } catch (_) {
    return String(v);
  }
  return '⁨' + String(v) + '⁩';
}

function txf(english, vars, context) {
  var out = tx(english, context);
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, function (whole, k) {
    return Object.prototype.hasOwnProperty.call(vars, k) ? bidiWrap(vars[k]) : whole;
  });
}

/** an id that is a machine's, not a person's ("pay:0d102689-…" or a uuid) is never shown (C7, R109, R123); MOVED here from cap-crm-record.js so every screen asks the one test */
function cbIsRawId(text) {
  var word = String(text || '');
  return /^[a-z_]+:[0-9a-f-]{16,}$/i.test(word) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(word);
}

/**
 * ⭐⭐ txn(one, other, n, vars) — a sentence whose wording depends on a COUNT.
 *
 * ⚠️ ENGLISH HAS TWO PLURAL FORMS AND THAT IS NOT UNIVERSAL. Arabic has SIX (zero, one, two, few, many,
 * other), Russian has three, Tamil and Chinese have one. So "1 product / 2 products" is an English fact rather
 * than a general one, and `n === 1 ? 'product' : 'products'` hard-codes English grammar into every screen that
 * counts anything.
 *
 * `Intl.PluralRules` knows the real answer per language, and the catalogue keys off the CATEGORY it returns —
 * which is why the stored key is `msgid\u0005category`, gettext's own plural convention. Until a translation
 * exists this falls back to the two English forms, which is exactly today's behaviour and no worse.
 *
 * ⚠️ `{count}` IS SUPPLIED AUTOMATICALLY, and formatted through the localisation layer — because a count is a
 * number, and a number is written differently in different places. Writing `n` into the string directly would
 * give an Arabic reader Western digits inside an Arabic sentence.
 */
function txn(one, other, n, vars) {
  var count = Number(n) || 0;
  var cat = 'other';
  try {
    cat = new Intl.PluralRules(CBLocale.locale()).select(count);
  } catch (_) {
    cat = count === 1 ? 'one' : 'other';
  }
  var m = CBSTR[cbLang()] || {};
  /* the exact category, then the catch-all, then English — never a key on screen */
  var text = m[one + '\u0005' + cat] || m[one + '\u0005other'] || (count === 1 ? one : other);
  var all = { count: CBLocale.number(count) };
  for (var k in vars || {}) if (Object.prototype.hasOwnProperty.call(vars, k)) all[k] = vars[k];
  return text.replace(/\{(\w+)\}/g, function (whole, key) {
    return Object.prototype.hasOwnProperty.call(all, key) ? bidiWrap(all[key]) : whole;
  });
}

/* ── a failure's words, and the toast ── */

function friendlyErr(e) {
  const m = (e && e.message) || String(e || '');
  if (/Already working/i.test(m)) return 'still finishing the last one — one moment';
  if (/session expired|sign in/i.test(m)) return 'your session expired — please sign in again';
  if (/Failed to fetch|network/i.test(m)) return 'network hiccup — check your connection and retry';
  return m || 'something went wrong';
}

/** the look of a host the page did not draw itself; a page with a bottom dock sets --cb-toast-bottom to clear it (shop.html) (same tokens and sizes as the pages that carry their own #toast rules) */
const TOAST_HOST_CSS =
  '#toast{position:fixed;left:50%;bottom:var(--cb-toast-bottom,20px);transform:translateX(-50%);z-index:60;max-width:min(520px,92vw)}' +
  '#toast .toast{background:var(--ink,#2a2418);color:var(--ground,#fbf6ec);padding:12px 16px;border-radius:10px;font-size:14px}' +
  '#toast .toast.err{background:var(--red-i,#8e3517)}#toast .toast.warn{background:var(--amber-i,#7a5205)}' +
  '#toast button{margin-left:10px;border:1px solid currentColor;background:transparent;color:inherit;border-radius:8px;padding:2px 10px}';
/**
 * The toast's host: the page's own <div id="toast"> or, when the page has none (shop, know-your-business, authority-forms),
 * one made here at the end of the body, so a failed save is never silent. It is a polite live region (role=status) so a screen
 * reader announces every message; an error is stated as role=alert, aria-live=assertive.
 */
function toastHost(isError) {
  let node = document.getElementById('toast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'toast';
    const hostStyle = document.createElement('style');
    hostStyle.textContent = TOAST_HOST_CSS;
    document.body.appendChild(hostStyle);
    document.body.appendChild(node);
  }
  node.setAttribute('role', isError ? 'alert' : 'status');
  node.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  node.setAttribute('aria-atomic', 'true');
  return node;
}
function toast(msg, undo) {
  const _lvl = toastLevel(msg);
  if (typeof cblog === 'function') cblog(_lvl, msg);
  const node = toastHost(_lvl === 'error');
  node.innerHTML = `<div class="toast ${_lvl === 'error' ? 'err' : _lvl === 'warn' ? 'warn' : ''}">${esc(msg)}${undo ? '<button id="undoBtn" data-cbsid="SCR045-B02">' + tx('Undo') + '</button>' : ''}</div>`;
  if (undo) {
    document.getElementById('undoBtn').onclick = () => {
      undo();
      node.innerHTML = '';
    };
  }
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (node.innerHTML = ''), 4500);
}
function toastLevel(m) {
  const s = String(m);
  if (/couldn't|failed|server error|session expired|not allowed|something went wrong|⚠|🚫/i.test(s)) return 'error';
  if (/already|only |capped|required|first\.|coming soon|⏳|not yet|pick a|type a/i.test(s)) return 'warn';
  return 'info';
}

/**
 * ⭐ THE LEDGER'S SWITCH (Athi, 2026-10-01: "add the switch-on control in settings"; "bring the subscribe button there
 * itself" — CB Accounts). ONE definition of what the owner is asked, what is sent, and what happens after; the three
 * places that offer the switch differ only in the box they paint and the dialog they own, so each hands those in:
 *   io.ask(title, bodyHtml, okLabel, onOk, danger)   the page's own confirm (app: confirmAsk; the others: a <dialog>)
 *   io.working()                                      paint "Working…" where the switch was
 *   io.call(on)                                       the transport: POST /api/books/enable, or /setting {enabled:false}
 *   io.done(on) / io.failed(e)                        what the page does next
 * The server refuses anyone but the owner; the pages only offer the button to the owner.
 */
var CBLedger = (function () {
  function words(on) {
    return {
      title: on ? tx('Switch the Ledger on?') : tx('Switch the Ledger off?'),
      body: esc(
        on
          ? tx('From today every bill, payment and expense is recorded. Nothing before today is.')
          : tx('Nothing is deleted. Recording stops until it is switched on again.')
      ),
      ok: on ? tx('Switch on') : tx('Switch off')
    };
  }
  /** the one call, over the host's api() ({ api: api }): on → POST enable · off → POST setting { enabled:false } */
  function ledgerCall(host, on) {
    return on ? host.api('booksEnable', { body: {} }) : host.api('booksSetting', { body: { enabled: false } });
  }
  function run(on, io) {
    var w = words(on),
      busy = false;
    io.ask(
      w.title,
      w.body,
      w.ok,
      async function () {
        if (busy) return;
        busy = true; /* one tap, one call — a second confirm while the first is out is dropped */
        try {
          io.working();
          await io.call(on);
          await io.done(on);
        } catch (err) {
          io.failed(err);
        } finally {
          busy = false;
        }
      },
      !on
    );
  }
  return {
    words: words,
    call: ledgerCall,
    run: run
  }; /* a distinct inner name: e2e/screen-reads matches functions by NAME, and a bare call() matched "call(s)" in another screen's text */
})();

/**
 * ⭐⭐ CBAction — THE ACTION-STATE HELPER (M64, 2026-10-07). Every control that WRITES goes through this, so that three
 * promises hold everywhere instead of wherever somebody remembered them:
 *   1  ONE PRESS, ONE WRITE. While the action is out (or its confirm is open) the button is disabled + aria-busy, and a
 *      second press of the same action — the same `key`, even on a button a repaint replaced — is dropped.
 *   2  AN IRREVERSIBLE WRITE ASKS FIRST, in the page's own dialog (confirmAsk in the app; CBConfirm on CB Accounts / CRM /
 *      the index tile). Cancel, Escape or the backdrop sends nothing. Never the browser's confirm(): it blocks automation.
 *   3  THE OUTCOME IS SAID WHERE THE ACTION HAPPENED — `out` (an element or its id beside the control) or the toast.
 *      No silent success, no silent failure. A JavaScript error's text never reaches the person: only a server's own
 *      reason for refusing (a 4xx with words) is shown; everything else gets the caller's `failed` sentence.
 *
 *   CBAction.run(button, fn, {
 *     key,                       // the action's identity; default the button's data-testid or id
 *     confirm: { title, body, yes, danger },   // irreversible → ask first (body is HTML; escape what you put in it)
 *     busy,                      // optional words on the button while it works ("Recording…")
 *     out,                       // where to say the outcome (element or id); default the toast
 *     done,                      // the success sentence (when there is no outcome painter)
 *     outcome(value),            // paints the result where it happened — flip the ROW, never the screen
 *     failed,                    // the failure sentence when the server gave no reason
 *     onFail(words, err)         // the caller shows the failure itself (e.g. into the form)
 *   }) → Promise<{ ok, value, cancelled, skipped, error }>   — never throws
 *
 *   CBAction.once(key, button, fn) — the busy half alone, for a write whose caller already says its outcome
 *   (bkOnce in cap-books.js IS this, widened from there — one guard, not two).
 *   CBAction.words(err, fallback) — what a failure says to a person.
 *
 * The button carries data-action-state = busy · done · failed · idle, so a test (and a stylesheet) can read it.
 * Every writing control and whether it uses this: docs/ACTION-STATE-SWEEP.md (node scripts/action-state-sweep.cjs).
 */
var CBAction = (function () {
  var RUNNING = {};
  function actKey(btn, o) {
    return (o && o.key) || (btn && (btn.getAttribute('data-testid') || btn.id)) || null;
  }
  function actMark(btn, st) {
    if (!btn || !btn.setAttribute) return;
    btn.setAttribute('data-action-state', st);
    if (st === 'busy') {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      return;
    }
    btn.removeAttribute('aria-busy');
    if (btn.isConnected) btn.disabled = false;
  }
  function actTake(key, btn) {
    if (key && RUNNING[key]) return false;
    if (btn && btn.getAttribute && btn.getAttribute('aria-busy') === 'true') return false;
    if (key) RUNNING[key] = true;
    actMark(btn, 'busy');
    return true;
  }
  function actFree(key, btn, st) {
    if (key) delete RUNNING[key];
    actMark(btn, st);
  }
  /** the page's own dialog → true (yes) / false (cancel). No dialog on the page = no irreversible write (never confirm()). */
  function actAsk(c) {
    return new Promise(function (res) {
      var f = typeof confirmAsk === 'function' ? confirmAsk : typeof CBConfirm === 'function' ? CBConfirm : null;
      if (!f) {
        if (typeof cblog === 'function') cblog('error', 'CBAction: no confirm dialog on this page — nothing sent');
        res(false);
        return;
      }
      f(
        c.title,
        c.body || '',
        c.yes || tx('Confirm'),
        function () {
          res(true);
        },
        c.danger !== false,
        function () {
          res(false);
        }
      );
    });
  }
  /** what a failure SAYS. A server's own refusal (4xx with words) is meant for people; a thrown error's text is not. */
  function actWords(e, fallback) {
    var m = String((e && e.message) || '');
    if (/Already working/i.test(m)) return tx('Still finishing the last one — one moment');
    if (/session expired|sign in again/i.test(m)) return tx('Your session expired — please sign in again');
    if (typeof isKeptKeyWords === 'function' && isKeptKeyWords(m)) return m; /* core.js: a 5xx or a 90 s abort on a kept key says check first; never "nothing was sent" */
    if (/offline|Failed to fetch|network|No answer from the server/i.test(m)) return tx('No connection — nothing was sent. Try again');
    var st = e && e.status;
    if (st >= 400 && st < 500 && st !== 404 && m && !/^API \d/.test(m)) return m;
    return fallback || tx('That did not go through — try again');
  }
  function actSay(o, msg, lvl) {
    var el = o.out && (typeof o.out === 'string' ? document.getElementById(o.out) : o.out);
    if (el) {
      el.textContent = msg;
      el.setAttribute('data-tone', lvl || 'ok');
      if (typeof cblog === 'function') cblog(lvl === 'error' ? 'error' : 'info', msg);
      return;
    }
    if (typeof toast === 'function') toast(msg);
  }
  async function actOnce(key, btn, fn) {
    var k = key || actKey(btn);
    if (!actTake(k, btn)) return;
    var st = 'failed';
    try {
      var v = await fn();
      st = 'done';
      return v;
    } finally {
      actFree(k, btn, st);
    }
  }
  async function actRun(btn, fn, o) {
    o = o || {};
    var k = actKey(btn, o),
      res = { ok: false };
    if (!actTake(k, btn)) {
      res.skipped = true;
      return res;
    }
    var label = null;
    try {
      if (o.confirm && !(await actAsk(o.confirm))) {
        res.cancelled = true;
        return res;
      }
      if (o.busy && btn && btn.isConnected) {
        label = btn.innerHTML;
        btn.textContent = o.busy;
      }
      var v = await fn();
      res.ok = true;
      res.value = v;
      if (v && v.queued) actSay(o, tx('Saved offline — it is sent when the connection is back'), 'warn');
      else if (typeof o.outcome === 'function') {
        /* the write HAS landed: a painter that throws must not turn it into a reported failure */
        try {
          o.outcome(v);
        } catch (pe) {
          if (typeof cblog === 'function') cblog('error', 'action ' + (k || '?') + ' outcome painter: ' + ((pe && pe.message) || pe));
          actSay(o, o.done || tx('Done'), 'ok');
        }
      } else actSay(o, o.done || tx('Done'), 'ok');
    } catch (e) {
      res.error = e;
      if (typeof cblog === 'function') cblog('error', 'action ' + (k || '?') + ' failed: ' + ((e && e.message) || e));
      var w = actWords(e, o.failed);
      if (typeof o.onFail === 'function') o.onFail(w, e);
      else actSay(o, w, 'error');
    } finally {
      if (label != null && btn && btn.isConnected) btn.innerHTML = label;
      actFree(k, btn, res.ok ? 'done' : res.error ? 'failed' : 'idle');
    }
    return res;
  }
  return { run: actRun, once: actOnce, words: actWords, ask: actAsk };
})();

/**
 * ⭐ SET-WALK1 · W24 (2026-10-15) — NEVER LOSE IN-PROGRESS WORK: leaving a screen with unsaved edits asks "Save or discard?" — ONE helper
 * for every form of every small app (the legal-name edit vanished when the tab moved to Account; DISCIPLINES §3 "never lose in-progress work").
 *   CBUnsaved.form({ dirty: fn → bool, save: fn → Promise })   a screen registers how it knows it moved and how it saves (a screen that keeps a
 *                                                           model: its own test; a plain form: CBUnsaved.domDirty(host) — any input whose value
 *                                                           left its defaultValue). mount() of the next screen calls CBUnsaved.reset().
 *   CBUnsaved.leave(go)                                     the page's router calls it BEFORE painting the next screen: nothing moved → go();
 *                                                           moved → CBConfirm "Unsaved changes" · Save → save() then go() · Discard → go()
 *                                                           (✕ / Escape = Discard, as the standard modal's Cancel). With no save fn: Discard · Stay.
 * Also the browser's own leave (beforeunload) while something moved — the browser's sentence, since ours cannot be shown there.
 */
var CBUnsaved = (function () {
  var pending = { forms: [] };
  var IGNORED_TYPES = ['hidden', 'button', 'submit'];
  function reset() {
    pending.forms = [];
  }
  function form(registration) {
    if (registration && typeof registration.dirty === 'function') pending.forms.push(registration);
    return registration;
  }
  /** has this one input, select or textarea moved from what the screen painted? */
  function inputMoved(input) {
    if (input.disabled || IGNORED_TYPES.indexOf(input.type) >= 0 || input.hasAttribute('data-unsaved-ignore')) return false;
    if (input.tagName === 'SELECT') {
      var chosen = input.options[input.selectedIndex];
      return !!(chosen && !chosen.defaultSelected && input.querySelector('option[selected]'));
    }
    if (input.type === 'checkbox' || input.type === 'radio') return input.checked !== input.defaultChecked;
    return input.value !== input.defaultValue;
  }
  /** any input, select or textarea under host whose value left what the screen painted (a repaint after Save paints the saved values) */
  function domDirty(host) {
    var container = typeof host === 'string' ? document.getElementById(host) : host;
    return !!container && Array.prototype.some.call(container.querySelectorAll('input,textarea,select'), inputMoved);
  }
  /** does this registered form say it moved? a dirty test that throws counts as "did not move" and is logged, never silent */
  function formMoved(registration) {
    try {
      return !!registration.dirty();
    } catch (err) {
      if (typeof cblog === 'function') cblog('error', 'unsaved: a dirty test threw: ' + ((err && err.message) || err));
      return false;
    }
  }
  function dirtyForms() {
    return pending.forms.filter(formMoved);
  }
  function isDirty() {
    return dirtyForms().length > 0;
  }
  /** Save or discard: Save runs every form's save() then goes on; the dialog's Cancel button is relabelled Discard */
  function askSaveOrDiscard(savers, body, goOn, stay) {
    CBConfirm(
      tx('Unsaved changes'),
      body,
      tx('Save'),
      function () {
        Promise.all(
          savers.map(function (registration) {
            return Promise.resolve().then(registration.save);
          })
        ).then(
          function () {
            reset();
            goOn();
          },
          function (err) {
            if (typeof toast === 'function') toast(CBAction.words(err, tx('Could not save')));
            if (stay) stay();
          }
        );
      },
      false,
      function () {
        reset();
        goOn();
      }
    );
    var cancel = document.querySelector('#cb_confirm [data-testid="confirm-cancel"]');
    if (cancel) {
      cancel.textContent = tx('Discard');
      cancel.setAttribute('data-testid', 'confirm-discard');
    }
  }
  /** nothing can save it: Discard or Stay (the dialog's Cancel button reads Stay) */
  function askDiscardOrStay(body, goOn, stay) {
    CBConfirm(
      tx('Unsaved changes'),
      body,
      tx('Discard'),
      function () {
        reset();
        goOn();
      },
      true,
      function () {
        if (stay) stay();
      }
    );
    var stayButton = document.querySelector('#cb_confirm [data-testid="confirm-cancel"]');
    if (stayButton) stayButton.textContent = tx('Stay');
  }
  /** nothing moved → goOn(); something moved → ask (Save or Discard when a form can save, Discard or Stay when none can) */
  function leave(goOn, stay) {
    var moved = dirtyForms();
    if (!moved.length) return goOn();
    var savers = moved.filter(function (registration) {
      return typeof registration.save === 'function';
    });
    var body = esc(tx(savers.length ? 'Save or discard what you typed?' : 'What you typed here is not saved. Discard it?'));
    if (savers.length) askSaveOrDiscard(savers, body, goOn, stay);
    else askDiscardOrStay(body, goOn, stay);
  }
  if (typeof window !== 'undefined')
    window.addEventListener('beforeunload', function (event) {
      if (isDirty()) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  return { form: form, reset: reset, leave: leave, isDirty: isDirty, domDirty: domDirty };
})();

/** how long a tap on the backdrop is ignored after the question opens (milliseconds) */
var CONFIRM_BACKDROP_GRACE_MS = 600;
/**
 * ⭐ THE CONFIRM FOR A PAGE THAT IS NOT THE APP — one native <dialog>, used by accounts.html (it is that page's confirmAsk)
 * and by the index tile's Switch on. Same signature as the app's confirmAsk(title, bodyHtml, okLabel, onOk, danger, onCancel);
 * bodyHtml is raw HTML (escape dynamic parts in the caller). The app keeps its own modal host — confirmAsk there is bound to
 * the app's modal system — so this is the page-level twin, not a second copy of the app's.
 * Cancel, Escape and a click on the backdrop all dismiss, and all call onCancel; a backdrop tap in the first
 * CONFIRM_BACKDROP_GRACE_MS is ignored, so the second tap of a double tap on Record does not close the question (UX-115).
 */
function CBConfirm(title, bodyHtml, okLabel, onOk, danger, onCancel) {
  var old = document.getElementById('cb_confirm');
  if (old) old.remove();
  var node = document.createElement('dialog');
  node.id = 'cb_confirm';
  node.setAttribute('data-testid', 'confirm');
  node.style.cssText =
    'border:1px solid var(--line,#DDD6C6);border-radius:14px;padding:0;max-width:min(420px,92vw);width:100%;background:var(--card,#fff);color:var(--ink,#1D1B16);font:15px/1.45 "IBM Plex Sans",system-ui,sans-serif';
  node.innerHTML =
    '<form method="dialog" style="margin:0;padding:20px 20px 16px;display:flex;flex-direction:column;gap:12px">' +
    '<div style="font-weight:700;font-size:18px">' +
    esc(title) +
    '</div>' +
    '<div style="color:var(--muted,#5E594D)">' +
    bodyHtml +
    '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">' +
    '<button data-cbsid="CMP003" type="button" data-testid="confirm-cancel" style="min-height:44px;padding:0 16px;border:1px solid var(--line,#DDD6C6);border-radius:9px;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer">' +
    esc(tx('Cancel')) +
    '</button>' +
    '<button type="button" data-testid="confirm-ok" data-cbsid="SCR045-B03" style="min-height:44px;padding:0 18px;border:1px solid ' +
    (danger ? 'var(--red-i,#8E3517)' : 'var(--green,#16693F)') +
    ';border-radius:9px;background:' +
    (danger ? 'var(--red-i,#8E3517)' : 'var(--green,#16693F)') +
    ';color:#fff;font:inherit;font-weight:700;cursor:pointer">' +
    esc(okLabel || tx('Confirm')) +
    '</button>' +
    '</div></form>';
  document.body.appendChild(node);
  var done = false;
  var close = function (yes) {
    if (done) return;
    done = true;
    try {
      node.close();
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
    node.remove();
    if (yes) onOk();
    else if (onCancel) onCancel();
  };
  node.querySelector('[data-testid="confirm-ok"]').onclick = function () {
    close(true);
  };
  node.querySelector('[data-testid="confirm-cancel"]').onclick = function () {
    close(false);
  };
  node.addEventListener('cancel', function (event) {
    event.preventDefault();
    close(false);
  });
  /* a backdrop tap in the first moments is the second tap of a double tap on the button that opened this question: it is not an answer (UX-115) */
  var openedAt = Date.now();
  node.addEventListener('click', function (ev) {
    if (ev.target === node && Date.now() - openedAt >= CONFIRM_BACKDROP_GRACE_MS) close(false);
  });
  node.setAttribute('data-pop', 'POP121'); node.showModal();
  openedAt = Date.now();
}
