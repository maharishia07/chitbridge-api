/* app/cap-traceability.js — TRACEABILITY capability (lazy via ensureCap('traceability')).
 * The recall DRAMA (not a network diagram): flag a batch → walk FORWARD → the recall set lights up with a
 * ₹-saved number in seconds; start from any node → walk BACKWARD → provenance to source in N hops.
 * Operator lens (TR-6): topology + product only — commercial terms stay per-party, so a rival's deal price is
 * never shown here. Backend: routes/chits.js  GET /api/chits/:id/trace?dir=forward|backward. Self-registers its EP. */
/* OWNS the traceability screens (batch, lot, trail)
 * CALLED BY app.html (ensureCap('traceability'))
 * FLOW read the trail -> _traceRs paints amounts through fmtMoney in the row's currency, else the shop's
 * CARD 10-operations/traceability */
if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    traceWalk: { m: 'GET', p: '/api/chits/:id/trace', ok: 'y' },
    traceBatches: { m: 'GET', p: '/api/chits/trace/batches', ok: 'y' },
    traceByBatch: { m: 'GET', p: '/api/chits/trace/by-batch', ok: 'y' }
  });
}

function _traceNum(v, d) {
  v = parseInt(v, 10);
  return isFinite(v) && v >= 0 ? v : d;
}
/* ⚠️ WAS `'₹' + toLocaleString('en-IN')` — a hardcoded rupee sign on every trace, whatever the chit was
   priced in, and Indian grouping for every reader. A currency symbol is not decoration; printing ₹ on a
   dirham amount states something false about the money. Currency now comes from the value; format from the
   reader. ⚠️ The INR default preserves today's behaviour where a caller passes no currency. */
function _traceRs(v, ccy) {
  return fmtMoney(v || 0, ccy || moneyCode());
} /* CX0: the SHOP's currency when the caller passes none */
function _traceSym() {
  try {
    return typeof curSym === 'function' ? curSym() : '₹';
  } catch (_) {
    return '₹';
  }
}
function _traceShort(id) {
  id = String(id || '');
  return id.length > 8 ? '…' + id.slice(-6) : id;
}

