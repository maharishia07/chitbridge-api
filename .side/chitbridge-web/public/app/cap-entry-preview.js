/* cap-entry-preview.js — ＋ ENTRY: the preview round trip (ask the server to preview the journal, read its answer, check the date).
 * OWNS      the field's label and value (enFieldLabel, enValueOf) · the question before a debit note (enAskWords, enAsk) · the preview body (enBody) · the server's refusals and warnings as the sheet shows them (enWords, enSeen) · enPreview, enPaint2, enCheckDate, enFixGo; moved out of cap-entry.js (2026-11-17, size ratchet; behaviour unchanged)
 * CALLED BY accounts.html and finance.html (<script src>, after cap-entry.js: it reads EN and the en* painters declared there) · cap-entry.js (enNext, enPick, enSave call enPreview)
 * FLOW      a field changes → enPreview → enBody → enAsk (POST /api/books/preview) → enSeen → enPaint2 draws step 4; Save (cap-entry.js) is enabled only when the server said balanced and refused nothing
 * CARD      16-finance/manual-entry
 * THE PAGE HOLDS NO RULES AND COMPUTES NO MONEY: every figure, refusal and warning is the server's.
 */
/** what the sheet holds for a field now ('' when nothing yet) */
function enValueOf(key) {
  return EN.v[key] == null ? '' : EN.v[key];
}
/** the label a field is asked with: its own, the shared one, or the plain word for its kind (the key when none) */
function enFieldLabel(field) {
  var k = field.key;
  return tx(
        field.label ||
          EN_LABEL[k] ||
          {
            party: 'Who',
            ledger: 'Which ledger',
            bank: 'Which bank',
            asset_class: 'What kind',
            loan: 'Which loan',
            amount: 'How much',
            date: 'Date',
            paid_by: 'Paid by',
            doc_no: 'Bill / receipt no.',
            photo: 'Photo of the paper',
            narration: 'Note',
            text: k
          }[field.kind] ||
          k
      );
}
/**
 * R106: the question before a debit note is saved — the party line of the SERVER's preview (its dr_minor is the note's ₹; never summed here), the bill
 * and the supplier as the row names them. null when this event does not ask.
 */
function enAskWords() {
  var question = EN.ev && EN_ASK[EN.ev.kind];
  if (!question) return null;
  /* the preview's party line: books-manual preview names it `party` (the id) and its golden type is personal */
  var partyLine = ((EN.pv && EN.pv.lines) || []).filter(function (line) {
    return (line.party || line.party_id || line.type === 'personal') && Number(line.dr_minor) > 0;
  })[0];
  var amount = partyLine ? bkMoney(partyLine.dr_minor, EN.pv.currency) : tx('this difference'),
    supplierName = typeof bkPartyLabel === 'function' ? bkPartyLabel(EN.v.supplier || EN.v.party, '') : '';
  return {
    title: txf(question.title, { amt: amount, ref: EN.v.against_ref || '', who: supplierName || tx('the supplier') }),
    body: esc(txf(question.body, { amt: amount, who: supplierName || tx('the supplier') })),
    yes: tx(question.yes),
    danger: false
  };
}

