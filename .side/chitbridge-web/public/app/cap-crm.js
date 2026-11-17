/* cap-crm.js — CB CRM: the parties list (home), follow-ups, Add party, and the plumbing every CRM screen shares.
 * OWNS  the Parties list and its Dues cell, follow-ups, Add party, the router and the helpers every CRM screen shares
 * CALLED BY  crm.html only; cap-crm-record.js reads its helpers
 * Loaded by crm.html only (after cap-books.js, list-ctl.js, chit-sheet.js). The record, its timeline and the Log sheet are
 * cap-crm-record.js. docs/design/crm/PLAN.md (Phases 3-4) · REQUIREMENT-home.md · REQUIREMENT-followups.md · the designer handoff,
 * where the FROZEN list standard (docs/design/list-standard, SYSTEM.md §3a) wins: every list here is a CBList mount.
 *
 * ⭐ REUSE (CLAUDE.md rule 1, named in the PR): CBList.mount for every list · partyDueChipHTML + bkMoney/bkDate (cap-books.js) for
 * the dues chip and every amount · openChitSheet (chit-sheet.js) for a chit/bill/message · api() with the EP rows (core.js) · tx/txf ·
 * custAdd / supAdd / entitySearch — the app's own add-a-party endpoints (Add party is ONE field over them, F1).
 * ⭐ ONE CALCULATION (rule 2): this file computes NO money, no "late", no segment, no on-ChitBridge. The dues a row shows are the
 * server's stored `balance_minor`, painted by the chip; "late" is `next_followup_late` / `dues_overdue` / `late` from the server.
 * ⭐ NEW PATHS (rule 4): CRM_EP (the /api/crm/* rows — no reader existed), the row → UI.custs/UI.sups mapping (cap-books.js's editor reads
 * those two lists; the CRM list is the one source and is mapped, not fetched twice), the Add-party and Follow-up sheets (no sheet of
 * either exists; each is one field over the existing endpoints).
 * ⚠️ Never the banned word for the books. A failure says what happened and offers Try again, never error.message.
 * ⭐ THE SERVER SAYS MAY/WHY (W2-CRM, CRM-MAY): GET /parties · /parties/:id · /followups · /calls carry `may { write, remove }` (api lib/access.mayWrite ·
 *   lib/owner.may). crmEdit() / crmMayRemove() read THAT; the token's hat is only the guess before the first answer lands. A refused action is greyed
 *   WITH a sentence this page words from the server's CODE (design rule 1: never the server's message) — crmViewWhy().
 * ⭐ THE SHOP'S DAY (CRM-DAY): a snooze sends a WORD ({ after: 'tomorrow' | 'week' }), the add sheet sends a bare date, and its presets count from the
 *   server's `shop_day` — nothing here turns the phone's clock into a due time.
 * ⭐ THE ONE PAGER (CRM-PAGE): follow-ups are read page by page (CBList.every over ?page=&limit=) until the server's total — never a silent cut.
 *
 * owns: the Parties list (#/parties) · the Follow-ups list (#/followups) · the Add party and Add follow-up sheets · CRM (the page's state) · the router.
 * called by: crm.html (crmRoute) · every cap-crm-*.js (CRM · crmEdit · crmViewWhy · crmGo · crmBar · crmNav · crmErrWords · crmWhen).
 * FLOW  crm.html → crmRoute() → crmHome() → crmLoad() [GET /parties → may] → crmFuJoin() [GET /followups → shop_day] → crmIndex() → CBList paints
 *       #/followups → crmFollowups() → crmFuLoad() [CBList.every GET /followups?page=] → Snooze → crmFuAct({ after }) · Add → crmFuSave({ due_at: date })
 * // CARD 11-crm-and-marketing/cap-crm
 */
'use strict';

/* ── the CRM API (chitbridge-api PR #15). The party routes it also calls (custAdd · supAdd · custGroup · supPatch · supDel · entitySearch
   · crmParties · booksTerms — shared with CB Finance) are CB_PARTY_EP in accounts-shell.js ── */
var CRM_EP = {
  crmParty: { m: 'GET', p: '/api/crm/parties/:id', ok: 'y' }, // the list row + contacts · prefs · followups · timeline_head …
  crmTimeline: { m: 'GET', p: '/api/crm/parties/:id/timeline', ok: 'y' }, // ?kind=&q=&before= — server-paged, 50 a page
  crmLog: { m: 'POST', p: '/api/crm/parties/:id/interactions', ok: 'y' }, // 503 "not migrated yet" before b276
  crmFollowups: { m: 'GET', p: '/api/crm/followups', ok: 'y' }, // ?scope=mine|all&done=0|1
  /* crmFollowAdd → CB_PARTY_EP (app/accounts-shell.js, T3-P1-MONEY): CB Finance › Cheques files a follow-up through the same row */
  crmFollowSet: { m: 'PATCH', p: '/api/crm/followups/:id', ok: 'y' }, // { done:true } · { due_at } · { assignee_user_id }
  crmFollowDel: { m: 'DELETE', p: '/api/crm/followups/:id', ok: 'y' },
  crmWalkIn: { m: 'POST', p: '/api/crm/walk-ins/add', ok: 'y' }, // { phone, name? } → 201 { party, points_claimed }: a phone that holds points becomes a local customer
  /* railChits (GET /api/facts/rail/chits, cap-crm-chits.js) lives in CB_SHEET_EP (accounts-shell.js) since TO1b: one name, registered once, for CRM and Tasks & Orders */
  crmLeadAdd: { m: 'POST', p: '/api/crm/leads', ok: 'y' }, // { name, phone?, stage? } → 201 { party } · 503 LEADS_NOT_MIGRATED before b297 (L1)
  crmStage: { m: 'POST', p: '/api/crm/parties/:id/stage', ok: 'y' }, // { stage } → { ok, lead } — "Move to…": a new memberships row, history kept (L1)
  crmLeadImport: { m: 'POST', p: '/api/crm/leads/import', ok: 'y' }, // { rows[≤500], dry? } → 200 the plan (dry) · 201 { added, merged, skipped[], rows[] } · 400 TOO_MANY · 503 before b297 (L3)
  crmCalls: { m: 'GET', p: '/api/crm/calls', ok: 'y' }, // ?scope=mine|all → { calls, outcomes, may, late } — today's queue + the server's outcome buttons (L2)
  crmOutcome: { m: 'POST', p: '/api/crm/parties/:id/outcome', ok: 'y' },
  /* T3-P3-CONSENT: consent (b306) and the privacy-request register (b307) — cap-crm-privacy.js; 503 PRIVACY_NOT_MIGRATED before the migrations */
  crmPrefs: { m: 'GET', p: '/api/crm/parties/:id/contact-prefs', ok: 'y' }, // { history[], may[channel][purpose] { may, code, why }, law }
  crmPrefSet: { m: 'POST', p: '/api/crm/parties/:id/contact-prefs', ok: 'y' }, // { channel, purpose, allowed } → 201 { pref } (append-only; a withdrawal is a new row)
  crmPrivFacts: { m: 'GET', p: '/api/privacy/facts', ok: 'y' }, // no sign-in needed -> { notice, contact_line, processors[{ name, role, region|null, on }], due_days } - who holds the data, where
  crmPrivReqs: { m: 'GET', p: '/api/crm/privacy-requests', ok: 'y' }, // ?open=1&page=&limit= → { requests, total, page, limit, open, late, may_answer, why }
  crmPrivReqAdd: { m: 'POST', p: '/api/crm/privacy-requests', ok: 'y' }, // { who, kind, received_at?, party_id?, country? } → 201 { request } — due_at is the law's
  crmPrivReqAnswer: { m: 'POST', p: '/api/crm/privacy-requests/:id/answer', ok: 'y' }, // owner only: { outcome, answer } → { request } — answered once   // { outcome, after?|due_at? } → 201 { interaction, followup, stage, suggest } — one transaction (L2)
  crmRemove: { m: 'DELETE', p: '/api/crm/parties/:id', ok: 'y' }, // "Remove from my parties" - owner only, 409 HAS_DUES, hides the party and deletes nothing
  /* T3-P2-CRM: segments & groups (cap-crm-groups.js) — the one segment rule counted · named groups written as a set · a send through the one gate */
  crmSegments: { m: 'GET', p: '/api/crm/segments', ok: 'y' }, // { segments[], groups[], groups_migrated, consent_migrated, channel, purpose, customers, may }
  crmGroupSet: { m: 'POST', p: '/api/crm/groups', ok: 'y' }, // { name, add[], remove[] } → 201 { name, added, removed, count } · 409 GROUPS_NOT_MIGRATED before b205
  crmGroupDel: { m: 'DELETE', p: '/api/crm/groups/:name', ok: 'y' }, // owner only → { name, removed }
  crmSegSend: { m: 'POST', p: '/api/crm/segments/:key/send', ok: 'y' } // { text, dry? } → dry: who may (by code); real: the one sender per allowed member
};
var CRM = {
  gen: 0,
  loadGen: 0,
  rows: [],
  byKey: {},
  alerts: {},
  currency: null,
  state: 'loading',
  err: null,
  loaded: false,
  api: null,
  fu: [],
  fuState: 'loading',
  fuErr: null,
  fuScope: null,
  fuDone: false,
  coAssists: [],
  fuApi: null,
  may: null,
  shopDay: null
};
var CRM_PAGE = 300; /* one page of follow-ups or calls asked of the server (its own max wins) */

