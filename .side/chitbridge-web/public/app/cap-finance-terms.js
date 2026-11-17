/* cap-finance-terms.js — CB Finance · Terms (round F2): the shop's DEFAULT credit terms and each party's OWN, set in ONE place.
 * Loaded by finance.html after cap-finance.js. docs: C:/dev/CB-FINANCE-PLAN.md §4 F2. The CRM record, the counter and Accounts only READ these.
 *
 * ⭐ REUSE (CLAUDE.md rule 1, named in the PR): CBList.mount (the party list) · bkMoneyInput / bkMoneyRead / bkMoney (the M36 money unit — the limit)
 * · CBAction (M64 — Save) · modal/closeModal (finance.html's sheet) · bkPartyLabel · the /api/crm/parties read the CRM already makes.
 * ⭐ ONE CALCULATION (rule 2): nothing here works out money or which term applies — GET /api/books/terms answers `effective` (the party's own value,
 * else the shop's) and `may_set` for THIS login; a field paints what it was told. Before the SQL (b298) has run the server says so and this tab says it
 * in words — the form is greyed, never a 500. A change is an event on the server; the party sheet lists them.
 * ⭐ NEW PATHS (rule 4): FT (this tab's state) · FT_EP (the two /api/books/terms rows + crmParties, which finance.html did not load) · the tab switch
 * (#/terms) — Collections is one list, the nav had no second place to go.
 * ⚠️ Never error.message on a screen: a failure says what happened (CBAction.words) and the button stays.
 * OWNS      the Terms tab of CB Finance (ftLoad · ftSaveShop · ftSaveParty · ftOpen) and the Finance tab switch every other Finance tab uses (ftNav · finTab · FIN_TABS)
 * CALLED BY public/finance.html (script tag) · public/app/cap-finance.js (finTab · ftNav · ftMount · ftLoad) · public/app/cap-finance-cash.js · cap-finance-cheques.js · cap-finance-pay.js · cap-finance-returns.js ·
 *           cap-mis.js · cap-mis-trend.js (ftNav, the tab switch) · public/app/cap-repeat.js (finTab · ftNav)
 * FLOW GET /api/books/terms (+ crmParties) -> FT.t / FT.parties -> the shop form + CBList party rows -> ftOpen (a party's sheet) -> ftSaveShop / ftSaveParty -> POST /api/books/terms -> ftLoad again
 * CARD 16-finance/terms-and-credit
 */
'use strict';

var FT = {
  gen: 0,
  state: 'loading',
  t: null,
  parties: [],
  pstate: 'loading',
  api: null,
  cur: null,
  inherited: {} /* FIN-46: what each form falls back to (the shop's terms under a party's sheet), for the preview */,
  base: {} /* FIN-46: each form's values as loaded, so "nothing changed yet" is known */
}; /* CX0: the shop's currency is the ledger's (bkCur → SESSION.currency, set by the dues answer), never typed */
var FT_EP = {
  /* booksTerms (the read) and crmParties live in accounts-shell.js CB_PARTY_EP — CRM reads them too; one name, one place */
  booksTermsSet: { m: 'POST', p: '/api/books/terms', ok: '✓' } // owner · { party_id?, side?, credit_days, credit_limit_minor, interest, early } — null clears
};
Object.assign(EP, FT_EP);
var FT_NOT_YET = 'Terms arrive after the next update.';

