/* app/cap-supplies.js — SUPPLIES: what the shop buys to USE, never to sell.
 *
 * Athi, 2026-09-10: *"i would purchase what I intend to sell, rest i may use it, so all cannot go into
 * catalogue"* and *"we may have to have a screen to add sundry items in case if it is not coming through the
 * channel."*
 *
 * ⭐⭐⭐ DELIBERATELY THIN, and that is a decision rather than an unfinished screen. Asked whether this work was
 * crossing into ERP territory, the honest answer was: partly, and this is the most ERP-shaped and least
 * differentiating part of it. So it does the four things a shopkeeper actually needs — see the list, add one,
 * record a purchase that came from outside ChitBridge, say some was used — and stops. No reorder points, no
 * consumption forecasting, no supplier price history. Those belong to whatever keeps the books.
 *
 * ⚠️ NOTHING HERE HAS A SELLING PRICE, and there is no field for one. Supplies live in their own table (b217) so
 * a storefront query cannot include one by forgetting a WHERE clause. A price box would be an invitation.
 *
 * Injected by ensureCap('supplies'). Classic script, shared global scope — uses api, esc, scr, modal/closeModal,
 * toast, money, UI, tx/txf, scrErr.
 */
/* OWNS Supplies: what the shop buys to use, never to sell
 * CALLED BY app.html (the Supplies capability)
 * FLOW list supplies -> price through fmtMoney(moneyCode()) -> add / edit rows
 * CARD 10-operations/supplies */

var SUP = { rows: null, busy: false, err: null };

function suppliesScreen() {
  /* ⚠️ WX-P2P-01 (2026-10-13, the real stack): a deep link to #/app/supplies stayed at "loading…" for ever. The capability's
     first arrival re-renders the shell (bgRenderApp) AFTER supLoad's answer had already painted into the previous body — so the
     fresh body held the placeholder and nothing repainted it, because SUP.rows was no longer null. The pattern suppliersScreen
     uses: paint what is already known once this markup is in the page. */
  if (SUP.rows !== null || SUP.err || SUP.notReady) setTimeout(supPaint, 0);
  return scr('🧴 ' + tx('Supplies'), 'sup_body', 'supplies');
}

async function supLoad() {
  if (SUP.busy) return;
  SUP.busy = true;
  try {
    var reply = await api('supplyList');
    SUP.rows = (reply && reply.supplies) || [];
    SUP.notReady = reply && reply.not_ready ? reply.not_ready : null;
    SUP.err = null;
  } catch (e) {
    SUP.err = e;
  }
  SUP.busy = false;
  supPaint();
}

/** ⚠️ ONE PAINTER, and it repaints the BODY only — the rail and the header do not move for a list change */
function supPaint() {
  var el = document.getElementById('sup_body');
  if (!el) return;
  if (SUP.err) {
    el.innerHTML = scrErr(SUP.err, 'supplies', 'supLoad()');
    return;
  }
  if (SUP.notReady) {
    el.innerHTML = supEmpty('⚙️', tx('Supplies are not switched on yet'), esc(SUP.notReady));
    return;
  }
  var rows = SUP.rows || [];

  var head =
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
    '<button data-cbsid="SCR009-B01" class="composebtn pri" data-testid="supply-add" onclick="supAddModal()">+ ' +
    tx('Add a supply') +
    '</button>' +
    '<button data-cbsid="SCR009-B02" class="composebtn" data-testid="supply-buy" onclick="supBuyModal()">🧾 ' +
    tx('Record a purchase') +
    '</button>' +
    '</div>' +
    /* ⭐ THE SENTENCE THAT STOPS SOMEBODY PUTTING PRODUCTS HERE. Without it this screen looks like a second
       catalogue, and the first person to misread it will put something sellable in it. */
    '<div style="font-size:var(--fs-1);color:var(--grey);line-height:1.6;margin-bottom:14px">' +
    tx(
      'Things the shop buys and uses — packing, cleaning, stationery. These never appear on your storefront and ' +
        'they have no selling price. What you buy to SELL lives in the Catalogue.'
    ) +
    '</div>';

  if (!rows.length) {
    el.innerHTML =
      head + supEmpty('🧴', tx('Nothing here yet'), tx('Add what the shop buys for itself, or record a purchase from a shop that is not on the network.'));
    return;
  }

  var counted = rows.filter(function (x) {
    return x.keep_stock;
  }).length;
  el.innerHTML =
    head +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:8px" data-testid="supply-count">' +
    txn('{count} supply · {c} counted', '{count} supplies · {c} counted', rows.length, { c: counted }) +
    '</div>' +
    '<div class="itab" style="border:1px solid var(--line);border-radius:12px;overflow:hidden">' +
    rows.map(supRow).join('') +
    '</div>';
}