function traceabilityScreen() {
  var id = UI.traceId || '';
  var cost = UI.traceCost == null ? 5000 : UI.traceCost;
  var blanket = UI.traceBlanket == null ? 200 : UI.traceBlanket;
  var res = UI.traceResult;

  var controls =
    '<div style="padding:14px 18px;border-bottom:1px solid var(--line)">' +
    '<div style="font-size:var(--fs-4);font-weight:800">🧭 Traceability — recall &amp; where it came from</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">Flag a batch to see exactly who it reached; trace any node back to its source. ' +
    'You see topology + product only — <b>commercial terms stay per-party</b>.</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px">' +
    '<input data-cbsid="INS003-I01" id="traceIdIn" value="' +
    esc(id) +
    '" placeholder="Paste a batch / chit id" ' +
    'oninput="UI.traceId=this.value" onkeydown="if(event.key===\'Enter\')runTrace(\'forward\')" ' +
    'style="flex:1;min-width:220px;padding:9px 11px;border:1px solid var(--line);border-radius:9px;font-size:var(--fs-2);font-family:monospace">' +
    '<button data-cbsid="INS003-B01" class="pri" onclick="runTrace(\'forward\')" style="padding:9px 14px">🚨 Recall set <span class=arw>▸</span></button>' +
    '<button data-cbsid="INS003-B02" onclick="runTrace(\'backward\')" style="padding:9px 14px"><span class=arw>◂</span> ' +
    tx('To source') +
    '</button>' +
    '</div>' +
    '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-top:10px;font-size:var(--fs-1);color:var(--grey)">' +
    '<label>' +
    _traceSym() +
    ' / node&nbsp;<input data-cbsid="INS003-I02" value="' +
    cost +
    '" oninput="UI.traceCost=_traceNum(this.value,5000)" ' +
    'style="width:80px;padding:4px 7px;border:1px solid var(--line);border-radius:6px;font-size:var(--fs-2)"></label>' +
    '<label>blanket-recall size&nbsp;<input data-cbsid="INS003-I03" value="' +
    blanket +
    '" oninput="UI.traceBlanket=_traceNum(this.value,200)" ' +
    'style="width:70px;padding:4px 7px;border:1px solid var(--line);border-radius:6px;font-size:var(--fs-2)"></label>' +
    '<span>— the ' +
    _traceSym() +
    ' saved is targeted recall vs a blanket recall of your whole network.</span>' +
    '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px;padding-top:11px;border-top:1px dashed var(--line)">' +
    '<span style="font-size:var(--fs-2);color:var(--grey)">or reconstruct from shared data (no links):</span>' +
    '<input data-cbsid="INS003-I04" id="traceBatchIn" value="' +
    esc(UI.traceBatchQ || '') +
    '" placeholder="batch number, e.g. FG-PC-6621" ' +
    'oninput="UI.traceBatchQ=this.value" onkeydown="if(event.key===\'Enter\')runTraceByBatch()" ' +
    'style="flex:1;min-width:180px;padding:8px 11px;border:1px solid var(--line);border-radius:9px;font-size:var(--fs-2);font-family:monospace">' +
    '<button data-cbsid="INS003-B03" onclick="runTraceByBatch()" style="padding:8px 13px">' +
    tx('🔎 Trace by batch #') +
    '</button>' +
    '</div>' +
    '</div>';

  var body;
  if (UI.traceLoading) body = loader('Walking the chain…');
  else if (res && res.error)
    body =
      '<div style="margin:22px 18px;padding:14px 16px;border:1px solid #f0c9c4;background:var(--danger-tint);border-radius:9px;font-size:var(--fs-2);color:var(--disp-2)">' +
      esc(res.error) +
      '</div>';
  else if (res && res.dir === 'forward') body = _traceFwd(res);
  else if (res && res.dir === 'backward') body = _traceBwd(res);
  else
    body = emptyState(
      '🧭',
      'Flag a batch to trace it',
      'Paste a batch or chit id above, then Recall set ▸ (who it reached) or ◂ To source (where it came from).'
    );

  return (
    '<div style="display:flex;flex-direction:column;height:100%;min-height:0">' +
    controls +
    '<div style="flex:1;overflow:auto;min-height:0">' +
    _traceBatchPicker() +
    body +
    '</div></div>'
  );
}

// The batches the signed-in operator can trace — each row prints its id (the "traceability string") and is
// clickable, so a demo works on any machine without pasting a key. RLS-scoped server-side (you see only yours).
async function loadTraceBatches() {
  try {
    var reply = await api('traceBatches');
    UI.traceBatches = (reply && reply.batches) || [];
  } catch (e) {
    UI.traceBatches = [];
  }
  if (typeof renderApp === 'function') bgRenderApp();
}
function _traceBatchPicker() {
  if (UI.traceBatches === undefined) {
    loadTraceBatches();
    return '<div style="padding:12px 20px;color:var(--grey);font-size:var(--fs-2)">' + tx('Loading your batches…') + '</div>';
  }
  if (!UI.traceBatches.length)
    return '<div style="padding:12px 20px;color:var(--grey);font-size:var(--fs-2)">No traceable batches yet — seed a chain, then reload.</div>';
  var rows = UI.traceBatches
    .map(function (item) {
      var name = esc(item.product || item.to_name || 'batch');
      var meta = [
        item.qty != null ? esc(String(item.qty)) + esc(item.unit ? ' ' + item.unit : '') : '',
        item.sender_name ? 'from ' + esc(item.sender_name) : ''
      ]
        .filter(Boolean)
        .join(' · ');
      return (
        '<div data-cbsid="INS003-C01" onclick="UI.traceId=\'' +
        item.chit_id +
        '\';runTrace(\'forward\')" title="Click to trace this batch" ' +
        'style="cursor:pointer;padding:9px 11px;border:1px solid var(--line);border-radius:9px;background:var(--card);display:flex;flex-direction:column;gap:2px;color:var(--on-card)">' +
        '<div style="display:flex;align-items:center;gap:7px"><b style="font-size:var(--fs-2)">' +
        name +
        '</b>' +
        (item.is_origin
          ? '<span style="font-size:var(--fs-1);font-weight:800;color:var(--blue-2);background:var(--blue-tint-bg);border-radius:5px;padding:1px 5px">' +
            tx('ORIGIN') +
            '</span>'
          : '') +
        '</div>' +
        (meta ? '<div style="font-size:var(--fs-1);color:var(--grey)">' + meta + '</div>' : '') +
        '<div style="font-family:monospace;font-size:var(--fs-1);color:var(--grey-3);word-break:break-all">' +
        esc(item.chit_id) +
        '</div>' +
        '</div>'
      );
    })
    .join('');
  return (
    '<div style="padding:10px 18px 4px">' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--grey);letter-spacing:.05em;margin-bottom:7px">' +
    tx('YOUR BATCHES — click one to trace') +
    '</div>' +
    '<div style="display:grid;gap:7px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">' +
    rows +
    '</div></div>'
  );
}

