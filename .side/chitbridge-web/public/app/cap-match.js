/* app/cap-match.js — THE THREE-WAY MATCH (lazy; ensureCap('match')).
 *
 * ⭐⭐⭐ THE SCREEN THE PRODUCT IS SOLD ON. PO ↔ GRN ↔ invoice is the oldest control in purchasing, and an ERP can only run it when
 * ONE company holds all three documents. Here the order is a chit we sent, the receipt is what our own door wrote, and the invoice is
 * either a chit they sent or the figure their paper bill carried — so the match happens ACROSS PARTIES, which is the thing no ERP can
 * do. See catalogue\PURCHASE-DESPATCH-SPEC-2026-09-08.md §11.
 *
 * ── ⚠️ IT NAMES A DIFFERENCE, IT NEVER RESOLVES ONE ─────────────────────────────────────────────────────────────
 * What was ordered, what was counted and what was charged are three CLAIMS. This screen puts them side by side with the reason the
 * person at the door gave, and stops. Deciding between them is a conversation between two parties — a dispute — and CB takes no side
 * in it. A screen that quietly "corrected" a receipt to match an invoice would destroy the only number the shop actually witnessed.
 *
 * Backend: GET /api/till/match (routes/till.js — deliberately outside the till key scope: a counter records what it sees and must
 * never read what the shop pays its suppliers).
 
 * OWNS      the Match screen of the workshop: the three-way match of order · receipt · invoice across parties (matchScreen · matchLoad · matchCard · matchDetail) and raising a dispute from a difference (matchDispute · matchDisputeSend)
 * CALLED BY public/app.html only (CAP_OF match → ensureCap('match'), and capScreen('matchScreen') for UI.nav 'match'): no other page loads it, so it is app.html-only (SUPPORT)
 * FLOW      matchScreen → matchLoad (GET /api/till/match) → matchCard → matchDetail (matchReceivedFig · matchGapNote) → matchDispute (draft) → matchDisputeSend → POST /api/chits/:chit_id/disputes
 * CARD      03-disputes-service-and-register/three-way-match
 */
if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    matchList: { m: 'GET', p: '/api/till/match', ok: 'y' },
    matchDispute: { m: 'POST', p: '/api/chits/:chit_id/disputes', ok: 'y' }
  });
}

var MATCH = { rows: null, days: 90, only: 'differs', open: null, busy: false };

/** the four states a purchase can be in, in the words a shopkeeper would use */
var MATCH_WORDS = {
  awaited: { label: 'Not arrived', colour: 'var(--grey)', why: 'Nothing has come in against this order yet.' },
  open: { label: 'Part arrived', colour: 'var(--blue)', why: 'Some of it is here. The rest is still owed.' },
  agreed: { label: 'Agrees', colour: 'var(--ok)', why: 'What you ordered, what you counted and what you were charged all agree.' },
  differs: { label: 'Does not agree', colour: 'var(--warn)', why: 'Something does not match. The lines below say what, and why.' }
};

async function matchLoad(force) {
  if (MATCH.rows && !force) return;
  MATCH.busy = true;
  try {
    var reply = await api('matchList', { query: { days: MATCH.days } });
    MATCH.rows = (reply && reply.orders) || [];
  } catch (e) {
    MATCH.rows = [];
    MATCH.error = (e && e.message) || String(e);
  }
  MATCH.busy = false;
  /**
   * ⚠️ WAS renderApp(), AND IT WOULD HAVE EATEN SOMEBODY'S TYPING. A loader resolves whenever the network
   * does — which may be while a person is halfway through a modal — and renderApp() repaints the shell
   * underneath them. bgRenderApp() paints identically when nothing is open and YIELDS when something is.
   * ⭐ The rule already had a guard (e2e/modal-safe-repaint.cjs, 81 loaders across 54 files); this was the
   * one file still failing it. [[feedback-loader-never-repaints-open-form]]
   */
  if (UI.nav === 'match') bgRenderApp();
}