function supEmpty(icon, title, note) {
  return (
    '<div style="text-align:center;padding:38px 16px;color:var(--grey)">' +
    '<div style="font-size:var(--fs-6)">' +
    icon +
    '</div>' +
    '<div style="font-weight:700;color:var(--ink);margin-top:6px">' +
    esc(title) +
    '</div>' +
    '<div style="font-size:var(--fs-1);margin-top:6px;max-width:42ch;margin-inline:auto;line-height:1.6">' +
    note +
    '</div></div>'
  );
}

function supRow(s) {
  /**
   * ⭐ THE TWO FACTS A SHOPKEEPER WANTS, and no more: what it last cost and who from. That is what makes a repeat
   * purchase recognisable at the counter of the hardware shop — "what did we pay last time" — and it is the whole
   * reason to keep this list rather than just an expense line.
   */
  /* ⚠️ WX-P2P-05 (2026-10-13, the real stack): the row read "40 · Corner Stores" — a bare number. `money` is not a global in app.html (each
     screen keeps its own local), so the fallback printed the raw figure. The app's one formatter (fmtMoney, M36) in the shop's currency. */
  var fmt = function (n) {
    try {
      return fmtMoney(Number(n), moneyCode());
    } catch (_) {
      return typeof money === 'function' ? money(n) : String(n);
    }
  };
  var last =
    s.last_cost != null
      ? fmt(s.last_cost) + (s.last_from ? ' · ' + esc(s.last_from) : '')
      : '<span style="color:var(--grey)">' + tx('not bought yet') + '</span>';
  /* ⚠️ COUNTED vs EXPENSED said in words, because "keep_stock" is our word and a shopkeeper reads neither */
  var kept = s.keep_stock
    ? '<span class="pillx" style="background:var(--ok-tint);color:var(--ok-2)">' + tx('counted') + '</span>'
    : '<span class="pillx" style="background:var(--card);color:var(--grey);border:1px solid var(--line)">' + tx('expensed') + '</span>';
  return (
    '<div class="kv" data-testid="supply-row" style="display:flex;gap:10px;align-items:center;padding:10px 13px;' +
    'border-bottom:1px dashed var(--line)">' +
    '<div style="flex:1;min-width:0">' +
    '<div style="font-weight:650">' +
    esc(s.name) +
    (s.unit ? ' <span style="color:var(--grey);font-weight:400">· ' + esc(s.unit) + '</span>' : '') +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">' +
    last +
    '</div>' +
    '</div>' +
    kept +
    (s.keep_stock
      ? '<button data-cbsid="SCR009-B03" class="btn2" data-testid="supply-use" onclick="supUseModal(\'' +
        esc(s.supply_item_id) +
        "','" +
        esc(s.name) +
        '\')">' +
        tx('Used some') +
        '</button>'
      : '') +
    '</div>'
  );
}