function _traceChip(n, isTerm) {
  var label = esc(n.product || '(no product)');
  var qty = n.qty != null ? ' · ' + esc(String(n.qty)) + esc(n.unit ? ' ' + n.unit : '') : '';
  var badge = n.is_origin
    ? '<span style="font-size:var(--fs-1);font-weight:800;color:var(--blue-2);background:var(--blue-tint-bg);border-radius:6px;padding:1px 5px;margin-inline-start:6px">' +
      tx('ORIGIN') +
      '</span>'
    : isTerm
      ? '<span style="font-size:var(--fs-1);font-weight:800;color:var(--disp-2);background:var(--danger-tint);border-radius:6px;padding:1px 5px;margin-inline-start:6px">' +
        tx('EXPOSED') +
        '</span>'
      : '';
  var bd = isTerm ? 'var(--disp)' : n.is_origin ? 'var(--blue-tint-bg)' : 'var(--line)';
  var bg = isTerm ? 'var(--danger-tint)' : n.is_origin ? 'var(--blue-tint-bg)' : '#fff';
  return (
    '<span style="display:inline-flex;align-items:center;border:1px solid ' +
    bd +
    ';background:' +
    bg +
    ';border-radius:9px;padding:5px 9px;font-size:var(--fs-2);margin:3px 5px 3px 0">' +
    '<b style="font-weight:700">' +
    label +
    '</b>' +
    qty +
    '<span style="color:var(--grey);font-family:monospace;font-size:var(--fs-1);margin-inline-start:7px">' +
    _traceShort(n.chit_id) +
    '</span>' +
    badge +
    '</span>'
  );
}

function _traceFwd(r) {
  var nodes = r.nodes || [];
  var targeted = r.reachable_count || nodes.length;
  var cost = UI.traceCost == null ? 5000 : UI.traceCost;
  var blanket = UI.traceBlanket == null ? 200 : UI.traceBlanket;
  var saved = Math.max(0, blanket - targeted) * cost;

  var banner =
    '<div style="margin:16px 18px;padding:16px 18px;border:1px solid #e6a79f;background:var(--danger-tint);border-radius:12px">' +
    '<div style="font-size:var(--fs-5);font-weight:800;color:var(--disp-2)">🚨 Recall set — ' +
    targeted +
    ' place' +
    (targeted === 1 ? '' : 's') +
    ' hold this batch</div>' +
    '<div style="font-size:var(--fs-2);color:var(--disp-2);margin-top:3px">' +
    (r.depth_max || 0) +
    ' hop' +
    ((r.depth_max || 0) === 1 ? '' : 's') +
    ' deep · ' +
    (r.terminals || []).length +
    ' exposed endpoint' +
    ((r.terminals || []).length === 1 ? '' : 's') +
    '</div>' +
    '<div style="margin-top:11px;font-size:var(--fs-3);font-weight:800;color:var(--ok-2)">' +
    _traceRs(saved) +
    ' saved' +
    '<span style="font-weight:600;color:var(--grey);font-size:var(--fs-2)"> — recall these ' +
    targeted +
    ', not a blanket ~' +
    blanket +
    '</span></div>' +
    ((r.flagged || 0) > 0
      ? '<div style="margin-top:11px;font-size:var(--fs-2);font-weight:800;color:#fff;background:#c0453b;border-radius:9px;padding:7px 12px;display:inline-block">⚠ ' +
        r.flagged +
        ' node' +
        (r.flagged === 1 ? '' : 's') +
        ' fail mass-balance — more went OUT than came IN</div>'
      : '') +
    '</div>';

  return (
    banner +
    '<div style="padding:4px 20px 22px">' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--grey);letter-spacing:.05em;margin:6px 0 6px">' +
    (r.reconstructed ? 'RECONSTRUCTED FROM BATCH “' + esc(r.by_batch || '') + '” — no links used' : 'WHO HOLDS IT — recall tree') +
    '</div>' +
    _traceTree(r) +
    '</div>'
  );
}