/* UX-93: ONE reader of the address decides the tab - "#/payables" and "#payables" both (the header chip, screen-id.js, reads the same word, so it can never name another tab than the one shown) */
var FIN_TABS = {
  terms: 'terms',
  cash: 'cash',
  payables: 'pay',
  repeat: 'repeat',
  cheques: 'cheques',
  returns: 'returns',
  reports: 'reports'
}; /* cash: F3 (cap-finance-cash.js) · pay: F4 (cap-finance-pay.js) · repeat: RI1 (cap-repeat.js) · cheques · returns: T3-P1-MONEY (cap-finance-cheques.js · cap-finance-returns.js) */
function finTab() {
  return FIN_TABS[(location.hash || '').replace(/^#\/?/, '').split(/[/?&]/)[0]] || 'collect';
}
function ftNav() {
  var t = finTab();
  [
    ['collect', 'fin-nav-collections'],
    ['pay', 'fin-nav-payables'],
    ['cheques', 'fin-nav-cheques'],
    ['cash', 'fin-nav-cash'],
    ['terms', 'fin-nav-terms'],
    ['repeat', 'fin-nav-repeat'],
    ['returns', 'fin-nav-returns'],
    ['reports', 'fin-nav-reports']
  ].forEach(function (x) {
    var node = document.querySelector('[data-testid="' + x[1] + '"]');
    if (!node) return;
    node.classList.toggle('active', x[0] === t);
    if (x[0] === t) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
    /* the tab's word through the catalogue (INT4: the walk-locale ratchet counts a hard-wired label); the page's English is kept as the key */
    var l = node.querySelector('.label');
    if (l && typeof tx === 'function') {
      l.dataset.en = l.dataset.en || l.textContent;
      l.textContent = tx(l.dataset.en);
      node.setAttribute('aria-label', l.textContent);
    }
  });
}
window.addEventListener('hashchange', function () {
  if (!document.getElementById('screen') || typeof finMount !== 'function') return;
  ftNav();
  finMount(false);
});

/* ── the fields: one builder for the shop card and the party sheet ── */
function ftNum(v) {
  return v == null ? '' : String(v);
}
/* the label is a for= label on the control `id` (axe label, WCAG 4.1.2); bold kept as the old <b> had it */
function ftField(id, label, input) {
  return '<div class="kv"><label for="' + id + '" style="flex:1 1 150px;font-weight:700">' + esc(label) + '</label><span style="flex:1 1 150px">' + input + '</span></div>';
}
function ftInput(id, v, ph, off) {
  return (
    '<input data-cbsid="FIN004-I01" class="inp" id="' +
    id +
    '" data-testid="' +
    id +
    '" inputmode="numeric" autocomplete="off" value="' +
    esc(ftNum(v)) +
    '" placeholder="' +
    esc(ph == null ? '' : String(ph)) +
    '"' +
    (off ? ' disabled' : '') +
    '>'
  );
}
/* ── FIN-46 · the four questions, a live "What this means", the rules each with a fix button, a save bar with its reason ──
 * No new field: the same eight inputs the server already takes (credit days · limit · interest on / rate / grace · early % / days), grouped as the four
 * things a shopkeeper decides. The preview and the rules read the FORM's values, with the inherited default under each blank; they count days, never money
 * (the limit is painted by bkMoney). The server stays the judge: the rules mirror its sentences so the person fixes before pressing Save.
 * `prefix` is the form's id prefix: 'fts' the shop card, 'ftp' a party's sheet. */

/** the four headings in the customer's and the supplier's own words; one table, the form paints the side it is for */
var FT_QUESTIONS = {
  customer: ['When do they pay?', 'How much can they owe?', 'If they pay late', 'If they pay early'],
  supplier: ['When do you pay them?', 'How much can you owe them?', 'If you pay late', 'If you pay early']
};
function ftGroup(title, rows) {
  return '<h3 style="margin:14px 0 2px;font-size:14px">' + esc(tx(title)) + '</h3>' + rows;
}
/** the form: four grouped questions, then "What this means" and the rules. ownTerms: this level's values; inherited: what falls back; greyed: may not edit; side: customer | supplier */
function ftForm(prefix, ownTerms, inherited, greyed, side) {
  ownTerms = ownTerms || {};
  inherited = inherited || {};
  FT.inherited[prefix] = inherited;
  var heading = FT_QUESTIONS[side || 'customer'];
  return (
    ftGroup(heading[0], ftField(prefix + '_days', tx('Credit days'), ftInput(prefix + '_days', ownTerms.credit_days, inherited.credit_days, greyed))) +
    ftGroup(heading[1], ftLimitRow(prefix, ownTerms, inherited, greyed)) +
    ftGroup(heading[2], ftLateRows(prefix, ownTerms.interest || {}, inherited.interest || {}, greyed)) +
    ftGroup(heading[3], ftEarlyRows(prefix, ownTerms.early || {}, inherited.early || {}, greyed)) +
    '<h3 style="margin:14px 0 2px;font-size:14px">' +
    esc(tx('What this means')) +
    '</h3><div id="' +
    prefix +
    '_prev" data-testid="' +
    prefix +
    '-prev"></div><div id="' +
    prefix +
    '_rules" data-testid="' +
    prefix +
    '-rules"></div>'
  );
}
/** the credit limit row: the money unit (M36), the inherited limit as its placeholder */
function ftLimitRow(prefix, ownTerms, inherited, greyed) {
  return ftField(
    prefix + '_limit',
    tx('Credit limit'),
    bkMoneyInput({
      id: prefix + '_limit',
      minor: ownTerms.credit_limit_minor,
      cur: bkCur(FT.cur),
      ph: inherited.credit_limit_minor != null ? bkMoney(inherited.credit_limit_minor, bkCur(FT.cur)) : tx('No limit'),
      extra: greyed ? 'disabled' : ''
    })
  );
}
/** the "if they pay late" rows: the interest switch, its yearly rate and the grace days */
function ftLateRows(prefix, interest, inheritedInterest, greyed) {
  return (
    ftField(
      prefix + '_ion',
      tx('Interest on overdue'),
      '<input data-cbsid="FIN004-I02" type="checkbox" id="' +
        prefix +
        '_ion" data-testid="' +
        prefix +
        '_ion"' +
        (interest.on ? ' checked' : '') +
        (greyed ? ' disabled' : '') +
        '> <span class="hint">' +
        esc(tx('Shown, never charged')) +
        '</span>'
    ) +
    ftField(prefix + '_rate', tx('Rate % a year'), ftInput(prefix + '_rate', interest.rate_pct, inheritedInterest.rate_pct, greyed)) +
    ftField(prefix + '_grace', tx('Grace days'), ftInput(prefix + '_grace', interest.grace_days, inheritedInterest.grace_days, greyed))
  );
}
/** the "if they pay early" rows: the discount percent and the days it holds for */
function ftEarlyRows(prefix, early, inheritedEarly, greyed) {
  return (
    ftField(prefix + '_epct', tx('Early-pay discount %'), ftInput(prefix + '_epct', early.pct, inheritedEarly.pct, greyed)) +
    ftField(prefix + '_edays', tx('Pay within days'), ftInput(prefix + '_edays', early.within_days, inheritedEarly.within_days, greyed))
  );
}

/** the form's values with the inherited default under every blank: what these terms will MEAN. { bad } when a box holds a non-number */
function ftEffective(prefix) {
  var read = ftRead(prefix);
  if (read.bad) return { bad: read.bad };
  var body = read.body,
    inherited = FT.inherited[prefix] || {},
    inheritedInterest = inherited.interest || {},
    inheritedEarly = inherited.early || {},
    ownInterest = body.interest || {},
    ownEarly = body.early || {},
    pick = function (own, fallback) {
      return own != null ? own : fallback != null ? fallback : null;
    };
  return {
    days: pick(body.credit_days, inherited.credit_days),
    limit: pick(body.credit_limit_minor, inherited.credit_limit_minor),
    on: body.interest ? !!ownInterest.on : !!inheritedInterest.on,
    rate: pick(ownInterest.rate_pct, inheritedInterest.rate_pct),
    grace: pick(ownInterest.grace_days, inheritedInterest.grace_days) || 0,
    pct: pick(ownEarly.pct, inheritedEarly.pct),
    within: pick(ownEarly.within_days, inheritedEarly.within_days)
  };
}
/** the sentences of "What this means": due · discount until · late after · interest shown · limit — days counted, no money worked out */
function ftSentences(effective, currency) {
  var lines = [];
  lines.push(
    effective.days == null
      ? tx('No credit days are set, so a bill is due on its own date.')
      : effective.days === 0
        ? tx('Due the day the bill is made.')
        : txf('Due {n} days after the bill date.', { n: effective.days })
  );
  if (effective.pct > 0 && effective.within > 0) lines.push(txf('{pct}% off if paid within {n} days of the bill.', { pct: effective.pct, n: effective.within }));
  if (effective.days != null) lines.push(txf('Preview: counted as late after day {n}.', { n: effective.days + effective.grace }));
  lines.push(
    effective.on && effective.rate > 0
      ? txf('Interest of {rate}% a year is shown from then, a day at a time. It is shown, never charged.', { rate: effective.rate })
      : tx('No interest is shown on late bills.')
  );
  lines.push(effective.limit != null ? txf('Owes up to {amt} before you are warned.', { amt: bkMoney(effective.limit, currency) }) : tx('No credit limit.'));
  return lines;
}
/** a whole number of days from 0 to 3650 (or not set) */
function ftWholeDays(days) {
  return days == null || (Math.floor(days) === days && days >= 0 && days <= 3650);
}
/** the number rules: whole credit days, a limit, a rate from 0 to 100, whole grace days — { field, text, fix } each */
function ftRulesNumbers(effective, prefix) {
  var broken = [];
  if (!ftWholeDays(effective.days)) broken.push({ field: prefix + '_days', text: tx('Credit days must be a whole number from 0 to 3650.'), fix: tx('Fix credit days') });
  if (effective.limit != null && effective.limit < 0) broken.push({ field: prefix + '_limit', text: tx('The credit limit cannot be below 0.'), fix: tx('Fix the limit') });
  if (effective.rate != null && (effective.rate < 0 || effective.rate > 100))
    broken.push({ field: prefix + '_rate', text: tx('The rate must be from 0 to 100.'), fix: tx('Fix the rate') });
  if (!ftWholeDays(effective.grace)) broken.push({ field: prefix + '_grace', text: tx('Grace days must be a whole number from 0 to 3650.'), fix: tx('Fix grace days') });
  return broken;
}
/** the pairing rules: interest needs a rate · a discount is 0 to 100 and needs its days · its days end before the due date */
function ftRulesPairs(effective, prefix) {
  var broken = [];
  if (effective.on && !(effective.rate > 0)) broken.push({ field: prefix + '_rate', text: tx('Interest needs a rate above 0.'), fix: tx('Add a rate') });
  if (effective.pct > 100) broken.push({ field: prefix + '_epct', text: tx('The early-pay discount must be from 0 to 100.'), fix: tx('Fix the discount') });
  if (effective.pct > 0 && !(effective.within > 0)) broken.push({ field: prefix + '_edays', text: tx('Early-pay needs the number of days.'), fix: tx('Add the days') });
  if (effective.within > 0 && effective.days != null && effective.within > effective.days)
    broken.push({ field: prefix + '_edays', text: tx('The early-pay days run past the due date.'), fix: tx('Shorten the days') });
  return broken;
}
/** every rule the form breaks, each with the field its fix button takes the person to */
function ftRules(effective, prefix) {
  if (effective.bad) return [{ field: prefix + '_days', text: effective.bad, fix: tx('Fix it') }];
  return ftRulesNumbers(effective, prefix).concat(ftRulesPairs(effective, prefix));
}
/** a rule's fix button: the field it names is focused and selected */
function ftFix(fieldId) {
  var field = document.getElementById(fieldId);
  if (!field) return;
  field.focus();
  if (field.select) field.select();
}
/** the broken rules as rows, each a sentence and its fix button */
function ftRulesHtml(rules, prefix) {
  return rules
    .map(function (rule, index) {
      return (
        '<div class="kv" data-testid="' +
        prefix +
        '-rule-' +
        index +
        '"><span class="hint" style="color:var(--red-i)">⚠ ' +
        esc(rule.text) +
        '</span><button data-cbsid="FIN004-B01" type="button" class="act" data-testid="' +
        prefix +
        '-fix-' +
        index +
        '" onclick="ftFix(\'' +
        esc(rule.field) +
        '\')">' +
        esc(rule.fix) +
        '</button></div>'
      );
    })
    .join('');
}
/** the save bar's reason: why Save is greyed, said in words — '' when it may go, null when the person may not set terms at all */
function ftWhyNot(prefix, rules, greyed) {
  if (greyed) return null;
  if (rules.length) return txn('Fix {count} thing first.', 'Fix {count} things first.', rules.length);
  return FT.base[prefix] === JSON.stringify(ftRead(prefix).body) ? tx('Nothing changed yet.') : '';
}
/** repaint the preview, the rules and the save bar from the form as it stands (every keystroke) */
function ftRefresh(prefix) {
  var effective = ftEffective(prefix),
    rules = ftRules(effective, prefix),
    preview = document.getElementById(prefix + '_prev'),
    rulesBox = document.getElementById(prefix + '_rules');
  if (preview)
    preview.innerHTML = effective.bad
      ? ''
      : ftSentences(effective, bkCur(FT.cur))
          .map(function (line) {
            return '<div class="kv"><span>' + esc(line) + '</span></div>';
          })
          .join('');
  if (rulesBox) rulesBox.innerHTML = ftRulesHtml(rules, prefix);
  ftSaveBarState(prefix, rules);
}
/** the save button and its line: greyed with a stated reason, or ready */
function ftSaveBarState(prefix, rules) {
  var shop = prefix === 'fts',
    saveButton = document.querySelector('[data-testid="' + (shop ? 'ft-save' : 'ftp-save') + '"]'),
    reason = ftWhyNot(prefix, rules, saveButton ? saveButton.dataset.off === '1' : true);
  if (!saveButton || reason === null) return;
  saveButton.disabled = reason !== '';
  ftSay(shop ? 'ft_why' : 'ftp_why', reason);
}
/** the form is on the page: remember what it held (so "changed" is known), listen once, paint the first preview */
function ftWire(prefix, root) {
  FT.base[prefix] = JSON.stringify(ftRead(prefix).body);
  if (!root.dataset.wired) {
    root.dataset.wired = '1';
    ['input', 'change'].forEach(function (name) {
      root.addEventListener(name, function () {
        ftRefresh(prefix);
      });
    });
  }
  ftRefresh(prefix);
}

/* ── the Changes list: Undo puts the newest change back (a new change, so it is in the list too) ── */
var FT_UNDOABLE = { credit_days: 1, credit_limit_minor: 1, interest: 1, early: 1 };
/** the stored old value → what the server takes back (a number, or the interest / early object; null clears) */
function ftUndoVal(field, oldValue) {
  if (oldValue == null || oldValue === '') return null;
  if (field === 'interest' || field === 'early') return typeof oldValue === 'string' ? JSON.parse(oldValue) : oldValue;
  return Number(oldValue);
}
/** the extra html for one change row: Undo on the newest change only, greyed when the person may not set terms */
function ftUndoFor(list, greyed, partyId) {
  var newest = (list || []).reduce(function (best, change, index) {
    return best < 0 || String(change.at) > String((list[best] || {}).at) ? index : best;
  }, -1);
  return function (change, index) {
    var field = String(change.field || '').replace(/^(customer|supplier)\./, '');
    if (index !== newest || !FT_UNDOABLE[field]) return '';
    var old = change.old == null ? '' : typeof change.old === 'object' ? JSON.stringify(change.old) : String(change.old);
    return ' <button data-cbsid="FIN004-B02" type="button" class="act" data-testid="ft-undo" data-field="' + esc(field) + '" data-old="' + esc(old) + '" data-party="' + esc(partyId || '') + '"' + (greyed ? ' disabled' : '') + ' onclick="ftUndo(this)">' + esc(tx('Undo')) + '</button>';
  };
}
/** the standard confirm for a money setting (CBAction asks in the page's own dialog; Cancel sends nothing) */
function ftMoneyConfirm(title, body, yes) {
  return { title: title, body: esc(body), yes: yes, danger: false };
}
/** Undo: send the newest change's old value back as a new change, then read the terms again */
function ftUndo(btn) {
  var undo = { field: btn.dataset.field, old: btn.dataset.old, partyId: btn.dataset.party || null };
  if (!undo.field) return;
  var body = undo.partyId ? { party_id: undo.partyId, side: 'customer' } : {},
    lineId = undo.partyId ? 'ftp_why' : 'ft_why';
  try {
    body[undo.field] = ftUndoVal(undo.field, undo.old);
  } catch (_) {
    return ftSay(lineId, tx('That change cannot be undone here.'));
  }
  return CBAction.run(
    btn,
    function () {
      return api('booksTermsSet', { body: body });
    },
    {
      key: 'ft-undo',
      confirm: ftMoneyConfirm(tx('Undo this change?'), tx('The earlier terms are put back as a new change. It shows in the Changes list.'), tx('Undo')),
      out: lineId,
      failed: tx('Could not undo'),
      done: '✓ ' + tx('Undone'),
      outcome: function () {
        ftLoad(true).then(function () {
          if (undo.partyId) ftOpen(undo.partyId);
          ftSay(lineId, '✓ ' + tx('Undone'));
        });
      }
    }
  );
}
/** put a sentence on a status line, if the line is on the page */
function ftSay(lineId, text) {
  var line = document.getElementById(lineId);
  if (line) line.textContent = text;
}
function ftText(id) {
  var el = document.getElementById(id);
  return el ? String(el.value || '').trim() : '';
}
function ftOne(id) {
  var t = ftText(id);
  if (t === '') return null;
  var n = Number(t);
  return isFinite(n) ? n : NaN;
}
/** the form → the body the server takes, or { bad: sentence }. Empty = not set (null). Money is read by the money unit, never multiplied here. */
function ftRead(p) {
  var days = ftOne(p + '_days'),
    rate = ftOne(p + '_rate'),
    grace = ftOne(p + '_grace'),
    ep = ftOne(p + '_epct'),
    ed = ftOne(p + '_edays');
  if (
    [days, rate, grace, ep, ed].some(function (item) {
      return item !== null && isNaN(item);
    })
  )
    return { bad: tx('Numbers only, please') };
  var lt = ftText(p + '_limit'),
    lim = lt === '' ? null : bkMoneyRead(p + '_limit');
  if (lim !== null && isNaN(lim)) return { bad: tx('That limit is not an amount') };
  var on = !!(document.getElementById(p + '_ion') || {}).checked;
  return {
    body: {
      credit_days: days,
      credit_limit_minor: lim,
      interest: on || rate !== null || grace !== null ? { on: on, rate_pct: rate, grace_days: grace } : null,
      early: ep !== null || ed !== null ? { pct: ep, within_days: ed } : null
    }
  };
}

/* ── the screen ── */
function ftMount(frame) {
  var node = document.getElementById('screen');
  if (!node) return;
  ftNav();
  node.className = 'screen';
  node.innerHTML =
    '<div class="card" id="ft_shop" data-testid="ft-shop"></div><div id="ft_parties" data-testid="ft-parties" style="flex:1 1 auto;min-height:260px"></div>';
  ftShopPaint();
  FT.api = CBList.mount(document.getElementById('ft_parties'), {
    key: 'fin-terms',
    t: tx,
    rows: function () {
      return FT.parties;
    },
    id: function (p) {
      return p.party_id;
    },
    rowTid: function (p) {
      return 'ft-row-' + p.party_id;
    },
    columns: ftCols(),
    defaultCols: ['party', 'days', 'limit'],
    cardMax: 3,
    fill: false,
    head: function () {
      return { title: tx('Party terms') };
    },
    state: function () {
      return FT.pstate;
    },
    error: function () {
      return tx('Could not read your parties. Try again.');
    },
    onRetry: function () {
      ftLoad();
    },
    empty: { title: tx('No customers yet') },
    search: function (p) {
      return [p.party_no, p.name, bkPartyLabel(p.party_id, p.name)].join(' ');
    },
    sorts: [
      {
        key: 'name',
        label: tx('Name'),
        cmp: function (a, b) {
          return String(a.name || '').localeCompare(String(b.name || ''));
        }
      }
    ],
    onOpen: function (p) {
      ftOpen(p.party_id);
    }
  });
  if (!frame) ftLoad(FT.parties.length > 0);
}
function ftCols() {
  var dash = '<span style="color:var(--grey)">—</span>',
    mine = function (p) {
      return (p.terms && p.terms.customer) || {};
    };
  return [
    {
      key: 'party',
      label: tx('Party'),
      prio: 1,
      sort: 'name',
      w: 240,
      html: true,
      cell: function (p) {
        return esc(bkPartyLabel(p.party_id, p.name));
      }
    },
    {
      key: 'days',
      label: tx('Credit days'),
      prio: 2,
      w: 150,
      html: true,
      cell: function (p) {
        var d = mine(p).credit_days;
        return d == null ? dash + ' <span class="hint">' + esc(tx('Shop default')) + '</span>' : '<span data-b="days">' + esc(String(d)) + '</span>';
      }
    },
    {
      key: 'limit',
      label: tx('Credit limit'),
      prio: 3,
      w: 170,
      num: true,
      html: true,
      cell: function (p) {
        var l = mine(p).credit_limit_minor;
        return l == null ? dash : '<span data-b="limit">' + esc(bkMoney(Number(l), bkCur(FT.cur))) + '</span>';
      }
    }
  ];
}
function ftShopPaint() {
  var el = document.getElementById('ft_shop');
  if (!el) return;
  if (FT.state === 'loading') {
    el.innerHTML = '<h2>' + esc(tx('Shop terms')) + '</h2><p class="hint">' + esc(tx('Loading…')) + '</p>';
    return;
  }
  if (FT.state === 'error' || !FT.t) {
    el.innerHTML =
      '<h2>' +
      esc(tx('Shop terms')) +
      '</h2><p data-testid="ft-error">' +
      esc(tx('Could not read terms. Try again.')) +
      '</p><button data-cbsid="CMP009" type="button" class="act" data-testid="ft-retry" onclick="ftLoad()">' +
      esc(tx('Try again')) +
      '</button>';
    return;
  }
  var t = FT.t,
    off = !t.terms_migrated || !t.may_set,
    why = !t.terms_migrated ? FT_NOT_YET : t.may_set ? '' : t.why_not || 'Only the owner may set terms.';
  el.innerHTML =
    '<h2>' +
    esc(tx('Shop terms')) +
    ' <span class="hint" style="font-size:.6em;font-weight:500">(' +
    esc(tx('optional')) +
    ')</span> <span title="' +
    esc(tx('Used when a party has none of its own.')) +
    '" style="cursor:help;opacity:.7;font-size:.7em">ⓘ</span></h2>' +
    (why ? '<div class="hint" data-testid="ft-why" style="opacity:.85">' + esc(tx(why)) + '</div>' : '') +
    ftForm('fts', t.default, null, off) +
    ftSaveBar('ft-save', 'ft_why', 'ft-out', 'ftSaveShop(this)', off) +
    '<h3 style="margin:14px 0 4px;font-size:14px">' +
    esc(tx('Changes')) +
    '</h3>' +
    bkTermEvents(t.events, bkCur(FT.cur), 'ft-event', ftUndoFor(t.events, off, null));
  /* FIN-46: Save is a visible bar that says why it is greyed (the autosave on change is gone: settings are Save, not autosave) */
  ftWire('fts', el);
}
/** the save bar: the button (greyed while nothing changed, a rule is broken or the person may not set terms) and the line that says why */
function ftSaveBar(testId, whyId, outTestId, onclick, greyed) {
  return (
    '<div style="display:flex;gap:10px;align-items:center;margin-top:10px"><button data-cbsid="CMP001" type="button" class="act" data-testid="' +
    testId +
    '" data-off="' +
    (greyed ? '1' : '0') +
    '" disabled onclick="' +
    onclick +
    '">' +
    esc(tx('Save')) +
    '</button><span id="' +
    whyId +
    '" data-testid="' +
    outTestId +
    '" class="hint"></span></div>'
  );
}
async function ftLoad(quiet) {
  var g = ++FT.gen;
  if (!quiet) {
    FT.state = 'loading';
    FT.pstate = 'loading';
    ftShopPaint();
    if (FT.api) FT.api.refresh();
  }
  var terms = api('booksTerms').then(
    function (reply) {
      return { r: reply };
    },
    function (e) {
      return { e: e };
    }
  );
  var list = api('crmParties').then(
    function (reply) {
      return { r: reply };
    },
    function (e) {
      return { e: e };
    }
  );
  var a = await terms,
    b = await list;
  if (g !== FT.gen) return;
  if ((a.e && a.e.status === 404) || (b.e && b.e.status === 404 && !a.r)) {
    finOff();
    return;
  } /* the Ledger is off (M212) */
  if (a.r) {
    FT.t = a.r;
    FT.state = 'ready';
  } else {
    FT.state = 'error';
  }
  if (b.r) {
    FT.parties = (b.r.parties || []).filter(function (item) {
      return item.roles && item.roles.customer && item.kind !== 'walk-in';
    });
    FT.pstate = 'ready';
  } else {
    FT.pstate = 'error';
  }
  ftShopPaint();
  if (FT.api) FT.api.refresh();
}
function ftSaveShop(btn) {
  var r = ftRead('fts'),
    out = document.getElementById('ft_why');
  if (r.bad) {
    if (out) out.textContent = r.bad;
    return;
  }
  return CBAction.run(
    btn,
    function () {
      return api('booksTermsSet', { body: r.body });
    },
    {
      key: 'ft-save',
      confirm: ftMoneyConfirm(tx('Save these terms?'), tx('Credit, interest and discount terms apply to new bills from now on. Each change shows in the Changes list.'), tx('Save terms')),
      out: 'ft_why',
      failed: tx('Could not save terms'),
      done: '✓ ' + tx('Saved'),
      outcome: function () {
        ftLoad(true).then(function () {
          ftSay('ft_why', '✓ ' + tx('Saved')); /* the repaint wiped the button's line: say it again on the new bar */
        });
      }
    }
  );
}

/* ── one party's own terms: the sheet ── */
async function ftOpen(pid) {
  var p = FT.parties.filter(function (x) {
    return x.party_id === pid;
  })[0] || { party_id: pid };
  modal(
    '<div class="mhd"><div class="t" data-testid="ft-sheet-title">' +
      esc(bkPartyLabel(pid, p.name)) +
      '</div></div><div class="mbody" id="ft_sheet_body"><p class="hint">' +
      esc(tx('Loading…')) +
      '</p></div>'
  );
  var r;
  try {
    r = await api('booksTerms', { query: { party_id: pid, side: 'customer' } });
  } catch (e) {
    var node = document.getElementById('ft_sheet_body');
    if (node) node.innerHTML = '<p data-testid="ft-sheet-error">' + esc(tx('Could not read terms. Try again.')) + '</p>';
    return;
  }
  var body = document.getElementById('ft_sheet_body');
  if (!body) return;
  var off = !r.terms_migrated || !r.may_set,
    why = !r.terms_migrated ? FT_NOT_YET : r.may_set ? '' : r.why_not || '';
  var own = r.party ? r.party.own : {},
    d = r.default || {};
  body.innerHTML =
    (why ? '<div class="hint" data-testid="ft-sheet-why">' + esc(tx(why)) + '</div>' : '') +
    '<p class="hint">' +
    esc(tx('Empty means the shop default.')) +
    '</p>' +
    ftForm('ftp', own, d, off) +
    '<h3 style="margin:12px 0 4px;font-size:14px">' +
    esc(tx('Changes')) +
    '</h3>' +
    bkTermEvents(r.events, bkCur(FT.cur), 'ft-event', ftUndoFor(r.events, off, pid));
  var foot = document.querySelector('#fin_sheet .mfoot');
  if (foot) foot.remove();
  body.insertAdjacentHTML(
    'afterend',
    '<div class="mfoot"><span id="ftp_why" data-testid="ftp-out" class="hint"></span><button data-cbsid="CMP005" type="button" onclick="closeModal()">' +
      esc(tx('Close')) +
      '</button>' +
      '<button data-cbsid="CMP001" type="button" class="act" data-testid="ftp-save" data-off="' +
      (off ? '1' : '0') +
      '" disabled onclick="ftSaveParty(\'' +
      esc(pid) +
      '\',this)">' +
      esc(tx('Save')) +
      '</button></div>'
  );
  ftWire('ftp', body);
}
function ftSaveParty(pid, btn) {
  var r = ftRead('ftp'),
    out = document.getElementById('ftp_why');
  if (r.bad) {
    if (out) out.textContent = r.bad;
    return;
  }
  var body = Object.assign({ party_id: pid, side: 'customer' }, r.body);
  return CBAction.run(
    btn,
    function () {
      return api('booksTermsSet', { body: body });
    },
    {
      key: 'ftp-save:' + pid,
      confirm: ftMoneyConfirm(tx('Save these terms?'), tx('Credit, interest and discount terms apply to new bills from now on. Each change shows in the Changes list.'), tx('Save terms')),
      out: 'ftp_why',
      failed: tx('Could not save terms'),
      done: tx('Saved'),
      outcome: function () {
        ftLoad(true).then(function () {
          ftOpen(pid); /* R76: the re-opened dialog wiped the button's "Saved" — say it in the dialog's own line */
          var said = document.getElementById('ftp_why');
          if (said) said.textContent = '✓ ' + tx('Saved');
        });
      }
    }
  );
}