function matchScreen() {
  if (!MATCH.rows && !MATCH.busy) {
    matchLoad();
  }
  var rows = MATCH.rows || [];
  var counts = { differs: 0, open: 0, agreed: 0, awaited: 0 };
  rows.forEach(function (item) {
    counts[item.verdict] = (counts[item.verdict] || 0) + 1;
  });
  var shown = rows.filter(function (item) {
    return MATCH.only === 'all' || item.verdict === MATCH.only;
  });

  var chip = function (key, label) {
    var on = MATCH.only === key;
    return (
      '<button data-cbsid="BUS003-B01" class="pill' +
      (on ? ' on' : '') +
      '" data-testid="match-chip-' +
      key +
      '" onclick="MATCH.only=\'' +
      key +
      '\';renderApp()">' +
      esc(label) +
      (key === 'all' ? '' : ' <b>' + (counts[key] || 0) + '</b>') +
      '</button>'
    );
  };

  var head =
    '<div class="mhd" style="padding:14px 16px 6px">' +
    '<div class="t">⚖️ ' +
    esc(tx('Match')) +
    '</div>' +
    '<div class="s">' +
    esc(tx('What you ordered, what actually arrived, and what you were charged — side by side.')) +
    '</div></div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;padding:0 16px 12px">' +
    chip('differs', tx('Does not agree')) +
    chip('open', tx('Part arrived')) +
    chip('agreed', tx('Agrees')) +
    chip('awaited', tx('Not arrived')) +
    chip('all', tx('Everything')) +
    '<span style="flex:1"></span>' +
    '<select data-cbsid="BUS003-S01" class="pill" data-testid="match-days" onchange="MATCH.days=Number(this.value);matchLoad(true)">' +
    [30, 90, 180, 365]
      .map(function (item) {
        return '<option value="' + item + '"' + (MATCH.days === item ? ' selected' : '') + '>' + txf('last {n} days', { n: String(item) }) + '</option>';
      })
      .join('') +
    '</select></div>';

  if (MATCH.busy && !MATCH.rows)
    return '<div style="flex:1;min-width:0;min-height:0;overflow:auto" data-testid="match-screen">' + head + '<div style="padding:30px;text-align:center;color:var(--grey)"><span class="spin"></span></div></div>';
  if (MATCH.error) return '<div style="flex:1;min-width:0;min-height:0;overflow:auto" data-testid="match-screen">' + head + '<div style="padding:22px;color:var(--warn)">' + esc(MATCH.error) + '</div></div>';

  var body = shown.length
    ? shown.map(matchCard).join('')
    : '<div style="padding:34px 18px;color:var(--grey);text-align:center">' +
      (rows.length
        ? esc(tx('Nothing in this state. Try another chip above.'))
        : esc(tx('No purchase orders yet. Send an order to a supplier, then receive the goods at the counter — this screen fills itself.'))) +
      '</div>';

  return '<div style="flex:1;min-width:0;min-height:0;overflow:auto" data-testid="match-screen">' + head + '<div style="padding:0 16px 24px">' + body + '</div></div>';
}

function matchCard(o) {
  var w = MATCH_WORDS[o.verdict] || MATCH_WORDS.open;
  var open = MATCH.open === o.chit_id;
  return (
    '<div style="border:1px solid var(--line);border-radius:12px;margin-bottom:10px;overflow:hidden" data-testid="match-order">' +
    '<div data-cbsid="BUS003-B02" role="button" tabindex="0" aria-expanded="' +
    (open ? 'true' : 'false') +
    '" style="display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();this.click()}" onclick="MATCH.open=' +
    (open ? 'null' : "'" + esc(o.chit_id) + "'") +
    ';renderApp()">' +
    '<span style="font-weight:800;flex:1">' +
    esc(o.party || tx('a supplier')) +
    '<div class="u" style="font-weight:400;color:var(--grey);font-size:var(--fs-1)">' +
    esc(String(o.at).slice(0, 10)) +
    (o.subject ? ' · ' + esc(o.subject) : '') +
    '</div></span>' +
    '<span style="color:' +
    w.colour +
    ';font-weight:800;font-size:var(--fs-2)" data-testid="match-verdict">' +
    esc(w.label) +
    '</span>' +
    '<span style="opacity:.5">' +
    (open ? '▾' : '▸') +
    '</span></div>' +
    (open ? matchDetail(o) : '') +
    '</div>'
  );
}

