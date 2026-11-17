/* app/cap-adopt.js — TAKING A SUPPLIER'S DELIVERY INTO YOUR OWN CATALOGUE.
 *
 * Athi, 2026-09-10: *"create the product and SKU etc according to your own way of doing and then accept the
 * product, but we can offer that facility so he doesn't need to create all by himself. So offer is the right way
 * of doing, but should not be so easy — just a button should not accept the product, it has to ask for
 * confirmation. If it is not his own vertical, refuse and say if you want to override then please say so."*
 *
 * ⭐⭐⭐ THIS OPENS FROM A DELIVERY, NOT FROM A MENU. Adopting is something you do while looking at what arrived,
 * with the supplier's own line in front of you — a nav item would make it a chore you go and do later, which is
 * how forty products stay untyped for a month.
 *
 * ⚠️ AND IT IS NOT ONE TAP. Every row the shop wants has to be given THEIR name and THEIR SKU before Accept does
 * anything, and the button counts what is actually ready. That friction is the feature: a catalogue that filled
 * itself from a supplier's wording slowly stops being the shop's own.
 *
 * Injected by ensureCap('adopt'). Uses api, esc, modal/closeModal, toast, money, tx/txf.
 
 * CALLED BY public/app/cap-chit2.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
/*
 * OWNS      the adopt-a-delivery step: a supplier's delivery taken into YOUR catalogue, with the confirmation and the own-vertical check
 * CALLED BY ensureCap('adopt') in public/app/cap-chit2.js:638 (opened from a delivery chit, never from a menu)
 * FLOW      delivery chit -> Adopt -> confirmation (another vertical refused unless overridden) -> product and SKU in your own catalogue
 * CARD      06-catalogue-pim/adopt-a-supplier-s-delivery-into-my-catalogue
 */

var ADO = { chit_id: null, data: null, edits: {} };

/**
 * ⭐ OPEN IT. Reads what the delivery offers — this call changes nothing and is safe to make twice.
 */
async function adoptOpen(chit_id) {
  ADO = { chit_id: chit_id, data: null, edits: {} };
  modal('<div style="padding:24px;text-align:center;color:var(--grey)"><span class="spin"></span> ' + tx('Reading the delivery…') + '</div>', false, { pop: 'POP012' });
  try {
    ADO.data = await api('adoptRead', { params: { id: chit_id } });
    adoptPaint();
  } catch (e) {
    modal(
      '<div style="padding:2px"><div style="font-weight:800">' +
        tx('Could not read the delivery') +
        '</div>' +
        '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:8px">' +
        esc((e && e.message) || '') +
        '</div>' +
        '<div style="display:flex;margin-top:16px"><button data-cbsid="CMP005" class="composebtn pri" style="flex:1" onclick="closeModal()">' +
        tx('Close') +
        '</button></div></div>',
      false, { pop: 'POP012' }
    );
  }
}

function adoptPaint() {
  var d = ADO.data || {};
  var rows = d.rows || [];
  var from = d.from || {};
  var head =
    '<div style="font-weight:800;font-size:var(--fs-4)">' +
    tx('New on this delivery') +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin:4px 0 12px">' +
    esc(from.name || tx('a supplier')) +
    (from.vertical ? ' · ' + esc(adoptTradeWord(from.vertical)) : '') +
    (from.supply_kind === 'own_use' ? ' · ' + tx('supplies you use') : '') +
    '</div>' +
    /* ⭐ THE HEADLINE SAYS WHAT NEEDS A PERSON, rather than how many rows there are */
    '<div style="font-size:var(--fs-2);margin-bottom:12px">' +
    esc(d.says || '') +
    '</div>';

  var body = rows.map(adoptRow).join('');
  var ready = adoptReadyCount();

  modal(
    '<div style="padding:2px;max-height:70vh;overflow-y:auto">' +
      head +
      body +
      '<div style="display:flex;gap:8px;margin-top:16px;position:sticky;bottom:0;background:var(--card);color:var(--on-card);padding-top:10px">' +
      '<button data-cbsid="CMP015" class="composebtn" style="flex:1" onclick="closeModal()">' +
      tx('Not now') +
      '</button>' +
      '<button data-cbsid="SCR001-B01" class="composebtn pri" style="flex:1" data-testid="adopt-accept" ' +
      (ready ? '' : 'disabled ') +
      'onclick="adoptAccept()">' +
      (ready ? txf('Add {n} to my catalogue', { n: ready }) : tx('Nothing ready yet')) +
      '</button>' +
      '</div></div>',
    false
  );
}

