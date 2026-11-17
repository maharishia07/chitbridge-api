/* cap-finance-returns.js — CB Finance · Returns (round T3-P1-MONEY): COUNTRY-FIRST. An Indian shop downloads the GSTR-1 / GSTR-3B files the server
 * already builds, for the month chosen; an AU / AE shop is told which return applies (BAS · VAT return) and where it is prepared (CB Accounts › GST);
 * a country whose pack has no return is told so; no country → Settings › Country. Loaded by finance.html after cap-finance.js.
 *
 * ⭐ REUSE (CLAUDE.md rule 1, named in the PR): api('me') (the shop's country — the read Home and Settings make; no ledger needed: India's return is the
 * rail's) · shopReg (helpers.js: the shop's pack, CBRegulation — never a second `country === 'IN'` for words) · gstrDownload (helpers.js: THE ONE download,
 * lifted from cap-admin.js misTaxExport) · monthNames (helpers.js) · bkToday (cap-books.js, the shop's day) · CBAction (M64 — a press, one file) · the
 * page's .card / .act / .inp / .hint (no new look) · finDenied.
 * ⭐ ONE CALCULATION (rule 2): nothing is summed here. The files are the server's (routes/tax.js → tax-lines gstr1 · gstr3b, the one builder); AU BAS /
 * AE VAT201 are books-period.taxReturn → engines gst-returns.returnFor, painted in CB Accounts — this tab builds no second return and shows no figure.
 * ⭐ NEW PATHS (rule 4): FR (this tab's state) · frMonths (the last twelve calendar months as a picker; the workshop's band has one typed month and
 * bkMonths is the fiscal year's names, not a picker) · frPaint.
 * ⚠️ Never error.message on a screen: a failure says what happened and offers Try again.
 * OWNS      the Returns tab of CB Finance: the country's return, the server's files and words painted (frLoad · frMount · frMonths · frCard · frPaint · frGet)
 * CALLED BY public/finance.html (script tag) · public/app/cap-finance.js (frLoad · frMount). Not loaded by app.html
 * FLOW      finance.html opens Returns → api('me') (the shop's country) → frPaint: India downloads the GSTR files (gstrDownload), AU / AE are told where the return is prepared → Try again on a failure
 * CARD      15-tax-and-country-packs/gst-returns-bas-vat
 */
'use strict';

var FR = { gen: 0, state: 'loading', code: null, pack: null };
var FR_SEE = 'Only the owner may see returns.';

async function frLoad(quiet) {
  var g = ++FR.gen;
  if (!quiet) {
    FR.state = 'loading';
    frPaint();
  }
  try {
    var reply = await api('me');
    if (g !== FR.gen) return;
    var e = (reply && reply.entity) || reply || {},
      code = e.country ? String(e.country).toUpperCase() : null;
    FR.code = code;
    FR.pack = code ? shopReg(code) : null;
    if (code && typeof SESSION !== 'undefined' && SESSION) SESSION.country = code; /* CX0: the pack's words reach this page too */
    FR.state = 'ready';
    ftNav();
  } catch (e2) {
    if (g !== FR.gen) return;
    if (e2 && e2.status === 403) {
      finDenied(FR_SEE, 'Returns');
      return;
    }
    FR.state = 'error';
  }
  frPaint();
}
function frRetry() {
  frLoad();
}

/** the last twelve calendar months, newest first, from the shop's day — value YYYY-MM, label in the reader's month words */
function frMonths() {
  var t = bkToday(),
    y = Number(t.slice(0, 4)),
    m = Number(t.slice(5, 7)),
    names = monthNames('short'),
    out = [];
  for (var index = 1; index <= 12; index++) {
    var mm = m - index,
      yy = y;
    while (mm < 1) {
      mm += 12;
      yy -= 1;
    }
    out.push({ v: yy + '-' + String(mm).padStart(2, '0'), label: names[mm - 1] + ' ' + yy });
  }
  return out;
}
function frCard(html, tid) {
  return '<div class="content"><div class="card" data-testid="' + tid + '" style="margin:0">' + html + '</div></div>';
}

