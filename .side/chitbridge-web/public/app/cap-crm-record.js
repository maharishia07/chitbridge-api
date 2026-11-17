/* cap-crm-record.js — CB CRM: ONE party's record, its timeline, the Log sheet, the Next block, and the party edit.
 * FLOW  crmRecordOpen(route) → the party and timeline reads (crmParty · crmTimeline) → crmRecordPaint → the actions greyed by the server's may/why
 * CARD 11-crm-and-marketing/crm-record
 * OWNS  one party's record page and its timeline: the wire entry to page entry grammar (crmEntryFrom), the bill facts, the Log sheet, the party edit
 * CALLED BY  crm.html, through the router in cap-crm.js (crmRecordOpen)
 * Loaded by crm.html after cap-crm.js (which owns the list, the router and the shared helpers). docs/design/crm/REQUIREMENT-record.md ·
 * REQUIREMENT-timeline.md · FLOWS F3–F8 · the designer handoff, where the FROZEN list standard wins: both timeline views are CBList
 * mounts (the record's latest five, and the full server-paged history) — no entry, row or card is drawn by hand.
 *
 * ⭐ REUSE (rule 1): CBList (every list) · partyDueChipHTML / partyBooksHTML / partyStatementLoad / partyEditOpen / payOpen / bkMoney / bkDate
 * (cap-books.js — the Ledger block, the dues chip, the edit sheet, Receive/Pay) · openChitSheet (chit-sheet.js — a chit, bill or message
 * opens in place) · CBLedger.run (accounts-shell.js — the Switch on) · custPatch/supPatch/custAdd (the existing relationship routes).
 * ⭐ ONE CALCULATION (rule 2): no money, no due-ness, no step and no on-ChitBridge is worked out here. Amounts are `amount_minor` /
 * `balance_minor` / `credit_limit_minor` painted by bkMoney; "late" is the server's; a bill's step word is the server's `state.word`;
 * the place-of-supply words are mapped from the server's `supply_type`.
 * ⭐ NEW PATHS (rule 4): the identity block + Next block + entry grammar (REQUIREMENT-record §4 — nothing gathered these per party; each
 * is an arrangement of existing tokens), the Log sheet (no store or sheet for a call/visit/note existed), `crmRemove` (DELETE /api/crm/parties/:id).
 */
'use strict';
var CRMR = { tok: 0, p: null, rec: null, menu: false, tl: null, tlApi: null, headApi: null, keep: {} };

/* what a kind looks like: [icon, tone-when-the-state-gives-none, word for screen readers] */
var CRM_KIND = {
  chit: ['chit', '', 'Chit'],
  message: ['msg', 'blue', 'Message'],
  message_internal: ['msg', '', 'Internal message'],
  bill: ['bill', '', 'Bill'],
  payment: ['pay', 'green', 'Payment'],
  dispute: ['flag', 'red', 'Dispute'],
  call: ['phone', '', 'Call'],
  visit: ['pin', '', 'Visit'],
  whatsapp: ['wa', 'green', 'WhatsApp'],
  note: ['note', '', 'Note'],
  mail: ['mail', '', 'Mail'],
  followup: ['clock', 'amber', 'Follow-up'],
  change: ['pencil', '', 'Change'],
  link: ['link', 'green', 'Linked'],
  stage: ['pencil', '', 'Stage'] /* a lead's move (memberships, read by the timeline — FX-L2C F7) */
};
var CRM_TABS = [
  ['all', 'All'],
  ['messages', 'Messages'],
  ['bills', 'Bills'],
  ['notes', 'Notes & calls'],
  ['mail', 'Mail'],
  ['followups', 'Follow-ups']
];
var CRM_SUPPLY = { intra: 'Same state — CGST and SGST', inter: 'Another state — IGST' };
var CRM_ADDED = {
  counter: 'Your counter',
  storefront: 'Your online shop',
  catalogue: 'Your online shop',
  handle: 'A User ID search',
  name: 'A name you typed',
  chit: 'A chit',
  import: 'An import'
};
var CRM_CHANNEL = { catalogue: 'online shop', storefront: 'online shop', counter: 'counter' };
/** a title that repeats the entry's own date ("Order · 09 Oct") loses the date: the When column says it once (C17) */
function crmNoDate(text) {
  text = String(text || '');
  if (!text) return '';
  var u = text
    .replace(/\s*[\u00b7,(\-\u2013\u2014]*\s*\b\d{4}-\d{2}-\d{2}\b\)?\s*$/, '')
    .replace(/\s*[\u00b7,(\-\u2013\u2014]*\s*\b\d{1,2}[ /-](?:[A-Za-z]{3,9}|\d{1,2})\.?(?:[ ,/-]+\d{2,4})?\)?\s*$/, '')
    .replace(/[\s\u00b7,\-\u2013\u2014]+$/, '');
  return u || text;
}
/** bills only, and the orders that have not been billed yet - from the entries the page already holds (C18/C22) */
function crmBillFacts(entries) {
  var chitBills = 0,
    ledBills = 0,
    lastBill = '',
    un = { n: 0, minor: 0, currency: null, hidden: 0 };
  (entries || []).forEach(function (e) {
    if (e.kind === 'bill') {
      if (e.src === 'ledger') ledBills++;
      else chitBills++;
      if (!lastBill || e.at > lastBill) lastBill = e.at;
    } else if (e.src === 'chit' && e.kind === 'chit' && /order/i.test(e.purpose || '') && !/cancel|reject|declin/i.test((e.state && e.state.word) || '')) {
      un.n++;
      if (e.amount_hidden) un.hidden++; // RAIL-146h: a figure the server hid is left out of the total (an unpriced order, null without the flag, still adds 0)
      else un.minor += Number(e.amount_minor || 0);
      un.currency = un.currency || e.currency;
    }
  });
  return { bills: Math.max(chitBills, ledBills), lastBill: lastBill, unbilled: un };
}
var CRM_CHAN = { chitbridge: 'ChitBridge', email: 'E-mail', phone: 'Phone', sms: 'SMS', whatsapp: 'WhatsApp' };

/* ═══ THE API'S REAL SHAPES (chitbridge-api routes/crm.js) → the shapes this page paints ═════════════════════════════════
   ⚠️ Found live 2026-10-03: GET /api/crm/parties/:id sends roles as an OBJECT, merged_from as { party_id, party_no }, points as
   { programme, points, worth } and NO contacts / prefs / timeline_head; the old reader spread it over the list row, crmRoleChips threw on the
   object, and the record sat on "Reading…" for good. The mapping is HERE, once, so the painter below still reads one shape. */