/**
 * CTR-248 (api #1194, OPS-87): goods counted in a unit other than the ordered one sit beside the total, never summed into it, so
 * the cell says both (short 6 · counted in another unit ...) and never hides one behind the other. One segment per other unit; no conversion is guessed, a person settles it.
 * Returns '' for an ordinary line, so the caller falls through to short / excess.
 */
function matchOtherUnits(item) {
  if (!item.counted_in_another_unit || !Array.isArray(item.other_units) || !item.other_units.length) return '';
  return item.other_units
    .map(function (part) {
      var seen = function (n) {
        return n == null ? '—' : n;
      };
      return txf('counted in another unit: {unit} mine {mine} / theirs {theirs}', { unit: part.unit, mine: seen(part.mine), theirs: seen(part.theirs) });
    })
    .join(' · ');
}

/**
 * The words of a line's Difference: the shortfall or excess in the ORDERED unit, then the other-unit counts (the api flags
 * counted_in_another_unit whenever other_units is non-empty, so 10 box ordered / 4 box + 2 dozen received says both). '' = agrees.
 */
function matchDiffWords(item) {
  var parts = [];
  if (item.difference < 0) parts.push(txf('short {n}', { n: String(-item.difference) }));
  else if (item.difference > 0) parts.push(txf('excess {n}', { n: String(item.difference) }));
  var other = matchOtherUnits(item);
  if (other) parts.push(other);
  if (item.billed_more) parts.push(tx('Billed more than received'));
  return parts.join(' · ');
}

/**
 * OPS-100/351 (api #1243): the quantity the supplier BILLED, painted beside Received. Unknown stays unknown: a null billed with a unit says "billed in <unit>" (their bill is in
 * another unit, no conversion guessed); a missing field (api not landed) or no figure at all says nothing, never 0.
 */
function matchBilledWords(item) {
  if (item.billed != null) return txf('billed {n}', { n: String(item.billed) }) + (item.billed_unit ? ' ' + item.billed_unit : '');
  return item.billed_unit ? txf('billed in {unit}', { unit: item.billed_unit }) : '';
}

/** the Received cell of one line: the count, then the billed words small and grey beneath it when there are any */
function matchReceivedCell(item) {
  var billed = matchBilledWords(item);
  return (
    '<td style="padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums">' +
    item.received +
    (billed ? '<div style="color:var(--grey);font-size:var(--fs-1)" data-testid="match-billed">' + esc(billed) + '</div>' : '') +
    '</td>'
  );
}

/** the small count of their billed lines that match nothing we ordered, under the money note; '' when none (or the api has not said) */
function matchBilledUnmatched(order) {
  return order.billed_unmatched > 0
    ? '<div style="color:var(--warn);font-size:var(--fs-1);margin-bottom:12px" data-testid="match-billed-unmatched">' +
        esc(txf('Billed lines not on your order: {n}', { n: String(order.billed_unmatched) })) +
        '</div>'
    : '';
}

/** the Difference cell of one line: the words, warn-coloured when there are any, else "agrees" in ok-colour; the door's reason after */
function matchDiffCell(item) {
  var words = matchDiffWords(item);
  return (
    '<td style="padding:6px 8px;color:' +
    (words ? 'var(--warn)' : 'var(--ok)') +
    ';font-weight:' +
    (words ? '700' : '400') +
    '">' +
    (words ? esc(words) : tx('agrees')) +
    (item.reason ? ' · ' + esc(item.reason) : '') +
    '</td>'
  );
}

