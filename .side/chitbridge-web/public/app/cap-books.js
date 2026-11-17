/* cap-books.js — THE LEDGER: parties, statements, payments, day book, trial balance, P&L, balance sheet, dues, month
 * lock, handover packs. Loaded on demand (ensureCap('books')). Contract: C:\dev\SPEC-books-v2.md §4–§5.
 *
 * ⚠️⚠️ STANDING RULE (Athi, 2026-09-28): this is NEVER called "accounting" or "books of account" on a screen. The door
 * says Ledger; the tabs say Day book, Ledgers, Trial balance, P&L, Balance sheet, Dues, Month lock, Packs.
 * ⭐ Every figure is the SERVER's (routes/books.js reads stored balances); this file never adds up entries itself —
 * a second opinion about what somebody owes is exactly what must not exist. Money arrives in integer MINOR units
 * and is shown through CBMoney.decimals + CBLocale.money, never rounded here.
 * ⭐ The two panels Athi named are the way in for parties (Customers / Suppliers): partyBooksHTML and
 * partyDueChipHTML are called from app.html's own row and detail painters, only once this file has loaded.
 */
/* OWNS the Ledger screens (parties, statements, day book, reports, month lock, packs) and the books money helpers bkMoney / bkCur / bkYearStart
 * CALLED BY accounts.html, app.html, crm.html, finance.html, tasks.html (ensureCap('books') or a script tag); cap-finance*.js and cap-crm*.js use its bkMoney
 * FLOW ensureCap('books') -> BK from GET /health (currency, year) -> each tab paints the server's figures -> money through bkMoney -> fmtMoney (no money stated: the bare amount)
 * CARD 16-finance/cb-finance */
'use strict';
if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    booksAccounts: { m: 'GET', p: '/api/books/accounts' },
    booksAccountAdd: { m: 'POST', p: '/api/books/accounts' },
    booksDaybook: { m: 'GET', p: '/api/books/daybook' },
    booksLedger: { m: 'GET', p: '/api/books/ledger/:account' },
    booksBankRail: {
      m: 'GET',
      p: '/api/books/bank/rail'
    } /* BR1: what the other parties already TOLD us (their payment advices) + the bank questions asked — the statement itself never goes */,
    booksTB: { m: 'GET', p: '/api/books/trial-balance' },
    booksPL: { m: 'GET', p: '/api/books/pl' },
    booksBS: { m: 'GET', p: '/api/books/bs' },
    booksPayRecord: { m: 'POST', p: '/api/books/payments', idem: 'attempt' /* FIN-63: one key per attempt */ },
    booksPayPreview: { m: 'POST', p: '/api/books/payments/preview' } /* M26: the bills table + the duplicate warnings; writes nothing */,
    booksLock: { m: 'POST', p: '/api/books/periods/:fy/:p/lock' },
    booksUnlock: { m: 'POST', p: '/api/books/periods/:fy/:p/unlock' },
    booksPeriods: { m: 'GET', p: '/api/books/periods' } /* every month of every year, with its status — the twelve rows of Month lock */,
    booksOpening: { m: 'POST', p: '/api/books/opening' },
    booksPacks: { m: 'GET', p: '/api/books/packs' },
    booksPackBuild: { m: 'POST', p: '/api/books/packs' },
    booksPackGet: { m: 'GET', p: '/api/books/packs/:id' },
    booksPackFile: { m: 'GET', p: '/api/books/packs/:id/file' } /* the zip itself — fetched as bytes (bkPackGet), never through api() */,
    booksPackAck: { m: 'POST', p: '/api/books/packs/:id/ack' },
    booksCheques: { m: 'GET', p: '/api/books/cheques' } /* the cheques still held, each with the steps it may take next */,
    booksChequeStep: { m: 'POST', p: '/api/books/cheques/:id/status' },
    booksRetry: { m: 'POST', p: '/api/books/outbox/retry' },
    booksTodo: { m: 'GET', p: '/api/books/todo' } /* what the owner has to do next — the API lists the checks; the To-do page only draws them */,
    booksEntryPost: {
      m: 'POST',
      p: '/api/books/entries'
    } /* F4: the owner's journal — Pay's early-pay discount sends the server's ready body (against_ref settles the bill) */
  });
}

/** the first columns of an account ledger: Date, then Mark (when the auditor's marks are on) and Party (a control account's) */
function bkLgLeadCols(ctrl) {
  var cols = [
    {
      key: 'date',
      label: tx('Date'),
      prio: 1,
      sort: 'date',
      w: 112,
      html: true,
      cell: function (l) {
        return bkNoWrap(esc(bkDvFmt(String(l.date).slice(0, 10), { day: '2-digit', month: 'short' })));
      }
    }
  ];
  if (BK.mk && BK.mk.state().may)
    cols.push({ key: 'mark', label: tx('Mark'), prio: 2, w: 120, html: true, cell: function (l) { return l.entry_id == null ? '' : BK.mk.chip(l.entry_id); }, value: function (l) { var m = l.entry_id == null ? null : BK.mk.row(l.entry_id); return m ? m.label || '' : ''; } }); /* ACC-358 */
  if (ctrl)
    cols.push({
      key: 'party',
      label: tx('Party'),
      prio: 2,
      sort: 'party',
      w: 250,
      html: true,
      cell: function (line) {
        var partyName = line.party_id ? bkPartyLabel(line.party_id, line.party_name) : line.party_name || '';
        return partyName ? '<b class="lg-party">' + esc(partyName) + '</b>' : '<span class="lg-noparty" style="color:var(--grey)">' + esc(tx(BK_NO_PARTY)) + '</span>';
      }
    });
  return cols;
}
/** hand the pack's bytes to the browser as a download (the file name is the server's Content-Disposition, else ledger-pack-<id>.zip) */
function bkPackDownload(res, blob, id) {
  var cd = '';
  try {
    cd = res.headers.get('Content-Disposition') || '';
  } catch (failure) {
    bkQuiet('pack-disposition', failure);
  }
  var m = /filename="?([^";]+)"?/.exec(cd);
  var node = document.createElement('a');
  node.href = URL.createObjectURL(blob);
  node.download = (m && m[1]) || 'ledger-pack-' + id + '.zip';
  node.setAttribute('data-testid', 'pack-download-link');
  document.body.appendChild(node);
  node.click();
  setTimeout(function () {
    URL.revokeObjectURL(node.href);
    node.remove();
  }, 1500);
}
/** the manifest shown beside the zip: its files with their fingerprints, and why the Tally file is absent or unchecked (the server's own sentence) */
function bkPackManifestHtml(reply) {
  var files = (reply && reply.manifest && reply.manifest.files) || [],
    tally = reply && reply.manifest && reply.manifest.tally;
  return (
      '<div data-testid="pack-manifest"><b>' +
      esc(tx('Manifest')) +
      '</b> · ' +
      files.length +
      ' ' +
      tx('files') +
      '<br>' +
      files
        .map(function (item) {
          return '<span class="mono">' + esc(item.name) + ' · ' + esc(String(item.sha256 || '').slice(0, 12)) + '</span>';
        })
        .join('<br>') +
      /* CX2 (A9): why the Tally file is absent or unchecked — the server's own sentence (not_for_country outside India · unverified), never a silent gap */
      (tally && tally.why
        ? '<div data-testid="pack-tally-why" style="color:var(--grey);margin-top:4px">' + esc(tx('Tally')) + ' · ' + esc(tx(tally.why)) + '</div>'
        : '') +
      '</div>'
  );
}
/**
 * ⚠️⚠️ ONE TAP, ONE RECORD (2026-09-30, review M11). Two taps on Next recorded two payments; opening balances pressed
 * twice doubled every balance. Two halves, both needed:
 *   · bkOnce — the button is dead while its call is out, and a second call with the same key is dropped
 *   · bkRef  — every form that records money carries ONE client_ref from the moment it opens: sent again on a retry
 *              (so the server answers with what it already kept), replaced only after the server said yes
 */
/* UX-137 IDENTITY: each control below carries data-cbsid, the code of its component element in the one register (CMP001/3/4/5/6/7/9/10/12/14 reused,
   CMP040..CMP044 the books' own). The mount is the screen's code (from the screen chip) + U1nn, nn = the component number; none on a page without the chip. */
/* the tap rule for a control the books still draw themselves (ui.js tap: 32 px on a desktop, 44 on a phone); none where ui.js is not loaded */
function bkTapAttribute() {
  return typeof ui !== 'undefined' && ui && typeof ui.tap === 'function' ? ui.tap('bookaction') : '';
}
function bkMountAttribute(component) {
  var chip = document.querySelector('[data-testid="screen-id"][data-cbsid]');
  var screen = chip ? chip.getAttribute('data-cbsid') : '';
  return /^[A-Z]{3}\d{3}$/.test(screen || '') ? ' data-cbmount="' + screen + '-U1' + String(component).slice(-2) + '"' : '';
}
/** the mount code of a popup this file opens through ui.dialog: the host screen's code (the screen chip) + -U2<n>; BKS001 (Accounts) when no chip is painted yet. n: 1 day bills, 2 party edit, 3 pay, 4 remind */
function bkDialogMount(n) {
  var chip = document.querySelector('[data-testid="screen-id"][data-cbsid]');
  var screen = chip ? chip.getAttribute('data-cbsid') : '';
  return (/^[A-Z]{3}\d{3}$/.test(screen || '') ? screen : 'BKS001') + '-U2' + n;
}
/* ⭐ M64: WIDENED into CBAction (app/accounts-shell.js) — the guard every page shares; bkOnce keeps its name for its callers */
function bkOnce(key, btn, fn) {
  return CBAction.once(key, btn, fn);
}
/* a fresh random client_ref for one money-recording form (web-<time>-<random>) */
function bkRef() {
  var r = '';
  try {
    var a = new Uint8Array(8);
    crypto.getRandomValues(a);
    r = Array.prototype.map
      .call(a, function (b) {
        return ('0' + b.toString(16)).slice(-2);
      })
      .join('');
  } catch (_) {
    r = Math.floor(Math.random() * 1e12).toString(16);
  }
  return 'web-' + Date.now().toString(36) + '-' + r;
}

/* a failure this screen survives: recorded through the page's cbQuiet when it has one, and the fallback handed back so the catch stays one line */
function bkQuiet(where, failure, fallback) {
  if (typeof cbQuiet === 'function') cbQuiet('books:' + where, failure);
  return fallback;
}
/* the Ledgers head (#lg_out): its laptop and phone rules, apart so bkCss stays within its size */
var LG_HEAD_CSS = [
    /* the Ledgers head on a laptop pane (#lg_out: list-ctl writes .cbl as .cbl:not(#_), id weight, so these name the id too): the title row and the tools row share ONE row (the tools sit at the right, folded to search · Filters · View · count), the column header is the second line */,
    '@container lt (min-width:621px){#bk_lt #lg_out{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto minmax(0,1fr)}#bk_lt #lg_out > *{grid-column:1/-1}#bk_lt #lg_out > .cbl-title{grid-column:1;grid-row:1}#bk_lt #lg_out > .cbl-tools{grid-column:2;grid-row:1;flex-wrap:nowrap;align-items:center;border-bottom:1px solid var(--line-soft,var(--line));padding-inline:0 12px;gap:6px}#bk_lt #lg_out > .cbl-title{padding-inline:16px;gap:4px 8px;flex-wrap:nowrap}#bk_lt #lg_out > .cbl-title .cbl-chip{flex:0 1 auto}#bk_lt #lg_out > .cbl-tools .cbl-search{flex:0 0 120px;width:120px}#bk_lt #lg_out .cbl-hc{padding-block:2px}#bk_lt #lg_out > .cbl-list{grid-row:2}}',
    /* a phone: search · Filters · View · count on ONE line (the party ledger's head was 36% of the window) */,
    '@container lt (max-width:620px){#bk_lt #lg_out .cbl-tools{flex-wrap:nowrap}#bk_lt #lg_out .cbl-tools .cbl-search{flex:1 1 60px;min-width:0}#bk_lt #lg_out .cbl-tools .cbl-count{flex:0 0 auto}/* the figures chip is text, not a button: it needs no 44 px tap height (it was a third row of the head) */#bk_lt #lg_out .cbl-title > span.cbl-chip{min-height:0}}'
].join('\n');
/* the tables' look, once, the way cap-categories does it (cbcatCss) */
function bkCss() {
  if (typeof document === 'undefined' || document.getElementById('bk_css')) return;
  var node = document.createElement('style');
  node.id = 'bk_css';
  node.textContent = [
    '.bktab th{font-size:var(--fs-1);color:var(--grey);font-weight:600;text-transform:uppercase;text-align:start;padding:5px 7px;border-bottom:1px solid var(--line)}',
    '.bktab td{padding:5px 7px;border-bottom:1px dashed var(--line);vertical-align:top}',
    '.bktab .num{text-align:end;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.bktab tfoot td{border-top:1px solid var(--ink);border-bottom:0}',
    /* ZEBRA (Athi, 2026-10-09) — the ledger and statement tables, the same one rule as CBList's rows: every other body row, from the theme's --zebra (else the ink mixed 4% into the card) */
    '.bktab tbody tr:nth-child(even){background:var(--zebra,color-mix(in srgb,var(--ink) 9%,var(--card)))}',
    '.bktab tr.bkentry td{border-top:1px solid var(--line);font-weight:600}',
    '#bk_body input[type=date].inp,#bk_body select.inp,#bk_body .supacts .inp{width:auto}',
    /* the primary button of a pane's action row (Pay · Receive · Edit · Lock …) — once here, so accounts.html, crm.html and the app read the same */
    '.supacts button.supact-pri,#bk_body .supacts button.supact-pri{background:var(--accent);border-color:var(--accent);color:var(--accent-ink,var(--on-accent))}',
    /* ⭐ THE MONEY INPUT (bkMoneyInput): the symbol sits inside the field, the figure runs to the end; the box is the field's, so the symbol never wraps off */
    '.mi{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;width:auto;max-width:100%;min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink)}',
    '.mi:focus-within{border-color:var(--blue)}',
    '.mi .mi-sym{color:var(--grey);flex:0 0 auto}',
    '.mi input.mi-in,#entrysheet .mi input.mi-in{flex:0 1 auto;min-width:0;width:12ch;min-height:0;height:auto;padding:8px 0;border:0;border-radius:0;outline:0;background:none;color:inherit;font:inherit;text-align:end;font-variant-numeric:tabular-nums;box-shadow:none}',
    /* the strip's chips: .optchip is inline-flex, which swallows the whitespace between its text and the figure */
    '.bkchip{gap:4px}',
    /* the day's to-do: one card per line on a narrow pane (flex-basis folds them at ~620px), tappable, phone first */
    '.bktodo{flex:1 1 240px;min-width:0;display:flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--card);border-radius:12px;padding:10px 12px;font-size:var(--fs-2);font-weight:600;cursor:pointer;text-align:start;color:inherit}',
    '.bktodo b{font-variant-numeric:tabular-nums;font-size:var(--fs-3);color:var(--warn-2)}',
    '.bktodo .bkgo{margin-inline-start:auto;color:var(--grey)}',
    /* the Day book's toolbar: the Day / Week / Month switch beside list-ctl's search · filters · sort. The ROWS are the Task table (list-ctl.js tbl*) — nothing here draws a row. */
    '.bkdv-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0}',
    '.bkdv-segs{display:inline-flex;gap:0}',
    '.bkdv-seg[aria-pressed=true]{background:var(--blue-tint);color:var(--blue-d);border-color:var(--blue-d);font-weight:700}',
    '.bkdv-count{color:var(--grey);font-size:var(--fs-1);margin:6px 0}',
    /* ⭐ THE LEDGERS PAGE (docs/design/ledgers-page, 2026-10-03): two panes — the ledger tree and the list (CBList) — inside one container, so the PANE decides phone or laptop, not the window.
       Tokens only; the tree is its own pane (more panes, not denser), the list is the Task table. */
    '#bk_lt{container:lt/inline-size;display:flex;height:100%;min-height:min(50vh,480px)}',
    '#bk_lt .lt-tree{width:min(var(--lt-w,320px),30%);flex:0 0 auto;display:flex;flex-direction:column;min-height:0;background:var(--page,var(--paper,#FCFAF5));border-top:1px solid var(--line)}',
    '#bk_lt.folded .lt-tree,#bk_lt.folded .lt-rz{display:none}',
    '#bk_lt .lt-tools{display:flex;gap:6px;align-items:center;padding:8px 10px 8px 16px}',
    '#bk_lt .lt-search{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--card);border-radius:9px;padding:0 10px;height:34px;font-size:var(--fs-2)}',
    '#bk_lt .lt-search input{border:0;outline:0;background:none;flex:1;min-width:0;font:inherit;color:var(--ink);padding:0;margin:0;height:auto;box-shadow:none}',
    '#bk_lt .lt-search:focus-within{border-color:var(--blue);outline:2px solid var(--accent);outline-offset:2px}',
    '#bk_lt .lt-btn{height:34px;min-height:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:9px;padding:0 10px;font:inherit;font-size:var(--fs-2)}',
    '#bk_lt .lt-ico{width:34px;padding:0}',
    '#bk_lt .lt-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:2px 6px 24px 8px}',
    '#bk_lt .lt-rz{flex:0 0 9px;margin-inline:-4px;position:relative;z-index:6;cursor:col-resize;border:0;background:none;padding:0;min-height:0}',
    '#bk_lt .lt-rz::after{content:"";position:absolute;inset-inline-start:4px;top:0;bottom:0;width:1px;background:var(--line)}',
    '@container lt (max-width:1100px) and (min-width:621px){#bk_lt{position:relative}#bk_lt:not(.folded) .lt-tree{position:absolute;inset:0 auto 0 0;z-index:30;width:min(var(--lt-w,320px),70%);box-shadow:var(--shadow,0 10px 28px rgba(0,0,0,.16));border-inline-end:1px solid var(--line)}#bk_lt:not(.folded) .lt-rz{display:none}#bk_lt.has-sel:not(.folded) .lt-pane{pointer-events:none}}',
    '#bk_lt .lt-rz:hover::after,#bk_lt .lt-rz:focus-visible::after,#bk_lt .lt-rz.drag::after{width:3px;inset-inline-start:3px;background:var(--blue)}',
    '#bk_lt .lt-pane{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}',
    '#bk_lt #lg_out{flex:1 1 auto;min-height:0}',
    '#bk_lt .lt-pane > .empty,#bk_lt .lt-pane > div:not(#lg_out){margin:24px auto}',
    '#bk_lt .lt-empty{padding:24px 12px;color:var(--grey);text-align:center;font-size:var(--fs-2)}',
    /* a node: ONE line — a name that cannot fit WRAPS (never clipped); the figure is one fixed column so every figure lines up; the chosen one a 3 px bar and a light tint */
    '#bk_lt .tn{display:grid;grid-template-columns:16px minmax(0,1fr) auto;align-items:start;gap:0 6px;width:100%;border:0;background:none;text-align:start;border-radius:8px;padding:6px 8px 6px calc(6px + var(--lvl,0) * 14px);position:relative;color:var(--ink);min-height:34px;font:inherit;font-size:var(--fs-2);cursor:pointer}',
    '#bk_lt .tn:hover{background:var(--panel)}',
    '#bk_lt .tn .tw{width:16px;text-align:center;line-height:1.45}',
    '#bk_lt .tn .nm{min-width:0;overflow-wrap:normal;word-break:normal;hyphens:manual;line-height:1.35;padding-top:1px}',
    '#bk_lt .tn .am{font-family:var(--f-num,"IBM Plex Mono",ui-monospace,monospace);font-variant-numeric:tabular-nums;font-size:calc(var(--fs-2) * .95);color:var(--grey);white-space:nowrap;text-align:end;min-width:var(--am-w,12ch);padding-top:2px}',
    '#bk_lt .tn .am.nil{color:var(--faint,var(--grey));opacity:.8}',
    '#bk_lt .tn .ck{color:var(--green);font-weight:700;margin-inline-end:4px}',
    '#bk_lt .tn.band{font-size:var(--fs-1);font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--grey);margin-top:10px}',
    '#bk_lt .tn.band:first-child{margin-top:2px}',
    '#bk_lt .tn.band .am,#bk_lt .tn.grp .am{font-family:var(--f-num,"IBM Plex Mono",monospace);letter-spacing:0;text-transform:none;font-weight:400;min-width:0}',
    '#bk_lt .tn.grp{font-weight:600;color:var(--grey)}',
    '#bk_lt .tn.party .nm{color:var(--grey)}',
    '#bk_lt .tn.on{background:color-mix(in srgb,var(--blue-tint-bg,var(--blue-t,#E4EEFA)) 60%,transparent);color:var(--blue-2,var(--blue-i,#174A87));font-weight:600}',
    '#bk_lt .tn.on::before{content:"";position:absolute;inset-inline-start:0;top:6px;bottom:6px;width:3px;border-radius:3px;background:var(--blue-2,var(--blue-i,#174A87))}',
    '#bk_lt .tn.on .nm,#bk_lt .tn.on .am{color:inherit}',
    '#bk_lt .tn mark{background:var(--amber-t,var(--warn-tint,#FDF3DC));color:inherit;border-radius:3px;box-shadow:0 0 0 1px var(--amber-b,#EFD39A)}',
    '#bk_lt .tn:focus-visible,#bk_lt .lt-btn:focus-visible,#bk_lt .lt-rz:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}',
    /* the opened entry: its journal never scrolls sideways (a long ledger name wraps) and its quiet facts line */
    '#bk_lt .cbl-nrow > span:first-child{white-space:normal!important;overflow:visible!important;text-overflow:clip!important;overflow-wrap:anywhere}#bk_lt .cbl-next{overflow-x:hidden}',
    '#bk_lt .lg-facts{display:flex;flex-wrap:wrap;gap:2px 0;color:var(--grey);font-size:var(--fs-1);margin:8px 0 0}',
    '#bk_lt .lg-facts > span:not(:last-child)::after{content:"·";margin:0 7px;opacity:.7}', LG_HEAD_CSS,
    /* phone: the tree is page one, the ledger page two (list → detail → back); no squeezed side panel */
    '@container lt (max-width:620px){#bk_lt .lt-tree{width:100%;border-top:0}#bk_lt .lt-rz,#bk_lt [data-lt="fold"]{display:none}#bk_lt.has-sel .lt-tree{display:none}#bk_lt:not(.has-sel) .lt-pane{display:none}#bk_lt .tn{min-height:44px;padding-block:10px}#bk_lt .tn.band{min-height:40px}#bk_lt .lt-tools{padding:8px 16px}#bk_lt .cbl-nrow > span:not(:first-child){width:auto!important;min-width:76px;padding-inline-start:10px;white-space:nowrap}',
    /* the ledger page's title row on a phone: ‹ title … bell · home · avatar on line one (R06: the bell takes ~36 px of it); the period, the figures and the notice on line two (the slot dissolves so each of its buttons takes its own place) */
    '#bk_lt .cbl-title .cbl-slot{display:contents!important}#bk_lt .cbl-title h1{flex:1 1 calc(100% - 186px);min-width:0;order:0}#bk_lt .cbl-title .cbb-btn{min-width:0;height:34px;padding:0 6px;font-size:15px;line-height:1}#bk_lt .cbl-title [data-lt="back"]{order:-1}#bk_lt .cbl-title .who{order:1}#bk_lt .cbl-title [data-lt="statement"],#bk_lt .cbl-title > .cbl-anchor,#bk_lt .cbl-title > .cbl-chip{order:2}}',
    /* on a phone the tapped view covers the rail — the way back must be visible (cb-design: .dback is desktop-hidden) */
    '#bk_back{display:none}',
    '.appwrap.m .panel.showdetail #bk_back{display:block;padding:10px 13px 0}'
  ].join('\n');
  document.head.appendChild(node);
}
bkCss();

/* ── money and dates: through the engines, never by hand ── */
/* the ledger's currency and its decimals: the money field's own (app/ui-money.js, CMP055-I05) — N1: none known -> undefined, never INR */
function bkCur(c) {
  return CBUiMoney.currency(c);
}
function bkDec(c) {
  return CBUiMoney.decimals(c);
}
function bkMoney(minor, c) {
  var n = Number(minor || 0) / Math.pow(10, bkDec(c));
  try {
    return fmtMoney(n, bkCur(c));
  } catch (_) {
    return n.toFixed(bkDec(c));
  }
}
/** a balance the way a ledger writes it: the amount, then Dr or Cr — never a minus sign (the server's figure is Dr − Cr) */
function bkDrCr(v, c) {
  v = Number(v || 0);
  return bkMoney(Math.abs(v), c) + (v ? ' ' + tx(v > 0 ? 'Dr' : 'Cr') : '');
}
/** ⭐ A BALANCE IN WORDS, never a minus (spec T59; R30): the server's dues figure is signed, + they owe you. Chips and sentences say it; a ledger table says Dr/Cr (bkDrCr above). */
function bkOwes(v, c) {
  v = Number(v || 0);
  return v ? tx(v > 0 ? 'they owe you' : 'you owe') + ' ' + bkMoney(Math.abs(v), c) : tx('settled');
}
function bkToMinor(v, c) {
  var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? Math.round(n * Math.pow(10, bkDec(c))) : NaN;
}
/**
 * ⭐⭐ THE ONE MONEY INPUT (M36 · R16 · T16): every amount a person TYPES goes through bkMoneyInput, and every amount SHOWN goes through bkMoney / bkDrCr / bkOwes.
 * The input and its readers LIVE in app/ui-money.js (CMP055-I05; ui.field({ kind: 'money' }) draws the same field); these names are one-line wrappers so no caller changed.
 * The unit owns three things and does no money arithmetic: the SYMBOL (CBLocale.symbol), the DECIMALS (CBMoney.decimals via bkDec — 2 for INR, 0 for JPY, 3 for OMR) and
 * MINOR UNITS out (bkMoneyRead — digits are joined as text, never multiplied). A typed amount is KEPT as typed and REFUSED with a sentence when it is a wrong mark, an extra place, a sign or too large (ACC-347).
 * A bare <input inputmode="decimal"> anywhere in CB Accounts or CB CRM fails the build (e2e/money-input-guard.cjs).
 *   o: { id, tid?, minor? | text?, cur?, ph?, on? (inline js run on input), extra? (raw attrs on the input), w? (css width of the whole field) }
 */
function bkMinorText(minor, c) {
  return CBUiMoney.minorText(minor, c);
}
function bkMoneyClamp(el) {
  return CBUiMoney.clamp(el);
}
function bkSymbol(code) {
  return CBUiMoney.symbol(code);
}
function bkMoneyInput(o) {
  return CBUiMoney.input(o);
}
/** the text a money field holds → minor units: an integer, or NaN when it is empty or REFUSED (a wrong mark, an extra place, a sign, above 2^53) */
function bkMoneyMinor(text, c) {
  return CBUiMoney.minor(text, c);
}
/** the minor units a money field (by id or element) holds — its own currency, read from the field. Quiet on purpose (the pay line reads it on every key): the refusal sentence is said under the field when focus leaves it */
function bkMoneyRead(idOrEl) {
  var el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
  return el ? CBUiMoney.read(el).value : NaN;
}
/** the bill's own number for a row; a bill that has none says "Bill of 24 Oct" (its date) or "Bill", never its id (R123) */
function bkBillNo(no, ref, date) {
  if (no) return no;
  if (ref && !cbIsRawId(ref)) return ref;
  return date ? txf('Bill of {date}', { date: bkDate(date) }) : tx('Bill');
}
function bkDate(d) {
  if (!d) return '—';
  try {
    return CBLocale.date(d);
  } catch (_) {
    return String(d).slice(0, 10);
  }
}
/** the SHOP's day — the browser's local calendar day (F3b, 2026-10-13: toISOString() is the UTC day, which for an Indian shop between midnight and
 *  05:30 is YESTERDAY — the entry date, the dues as-of and the Cash tab's Today tag were all a day behind every early morning). Same day as crmLocalISO / peYmd. */
function bkToday() {
  var date = new Date(),
    p = function (n) {
      return (n < 10 ? '0' : '') + n;
    };
  return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate());
}
/* ── CB Finance · Terms (F2): the words for a term and for a change to one — read by the Finance Terms tab AND the CRM record (one wording, two screens) ── */
var BK_TERM_FIELD = { credit_days: 'Credit days', credit_limit_minor: 'Credit limit', interest: 'Interest', early: 'Early pay', allowed: 'Over limit allowed' };
/* the words for one term value (credit limit as money, interest as its rate text, the rest as typed) */
function bkTermVal(f, v, c) {
  if (v == null || v === '') return tx('not set');
  if (f === 'credit_limit_minor' || f === 'allowed') return bkMoney(Number(v), c);
  if (f === 'interest' || f === 'early') {
    try {
      var o = typeof v === 'string' ? JSON.parse(v) : v;
      return f === 'interest'
        ? (o.on ? o.rate_pct + '%' : tx('off')) + (o.grace_days ? ' · ' + txf('{n} days grace', { n: o.grace_days }) : '')
        : o.pct + '% ' + txf('within {n} days', { n: o.within_days });
    } catch (_) {
      return String(v);
    }
  }
  return String(v);
}
/** the change events the server lists (newest first): date · what · from → to; `extra(x, index)` may add html to a row (FIN-46: the Terms tab's Undo) */
function bkTermEvents(list, c, tid, extra) {
  if (!list || !list.length) return '<div class="hint" data-testid="' + tid + '-none">' + esc(tx('No changes yet')) + '</div>';
  return list
    .map(function (x, index) {
      var f = String(x.field || '').replace(/^(customer|supplier)./, '');
      return (
        '<div class="kv" data-testid="' +
        tid +
        '-' +
        index +
        '"><b style="flex:0 0 96px">' +
        esc(bkDate(x.at)) +
        '</b><span>' +
        esc(tx(BK_TERM_FIELD[f] || f)) +
        ': ' +
        esc(bkTermVal(f, x.old, c)) +
        ' → ' +
        esc(bkTermVal(f, x.new, c)) +
        '</span>' +
        (extra ? extra(x, index) : '') +
        '</div>'
      );
    })
    .join('');
}
/** ⭐ ONE door for a failure's words: the app's verdict table (friendlyErr, app.html) first, the screen's own fallback
 *  when the server said nothing — never a second table here, never a raw message pasted into a pane. */
function bkWhy(e, fallback) {
  var m = (e && e.message) || '';
  if (!m) return fallback || tx('Could not be read');
  return typeof friendlyErr === 'function' ? friendlyErr(e) : m;
}
function bkErr(e) {
  return esc(bkWhy(e, tx('Could not be read')));
}

/* ══ 1 · THE PANELS' HALF — a chip on each row, a block in each detail pane ═══════════════════════════════════ */
var BK = { dues: null, duesAt: 0, stmt: {}, owed: {}, tab: 'daybook' };
/** the /dues answer becomes the party map (party_id → no · name · balance) every screen reads — one place stores it */
function bkDuesStore(r) {
  BK.duesRaw = r; /* the answer as the server sent it: the Day book's to-do counts read it when it lands */
  BK.dues = {};
  BK.duesCur = (r && r.currency) || null;
  BK.duesAt = Date.now();
  ((r && r.parties) || []).forEach(function (item) {
    BK.dues[item.party_id] = item;
  });
  return BK.dues;
}
/** ⭐ A ROW NAMES ITS PARTY (Athi, 2026-10-02): "P-0007 · Chola Auto Care" from the dues map; the name alone if there is no number; never the bare id */
function bkPartyLabel(partyId, fallbackName) {
  var d = partyId && BK.dues && BK.dues[partyId];
  var name = (d && d.name) || fallbackName || '',
    no = d && d.party_no;
  return no && name ? no + ' · ' + name : name || no || '';
}
/** the balances arrived: the open Dues list and the party lists paint again (each on its own, a failure is logged, never thrown) */
function bkDuesRepaintLists() {
  try {
    var duesList = document.getElementById('bkl_dues') && CBList.get('dues'); /* W15-117: the rows are read again, a cleared party drops off ⚑ Needs you */
    if (duesList) {
      bkNeedsHead();
      duesList.refresh();
    }
  } catch (failure) { bkQuiet('repaint-dues', failure); }
  try {
    if (typeof paintCustList === 'function' && document.getElementById('cu_rows')) paintCustList();
  } catch (failure) { bkQuiet('repaint-customers', failure); }
  try {
    if (typeof paintSupList === 'function' && document.getElementById('sup_rows')) paintSupList();
  } catch (failure) { bkQuiet('repaint-suppliers', failure); }
}
/** the open party block was painted before the balances arrived — repaint that pane (never a modal) */
function bkDuesRepaintOpenParty() {
  try {
    if (document.querySelector('#detailpane [data-testid^="party-books-"]') && typeof paintCustDetail === 'function' && UI.nav === 'customers')
      paintCustDetail();
    if (document.querySelector('#supslide [data-testid^="party-books-"]') && typeof paintSupSlide === 'function') paintSupSlide();
  } catch (failure) { bkQuiet('repaint-open-party', failure); }
}
/** the balances arrived: every list and pane that shows a chip paints again */
function bkDuesRepaint() {
  bkDuesRepaintLists();
  bkDuesRepaintOpenParty();
}
/** ⭐ ONE READ for every row's chip: /dues answers all parties at once (stored balances, not a scan) */
async function booksDuesLoad(force) {
  if (!force && BK.dues && Date.now() - BK.duesAt < 30000) return BK.dues;
  try {
    bkDuesStore(await api('booksDues')); /* WX-P2P-02: no asOf — the server's today is the shop's day */
  } catch (_) {
    BK.dues = BK.dues || {};
  }
  bkDuesRepaint();
  return BK.dues;
}
/** the row chip: what this party owes you (or you them), and the oldest due date */
function partyDueChipHTML(partyId, opts) {
  var d = BK.dues && BK.dues[partyId];
  if (!d) return '';
  var no = opts && opts.noNo ? '' : esc(d.party_no || '') + ' · '; /* CB CRM names the party in the same row: its number is not said twice */
  var b = Number(d.balance_minor || 0);
  if (!b) return '<span class="optchip" data-testid="party-due-' + esc(partyId) + '" style="color:var(--grey)">' + no + tx('settled') + '</span>';
  var owes = b > 0;
  return (
    '<span class="optchip" data-testid="party-due-' +
    esc(partyId) +
    '" title="' +
    esc(owes ? tx('They owe you') : tx('You owe them')) +
    (d.oldest_due ? ' · ' + esc(tx('oldest due')) + ' ' + esc(bkDate(d.oldest_due)) : '') +
    '"' +
    ' style="' +
    (owes
      ? 'background:var(--warn-tint);color:var(--warn-2);border-color:var(--warn-2)'
      : 'background:var(--blue-tint);color:var(--blue-d);border-color:var(--blue-d)') +
    '">' +
    no +
    esc(bkOwes(b, BK.duesCur)) +
    '</span>'
  );
}
/**
 * ⭐ THE PARTY BLOCK in the Customer detail and the Supplier record: who they are for the ledger (party no, legal
 * name, nickname, tax ids, credit terms), what stands between you (balance, oldest due), their statement, and the
 * one action — Receive (a customer) / Pay (a supplier).
 */
function partyBooksHTML(kind, partyId, row, moneyOnly) {
  /* moneyOnly (the CRM record, C5/C19): the section already has its title, the head has Edit and Pay/Receive - this block is the money and the statement */
  if (!partyId) return '';
  var dues = (BK.dues && BK.dues[partyId]) || {};
  var partyRow = row || {};
  var labelValue = function (label, value) {
    return (
      '<div class="kv" style="display:flex;gap:8px;padding:9px 13px;border-bottom:1px dashed var(--line);font-size:var(--fs-2)"><b style="min-width:112px;color:var(--grey);font-weight:600;font-size:var(--fs-1);text-transform:uppercase">' +
      label +
      '</b><span style="font-weight:600;flex:1">' +
      (value == null || value === '' ? '—' : value) +
      '</span></div>'
    );
  };
  var taxText = (partyRow.tax_ids || [])
    .map(function (item) {
      return esc(item.scheme) + ' <span class="mono">' + esc(item.value) + '</span>';
    })
    .join(' · ');
  var balance = Number(dues.balance_minor || 0);
  var actionWord = kind === 'supplier' ? tx('Pay') : tx('Receive');
  setTimeout(function () {
    partyStatementLoad(partyId);
  }, 0);
  return (
    (moneyOnly ? '' : '<div class="sec">' + tx('Ledger') + '</div>') +
    '<div class="itab" data-testid="party-books-' +
    esc(partyId) +
    '" style="border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:12px">' +
    (moneyOnly
      ? ''
      : labelValue(tx('Party no'), '<span class="mono" data-testid="party-no">' + esc(dues.party_no || partyRow.party_no || '—') + '</span>') +
        labelValue(tx('Legal name'), esc(partyRow.legal_name || '')) +
        labelValue(tx('Nickname'), esc(partyRow.nickname || '')) +
        labelValue(tx('Tax ids'), taxText)) +
    labelValue(
      tx('Credit'),
      (partyRow.credit_days != null ? txf('{n} days', { n: partyRow.credit_days }) : '—') +
        (partyRow.credit_limit_minor != null ? ' · ' + tx('limit') + ' ' + esc(bkMoney(partyRow.credit_limit_minor)) : '')
    ) +
    labelValue(tx('Balance'), '<b data-testid="party-balance"' + (balance ? '' : ' style="color:var(--grey);font-weight:400"') + '>' + esc(bkOwes(balance, BK.duesCur)) + '</b>') +
    labelValue(tx('Oldest due'), dues.oldest_due ? esc(bkDate(dues.oldest_due)) : '—') +
    (moneyOnly
      ? ''
      : '<div class="supacts" style="display:flex;gap:7px;padding:9px 13px;flex-wrap:wrap">' +
        '<button data-cbsid="CMP012-B01"' + bkMountAttribute('CMP012') + ' data-testid="party-edit" onclick="partyEditOpen(\'' +
        kind +
        "','" +
        esc(partyId) +
        '\')">' +
        tx('Edit') +
        '</button>' +
        '<button data-cbsid="CMP042-B01"' + bkMountAttribute('CMP042') + ' class="supact-pri" data-testid="party-pay" onclick="payOpen(\'' +
        kind +
        "','" +
        esc(partyId) +
        '\')">' +
        actionWord +
        '</button></div>') +
    '<div id="bk_stmt_' +
    esc(partyId) +
    '" data-testid="party-statement" style="padding:9px 13px;font-size:var(--fs-1);color:var(--grey)">' +
    tx('Reading…') +
    '</div>' +
    '</div>'
  );
}
/* fetch a party's statement once and paint it into its box (a second call finds data-done and leaves) */
async function partyStatementLoad(partyId) {
  var box = document.getElementById('bk_stmt_' + partyId);
  if (!box || box.getAttribute('data-done') === '1') return;
  box.setAttribute('data-done', '1');
  if (BK.stmt[partyId]) {
    box.style.color = '';
    box.innerHTML = statementHTML(BK.stmt[partyId]);
    return;
  }
  try {
    var reply = await api('booksStatement', { params: { id: partyId } });
    BK.stmt[partyId] = reply;
    box = document.getElementById('bk_stmt_' + partyId);
    if (!box) return;
    box.style.color = '';
    box.innerHTML = statementHTML(reply);
  } catch (e) {
    box = document.getElementById('bk_stmt_' + partyId);
    if (box) box.innerHTML = bkErr(e);
  }
}
/**
 * ⭐ WHERE AN ENTRY CAME FROM (Athi, 2026-10-01, the first real entry: "where is it referenced to the sale record, how do I
 * connect to the sale record, who has done it?"). The server's `source` (routes/books.js sourceOf) becomes the parts after
 * the entry's word: "Bill C2/26-27/0002 · Counter C2 · Athi" — the number is a link that opens the chit; a walk-in day
 * reads "12 bills · Counter C2". A part the server did not know is left out, never guessed. No source → ''.
 */
/** a walk-in day's "N bills": opens the bills it covers, each one a link to its chit (the server names them in source.bills; without them it is only the count) */
function bkDayBillsLink(s, tid) {
  var word = esc(txn('{count} bill', '{count} bills', s.count));
  if (!s.bills || !s.bills.length) return word;
  var BKD = (BK.dayBills = BK.dayBills || {});
  BKD[tid] = s.bills;
  return (
    '<a data-cbsid="CMP044-C01"' + bkMountAttribute('CMP044') + ' href="#" data-testid="' + esc(tid) + '-bills" onclick="event.stopPropagation();bkDayBillsOpen(\'' + esc(tid) + '\');return false">' + word + '</a>'
  );
}
/* open the popover listing the bills one day-book entry settled */
function bkDayBillsOpen(tid) {
  var bills = (BK.dayBills || {})[tid] || [];  /* where-used: out-of-scope the mount is bkDialogMount(n): the host screen's own code plus -U2n, so it cannot be one literal */
  ui.dialog({
    mount: bkDialogMount(1),
    pop: 'POP093',
    titleText: txn('{count} bill', '{count} bills', bills.length),
    titleTestid: 'daybills_title',
    body:
      '<div data-testid="daybills_list" style="max-height:54vh;overflow-y:auto">' +
      bills
        .map(function (item, index) {
          return '<div style="padding:6px 0">' + bkBillPart({ ref: item.ref, chit_id: item.chit_id }, 'daybills-' + index) + '</div>';
        })
        .join('') +
      '</div>',
    actions: [{ name: 'close', options: { mount: bkDialogMount(1), testid: 'daybills_close' } }]
  });
}
/** a long payment reference, readable: its first and last four (4421…9931) — the full one is on the chit */
function bkShortRef(r) {
  var text = String(r == null ? '' : r).trim();
  return text.length > 10 ? text.slice(0, 4) + '…' + text.slice(-4) : text;
}
var BK_SRC_WORD = { bill: 'Bill', purchase: 'Bill', receipt: 'Receipt', payment: 'Payment', credit_note: 'Credit note', expense: 'Expense', income: 'Income' };
/** the person who serviced it IS the shop itself (an owner, not a counter hand) — the shop's own name, as the session knows it */
function bkIsShopName(n) {
  if (typeof SESSION === 'undefined') return false;
  var shop = SESSION.entity || (SESSION.role === 'entity' ? SESSION.name : '');
  return !!shop && String(n || '').trim() === String(shop).trim();
}
/** the bill's number as a link that opens the chit sheet, with its time — "Bill C2/26-27/0002 12:30" (the word is the caller's) */
function bkBillPart(s, tid, noTime) {
  if (!s || !(s.ref || s.chit_id)) return '';
  var no = s.ref ? '<span class="mono">' + esc(s.ref) + '</span>' : esc(tx('Open'));
  var link = s.chit_id
    ? '<a data-cbsid="CMP044-C02"' + bkMountAttribute('CMP044') + ' href="#" data-testid="' + esc(tid) + '" onclick="event.stopPropagation();openChitSheet(\'' + esc(s.chit_id) + '\');return false">' + no + '</a>'
    : no;
  return link + (s.doc_at && !noTime ? ' <span data-testid="' + esc(tid) + '-at">' + esc(bkTime(s.doc_at)) + '</span>' : '');
}
/* ⭐ HOW IT WAS PAID (Athi, 2026-10-01: "clearly segregate credit, cash, UPI") — a day: each tender with its amount */
function bkHowPart(text, tid, cur) {
  if (!text) return '';
  if (text.kind === 'day' && text.split && text.split.length)
    return text.split
      .map(function (x) {
        return esc(tx(x.how)) + ' ' + esc(bkMoney(x.amount_minor, cur));
      })
      .join(' · ');
  if (text.how)
    return (
      '<span data-testid="' +
      esc(tid) +
      '-how">' +
      esc(tx(text.how)) +
      (text.how_ref ? ' <span class="mono">' + esc(bkShortRef(text.how_ref)) + '</span>' : '') +
      '</span>'
    );
  return '';
}
/* ⭐ the person who rang it up is NOT the party (2026-10-02: a 1300 row read as if the shop owed itself) — "rung by", and last */
function bkRungPart(s) {
  return s && s.by ? esc(tx('rung by')) + ' ' + esc(s.by) + (bkIsShopName(s.by) ? ' ' + esc(tx('(owner)')) : '') : '';
}
/* the words that say where an entry came from: the kind word once, then its number and who made it */
function bkSourceParts(s, tid, cur, lead) {
  if (!s) return [];
  var out = [];
  /* ⭐ the kind word ONCE (2026-10-03: "Expense · Expense C2/…"): when the entry's own word already says it, only the number follows */
  var text = BK_SRC_WORD[s.kind] ? tx(BK_SRC_WORD[s.kind]) : '',
    said =
      !!text &&
      String(lead || '')
        .trim()
        .toLowerCase() === text.toLowerCase();
  if (s.kind === 'day') {
    if (s.count != null) out.push(bkDayBillsLink(s, tid));
  } else if (s.ref || s.chit_id) out.push((text && !said ? esc(text) + ' ' : '') + bkBillPart(s, tid));
  var how = bkHowPart(s, tid, cur);
  if (how) out.push(how);
  if (s.counter) out.push(esc(counterWord(s.counter)));
  var rung = bkRungPart(s);
  if (rung) out.push(rung);
  return out;
}
/** the entry's own word, then its source: "Sale · Bill … · Counter C2 · Athi" — a walk-in day says "Walk-in day" */
function bkEntryHead(e, tid, cur, party) {
  var s = e && e.source;
  var head =
    s && s.kind === 'day'
      ? esc(tx('Walk-in day'))
      : s && s.kind === 'receipt'
        ? esc(tx('Received'))
        : esc((e && (e.narration || e.what || e.event_type)) || '');
  return [head].concat(party ? [esc(party)] : [], bkSourceParts(s, tid, cur, head)).join(' · ') + bkRecordedHTML(e, tid);
}
/** the bill's own time of day, in the shop's zone (CBLocale.time) — "beside the bill number" */
function bkTime(ts) {
  try {
    return CBLocale.time(ts) || '';
  } catch (failure) {
    return bkQuiet('time', failure, '');
  }
}
/** the small line under a Day book entry an adviser posted for the client: "Posted by Pat Lee, Bayside Bookkeeping" (the api's posted_by; nothing for an entry nobody posted for the client) */
function bkPostedByHTML(e) {
  var words = typeof CBBooksActing !== 'undefined' ? CBBooksActing.postedByWords(e) : '';
  return words ? '<div class="sub" data-testid="db-posted-by">' + esc(words) + '</div>' : '';
}
/**
 * ⭐ BOTH TIMES (Athi, 2026-10-01: "the time the bill was made or the time the entry was accepted? both should be there").
 * The row is the bill's (its date, its time beside the number); when the ledger took it on ANOTHER day — a late bill, a
 * buyer's acceptance days after the invoice — "recorded 01 Oct" follows, muted. Same day → nothing more to say.
 */
function bkRecordedHTML(e, tid) {
  if (!e) return '';
  var s = e.source || {},
    doc = e.doc_date || null,
    post = e.posting_date || e.date || null,
    rec = s.recorded_at || null;
  var day = function (v, o) {
    try {
      return CBLocale.date(v, o);
    } catch (_) {
      return String(v).slice(0, 10);
    }
  };
  var late = (doc && post && doc !== post) || (doc && rec && day(rec) !== day(doc));
  if (!late) return '';
  return (
    ' <span data-testid="' +
    esc(tid) +
    '-rec" style="color:var(--grey);font-weight:400">' +
    esc(txf('recorded {date}', { date: day(rec || post, { day: '2-digit', month: 'short' }) })) +
    '</span>'
  );
}
/** opening · each movement with its running balance · closing — the shape every statement has */
/* ── M29 · Reverse from the row ──
 * A statement line names its entry (entry_id, M29 api), so the ONE confirm (cap-entry.js enReverse) runs from the row without a Day book read; the
 * answer repaints THIS row — "reversed by MJ/… — reason" — and the toast says the bills reopened (the API's words). Both statement painters
 * (the CRM record's table, the ledger's CBList) read the same line object, so the row that was pressed is the row that changes. */
/** may this line be reversed from its row: it names its entry, is not already reversed, and is not itself a reversal */
function bkCanReverse(l) {
  return !!(l && l.entry_id && !l.reversed_by && !l.reverses_entry_id && l.event_type !== 'reversal');
}
/* reverse one statement line through the shared reverse dialog, then show the reversal on that line */
function bkReverseLine(l, partyId) {
  if (!bkCanReverse(l) || typeof enReverse !== 'function') return;
  enReverse(l.entry_id, l.entry_no || l.ref, false, function (r, why) {
    l.reversed_by = (r && r.entry_no) || '—';
    l.reversed_why = why || null;
    if (l.payment_id) l.unapplied_minor = 0;
    var st = partyId ? BK.stmt[partyId] : null,
      box = partyId ? document.getElementById('bk_stmt_' + partyId) : null;
    if (st && box && (st.lines || []).indexOf(l) >= 0) box.innerHTML = statementHTML(st, partyId);
    if (BK.lt && BK.lt.r && (BK.lt.r.lines || []).indexOf(l) >= 0 && BK.lt.api) BK.lt.api.refresh();
  });
}
function bkStmtReverse(partyId, i) {
  var st = BK.stmt[partyId];
  bkReverseLine(st && st.lines && st.lines[i], partyId);
}
/** the chips a line carries after M29: "reversed by MJ/… — reason" · the advice state (M30: CBAdvice's words — none → nothing) · the Advice button on a payment line */
function bkLineChips(l, tid) {
  var out = '';
  if (l && l.reversed_by)
    out +=
      ' <span class="cbl-chip" data-testid="' +
      esc(tid) +
      '-rev">' +
      esc(tx('reversed by') + ' ' + l.reversed_by + (l.reversed_why ? ' — ' + l.reversed_why : '')) +
      '</span>';
  if (l && l.advice && l.advice.state && l.advice.state !== 'none')
    out += ' <span class="cbl-chip" data-testid="' + esc(tid) + '-adv">' + esc(bkAdviceWords(l.advice)) + '</span>';
  /* M30: every recorded payment line offers the advice (send on rail · share off rail); whether THIS login may is the server's answer, painted by the unit */
  if (l && l.payment_id && !l.reversed_by && !l.reverses_entry_id && typeof CBAdvice !== 'undefined')
    out +=
      ' <button data-cbsid="CMP042-B20"' + bkMountAttribute('CMP042') + ' type="button" class="cbl-btn" data-testid="' +
      esc(tid) +
      '-advbtn" data-adv="' +
      esc(l.payment_id) +
      '" onclick="event.stopPropagation();bkAdviceToggle(this)">✉ ' +
      esc(tx('Advice')) +
      '</button>';
  return out;
}
/** the chip words for an advice state — the unit's own (one vocabulary on the row and under the outcome) */
function bkAdviceWords(a) {
  return typeof CBAdvice !== 'undefined' ? CBAdvice.stateWords(a) : a && a.state ? tx('advice') + ' ' + tx(a.state) : '';
}
/**
 * M30 · the Advice button on a statement row: mounts CBAdvice (app/rail-advice.js) right under the row's details, once; a second press folds it.
 * The unit reads GET /payments/:id/advice itself and paints Send / Share with the server's may; its cb:rail / onDone flips THIS row's chip
 * locally (every line object that is this payment, on the CRM table and the ledger list alike), never the screen.
 */
function bkAdviceToggle(btn) {
  var pid = btn && btn.getAttribute('data-adv');
  if (!pid) return;
  var cell = btn.closest('td,div') || btn.parentNode,
    host = cell.querySelector('[data-adv-host="' + pid + '"]');
  if (host) {
    host.remove();
    return;
  }
  host = document.createElement('div');
  host.setAttribute('data-adv-host', pid);
  host.setAttribute('data-testid', 'adv-host');
  host.style.marginTop = '6px';
  btn.insertAdjacentElement('afterend', host);
  var party = BK.lt && BK.lt.sel && BK.lt.sel.party ? bkPartyLabel(BK.lt.sel.party) : '';
  CBAdvice.mount(host, {
    payment_id: pid,
    party: party || undefined,
    context: { host: typeof ACC !== 'undefined' ? 'accounts' : typeof CRM !== 'undefined' ? 'crm' : 'app' },
    onDone: function (res) {
      bkAdviceFlip(pid, res, cell);
    }
  });
}
/** the row after an advice went: the line objects remember the state, the chip beside the button repaints — no re-read */
function bkAdviceFlip(pid, res, cell) {
  var lines = [];
  Object.keys(BK.stmt || {}).forEach(function (item) {
    ((BK.stmt[item] && BK.stmt[item].lines) || []).forEach(function (entry) {
      if (entry.payment_id === pid) lines.push(entry);
    });
  });
  ((BK.lt && BK.lt.r && BK.lt.r.lines) || []).forEach(function (item) {
    if (item.payment_id === pid) lines.push(item);
  });
  lines.forEach(function (item) {
    item.advice = Object.assign({}, item.advice || {}, res);
  });
  var chip = cell && cell.querySelector('[data-testid$="-adv"]'),
    node = cell && cell.querySelector('[data-adv="' + pid + '"]');
  var words = bkAdviceWords(res);
  if (chip) chip.textContent = words;
  else if (node && words) {
    chip = document.createElement('span');
    chip.className = 'cbl-chip';
    chip.setAttribute('data-testid', (node.getAttribute('data-testid') || '').replace(/-advbtn$/, '-adv'));
    chip.textContent = words;
    node.insertAdjacentElement('beforebegin', chip);
    node.insertAdjacentText('beforebegin', ' ');
  }
}
/* the statement table of one party: lines with their running balance, reverse links and chips */
function statementHTML(r, partyId) {
  var c = r && r.currency,
    pid = partyId || (r && r.party_id) || '';
  var rows = ((r && r.lines) || [])
    .map(function (item, index) {
      var rev =
        pid && item.payment_id && bkCanReverse(item) && typeof enReverse === 'function'
          ? ' <button data-cbsid="CMP042-B21"' + bkMountAttribute('CMP042') + ' type="button" class="cbl-btn" data-testid="stmt-reverse-' +
            index +
            '" onclick="event.stopPropagation();bkStmtReverse(\'' +
            esc(pid) +
            "'," +
            index +
            ')">↩ ' +
            esc(tx('Reverse')) +
            '</button>'
          : '';
      return (
        '<tr' +
        (item.source_chit_id ? ' style="cursor:pointer" onclick="openChitSheet(\'' + esc(item.source_chit_id) + '\')"' : '') +
        '><td data-l="' + esc(tx('Date')) + '">' +
        esc(bkDate(item.date)) +
        '</td><td data-l="' + esc(tx('What')) + '" data-testid="stmt-what-' +
        index +
        '">' +
        bkEntryHead(item, 'stmt-src-' + index, c, bkPartyLabel(item.party_id || partyId || (r && r.party_id), item.party_name)) +
        (item.ref ? ' <span class="mono">' + esc(item.ref) + '</span>' : '') +
        bkLineChips(item, 'stmt-' + index) +
        rev +
        '</td>' +
        '<td class="num" data-l="' + esc(tx('Debit')) + '">' +
        (item.dr_minor ? esc(bkMoney(item.dr_minor, c)) : '') +
        '</td><td class="num" data-l="' + esc(tx('Credit')) + '">' +
        (item.cr_minor ? esc(bkMoney(item.cr_minor, c)) : '') +
        '</td><td class="num" data-l="' + esc(tx('Balance')) + '"><b>' +
        esc(bkDrCr(item.running_minor, c)) +
        '</b></td></tr>'
      );
    })
    .join('');
  return (
    '<table class="bktab" style="width:100%;border-collapse:collapse;font-size:var(--fs-1)"><thead><tr><th>' +
    tx('Date') +
    '</th><th>' +
    tx('What') +
    '</th><th class="num">' +
    tx('Debit') +
    '</th><th class="num">' +
    tx('Credit') +
    '</th><th class="num">' +
    tx('Balance') +
    '</th></tr></thead><tbody>' +
    '<tr><td></td><td><i>' +
    tx('Opening') +
    '</i></td><td></td><td></td><td class="num" data-l="' + esc(tx('Balance')) + '" data-testid="stmt-opening">' +
    esc(bkDrCr(r && r.opening_minor, c)) +
    '</td></tr>' +
    rows +
    '<tr><td></td><td><b>' +
    tx('Closing') +
    '</b></td><td></td><td></td><td class="num" data-l="' + esc(tx('Balance')) + '" data-testid="stmt-closing"><b>' +
    esc(bkDrCr(r && r.closing_minor, c)) +
    '</b></td></tr></tbody></table>'
  );
}


/* ══ 2 · RECEIVE / PAY — ONE unit (M27, SPEC-payments §1.1 · §5): the amount, how, the bills table, the band, Record, the outcome ══
   One call (booksPayRecord, M26) posts the payment and settles the bills together; /payments/preview paints the bills table and the
   duplicate band. There is no "Later": "Keep it as an advance" is a switch that says what it does. The words of every warning and of
   the outcome come from the server; this unit paints them. */
var PAY = null;
/**
 * The third argument (every other door calls payOpen(kind, partyId) as before) is ONE of:
 *   a name (string) — the Dues / CB Finance row's own name, for pages that load no party lists (WX-O2C);
 *   pre — BR1's payment advice the Bank page read: { amount_minor, mode, reference, name, bills } (payPrefill);
 *   opt (F4) — { offer, after }: offer = the server's early-pay offer for one bill (GET /dues?side=supplier&finance=1 → payable.early: { words,
 *          pay_minor, record, gst_note, valid }) — its sentence sits under Amount, the amount starts at the server's pay_minor, and after Record the
 *          discount is offered as the owner's journal (record.body, sent as given) beside a GST credit note button the server greys with its sentence.
 *          Nothing here works out a discount. after = called when this form wrote something (a payment, a discount) — CB Finance re-reads its list.
 */
function payOpen(kind, partyId, pre) {
  var r = partyRowOf(kind, partyId) || {};
  /* ⚠️ WX-P2P-10 + WX-O2C (2026-10-13, the real stack): on CB Accounts / Receivables / CB Finance (no supplier / customer list loaded) the sheet
     opened as "Pay ·" / "Receive · " — no name until the preview answered. The row that opened it holds the name: BK.dues (the one dues read), or
     the name the Dues / Finance row hands (a string). A prefill object (bank rec) still carries its own name; the preview's party.name wins later. */
  var d = (BK.dues && BK.dues[partyId]) || {},
    nm = typeof pre === 'string' ? pre : '';
  var o = pre && typeof pre === 'object' && ('offer' in pre || 'after' in pre) ? pre : {},
    offer = o.offer && o.offer.valid ? o.offer : null;
  if (typeof pre === 'string' || o === pre) pre = null;
  PAY = {
    kind: kind,
    partyId: partyId,
    name: r.nickname || r.display_name || d.name || nm || '',
    ref: bkRef(),
    seq: 0,
    ack: [],
    advice: false,
    preview: null,
    offer: offer,
    after: o.after || null
  }; /* one ref per opened form */  /* where-used: out-of-scope the mount is bkDialogMount(n): the host screen's own code plus -U2n, so it cannot be one literal */
  ui.dialog({
    mount: bkDialogMount(3), pop: 'POP090', titleId: 'pay_title', titleTestid: 'pay_title', bodyId: 'pay_body',
    titleText: (kind === 'supplier' ? tx('Pay') : tx('Receive')) + ' · ' + PAY.name,
    bodyStyle: 'display:flex;flex-direction:column;gap:8px',
    body:
      '<label>' +
      tx('Amount') +
      '' +
      bkMoneyInput({ id: 'pay_amt', on: 'payPreviewSoon()', minor: offer ? offer.pay_minor : null, extra: 'required data-required-msg="' + esc(tx('Type the amount')) + '"' }) +
      '</label>' +
      (offer ? '<div data-testid="pay_offer" style="font-size:var(--fs-1);color:var(--grey)">' + esc(offer.words) + '</div>' : '') +
      '<label>' +
      tx('How') +
      '<select data-cbsid="CMP041-S01"' + bkMountAttribute('CMP041') + ' class="inp" id="pay_mode" data-testid="pay_mode" onchange="payModePaint()"><option value="cash">' +
      tx('Cash') +
      '</option>' +
      payModeOpts() +
      '<option value="bank">' +
      tx('Bank') +
      '</option><option value="card">' +
      tx('Card') +
      '</option><option value="cheque">' +
      tx('Cheque') +
      '</option></select></label>' +
      '<label>' +
      tx('Reference') +
      '<input data-cbsid="CMP040-I01"' + bkMountAttribute('CMP040') + ' class="inp" id="pay_ref" data-testid="pay_ref" style="width:100%"></label>' +
      '<div id="pay_chq" hidden style="gap:6px"><input data-cbsid="CMP040-I01"' + bkMountAttribute('CMP040') + ' class="inp" id="pay_chqno" data-testid="pay_chqno" placeholder="' +
      esc(tx('Cheque no')) +
      '"><input data-cbsid="CMP040-I01"' + bkMountAttribute('CMP040') + ' class="inp" id="pay_bank" placeholder="' +
      esc(tx('Bank')) +
      '"><input data-cbsid="CMP040-I02"' + bkMountAttribute('CMP040') + ' class="inp" id="pay_chqdate" type="date"></div>' +
      '<div style="display:flex;gap:8px;align-items:center"><input data-cbsid="CMP040-I03"' + bkMountAttribute('CMP040') + ' type="checkbox" id="pay_adv" data-testid="pay_adv" onchange="payAdvToggle()"><label for="pay_adv" style="display:inline;margin:0">' +
      tx('Keep as advance') +
      '</label></div>' +
      '<div id="pay_band" data-testid="pay_band" role="alert" hidden class="payband" style="border:1px solid var(--warn-2);border-radius:6px;padding:8px;font-size:var(--fs-1)"></div>' +
      '<div data-testid="pay_left" id="pay_left" style="font-size:var(--fs-1)"></div>' +
      '<div id="pay_bills" data-testid="pay_bills"></div>' +
      '<div id="pay_why" data-testid="pay_why" style="color:var(--warn-2);font-size:var(--fs-1)"></div>' +
      '',
    footId: 'pay_foot', footerHtml: '<button data-cbsid="CMP003-B01"' + bkMountAttribute('CMP003') + ' onclick="closeModal()">' +
      tx('Cancel') +
      '</button><button data-cbsid="CMP042-B02"' + bkMountAttribute('CMP042') + bkTapAttribute() + ' class="pri" data-testid="pay_record" data-sheet-save onclick="payRecord()">' +
      tx('Record') +
      '</button>' +
      (kind === 'supplier' ? '' : '<button data-cbsid="CMP042-B03"' + bkMountAttribute('CMP042') + bkTapAttribute() + ' data-testid="pay_remind" onclick="payRemind()">' + tx('Not paid yet — remind me') + '</button>')
  });
  payPaint();
  payOpenFill(kind, d, pre, offer);
}
/** after the first paint: a given prefill, else the dues figure the list already carries (opens FILLED, Bank first, the bills table at once), else the offered amount's bills */
function payOpenFill(kind, due, pre, offer) {
  var fill = pre || (offer ? null : payOpenTotal(kind, due));
  if (fill) payPrefill(fill);
  else if (offer) payPreviewSoon(0); /* F4: the amount came filled in: read its bills now */
}
/** the open total of a party as the ONE dues read carries it (BK.dues balance_minor — never recomputed): Receive needs it owed to us, Pay owed by us; else null (nothing to prefill) */
function payOpenTotal(kind, due) {
  var minor = Number((due && due.balance_minor) || 0);
  return (kind === 'supplier' ? minor < 0 : minor > 0) ? { amount_minor: Math.abs(minor), mode: 'bank' } : null;
}
/**
 * BR1 · a payment the OTHER PARTY already told us about (their payment advice chit, read by the Bank page): the amount, How (the statement's
 * own ledger), their reference and the bills the chit settles are placed — the person still presses Record, and the ONE books writer
 * (POST /payments) decides. pre = { amount_minor, mode, reference, name, bills: [{ ref_chit_id, applied_minor }] }
 */
function payPrefill(pre) {
  PAY.pre = pre;
  if (!PAY.name && pre.name) {
    PAY.name = pre.name;
    var node = document.getElementById('pay_title');
    if (node) node.textContent = (PAY.kind === 'supplier' ? tx('Pay') : tx('Receive')) + ' · ' + PAY.name;
  }
  var a = document.getElementById('pay_amt');
  if (a && pre.amount_minor > 0) a.value = bkMinorText(pre.amount_minor);
  var m = document.getElementById('pay_mode');
  if (m && pre.mode) {
    m.value = pre.mode;
    payModePaint();
  }
  var f = document.getElementById('pay_ref');
  if (f && pre.reference) f.value = pre.reference;
  payPreviewSoon(0);
}
/** the bills the advice names take the amounts it names; the others 0 — only when the advice's bills are among the open ones (else the server's proposal stands) */
function payPreBills(r) {
  var bills = (PAY.pre && PAY.pre.bills) || [],
    rows = (r && r.proposal) || [];
  if (
    !bills.length ||
    !rows.some(function (item) {
      return bills.some(function (b) {
        return b.ref_chit_id === item.against_ref;
      });
    })
  )
    return;
  rows.forEach(function (item) {
    var b = bills.filter(function (x) {
      return x.ref_chit_id === item.against_ref;
    })[0];
    item.apply_minor = b ? Math.min(b.applied_minor != null ? b.applied_minor : item.open_minor, item.open_minor) : 0;
  });
}
/** F4: the early-pay step under the Pay outcome — the owner's journal (the server's ready body, one client_ref) and the GST credit note the server greys */
function payDiscHTML(f) {
  var rec = f.record || { ok: false },
    gst = f.gst_note || { ok: false };
  return (
    '<div data-testid="pay_disc" style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line,#e6dcc6);padding-top:8px">' +
    '<span data-testid="pay_disc_words">' +
    esc(f.words) +
    '</span>' +
    '<span style="display:flex;gap:8px;flex-wrap:wrap"><button data-cbsid="CMP042-B24"' + bkMountAttribute('CMP042') + bkTapAttribute() + ' type="button" class="pri" data-testid="pay_disc_record" onclick="payDiscRecord(this)"' +
    (rec.ok ? '' : ' disabled aria-disabled="true"') +
    '>' +
    esc(tx('Record discount')) +
    '</button>' +
    '<button data-cbsid="CMP042-B22"' + bkMountAttribute('CMP042') + bkTapAttribute() + ' type="button" data-testid="pay_gst_note" disabled aria-disabled="true">' +
    esc(tx('GST credit note')) +
    '</button></span>' +
    (rec.ok ? '' : '<span class="hint" data-testid="pay_disc_why_not">' + esc(rec.say || '') + '</span>') +
    '<span class="hint" data-testid="pay_gst_why">' +
    esc(gst.say || '') +
    '</span>' +
    '<span id="pay_disc_out" data-testid="pay_disc_out" class="hint"></span></div>'
  );
}
/* record the early-pay discount the server offered, as its ready entry body */
function payDiscRecord(btn) {
  var f = PAY && PAY.offer;
  if (!f || !f.record || !f.record.ok) return;
  return CBAction.run(
    btn,
    function () {
      return api('booksEntryPost', { body: Object.assign({ date: bkToday() }, f.record.body) });
    },
    {
      key: 'pay-disc:' + f.record.body.client_ref,
      out: 'pay_disc_out',
      failed: tx('Could not record the discount'),
      /* the outcome where it happened: the button becomes the fact (a second press would only replay the same client_ref) */
      outcome: function (r) {
        var node = document.createElement('span');
        node.className = 'tag green';
        node.setAttribute('data-testid', 'pay_disc_done');
        node.textContent = '✓ ' + tx('Discount recorded') + (r && r.entry_no ? ' · ' + r.entry_no : '');
        btn.replaceWith(node);
        if (PAY && PAY.after) PAY.after();
      }
    }
  );
}
/** "Not paid yet — remind me" (SPEC-payments D3): nothing posts; it is the Remind of the Dues row — a message on the oldest open bill */
function payRemind() {
  if (!PAY) return;
  var id = PAY.partyId;
  closeModal();
  return bkRemind(id, null);
}
function payDirection() {
  return PAY.kind === 'supplier' ? 'out' : 'in';
}
function payMode() {
  return (document.getElementById('pay_mode') || {}).value;
}
function payModePaint() {
  var node = document.getElementById('pay_chq'),
    on = payMode() === 'cheque';
  if (node) {
    node.hidden = !on;
    node.style.display = on ? 'flex' : '';
  }
  payPaint();
}
function payAdvToggle() {
  PAY.advice = !!(document.getElementById('pay_adv') || {}).checked;
  PAY.ack = [];
  payPreviewSoon(0);
}
/**
 * ⭐⭐ THE ONE PLACE W1's TRIGGER LIVES (owner, 2026-10-08: W1 "nothing owed" fires ONLY when the payment carries an allocation — bills
 * chosen). The server asks the same question of the same body (lib/books.js duplicateWarnings: `allocating`), so what this returns
 * is what makes W1 fire or stay silent. Change it here, and only here.
 *   · "Keep it as an advance" on, or a cheque (it settles nothing until it clears) → allocate: 'none'   — no bills meant, no W1
 *   · bills on screen and every one set to 0                                        → allocate: 'none'   — an advance on purpose
 *   · otherwise                                                                      → allocate: 'oldest_first' (+ the ticked list, once recorded)
 */
function payIntent(forRecord) {
  if (PAY.advice || payMode() === 'cheque') return { allocate: 'none' };
  var shown = PAY.preview && PAY.preview.proposal && PAY.preview.proposal.length,
    rows = forRecord
      ? payAllocs().filter(function (x) {
          return x.amount_minor > 0;
        })
      : [];
  if (forRecord && shown && !rows.length) return { allocate: 'none' };
  var o = { allocate: 'oldest_first' };
  if (rows.length)
    o.allocations = rows.map(function (x) {
      return { against_ref: x.against_ref, amount_minor: x.amount_minor };
    });
  return o;
}
var payTimer = null;
function payPreviewSoon(ms) {
  clearTimeout(payTimer);
  payTimer = setTimeout(payPreview, ms == null ? 300 : ms);
}
/** W15-96: a payment OUT asks the server to check the bills' holds too; a receipt does not */
function payChecksAsked() {
  return payDirection() === 'out' ? true : undefined;
}
/** the bills table, the line under it and the band all come from ONE read: /payments/preview (no write) */
async function payPreview() {
  if (!PAY || PAY.done) return;
  var amt = bkMoneyRead('pay_amt');
  if (!(amt > 0)) {
    PAY.preview = null;
    PAY.ack = [];
    payPaint();
    return;
  }
  if (PAY.reading) {
    PAY.again = true;
    return;
  }
  PAY.reading = true;
  var n = ++PAY.seq,
    p = PAY;
  try {
    var q = payIntent(false),
      reply = await api('booksPayPreview', {
        body: { party_id: PAY.partyId, direction: payDirection(), amount_minor: amt, currency: bkCur(), allocate: q.allocate, checks: payChecksAsked() } /* W15-96: the bills' holds and tax-invoice flags ride with the bills */
      });
    if (PAY === p && n === PAY.seq) {
      PAY.preview = reply;
      PAY.ack = [];
      PAY.amount = amt;
      payPreBills(reply);
      /* a door that does not hold the party's list (the CRM record) learns the name from the server's own answer */
      if (!PAY.name && reply.party && reply.party.name) {
        PAY.name = reply.party.name;
        var node = document.getElementById('pay_title');
        if (node) node.textContent = (PAY.kind === 'supplier' ? tx('Pay') : tx('Receive')) + ' · ' + PAY.name;
      }
      var w = document.getElementById('pay_why');
      if (w) w.textContent = '';
      payPaint();
    }
  } catch (e) {
    if (PAY === p) {
      var w2 = document.getElementById('pay_why');
      if (w2) w2.textContent = bkWhy(e, tx('Could not read the bills'));
    }
  }
  if (PAY === p) {
    PAY.reading = false;
    if (PAY.again) {
      PAY.again = false;
      payPreview();
    }
  }
}
/** the acknowledgements sent: each code with the FIGURE the warning showed ({ code, over_minor }) when it carries one, else the bare code (FIN-53: a stale figure is asked again by the server) */
function payAckList(codes, warnings) {
  return (codes || []).map(function (code) {
    var shown = (warnings || []).find(function (item) {
      return item.code === code && item.over_minor != null;
    });
    return shown ? { code: code, over_minor: shown.over_minor } : code;
  });
}
function payOpenWarnings() {
  return ((PAY.preview && PAY.preview.warnings) || []).filter(function (item) {
    return PAY.ack.indexOf(item.code) < 0;
  });
}
/** the band under the bills: the warnings in the server's words and the yes/no that answers them (empty when there is nothing to say) */
function payBandPaint(band, list) {
  if (band) {
    band.hidden = !list.length;
    /* ⚠️ WX-P2P-11 (2026-10-13, the real stack): the band's yes said "Pay as advance" for EVERY warning — a second genuine payment to the same
       supplier today ("the last bill was settled by PY/… today", the duplicate rule) offered only an advance, though pressing it applies the bills
       on screen exactly as Record would. The words follow the warning: an advance only when nothing is owed / too much is paid. */
    var asAdvance = list.some(function (item) {
      return item.code === 'nothing_owed' || item.code === 'excess';
    });
    band.innerHTML = !list.length
      ? ''
      : '<div data-testid="pay_band_words">' +
        list
          .map(function (item) {
            return esc(item.words);
          })
          .join(' ') +
        (asAdvance
          ? ' ' + esc(txf(PAY.kind === 'supplier' ? 'Pay {amt} again as an advance?' : 'Receive {amt} again as an advance?', { amt: bkMoney(PAY.amount) }))
          : '') +
        '</div><div style="display:flex;gap:8px;margin-top:6px"><button data-cbsid="CMP042-B25"' + bkMountAttribute('CMP042') + bkTapAttribute() + ' class="pri" data-testid="pay_ack" onclick="payRecord(true)">' +
        esc(
          asAdvance
            ? PAY.kind === 'supplier'
              ? tx('Pay as advance')
              : tx('Receive as advance')
            : PAY.kind === 'supplier'
              ? tx('Pay anyway')
              : tx('Receive anyway')
        ) +
        '</button>' +
        '<button data-cbsid="CMP003-B01"' + bkMountAttribute('CMP003') + ' data-testid="pay_band_cancel" onclick="closeModal()">' +
        tx('Cancel') +
        '</button></div>';
  }
}
/** paints the three things the preview decides: the bills table, the where-the-money-goes line, the band (and whether Record may be pressed) */
function payPaint() {
  var pv = PAY.preview,
    rows = (pv && pv.proposal) || [],
    bills = document.getElementById('pay_bills'),
    band = document.getElementById('pay_band'),
    rec = document.querySelector('[data-testid="pay_record"]');
  var cheque = payMode() === 'cheque',
    hide = PAY.advice || cheque || !rows.length;
  if (bills)
    bills.innerHTML = hide
      ? ''
      : '<div style="font-size:var(--fs-1);color:var(--grey)">' +
        tx('Oldest bill first. Edit any amount') +
        '</div>' +
        '<table class="bktab" style="width:100%;font-size:var(--fs-1)"><thead><tr><th>' +
        tx('Bill') +
        '</th><th>' +
        tx('Due') +
        '</th><th class="num">' +
        tx('Open') +
        '</th><th class="num">' +
        tx('Apply') +
        '</th></tr></thead><tbody>' +
        rows
          .map(function (item, index) {
            return (
              '<tr data-testid="alloc-row-' +
              index +
              '"><td class="mono">' +
              esc(bkBillNo(item.bill_no, item.against_ref, item.date || item.due_date)) +
              (item.disputed ? ' <span class="optchip" style="color:var(--warn-2)">' + tx('In dispute') + '</span>' : '') +
              bkBillFlags(item) +
              '</td><td>' +
              esc(bkDate(item.due_date)) +
              '</td><td class="num">' +
              (item.open_minor == null ? '<span class="sub" data-testid="alloc-hidden-' + index + '">' + esc(tx('hidden')) + '</span>' : esc(bkMoney(item.open_minor))) /* ⭐ RAIL-146n: the server sent cost_hidden — the bill's figure is not this login's to see; the cell says so, never ₹0 */ +
              '</td>' +
              '<td class="num">' +
              bkMoneyInput({
                id: 'alloc_' + index,
                tid: 'alloc-' + index,
                minor: item.apply_minor || null,
                ph: '',
                w: 'min(150px,30vw)',
                on: 'payLeftPaint()',
                extra: item.disputed ? 'disabled title="' + esc(tx('In dispute · settle it first')) + '"' : ''
              }) +
              '</td></tr>'
            );
          })
          .join('') +
        '</tbody></table></div>';
  payLeftPaint();
  var list = payOpenWarnings();
  if (band) payBandPaint(band, list);
  /* nothing records until a button IN the band is pressed */
  if (rec && !PAY.done) rec.disabled = !!list.length;
}
function payAllocs() {
  if (PAY.advice || payMode() === 'cheque') return [];
  return ((PAY.preview && PAY.preview.proposal) || []).map(function (item, index) {
    var node = (document.getElementById('alloc_' + index) || {}).value;
    var m = node === '' || node == null ? 0 : bkMoneyMinor(node);
    return { against_ref: item.against_ref, amount_minor: m, disputed: !!item.disputed, open_minor: item.open_minor };
  });
}
/** the line under the table — says where the money goes, and follows every edit */
function payLeftPaint() {
  var box = document.getElementById('pay_left');
  if (!box) return;
  var amt = bkMoneyRead('pay_amt'),
    pv = PAY.preview;
  if (!(amt > 0)) {
    box.textContent = tx('Type the amount');
    box.style.color = 'var(--grey)';
    return;
  }
  if (payMode() === 'cheque') {
    box.textContent = tx('Counts against bills when the cheque clears');
    box.style.color = 'var(--grey)';
    return;
  }
  var list = payAllocs(),
    used = list.reduce(function (total, x) {
      return total + (x.amount_minor > 0 ? x.amount_minor : 0);
    }, 0),
    n = list.filter(function (x) {
      return x.amount_minor > 0;
    }).length,
    left = amt - used,
    parts = [];
  if (n) parts.push(txn('{amt} settles {count} bill', '{amt} settles {count} bills', n, { amt: bkMoney(used) }));
  if (left > 0)
    parts.push(
      txf(PAY.kind === 'supplier' ? '{amt} stays with {name} as an advance' : '{amt} is kept as an advance from {name}', { amt: bkMoney(left), name: PAY.name })
    );
  if (left < 0) parts.push(txf('{amt} too much', { amt: bkMoney(Math.abs(left)) }));
  box.textContent = parts.length ? parts.join(' · ') : (pv && pv.words) || '';
  box.style.color = left < 0 ? 'var(--warn-2)' : 'var(--grey)';
}
/** Record (viaBand = true: the band's "Pay as advance", which is what acknowledges the warnings). One call; the outcome replaces the form.
 *  R102b (walk 24 Oct): a payment is a money promise — Record asks first (payAsk); the band's own button already names who and how much, so it does not ask twice. */
function payRecord(viaBand) {
  /* ⚠️ M11/M64: through CBAction — one press one call; every attempt from this form carries the SAME client_ref; the outcome is said
     in the form (pay_why), never a thrown error's text */
  if (!PAY || PAY.done || PAY.asking || PAY.writing) return; /* one question, one write: a press while either is up does nothing */
  var node = document.getElementById('pay_why'),
    amt = bkMoneyRead('pay_amt');
  if (!(amt > 0)) {
    if (node) node.textContent = tx('Type the amount');
    return;
  }
  var open = payOpenWarnings();
  if (open.length && viaBand !== true) return; /* the band is up: only its own buttons record */
  var refused = payRefusal(payAllocs(), amt);
  if (refused) {
    if (node) node.textContent = refused;
    return;
  }
  var ack =
    viaBand === true
      ? open.map(function (item) {
          return item.code;
        })
      : PAY.ack;
  if (viaBand === true) return payWrite(amt, ack, true);
  PAY.asking = true;
  return payAsk(amt).then(function (yes) {
    PAY.asking = false;
    if (yes === true) return payWrite(amt, ack, false);
    if (node) node.textContent = yes === null ? tx('Nothing sent. This page cannot ask first.') : '';
  });
}
/** the same refusals the engine makes (check), said before the round trip — the server still decides. The sentence, or null when nothing is refused */
function payRefusal(allocations, amount) {
  var bad = allocations.filter(function (x) {
    return x.amount_minor < 0 || !isFinite(x.amount_minor) || x.amount_minor > x.open_minor || (x.disputed && x.amount_minor > 0);
  })[0];
  var used = allocations.reduce(function (total, x) {
    return total + (x.amount_minor > 0 ? x.amount_minor : 0);
  }, 0);
  if (bad) return bad.disputed ? tx('A disputed bill takes nothing') : tx('More than that bill has open');
  if (used > amount) return tx('More applied than paid');
  return null;
}
/** W15-96: the bills this payment would settle that the auditor has put on hold — [{ no, by, note }] (the proposal rows' mark, the Day book's own); none when nothing is held */
function payHeldBills() {
  var rows = (PAY.preview && PAY.preview.proposal) || [];
  return payAllocs()
    .filter(function (alloc) {
      return alloc.amount_minor > 0;
    })
    .map(function (alloc) {
      return (
        rows.filter(function (row) {
          return row.against_ref === alloc.against_ref;
        })[0] || null
      );
    })
    .filter(function (row) {
      return row && row.mark && (row.mark.class === 'hold' || row.mark.kind === 'on_hold');
    })
    .map(function (row) {
      return { no: bkBillNo(row.bill_no, row.against_ref, row.date || row.due_date), by: row.mark.by_name || '', note: row.mark.note || '' };
    });
}
/** the ask, in the screen's own words: who, how much, how (the How select's word) — through CBConfirm, the stacked <dialog> every utility page
 *  aliases confirmAsk to; on app.html confirmAsk paints into #modalhost, the host this sheet is in, so CBAction.ask there would replace the
 *  form before the write. true = yes · false = cancel · null = no dialog on this page (nothing is sent, and the form says so) */
function payAsk(amount) {
  if (typeof CBConfirm !== 'function') {
    if (typeof cblog === 'function') cblog('error', 'payAsk: no confirm dialog on this page — nothing sent');
    return Promise.resolve(null);
  }
  var modeSelect = document.getElementById('pay_mode'),
    howWord = modeSelect && modeSelect.selectedIndex >= 0 ? modeSelect.options[modeSelect.selectedIndex].text : '',
    out = PAY.kind === 'supplier',
    words = { name: PAY.name, amt: bkMoney(amount), how: howWord === howWord.toUpperCase() ? howWord : howWord.toLowerCase() };
  var title = out
    ? howWord
      ? txf('Pay {name} {amt} by {how}?', words)
      : txf('Pay {name} {amt}?', words)
    : howWord
      ? txf('Record {amt} from {name} by {how}?', words)
      : txf('Record {amt} from {name}?', words);
  var held = payHeldBills(),
    heldWords = held
      .map(function (item) {
        return txf('{no} is on hold', { no: item.no }) + (item.by ? ' ' + txf('(marked by {who})', { who: item.by }) : '') + (item.note ? ': ' + item.note : '') + '.';
      })
      .join(' ');
  if (held.length) title = txf('A bill is on hold. Pay {name} {amt} anyway?', words);
  return new Promise(function (res) {
    CBConfirm(
      title,
      (held.length ? '<div data-testid="pay_hold_words" style="color:var(--warn-2);font-weight:700;margin-bottom:6px">' + esc(heldWords) + '</div>' : '') +
        esc(tx(out ? 'Your books will show it paid.' : 'Your books will show it received.')),
      tx(out ? 'Pay' : 'Record'),
      function () {
        res(true);
      },
      false,
      function () {
        res(false);
      }
    );
  });
}
/** the ONE write: POST /payments through CBAction (busy · one call per press · the outcome painted in the form); PAY.writing holds a second press off while it is out */
function payWrite(amount, acknowledged, viaBand) {
  PAY.writing = true;
  return CBAction.run(
    document.querySelector('[data-testid="' + (viaBand === true ? 'pay_ack' : 'pay_record') + '"]'),
    async function () {
      var mode = payMode(),
        q = payIntent(true);
      var body = {
        party_id: PAY.partyId,
        direction: payDirection(),
        amount_minor: amount,
        currency: bkCur(),
        mode: mode,
        reference: (document.getElementById('pay_ref') || {}).value || null,
        received_at: new Date().toISOString(),
        allocate: q.allocate,
        client_ref: PAY.ref,
        cheque:
          mode === 'cheque'
            ? {
                number: (document.getElementById('pay_chqno') || {}).value || null,
                bank: (document.getElementById('pay_bank') || {}).value || null,
                date: (document.getElementById('pay_chqdate') || {}).value || null
              }
            : null
      };
      if (q.allocations) body.allocations = q.allocations;
      if (acknowledged.length) body.acknowledge = payAckList(acknowledged, PAY.preview && PAY.preview.warnings);
      var reply = await api('booksPayRecord', { body: body });
      PAY.amount = amount;
      return reply;
    },
    {
      key: 'pay',
      out: 'pay_why',
      failed: tx('Could not record it'),
      /* the server asked "Already paid?" (a warning the preview did not have): nothing was written — the band takes its words */
      onFail: function (w, e) {
        if (e && e.status === 409 && e.data && e.data.warnings && e.data.warnings.length) {
          PAY.preview = Object.assign({}, PAY.preview || {}, { warnings: e.data.warnings });
          PAY.ack = [];
          payPaint();
          return;
        }
        var el = document.getElementById('pay_why');
        if (el) el.textContent = w;
      },
      outcome: payOutcomePaint
    }
  ).finally(function () {
    if (PAY) PAY.writing = false;
  });
}
/** RAIL-146n: the one line the outcome adds when the server answered cost_hidden (a co-assist without can_see_costs paying a supplier) */
function payHiddenNote(hidden) {
  return hidden ? '<p data-testid="pay_hidden" style="margin:0;color:var(--grey)">' + esc(tx('Amounts hidden')) + '</p>' : '';
}
/** the outcome IS the form's next state: what happened · what it means (the bills named, the balance) · Done */
function payOutcomePaint(r) {
  var node = document.getElementById('pay_body'),
    pf = document.getElementById('pay_foot');
  if (!node || !pf || !r || !r.payment) return;
  PAY.done = true;
  PAY.id = r.payment.payment_id;
  var o = r.outcome || {},
    bills = (o.settled || []).map(function (item) {
      return item.bill_no || item.against_ref;
    }),
    cheque = r.payment.status === 'cheque_received',
    html = '';
  if (cheque) {
    /* ⭐ C3: a cheque counts on CLEARING — nothing to match yet; its steps are offered right here */
    bkChequeKeep({
      payment_id: PAY.id,
      party_id: PAY.partyId,
      name: PAY.name,
      amount_minor: PAY.amount,
      cheque_no: (document.getElementById('pay_chqno') || {}).value || null,
      cheque_bank: (document.getElementById('pay_bank') || {}).value || null,
      cheque_date: (document.getElementById('pay_chqdate') || {}).value || null,
      status: 'received'
    });
  }
  html +=
    '<p data-testid="pay_outcome" style="margin:0;font-weight:600">' + esc(o.words || (r.payment.duplicate ? tx('Already recorded') : tx('Recorded'))) + '</p>' + payHiddenNote(r.cost_hidden); /* ⭐ RAIL-146n: figures left out for a co-assist who may not see cost */
  if (bills.length) html += '<p data-testid="pay_settled" style="margin:0">' + esc(txf('Settled: {bills}', { bills: bills.join(', ') })) + '</p>';
  if (o.balance_minor != null)
    html +=
      '<p data-testid="pay_balance" style="margin:0;color:var(--grey)">' +
      esc(txf('Balance: {bal}', { bal: bkOwes(o.balance_minor) })) +
      (r.posted && r.posted.entry_no ? ' · <span class="mono">' + esc(r.posted.entry_no) + '</span>' : '') +
      '</p>';
  if (cheque)
    html +=
      '<div id="pay_chq_steps" data-testid="pay_chq_steps">' +
      bkChequeStepsHTML(BK.cheques[PAY.id]) +
      '</div><div id="chq_out" data-testid="chq_out" style="color:var(--warn-2);font-size:var(--fs-1)"></div>';
  /* M30: the advice line — "Advice sent to Tally Test ✓" / "Ravi Stores is not on ChitBridge — share the advice" — the unit, from the block the record answered (no second read) */
  if (r.advice) html += '<div id="pay_advice" data-testid="pay_advice"></div>';
  node.innerHTML = html;
  if (r.advice && typeof CBAdvice !== 'undefined')
    CBAdvice.mount(document.getElementById('pay_advice'), {
      payment_id: PAY.id,
      advice: r.advice,
      party: PAY.name,
      context: { host: typeof ACC !== 'undefined' ? 'accounts' : 'crm' },
      onDone: function (res) {
        bkAdviceFlip(PAY.id, res, null);
      }
    });
  if (PAY.offer) node.insertAdjacentHTML('beforeend', payDiscHTML(PAY.offer)); /* F4: the discount is the owner's next step, never automatic */
  pf.innerHTML = '<button data-cbsid="CMP004-B01"' + bkMountAttribute('CMP004') + ' class="pri" data-testid="pay_done" onclick="closeModal()">' + tx('Done') + '</button>';
  booksAfterPay(r);
  if (PAY.after) PAY.after(); /* the statement, the dues chip and the record's header repaint now, behind the outcome */
}
/* after a payment is recorded: drop the stale statement, repaint the balance and chip from the answer */
function booksAfterPay(r) {
  var pid = PAY && PAY.partyId;
  if (PAY) {
    delete BK.stmt[PAY.partyId];
    delete BK.owed[PAY.partyId];
  }
  /* M30-1c: repaint LOCALLY from the answer - the balance the record just returned is the party's balance now (same sign as the dues read: + they owe you) */
  try {
    var o = r && r.outcome;
    if (pid && o && o.balance_minor != null) {
      BK.dues = BK.dues || {};
      BK.dues[pid] = Object.assign({}, BK.dues[pid], { balance_minor: o.balance_minor });
    }
  } catch (failure) {
    bkQuiet('pay-balance', failure);
  }
  try {
    if (pid && typeof crmLedgerRepaint === 'function') crmLedgerRepaint(pid);
  } catch (failure) {
    bkQuiet('pay-crm-repaint', failure);
  }
  booksDuesLoad(true).then(function () {
    try {
      if (PAY && PAY.kind === 'supplier') {
        if (typeof paintSupSlide === 'function') paintSupSlide();
      } else if (typeof paintCustDetail === 'function') paintCustDetail();
    } catch (failure) {
      bkQuiet('pay-repaint', failure);
    }
  });
}

/* ══ 3 · THE LEDGER SCREEN — the house layout: a list of views on the left, the view on the right ═════════════ */
var BK_TABS = [
  ['daybook', '📖', 'Day book'],
  ['ledgers', '📒', 'Ledgers'],
  ['tb', '⚖️', 'Trial balance'],
  ['pl', '📈', 'P&L'],
  ['bs', '🏛️', 'Balance sheet'],
  ['dues', '⏳', 'Dues'],
  ['cheques', '🧾', 'Cheques'],
  ['waiting', '🕗', 'Waiting'],
  ['lock', '🔒', 'Month lock'],
  ['packs', '📦', 'Packs'],
  ['opening', '📥', 'Opening balances'],
  ['accounts', '🗂️', 'Shop ledgers']
];
/* the Ledger screen: the tab list on the left, the open tab's body on the right */
function ledgerScreen() {
  var list =
    '<div class="list"><div class="lh"><div style="font-family:\'Space Grotesk\';font-weight:700;font-size:var(--fs-3)">📒 ' +
    tx('Ledger') +
    '</div></div><div class="rows" id="bk_tabs">' +
    BK_TABS.map(function (item) {
      return (
        '<div data-cbsid="CMP043-K01"' + bkMountAttribute('CMP043') + ' class="row ' +
        (BK.tab === item[0] ? 'sel' : '') +
        '" data-testid="bk-tab-' +
        item[0] +
        '" onclick="bkTab(\'' +
        item[0] +
        '\')"><div class="main2"><div class="l1"><span class="code">' +
        item[1] +
        ' ' +
        tx(item[2]) +
        '</span></div></div><div class="rowgo" aria-hidden="true">›</div></div>'
      );
    }).join('') +
    '</div></div>';
  var divider =
    '<div class="divider" id="divider" onmousedown="startDrag(event)" ontouchstart="startDrag(event)" role="separator" aria-label="Resize panes"><span class="grip"></span></div>';
  setTimeout(function () {
    bkTab(BK.tab, true);
    if (BK.tab !== 'waiting' && BK.tab !== 'cheques') bkHealthLoad().catch(function (failure) {
      bkQuiet('health-load', failure);
    });
  }, 0); /* the Waiting count, on the list itself */
  return (
    '<div class="panel" id="panel" style="--lw:' +
    UI.lw +
    'px">' +
    list +
    divider +
    '<div class="detail" id="detailpane"><div id="bk_back"><button data-cbsid="CMP006-B01"' + bkMountAttribute('CMP006') + ' class="supback" data-testid="bk-back" onclick="bkBack()">‹ ' +
    tx('Ledger') +
    '</button></div><div class="db" tabindex="0" role="region" aria-label="' + esc(tx('Ledger details')) + '" id="bk_body" data-testid="bk-body">' +
    tx('Reading…') +
    '</div></div></div>'
  );
}
function bkBack() {
  UI.mdetail = false;
  var node = document.getElementById('panel');
  if (node) node.classList.remove('showdetail');
}
/** UX-116 R60: a bill sheet opened on one view never stays over another view */
function bkCloseSheetOnMove(next) {
  if (next !== BK.tab && typeof CBSheet !== 'undefined') CBSheet.close();
}
/* open one Ledger tab (day book, ledgers, trial balance and so on), telling a host page which tab opened */
function bkTab(t, silent) {
  bkCloseSheetOnMove(t);
  BK.tab = t;
  /* ⭐ a host page that is not the app's Ledger screen (accounts.html — CB Accounts) paints its own chrome and may own a view:
     BK.onTab(t) is told which tab opened, BK.views[t] replaces a view's painter. Both are absent in the app, so it is unchanged. */
  if (BK.onTab) BK.onTab(t);
  /* on a phone the tapped view replaces the rail (the way selectCust does it — cap-admin's helper may not be loaded) */
  if (!silent && UI.vp === 'mob') {
    UI.mdetail = true;
    var node = document.getElementById('panel');
    if (node) node.classList.add('showdetail');
  }
  var tabs = document.getElementById('bk_tabs');
  if (tabs)
    Array.prototype.forEach.call(tabs.children, function (el) {
      el.classList.toggle('sel', el.getAttribute('data-testid') === 'bk-tab-' + t);
    });
  var body = document.getElementById('bk_body');
  if (!body) return;
  body.innerHTML = '<div class="loadwrap"><span class="spin"></span> ' + tx('Reading…') + '</div>';
  var f =
    (BK.views && BK.views[t]) ||
    {
      daybook: bkDaybook,
      ledgers: bkLedgers,
      tb: bkTB,
      pl: bkPL,
      bs: bkBS,
      dues: bkDues,
      cheques: bkChequesView,
      waiting: bkWaitingView,
      lock: bkLockView,
      packs: bkPacks,
      opening: bkOpeningView,
      accounts: bkAccounts
    }[t];
  if (f) f(body);
}
function bkRange(id) {
  if (id === 'db' && BK.dbp) return { from: BK.dbp.from, to: BK.dbp.to };
  if (id === 'lg' && BK.lgp)
    return { from: BK.lgp.from, to: BK.lgp.to }; /* the Ledgers' period chip (bkLgHead) */ /* the Day book's period chip (bkDbPeriod) */
  var from = (document.getElementById(id + '_from') || {}).value,
    to = (document.getElementById(id + '_to') || {}).value;
  return { from: from || bkFyFrom(), to: to || bkToday() };
}
/* the from / to date pair and its Apply button for one report */
function bkRangeHTML(id, again) {
  var r = bkRange(id);
  return (
    '<div class="supacts" style="display:flex;gap:6px;align-items:center;margin-bottom:9px;flex-wrap:wrap"><input data-cbsid="CMP040-I02"' + bkMountAttribute('CMP040') + ' type="date" class="inp" id="' +
    id +
    '_from" aria-label="' +
    esc(tx('From')) +
    '" value="' +
    r.from +
    '"><span>→</span><input data-cbsid="CMP040-I02"' + bkMountAttribute('CMP040') + ' type="date" class="inp" id="' +
    id +
    '_to" aria-label="' +
    esc(tx('To')) +
    '" value="' +
    r.to +
    '"><button data-cbsid="CMP042-B04"' + bkMountAttribute('CMP042') + ' onclick="' +
    again +
    '">' +
    tx('Show') +
    '</button></div>'
  );
}
/* a report table from its head cells, row HTML and optional foot */
function bkTable(head, rows, foot) {
  return (
    '<table class="bktab" style="width:100%;border-collapse:collapse;font-size:var(--fs-1)"><thead><tr>' +
    head
      .map(function (item) {
        return '<th' + (item.num ? ' class="num"' : '') + '>' + item.t + '</th>';
      })
      .join('') +
    '</tr></thead><tbody>' +
    rows +
    '</tbody>' +
    (foot ? '<tfoot>' + foot + '</tfoot>' : '') +
    '</table>'
  );
}
/** a money figure the server holds in MAJOR units (a chit's frozen total) — through the same formatter the chit sheet uses */
function bkMajor(n, cur) {
  if (n == null || n === '' || isNaN(Number(n))) return '';
  try {
    return fmtMoney(Number(n), cur || bkCur());
  } catch (_) {
    return bkMoney(Math.round(Number(n) * Math.pow(10, bkDec(cur))), cur);
  }
}

/**
 * ⭐ THE DAY'S STRIP (Athi, 2026-10-01: "in the daybook, you should be able to see the total sale in different
 * counters, sellers' pending invoices and so on, so you can act one by one"). ONE function adds up the day's sales;
 * the per-counter row and the by-tender row both read ITS answer — never the entries a second way. A walk-in day
 * entry counts `source.count` bills with its `split`; a per-bill entry counts 1 with its `how` and the entry's own
 * total (the server's lines, summed once — not a second opinion, the same figure the entry already shows).
 */
function bkDaySales(entries, day) {
  var counters = {},
    tenders = {},
    corder = [],
    torder = [],
    hasDay = false;
  (entries || []).forEach(function (e) {
    if (day && String(e.posting_date || '').slice(0, 10) !== day) return;
    var text = e.source;
    if (!text) return;
    if (text.kind === 'day') hasDay = true; /* the counter closed its day — walk-ins are in */
    if (text.kind !== 'day' && text.kind !== 'bill') return; /* sales only: a bill, or a walk-in day */
    var total =
      text.kind === 'day'
        ? (text.split || []).reduce(function (sum, x) {
            return sum + Number(x.amount_minor || 0);
          }, 0)
        : (e.lines || []).reduce(function (sum, item) {
            return sum + Number(item.dr_minor || 0);
          }, 0);
    var bills = text.kind === 'day' ? Number(text.count || 0) : 1;
    var c = text.counter || '—';
    if (!counters[c]) {
      counters[c] = { counter: c, amount_minor: 0, bills: 0 };
      corder.push(c);
    }
    counters[c].amount_minor += total;
    counters[c].bills += bills;
    var add = function (how, amt) {
      if (!tenders[how]) {
        tenders[how] = { how: how, amount_minor: 0 };
        torder.push(how);
      }
      tenders[how].amount_minor += amt;
    };
    if (text.kind === 'day')
      (text.split || []).forEach(function (x) {
        add(x.how, Number(x.amount_minor || 0));
      });
    else if (text.how) add(text.how, total);
  });
  corder.sort();
  return {
    counters: corder.map(function (item) {
      return counters[item];
    }),
    tenders: torder.map(function (item) {
      return tenders[item];
    }),
    day_closed: hasDay
  };
}
/**
 * ⭐ THE TO-DO — what waits on you, one line each, a tap away. Only a count above zero earns a row (SYSTEM rule 1);
 * all quiet collapses into one line. Every count is the server's: /health `todo` (STD1: the one count — bills to accept, one opens its
 * sheet, several open Waiting; suppliers to add; the rest are the ledger's to record), /dues (a
 * customer with money past its due date: follow_up.worst), /cheques (a held cheque with a step still open).
 */
function bkTodoCounts(dues, cheques, health) {
  var waiting = (health && health.waiting) || [],
    n = bkWaitN(health);
  var confirm = waiting.filter(function (item) {
    return bkWaitTodo(item) === 'accept';
  });
  var overdue = ((dues && dues.parties) || []).filter(function (item) {
    if (bkDuesSide(item) !== 'rcv') return false;
    return !!(item.follow_up && item.follow_up.worst); /* W15-94: the one ageing — the same word Receivables and Collections show */
  });
  var chq = ((cheques && cheques.cheques) || []).filter(function (x) {
    return bkChequeNext({ status: bkChequeStatus(x.status), next: Array.isArray(x.next) ? x.next : null }).length > 0;
  });
  return {
    accept: n.accept,
    acceptIds: confirm
      .map(function (item) {
        return item.chit_id;
      })
      .filter(Boolean),
    supplier: n.add_supplier,
    overdue: overdue.length,
    cheques: chq.length,
    waiting: n.record
  };
}
/**
 * STD1: what a Waiting row asks of the owner is the row's DATA — `todo` (accept · add_supplier · record), written when the books parked it
 * (api books-hooks park). Never read from the sentence: `reason` is for people, and a copy edit must not change what a screen does.
 */
var BK_TODOS = ['accept', 'add_supplier', 'record'];
function bkWaitTodo(w) {
  return w && BK_TODOS.indexOf(w.todo) >= 0 ? w.todo : 'record';
}
/**
 * STD1 · THE ONE COUNT — /health's `total` and `todo` (api books-store waitingCount: GROUP BY over every open row, never the 50-row page), less
 * the bills this page has just accepted that the server still lists (bkWaitGone). Home's alert and the Accounts card say the same numbers.
 */
function bkWaitN(r) {
  var rows = (r && r.waiting) || [],
    t = (r && r.todo) || null,
    gone = function (w) {
      return !!(BK.gone && BK.gone[w.chit_id]) && bkWaitTodo(w) === 'accept';
    };
  var n = t
    ? { total: Number(r.total) || 0, accept: Number(t.accept) || 0, add_supplier: Number(t.add_supplier) || 0, record: Number(t.record) || 0 }
    : rows.reduce(
        function (a, item) {
          a[bkWaitTodo(item)]++;
          a.total++;
          return a;
        },
        { total: 0, accept: 0, add_supplier: 0, record: 0 }
      ); /* an answer without counts: its rows' own todo */
  var g = rows.filter(gone).length;
  n.accept = Math.max(0, n.accept - g);
  n.total = Math.max(0, n.total - g);
  return n;
}
/**
 * ⭐ THE DAY BOOK, THE WAY A DAY BOOK READS (Athi, 2026-10-01: "expand all, collapse all, search, filter, daily view,
 * weekly view … do we need these many lines per sale? … the gist can be showcased as a summary."). ONE row per entry,
 * its GIST under it — the entry's own lines merged by ledger (GST = 2200–2212 together), each figure a sum of those
 * lines, never recomputed — and the rate-wise lines on a tap. Search, chips, Day / Week / Month heads and the CSV all
 * read the SAME shown list (the unit's); nothing here adds to a figure the server did not send.
 */
var BK_KINDS = ['Sales', 'Receipts', 'Purchases', 'Payments', 'Expenses', 'Returns', 'Other'];
/** the same-ledger lines merged, credit side first (Sales · GST · Debtors); GST = the 2200–2212 lines together */
function bkDvGist(e) {
  var m = {},
    order = [];
  ((e && e.lines) || []).forEach(function (item) {
    var gst = /^22(0\d|1[0-2])$/.test(String(item.code)),
      key = gst ? 'GST' : String(item.code);
    if (!m[key]) {
      m[key] = { name: gst ? 'GST' : item.name, amt: 0, cr: 0 };
      order.push(key);
    }
    m[key].amt += Number(item.dr_minor || 0) + Number(item.cr_minor || 0);
    m[key].cr += Number(item.cr_minor || 0) - Number(item.dr_minor || 0);
  });
  var all = order.map(function (item) {
    return m[item];
  });
  return all
    .filter(function (x) {
      return x.cr > 0;
    })
    .concat(
      all.filter(function (x) {
        return x.cr <= 0;
      })
    );
}
function bkDvTotal(e) {
  return ((e && e.lines) || []).reduce(function (total, item) {
    return total + Number(item.dr_minor || 0);
  }, 0);
}
function bkDvParty(e) {
  var l = dayBookPartyLine(e);
  return l ? bkPartyLabel(l.party_id, l.party_name) : '';
}
function bkDvTenders(e) {
  var text = e && e.source;
  if (!text) return [];
  if (text.kind === 'day' && text.split && text.split.length)
    return text.split.map(function (x) {
      return x.how;
    });
  return text.how ? [text.how] : [];
}
/** the chips' four questions, and what each entry answers to them */
var BK_DV_DIMS = [
  ['kind', 'Kind'],
  ['how', 'Tender'],
  ['counter', 'Counter'],
  ['by', 'Person']
];
function bkDvVals(e, dim) {
  var s = (e && e.source) || {};
  if (dim === 'kind') return [dayBookKind(e)];
  if (dim === 'how') return bkDvTenders(e);
  return s[dim] ? [s[dim]] : [];
}
function bkDvFmt(day, o) {
  try {
    return CBLocale.date(day, o);
  } catch (_) {
    return String(day).slice(0, 10);
  }
}
/** Day = the date · Week = Mon–Sun with the ISO week number · Month = its name */
function bkDvGroupOf(date, mode) {
  var dayKey = String(date || '').slice(0, 10),
    dayStart = new Date(dayKey + 'T00:00:00Z');
  if (mode === 'month') return { key: dayKey.slice(0, 7), label: bkDvFmt(dayKey, { month: 'long', year: 'numeric' }) };
  if (mode === 'week') {
    var monday = new Date(dayStart.getTime() - ((dayStart.getUTCDay() + 6) % 7) * 864e5),
      thursday = new Date(monday.getTime() + 3 * 864e5),
      sunday = new Date(monday.getTime() + 6 * 864e5);
    var isoWeek = Math.ceil(((thursday - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7),
      isoDate = function (x) {
        return x.toISOString().slice(0, 10);
      },
      dateFormat = { day: '2-digit', month: 'short' };
    return { key: isoDate(monday), label: txf('Week {n}', { n: isoWeek }) + ' · ' + bkDvFmt(isoDate(monday), dateFormat) + ' – ' + bkDvFmt(isoDate(sunday), dateFormat) };
  }
  return { key: dayKey, label: bkDvFmt(dayKey, { weekday: 'short', day: '2-digit', month: 'short' }) };
}
/** one CSV cell: a cell that starts like a formula is quoted as text (a plain number, negative too, stays a number), a cell with a comma, quote or line break is wrapped (the one reader: Day book and the bank's BRS) */
function bkCsvCell(v) {
  var text = String(v == null ? '' : v);
  if (/^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
/** hand a CSV text to the person as a file (BOM first so a spreadsheet reads the rupee sign) — the one saver */
function bkSaveCsv(name, text) {
  var blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' });
  var node = document.createElement('a');
  node.href = URL.createObjectURL(blob);
  node.download = name;
  document.body.appendChild(node);
  node.click();
  node.remove();
  setTimeout(function () {
    URL.revokeObjectURL(node.href);
  }, 2000);
}
/** the shown rows as a CSV — client-side, one line per row; a cell that starts like a formula is quoted as text */
function bkDvCsv(list, c) {
  var pow = Math.pow(10, bkDec(c)),
    amt = function (m) {
      return (Number(m || 0) / pow).toFixed(bkDec(c));
    };
  var cell = bkCsvCell;
  var rows = [['date', 'no', 'kind', 'party', 'ref', 'how', 'counter', 'by', 'dr', 'cr', 'gist']];
  list.forEach(function (e) {
    var s = e.source || {},
      cr = (e.lines || []).reduce(function (total, item) {
        return total + Number(item.cr_minor || 0);
      }, 0);
    rows.push([
      String(e.posting_date).slice(0, 10),
      e.entry_no,
      dayBookKind(e),
      bkDvParty(e),
      s.ref || '',
      bkDvTenders(e).join(' · '),
      s.counter || '',
      s.by || '',
      '#' + amt(bkDvTotal(e)),
      '#' + amt(cr),
      bkDvGist(e)
        .map(function (x) {
          return x.name + ' ' + amt(x.amt);
        })
        .join('; ')
    ]);
  });
  return (
    rows
      .map(function (item, index) {
        return item
          .map(function (text) {
            return index && typeof text === 'string' && text.charAt(0) === '#' ? text.slice(1) : cell(text);
          })
          .join(',');
      })
      .join('\r\n') + '\r\n'
  );
}
/** the rows the Day book is showing, in the order shown — what the CSV downloads (the unit hands them over: it holds the filters) */
function bkDvDownload(rows) {
  var d = BK.dv;
  if (!d) return;
  bkSaveCsv('day-book-' + d.range.from + '-' + d.range.to + '.csv', bkDvCsv(rows, d.r.currency));
}
/** what the search looks in: the entry, its bill, its party (by name AND by number — "P0007"), its lines, and its amounts the way they are read */
function bkDvText(e, c) {
  var tot = bkDvTotal(e),
    pow = Math.pow(10, bkDec(c));
  return [e.entry_no, e.source && e.source.ref, e.narration, bkDvParty(e), dayBookKind(e)]
    .concat(
      (e.lines || []).map(function (item) {
        return [item.name, item.party_name, bkPartyLabel(item.party_id, item.party_name)].join(' ');
      }),
      [(tot / pow).toFixed(bkDec(c)), String(Math.floor(tot / pow)), bkMoney(tot, c)],
      bkDvGist(e).map(function (x) {
        return (x.amt / pow).toFixed(bkDec(c));
      })
    )
    .join(' ');
}
/** the group head's words: how many entries, Dr, Cr, Sales and each tender — every figure a sum of the server's own lines (plain text: the unit escapes it) */
function bkDvGroupSummary(entries, c) {
  var dr = 0,
    cr = 0,
    sales = 0;
  entries.forEach(function (e) {
    (e.lines || []).forEach(function (item) {
      dr += Number(item.dr_minor || 0);
      cr += Number(item.cr_minor || 0);
    });
    if (dayBookKind(e) === 'Sales')
      (e.lines || []).forEach(function (item) {
        if (/^4/.test(String(item.code))) sales += Number(item.cr_minor || 0) - Number(item.dr_minor || 0);
      });
  });
  var list = bkDaySales(entries, null).tenders;
  var parts = [txn('{count} entry', '{count} entries', entries.length), tx('Dr') + ' ' + bkMoney(dr, c), tx('Cr') + ' ' + bkMoney(cr, c)];
  if (sales) parts.push(tx('Sales') + ' ' + bkMoney(sales, c));
  list.forEach(function (x) {
    parts.push(tx(x.how) + ' ' + bkMoney(x.amount_minor, c));
  });
  return parts.join(' · ');
}
/** what the Day book says about an entry — one fact a column (Athi, 2026-10-02: date · entry no · kind · party · bill · tender · counter · amount); the unit draws the caret, the header and the widths */
function bkDvCols(c) {
  var dash = '<span style="color:var(--grey)">—</span>';
  var no = function (e) {
    return esc(e.entry_no);
  };
  return [
    {
      key: 'date',
      label: tx('Date'),
      prio: 1,
      sort: 'date',
      w: 96,
      html: true,
      cell: function (e) {
        return '<span class="bkdv-dt">' + esc(bkDvFmt(String(e.posting_date).slice(0, 10), { day: '2-digit', month: 'short' })) + '</span>';
      }
    },
    {
      key: 'no',
      label: tx('Entry'),
      prio: 6,
      sort: 'no',
      w: 150,
      html: true,
      cell: function (e) {
        return '<span class="mono">' + no(e) + '</span>' + bkDvRevChip(e);
      }
    },
    {
      key: 'kind',
      label: tx('Kind'),
      prio: 5,
      sort: 'kind',
      w: 100,
      html: true,
      cell: function (e) {
        return esc(tx(dayBookKind(e)));
      }
    },
    {
      key: 'party',
      label: tx('Party'),
      prio: 3,
      sort: 'party',
      w: 190,
      html: true,
      cell: function (e) {
        return esc(bkDvParty(e)) || dash;
      }
    },
    {
      key: 'bill',
      label: tx('Bill'),
      prio: 4,
      w: 230,
      html: true,
      tid: function (e) {
        return 'db-head-' + e.entry_no;
      },
      cell: function (e) {
        var s = e.source || {},
          t = 'db-src-' + e.entry_no;
        if (s.kind === 'day')
          return (
            esc(tx('Walk-in day')) + (s.count != null ? ' · ' + bkDayBillsLink(s, t) : '')
          ); /* M132: the count opens the bills list, as the statement rows do */
        if (s.ref || s.chit_id) return bkBillPart(s, t) + bkRecordedHTML(e, t) + bkPostedByHTML(e);
        return esc(s.kind === 'receipt' ? tx('Received') : e.narration || e.what || e.event_type || '') + bkRecordedHTML(e, t) + bkPostedByHTML(e) || dash;
      }
    },
    {
      key: 'how',
      label: tx('Tender'),
      prio: 7,
      w: 160,
      html: true,
      cell: function (e) {
        return bkHowPart(e.source, 'db-src-' + e.entry_no, c) || dash;
      }
    },
    {
      key: 'counter',
      label: tx('Counter'),
      prio: 8,
      w: 220,
      html: true,
      cell: function (e) {
        var s = e.source || {},
          cw = s.counter ? esc(counterWord(s.counter)) : '',
          by = bkRungPart(s);
        /* the cashier and the counter are NOT the party: secondary text, never in the Party column */
        return cw + (cw && by ? ' · ' : '') + (by ? '<span style="color:var(--grey)">' + by + '</span>' : '') || dash;
      }
    },
    {
      key: 'amount',
      label: tx('Amount'),
      prio: 2,
      pin: 'end',
      sort: 'amount',
      w: 130,
      html: true,
      cell: function (e) {
        return '<b data-testid="db-total-' + no(e) + '">' + esc(bkMoney(bkDvTotal(e), c)) + '</b>';
      }
    }
  ];
}
/** M174: a reversed entry says "Reversed by <its reversal's number>" - a link to that row - and offers no Reverse button (the action's `when`); the reversal says what it undoes */
function bkDvRevChip(e) {
  if (e.reversed_by)
    return (
      '<div style="font-size:var(--fs-1);color:var(--grey)" data-testid="db-rev-' +
      esc(e.entry_no) +
      '">' +
      esc(tx('Reversed by')) +
      ' <a data-cbsid="CMP044-C03"' + bkMountAttribute('CMP044') + ' href="#" class="mono" data-testid="db-rev-link-' +
      esc(e.entry_no) +
      '" onclick="event.stopPropagation();bkDvGoto(\'' +
      esc(e.reversed_by) +
      '\');return false">' +
      esc(e.reversed_by) +
      '</a></div>'
    );
  return '';
}
/** bring a row of the Day book into view (its reversal, from the chip) - or say it is outside these dates */
function bkDvGoto(no) {
  var node = document.querySelector('#bk_dvlist [data-no="' + String(no).replace(/"/g, '') + '"]');
  if (!node) {
    toast(tx('Not in these dates'));
    return;
  }
  node.scrollIntoView({ block: 'center' });
  if (node.focus) node.focus();
}
/** M175: a reversal repaints the Day book from what the server answered - the original says who reversed it, the mirror row is added - no read of the whole book. true = handled */
function bkDvReversed(id, r) {
  var d = BK.dv;
  if (!d || !d.r || !d.api || BK.tab !== 'daybook') return false;
  var ents = d.r.entries || [],
    o = null;
  ents.forEach(function (e) {
    if (e.entry_id === id) o = e;
  });
  if (!o || !r || !r.entry_no) return false;
  o.reversed_by = r.entry_no;
  o.reversed_by_id = r.entry_id || null;
  var day = String(r.posting_date || '').slice(0, 10);
  if (day && day >= d.range.from && day <= d.range.to)
    ents.push({
      entry_id: r.entry_id,
      entry_no: r.entry_no,
      posting_date: day,
      doc_date: day,
      event_type: 'reversal',
      narration: 'Reversal',
      source_chit_id: null,
      reverses_entry_id: id,
      reversed_by: null,
      reversed_by_id: null,
      source: null,
      lines: (o.lines || []).map(function (item) {
        return Object.assign({}, item, { dr_minor: item.cr_minor, cr_minor: item.dr_minor });
      })
    });
  d.r.count = ents.length;
  d.api.refresh();
  return true;
}
/** its next level: the gist (the lines merged by ledger), then the Dr/Cr lines — each tax and sales line with its rate, as the line carries it */
function bkDvGistHTML(e, c) {
  return bkDvGist(e)
    .map(function (x) {
      return esc(x.name) + ' ' + esc(bkMoney(x.amt, c));
    })
    .join(' · ');
}
function bkDvGistText(e, c) {
  return bkDvGist(e)
    .map(function (x) {
      return x.name + ' ' + bkMoney(x.amt, c);
    })
    .join(' · ');
}
/* the Details cell of one day-book entry: kind, party, the entry's lines with their rate */
function bkDvNext(e, c, lines, noParty, mine) {
  var no = esc(e.entry_no);
  var gist = bkDvGistHTML(e, c);
  /* ⭐ THE RATE (Athi, 2026-10-02): "Output CGST 6%", "Sales @12%" — as the line (the frozen invoice's) carries it, never worked out here */
  var rate = function (l) {
    var r = l.rate != null ? l.rate : l.rate_pct;
    return r != null && r !== '' && !/%/.test(String(l.name)) ? (/^4/.test(String(l.code)) ? ' @' : ' ') + esc(String(r)) + '%' : '';
  };
  var grey = 'color:var(--grey);font-size:var(--fs-1);text-transform:uppercase';
  return (
    '<div data-testid="db-lines-' +
    no +
    '">' +
    (lines ? '' : '<div data-testid="db-gist-' + no + '" style="color:var(--grey);font-size:var(--fs-1);padding:2px 0 4px">' + gist + '</div>') +
    '<div style="' +
    grey +
    '">' +
    CBList.nextRow([esc(tx('Code')) + ' · ' + esc(tx('Ledger')), esc(tx('Debit')), esc(tx('Credit'))], [110, 110]) +
    '</div>' +
    (e.lines || [])
      .map(function (item) {
        var row = CBList.nextRow(
          [
            '<span class="mono">' +
              esc(item.code) +
              '</span> ' +
              esc(item.name) +
              rate(item) +
              (item.party_name && !noParty ? ' · ' + esc(bkPartyLabel(item.party_id, item.party_name)) : ''),
            item.dr_minor ? esc(bkMoney(item.dr_minor, c)) : '',
            item.cr_minor ? esc(bkMoney(item.cr_minor, c)) : ''
          ],
          [110, 110]
        );
        /* the ledger you are in is bold (the Ledgers page passes its code; the Day book passes none) */
        return mine && String(item.code) === String(mine) ? '<div class="lg-me" style="font-weight:700">' + row + '</div>' : row;
      })
      .join('') +
    '</div>'
  );
}
/** the Day book's period: Today · This month · This FY · Custom — applies on pick (no Show button); bkRange('db') reads it */
function bkDbPeriod(preset, custom) {
  var today = bkToday(),
    fy = bkFyFrom();
  if (preset === 'today') return { preset: 'today', from: today, to: today };
  if (preset === 'month') return { preset: 'month', from: today.slice(0, 7) + '-01', to: today };
  if (preset === 'custom' && custom && custom.from && custom.to) return { preset: 'custom', from: custom.from, to: custom.to };
  return { preset: 'fy', from: fy, to: today };
}
/** the period one step back (dir -1) or forward (+1) from the Day book's: a day, a month, a financial year, or the same span of a custom range; never past today. null when there is nowhere to go. */
function bkDbStep(period, dir) {
  var today = bkToday(),
    dayOf = function (text) {
      return new Date(text + 'T00:00:00Z');
    },
    isoOf = function (date) {
      return date.toISOString().slice(0, 10);
    },
    from = dayOf(period.from),
    to = dayOf(period.to),
    first,
    last;
  if (period.preset === 'today') {
    first = last = new Date(to.getTime() + dir * 86400000);
  } else if (period.preset === 'month') {
    first = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + dir, 1));
    last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  } else if (period.preset === 'fy') {
    first = new Date(Date.UTC(from.getUTCFullYear() + dir, from.getUTCMonth(), from.getUTCDate()));
    last = new Date(Date.UTC(first.getUTCFullYear() + 1, first.getUTCMonth(), first.getUTCDate() - 1));
  } else {
    var span = Math.round((to - from) / 86400000) + 1;
    first = new Date(from.getTime() + dir * span * 86400000);
    last = new Date(first.getTime() + (span - 1) * 86400000);
  }
  if (isoOf(first) > today) return null;
  return { preset: period.preset, from: isoOf(first), to: isoOf(last) > today ? today : isoOf(last) };
}
function bkDbPeriodLabel(q, preset) {
  var o = { day: 'numeric', month: 'short' },
    oy = { day: 'numeric', month: 'short', year: 'numeric' };
  return preset === 'today' ? bkDvFmt(q.to, oy) : bkDvFmt(q.from, o) + ' – ' + bkDvFmt(q.to, oy);
}
/**
 * WALK2 W31 (ACC-1): the "not closed yet" notice says WHICH day (the strip's day — not "today" by assumption) and, when the books show it, WHICH
 * counters sold by bill that day (no day is closed, so each is still open). A counter that took only cash leaves no entry until it closes, so it
 * cannot be named from the books — then the day alone is said. When it shows is unchanged (bkDvHead: no walk-in day entry that day).
 */
function bkNoCloseNotice(strip, stripDay) {
  var open = strip.counters
    .map(function (row) {
      return row.counter;
    })
    .filter(function (counter) {
      return counter !== '—';
    });
  return {
    cls: 'warn',
    tid: 'strip-noclose',
    onOpen: function () {
      if (typeof navTo === 'function') navTo('counter');
    },
    text: txf(
      open.length
        ? 'Walk-ins for {day} not closed yet on {counters} — close the day on the counter'
        : 'Walk-ins for {day} not closed yet — close the day on the counter',
      { day: bkDvFmt(stripDay, { day: 'numeric', month: 'short' }), counters: open.join(', ') }
    )
  };
}
/** what waits on you, as notices that open their fix (accept · suppliers to add · overdue · cheques · waiting); a count of 0 says nothing */
function bkDvTodoNotices(todoCounts) {
  var notices = [];
  if (todoCounts.accept)
    notices.push({
      cls: 'warn',
      tid: 'todo-accept',
      text: todoCounts.accept + ' ' + tx(todoCounts.accept === 1 ? 'supplier bill to accept' : 'supplier bills to accept'),
      /* one bill → its sheet over the Day book; several → the Waiting list, whose rows open the sheet. Never Intake. */
      onOpen: function () {
        if (todoCounts.accept === 1 && (todoCounts.acceptIds || []).length === 1) openChitSheet(todoCounts.acceptIds[0]);
        else bkNoticeGo('accept');
      }
    });
  if (todoCounts.supplier)
    notices.push({
      cls: 'warn',
      tid: 'todo-supplier',
      text: txn('{count} supplier to add', '{count} suppliers to add', todoCounts.supplier),
      onOpen: function () {
        bkNoticeGo('supplier');
      }
    });
  if (todoCounts.overdue)
    notices.push({
      cls: 'warn',
      tid: 'todo-overdue',
      text: todoCounts.overdue + ' ' + tx(todoCounts.overdue === 1 ? 'customer overdue' : 'customers overdue'),
      onOpen: function () {
        bkTab('dues');
      }
    });
  if (todoCounts.cheques)
    notices.push({
      cls: 'warn',
      tid: 'todo-cheques',
      text: todoCounts.cheques + ' ' + tx(todoCounts.cheques === 1 ? 'cheque to deposit / clear' : 'cheques to deposit / clear'),
      onOpen: function () {
        bkTab('cheques');
      }
    });
  if (todoCounts.waiting)
    notices.push({
      cls: 'warn',
      tid: 'todo-waiting',
      text: todoCounts.waiting + ' ' + tx('waiting to be recorded'),
      onOpen: function () {
        bkTab('waiting');
      }
    });
  return notices;
}
/** the period stepper (‹ earlier · later ›, the Back / Next stops of the lists) and ＋ Entry (cap-entry.js, loaded by CB Accounts): the one door to a manual entry, in the slot CBList gives the head — the page that loads cap-entry offers it, nobody else */
function bkDvStepSlot(period, dayRange) {
  return function (el) {
    var currentPeriod = { preset: period.preset, from: dayRange.from, to: dayRange.to },
      back = bkDbStep(currentPeriod, -1),
      forward = bkDbStep(currentPeriod, 1),
      step = function (dir, to, tid, word, mark) {
        return '<button data-cbsid="TSK006-B1' + (dir < 0 ? '4' : '5') + '"' + bkMountAttribute('TSK006') + ' type="button" class="cbl-chip" data-testid="' + tid + '" aria-label="' + esc(tx(word)) + '" title="' + esc(tx(word)) + '"' + (to ? '' : ' disabled') + ' style="min-height:44px;min-width:44px">' + mark + '</button>';
      };
    var canAdd = typeof enOpen === 'function' && !(typeof SESSION !== 'undefined' && SESSION && SESSION.role === 'customer');
    el.innerHTML =
      step(-1, back, 'db-step-back', 'Earlier', '‹') + step(1, forward, 'db-step-next', 'Later', '›') +
      (canAdd
        ? '<button data-cbsid="CMP007-B01"' + bkMountAttribute('CMP007') + ' type="button" class="cbl-chip" data-testid="db-add" aria-label="' + esc(tx('New entry')) + '" style="cursor:pointer;min-height:44px;font-weight:700">＋ ' + esc(tx('Entry')) + '</button>'
        : '');
    var stepper = function (to) {
      return function () {
        if (!to) return;
        BK.dbp = to;
        bkTab('daybook', true);
      };
    };
    var buttons = el.querySelectorAll('button');
    buttons[0].onclick = stepper(back);
    buttons[1].onclick = stepper(forward);
    if (canAdd)
      buttons[2].onclick = function () {
        enOpen();
      };
  };
}
/** the head the Day book declares: its period, today's strip (sales per counter and by tender) as chips, and what waits on you as notices that open their fix */
function bkDvHead() {
  var view = BK.dv,
    reply = view.r,
    currency = reply && reply.currency,
    dayRange = view.range,
    todoCounts = view.todo,
    period = BK.dbp || bkDbPeriod('fy');
  var sales = bkDaySales((reply && reply.entries) || [], dayRange.to),
    chips = [],
    notices = [];
  sales.counters.forEach(function (x) {
    chips.push({
      tid: 'strip-counter-' + x.counter,
      text: x.counter + ' ' + bkMoney(x.amount_minor, currency) + ' · ' + txn('{count} bill', '{count} bills', x.bills)
    });
  });
  sales.tenders.forEach(function (x) {
    chips.push({ tid: 'strip-tender-' + x.how, text: tx(x.how) + ' ' + bkMoney(x.amount_minor, currency) });
  });
  /* ⚠️ walk-in cash/UPI/card reach the Day book only at day close — no walk-in day entry for this day means the strip is not the whole day yet, and says so (the counter holds the fix) */
  if (!sales.day_closed) notices.push(bkNoCloseNotice(sales, dayRange.to));
  notices = notices.concat(bkDvTodoNotices(todoCounts));
  var askWaiting = bkMarkChips(notices, (reply && reply.entries) || []);
  if (!todoCounts.accept && !todoCounts.supplier && !todoCounts.overdue && !todoCounts.cheques && !todoCounts.waiting && !askWaiting) chips.push({ tid: 'todo-none', text: tx('Nothing waiting on you') });
  return {
    period: {
      label: bkDbPeriodLabel(dayRange, period.preset),
      value: period.preset,
      custom: { from: dayRange.from, to: dayRange.to },
      presets: [
        ['today', tx('Today')],
        ['month', tx('This month')],
        ['fy', bkFyWord('This FY')],
        ['custom', tx('Custom')]
      ],
      onPick: function (v, range) {
        if (v === 'custom' && !range) return;
        BK.dbp = bkDbPeriod(v, range);
        bkTab('daybook', true);
      }
    },
    chips: chips,
    notices: notices,
    slot: bkDvStepSlot(period, dayRange)
  };
}
/** W15-25 (cap-mark.js turn()): the Day book's two filter chips for Queries — "Waiting for you · n" (the owner has not answered) and "Answered · n" (the reviewer has the ball); pressing one shows only those rows, pressing it again shows all */
function bkMarkChips(notices, entries) {
  if (!BK.mk || !BK.mk.state().may) return 0;
  var count = { waiting: 0, answered: 0 };
  entries.forEach(function (e) {
    var turn = BK.mk.turn(e.entry_id);
    if (turn) count[turn]++;
  });
  [
    ['waiting', 'Waiting for you'],
    ['answered', 'Answered']
  ].forEach(function (item) {
    if (!count[item[0]] && BK.dvMk !== item[0]) return;
    notices.push({
      cls: 'ask',
      pressed: BK.dvMk === item[0],
      tid: 'mk-chip-' + item[0],
      text: tx(item[1]) + ' · ' + count[item[0]],
      onOpen: function () {
        BK.dvMk = BK.dvMk === item[0] ? '' : item[0];
        if (BK.dv && BK.dv.api) BK.dv.api.refresh();
      }
    });
  });
  return count.waiting;
}
/** the Evidence state of an entry (CBEvidence.stateOf, the chip's own): flag · none · nodoc · held; null when the server sent none */
function bkDvEvState(e) {
  return e && e.evidence ? CBEvidence.stateOf(e.evidence) : null;
}
function bkDvEvRank(e) {
  var s = bkDvEvState(e);
  return s ? s.rank : 9;
}
/** the fifth filter, Evidence: one choice per state the chip can show, with how many entries hold it */
function bkDvEvidenceFilter(ents) {
  var n = {};
  ents.forEach(function (e) {
    var s = bkDvEvState(e);
    if (s) n[s.key] = (n[s.key] || 0) + 1;
  });
  var evidenceWords = CBEvidence.words;
  return {
    key: 'evidence',
    label: tx('Evidence'),
    all: tx('Evidence'),
    match: function (e, v) {
      var s = bkDvEvState(e);
      return !!s && s.key === v;
    },
    options: ['flag', 'none', 'nodoc', 'held']
      .filter(function (k) {
        return n[k];
      })
      .map(function (k) {
        return { v: k, label: tx(evidenceWords[k]) + ' · ' + n[k] };
      })
  };
}
/** the Day book's filters: one per dimension (Kind · Tender · Counter · Person), then Evidence and Saved when those are on — each with the options the read actually holds */
function bkDvFilters(entries) {
  var ents = entries || [];
  var filters = BK_DV_DIMS.map(function (x) {
    var seen = [];
    ents.forEach(function (e) {
      bkDvVals(e, x[0]).forEach(function (item) {
        if (seen.indexOf(item) < 0) seen.push(item);
      });
    });
    if (x[0] === 'kind')
      seen.sort(function (first, second) {
        return BK_KINDS.indexOf(first) - BK_KINDS.indexOf(second);
      });
    else seen.sort();
    return {
      key: x[0],
      label: tx(x[1]),
      all: tx(x[1]),
      match: function (e, v) {
        return bkDvVals(e, x[0]).indexOf(v) >= 0;
      },
      options: seen.map(function (item) {
        return {
          v: item,
          label: x[0] === 'counter' ? tx('Counter') + ' ' + item : x[0] === 'by' ? item + (bkIsShopName(item) ? ' ' + tx('(owner)') : '') : tx(item)
        };
      })
    };
  });
  if (BK.ev) filters.push(bkDvEvidenceFilter(ents));
  if (bkFlagsOn())
    filters.push({ key: 'flag', label: tx('Saved'), all: tx('Saved'), match: function (e, v) { return v === 'noted' ? BK.fl.noted(e.entry_id) > 0 : BK.fl.bookmarked(e.entry_id); }, options: [{ v: 'bookmarked', label: tx('Bookmarked') }, { v: 'noted', label: tx('With a note') }] }); /* CMP066: my own bookmarks, never the Checked n of m */
  return filters;
}
/** the Day book's columns: the base set, then Evidence · Mark · Saved when those are on */
function bkDvColumns(c) {
  var cols = bkDvCols(c);
  if (BK.ev)
    cols.splice(cols.length - 1, 0, { key: 'evidence', sort: 'evidence', label: tx('Evidence'), prio: 2, w: 170, keep: true, html: true, cell: function (e) { var s = bkDvEvState(e); return s && s.key === 'nodoc' ? '—' : BK.ev.chip(e); }, value: function (e) { var s = bkDvEvState(e); return s ? s.word : ''; } }); /* CMP062: never cut to make room; No source = no document to attach, so a quiet dash, not a pill that reads as a fault (rule in cap-evidence.js header, as the firm Day book) */
  if (BK.mk && BK.mk.state().may)
    cols.splice(1, 0, { key: 'mark', label: tx('Mark'), prio: 2, w: 120, html: true, cell: function (e) { return BK.mk.chip(e.entry_id); }, value: function (e) { var m = BK.mk.row(e.entry_id); return m ? m.label || '' : ''; } }); /* ACC-358: the auditor's mark, read-only here; a Query opens its sheet for a reply */
  if (bkFlagsOn())
    cols.splice(cols.length - 1, 0, { key: 'flag', label: tx('Saved'), prio: 2, w: 80, keep: true, html: true, cell: function (e) { return BK.fl.chip(e.entry_id, String(e.entry_no || '') + (e.posting_date ? ' · ' + e.posting_date : '')); }, value: function (e) { return BK.fl.bookmarked(e.entry_id) ? 1 : 0; } }); /* CMP066 */
  return cols;
}
/** W15-116 / W15-117 ⚑ Needs you for the Day book (see the mount) */
function bkDvNeeds() {
  return {
    count: function () {
      return typeof CBAttention !== 'undefined' ? CBAttention.needs('bk_attn_db') : 0;
    },
    match: function (e) {
      var st = bkDvEvState(e);
      return !!((st && st.key === 'flag') || (BK.mk && BK.mk.row(e.entry_id) && BK.mk.row(e.entry_id).class === 'open'));
    },
    rank: function (e) {
      return BK.mk && BK.mk.row(e.entry_id) && BK.mk.row(e.entry_id).class === 'open' ? 2 : 1;
    },
    onNext: function (e) {
      var open = BK.mk && BK.mk.row(e.entry_id) && BK.mk.row(e.entry_id).class === 'open';
      if (open) BK.mk.sheet(e.entry_id, {});
      else if (BK.ev) BK.ev.sheet(e, {});
    }
  };
}
/** the Day book's sorts: as recorded · date · entry · kind · party · amount (· evidence when it is on) */
function bkDvSorts() {
  var by = bkSortBy;
  return [
    {
      key: 'rec',
      label: tx('As recorded'),
      cmp: function () {
        return 0;
      }
    },
    {
      key: 'date',
      label: tx('Date'),
      cmp: function (a, b) {
        return (
          String(a.posting_date).localeCompare(String(b.posting_date)) || String(a.entry_no).localeCompare(String(b.entry_no), undefined, { numeric: true })
        );
      }
    },
    {
      key: 'no',
      label: tx('Entry'),
      cmp: by(function (e) {
        return e.entry_no;
      })
    },
    {
      key: 'kind',
      label: tx('Kind'),
      cmp: by(function (e) {
        return BK_KINDS.indexOf(dayBookKind(e));
      }, true)
    },
    {
      key: 'party',
      label: tx('Party'),
      cmp: by(function (e) {
        return bkDvParty(e);
      })
    },
    { key: 'amount', label: tx('Amount'), cmp: by(bkDvTotal, true) }
  ].concat(BK.ev ? [{ key: 'evidence', label: tx('Evidence'), cmp: by(bkDvEvRank, true) }] : []);
}
/** declare the Day book's list once per read: its columns, grouping, five filters (Kind · Tender · Counter · Person · Evidence), sorts, search, next level, CSV — the page paints nothing else */
function bkDvMount(el) {
  var d = BK.dv,
    currency = d.r.currency;
  var filters = bkDvFilters(d.r.entries),
    cols = bkDvColumns(currency);
  var preset = BK.dvPreset; /* a link from another page (BAS: See them) opens the list narrowed; once */
  BK.dvPreset = null;
  return CBList.mount(el, {
    key: 'daybook',
    preset: preset || undefined,
    /* W15-116 / W15-117: ⚑ Needs you — the server's count over the range (/attention: no tax invoice, or an open query); the row's own flag and mark say which; Next › opens the next entry's evidence or query */
    needs: bkDvNeeds(),
    t: tx,
    view: 'lines' /* the Day book reads as a line a record (Athi, 2026-10-02: "one after the other, so it is more readable") */,
    rows: function () {
      var all = d.r.entries || [];
      if (!BK.dvMk || !BK.mk) return all;
      return all.filter(function (e) {
        return BK.mk.turn(e.entry_id) === BK.dvMk;
      });
    },
    rowClass: function (e) {
      return BK.mk && BK.mk.state().may ? BK.mk.rowClass(e.entry_id) : '';
    },
    id: function (e) {
      return e.entry_no;
    },
    head: bkDvHead,
    columns: cols,
    defaultCols: cols
      .filter(function (x) {
        return x.pin !== 'end';
      })
      .map(function (x) {
        return x.key;
      }),
    rowTid: function (e) {
      return 'db-entry-' + e.entry_no;
    },
    rowAttrs: function (e) {
      return { 'data-no': e.entry_no };
    },
    gist: function (e) {
      return bkDvGistText(e, currency);
    },
    gistTid: function (e) {
      return 'db-gist-' + e.entry_no;
    },
    next: function (e, ctx) {
      return bkDvNext(e, currency, ctx.view === 'lines');
    },
    group: {
      default: 'day',
      tid: 'db',
      options: [
        ['day', 'Day'],
        ['week', 'Week'],
        ['month', 'Month']
      ],
      by: function (e, mode) {
        var g = bkDvGroupOf(e.posting_date, mode);
        return [g.label, g.key];
      },
      fig: function (rows) {
        return bkDvGroupSummary(rows, currency);
      }
    },
    filters: filters,
    search: function (e) {
      return bkDvText(e, currency);
    },
    searchHint: tx('Search party, bill, amount'),
    sorts: bkDvSorts(),
    csv: function (rows) {
      bkDvDownload(rows);
    },
    /* Reverse this entry: insert-only — adds the mirror entry, never edits (cap-entry.js enReverse asks first) */
    actions:
      typeof enReverse === 'function'
        ? [
            {
              id: 'reverse',
              icon: '↩',
              label: 'Reverse this entry',
              tid: 'db-reverse',
              when: function (e) {
                return !!e.entry_id && !e.reversed_by && !e.reverses_entry_id && e.event_type !== 'reversal';
              },
              run: function (e) {
                enReverse(e.entry_id, e.entry_no);
              }
            }
          ]
        : undefined,
    tids: { expand: 'db-expand-all', collapse: 'db-collapse-all', csv: 'db-csv', count: 'db-count' },
    empty: { title: tx('Nothing in these dates') }
  });
}
/** ACC-358 (cap-mark.js): the auditor's marks arrive on each Day book entry; the owner sees the chip and may reply to a Query, never set one (the server's `mark_actions` says so) */
function bkMarksIngest(r, list) {
  if (!bkMarkControl()) return;
  BK.mk.ingest(list || r.entries, r);
}
/** the ONE mark control (adopter acc.audit): the Day book and the Receivables / Payables bill list read the same marks through it — null on a page that loads no cap-mark.js */
function bkMarkControl() {
  if (typeof CBMark === 'undefined') return null;
  if (!BK.mk) {
    BK.mk = CBMark.use({ adopter: 'acc.audit', call: api, period: function () { return BK.dv && BK.dv.range; } }); /* the Checked n of m counts the range the list shows */
    BK.mk.onChange(function () {
      if (BK.dv && BK.dv.api) BK.dv.api.refresh();
      if (BK.lt && BK.lt.api) BK.lt.api.refresh();
    });
  }
  return BK.mk;
}
/** CMP062 (cap-evidence.js): each Day book entry arrives with its evidence; the chip says what is held, a press opens the sheet, a file opens through the seat's own headers (the adviser's X-Books-For rides in CBBooksActing) */
function bkEvidenceIngest(list) {
  if (typeof CBEvidence === 'undefined') return;
  if (!BK.ev)
    BK.ev = CBEvidence.use({
      raw: function (path) {
        return fetch(CFG.API_BASE + path, { cache: 'no-store', headers: CBBooksActing.authHeaders() });
      }
    });
  BK.ev.ingest(list);
}
/**
 * CMP066 (cap-flag.js): the owner's own private bookmarks and notes on this business's entries. The call carries the token and NOTHING else: never X-Books-For, so a flag is kept in the caller's own organisation.
 * Only on the business's OWN books (not while acting for a client: the firm's seats are the grant view's); the subject is this business's own id.
 */
function bkFlagCall(method, path, body) {
  return fetch(CFG.API_BASE + path, { method: method, cache: 'no-store', headers: Object.assign(CBBooksActing.tokenHeader(), { 'Content-Type': 'application/json' }), body: body ? JSON.stringify(body) : undefined }).then(function (r) {
    return r.json().catch(function (failure) { return bkQuiet('flag-call', failure, {}); }).then(function (j) {
      if (!r.ok) { var e = new Error(j.detail || j.message || j.error || 'API ' + r.status); e.status = r.status; e.code = j.code; throw e; }
      return j;
    });
  });
}
function bkFlagsOn() {
  return !!BK.fl && !BK.fl.off() && BK.fl.ready();
}
function bkFlagsIngest(list) {
  if (typeof CBFlag === 'undefined' || !SESSION.entityId || (typeof CBBooksActing !== 'undefined' && CBBooksActing.current())) return;
  if (!BK.fl) BK.fl = CBFlag.use({ call: bkFlagCall, kind: 'posting', entity: function () { return SESSION.entityId; } });
  var flags = BK.fl;
  flags.load((list || []).map(function (e) { return e.entry_id; }).filter(Boolean)).then(function () {
    var host = document.getElementById('bk_dvlist'), d = BK.dv;
    if (BK.fl !== flags || !d || !host) return;
    if (bkFlagsOn() && !d.flDrawn) {
      d.flDrawn = true; /* the Saved column and filter exist only once the answer is in: the list is drawn again, once */
      if (d.api && d.api.destroy) d.api.destroy();
      d.api = bkDvMount(host);
    } else if (d.api) d.api.refresh();
  });
}
/** the Day book tab: one date range of entries, the strip and the to-do read together */
/** 5-YEAR GROWTH (l16-scale): the Day book reads one page at a time, newest first (the server's keyset, ?limit · ?order=desc · ?after); "Older" asks for the next. Never the whole range. */
var BK_PAGE = 100;
async function bkDaybook(body) {
  var q = bkRange('db');
  try {
    /* the strip and the to-do read routes that already exist — the day book's own, dues, cheques, health — together */
    /* the Day book does NOT wait for /dues (growth5y: it reads every party's balance and was the slow one): the list paints from its own read; the names and the overdue count arrive after */
    /* 5-YEAR GROWTH (l16-scale): one page at a time, newest first */
    var rr = await Promise.all([api('booksDaybook', { query: Object.assign({ limit: BK_PAGE, order: 'desc' }, q) }), bkChequesLoad(), bkHealthLoad()]);
    var r = rr[0];
    BK.dv = { r: r, range: q, todo: bkTodoCounts(BK.duesRaw || null, rr[1], rr[2]) };
    api('booksDues').then(
      function (dues) {
        bkDuesStore(dues); /* the same read names each entry's party (bkPartyLabel) */
        if (BK.dv && BK.dv.r === r) {
          BK.dv.todo = bkTodoCounts(dues, rr[1], rr[2]);
          if (BK.dv.api) BK.dv.api.refresh();
        }
      },
      function (failure) {
        bkQuiet('daybook-dues', failure);
      }
    );
    /* the strip adds up the LAST day's sales from the entries held: while the page is still inside that day (a busy day), the next page is read too — a strip of half a day would be silent */
    for (var more = 0; more < 5 && bkDvOpenDay(r, q); more++) r = await bkDvAppend(r, await api('booksDaybook', { query: Object.assign({ limit: BK_PAGE, order: 'desc', after: r.next }, q) }));
    BK.dv.r = r;
    bkMarksIngest(r);
    bkEvidenceIngest(r.entries); /* CMP062: what stands behind each entry */
    bkFlagsIngest(r.entries); /* CMP066: and my bookmarks of them (one read; the list is drawn again when it answers) */
    /* W15-102: the Needs attention strip, the server's counts over the range — never counted here */
    body.innerHTML = '<div class="attn-col"><div id="bk_attn_db"></div><div id="bk_dvlist" data-testid="db-list"></div></div><div id="bk_dvpager" data-testid="db-pager"></div>';
    BK.dv.api = bkDvMount(document.getElementById('bk_dvlist'));
    bkPagerPaint('bk_dvpager', 'db', r, 'Older', 'newest first', bkDvOlder);
    bkDvCountsHook(r, q);
    if (typeof CBAttention !== 'undefined')
      CBAttention.mount(document.getElementById('bk_attn_db'), q, function () {
        if (BK.dv && BK.dv.api) BK.dv.api.refresh(); /* the count of ⚑ Needs you arrives with the strip's own read */
      });
  } catch (e) {
    body.innerHTML = bkErr(e);
  }
}
/** is the oldest entry held still on the range's last day, with more behind it? */
function bkDvOpenDay(r, q) {
  var list = r.entries || [];
  return !!r.next && !!list.length && String(list[list.length - 1].posting_date || '').slice(0, 10) === q.to;
}
/** the next page joined to what is held (entries appended, the cursor and the range's totals the newest reply's) */
async function bkDvAppend(r, reply) {
  return Object.assign({}, reply, { entries: (r.entries || []).concat(reply.entries || []), count: (r.entries || []).length + (reply.entries || []).length });
}
/** "Older": the next page of the Day book, newest first */
async function bkDvOlder() {
  var d = BK.dv;
  if (!d || !d.r || !d.r.next || d.busy) return;
  d.busy = true;
  try {
    var reply = await api('booksDaybook', { query: Object.assign({ limit: BK_PAGE, order: 'desc', after: d.r.next }, d.range) });
    if (BK.dv !== d) return;
    bkMarksIngest(reply);
    bkEvidenceIngest(reply.entries);
    bkFlagsIngest(reply.entries); /* CMP066 */
    d.r = await bkDvAppend(d.r, reply);
    if (d.api) d.api.refresh();
    bkPagerPaint('bk_dvpager', 'db', d.r, 'Older', 'newest first', bkDvOlder);
  } catch (e) {
    if (typeof toast === 'function') toast(tx('Could not load more'));
  } finally {
    d.busy = false;
  }
}
/**
 * THE HOOK for the server's counts (l16-finfix, "Needs attention"): the filter and Evidence counts of this list must come from the server over the whole range, not from the page held. When that route lands it is called
 * here with the range, and its answer replaces the counts the filters draw; until then the filters work on the entries held and the pager says how many are held of how many there are.
 */
function bkDvCountsHook(r, range) {
  BK.dv.counts = null; /* set from the server's counts route over the range when it exists */
}
/** the one pager line under a paged list: "↓ Older 100 · 100 of 7,701 · newest first" — nothing when the whole range is held. The button is the list unit's own "show more" (CMP037-B05) */
function bkPagerPaint(id, key, reply, word, order, onMore) {
  var node = document.getElementById(id);
  if (!node) return;
  var held = key === 'lg' ? (reply.lines || []).length : (reply.entries || []).length,
    total = Number(reply.total || held);
  if (!reply.next && held >= total) {
    node.innerHTML = '';
    return;
  }
  node.innerHTML =
    '<div class="cbl-end" data-testid="' + key + '-more"><button type="button" data-cbsid="CMP037-B05"' + bkMountAttribute('CMP037') + ' data-bk-more="' + key + '"' + (reply.next ? '' : ' disabled') + '>↓ ' +
    esc(tx(word)) + ' ' + Math.min(BK_PAGE, total - held) + '</button> <span data-testid="' + key + '-held">' + held + ' ' + esc(tx('of')) + ' ' + total + ' · ' + esc(tx(order)) + '</span></div>';
  var button = node.querySelector('[data-bk-more]');
  if (button) button.onclick = onMore;
}

/**
 * ══ THE LEDGERS ARE A FOLDER TREE AND THE TASK TABLE ═══════════════════════════════════════════════════════════════
 * Athi, 2026-10-02 (live): *"i couldn't see the folder for each of the ledger, how do i open the folders, no folder symbol or
 * something to see it as a folder, or a tree structure"*. So: on the left the tree Folders already draws (cap-folders.js
 * `_folderNode` / `_folderPanes` — the same node, the same two panes) — four bands (People · Things you hold · Income and
 * expenses · Your capital) as top folders, their groups (Cash & bank, Duties & taxes …), each ledger a leaf with its balance;
 * Customers (Sundry Debtors) and Suppliers (Sundry Creditors) are FOLDERS whose leaves are the PARTIES — "P0007 · Chola Auto
 * Care", ordered by party no, one balance each from the one /dues read. On the right, the chosen ledger's entries in the
 * Task table (list-ctl.js tbl*): one row an entry, its journal's Dr/Cr lines the next level, a bill number opens the sheet.
 * The classification is by CODE and decided HERE once (accounts.html no longer keeps a second copy); every figure is the server's.
 */
var BK_LT_BANDS = [
  { id: 'people', title: 'People', blurb: 'personal — customers and suppliers' },
  { id: 'things', title: 'Things you hold', blurb: 'real — cash, bank, stock, and what you owe on them' },
  { id: 'income', title: 'Income and expenses', blurb: 'nominal' },
  { id: 'capital', title: 'Your capital', blurb: 'what the owner has put in' }
];
/** the Cash & bank ledgers: the codes the tree groups together and the ledger writes as Spent / Received */
var BK_CASHBANK = /^1[45]\d\d/;
/* [band, group, the codes it takes] — a code none of them claims lands in "Other" of its band, never nowhere */
var BK_LT_GROUPS = [
  ['things', 'Cash & bank', BK_CASHBANK],
  ['things', 'Stock & advances', /^(12|17|24)\d\d/],
  ['things', 'Duties & taxes', /^22[01]\d/],
  ['things', 'Taxes & suspense', /^(222|29)\d/],
  ['capital', "Owner's equity", /^3\d\d\d/],
  ['income', 'Income', /^4\d\d\d/],
  ['income', 'Direct costs', /^5\d\d\d/],
  ['income', 'Operating expenses', /^6[01]\d\d/],
  ['income', 'Adjustments', /^6[89]\d\d/]
];
/** the two control accounts open into one ledger per party: which side of /dues each takes, and its words */
var BK_CTRL = { '1300': { side: 'rcv', by: 'By customer', all: 'All customers' }, '2100': { side: 'pay', by: 'By supplier', all: 'All suppliers' } };
BK.lt = { open: {}, sel: null, model: null, bal: null, r: null, day: null, tq: '', w: 320, folded: null, api: null, prefs: false, noParty: false };
function bkLtBand(code) {
  var c = String(code == null ? '' : code);
  if (/^(1300|2100)/.test(c)) return 'people';
  if (/^3/.test(c)) return 'capital';
  if (/^[456]/.test(c)) return 'income';
  return 'things';
}
/** the accounts become bands → groups → ledgers. The per-party sub-accounts (1300-P…, 2100-P…) are NOT leaves: a party is read from /dues */
function bkLtModel(accounts) {
  var bands = BK_LT_BANDS.map(function (item) {
    return { id: item.id, title: item.title, blurb: item.blurb, groups: [], ctrl: [] };
  });
  var order = BK_LT_GROUPS.map(function (item) {
    return item[1];
  });
  (accounts || [])
    .filter(function (item) {
      return !item.is_group && !/^(1300|2100)-/.test(String(item.code));
    })
    .forEach(function (item) {
      var code = String(item.code),
        bid = bkLtBand(code),
        band = bands.filter(function (entry) {
          return entry.id === bid;
        })[0];
      if (BK_CTRL[code]) {
        band.ctrl.push({ code: code, name: String(item.name || ''), short: item.short_name || item.short || '' });
        return;
      }
      var g = BK_LT_GROUPS.filter(function (x) {
          return x[2].test(code);
        })[0],
        title = g ? g[1] : 'Other';
      var grp = band.groups.filter(function (x) {
        return x.title === title;
      })[0];
      if (!grp) {
        grp = { title: title, accts: [] };
        band.groups.push(grp);
      }
      grp.accts.push({ code: code, name: String(item.name || ''), short: item.short_name || item.short || '', role: item.role || null });
    });
  bands.forEach(function (item) {
    item.groups.sort(function (x, y) {
      return order.indexOf(x.title) + 100 * (x.title === 'Other') - (order.indexOf(y.title) + 100 * (y.title === 'Other'));
    });
    item.groups.forEach(function (entry) {
      entry.accts.sort(function (x, y) {
        return String(x.code).localeCompare(String(y.code), 'en', { numeric: true });
      });
    });
    item.ctrl.sort(function (x, y) {
      return String(x.code).localeCompare(String(y.code));
    });
  });
  return bands;
}
/** the next page's lines join the ones held (each numbered after them), the cursor and page are the newest reply's */
function bkLgJoinPage(held, reply) {
  var from = (held.lines || []).length;
  (reply.lines || []).forEach(function (item, index) {
    item._ix = from + index;
  });
  held.lines = (held.lines || []).concat(reply.lines || []);
  held.next = reply.next;
  held.page = reply.page;
}
/** "Next": the following page of this ledger (oldest first); its lines join the ones held, the running balance carries on from the server's own page opening */
async function bkLgMore() {
  var held = BK.lt.r,
    chosen = BK.lt.sel;
  if (!held || !held.next || BK.lt.busy || !chosen || chosen.party) return;
  BK.lt.busy = true;
  try {
    var reply = await api('booksLedger', { params: { account: chosen.code }, query: Object.assign({ limit: BK_PAGE, after: held.next }, bkRange('lg')) });
    if (BK.lt.r !== held) return;
    bkLgJoinPage(held, reply);
    bkMarksIngest(reply, reply.lines);
    if (BK.lt.api) BK.lt.api.refresh();
    bkPagerPaint('lg_pager', 'lg', held, 'Next', 'oldest first', bkLgMore);
  } catch (e) {
    if (typeof toast === 'function') toast(tx('Could not load more'));
  } finally {
    BK.lt.busy = false;
  }
}
/* leave the open ledger and go back to the tree */
function bkLtBack() {
  var s = BK.lt.sel;
  if (s) BK.lt.last = { code: s.code, party: s.party || null };
  if (typeof BK.onLedger === 'function') BK.onLedger(null);
  if (BK.lt.api) {
    BK.lt.api.destroy();
    BK.lt.api = null;
  }
  BK.lt.sel = null;
  var el = document.getElementById('bk_lt');
  if (el) el.classList.remove('has-sel', 'folded');
  var node = document.getElementById('lt_pane');
  if (node) node.innerHTML = bkLtPaneHTML();
  bkLtTreePaint(s ? (s.party ? 'P:' + s.party : 'L:' + s.code) : null);
}
/* open a ledger or a party in the right pane and load its lines */
function bkLtOpen(sel) {
  if (typeof BK.onLedger === 'function')
    BK.onLedger(sel); /* a host page takes its own header away (accounts.html) BEFORE the title row takes the shop · Home · avatar */
  if (BK.lt.api) {
    BK.lt.api.destroy();
    BK.lt.api = null;
  }
  BK.lt.over = false;
  BK.lt.sel = sel;
  BK.lt.r = null;
  BK.lt.err = null;
  BK.lt.day = null;
  BK.lt.dayP = null;
  BK.lt.noParty = false;
  BK.lt.last = { code: sel.code, party: sel.party || null };
  ['ledger-control', 'ledger-plain', 'ledger-party'].forEach(function (item) {
    CBList.reset(item);
  }); /* an open row, a search and a filter belong to the ledger they were made in */
  var el = document.getElementById('bk_lt');
  if (el) {
    el.classList.add('has-sel');
    el.classList.toggle('folded', bkLtFolded());
  } /* the tree folds away once a ledger is open on a narrow laptop (the person's own choice wins); with none open it is always shown */
  bkLtPrefsSave();
  var node = document.getElementById('lt_pane');
  if (node) node.innerHTML = bkLtPaneHTML();
  bkLtTreePaint();
  var out = document.getElementById('lg_out');
  if (out) BK.lt.api = bkLgMount(out);
  bkKuralFor();
  bkLtLoad();
}
/* find a ledger by its account code in the tree model and open it */
function bkLtAcct(code) {
  var f = null;
  (BK.lt.model || []).forEach(function (item) {
    item.ctrl
      .concat(
        item.groups.reduce(function (total, entry) {
          return total.concat(entry.accts);
        }, [])
      )
      .forEach(function (entry) {
        if (entry.code === code) f = entry;
      });
  });
  return f;
}
function bkLtPick(code) {
  BK.lgAcc = code;
  bkLtOpen({ code: code });
}
/** a control account: its folder opens (its parties appear) and its own ledger shows — total of the parties beside its closing */
function bkLtPickCtrl(code) {
  BK.lt.open['L:' + code] = true;
  BK.lt.open['B:people'] = true;
  bkLtPick(code);
}
function bkLtPickParty(id, ctrl) {
  BK.lgAcc = ctrl;
  delete BK.stmt[id];
  delete BK.owed[id];
  BK.lt.open['L:' + ctrl] = true;
  bkLtOpen({ code: ctrl, party: id });
}
/** which kural the open ledger carries (docs/design/ledgers-page README "Which kural"): the API sends no `ledger.kural` yet, so the page names the route of kurals.json; People and a first page read the page's own */
function bkKuralFor() {
  if (typeof CBKural === 'undefined') return;
  var s = BK.lt.sel,
    code = s ? String(s.code) : '',
    route = 'accounts';
  if (/^1[45]/.test(code)) route = 'daybook'; /* Cash & bank → 520 · check every day */
  else if (/^22[01]/.test(code)) route = 'gst'; /* GST, TDS → 733 */
  else if (/^29/.test(code)) route = 'suspense'; /* Suspense → 436 */
  else if (/^[456]/.test(code)) route = 'reports'; /* Income and expenses → 754 */
  else if (/^3/.test(code)) route = 'period-close'; /* Your capital → 385 */
  CBKural.set(route);
}
/* fetch the open ledger's lines from the server and paint them */
async function bkLtLoad() {
  var sel = BK.lt.sel;
  if (!sel) return;
  try {
    var r,
      ctrl = BK_CTRL[sel.code];
    if (sel.party) {
      r = await api('booksStatement', { params: { id: sel.party } });
      BK.stmt[sel.party] = r;
    } else {
      var rr = await Promise.all([api('booksLedger', { params: { account: sel.code }, query: Object.assign({ limit: BK_PAGE }, bkRange('lg')) }), ctrl ? booksDuesLoad(true) : null]); /* 5-YEAR GROWTH: a page of the period, oldest first (its running balance runs from the opening); "Next" reads the following page */
      r = rr[0];
      if (ctrl) bkLtTreePaint();
    }
    if (BK.lt.sel !== sel) return;
    BK.lt.r = r;
    BK.lt.err = null;
    BK.lt.day = null;
    BK.lt.dayP = null;
    BK.lgR = r;
    (r.lines || []).forEach(function (item, index) {
      item._ix = index;
    }); /* a line's place in the statement is its row id */
    if (!sel.party) bkMarksIngest(r, r.lines); /* ACC-358: the same chip on each ledger line (read + reply; the owner never sets) */
    if (BK.lt.api) BK.lt.api.refresh({ filters: bkLgFilters() });
    bkPagerPaint('lg_pager', 'lg', r, 'Next', 'oldest first', bkLgMore);
  } catch (e) {
    if (BK.lt.sel !== sel) return;
    BK.lt.err = e;
    if (BK.lt.api) BK.lt.api.refresh();
  }
}

/* ── the list: a CBList declaration for the chosen ledger ── */
var BK_NO_PARTY = 'No party';
function bkLgKind() {
  var s = BK.lt.sel || {};
  return s.party ? 'party' : BK_CTRL[s.code] ? 'control' : 'plain';
}
function bkLgDash() {
  return '<span style="color:var(--grey)">—</span>';
}
function bkEntryWord(e) {
  var s = e && e.source;
  return s && s.kind === 'day'
    ? esc(tx('Walk-in day'))
    : s && s.kind === 'receipt'
      ? esc(tx('Received'))
      : esc((e && (e.narration || e.what || e.event_type)) || '');
}
/** W15-89b · who the money went to / came from and what for, as the api carries them on the line ({ other: { code, name } | { code: null, name: 'Split', count }, party_name }): "Rent · Metro Trade Supplies"; '' when the line carries neither */
function bkLgOtherWords(l) {
  var o = l && l.other,
    what = !o ? '' : o.code == null ? tx('Split') + ' (' + o.count + ')' : o.name || '';
  return [what, l && l.party_name].filter(Boolean).join(' · ');
}
/** W15-89b: on a ledger's own page (not a party's, not a control account's) what the money was for and who got it; nothing elsewhere */
function bkLgPlainOther(line) {
  return bkLgKind() === 'plain' ? bkLgOtherWords(line) : '';
}
/** the words that open the Details cell: the line's other side (the bank's own words under the pointer) when it has one, else the entry's own word */
function bkLgWhatHTML(word, other) {
  return other ? '<span title="' + word + '">' + esc(other) + '</span>' : word;
}
/** the columns the open ledger shows now (the grid's own list), else the ones it opens with */
function bkLgShownCols() {
  var shown = [];
  try {
    shown = (BK.lt.api && BK.lt.api.state().cols) || [];
  } catch (failure) {
    shown = bkQuiet('grid-columns', failure, []);
  }
  return shown.length ? shown : bkLgDefaultCols(bkLgKind());
}
/** the facts of a line whose column is hidden, said under the opened entry: when it was made, when recorded, its entry number, tender, counter and who rang it */
function bkLgFacts(line) {
  var shown = bkLgShownCols(),
    on = function (key) {
      return shown.indexOf(key) >= 0;
    },
    source = line.source || {},
    facts = [];
  if (source.doc_at) facts.push(esc(bkTime(source.doc_at)));
  var recorded = bkRecordedHTML(line, 'stmt-' + line._ix);
  if (recorded) facts.push(recorded);
  if (!on('entry') && (line.entry_no || line.ref)) facts.push(esc(tx('Entry')) + ' <span class="mono">' + esc(line.entry_no || line.ref) + '</span>');
  if (!on('tender') && source.how) facts.push(esc(tx(source.how)));
  if (!on('counter') && source.counter) facts.push(esc(counterWord(source.counter)));
  if (!on('person') && source.by) facts.push(bkRungPart(source));
  return facts;
}
/** the Details cell: the kind and the bill, ONCE ("Expense C2/26-27/0007 11:44") — the entry number, the tender, the counter and who rang it live in ⚙ and in the opened entry */
function bkLgDetails(l) {
  /* W15-89: no time and no "recorded" note on the line — both live in the opened entry (bkLgNext) */
  var s = l.source || {},
    tid = 'stmt-src-' + l._ix,
    word = bkEntryWord(l),
    text = BK_SRC_WORD[s.kind] ? tx(BK_SRC_WORD[s.kind]) : '',
    other = bkLgPlainOther(l); /* W15-89b: on a ledger's own page the line says what the money was for and who got it; the bank's own words stay under the pointer */
  var said = !other && !!text && String(word).trim().toLowerCase() === text.toLowerCase(),
    out = bkLgWhatHTML(word, other);
  if (s.kind === 'day') {
    if (s.count != null) out += ' · ' + esc(txn('{count} bill', '{count} bills', s.count));
  } else if (s.ref || s.chit_id) out += (said ? ' ' : ' · ' + (text ? esc(text) + ' ' : '')) + bkBillPart(s, tid, true);
  return out + (l.ref && !s.ref && !other ? ' <span class="mono">' + esc(l.ref) + '</span>' : '') + bkLineChips(l, 'stmt-' + l._ix);
}
/** a cash or bank ledger (not a party's, not a control account's): it reads Spent / Received, the way a bank register does (W15-88) */
function bkLgIsBank(kind) {
  var s = BK.lt.sel || {};
  return kind === 'plain' && BK_CASHBANK.test(String(s.code || ''));
}
var BK_LG_MONEY_W = 150;
/** a date or an amount stays on one line ("30 Sept", "₹1,200.00 Dr") — a narrow column clips the pane's spare room, never wraps the figure */
function bkNoWrap(html) {
  return '<span style="white-space:nowrap">' + html + '</span>';
}
/** the columns a ledger opens with (the opened entry's facts line reads the same list) */
function bkLgDefaultCols(kind) {
  return kind === 'control' ? ['date', 'party', 'what', 'amount'] : bkLgIsBank(kind) ? ['date', 'what', 'spent', 'received', 'bal'] : ['date', 'what', 'amount', 'bal'];
}
/** the money columns, in the order a ledger reads: Spent · Received (a cash or bank ledger) or Amount Dr/Cr (every other), then the running Balance — all one-line */
function bkLgMoneyCols(currency, ctrl, bank) {
  var dash = bkLgDash(),
    money = function (v, ix, word) {
      return v ? bkNoWrap('<b data-testid="stmt-amt-' + ix + '">' + esc(bkMoney(v, currency) + (word ? ' ' + tx(word) : '')) + '</b>') : dash;
    },
    base = { num: true, w: BK_LG_MONEY_W, html: true };
  var out = bank
    ? [
        Object.assign({ key: 'spent', label: tx('Spent'), prio: 3, sort: 'spent', cell: function (l) { return money(l.cr_minor, l._ix); } }, base),
        Object.assign({ key: 'received', label: tx('Received'), prio: 3, sort: 'received', cell: function (l) { return money(l.dr_minor, l._ix); } }, base)
      ]
    : [
        Object.assign(
          {
            key: 'amount',
            label: tx('Amount'),
            prio: 3,
            sort: 'amount',
            cell: function (l) { return l.dr_minor ? money(l.dr_minor, l._ix, 'Dr') : money(l.cr_minor, l._ix, 'Cr'); }
          },
          base
        )
      ];
  out.push({
    key: 'bal',
    label: tx('Balance'),
    prio: ctrl ? 9 : 4,
    sort: 'bal',
    num: true,
    w: 160,
    html: true,
    cell: function (l) {
      return bkNoWrap(esc(bkDrCr(l.running_minor, currency)));
    }
  });
  return out;
}
/* the column list of the open ledger's grid (control account or one party) */
function bkLgCols(c, kind) {
  var dash = bkLgDash(),
    ctrl = kind === 'control';
  /* ONE flexible column (the designer's): Details takes what the others leave, so the default columns fill the pane and never spill sideways — a bill number is not broken across two lines. A width the person dragged wins (CBList remembers it). */
  var box = document.getElementById('lg_out'),
    avail = box ? box.clientWidth : 0,
    bank = bkLgIsBank(kind),
    moneyW = bank ? 2 * BK_LG_MONEY_W : BK_LG_MONEY_W,
    whatW = Math.max(240, Math.min(560, avail - (112 + moneyW + 160 + (ctrl ? 250 : 0)) - 12));
  var cols = bkLgLeadCols(ctrl);
  cols.push(
    {
      key: 'what',
      label: tx('Details'),
      prio: ctrl ? 3 : 2,
      sort: 'what',
      w: whatW,
      html: true,
      tid: function (l) {
        return 'stmt-what-' + l._ix;
      },
      cell: bkLgDetails
    },
    ...bkLgMoneyCols(c, ctrl, bank),
    {
      key: 'entry',
      label: tx('Entry no.'),
      prio: 5,
      sort: 'entry',
      w: 170,
      html: true,
      cell: function (l) {
        return l.entry_no || l.ref ? '<span class="mono">' + esc(l.entry_no || l.ref) + '</span>' : dash;
      }
    },
    {
      key: 'tender',
      label: tx('Tender'),
      prio: 6,
      w: 120,
      html: true,
      cell: function (l) {
        return bkHowPart(l.source, 'stmt-how-' + l._ix, c) || dash;
      }
    },
    {
      key: 'counter',
      label: tx('Counter'),
      prio: 7,
      w: 120,
      html: true,
      cell: function (line) {
        var source = line.source || {};
        return source.counter ? esc(counterWord(source.counter)) : dash;
      }
    },
    {
      key: 'person',
      label: tx('Rung by'),
      prio: 8,
      w: 130,
      html: true,
      cell: function (line) {
        var source = line.source || {};
        return source.by ? esc(source.by) + (bkIsShopName(source.by) ? ' <span style="color:var(--grey)">' + esc(tx('(owner)')) + '</span>' : '') : dash;
      }
    }
  );
  return cols;
}
/** a ledger's head is the CBList title row: the ledger's name, the period chip (the Day book's presets), ONE figures line, the notice when something needs a hand */
function bkLgPeriodHead() {
  var p = BK.lgp || (BK.lgp = bkDbPeriod('fy')),
    q = bkRange('lg');
  var pane = document.getElementById('lt_pane'),
    word = { today: 'Today', month: 'This month', fy: 'This FY' }[p.preset];
  /* the chip says the preset's name ("This FY") where the pane is too narrow for the dates — they are the chip's popover and the figures' own period */
  return {
    label: word && pane && pane.clientWidth < 1100 ? tx(word) : bkDbPeriodLabel(q, p.preset),
    value: p.preset,
    custom: { from: q.from, to: q.to },
    presets: [
      ['today', tx('Today')],
      ['month', tx('This month')],
      ['fy', bkFyWord('This FY')],
      ['custom', tx('Custom')]
    ],
    onPick: function (v, range) {
      if (v === 'custom' && !range) return;
      BK.lgp = bkDbPeriod(v, range);
      BK.lt.r = null;
      BK.lt.noParty = false;
      if (BK.lt.api) BK.lt.api.refresh();
      bkLtLoad();
    }
  };
}
/** one sort for a list: by the value `valueOf` gives (a number when `numeric`, else words with numbers in them in their order) */
function bkSortBy(valueOf, numeric) {
  return function (first, second) {
    var left = valueOf(first),
      right = valueOf(second);
    return numeric ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true });
  };
}
/** the text one ledger line is found by: date · what · party · bill · tender · counter · who rang it · the amount as the shop writes it */
function bkLgSearchText(l, currency) {
  var source = l.source || {};
  return [
    l.date,
    l.what,
    l.narration,
    l.ref,
    l.entry_no,
    l.party_name,
    bkPartyLabel(l.party_id, l.party_name),
    source.ref,
    source.how,
    source.counter,
    source.by,
    (Number(l.dr_minor || l.cr_minor || 0) / Math.pow(10, bkDec(currency))).toFixed(bkDec(currency))
  ].join(' ');
}
/** the ledger's sorts, OLDEST first by default: a ledger reads down with its running balance, and the Date header's ▲ (aria-sort ascending) is then true; ▼ reverses it (W15-87) */
function bkLgSorts() {
  var by = bkSortBy;
  return [
    {
      key: 'date',
      label: tx('Oldest first'),
      cmp: function (a, b) {
        return String(a.date).localeCompare(String(b.date)) || a._ix - b._ix;
      }
    },
    {
      key: 'what',
      label: tx('Details'),
      cmp: by(function (l) {
        return l.what || l.narration || '';
      })
    },
    {
      key: 'party',
      label: tx('Party'),
      cmp: by(function (l) {
        return bkPartyLabel(l.party_id, l.party_name);
      })
    },
    {
      key: 'entry',
      label: tx('Entry no.'),
      cmp: by(function (l) {
        return l.entry_no || l.ref || '';
      })
    },
    {
      key: 'bal',
      label: tx('Balance'),
      cmp: by(function (l) {
        return Number(l.running_minor || 0);
      }, true)
    },
    {
      key: 'amount',
      label: tx('Amount'),
      cmp: by(function (l) {
        return Number(l.dr_minor || 0) - Number(l.cr_minor || 0);
      }, true)
    },
    {
      key: 'spent',
      label: tx('Spent'),
      cmp: by(function (l) {
        return Number(l.cr_minor || 0);
      }, true)
    },
    {
      key: 'received',
      label: tx('Received'),
      cmp: by(function (l) {
        return Number(l.dr_minor || 0);
      }, true)
    }
  ];
}
/** Reverse this entry (insert-only: cap-entry.js asks first). The line names its entry only through the journal, so the journal is read first and a line that cannot be reversed (already reversed, or itself a reversal) says so. M29: a line that names its entry (a party statement) reverses FROM THE ROW — no Day book read, and the row repaints itself (bkReverseLine) */
function bkLgActions() {
  if (typeof enReverse !== 'function') return undefined;
  return [
    {
      id: 'reverse',
      icon: '↩',
      label: 'Reverse this entry',
      tid: 'lg-reverse',
      when: function (l) {
        return l.entry_id ? bkCanReverse(l) : !!(l.entry_no || l.ref || l.source_chit_id || (l.source && l.source.chit_id));
      },
      run: function (l) {
        if (l.entry_id) return bkReverseLine(l, BK.lt.sel && BK.lt.sel.party);
        bkLgJournal(l).then(function () {
          var e = bkLgEntry(l);
          if (!e || !e.entry_id || e.reversed_by || e.reverses_entry_id || e.event_type === 'reversal') {
            if (typeof toast === 'function') toast(tx('This entry cannot be reversed here.'));
            return;
          }
          enReverse(e.entry_id, e.entry_no);
        });
      }
    }
  ];
}
/**
 * ⭐ THE ONE FIGURES LINE (2026-10-03: the closing was shown three times with changing signs): "Opening ₹x Cr · Closing ₹y Cr", or "Balance ₹x Cr" once when they are the same,
 * and for a control account "✓ parties agree". Every figure is the server's. The parties check reads the API's `parties_check` when it sends one; until it does the page makes the
 * one comparison it always made — the parties' balances (the one /dues read) against the ledger's closing (listed in the PR as an API field).
 */
function bkLgFigs(ledgerReply, currency, selection) {
  var opening = Number(ledgerReply.opening_minor || 0),
    closing = Number(ledgerReply.closing_minor || 0),
    same = opening === closing,
    parts = same ? [tx('Balance') + ' ' + bkDrCr(closing, currency)] : [tx('Opening') + ' ' + bkDrCr(opening, currency), tx('Closing') + ' ' + bkDrCr(closing, currency)],
    check = null;
  if (!selection.party && BK_CTRL[selection.code]) {
    var partiesCheck = ledgerReply.parties_check,
      none = (ledgerReply.lines || []).filter(function (item) {
        return !item.party_id && !item.party_name;
      }).length;
    if (partiesCheck && typeof partiesCheck.agree === 'boolean')
      check = partiesCheck.agree ? { agree: true } : { agree: false, amount: Number(partiesCheck.amount_minor || 0), n: partiesCheck.entries != null ? Number(partiesCheck.entries) : none };
    else {
      var total = bkLtParties(selection.code).reduce(function (sum, item) {
        return sum + Number(item.balance_minor || 0);
      }, 0);
      check = total === closing ? { agree: true } : { agree: false, amount: closing - total, n: none };
    }
  }
  return { text: parts.join(' · ') + (check && check.agree ? ' · ' + tx('✓ parties agree') : ''), same: same, check: check };
}
/* the head line above the grid: the ledger name, its balance and whether the parties agree */
function bkLgHead() {
  var selection = BK.lt.sel;
  if (!selection) return null;
  var ledgerReply = BK.lt.r,
    ownsParty = !!selection.party,
    currency = (ledgerReply && ledgerReply.currency) || BK.duesCur,
    head = { title: bkLtTitle(), chips: [], notices: [] };
  if (!ownsParty) head.period = bkLgPeriodHead();
  if (ledgerReply) {
    var figures = bkLgFigs(ledgerReply, currency, selection);
    head.chips.push({ tid: 'lg-sum', text: figures.text });
    var agreedUpTo = ownsParty ? bkAgreedTo(ledgerReply) || bkAgreedTo(BK.dues && BK.dues[selection.party]) : '';
    if (agreedUpTo) head.chips.push({ tid: 'lg-agreed', text: tx('✓ Agreed up to') + ' ' + bkDate(agreedUpTo) });
    if (figures.check && !figures.check.agree) {
      head.notices.push({
        cls: 'warn',
        tid: 'lg-parties-diff',
        text: BK.lt.noParty
          ? txf(figures.check.n === 1 ? 'Showing the {n} entry with no party · Show all' : 'Showing the {n} entries with no party · Show all', { n: figures.check.n })
          : bkDrCr(figures.check.amount, currency) + ' ' + tx('with no party'),
        onOpen: function () {
          BK.lt.noParty = !BK.lt.noParty;
          if (BK.lt.api) BK.lt.api.refresh();
          if (BK.lt.noParty && typeof toast === 'function')
            toast(
              txf(figures.check.n === 1 ? 'Showing the {n} entry with no party. Open it and pick the party.' : 'Showing the {n} entries with no party.', {
                n: figures.check.n
              })
            );
        }
      });
    }
  }
  /* the grid's top-bar slot: back, fold and download buttons */
  head.slot = function (el) {
    var x = '';
    if (BK.backTo) /* ACC-357: opened from a return's box: Back goes to the return, on the same period */
      x += '<button data-cbsid="CMP006-B01"' + bkMountAttribute('CMP006') + ' type="button" class="cbl-tbtn" data-lt="backto" data-testid="lt-backto">‹ ' + esc(txf('Back to {form}', { form: BK.backTo.label })) + '</button>';
    if (bkLtNarrow())
      x += '<button data-cbsid="CMP006-B01"' + bkMountAttribute('CMP006') + ' type="button" class="cbl-tbtn cbl-ico" data-lt="back" data-testid="lt-back" aria-label="' + esc(tx('Back to all ledgers')) + '">‹</button>';
    if (bkLtFolded() && !bkLtNarrow())
      x +=
        '<button data-cbsid="CMP042-B06"' + bkMountAttribute('CMP042') + ' type="button" class="cbl-tbtn" data-lt="unfold" data-testid="lt-unfold" aria-label="' +
        esc(tx('Show the ledger list')) +
        '">☰ ' +
        esc(tx('Ledgers')) +
        '</button>';
    if (ownsParty) {
      x += '<span style="display:inline-flex;gap:6px;flex-wrap:nowrap">';
      x += '<button data-cbsid="CMP042-B05"' + bkMountAttribute('CMP042') + ' type="button" class="cbl-tbtn" data-lt="statement" data-testid="lg-statement">' + esc(tx('Statement')) + '</button>';
      x +=
        '<button data-cbsid="CMP042-B01"' + bkMountAttribute('CMP042') + ' type="button" class="cbl-tbtn" data-lt="pay" data-testid="lg-pay">' +
        esc(tx(bkPartyKind(BK.lt.sel.party, BK.lt.sel.code) === 'supplier' ? 'Pay' : 'Receive')) +
        '</button>';
      x += '</span>';
    }
    el.innerHTML = x;
    if (typeof BK.slotWho === 'function') BK.slotWho(el);
  };
  return head;
}
/* the open ledger's lines as CSV text, amounts in whole currency units */
function bkLgCsv(rows, c) {
  var pow = Math.pow(10, bkDec(c)),
    amt = function (m) {
      return (Number(m || 0) / pow).toFixed(bkDec(c));
    };
  var cell = function (v) {
    var text = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  var out = [['date', 'details', 'party', 'entry_no', 'dr', 'cr', 'balance', 'balance_side']];
  rows.forEach(function (item) {
    var s = item.source || {},
      b = Number(item.running_minor || 0);
    out.push([
      String(item.date).slice(0, 10),
      String(item.narration || item.what || s.kind || '') + (s.ref ? ' ' + s.ref : ''),
      item.party_name || '',
      item.entry_no || item.ref || '',
      item.dr_minor ? amt(item.dr_minor) : '',
      item.cr_minor ? amt(item.cr_minor) : '',
      amt(Math.abs(b)),
      b ? (b > 0 ? 'Dr' : 'Cr') : ''
    ]);
  });
  return (
    out
      .map(function (item) {
        return item.map(cell).join(',');
      })
      .join('\r\n') + '\r\n'
  );
}
/* download the shown rows as a CSV file */
function bkLgDownload(rows) {
  var r = BK.lt.r,
    sel = BK.lt.sel;
  if (!r || !sel) return;
  var blob = new Blob(['﻿' + bkLgCsv(rows, r.currency)], { type: 'text/csv;charset=utf-8' });
  var node = document.createElement('a');
  node.href = URL.createObjectURL(blob);
  node.download = 'ledger-' + (sel.party || sel.code) + '.csv';
  document.body.appendChild(node);
  node.click();
  node.remove();
  setTimeout(function () {
    URL.revokeObjectURL(node.href);
  }, 2000);
}
/* build the grid of the open ledger: columns, sorting, filters, row actions */
function bkLgMount(el) {
  var kind = bkLgKind(),
    c0 = BK.duesCur;
  var cur = function () {
    return (BK.lt.r && BK.lt.r.currency) || c0;
  };
  var dflt = bkLgDefaultCols(kind);
  return CBList.mount(el, {
    key: 'ledger-' + kind, foldHead: true /* the phone's head fold at every width: the title and the tools share a row on a laptop (head within 20% / 30%) */,
    t: tx,
    view: 'grid',
    fill: false /* the pane's own layout (flex) sizes the list — it leaves room for the kural footer, which fit() (window height minus the top) would not */,
    state: function () {
      return BK.lt.err ? 'error' : BK.lt.r ? undefined : 'loading';
    },
    error: function () {
      return { title: tx('This ledger could not be read.'), sub: bkWhy(BK.lt.err, tx('Nothing was lost. Try again in a moment.')) };
    },
    onRetry: function () {
      BK.lt.err = null;
      if (BK.lt.api) BK.lt.api.refresh();
      bkLtLoad();
    },
    rows: function () {
      var list = (BK.lt.r && BK.lt.r.lines) || [];
      return BK.lt.noParty
        ? list.filter(function (item) {
            return !item.party_id && !item.party_name;
          })
        : list;
    },
    id: function (l) {
      return String(l._ix);
    },
    rowTid: function (l) {
      return 'stmt-row-' + l._ix;
    },
    columns: function () {
      return bkLgCols(cur(), kind);
    },
    defaultCols: dflt,
    head: bkLgHead,
    search: function (l) {
      return bkLgSearchText(l, cur());
    },
    searchHint: tx('Search bill, party, amount'),
    /* OLDEST first: a ledger reads down with its running balance, and the Date header's ▲ (aria-sort ascending) is then true; ▼ reverses it (W15-87) */
    sorts: bkLgSorts(),
    filters: bkLgFilters(),
    /* Month · Day · None, in the sort's order (oldest first). A group head says only "n shown": the API sends no month / day totals yet, and the page adds up no money (listed in the PR) */
    group: {
      default: 'month',
      tid: 'lg',
      options: [
        ['month', 'Month'],
        ['day', 'Day'],
        ['none', 'None']
      ],
      by: function (l, mode) {
        if (mode === 'none') return null;
        var g = bkDvGroupOf(l.date, mode);
        return [g.label, g.key];
      }
    },
    csv: function (rows) {
      bkLgDownload(rows);
    },
    /* its journal is read once, on the first open, and the row shows it when it arrives */
    next: function (l) {
      return bkLgJournal(l).then(function () {
        return bkLgNext(l, cur());
      });
    },
    actions: bkLgActions(),
    tids: { expand: 'lg-expand-all', collapse: 'lg-collapse-all', csv: 'lg-csv', count: 'lg-count' },
    empty: { title: tx('No entries in these dates') }
  });
}
/** a ledger line's journal: the day-book entry it belongs to (by its entry number, else its chit and date) — read once, on the first open */
function bkLgEntry(l) {
  var list = (BK.lt.day && BK.lt.day.entries) || [],
    d = String(l.date || '').slice(0, 10);
  return list.filter(function (e) {
    return (
      (l.entry_no && e.entry_no === l.entry_no) ||
      (l.entry_id && e.entry_id === l.entry_id) ||
      (!l.entry_no &&
        !l.entry_id &&
        (l.source_chit_id || (l.source && l.source.chit_id)) &&
        (e.source_chit_id || (e.source && e.source.chit_id)) === (l.source_chit_id || (l.source && l.source.chit_id)) &&
        String(e.posting_date).slice(0, 10) === d)
    );
  })[0];
}
/**
 * PERF1: the opened line's OWN entry, read by its id (GET /daybook?entries=<entry_id>, that day) and kept for the next open — it read the whole
 * range's Day book for one line (the cash ledger's year: 24,163 entries, 18 MB at 100k lines). A line with no entry_id (an older api) reads
 * the range as before. A read that fails is said by the row ("not on this page"), and logged.
 */
function bkLgJournal(l) {
  var id = l && l.entry_id,
    day = String((l && l.date) || '').slice(0, 10),
    me = BK.lt.r;
  var have = function () {
    return ((BK.lt.day && BK.lt.day.entries) || []).some(function (e) {
      return e.entry_id === id;
    });
  };
  if (id && day) {
    if (have()) return Promise.resolve();
    return api('booksDaybook', { query: { from: day, to: day, entries: id } }).then(
      function (reply) {
        if (BK.lt.r !== me) return;
        BK.lt.day = BK.lt.day || { entries: [] };
        (reply.entries || []).forEach(function (e) {
          if (
            !BK.lt.day.entries.some(function (x) {
              return x.entry_id === e.entry_id;
            })
          )
            BK.lt.day.entries.push(e);
        });
      },
      function (e) {
        console.error("Books: a ledger line's journal could not be read —", id, (e && e.message) || e);
      }
    ); /* the row then says "not on this page" (bkLgNext) */
  }
  /* 5-YEAR GROWTH: no second read of the whole span's Day book — a line the server sends with no entry id says "not on this page" (bkLgNext); every line has one */
  return Promise.resolve();
}
/** the opened entry, in place: its journal's Dr / Cr lines (the ledger you are in is bold) and ONE quiet line of the facts no visible column already shows */
function bkLgNext(line, currency) {
  var e = bkLgEntry(line),
    ownsParty = !!(BK.lt.sel && BK.lt.sel.party);
  if (!e)
    return (
      '<div data-testid="stmt-lines-' +
      line._ix +
      '" style="color:var(--grey);font-size:var(--fs-1)">' +
      esc(tx('The journal lines of this entry are not on this page.')) +
      '</div>'
    );
  var facts = bkLgFacts(line);
  return (
    bkDvNext(e, currency, true, ownsParty, BK.lt.sel && BK.lt.sel.code) +
    (facts.length
      ? '<div class="lg-facts" data-testid="lg-facts-' +
        line._ix +
        '">' +
        facts
          .map(function (item) {
            return '<span>' + item + '</span>';
          })
          .join('') +
        '</div>'
      : '')
  );
}
/** a click on a tree row: a band or group folds, a ledger or party opens; true when the click was the tree's (else the click falls to the pane's buttons) */
function bkLtClickTree(ev, element) {
  var id = element.getAttribute('data-tn'),
    k = id.charAt(0),
    v = id.slice(2),
    exp = element.getAttribute('aria-expanded');
  if (k === 'B' || k === 'G') {
    bkLtSet(id, !bkLtOpenNow(id, true));
    bkLtTreePaint(id);
    return true;
  }
  if (k === 'L') {
    if (exp != null && ev.target.closest('.tw')) {
      bkLtSet(id, exp !== 'true');
      bkLtTreePaint(id);
      return true;
    }
    if (BK_CTRL[v]) bkLtPickCtrl(v);
    else bkLtPick(v);
    bkLtFocus(id);
    return true;
  }
  if (k === 'P') {
    bkLtPickParty(v, element.getAttribute('data-ctrl'));
    bkLtFocus(id);
    return true;
  }
  return false;
}
/** fold the tree away (its Unfold button takes the focus) or bring it back (the find box takes it); on a narrow laptop that is the overlay, elsewhere the kept width */
function bkLtFoldSet(fold) {
  if (bkLtOverlay()) BK.lt.over = !fold;
  else {
    BK.lt.folded = fold;
    bkLtPrefsSave();
  }
  bkLtFoldPaint();
  var target = fold ? document.querySelector('[data-lt="unfold"]') : document.getElementById('lt_q');
  if (target) target.focus();
}
/** a click on one of the pane's own buttons (data-lt): clear the find box · fold / unfold the tree · back to the tree · back to where the person came from · Statement · Pay */
function bkLtClickAction(action) {
  if (action === 'clear') {
    BK.lt.tq = '';
    var innerNode = document.getElementById('lt_q');
    if (innerNode) {
      innerNode.value = '';
      innerNode.focus();
    }
    bkLtTreePaint();
    return;
  }
  if (action === 'fold' || action === 'unfold') {
    bkLtFoldSet(action === 'fold');
    return;
  }
  if (action === 'back') {
    bkLtBack();
    return;
  }
  if (action === 'backto') {
    var back = BK.backTo;
    BK.backTo = null;
    if (back && typeof show === 'function') show(back.tab);
    return;
  }
  if (action === 'statement') {
    bkLgStatement();
    return;
  }
  if (action === 'pay') {
    var sp = BK.lt.sel && BK.lt.sel.party;
    if (sp) payOpen(bkPartyKind(sp, BK.lt.sel.code), sp);
  }
}
/** keys in the tree's find box: Escape clears it, ArrowDown steps into the tree; true when the key was handled */
function bkLtKeySearch(event, element) {
  if (event.key === 'Escape' && BK.lt.tq) {
    event.preventDefault();
    BK.lt.tq = '';
    element.value = '';
    bkLtTreePaint();
    return true;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    var nestedNode = document.querySelector('#lt_tree .tn');
    if (nestedNode) bkLtFocus(nestedNode.getAttribute('data-tn'));
    return true;
  }
  return false;
}
/** the arrow keys on a tree row: ↑ ↓ move · → open / step in · ← close / step out (to the nearest row of a lower level) */
function bkLtArrow(key, element, all) {
  var at = all.indexOf(element),
    expanded = element.getAttribute('aria-expanded'),
    level = +element.getAttribute('aria-level'),
    id = element.getAttribute('data-tn');
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    var neighbour = all[at + (key === 'ArrowDown' ? 1 : -1)];
    if (neighbour) bkLtFocus(neighbour.getAttribute('data-tn'));
  } else if (key === 'ArrowRight') {
    if (expanded === 'false') {
      bkLtSet(id, true);
      bkLtTreePaint(id);
    } else if (expanded === 'true' && all[at + 1]) bkLtFocus(all[at + 1].getAttribute('data-tn'));
  } else if (expanded === 'true') {
    bkLtSet(id, false);
    bkLtTreePaint(id);
  } else {
    for (var up = at - 1; up >= 0; up--) {
      if (+all[up].getAttribute('aria-level') < level) {
        bkLtFocus(all[up].getAttribute('data-tn'));
        break;
      }
    }
  }
}
/** keys on a tree row: arrows move and fold, Home / End jump, Enter or Space opens; true when the key was handled */
function bkLtKeyTree(event, element) {
  var all = Array.prototype.slice.call(document.querySelectorAll('#lt_tree .tn'));
  if (['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].indexOf(event.key) >= 0) {
    event.preventDefault();
    bkLtArrow(event.key, element, all);
    return true;
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    bkLtFocus(all[event.key === 'Home' ? 0 : all.length - 1].getAttribute('data-tn'));
    return true;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    element.click();
    return true;
  }
  return false;
}
/** the tree's width handle: drag it (pointer) to size the tree, the width is kept on this device when the drag ends */
function bkLtBindDrag(root) {
  var node = root.querySelector('#lt_rz'),
    drag = null;
  if (node) {
    node.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      drag = { x: event.clientX, w: BK.lt.w };
      node.classList.add('drag');
      try {
        node.setPointerCapture(event.pointerId);
      } catch (failure) { bkQuiet('pointer-capture', failure); }
    });
    node.addEventListener('pointermove', function (ev) {
      if (drag) bkLtWidth(drag.w + (ev.clientX - drag.x), true);
    });
    var end = function () {
      if (!drag) return;
      drag = null;
      node.classList.remove('drag');
      bkLtPrefsSave();
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
  }
}
/** the tree's three behaviours — click · keyboard · find box · fold · resize — bound ONCE on the pane that holds them */
function bkLtBind(root) {
  root.addEventListener('click', function (ev) {
    var element = ev.target.closest('[data-tn]'),
      nestedNode = ev.target.closest('[data-lt]');
    if (element && root.contains(element) && bkLtClickTree(ev, element)) return;
    if (nestedNode) bkLtClickAction(nestedNode.getAttribute('data-lt'));
  });
  root.addEventListener('input', function (ev) {
    if (ev.target.id === 'lt_q') {
      BK.lt.tq = ev.target.value;
      bkLtTreePaint();
    }
  });
  root.addEventListener('keydown', function (event) {
    var element = event.target;
    if (element.id === 'lt_q' && bkLtKeySearch(event, element)) return;
    if (element.getAttribute && element.getAttribute('data-tn') && bkLtKeyTree(event, element)) return;
    if (event.key === 'Escape' && BK.lt.over) {
      BK.lt.over = false;
      bkLtFoldPaint();
      var localNode = document.querySelector('[data-lt="unfold"]');
      if (localNode) localNode.focus();
      return;
    }
    if (element.id === 'lt_rz' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      bkLtWidth(BK.lt.w + (event.key === 'ArrowRight' ? 16 : -16));
    }
  });
  bkLtBindDrag(root);
}
function bkLtWidth(w, quiet) {
  BK.lt.w = Math.max(240, Math.min(520, Math.round(w)));
  var el = document.getElementById('bk_lt');
  if (el) el.style.setProperty('--lt-w', BK.lt.w + 'px');
  var node = document.getElementById('lt_rz');
  if (node) node.setAttribute('aria-valuenow', String(BK.lt.w));
  if (!quiet) bkLtPrefsSave();
}
function bkLtFoldPaint() {
  var el = document.getElementById('bk_lt');
  if (!el) return;
  el.classList.toggle('folded', bkLtFolded() && !!BK.lt.sel);
  if (BK.lt.api) BK.lt.api.refresh(); /* the title row's ☰ Ledgers appears / goes with the fold */
}
/** Statement, from a party's ledger (designer extra #5): the API has no "send the statement" route yet, so this opens the party's own statement view — CB CRM's party record, whose Ledger section already carries it */
function bkLgStatement() {
  var s = BK.lt.sel;
  if (!s || !s.party) return;
  var d = BK.dues && BK.dues[s.party],
    key = (d && d.party_no) || s.party;
  try {
    window.open('/crm.html#/party/' + encodeURIComponent(key), '_blank', 'noopener');
  } catch (failure) {
    bkQuiet('open-party', failure);
  }
}
/** the filters' options are the values the rows really carry — read when the ledger arrives, never a list the page invents */
function bkLgFilters() {
  var kind = bkLgKind(),
    parties = kind === 'control' && BK.lt.sel ? bkLtParties(BK.lt.sel.code) : [],
    list = [];
  var seen = function (f) {
    var rows = [];
    ((BK.lt.r && BK.lt.r.lines) || []).forEach(function (item) {
      var v = f(item);
      if (v && rows.indexOf(v) < 0) rows.push(v);
    });
    return rows.sort();
  };
  if (kind === 'control')
    list.push({
      key: 'party',
      label: tx('Party'),
      all: tx('Party'),
      match: function (l, v) {
        return v === BK_NO_PARTY ? !l.party_id && !l.party_name : bkPartyLabel(l.party_id, l.party_name) === v;
      },
      options: parties
        .map(function (item) {
          return bkPartyLabel(item.party_id, item.name);
        })
        .concat([BK_NO_PARTY])
        .map(function (item) {
          return { v: item, label: item === BK_NO_PARTY ? tx(BK_NO_PARTY) : item };
        })
    });
  list.push(
    {
      key: 'tender',
      label: tx('Tender'),
      all: tx('Tender'),
      match: function (l, v) {
        return (l.source || {}).how === v;
      },
      options: seen(function (l) {
        return (l.source || {}).how;
      }).map(function (item) {
        return { v: item, label: tx(item) };
      })
    },
    {
      key: 'counter',
      label: tx('Counter'),
      all: tx('Counter'),
      match: function (l, v) {
        return (l.source || {}).counter === v;
      },
      options: seen(function (l) {
        return (l.source || {}).counter;
      }).map(function (item) {
        return { v: item, label: tx('Counter') + ' ' + item };
      })
    },
    {
      key: 'person',
      label: tx('Rung by'),
      all: tx('Rung by'),
      match: function (l, v) {
        return (l.source || {}).by === v;
      },
      options: seen(function (l) {
        return (l.source || {}).by;
      }).map(function (item) {
        return { v: item, label: item };
      })
    }
  );
  return list;
}
/** the ledger a first visit opens on: the shop's main bank ledger (the chart's role 'bank'), else the first Cash & bank ledger — never an empty "Pick a ledger" card (W15-90) */
function bkLtMainBank() {
  var first = null,
    bank = null;
  (BK.lt.model || []).forEach(function (band) {
    band.groups.forEach(function (g) {
      g.accts.forEach(function (a) {
        if (!first && BK_CASHBANK.test(String(a.code))) first = a;
        if (!bank && a.role === 'bank') bank = a;
      });
    });
  });
  return bank || first;
}
/** the last ledger this person had open comes back (on a wide page; a phone opens on the tree) — only if it is still on the chart */
function bkLtRestore() {
  var l = BK.lt.last;
  if (BK.lt.sel || bkLtNarrow()) return;
  if (!l || !bkLtAcct(l.code) || (l.party && !(BK.dues && BK.dues[l.party]))) {
    var main = bkLtMainBank();
    l = main ? { code: main.code, party: null } : null;
  }
  if (!l) return;
  BK.lt.open['B:' + bkLtBand(l.code)] = true;
  var a = bkLtAcct(l.code),
    band = (BK.lt.model || []).filter(function (item) {
      return item.id === bkLtBand(l.code);
    })[0];
  if (band && !BK_CTRL[l.code])
    band.groups.forEach(function (item, index) {
      if (item.accts.indexOf(a) >= 0) BK.lt.open['G:' + band.id + '/' + index] = true;
    });
  if (l.party) {
    BK.lt.open['L:' + l.code] = true;
    bkLtOpen({ code: l.code, party: l.party });
  } else bkLtOpen({ code: l.code });
}
/** the Ledgers tab's frame: the tree (find box, fold button, the Needs-attention strip, the list) · the width handle · the pane */
function bkLtShellHTML() {
  return (
        '<div class="attn-flex">' +
        '<div id="bk_lt" class="lt' +
        (BK.lt.sel ? ' has-sel' : '') +
        '" data-testid="bk-lt" style="--lt-w:' +
        BK.lt.w +
        'px">' +
        '<nav class="lt-tree" aria-label="' +
        esc(tx('All ledgers')) +
        '"><div class="lt-tools" data-testid="lt-search"><div class="lt-search"><span aria-hidden="true">🔍</span><input data-cbsid="CMP040-I01"' + bkMountAttribute('CMP040') + ' id="lt_q" data-testid="lt-find" type="search" autocomplete="off" placeholder="' +
        esc(tx('Find a ledger or party')) +
        '" aria-label="' +
        esc(tx('Find a ledger or party')) +
        '" value="' +
        esc(BK.lt.tq || '') +
        '"></div>' +
        '<button data-cbsid="CMP042-B06"' + bkMountAttribute('CMP042') + ' type="button" class="lt-btn lt-ico" data-lt="fold" data-testid="lt-fold" title="' +
        esc(tx('Hide this list')) +
        '" aria-label="' +
        esc(tx('Hide the ledger list')) +
        '">⟨</button></div>' +
        '<div id="bk_attn_lg" class="lt-attn" data-testid="lt-attn"></div>' + /* the Needs attention strip lives in the ledger list column: a row of its own over the pane cost the head 5% of the window (Ledgers head budget 20% / 30%); a list it opens scrolls in the column */
        '<div id="lt_tree" class="lt-list" data-testid="lt-tree" role="tree" aria-label="' +
        esc(tx('Ledgers by band')) +
        '"></div></nav>' +
        '<button data-cbsid="CMP042-B23"' + bkMountAttribute('CMP042') + ' type="button" class="lt-rz" id="lt_rz" role="separator" aria-orientation="vertical" aria-valuemin="240" aria-valuemax="520" aria-valuenow="' +
        BK.lt.w +
        '" aria-label="' +
        esc(tx('Resize the ledger list (arrow keys)')) +
        '" title="' +
        esc(tx('Drag to resize')) +
        '"></button>' +
        '<main class="lt-pane" id="lt_pane">' +
        bkLtPaneHTML() +
        '</main></div></div>'
  );
}
/* the Ledgers tab: the tree of control accounts and parties and the pane for the open one */
async function bkLedgers(body) {
  try {
    var rr = await Promise.all([
      api('booksAccounts'),
      bkBalances().catch(function (failure) {
        return bkQuiet('balances', failure, null);
      }),
      booksDuesLoad(true)
    ]);
    bkLtPrefsRead();
    BK.lt.model = bkLtModel((rr[0] && rr[0].accounts) || []);
    BK.lt.bal = rr[1];
    BK.lt.api = null;
    body.innerHTML = bkLtShellHTML();
    if (typeof CBAttention !== 'undefined') CBAttention.mount(document.getElementById('bk_attn_lg'), bkRange('lg')); /* W15-102 */
    var root = document.getElementById('bk_lt');
    bkLtBind(root);
    bkLtTreePaint();
    if (typeof ResizeObserver !== 'undefined') {
      var last = bkLtNarrow();
      try {
        new ResizeObserver(function () {
          var n = bkLtNarrow();
          if (n !== last) {
            last = n;
            bkLtTreePaint();
            if (BK.lt.api) BK.lt.api.refresh();
          }
        }).observe(root);
      } catch (failure) { bkQuiet('resize-observer', failure); }
    }
    var s0 = BK.lt.sel,
      go = !!BK.lt.go;
    BK.lt.sel = null;
    BK.lt.go = false;
    if (s0 && (go || !bkLtNarrow())) bkLtOpen(s0.party ? { code: s0.code, party: s0.party } : { code: s0.code });
    else if (!s0) bkLtRestore();
    if (typeof CBKural !== 'undefined' && !BK.lt.sel) CBKural.set('accounts');
  } catch (e) {
    body.innerHTML = bkErr(e);
  }
}
/** RANK 9: the owner's bank agreement under the Trial balance: the ONE function (bank-tb-line.js) shared with the firm's books view; the sign-off is read from the api's `bank` block, never chosen or summed here */
function bkTbBankOptions(reply, asOf) {
  var shopCurrency = reply && reply.currency;
  return {
    money: function (minor, c) { return bkMoney(minor, c || shopCurrency); }, day: function (iso) { return typeof shopDay === 'function' ? shopDay(iso) : iso; }, tx: tx, txf: typeof txf === 'function' ? txf : tx,
    codes: { note: 'BKS004-P01', open: 'BKS004-B02', at: 'BKS004-B01' }, ids: 'bk_tb_bank_',
    onDay: function (day) { BK.tbDay = day; bkTab('tb'); } /* the tab repaints from scratch, so the day rides in BK until bkTB reads it */,
    onOpen: function () {
      var from = (reply && reply.fy_from) || '', query = new URLSearchParams(location.search || '');
      if (from && asOf) { query.set('fy', from.slice(0, 4)); query.set('from', from); query.set('to', asOf); history.replaceState(null, '', location.pathname + '?' + query.toString() + location.hash); } /* the Bank page reads the period from the address */
      if (typeof hashView === 'function') location.hash = 'bank';
      else bkTab('bank');
    }
  };
}
/** one trial-balance row: code · ledger (a link that opens its lines) · Dr · Cr, and with a comparison last year · change · % (a row over the rule is marked) */
function bkTbRowHTML(x, reply, compare, currency, asOf) {
  var changed = compare && window.CBTbChange ? window.CBTbChange.read(x) : x; /* F3: Change and % on the account's own side, the one helper the auditor's books view uses (tb-change.js) */
  return (
    '<tr' + (compare && x.change_over ? ' class="bk-over"' : '') + '><td class="mono">' +
    esc(x.code) +
    '</td><td>' +
    bkDrillLink(x.code, x.name, 'tb', reply.fy_from || bkFyFrom(), asOf, 'tb', tx('Trial balance')) +
    '</td><td class="num">' +
    (x.dr_minor ? esc(bkMoney(x.dr_minor, currency)) : '') +
    '</td><td class="num">' +
    (x.cr_minor ? esc(bkMoney(x.cr_minor, currency)) : '') +
    '</td>' +
    (compare ? '<td class="num" data-testid="tb-prior">' + (x.prior_net_minor == null ? bkFig(null, currency) : esc(bkDrCr(x.prior_net_minor, currency))) + '</td><td class="num">' + bkChange(changed.change_minor, x.change_over, currency, 'BKS004-P02', changed.side) + '</td><td class="num">' + bkPct(changed.change_bp, true) + '</td>' : '') +
    '</tr>'
  );
}
/** the bar over the trial balance: the date, Show, and the chip that says whether debits equal credits */
function bkTbBarHTML(asOf, ok) {
  return (
    '<div class="supacts" style="display:flex;gap:6px;align-items:center;margin-bottom:9px"><input data-cbsid="CMP040-I02"' + bkMountAttribute('CMP040') + ' type="date" class="inp" id="tb_asof" aria-label="' + esc(tx('As of')) + '" value="' +
    asOf +
    '"><button data-cbsid="CMP042-B04"' + bkMountAttribute('CMP042') + ' onclick="bkTab(\'tb\')">' +
    tx('Show') +
    '</button>' +
    '<span class="optchip" data-testid="tb-balanced" style="margin-inline-start:auto;' +
    (ok ? 'color:var(--ok-2);border-color:var(--ok-2)' : 'color:var(--warn-2);border-color:var(--warn-2)') +
    '">' +
    (ok ? tx('✓ balances') : tx('⚠ does not balance')) +
    '</span></div>'
  );
}
/** the Total row of the trial balance: the debit and credit totals (blank cells under a comparison) */
function bkTbTotalRowHTML(reply, currency, comparison) {
  return (
    '<tr><td></td><td><b>' +
      tx('Total') +
      '</b></td><td class="num" data-testid="tb-dr"><b>' +
      esc(bkMoney(reply.total_dr_minor, currency)) +
      '</b></td><td class="num" data-testid="tb-cr"><b>' +
      esc(bkMoney(reply.total_cr_minor, currency)) +
      '</b></td>' + (comparison ? '<td></td><td></td><td></td>' : '') + '</tr>'
  );
}
/* the Trial balance tab: every account's debit and credit as of one date */
async function bkTB(body) {
  var asOf = BK.tbDay || (document.getElementById('tb_asof') || {}).value || bkToday();
  BK.tbDay = '';
  try {
    var reply = await api('booksTB', { query: { asOf: asOf } });
    var currency = reply && reply.currency;
    var comparison = reply && reply.compare; /* leader-compare #2: the same day last year, the server's read (null in the first year of the books) */
    var rows = ((reply && reply.rows) || [])
      .map(function (x) {
        return bkTbRowHTML(x, reply, comparison, currency, asOf);
      })
      .join('');
    var ok = Number(reply.total_dr_minor) === Number(reply.total_cr_minor);
    body.innerHTML =
      bkStmtCss() + '<style>.bktab .bk-over td{background:var(--amber-t)}</style>' +
      bkTbBarHTML(asOf, ok) +
      (window.CBBankTbLine && reply.bank ? CBBankTbLine.html(reply.bank, bkTbBankOptions(reply, asOf)) : '') +
      bkTable(
        [{ t: tx('Code') }, { t: tx('Ledger') }, { t: tx('Debit'), num: 1 }, { t: tx('Credit'), num: 1 }].concat(comparison ? [{ t: tx('Last year'), num: 1 }, { t: tx('Change'), num: 1 }, { t: '%', num: 1 }] : []),
        rows,
        bkTbTotalRowHTML(reply, currency, comparison)
      ) +
      (comparison ? bkOverNote(reply.over_rule, currency, 'BKS004-P03', 'tb-over-note') : ''); /* the note sits UNDER the list: the first data row stays where it was */
    if (window.CBBankTbLine && reply.bank) CBBankTbLine.wire(body, reply.bank, bkTbBankOptions(reply, asOf));
  } catch (e) {
    body.innerHTML = bkErr(e);
  }
}
/**
 * ⭐ EVERY NUMBER OPENS WHAT IT COUNTS (WX-R2R, 2026-10-13): a Trial balance / P&L / Balance sheet line opens ITS ledger — the Ledgers view's own
 * door (BK.lt.sel → bkLedgers → bkLtOpen), never a second ledger screen. The link is the Day book's (an <a> that runs the door). `go` opens it even
 * on a phone, where the Ledgers view otherwise starts on its list.
 */
function bkOpenLedger(code) {
  BK.lt.sel = { code: String(code) };
  BK.lt.go = true;
  BK.lgAcc = String(code);
  if (typeof hashView === 'function') location.hash = 'ledgers';
  else bkTab('ledgers'); /* CB Accounts moves by its menu's hash (show) — the menu and the header follow */
}
/* ═══ THE STATEMENTS BESIDE LAST YEAR (ACC-357 · W15-118 P&L · W15-119 Balance sheet) ═══════════════════════════════════════════════════════════════
   Leaders (docs/walks/LEADERS-REPORTS-2026-11-16.md): MYOB "Compare to" last year with $ and % change and "% Sale analysis"; QuickBooks "previous period / previous year"; Xero compares
   equal-length periods. Taken: a Last-year column with its change and a % of income, ANY range against the same range a year earlier, the Balance sheet's prior month AND prior year in one view,
   a line that opens below. ⭐ THE PAGE ADDS NOTHING: every figure, change and share is the server's (basis points, formatted here only). The period and the dates come from the pack's year. */
var BK_PL = { preset: 'ytd', step: 0, from: '', to: '', compare: 'year' };
var BK_BS = { kind: 'today', step: 0, asOf: '' };
/** a carried change or share (basis points) as a short percent: "+25.0%" or "12.5%"; "—" when the server had nothing to compare with */
function bkPct(bp, signed) {
  if (bp == null) return '<span style="color:var(--grey)">—</span>';
  var n = Number(bp) / 100,
    shown = n.toFixed(1);
  if (Number(shown) === 0) return '0.0%'; /* a change that rounds to zero prints no sign: never "-0.0%" (critic finding 7) */
  return esc((signed && n > 0 ? '+' : '') + shown + '%');
}
function bkSpan(from, to) {
  return bkDate(from) + ' – ' + bkDate(to);
}
/** the figure cell: right-aligned money, "—" when the server sent none */
function bkFig(minor, c) {
  return minor == null ? '<span style="color:var(--grey)">—</span>' : esc(bkMoney(minor, c));
}
/** a ledger's name as a button that opens its entries BELOW the line (the server's page of ten), "Open all" going on to the Ledgers page and Back returning here; every line of every statement, one pattern */
function bkDrillLink(code, name, tid, from, to, tab, label) {
  if (!code) return esc(name);
  return (
    '<button data-cbsid="CMP010-B01"' + bkMountAttribute('CMP010') + ' type="button" class="bk-dl" aria-expanded="false" data-testid="' + esc(tid) + '-open-' + esc(code) + '" onclick="bkDrillToggle(this,\'' +
    esc(code) + '\',\'' + esc(from) + '\',\'' + esc(to) + '\',\'' + esc(tab) + '\',\'' + esc(label) + '\')" title="' + esc(tx('Show its entries below')) + '">' + '<span class="bk-code">' + esc(code) + ' · </span>' + esc(name) + ' ▸</button>'
  );
}
/** open or close the entries of one ledger under its row: one read of ten, then the count and "Open all" */
async function bkDrillToggle(btn, code, from, to, fromTab, label) {
  var row = btn.closest('tr'),
    next = row && row.nextElementSibling;
  if (next && next.getAttribute('data-drill') === code) {
    next.remove();
    btn.setAttribute('aria-expanded', 'false');
    return;
  }
  btn.setAttribute('aria-expanded', 'true');
  var td = document.createElement('td');
  td.colSpan = row.cells.length;
  td.innerHTML = '<span style="color:var(--grey);font-size:var(--fs-1)">' + esc(tx('Reading the entries…')) + '</span>';
  var tr = document.createElement('tr');
  tr.setAttribute('data-drill', code);
  tr.appendChild(td);
  row.parentNode.insertBefore(tr, row.nextSibling);
  try {
    var ledgerReply = await api('booksLedger', { params: { account: code }, query: { from: from, to: to, limit: 10, order: 'desc' } });
    var currency = ledgerReply.currency,
      lines = ledgerReply.lines || [],
      total = ledgerReply.total != null ? ledgerReply.total : lines.length;
    td.innerHTML =
      '<div style="padding:4px 0 8px 16px;font-size:var(--fs-1)" data-testid="drill-' + esc(code) + '">' +
      (lines.length
        ? lines
            .map(function (l) {
              return (
                '<div style="display:flex;gap:10px;justify-content:space-between"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
                esc(bkDate(l.date)) + ' · ' + esc(l.what || '') + '</span><span class="num" style="white-space:nowrap">' + esc(bkMoney(l.dr_minor ? l.dr_minor : l.cr_minor, currency)) + ' ' + esc(tx(l.dr_minor ? 'Dr' : 'Cr')) + '</span></div>'
              );
            })
            .join('')
        : '<span style="color:var(--grey)">' + esc(tx('No entries in this period')) + '</span>') +
      (total > 0 ? '<div style="margin-top:4px"><button type="button" class="bk-dl" data-testid="drill-all-' + esc(code) + '" onclick="bkOpenLedgerIn(\'' + esc(code) + '\',\'' + esc(from) + '\',\'' + esc(to) + '\',\'' + esc(fromTab) + '\',\'' + esc(label) + '\')">' +
        esc(txn('Open the {count} entry ▸', 'Open all {count} entries ▸', total, { count: total })) + '</button></div>' : '') +
      '</div>';
  } catch (failure) {
    td.innerHTML = '<span class="pe-bad">' + bkErr(failure) + '</span>';
  }
}
/** the ledger's entries for a period, with Back returning to the statement it came from */
function bkOpenLedgerIn(code, from, to, tab, label) {
  BK.lgp = { preset: 'custom', from: from, to: to };
  BK.backTo = { tab: tab, label: label, code: String(code) };
  bkOpenLedger(code);
}
/** the picker row of a statement: preset (from the pack's year) · ‹ › · the range said once · the comparison */
function bkPeriodBar(o) {
  var selectHtml = function (id, opts, cur, on) {
    return (
      '<select data-cbsid="CMP041-S01"' + bkMountAttribute('CMP041') + ' class="inp" id="' + id + '" data-testid="' + id + '" aria-label="' + esc(tx(o.aria)) + '" onchange="' + on + '">' +
      opts.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (String(x[0]) === String(cur) ? ' selected' : '') + '>' + esc(tx(x[1])) + '</option>'; }).join('') + '</select>'
    );
  };
  var btn = function (tid, glyph, label, step, off) {
    return '<button data-cbsid="CMP042-B04"' + bkMountAttribute('CMP042') + ' type="button" class="cbl-tbtn" data-testid="' + tid + '" aria-label="' + esc(tx(label)) + '"' + (off ? ' disabled' : '') + ' onclick="' + o.step + '(' + step + ')">' + glyph + '</button>';
  };
  return (
    '<div class="supacts" style="display:flex;gap:6px;align-items:center;margin-bottom:9px;flex-wrap:wrap" data-testid="' + o.tid + '-bar">' +
    selectHtml(o.tid + '_pick', o.opts, o.cur, o.pick + '(this.value)') +
    btn(o.tid + '-prev', '‹', 'Earlier', -1, o.custom) +
    btn(o.tid + '-next', '›', 'Later', 1, o.custom || !o.canNext) +
    (o.custom ? o.dates : '') +
    (o.extra || '') +
    '<span style="color:var(--grey);font-size:var(--fs-1)" data-testid="' + o.tid + '-range">' + esc(o.range) + '</span></div>'
  );
}
/** the statements' own look: money columns right-aligned and equal, the narrow screen drops the percent columns, never a sideways scroll */
function bkStmtCss() {
  return '<style>.bk-st{width:100%;border-collapse:collapse;font-size:var(--fs-1)}.bk-st td,.bk-st th{padding:3px 6px;vertical-align:baseline}.bk-st th{text-align:left;color:var(--grey);font-weight:600}.bk-st .num{text-align:right;white-space:nowrap}.bk-st .bk-over td{background:var(--amber-t)}.bk-over-dot{color:var(--amber-i)}.bk-over-note{margin:6px 0;color:var(--muted);font-size:var(--fs-1)}.bk-st .bk-sec td{padding-top:12px;font-weight:700}.bk-st .bk-grp td{padding-top:8px;font-weight:600}.bk-st .bk-sub td{border-top:1px solid var(--line);font-weight:600}.bk-st .bk-tot td{border-top:2px solid var(--line);font-weight:700}.bk-st .bk-ind{padding-left:18px}.bk-dl{background:none!important;border:0!important;padding:6px 0!important;min-height:0!important;line-height:1.2!important;font:inherit!important;color:var(--link,#1a5f8a)!important;text-align:left;cursor:pointer;box-shadow:none!important;border-radius:0!important}.bk-dl:hover{text-decoration:underline}.bk-st .bk-note{color:var(--grey);font-size:calc(var(--fs-1) - 1px);margin-inline-start:6px;white-space:nowrap}@media(max-width:620px){.bk-st .bk-wide,.bk-st .bk-code{display:none}.bk-st{font-size:12px}.bk-st td,.bk-st th{padding:3px 3px}.bk-st .bk-ind{padding-left:4px;display:inline-block;max-width:100%}.bk-st .bk-note{display:block;margin:0;white-space:normal}.bk-st .bk-dl{max-width:8.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:bottom}}</style>';
}
/** one statement row: label cell, then the figures the server carried (a figure list of { v, pct?, wide? }) */
function bkStRow(cls, label, cells) {
  return '<tr class="' + cls + '"><td>' + label + '</td>' + cells.map(function (x) { return '<td class="num' + (x.wide ? ' bk-wide' : '') + '"' + (x.tid ? ' data-testid="' + x.tid + '"' : '') + '>' + x.v + '</td>'; }).join('') + '</tr>';
}
/** ASA 520: the Change cell: the server's signed amount, with a quiet dot when the server says it is over its threshold (row class bk-over carries the tint on a narrow screen) */
function bkChange(minor, over, c, code, side) {
  if (minor == null) return bkFig(null, c);
  return (over ? '<span class="bk-over-dot" data-cbsid="' + (code || 'BKS005-P02') + '" role="img" aria-label="' + esc(tx('Highlighted')) + '" title="' + esc(tx('Highlighted')) + '">●</span> ' : '') + esc((Number(minor) > 0 ? '+' : '') + bkMoney(minor, c) + (side ? '\u00a0' + tx(side) : ''));
}
/** the one line under the P&L that says what is highlighted, from the server's rule */
function bkOverNote(rule, c, code, tid) {
  if (!rule || rule.pct_bp == null || rule.min_minor == null) return '';
  return '<div class="bk-over-note" data-cbsid="' + (code || 'BKS005-P01') + '" data-testid="' + (tid || 'pl-over-note') + '">' + esc(tx('Highlighted') + ': ' + tx('change of') + ' ' + rule.pct_bp / 100 + '% ' + tx('and') + ' ' + bkMoney(rule.min_minor, c).replace(/[.,]0+$/, '') + ' ' + tx('or more')) + '</div>';
}
/** the P&L: a head's ledgers, then its subtotal (every head gets one), each line with last year · change · % of income */
function bkPlGroups(lines, currency, compare, from, to) {
  return (lines || [])
    .map(function (head) {
      var accts = head.accounts || [];
      var figs = function (x) {
        var cells = [{ v: bkFig(x.amount_minor, currency) }];
        if (compare) cells.push({ v: bkFig(x.prior_minor, currency), wide: true }, { v: bkChange(x.change_minor, x.change_over, currency), wide: true }, { v: bkPct(x.change_bp, true), wide: true });
        cells.push({ v: bkPct(x.share_bp), wide: true });
        return cells;
      };
      return (
        bkStRow('bk-grp', esc(head.label), []).replace('</tr>', '<td colspan="' + (compare ? 5 : 2) + '"></td></tr>') +
        accts.map(function (x) { return bkStRow(compare && x.change_over ? 'bk-over' : '', '<span class="bk-ind">' + bkDrillLink(x.code, x.name, 'pl', from, to, 'pl', tx('P&L')) + '</span>', figs(x)); }).join('') +
        bkStRow('bk-sub' + (compare && head.change_over ? ' bk-over' : ''), esc(tx('Total') + ' ' + head.label), figs(head))
      );
    })
    .join('');
}
function bkPlPick(v) {
  BK_PL.preset = v;
  BK_PL.step = 0;
  if (v === 'custom') {
    BK_PL.from = BK_PL.from || bkFyFrom();
    BK_PL.to = BK_PL.to || bkToday();
  }
  bkTab('pl');
}
function bkPlStep(n) {
  BK_PL.step = Math.min(0, (BK_PL.step || 0) + n);
  bkTab('pl');
}
function bkPlCompare(v) {
  BK_PL.compare = v;
  bkTab('pl');
}
function bkPlDates() {
  BK_PL.from = (document.getElementById('pl_from') || {}).value || BK_PL.from;
  BK_PL.to = (document.getElementById('pl_to') || {}).value || BK_PL.to;
  bkTab('pl');
}
/** a total line of the P&L (Total income · Total expenses): the figure, then — beside last year — last year · change · %, then its share of income */
function bkPlTotalRow(cmp, c, total) {
  var cells = [{ v: bkFig(total.minor, c), tid: total.tid }];
  if (cmp) cells.push({ v: bkFig(total.was, c), wide: true }, { v: bkChange(total.chMinor, total.over, c), wide: true }, { v: bkPct(total.changeBp, true), wide: true });
  cells.push({ v: bkPct(total.share), wide: true });
  return bkStRow('bk-tot' + (cmp && total.over ? ' bk-over' : ''), esc(total.label), cells);
}
/** what the P&L asks the server: the compare mode and either the custom dates or the preset and its step back */
function bkPlQuery() {
  var query = { compare: BK_PL.compare };
  if (BK_PL.preset === 'custom') {
    query.from = BK_PL.from || bkFyFrom();
    query.to = BK_PL.to || bkToday();
  } else {
    query.preset = BK_PL.preset;
    query.step = BK_PL.step;
  }
  return query;
}
/** the total of one section ('income' or 'expense') from the server's reply, with last year's figure, change and share when compared */
function bkPlSectionTotal(reply, comparison, currency, kind, label) {
  var compared = comparison || {};
  return bkPlTotalRow(comparison, currency, {
    label: label,
    minor: reply['total_' + kind + '_minor'],
    was: compared['total_' + kind + '_minor'],
    changeBp: compared[kind + '_change_bp'],
    share: reply['total_' + kind + '_share_bp'],
    tid: 'pl-total-' + kind,
    chMinor: compared[kind + '_change_minor'],
    over: compared[kind + '_change_over']
  });
}
/** the P&L's first line: Profit or Loss, its share of income and, beside last year, what it was */
function bkPlLeadHTML(reply, cmp, c) {
  var profit = Number(reply.profit_minor);
  return '<div style="padding:4px 0 10px;font-size:var(--fs-3)" data-testid="pl-profit"><b>' + esc(tx(profit >= 0 ? 'Profit' : 'Loss')) + ' ' + esc(bkMoney(Math.abs(profit || 0), c)) + '</b>' +
    (reply.profit_share_bp != null ? ' <span style="color:var(--grey);font-size:var(--fs-1)">· ' + bkPct(reply.profit_share_bp) + ' ' + esc(tx('of income')) + '</span>' : '') +
    (cmp ? ' <span style="color:var(--grey);font-size:var(--fs-1)" data-testid="pl-profit-was">· ' + esc(tx('was')) + ' ' + esc(bkMoney(cmp.profit_minor, c)) + (cmp.profit_change_bp != null ? ' (' + bkPct(cmp.profit_change_bp, true) + ')' : '') + '</span>' : '') + '</div>';
}
/** the P&L's column heads: this period, last year · change · % when compared, % of income */
function bkPlHeadHTML(cmp) {
  return '<thead><tr><th>' + esc(tx('Ledger')) + '</th><th class="num">' + esc(tx('This period')) + '</th>' +
    (cmp ? '<th class="num bk-wide">' + esc(tx(cmp.how === 'year' ? 'Last year' : 'Before')) + '</th><th class="num bk-wide">' + esc(tx('Change')) + '</th><th class="num bk-wide">%</th>' : '') +
    '<th class="num bk-wide">' + esc(tx('% of income')) + '</th></tr></thead>';
}
/** the P&L's Compare-with list: same days last year · period before · none */
function bkPlCompareHTML() {
  return '<select data-cbsid="CMP041-S01"' + bkMountAttribute('CMP041') + ' class="inp" id="pl_cmp" data-testid="pl_cmp" aria-label="' + esc(tx('Compare with')) + '" onchange="bkPlCompare(this.value)">' +
    [['year', 'Same days last year'], ['period', 'Period before'], ['none', 'No comparison']].map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === BK_PL.compare ? ' selected' : '') + '>' + esc(tx(x[1])) + '</option>'; }).join('') + '</select>';
}
/* the P&L tab: profit first, then income and expenses by the pack's heads with a subtotal each, beside the same range last year */
async function bkPL(body) {
  var query = bkPlQuery();
  try {
    var reply = await api('booksPL', { query: query });
    var currency = reply && reply.currency,
      by = reply.by_line || {},
      comparison = reply.compare,
      period = reply.period || {},
      custom = BK_PL.preset === 'custom';
    var opts = (reply.presets || []).map(function (x) { return [x.id, x.label]; }).concat([['custom', 'Custom dates']]);
    var dates = custom
      ? '<input data-cbsid="CMP040-I02"' + bkMountAttribute('CMP040') + ' type="date" class="inp" id="pl_from" aria-label="' + esc(tx('From')) + '" value="' + esc(reply.from) + '" onchange="bkPlDates()"><span>→</span><input data-cbsid="CMP040-I02"' + bkMountAttribute('CMP040') + ' type="date" class="inp" id="pl_to" aria-label="' + esc(tx('To')) + '" value="' + esc(reply.to) + '" onchange="bkPlDates()">'
      : '';
    var cmpSel = bkPlCompareHTML();
    var range = bkSpan(reply.from, reply.to) + (comparison ? ' · ' + tx('against') + ' ' + bkSpan(comparison.from, comparison.to) : '');
    var lead = bkPlLeadHTML(reply, comparison, currency);
    var head = bkPlHeadHTML(comparison);
    body.innerHTML =
      bkStmtCss() +
      bkPeriodBar({ tid: 'pl', aria: 'Period', opts: opts, cur: BK_PL.preset, pick: 'bkPlPick', step: 'bkPlStep', custom: custom, canNext: period.can_next, dates: dates, extra: cmpSel, range: range }) +
      lead +
      '<table class="bk-st" data-testid="pl-table">' + head + '<tbody>' +
      bkStRow('bk-sec', esc(tx('Income')), []).replace('</tr>', '<td colspan="' + (comparison ? 5 : 2) + '"></td></tr>') +
      bkPlGroups(by.income, currency, comparison, reply.from, reply.to) +
      bkPlSectionTotal(reply, comparison, currency, 'income', tx('Total income')) +
      bkStRow('bk-sec', esc(tx('Expenses')), []).replace('</tr>', '<td colspan="' + (comparison ? 5 : 2) + '"></td></tr>') +
      bkPlGroups(by.expense, currency, comparison, reply.from, reply.to) +
      bkPlSectionTotal(reply, comparison, currency, 'expense', tx('Total expenses')) +
      '</tbody></table>' + (comparison ? bkOverNote(reply.over_rule, currency) : '');
  } catch (e) {
    body.innerHTML = bkErr(e);
  }
}
function bkBsPick(v) {
  BK_BS.kind = v;
  BK_BS.step = 0;
  if (v === 'custom') BK_BS.asOf = BK_BS.asOf || bkToday();
  bkTab('bs');
}
function bkBsStep(n) {
  BK_BS.step = Math.min(0, (BK_BS.step || 0) + n);
  bkTab('bs');
}
function bkBsDate() {
  BK_BS.asOf = (document.getElementById('bs_asof') || {}).value || BK_BS.asOf;
  bkTab('bs');
}
/** a side of the balance sheet: the pack's own chart heads, each with its ledgers and a subtotal, then the side's carried total */
function bkBsSide(title, items, heads, c, total, totalWas, tid, asOf, fyFrom, change) {
  /* leader-compare #2: `change` (the server read last year) adds Change and % after the year-ago column; a head or total, which carries none, stays blank */
  var cells = function (x) {
    var row = [{ v: bkFig(x.amount_minor, c) }, { v: bkFig(x.prior_month_minor, c), wide: true }, { v: bkFig(x.prior_year_minor, c) }];
    if (!change) return row;
    return row.concat('change_minor' in x ? [{ v: bkChange(x.change_minor, x.change_over, c, 'BKS006-P01') }, { v: bkPct(x.change_bp, true) }] : [{ v: '' }, { v: '' }]);
  };
  var out = bkStRow('bk-sec', esc(title), []).replace('</tr>', '<td colspan="' + (change ? 5 : 3) + '"></td></tr>');
  (heads || []).forEach(function (headGroup) {
    var mine = (items || []).filter(function (x) { return (x.group ? x.group.code : null) === headGroup.code; });
    var same = !headGroup.name || String(headGroup.name).toLowerCase() === String(title).toLowerCase(); /* a group named like its section (Equity under Equity) is said once */
    if (!same) out += bkStRow('bk-grp', esc(headGroup.name), []).replace('</tr>', '<td colspan="' + (change ? 5 : 3) + '"></td></tr>');
    mine.forEach(function (x) {
      var pair = x.net_of && x.net_of.length === 2 ? x.net_of : null;
      var note = pair ? '<span class="bk-note" data-testid="st-netof" title="' + esc(tx('Net of') + ' ' + pair[0].name + ' ' + pair[0].code + ' ' + tx('less') + ' ' + pair[1].name + ' ' + pair[1].code) + '">' + esc(tx('net of') + ' ' + pair[0].name + ' ' + tx('less') + ' ' + pair[1].name) + '</span>' : '';
      out += bkStRow(change && x.change_over ? 'bk-over' : '', '<span class="bk-ind">' + (x.code ? bkDrillLink(x.code, x.name, 'bs', fyFrom, asOf, 'bs', tx('Balance sheet')) : esc(x.name)) + note + '</span>', cells(x));
    });
    if (!same) out += bkStRow('bk-sub', esc(tx('Total') + ' ' + headGroup.name), cells(headGroup));
  });
  return out + bkStRow('bk-tot', esc(tx('Total') + ' ' + title.toLowerCase()), [{ v: bkFig(total, c), tid: tid }, { v: bkFig(totalWas && totalWas.month, c), wide: true }, { v: bkFig(totalWas && totalWas.year, c) }].concat(change ? [{ v: '' }, { v: '' }] : []));
}
/** the period bar's range text: the day, then the month-ago and year-ago days when compared */
function bkBsRange(reply, compare) {
  return tx('as at') + ' ' + bkDate(reply.asOf) + (compare.month ? ' · ' + bkDate(compare.month.as_at) + ' · ' + bkDate(compare.year && compare.year.as_at) : '');
}
/** the chip beside the period bar: ✓ balances, or a warning when assets and liabilities + equity differ (or the net assets do not agree) */
function bkBsBalancedChip(balanced, reply) {
  return '<span class="optchip" data-testid="bs-balanced" style="' + (balanced && reply.net_assets_ok !== false ? 'color:var(--ok-2)' : 'color:var(--warn-2)') + '">' + (balanced ? tx('✓ balances') : tx('⚠ does not balance')) + '</span>';
}
/** did the server read last year for any line (a year before the books began carries no change) */
function bkBsHasChange(reply) {
  return [].concat(reply.assets || [], reply.liabilities || [], reply.equity || []).some(function (x) {
    return x.change_minor != null;
  });
}
/** a side's total a month ago and a year ago, from the server's compare block (null when it sent none) */
function bkBsWas(compare, side) {
  return { month: compare.month ? compare.month[side] : null, year: compare.year ? compare.year[side] : null };
}
/** the Balance sheet's first line: Net assets, beside a month ago and a year ago when the server read them */
function bkBsLeadHTML(reply, cmp, c) {
  return '<div style="padding:4px 0 10px;font-size:var(--fs-3)" data-testid="bs-net"><b>' + esc(tx('Net assets')) + ' ' + esc(bkMoney(reply.net_assets_minor, c)) + '</b>' +
    (cmp.month ? ' <span class="bk-wide" style="color:var(--grey);font-size:var(--fs-1)">· ' + esc(tx('a month ago')) + ' ' + esc(bkMoney(cmp.month.net_assets_minor, c)) + '</span>' : '') +
    (cmp.year ? ' <span style="color:var(--grey);font-size:var(--fs-1)">· ' + esc(tx('a year ago')) + ' ' + esc(bkMoney(cmp.year.net_assets_minor, c)) + '</span>' : '') + '</div>';
}
/* the Balance sheet tab: net assets first, "as at" a day with ‹ ›, this date beside a month ago and a year ago, by the pack's own chart heads */
async function bkBS(body) {
  var asked = BK_BS.kind === 'custom' ? { asOf: BK_BS.asOf || bkToday() } : { kind: BK_BS.kind, step: BK_BS.step };
  try {
    var reply = await api('booksBS', { query: asked });
    var currency = reply && reply.currency,
      asAt = reply.as_at || {},
      comparison = reply.compare || {},
      custom = BK_BS.kind === 'custom',
      ok = Number(reply.total_assets_minor) === Number(reply.total_liab_equity_minor),
      groups = reply.groups || {},
      fyFrom = reply.fy_from || bkFyFrom(),
      change = bkBsHasChange(reply);
    var opts = [['today', 'Today'], ['month', 'Last month end'], ['year', 'Last year end'], ['custom', 'Pick a date']];
    var dates = custom ? '<input data-cbsid="CMP040-I02"' + bkMountAttribute('CMP040') + ' type="date" class="inp" id="bs_asof" aria-label="' + esc(tx('As of')) + '" value="' + esc(reply.asOf) + '" onchange="bkBsDate()">' : '';
    var wasOf = function (side) {
      return bkBsWas(comparison, side);
    };
    var lead = bkBsLeadHTML(reply, comparison, currency);
    body.innerHTML =
      bkStmtCss() +
      bkPeriodBar({ tid: 'bs', aria: 'As at', opts: opts, cur: BK_BS.kind, pick: 'bkBsPick', step: 'bkBsStep', custom: custom, canNext: asAt.can_next, dates: dates, range: bkBsRange(reply, comparison),
        extra: bkBsBalancedChip(ok, reply) }) +
      lead +
      '<table class="bk-st" data-testid="bs-table"><thead><tr><th>' + esc(tx('Ledger')) + '</th><th class="num">' + esc(tx('This date')) + '</th><th class="num bk-wide">' + esc(tx('A month ago')) + '</th><th class="num">' + esc(tx('A year ago')) + '</th>' + (change ? '<th class="num">' + esc(tx('Change')) + '</th><th class="num">%</th>' : '') + '</tr></thead><tbody>' +
      bkBsSide(tx('Assets'), reply.assets, groups.assets, currency, reply.total_assets_minor, wasOf('total_assets_minor'), 'bs-total-assets', reply.asOf, fyFrom, change) +
      bkBsSide(tx('Liabilities'), reply.liabilities, groups.liabilities, currency, reply.total_liabilities_minor, wasOf('total_liabilities_minor'), 'bs-total-liabilities', reply.asOf, fyFrom, change) +
      bkBsSide(tx('Equity'), reply.equity, groups.equity, currency, reply.total_equity_minor, wasOf('total_equity_minor'), 'bs-total-equity', reply.asOf, fyFrom, change) +
      bkStRow('bk-tot', esc(tx('Total liabilities and equity')), [{ v: bkFig(reply.total_liab_equity_minor, currency), tid: 'bs-total-le' }, { v: '', wide: true }, { v: '' }].concat(change ? [{ v: '' }, { v: '' }] : [])) +
      '</tbody></table>' + (change ? bkOverNote(reply.over_rule, currency, 'BKS006-P02', 'bs-over-note') : ''); /* the note sits UNDER the table */
  } catch (e) {
    body.innerHTML = bkErr(e);
  }
}
/**
 * ⭐ ONE AGEING (W15-94, 2026-11-16): the server's days-past-due set (row.follow_up — engines CBLedger.ageing set 'followup', api books-engines.followRow), the same on
 * Receivables, Payables, Collections and the Day book's overdue chip. The old tables here named the India Schedule III keys (lt_6m, m6_1y …); an Australian shop's pack sends
 * lt_1m / m1_2 …, so its money fell into "Other" and the oldest word read "Not due". No pack bucket is read by any screen now, and there is no "Other": the five keys are
 * the whole answer. A bill with no due date ages from its bill date (follow_up.no_terms_minor says how much; the screen says so).
 * Due today sits in 1–30 days (FIN-72: a collector chases a bill on its due day).
 */
var BK_FOLLOW = [
  ['not_due', 'Current'],
  ['d0_30', '1–30 days'],
  ['d31_60', '31–60 days'],
  ['d61_90', '61–90 days'],
  ['d90_plus', '90+ days']
];
/** the words of one follow-up code ('' for a code this screen does not know) */
function bkFollowWord(code) {
  var match = BK_FOLLOW.filter(function (item) {
    return item[0] === code;
  })[0];
  return match ? tx(match[1]) : '';
}
/** a supplier the shop has paid ahead (Dr balance: paid with no bill) is an advance — they owe you; the balance sheet reclassifies it the same way (1700). It is never under To pay. */
function bkDuesAdvance(p) {
  return bkDuesSide(p) === 'pay' && Number(p.balance_minor) > 0;
}
function bkDuesSide(p) {
  if (p.side === 'supplier') return 'pay';
  if (p.side === 'customer') return 'rcv';
  var b = p.buckets || {};
  if (p.side !== 'both' && 'lt_1y' in b && !('lt_6m' in b) && !('m6_1y' in b)) return 'pay';
  return Number(p.balance_minor) < 0 ? 'pay' : 'rcv';
}
/** the bills a party's statement holds — read once, on the first time its row opens (the party's own statement route) */
async function bkStmtRead(pid, list) {
  if (BK.stmt[pid] || (BK.stmtBusy || {})[pid]) return;
  BK.stmtBusy = BK.stmtBusy || {};
  BK.stmtBusy[pid] = true;
  try {
    BK.stmt[pid] = await api('booksStatement', { params: { id: pid } });
  } catch (failure) {
    BK.stmt[pid] = bkQuiet('statement', failure, { lines: [], failed: true });
  }
  delete BK.stmtBusy[pid];
  var lst = CBList.get(list);
  if (lst) lst.refresh();
}
/* the column list of the Dues grid (who, bills, oldest, amount owed) */
function bkDuesCols(c) {
  var dash = '<span style="color:var(--grey)">—</span>',
    amt = function (p, v) {
      return esc(bkMoney(Math.abs(Number(v || 0)), c));
    }; /* the group head says whose it is (You owe / They owe you) — an amount here is never signed */
  return [
    {
      key: 'party',
      label: tx('Party'),
      prio: 1,
      sort: 'party',
      w: 230,
      html: true,
      cell: function (p) {
        return esc(bkPartyLabel(p.party_id, p.name) || tx('Unnamed party'));
      }
    },
    {
      key: 'needs',
      label: tx('Needs'),
      prio: 2,
      sort: 'needs',
      w: 250,
      html: true,
      cell: function (p) {
        return bkNeedChips(p);
      }
    },
    {
      key: 'due',
      label: tx('Total due'),
      prio: 2,
      sort: 'due',
      num: true,
      w: 130,
      html: true,
      cell: function (p) {
        return (
          '<b data-b="balance">' +
          amt(p, p.balance_minor) +
          '</b>' +
          bkDuesForeign(p) +
          (bkDuesAdvance(p) ? ' <span data-b="advance" style="color:var(--grey)">· ' + esc(tx('advance paid — they owe you')) + '</span>' : '')
        );
      }
    },
    {
      key: 'oldest',
      label: tx('Oldest due'),
      prio: 3,
      sort: 'oldest',
      w: 220,
      html: true,
      cell: function (party) {
        var ageWord = bkDuesAge(party);
        return party.oldest_due
          ? '<span data-b="due">' +
              esc(bkDate(party.oldest_due)) +
              '</span>' +
              (ageWord ? ' <span data-b="age" style="color:var(--grey)">· ' + esc(tx(ageWord)) + '</span>' : '')
          : dash;
      }
    },
    {
      key: 'act',
      label: ' ',
      prio: 1,
      pin: 'end',
      w: 170,
      html: true,
      cell: function (p) {
        return bkDuesActs(p);
      }
    }
  ];
}
/** FX1: a party's foreign balance beside the books' figure — "USD 1,000 · ₹83,250" (the server's `foreign[]`, after b392; nothing for a party with none) */
function bkDuesForeign(p) {
  return (p.foreign || [])
    .filter(function (item) {
      return Number(item.balance_minor);
    })
    .map(function (item) {
      return (
        ' <span data-b="foreign" data-testid="dues-fx-' +
        esc(p.party_id) +
        '-' +
        esc(item.currency) +
        '" style="color:var(--grey)">· ' +
        esc(bkMoney(Math.abs(Number(item.balance_minor)), item.currency)) +
        '</span>'
      );
    })
    .join('');
}
/** the oldest late bucket the party has money in, else "Current" when all it owes is not yet due — the server's follow_up, in the words of BK_FOLLOW ('' when the row carries none) */
function bkDuesAge(party) {
  var follow = party.follow_up;
  if (!follow) return '';
  if (follow.worst) return bkFollowWord(follow.worst);
  return Number(follow.not_due) ? bkFollowWord('not_due') : '';
}
/** the buttons on a Dues row: Receive (or Pay) opens the ONE unit — an ADVANCE row says what it does: "Get back" (paid ahead to a supplier) or "Adjust" (a customer's advance), never "Pay" (M167); Remind (only on what is owed to you) messages the oldest open bill */
function bkDuesActs(p) {
  var kind = bkPartyKind(p.party_id),
    id = esc(p.party_id),
    rcv = kind === 'customer';
  return (
    '<span data-cbsid="CMP042-P01"' + bkMountAttribute('CMP042') + ' style="display:inline-flex;gap:6px" onclick="event.stopPropagation()">' +
    (kind === 'supplier' ? bkOwedFlags(p.party_id) : '') +
    '<button data-cbsid="CMP042-B01"' + bkMountAttribute('CMP042') + ' type="button" class="cbl-tbtn" data-testid="dues-pay-' +
    id +
    '" onclick="event.stopPropagation();payOpen(\'' +
    kind +
    "','" +
    id +
    "'," +
    esc(JSON.stringify(String(p.name || ''))) +
    ')">' +
    esc(tx(bkDuesAdvance(p) ? 'Get back' : rcv && Number(p.balance_minor) < 0 ? 'Adjust' : rcv ? 'Receive' : 'Pay')) +
    '</button>' +
    (rcv
      ? '<button data-cbsid="CMP042-B03"' + bkMountAttribute('CMP042') + ' type="button" class="cbl-tbtn" data-testid="dues-remind-' +
        id +
        '" onclick="event.stopPropagation();bkRemind(\'' +
        id +
        '\',this)">' +
        esc(tx('Remind')) +
        '</button>'
      : '') +
    '</span>'
  );
}
/** 'customer' (you receive) or 'supplier' (you pay): the party's side from the one /dues read, else the control account that is open */
function bkPartyKind(pid, ctrl) {
  var d = BK.dues && BK.dues[pid],
    side = d ? bkDuesSide(d) : (BK_CTRL[ctrl] || {}).side || 'rcv';
  return side === 'pay' ? 'supplier' : 'customer';
}
/**
 * ⭐ REMIND (M28) — a MESSAGE on the oldest open bill's line, through CBThread (R02). Never a new chit kind, never a new route: the oldest open bill is
 * the engine's own (/payments/preview lists the party's open bills oldest-due first — the list the Pay unit shows), its line is the first live line of
 * that chit, and the words are the shopkeeper's to edit before they send. The send, the busy state and the outcome are CBThread's.
 */
async function bkRemindTarget(pid) {
  var reply = await api('booksPayPreview', { body: { party_id: pid, direction: 'in', amount_minor: 1, currency: bkCur(), allocate: 'oldest_first' } });
  /* ⭐ THE ONE DUE FIGURE (R73): due_minor is the bill net of the party's receipts on account too — what the Collections list and the Cash view
     show; open_minor (what a payment may still be allocated to) is the Pay unit's figure and stands in only on an older server */
  var dueOf = function (item) {
    return Number(item.due_minor != null ? item.due_minor : item.open_minor);
  };
  var bill = ((reply && reply.proposal) || []).filter(function (item) {
    return dueOf(item) > 0 && !item.disputed;
  })[0];
  if (!bill) throw new Error('nothing open');
  bill = Object.assign({}, bill, { due_minor: dueOf(bill) });
  var line = null,
    acts = null;
  try {
    var ch = await api('chit', { params: { id: bill.against_ref } });
    acts = ch && ch.actions;
    var ls = ((ch && ch.live_set) || []).filter(function (e) {
      return e && !e.removed && e.line_id;
    });
    line = ls.length ? ls[0].line_id : null;
  } catch (failure) {
    bkQuiet('bill-line', failure);
  }
  /* can the reminder reach anyone? a party with no phone, no e-mail and not on the network is told the truth (null = not known: the old words stand) */
  var reach = null;
  try {
    var rec = await api('crmParty', { params: { id: pid } });
    if (rec) reach = !!(rec.phone || rec.email || rec.on_chitbridge);
  } catch (failure) {
    bkQuiet('remind-reach', failure);
  }
  return { chit_id: bill.against_ref, line_id: line, actions: acts, bill: bill, currency: reply.currency, party: (reply.party && reply.party.name) || '', reach: reach };
}
/* start a reminder to one party by opening their chit thread */
function bkRemind(pid, btn) {
  if (typeof CBThread === 'undefined' || !CBThread) {
    toast(tx('Could not open the reminder'));
    return;
  }
  return CBAction.run(
    btn || null,
    function () {
      return bkRemindTarget(pid);
    },
    { key: 'remind:' + pid, failed: tx('No open bill to remind about'), outcome: bkRemindOpen }
  );
}
/* open the reminder thread for one bill with the reminder words already written */
function bkRemindOpen(t) {
  var name = t.party || '';
  /* R73: a bill not yet late IS due, not WAS due — the day decides the sentence (bkToday: the shop's day, never UTC) */
  var late = !!(t.bill.due_date && t.bill.due_date < bkToday());
  var text = txf(
    late
      ? 'Hello {name}, a reminder: bill {no} for {amt} was due on {date}. Please pay when you can.'
      : 'Hello {name}, a reminder: bill {no} for {amt} is due on {date}. Please pay by then.',
    {
      name: name,
      no: t.bill.bill_no || '',
      amt: bkMoney(t.bill.due_minor, t.currency),
      date: bkDate(t.bill.due_date)
    }
  );  /* where-used: out-of-scope the mount is bkDialogMount(n): the host screen's own code plus -U2n, so it cannot be one literal */
  ui.dialog({
    mount: bkDialogMount(4),
    pop: 'POP094',
    titleText: tx('Remind') + ' · ' + name,
    titleTestid: 'remind_title',
    body:
      '<div data-testid="remind_for" style="font-size:var(--fs-1);margin-bottom:8px">' +
      esc((t.bill.bill_no || '') + ' · ' + bkMoney(t.bill.due_minor, t.currency) + ' · ' + bkDate(t.bill.due_date)) +
      '</div>' +
      '<div id="remind_thread" data-testid="remind_thread"></div>',
    footerHtml: '<button data-cbsid="CMP005-B01"' + bkMountAttribute('CMP005') + ' onclick="closeModal()">' + tx('Close') + '</button>'
  });
  CBThread.mount('remind_thread', {
    chit_id: t.chit_id,
    line_id: t.line_id || undefined,
    actions: t.actions || undefined,
    text: text,
    party: name,
    no_channel: t.reach === false,
    channel: 'external',
    thread_type: 'external',
    context: { host: 'dues', source: 'remind' }
  });
}
/**
 * ⭐ W15-95: what is still owed on each bill — the pay sheet's own open-bills reader (POST /payments/preview, `checks: true`), read once when a party's bills open. The figure is the
 * books' one due figure (due_minor: net of the receipts on account, books-engines.netOpen — what Remind asks for); nothing here works out an allocation. A bill the reader does not list
 * is paid in full. `reply.proposal[].entry_id` joins a row to its line on the statement (the same entry).
 */
async function bkOwedRead(pid, list) {
  if (BK.owed[pid] || (BK.owedBusy || {})[pid]) return;
  BK.owedBusy = BK.owedBusy || {};
  BK.owedBusy[pid] = true;
  try {
    var reply = await api('booksPayPreview', {
      body: { party_id: pid, direction: bkPartyKind(pid) === 'supplier' ? 'out' : 'in', amount_minor: 1, currency: bkCur(), allocate: 'none', checks: true }
    });
    BK.owed[pid] = reply;
    var marks = bkMarkControl();
    if (marks && reply && reply.mark_actions)
      marks.ingest(
        ((reply && reply.proposal) || []).map(function (row) {
          return { entry_id: row.entry_id, mark: row.mark };
        }),
        { mark_actions: reply.mark_actions }
      );
  } catch (failure) {
    BK.owed[pid] = bkQuiet('owed', failure, { proposal: [], failed: true });
  }
  delete BK.owedBusy[pid];
  var listApi = CBList.get(list);
  if (listApi) listApi.refresh();
}
/** a bill's standing from its own figures: 'paid' (nothing owed) · 'part' (less owed than the bill) · 'unpaid'; '' when the owed figure is hidden from this reader */
function bkBillStanding(amount, owed) {
  if (owed == null) return '';
  return owed <= 0 ? 'paid' : owed < amount ? 'part' : 'unpaid';
}
var BK_STANDING = { paid: 'Paid', part: 'Part paid', unpaid: 'Unpaid' };
/** the two things a reviewer and the books say about an open bill, beside Pay (W15-96): the auditor's hold (the Day book's mark) and "No tax invoice" (the Day book's evidence flag) — both the server's, on the bill's row */
function bkBillFlags(row) {
  var out = '',
    mark = row && row.mark;
  if (mark && (mark.class === 'hold' || mark.kind === 'on_hold'))
    out += ' <span class="optchip" data-b="mark-hold" style="color:var(--warn-2)">‖ ' + esc(tx('On hold')) + '</span>';
  if (row && row.evidence_flag === 'no_tax_invoice') out += ' <span class="optchip" data-b="no-tax-invoice" style="color:var(--warn-2)">⚠ ' + esc(tx('No tax invoice')) + '</span>';
  return out;
}
/** the flags of every open bill of a party, once, for its row's Pay (shown after its bills have been opened — a list does not read every party's bills) */
function bkOwedFlags(pid) {
  var rows = (BK.owed[pid] && BK.owed[pid].proposal) || [],
    held = rows.some(function (row) {
      return row.mark && (row.mark.class === 'hold' || row.mark.kind === 'on_hold');
    }),
    flagged = rows.some(function (row) {
      return row.evidence_flag === 'no_tax_invoice';
    });
  return bkBillFlags({ mark: held ? { class: 'hold' } : null, evidence_flag: flagged ? 'no_tax_invoice' : null });
}
/**
 * ⭐ W15-107 · THE BILLS OF A PARTY, as a sub-table the server pages (GET /party/:id/bills — open bills first, newest first, a page of 25, paid only when asked for).
 * Columns: Date · Bill · Due date · Days overdue · Status · Amount · Still owed · Reviewed. Every figure, the days late and the band are the SERVER's (the one ageing); the Reviewed cell is the
 * Day book's own mark (CBMark acc.audit — never a second mark), the hold and "No tax invoice" flags sit under the bill number (W15-96).
 * `list` is the table that asked (it paints again when each read lands). Shared by Dues and the CRM's Customers and Suppliers (app.html), so a party's bills read the same wherever its row opens.
 * State per party in BK.pb[pid]: { q: { state, band, sort, dir, page }, ans, busy }. A press (state · band · sort · page) sets q and reads again; nothing is filtered or counted here.
 */
var BK_PB_LIMIT = 25;
var BK_PB_TABS = [
  ['needs', 'Needs you'],
  ['open', 'Open'],
  ['all', 'All']
];
function bkPbOf(pid, list) {
  BK.pb = BK.pb || {};
  if (!BK.pb[pid]) BK.pb[pid] = { q: { tab: 'needs', paid: false, why: '', band: '', sort: 'date', dir: 'desc', page: 1 }, ans: null, busy: false, list: list || 'dues' };
  if (list) BK.pb[pid].list = list;
  return BK.pb[pid];
}
/** what the bills read asks the server for one party: the tab, the why and band filters, the page and — off the Needs tab — the sort */
function bkPbRequest(pid, question) {
  var request = { side: bkPartyKind(pid), tab: question.tab, why: question.why || undefined, band: question.band || undefined, page: question.page, limit: BK_PB_LIMIT };
  if (question.tab === 'all' && question.paid) request.state = 'paid';
  if (question.tab !== 'needs') {
    request.sort = question.sort;
    request.dir = question.dir;
  }
  return request;
}
/** the auditor's marks that arrived with a bills read join the mark control (the owner sees the chip, never sets one) */
function bkPbIngestMarks(reply) {
  var marks = bkMarkControl();
  if (marks && reply && reply.mark_actions)
    marks.ingest(
      (reply.bills || []).map(function (row) {
        return { entry_id: row.entry_id, mark: row.mark };
      }),
      { mark_actions: reply.mark_actions }
    );
}
/** read the bills of one party once at a time (a read already out wins), keep the answer on the party's state and refresh the list that shows it */
async function bkPbRead(pid) {
  var pbState = bkPbOf(pid);
  if (pbState.busy) return;
  pbState.busy = true;
  try {
    var reply = await api('booksPartyBills', { params: { id: pid }, query: bkPbRequest(pid, pbState.q) });
    bkPbIngestMarks(reply);
    pbState.ans = reply;
  } catch (failure) {
    pbState.ans = bkQuiet('bills', failure, { bills: [], failed: true });
  }
  pbState.busy = false;
  var listApi = CBList.get(pbState.list);
  if (listApi) listApi.refresh();
}
/** a press on the bills of party `pid`: set one part of the question and read again (a new tab, band or sort goes back to page 1) */
function bkPbSet(pid, patch, keepPage) {
  var s = bkPbOf(pid);
  Object.keys(patch).forEach(function (key) {
    s.q[key] = patch[key];
  });
  if (!keepPage) s.q.page = 1;
  s.ans = s.ans && Object.assign({}, s.ans, { stale: true });
  bkPbRead(pid);
}
function bkPbHost(el) {
  var host = el && el.closest && el.closest('[data-pb]');
  return host ? host.getAttribute('data-pb') : null;
}
/** a press on a band, tab, paid, why or page control of a party's bills: set that one part of the question and read again */
function bkPbPress(el) {
  var pid = bkPbHost(el),
    action = el.getAttribute('data-pb-act'),
    value = el.getAttribute('data-pb-val'),
    pbState = pid && bkPbOf(pid);
  if (!pbState) return;
  if (action === 'band') bkPbSet(pid, { band: pbState.q.band === value ? '' : value });
  else if (action === 'tab') bkPbSet(pid, { tab: value, paid: false, why: '', band: '' });
  else if (action === 'paid') bkPbSet(pid, { paid: !pbState.q.paid });
  else if (action === 'why') bkPbSet(pid, { why: '' });
  else if (action === 'page') bkPbSet(pid, { page: Math.max(1, pbState.q.page + Number(value)) }, true);
}
function bkPbSort(key) {
  var pid = bkPbHost(window.event && window.event.target),
    s = pid && bkPbOf(pid);
  if (!s) return;
  var wide = key === 'date' || key === 'amount' || key === 'owed' || key === 'days';
  bkPbSet(pid, { sort: key, dir: s.q.sort === key ? (s.q.dir === 'desc' ? 'asc' : 'desc') : wide ? 'desc' : 'asc' });
}
/**
 * ⭐ W15-115 · ONE ACTION A BILL — the why-chip says why the bill needs you, the button does the one thing that fixes it: Attach (a tax invoice) · Release (a hold) · Answer (a query or a dispute) · Pay / Receive · Set terms.
 * Nothing posts by itself: Attach opens the file picker, Release asks first (W15-113), Pay opens the pay sheet, Answer opens the mark's sheet or the bill.
 */
function bkNeedAction(pid, row, kind) {
  var word = row.action === 'pay' ? (kind === 'customer' ? 'Receive' : 'Pay') : BK_NEED[row.why] ? BK_NEED[row.why][1] : '';
  if (!word) return '';
  if (row.action === 'terms') return bkSetTermsLink();
  if (row.action === 'attach' && !row.chit_id) return '';
  return '<button type="button" class="cbl-tbtn bk-act" data-cbsid="CMP038-B01"' + bkMountAttribute('CMP038') + ' data-b="need-act-' + esc(row.action) + '" data-testid="bill-act-' + esc(row.ref) + '" onclick="event.stopPropagation();bkNeedDo(\'' + esc(pid) + "','" + esc(row.ref) + '\',this)">' + esc(tx(word)) + '</button>';
}
/** Attach: pick the file for the bill's chit; a held bill then offers its release, any other reads again (nothing posts by itself) */
async function bkNeedAttach(pid, row) {
  try {
    var added = await cbAttachPick(JSON.stringify({ chit_id: row.chit_id }));
    if (!added) return;
  } catch (failure) {
    bkQuiet('need-attach', failure);
    return;
  }
  var held = row.mark && (row.mark.class === 'hold' || row.mark.kind === 'on_hold');
  delete BK.owed[pid];
  if (held && bkMarkControl() && row.entry_id) bkAskRelease(pid, row);
  else bkPbSet(pid, {}, true);
}
/** Answer: a bill with a query opens the mark's sheet; any other opens the bill's own sheet */
function bkNeedAnswer(row, button) {
  var marks = bkMarkControl();
  if (marks && row.entry_id && row.reasons.indexOf('query') >= 0) marks.sheet(row.entry_id, { opener: button, title: bkBillTitle(row) });
  else if (row.chit_id && typeof openChitSheet === 'function') openChitSheet(row.chit_id);
}
/** the one action a bill's button does: Pay · Attach · Release · Answer (the row's own `action`) */
async function bkNeedDo(pid, ref, button) {
  var pbState = bkPbOf(pid),
    row = ((pbState.ans && pbState.ans.bills) || []).filter(function (item) {
      return item.ref === ref;
    })[0];
  if (!row) return;
  if (row.action === 'pay') {
    var party = BK.dues && BK.dues[pid];
    payOpen(bkPartyKind(pid), pid, String((party && party.name) || ''));
  } else if (row.action === 'attach') await bkNeedAttach(pid, row);
  else if (row.action === 'release') bkAskRelease(pid, row);
  else if (row.action === 'answer') bkNeedAnswer(row, button);
}
function bkBillTitle(row) {
  return [row.bill_no || row.ref, row.date ? bkDate(row.date) : ''].filter(Boolean).join(' · ');
}
/** who holds a bill and since when, from the hold's own fields (mark.by_name, mark.at); says nothing about an attachment */
function bkHeldBy(m) {
  m = m || {};
  var who = m.by_name || tx('someone else');
  return m.at ? txf('Held by {who} on {date}. Ask them to release it.', { who: who, date: bkDate(m.at) }) : txf('Held by {who}. Ask them to release it.', { who: who });
}
/** W15-113: a tax invoice is attached to a held bill → offer to release the hold; the owner confirms, nothing releases by itself */
function bkAskRelease(pid, row) {
  var marks = bkMarkControl();
  /* the hold is the AUDITOR's mark (api lib/mark-adopters: only grant:auditor sets): an owner who may not set one is told, not offered a button that would be refused */
  if (marks && row.entry_id && !marks.mayCheck(row.entry_id)) {
    if (typeof toast === 'function') toast(bkHeldBy(row.mark)); /* whoever set the hold releases it (DECISIONS 16 Nov); the owner's override is FIN-126 */
    return bkPbSet(pid, {}, true);
  }
  if (!marks || !row.entry_id || typeof CBConfirm !== 'function') return bkPbSet(pid, {}, true);
  CBConfirm(
    tx('Release the hold?'),
    '<p data-testid="release-body">' + esc(txf('{bill} is on hold. Take it off hold now?', { bill: bkBillTitle(row) })) + '</p>',
    tx('Release'),
    function () {
      return marks.set(row.entry_id, 'clear', '', null).then(function () {
        bkPbSet(pid, {}, true);
        return booksDuesLoad(true);
      });
    },
    false,
    function () {
      bkPbSet(pid, {}, true);
    }
  );
}
/** the strip over a party's bills: the three tabs with the server's counts (Paid a filter inside All), the age bands it counted and the on-account line */
function bkPbStripHTML(pbState, answer, currency) {
  var moneyOf = function (v) {
    return esc(bkMoney(Number(v), currency));
  };
  var counts = answer.counts || {},
    on = pbState.q.tab;
  /* the three tabs, the server's counts: Needs you (the default) · Open · All; Paid is answer filter inside All */
  var tabs = BK_PB_TABS.map(function (item) {
    var n = counts[item[0]];
    return (
      '<button type="button" class="cbl-nchip" data-cbsid="CMP036-K01"' + bkMountAttribute('CMP036') + ' data-b="tab-' + item[0] + '" data-testid="bills-tab-' + item[0] + '" data-pb-act="tab" data-pb-val="' + item[0] + '" aria-pressed="' + (on === item[0]) + '" onclick="bkPbPress(this)">' +
      esc(tx(item[1])) + (n != null ? ' <b>' + esc(String(n)) + '</b>' : '') + '</button>'
    );
  }).join('');
  if (on === 'all' && counts.paid != null)
    tabs += '<button type="button" class="cbl-nchip" data-cbsid="CMP033-B01" data-b="paid-filter" data-pb-act="paid" aria-pressed="' + !!pbState.q.paid + '" onclick="bkPbPress(this)">' + esc(tx('Paid')) + ' ' + esc(String(counts.paid)) + (pbState.q.paid ? ' ✕' : '') + '</button>';
  if (pbState.q.why)
    tabs += '<button type="button" class="cbl-nchip" data-cbsid="CMP033-B01" data-b="why-filter" data-pb-act="why" aria-pressed="true" onclick="bkPbPress(this)">' + esc(tx(BK_NEED[pbState.q.why][0])) + ' ✕</button>';
  /* the age bands the server counted (the one ageing): each answer chip that filters the bills below to that band; two to answer row on answer phone */
  var bands =
    on === 'needs'
      ? ''
      : BK_FOLLOW.filter(function (item) {
          return Number((answer.bands || {})[item[0]]) > 0;
        })
          .map(function (item) {
            var pressed = pbState.q.band === item[0],
              word = bkFollowWord(item[0]),
              cut = word.indexOf(' ') > 0 ? [word.slice(0, word.indexOf(' ')), word.slice(word.indexOf(' '))] : [word, ''];
            return (
              '<button type="button" class="cbl-nchip bk-band" data-cbsid="CMP033-B01" data-b="band-' + item[0] + '" data-pb-act="band" data-pb-val="' + item[0] + '" aria-pressed="' + pressed + '" onclick="bkPbPress(this)">' +
              esc(cut[0]) + '<span class="bk-bw">' + esc(cut[1]) + '</span> <b>' + moneyOf(answer.bands[item[0]]) + '</b>' + (pressed ? ' ✕' : '') + '</button>'
            );
          })
          .join('');
  var onAccount = Number(answer.on_account_minor) > 0 ? '<span data-b="on-account">' + esc(txf('{amt} on account, counted against the oldest bills', { amt: bkMoney(answer.on_account_minor, currency) })) + '</span>' : '';
  var strip = '<div class="cbl-nstrip" data-b="tab-strip">' + tabs + '</div>' + (bands || onAccount ? '<div class="cbl-nstrip bk-bands" data-b="band-strip">' + bands + onAccount + '</div>' : '');
  return strip;
}
/** the table of a party's bills: the columns this tab needs, one row a bill, the server's sort */
function bkPbTableHTML(pid, pbState, answer, currency) {
  var grey = 'color:var(--grey);font-size:var(--fs-1)',
    on = pbState.q.tab,
    kind = bkPartyKind(pid),
    moneyOf = function (v) {
      return esc(bkMoney(Number(v), currency));
    };
  var marks = bkMarkControl();
  /* the columns, one list: answer column the tab does not need is not drawn (Amount is the bill as it was: it says nothing more than Still owed until answer bill is part paid, so only All shows it).
     ln = the line answer phone card puts it on (1 · 2 · 0 = left off answer phone); end = pushed to the right of its line */
  var sortable = on !== 'needs';
  var spec = [
    { k: 'date', label: 'Date', w: 92, sort: sortable, ln: 1, cell: function (row) { return esc(bkDate(row.date)); } },
    { k: 'bill', label: 'Bill', sort: sortable, ln: 1, cell: function (row, index) { return bkBillPart({ ref: row.bill_no || row.ref, chit_id: row.chit_id }, 'bills-' + pid + '-' + index, true); } },
    { k: 'status', label: on === 'needs' ? 'Why' : 'Status', w: 200, ln: 1, cell: function (row) { return bkBillStatus(row, on); } },
    { k: 'due', label: 'Due date', w: 104, sort: sortable, ln: 2, cell: function (row) { return row.no_terms && row.status !== 'paid' ? bkSetTermsLink(pid) : row.due_date ? esc(bkDate(row.due_date)) : '—'; } },
    { k: 'days', label: 'Days overdue', w: 96, r: true, sort: sortable, ln: 2, cell: function (row) { return row.status === 'paid' ? '—' : row.days_overdue == null ? esc(tx('not due')) : row.days_overdue === 0 ? esc(tx('due today')) : esc(String(row.days_overdue)); } },
    { k: 'amount', label: 'Amount', w: 100, r: true, sort: sortable, ln: 0, only: 'all', cell: function (row) { return moneyOf(row.amount_minor); } },
    { k: 'owed', label: 'Still owed', w: 104, r: true, sort: sortable, ln: 2, end: true, cell: function (row) { return row.owed_minor == null ? '<span style="' + grey + '">—</span>' : '<b data-b="owed">' + moneyOf(row.owed_minor) + '</b>'; } },
    {
      k: 'reviewed', label: 'Reviewed', w: 90, ln: 0,
      cell: function (row) {
        var held = row.mark && (row.mark.class === 'hold' || row.mark.kind === 'on_hold'); /* answer hold is said ONCE, in Status; Reviewed holds the tick (and answer query) only */
        return !held && marks && row.entry_id && marks.row(row.entry_id) ? marks.chip(row.entry_id) : '<span style="' + grey + '">—</span>';
      }
    },
    { k: 'act', label: ' ', w: 96, ln: 1, end: true, cell: function (row) { return bkNeedAction(pid, row, kind); } }
  ].filter(function (col) {
    return !col.only || col.only === on;
  });
  var table = CBList.nextTable({
    id: 'bills-' + pid,
    sort: { k: pbState.q.sort, dir: pbState.q.dir },
    act: 'bkPbSort',
    empty: tx(on === 'needs' ? 'Nothing here needs you' : on === 'open' ? 'No open bills' : 'No bills here'),
    cols: spec.map(function (col) {
      return { k: col.k, label: tx(col.label), w: col.w, r: col.r, sort: col.sort, ln: col.ln, end: col.end };
    }),
    rows: (answer.bills || []).map(function (row, index) {
      return spec.map(function (col) {
        return col.cell(row, index);
      });
    })
  });
  return table;
}
/** the page line under a party's bills (Previous · Page n of m · Next); nothing when everything fits one page */
function bkPbPagerHTML(pid, pbState, answer) {
  var pages = Math.max(1, Math.ceil(Number(answer.total || 0) / BK_PB_LIMIT)),
    pager = '';
  if (pages > 1) {
    var press = function (side, label, off, step) {
      return '<button type="button" data-cbsid="CMP037-' + (side === 'prev' ? 'B06' : 'B07') + '" class="act quiet cbl-pgbtn" data-testid="bills-' + side + '-' + esc(pid) + '" data-pb-act="page" data-pb-val="' + step + '" onclick="bkPbPress(this)"' + (off ? ' disabled' : '') + '>' + (side === 'prev' ? '‹ ' + esc(label) : esc(label) + ' ›') + '</button>';
    };
    pager =
      '<div class="cbl-nstrip" data-b="bills-pager">' + press('prev', tx('Previous'), pbState.q.page <= 1, -1) + press('next', tx('Next'), pbState.q.page >= pages, 1) +
      '<span>' + esc(txf('Page {n} of {m}', { n: pbState.q.page, m: pages })) + '</span></div>';
  }
  return pager;
}
/** a party's bills as the Needs you · Open · All tabs: the server's counts, bands and one table (shared by Dues and the CRM party panes) */
function bkPartyBillsHTML(pid, list, currency) {
  var pbState = bkPbOf(pid, list),
    grey = 'color:var(--grey);font-size:var(--fs-1)';
  if (!pbState.ans) {
    bkPbRead(pid);
    return '<div style="' + grey + '">' + esc(tx('Reading the bills…')) + '</div>';
  }
  var answer = pbState.ans;
  if (answer.failed) return '<div style="' + grey + '">' + esc(tx('The bills could not be read')) + '</div>';
  var counts = answer.counts || {},
    on = pbState.q.tab;
  /* the clean bills fold into one line (W15-115): "✓ 130 bills in order" — pressed, they open on the Open tab */
  var fold =
    on === 'needs' && Number(counts.in_order) > 0
      ? '<div class="cbl-nstrip" data-b="in-order"><button type="button" class="cbl-nchip" data-cbsid="CMP033-B01" data-testid="bills-in-order" data-pb-act="tab" data-pb-val="open" onclick="bkPbPress(this)">✓ ' + esc(txn('{count} bill in order', '{count} bills in order', Number(counts.in_order))) + ' ▸</button></div>'
      : '';
  return '<div data-pb="' + esc(pid) + '"' + (answer.stale ? ' aria-busy="true" style="opacity:.6"' : '') + '>' + bkPbStripHTML(pbState, answer, currency) + '<div class="bk-tabwrap">' + bkPbTableHTML(pid, pbState, answer, currency) + '</div>' + fold + bkPbPagerHTML(pid, pbState, answer) + '</div>';
}
/** no terms = no due date: the link goes to the ONE terms editor (CB Finance › Terms) — never a second one here */
function bkSetTermsLink() {
  return '<a data-b="set-terms" data-cbsid="CMP044-C02" href="/finance.html#terms" onclick="event.stopPropagation()">' + esc(tx('Set terms')) + '</a>';
}
/** Status, said once: Paid · Part paid · Unpaid, then WHY the bill needs you in ONE chip — "On hold · no tax invoice" — with who and when on hover (the hold is a press that opens the mark's sheet). `tab` = the tab asking: the days late are a column, so "overdue" is a chip only on Needs you */
function bkBillStatus(row, onTab) {
  var markRow = row.mark,
    held = markRow && (markRow.class === 'hold' || markRow.kind === 'on_hold'),
    reasons = row.reasons || [],
    warn = 'style="color:var(--warn-2)"',
    parts = ['<span class="optchip" data-b="standing-' + row.status + '"' + (row.status === 'unpaid' ? '' : ' style="color:var(--grey)"') + '>' + esc(tx(BK_STANDING[row.status])) + '</span>'];
  if (reasons.indexOf('no_tax_invoice') >= 0 && held) {
    /* ONE chip (W15-113): the hold and its reason inside it; heldBy and when on hover, the press opens the mark's sheet */
    var heldBy = [markRow.by_name, markRow.at ? bkDate(markRow.at) : ''].filter(Boolean).join(' · ');
    var chipCode = 'CMP058-B02'; /* the Day book's mark chip code (cap-mark.js), held in a name so the census reads it on the element */
    parts.push('<button type="button" class="optchip" data-cbsid="' + chipCode + '" data-mk="open" data-id="' + esc(row.entry_id) + '" data-class="hold" data-b="mark-hold" ' + warn + ' title="' + esc(heldBy) + '" aria-label="' + esc(tx('On hold') + ' · ' + tx('No tax invoice')) + '">‖ ' + esc(tx('On hold')) + ' · ' + esc(tx('no tax invoice')) + '</button>');
  } else {
    reasons.forEach(function (reason) {
      if (reason === 'overdue' && onTab !== 'needs') return; /* the Days overdue column already says it */
      if (reason === 'no_terms' && onTab !== 'needs') return; /* the Due date cell says it, with the link that fixes it */
      var word = { disputed: 'In dispute', query: '? Open query', held: '‖ On hold', no_tax_invoice: '⚠ No tax invoice', no_terms: 'No terms', overdue: 'Overdue' }[reason];
      parts.push('<span class="optchip" data-b="why-' + reason + '" ' + warn + '>' + esc(tx(word)) + '</span>');
    });
    if (parts.length > 2) parts.splice(2, parts.length - 2, '<span class="optchip" data-b="why-more" title="' + esc(reasons.map(function (r) { return tx(BK_NEED[r][0]); }).join(' · ')) + '">+' + (parts.length - 2) + '</span>'); /* one why-chip says the main reason; the rest are a count (the full list on hover) */
  }
  if (parts.length > 1 && row.status === 'unpaid') parts.shift(); /* "Unpaid" is every open bill: said only when nothing else is */
  return '<span class="bk-st" style="display:inline-flex;gap:4px;flex-wrap:nowrap">' + parts.join(' ') + '</span>';
}
/** its next level (W15-108): an info strip (the age bands — each one a filter —, what has no due date, what is disputed) and then the bills as a real sub-table under its own header. The bands and every figure are the server's (GET /party/:id/bills); `list` = the CBList key that asked (R76: Collections is 'fin-collect'; the bills read repaints THAT list) */
function bkDuesNext(party, currency, list) {
  var follow = party.follow_up || null,
    money = function (value) {
      return esc(bkMoney(Math.abs(Number(value)), currency));
    };
  var notes =
    (follow && Number(follow.no_terms_minor)
      ? '<span data-b="no-due-date">' + esc(txf('{amt} has no due date — aged from the bill date', { amt: bkMoney(Number(follow.no_terms_minor), currency) })) + '</span>'
      : '') +
    (party.disputed_minor ? '<span data-b="disputed">' + esc(tx('Disputed')) + ' <b>' + money(party.disputed_minor) + '</b></span>' : '');
  return (
    '<div data-testid="dues-next-' + esc(party.party_id) + '">' +
    (notes ? '<div class="cbl-nstrip" data-b="dues-notes">' + notes + '</div>' : '') +
    bkPartyBillsHTML(party.party_id, list || 'dues', currency) +
    '</div>'
  );
}
/* the Dues tab: what parties owe you and what you owe, grouped by side */
/**
 * ⭐ W15-114 · WHO NEEDS YOU, AND WHY — the server's reasons (api lib/books-needs), in the shopkeeper's words. Nothing is counted here: a party row carries `needs { bills, <reason>: n, overdue_minor }`
 * and the answer carries the same by side. [word of a chip, the one action it offers]. A chip is a press: it opens that party on its Needs you tab, narrowed to that reason.
 */
var BK_NEED = {
  disputed: ['disputed', 'Answer'],
  query: ['open query', 'Answer'],
  held: ['on hold', 'Release'],
  no_tax_invoice: ['no tax invoice', 'Attach'],
  no_terms: ['no terms', 'Set terms'],
  overdue: ['overdue', 'Pay']
};
var BK_NEED_ORDER = ['disputed', 'query', 'held', 'no_tax_invoice', 'no_terms', 'overdue'];
/** the chips of one party row: up to three reasons with their counts, then "+n"; each opens the party on its fix. Nothing wraps (one line a row). */
function bkNeedChips(party) {
  var needTotals = party.needs || {},
    kinds = BK_NEED_ORDER.filter(function (kind) {
      return Number(needTotals[kind]) > 0;
    });
  if (!kinds.length) return '';
  var shown = kinds.slice(0, 3).map(function (kind) {
    return (
      '<button type="button" class="cbl-nchip bk-need" data-cbsid="CMP033-B01"' + bkMountAttribute('CMP033') + ' data-b="need-' + kind + '" data-testid="need-' + kind + '-' + esc(party.party_id) + '" onclick="bkNeedOpen(event,\'' + esc(party.party_id) + "','" + kind + '\')">' +
      '<b>' + esc(String(needTotals[kind])) + '</b> ' + esc(tx(BK_NEED[kind][0])) + '</button>'
    );
  });
  if (kinds.length > 3) shown.push('<span class="bk-need-more" data-b="need-more">+' + (kinds.length - 3) + '</span>');
  return '<span class="bk-needs" style="display:inline-flex;gap:4px;flex-wrap:nowrap;white-space:nowrap">' + shown.join('') + '</span>';
}
/** how urgent a party is: what is late (most money first), then how many bills need it */
function bkNeedRank(p) {
  var n = p.needs || {};
  return (Number(n.overdue_minor) || 0) * 1000 + (Number(n.bills) || 0);
}
/** the answer's own sums for the page's side (receivables = customers, payables = suppliers; no side = both): { parties, bills, <reason>, overdue_minor } */
function bkNeedsSum(side) {
  var all = (BK.duesRaw && BK.duesRaw.needs) || {},
    keys = side === 'rcv' ? ['customer'] : side === 'pay' ? ['supplier'] : ['customer', 'supplier'],
    out = { parties: 0, bills: 0, overdue_minor: 0 };
  BK_NEED_ORDER.forEach(function (kind) {
    out[kind] = 0;
  });
  keys.forEach(function (key) {
    var part = all[key];
    if (!part) return;
    Object.keys(out).forEach(function (field) {
      if (part[field] == null) {
        if (field === 'overdue_minor') out[field] = null;
      } else if (out[field] != null) out[field] += Number(part[field]);
    });
  });
  return out;
}
/** the Needs filter of the Dues list: any reason, or one of them (the header line presses it) */
function bkNeedFilters() {
  return [
    {
      key: 'need',
      label: tx('Needs'),
      all: tx('Needs'),
      match: function (p, v) {
        return v === 'any' ? !!(p.needs && p.needs.bills > 0) : !!(p.needs && Number(p.needs[v]) > 0);
      },
      options: [{ v: 'any', label: tx('Needs you') }].concat(
        BK_NEED_ORDER.map(function (kind) {
          return { v: kind, label: tx(BK_NEED[kind][0]) };
        })
      )
    }
  ];
}
/** one chip of the header line: pressed when the list is narrowed to that reason */
function bkNeedsChip(kind, text, pressed) {
  return '<button type="button" class="attn-chip" data-cbsid="CMP033-B01"' + bkMountAttribute('CMP033') + ' data-b="needs-head-' + kind + '" data-testid="needs-head-' + kind + '" aria-pressed="' + (pressed === kind) + '" onclick="bkNeedsHeadPress(\'' + kind + '\')">' + text + '</button>';
}
/** the chips of the header line, the server's counts only: parties that need you, then each reason with its count (overdue says the amount) */
function bkNeedsChips(sum, side, currency, pressed) {
  var words = side === 'pay' ? ['supplier', 'suppliers'] : side === 'rcv' ? ['customer', 'customers'] : ['party', 'parties'],
    parts = [];
  if (sum.parties) parts.push(bkNeedsChip('any', esc(txn('{count} ' + words[0] + ' needs you', '{count} ' + words[1] + ' need you', sum.parties)).replace(/^([0-9][0-9,.]*)/, function (n) { return '<b>' + n + '</b>'; }), pressed));
  [
    ['no_tax_invoice', tx('no tax invoice')],
    ['no_terms', tx('without terms')],
    ['disputed', tx('disputed')],
    ['query', tx('open queries')],
    ['held', tx('on hold')]
  ].forEach(function (reason) {
    if (sum[reason[0]]) parts.push(bkNeedsChip(reason[0], '<b>' + sum[reason[0]] + '</b> ' + esc(reason[1]), pressed));
  });
  if (sum.overdue) parts.push(bkNeedsChip('overdue', '<b>' + (sum.overdue_minor != null ? esc(bkMoney(sum.overdue_minor, currency)) : sum.overdue) + '</b> ' + esc(tx('overdue')), pressed));
  return parts;
}
/** the header line of Receivables / Payables: "12 suppliers need you · 8 no tax invoice · 3 no terms · A$4,210 overdue" — each a filter (a press again clears it) */
function bkNeedsHead() {
  var host = document.getElementById('bk_needs_head');
  if (!host) return;
  var side = BK.duesSide,
    sum = bkNeedsSum(side),
    currency = (BK.duesRaw && BK.duesRaw.currency) || bkCur(),
    list = typeof CBList !== 'undefined' && CBList.get('dues'),
    pressed = (list && list.state().filt.need) || '';
  var parts = bkNeedsChips(sum, side, currency, pressed);
  if (typeof CBAttention !== 'undefined' && CBAttention.styles) CBAttention.styles(); /* the one strip look (Day book, Ledgers, BAS and this line) */
  host.innerHTML = '<div class="attn-strip" role="status" data-testid="needs-head">' + (parts.length ? parts.join(' · ') : '<span class="attn-ok" data-b="needs-ok">✓ ' + esc(tx('Nobody needs you')) + '</span>') + '</div>';
}
/** a press on the header line: the list narrows to that reason; the same press again puts it back */
function bkNeedsHeadPress(kind) {
  var list = CBList.get('dues');
  if (!list) return;
  list.filter('need', list.state().filt.need === kind ? '' : kind);
  bkNeedsHead();
}
/** a chip on a party row: that party opens on its Needs you tab, narrowed to the reason */
function bkNeedOpen(event, pid, kind) {
  event.stopPropagation();
  bkPbSet(pid, { tab: 'needs', why: kind, paid: false, band: '' });
  var list = CBList.get('dues');
  if (list) list.open(pid, true);
}
/** the rows of the Dues list from the one /dues read the page holds: the parties with a balance, on the page's own side (Receivables also holds the advances paid; Payables holds no one who owes you) */
function bkDuesRows(onlySide) {
  var open = ((BK.duesRaw && BK.duesRaw.parties) || []).filter(function (item) {
    return Number(item.balance_minor);
  });
  if (onlySide)
    open = open.filter(function (item) {
      return onlySide === 'rcv' ? bkDuesSide(item) === 'rcv' || bkDuesAdvance(item) : bkDuesSide(item) === 'pay' && !bkDuesAdvance(item);
    });
  return open;
}
/** ⚑ Needs you for the Dues list: the server's count of parties, each row's own needs, the most late first (W15-116 / W15-117) */
function bkDuesNeeds() {
  return {
    count: function () {
      return bkNeedsSum(BK.duesSide).parties;
    },
    match: function (p) {
      return !!(p.needs && p.needs.bills > 0);
    },
    rank: function (p) {
      return bkNeedRank(p);
    }
  };
}
/** They owe you / You owe: one head each, the customers first, with the party count and the net beside it */
function bkDuesGroup(c) {
  return {
    default: 'side',
    order: ['rcv', 'adv', 'pay'],
    by: function (p) {
      if (bkDuesAdvance(p)) return [tx('Advance paid'), 'adv'];
      var s = bkDuesSide(p);
      return [tx(s === 'rcv' ? 'To collect' : 'To pay'), s];
    },
    fig: function (rows) {
      return (
        txn('{count} party', '{count} parties', rows.length) +
        ' · ' +
        bkOwes(
          rows.reduce(function (total, item) {
            return total + Number(item.balance_minor || 0);
          }, 0),
          c
        )
      );
    },
    headTid: function (k) {
      return 'dues-side-' + k;
    }
  };
}
/** the text a Dues row is found by: party no · name · the label · the balance as the shop writes it */
function bkDuesSearchText(p, c) {
    return [
      p.party_no,
      p.name,
      bkPartyLabel(p.party_id, p.name),
      p.balance_minor ? (Math.abs(p.balance_minor) / Math.pow(10, bkDec(c))).toFixed(bkDec(c)) : ''
    ].join(' ');
}
/** the Dues list's sorts: party no · name · total due · oldest due · needs */
function bkDuesSorts() {
  return [
    {
      key: 'party',
      label: tx('Party no'),
      cmp: function (left, right) {
        return String(left.party_no || '').localeCompare(String(right.party_no || ''), undefined, { numeric: true });
      }
    },
    {
      key: 'name',
      label: tx('Name'),
      cmp: function (left, right) {
        return String(left.name || '').localeCompare(String(right.name || ''));
      }
    },
    {
      key: 'due',
      label: tx('Total due'),
      cmp: bkSortBy(function (p) {
        return Math.abs(p.balance_minor || 0);
      }, true)
    },
    {
      key: 'oldest',
      label: tx('Oldest due'),
      cmp: function (left, right) {
        return String(left.oldest_due || '9999').localeCompare(String(right.oldest_due || '9999'));
      }
    },
    {
      key: 'needs',
      label: tx('Needs'),
      cmp: function (left, right) {
        return bkNeedRank(right) - bkNeedRank(left);
      }
    }
  ];
}
/** the Side filter (both sides on the full list; none on Receivables or Payables, which are one side) */
function bkDuesSideFilter(onlySide) {
  return (onlySide
    ? []
    : [
        {
          key: 'side',
          label: tx('Side'),
          all: tx('Both sides'),
          options: [
            { v: 'rcv', label: tx('To collect') },
            { v: 'pay', label: tx('To pay') }
          ],
          match: function (party, filterValue) {
            return filterValue === 'pay' ? bkDuesSide(party) === 'pay' && !bkDuesAdvance(party) : bkDuesSide(party) === 'rcv' || bkDuesAdvance(party);
          }
        }
      ]);
}
/** the Dues list (Receivables / Payables when `onlySide` is given): who owes what, their needs and the oldest due, from the one /dues read */
async function bkDues(body, onlySide) {
  /* onlySide 'rcv' | 'pay' (CB Accounts: Receivables / Payables) opens the same list on that side */
  try {
    var reply = await api('booksDues');
    var c = reply && reply.currency;
    bkDuesStore(reply);
    BK.duesSide = onlySide || null;
    body.innerHTML = '<div class="attn-col"><div id="bk_needs_head"></div><div id="bkl_dues" data-testid="dues-list"></div></div>';
    bkNeedsHead();
    CBList.mount(document.getElementById('bkl_dues'), {
      key: 'dues',
      t: tx,
      rows: function () {
        return bkDuesRows(BK.duesSide);
      },
      /* W15-116 / W15-117: ⚑ Needs you — the server's count of parties, the row's own needs, the most late first; Next › opens the next party */
      needs: bkDuesNeeds(),
      id: function (p) {
        return p.party_id;
      },
      columns: bkDuesCols(c),
      rowTid: function (p) {
        return 'dues-' + p.party_id;
      },
      /* They owe you / You owe: one head each, the customers first */
      group: bkDuesGroup(c),
      search: function (p) {
        return bkDuesSearchText(p, c);
      },
      sorts: bkDuesSorts(),
      filters: bkNeedFilters().concat(bkDuesSideFilter(onlySide)),
      next: function (p) {
        return bkDuesNext(p, c);
      },
      empty: { title: tx(onlySide === 'rcv' ? 'Nobody owes you money' : onlySide === 'pay' ? 'You owe nobody' : 'Nothing is due') }
    });
  } catch (e) {
    body.innerHTML = bkErr(e);
  }
}
/**
 * ⭐ THE SHOP'S YEAR IS THE SERVER'S — ONE PLACE (WX-R2R + CX2, 2026-10-13; one painter since INT5b): GET /books/health answers
 * year { fiscal_year, from, start_month } — the pack on the Country setup's year start, the same default the TB / P&L / BS reads take. BK.year
 * holds it (accounts.html boot · bkHealthLoad). Its first month, else the pack's (shopReg — CX2), else April (an older api, a page without
 * helpers.js); the name is the pack's (split '2026-27' · single '2026'). Period 1 is that first month — what the server numbers.
 */
function bkFyPack() {
  return typeof shopReg === 'function' ? shopReg() : null;
}
/* N4 (NEUTRAL-CORE): the month the shop's year starts - the books setting (BK.year.start_month), else its pack's; no April of our own. Before either has arrived (the books open only after the server's gate) the calendar year (1) stands in, as a shape not a statement */
function bkYearStart() {
  var r = bkFyPack(),
    m = Number(BK.year && BK.year.start_month) || (r && r.fiscalYear && r.fiscalYear.startMonth);
  return m >= 1 && m <= 12 ? m : 1;
}
function bkFyStartYear(date) {
  return date.getMonth() + 1 >= bkYearStart() ? date.getFullYear() : date.getFullYear() - 1;
}
function bkFyName(y) {
  var r = bkFyPack(),
    single = r && r.fiscalYear && r.fiscalYear.label ? r.fiscalYear.label === 'single' : bkYearStart() === 1;
  return single ? String(y) : y + '-' + String((y + 1) % 100).padStart(2, '0');
}
function bkFyNow() {
  return BK.year && BK.year.fiscal_year ? String(BK.year.fiscal_year) : bkFyName(bkFyStartYear(new Date()));
}
function bkFyFrom() {
  return (BK.year && BK.year.from) || bkFyStartYear(new Date()) + '-' + String(bkYearStart()).padStart(2, '0') + '-01';
}
/** the twelve month names of the shop's year, period 1 first (April for India, July for Australia, January for a calendar year) */
function bkMonths() {
  var s = bkYearStart() - 1,
    list = monthNames('short');
  return list.map(function (_, index) {
    return list[(s + index) % 12];
  });
} /* T2-WEBPRIMS: the words are CBLocale's (helpers.js monthNames) */
/** the year before `fy` in the server's own labels ("2026-27" → "2025-26"; a calendar year "2026" → "2025") */
function bkFyPrev(fy) {
  var y = Number(String(fy).slice(0, 4)) - 1;
  return String(fy).length === 4 ? String(y) : y + '-' + String((y + 1) % 100).padStart(2, '0');
}
/** the words beside a month's Lock button: the server's why when it may not lock, and (ACC-204) the tax period the month ends in while its close has not run — GET /periods row `return`, a pack whose return the ledgers close: "BAS FY27 Q1 (Jul–Sep 2026) not closed yet" */
function bkLockNote(row, periodNo, mayLock, whyNot) {
  var taxPeriod = row && row.return,
    note = !mayLock && whyNot ? '<span data-testid="lk-why-' + periodNo + '" style="color:var(--grey);font-size:var(--fs-1)">' + esc(tx(whyNot)) + '</span>' : '';
  if (!taxPeriod || taxPeriod.closed) return note;
  return note + ' <span data-testid="lk-return-' + periodNo + '" style="color:var(--grey);font-size:var(--fs-1)">' + esc(txf('{form} {label} not closed yet', { form: taxPeriod.form, label: taxPeriod.label })) + '</span>';
}
/** the year and month a day falls in — the server's own row first (GET /periods start_date…end_date), the shop's year start when the month has no row yet */
function bkPeriodOfDay(dayKey, lockState) {
  var text = Object.keys((lockState && lockState.info) || {}).filter(function (item) {
    var x = lockState.info[item];
    return x.start_date && x.end_date && String(x.start_date).slice(0, 10) <= dayKey && dayKey <= String(x.end_date).slice(0, 10) && Number(x.period) >= 1;
  })[0];
  if (text) return { fy: text.split('|')[0], p: Number(text.split('|')[1]) };
  var startMonth = bkYearStart(),
    month = Number(dayKey.slice(5, 7)),
    y = month >= startMonth ? Number(dayKey.slice(0, 4)) : Number(dayKey.slice(0, 4)) - 1;
  return { fy: bkFyName(y), p: ((month - startMonth + 12) % 12) + 1 };
}
/** "This FY (Jul–Jun)" / "Whole year (Jul–Jun)" — the word with the shop's own months, ONE catalogue sentence (CX2) */
function bkFyWord(w) {
  var m = bkMonths();
  return txf((w || 'This FY') + ' ({a}–{b})', { a: tx(m[0]), b: tx(m[11]) });
}
/** the period's status is a server enum — it becomes a word through CBLockWords.stateWord (ONE word per state, E13), never shown raw */
/** W15-71: the seat that only READS the client's books (an auditor under a grant): every write control is left out, not greyed; the server refuses the writes too */
function bkReadOnlySeat() {
  var seat = typeof CBBooksActing !== 'undefined' && CBBooksActing.current ? CBBooksActing.current() : null;
  return !!seat && seat.role === 'auditor';
}
function bkIsOwner() {
  return typeof SESSION !== 'undefined' && !!SESSION && SESSION.role === 'entity' && !bkReadOnlySeat();
} /* the server enforces it; this only decides who is offered the buttons */
var BK_PERIOD_SYM = { open: '○', soft_locked: '🔒', hard_locked: '⛔' };
/**
 * ⭐ ONE READ of the twelve months: GET /api/books/periods (no fy) answers every month of every year the data holds, with its
 * status. BK.lk = { rows: { 'fy|p': status }, years: [newest first], fy: the year on screen }. A month with no row is open (the
 * server makes a year's months the first time an entry lands in it). Month lock and Packs both read it; the year they show is one.
 */
async function bkPeriodsLoad() {
  var reply = await api('booksPeriods'),
    rows = {},
    info = {},
    yrs = {};
  ((reply && reply.periods) || []).forEach(function (x) {
    var p = Number(x.period);
    if (p >= 1 && p <= 12) {
      rows[x.fiscal_year + '|' + p] = x.status;
      info[x.fiscal_year + '|' + p] = x;
      yrs[x.fiscal_year] = 1;
    }
  });
  yrs[bkFyNow()] = 1;
  var L = (BK.lk = BK.lk || {});
  L.rows = rows;
  L.info = info;
  L.years = Object.keys(yrs).sort().reverse();
  if (!L.fy || !yrs[L.fy]) L.fy = bkFyNow();
  return L;
}
/* a select of the financial years for the Month lock and Packs tabs */
function bkFyPicker(id, tid, sty) {
  return (
    '<select data-cbsid="CMP041-S01"' + bkMountAttribute('CMP041') + ' class="inp" id="' +
    id +
    '" data-testid="' +
    tid +
    '" aria-label="' +
    esc(tx('Financial year')) +
    '" onchange="bkFyPick(this.value)" style="' +
    (sty || 'flex:1 1 110px;min-width:0') +
    '">' +
    BK.lk.years
      .map(function (y) {
        return '<option value="' + esc(y) + '"' + (y === BK.lk.fy ? ' selected' : '') + '>' + esc(y) + '</option>';
      })
      .join('') +
    '</select>'
  );
}
function bkFyPick(v) {
  BK.lk.fy = v;
  if (BK.tab === 'lock') bkLockRowsPaint();
  else bkPackCtlPaint();
}
/** W15-97: the words of a month's lock history and of the month a Lock waits for are lock-words.js' (the auditor's Months say the same) */
function bkLockWho(x, st) {
  return CBLockWords.whoOf(x, st);
}
function bkLockWhyWords(x, kind) {
  return CBLockWords.whyOf(x, kind, bkMonths().map(tx)) || (x && x[kind] && x[kind].why) || '';
}
/* the Month lock tab: the year picker and its twelve month rows */
async function bkLockView(body) {
  try {
    await bkPeriodsLoad();
  } catch (e) {
    body.innerHTML = bkErr(e);
    return;
  }
  var own = bkIsOwner();
  body.innerHTML =
    '<div style="display:flex;flex-direction:column;gap:8px;max-width:900px">' +
    '<label style="max-width:420px">' +
    tx('Financial year') +
    bkFyPicker('lk_fy', 'lk_fy', 'width:100%') +
    '</label>' +
    '<div id="lk_rows" data-testid="lk_rows"></div>' +
    '<div id="lk_fx"></div>' /* FX1 (cap-fx.js): the foreign balances of the month to lock next — revalue, then lock */ +
    '<div id="lk_foot" data-testid="lk_note" style="color:var(--grey);font-size:var(--fs-1)"></div>' +
    '<div id="lk_out" data-testid="lk_out" style="font-size:var(--fs-1)"></div></div>';
  bkLockRowsPaint();
}
/** what the server says about one month: may it be locked, may it open again, who did what, and the sentence when it may not */
function bkLockRule(info, state) {
  var mayLock = !info || !info.lock || info.lock.may,
    lockWhy = info && info.lock && info.lock.why ? bkLockWhyWords(info, 'lock') : '',
    openMay = !info || !info.reopen || info.reopen.may !== false;
  return {
    may: mayLock,
    openMay: openMay,
    why: lockWhy,
    who: bkLockWho(info, state),
    blocked: state === 'open' ? !mayLock : state === 'soft_locked' && !openMay,
    blockWhy: state === 'open' ? lockWhy : bkLockWhyWords(info, 'reopen')
  };
}
/** one month's row of the lock table: its state with who did it, the entries and sales, and the button the SERVER says may be pressed (owner only) with the reason it may not */
function bkLockRowHTML(item, index, isOwner) {
  var lock = BK.lk,
    month = index + 1,
    state = lock.rows[lock.fy + '|' + month] || 'open',
    info = (lock.info || {})[lock.fy + '|' + month] || null,
    rule = bkLockRule(info, state),
    buttons = bkLockButtonsHTML(isOwner, state, month, rule);
  return (
    '<tr data-testid="lk-row-' +
    month +
    '"><th scope="row">' +
    tx(item) +
    '</th><td data-testid="lk-state-' +
    month +
    '" data-state="' +
    esc(state) +
    '">' +
    (BK_PERIOD_SYM[state] || '') +
    ' ' +
    esc(CBLockWords.stateWord(state)) +
    bkLockWhoHTML(month, rule.who) +
    '</td><td data-testid="lk-figs-' +
    month +
    '" class="num lk-ent">' +
    esc(String((info && info.entries) || 0)) +
    '</td><td class="num lk-sales">' +
    (info && info.sales_minor ? bkMoney(info.sales_minor) : esc(tx('No sales'))) +
    '</td><td class="lk-act">' +
    buttons +
    (buttons ? bkLockWhyHTML(month, state, info, rule.blocked, rule.blockWhy) : '') +
    '</td></tr>'
  );
}
/** the Lock button of an open month, or Open again + Close for good of a soft-locked one (owner only); a refused one is disabled with the server's sentence */
function bkLockButtonsHTML(isOwner, st, month, rule) {
  var b = '',
    mayLock = rule.may,
    openMay = rule.openMay,
    lockWhy = rule.why,
    blockWhy = rule.blockWhy;
  if (isOwner && st === 'open')
    b =
      '<button data-cbsid="CMP042-B07"' + bkMountAttribute('CMP042') + ' type="button"' + (mayLock ? ' class="supact-pri"' : '') + ' data-testid="lk-lock-' +
      month +
      '"' +
      (mayLock
        ? " onclick=\"bkLockDo('lock'," + month + ')" title="' + esc(tx('Stops entries · reopens with a reason')) + '"'
        : ' disabled style="opacity:.55;cursor:not-allowed" title="' + esc(tx(lockWhy)) + '"') +
      '>🔒 ' +
      tx('Lock') +
      '</button>';
  if (isOwner && st === 'soft_locked')
    b =
      '<button data-cbsid="CMP042-B08"' + bkMountAttribute('CMP042') + ' type="button" data-testid="lk-unlock-' +
      month +
      '"' + (openMay ? ' onclick="bkLockReopen(' + month + ')"' : ' disabled style="opacity:.55;cursor:not-allowed" title="' + esc(tx(blockWhy)) + '"') + '>🔓 ' +
      tx('Open again') +
      '</button> <button data-cbsid="CMP042-B09"' + bkMountAttribute('CMP042') + ' type="button" data-testid="lk-hard-' +
      month +
      '" onclick="bkLockDo(\'hard\',' +
      month +
      ')">⛔ ' +
      tx('Close for good') +
      '</button>';
  return b;
}
/** who locked or opened the month, and its history (the first row's line, the notes and the full list on a fold) */
function bkLockWhoHTML(p, who) {
  return (
    (who.line || who.note ? '<div class="lk-who" data-testid="lk-who-' + p + '">' + esc([who.line, who.note].filter(Boolean).join('. ')) + '</div>' : '') +
    (who.all.length > 1 ? '<details class="lk-hist" data-testid="lk-hist-' + p + '"><summary>' + esc(txf('History ({n})', { n: who.all.length })) + '</summary><ul>' + who.all.map(function (words) { return '<li>' + esc(words) + '</li>'; }).join('') + '</ul></details>' : '')
  );
}
/** the line under a refused button: why it is blocked, shortened, with the return still to close when that is the reason */
function bkLockWhyHTML(p, st, x, blocked, blockWhy) {
  return (
    (!blocked ? '' : '<button type="button" class="lk-why" aria-expanded="false" data-testid="lk-why-' + p + '" data-short="' + esc(tx(blockWhy)) + '" data-full="' + esc(tx(blockWhy) + (st === 'open' && x && x.return && !x.return.closed ? ' ' + txf('{form} {label} not closed yet', { form: x.return.form, label: x.return.label }) : '')) + '" title="' + esc(tx(blockWhy)) + '" onclick="bkLockWhy(this)">' + esc(tx(blockWhy)) + '</button>')
  );
}
/**
 * the twelve months, April to March: state as a word and a symbol, its entries and sales, and the actions the SERVER says it may do (owner only).
 * M157: ONE rule, read from GET /periods - Lock for a finished month, oldest first (else greyed with the server's sentence); the Reason box and the foot
 * follow reopen.may, so the page never promises what the server will refuse.
 */
function bkLockRowsPaint() {
  var el = document.getElementById('lk_rows'),
    L = BK.lk,
    own = bkIsOwner();
  if (!el) return;
  if (typeof fxLockLine === 'function') fxLockLine();
  var foot = document.getElementById('lk_foot');
  if (foot) foot.textContent = !own ? '' : tx('A locked month opens again with a reason, asked when you press Open again. Close for good never opens.');
  var rows = bkMonths()
    .map(function (item, index) {
      return bkLockRowHTML(item, index, own);
    })
    .join('');
  el.innerHTML =
    '<style>@media(max-width:620px){.lk-t thead{display:none}.lk-t,.lk-t tbody{display:block}.lk-t tr{display:grid;grid-template-columns:auto 1fr auto;gap:2px 10px;align-items:center;padding:6px 4px;border-bottom:1px solid var(--line)}.lk-t td,.lk-t th{padding:0!important}.lk-t .lk-ent{display:none}.lk-t .lk-act{grid-column:1 / -1}.lk-t .lk-sales{text-align:right}}.lk-t button.lk-why{background:none!important;border:0!important;box-shadow:none!important;padding:0!important;min-height:0!important;font:inherit!important;font-size:var(--fs-1)!important;font-weight:400!important;color:var(--grey)!important;text-align:left;cursor:pointer;display:inline-block;vertical-align:middle;margin-left:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%}@media(max-width:620px){.lk-t button.lk-why{display:block;margin:2px 0 0;max-width:100%}}.lk-t button.lk-why[aria-expanded=true]{white-space:normal;max-width:100%}.lk-who{color:var(--grey);font-size:var(--fs-1);font-weight:400}.lk-hist{font-size:var(--fs-1);color:var(--grey)}.lk-hist summary{cursor:pointer;display:inline-block}.lk-hist ul{margin:2px 0 0;padding-left:16px}.lk-box{max-height:calc(100vh - 405px);min-height:160px;overflow:auto}body:has(#acting-band) .lk-box{max-height:calc(100vh - 465px)}@media(max-width:620px){.lk-box{max-height:calc(100vh - 480px)}}.lk-t th{position:sticky;top:0;background:var(--surface,#fff);z-index:1}.lk-t td,.lk-t th{padding:3px 8px;text-align:left;vertical-align:middle}.lk-t .num{text-align:right}.lk-t button{padding:3px 10px;min-height:0}</style>' +
    '<div class="lk-box" data-testid="lk-box"><table class="tbl lk-t" data-testid="lk-table" style="width:100%;border-collapse:collapse;font-size:var(--fs-1)"><thead><tr><th>' +
    tx('Month') +
    '</th><th>' +
    tx('State') +
    '</th><th class="num">' +
    tx('Entries') +
    '</th><th class="num">' +
    tx('Sales') +
    '</th><th></th></tr></thead><tbody>' +
    rows +
    '</tbody></table></div>';
}
/** the reason line opens in place to the full sentence (tap or Enter), shut again on the next press */
function bkLockWhy(node) {
  var open = node.getAttribute('aria-expanded') !== 'true';
  node.setAttribute('aria-expanded', open ? 'true' : 'false');
  node.textContent = node.getAttribute(open ? 'data-full' : 'data-short');
}
/**
 * W15-97 · OPEN AGAIN asks its reason in its own popup, beside the button that sends it (the box used to sit under the twelve rows, apart from the action). The reason is kept in the trail with the name and the day; Cancel sends nothing.
 */
function bkLockReopen(period) {
  var monthName = tx(bkMonths()[period - 1] || String(period));
  /* where-used: out-of-scope the mount is bkDialogMount(6): the host screen's own code plus -U26, so it cannot be one literal */
  ui.dialog({
    mount: bkDialogMount(6),
    pop: 'POP092',
    titleText: txf('Open {m} again?', { m: monthName + ' ' + String((((BK.lk.info || {})[BK.lk.fy + '|' + period]) || {}).start_date || BK.lk.fy).slice(0, 4) }),
    bodyStyle: 'display:flex;flex-direction:column;gap:8px',
    body:
      '<label>' + tx('Why are you opening it again?') + '<input class="inp" data-cbsid="CMP040-I01"' + bkMountAttribute('CMP040') + ' id="lk_why" data-testid="lk_why" maxlength="200" autocomplete="off" placeholder="' + esc(tx('Needed to open a month again')) + '"></label>' +
      '<div id="lk_whyout" data-testid="lk-whyout" role="alert" style="color:var(--warn-2)"></div>',
    footerHtml:
      '<button type="button" data-cbsid="CMP003-B01"' + bkMountAttribute('CMP003') + ' onclick="closeModal()">' + tx('Cancel') + '</button>' +
      '<button type="button" class="supact-pri" data-cbsid="CMP042-B08"' + bkMountAttribute('CMP042') + ' data-testid="lk-reopen-go" onclick="bkLockReopenGo(' + period + ')">' + tx('Open again') + '</button>'
  });
}
function bkLockReopenGo(period) {
  var reason = String((document.getElementById('lk_why') || {}).value || '').trim(),
    out = document.getElementById('lk_whyout');
  if (!reason) {
    if (out) out.textContent = tx('Say why — the reason is kept');
    return;
  }
  closeModal();
  return bkLockDo('unlock', period, reason);
}
/* lock or unlock one month, asking the server and flipping only that row */
async function bkLockDo(what, period, reason) {
  var lockState = BK.lk,
    fiscalYear = lockState.fy,
    node = reason || '',
    out = document.getElementById('lk_out');
  var monthName = tx(bkMonths()[period - 1] || String(period));
  if (what === 'unlock' && !node.trim()) return; /* the reason is asked in bkLockReopen, beside the button that sends it */
  /* ⭐ M64: through CBAction — ONE write per month at a time (whichever of its buttons), Close for good asks first in the
     page's own dialog (Cancel sends nothing), and the outcome is said in lk_out beside the months */
  var btn = document.querySelector('[data-testid="lk-' + what + '-' + period + '"]');
  return CBAction.run(
    btn,
    function () {
      return api(what === 'unlock' ? 'booksUnlock' : 'booksLock', { params: { fy: fiscalYear, p: period }, body: { reason: node, hard: what === 'hard' } });
    },
    {
      key: 'lk-' + fiscalYear + '-' + period,
      out: 'lk_out',
      failed: tx('Could not change it'),
      confirm:
        what === 'hard'
          ? { title: tx('Close for good?'), body: esc(txf('{m} {fy} will never open again.', { m: monthName, fy: fiscalYear })), yes: tx('Close for good') }
          : { title: txf('Lock {m} {fy}?', { m: monthName, fy: fiscalYear }), body: esc(tx('No entries can be added to it. It opens again with a reason.')), yes: tx('Lock'), danger: false }, /* E12: Lock is a commit, so it asks first in the library's confirm */
      /* after the server answers: flip the one month row, then reload the periods */
      outcome: function (answer) {
        var status = answer && answer.period && answer.period.status;
        if (status) lockState.rows[fiscalYear + '|' + period] = status; /* flip the ROW, never the whole list */
        if (lockState.fy === fiscalYear) bkLockRowsPaint();
        bkPeriodsLoad()
          .then(function () {
            if (BK.lk.fy === fiscalYear) bkLockRowsPaint();
          })
          .catch(function (failure) {
            bkQuiet('periods-reload', failure);
          }); /* M157: the server's may/why moves with the lock (the next month opens up, the reason box follows) */
        var element = document.getElementById('lk_out');
        if (element) element.textContent = txf('{m} {fy} · {s}', { m: monthName, fy: fiscalYear, s: status ? CBLockWords.stateWord(status) : tx('Done') });
      }
    }
  );
}
/**
 * ⚠️⚠️ A PACK IS ITS FILE (2026-09-30, review M10). Download saved the manifest — a list of names and fingerprints —
 * and "We have it" then told the server the shop holds its ledger files, which is the fact that later allows old
 * detail to be summarised away. So: Download fetches the real zip; "We have it" exists only for a pack that HAS a
 * file, and unless that file came down in this session the owner is asked first; a pack with no file says so and
 * offers neither.
 * ⭐ ONE reader of "has it a file": has_file when the server says it (on the row, or on GET /packs/:id beside `file`),
 * else the older `stored` / `download`. null = the row does not say — GET /packs/:id is asked before anything is offered.
 */
function bkPackHasFile(listedPack, reply) {
  var pick = function (source) {
    return !source ? null : typeof source.has_file === 'boolean' ? source.has_file : typeof source.stored === 'boolean' ? source.stored : null;
  };
  var hasFile = pick(reply);
  if (hasFile == null && reply) hasFile = pick(reply.pack);
  if (hasFile == null && reply && ('file' in reply || 'download' in reply)) hasFile = !!(reply.file || reply.download);
  if (hasFile == null) hasFile = pick(listedPack);
  return hasFile;
}
/* the Packs tab: the handover packs built so far and the form to build one */
async function bkPacks(body) {
  try {
    var rr = await Promise.all([api('booksPacks'), bkPeriodsLoad()]),
      r = rr[0];
    BK.packRows = {};
    BK.packGot = BK.packGot || {};
    var rows = ((r && r.packs) || [])
      .map(function (item) {
        BK.packRows[item.pack_id] = item;
        var has = bkPackHasFile(item, null),
          id = esc(item.pack_id);
        var ack = item.acknowledged_at
          ? '✓ ' + esc(bkDate(item.acknowledged_at))
          : has === false
            ? '<span data-testid="pack-nofile-' + id + '" style="color:var(--warn-2)">' + tx('No file · make it again') + '</span>'
            : '<div class="supacts" style="margin:0"><button data-cbsid="CMP042-B10"' + bkMountAttribute('CMP042') + ' data-testid="pack-ack-' +
              id +
              '" onclick="bkPackAck(\'' +
              id +
              '\')">' +
              tx('We have it') +
              '</button></div>';
        var get =
          has === false
            ? ''
            : '<div class="supacts" style="margin:0"><button data-cbsid="CMP042-B11"' + bkMountAttribute('CMP042') + ' data-testid="pack-get-' +
              id +
              '" onclick="bkPackGet(\'' +
              id +
              '\')">' +
              tx('Download') +
              '</button></div>';
        return (
          '<tr data-testid="pack-' +
          id +
          '"><td>' +
          esc(tx({ month: 'Month', year: 'Year', exit: 'Exit' }[item.kind] || item.kind || '')) +
          '</td><td>' +
          esc(item.fiscal_year || '') +
          (item.period ? ' · ' + esc(item.period) : '') +
          '</td><td>' +
          esc(bkDate(item.created_at)) +
          '</td>' +
          '<td class="mono" title="' +
          esc(item.sha256 || '') +
          '">' +
          esc(String(item.sha256 || '').slice(0, 10)) +
          '</td>' +
          '<td>' +
          ack +
          '</td><td>' +
          get +
          '</td></tr>'
        );
      })
      .join('');
    body.innerHTML =
      '<div id="pk_ctl" data-testid="pk_ctl"></div>' +
      '<div id="pk_out" data-testid="pk_out" style="font-size:var(--fs-1)"></div>' +
      (rows
        ? bkTable([{ t: tx('Kind') }, { t: tx('Period') }, { t: tx('Made') }, { t: tx('Fingerprint') }, { t: tx('Handed over') }, { t: '' }], rows)
        : emptyState('📦', tx('No packs yet'), ''));
    bkPackCtlPaint();
  } catch (e) {
    body.innerHTML = bkErr(e);
  }
}
/** the pack controls: the year, then a month that IS locked (a pack is made from a locked month). No locked month → the sentence is the button to Month lock */
function bkPackCtlPaint() {
  var el = document.getElementById('pk_ctl'),
    L = BK.lk;
  if (!el) return;
  var locked = bkMonths()
    .map(function (item, index) {
      return [index + 1, item, L.rows[L.fy + '|' + (index + 1)]];
    })
    .filter(function (x) {
      return x[2] === 'soft_locked' || x[2] === 'hard_locked';
    });
  el.innerHTML =
    '<div class="supacts" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:9px">' +
    bkFyPicker('pk_fy', 'pk_fy') +
    '<select data-cbsid="CMP041-S01"' + bkMountAttribute('CMP041') + ' class="inp" id="pk_p" data-testid="pk_p" aria-label="' + esc(tx('Month')) + '" onchange="bkPackPick()" style="flex:1 1 110px;min-width:0"' +
    '><option value="">' +
    esc(tx('Month')) +
    '</option><option value="year">' +
    esc(bkFyWord('Whole year')) +
    '</option>' +
    locked
      .map(function (x) {
        return '<option value="' + x[0] + '">' + esc(tx(x[1])) + '</option>';
      })
      .join('') +
    '</select>' +
    '<button data-cbsid="CMP042-B12"' + bkMountAttribute('CMP042') + ' class="supact-pri" data-testid="pk_build" id="pk_build" onclick="bkPackBuild()" disabled>' +
    tx('Make a pack') +
    '</button></div>' +
    (locked.length
      ? ''
      : '<div class="supacts" style="margin-bottom:9px"><button data-cbsid="CMP042-B13"' + bkMountAttribute('CMP042') + ' data-testid="pk_lockfirst" onclick="bkTab(\'lock\')">🔒 ' +
        tx('Lock a month first') +
        '</button></div>');
}
function bkPackPick() {
  var node = document.getElementById('pk_build');
  if (node) node.disabled = !(document.getElementById('pk_p') || {}).value;
}
/* build a handover pack for the chosen year and month */
async function bkPackBuild() {
  var out = document.getElementById('pk_out');
  var node = (document.getElementById('pk_fy') || {}).value,
    v = (document.getElementById('pk_p') || {}).value,
    p = parseInt(v, 10);
  if (!p && v !== 'year') return; /* the button is off until a month or the whole year is chosen; this is the same fence for a key press */
  try {
    await api('booksPackBuild', { body: p ? { kind: 'month', fiscal_year: node, period: p } : { kind: 'year', fiscal_year: node, period: null } });
    bkTab('packs');
  } catch (e) {
    if (out) out.textContent = bkWhy(e, tx('Could not make it'));
  }
}
/** the one sentence for a pack with nothing to download — said, and the row stops offering Download / We have it */
function bkPackNoFile(id) {
  if (BK.packRows && BK.packRows[id]) BK.packRows[id].has_file = false;
  var out = document.getElementById('pk_out');
  if (out) out.innerHTML = '<span data-testid="pack-nofile-said" style="color:var(--warn-2)">' + esc(tx('No file for this pack · make it again')) + '</span>';
  var tr = document.querySelector('[data-testid="pack-' + id + '"]');
  if (tr && !tr.querySelector('[data-testid^="pack-nofile-"]')) {
    /* flip the ROW, never the whole list */
    tr.children[4].innerHTML = '<span data-testid="pack-nofile-' + esc(id) + '" style="color:var(--warn-2)">' + tx('No file · make it again') + '</span>';
    tr.children[5].innerHTML = '';
  }
}
/**
 * ⭐ THE PACK ITSELF comes down — the zip at /packs/:id/file, as bytes, with the session (api() speaks JSON only). The
 * manifest is still shown beside it: the file list and fingerprints are what make the zip checkable.
 */
async function bkPackGet(id) {
  var out = document.getElementById('pk_out');
  await bkOnce('packget:' + id, document.querySelector('[data-testid="pack-get-' + id + '"]'), async function () {
    try {
      var reply = await api('booksPackGet', { params: { id: id } });
      if (bkPackHasFile(BK.packRows && BK.packRows[id], reply) === false) {
        bkPackNoFile(id);
        return;
      }
      var base = (typeof CFG !== 'undefined' && CFG.API_BASE) || '';
      var res = await fetch(base + EP.booksPackFile.p.replace(':id', encodeURIComponent(id)), {
        cache: 'no-store',
        headers: CBBooksActing.tokenHeader()
      });
      if (res.status === 409 || res.status === 404) {
        bkPackNoFile(id);
        return;
      } /* made while storage was not connected */
      if (!res.ok) throw new Error('');
      var blob = await res.blob();
      if (!blob || !blob.size) {
        bkPackNoFile(id);
        return;
      }
      bkPackDownload(res, blob, id);
      BK.packGot = BK.packGot || {};
      BK.packGot[id] = true; /* this session holds the file — "We have it" is now a plain yes */
      if (out) out.innerHTML = bkPackManifestHtml(reply);
    } catch (e) {
      if (out) out.textContent = bkWhy(e, tx('Could not download it'));
    }
  });
}
/* record that a handover pack was received, after the owner says it was saved */
async function bkPackAck(id) {
  await bkOnce('packack:' + id, document.querySelector('[data-testid="pack-ack-' + id + '"]'), async function () {
    try {
      if (!(BK.packGot && BK.packGot[id])) {
        /* not downloaded in this session: is there a file at all? then the owner says so themselves */
        var reply = await api('booksPackGet', { params: { id: id } });
        if (bkPackHasFile(BK.packRows && BK.packRows[id], reply) !== true) {
          bkPackNoFile(id);
          return;
        }
        var yes = await new Promise(function (res) {
          confirmAsk(
            tx('Saved this pack?'),
            esc(tx('Download it first if you have not')),
            tx('We have it'),
            function () {
              res(true);
            },
            false,
            function () {
              res(false);
            }
          );
        });
        if (!yes) return;
      }
      await api('booksPackAck', { params: { id: id }, body: {} });
      bkTab('packs');
    } catch (e) {
      toast(bkWhy(e, tx('Could not record it')));
    }
  });
}
/* the Opening balances page lives in app/cap-opening.js (obView): a start date, the grid, the live Difference, what is saved */
function bkOpeningView(body) {
  return typeof obView === 'function' ? obView(body) : null;
}

/* ══ 4 · CHEQUES AND WHAT IS WAITING — the two things that were on no screen (2026-09-30, review M12) ═════════ */
/**
 * ⚠️⚠️ A CHEQUE COULD NEVER CLEAR. Both screens record one, the server holds it correctly until it clears — and no
 * screen ever called the step, so the customer's balance never moved. The steps are offered wherever a held cheque
 * is listed: in the Receive form the moment it is recorded, and on the Ledger's Cheques view.
 * ⭐ The server decides every step (a refusal is shown in its own words); this only remembers what it was told.
 * ⚠️ WHAT IS LISTED: GET /api/books/cheques (the cheques still held, from any session or the counter), plus the ones
 * recorded in this session. Each server row carries `next` — the steps the engine accepts NOW; BK_CHQ_NEXT is only
 * the fallback for a row that came without it, and says what the engine says: received → deposited → cleared or
 * bounced; a cleared cheque later dishonoured is an owner reversal, not a step (engines v1.8.1).
 */
BK.cheques = BK.cheques || {};
var BK_CHQ_WORD = { received: 'Received', deposited: 'Deposited', cleared: 'Cleared', bounced: 'Bounced' };
var BK_CHQ_NEXT = { received: ['deposited'], deposited: ['cleared', 'bounced'], cleared: [], bounced: [] };
function bkChequeStatus(s) {
  s = String(s || '').replace(/^cheque_/, '');
  return BK_CHQ_WORD[s] ? s : 'received';
}
function bkChequeNext(c) {
  return c && Array.isArray(c.next) ? c.next : BK_CHQ_NEXT[c && c.status] || [];
}
/* keep one cheque's latest state in the BK.cheques cache */
function bkChequeKeep(c) {
  var id = c && (c.payment_id || c.id);
  if (!id) return null;
  var was = BK.cheques[id] || {};
  BK.cheques[id] = {
    payment_id: id,
    party_id: c.party_id || was.party_id || null,
    name: c.name || c.party_name || was.name || '',
    amount_minor: c.amount_minor != null ? c.amount_minor : was.amount_minor,
    currency: c.currency || was.currency || null,
    cheque_no: c.cheque_no || c.number || was.cheque_no || '',
    cheque_bank: c.cheque_bank || c.bank || was.cheque_bank || '',
    cheque_date: c.cheque_date || c.date || was.cheque_date || null,
    status: bkChequeStatus(c.status || was.status),
    next: Array.isArray(c.next) ? c.next : c.status ? null : was.next || null,
    direction: c.direction || was.direction || 'in'
  }; /* T3-P1-MONEY (widened): in = received · out = written by the shop — CB Finance › Cheques groups on it; a recorded Receive is `in` */
  return BK.cheques[id];
}
/* the buttons for the steps a cheque may take next */
function bkChequeStepsHTML(c) {
  if (!c) return '';
  var id = esc(c.payment_id),
    next = bkChequeNext(c);
  return (
    '<span data-testid="chq-status-' +
    id +
    '" style="font-weight:600">' +
    tx(BK_CHQ_WORD[c.status]) +
    '</span>' +
    (next.length
      ? ' <span class="supacts" style="display:inline-flex;gap:6px;margin:0 0 0 8px">' +
        next
          .map(function (item) {
            /* class cbl-tbtn (T3-P1-MONEY): the list's own small button — a bare <button> wore the browser's colours and failed AA in Dark; outside a list the class has no rule */
            return (
              '<button data-cbsid="CMP042-B15"' + bkMountAttribute('CMP042') + ' type="button" class="cbl-tbtn" data-testid="chq-' +
              item +
              '-' +
              id +
              '" onclick="bkChequeStep(\'' +
              id +
              "','" +
              item +
              '\')">' +
              tx(BK_CHQ_WORD[item]) +
              '</button>'
            );
          })
          .join('') +
        '</span>'
      : '')
  );
}
/* move a cheque to its next step (deposit, clear, bounce), asking first for a bounce */
async function bkChequeStep(id, to) {
  var c = BK.cheques[id];
  if (!c || bkChequeNext(c).indexOf(to) < 0) return;
  /* a bounce puts the debt back (and reverses a cleared one) — asked first */
  var inForm = !!document.getElementById('pay_chq_steps');
  if (to === 'bounced') {
    var yes = await new Promise(function (res) {
      confirmAsk(
        tx('Cheque bounced?'),
        esc(tx('They owe this amount again')),
        tx('Bounced'),
        function () {
          res(true);
        },
        true,
        function () {
          res(false);
        }
      );
    });
    if (inForm) booksAfterPay(); /* the question took the Receive form's place — repaint the party behind it */
    if (!yes) return;
  }
  await bkOnce('chq:' + id, null, async function () {
    var node = function (t) {
      var element = document.getElementById('chq_out');
      if (element) element.textContent = t;
      else if (t) toast(t);
    };
    document.querySelectorAll('[data-testid^="chq-"][data-testid$="-' + id + '"]').forEach(function (item) {
      if (item.tagName === 'BUTTON') item.disabled = true;
    });
    try {
      await api('booksChequeStep', { params: { id: id }, body: { status: to } });
      c.status = to;
      c.next = null;
      node(''); /* the next steps are the engine's to say — the fallback table until the list is read again */
      if (to === 'cleared' || to === 'bounced') {
        delete BK.stmt[c.party_id];
        delete BK.owed[c.party_id];
        booksDuesLoad(true);
      }
    } catch (e) {
      node(bkWhy(e, tx('Could not change it')));
    }
    bkChequeRepaint(id);
  });
}