/* ── add one by hand ───────────────────────────────────────────────────────────────────────────────────────── */
function supAddModal() {
  modal(
    '<div style="padding:2px"><div style="font-weight:800;font-size:var(--fs-4)">' +
      tx('Add a supply') +
      '</div>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin:6px 0 12px;line-height:1.6">' +
      tx('Something the shop uses. It will never appear on your storefront.') +
      '</div>' +
      '<input data-cbsid="SCR009-I01" class="inp" id="sup_name" data-testid="supply-name" placeholder="' +
      tx('What is it?') +
      '" style="width:100%;margin-bottom:8px">' +
      '<input data-cbsid="SCR009-I02" class="inp" id="sup_unit" data-testid="supply-unit" placeholder="' +
      tx('Unit (piece, can, box)') +
      '" style="width:100%;margin-bottom:10px">' +
      /* ⭐ THE MATERIALITY CHOICE, in a shopkeeper's words and defaulting to the cheaper answer */
      '<label style="display:flex;gap:8px;align-items:flex-start;font-size:var(--fs-2);cursor:pointer">' +
      '<input data-cbsid="SCR009-I03" type="checkbox" id="sup_keep" data-testid="supply-keep" style="margin-top:3px">' +
      '<span>' +
      tx('Count how many are left') +
      '<div style="font-size:var(--fs-1);color:var(--grey);line-height:1.5">' +
      tx(
        'Leave this off for small things — they are recorded and costed, just not counted. Turn it on for ' +
          'something bought in bulk, where how many are left is a real question.'
      ) +
      '</div></span></label>' +
      '<div style="display:flex;gap:8px;margin-top:16px">' +
      '<button data-cbsid="CMP003" class="composebtn" style="flex:1" onclick="closeModal()">' +
      tx('Cancel') +
      '</button>' +
      '<button data-cbsid="CMP007" class="composebtn pri" style="flex:1" data-testid="supply-save" onclick="supAdd()">' +
      tx('Add') +
      '</button>' +
      '</div></div>',
    false
  );
}

async function supAdd() {
  var name = (document.getElementById('sup_name') || {}).value || '';
  if (!name.trim()) {
    toast(tx('It needs a name'));
    return;
  }
  try {
    await api('supplyAdd', {
      body: {
        name: name.trim(),
        unit: ((document.getElementById('sup_unit') || {}).value || '').trim() || null,
        keep_stock: !!(document.getElementById('sup_keep') || {}).checked
      }
    });
    closeModal();
    toast(tx('Added'));
    supLoad();
  } catch (e) {
    toast((e && e.message) || tx('Could not add it'));
  }
}

/* ── record a purchase that never came through a channel ───────────────────────────────────────────────────── */
function supBuyModal(from) {
  /**
   * ⭐⭐ THE COMMON CASE, NOT THE EXCEPTION. Most sundry buying is cash from the shop down the road with a paper
   * bill and no ChitBridge relationship — so "who from" is free text and always will be. Requiring a relationship
   * would make this useless for exactly the purchases it exists for.
   *
   * ⭐ It is now PRE-FILLED when this is opened from a supplier's row (b218), because at that point the shop has
   * already said who — retyping it would be the second place the same fact is entered, and the place where the
   * two spellings drift apart.
   */
  var opts = (SUP.rows || [])
    .map(function (item) {
      return '<option value="' + esc(item.name) + '">';
    })
    .join('');
  modal(
    '<div style="padding:2px"><div style="font-weight:800;font-size:var(--fs-4)">' +
      tx('Record a purchase') +
      '</div>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin:6px 0 12px;line-height:1.6">' +
      tx('Something you bought for the shop from outside ChitBridge — a cash bill from the shop down the road.') +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:8px">' +
      '<input data-cbsid="SCR009-I04" class="inp" id="sup_from" data-testid="supply-from" placeholder="' +
      tx('Who from') +
      '" style="flex:1" value="' +
      esc(from || '') +
      '">' +
      '<input data-cbsid="SCR009-I05" class="inp" id="sup_ref" data-testid="supply-ref" placeholder="' +
      tx('Bill number') +
      '" style="width:140px">' +
      '</div>' +
      '<datalist id="sup_known">' +
      opts +
      '</datalist>' +
      '<div id="sup_lines"></div>' +
      '<button data-cbsid="SCR009-B04" class="btn2" data-testid="supply-addline" onclick="supAddLine()" style="margin-top:6px">+ ' +
      tx('another line') +
      '</button>' +
      '<div style="display:flex;gap:8px;margin-top:16px">' +
      '<button data-cbsid="CMP003" class="composebtn" style="flex:1" onclick="closeModal()">' +
      tx('Cancel') +
      '</button>' +
      '<button data-cbsid="SCR009-B05" class="composebtn pri" style="flex:1" data-testid="supply-record" onclick="supBuy()">' +
      tx('Record it') +
      '</button>' +
      '</div></div>',
    false
  );
  supAddLine();
}

