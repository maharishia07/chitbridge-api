/* app/cap-register.js — THE REGISTER. Lazy (ensureCap('register')).
 *
 * Athi, 2026-08-30: *"complete the entire stuff and showcase the outcome"* — and, earlier, *"at the end of the
 * test, it has to clearly come out as actions? correct?"*
 *
 * ── ⭐⭐ THREE VIEWS, BECAUSE A REGISTER ANSWERS THREE DIFFERENT QUESTIONS ───────────────────────────────────
 *   LIVE     what is open, who has it, what is it worth watching — the working list
 *   CLOSURE  ⭐ THE OUTCOME. What happened to everything, named, and WHAT CAME OUT AS WORK
 *   IMPACT   what this breaks, or what broke it — the graph, walked from one entry
 *
 * ⚠️ THEY ARE NOT FILTERS OF ONE LIST. Closure is the view that must not be skimmed: it is the only place that
 * separates "resolved" from "the order closed and nobody ever answered it", and folding it into a status column
 * on the live list is exactly how a campaign gets reported clean while shipping four unfixed things.
 *
 * ⚠️ THE OLD REPORT WAS A FLAT LIST AND STAYS REACHABLE — Live IS that list, plus the registers down the side.
 * Nothing that worked before needs a new gesture to reach.
 
 * CALLED BY public/app.html, public/app/cap-worklist.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
/* OWNS the register screens: live, closure, impact; recording against a chit or a line
 * CALLED BY app.html (ensureCap('register')), cap-worklist.js (rgQuickAdd)
 * FLOW api raidaReport / reg* -> RG -> rgPaint; a refusal CAPABILITY_OFF is said in words (registerOffWords), any other failure through MSG.fail
 * CARD 03-disputes-service-and-register/raida-register-and-report */
var RG = {
  view: 'live',
  subjects: null,
  sel: null,
  report: null,
  attach: null,
  walk: null,
  walkFrom: null,
  walkBack: true,
  busy: false,
  err: null,
  adding: false,
  closing: null,
  editing: null,
  opening: false,
  ctx: null,
  ctxWhole: false
};

/* ── the shell ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⭐⭐ A REGISTER IS A TABLE, AND IT NEEDS THE ROOM — Athi, 2026-08-30: *"it is currently bringing the task
 * panel. what we need is a proper UI for RISK register with all the columns intact so it looks like a
 * register."*
 *
 * ⚠️ IT WAS RENDERING INTO `.notifpanel`, the message-centre shell — ~300px of stacked rows. That is the right
 * frame for notifications and the wrong one for a register: every standard here (PRINCE2, PMBOK, ISO 31000,
 * MIL-STD-882E) describes a row per risk with inherent score, treatment and residual score side by side, and
 * every tool that renders one — Excel included, which is what most people actually use — renders it wide.
 * Stacked into a narrow pane the columns cannot sit beside each other, so the comparison the register exists to
 * support cannot be made.
 *
 * ⭐ REUSES modal(html, true): 820px, movable and resizable via makeMovable, with its own close control. No new
 * frame, no new coordinates — see UI placement standards.
 */
function rgShell(body, right, loading) {
  return (
    '<div class="mhd" style="display:flex;align-items:center;gap:10px">' +
    '<div class="t" style="flex:1;padding-inline-end:30px">' +
    tx('📋 Register') +
    '</div>' +
    /* ⚠️ 72px of clearance. modal() puts its close button at inset-inline-end:9px and mvModal defaults
       barAt:'right', which parks the drag grip at 42px — so anything flush right in this header lands
       UNDER both. The counts were doing exactly that. */
    (right ? '<div style="font-size:var(--fs-1);color:var(--grey);white-space:nowrap;padding-inline-end:72px">' + right + '</div>' : '') +
    '</div>' +
    /* ⚠️ data-ready SEPARATES 'open' FROM 'opening'. Both states carried the same testid, so anything waiting
       for the panel — a spec, a screen reader — was told it had arrived while it was still a spinner. A
       surface that announces itself ready before it is is a wrong answer, not a slow one. */
    '<div class="mbody" data-testid="register-panel" data-ready="' +
    (loading ? '0' : '1') +
    '"' +
    ' style="padding:12px 16px 16px">' +
    body +
    '</div>'
  );
}

function rgTabs() {
  var list = [
    ['live', tx('Register')],
    ['closure', tx('Closure')],
    ['impact', tx('Impact')]
  ];
  return (
    '<div class="raidtoggle" style="padding:0 0 10px">' +
    list
      .map(function (item) {
        return (
          '<button data-cbsid="SCR007-B01" data-testid="register-tab-' +
          item[0] +
          '" class="' +
          (RG.view === item[0] ? 'on' : '') +
          '"' +
          ' onclick="rgGo(&quot;' +
          item[0] +
          '&quot;)">' +
          item[1] +
          '</button>'
        );
      })
      .join('') +
    '</div>'
  );
}

function rgGo(v) {
  RG.view = v;
  RG.err = null;
  rgPaint();
  if (v === 'impact' && !RG.walk) rgWalkPick();
}

/* ── loading ────────────────────────────────────────────────────────────────────────────────────────────── */

/** a failed register call in words: the off register says so, anything else goes through MSG.fail */
function rgFail(verb, e) {
  return registerOffWords(e) || MSG.fail(verb, e);
}

/** why a register read failed, in words: the off register says so, else the error's own words, else `fallback` */
function rgWhy(e, fallback) {
  return registerOffWords(e) || (e && e.message) || fallback;
}

/**
 * ⚠️ THE THREE VIEWS SHARE ONE LOAD. The report is every entry this entity holds; subjects are the registers
 * they hang off. Fetching per-view would make switching tabs a network round trip for data already in hand.
 */
async function rgLoad(force) {
  if (RG.busy) return;
  if (RG.report && !force) return;
  RG.busy = true;
  RG.err = null;
  try {
    var reply = await api('raidaReport');
    RG.report = reply || { entries: [] };
    /* Subjects only exist after b185. A phase-0 database answers the report and not this, which is not a fault. */
    if (reply && reply.full) {
      try {
        var s = await api('regSubjects');
        RG.subjects = (s && s.subjects) || [];
      } catch (_) {
        RG.subjects = [];
      }
      try {
        var a = await api('regAttachables');
        RG.attach = (a && a.attachables) || [];
      } catch (_) {
        RG.attach = [];
      }
    }
  } catch (e) {
    RG.err = rgWhy(e, tx('Could not read the register just now.'));
  }
  RG.busy = false;
}

async function openRegister(force) {
  if (!RG.report || force) {
    modal(
      rgShell(
        '<div style="padding:14px 2px;color:var(--grey);font-size:var(--fs-2)">' + '<span class="spin"></span> ' + tx('reading every register…') + '</div>',
        '',
        true
      ),
      true, { pop: 'POP067' }
    );
    await rgLoad(force);
  }
  rgPaint();
}

/* max-width:94vw on .modal.wide still applies, so this asks for room and never overflows a narrow screen. */
function rgWiden() {
  var node = document.querySelector('#modalhost .modal');
  if (!node) return;
  /* ⭐ WIDE ONLY WHEN THERE IS A TABLE. 1240px exists so fifteen columns can be read across; wrapped around a
     560px form it is just empty space, and an empty state that looks broken is its own problem. */
  var wide = rgEntries().length > 0 || (RG.subjects || []).length > 0;
  node.classList[wide ? 'add' : 'remove']('rg-modal');
}

/**
 * ⚠️ THE CONDITIONAL FIELDS MUST MATCH THE KIND THAT IS ALREADY SELECTED. rgKindChanged is an onchange, so on
 * first paint the response and edge blocks stayed hidden even with Risk pre-selected — the field a person came
 * to fill was invisible until they changed the dropdown to something else and back.
 */