function crmRecordFrom(rec, p) {
  var r = Object.assign({}, rec || {});
  r.roles = crmRolesList(r.roles);
  if (r.merged_from && typeof r.merged_from === 'object') r.merged_from = r.merged_from.party_no || r.merged_from.party_id || null;
  if (r.points && r.points.balance == null && r.points.points != null) r.points = Object.assign({}, r.points, { balance: r.points.points });
  if (!r.contacts) {
    var ph = r.phone || r.otp_contact || (p && p.phone) || '',
      em = crmRealEmail(r.email || (p && p.email) || '');
    r.contacts = { phones: ph ? [ph] : [], emails: em ? [em] : [], address: null };
  }
  /* O6 / C9: an internal sign-in handle (…@<shop>.cr) is not an e-mail, wherever it came from */
  if (r.contacts && Array.isArray(r.contacts.emails))
    r.contacts = Object.assign({}, r.contacts, { emails: r.contacts.emails.map(crmRealEmail).filter(Boolean) });
  if (r.gstn_profile === undefined) r.gstn_profile = r.gstin && r.gstin.differs ? r.gstin.theirs : null; // the API says "differs"; the page offers "Use theirs"
  /* the credit terms come in `terms`, one per side; the painter and the edit sheet read them off the side */
  ['customer', 'supplier'].forEach(function (item) {
    if (r[item] && r.terms && r.terms[item]) r[item] = Object.assign({}, r[item], r.terms[item]);
  });
  if (r.customer && r.customer.last_bill_at === undefined) r.customer = Object.assign({}, r.customer, { last_bill_at: r.customer.last_txn_at });
  if (!Array.isArray(r.followups)) r.followups = [];
  return r;
}
/** who made a change, in words; a machine's id (a shop uuid) is never a name, so it says nothing (R109) */
function crmWho(by) {
  return cbIsRawId(by) ? '' : by || '';
}
/** RAIL-146h: a chit or ledger entry whose money the server took off (a cost-blind reader: figure null + cost_hidden) is marked, so the Amount column says "hidden" and not a dash */
function crmMarkHidden(entry, wire) {
  var figure = entry.src === 'chit' ? wire.value : wire.amount_minor;
  if ((entry.src === 'chit' || entry.src === 'ledger') && figure == null && wire.cost_hidden) entry.amount_hidden = true;
  return entry;
}
function crmEntryFrom(e, i) {
  if (e && e.line != null && e.id != null) return e; // already the page's grammar (the design stand-in's) — accepted as is
  var at = e.at || '',
    k = e.kind,
    key = e.interaction_id || e.followup_id || e.dispute_id || e.membership_id || e.chit_id || e.ref || e.field || '';
  /* a stable id (it is the row's test id and its key): the API's own id for the thing, plus the time where the same id can appear twice (a message, a ledger item, a change) */
  var o = { at: at, kind: k, line: '', by: '', id: k + '-' + key + (/^(message|ledger|change|followup_done)$/.test(k) ? '-' + Date.parse(at) : '') };
  if (e.chit_id) o.chit_id = e.chit_id;
  if (e.followup_id) o.followup_id = e.followup_id;
  var word = function (text) {
    text = String(text || '').replace(/_/g, ' ');
    return text ? tx(text.charAt(0).toUpperCase() + text.slice(1)) : '';
  };
  if (k === 'chit') {
    o.kind = e.doc_kind === 'bill' ? 'bill' : 'chit';
    o.src = 'chit';
    o.purpose = e.purpose || '';
    o.line = crmNoDate(e.title) || e.bill_no || word(e.purpose) || tx('Chit');
    if (e.status) o.state = { word: word(e.status) };
    if (e.value != null) {
      o.amount_minor = bkToMinor(e.value, e.currency);
      o.currency = e.currency;
    } // summary_json total_value is in MAJOR units, not minor
    o.theirs = e.direction === 'in';
    /* WHO and by which door: the party placed it ("athi · online shop"), or you did */
    var pp = CRMR.p,
      who = pp ? pp.nickname || pp.display_name || '' : '',
      ch = o.theirs && /order/i.test(e.purpose || '') ? CRM_CHANNEL[CRMR.added] : '';
    o.by = o.theirs ? who + (ch ? ' · ' + tx(ch) : '') : tx('You');
  } else if (k === 'message') {
    o.line = e.text || '';
    o.by = e.who || '';
  } else if (k === 'dispute') {
    o.line = tx('Dispute') + (e.category ? ' · ' + word(e.category) : '');
    if (e.status) o.state = { word: word(e.status), tone: 'red' };
  } else if (k === 'ledger') {
    o.kind = e.ledger_kind === 'bill' ? 'bill' : 'payment';
    o.src = 'ledger';
    o.amount_minor = e.amount_minor;
    o.currency = e.currency;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(e.doc_date || ''))) o.doc_date = e.doc_date; /* a day the wire cut short ("Thu Oct 08") is not kept: the When cell then shows the entry's own moment */
    o.line = crmLedgerLine(e, o.kind);
  } else if (k === 'interaction') {
    var ik = e.interaction_kind;
    o.kind = ik === 'message' ? 'whatsapp' : CRM_KIND[ik] ? ik : 'note';
    o.line = e.body || '';
    o.direction = e.direction || '';
  } else if (k === 'followup') o.line = e.what || '';
  else if (k === 'followup_done') {
    o.kind = 'followup';
    o.line = tx('Done') + ' · ' + (e.what || '');
  } else if (k === 'change') {
    o.line = word(e.field) + (e.old != null || e.new != null ? ': ' + (e.old == null ? '—' : e.old) + ' → ' + (e.new == null ? '—' : e.new) : '');
    o.by = crmWho(e.by); /* R109: a change row never says who by a shop id */
  }
  /* a stage move: who · when · from → to (the server's memberships row; the words are the Leads module's CRM_STAGE) */
  else if (k === 'stage') {
    var SW = typeof CRM_STAGE === 'object' ? CRM_STAGE : {},
      to = tx(SW[e.stage] || e.stage || '');
    o.line = e.from ? txf('Moved to {to} · from {from}', { to: to, from: tx(SW[e.from] || e.from) }) : txf('Added as {to}', { to: to });
    o.by = crmWho(e.by);
  } else o.line = e.line || e.title || '';
  return crmMarkHidden(o, e);
}
function crmEntriesFrom(r) {
  return ((r && r.entries) || []).map(crmEntryFrom);
}

/* ═══ THE TIMELINE ENTRY — one grammar for every kind: mark · line · by · time · chip (REQUIREMENT-timeline §4) ═══════ */
var CRM_LONG = 110;
/** a long call / visit / WhatsApp / note ends "…" and opens in place to its whole text (REQUIREMENT-timeline §4) */
function crmEntryLine(e) {
  var text = String(e.line || '');
  return /^(call|visit|whatsapp|note)$/.test(e.kind) && text.length > CRM_LONG ? text.slice(0, Math.max(text.lastIndexOf(' ', CRM_LONG), 40)) + '…' : text;
}
function crmEntryWhat(e) {
  var k = CRM_KIND[e.kind] || CRM_KIND.note,
    tone = (e.state && e.state.tone) || k[1] || '';
  var unread = e.thread && e.thread.unread;
  return (
    '<div class="entry' +
    (e.theirs ? ' theirs' : '') +
    '" data-testid="crm-entry-' +
    esc(e.id) +
    '" data-kind="' +
    esc(e.kind) +
    '"><span class="mk ' +
    esc(tone) +
    '" title="' +
    esc(tx(k[2])) +
    '">' +
    crmIcon(k[0]) +
    '<span class="sr-only">' +
    esc(tx(k[2])) +
    '</span></span>' +
    '<span class="tx"><span' +
    (unread ? ' class="unread-line"' : '') +
    '>' +
    (unread ? '<span class="udot" title="' + esc(tx('Unread')) + '"></span> ' : '') +
    esc(crmEntryLine(e)) +
    '</span>' +
    (e.kind === 'message_internal' ? '<span class="tagi">' + esc(tx('internal')) + '</span>' : '') +
    (e.thread && e.thread.count > 1 ? ' <span class="sub">+' + (e.thread.count - 1) + ' ' + esc(tx('more')) + '</span>' : '') +
    '<span class="by">' +
    (e.theirs ? '<span style="color:var(--blue-i)">↙</span> ' : '') +
    esc(e.by || '') +
    (e.direction ? (e.by ? ' · ' : '') + esc(tx(e.direction === 'in' ? 'incoming' : 'outgoing')) : '') +
    '</span></span></div>'
  ); /* never a lone "· out" (ai-eye E-16/E-20) */
}
function crmEntryState(e) {
  var h = '';
  if (e.state && e.state.word)
    h += '<span class="tag ' + esc(e.state.tone || '') + '" data-testid="crm-state-' + esc(e.id) + '">' + esc(e.state.word) + '</span>';
  if (e.fix && crmEdit())
    h += ' <button data-cbsid="CRM006-B01" type="button" class="crm-mini" data-crm="fixaddr" data-testid="crm-fix-' + esc(e.id) + '">' + esc(tx(e.fix)) + '</button>';
  return h || '<span class="sub">—</span>';
}
function crmTlCols() {
  return [
    {
      key: 'what',
      label: 'What',
      prio: 1,
      w: 560,
      html: true,
      cell: crmEntryWhat,
      value: function (e) {
        return e.line;
      }
    },
    {
      key: 'when',
      label: 'When',
      prio: 2,
      w: 150,
      html: true,
      cell: crmWhenCell,
      value: function (e) {
        return e.doc_date || e.at;
      }
    },
    {
      key: 'amount',
      label: 'Amount',
      prio: 2,
      w: 120,
      pin: 'end',
      html: true,
      cell: function (e) {
        return e.amount_minor != null
          ? '<span class="mono" data-testid="crm-amt-' + esc(e.id) + '">' + esc(bkMoney(e.amount_minor, e.currency)) + '</span>'
          : '<span class="sub"' + (e.amount_hidden ? ' data-testid="crm-amt-hidden-' + esc(e.id) + '"' : '') + '>' + (e.amount_hidden ? esc(tx('hidden')) : '\u2014') + '</span>';
      },
      value: function (e) {
        return e.amount_minor == null ? '' : e.amount_minor;
      }
    },
    {
      key: 'state',
      label: 'State',
      prio: 3,
      w: 210,
      html: true,
      cell: crmEntryState,
      value: function (e) {
        return (e.state && e.state.word) || '';
      }
    }
  ];
}
function crmEntryNext(e) {
  var long = /^(call|visit|whatsapp|note)$/.test(e.kind);
  return (
    '<div data-testid="crm-entry-next-' +
    esc(e.id) +
    '">' +
    (long
      ? '<div style="white-space:pre-wrap;max-width:72ch;overflow-wrap:anywhere" data-testid="crm-entry-full-' + esc(e.id) + '">' + esc(e.line) + '</div>'
      : '') +
    CBList.nextRow(
      ['<span style="color:var(--muted)">' + esc(tx('By')) + '</span> ' + esc(e.by || '—') + ' · ' + esc(bkDate(e.at)) + ' ' + esc(bkTime(e.at))],
      []
    ) +
    '</div>'
  );
}
function crmEntryOpen(e) {
  if (e.chit_id) return openChitSheet(e.chit_id);
  if (e.followup_id) return crmGo('#/followups');
}
function crmDayGroup(e) {
  var date = new Date(e.at);
  return [crmDayWord(e.at), isNaN(date) ? 'x' : crmLocalISO(date)];
}