/* ── the server's journal ── */
/* the app's api() refuses a second POST to the same route while one is out, so the page asks one preview at a time and the newest answer wins (EN.seq) */
function enAsk(body) {
  var go = function () {
    return api('booksPreview', { body: body });
  };
  var p = (EN.q || Promise.resolve()).then(go, go);
  EN.q = p.catch(function () {});
  return p;
}
/** the POST body for preview and save: the typed fields, with the amount parsed to minor units */
function enBody() {
  var b = { event: EN.ev.kind || EN.ev.id };
  Object.keys(EN.v).forEach(function (item) {
    if (EN.v[item] !== '' && EN.v[item] != null) b[item] = EN.v[item];
  });
  if (EN.v.amount != null && EN.v.amount !== '') {
    b.amount_minor = bkMoneyMinor(EN.v.amount);
    delete b.amount;
  }
  if (EN.ev.kind === 'journal')
    b.lines = EN.lines.map(function (item) {
      var o = { code: item.code };
      o[item.side === 'cr' ? 'cr_minor' : 'dr_minor'] = bkMoneyMinor(item.amt);
      return o;
    });
  else if (EN.items.length) b.lines = enItemsBody(); /* R106: the item lines, as typed */
  return b;
}
/** the server's refusals are plain sentences (and `code` for the first); give each a button back to the form. Nothing here decides anything. */
function enWords(list, code, dateStep) {
  return (list || []).map(function (item, index) {
    var c = index === 0 && code ? code : null,
      msg = typeof item === 'object' && item ? item.message : item;
    return {
      code: c || (typeof item === 'object' && item && item.code) || 'R' + index,
      message: String(msg),
      fix: c === 'PERIOD_LOCKED' ? { label: tx('Pick another date'), step: dateStep || 3, focus: 'date' } : { label: tx('Change it'), step: enSteps()[1] }
    };
  });
}
/** the preview answer reduced to what the sheet compares and saves against */
function enSeen(reply) {
  reply = reply || {};
  return {
    balanced: reply.balanced === true,
    voucher: reply.voucher ? { series: reply.voucher.series, kind: reply.voucher.type } : null,
    narration: (EN.v && EN.v.narration) || '' /* the API's preview echoes no note and no currency: the note is the one the person typed */,
    lines: (reply.lines || []).map(function (item) {
      return Object.assign({}, item, { name: item.ledger || item.name });
    }),
    refusals: enWords(typeof CBBooksActing !== 'undefined' ? CBBooksActing.refusals(reply.refusals) : reply.refusals, reply.code),
    warnings: enWords(reply.flags || reply.warnings, null).map(function (item, index) {
      return Object.assign(item, { code: 'FLAG' + index });
    })
  };
}
/** ask the server to preview the journal for the typed fields; a later call supersedes an earlier one */
async function enPreview() {
  var seq = ++EN.seq;
  EN.pvBusy = true;
  EN.err = null;
  enPaint2();
  try {
    var r = await enAsk(enBody());
    if (seq !== EN.seq) return;
    EN.pv = enSeen(r);
  } catch (e) {
    if (seq !== EN.seq) return;
    EN.pv = {
      balanced: false,
      refusals: [{ code: 'READ', message: bkWhy(e, tx('Could not check this entry')), fix: { label: tx('Try again'), retry: true } }],
      lines: []
    };
  }
  EN.pvBusy = false;
  enPaint2();
}
function enPaint2() {
  var node = document.getElementById('en_body');
  if (!node) return;
  if (EN.step === 4) {
    node.innerHTML = '<h3 data-testid="en-step-4">' + esc(tx(enStepWord(4))) + '</h3>' + enPreviewHTML();
    enActs();
  }
}
/* a locked month is refused the moment the date is picked: the server's answer, shown under the date */
async function enCheckDate() {
  var seq = ++EN.seq,
    d = EN.v.date;
  EN.dateRef = null;
  if (!EN.ev || !d) return;
  /* the server has no date-only question: it is asked with what is filled in so far, and only its "month is locked" answer is read here */
  try {
    var r = await enAsk(enBody());
    if (seq !== EN.seq) return;
    EN.dateRef = r && r.code === 'PERIOD_LOCKED' ? enWords(r.refusals, r.code).slice(0, 1) : [];
  } catch (e) {
    if (seq !== EN.seq) return;
    EN.dateRef = [{ code: 'READ', message: bkWhy(e, tx('Could not check this date')), fix: { label: tx('Try again'), retry: true } }];
  }
  var el = document.getElementById('en_dateref');
  if (el) el.innerHTML = enRefusalHTML(EN.dateRef);
  var node = document.getElementById('en_next');
  if (node) node.disabled = !enStepReady(EN.step);
}
/** run the fix a warning or refusal offers (retry, go to a step or field) */
function enFixGo(i, w) {
  var list = w === 'date' ? EN.dateRef : EN.pv && EN.pv[w];
  var x = list && list[i];
  var node = (x && x.fix) || {};
  if (node.retry) {
    if (EN.step === 4) return enPreview();
    return enCheckDate();
  }
  EN.pv = null;
  EN.step = Number(node.step || 3);
  enPaint();
  if (node.focus) {
    var el = document.querySelector('[data-testid="en-f-' + node.focus + '"]');
    if (el) el.focus();
  }
}