var SUP_LINE = 0;
/**
 * ⚠️ ONE LINE EDITOR FOR SUPPLIES, AND ONLY FOR SUPPLIES. It briefly grew a `lot` flag so a resale delivery could
 * reuse it — that whole branch is gone, because a resale delivery is now authored in compose like every other
 * chit. A form that serves two constructs is how the second construct gets built without anybody deciding to.
 */
function supAddLine() {
  var box = document.getElementById('sup_lines');
  if (!box) return;
  var i = SUP_LINE++;
  var node = document.createElement('div');
  node.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';
  node.innerHTML =
    '<input data-cbsid="SCR009-I06" class="inp" list="sup_known" data-l="' +
    i +
    '" data-f="name" data-testid="supply-l-name" placeholder="' +
    tx('What') +
    '" style="flex:1">' +
    '<input data-cbsid="SCR009-I07" class="inp" type="number" data-l="' +
    i +
    '" data-f="qty" data-testid="supply-l-qty" placeholder="' +
    tx('Qty') +
    '" style="width:70px">' +
    '<input data-cbsid="SCR009-I08" class="inp" data-l="' +
    i +
    '" data-f="unit" placeholder="' +
    tx('Unit') +
    '" style="width:70px">' +
    '<input data-cbsid="SCR009-I09" class="inp" type="number" data-l="' +
    i +
    '" data-f="cost" data-testid="supply-l-cost" placeholder="' +
    tx('Cost each') +
    '" style="width:90px">';
  box.appendChild(node);
}

/** read the line editor back — shared, so the two submits cannot disagree about what an empty line is */
function supReadLines() {
  var lines = {},
    box = document.getElementById('sup_lines');
  (box ? box.querySelectorAll('input[data-l]') : []).forEach(function (item) {
    var i = item.getAttribute('data-l');
    lines[i] = lines[i] || {};
    lines[i][item.getAttribute('data-f')] = item.value;
  });
  return Object.keys(lines)
    .map(function (item) {
      return lines[item];
    })
    .filter(function (item) {
      return (item.name || '').trim() && Number(item.qty) > 0;
    });
}

/**
 * ⚠️⚠️ THIS FUNCTION WAS DELETED BY ACCIDENT AND SHIPPED THAT WAY. Removing the private delivery path, I spliced
 * out a line range and took supBuy with it — "Record a purchase" became a button that called nothing. `node -c`
 * passed, the file parsed, the guard suite was green: NOTHING catches a missing function, because a call to one
 * only fails when a person presses the button. [SUP-01] pressed it.
 * ⭐ The lesson is not "be careful with line ranges" — it is that a line-range splice has no anchor to verify, so
 * it should never be the tool. An anchored replace fails loudly when the anchor moves.
 */
async function supBuy() {
  var body = {
    from: ((document.getElementById('sup_from') || {}).value || '').trim() || null,
    ref: ((document.getElementById('sup_ref') || {}).value || '').trim(),
    lines: supReadLines().map(function (item) {
      return { name: item.name.trim(), qty: Number(item.qty), unit: (item.unit || '').trim() || null, cost: item.cost === '' ? null : Number(item.cost) };
    })
  };
  /* ⚠️ A REFERENCE IS REQUIRED. Without one a repeated entry cannot be told from a second purchase, and the same
     cash bill typed twice would double the spend. The message says what to put, not that a field is missing. */
  if (!body.ref) {
    toast(tx('Give it a reference — the bill number, or the date and the shop'));
    return;
  }
  if (!body.lines.length) {
    toast(tx('Add at least one line with a quantity'));
    return;
  }
  try {
    var reply = await api('supplyBuy', { body: body });
    closeModal();
    toast(reply && reply.says ? reply.says : tx('Recorded'));
    supLoad();
  } catch (e) {
    toast((e && e.message) || tx('Could not record it'));
  }
}