/** ⚠️ our word for a trade is not a shopkeeper's — say the trade, not the key */
function adoptTradeWord(v) {
  return { pharma: 'medicines', food: 'food and groceries', serialised: 'electronics', chemical: 'chemicals', lot: 'textiles' }[v] || v;
}

function adoptRow(r, i) {
  if (r.may === 'already') return adoptNote(r, tx('you already stock this'), 'var(--grey)');
  if (r.may === 'not_for_sale') return adoptNote(r, r.why, 'var(--grey)');

  if (r.may === 'refuse' && r.refused === 'vertical') {
    /**
     * ⭐⭐⭐ THE REFUSAL IS THE INTERESTING SCREEN. It has to say what stocking these goods would OBLIGE — a batch,
     * an expiry, a recall you can be asked to act on — because that is the decision, and "vertical mismatch" is a
     * phrase from our world. The way through is a separate, deliberate act with its own words on it.
     */
    return (
      '<div class="itab" data-testid="adopt-refused" style="border:1px solid var(--warn);border-radius:12px;' +
      'padding:12px 13px;margin-bottom:9px;background:var(--warn-tint)">' +
      '<div style="font-weight:700">' +
      esc(r.particulars || '') +
      '</div>' +
      '<div style="font-size:var(--fs-1);margin-top:6px;line-height:1.6">' +
      esc(r.why) +
      '</div>' +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:var(--fs-2);cursor:pointer">' +
      '<input data-cbsid="SCR001-I01" type="checkbox" data-testid="adopt-override" onchange="adoptSet(' +
      r.line +
      ",'override',this.checked)\">" +
      '<b>' +
      esc(r.override_says || tx('Yes, I stock these too')) +
      '</b></label>' +
      adoptFields(r, true) +
      '</div>'
    );
  }
  if (r.may !== 'offer') return adoptNote(r, r.why || '', 'var(--grey)');

  var seed = r.seed || {};
  return (
    '<div class="itab" data-testid="adopt-offer" style="border:1px solid var(--line);border-radius:12px;' +
    'padding:12px 13px;margin-bottom:9px">' +
    '<div style="display:flex;justify-content:space-between;gap:8px">' +
    '<div style="font-weight:700">' +
    esc(r.particulars || '') +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey)">' +
    tx('cost') +
    ' ' +
    (seed.cost != null ? (typeof money === 'function' ? money(seed.cost) : seed.cost) : '—') +
    '</div>' +
    '</div>' +
    (r.ask_purpose
      ? '<div style="font-size:var(--fs-1);color:var(--warn);margin-top:5px">' +
        tx('Nobody has said whether this supplier sells you goods or things the shop uses.') +
        '</div>'
      : '') +
    ((r.missing || []).length
      ? '<div style="font-size:var(--fs-1);color:var(--warn);margin-top:5px">' +
        txf('This delivery did not carry: {what} — worth asking the supplier.', { what: esc((r.missing || []).join(', ')) }) +
        '</div>'
      : '') +
    adoptFields(r, false) +
    '</div>'
  );
}

/**
 * ⭐⭐ THE FORM IS SEEDED, NOT FILLED. The name box carries the supplier's wording so nobody types forty of them,
 * and the SKU box carries a SUGGESTION — but both are the shop's to change, and Accept counts only rows where
 * both are present. The COST is shown and the SELLING PRICE is empty, always: a shop that sold at cost because a
 * form pre-filled it would have been failed by this screen.
 */