/* ═══ THE RECORD ═════════════════════════════════════════════════════════════════════════════════════════════════ */
/** the record read or paint failed: a plain line and Try again in the loading spot (or under the header, or alone), never "Reading…" for good */
function crmRecordOpenFailed(node) {
  var w = node.querySelector('.loadwrap'),
    html =
      '<div class="empty" data-testid="crm-rec-error"><div class="t">' +
      esc(tx("Couldn't open this party.")) +
      '</div><button data-cbsid="CMP009" type="button" class="act ghost" data-crm="recretry" data-testid="crm-rec-retry">' +
      esc(tx('Try again')) +
      '</button></div>';
  if (w) w.outerHTML = html;
  else {
    var rr = node.querySelector('.rec');
    if (rr) rr.insertAdjacentHTML('beforeend', html);
    else node.innerHTML = '<div class="content">' + html + '</div>';
  }
}
async function crmRecordOpen(route) {
  var tok = ++CRMR.tok,
    node = document.getElementById('screen');
  CRMR.menu = false;
  if (!CRM.loaded) {
    node.className = 'screen';
    node.innerHTML = '<div class="content"><div class="loadwrap" role="status"><span class="spin"></span>' + esc(tx('Reading…')) + '</div></div>';
    await crmLoad(true);
    if (tok !== CRMR.tok) return;
  }
  var p = CRM.byKey[route.key];
  if (!p && typeof crmLeadsEnsure === 'function') {
    await crmLeadsEnsure();
    if (tok !== CRMR.tok) return;
    p = CRM.byKey[route.key];
  } /* a lead opened from a link: the Leads read first */
  if (!p) return crmRecordFold(route, tok);
  crmNav(p.lead ? 'leads' : 'parties');
  CRMR.p = p;
  CRMR.rec = null;
  var back =
    '<a href="#/parties" data-testid="crm-back">‹ ' +
    esc(tx('Parties')) +
    '</a>' +
    (p.party_no ? ' <span class="sub">/</span> <span class="mono">' + esc(p.party_no) + '</span>' : '');
  crmBar(back, route.sub === 'timeline' ? '' : '');
  if (route.sub === 'timeline') return crmTimelineView(p, tok);
  node.className = 'screen';
  /* header from the list row at once (no flash); the sections fill as the record read returns */
  node.innerHTML =
    '<div class="rec" data-testid="crm-record">' +
    crmHeaderHTML(p) +
    '<div class="loadwrap" role="status" data-testid="crm-rec-loading"><span class="spin"></span>' +
    esc(tx('Reading…')) +
    '</div></div>';
  var rec,
    head = null,
    tlFailed = false;
  try {
    /* a walk-in is a phone that holds points, not a party: the API has no record of it (its party_id is null) - the row is all there is */
    var got =
      p.kind === 'walk-in'
        ? [{}, null]
        : await Promise.all([
            api('crmParty', { params: { id: p.party_id } }),
            api('crmTimeline', { params: { id: p.party_id }, query: { limit: 100 } }).catch(function () {
              tlFailed = true; /* R70: a history that could not be read is NOT an empty history: the card says so and offers Try again */
              return null;
            })
          ]);
    rec = got[0];
    head = got[1];
    crmMaySet(crmMayOf(rec)); /* the server's may/why for this login rides the record (W2-CRM) */
    /* the person may have LEFT this record while the read was out (WX-L2C: a stage move re-reads the record; Leads opened meanwhile, and the
       record painted over the Leads list under the Leads bar): a read that lands on another screen paints nothing */
    if (tok !== CRMR.tok || CRM.route !== route) return;
    rec = crmRecordFrom(rec, p);
    CRMR.added = (rec.customer && rec.customer.added_via) || '';
    /* the latest five are shown; the same read (up to 100) is what "bills" and "orders not billed yet" are counted from - no new route */
    rec.timeline_all = head ? crmEntriesFrom(head) : [];
    if (!rec.timeline_head) rec.timeline_head = rec.timeline_all.slice(0, 5);
    rec.timeline_failed = tlFailed && !rec.timeline_head.length;
    CRMR.rec = rec;
    crmRecordPaint(p, CRMR.rec);
  } catch (e) {
    /* ANY failure — the read or the paint — ends the spinner: a plain line and Try again, never "Reading…" for good */
    if (tok !== CRMR.tok || CRM.route !== route) return;
    crmRecordOpenFailed(node);
    return;
  }
  if (route.sub === 'log') crmLogOpen(p);
  else if (route.sub === 'edit') crmEditOpen(p);
}
/** a key that is no row: a folded party opens its keeper once with "Merged from …" (the server answers the keeper's record) */
async function crmRecordFold(route, tok) {
  var node = document.getElementById('screen');
  try {
    var rec = await api('crmParty', { params: { id: route.key } });
    if (tok !== CRMR.tok) return;
    crmMaySet(rec && rec.may);
    var keeper = rec && CRM.byKey[rec.party_id];
    if (keeper) {
      CRMR.mergedNote =
        (rec.merged_from && (rec.merged_from.party_no || rec.merged_from.party_id)) ||
        (typeof rec.merged_from === 'string' ? rec.merged_from : '') ||
        route.key;
      return crmGo('#/party/' + encodeURIComponent(crmKey(keeper)), true);
    }
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  if (tok !== CRMR.tok) return;
  crmBar('<a href="#/parties">‹ ' + esc(tx('Parties')) + '</a>', '');
  node.className = 'screen';
  node.innerHTML =
    '<div class="content"><div class="empty" data-testid="crm-rec-missing"><div class="t">' +
    esc(tx("Couldn't open this party.")) +
    '</div><a class="act ghost" href="#/parties">' +
    esc(tx('Back to parties')) +
    '</a></div></div>';
}
function crmDueChip(p) {
  var said = crmUnbilledSaid(p.billFacts && p.billFacts.unbilled, CRM.currency);
  if (!CRM.ledger || p.balance_minor == null) return said ? '<span class="tag amber" data-testid="crm-unbilled">' + esc(said) + '</span>' : '';
  if (!Number(p.balance_minor || 0) && said)
    return (
      '<span class="due settled" data-testid="party-due-' +
      esc(p.party_id) +
      '">' +
      esc(tx('Settled')) +
      ' \u00b7 <span data-testid="crm-unbilled">' +
      esc(said) +
      '</span></span>'
    );
  return crmDueCell(p) + (said ? ' <span class="tag amber" data-testid="crm-unbilled">' + esc(said) + '</span>' : '');
}
function crmHeaderHTML(p) {
  var legal = p.legal_name && p.legal_name !== p.display_name ? '<div class="legal" data-testid="crm-legal">' + esc(p.legal_name) + '</div>' : '';
  return (
    '<div class="rhead"><h1 data-testid="crm-rec-name">' +
    esc(p.display_name) +
    '</h1>' +
    legal +
    '<div class="rchips">' +
    crmRoleChips(p) +
    crmRailChip(p) +
    (crmIsLead(p) && !Number(p.balance_minor || 0) ? '' : crmDueChip(p)) +
    crmSegChip(p) +
    crmStageChip(p.lead) +
    '</div></div>'
  ); /* a lead with nothing due is not "Settled": nothing was ever due (WX-L2C) */
}
function crmIdentityHTML(p, rec) {
  if (p.kind === 'walk-in')
    return (
      '<div class="idblk walk" data-testid="crm-ident"><div class="verdict off">' +
      crmIcon('walk') +
      '<span>' +
      esc(tx('Walk-in — known by phone at the counter. A party number comes when you add them.')) +
      '</span></div></div>'
    );
  var on = !!p.on_chitbridge,
    minted = p.kind === 'local' || !p.bridge_id;
  var cell = function (k, v, none, tid) {
    return (
      '<div class="c"><div class="k">' +
      esc(tx(k)) +
      '</div><div class="v' +
      (v ? '' : ' none') +
      '" data-testid="' +
      tid +
      '">' +
      (v ? esc(v) : esc(tx(none))) +
      '</div></div>'
    );
  };
  var shopper =
    p.why_not === 'shopper' ||
    (!on &&
      !minted &&
      !!p.bridge_id &&
      p.why_not !== 'inactive' &&
      p.why_not !== 'other_population'); /* a minted party (kind 'local') is never a shopper account, bridge_id or not (WX-L2C) */
  var why =
    p.why_not === 'inactive'
      ? 'Account inactive — bills are yours only.'
      : p.why_not === 'other_population'
        ? 'Test space — bills are yours only.'
        : shopper
          ? 'A shopper account on the network — they order from your shop. Bills are yours only.'
          : 'Not on the network — bills are yours only.';
  return (
    '<div class="idblk' +
    (on ? '' : ' local') +
    '" data-testid="crm-ident">' +
    '<div class="cells">' +
    cell('Party no', p.party_no, '—', 'crm-id-no') +
    (!minted && p.user_id ? cell('User ID', p.user_id, '—', 'crm-id-user') : '') +
    (!minted && p.bridge_id ? cell('Network ID', p.bridge_id, '—', 'crm-id-bridge') : '') +
    '</div>' +
    (on
      ? '<div class="verdict on" data-testid="crm-verdict">' +
        crmIcon('link') +
        '<span><b>' +
        esc(tx('On the network')) +
        '</b> — ' +
        esc(tx('bills, orders and messages reach them in their app.')) +
        '</span></div>'
      : '<div class="verdict off" data-testid="crm-verdict">' + crmIcon('house') + '<span>' + esc(tx(why)) + '</span></div>') +
    '</div>'
  );
}
/* ── Next: only failing or due things, each with its button (SYSTEM rule 1) ── */
function crmNextHTML(p, rec) {
  var items = [],
    ed = crmEdit(),
    key = esc(crmKey(p));
  var btn = function (a, label, pri, extra, tid) {
    return ed
      ? '<button data-cbsid="CRM006-B02" type="button" class="act sm' +
          (pri ? '' : ' ghost') +
          '" data-crm="' +
          a +
          '"' +
          (extra || '') +
          ' data-testid="' +
          tid +
          '">' +
          esc(tx(label)) +
          '</button>'
      : '';
  };
  (rec.followups || []).forEach(function (item) {
    if (!item.late && item.today !== true && item.bucket !== 'today' && item.due_today !== true && crmDayWord(item.due_at) !== tx('Today')) return;
    items.push(
      '<div class="nx" data-testid="crm-next-followup"><span class="ic">' +
        crmIcon('clock') +
        '</span><span class="tx"><b>' +
        (item.late ? esc(tx('Late since')) + ' ' + esc(bkDate(item.due_at)) : esc(tx('Today')) + ' ' + esc(bkTime(item.due_at))) +
        '</b> · ' +
        esc(item.what) +
        '<span class="s">' +
        esc(item.assignee_name || tx('Unassigned')) +
        '</span></span>' +
        '<span class="btns">' +
        btn('rfudone', 'Done', true, ' data-id="' + esc(item.followup_id) + '"', 'crm-next-done-' + esc(item.followup_id)) +
        '</span></div>'
    );
  });
  if (p.unread)
    items.push(
      '<div class="nx" data-testid="crm-next-unread"><span class="ic">' +
        crmIcon('msg') +
        '</span><span class="tx"><b>' +
        esc(crmPlural(p.unread, 'unread message', 'unread messages')) +
        '</b></span><span class="btns"><a class="act sm" href="#/party/' +
        key +
        '/timeline?f=messages" data-testid="crm-next-open-msgs">' +
        esc(tx('Open')) +
        '</a></span></div>'
    );
  if (crmDuesBand(p)) {
    var owes = p.balance_minor > 0;
    items.push(
      '<div class="nx" data-testid="crm-next-dues"><span class="ic">' +
        crmIcon('pay') +
        '</span><span class="tx"><b>' +
        esc(tx(owes ? 'Late dues' : 'You are late paying')) +
        '</b> · ' +
        esc(tx('oldest since')) +
        ' ' +
        esc(bkDate(p.oldest_due)) +
        '</span><span class="btns">' +
        (owes
          ? btn('rremind', 'Remind', false, '', 'crm-next-remind') + btn('rpay', 'Receive payment', true, '', 'crm-next-pay')
          : btn('rpay', 'Pay', true, '', 'crm-next-pay')) +
        '</span></div>'
    );
  }
  var mine = (p.tax_ids || []).filter(function (item) {
    return item.scheme === taxIdWord();
  })[0]; /* CX0: the pack's tax-id (GSTIN · ABN · TRN) */
  if (rec.gstn_profile && mine && rec.gstn_profile !== mine.value && CRMR.keep[p.party_id + rec.gstn_profile] !== 1)
    items.push(
      '<div class="nx" data-testid="crm-next-gstin"><span class="ic">' +
        crmIcon('warn') +
        '</span><span class="tx"><b>' +
        esc(tx('GSTIN differs from their profile')) +
        '</b><span class="s mono">' +
        esc(tx('Yours')) +
        ' ' +
        esc(mine.value) +
        ' · ' +
        esc(tx('theirs')) +
        ' ' +
        esc(rec.gstn_profile) +
        '</span></span><span class="btns">' +
        btn('rgtheirs', 'Use theirs', true, '', 'crm-gstin-theirs') +
        btn('rgmine', 'Keep mine', false, '', 'crm-gstin-mine') +
        '</span></div>'
    );
  if (rec.mail_bounced)
    items.push(
      '<div class="nx" data-testid="crm-next-bounce"><span class="ic">' +
        crmIcon('mail') +
        '</span><span class="tx"><b>' +
        esc(tx('Mail bounced')) +
        '</b> · ' +
        esc(rec.mail_bounced.to) +
        '<span class="s">' +
        esc(crmWhen(rec.mail_bounced.at)) +
        ' — ' +
        esc(tx('check the address')) +
        '</span></span><span class="btns">' +
        btn('fixaddr', 'Fix address', true, '', 'crm-next-fix') +
        '</span></div>'
    );
  var c = rec.contacts || {};
  if (p.kind !== 'walk-in' && !((c.phones || []).length || (c.emails || []).length))
    items.push(
      '<div class="nx" data-testid="crm-next-nocontact"><span class="ic">' +
        crmIcon('phone') +
        '</span><span class="tx"><b>' +
        esc(tx('No phone or e-mail yet')) +
        '</b></span><span class="btns">' +
        btn('redit', 'Add', true, '', 'crm-next-add') +
        '</span></div>'
    );
  return items.length
    ? '<section class="next" aria-label="' +
        esc(tx('Next')) +
        '" data-testid="crm-next"><div class="nh">' +
        esc(tx('Next')) +
        '</div>' +
        items.join('') +
        '</section>'
    : '';
}
/* ── the actions: Message (on ChitBridge) › Call › Mail; Log · Follow-up · Edit · More. Hidden for a viewer, never disabled-and-unexplained ── */
function crmMailBlock(p, rec) {
  /* T3-P3-CONSENT: the api's one shape — contact_prefs.may (lib/privacy.mayAll); the old `prefs` array was never sent */
  var e = rec.contact_prefs && rec.contact_prefs.may && rec.contact_prefs.may.email && rec.contact_prefs.may.email.service,
    c = rec.contacts || {};
  if (e && e.may === false) return e.why || tx('They asked not to be mailed');
  if (!(c.emails || []).length) return tx('No e-mail yet');
  return '';
}
/**
 * a viewer's bar (FX-L2C): every action the record offers is SHOWN, greyed, with the server's ONE sentence — the rule "show the action, the
 * server decides" (the Calls list greys its outcomes the same way). A phone call is not a write, so Call stays live when there is a number.
 */
function crmViewerActionsHTML(p, rec) {
  var c = rec.contacts || {},
    phone = (c.phones || [])[0],
    why = crmViewWhy(),
    list = [];
  var off = function (k, tid, label, cls) {
    return (
      '<button data-cbsid="CRM006-B03" type="button" class="act ghost' +
      (cls ? ' ' + cls : '') +
      '" disabled aria-disabled="true" title="' +
      esc(why) +
      '" data-testid="' +
      tid +
      '">' +
      (k ? crmIcon(k) : '') +
      esc(tx(label)) +
      '</button>'
    );
  };
  if (phone)
    list.push(
      '<a class="act" href="tel:' +
        esc(String(phone).replace(/\s+/g, '')) +
        '" data-crm="call" data-testid="crm-act-call">' +
        crmIcon('phone') +
        esc(tx('Call')) +
        '</a>'
    );
  if (p.kind === 'walk-in') list.push(off('plus', 'crm-act-walkin', 'Add to my parties'));
  else {
    if (p.on_chitbridge) list.push(off('msg', 'crm-act-message', 'Message'));
    var b0 = Number(p.balance_minor || 0);
    list.push(off('pay', 'crm-act-pay', b0 > 0 ? 'Receive' : b0 < 0 ? 'Pay' : 'Pay / Receive'));
    list.push(off('note', 'crm-act-log', 'Log'), off('clock', 'crm-act-fu', 'Follow-up', 'wide-only'), off('pencil', 'crm-act-edit', 'Edit', 'wide-only'));
    if (crmIsLead(p)) list.push(off('', 'crm-act-stage', 'Move to…'));
  }
  return (
    '<div class="actbar pin" role="toolbar" aria-label="' +
    esc(tx('Actions')) +
    '" data-testid="crm-actions" data-level="viewer">' +
    list.join('') +
    '<span class="why" data-testid="crm-actions-why">' +
    esc(why) +
    '</span></div>'
  );
}
/** W2-CRM: Remove is SHOWN to every login; the SERVER's may.remove greys it with its sentence (owner only), open dues grey it too */
function crmRemoveItemHTML(party, icon) {
  var mayRemove = crmMayRemove(),
    removeWhy = !mayRemove.ok ? mayRemove.why : CRM.ledger && !!party.balance_minor ? tx('dues open') : '';
  return (
    '<button data-cbsid="CRM006-B04" type="button" class="danger" data-crm="rremove" data-testid="crm-more-remove"' +
    (removeWhy ? ' disabled aria-disabled="true" title="' + esc(removeWhy) + '"' : '') +
    '>' +
    icon('warn') +
    esc(tx('Remove from my parties')) +
    (removeWhy ? '<span class="why" data-testid="crm-more-remove-why">' + esc(removeWhy) + '</span>' : '') +
    '</button>'
  );
}
/** the Next band offers Receive / Pay (and Remind) when the dues are late: the action row then leaves them out (one place per action) */
function crmDuesBand(p) {
  return !!(CRM.ledger && p.dues_overdue);
}
/** Pay / Receive on the record's action row, greyed WITH the server's sentence when the login may not */
function crmPayButton(party) {
  var wpay = crmWhyNot(party, 'pay'),
    owed = Number(party.balance_minor || 0),
    label = owed > 0 ? 'Receive' : owed < 0 ? 'Pay' : 'Pay / Receive';
  return (
      '<button data-cbsid="CRM006-B08" type="button" class="act' +
        (wpay ? ' ghost' : '') +
        '" data-crm="rpay" data-testid="crm-act-pay"' +
        (wpay ? ' disabled title="' + esc(wpay) + '"' : '') +
        '>' +
        crmIcon('pay') +
        esc(tx(label)) +
        (wpay ? '<span class="why wide-only" style="font-weight:400;font-size:12px"> \u00b7 ' + esc(wpay) + '</span>' : '') +
        '</button>'
  );
}
function crmActionsHTML(p, rec) {
  if (!crmEdit()) return crmViewerActionsHTML(p, rec);
  var c = rec.contacts || {},
    phone = (c.phones || [])[0],
    mail =
      (c.emails || []).filter(function (item) {
        return !(rec.mail_bounced && rec.mail_bounced.to === item);
      })[0] || (c.emails || [])[0],
    mb = crmMailBlock(p, rec),
    primary,
    inline = [];
  var key = esc(crmKey(p)),
    icon = function (k) {
      return crmIcon(k);
    };
  var mailBtn =
    '<a class="act ghost wide-only" href="mailto:' +
    esc(mail || '') +
    '" data-crm="mail" data-testid="crm-act-mail">' +
    icon('mail') +
    esc(tx('Mail')) +
    '</a>';
  var callBtn = function (pri) {
    return (
      '<a class="act' +
      (pri ? '' : ' ghost wide-only') +
      '" href="tel:' +
      esc(String(phone || '').replace(/\s+/g, '')) +
      '" data-crm="call" data-testid="crm-act-call">' +
      icon('phone') +
      esc(tx('Call')) +
      '</a>'
    );
  };
  if (p.kind === 'walk-in')
    primary = '<button data-cbsid="CRM006-B05" type="button" class="act" data-crm="walkin" data-testid="crm-act-walkin">' + icon('plus') + esc(tx('Add to my parties')) + '</button>';
  else if (p.on_chitbridge) {
    primary = '<button data-cbsid="CRM006-B06" type="button" class="act" data-crm="message" data-testid="crm-act-message">' + icon('msg') + esc(tx('Message')) + '</button>';
    if (!mb) inline.push(mailBtn);
    if (phone) inline.push(callBtn(false));
  } else if (phone) {
    primary = callBtn(true);
    if (!mb) inline.push(mailBtn);
  } else if (!mb) primary = mailBtn.replace('ghost wide-only', '');
  else primary = ''; /* no phone, no e-mail: the Next band's "Add" is the one place (one place per action) */
  /* the list card's actions, at the top: Pay / Receive (greyed WITH its sentence) and Message when they are not on ChitBridge */
  if (p.kind !== 'walk-in') {
    if (!crmDuesBand(p)) inline.push(crmPayButton(p));
    if (!p.on_chitbridge)
      inline.push(
        '<button data-cbsid="CRM006-B09" type="button" class="act ghost wide-only" disabled data-testid="crm-act-message-off" title="' +
          esc(crmWhyNot(p, 'message')) +
          '">' +
          icon('msg') +
          esc(tx('Message')) +
          '<span class="why wide-only" style="font-weight:400;font-size:12px"> · ' +
          esc(crmWhyNot(p, 'message')) +
          '</span></button>'
      ); /* the refused action carries its sentence on screen, as Pay / Receive does — not only in a tooltip (WX-L2C) */
  }
  var more = [];
  if (p.kind !== 'walk-in')
    more.push(
      '<button data-cbsid="CRM006-B10" type="button" class="narrow-only" data-crm="rfu" data-testid="crm-more-fu">' + icon('clock') + esc(tx('Follow-up')) + '</button>',
      '<button data-cbsid="CRM006-B11" type="button" class="narrow-only" data-crm="redit" data-testid="crm-more-edit">' + icon('pencil') + esc(tx('Edit')) + '</button>'
    );
  if (mb && p.kind !== 'walk-in')
    more.push(
      '<button data-cbsid="CRM006-B12" type="button" disabled data-testid="crm-act-mail-off" title="' +
        esc(mb) +
        '">' +
        icon('mail') +
        esc(tx('Mail')) +
        '<span class="why" data-testid="crm-mail-why">' +
        esc(mb) +
        '</span></button>'
    );
  if (!mb && inline.indexOf(mailBtn) >= 0)
    more.push(
      '<a class="narrow-only" style="display:flex;align-items:center;gap:8px;min-height:40px;padding:0 12px;text-decoration:none;color:var(--ink)" href="mailto:' +
        esc(mail || '') +
        '">' +
        icon('mail') +
        esc(tx('Mail')) +
        '</a>'
    );
  if (p.kind !== 'walk-in' && p.roles.length === 1)
    more.push(
      '<button data-cbsid="CRM006-B13" type="button" data-crm="alsorole" data-testid="crm-more-also">' +
        icon('plus') +
        esc(tx(p.roles[0] === 'customer' ? 'Also a supplier' : 'Also a customer')) +
        '</button>'
    );
  if (p.kind !== 'walk-in') more.push(crmRemoveItemHTML(p, icon));
  var wide =
    p.kind === 'walk-in'
      ? ''
      : '<button data-cbsid="CRM006-B14" type="button" class="act quiet wide-only" data-crm="rfu" data-testid="crm-act-fu">' +
        icon('clock') +
        esc(tx('Follow-up')) +
        '</button><button data-cbsid="CRM006-B15" type="button" class="act quiet wide-only" data-crm="redit" data-testid="crm-act-edit">' +
        icon('pencil') +
        esc(tx('Edit')) +
        '</button>';
  return (
    '<div class="actbar pin" role="toolbar" aria-label="' +
    esc(tx('Actions')) +
    '" data-testid="crm-actions">' +
    primary +
    inline.join('') +
    '<button data-cbsid="CRM006-B16" type="button" class="act quiet" data-crm="rlog" data-testid="crm-act-log">' +
    icon('note') +
    esc(tx('Log')) +
    '</button>' +
    wide +
    crmStageBtn(p) +
    '<span class="more"><button data-cbsid="CRM006-B17" type="button" class="act quiet" data-crm="rmore" aria-haspopup="true" aria-expanded="' +
    CRMR.menu +
    '" data-testid="crm-act-more">' +
    icon('dots') +
    esc(tx('More')) +
    '</button>' +
    (CRMR.menu && more.length ? '<div class="menu" role="menu" data-testid="crm-more-menu">' + more.join('') + '</div>' : '') +
    '</span></div>'
  );
}
/** C25: what is missing and where to set it - never a dead end */
function crmTaxMissing(p, R, cu, su) {
  var gst = (R.tax_ids || []).filter(function (item) {
      return item.scheme === taxIdWord();
    })[0],
    miss = [],
    where = []; /* CX0: the pack's tax-id word */
  if (!gst) {
    miss.push(txf('no {id}', { id: taxIdWord() }));
    where.push(txf('Add their {id} with Edit.', { id: taxIdWord() }));
  }
  if (!((cu && cu.credit_days != null) || (su && su.credit_days != null))) {
    miss.push(tx('no credit terms'));
    where.push(tx('Set them in Finance, under Terms.'));
  }
  return miss.length
    ? '<div class="hint" data-testid="crm-tax-missing"><b>' + esc(miss.join(' \u00b7 ')) + '</b> \u2014 ' + esc(where.join(' ')) + '</div>'
    : '';
}
function crmSec(id, title, fact, body, open) {
  return (
    '<details class="rsec" data-testid="crm-sec-' +
    id +
    '"' +
    (open ? ' open' : '') +
    '><summary>' +
    esc(tx(title)) +
    '<span class="fact" data-testid="crm-sec-fact-' +
    id +
    '">' +
    (fact || '') +
    '</span></summary><div class="rbody">' +
    body +
    '</div></details>'
  );
}
function crmKV(l, v) {
  return v == null || v === '' ? '' : '<div class="kv"><b>' + esc(tx(l)) + '</b><span>' + v + '</span></div>';
}
function crmRecordPaint(p, rec) {
  var R = Object.assign({}, p, rec, { billFacts: crmBillFacts(rec.timeline_all || rec.timeline_head) });
  R.unbilled = R.billFacts.unbilled;
  var node = document.getElementById('screen'),
    c = rec.contacts || {},
    one = R.roles.length === 1,
    ed = crmEdit();
  var merged = CRMR.mergedNote
    ? '<div class="banner" data-testid="crm-merged">' + crmIcon('link') + '<span>' + esc(txf('Merged from {no}', { no: CRMR.mergedNote })) + '</span></div>'
    : '';
  CRMR.mergedNote = null;
  var secs = [];
  /* Timeline — the latest five (a CBList mount) and See all */
  var all = (rec.counts && rec.counts.all) != null ? rec.counts.all : (rec.timeline_head || []).length;
  secs.push(
    crmSec(
      'timeline',
      'Timeline',
      all ? esc(crmPlural(all, 'entry', 'entries')) : '',
      '<div class="tl-wrap"><div id="crm_tlhead" data-testid="crm-tl-head"></div></div>' +
        (all > 5
          ? '<div style="padding-top:10px"><a class="act sm ghost" href="#/party/' +
            esc(crmKey(p)) +
            '/timeline" data-testid="crm-tl-all">' +
            esc(txf('See all {n}', { n: all })) +
            '</a></div>'
          : ''),
      true
    )
  );
  /* Who & contact (contact preferences moved to the Consent section — T3-P3-CONSENT, one place) */
  var who =
    crmKV('Legal name', R.legal_name && R.legal_name !== R.display_name ? esc(R.legal_name) : '') +
    crmKV('Phone', (c.phones || []).map(esc).join('<br>')) +
    crmKV(
      'E-mail',
      (c.emails || [])
        .map(function (item) {
          return esc(item) + (rec.mail_bounced && rec.mail_bounced.to === item ? ' <span class="tag amber">' + esc(tx('bounced')) + '</span>' : '');
        })
        .join('<br>')
    ) +
    crmKV('Address', esc(c.address || '')) +
    (p.city ? crmKV('City', esc(p.city)) : '') +
    (!(c.phones || []).length && !(c.emails || []).length && p.kind !== 'walk-in'
      ? '<div class="kv"><span>' + esc(tx('No phone or e-mail yet')) + '</span></div>'
      : '');
  secs.push(crmSec('who', 'Who & contact', '', who || '<div class="hint">' + esc(tx('Nothing more is recorded')) + '</div>', true));
  /* Tax & terms */
  var cu = rec.customer,
    su = rec.supplier,
    lim = function (x) {
      return x && x.credit_limit_minor != null ? ' · ' + esc(tx('limit')) + ' ' + esc(bkMoney(x.credit_limit_minor, p.currency)) : '';
    };
  var days = function (x) {
    return x && x.credit_days != null ? esc(txf('{n} days', { n: x.credit_days })) + lim(x) : '';
  };
  var gst = (R.tax_ids || []).filter(function (item) {
    return item.scheme === taxIdWord();
  })[0]; /* CX0: the pack's tax-id word */
  var tax =
    crmKV(
      'Tax IDs',
      (R.tax_ids || [])
        .map(function (item) {
          return esc(item.scheme) + ' <span class="mono">' + esc(item.value) + '</span>';
        })
        .join('<br>')
    ) +
    crmKV('State', R.state_code ? esc(R.state_code) + (R.supply_type ? ' · ' + esc(tx(CRM_SUPPLY[R.supply_type] || R.supply_type)) : '') : '') +
    (cu ? crmKV('Credit you give', days(cu)) : '') +
    (su ? crmKV('Credit you get', days(su)) : '');
  secs.push(
    crmSec(
      'tax',
      'Tax & terms',
      gst ? '<span class="mono">' + esc(gst.value) + '</span>' : '',
      tax + crmTaxMissing(p, R, cu, su) + '<div id="crm_terms" data-testid="crm-terms"></div>',
      false
    )
  );
  /* Customer · Supplier */
  var bf = R.billFacts || crmBillFacts([]);
  var ufact = bf.unbilled.n
    ? crmPlural(bf.unbilled.n, 'order not billed yet', 'orders not billed yet') + ' \u00b7 ' + crmUnbilledMoney(bf.unbilled)
    : '';
  if (cu)
    secs.push(
      crmSec(
        'customer',
        'Customer',
        esc(bf.bills ? crmPlural(bf.bills, 'bill', 'bills') : ufact || tx('No bills yet')),
        crmKV('Bills', esc(String(bf.bills))) +
          crmKV('Last bill', bf.lastBill ? esc(bkDate(bf.lastBill)) : '') +
          crmKV('Not billed yet', ufact ? esc(ufact) : '') +
          crmKV('Customer since', cu.since ? esc(bkDate(cu.since)) : '') +
          crmKV('Added from', cu.added_via ? esc(tx(CRM_ADDED[cu.added_via] || cu.added_via)) : '') +
          crmKV(
            'Segment',
            cu.segment && cu.segment !== 'new' ? esc(tx(CRM_SEG[cu.segment] || cu.segment)) + (cu.segment_override ? ' · ' + esc(tx('set by you')) : '') : ''
          ) +
          crmKV(
            'Groups',
            (cu.groups || [])
              .map(function (item) {
                return '<span class="tag">' + esc(item) + '</span>';
              })
              .join(' ')
          ) +
          crmKV('Points', rec.points ? esc(String(rec.points.balance)) + (rec.points.programme ? ' · ' + esc(rec.points.programme) : '') : ''),
        one
      )
    );
  /* T3-P2-CRM: Rewards — the engine's pane (app/cap-rewards.js, ONE copy with the workshop): the fact is the record's own points figure; the pane reads when the fold opens */
  if (cu && p.kind !== 'walk-in')
    secs.push(
      crmSec(
        'rewards',
        'Rewards',
        rec.points
          ? esc(String(rec.points.points != null ? rec.points.points : rec.points.balance)) +
              ' ' +
              esc(tx('points')) +
              (rec.points.programme ? ' · ' + esc(rec.points.programme) : '')
          : '',
        '<div id="crm_rw" data-testid="crm-rewards"></div>',
        false
      )
    );
  if (su)
    secs.push(
      crmSec(
        'supplier',
        'Supplier',
        su.category ? esc(su.category) : '',
        crmKV('Category', esc(su.category || '')) +
          crmKV('Preferred', su.preferred ? esc(tx('Yes')) : '') +
          crmKV('Supplies', esc(tx(su.supply_kind === 'resale' ? 'For resale' : su.supply_kind === 'own_use' ? 'For the shop' : su.supply_kind || ''))) +
          crmKV('Catalogue', su.catalogue ? esc(tx('On the network')) : '') +
          (su.notes ? '<div class="kv" data-testid="crm-notes"><b>' + esc(tx('Notes')) + '</b><span>📌 ' + esc(su.notes) + '</span></div>' : ''),
        one
      )
    );
  /* Consent — the record's own contact_prefs (cap-crm-privacy.js: the chip from the server's code, Yes/No greyed with the sentence) */
  if (typeof crmConsentHTML === 'function') secs.push(crmConsentHTML(p, rec));
  /* Ledger — cap-books.js's own block; off → one line and the owner's switch */
  if (p.kind !== 'walk-in') {
    if (CRM.ledger)
      secs.push(crmSec('ledger', 'Ledger', p.balance_minor != null ? crmDueCell(p) : '', '<div id="crm_ledger" data-testid="crm-ledger"></div>', false));
    else
      secs.push(
        crmSec(
          'ledger',
          'Ledger',
          '',
          '<p style="margin:8px 0">' +
            esc(tx('Dues show when Accounts is on')) +
            '</p>' +
            (crmOwner() ? '<button data-cbsid="CRM006-B18" type="button" class="act sm" data-crm="ledgeron" data-testid="crm-ledger-on">' + esc(tx('Switch on')) + '</button>' : ''),
          false
        )
      );
  }
  if (crmOwner() && (rec.changes || []).length)
    secs.push(
      crmSec(
        'changes',
        'History of changes',
        esc(crmPlural(rec.changes.length, 'change', 'changes')),
        (rec.changes || [])
          .map(function (x) {
            return (
              '<div class="kv" data-testid="crm-change"><b>' +
              esc(bkDate(x.at)) +
              '</b><span>' +
              esc(x.line) +
              ' <span class="sub">· ' +
              esc(crmWho(x.by)) +
              '</span></span></div>'
            );
          })
          .join(''),
        false
      )
    );
  node.className = 'screen';
  node.innerHTML =
    '<div class="rec" data-testid="crm-record" data-party="' +
    esc(p.party_id) +
    '">' +
    merged +
    crmHeaderHTML(R) +
    crmIdentityHTML(R, rec) +
    crmNextHTML(R, rec) +
    crmActionsHTML(R, rec) +
    secs.join('') +
    '</div>';
  /* the mounts */
  crmEditPrep(p, rec);
  if (typeof crmConsentMount === 'function') crmConsentMount(p);
  var head = document.getElementById('crm_tlhead');
  if (head) {
    if (CRMR.headApi) {
      try {
        CRMR.headApi.destroy();
      } catch (_) { /* best effort: failing here changes nothing the user sees */ }
    }
    CRMR.headApi = CBList.mount(head, Object.assign({
      key: 'crm-tl-head',
      t: tx,
      fill: false,
      view: 'grid',
      tools: { search: false, csv: false, count: false },
      rows: function () {
        return rec.timeline_head || [];
      },
      id: function (e) {
        return e.id;
      } /* the section head already says "N entries" — one count (ai-eye E-18) */,
      columns: crmTlCols,
      defaultCols: ['what', 'when', 'state', 'amount'],
      rowTid: function (e) {
        return 'crm-tl-' + e.id;
      },
      onOpen: crmEntryOpen,
      next: crmEntryNext,
      empty: { title: tx('Nothing yet with this party.'), sub: tx('Use Log to record a call or note.') }
    }, crmTimelineFailure(rec)));
  }
  var led = document.getElementById('crm_ledger');
  if (led) led.innerHTML = partyBooksHTML(cu ? 'customer' : 'supplier', p.party_id, crmLedgerRow(p, rec), true);
  var rwSec = document.querySelector('[data-testid="crm-sec-rewards"]');
  if (rwSec && typeof CBRewardsPane !== 'undefined') {
    var rwOnce = function () {
      if (rwSec.open && !rwSec.getAttribute('data-read')) {
        rwSec.setAttribute('data-read', '1');
        CBRewardsPane.load('crm_rw', {
          id: p.party_id,
          api: api,
          t: tx,
          money: function (n) {
            try {
              return CBLocale.money(n, p.currency || CRM.currency);
            } catch (_) {
              return String(n);
            }
          } /* the same formatter the workshop's pane uses */
        });
      }
    };
    rwSec.addEventListener('toggle', rwOnce);
    rwOnce();
  }
  if (CRM.ledger) crmTermsFill(p.party_id, cu ? 'customer' : 'supplier');
}
/** F2: the credit terms that apply to this party, READ-ONLY (CB Finance · Terms is the one place that sets them) + the changes made to them.
 *  The server answers what applies (own, else the shop's) and who may change it; a login that may not sees the button greyed with the sentence. */
async function crmTermsFill(pid, side) {
  var el = document.getElementById('crm_terms');
  if (!el) return;
  var r;
  try {
    r = await api('booksTerms', { query: { party_id: pid, side: side } });
  } catch (_) {
    return;
  } /* ledger off / no read → the record says nothing more */
  el = document.getElementById('crm_terms');
  if (!el || !(CRM.route && CRM.route.view === 'party')) return;
  var cur = CRMR.p && CRMR.p.currency,
    eff = r.party && r.party.effective,
    from = function (x) {
      return x && x.from === 'shop' ? ' <span class="hint">' + esc(tx('Shop default')) + '</span>' : '';
    };
  var rows = '';
  if (eff) {
    rows =
      (eff.credit_days.value != null ? crmKV('Credit days', esc(String(eff.credit_days.value)) + from(eff.credit_days)) : '') +
      (eff.credit_limit_minor.value != null ? crmKV('Credit limit', esc(bkMoney(eff.credit_limit_minor.value, cur)) + from(eff.credit_limit_minor)) : '') +
      (eff.interest.value ? crmKV('Interest', esc(bkTermVal('interest', eff.interest.value, cur)) + from(eff.interest)) : '') +
      (eff.early.value ? crmKV('Early pay', esc(bkTermVal('early', eff.early.value, cur)) + from(eff.early)) : '');
  }
  var can = r.may_set && r.terms_migrated,
    why = !r.terms_migrated ? tx('Terms arrive after the next update.') : r.may_set ? '' : r.why_not || '';
  el.innerHTML =
    rows +
    (why ? '<div class="hint" data-testid="crm-terms-why">' + esc(why) + '</div>' : '') +
    (r.events && r.events.length ? '<div data-testid="crm-terms-events">' + bkTermEvents(r.events.slice(0, 5), cur, 'crm-terms-event') + '</div>' : '') +
    '<a data-cbsid="CRM006-C01" class="act sm' +
    (can ? '' : ' disabled') +
    '" data-testid="crm-terms-go" href="' +
    (can ? '/finance.html#/terms' : '#') +
    '"' +
    (can ? '' : ' aria-disabled="true" onclick="return false"') +
    '>' +
    esc(tx('Open Terms')) +
    '</a>';
}
/** M30-1c: after a payment, the open record's Ledger (header chip, Balance, statement) repaints from what the books now say - the Day book had the payment, this block did not */
function crmLedgerRepaint(pid) {
  var p = CRMR.p,
    rec = CRMR.rec;
  if (!p || !rec || p.party_id !== pid || !(CRM.route && CRM.route.view === 'party' && !CRM.route.sub)) return;
  var d = BK.dues && BK.dues[pid];
  if (d && d.balance_minor != null) p.balance_minor = d.balance_minor; /* the same row the Parties list reads */
  /* only the three places the balance shows - never the whole record: a repaint would fold the Ledger section the person is working in */
  var R = Object.assign({}, p, rec),
    has = CRM.ledger && p.balance_minor != null,
    node = document.querySelector('[data-testid="crm-record"] .rchips');
  if (node)
    node.innerHTML =
      crmRoleChips(R) +
      crmRailChip(R) +
      (crmIsLead(R) && !Number(p.balance_minor || 0)
        ? ''
        : crmDueChip(Object.assign({}, R, { balance_minor: p.balance_minor, billFacts: crmBillFacts(rec.timeline_all || rec.timeline_head) }))) +
      crmSegChip(R) +
      crmStageChip(R.lead);
  var fact = document.querySelector('[data-testid="crm-sec-fact-ledger"]');
  if (fact) fact.innerHTML = has ? crmDueCell(p) : '';
  var led = document.getElementById('crm_ledger');
  if (led) led.innerHTML = partyBooksHTML(rec.customer ? 'customer' : 'supplier', pid, crmLedgerRow(p, rec), true);
}
function crmLedgerRow(p, rec) {
  var side = rec.customer || rec.supplier || {};
  return {
    party_no: p.party_no,
    legal_name: p.legal_name,
    nickname: p.nickname,
    tax_ids: p.tax_ids,
    credit_days: side.credit_days,
    credit_limit_minor: side.credit_limit_minor
  };
}

/* ── the party edit: cap-books.js's own sheet (partyEditOpen), fed the record's ids and terms; the CRM list is its one source ── */
function crmEditPrep(p, rec) {
  var set = function (list, idKey, kind, side, listId) {
    var row = list.filter(function (item) {
      return item[idKey] === p.party_id;
    })[0];
    if (!row) return;
    Object.assign(row, {
      display_name: p.display_name,
      nickname: p.nickname,
      legal_name: p.legal_name,
      tax_ids: p.tax_ids.slice(),
      state_code: p.state_code,
      party_no: p.party_no,
      credit_days: side && side.credit_days != null ? side.credit_days : null,
      credit_limit_minor: side && side.credit_limit_minor != null ? side.credit_limit_minor : null
    });
    row[kind === 'supplier' ? 'supplier_list_id' : 'customer_list_id'] = side && side.list_id;
    var other = kind === 'supplier' ? rec.customer : rec.supplier;
    row.also = other && other.list_id ? { kind: kind === 'supplier' ? 'customer' : 'supplier', id: other.list_id } : null;
    row.contacts = p.kind === 'local' ? { phone: ((rec.contacts || {}).phones || [])[0] || '', email: ((rec.contacts || {}).emails || [])[0] || '' } : null;
  };
  set(UI.custs, 'customer_identity_id', 'customer', rec.customer);
  set(UI.sups, 'supplier_entity_id', 'supplier', rec.supplier);
}
function crmEditOpen(p) {
  var kind = CRMR.rec && CRMR.rec.customer ? 'customer' : 'supplier';
  partyEditOpen(kind, p.party_id);
}
/** cap-books.js calls this after a party edit saves: the list and the record are read again (one source) */
function crmAfterEdit(kind, partyId) {
  crmLoad(true).then(function () {
    if (CRM.route && CRM.route.view === 'party') crmRecordOpen(CRM.route);
  });
}

/* ═══ THE LOG SHEET — a call, a visit, a WhatsApp or a note; optionally the follow-up it leaves (F4) ═════════════════ */
var LOG = { kind: 'call', dir: 'out', fu: false, busy: false };
function crmLogOpen(p) {
  LOG.kind = 'call';
  LOG.dir = 'out';
  LOG.fu = false;
  LOG.busy = false;
  LOG.p = p;
  var seg = function (a, items, cur) {
    return (
      '<div class="seg2" role="group">' +
      items
        .map(function (x) {
          return (
            '<button data-cbsid="CRM006-B20" type="button" data-crm="' +
            a +
            '" data-v="' +
            x[0] +
            '" aria-pressed="' +
            (x[0] === cur) +
            '" data-testid="crm-' +
            a +
            '-' +
            x[0] +
            '">' +
            esc(tx(x[1])) +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  };
  ui.dialog({
    mount: 'CRM006-U201',
    pop: 'POP101',
    titleText: tx('Log') + ' · ' + p.display_name,
    testid: 'crm-log-sheet',
    body:
      '<div class="supacts">' +
      seg(
        'logkind',
        [
          ['call', 'Call'],
          ['visit', 'Visit'],
          ['whatsapp', 'WhatsApp'],
          ['note', 'Note']
        ],
        'call'
      ) +
      '<span id="crm_logdir">' +
      seg(
        'logdir',
        [
          ['out', 'Out'],
          ['in', 'In']
        ],
        'out'
      ) +
      '</span></div>' +
      '<label>' +
      esc(tx('What happened?')) +
      '<textarea data-cbsid="CRM006-T01" class="inp" id="crm_log_body" data-testid="crm-log-body" rows="4" placeholder="' +
      esc(tx('Said, agreed, asked…')) +
      '"></textarea></label>' +
      '<label style="flex-direction:row;align-items:center;gap:8px;font-weight:600"><input data-cbsid="CRM006-I01" type="checkbox" id="crm_log_fu" data-crm="logfu" data-testid="crm-log-fu"> ' +
      esc(tx('Add a follow-up')) +
      '</label>' +
      '<div id="crm_log_fubox" hidden style="display:none;flex-direction:column;gap:8px"><input data-cbsid="CRM006-I02" class="inp" id="crm_log_fuwhat" data-testid="crm-log-fuwhat" placeholder="' +
      esc(tx('Call back about…')) +
      '"><div class="supacts"><input data-cbsid="CRM006-I03" class="inp" id="crm_log_fudue" data-testid="crm-log-fudue" type="date" style="width:auto">' +
      [
        ['tomorrow', 'Tomorrow'],
        ['week', 'Next week']
      ]
        .map(function (x) {
          return '<button data-cbsid="CRM006-B21" type="button" class="crm-mini" data-crm="logpreset" data-v="' + x[0] + '">' + esc(tx(x[1])) + '</button>';
        })
        .join('') +
      '</div></div>' +
      '<div id="crm_log_msg" class="hint" role="status"></div>',
    actions: [
      { name: 'cancel', options: { mount: 'CRM006-U201' } },
      { name: 'save', options: { mount: 'CRM006-U201', key: 'save', effect: 'preference', testid: 'crm-log-save', data: { crm: 'logsave' } } }
    ]
  });
  document.getElementById('crm_log_body').focus();
}
async function crmLogSave() {
  if (LOG.busy) return;
  var node = function (id) {
      return String((document.getElementById(id) || {}).value || '').trim();
    },
    msg = document.getElementById('crm_log_msg'),
    p = LOG.p;
  if (!node('crm_log_body')) {
    msg.textContent = tx('Say what happened.');
    return;
  }
  LOG.busy = true;
  try {
    await api('crmLog', {
      params: { id: p.party_id },
      body: { kind: LOG.kind === 'whatsapp' ? 'message' : LOG.kind, direction: LOG.kind === 'note' ? null : LOG.dir, body: node('crm_log_body') }
    });
    if (LOG.fu && node('crm_log_fuwhat') && node('crm_log_fudue'))
      await api('crmFollowAdd', {
        body: { party_id: p.party_id, what: node('crm_log_fuwhat'), due_at: new Date(node('crm_log_fudue') + 'T09:00:00').toISOString(), source: 'interaction' }
      });
    closeModal();
    toast(tx('Logged'));
    crmLoad(true);
    if (CRM.route && CRM.route.view === 'party') crmRecordOpen(CRM.route);
  } catch (e) {
    msg.textContent = e && e.status === 503 ? tx('Calls and follow-ups start after an update. Nothing is lost.') : tx("Couldn't save that. Try again.");
  }
  LOG.busy = false;
}

/* ═══ ONE click door for the record's controls (cap-crm.js hands every data-crm it does not own to this) ═══════════ */
/** the side Receive / Pay opens on: the side the record has; a party on both sides: by who owes whom */
function crmPaySide(p, rec) {
  if (rec.customer && rec.supplier) return p.balance_minor > 0 ? 'customer' : 'supplier';
  return rec.customer ? 'customer' : 'supplier';
}
function crmRecordClick(a, node, ev) {
  var p = CRMR.p,
    rec = CRMR.rec || {},
    v = node.getAttribute('data-v');
  if (typeof crmPrivacyClick === 'function' && crmPrivacyClick(a, node)) return; /* consent Yes/No · the register (cap-crm-privacy.js) */
  if (a === 'rmore') {
    CRMR.menu = !CRMR.menu;
    return crmRecordPaint(p, rec);
  }
  if (a === 'recretry') return crmRecordOpen(CRM.route);
  if (a === 'rlog') return crmLogOpen(p);
  if (a === 'rfu')
    return crmFuAddOpen(p.party_id, function () {
      crmRecordOpen(CRM.route);
    });
  if (a === 'redit' || a === 'fixaddr') return crmEditOpen(p);
  if (a === 'logkind') {
    LOG.kind = v;
    document.querySelectorAll('[data-crm="logkind"]').forEach(function (item) {
      item.setAttribute('aria-pressed', String(item.getAttribute('data-v') === v));
    });
    document.getElementById('crm_logdir').style.display = v === 'note' ? 'none' : '';
    return;
  }
  if (a === 'logdir') {
    LOG.dir = v;
    document.querySelectorAll('[data-crm="logdir"]').forEach(function (item) {
      item.setAttribute('aria-pressed', String(item.getAttribute('data-v') === v));
    });
    return;
  }
  if (a === 'logfu') {
    LOG.fu = node.checked;
    var bx = document.getElementById('crm_log_fubox');
    bx.hidden = !node.checked;
    bx.style.display = node.checked ? 'flex' : 'none';
    return;
  }
  if (a === 'logpreset') {
    var date = new Date();
    date.setDate(date.getDate() + (v === 'week' ? 7 : 1));
    document.getElementById('crm_log_fudue').value = crmLocalISO(date);
    return;
  }
  if (a === 'logsave') return crmLogSave();
  if (a === 'call') {
    setTimeout(function () {
      if (CRMR.p) crmLogOpen(CRMR.p);
    }, 400);
    return;
  }
  if (a === 'mail') {
    setTimeout(function () {
      if (CRMR.p) crmLogOpen(CRMR.p);
    }, 400);
    return;
  }
  if (a === 'message') return crmMessage(p, rec);
  if (a === 'rfudone')
    return crmFuAct(node.getAttribute('data-id'), { done: true }, function () {
      setTimeout(function () {
        crmRecordOpen(CRM.route);
      }, 0);
    });
  if (a === 'rremind')
    return crmFuAddOpen(
      p.party_id,
      function () {
        crmRecordOpen(CRM.route);
      },
      { what: tx('Remind about the overdue dues'), source: 'dues' }
    );
  if (a === 'rpay') {
    var side = crmPaySide(p, rec);
    return payOpen(side, p.party_id, payOpenTotal(side, p) || undefined); /* the figure the record already shows, carried */
  } /* the side the record has; a party on both sides: by who owes whom */
  if (a === 'rgtheirs') return crmGstinTheirs(p, rec);
  if (a === 'rgmine') {
    CRMR.keep[p.party_id + rec.gstn_profile] = 1;
    return crmRecordPaint(p, rec);
  }
  if (a === 'ledgeron') return crmLedgerOn();
  if (a === 'walkin') return crmWalkin(p);
  if (a === 'alsorole') return crmAlsoRole(p, rec);
  if (a === 'rremove') return crmRemove(p, rec);
}
/* C3: Esc closes the More menu (as the drawers do), and the focus goes back to More */
document.addEventListener('keydown', function (ev) {
  if (ev.key !== 'Escape' || !CRMR.menu) return;
  CRMR.menu = false;
  if (CRMR.p && CRMR.rec && CRM.route && CRM.route.view === 'party' && !CRM.route.sub) {
    crmRecordPaint(CRMR.p, CRMR.rec);
    var node = document.querySelector('[data-testid="crm-act-more"]');
    if (node) node.focus();
  }
});
document.addEventListener('click', function (ev) {
  if (!CRMR.menu) return;
  if (!ev.target.closest || !ev.target.closest('.more')) {
    CRMR.menu = false;
    if (CRMR.p && CRMR.rec && CRM.route && CRM.route.view === 'party' && !CRM.route.sub) crmRecordPaint(CRMR.p, CRMR.rec);
  }
});
/** Message: the thread already open with this party, in the chit sheet — compose has no deep link yet (reported in the PR), so a new message starts in the app */
function crmMessage(p, rec) {
  var th = (rec.timeline_head || []).filter(function (e) {
    return e.chit_id && /^(message|chit)$/.test(e.kind);
  })[0];
  if (th) return openChitSheet(th.chit_id);
  toast(tx('No messages with them yet.'));
}
async function crmGstinTheirs(p, rec) {
  var side = rec.customer || rec.supplier,
    kind = rec.customer ? 'customer' : 'supplier';
  var ids = (p.tax_ids || []).map(function (item) {
    return item.scheme === 'GSTIN' ? { scheme: 'GSTIN', value: rec.gstn_profile } : item;
  });
  try {
    await api(kind === 'supplier' ? 'supPatch' : 'custGroup', { params: { id: side.list_id }, body: { tax_ids: ids } });
    toast(tx('Saved'));
    await crmLoad(true);
    crmRecordOpen(CRM.route);
  } catch (e) {
    toast((e && e.message) || tx("Couldn't save that. Try again."));
  }
}
function crmLedgerOn() {
  CBLedger.run(true, {
    ask: confirmAsk,
    working: function () {},
    call: function (on) {
      return CBLedger.call({ api: api }, on);
    },
    done: function () {
      CRM.ledger = true;
      crmLoad(true).then(function () {
        crmRecordOpen(CRM.route);
      });
    },
    failed: function (e) {
      toast(tx('Could not switch it on.') + ' ' + friendlyErr(e));
    }
  });
}
async function crmWalkin(p) {
  try {
    /* the CRM's own door: the phone becomes a local customer and its points move to them (the API names them "Customer 0021" until the shop says otherwise) */
    var reply = await api('crmWalkIn', { body: { phone: p.phone } });
    var made = (reply && reply.party) || {},
      pts = reply && reply.points_claimed != null ? reply.points_claimed : 0;
    toast(tx('Added to your parties') + (pts ? ' — ' + txf('{n} points kept', { n: pts }) : ''));
    await crmLoad(true);
    var np = made.party_id && CRM.byKey[made.party_id];
    crmGo(np ? '#/party/' + encodeURIComponent(crmKey(np)) : '#/parties');
  } catch (e) {
    toast((e && e.message) || tx("Couldn't add that. Try again."));
  }
}
async function crmAlsoRole(p, rec) {
  var toSup = p.roles[0] === 'customer';
  try {
    await api(toSup ? 'supAdd' : 'custAdd', {
      body: toSup
        ? p.on_chitbridge
          ? { supplier_bridge_id: p.bridge_id }
          : { name: p.display_name }
        : p.on_chitbridge
          ? { handle: p.user_id }
          : { name: p.display_name, phone: p.phone }
    });
    CRMR.menu = false;
    toast(tx('Added'));
    await crmLoad(true);
    crmRecordOpen(CRM.route);
  } catch (e) {
    toast((e && e.message) || tx("Couldn't add that. Try again."));
  }
}
function crmRemove(p, rec) {
  confirmAsk(
    tx('Remove from my parties?'),
    esc(txf('{name} is hidden from your parties. Nothing is deleted.', { name: p.display_name })),
    tx('Remove'),
    async function () {
      try {
        await api('crmRemove', { params: { id: p.party_id } }); // ONE call hides the party from both lists; the API refuses (409 HAS_DUES) with dues open
        toast(tx('Removed'));
        await crmLoad(true);
        crmGo('#/parties');
      } catch (e) {
        toast(e && e.status === 409 ? tx('There are dues open on this party.') : tx("Couldn't remove that. Try again."));
      }
    },
    true
  );
}