function rgSyncFields() {
  try {
    if (document.getElementById('rgKind')) rgKindChanged();
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
}

function rgPaint() {
  var r = RG.report;
  var body;

  if (RG.err) {
    /* ⚠️ Say what is NOT known. "Nothing here" and "I could not look" are different answers. */
    body =
      '<div style="padding:14px 2px;color:var(--disp);font-size:var(--fs-2)">' +
      esc(RG.err) +
      '<br><span style="color:var(--grey)">' +
      tx('This does NOT mean there is nothing on the register.') +
      '</span></div>';
    modal(rgShell(body), true, { pop: 'POP067' });
    return;
  }
  if (r && r.migrated === false) {
    modal(
      rgShell(
        '<div style="padding:14px 2px;color:var(--grey);font-size:var(--fs-2)">' +
          tx('The register is not switched on for this environment yet (b182).') +
          '</div>'
      ),
      true, { pop: 'POP067' }
    );
    return;
  }

  var head = r
    ? r.open + ' ' + tx('open') + ' · ' + r.closed + ' ' + tx('closed') + (r.closed_by_order ? ' · ' + r.closed_by_order + ' ' + tx('with the order') : '')
    : '';
  body = RG.view === 'closure' ? rgClosure() : RG.view === 'impact' ? rgImpact() : rgLive();
  modal(rgShell(rgTabs() + body, head), true, { pop: 'POP067' });
  rgWiden();
  rgSyncFields();
}

/* ── shared bits ────────────────────────────────────────────────────────────────────────────────────────── */

function rgIcon(k) {
  return (RAIDA_KINDS[k] && RAIDA_KINDS[k].icon) || '•';
}
function rgLabel(k) {
  return (RAIDA_KINDS[k] && RAIDA_KINDS[k].label) || k;
}
function rgEnding(d) {
  return (RAIDA_ENDINGS[d] && RAIDA_ENDINGS[d].label) || d;
}
function rgBand(t, n) {
  return (
    '<div style="margin-top:12px;font-size:var(--fs-1);font-weight:800;letter-spacing:.06em;' +
    'text-transform:uppercase;color:var(--grey)">' +
    t +
    (n != null ? ' · ' + n : '') +
    '</div>'
  );
}
function rgEntries() {
  return (RG.report && RG.report.entries) || [];
}

/* Entries on the selected register, or all of them when nothing is selected. */
function rgScoped() {
  var list = rgEntries();
  return RG.sel
    ? list.filter(function (e) {
        return e.subject_id === RG.sel;
      })
    : list;
}
function rgSubjectName(id) {
  var s = (RG.subjects || []).find(function (x) {
    return x.subject_id === id;
  });
  return s ? s.name : null;
}

/**
 * ⭐⭐ THE FOUR BANDS, WHICH IS HOW EVERY TOOL COLOURS A REGISTER. 5×5 gives 1–25; the split below is the common
 * one (low · medium · high · extreme). The band is what makes a register scannable — a column of bare integers
 * is a spreadsheet, not a risk view.
 *
 * ⚠️ NO BAND FOR AN UNRATED ENTRY. Colouring "nobody has assessed this" green is the single most misleading
 * thing a register can do.
 */
function rgBandOf(score) {
  if (!score) return null;
  if (score >= 15) return { key: 'extreme', label: tx('Extreme'), fg: 'var(--disp)' };
  if (score >= 10) return { key: 'high', label: tx('High'), fg: 'var(--disp)' };
  if (score >= 5) return { key: 'high', label: tx('Medium'), fg: 'var(--warn-2)' };
  return { key: 'low', label: tx('Low'), fg: 'var(--grey)' };
}

function rgCell(l, s, score) {
  if (!score) return '<span style="color:var(--grey)">—</span>';
  var b = rgBandOf(score);
  return (
    '<span title="' +
    esc(tx('likelihood × severity')) +
    '" style="color:' +
    b.fg +
    ';font-weight:700;' +
    'font-variant-numeric:tabular-nums">' +
    l +
    '×' +
    s +
    '</span> ' +
    '<span style="color:' +
    b.fg +
    ';font-variant-numeric:tabular-nums">' +
    score +
    '</span>'
  );
}

/**
 * ⭐⭐ THE HEAT MAP — likelihood against severity, counts in the cells. Every risk tool pairs the register with
 * one, and it answers the question the table cannot: not "what is on it" but "what shape is this".
 *
 * ⚠️ RESIDUAL WHERE THERE IS ONE, INHERENT OTHERWISE, and it says which. Plotting inherent scores next to
 * residual ones in the same grid would double-count treated risks and overstate the exposure.
 */
function rgHeat(entries) {
  var rated = entries.filter(function (e) {
    return e.open && e.severity && e.likelihood;
  });
  if (!rated.length) return '';
  var grid = {},
    anyResidual = false;
  rated.forEach(function (e) {
    var nestedL = e.residual_likelihood || e.likelihood,
      s = e.residual_severity || e.severity;
    if (e.residual_likelihood || e.residual_severity) anyResidual = true;
    grid[nestedL + ':' + s] = (grid[nestedL + ':' + s] || 0) + 1;
  });
  var rows = '';
  for (var l = 5; l >= 1; l--) {
    var cells = '';
    for (var count = 1; count <= 5; count++) {
      var n = grid[l + ':' + count] || 0;
      var b = rgBandOf(l * count);
      cells += '<td class="rg-hc" style="' + (n ? 'color:' + b.fg + ';font-weight:700' : 'color:var(--line)') + '">' + (n || '·') + '</td>';
    }
    rows += '<tr><th class="rg-hh">' + l + '</th>' + cells + '</tr>';
  }
  return (
    '<div class="rg-heat"><table class="rg-heatt" aria-label="' +
    esc(tx('Likelihood against severity')) +
    '">' +
    '<caption>' +
    tx('Open, by likelihood × severity') +
    (anyResidual ? ' · <span style="color:var(--grey)">' + tx('residual where set') + '</span>' : '') +
    '</caption>' +
    rows +
    '<tr><th class="rg-hh"></th>' +
    [1, 2, 3, 4, 5]
      .map(function (item) {
        return '<th class="rg-hh">' + item + '</th>';
      })
      .join('') +
    '</tr></table>' +
    '<div class="rg-hax">' +
    tx('severity →') +
    '</div></div>'
  );
}

/**
 * ⭐ THE REGISTERS THEMSELVES. One chip per subject with its open count, plus "All registers" — the roll-up
 * across every one of them, which is the view a governance question usually starts from.
 */
function rgRegisterRail() {
  var subs = RG.subjects;
  if (!subs) return '';
  /* ⚠️ Nothing to choose between, and the form below already offers the only action — a lone "All registers"
     chip beside a + that opens what is on screen is two answers to one question. */
  if (!subs.length) return '';
  var list = rgEntries();
  var countFor = function (id) {
    return list.filter(function (e) {
      return e.subject_id === id && e.open;
    }).length;
  };
  var chip = function (id, name, n, closed) {
    return (
      '<button data-cbsid="SCR007-B02" data-testid="register-subject" class="' +
      (RG.sel === id ? 'on' : '') +
      '"' +
      ' onclick="rgSel(' +
      (id ? '&quot;' + id + '&quot;' : 'null') +
      ')"' +
      ' title="' +
      esc(name) +
      '">' +
      esc(name) +
      (n ? ' <b>' + n + '</b>' : '') +
      (closed ? ' ✓' : '') +
      '</button>'
    );
  };
  return (
    '<div class="raidtoggle" style="padding:0 0 8px">' +
    chip(
      null,
      tx('All registers'),
      list.filter(function (e) {
        return e.open;
      }).length,
      false
    ) +
    subs
      .map(function (item) {
        return chip(item.subject_id, item.name, countFor(item.subject_id), !!item.closed_at);
      })
      .join('') +
    '<button data-cbsid="SCR007-B03" onclick="rgQuickAdd()" data-testid="register-new" title="' +
    esc(tx('Record something in a new register')) +
    '">＋ ' +
    tx('New') +
    '</button>' +
    '</div>'
  );
}

function rgSel(id) {
  RG.sel = id;
  RG.walk = null;
  RG.walkFrom = null;
  rgPaint();
}

/* ── LIVE — the register itself ─────────────────────────────────────────────────────────────────────────── */

/**
 * ⭐⭐ THE COLUMNS ARE NOT INVENTED. They are the set PRINCE2, PMBOK, ISO 31000 and MIL-STD-882E agree on:
 * an identifier · what it is · the description · who owns it · when it was raised · an INHERENT score ·
 * the treatment · a RESIDUAL score · dates · status. Two of them carry more weight than they look:
 *
 *   ⭐ INHERENT AND RESIDUAL SIT SIDE BY SIDE. A register that shows one number cannot show that anything was
 *     done — the whole argument of a treatment is the distance between the two.
 *   ⭐ VERIFY is ISO/IEC/IEEE 15288's four (test · analysis · inspection · demonstration). "How would we know"
 *     is the column that separates a register from a worry list.
 *
 * ⚠️ THE CHIT IS A LINK, NOT THE ROW. Making the whole row navigate is what made this feel like the task panel:
 * a register is read across, and a row that jumps away on any click cannot be read at all.
 */
function rgLinkTo(e) {
  if (!e.chit_id) return '<span style="color:var(--grey)">' + tx('standalone') + '</span>';
  var label = e.particulars || e.subject || tx('the order');
  return (
    '<a data-cbsid="SCR007-C01" href="#" class="rg-link" data-testid="raida-chit-link"' +
    ' onclick="event.preventDefault();event.stopPropagation();closeModal();openChit(&quot;' +
    e.chit_id +
    '&quot;);return false"' +
    ' title="' +
    esc(tx('Open the order')) +
    '">' +
    esc(label) +
    ' ↗</a>'
  );
}

/**
 * ⭐⭐ ORDERED BY WHAT A REGISTER IS READ FOR, not by what the table happens to hold. The first pass put
 * Register and Where in positions 4 and 5 — so at any sane window width the visible columns were id, type,
 * description, and two pieces of CONTEXT, while inherent score, response, treatment and residual were all off
 * the right edge. A register whose scores need a horizontal scroll is barely better than the stacked rows this
 * replaced.
 *
 * ⭐ The risk story now reads left to right without moving: what it is → how bad → what we decided → what we
 * are doing → what is left. Context and dates follow.
 */
var RG_COLS = [
  { k: 'id', w: '64px', h: 'ID' },
  { k: 'type', w: '108px', h: 'Type' },
  { k: 'what', w: 'minmax(200px,1.3fr)', h: 'What' },
  { k: 'inherent', w: '86px', h: 'Inherent' },
  { k: 'response', w: '96px', h: 'Response' },
  { k: 'treatment', w: 'minmax(140px,1fr)', h: 'Treatment' },
  { k: 'residual', w: '86px', h: 'Residual' },
  { k: 'verify', w: '92px', h: 'Verify' },
  { k: 'owner', w: '96px', h: 'Owner' },
  { k: 'where', w: 'minmax(120px,1fr)', h: 'Where' },
  { k: 'due', w: '92px', h: 'Due' },
  { k: 'review', w: '92px', h: 'Review' },
  { k: 'register', w: 'minmax(130px,1fr)', h: 'Register' },
  { k: 'raised', w: '92px', h: 'Raised' },
  { k: 'status', w: '100px', h: 'Status' }
];

function rgTpl() {
  return RG_COLS.map(function (item) {
    return item.w;
  }).join(' ');
}

/* ⚠️ Each heading carries its key, so a spec can assert the header and the cells agree on ORDER and not merely
   on count — a reorder that misaligns every column is otherwise completely silent. */
function rgHead() {
  return (
    '<div class="lhead" style="grid-template-columns:' +
    rgTpl() +
    '">' +
    RG_COLS.map(function (item) {
      return '<div data-col="' + item.k + '">' + tx(item.h) + '</div>';
    }).join('') +
    '</div>'
  );
}

/**
 * ⚠️⚠️ THE CELLS ARE KEYED, AND RENDERED IN RG_COLS ORDER. They used to be written out as a hand-ordered list
 * of divs beside a hand-ordered list of headings — two orderings of one fact. Reordering the columns then
 * misaligns every cell after the change with NO error anywhere, and a count check does not catch it because the
 * count is still right. Deriving the order from RG_COLS makes that class of bug unrepresentable.
 */
function rgTr(e) {
  var dash = '<span style="color:var(--grey)">—</span>';
  var d = function (v) {
    return v ? esc(String(v).slice(0, 10)) : '';
  };
  var end =
    e.ending === 'closed'
      ? '<span style="color:var(--grey)">' + esc(rgEnding(e.disposition)) + '</span>'
      : e.ending === 'closed_by_order'
        ? '<span style="color:var(--warn-2)">' + tx('with the order') + '</span>'
        : '<button data-cbsid="CMP012" class="rg-act" data-testid="raida-edit" onclick="rgEditAsk(&quot;' +
          e.raida_id +
          '&quot;)">' +
          tx('Edit') +
          '</button> ' +
          '<button data-cbsid="SCR007-B04" class="rg-act" data-testid="raida-close" onclick="rgCloseAsk(&quot;' +
          e.raida_id +
          '&quot;)">' +
          tx('End →') +
          '</button>';

  var cell = {
    id: { c: 'rg-id', h: esc(String(e.raida_id).slice(0, 6)), t: e.raida_id },
    type: { h: '<span class="mtype ' + e.kind + '">' + rgIcon(e.kind) + ' ' + esc(rgLabel(e.kind)) + '</span>' },
    what: { c: 'rg-what', h: esc(e.body) },
    inherent: { c: 'rg-num', h: rgCell(e.likelihood, e.severity, e.score) },
    response: { c: 'rg-clip', h: e.response ? esc(rgRespLabel(e.response)) : dash },
    treatment: { c: 'rg-what', h: e.treatment ? esc(e.treatment) : dash },
    residual: {
      c: 'rg-num',
      h: e.residual_likelihood && e.residual_severity ? rgCell(e.residual_likelihood, e.residual_severity, e.residual_likelihood * e.residual_severity) : dash
    },
    verify: { c: 'rg-clip', h: e.verification_method ? esc(e.verification_method) : dash },
    owner: { c: 'rg-clip', h: esc(e.owner || e.by || '') },
    where: { c: 'rg-clip', h: rgLinkTo(e) },
    due: { c: 'rg-dt', h: d(e.due_date) },
    review: { c: 'rg-dt', h: d(e.review_date) },
    register: { c: 'rg-clip', h: esc(e.subject || '') },
    raised: { c: 'rg-dt', h: d(e.at) },
    status: { h: end }
  };

  return (
    '<div class="lrow rg-row' +
    (e.open ? '' : ' rg-shut') +
    '" data-testid="raida-item"' +
    ' data-rid="' +
    e.raida_id +
    '" style="grid-template-columns:' +
    rgTpl() +
    '">' +
    RG_COLS.map(function (col) {
      var v = cell[col.k] || { h: '' };
      return '<div data-col="' + col.k + '"' + (v.c ? ' class="' + v.c + '"' : '') + (v.t ? ' title="' + esc(v.t) + '"' : '') + '>' + v.h + '</div>';
    }).join('') +
    '</div>'
  );
}

function rgTable(list) {
  return '<div class="rg-wrap" data-testid="register-table">' + '<div class="rg-grid">' + rgHead() + list.map(rgTr).join('') + '</div></div>';
}

/**
 * ⚠️ ONLY WHAT THE STANDARD LIST DOES NOT ALREADY GIVE. `.lhead` and `.lrow` carry the header, the type scale,
 * the borders, the hover and the spacing; everything below is either the scroll frame they sit in or one of the
 * three deliberate departures. Restating what they already do is how two lists start to disagree.
 *
 * The styles travel with the capability because it is lazily loaded — putting them in the shell would ship a
 * register's worth of CSS to everyone who never opens one.
 */
function rgCss() {
  return (
    '<style>' +
    /* the scroll frame — a register is wider than any pane, and the page must never scroll sideways with it */
    /* ⭐ A register is a WIDE object. modal(…, true) is 820px — right for a form, wrong here: at 820 the
       scores sit off the right edge, which is most of why the first attempt read as a stacked panel.
       Scoped to this capability rather than widening every modal in the app. */
    '#modalhost .modal.rg-modal{width:1240px}' +
    '.rg-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;margin-top:8px}' +
    '.rg-grid{min-width:1620px}' +
    /* ⚠️ THE ROW AND HEADER LOOK USED TO COME FROM list-ctl.js's global styles (.lhead · .lrow). list-ctl.js is CBList now and owns only its
       own look, so the register — a hand-drawn list in a modal, NOT yet a CBList mount (see e2e/list-standard.cjs DEBT) — carries its own */
    '.rg-wrap .lhead,.rg-wrap .lrow{display:grid;align-items:start;gap:8px;padding:8px 12px;font-size:var(--fs-2)}' +
    '.rg-wrap .lhead{position:sticky;top:0;z-index:3;background:var(--card);border-bottom:1.5px solid var(--line);font-size:var(--fs-1);font-weight:700;color:var(--grey);text-transform:uppercase;letter-spacing:.3px}' +
    '.rg-wrap .lrow{border-bottom:1px solid var(--line)}.rg-wrap .lrow:hover{background:var(--paper)}' +
    /* ⚠️ departure 1 — a register row is READ, not opened. The chit inside it is the link. */
    '.rg-row{cursor:default}' +
    /* ⚠️ departure 2 — the description and the treatment wrap; everything else stays on one line so it scans */
    '.rg-what{white-space:normal;overflow-wrap:anywhere;line-height:1.4}' +
    '.rg-clip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    /* ⚠️ departure 3 — figures line up. Scores and dates are compared down the column, not read as words. */
    '.rg-num,.rg-dt{font-variant-numeric:tabular-nums}' +
    '.rg-dt{color:var(--grey)}' +
    '.rg-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--grey);font-size:var(--fs-1)}' +
    '.rg-shut{opacity:.55}' +
    '.rg-link{color:var(--blue-2);text-decoration:none}' +
    '.rg-link:hover{text-decoration:underline}' +
    '.rg-act{background:none;border:1px solid var(--line);border-radius:7px;padding:2px 8px;cursor:pointer;' +
    'color:var(--blue-2);font-size:var(--fs-1)}' +
    '.rg-act:hover{border-color:var(--blue-2)}' +
    /* the heat map — its own small object, sized to sit beside the counts rather than compete with them */
    '.rg-heat{display:inline-block;margin:8px 14px 4px 0;vertical-align:top}' +
    '.rg-heatt{border-collapse:collapse}' +
    '.rg-heatt caption{caption-side:top;text-align:start;font-size:var(--fs-1);color:var(--grey);' +
    'padding-bottom:4px;white-space:nowrap}' +
    '.rg-hc{width:26px;height:22px;text-align:center;border:1px solid var(--line);' +
    'font-size:var(--fs-1);font-variant-numeric:tabular-nums}' +
    '.rg-hh{width:22px;text-align:center;color:var(--grey);font-weight:600;font-size:var(--fs-1)}' +
    '.rg-hax{font-size:var(--fs-1);color:var(--grey);text-align:end;padding-top:2px}' +
    '.rg-editrow{padding:8px 12px;border-bottom:1px solid var(--line);background:var(--paper)}' +
    '</style>'
  );
}

function rgLive() {
  var list = rgScoped();
  var open = list.filter(function (e) {
    return e.open;
  });
  var shut = list.filter(function (e) {
    return !e.open;
  });
  /* ⭐ Worst first. Sorted by date, a register buries the thing that should be read first under whatever was
     typed most recently. Unrated entries sort last rather than as zero — an unassessed risk is not a low one. */
  open.sort(function (first, second) {
    return (second.score || 0) - (first.score || 0);
  });

  return (
    rgCss() +
    rgRegisterRail() +
    (RG.report.full ? rgAddBar() : '') +
    (list.length
      ? rgHeat(open) +
        (open.length ? rgBand(tx('Open'), open.length) + rgTable(open) : '') +
        /* ⚠️ Closed entries stay, greyed — a register that hides what it settled cannot show it settled
             anything, and "what did we decide about that" is most of why anyone opens an old one. */
        (shut.length ? rgBand(tx('Closed'), shut.length) + rgTable(shut) : '')
      : /* ⚠️ Only when there IS somewhere to record: with no register the form is already the empty state,
           and saying 'nothing recorded' under it answers a question nobody asked twice. */
        (RG.subjects || []).length
        ? '<div class="msgempty">' + tx('Nothing recorded yet — which is usually the right answer.') + '</div>'
        : '')
  );
}

/* ── writing to it ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⭐⭐ ONE RECORD FORM, AND IT IS THE EMPTY STATE — Athi, 2026-08-31: *"a simple screen with the record format
 * has to be appearing at empty state"* and *"a plus icon can bring a new tab to add any risk, so we can embed
 * the + icon anywhere we want."*
 *
 * ⚠️ NOT A BLANK TABLE WITH HEADERS. That is the one empty state Carbon, Cloudscape and NN/G all warn against:
 * a screen reader reads the whole header row before reaching "there is nothing here". What they prescribe is to
 * say what will fill the space and give the step that fills it — and for a register that step IS the record
 * form. So the form is the empty state, not a link to one.
 *
 * ⚠️ AND IT CREATES THE REGISTER IF THERE ISN'T ONE. A finding has to live in a register; asking for one first
 * and refusing the entry meanwhile is exactly how this was a dead end. Naming it is a field IN this form.
 *
 * ⭐ SELF-CONTAINED, so rgQuickAdd() can open it from anywhere — a + on a line card, a chit, a dashboard.
 */
function rgAddPanel(opt) {
  opt = opt || {};
  var subs = (RG.subjects || []).filter(function (item) {
    return !item.closed_at;
  });
  var into = opt.into || RG.sel || (subs.length === 1 ? subs[0].subject_id : '');
  var kinds = Object.keys(RAIDA_KINDS)
    .map(function (item) {
      return '<option value="' + item + '"' + (opt.kind === item ? ' selected' : '') + '>' + rgIcon(item) + ' ' + esc(RAIDA_KINDS[item].label) + '</option>';
    })
    .join('');
  var newFields =
    '<select data-cbsid="SCR007-S01" id="rgNewType" class="inp" data-testid="register-new-type" style="flex:0 0 40%">' +
    (RG.attach || [])
      .map(function (item) {
        return '<option value="' + item.type_key + '"' + (item.type_key === 'chit' ? ' selected' : '') + '>' + esc(item.label) + '</option>';
      })
      .join('') +
    '</select>' +
    '<input data-cbsid="SCR007-I01" id="rgNewName" class="inp" data-testid="register-new-name" style="flex:1"' +
    ' placeholder="' +
    esc(tx('Name the register')) +
    '">';

  var where;
  /* ⭐ A chit decides its own register — the person only decides line vs order. */
  if (RG.ctx && RG.ctx.chit_id) {
    where = rgScopeFields();
  } else if (!subs.length) {
    where =
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:4px">' +
      tx('Findings live in a register — one per order, campaign, audit or release.') +
      '</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:6px">' +
      newFields +
      '</div>';
  } else {
    where =
      '<select data-cbsid="SCR007-S02" id="rgInto" class="inp" data-testid="raida-into" onchange="rgIntoChanged()"' +
      ' style="width:100%;margin-bottom:6px">' +
      subs
        .map(function (item) {
          return (
            '<option value="' +
            item.subject_id +
            '"' +
            (item.subject_id === into ? ' selected' : '') +
            '>' +
            esc(tx('into')) +
            ' ' +
            esc(item.name) +
            '</option>'
          );
        })
        .join('') +
      '<option value="__new">' +
      esc(tx('a new register…')) +
      '</option>' +
      '</select>' +
      '<div id="rgNewWrap" style="display:none;gap:6px;margin-bottom:6px">' +
      newFields +
      '</div>';
  }

  /* ⚠️ CAPPED. The panel is 1240px so a register can be read across; a form stretched to that width puts the
     Owner box a hand-span from its label and reads as a broken layout. */
  return (
    '<div class="raidadd" data-testid="raida-form" style="padding:8px 0;max-width:560px">' +
    where +
    '<select data-cbsid="SCR007-S03" id="rgKind" class="inp" data-testid="raida-kind" onchange="rgKindChanged()" style="width:100%;margin-bottom:6px">' +
    kinds +
    '</select>' +
    '<input data-cbsid="SCR007-I02" id="rgBody" class="inp" data-testid="raida-body" style="width:100%;margin-bottom:6px"' +
    ' placeholder="' +
    esc(tx('What is it? Say it in one line.')) +
    '">' +
    '<div style="display:flex;gap:6px;margin-bottom:6px">' +
    '<input data-cbsid="SCR007-I03" id="rgOwner" class="inp" style="flex:1" placeholder="' +
    esc(tx('Owner')) +
    '">' +
    '<input data-cbsid="SCR007-I04" id="rgDue" class="inp" type="date" style="flex:1">' +
    '</div>' +
    '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">' +
    '<span style="font-size:var(--fs-1);color:var(--grey)">' +
    tx('Likelihood') +
    '</span>' +
    '<input data-cbsid="SCR007-I05" id="rgL" class="inp" type="number" min="1" max="5" style="width:64px">' +
    '<span style="font-size:var(--fs-1);color:var(--grey)">' +
    tx('Severity') +
    '</span>' +
    '<input data-cbsid="SCR007-I06" id="rgS" class="inp" type="number" min="1" max="5" style="width:64px">' +
    '</div>' +
    rgRespFields() +
    rgEdgeFields() +
    '<div style="display:flex;gap:6px">' +
    '<button data-cbsid="SCR007-B05" class="btn" data-testid="raida-save" style="flex:1" onclick="rgSave()">' +
    tx('Record it') +
    '</button>' +
    (opt.bare ? '' : '<button data-cbsid="CMP003" class="btn ghost" style="flex:1" onclick="rgAdd(false)">' + tx('Cancel') + '</button>') +
    '</div></div>'
  );
}

/* The register select can ask for a new one; that reveals the two fields rather than sending you elsewhere. */
function rgIntoChanged() {
  var node = document.getElementById('rgNewWrap');
  if (node) node.style.display = rgVal('rgInto') === '__new' ? 'flex' : 'none';
}

function rgAddBar() {
  /* ⭐ Nothing recorded and nowhere to record it: the form IS the screen. No link, no second click. */
  if (!rgEntries().length && !(RG.subjects || []).length) return rgAddPanel({ bare: true });
  if (!RG.adding) {
    return (
      '<div style="padding:8px 0"><button data-cbsid="SCR007-B06" class="msglink" data-testid="raida-add-open"' +
      ' onclick="rgAdd(true)">＋ ' +
      tx('Record something') +
      '</button></div>'
    );
  }
  return '<div style="border-bottom:1px solid var(--line)">' + rgAddPanel({}) + '</div>';
}

var RG_RESPONSES = {
  tolerate: { label: 'Tolerate', hint: 'accept it and carry on — recorded, not ignored' },
  treat: { label: 'Treat', hint: 'act to reduce likelihood or severity' },
  transfer: { label: 'Transfer', hint: 'move the exposure — insure it, contract it out' },
  terminate: { label: 'Terminate', hint: 'stop doing the thing that carries it' }
};

function rgRespLabel(k) {
  return (RG_RESPONSES[k] && RG_RESPONSES[k].label) || k;
}

function rgRespFields() {
  if (!RG.report || !RG.report.resp) return '';
  return (
    '<div id="rgRespWrap" style="display:none;margin-bottom:6px">' +
    '<select data-cbsid="SCR007-S04" id="rgResp" class="inp" data-testid="raida-response" style="width:100%">' +
    '<option value="">' +
    esc(tx('— response not decided —')) +
    '</option>' +
    Object.keys(RG_RESPONSES)
      .map(function (item) {
        return '<option value="' + item + '">' + esc(RG_RESPONSES[item].label) + ' — ' + esc(RG_RESPONSES[item].hint) + '</option>';
      })
      .join('') +
    '</select></div>'
  );
}

/**
 * ⭐⭐ THE FIELDS THAT MAKE A DEPENDENCY AN EDGE — without them the Impact view can never populate. The register
 * could record "we are waiting on the crane" all day, but nothing set `to_id`, so every dependency stayed a
 * sentence and the graph had no data by construction.
 *
 * ⚠️ SHOWN ONLY FOR A DEPENDENCY. The other five kinds do not point.
 */
function rgEdgeFields() {
  var subs = (RG.subjects || []).filter(function (item) {
    return item.subject_id !== RG.sel && !item.closed_at;
  });
  var rels = [
    ['finish_to_start', tx('starts after')],
    ['start_to_start', tx('starts with')],
    ['finish_to_finish', tx('finishes with')],
    ['start_to_finish', tx('finishes after')]
  ];
  return (
    '<div id="rgEdge" style="display:none;border-top:1px dashed var(--line);margin-top:6px;padding-top:6px">' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:4px">' +
    tx('What does it wait on? Leave blank and it stays a note, not a link.') +
    '</div>' +
    '<select data-cbsid="SCR007-S05" id="rgTo" class="inp" data-testid="raida-to" style="width:100%;margin-bottom:6px">' +
    '<option value="">' +
    esc(tx('— nothing named —')) +
    '</option>' +
    subs
      .map(function (item) {
        return '<option value="' + item.subject_id + '|' + item.type_key + '|' + esc(item.name) + '">' + esc(item.name) + '</option>';
      })
      .join('') +
    '</select>' +
    '<div style="display:flex;gap:6px">' +
    '<select data-cbsid="SCR007-S06" id="rgRel" class="inp" style="flex:1">' +
    rels
      .map(function (item) {
        return '<option value="' + item[0] + '">' + item[1] + '</option>';
      })
      .join('') +
    '</select>' +
    '<input data-cbsid="SCR007-I07" id="rgNeed" class="inp" type="date" style="flex:1" title="' +
    esc(tx('Needed by')) +
    '">' +
    '</div></div>'
  );
}

/* One listener, set when the bar is painted: the edge fields belong to a dependency, the response to a risk. */
function rgKindChanged() {
  var k = rgVal('rgKind');
  var edge = document.getElementById('rgEdge');
  if (edge) edge.style.display = k === 'dependency' ? '' : 'none';
  var resp = document.getElementById('rgRespWrap');
  if (resp) resp.style.display = k === 'risk' ? '' : 'none';
}

function rgAdd(on) {
  RG.adding = !!on;
  rgPaint();
}

function rgVal(id) {
  var el = document.getElementById(id);
  return el ? String(el.value || '').trim() : '';
}

/**
 * ⭐⭐ ONE SAVE, WHICH OPENS THE REGISTER IF THE FORM ASKED FOR ONE. Two round trips only when a register is
 * genuinely being created; otherwise one. The register-then-entry split used to be two screens and a refusal
 * in between.
 */
async function rgSave() {
  var body = rgVal('rgBody');
  if (!body) {
    toast(tx('It needs to say something.'));
    return;
  }

  /* ⭐⭐ A CHIT CONTEXT GOES THROUGH THE CHIT ROUTE, which proves ownership and opens the order's register on
     first use. Posting to a subject here would file a line's finding against whatever register happened to be
     selected on a screen the person is not looking at. */
  if (RG.ctx && RG.ctx.chit_id) {
    return rgSaveOnChit();
  }

  var into = rgVal('rgInto');
  var wantNew = !into || into === '__new';
  if (wantNew) {
    var name = rgVal('rgNewName');
    if (!name) {
      toast(tx('Name the register it goes into.'));
      return;
    }
    try {
      var made = await api('regSubjectNew', { body: { type_key: rgVal('rgNewType') || 'other', name: name } });
      into = made && made.subject_id;
      RG.sel = into;
    } catch (e) {
      toast(rgFail('open the register', e));
      return;
    }
  }
  if (!into) {
    toast(tx('Pick a register.'));
    return;
  }

  var p = { kind: rgVal('rgKind') || 'risk', body: body };
  var o = rgVal('rgOwner');
  if (o) p.owner_name = o;
  var d = rgVal('rgDue');
  if (d) p.due_date = d;
  var l = rgVal('rgL');
  if (l) p.likelihood = +l;
  var s = rgVal('rgS');
  if (s) p.severity = +s;
  /* ⭐ Only for a risk, and only when the column exists — see rgRespFields. */
  if (p.kind === 'risk') {
    var rsp = rgVal('rgResp');
    if (rsp) p.response = rsp;
  }
  /* ⭐ An edge only exists when a target is NAMED. Blank leaves it a note, which Impact lists apart rather
     than pretending it can be walked. */
  if (p.kind === 'dependency') {
    var to = rgVal('rgTo');
    if (to) {
      var bits = to.split('|');
      p.to_id = bits[0];
      p.to_type = bits[1];
      p.to_label = bits.slice(2).join('|');
      p.rel_type = rgVal('rgRel') || 'finish_to_start';
      var nb = rgVal('rgNeed');
      if (nb) p.needed_by = nb;
    }
  }

  try {
    await api('regEntryAdd', { params: { sid: into }, body: p });
    RG.adding = false;
    toast(tx('Recorded.'));
    await openRegister(true);
  } catch (e) {
    toast(rgFail('record it', e));
  }
}

/**
 * ⭐ Recording against an order or one of its lines. Same fields as anywhere else — the register a finding
 * lands in is decided by the chit, not by the form.
 *
 * ⚠️ `line_id` NULL means the whole order, which is the scope toggle's only job. b182's comment is the reason
 * the distinction exists: the credit is an order fact and the crane is a line fact, and only the person typing
 * knows which they mean.
 */
async function rgSaveOnChit() {
  var body = rgVal('rgBody');
  if (!body) {
    toast(tx('It needs to say something.'));
    return;
  }
  var c = RG.ctx;
  var p = { kind: rgVal('rgKind') || 'risk', body: body, line_id: RG.ctxWhole ? null : c.line_id || null };
  var o = rgVal('rgOwner');
  if (o) p.owner_name = o;
  var d = rgVal('rgDue');
  if (d) p.due_date = d;
  var l = rgVal('rgL');
  if (l) p.likelihood = +l;
  var s = rgVal('rgS');
  if (s) p.severity = +s;
  if (p.kind === 'risk') {
    var rsp = rgVal('rgResp');
    if (rsp) p.response = rsp;
  }
  if (p.kind === 'dependency') {
    var to = rgVal('rgTo');
    if (to) {
      var bits = to.split('|');
      p.to_id = bits[0];
      p.to_type = bits[1];
      p.to_label = bits.slice(2).join('|');
      p.rel_type = rgVal('rgRel') || 'finish_to_start';
      var nb = rgVal('rgNeed');
      if (nb) p.needed_by = nb;
    }
  }
  try {
    await api('regChitAdd', { params: { id: c.chit_id }, body: p });
    toast(tx('Recorded.'));
    if (typeof closeModal === 'function') closeModal();
    /* ⚠️ A NAME, not a function reference. The caller is a different lazily-loaded capability and this is a
       classic-script app — a name is the only handle that survives that boundary. */
    if (c.onSaved && typeof window[c.onSaved] === 'function') {
      try {
        window[c.onSaved]();
      } catch (_) { /* best effort: failing here changes nothing the user sees */ }
    }
    RG.ctx = null;
    /* If the register screen is behind this, it is now stale. */
    if (RG.report) {
      RG.report = null;
    }
  } catch (e) {
    toast(rgFail('record it', e));
  }
}

/**
 * ⭐⭐ WHERE THE FORM WAS OPENED FROM. Athi: *"we should be able to call this risk capability from anywhere at
 * task level or line item level."*
 *
 * With a chit context the register is not a CHOICE — the finding belongs to that order, and its register is
 * opened for it automatically on first use. So the picker is replaced by the one thing the person actually
 * decides: whether it is against this LINE or the whole ORDER. Offering a register list there would invite
 * filing a line's risk against a campaign.
 */
function rgScopeFields() {
  var c = RG.ctx;
  if (!c || !c.chit_id) return '';
  var lineLabel = c.line_label || tx('this line');
  return (
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:4px">' +
    tx('Against') +
    ' <b style="color:var(--on-card)">' +
    esc(c.chit_label || tx('this order')) +
    '</b></div>' +
    (c.line_id
      ? '<div class="raidtoggle" style="padding:0 0 6px">' +
        '<button data-cbsid="SCR007-B07" type="button" data-testid="raida-scope-line" class="' +
        (RG.ctxWhole ? '' : 'on') +
        '"' +
        ' onclick="rgScope(false)">' +
        esc(lineLabel) +
        '</button>' +
        '<button data-cbsid="SCR007-B08" type="button" data-testid="raida-scope-order" class="' +
        (RG.ctxWhole ? 'on' : '') +
        '"' +
        ' onclick="rgScope(true)">' +
        tx('the whole order') +
        '</button>' +
        '</div>'
      : '')
  );
}

function rgScope(whole) {
  RG.ctxWhole = !!whole;
  var host = document.querySelector('[data-testid="raida-quickadd"]');
  if (host) host.innerHTML = rgAddPanel({ kind: rgVal('rgKind'), bare: true });
}

/**
 * ⭐⭐ THE + FROM ANYWHERE. A line card, a chit header, a dashboard tile can all call this.
 *
 * ⚠️ IT LOADS ITS OWN DATA. A caller elsewhere has never opened the register, so RG.subjects and RG.attach are
 * null and the form would otherwise offer an empty picker.
 *
 * opts: { chit_id, line_id, chit_label, line_label, kind, into, onSaved }
 * `onSaved` is the NAME of a global to call after a successful save — this is a classic-script app and the
 * caller is a different lazily-loaded capability, so a name is the only handle that survives the boundary.
 */
async function rgQuickAdd(opt) {
  opt = opt || {};
  RG.ctx = opt.chit_id
    ? {
        chit_id: opt.chit_id,
        line_id: opt.line_id || null,
        chit_label: opt.chit_label || null,
        line_label: opt.line_label || null,
        onSaved: opt.onSaved || null
      }
    : null;
  RG.ctxWhole = false;
  var title = tx('＋ Record a finding');
  var head = '<div class="mhd"><div class="t" style="padding-inline-end:72px">' + title + '</div></div>';
  if (typeof modal === 'function') {
    modal(
      head +
        '<div class="mbody" style="padding:14px 16px;color:var(--grey);font-size:var(--fs-2)">' +
        '<span class="spin"></span> ' +
        tx('opening…') +
        '</div>',
      false, { pop: 'POP068' }
    );
  }
  if (!RG.report) {
    await rgLoad(false);
  }
  modal(
    head +
      '<div class="mbody" data-testid="raida-quickadd" style="padding:8px 16px 16px">' +
      rgAddPanel({ into: opt.into, kind: opt.kind, bare: true }) +
      '</div>',
    false, { pop: 'POP068' }
  );
  rgSyncFields();
}

/**
 * ⚠️⚠️ THE SEPARATE new-register FORM IS GONE. There were two forms that both created a register, carrying the
 * SAME testids — which is how a spec ended up matching two elements and how a reader ends up with two answers
 * to one question. Creating a register is now a field inside the record form: you name it while recording the
 * first thing that goes in it.
 *
 * ⭐ A register with nothing in it holds no information, and a chit gets one automatically on first use, so
 * nothing is lost by removing the standalone path.
 */

/**
 * ⭐⭐ UPDATE FROM THE REGISTER — Athi: *"we should be able to update the same from register panel as well."*
 *
 * ⚠️ A REVISION, NOT AN EDIT. The server appends a row carrying only what changed and folds the latest over the
 * original on read. Reassignment is normal, and *who held it when this went wrong* is the question afterwards —
 * an UPDATE in place destroys exactly that.
 *
 * ⚠️ BLANK MEANS UNCHANGED, not cleared. Every field starts empty rather than pre-filled, because a pre-filled
 * form that submits everything would record a "revision" of nine fields when one was touched, and the changed
 * list is what a reader scans.
 */
function rgEditAsk(id) {
  RG.editing = RG.editing === id ? null : id;
  rgPaint();
  if (RG.editing) rgEditPaint(id);
}

function rgEditPaint(id) {
  var el = document.querySelector('[data-rid="' + id + '"]');
  if (!el) return;
  var e =
    rgEntries().filter(function (x) {
      return x.raida_id === id;
    })[0] || {};
  var resp =
    RG.report && RG.report.resp
      ? '<select data-cbsid="SCR007-S07" id="rgEResp" class="inp" data-testid="raida-edit-response" style="min-width:150px">' +
        '<option value="">' +
        esc(tx('response — unchanged')) +
        '</option>' +
        Object.keys(RG_RESPONSES)
          .map(function (item) {
            return '<option value="' + item + '">' + esc(RG_RESPONSES[item].label) + '</option>';
          })
          .join('') +
        '</select>'
      : '';
  var row = document.createElement('div');
  row.className = 'rg-editrow';
  row.innerHTML =
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:4px 0">' +
    '<span style="font-size:var(--fs-1);color:var(--grey)">' +
    tx('Change only what moved:') +
    '</span>' +
    '<input data-cbsid="SCR007-I08" id="rgEOwner" class="inp" data-testid="raida-edit-owner" style="min-width:130px"' +
    ' placeholder="' +
    esc(tx('owner')) +
    (e.owner ? ' · ' + esc(e.owner) : '') +
    '">' +
    '<input data-cbsid="SCR007-I09" id="rgEL" class="inp" type="number" min="1" max="5" style="width:72px"' +
    ' placeholder="' +
    esc(tx('L')) +
    (e.likelihood ? ' ' + e.likelihood : '') +
    '">' +
    '<input data-cbsid="SCR007-I10" id="rgES" class="inp" type="number" min="1" max="5" style="width:72px"' +
    ' placeholder="' +
    esc(tx('S')) +
    (e.severity ? ' ' + e.severity : '') +
    '">' +
    '<input data-cbsid="SCR007-I11" id="rgERL" class="inp" type="number" min="1" max="5" style="width:96px"' +
    ' placeholder="' +
    esc(tx('resid L')) +
    '">' +
    '<input data-cbsid="SCR007-I12" id="rgERS" class="inp" type="number" min="1" max="5" style="width:96px"' +
    ' placeholder="' +
    esc(tx('resid S')) +
    '">' +
    resp +
    '<input data-cbsid="SCR007-I13" id="rgETreat" class="inp" data-testid="raida-edit-treatment" style="flex:1;min-width:180px"' +
    ' placeholder="' +
    esc(tx('treatment')) +
    '">' +
    '<input data-cbsid="SCR007-I14" id="rgEDue" class="inp" type="date" style="min-width:140px" title="' +
    esc(tx('due')) +
    '">' +
    '<button data-cbsid="SCR007-B09" class="btn" data-testid="raida-edit-save" onclick="rgEditSave(&quot;' +
    id +
    '&quot;)">' +
    tx('Save change') +
    '</button>' +
    '<button data-cbsid="CMP003" class="btn ghost" onclick="rgEditAsk(&quot;' +
    id +
    '&quot;)">' +
    tx('Cancel') +
    '</button>' +
    '</div>';
  el.parentNode.insertBefore(row, el.nextSibling);
}

async function rgEditSave(id) {
  var f = {};
  var owner = rgVal('rgEOwner');
  if (owner) f.owner_name = owner;
  var l = rgVal('rgEL');
  if (l) f.likelihood = +l;
  var s = rgVal('rgES');
  if (s) f.severity = +s;
  var rl = rgVal('rgERL');
  if (rl) f.residual_likelihood = +rl;
  var rs = rgVal('rgERS');
  if (rs) f.residual_severity = +rs;
  var t = rgVal('rgETreat');
  if (t) f.treatment = t;
  var d = rgVal('rgEDue');
  if (d) f.due_date = d;
  var r = rgVal('rgEResp');
  if (r) f.response = r;
  if (!Object.keys(f).length) {
    toast(tx('Nothing changed.'));
    return;
  }
  try {
    await api('regEntryRevise', { params: { rid: id }, body: f });
    RG.editing = null;
    toast(tx('Updated.'));
    await openRegister(true);
  } catch (e) {
    toast(rgFail('update it', e));
  }
}

function rgCloseAsk(id) {
  RG.closing = RG.closing === id ? null : id;
  rgPaint();
  if (RG.closing) rgClosePaint(id);
}

/**
 * ⚠️⚠️ ADDRESSED BY ID, NOT BY INDEX. An earlier version counted its way down the open entries and appended into
 * `rows[idx]` — which only ever worked because the open list happens to render before the closed one. A row
 * knows its own id; ask for it.
 *
 * ⚠️ AND IT IS A SIBLING, not a child. The row is a grid track: anything put inside it becomes a fourteenth
 * column and lands under one heading rather than across the row.
 */
function rgClosePaint(id) {
  var el = document.querySelector('[data-rid="' + id + '"]');
  if (!el) return;
  var moves = (RG.subjects || []).filter(function (item) {
    return item.subject_id !== RG.sel && !item.closed_at;
  });
  var opts = Object.keys(RAIDA_ENDINGS)
    .map(function (item) {
      return '<option value="' + item + '">' + esc(RAIDA_ENDINGS[item].label) + ' — ' + esc(RAIDA_ENDINGS[item].hint) + '</option>';
    })
    .join('');
  var row = document.createElement('div');
  row.className = 'rg-editrow';
  row.innerHTML =
    '' +
    '<div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;padding:4px 0">' +
    '<select data-cbsid="SCR007-S08" id="rgDisp" class="inp" data-testid="raida-disposition" onchange="rgDispChanged()"' +
    ' style="min-width:230px">' +
    opts +
    '</select>' +
    /**
     * ⭐⭐ "CARRIED FORWARD" MUST NAME WHERE IT WENT, and the server refuses without it — *"we will deal with it
     * later" without a later is how a finding disappears while looking dispositioned*.
     */
    '<select data-cbsid="SCR007-S09" id="rgCarry" class="inp" data-testid="raida-carry" style="min-width:190px;display:none">' +
    '<option value="">' +
    esc(tx('— which register? —')) +
    '</option>' +
    moves
      .map(function (item) {
        return '<option value="' + item.subject_id + '">' + esc(item.name) + '</option>';
      })
      .join('') +
    '</select>' +
    '<input data-cbsid="SCR007-I15" id="rgNote" class="inp" data-testid="raida-close-note" style="flex:1;min-width:200px"' +
    ' placeholder="' +
    esc(tx('What happened? One line.')) +
    '">' +
    '<button data-cbsid="SCR007-B10" class="btn" data-testid="raida-close-save"' +
    ' onclick="rgCloseSave(&quot;' +
    id +
    '&quot;)">' +
    tx('End it') +
    '</button>' +
    '<button data-cbsid="CMP003" class="btn ghost" onclick="rgCloseAsk(&quot;' +
    id +
    '&quot;)">' +
    tx('Cancel') +
    '</button>' +
    '</div>';
  el.parentNode.insertBefore(row, el.nextSibling);
}

/* Only "carried forward" needs somewhere to go. */
function rgDispChanged() {
  var el = document.getElementById('rgCarry');
  if (el) el.style.display = rgVal('rgDisp') === 'carried_forward' ? '' : 'none';
}

async function rgCloseSave(id) {
  var disp = rgVal('rgDisp');
  if (!disp) {
    toast(tx('Say how it ended.'));
    return;
  }
  try {
    var payload = { disposition: disp, body: rgVal('rgNote') };
    if (disp === 'carried_forward') {
      var to = rgVal('rgCarry');
      if (!to) {
        toast(tx('Name the register it moves to.'));
        return;
      }
      payload.carried_to_subject_id = to;
    }
    await api('regEntryClose', { params: { rid: id }, body: payload });
    RG.closing = null;
    toast(tx('Ended.'));
    await openRegister(true);
  } catch (e) {
    toast(rgFail('end it', e));
  }
}

/* ── CLOSURE — the outcome ──────────────────────────────────────────────────────────────────────────────── */

/**
 * ⭐⭐ THE VIEW THAT ANSWERS *"at the end of the test, it has to clearly come out as actions"*.
 *
 * A register is worth keeping only if closing it PRODUCES something. Three groups, and they are separated on
 * purpose because they land on different people:
 *
 *   WORK CAME OUT        action · carried_forward — somebody now owns something
 *   CARRIED KNOWINGLY    accepted · constraint · waived — ⚠️ nothing will EVER nag anyone about these again.
 *                        They are invisible by construction, so this list is the only place they exist.
 *   SETTLED              resolved — fixed, and the fix was verified
 *
 * ⚠️ AND WHAT NOBODY ANSWERED IS ITS OWN GROUP. An order that closes takes its entries with it; those are not
 * resolved, they are abandoned, and summing them into "closed" flatters the register at the one moment it must
 * not.
 */
var RG_OUTCOME = {
  work: { keys: ['action', 'carried_forward'], label: 'Work came out of it', tone: 'var(--blue-2)' },
  carried: { keys: ['accepted', 'constraint', 'waived'], label: 'Carried knowingly', tone: 'var(--warn-2)' },
  settled: { keys: ['resolved'], label: 'Settled', tone: 'var(--grey)' }
};

function rgClosure() {
  var list = rgScoped();
  if (!RG.report.full) {
    return '<div class="rg-body"><div class="msgempty">' + tx('Closure needs the full register (b185).') + '</div></div>';
  }
  if (!list.length) {
    return '<div class="rg-body">' + rgRegisterRail() + '<div class="msgempty">' + tx('Nothing recorded, so there is nothing to close out.') + '</div></div>';
  }

  var open = list.filter(function (e) {
    return e.open;
  });
  var abandoned = list.filter(function (e) {
    return e.ending === 'closed_by_order';
  });
  var ended = list.filter(function (e) {
    return e.ending === 'closed';
  });
  var name = RG.sel ? rgSubjectName(RG.sel) : tx('every register');

  var group = function (g) {
    var rows = ended.filter(function (e) {
      return g.keys.indexOf(e.disposition) >= 0;
    });
    if (!rows.length) return '';
    return (
      rgBand(tx(g.label), rows.length) +
      rows
        .map(function (e) {
          return (
            '<div data-cbsid="SCR007-C02" class="raidrow" data-testid="closure-item"' +
            (e.chit_id ? ' style="cursor:pointer" onclick="closeModal();openChit(&quot;' + e.chit_id + '&quot;)"' : '') +
            '><div class="rl"><span class="mtype ' +
            e.kind +
            '">' +
            rgIcon(e.kind) +
            ' ' +
            esc(rgLabel(e.kind)) +
            '</span>' +
            ' <span style="color:' +
            g.tone +
            ';font-weight:700">' +
            esc(rgEnding(e.disposition)) +
            '</span></div>' +
            '<div style="font-size:var(--fs-2);color:var(--on-card);line-height:1.5">' +
            esc(e.body) +
            '</div>' +
            '<div class="rsamp">' +
            (e.closed_note ? esc(e.closed_note) : tx('no note')) +
            (e.closed_by ? ' · ' + esc(e.closed_by) : '') +
            (e.owner ? ' · ' + tx('owner') + ' ' + esc(e.owner) : '') +
            (e.evidence ? ' · ' + tx('evidence') + ' ' + esc(e.evidence.ref) : '') +
            '</div></div>'
          );
        })
        .join('')
    );
  };

  /* ⭐ THE GATE, stated before the button rather than discovered by pressing it. */
  var gate = open.length
    ? '<div style="margin-top:12px;padding:10px;border:1px solid var(--warn-2);border-radius:8px">' +
      '<b style="color:var(--warn-2)">' +
      open.length +
      ' ' +
      tx('still open') +
      '</b><br>' +
      '<span style="font-size:var(--fs-1);color:var(--grey)">' +
      tx('A register cannot be closed while anything is undispositioned. Each one needs an ending.') +
      '</span>' +
      '<div style="margin-top:6px">' +
      open
        .map(function (e) {
          return '<div style="font-size:var(--fs-2)">' + rgIcon(e.kind) + ' ' + esc(e.body) + '</div>';
        })
        .join('') +
      '</div></div>'
    : RG.sel
      ? '<div style="margin-top:12px"><button data-cbsid="SCR007-B11" class="btn" data-testid="register-close"' +
        ' onclick="rgSubjectClose()">' +
        tx('Close this register') +
        '</button></div>'
      : '';

  return (
    '<div class="rg-body">' +
    rgRegisterRail() +
    '<div style="padding:8px 0;font-size:var(--fs-2);color:var(--grey)">' +
    tx('Closure statement for') +
    ' <b style="color:var(--on-card)">' +
    esc(name) +
    '</b> — ' +
    list.length +
    ' ' +
    tx('recorded') +
    ', ' +
    ended.length +
    ' ' +
    tx('ended') +
    ', ' +
    open.length +
    ' ' +
    tx('open') +
    '.</div>' +
    group(RG_OUTCOME.work) +
    group(RG_OUTCOME.carried) +
    group(RG_OUTCOME.settled) +
    (abandoned.length
      ? rgBand('<span style="color:var(--disp)">' + tx('Nobody answered these') + '</span>', abandoned.length) +
        '<div style="font-size:var(--fs-1);color:var(--grey);padding:2px 0">' +
        tx('The order closed around them. Unresolved, not resolved.') +
        '</div>' +
        abandoned
          .map(function (e) {
            return (
              '<div class="raidrow"><div class="rl"><span class="mtype ' +
              e.kind +
              '">' +
              rgIcon(e.kind) +
              ' ' +
              esc(rgLabel(e.kind)) +
              '</span></div>' +
              '<div style="font-size:var(--fs-2);color:var(--on-card)">' +
              esc(e.body) +
              '</div></div>'
            );
          })
          .join('')
      : '') +
    gate +
    '</div>'
  );
}

async function rgSubjectClose() {
  if (!RG.sel) return;
  try {
    await api('regSubjectClose', { params: { sid: RG.sel }, body: {} });
    toast(tx('Register closed.'));
    await openRegister(true);
  } catch (e) {
    /* ⚠️ The 409 NAMES what is outstanding. Showing "could not close" would throw that away. */
    var out = (e && e.outstanding) || null;
    toast(out && out.length ? txf('{n} still need an ending.', { n: out.length }) : rgFail('close the register', e));
    await openRegister(true);
  }
}

/* ── IMPACT — the graph ─────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⭐⭐ WHAT THIS BREAKS, OR WHAT BROKE IT. Every dependency that POINTS is an edge; the walk is the impact.
 *
 * ⚠️ BACKWARDS IS THE DEFAULT, deliberately. Forwards ("what waits on this") is the planning question and gets
 * asked occasionally. Backwards ("what is this waiting on") is the question asked after something has already
 * gone wrong, which is when anyone actually opens this.
 *
 * ⚠️ A DEPENDENCY THAT DOES NOT POINT IS A SENTENCE, NOT AN EDGE. "We need the crane" with no target cannot be
 * walked and must not be drawn as though it could — it is listed separately rather than silently dropped.
 */
function rgWalkPick() {
  var es = rgScoped().filter(function (e) {
    return e.edge;
  });
  if (es.length && !RG.walkFrom) {
    RG.walkFrom = es[0].line_id || es[0].subject_id;
    rgWalkLoad();
  }
}

async function rgWalkLoad() {
  if (!RG.walkFrom) return;
  try {
    RG.walk = await api('regWalk', { params: { from: RG.walkFrom }, query: { backwards: RG.walkBack ? '1' : '0' } });
  } catch (e) {
    RG.walk = { hops: [], err: rgWhy(e, 'failed') };
  }
  rgPaint();
}

function rgWalkDir() {
  RG.walkBack = !RG.walkBack;
  rgWalkLoad();
}
function rgWalkFrom(id) {
  RG.walkFrom = id;
  rgWalkLoad();
}

/**
 * ⭐⭐ TOP-TO-BOTTOM, NOT LEFT-TO-RIGHT — because of the pane it lives in. A wide flow reads left-to-right, and
 * that is what this drew first: at 240px per column inside a ~300px panel it put the ONE box that carries the
 * answer off the right edge, every time. A layered stack in a narrow column reads downward.
 *
 * ⚠️ DEPTH IS THE INDENT, so a chain still reads as a chain rather than a flat list.
 */
/* The origin box. Names the register when one is selected — with the room the wide frame gives, "this" is a
   wasted label on the only box the reader already understands. */
function rgWalkLabel() {
  var n = RG.sel ? rgSubjectName(RG.sel) : null;
  if (!n) return tx('this');
  return n.length > 26 ? n.slice(0, 26) + '…' : n;
}
function rgGraph(hops) {
  var W = 300,
    PAD = 10,
    BOXH = 44,
    GAP = 30,
    INDENT = 14;
  var H = PAD * 2 + BOXH + hops.length * (BOXH + GAP);
  var parts = [];

  parts.push(
    '<rect x="' + PAD + '" y="' + PAD + '" width="' + (W - PAD * 2) + '" height="' + BOXH + '" rx="8" fill="none" stroke="currentColor" stroke-width="2"/>'
  );
  parts.push('<text x="' + (PAD + 10) + '" y="' + (PAD + 27) + '" font-size="12" font-weight="700"' + ' fill="currentColor">' + esc(rgWalkLabel()) + '</text>');

  var y = PAD + BOXH;
  hops.forEach(function (item) {
    var x = PAD + Math.min(item.depth, 3) * INDENT;
    var sev = item.severity >= 4 ? 'var(--disp)' : 'currentColor';
    parts.push(
      '<line x1="' +
        (x + 14) +
        '" y1="' +
        y +
        '" x2="' +
        (x + 14) +
        '" y2="' +
        (y + GAP) +
        '" stroke="currentColor" stroke-width="1.5" opacity=".55" marker-end="url(#rgarrow)"/>'
    );
    parts.push(
      '<text x="' +
        (x + 24) +
        '" y="' +
        (y + GAP - 10) +
        '" font-size="10" fill="currentColor"' +
        ' opacity=".7">' +
        esc(String(item.rel_type || '').replace(/_/g, ' ')) +
        '</text>'
    );
    y += GAP;
    parts.push(
      '<rect x="' + x + '" y="' + y + '" width="' + (W - x - PAD) + '" height="' + BOXH + '" rx="8" fill="none" stroke="' + sev + '" stroke-width="1.5"/>'
    );
    var text = String(item.to_label || item.body || '');
    parts.push(
      '<text x="' + (x + 10) + '" y="' + (y + 19) + '" font-size="11" fill="currentColor">' + esc(text.length > 30 ? text.slice(0, 30) + '…' : text) + '</text>'
    );
    var sub = (item.owner || '') + (item.needed_by ? ' · ' + String(item.needed_by).slice(0, 10) : '');
    if (sub) {
      parts.push('<text x="' + (x + 10) + '" y="' + (y + 34) + '" font-size="10" fill="currentColor"' + ' opacity=".65">' + esc(sub) + '</text>');
    }
    y += BOXH;
  });

  return (
    '<svg viewBox="0 0 ' +
    W +
    ' ' +
    H +
    '" role="img" style="width:' +
    W +
    'px;max-width:100%;height:auto;' +
    'color:var(--on-card)" aria-label="' +
    esc(tx('Impact walk')) +
    '">' +
    '<defs><marker id="rgarrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6"' +
    ' orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>' +
    parts.join('') +
    '</svg>'
  );
}

function rgDangling(list) {
  if (!list.length) return '';
  return (
    rgBand(tx('Dependencies that name no target'), list.length) +
    '<div style="font-size:var(--fs-1);color:var(--grey);padding:2px 0">' +
    tx('These cannot be walked — they are sentences, not edges.') +
    '</div>' +
    list
      .map(function (e) {
        return '<div class="raidrow"><div style="font-size:var(--fs-2)">🔗 ' + esc(e.body) + '</div></div>';
      })
      .join('')
  );
}

function rgImpact() {
  if (!RG.report.full) {
    return '<div class="rg-body"><div class="msgempty">' + tx('The impact walk needs the full register (b185).') + '</div></div>';
  }
  var list = rgScoped();
  var edges = list.filter(function (e) {
    return e.edge;
  });
  var dangling = list.filter(function (e) {
    return e.kind === 'dependency' && !e.edge;
  });

  if (!edges.length) {
    return (
      '<div class="rg-body">' +
      rgRegisterRail() +
      '<div class="msgempty">' +
      tx('Nothing points anywhere yet, so there is no graph to walk.') +
      '<br>' +
      '<span style="font-size:var(--fs-1)">' +
      tx('A dependency becomes an edge when it names what it waits on.') +
      '</span></div>' +
      rgDangling(dangling) +
      '</div>'
    );
  }

  var starts = [];
  edges.forEach(function (e) {
    var id = e.line_id || e.subject_id;
    if (
      id &&
      !starts.some(function (item) {
        return item.id === id;
      })
    ) {
      starts.push({ id: id, label: e.particulars || e.subject || tx('this register') });
    }
  });
  var hops = (RG.walk && RG.walk.hops) || [];

  return (
    '<div class="rg-body">' +
    rgRegisterRail() +
    '<div class="raidtoggle" style="padding:6px 0">' +
    '<button data-cbsid="SCR007-B12" class="' +
    (RG.walkBack ? 'on' : '') +
    '" data-testid="walk-back" onclick="rgWalkDir()">' +
    tx('What this waits on') +
    '</button>' +
    '<button data-cbsid="SCR007-B13" class="' +
    (RG.walkBack ? '' : 'on') +
    '" onclick="rgWalkDir()">' +
    tx('What waits on this') +
    '</button></div>' +
    (starts.length > 1
      ? '<div class="raidtoggle" style="padding:6px 0">' +
        starts
          .map(function (item) {
            return (
              '<button data-cbsid="SCR007-B14" class="' +
              (RG.walkFrom === item.id ? 'on' : '') +
              '"' +
              ' onclick="rgWalkFrom(&quot;' +
              item.id +
              '&quot;)">' +
              esc(item.label) +
              '</button>'
            );
          })
          .join('') +
        '</div>'
      : '') +
    (hops.length
      ? '<div style="overflow-x:auto" data-testid="walk-graph">' +
        rgGraph(hops) +
        '</div>' +
        '<div style="font-size:var(--fs-1);color:var(--grey);padding:6px 0">' +
        txn('{count} hop', '{count} hops', hops.length) +
        ' · ' +
        txf('{d} deep', { d: (RG.walk && RG.walk.depth_reached) || 0 }) +
        (RG.walk && RG.walk.truncated ? ' ' + tx('Stopped at the depth limit — there is more.') : '') +
        '</div>'
      : '<div class="msgempty">' + tx('Nothing on this path.') + '</div>') +
    rgDangling(dangling) +
    '</div>'
  );
}

/* ⚠️⚠️ NO openRaidReport() HERE, DELIBERATELY. Defining it in this file too would SHADOW the shim in app.html
 * — two declarations of one name across two files, which dead-surface.cjs flags and is right to: a reader
 * cannot tell which one runs, and the answer depends on load order. The shim is the single door. ensureCap is
 * memoised, so going through it every time costs nothing after the first open, and it re-reads on each open
 * on purpose: a stale governance number is worse than a spinner.
 */
