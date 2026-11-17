/* cap-crm-privacy.js — CB CRM: a party's CONSENT (the record's Consent block) and the shop's PRIVACY REQUESTS register (#/privacy).
 * OWNS      the Consent block on a party record (crmConsentHTML, crmConsentMount, crmConsentSet) · the privacy register (crmPrivacy, a CBList), Log a request (crmPrivReqOpen) and Answer (crmPrivAnswerOpen) live in cap-crm-privacy-register.js
 * CALLED BY crm.html (<script src>, after cap-crm-record.js) · cap-crm.js (crmRoute → crmPrivacy on #/privacy) · cap-crm-record.js (crmConsentHTML, crmConsentMount, and crmRecordClick → crmPrivacyClick)
 * FLOW      a record opens → crmConsentHTML draws the block → crmConsentMount, on open, crmConsentOpen reads crmPrefs → Yes/No → crmConsentSet (crmPrefSet) → CBAction · #/privacy → crmPrivLoad → the register → Log / Answer sheets
 * CARD      11-crm-and-marketing/crm-privacy
 * T3-P3-CONSENT (2026-10-14). Flow: CRM step 6 "consent & privacy requests" (docs/process/flows.json).
 *
 * ⭐ REUSE (rule 1): crmSec (the record's own section) · CBList (the history and the register) · modal/closeModal (crm.html's sheet) · crmBar ·
 *   crmViewOnlyBtn · crmErrWords · api() (core.js) · bkDate (cap-books.js) · the record's data-crm click door (crmRecordClick hands here).
 * ⭐ ONE CALCULATION (rule 2): nothing is decided here. The server's `may[channel][purpose].code` picks the chip and which button is drawn;
 *   `why` is only printed; `law` (the shop's country's words, lib/privacy.lawOf) is painted, never composed; `late`, `due_at` are the server's.
 * ⭐ NEW PATHS (rule 4): no screen held consent or the register (grep consent|contact-pref|privacy: only the Standards rows) — the api's
 *   GET/POST contact-prefs and the b307 register had no client since CO1 (13 Oct).
 * The server decides: a viewer's Yes/No is greyed with its sentence; before b306/b307 the block says so in words, never "nothing here". */
'use strict';
var PRV = {
  rows: [],
  total: 0,
  page: 1,
  limit: 50,
  open: 0,
  late: 0,
  state: 'idle',
  err: null,
  api: null,
  mayAnswer: false,
  why: null,
  migrated: true,
  params: {},
  busy: false
};
/* tones: green = agreed, amber = needs a hand (not asked · said no · withdrawn · stopped), plain = allowed by law. Red is for a stopped sale, not for consent (SYSTEM.md colour rule; rule 13: amber reads AA in both themes) */
var CRM_CONSENT_WORD = {
  CONSENT: ['Agreed', 'green'],
  LEGITIMATE_USE: ['Allowed', ''],
  NO_CONSENT: ['Not asked', 'amber'],
  CONSENT_WITHDRAWN: ['Withdrawn', 'amber'],
  SAID_NO: ['Said no', 'amber'],
  OPTED_OUT: ['Stopped', 'amber']
};
var CRM_REQ_KIND = { access: 'A copy', correct: 'Correct', erase: 'Erase', withdraw: 'Withdraw consent', nominate: 'Nominate', grievance: 'Grievance' };
var CRM_REQ_OUT = { done: 'Done', partly: 'Partly', refused: 'Refused' };
var CRM_CONSENT_CH = ['whatsapp', 'sms', 'email', 'phone', 'chitbridge'];