// Each node = a handoff, labelled by the PARTY THAT HOLDS IT (to_name) with from-whom + how much. Rendered as a
// parent→child tree from the walk's edges; the visited-set keeps a diamond from rendering twice.
/* A QUANTITY, not money — grouped for the reader, with no currency attached. */
function _traceQ(v) {
  return CBLocale.number(v || 0);
}
function _traceNode(n, isTerm) {
  var who = esc(n.to_name || n.product || _traceShort(n.chit_id));
  var bal = n.balance,
    isRed = !!(bal && bal.status === 'red');
  var bits = [];
  if (n.sender_name) bits.push('from ' + esc(n.sender_name));
  if (n.qty != null) bits.push('<b style="color:var(--ink-2)">' + esc(String(n.qty)) + esc(n.unit ? ' ' + n.unit : '') + '</b>');
  if (n.product) bits.push(esc(n.product));
  bits.push('<span style="font-family:monospace;font-size:var(--fs-1);opacity:.6">' + _traceShort(n.chit_id) + '</span>');
  var badge = n.is_origin
    ? '<span style="font-size:var(--fs-1);font-weight:800;color:var(--blue-2);background:var(--blue-tint-bg);border-radius:6px;padding:1px 6px;margin-inline-start:7px">' +
      tx('ORIGIN') +
      '</span>'
    : isTerm
      ? '<span style="font-size:var(--fs-1);font-weight:800;color:var(--disp-2);background:var(--danger-tint);border-radius:6px;padding:1px 6px;margin-inline-start:7px">' +
        tx('EXPOSED') +
        '</span>'
      : '';
  if (isRed)
    badge +=
      '<span style="font-size:var(--fs-1);font-weight:800;color:var(--disp);background:#c0453b;border-radius:6px;padding:1px 6px;margin-inline-start:7px">⚠ OUT &gt; IN</span>';
  var dot = isRed || isTerm ? 'var(--disp)' : n.is_origin ? 'var(--blue-2)' : 'var(--blue-2)';
  var balLine = isRed
    ? '<div style="font-size:var(--fs-1);color:var(--disp-2);font-weight:700;margin-inline-start:17px;margin-top:2px">claimed ' +
      _traceQ(bal.out) +
      ' out, received ' +
      _traceQ(bal.in) +
      ' in — <u>' +
      _traceQ(bal.delta) +
      ' ' +
      esc(bal.base_unit || '') +
      ' unaccounted</u></div>'
    : '';
  return (
    '<div style="padding:6px 0' +
    (isRed ? ';background:var(--danger-tint);border-radius:9px' : '') +
    ';color:var(--on-card)">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap' +
    (isRed ? ';padding-inline-start:6px' : '') +
    '">' +
    '<span style="width:9px;height:9px;border-radius:50%;background:' +
    dot +
    ';flex:0 0 auto"></span>' +
    '<span style="font-weight:700;font-size:var(--fs-3)' +
    (isRed ? ';color:var(--disp-2)' : '') +
    '">' +
    who +
    '</span>' +
    badge +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-inline-start:17px;margin-top:1px' +
    (isRed ? ';padding-inline-start:6px' : '') +
    '">' +
    bits.join(' · ') +
    '</div>' +
    balLine +
    '</div>'
  );
}
function _traceTree(r) {
  var byId = {};
  (r.nodes || []).forEach(function (item) {
    byId[item.chit_id] = item;
  });
  var kids = {};
  (r.edges || []).forEach(function (e) {
    (kids[e.from] = kids[e.from] || []).push(e.to);
  });
  var term = {};
  (r.terminals || []).forEach(function (item) {
    term[item.chit_id] = 1;
  });
  var hasParent = {};
  (r.edges || []).forEach(function (e) {
    hasParent[e.to] = 1;
  });
  var roots = (r.nodes || [])
    .filter(function (item) {
      return !hasParent[item.chit_id];
    })
    .map(function (item) {
      return item.chit_id;
    });
  if (!roots.length && r.start) roots = [r.start]; // walk always has a single flagged root; batch-reconstruct may be a forest
  var seen = {};
  function render(id) {
    if (seen[id]) return '';
    seen[id] = 1;
    var n = byId[id] || { chit_id: id };
    var kidHtml = (kids[id] || []).map(render).join('');
    return (
      '<div>' +
      _traceNode(n, !!term[id]) +
      (kidHtml ? '<div style="margin-inline-start:8px;border-inline-start:1.5px solid var(--line);padding-inline-start:15px">' + kidHtml + '</div>' : '') +
      '</div>'
    );
  }
  return roots.map(render).join('');
}