function matchDetail(o) {
  var rows = o.lines
    .map(function (item) {
      return (
        '<tr data-testid="match-line">' +
        '<td style="padding:6px 8px">' +
        esc(item.name) +
        '</td>' +
        '<td style="padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums">' +
        item.ordered +
        ' ' +
        esc(item.unit) +
        '</td>' +
        matchReceivedCell(item) +
        matchDiffCell(item) +
        '</tr>'
      );
    })
    .join('');

  /**
   * ⭐ THE THREE FIGURES, AND WHERE EACH CAME FROM. "Invoiced" is either a chit they sent or the total somebody keyed off their paper
   * bill at the door — and the screen SAYS WHICH, because a figure whose source is unknown is not evidence.
   */
  return (
    '<div style="border-top:1px solid var(--line);padding:12px 14px">' +
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px">' +
    matchFig(tx('Ordered'), fmtMoney(o.ordered_total, myCur(), '—'), tx('what you asked for')) +
    matchReceivedFig(o) +
    matchFig(tx('Invoiced'), fmtMoney(o.invoiced_total, myCur(), '—'), o.invoiced_from ? esc(o.invoiced_from) : tx('no bill of theirs yet')) +
    '</div>' +
    matchGapNote(o) +
    matchBilledUnmatched(o) +
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:var(--fs-2)">' +
    '<thead><tr style="color:var(--grey);text-align:left">' +
    '<th style="padding:4px 8px">' +
    esc(tx('Line')) +
    '</th>' +
    '<th style="padding:4px 8px;text-align:right">' +
    esc(tx('Ordered')) +
    '</th>' +
    '<th style="padding:4px 8px;text-align:right">' +
    esc(tx('Received')) +
    '</th>' +
    '<th style="padding:4px 8px">' +
    esc(tx('Difference')) +
    '</th></tr></thead>' +
    '<tbody>' +
    rows +
    '</tbody></table></div>' +
    (o.receipts.length
      ? '<div style="color:var(--grey);font-size:var(--fs-1);margin-top:10px">' +
        esc(tx('Receipts:')) +
        ' ' +
        o.receipts
          .map(function (item) {
            return esc(item.no || '') + (item.their_bill_no ? ' (' + esc(tx('their bill')) + ' ' + esc(item.their_bill_no) + ')' : '');
          })
          .join(' · ') +
        '</div>'
      : '') +
    '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
    (o.verdict === 'differs'
      ? '<button data-cbsid="BUS003-B03" class="composebtn" data-testid="match-dispute" onclick="matchDispute(\'' +
        esc(o.chit_id) +
        '\')">⚑ ' +
        esc(tx('Raise a dispute')) +
        '</button>'
      : '') +
    '<button data-cbsid="BUS003-B04" class="pill" onclick="openChit(\'' +
    esc(o.chit_id) +
    '\')">' +
    esc(tx('Open the order')) +
    '</button>' +
    '</div>' +
    '<div style="color:var(--grey);font-size:var(--fs-1);margin-top:10px">' +
    esc(tx('What you counted is never changed to match their bill. Both figures stay, and the difference is yours to settle with them.')) +
    '</div></div>'
  );
}

/**
 * ⭐ "RECEIVED" IN THE SAME TERMS AS "INVOICED" (OPS-83). A bill's total is what they CHARGE, tax in, so beside it the door's count is painted tax in too:
 * the api's received_with_tax (the receipts' carried taxable + tax, read through lib/their-bill). Only a receipt older than that carries no such figure;
 * then the pre-tax count stands, and says so, and the api gives no gap to compare it with.
 */
function matchReceivedFig(order) {
  var taxed = order.received_with_tax != null;
  return matchFig(
    tx('Received'),
    fmtMoney(taxed ? order.received_with_tax : order.received_total, myCur(), '—'),
    taxed ? tx('what your own door counted, tax in') : tx('what your own door counted, before tax')
  );
}

/**
 * the money note under the three figures, worded from the api's money_code (never from the sign alone): another currency is said, never compared; a round-off is calm,
 * not a warning; a gap is named only once every line has closed (while goods are still short, the gap is the goods' news, not the bill's). '' when there is nothing to say.
 */
function matchGapNote(order) {
  var gap = order.money_gap,
    code = order.money_code,
    closed = order.lines.every(function (item) {
      return item.state === 'agreed';
    });
  var words =
    code === 'currency_mismatch'
      ? tx('Their bill is in another currency, so it is not compared.')
      : !closed || gap == null || gap === 0
      ? ''
      : code === 'round_off'
      ? txf('Their bill is {v} off: their round-off.', { v: inr(Math.abs(gap)) })
      : gap > 0
      ? txf('You counted {v} more than they billed.', { v: inr(gap) })
      : txf('They billed {v} more than you counted.', { v: inr(-gap) });
  if (!words) return '';
  return (
    '<div style="background:var(--warn-tint,rgba(200,120,0,.12));border-radius:8px;padding:9px 11px;margin-bottom:12px;font-weight:700;color:' +
    (code === 'round_off' ? 'var(--grey)' : 'var(--warn)') +
    '" data-testid="match-gap">' +
    words +
    '</div>'
  );
}