function adoptFields(r, refused) {
  var seed = r.seed || {};
  var e = ADO.edits[r.line] || {};
  return (
    '<div style="display:flex;gap:6px;margin-top:9px;flex-wrap:wrap">' +
    '<input data-cbsid="SCR001-I02" class="inp" data-testid="adopt-name" placeholder="' +
    tx('Your name for it') +
    '" style="flex:1;min-width:150px" ' +
    'value="' +
    esc(e.name != null ? e.name : seed.name || '') +
    '" oninput="adoptSet(' +
    r.line +
    ",'name',this.value)\">" +
    '<input data-cbsid="SCR001-I03" class="inp" data-testid="adopt-sku" placeholder="' +
    tx('Your SKU') +
    '" style="width:120px" ' +
    'value="' +
    esc(e.sku != null ? e.sku : '') +
    '" oninput="adoptSet(' +
    r.line +
    ",'sku',this.value)\">" +
    '<input data-cbsid="SCR001-I04" class="inp" type="number" data-testid="adopt-price" placeholder="' +
    tx('Sell at') +
    '" style="width:100px" ' +
    'value="' +
    esc(e.price != null ? e.price : '') +
    '" oninput="adoptSet(' +
    r.line +
    ",'price',this.value)\">" +
    '</div>' +
    (seed.suggested_sku
      ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px">' +
        txf('Suggested SKU: {s}', {
          s:
            '<b style="cursor:pointer;color:var(--blue)" data-testid="adopt-usesku" ' +
            'onclick="adoptUseSku(' +
            r.line +
            ",'" +
            esc(seed.suggested_sku) +
            '\')">' +
            esc(seed.suggested_sku) +
            '</b>'
        }) +
        '</div>'
      : '') +
    (seed.batch_tracked ? '<div style="font-size:var(--fs-1);color:var(--ok-2);margin-top:4px">' + tx('Stock will be kept per batch.') + '</div>' : '')
  );
}

function adoptNote(r, why, colour) {
  return (
    '<div style="padding:9px 2px;border-bottom:1px dashed var(--line);font-size:var(--fs-1);color:' +
    colour +
    '">' +
    '<b style="color:var(--ink)">' +
    esc(r.particulars || '') +
    '</b> — ' +
    esc(why) +
    '</div>'
  );
}

function adoptSet(line, field, value) {
  ADO.edits[line] = ADO.edits[line] || {};
  ADO.edits[line][field] = value;
  /* ⚠️ REPAINT ONLY THE BUTTON. Redrawing the modal on every keystroke would take the caret out of the box the
     person is typing in — the same fault the counter had with its quantity field. */
  adoptRepaintButton();
}

function adoptUseSku(line, sku) {
  ADO.edits[line] = ADO.edits[line] || {};
  ADO.edits[line].sku = sku;
  adoptPaint(); /* a click, not a keystroke — safe to redraw, and the box must show what was chosen */
}

/** a row is ready when the shop has given it a name AND a SKU — and, if refused, has said so explicitly */
function adoptReady(r) {
  if (r.may !== 'offer' && !(r.may === 'refuse' && r.refused === 'vertical')) return false;
  var e = ADO.edits[r.line] || {};
  var name = (e.name != null ? e.name : (r.seed && r.seed.name) || '').trim();
  var sku = (e.sku || '').trim();
  if (!name || !sku) return false;
  if (r.may === 'refuse') return e.override === true;
  return true;
}
function adoptReadyCount() {
  return ((ADO.data && ADO.data.rows) || []).filter(adoptReady).length;
}

function adoptRepaintButton() {
  var node = document.querySelector('[data-testid="adopt-accept"]');
  if (!node) return;
  var n = adoptReadyCount();
  node.disabled = !n;
  node.textContent = n ? txf('Add {n} to my catalogue', { n: n }) : tx('Nothing ready yet');
}

async function adoptAccept() {
  var rows = ((ADO.data && ADO.data.rows) || []).filter(adoptReady);
  if (!rows.length) return;
  var accept = rows.map(function (item) {
    var e = ADO.edits[item.line] || {};
    return {
      line: item.line,
      name: (e.name != null ? e.name : (item.seed && item.seed.name) || '').trim(),
      sku: (e.sku || '').trim(),
      price: e.price === '' || e.price == null ? null : Number(e.price),
      override: e.override === true
    };
  });
  try {
    var reply = await api('adoptAccept', { params: { id: ADO.chit_id }, body: { accept: accept } });
    closeModal();
    toast((reply && reply.says) || tx('Added'));
    /* the catalogue is the thing that changed — reload it if the person is looking at it */
    if (typeof UI !== 'undefined' && UI.nav === 'catalogue' && typeof loadCatalogue === 'function') loadCatalogue();
  } catch (e) {
    toast((e && e.message) || tx('Could not add them'));
  }
}