function _traceBwd(r) {
  var path = r.path || [],
    nodes = r.nodes || [];
  var byId = {};
  nodes.forEach(function (item) {
    byId[item.chit_id] = item;
  });
  var head =
    '<div style="margin:16px 18px;padding:14px 18px;border:1px solid #a9c6ef;background:var(--blue-tint-bg);border-radius:12px;color:var(--on-card)">' +
    '<div style="font-size:var(--fs-4);font-weight:800;color:var(--blue-2)"><span class=arw>◂</span> Where it came from — back to source</div>' +
    '<div style="font-size:var(--fs-2);color:var(--blue);margin-top:2px">' +
    r.hops +
    ' hop' +
    (r.hops === 1 ? '' : 's') +
    ' from the flagged node back to origin</div></div>';
  var steps = path
    .map(function (item, index) {
      var n = byId[item] || { chit_id: item };
      var arrow = index < path.length - 1 ? '<div style="color:var(--grey);font-size:var(--fs-3);padding:2px 0 2px 22px">↓</div>' : '';
      var tag = index === 0 ? 'SOURCE' : index === path.length - 1 ? 'FLAGGED' : 'HOP ' + index;
      return (
        '<div style="padding:2px 18px"><span style="font-size:var(--fs-1);font-weight:800;color:var(--grey);margin-inline-end:8px">' +
        tag +
        '</span>' +
        _traceChip(n, false) +
        '</div>' +
        arrow
      );
    })
    .join('');
  return head + '<div style="padding:6px 0 18px">' + steps + '</div>';
}

function runTrace(dir) {
  var id = (UI.traceId || '').trim();
  if (!id) {
    if (typeof toast === 'function') toast('Paste a batch / chit id to trace.');
    return;
  }
  UI.traceLoading = true;
  UI.traceResult = undefined;
  if (typeof renderApp === 'function') renderApp();
  api('traceWalk', { params: { id: id }, query: { dir: dir } })
    .then(function (reply) {
      UI.traceLoading = false;
      reply = reply || {};
      reply.dir = dir;
      UI.traceResult = reply;
      if (typeof renderApp === 'function') renderApp();
    })
    .catch(function (e) {
      UI.traceLoading = false;
      UI.traceResult = { error: (e && e.message) || 'Trace failed — is this a batch you oversee?' };
      if (typeof renderApp === 'function') renderApp();
    });
}
// Reconstruct the chain from a shared batch number instead of the links (proves the graph survives without them).
function runTraceByBatch() {
  var q = (UI.traceBatchQ || '').trim();
  if (!q) {
    if (typeof toast === 'function') toast('Type a batch number to reconstruct.');
    return;
  }
  UI.traceLoading = true;
  UI.traceResult = undefined;
  if (typeof renderApp === 'function') renderApp();
  api('traceByBatch', { query: { q: q } })
    .then(function (reply) {
      UI.traceLoading = false;
      reply = reply || {};
      reply.dir = 'forward';
      UI.traceResult = reply;
      if (typeof renderApp === 'function') renderApp();
    })
    .catch(function (e) {
      UI.traceLoading = false;
      UI.traceResult = { error: (e && e.message) || 'Batch trace failed' };
      if (typeof renderApp === 'function') renderApp();
    });
}