/**
 * ── ⭐⭐⭐ GOODS BOUGHT TO SELL, FROM A SUPPLIER WHO IS NOT ON CHITBRIDGE ───────────────────────────────────────
 *
 * The Trade tab's twin of "Record a purchase". Athi, 2026-09-10: *"if you call them through 'other supplier', you
 * know where to keep the product and what life cycle you have to follow."* The flag on the supplier chose the
 * destination; this is the other one.
 *
 * ⭐⭐⭐ AND IT OPENS COMPOSE, because that is how a chit is authored in this product. Athi, same day: *"never ever
 * go out of the product construct and create a different path — whatever we try to build should follow the core
 * principles."*
 *
 * ⚠️⚠️ THAT IS A CORRECTION OF WHAT STOOD HERE AN HOUR AGO. I had written a private modal with its own line
 * editor calling createChit directly. It worked — and it skipped cbFreezeTerms, the business_json merge, per-line
 * attachments, drafts, and every other rule sendChit owns. A second way to mint a chit does not announce itself
 * when it drifts from the first; it just quietly stops doing something the real path started doing.
 *
 * ⭐ A RECEIPT CHIT, not a direct write to the ledger. A chit from a real supplier puts stock in at landed cost,
 * offers the new items to the catalogue, and leaves a document to point at afterwards. Writing straight to
 * stock_movement would get the quantity right and skip all three, leaving a balance with nothing behind it.
 *
 * ⚠️ ADDRESSED TO SELF, because a minted supplier cannot receive anything — the one thing the ~ marker enforces.
 * Who it came from rides in business_json.source, exactly where a chit from a real supplier carries it, so
 * adoption and the ledger read it without knowing the difference.
 */
function supRecordDelivery(name, supplier_id) {
  if (typeof compose !== 'function') {
    toast(tx('Compose is not loaded yet — try once more'));
    return;
  }
  var who = name || tx('local supplier');
  compose({
    subject: tx('Delivery') + ' — ' + who,
    recipients: [{ name: 'Self', role: 'to', self: true }],
    purpose: 'receipt',
    /* ⭐ the same shape a chit from a real ChitBridge supplier carries, so lib/adopt.js reads it unchanged */
    business_json: { doc: 'receipt', source: { entity_id: supplier_id || null, name: name || null, off_rail: true } },
    /* ⚠️ says on screen where these lines came from — compose without an origin banner reads as "nothing arrived" */
    origin: txf('Recording what you bought from {who}', { who: who })
  });
}

/* ── used some ─────────────────────────────────────────────────────────────────────────────────────────────── */
function supUseModal(id, name) {
  modal(
    '<div style="padding:2px"><div style="font-weight:800;font-size:var(--fs-4)">' +
      esc(name) +
      '</div>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin:6px 0 12px;line-height:1.6">' +
      tx('How many did the shop use? This is what turns a purchase into something you can read later.') +
      '</div>' +
      '<input data-cbsid="SCR009-I10" class="inp" type="number" id="sup_use_qty" data-testid="supply-use-qty" placeholder="' +
      tx('How many') +
      '" style="width:100%">' +
      '<div style="display:flex;gap:8px;margin-top:16px">' +
      '<button data-cbsid="CMP003" class="composebtn" style="flex:1" onclick="closeModal()">' +
      tx('Cancel') +
      '</button>' +
      '<button data-cbsid="SCR009-B06" class="composebtn pri" style="flex:1" data-testid="supply-use-save" onclick="supUse(\'' +
      esc(id) +
      '\')">' +
      tx('Record') +
      '</button>' +
      '</div></div>',
    false
  );
}

async function supUse(id) {
  var node = Number((document.getElementById('sup_use_qty') || {}).value || 0);
  if (!(node > 0)) {
    toast(tx('How many?'));
    return;
  }
  try {
    await api('supplyUse', { params: { id: id }, body: { qty: node } });
    closeModal();
    toast(tx('Recorded'));
    supLoad();
  } catch (e) {
    toast((e && e.message) || tx('Could not record it'));
  }
}