/* ═══ 1 · THE RECORD'S CONSENT BLOCK — painted from the record's own contact_prefs (no extra read); the history on open ═══ */
/** the verdict chip: the server's code → a word and a tone (the sentence sits in the title) */
function crmConsentChip(v, tid) {
  var w = CRM_CONSENT_WORD[(v || {}).code] || ['Unknown', ''];
  return (
    '<span class="tag' +
    (w[1] ? ' ' + w[1] : '') +
    '" title="' +
    esc((v || {}).why || '') +
    '" data-testid="' +
    tid +
    '" data-code="' +
    esc((v || {}).code || '') +
    '">' +
    esc(tx(w[0])) +
    '</span>'
  );
}
/** why a Yes/No may not be pressed now — '' when it may (the viewer's sentence; the not-migrated sentence) */
function crmConsentWhyNot(cp) {
  if (!crmEdit()) return crmViewWhy();
  if (!cp || !cp.migrated) return tx('Consent records start after an update.');
  return '';
}
function crmConsentBtn(ch, pu, allowed, label, why, tid) {
  return (
    '<button data-cbsid="CRM010-B01" type="button" class="act sm' +
    (allowed && pu === 'marketing' ? '' : ' ghost') +
    '" data-crm="consent" data-ch="' +
    ch +
    '" data-pu="' +
    pu +
    '" data-v="' +
    (allowed ? '1' : '0') +
    '" data-testid="' +
    tid +
    '"' +
    (why ? ' disabled aria-disabled="true" title="' + esc(why) + '"' : '') +
    '>' +
    esc(tx(label)) +
    '</button>'
  );
}
/** the fact beside the section title: which channels may get offers, in words */
function crmConsentFact(cp) {
  if (!cp) return '';
  if (!cp.migrated) return esc(tx('Not set up yet'));
  var on = CRM_CONSENT_CH.filter(function (item) {
    return cp.may[item] && cp.may[item].marketing && cp.may[item].marketing.may;
  }).map(function (item) {
    return tx(CRM_CHAN[item]);
  });
  return esc(on.length ? tx('Offers') + ': ' + on.join(', ') : tx('No consent for offers'));
}
/** one row per channel: Offers (consent) and Messages (about their own orders) — the chip from the code; the button that CHANGES the state only */
function crmConsentRows(cp) {
  var why = crmConsentWhyNot(cp),
    may = (cp && cp.may) || {};
  return CRM_CONSENT_CH.map(function (item) {
    var m = (may[item] || {}).marketing || { code: 'NO_CONSENT' },
      s = (may[item] || {}).service || { code: 'LEGITIMATE_USE' };
    var offers =
      crmConsentChip(m, 'crm-consent-' + item + '-marketing') +
      ' ' +
      (m.may
        ? crmConsentBtn(item, 'marketing', false, 'No', why, 'crm-consent-no-' + item)
        : crmConsentBtn(item, 'marketing', true, 'Yes', why, 'crm-consent-yes-' + item));
    var msgs =
      crmConsentChip(s, 'crm-consent-' + item + '-service') +
      ' ' +
      (s.may
        ? crmConsentBtn(item, 'service', false, 'Stop', why, 'crm-consent-stop-' + item)
        : crmConsentBtn(item, 'service', true, 'Allow', why, 'crm-consent-allow-' + item));
    return (
      '<div class="kv" data-testid="crm-consent-row-' +
      item +
      '"><b>' +
      esc(tx(CRM_CHAN[item] || item)) +
      '</b><span class="consent-cells"><span class="cc"><i>' +
      esc(tx('Offers')) +
      '</i> ' +
      offers +
      '</span><span class="cc"><i>' +
      esc(tx('Their orders')) +
      '</i> ' +
      msgs +
      '</span><span class="hint stand" data-standing="' +
      item +
      '" data-testid="crm-consent-standing-' +
      item +
      '"></span></span></div>'
    );
  }).join('');
}
/** the section (crmSec): the rows now, the law line + the history when opened, a Privacy request door */
function crmConsentHTML(p, rec) {
  if (p.kind === 'walk-in') return '';
  var cp = rec.contact_prefs || null,
    why = crmConsentWhyNot(cp);
  var head =
    cp && !cp.migrated
      ? '<div class="hint" data-testid="crm-consent-notyet">' + esc(tx('Consent records start after an update. Nothing is lost.')) + '</div>'
      : '';
  var reqBtn = crmEdit()
    ? '<button data-cbsid="CRM010-B02" type="button" class="act sm ghost" data-crm="privreq" data-testid="crm-consent-request">' + esc(tx('Privacy request')) + '</button>'
    : crmViewOnlyBtn('crm-consent-request', tx('Privacy request'), crmViewWhy());
  var body =
    head +
    '<div class="consent-rows" data-testid="crm-consent-rows">' +
    crmConsentRows(cp) +
    '</div>' +
    (why && cp && cp.migrated ? '<div class="why" data-testid="crm-consent-why">' + esc(why) + '</div>' : '') +
    '<div id="crm_consent_ask" data-testid="crm-consent-ask"></div>' +
    '<div class="hint" id="crm_consent_law" data-testid="crm-consent-law"></div>' +
    '<div class="hint" id="crm_consent_holders" data-testid="crm-consent-holders"></div>' +
    '<div id="crm_consent_hist" data-testid="crm-consent-hist"></div>' +
    '<div class="supacts" style="margin-top:8px">' +
    reqBtn +
    '<a class="act sm ghost" href="#/privacy" data-testid="crm-consent-register">' +
    esc(tx('All requests')) +
    '</a></div>';
  return crmSec('consent', 'Consent', crmConsentFact(cp), body, false);
}
/** how one consent row was given - the person's own STOP reply (b777 source), withdrawn, by them online, by you, by the shop, or just noted */
function crmConsentHow(row, partyId) {
  if (row.source === 'reply') return tx('Withdrawn · replied STOP'); /* CON-2: the person's own STOP on WhatsApp, not staff or the web */
  if (row.withdrawn_at) return tx('Withdrawn');
  var me = (window.SESSION && (SESSION.actorId || SESSION.entityId)) || null;
  if (row.noted_by && row.noted_by === partyId) return tx('By them, online');
  if (row.noted_by && me && row.noted_by === me) return tx('Noted by you');
  return row.noted_by ? tx('Noted by the shop') : tx('Noted');
}
/** who holds the data and where: the public facts list (GET /api/privacy/facts), printed as the server words it; a region it does not state says so */
async function crmConsentHolders() {
  var node = document.getElementById('crm_consent_holders');
  if (!node || node.getAttribute('data-loaded')) return;
  node.setAttribute('data-loaded', '1');
  try {
    var held = await api('crmPrivFacts');
    var list = (held.processors || [])
      .filter(function (item) {
        return item.on;
      })
      .map(function (item) {
        return item.name + ' (' + (item.region || tx('region not stated')) + ')';
      });
    node = document.getElementById('crm_consent_holders');
    if (node) node.textContent = list.length ? tx('Your data is held by') + ': ' + list.join(', ') : '';
  } catch (_) {
    node = document.getElementById('crm_consent_holders');
    if (!node) return;
    node.removeAttribute('data-loaded'); /* opening the block again retries */
    node.textContent = tx("Couldn't read who holds the data.");
  }
}
/** on open: the history (what · when · how given · withdrawn) and the law's words — one GET, a CBList mount; could-not-read in words */
/** the history could not be read: say why in words (503: the consent records start after an update) and offer Try again */
function crmConsentHistFailed(hist, e) {
  hist.removeAttribute('data-loaded');
  hist.innerHTML =
    '<div class="hint" data-testid="crm-consent-hist-err">' +
    esc(e && e.status === 503 ? tx('Consent records start after an update. Nothing is lost.') : tx("Couldn't read the consent history.")) +
    ' <button data-cbsid="CMP009" type="button" class="crm-mini" data-crm="consentretry">' +
    esc(tx('Try again')) +
    '</button></div>';
}
async function crmConsentOpen(p) {
  var hist = document.getElementById('crm_consent_hist'),
    node = document.getElementById('crm_consent_law');
  if (!hist || hist.getAttribute('data-loaded')) return;
  hist.setAttribute('data-loaded', '1');
  var r;
  try {
    r = await api('crmPrefs', { params: { id: p.party_id } });
  } catch (e) {
    crmConsentHistFailed(hist, e);
    return;
  }
  hist = document.getElementById('crm_consent_hist');
  node = document.getElementById('crm_consent_law');
  if (!hist) return;
  if (node && r.law) node.innerHTML = r.law.known ? '<b>' + esc(r.law.short || r.law.law) + '</b> · ' + esc(r.law.consent) : esc(r.law.note || '');
  crmConsentStanding(r);
  var rows = (r.history || []).map(function (item, index) {
    return Object.assign({ _i: index }, item);
  });
  var how = function (h) {
    return crmConsentHow(h, p.party_id);
  };
  var what = function (h) {
    return (
      tx(CRM_CHAN[h.channel] || h.channel) +
      ' · ' +
      (h.purpose === 'marketing' ? tx('offers') : tx('their orders')) +
      ' · ' +
      (h.allowed ? tx('yes') : tx('no'))
    );
  };
  if (CRMR.consentApi) {
    try {
      CRMR.consentApi.destroy();
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  }
  CRMR.consentApi = CBList.mount(hist, {
    key: 'crm-consent-hist',
    t: tx,
    fill: false,
    view: 'grid',
    tools: { search: false, csv: false, count: true },
    rows: function () {
      return rows;
    },
    id: function (h) {
      return h.pref_id || String(h._i);
    },
    rowTid: function (h) {
      return 'crm-consent-h-' + (h.pref_id || h._i);
    },
    columns: [
      {
        key: 'when',
        label: 'When',
        prio: 1,
        w: 150,
        cell: function (h) {
          return h.noted_at ? bkDate(h.noted_at) : '—';
        }
      },
      { key: 'what', label: 'What', prio: 2, w: 260, cell: what },
      { key: 'how', label: 'How given', prio: 3, w: 170, cell: how },
      {
        key: 'notice',
        label: 'Notice',
        prio: 4,
        w: 120,
        cell: function (h) {
          return h.notice_version || tx('None yet');
        }
      }
    ],
    defaultCols: ['when', 'what', 'how'],
    cardMax: 3,
    head: { title: tx('History') },
    empty: { title: tx('Nothing noted yet.'), sub: tx('Say yes or no above when they tell you.') }
  });
}
/** the customer's own no still stands: their newest own row (self / reply) on this channel's offers says no and the server's verdict is no — a staff yes after it does not lift it (api lib/consent-standing) */
function crmConsentStandingNo(r, ch) {
  var own = (r.history || []).filter(function (h) {
    return h.channel === ch && h.purpose === 'marketing' && (h.source === 'self' || h.source === 'reply');
  })[0];
  var m = ((r.may || {})[ch] || {}).marketing || {};
  return !!(own && !own.allowed && m.may === false);
}
/** say it plainly beside the toggle, per channel, from the history the api returned */
function crmConsentStanding(r) {
  CRM_CONSENT_CH.forEach(function (ch) {
    var node = document.querySelector('[data-standing="' + ch + '"]');
    if (node) node.textContent = crmConsentStandingNo(r, ch) ? tx('The customer said no themselves. Only their own yes lifts it.') : '';
  });
}
/** a Yes to offers needs its reason: the field opens in the block, beside the rows (the api asks for source staff + a note of 3+ characters) */
function crmConsentAsk(channel) {
  var box = document.getElementById('crm_consent_ask');
  if (!box) return;
  box.innerHTML =
    '<label>' +
    esc(tx('Why is it a yes? What did they say, and when?')) +
    '<input data-cbsid="CRM010-I03" class="inp" id="crm_consent_note" data-testid="crm-consent-note" maxlength="300" data-ch="' +
    esc(channel) +
    '" autocomplete="off"></label>' +
    '<div id="crm_consent_note_err" class="why" role="alert" data-testid="crm-consent-note-err"></div>' +
    '<div class="supacts">' +
    '<button data-cbsid="CRM010-B08" type="button" class="act sm" data-crm="consentsave" data-testid="crm-consent-note-save">' +
    esc(tx('Note yes')) +
    '</button>' +
    '<button data-cbsid="CRM010-B09" type="button" class="act sm ghost" data-crm="consentcancel" data-testid="crm-consent-note-cancel">' +
    esc(tx('Cancel')) +
    '</button></div>';
  document.getElementById('crm_consent_note').focus();
}
function crmConsentAskClose() {
  var box = document.getElementById('crm_consent_ask');
  if (box) box.innerHTML = '';
}
/** the Save of the reason field: 3+ characters here first (inline), then the one POST */
function crmConsentAskSave(party) {
  var field = document.getElementById('crm_consent_note'),
    err = document.getElementById('crm_consent_note_err');
  if (!field) return;
  var note = String(field.value || '').trim();
  if (note.length < 3) {
    err.textContent = tx('Add a short reason, at least 3 characters.');
    return;
  }
  err.textContent = '';
  crmConsentSet(party, field.getAttribute('data-ch'), 'marketing', true, note);
}
/** a Yes / No / Stop / Allow → ONE POST (the same route the shopper's own page writes through); the record re-reads. A staff Yes to offers carries source staff + its note */
async function crmConsentSet(p, ch, pu, allowed, note) {
  if (PRV.busy) return;
  PRV.busy = true;
  var field = document.getElementById('crm_consent_note_err');
  try {
    var body = { channel: ch, purpose: pu, allowed: allowed };
    if (allowed && pu === 'marketing') {
      body.source = 'staff';
      body.note = note;
    }
    await api('crmPrefSet', { params: { id: p.party_id }, body: body });
    toast(tx('Noted'));
    CRMR.keep.consentOpen = true;
    crmRecordOpen(CRM.route);
  } catch (e) {
    var words = e && e.status === 400 ? answerWords(e.data) : '';
    if (words && field) field.textContent = words; /* the api's own 400 words, on the field */
    else
      toast(
        e && e.status === 503
          ? tx('Consent records start after an update. Nothing is lost.')
          : e && e.status === 403
            ? crmViewWhy()
            : tx("Couldn't save that. Try again.")
      );
  } finally {
    PRV.busy = false;
  }
}
/** the click door the record hands here (crmRecordClick → crmPrivacyClick): true when handled */
var CRM_PRIV_CLICKS = {
  consent: function (node, party) {
    if (!party) return false;
    if (node.getAttribute('data-pu') === 'marketing' && node.getAttribute('data-v') === '1') crmConsentAsk(node.getAttribute('data-ch'));
    else crmConsentSet(party, node.getAttribute('data-ch'), node.getAttribute('data-pu'), node.getAttribute('data-v') === '1');
    return true;
  },
  consentsave: function (node, party) {
    if (!party) return false;
    crmConsentAskSave(party);
    return true;
  },
  consentcancel: function () {
    crmConsentAskClose();
    return true;
  },
  consentretry: function (node, party) {
    if (!party) return false;
    crmConsentOpen(party);
    return true;
  },
  privreq: function (node, party) {
    if (!party) return false;
    crmGo('#/privacy?party=' + encodeURIComponent(party.party_id) + '&who=' + encodeURIComponent(party.display_name || '') + '&add=1');
    return true;
  },
  prvadd: function () {
    crmPrivReqOpen(PRV.params);
    return true;
  },
  prvsave: function () {
    crmPrivReqSave();
    return true;
  },
  prvanswer: function (node) {
    crmPrivAnswerOpen(node.getAttribute('data-id'));
    return true;
  },
  prvanswersave: function (node) {
    crmPrivAnswerSave(node.getAttribute('data-id'));
    return true;
  },
  prvpage: function (node) {
    PRV.page = Math.max(1, Number(node.getAttribute('data-v')) || 1);
    crmPrivLoad();
    return true;
  },
  prvretry: function () {
    crmPrivLoad();
    return true;
  }
};
function crmPrivacyClick(a, node) {
  var handler = Object.prototype.hasOwnProperty.call(CRM_PRIV_CLICKS, a) ? CRM_PRIV_CLICKS[a] : null;
  return handler ? handler(node, CRMR.p) : false;
}
/** wired by crmRecordPaint's mounts: the Consent <details> loads its history the first time it opens (and stays open after a Yes/No) */
function crmConsentMount(p) {
  var node = document.querySelector('[data-testid="crm-sec-consent"]');
  if (!node) return;
  node.addEventListener('toggle', function () {
    if (!node.open) return;
    crmConsentOpen(p);
    crmConsentHolders();
  });
  if (CRMR.keep.consentOpen) {
    CRMR.keep.consentOpen = false;
    node.open = true;
  }
}