function matchFig(label, value, note) {
  return (
    '<div style="border:1px solid var(--line);border-radius:10px;padding:10px">' +
    '<div style="color:var(--grey);font-size:var(--fs-1)">' +
    esc(label) +
    '</div>' +
    '<div style="font-weight:800;font-size:var(--fs-4);font-variant-numeric:tabular-nums">' +
    value +
    '</div>' +
    '<div style="color:var(--grey);font-size:var(--fs-1)">' +
    note +
    '</div></div>'
  );
}

/**
 * ⭐ A DISPUTE IS RAISED WITH THE EVIDENCE ALREADY IN IT. The reason field is filled from what the screen can see — which lines, by
 * how much, and the reason the person at the door gave — so the supplier is answering a specific claim rather than "there is a
 * problem". A dispute nobody can act on is worse than a phone call.
 */
function matchDispute(chit_id) {
  var o = (MATCH.rows || []).filter(function (x) {
    return x.chit_id === chit_id;
  })[0];
  if (!o) return;
  var list = o.lines.filter(function (item) {
    return matchDiffWords(item) !== '';
  });
  var draft = list
    .map(function (item) {
      return (
        item.name +
        ': ordered ' +
        item.ordered +
        ' ' +
        item.unit +
        ', received ' +
        item.received +
        (matchBilledWords(item) ? ', ' + matchBilledWords(item) : '') +
        ' (' +
        matchDiffWords(item) +
        ')' +
        (item.reason ? ' — ' + item.reason : '')
      );
    })
    .join('\n');
  if (o.money_gap && o.money_code !== 'round_off')
    draft += '\n' + (o.money_gap > 0 ? 'We counted ' + inr(o.money_gap) + ' more than billed.' : 'Billed ' + inr(-o.money_gap) + ' more than we counted.');

  modal(
    '<div class="mhd"><div class="t">⚑ ' +
      esc(tx('Raise a dispute')) +
      '</div><div class="s">' +
      esc(o.party || '') +
      ' · ' +
      esc(tx('they see this, and both figures stay as they are')) +
      '</div></div>' +
      '<div class="mbody">' +
      '<label>' +
      esc(tx('What is wrong')) +
      '</label>' +
      '<textarea data-cbsid="BUS003-T01" id="match_reason" rows="6" style="width:100%" data-testid="match-dispute-reason">' +
      esc(draft) +
      '</textarea>' +
      '<div style="color:var(--grey);font-size:var(--fs-1);margin-top:8px">' +
      esc(tx('This goes to them as a quantity dispute against this order. Nothing you counted is changed by raising it.')) +
      '</div>' +
      '<div class="mfoot"><button data-cbsid="CMP003" class="pill" onclick="closeModal()">' +
      esc(tx('Cancel')) +
      '</button>' +
      '<button data-cbsid="BUS003-B05" class="composebtn" data-testid="match-dispute-send" onclick="matchDisputeSend(\'' +
      esc(chit_id) +
      '\')">' +
      esc(tx('Raise it')) +
      '</button></div>' +
      '</div>'
  );
}

async function matchDisputeSend(chit_id) {
  var node = document.getElementById('match_reason');
  var reason = ((node && node.value) || '').trim();
  if (reason.length < 10) {
    toast(tx('Say a little more about what is wrong.'));
    return;
  }
  var o = (MATCH.rows || []).filter(function (x) {
    return x.chit_id === chit_id;
  })[0];
  try {
    await api('matchDispute', { params: { chit_id: chit_id }, body: { category: 'quantity', reason: reason, target_entity_id: (o && o.party_id) || null } });
    closeModal();
    toast(tx('Raised. It is on the order, and they can see it.'));
    matchLoad(true);
  } catch (e) {
    toast(tx('Could not raise it') + ': ' + ((e && e.message) || e));
  }
}