function frPaint() {
  var node = document.getElementById('screen');
  if (!node) return;
  node.className = 'screen';
  if (FR.state === 'loading') {
    node.innerHTML = frCard('<div class="loadwrap"><span class="spin"></span>' + esc(tx('Loading…')) + '</div>', 'fr-loading');
    return;
  }
  if (FR.state === 'error') {
    node.innerHTML = frCard(
      '<h2>' +
        esc(tx('Could not read your country')) +
        '</h2><p>' +
        esc(tx('Nothing was lost.')) +
        '</p>' +
        '<button data-cbsid="CMP009" type="button" class="act" data-testid="fr-retry" onclick="frRetry()">' +
        esc(tx('Try again')) +
        '</button>',
      'fr-error'
    );
    return;
  }
  if (!FR.code) {
    node.innerHTML = frCard(
      '<h2>' +
        esc(tx('Country not set')) +
        '</h2><p>' +
        esc(tx('A return follows the country your shop keeps its books in.')) +
        '</p>' +
        '<a class="act" href="/settings.html#/country" data-testid="fr-country">' +
        esc(tx('Set the country')) +
        '</a>',
      'fr-nocountry'
    );
    return;
  }
  var pk = FR.pack;
  /* India's GSTR-1 / 3B are the RAIL's read (books-period.taxReturn refuses the ledgers for the IN pack the same way): the pack id decides, not a word */
  if (pk && pk.id === 'IN') {
    var months = frMonths();
    node.innerHTML = frCard(
      '<h2>' +
        esc(tx('GSTR-1 and GSTR-3B')) +
        '</h2><p>' +
        esc(tx('Read from the rail. Check in the offline tool before filing.')) +
        '</p>' +
        '<label style="display:flex;flex-direction:column;gap:4px;font-size:13.5px;font-weight:600">' +
        esc(tx('Month')) +
        '<select data-cbsid="FIN007-S01" class="inp" id="fr_month" data-testid="fr-month">' +
        months
          .map(function (x) {
            return '<option value="' + esc(x.v) + '">' + esc(x.label) + '</option>';
          })
          .join('') +
        '</select></label>' +
        '<div class="supacts"><button data-cbsid="FIN007-B01" type="button" class="act" data-testid="fr-gstr1" onclick="frGet(\'gstr1\',this)">' +
        esc(tx('GSTR-1 file')) +
        '</button>' +
        '<button data-cbsid="FIN007-B02" type="button" class="act quiet" data-testid="fr-gstr3b" onclick="frGet(\'gstr3b\',this)">' +
        esc(tx('GSTR-3B file')) +
        '</button></div>' +
        '<div id="fr_out" class="hint" role="status" data-testid="fr-out"></div>' +
        '<p class="hint" data-testid="fr-prepared">' +
        esc(tx('Prepared, not filed.')) +
        '</p>',
      'fr-gstr'
    );
    return;
  }
  if (pk && pk.returns && pk.returns.id) {
    node.innerHTML = frCard(
      '<h2 data-testid="fr-which">' +
        esc(pk.returns.short || pk.returns.id) +
        '</h2><p>' +
        esc(txf('{name}: prepared in Accounts, not here.', { name: pk.returns.name || pk.returns.id })) +
        '</p>' +
        '<a class="act" href="/accounts.html#gstclose" data-testid="fr-accounts">' +
        esc(tx('Open Accounts')) +
        '</a>',
      'fr-elsewhere'
    );
    return;
  }
  node.innerHTML = frCard(
    '<h2>' +
      esc(tx('No return built yet')) +
      '</h2><p data-testid="fr-none-why">' +
      esc(txf('Nothing is built for {country} yet.', { country: (pk && pk.name) || FR.code })) +
      '</p>',
    'fr-none'
  );
}
/** one press, one file: the server's JSON saved as gstr1-YYYY-MM.json / gstr3b-YYYY-MM.json (helpers.js gstrDownload) */
function frGet(form, btn) {
  var node = document.getElementById('fr_month'),
    month = node ? node.value : null;
  if (!month) return;
  return CBAction.run(
    btn,
    function () {
      return gstrDownload(month, form);
    },
    {
      key: 'fr-' + form,
      out: 'fr_out',
      failed: tx('Could not build the file'),
      done: tx('Downloaded'),
      outcome: function (name) {
        var element = document.getElementById('fr_out');
        if (element) element.textContent = tx('Saved as') + ' ' + name;
      }
    }
  );
}
function frMount(frame) {
  var node = document.getElementById('screen');
  if (!node) return;
  ftNav();
  frPaint();
  if (!frame) frLoad(FR.state === 'ready');
}