/* ── who is looking: the SERVER's may/why (CRM.may, from the first read) decides; the session's role is the guess until it lands ── */
function crmOwner() {
  return SESSION.role === 'entity';
}
/** the server's `may` rides every CRM read (GET /parties · /parties/:id · /followups · /calls): kept once, so every screen asks the same answer */
function crmMaySet(mayAnswer) {
  if (mayAnswer && typeof mayAnswer === 'object' && (mayAnswer.write || mayAnswer.remove)) CRM.may = mayAnswer;
}
/** the `may` an answer carries (a record, a list), or nothing — one reader, so a caller never spells `answer && answer.may` */
function crmMayOf(answer) {
  return answer && answer.may;
}
/** the sentence this page says for the server's refusal CODE (design rule 1: the server's message is never rendered) */
var CRM_MAY_WORD = { read_only: 'Your login can only view', comment_only: 'Your login can only comment', OWNER_ONLY: 'Only the owner can remove a party' };
function crmViewWhy() {
  var writeMay = CRM.may && CRM.may.write;
  return tx(CRM_MAY_WORD[writeMay && writeMay.code] || CRM_MAY_WORD.read_only);
}
/** may this login remove a party? the server's `may.remove` (owner only), with the page's words for its code; before the answer: the session's role */
function crmMayRemove() {
  var remove = CRM.may && CRM.may.remove;
  if (remove) return { ok: !!remove.ok, why: remove.ok ? '' : tx(CRM_MAY_WORD[remove.code] || CRM_MAY_WORD.OWNER_ONLY) };
  return { ok: crmOwner(), why: crmOwner() ? '' : tx(CRM_MAY_WORD.OWNER_ONLY) };
}
/** the co-assist's hat rides in their signed token (lib/access.js); the session record does not keep it, so it is read from the token's own payload */
function crmHat() {
  /* the b173 ladder word (access_level: viewer · commenter · editor) is what the server enforces — read FIRST; the old hat only when no level rides (FX-L2C) */
  /* the level rides in the signed token's own payload (lib/identity-auth issueToken: access_level; pre-b173 tokens: hat / actor_hat) */
  try {
    var b = String(SESSION.token || '')
      .split('.')[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    var parsed = JSON.parse(atob(b));
    return String(parsed.access_level || parsed.level || parsed.hat || parsed.actor_hat || '');
  } catch (_) {
    return '';
  }
}
function crmRole() {
  if (crmOwner()) return 'owner';
  if (CRM.may && CRM.may.write) return CRM.may.write.may ? 'editor' : 'viewer'; /* the server's word, once it has spoken */
  return /^(view_only|view|viewer|audit|mis|comment|commenter)$/i.test(crmHat()) ? 'viewer' : 'editor'; /* the guess before the first read */
}
function crmEdit() {
  return crmRole() !== 'viewer';
}
/** YYYY-MM-DD + n days → YYYY-MM-DD (whole days on a calendar; no zone, no clock — the day itself is the server's shop_day) */
function crmDayPlus(dayIso, days) {
  var date = new Date(dayIso + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
/** the shop's today: the server's shop_day (GET /followups · /calls); the phone's date only before any answer landed */
function crmShopDay() {
  return CRM.shopDay || crmLocalISO(new Date());
}

/* ── small things every screen uses ── */
function crmKey(p) {
  return p.party_no || p.party_id;
}
function crmDay0(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
/** Today · Yesterday · Tomorrow, else the date in the reader's locale (a label for a day, never a verdict: "late" is the server's word) */
function crmDayWord(iso) {
  var date = new Date(iso);
  if (isNaN(date)) return '';
  var n = Math.round((crmDay0(date) - crmDay0(new Date())) / 86400000);
  return n === 0 ? tx('Today') : n === -1 ? tx('Yesterday') : n === 1 ? tx('Tomorrow') : bkDate(iso);
}
function crmWhen(iso) {
  if (!iso) return '—';
  var w = crmDayWord(iso),
    date = new Date(iso),
    n = Math.round((crmDay0(date) - crmDay0(new Date())) / 86400000);
  /* a follow-up made from a DAY (the call desk's "Tomorrow", a date pick) lands at the shop's midnight: the day is the word, "12:00 am" is noise (WX-L2C) */
  var midnight = date.getHours() === 0 && date.getMinutes() === 0;
  return n >= -1 && n <= 1 && !midnight ? w + ' ' + bkTime(iso) : w;
}
function crmLocalISO(date) {
  var p = function (n) {
    return String(n).padStart(2, '0');
  };
  return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate());
}
function crmPlural(n, one, many) {
  return n + ' ' + (n === 1 ? tx(one) : tx(many));
}
/** the unbilled orders' sum as said: the figure; "hidden" when every one was hidden; the figure and "some hidden" when only some were (RAIL-146h) */
function crmUnbilledMoney(unbilled, currency) {
  if (unbilled.cost_hidden && unbilled.minor == null) return tx('hidden'); // the server's own shape for a cost-blind reader: { n, minor: null, currency, cost_hidden: true }
  if (unbilled.hidden && !unbilled.minor) return tx('hidden');
  return bkMoney(unbilled.minor, unbilled.currency || currency || CRM.currency) + (unbilled.hidden ? ' · ' + tx('some hidden') : '');
}
/** "2 orders not billed yet ₹840" - the ONE sentence for the server's { n, minor, currency } (the record's chip says the same words); '' when nothing is waiting. minor is null across two currencies: the count alone. */
function crmUnbilledSaid(unbilled, currency) {
  if (!unbilled || !unbilled.n) return '';
  return (
    crmPlural(unbilled.n, 'order not billed yet', 'orders not billed yet') +
    (unbilled.minor == null && !unbilled.hidden && !unbilled.cost_hidden ? '' : ' ' + crmUnbilledMoney(unbilled, currency))
  );
}

var CRM_ICON = {
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  msg: 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5',
  bill: 'M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4',
  pay: 'M3 7h18v10H3zM3 11h18M7 15h3',
  flag: 'M5 21V4M5 5h12l-2 4 2 4H5',
  pin: 'M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
  wa: 'M4 20l1.5-4A8 8 0 1 1 8 18.5zM9 9c0 3 3 6 6 6l1-2-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2z',
  note: 'M5 3h10l4 4v14H5zM8 11h8M8 15h6',
  mail: 'M3 6h18v12H3zM3 7l9 7 9-7',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',
  pencil: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
  link: 'M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1',
  house: 'M3 11l9-7 9 7M5 10v10h14V10',
  walk: 'M12 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM10 21l2-6-2-3 1-4 3 3 3 1M9 12l-3 2',
  chit: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6',
  warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  plus: 'M12 5v14M5 12h14',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'M5 12l5 5 9-10'
};
function crmIcon(k) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + (CRM_ICON[k] || CRM_ICON.note) + '"/></svg>';
}

/** ⭐ O6 / C9: the sign-in handles of people the shop keeps (phone@<shop>.cr · name=domain@<shop>.cr · …@<shop>.br) are INTERNAL. A handle that carries an e-mail (name=domain@x.cr) gives
 *  that e-mail back; one that carries a phone or a user id has none. A real address on a country domain (…@firm.co.cr) has a dot before .cr and is left alone. Applied where the row is MAPPED, so no screen can show a handle. */
function crmRealEmail(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (!/@[^@.\s]+\.(cr|br)$/i.test(s)) return s;
  var local = s.slice(0, s.lastIndexOf('@')),
    eq = local.indexOf('=');
  return eq > 0 && eq < local.length - 1 ? local.slice(0, eq) + '@' + local.slice(eq + 1) : '';
}

/* ── the chips: a status is an icon AND a word; the server's verdict (on_chitbridge · why_not · kind) decides, the page only words it ── */
function crmRailChip(p) {
  if (p.kind === 'walk-in')
    return '<span class="tag walk" title="' + esc(tx('Phone only — points at the counter')) + '">' + crmIcon('walk') + esc(tx('Walk-in')) + '</span>';
  if (p.on_chitbridge)
    return (
      '<span class="tag on" title="' + esc(tx('Bills and messages reach them in their app')) + '">' + crmIcon('link') + esc(tx('On the network')) + '</span>'
    );
  /* WX-L2C (2026-10-13, real stack): a MINTED party (the server's kind 'local' — every lead, every party added by name) carries a bridge_id too;
     it is Local, never a shopper account. The server's kind decides first; the bridge_id heuristic only for a party the server did not call local. */
  var shop = p.why_not === 'shopper' || (p.kind !== 'local' && !!p.bridge_id && p.why_not !== 'inactive' && p.why_not !== 'other_population');
  var w = p.why_not === 'inactive' ? tx('Account inactive') : p.why_not === 'other_population' ? tx('Test space') : shop ? tx('Shopper account') : tx('Local');
  return (
    '<span class="tag local" title="' +
    esc(shop ? tx('A shopper account on the network — they order from your shop. Bills are yours only') : tx('Not on the network — bills are yours only')) +
    '">' +
    crmIcon('house') +
    esc(w) +
    '</span>'
  );
}
var CRM_ROLE = { customer: 'Customer', supplier: 'Supplier' };
/** a LIVE lead (the server's lead.stage, not yet 'customer'): the stage chip is its one word — "Customer" / "New customer" / "Settled" beside it would say three things at once (WX-L2C) */
function crmIsLead(p) {
  return !!(p && p.lead && p.lead.stage && p.lead.stage !== 'customer');
}
function crmRoleChips(p) {
  return (p.roles || [])
    .filter(function (item) {
      return !(item === 'customer' && crmIsLead(p));
    })
    .map(function (item) {
      return '<span class="tag role">' + esc(tx(CRM_ROLE[item] || item)) + '</span>';
    })
    .join('');
}
var CRM_SEG = { new: 'New customer', regular: 'Regular', inactive: 'Inactive', high_value: 'High value' };
function crmSegChip(p) {
  return p.segment && !crmIsLead(p) ? '<span class="tag seg">' + esc(tx(CRM_SEG[p.segment] || p.segment)) + '</span>' : '';
}
/** CRM-2: the cell for a party owing nothing: a customer the server counts no bill for (customer.txn_count 0) who is not a supplier (a supplier's bills are not in that count) has nothing to settle, so "Nothing yet", else "Settled" */
function crmNothingDueCell(party, testAttr) {
  var never = party.customer && !party.supplier && Number(party.txn_count) === 0;
  return '<span class="due ' + (never ? 'sub' : 'settled') + '"' + testAttr + '>' + esc(tx(never ? 'Nothing yet' : 'Settled')) + '</span>';
}
/** ⭐ A DUE IS SAID THE WAY A SHOPKEEPER SAYS IT: "₹12,450 you'll get" (green) / "₹4,816 you'll give" (red) — a symbol AND a word AND a colour, never the colour alone.
 *  The figure is the server's stored balance (+ they owe you), painted by bkMoney; the sign only picks the word. */
function crmDueCell(p) {
  if (!CRM.ledger) return '<span class="sub">—</span>';
  if (p.balance_minor == null) return p.dues && p.dues.cost_hidden ? '<span class="sub" data-testid="party-due-hidden-' + esc(p.party_id) + '">' + esc(tx('hidden')) + '</span>' : '<span class="sub">—</span>';
  var b = Number(p.balance_minor || 0),
    late = p.dues_overdue
      ? ' <span class="late red" data-testid="party-due-late-' +
        esc(p.party_id) +
        '">· ' +
        esc(tx(p.oldest_due ? 'late since' : 'late')) +
        (p.oldest_due ? ' ' + esc(bkDate(p.oldest_due)) : '') +
        '</span>'
      : '';
  var tid = ' data-testid="party-due-' + esc(p.party_id) + '"',
    oldest = p.oldest_due ? ' · ' + tx('oldest due') + ' ' + bkDate(p.oldest_due) : '';
  if (!b) return crmNothingDueCell(p, tid);
  return b > 0
    ? '<span class="due get"' +
        tid +
        ' title="' +
        esc(tx('They owe you') + oldest) +
        '"><span aria-hidden="true">↓</span> ' +
        esc(bkMoney(b, CRM.currency)) +
        ' <span class="w">' +
        esc(tx("you'll get")) +
        '</span>' +
        late +
        '</span>'
    : '<span class="due give"' +
        tid +
        ' title="' +
        esc(tx('You owe them') + oldest) +
        '"><span aria-hidden="true">↑</span> ' +
        esc(bkMoney(Math.abs(b), CRM.currency)) +
        ' <span class="w">' +
        esc(tx("you'll give")) +
        '</span>' +
        late +
        '</span>';
}
/** CRM-32: the Dues column. An order that is unpaid but NOT BILLED YET is not "Settled" (walk W41): the server's per-party figure (`p.unbilled`, the Tasks Billed tag's own test) is said instead of Settled, or beside what is owed. */
function crmDueListCell(party) {
  var said = crmUnbilledSaid(party.unbilled, CRM.currency);
  if (!said) return crmDueCell(party);
  var tag = '<span class="tag amber" data-testid="crm-unbilled-' + esc(party.party_id) + '">' + esc(said) + '</span>';
  if (!CRM.ledger || party.balance_minor == null) return tag;
  if (!Number(party.balance_minor || 0)) return '<span class="due" data-testid="party-due-' + esc(party.party_id) + '">' + tag + '</span>';
  return crmDueCell(party) + ' ' + tag;
}
/** the next follow-up is ALWAYS on the row; an overdue one is red, says Late, and carries its date */
function crmFuCell(p) {
  if (!p.next_followup_at) return '<span class="sub">—</span>';
  if (p.next_followup_late)
    return (
      '<span class="late red" style="white-space:nowrap" data-testid="crm-fu-late"><span aria-hidden="true">⚠</span> ' +
      esc(tx('Late')) +
      ' · ' +
      esc(bkDate(p.next_followup_at)) +
      '</span>'
    ); /* one line, as the due form is (the one face wraps it otherwise) */
  return '<span style="white-space:nowrap">' + esc(crmWhen(p.next_followup_at)) + '</span>';
}
/** the party is ONE line: the name and its number — nothing stacked under it (role · connection · dues have their own columns) */
function crmPartyCell(p) {
  return (
    '<span class="pcell"><span class="l1">' +
    (p.unread ? '<span class="udot" title="' + esc(crmPlural(p.unread, 'unread message', 'unread messages')) + '"></span>' : '') +
    '<span class="nm" data-testid="crm-name">' +
    esc(p.display_name) +
    '</span>' +
    (p.party_no ? '<span class="pno" data-testid="crm-no">' + esc(p.party_no) + '</span>' : '') +
    '</span></span>'
  );
}
/** Role, in the shop's own words: Customer / Supplier / Both / Staff — one word per party (the Group control and the heading filter say the same words) */
function crmRoleKey(p) {
  var r = p.roles || [];
  if (p.kind === 'staff' || r.indexOf('staff') >= 0 || r.indexOf('employee') >= 0) return 'staff';
  return r.length > 1 ? 'both' : r[0] || 'customer';
}
var CRM_ROLE_WORD = { customer: 'Customer', supplier: 'Supplier', both: 'Both', staff: 'Staff' };
function crmRoleWord(p) {
  return tx(CRM_ROLE_WORD[crmRoleKey(p)]);
}
/** On ChitBridge: ✓ when bills, orders and messages reach them in their app, – when they do not (a word for a screen reader, the sentence on hover) */
function crmConnected(p) {
  return !!p.on_chitbridge && p.kind !== 'walk-in';
}
var CRM_CONN_TIP = 'On the network: bills, orders and messages reach them in their app';
function crmRailCell(p) {
  return crmConnected(p)
    ? '<span class="conn on" data-testid="crm-conn-on" title="' +
        esc(tx(CRM_CONN_TIP)) +
        '"><span aria-hidden="true">✓</span><span class="sr-only">' +
        esc(tx('On the network')) +
        '</span></span>'
    : '<span class="conn off" data-testid="crm-conn-off" title="' +
        esc(tx('Not connected: you keep their record, they do not see it in an app')) +
        '"><span aria-hidden="true">–</span><span class="sr-only">' +
        esc(tx('Not connected')) +
        '</span></span>';
}
/** the last activity: the date, and what it was (a customer's last order · a walk-in's points at the counter) */
function crmLastCell(p) {
  if (!p.last_at) return '<span class="sub">—</span>';
  var what = p.kind === 'walk-in' ? tx('at the counter') : (p.roles || []).indexOf('customer') >= 0 ? tx('order') : '';
  return '<span style="white-space:nowrap">' + esc(crmWhen(p.last_at)) + (what ? ' <span class="sub">· ' + esc(what) + '</span>' : '') + '</span>';
}
function crmTermsCell(p) {
  var t = p.terms || {},
    side = t.customer || t.supplier;
  if (!side) return '<span class="sub">—</span>';
  var days = side.credit_days != null ? txf('{n} days', { n: side.credit_days }) : '',
    lim = side.credit_limit_minor != null ? bkMoney(side.credit_limit_minor, CRM.currency) : '';
  return days || lim ? esc([days, lim].filter(Boolean).join(' · ')) : '<span class="sub">—</span>';
}

/* ═══ THE READ — one call, one row per party ═════════════════════════════════════════════════════════════════════ */
/* ═══ THE API'S REAL SHAPES → the row this page paints (chitbridge-api lib/crm.js assemble; contract: docs/contracts/web-api.json) ═══
   The design stand-in sent a FLAT row (balance_minor · segment · groups · last_at · why_not · next_followup_*); the API sends the nested one:
   dues { balance_minor, oldest_due, side } · customer { segment, groups, txn_count … } · supplier { … } · last_activity · may_trade { ok, why }.
   Mapped HERE, once, so every painter below still reads one row. A row that already carries the flat names (the older shape) is left as it is. */
function crmPartyFrom(p) {
  if (!p || (p.dues === undefined && !p.may_trade && !p.customer && !p.supplier)) return p;
  var q = Object.assign({}, p),
    c = p.customer || null,
    d = p.dues;
  q.roles = crmRolesList(p.roles);
  q.email = crmRealEmail(p.email) || null;
  if (q.balance_minor === undefined) {
    q.balance_minor = d ? d.balance_minor : null;
    q.oldest_due = d ? d.oldest_due : null;
  }
  if (q.segment === undefined) q.segment = c ? c.segment : null;
  if (q.groups === undefined) q.groups = c && Array.isArray(c.groups) ? c.groups : [];
  if (q.txn_count === undefined) q.txn_count = c ? c.txn_count : 0;
  if (q.last_at === undefined) q.last_at = p.last_activity || null;
  if (q.why_not === undefined) q.why_not = p.may_trade && p.may_trade.ok === false ? p.may_trade.why || 'local' : null;
  if (q.dues_overdue === undefined) q.dues_overdue = !!(d && d.overdue); // the API's own flag (dues.overdue — one late rule, the shop's day); the page does not work lateness out
  if (q.unread === undefined) q.unread = 0; // nor an unread count on the list
  if (q.next_followup_at === undefined) {
    q.next_followup_at = null;
    q.next_followup_late = false;
  } // filled from GET /followups (crmFuJoin)
  return q;
}
/** a walk-in as the API sends it ({ walk_in: true, party_id: null, kind: 'walk-in', phone, points, last_activity }) → a row with a key of its own */
function crmWalkInFrom(w) {
  if (w.party_id) return w;
  var digits = String(w.phone || '').replace(/[^0-9]/g, '');
  return {
    party_id: 'walkin-' + digits,
    party_no: null,
    display_name: 'Walk-in ' + (digits.length > 4 ? digits.slice(0, 2) + '…' + digits.slice(-2) : digits),
    kind: 'walk-in',
    roles: ['customer'],
    phone: w.phone || null,
    email: null,
    city: null,
    user_id: null,
    bridge_id: null,
    on_chitbridge: false,
    why_not: null,
    tax_ids: [],
    groups: [],
    segment: null,
    txn_count: 0,
    last_at: w.last_activity || null,
    balance_minor: null,
    oldest_due: null,
    dues_overdue: false,
    next_followup_at: null,
    next_followup_late: false,
    unread: 0,
    points: { balance: Number(w.points) || 0, programme: '' },
    nickname: null,
    legal_name: null,
    state_code: null
  };
}
/** a follow-up as the API sends it (late · today · due_day · party_listed, NO bucket) → the page's row */
/* W2-CRM: the server's `bucket` used to END this mapping (`if (f.bucket) return f`), so party_removed / assignee_left were never set against the real API
   (the walk's "No longer your party" row was red on main); only the bucket is skipped now, and an older answer without one is bucketed from the SHOP's day */
function crmFuFrom(f) {
  if (!f) return f;
  var o = Object.assign({}, f);
  if (!f.bucket) {
    var today = crmShopDay(),
      weekEnd = crmDayPlus(today, 6); // This week = the next six days after today
    o.bucket = f.late ? 'late' : f.today ? 'today' : f.due_day && f.due_day <= weekEnd && f.due_day > today ? 'week' : 'later';
  }
  if (f.party_listed === false) o.party_removed = true;
  if (f.assignee_user_id && !f.assignee_name) o.assignee_left = true; // an assignee with no name on file has left the team
  return o;
}
/** every follow-up the server has, page by page (CBList.every asks ?page=&limit= until the server's total) → the first page's envelope with every row under `followups`;
 *  the server's `may` and `shop_day` ride it and are kept here, once, for every screen */
async function crmFuRead(query) {
  var head = null;
  var rows = await CBList.every(function (page) {
    return api('crmFollowups', { query: Object.assign({}, query, { page: page, limit: CRM_PAGE }) }).then(function (answer) {
      if (!head) head = answer || {};
      return answer;
    });
  }, 'followups');
  crmMaySet(head && head.may);
  if (head && head.shop_day) CRM.shopDay = head.shop_day;
  return Object.assign({}, head, { followups: rows });
}
/** the soonest open follow-up of each party, and the server's own late count, from GET /followups (the list row carries neither) */
async function crmFuJoin(rows, r) {
  if (r && r.alerts && r.alerts.followups_overdue != null) return; // the older shape sent them with the list (the API's list carries only the dues count: the follow-ups are read below)
  var f;
  try {
    f = await crmFuRead({ scope: crmOwner() ? 'all' : 'mine', done: '0' });
  } catch (e) {
    console.warn('CRM: the follow-ups could not be read for the Next column —', (e && e.message) || e);
    return;
  } /* the list stands without its Next column; the Follow-ups screen says why on its own */
  var list = ((f && f.followups) || []).map(crmFuFrom),
    by = {},
    late = {};
  list.forEach(function (x) {
    var k = String(x.party_id),
      cur = by[k];
    if (!cur || String(x.due_at) < String(cur.due_at)) by[k] = x;
    if (x.late) late[k] = true;
  });
  rows.forEach(function (item) {
    var x = by[String(item.party_id)];
    if (x) {
      item.next_followup_at = x.due_at;
      item.next_followup_late = !!late[String(item.party_id)];
    }
  });
  CRM.alerts = Object.assign({}, CRM.alerts, {
    followups_overdue:
      f && f.late != null
        ? Number(f.late)
        : list.filter(function (x) {
            return x.late;
          }).length
  });
}
/** the page's own guard on the list (the server already does both): a merged party is never a row; the same party twice is one row with both roles */
function crmNormalize(parties) {
  var by = {},
    out = [];
  (parties || []).forEach(function (item) {
    item = crmPartyFrom(item);
    if (!item || item.merged_into) return;
    item.email = crmRealEmail(item.email) || null; /* the flat (older) shape skips crmPartyFrom's mapping: the handle is dropped here too */
    var k = item.party_id,
      seen = by[k];
    item.roles = crmRolesList(item.roles);
    if (seen) {
      (item.roles || []).forEach(function (entry) {
        if (seen.roles.indexOf(entry) < 0) seen.roles.push(entry);
      });
      return;
    }
    item.roles = item.roles.slice();
    item.groups = item.groups || [];
    item.tax_ids = item.tax_ids || [];
    by[k] = item;
    out.push(item);
  });
  return out;
}
/** map the stored balances into the dues map cap-books.js's chip, label and ledger block read, and the rows into the two lists its party editor reads — once per read */
function crmIndex() {
  CRM.byKey = {};
  CRM.rows.forEach(function (item) {
    CRM.byKey[item.party_id] = item;
    if (item.party_no) CRM.byKey[item.party_no] = item;
  });
  if (typeof crmLeadsIndex === 'function') crmLeadsIndex(); /* a lead opens on the same record (cap-crm-leads.js) */
  bkDuesStore({
    currency: CRM.currency,
    parties: CRM.rows
      .filter(function (item) {
        return item.balance_minor != null;
      })
      .map(function (item) {
        return {
          party_id: item.party_id,
          party_no: item.party_no,
          name: item.display_name,
          balance_minor: item.balance_minor,
          oldest_due: item.oldest_due,
          side: item.roles.length > 1 ? 'both' : item.roles[0]
        };
      })
  });
  var mk = function (p, kind) {
    return {
      customer_identity_id: kind === 'customer' ? p.party_id : undefined,
      supplier_entity_id: kind === 'supplier' ? p.party_id : undefined,
      display_name: p.display_name,
      nickname: p.nickname,
      legal_name: p.legal_name,
      party_no: p.party_no,
      tax_ids: p.tax_ids,
      state_code: p.state_code,
      credit_days: null,
      credit_limit_minor: null
    };
  };
  UI.custs = CRM.rows
    .filter(function (item) {
      return item.roles.indexOf('customer') >= 0;
    })
    .map(function (item) {
      return mk(item, 'customer');
    });
  UI.sups = CRM.rows
    .filter(function (item) {
      return item.roles.indexOf('supplier') >= 0;
    })
    .map(function (item) {
      return mk(item, 'supplier');
    });
}
/** what a failure says; a migration answer is a state, never a stack trace (503 CRM_NOT_MIGRATED on calls and follow-ups; the list and the record answer before b276) */
function crmErrWords(e, what) {
  var st = e && e.status;
  if (st === 503) return { title: tx('Calls and follow-ups start after an update.'), sub: tx('Nothing is lost.') };
  return { title: tx("Couldn't load " + what + '.'), sub: tx('Check the connection and try again.') };
}
/* ⚠️ THE API SENDS ROLES AS AN OBJECT ({ customer: true, supplier: false }, chitbridge-api lib/crm.js); the stand-in sent a list.
   Found live 2026-10-03: .indexOf on the object threw, the load's catch showed "Couldn't load your parties". Both shapes read here. */
function crmRolesList(r) {
  if (Array.isArray(r)) return r.slice();
  if (r && typeof r === 'object')
    return ['customer', 'supplier'].filter(function (item) {
      return !!r[item];
    });
  return [];
}
async function crmLoad(quiet) {
  var g = ++CRM.loadGen;
  if (!quiet || !CRM.loaded) {
    CRM.state = 'loading';
    crmRefresh();
  }
  try {
    var reply = await api('crmParties');
    if (g !== CRM.loadGen) return;
    var rows = ((reply && reply.parties) || (Array.isArray(reply) ? reply : [])).concat(((reply && reply.walk_ins) || []).map(crmWalkInFrom));
    CRM.rows = crmNormalize(rows);
    CRM.alerts = (reply && reply.alerts) || {};
    CRM.currency = (CRM.rows[0] && CRM.rows[0].currency) || CRM.currency;
    crmMaySet(crmMayOf(reply));
    await crmFuJoin(CRM.rows, reply); /* the server's may/why for this login — the bar's action is painted again from it below */
    if (g !== CRM.loadGen) return;
    crmIndex();
    CRM.state = 'ready';
    CRM.loaded = true;
    CRM.err = null;
  } catch (e) {
    if (g !== CRM.loadGen) return;
    if (CRM.loaded) {
      CRM.state = 'ready';
    } else {
      CRM.state = 'error';
      CRM.err = e;
    }
  }
  crmNav(CRM.route && CRM.route.nav);
  crmBarAction();
  crmRefresh();
}
function crmRefresh() {
  var a = CRM.api;
  if (a && a.el && document.body.contains(a.el)) a.refresh();
}
/** the bar's one action, painted again once the server has said may/why (the frame drew it from the session's guess) — only for the two lists this file owns */
function crmBarAction() {
  var view = CRM.route && CRM.route.view,
    slot = document.getElementById('crm-bar-act');
  if (!slot) return;
  if (view === 'parties') slot.innerHTML = crmAddBtn();
  else if (view === 'followups') slot.innerHTML = crmAddFuBtn();
}

/* ═══ THE SHELL'S PARTS: sidebar, the bar's one action, the router ═══════════════════════════════════════════════ */
function crmNav(active) {
  var late = Number((CRM.alerts || {}).followups_overdue) || 0; // the server's number — the same one the alert line shows
  var items = [
    [
      'parties',
      'Parties',
      'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21c0-4 3.6-6 8-6s8 2 8 6',
      CRM.loaded ? '<span class="n quiet" data-testid="crm-nav-n-parties">' + CRM.rows.length + '</span>' : ''
    ],
    [
      'chits',
      'Chits',
      'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
      typeof CHITS !== 'undefined' && CHITS.state === 'ready' && chitsStuckCount()
        ? '<span class="n" data-testid="crm-nav-n-chits" title="' + esc(tx('Stuck chits')) + '">' + chitsStuckCount() + '</span>'
        : ''
    ],
    ['leads', 'Leads', 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.4 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z', ''],
    [
      'calls',
      'Calls',
      'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
      typeof CALLS !== 'undefined' && CALLS.loaded && CALLS.rows.length
        ? '<span class="n' + (CALLS.late ? '' : ' quiet') + '" data-testid="crm-nav-n-calls">' + CALLS.rows.length + '</span>'
        : ''
    ],
    [
      'followups',
      'Follow-ups',
      'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',
      late
        ? '<span class="n" data-testid="crm-nav-n-followups" title="' + esc(crmPlural(late, 'late follow-up', 'late follow-ups')) + '">' + late + '</span>'
        : ''
    ],
    [
      'groups',
      'Groups',
      'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 20c0-3 2.7-5 6-5s6 2 6 5M15 15c3 0 6 2 6 5',
      typeof GROUPS !== 'undefined' && GROUPS.loaded && GROUPS.rows.length
        ? '<span class="n quiet" data-testid="crm-nav-n-groups">' +
          GROUPS.rows.filter(function (item) {
            return item.kind === 'group';
          }).length +
          '</span>'
        : ''
    ],
    ['showcase', 'Shop window', 'M3 9l1.5-5h15L21 9M3 9h18M3 9v3a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V9M5 13v8h14v-8M10 21v-5h4v5', ''],
    [
      'privacy',
      'Privacy',
      'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6zM9 12l2 2 4-4',
      typeof PRV !== 'undefined' && PRV.state === 'ready' && PRV.late
        ? '<span class="n" data-testid="crm-nav-n-privacy" title="' + esc(tx('Late privacy requests')) + '">' + PRV.late + '</span>'
        : ''
    ]
  ];
  document.getElementById('nav').innerHTML = crmNavItems(items)
    .map(function (x) {
      return crmNavLink(x, active);
    })
    .join('');
}
/** the items this page's face shows: the Marketing face keeps its own five tabs (cap-marketing.js); CRM itself shows them all */
function crmNavItems(items) {
  return (typeof crmFaceNav === 'function' && crmFaceNav(items)) || items;
}
/** one sidebar link: [key, label, icon path, badge html] */
function crmNavLink(item, active) {
  return (
    '<a class="nav-btn' +
    (item[0] === active ? ' active' : '') +
    '" href="#/' +
    item[0] +
    '" data-testid="crm-nav-' +
    item[0] +
    '" aria-label="' +
    esc(tx(item[1])) +
    '"' +
    (item[0] === active ? ' aria-current="page"' : '') +
    '>' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' +
    item[2] +
    '"/></svg><span class="label">' +
    esc(tx(item[1])) +
    '</span>' +
    item[3] +
    '</a>'
  );
}
/** the app's name in the bar: CRM, or the face this page was opened as (Marketing, cap-marketing.js) */
function crmAppName() {
  var face = typeof crmFace === 'function' ? crmFace() : null;
  return face ? tx(face.brand) : tx('CRM');
}
function crmBar(crumb, action, overlay) {
  var node = document.querySelector('.main');
  if (node) node.classList.toggle('overbar', !!overlay);
  document.getElementById('crumb').innerHTML = crumb || '';
  var a = document.getElementById('crm-bar-act');
  if (a) a.innerHTML = action || '';
}
/** the page action a login may not take is SHOWN, greyed, with the server's sentence — never hidden (rule: show the action, the server decides; FX-L2C) */
function crmViewOnlyBtn(tid, label, why) {
  return (
    '<button data-cbsid="CRM001-B03" type="button" class="act sm ghost" disabled aria-disabled="true" title="' +
    esc(why) +
    '" data-testid="' +
    tid +
    '">' +
    esc(label) +
    '</button><span class="why" data-testid="' +
    tid +
    '-why">' +
    esc(why) +
    '</span>'
  );
}
function crmAddBtn() {
  return crmEdit()
    ? '<button data-cbsid="CRM001-B04" type="button" class="act sm" data-testid="crm-add" data-crm="add">+ ' + esc(tx('Add party')) + '</button>'
    : crmViewOnlyBtn('crm-add', '+ ' + tx('Add party'), crmViewWhy());
}
function crmAddFuBtn() {
  return crmEdit()
    ? '<button data-cbsid="CRM001-B05" type="button" class="act sm" data-testid="crm-fu-add" data-crm="fuadd">+ ' + esc(tx('Add follow-up')) + '</button>'
    : crmViewOnlyBtn('crm-fu-add', '+ ' + tx('Add follow-up'), crmViewWhy());
} /* never hidden — greyed with the reason */
function crmGo(hash, replace) {
  if (replace) {
    try {
      history.replaceState(null, '', hash);
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
    crmRoute();
  } else location.hash = hash;
}

/** one kural per page (kurals.json group `crm`; a face may name its own); true when the Marketing face handled this route itself (cap-marketing.js) */
function crmRoutePrelude(segments, params, frame) {
  var shown = segments[0] === 'party' && segments[1] ? 'crm-party' : segments[0] === 'followups' ? 'crm-party' : 'crm-parties';
  if (window.CBKural) CBKural.set((typeof crmFaceKural === 'function' && crmFaceKural()) || shown);
  return typeof crmFaceRoute === 'function' && crmFaceRoute(segments, params, frame);
}
function crmRoute(frame) {
  var text = (location.hash || '').replace(/^#\/?/, ''),
    q = '',
    qi = text.indexOf('?');
  if (qi >= 0) {
    q = text.slice(qi + 1);
    text = text.slice(0, qi);
  }
  var seg = text.split('/').filter(Boolean).map(decodeURIComponent),
    params = {};
  q.split('&').forEach(function (item) {
    if (item) {
      var a = item.split('=');
      params[a[0]] = decodeURIComponent(a[1] || '');
    }
  });
  closeModal();
  /* one kural per page (kurals.json group `crm`); the footer is the page's, never a part of a message */
  if (crmRoutePrelude(seg, params, frame)) return; /* the kural band, then the Marketing face's own routes (#/sent · #/results · its home) */
  if (seg[0] === 'party' && seg[1]) {
    if (frame) {
      crmNav('parties');
      return;
    } /* a record reads before it can draw: only the menu is drawn first */
    CRM.route = { nav: 'parties', view: 'party', key: seg[1], sub: seg[2] || '', params: params };
    return crmRecordOpen(CRM.route);
  }
  if (seg[0] === 'chit' && seg[1]) {
    /* CRM2: the chit page — the sheet's painters full-page (cap-crm-chits.js chitPage) */
    CRM.route = { nav: 'chits', view: 'chit', key: seg[1], sub: '', params: params };
    crmNav('chits');
    chitPage(seg[1], frame);
    return;
  }
  if (seg[0] === 'chits') {
    CRM.route = { nav: 'chits', view: 'chits', sub: '', params: params };
    crmNav('chits');
    chitsHome(params, frame);
    return;
  }
  if (seg[0] === 'leads') {
    CRM.route = { nav: 'leads', view: 'leads', sub: '', params: params };
    crmNav('leads');
    crmLeads(frame);
    return;
  }
  if (seg[0] === 'calls') {
    CRM.route = { nav: 'calls', view: 'calls', sub: '', params: params };
    crmNav('calls');
    crmCalls(frame);
    return;
  }
  if (seg[0] === 'groups' && typeof crmGroups === 'function') {
    /* T3-P2-CRM: Groups & segments (cap-crm-groups.js) */
    CRM.route = { nav: 'groups', view: 'groups', sub: '', params: params };
    crmNav('groups');
    crmGroups(frame);
    return;
  }
  if (seg[0] === 'showcase' && typeof crmShowcase === 'function') {
    /* T3-P2-CRM: the Shop window — pick · preview · share */
    CRM.route = { nav: 'showcase', view: 'showcase', sub: '', params: params };
    crmNav('showcase');
    crmShowcase(frame);
    return;
  }
  if (seg[0] === 'privacy') {
    /* T3-P3-CONSENT: the privacy-request register (cap-crm-privacy.js) */
    CRM.route = { nav: 'privacy', view: 'privacy', sub: '', params: params };
    crmNav('privacy');
    crmPrivacy(frame, params);
    return;
  }
  if (seg[0] === 'followups') {
    CRM.route = { nav: 'followups', view: 'followups', sub: seg[1] || '', params: params };
    crmNav('followups');
    crmFollowups(frame);
    if (seg[1] === 'add' && !frame) crmFuAddOpen(params.party);
    return;
  }
  CRM.route = { nav: 'parties', view: 'parties', sub: seg[1] || '', params: params };
  crmNav('parties');
  crmHome(frame);
  if (seg[1] === 'add' && !frame) crmAddOpen(params.q || '');
}

/* ═══ 1 · HOME — the parties list (a CBList mount: the Task table's look, one row per party) ═════════════════════ */
/** ONE LINE PER PARTY, IN COLUMNS (Athi, 2026-10-09): Party · Role (heading filter) · On ChitBridge · Dues · Last activity · Next follow-up; the chooser adds phone · e-mail · GSTIN · segment · credit terms · city */
function crmPartyCols() {
  var cols = [
    {
      key: 'party',
      label: 'Party',
      prio: 1,
      w: 270,
      sort: 'name',
      html: true,
      cell: crmPartyCell,
      value: function (p) {
        return p.display_name;
      }
    },
    {
      key: 'role',
      label: 'Role',
      prio: 3,
      w: 120,
      sort: 'role',
      hfilter: 'role',
      cell: crmRoleWord,
      tid: function (p) {
        return 'crm-role-' + crmKey(p);
      },
      value: function (p) {
        return crmRoleWord(p);
      }
    },
    {
      key: 'rail',
      label: 'On the network',
      prio: 6,
      w: 170,   /* measured at 1366x768, text size m: the label, arrow, filter and resize handle need 166 px; wider pushes the last column off the edge */
      sort: 'rail',
      hfilter: 'rail',
      html: true,
      cell: crmRailCell,
      value: function (p) {
        return crmConnected(p) ? 'a' : 'b';
      }
    }
  ];
  if (CRM.ledger)
    cols.push({
      key: 'dues',
      label: 'Dues',
      prio: 2,
      w: 200,
      sort: 'dues',
      html: true,
      cell: crmDueListCell,
      value: function (p) {
        return p.balance_minor == null ? '' : p.balance_minor;
      }
    });
  cols.push(
    {
      key: 'last',
      label: 'Last activity',
      prio: 5,
      w: 200,
      sort: 'last',
      html: true,
      cell: crmLastCell,
      value: function (p) {
        return p.last_at || '';
      }
    },
    {
      key: 'next',
      label: 'Next follow-up',
      prio: 4,
      w: 170,
      sort: 'next',
      html: true,
      cell: crmFuCell,
      value: function (p) {
        return p.next_followup_at || '9999';
      }
    },
    {
      key: 'phone',
      label: 'Phone',
      prio: 7,
      w: 160,
      cell: function (p) {
        return p.phone || '—';
      }
    },
    {
      key: 'email',
      label: 'E-mail',
      prio: 8,
      w: 220,
      cell: function (p) {
        return crmRealEmail(p.email) || '—';
      }
    },
    {
      key: 'gstin',
      label: taxIdWord(),
      prio: 9,
      w: 190,
      mono: true,
      cell: function (p) {
        var g = (p.tax_ids || []).filter(function (item) {
          return item.scheme === taxIdWord();
        })[0];
        return g ? g.value : '—';
      }
    } /* CX0: the pack's tax-id word (GSTIN · ABN · TRN) */,
    {
      key: 'seg',
      label: 'Segment · groups',
      prio: 10,
      w: 190,
      html: true,
      cell: function (p) {
        return (
          crmSegChip(p) +
            (p.groups || [])
              .map(function (item) {
                return '<span class="tag">' + esc(item) + '</span>';
              })
              .join(' ') || '<span class="sub">—</span>'
        );
      },
      value: function (p) {
        return [p.segment].concat(p.groups || []).join(' ');
      }
    },
    {
      key: 'terms',
      label: 'Credit terms',
      prio: 11,
      w: 170,
      html: true,
      cell: crmTermsCell,
      value: function (p) {
        var t = p.terms || {},
          s = t.customer || t.supplier;
        return s && s.credit_days != null ? s.credit_days : '';
      }
    },
    {
      key: 'city',
      label: 'City',
      prio: 12,
      w: 140,
      cell: function (p) {
        return p.city || '—';
      }
    }
  );
  return cols;
}
function crmGroupNames() {
  var s = {};
  CRM.rows.forEach(function (item) {
    (item.groups || []).forEach(function (entry) {
      s[entry] = 1;
    });
  });
  return Object.keys(s).sort();
}
function crmFilters() {
  var list = [
    {
      key: 'role',
      label: tx('Role'),
      all: tx('All roles'),
      options: [
        { v: 'customer', label: tx('Customers') },
        { v: 'supplier', label: tx('Suppliers') },
        { v: 'both', label: tx('Both') }
      ],
      match: function (p, v) {
        return v === 'both' ? p.roles.length === 2 : p.roles.indexOf(v) >= 0;
      }
    },
    {
      key: 'rail',
      label: tx('On the network'),
      all: tx('All'),
      options: [
        { v: 'on', label: tx('On the network') },
        { v: 'off', label: tx('Not connected') }
      ],
      match: function (p, v) {
        return v === 'on' ? crmConnected(p) : !crmConnected(p);
      }
    },
    {
      key: 'seg',
      label: tx('Segment'),
      all: tx('Any segment'),
      options: Object.keys(CRM_SEG).map(function (item) {
        return { v: item, label: tx(CRM_SEG[item]) };
      }),
      match: function (p, v) {
        return p.segment === v;
      }
    },
    {
      key: 'group',
      label: tx('Group'),
      all: tx('Any group'),
      options: crmGroupNames(),
      match: function (p, v) {
        return (p.groups || []).indexOf(v) >= 0;
      }
    }
  ];
  if (CRM.ledger)
    list.push({
      key: 'dues',
      label: tx('Dues'),
      all: tx('Any'),
      options: [
        { v: 'has', label: tx('Has dues') },
        { v: 'late', label: tx('Dues late') },
        { v: 'get', label: tx("You'll get") },
        { v: 'give', label: tx("You'll give") }
      ],
      match: function (p, v) {
        var b = Number(p.balance_minor || 0);
        return v === 'late' ? !!p.dues_overdue : v === 'get' ? b > 0 : v === 'give' ? b < 0 : !!b;
      }
    });
  list.push({
    key: 'quiet',
    label: tx('Last contact'),
    all: tx('Any'),
    options: [{ v: '30', label: tx('None in 30 days') }],
    match: function (p) {
      return !p.last_at || Date.now() - Date.parse(p.last_at) > 30 * 86400000;
    }
  });
  list.push({
    key: 'fu',
    label: tx('Follow-up'),
    all: tx('Any'),
    options: [
      { v: 'due', label: tx('Follow-up due') },
      { v: 'late', label: tx('Follow-up late') }
    ],
    match: function (p, v) {
      return v === 'late' ? !!p.next_followup_late : !!p.next_followup_at;
    }
  });
  return list;
}
function crmPartySorts() {
  var by = function (f, rev) {
    return function (a, b) {
      var x = f(a),
        y = f(b);
      return rev ? (y > x ? 1 : y < x ? -1 : 0) : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
    };
  };
  return [
    {
      key: 'name',
      label: tx('Name'),
      cmp: by(function (p) {
        return p.display_name;
      })
    },
    {
      key: 'last',
      label: tx('Last activity'),
      cmp: by(function (p) {
        return p.last_at || '';
      }, true)
    },
    {
      key: 'role',
      label: tx('Role'),
      cmp: by(function (p) {
        return crmRoleWord(p);
      })
    },
    {
      key: 'rail',
      label: tx('On the network'),
      cmp: by(function (p) {
        return crmConnected(p) ? 'a' : 'b';
      })
    },
    {
      key: 'next',
      label: tx('Next follow-up'),
      cmp: by(function (p) {
        return p.next_followup_at || '9999';
      })
    },
    {
      key: 'dues',
      label: tx('Dues'),
      cmp: by(function (p) {
        return Math.abs(p.balance_minor || 0);
      }, true)
    }, // an ordering of the server's figures, not a sum
    {
      key: 'newest',
      label: tx('Newest'),
      cmp: by(function (p) {
        return p.party_no || '';
      }, true)
    }
  ];
}
/** the alert line: only failing things, each with the button that fixes it (SYSTEM rule 1). "duplicates" waits for its screen (Phase 6). */
function crmNotices() {
  var a = CRM.alerts || {},
    out = [],
    fu = Number(a.followups_overdue) || 0,
    du = Number(a.dues_overdue) || 0;
  if (fu > 0)
    out.push({
      text: crmPlural(fu, 'follow-up late', 'follow-ups late') + ' · ' + tx('Open follow-ups'),
      cls: 'warn',
      tid: 'crm-alert-followups',
      onOpen: function () {
        crmGo('#/followups');
      }
    });
  if (CRM.ledger && du > 0)
    out.push({
      text: crmPlural(du, 'party with late dues', 'parties with late dues') + ' · ' + tx('See dues'),
      cls: 'warn',
      tid: 'crm-alert-dues',
      onOpen: function () {
        location.href = '/accounts.html#dues';
      }
    });
  return out;
}
/* ═══ THE MINI-CARD — what ▸ opens in place, the same height and style on every row (Athi: "that has to be fantastic") ═════════════════
   Three boxes (contact · money · last chits) then the action row the list unit draws. Same pattern for Chits and Follow-ups (crmMiniBox). */
function crmMiniBox(cls, title, rows, tid) {
  return '<section class="mc-box ' + cls + '" data-testid="' + esc(tid) + '"><h5>' + esc(tx(title)) + '</h5>' + rows.join('') + '</section>';
}
function crmMiniRow(icon, html, tid) {
  return (
    '<div class="mc-r"' +
    (tid ? ' data-testid="' + esc(tid) + '"' : '') +
    '><span class="ic">' +
    (icon ? crmIcon(icon) : '') +
    '</span><span class="v">' +
    html +
    '</span></div>'
  );
}
function crmMiniKV(label, html, tid) {
  return (
    '<div class="mc-r kv"' +
    (tid ? ' data-testid="' + esc(tid) + '"' : '') +
    '><span class="k">' +
    esc(tx(label)) +
    '</span><span class="v">' +
    html +
    '</span></div>'
  );
}
var CRM_MINI = { chits: {}, q: [], busy: 0 };
/** the last three chits of a party: one timeline read, only when the row is opened, at most four at a time (⇣ Expand all must not stampede the server) */
function crmMiniChits(p) {
  var k = p.party_id;
  if (CRM_MINI.chits[k]) return CRM_MINI.chits[k];
  var go = function (resolve) {
    CRM_MINI.busy++;
    api('crmTimeline', { params: { id: k }, query: { limit: 20 } })
      .then(
        function (reply) {
          var all = crmEntriesFrom(reply).filter(function (e) {
            return /^(bill|chit|payment|dispute)$/.test(e.kind);
          });
          resolve(all.slice(0, 3));
        },
        function () {
          resolve(null);
        }
      )
      .then(function () {
        CRM_MINI.busy--;
        var n = CRM_MINI.q.shift();
        if (n) n();
      });
  };
  CRM_MINI.chits[k] = new Promise(function (resolve) {
    if (CRM_MINI.busy < 4) go(resolve);
    else
      CRM_MINI.q.push(function () {
        go(resolve);
      });
  });
  return CRM_MINI.chits[k];
}
function crmMiniChitRows(list, key) {
  var rows = [];
  if (list === null) rows.push('<div class="mc-r sub">' + esc(tx("Couldn't read the chits. Open the record.")) + '</div>');
  else
    (list || []).forEach(function (e, index) {
      rows.push(
        '<div data-cbsid="CRM001-B06" class="mc-c"' +
          (e.chit_id ? ' role="button" tabindex="0" data-crm="minichit" data-id="' + esc(e.chit_id) + '"' : '') +
          ' data-testid="crm-mini-chit-' +
          esc(key) +
          '-' +
          index +
          '"><span class="d">' +
          esc(bkDate(e.at)) +
          '</span><span class="w">' +
          esc(e.line || '') +
          '</span><span class="a mono">' +
          (e.amount_minor != null ? esc(bkMoney(e.amount_minor, e.currency || CRM.currency)) : e.amount_hidden ? esc(tx('hidden')) : '') +
          '</span></div>'
      );
    });
  if (list && !list.length) rows.push('<div class="mc-r sub" data-testid="crm-mini-nochits-' + esc(key) + '">' + esc(tx('No chits yet')) + '</div>');
  return rows;
}
function crmMini(p, list) {
  var key = crmKey(p),
    ph = p.phone,
    em = crmRealEmail(p.email),
    terms = crmTermsCell(p);
  var contact = crmMiniBox(
    'mc-contact',
    'Contact',
    [
      crmMiniRow(
        'phone',
        ph ? '<a href="tel:' + esc(String(ph).replace(/\s+/g, '')) + '">' + esc(ph) + '</a>' : '<span class="sub">' + esc(tx('no phone')) + '</span>',
        'crm-mini-phone-' + key
      ),
      crmMiniRow(
        'mail',
        em ? '<a href="mailto:' + esc(em) + '">' + esc(em) + '</a>' : '<span class="sub">' + esc(tx('no e-mail')) + '</span>',
        'crm-mini-email-' + key
      ),
      crmMiniRow('pin', p.city ? esc(p.city) : '<span class="sub">' + esc(tx('no place')) + '</span>', 'crm-mini-city-' + key)
    ],
    'crm-mini-contact-' + key
  );
  var money = crmMiniBox(
    'mc-money',
    'Money',
    [
      '<div class="mc-big">' + (CRM.ledger && p.balance_minor != null ? crmDueListCell(p) : '<span class="sub">—</span>') + '</div>',
      crmMiniKV('Credit terms', terms, 'crm-mini-terms-' + key),
      crmMiniKV('Oldest bill', p.oldest_due ? esc(bkDate(p.oldest_due)) : '<span class="sub">—</span>', 'crm-mini-oldest-' + key)
    ],
    'crm-mini-money-' + key
  );
  var rows = list === undefined ? ['<div class="mc-r sub">' + esc(tx('Reading…')) + '</div>'] : crmMiniChitRows(list, key);
  return (
    '<div class="mc" data-testid="crm-mini-' +
    esc(key) +
    '">' +
    contact +
    money +
    '<section class="mc-box mc-last" data-testid="crm-mini-last-' +
    esc(key) +
    '"><h5>' +
    esc(tx('Last chits')) +
    '</h5><div class="mc-list">' +
    rows.join('') +
    '</div></section></div>'
  );
}
/** the ▸ opens at once; the last three chits fill in when the one read returns (the unit repaints a pending answer in place) */
function crmMiniAsync(p) {
  if (p.kind === 'walk-in' || !p.party_id) return crmMini(p, []);
  return crmMiniChits(p).then(function (list) {
    return crmMini(p, list);
  });
}
/* the actions: every one SHOWN; a login that may not do one sees it greyed WITH the sentence (show-action-enable-by-role). who may is the login's role, the server refuses too. */
function crmWhyNot(p, act) {
  var viewer = !crmEdit(),
    walk = p.kind === 'walk-in',
    b = Number(p.balance_minor || 0);
  if (act === 'call') return p.phone ? '' : tx('No phone number yet');
  if (act === 'message')
    return viewer
      ? crmViewWhy()
      : walk
        ? tx('Add them to your parties first')
        : crmConnected(p)
          ? ''
          : tx('Not on the network'); /* one short reason beside a greyed button (ai-eye E-14) */
  if (act === 'pay')
    return viewer
      ? crmViewWhy()
      : walk
        ? tx('Add them to your parties first')
        : !CRM.ledger
          ? tx('Switch on the Ledger first')
          : !b
            ? tx('Nothing is due')
            : '';
  if (act === 'followup') return viewer ? crmViewWhy() : walk ? tx('Add them to your parties first') : '';
  return '';
}
function crmMiniActions() {
  return [
    {
      id: 'call',
      label: tx('Call'),
      icon: '📞',
      tid: 'crm-mini-call',
      why: function (p) {
        return crmWhyNot(p, 'call');
      },
      run: function (p) {
        location.href = 'tel:' + String(p.phone || '').replace(/\s+/g, '');
      }
    },
    {
      id: 'message',
      label: tx('Message'),
      icon: '💬',
      tid: 'crm-mini-message',
      why: function (p) {
        return crmWhyNot(p, 'message');
      },
      run: function (p) {
        crmMiniChits(p).then(function (reply) {
          var e = (reply || []).filter(function (x) {
            return x.chit_id;
          })[0];
          if (e && typeof openChitSheet === 'function') openChitSheet(e.chit_id);
          else toast(tx('No messages with them yet.'));
        });
      }
    },
    {
      id: 'pay',
      label: tx('Pay / Receive'),
      icon: '₹',
      tid: 'crm-mini-pay',
      why: function (p) {
        return crmWhyNot(p, 'pay');
      },
      run: function (p) {
        var side = Number(p.balance_minor) > 0 || (p.roles || []).indexOf('supplier') < 0 ? 'customer' : 'supplier';
        payOpen(side, p.party_id, payOpenTotal(side, p) || undefined);
      }
    },
    {
      id: 'followup',
      label: tx('Follow-up'),
      icon: '⏰',
      tid: 'crm-mini-followup',
      why: function (p) {
        return crmWhyNot(p, 'followup');
      },
      run: function (p) {
        crmFuAddOpen(p.party_id);
      }
    },
    {
      id: 'open',
      label: tx('Open record'),
      icon: '↗',
      tid: 'crm-open',
      run: function (p) {
        crmGo('#/party/' + encodeURIComponent(crmKey(p)));
      }
    }
  ];
}
/** the people-lists' group head: "5 parties · ₹12,450 you'll get · ₹4,816 you'll give" — the server's stored balances, added by sign; no other figure is made here */
function crmGroupFig(rows) {
  var get = 0,
    give = 0;
  rows.forEach(function (item) {
    var b = Number(item.balance_minor || 0);
    if (b > 0) get += b;
    else if (b < 0) give -= b;
  });
  var out = [crmPlural(rows.length, 'party', 'parties')];
  if (CRM.ledger && get) out.push(bkMoney(get, CRM.currency) + ' ' + tx("you'll get"));
  if (CRM.ledger && give) out.push(bkMoney(give, CRM.currency) + ' ' + tx("you'll give"));
  return out.join(' · ');
}
/** the saved views: one tap sets the list's own filters */
function crmViews() {
  var list = [
    { key: 'all', label: 'All', filt: {} },
    { key: 'customers', label: 'Customers', filt: { role: 'customer' } },
    { key: 'suppliers', label: 'Suppliers', filt: { role: 'supplier' } }
  ];
  if (CRM.ledger)
    list.push(
      { key: 'owe-me', label: 'Owe me', filt: { dues: 'get' }, tip: 'Parties who owe you money' },
      { key: 'i-owe', label: 'I owe', filt: { dues: 'give' }, tip: 'Parties you owe money' }
    );
  list.push({ key: 'quiet', label: 'No contact in 30 days', filt: { quiet: '30' } });
  return { tid: 'crm-view', items: list };
}
/** the filters a link may preset: ?role= (the Home rail's doors) · ?seg= / ?group= (the Groups screen's "See all in Parties", T3-P2-CRM) — the list's own filters, nothing new */
function crmHomePreset() {
  var q = (CRM.route && CRM.route.params) || {},
    f = {};
  if (/^(customer|supplier|both)$/.test(q.role || '')) f.role = q.role;
  if (q.seg && CRM_SEG[q.seg]) f.seg = q.seg;
  if (q.group) f.group = q.group;
  return Object.keys(f).length ? { filt: f } : null;
}
function crmHome(frame) {
  crmBar('<strong>' + esc(crmAppName()) + '</strong>', crmAddBtn(), true);
  var node = document.getElementById('screen');
  node.className = 'screen flush';
  node.innerHTML = '<div id="crm_list" data-testid="crm-list"></div>';
  if (CRM.api && CRM.api.destroy) {
    try {
      CRM.api.destroy();
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  }
  CRM.api = CBList.mount(document.getElementById('crm_list'), {
    key: 'crm-parties',
    t: tx,
    rows: function () {
      return CRM.rows;
    },
    id: function (p) {
      return p.party_id;
    },
    rowTid: function (p) {
      return 'crm-row-' + crmKey(p);
    },
    columns: crmPartyCols,
    defaultCols: CRM.ledger ? ['party', 'role', 'rail', 'dues', 'last', 'next'] : ['party', 'role', 'rail', 'last', 'next'],
    cardMax: 4,
    fill: false,
    views: crmViews(),
    head: function () {
      return { title: tx('Parties'), reserve: true, notices: CRM.state === 'ready' ? crmNotices() : [] };
    },
    state: function () {
      return CRM.state;
    },
    error: function () {
      return crmErrWords(CRM.err, 'your parties');
    },
    onRetry: function () {
      crmLoad();
    },
    empty: { title: tx('No parties yet'), sub: tx('Customers appear when you bill them; suppliers when you add them. Use + Add party.') },
    search: function (p) {
      return [
        p.display_name,
        p.nickname,
        p.legal_name,
        p.party_no,
        p.user_id,
        p.phone,
        p.email,
        (p.tax_ids || [])
          .map(function (item) {
            return item.value;
          })
          .join(' '),
        (p.groups || []).join(' ')
      ].join(' ');
    },
    searchHint: tx('Name, ID, phone, e-mail'),
    filters: crmFilters(),
    sorts: crmPartySorts(),
    preset: crmHomePreset(),
    group: {
      options: [
        ['none', 'None'],
        ['role', 'Role'],
        ['conn', 'Connection'],
        ['seg', 'Segment']
      ],
      default: 'none',
      tid: 'crm-parties',
      as: 'select',
      tips: { conn: CRM_CONN_TIP },
      fig: function (rows) {
        return crmGroupFig(rows);
      },
      by: function (p, mode) {
        if (mode === 'conn') {
          var on = crmConnected(p);
          return [on ? tx('On the network') : tx('Not connected'), on ? 'on' : 'off'];
        }
        if (mode === 'role') {
          var r = crmRoleKey(p);
          return [tx(CRM_ROLE_WORD[r]), r];
        }
        if (mode === 'seg') return p.segment ? [tx(CRM_SEG[p.segment] || p.segment), p.segment] : [tx('No segment'), 'none'];
        return null;
      }
    },
    onOpen: function (p) {
      crmGo('#/party/' + encodeURIComponent(crmKey(p)));
    },
    next: crmMiniAsync,
    nextPending: function (p) {
      return crmMini(p);
    },
    actions: crmMiniActions()
  });
  if (frame) return; /* the frame only: the rows are asked for once the shop is known */
  if (!CRM.loaded) crmLoad();
  else crmLoad(true);
}

/* ═══ 2 · FOLLOW-UPS — the Task table, grouped Late · Today · This week · Later ══════════════════════════════════ */
var CRM_BUCKET = { late: 'Late', today: 'Today', week: 'This week', later: 'Later' };
function crmFuDue(f) {
  if (f.late) return '<span class="late red">⚠ ' + esc(tx('Late')) + ' · ' + esc(bkDate(f.due_at)) + '</span>';
  return esc(crmWhen(f.due_at));
}
function crmFuSrc(f) {
  return { manual: tx('Manual'), dues: tx('Dues'), interaction: tx('From a call') }[f.source] || '';
}
function crmFuWhat(f) {
  var acts = f.party_removed
    ? '<span class="sub">' +
      esc(tx('No longer your party')) +
      '</span> <button data-cbsid="CMP011" type="button" class="crm-mini" data-crm="fudel" data-id="' +
      esc(f.followup_id) +
      '" data-testid="crm-fu-del-' +
      esc(f.followup_id) +
      '">' +
      esc(tx('Delete')) +
      '</button>'
    : crmEdit()
      ? ui.action('done', {
          mount: 'CRM003-U104',
          object: 'follow-up',
          surface: 'list',
          size: 'compact',
          testid: 'crm-fu-done-' + f.followup_id,
          data: { crm: 'fudone', id: f.followup_id }
        }) +
        (f.assignee_left
          ? ' <button data-cbsid="CRM001-B07" type="button" class="crm-mini" data-crm="fuassign" data-id="' +
            esc(f.followup_id) +
            '" data-testid="crm-fu-assign-' +
            esc(f.followup_id) +
            '">' +
            esc(tx('Assign')) +
            '</button>'
          : '')
      : '';
  return (
    '<span class="fu1"><span class="fut' +
    (f.party_removed ? ' sub' : '') +
    '">' +
    esc(f.what) +
    '</span>' +
    (acts ? '<span class="fua">' + acts + '</span>' : '') +
    '</span>'
  );
}
/** the follow-up's mini-card: what · when · party, then Done · Snooze · Open party (each shown; a login that may not sees it greyed with the sentence) */
function crmFuMini(f) {
  var key = esc(f.followup_id),
    who = f.assignee_left ? tx('Unassigned') : f.assignee_name || tx('Unassigned'),
    p = CRM.byKey[f.party_id] || CRM.byKey[f.party_no] || null;
  var late = f.late ? '<span class="late red">⚠ ' + esc(tx('Late')) + ' · ' + esc(bkDate(f.due_at)) + '</span>' : esc(crmWhen(f.due_at));
  return (
    '<div class="mc" data-testid="crm-fu-mini-' +
    key +
    '">' +
    crmMiniBox(
      'mc-what',
      'What',
      [crmMiniRow('note', '<span style="white-space:normal">' + esc(f.what) + '</span>'), crmMiniKV('From', esc(crmFuSrc(f) || '—'))],
      'crm-fu-mini-what-' + key
    ) +
    crmMiniBox(
      'mc-when',
      'When',
      [
        crmMiniKV('Due', late),
        crmMiniKV('Who', f.assignee_left ? '<span class="late red">' + esc(who) + '</span>' : esc(who)),
        crmMiniKV('Added', f.created_at ? esc(bkDate(f.created_at)) : '—')
      ],
      'crm-fu-mini-when-' + key
    ) +
    crmMiniBox(
      'mc-party',
      'Party',
      [
        crmMiniRow('link', '<b>' + esc(f.party_name || '—') + '</b> <span class="mono sub">' + esc(f.party_no || '') + '</span>'),
        crmMiniRow(
          'phone',
          p && p.phone
            ? '<a href="tel:' + esc(String(p.phone).replace(/\s+/g, '')) + '">' + esc(p.phone) + '</a>'
            : '<span class="sub">' + esc(tx('no phone')) + '</span>'
        ),
        crmMiniKV('Dues', p ? crmDueCell(p) : '<span class="sub">—</span>')
      ],
      'crm-fu-mini-party-' + key
    ) +
    '</div>'
  );
}
function crmFuWhyNot(f) {
  return !crmEdit() ? crmViewWhy() : f.party_removed ? tx('No longer your party') : '';
}
function crmFuActions() {
  return [
    {
      id: 'done',
      label: tx('Done'),
      icon: '✓',
      tid: 'crm-fu-mini-done',
      why: function (f) {
        return crmEdit() ? '' : crmViewWhy();
      },
      run: function (f) {
        crmFuAct(f.followup_id, { done: true });
      }
    },
    /* a snooze is a WORD the server turns into the shop's day (api crm-followups AFTER) — never an instant from this phone's clock (W2-CRM) */
    {
      id: 'snooze1',
      label: tx('Snooze') + ' · ' + tx('Tomorrow'),
      icon: '⏰',
      tid: 'crm-fu-snooze-tomorrow',
      why: crmFuWhyNot,
      run: function (f) {
        crmFuAct(f.followup_id, { after: 'tomorrow' });
      }
    },
    {
      id: 'snooze7',
      label: tx('Snooze') + ' · ' + tx('Next week'),
      icon: '⏰',
      tid: 'crm-fu-snooze-week',
      why: crmFuWhyNot,
      run: function (f) {
        crmFuAct(f.followup_id, { after: 'week' });
      }
    },
    {
      id: 'party',
      label: tx('Open party'),
      icon: '↗',
      tid: 'crm-fu-open-party',
      why: function (f) {
        return f.party_removed ? tx('No longer your party') : '';
      },
      run: function (f) {
        crmGo('#/party/' + encodeURIComponent(f.party_no || f.party_id));
      }
    }
  ];
}
async function crmFuLoad() {
  var g = ++CRM.loadGen;
  CRM.fuState = 'loading';
  crmFuRefresh();
  try {
    var scope = CRM.fuScope || (crmOwner() ? 'all' : 'mine');
    var answer = await crmFuRead({ scope: scope, done: CRM.fuDone ? '1' : '0' }); /* every page, to the server's total */
    CRM.fu = (answer.followups || []).map(crmFuFrom);
    CRM.coAssists = answer.co_assists || CRM.coAssists;
    CRM.fuState = 'ready';
    CRM.fuErr = null;
  } catch (e) {
    CRM.fuState = e && e.status === 503 ? 'notyet' : 'error';
    CRM.fuErr = e;
  }
  crmBarAction();
  crmFuRefresh();
}
function crmFuRefresh() {
  var a = CRM.fuApi;
  if (a && a.el && document.body.contains(a.el)) {
    a.refresh();
  }
}
/** a list whose filters or search are answered by the SERVER: the page reads what the person chose from the events the unit's own controls raise
 *  (a filter select, its ×, Clear, the search box — nothing of the unit's internals) and asks again when it changed. onChange({ filt:{key:value}, q }) */
function crmWatch(el, onChange) {
  var cur = { filt: {}, q: '' },
    last = JSON.stringify(cur),
    t = null;
  var fire = function (ms) {
    clearTimeout(t);
    t = setTimeout(function () {
      var now = JSON.stringify(cur);
      if (now !== last) {
        last = now;
        onChange(JSON.parse(now));
      }
    }, ms);
  };
  el.addEventListener('change', function (ev) {
    var k = ev.target.getAttribute && ev.target.getAttribute('data-filt');
    if (k) {
      if (ev.target.value) cur.filt[k] = ev.target.value;
      else delete cur.filt[k];
      fire(20);
    }
  });
  el.addEventListener('click', function (ev) {
    var node = ev.target.closest && ev.target.closest('[data-unfilt],[data-cbl-clearf],[data-cbl-clear]');
    if (!node) return;
    if (node.hasAttribute('data-unfilt')) delete cur.filt[node.getAttribute('data-unfilt')];
    else {
      cur.filt = {};
      if (node.hasAttribute('data-cbl-clear')) cur.q = '';
    }
    fire(20);
  });
  el.addEventListener('input', function (ev) {
    if (ev.target.hasAttribute && ev.target.hasAttribute('data-cbl-q')) {
      cur.q = String(ev.target.value || '').trim();
      fire(300);
    }
  });
}
function crmFollowups(frame) {
  crmBar('<a href="#/parties" data-testid="crm-back">‹ ' + esc(tx('Parties')) + '</a>', crmAddFuBtn(), true);
  var node = document.getElementById('screen');
  node.className = 'screen flush';
  var def = crmOwner() ? 'all' : 'mine';
  node.innerHTML = '<div id="crm_fu" data-testid="crm-fu-list"></div>';
  if (CRM.fuApi && CRM.fuApi.destroy) {
    try {
      CRM.fuApi.destroy();
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  }
  var by = function (f) {
    return function (a, b) {
      return String(f(a)).localeCompare(String(f(b)), undefined, { numeric: true, sensitivity: 'base' });
    };
  };
  var el = document.getElementById('crm_fu');
  CRM.fuApi = CBList.mount(el, {
    key: 'crm-followups',
    t: tx,
    rows: function () {
      return CRM.fuState === 'ready' ? CRM.fu : [];
    },
    id: function (f) {
      return f.followup_id;
    },
    rowTid: function (f) {
      return 'crm-fu-' + f.followup_id;
    },
    columns: [
      {
        key: 'due',
        label: 'Due',
        prio: 1,
        w: 170,
        sort: 'due',
        html: true,
        cell: crmFuDue,
        value: function (f) {
          return f.due_at;
        }
      },
      {
        key: 'what',
        label: 'What',
        prio: 2,
        w: 420,
        html: true,
        cell: crmFuWhat,
        value: function (f) {
          return f.what;
        }
      },
      {
        key: 'party',
        label: 'Party',
        prio: 3,
        w: 240,
        sort: 'party',
        html: true,
        cell: function (f) {
          return (
            '<span class="nm">' +
            esc(f.party_name) +
            '</span> <span class="pno mono" style="font-size:12px;color:var(--muted)">' +
            esc(f.party_no || '') +
            '</span>'
          );
        },
        value: function (f) {
          return f.party_name;
        }
      },
      {
        key: 'who',
        label: 'Who',
        prio: 4,
        w: 150,
        cell: function (f) {
          return f.assignee_left ? tx('Unassigned') : f.assignee_name || '—';
        }
      },
      {
        key: 'source',
        label: 'Source',
        prio: 5,
        w: 140,
        cell: function (f) {
          return { manual: tx('Manual'), dues: tx('Dues'), interaction: tx('From a call') }[f.source] || '—';
        }
      },
      {
        key: 'created',
        label: 'Created',
        prio: 6,
        w: 140,
        sort: 'created',
        cell: function (f) {
          return f.created_at ? bkDate(f.created_at) : '—';
        },
        value: function (f) {
          return f.created_at || '';
        }
      }
    ],
    defaultCols: ['due', 'what', 'party'],
    cardMax: 3,
    fill: false,
    head: function () {
      var open = CRM.fu.filter(function (item) {
        return item.bucket === 'late' || item.bucket === 'today';
      }).length;
      return {
        title: tx('Follow-ups'),
        chips: CRM.fuState === 'ready' && !CRM.fuDone && CRM.fu.length && !open ? [{ text: tx('Nothing due today'), tid: 'crm-fu-nothing-today' }] : []
      };
    },
    state: function () {
      return CRM.fuState === 'loading' ? 'loading' : CRM.fuState === 'error' ? 'error' : null;
    },
    error: function () {
      return crmErrWords(CRM.fuErr, 'follow-ups');
    },
    onRetry: function () {
      crmFuLoad();
    },
    empty: function () {
      return CRM.fuState === 'notyet'
        ? { title: tx('Calls and follow-ups start after an update.'), sub: tx('Nothing is lost.') }
        : { title: tx('No follow-ups.'), sub: tx('Add one from a party, or when you log a call.') };
    },
    search: function (f) {
      return [f.what, f.party_name, f.party_no, f.assignee_name].join(' ');
    },
    searchHint: tx('Search follow-ups'),
    /* Mine / Everyone and Open / Done are the server's two questions (?scope= · ?done=): they sit in the unit's Filters like any other, and the page asks again when they change */
    filters: [
      {
        key: 'scope',
        label: tx('Show'),
        all: tx(def === 'all' ? 'Everyone' : 'Mine'),
        options: [{ v: def === 'all' ? 'mine' : 'all', label: tx(def === 'all' ? 'Mine' : 'Everyone') }],
        match: function () {
          return true;
        }
      },
      {
        key: 'done',
        label: tx('State'),
        all: tx('Open'),
        options: [{ v: '1', label: tx('Done') }],
        match: function () {
          return true;
        }
      },
      {
        key: 'source',
        label: tx('Source'),
        all: tx('Any source'),
        options: [
          { v: 'manual', label: tx('Manual') },
          { v: 'dues', label: tx('Dues') },
          { v: 'interaction', label: tx('From a call') }
        ],
        match: function (f, v) {
          return f.source === v;
        }
      }
    ],
    sorts: [
      {
        key: 'due',
        label: tx('Due'),
        cmp: by(function (f) {
          return f.due_at || '';
        })
      },
      {
        key: 'party',
        label: tx('Party'),
        cmp: by(function (f) {
          return f.party_name || '';
        })
      },
      {
        key: 'created',
        label: tx('Created'),
        cmp: by(function (f) {
          return f.created_at || '';
        })
      }
    ],
    group: {
      default: 'on',
      tid: 'crm-fu',
      order: ['late', 'today', 'week', 'later'],
      by: function (f) {
        var b = f.bucket || 'later';
        return [tx(CRM_BUCKET[b] || b), b];
      }
    },
    onOpen: function (f) {
      if (!f.party_removed) crmGo('#/party/' + encodeURIComponent(f.party_no || f.party_id));
    },
    next: crmFuMini,
    nextPending: crmFuMini,
    actions: crmFuActions()
  });
  crmWatch(el, function (c) {
    CRM.fuScope = c.filt.scope || def;
    CRM.fuDone = c.filt.done === '1';
    crmFuLoad();
  });
  if (!frame) crmFuLoad();
}
async function crmFuAct(id, body, done) {
  try {
    await api('crmFollowSet', { params: { id: id }, body: body });
    if (done) done();
    toast(tx('Saved'));
    CRM.fu = CRM.fu.filter(function (item) {
      return item.followup_id !== id || !body.done;
    });
    crmFuLoad();
    crmLoad(true);
  } catch (e) {
    toast(e && e.status === 503 ? tx('Calls and follow-ups start after an update. Nothing is lost.') : tx("Couldn't save that. Try again."));
  }
}

/* ═══ 3 · ADD PARTY — one field; look on ChitBridge and in your parties first (F1) ═══════════════════════════════ */
var ADD = { role: 'customer', q: '', busy: false, found: null };
function crmAddOpen(q) {
  ADD.q = q || '';
  ADD.found = null;
  ADD.busy = false;
  ui.dialog({
    mount: 'CRM001-U201',
    pop: 'POP095',
    title: 'Add party',
    testid: 'crm-add-sheet',
    body:
      '<p class="hint" style="margin:0">' +
      esc(tx('One field — we look on the network and in your parties first.')) +
      '</p>' +
      '<label>' +
      esc(tx('Who?')) +
      '<input data-cbsid="CRM001-I01" class="inp" id="crm_addq" data-testid="crm-addq" value="' +
      esc(ADD.q) +
      '" placeholder="' +
      esc(tx('Name, User ID, phone or e-mail')) +
      '" autocomplete="off"></label>' +
      '<div class="supacts"><span class="hint">' +
      esc(tx('As')) +
      '</span><div class="seg2" role="group" aria-label="' +
      esc(tx('Role')) +
      '"><button data-cbsid="CRM001-B08" type="button" data-crm="addrole" data-v="customer" aria-pressed="true" data-testid="crm-add-role-customer">' +
      esc(tx('Customer')) +
      '</button><button data-cbsid="CRM001-B09" type="button" data-crm="addrole" data-v="supplier" aria-pressed="false" data-testid="crm-add-role-supplier">' +
      esc(tx('Supplier')) +
      '</button><button data-cbsid="CRM001-B10" type="button" data-crm="addrole" data-v="both" aria-pressed="false" data-testid="crm-add-role-both">' +
      esc(tx('Both')) +
      '</button></div></div>' +
      '<div id="crm_addres" aria-live="polite" style="display:flex;flex-direction:column;gap:8px"></div>',
    actions: [
      { name: 'cancel', options: { mount: 'CRM001-U201' } }
    ]
  });
  ADD.role = 'customer';
  var node = document.getElementById('crm_addq');
  if (node) {
    node.focus();
    node.addEventListener('input', crmAddType);
    node.addEventListener('keydown', crmAddEnter);
  }
  crmAddResults();
}
/** Enter in the one field (rule 4): read what was typed now, not after the pause, then press the one way forward when there is exactly one (Add as local); with matches to choose from nothing is added for them */
function crmAddEnter(ev) {
  if (ev.key !== 'Enter' || ev.isComposing) return;
  ev.preventDefault();
  clearTimeout(_addT);
  crmAddSearch().then(function () {
    var only = document.querySelector('#crm_addres [data-sheet-save]');
    if (only) only.click();
  });
}
var _addT = null;
function crmAddType(ev) {
  ADD.q = ev.target.value;
  clearTimeout(_addT);
  _addT = setTimeout(crmAddSearch, 250);
  crmAddResults();
}
async function crmAddSearch() {
  var q = ADD.q.trim();
  ADD.found = null;
  if (q.length < 2 || (q.indexOf('@') >= 0 && !/\S+@\S+\.\S+/.test(q))) {
    crmAddResults();
    return;
  }
  var mine = q;
  try {
    var reply = await api('entitySearch', { query: { q: q } });
    if (ADD.q.trim() === mine) ADD.found = (reply && (reply.results || reply.entities)) || (Array.isArray(reply) ? reply : []);
  } catch (_) {
    ADD.found = [];
  }
  crmAddResults();
}
function crmAddResults() {
  var box = document.getElementById('crm_addres');
  if (!box) return;
  var text = ADD.q.trim(),
    ql = text.toLowerCase(),
    h = '';
  if (!text) {
    box.innerHTML =
      '<p class="hint" style="margin:0">' + esc(tx('Type a name to add a local party, or a User ID / e-mail to find them on the network.')) + '</p>';
    return;
  }
  var mine = CRM.rows
    .filter(function (item) {
      return [item.display_name, item.nickname, item.party_no, item.user_id, item.phone, item.email].join(' ').toLowerCase().indexOf(ql) >= 0;
    })
    .slice(0, 4);
  mine.forEach(function (item) {
    h +=
      '<div class="result" data-testid="crm-add-mine"><span><span class="k">' +
      esc(tx('Already your party')) +
      '</span><b>' +
      esc(item.display_name) +
      '</b> <span class="pno mono">' +
      esc(item.party_no || '') +
      '</span><br>' +
      crmRoleChips(item) +
      ' ' +
      crmRailChip(item) +
      '</span>' +
      '<button data-cbsid="CMP010" type="button" class="act sm ghost" data-crm="addopen" data-k="' +
      esc(crmKey(item)) +
      '">' +
      esc(tx('Open')) +
      '</button></div>';
  });
  (ADD.found || []).forEach(function (e, index) {
    h +=
      '<div class="result" data-testid="crm-add-found"><span><span class="k">' +
      esc(tx('On the network — is this them?')) +
      '</span><b>' +
      esc(e.display_name) +
      '</b><br><span class="mono hint">' +
      esc(e.user_id || '') +
      '</span><span class="hint">' +
      (e.city ? ' · ' + esc(e.city) : '') +
      '</span></span>' +
      '<button data-cbsid="CMP007" type="button" class="act sm" data-crm="addfound" data-i="' +
      index +
      '" data-testid="crm-add-this">' +
      esc(tx('Add')) +
      '</button></div>';
  });
  if (text.indexOf('@') >= 0 && !/\S+@\S+\.\S+/.test(text))
    h +=
      '<div class="banner" data-testid="crm-add-warn">' +
      crmIcon('warn') +
      '<span>' +
      esc(tx('Use their User ID or e-mail to find them on the network.')) +
      '</span></div>';
  else
    h +=
      '<div class="result" data-testid="crm-add-local"><span><span class="k">' +
      esc(tx('Not on the network')) +
      '</span><b>' +
      esc(txf('Add “{q}” as a local party', { q: text })) +
      '</b><br><span class="hint">' +
      esc(tx('Bills are yours only until they join.')) +
      '</span></span>' +
      '<button data-cbsid="CRM001-B11" type="button" class="act sm ghost" data-crm="addlocal" data-testid="crm-add-local-go"' + (mine.length || (ADD.found || []).length ? '' : ' data-sheet-save') + '>' +
      esc(tx('Add as local')) +
      '</button></div>';
  box.innerHTML = h;
}
async function crmAddGo(kind, byHandle) {
  if (ADD.busy) return;
  ADD.busy = true;
  var role = ADD.role,
    both = role === 'both',
    first = both ? 'customer' : role,
    ep = first === 'supplier' ? 'supAdd' : 'custAdd',
    name = ADD.q.trim().replace(/\s+/g, ' ');
  var bodyFor = function (rl) {
    return kind === 'found' ? (rl === 'supplier' ? { supplier_bridge_id: byHandle.bridge_id } : { handle: byHandle.user_id }) : { name: name };
  };
  try {
    var reply = await api(ep, { body: bodyFor(first) });
    if (both) await api('supAdd', { body: bodyFor('supplier') }); /* "Both" = the two EXISTING adds; the second finds the same party and adds the other role */
    var made = (reply && (reply.customer || reply.supplier)) || {},
      id = made.customer_identity_id || made.supplier_entity_id;
    closeModal();
    toast(tx(both ? 'Customer and supplier added' : role === 'supplier' ? 'Supplier added' : 'Customer added') + ': ' + (made.display_name || ADD.q));
    await crmLoad(true);
    var p = id && CRM.byKey[id];
    crmGo(p ? '#/party/' + encodeURIComponent(crmKey(p)) : '#/parties');
  } catch (e) {
    toast((e && e.message) || tx("Couldn't add that. Try again."));
  }
  ADD.busy = false;
}

/* ═══ 4 · ADD FOLLOW-UP — party picker · what · when (presets write into the date) · who ═════════════════════════ */
var FUADD = { party: null, asked: false };
function crmFuAddOpen(partyKey, then, prefill) {
  var p = partyKey && CRM.byKey[partyKey];
  FUADD.party = p || null;
  FUADD.asked = false;
  FUADD.then = then || null;
  FUADD.source = (prefill && prefill.source) || 'manual';
  ui.dialog({
    mount: 'CRM001-U202',
    pop: 'POP097',
    title: 'Add follow-up',
    testid: 'crm-fu-sheet',
    body:
      '<label>' +
      esc(tx('Party')) +
      '<input data-cbsid="CRM001-I02" class="inp" id="crm_fu_pq" data-testid="crm-fu-pq" placeholder="' +
      esc(tx('Name or party no')) +
      '" autocomplete="off" value="' +
      esc(p ? p.display_name : '') +
      '"></label>' +
      '<div id="crm_fu_pres" style="display:flex;flex-direction:column;gap:6px"></div>' +
      '<label>' +
      esc(tx('What')) +
      '<input data-cbsid="CRM001-I03" class="inp" id="crm_fu_what" data-testid="crm-fu-what" placeholder="' +
      esc(tx('Call back about…')) +
      '" value="' +
      esc((prefill && prefill.what) || '') +
      '"></label>' +
      '<label>' +
      esc(tx('When')) +
      '<input data-cbsid="CRM001-I04" class="inp" id="crm_fu_due" data-testid="crm-fu-due" type="date"></label>' +
      '<div class="supacts">' +
      [
        ['today', 'Today'],
        ['tomorrow', 'Tomorrow'],
        ['week', 'Next week']
      ]
        .map(function (x) {
          return (
            '<button data-cbsid="CRM001-B12" type="button" class="crm-mini" data-crm="fupreset" data-v="' +
            x[0] +
            '" data-testid="crm-fu-preset-' +
            x[0] +
            '">' +
            esc(tx(x[1])) +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '<label>' +
      esc(tx('Who')) +
      '<select data-cbsid="CRM001-S01" class="inp" id="crm_fu_who" data-testid="crm-fu-who"><option value="">' +
      esc(tx('Me')) +
      '</option>' +
      (CRM.coAssists || [])
        .map(function (item) {
          return '<option value="' + esc(item.user_id) + '">' + esc(item.name) + '</option>';
        })
        .join('') +
      '</select></label>' +
      '<div id="crm_fu_msg" class="hint" role="status"></div>',
    actions: [
      { name: 'cancel', options: { mount: 'CRM001-U202' } },
      { name: 'save', options: { mount: 'CRM001-U202', key: 'save', effect: 'preference', testid: 'crm-fu-save', data: { crm: 'fusave' } } }
    ]
  });
  var node = document.getElementById('crm_fu_pq');
  if (node) {
    node.addEventListener('input', function () {
      FUADD.party = null;
      crmFuPicker(node.value);
    });
    if (!p) node.focus();
    else document.getElementById('crm_fu_what').focus();
  }
}
function crmFuPicker(q) {
  var box = document.getElementById('crm_fu_pres');
  if (!box) return;
  q = String(q || '')
    .trim()
    .toLowerCase();
  if (!q) {
    box.innerHTML = '';
    return;
  }
  if (!CRM.loaded) {
    crmFuPickerLoad(box);
    return;
  }
  var list = CRM.rows
    .filter(function (item) {
      return [item.display_name, item.nickname, item.party_no].join(' ').toLowerCase().indexOf(q) >= 0 && item.kind !== 'walk-in';
    })
    .slice(0, 5);
  box.innerHTML =
    list
      .map(function (item) {
        return (
          '<button data-cbsid="CRM001-B13" type="button" class="result" style="text-align:left;background:var(--surface)" data-crm="fupick" data-k="' +
          esc(item.party_id) +
          '" data-testid="crm-fu-pick-' +
          esc(crmKey(item)) +
          '"><span><b>' +
          esc(item.display_name) +
          '</b> <span class="pno mono">' +
          esc(item.party_no || '') +
          '</span></span></button>'
        );
      })
      .join('') || '<span class="hint">' + esc(tx('Nobody matches.')) + '</span>';
}
/**
 * R81: the picker searches the Parties list, which only the Parties page used to load - opened straight at #/followups (a bookmark, a reload)
 * it answered "Nobody matches." with nothing fetched. It now loads the list through crmLoad (the ONE loader Parties uses), once per open sheet, says
 * so while it waits, repaints with what the person typed, and says in words if the list could not be read.
 */
function crmFuPickerLoad(box) {
  var words = FUADD.asked && CRM.state === 'error' ? tx('Could not read your parties. Close this and try again.') : tx('Loading your parties…');
  box.innerHTML = '<span class="hint" role="status">' + esc(words) + '</span>';
  if (FUADD.asked) return;
  FUADD.asked = true;
  crmLoad(true).then(function () {
    var again = document.getElementById('crm_fu_pq');
    if (again) crmFuPicker(again.value);
  });
}
async function crmFuSave() {
  var node = function (id) {
      return String((document.getElementById(id) || {}).value || '').trim();
    },
    msg = document.getElementById('crm_fu_msg');
  if (!FUADD.party) {
    msg.textContent = tx('Pick a party first.');
    return;
  }
  if (!node('crm_fu_what')) {
    msg.textContent = tx('Say what to do.');
    return;
  }
  if (!node('crm_fu_due')) {
    msg.textContent = tx('Pick a day.');
    return;
  }
  var body = {
    party_id: FUADD.party.party_id,
    what: node('crm_fu_what'),
    due_at: node('crm_fu_due'),
    source: FUADD.source || 'manual'
  }; /* a bare date: the server lands it on the SHOP's day (W2-CRM) */
  if (node('crm_fu_who')) body.assignee_user_id = node('crm_fu_who');
  try {
    await api('crmFollowAdd', { body: body });
    var then = FUADD.then;
    closeModal();
    toast(tx('Follow-up added'));
    crmLoad(true);
    if (CRM.route && CRM.route.view === 'followups') crmFuLoad();
    if (then) then();
  } catch (e) {
    msg.textContent = e && e.status === 503 ? tx('Calls and follow-ups start after an update. Nothing is lost.') : tx("Couldn't save that. Try again.");
  }
}

/* ═══ ONE click door for every control this file draws outside a CBList cell (data-crm="…") ═════════════════════ */
/* the table of this file's own clicks (data-crm="…" → what happens); a row's args: the control, its data-id, its data-v, the event */
var CRM_CLICK = {
  add: function () {
    return crmGo('#/parties/add');
  },
  fuadd: function () {
    return crmFuAddOpen(null);
  },
  fudone: function (control, id, value, event) {
    event.stopPropagation();
    return crmFuAct(id, { done: true });
  },
  fusnooze: function (control, id, value, event) {
    event.stopPropagation();
    return crmFuAct(id, { after: control.getAttribute('data-when') === 'week' ? 'week' : 'tomorrow' });
  },
  fuassign: function (control, id, value, event) {
    event.stopPropagation();
    return crmFuAct(id, { assignee_user_id: SESSION.name || '' });
  },
  fudel: function (control, id, value, event) {
    event.stopPropagation();
    return api('crmFollowDel', { params: { id: id } }).then(
      function () {
        toast(tx('Deleted'));
        crmFuLoad();
      },
      function () {
        toast(tx("Couldn't delete that. Try again."));
      }
    );
  },
  addrole: function (control, id, value) {
    ADD.role = value;
    document.querySelectorAll('[data-crm="addrole"]').forEach(function (item) {
      item.setAttribute('aria-pressed', String(item.getAttribute('data-v') === value));
    });
  },
  addopen: function (control) {
    return crmGo('#/party/' + encodeURIComponent(control.getAttribute('data-k')));
  },
  addfound: function (control) {
    return crmAddGo('found', (ADD.found || [])[+control.getAttribute('data-i')]);
  },
  addlocal: function () {
    return crmAddGo('local');
  },
  fupreset: function (control, id, value) {
    document.getElementById('crm_fu_due').value = crmDayPlus(crmShopDay(), value === 'tomorrow' ? 1 : value === 'week' ? 7 : 0);
  } /* from the SHOP's day, not the phone's */,
  fupick: function (control) {
    FUADD.party = CRM.byKey[control.getAttribute('data-k')];
    document.getElementById('crm_fu_pq').value = FUADD.party.display_name;
    document.getElementById('crm_fu_pres').innerHTML = '';
  },
  fusave: function () {
    return crmFuSave();
  },
  minichit: function (control, id, value, event) {
    event.stopPropagation();
    if (typeof openChitSheet === 'function') openChitSheet(id);
  }
};
document.addEventListener('click', function (ev) {
  var node = ev.target.closest && ev.target.closest('[data-crm]');
  if (!node) return;
  var a = node.getAttribute('data-crm'),
    id = node.getAttribute('data-id'),
    v = node.getAttribute('data-v');
  if (CRM_CLICK[a]) return CRM_CLICK[a](node, id, v, ev);
  if (typeof crmLeadClick === 'function' && crmLeadClick(a, node)) return;
  if (typeof crmCallClick === 'function' && crmCallClick(a, node)) return;
  if (typeof crmGroupsClick === 'function' && crmGroupsClick(a, node)) return;
  if (typeof crmMarketingClick === 'function' && crmMarketingClick(a, node)) return;
  if (typeof crmRecordClick === 'function') return crmRecordClick(a, node, ev);
});
