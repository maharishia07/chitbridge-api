/* app/cap-connector.js — IoT / ERP connector MANAGEMENT (lazy; loaded via ensureCap('connector') on INVOCATION).
 * The list VIEW (rows, badges, health) lives in cap-workforce and renders from flags — this module is only the
 * heavy Tier-2 management: the device cockpit, provisioning/connection-string, add-device, regenerate, and the
 * one-drop package installer. It SELF-REGISTERS its renderer into ACTOR_MANAGE, so the generic dispatcher finds it.
 * Backend: routes/connectors.js + migration b62. Nothing ships to entities that never open a connector.
 * OWNS      the connector cockpit (IoT / ERP management): provisioning, add device, regenerate key, the one-drop installer; it registers itself into ACTOR_MANAGE.
 * CALLED BY app.html: CAP_OF connectors → 'connector' (and CAP_GATED) · cap-workforce.js (ensureCap('connector'); acLoadDevices · piCockpit · _download · _buildInstaller). The Connectors card opens /settings.html#/connectors, which loads no cap-connector.js: SUPPORT.
 * FLOW      ensureCap('connector') → registers into ACTOR_MANAGE → acLoadDevices → piCockpit → acAddDevice / acToggleDevice / acRegenKey / acCreatePackage
 * CARD      28-platform-and-operations/connector-cockpit
 */

if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    connectorConns: { m: 'GET', p: '/api/connectors/:actorId/connections', ok: 'y' },
    connectorConnAdd: { m: 'POST', p: '/api/connectors/:actorId/connections', ok: 'y' },
    connectorConnToggle: { m: 'PATCH', p: '/api/connectors/:actorId/connections/:connId', ok: 'y' },
    connectorProvision: { m: 'GET', p: '/api/connectors/:actorId/provisioning', ok: 'y' },
    connectorRegen: { m: 'POST', p: '/api/connectors/:actorId/regenerate-key', ok: 'y' },
    connectorPing: { m: 'POST', p: '/api/connectors/:actorId/ping', ok: 'y' },
    connectorCreate: { m: 'POST', p: '/api/connectors', ok: 'y' },
    connectorList: { m: 'GET', p: '/api/connectors', ok: 'y' },
    connectorDelete: { m: 'DELETE', p: '/api/connectors/:actorId', ok: 'y' },
    connectorReissueCode: { m: 'POST', p: '/api/connectors/reissue-code', ok: 'y' },
    connectorErpTest: { m: 'POST', p: '/api/connectors/:actorId/erp-test', ok: 'y' },
    connectorReceipts: { m: 'GET', p: '/api/connectors/:actorId/receipts', ok: 'y' }
  });
}

async function acLoadDevices(id) {
  UI.acConnsErr = null;
  var ok = false,
    lastErr = null; // retry once — a cold-start blip must NOT silently show "no devices"
  for (var index = 0; index < 2 && !ok; index++) {
    /**
     * ⚠️⚠️ `r` IS THE CONNECTIONS ARRAY, not an envelope around it. api() collapses a response whose array key
     * is on its list, so `r.connections` was undefined and this read `[]` on every successful call — an empty
     * device list and a permanent "offline", whatever the Pi was really doing. Found 2026-09-16 by
     * e2e/api-envelope.cjs. The two siblings now survive the collapse (SIBS in core.js); the array is taken as
     * itself, with the old shape kept as a fallback so an endpoint that stops collapsing still works.
     */
    try {
      var reply = await api('connectorConns', { params: { actorId: id } });
      UI.acConns = Array.isArray(reply) ? reply : (reply && reply.connections) || [];
      UI.acHealth = (reply && reply.actor_health) || 'offline';
      UI.acLastSeen = (reply && reply.actor_last_seen) || null;
      ok = true;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!ok) {
    UI.acConns = [];
    UI.acHealth = 'offline';
    UI.acConnsErr = (lastErr && lastErr.message) || 'Could not load devices';
  }
  try {
    UI.acProv = await api('connectorProvision', { params: { actorId: id } });
  } catch (_) {
    UI.acProv = null;
  }
  if (UI.acSel === id) paintAcDetail();
  // ERP: the receipt ledger is the ERP-specific value — lazy-load it on cockpit open (on-demand, never pre-loaded).
  if ((UI._connMap || {})[id] === 'erp') {
    UI.acReceipts = undefined;
    UI.acReceiptsErr = null;
    acLoadReceipts(id);
  }
}
async function acLoadReceipts(id) {
  try {
    var reply = await api('connectorReceipts', { params: { actorId: id } });
    UI.acReceipts = (reply && reply.receipts) || [];
    UI.acReceiptsErr = null;
  } catch (e) {
    UI.acReceipts = [];
    UI.acReceiptsErr = (e && e.message) || 'Could not load receipts';
  }
  if (UI.acSel === id) paintAcDetail();
}
// OWNER-authed test cycle: fire the real process-then-forget loop with a sample doc, then refresh the ledger + health.
async function acErpTest(id) {
  try {
    var reply = await api('connectorErpTest', { params: { actorId: id } });
    var oc = (reply && reply.outcome) || 'processed';
    if (typeof toast === 'function')
      toast(
        'Processed ' +
          ((reply && reply.doc_type) || 'document') +
          ' ' +
          ((reply && reply.doc_ref) || '') +
          ' — receipt kept' +
          (oc === 'processed' ? ', chit sent' : '') +
          '.'
      );
    UI.acReceipts = undefined;
    if (UI.acSel === id) paintAcDetail();
    await acLoadReceipts(id);
    await acLoadDevices(id);
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || 'Test failed');
  }
}
// Type-aware "how it works" — the per-service info affordance (the ℹ️ header icon).
function acHowItWorks(iot) {
  if (typeof modal !== 'function') {
    if (typeof toast === 'function') toast('Cannot open help.');
    return;
  }
  var body = iot
    ? '<div style="font-weight:800;font-size:var(--fs-4);margin-bottom:8px">' +
      tx('🛰️ How an IoT connector works') +
      '</div><div style="font-size:var(--fs-2);color:var(--ink-2);line-height:1.6">' +
      txf(
        'A Pi or gateway holds its own key and {pushes} readings to the rail. Each exception becomes a {chit} filed into your folder — the reading itself is the record that is kept.',
        { pushes: '<b>' + tx('pushes') + '</b>', chit: '<b>' + tx('co-held chit') + '</b>' }
      ) +
      specNote('connector.iot-health', 'Health goes live by heartbeat.') +
      '</div>'
    : '<div style="font-weight:800;font-size:var(--fs-4);margin-bottom:8px">' +
      tx('🔌 How an ERP connector works') +
      '</div><div style="font-size:var(--fs-2);color:var(--ink-2);line-height:1.6">' +
      txf(
        'Your ERP or middleware {push} over the governed rail. We {pf}: only the {summary} travels on as a co-held chit, and we keep a {receipt} — a hash of the payload plus the outcome — {never}. Retries are safe (idempotent by hash). It stays auditable and disputable against the hash, with neither side holding your ERP data.',
        {
          push: '<b>pushes a document</b>',
          pf: '<b>process then forget</b>',
          summary: '<b>summary</b>',
          receipt: '<b>receipt</b>',
          never: '<b>never the raw document</b>'
        }
      ) +
      '</div>' +
      '<div style="font-size:var(--fs-1);color:var(--blue-2);background:var(--blue-tint);border:1px solid var(--blue-tint-line);border-radius:9px;padding:9px 11px;margin-top:12px">' +
      txf('Tap {btn} below to run the whole loop once and watch a receipt appear.', { btn: '<b>' + tx('📄 Send a test document') + '</b>' }) +
      '</div>';
  modal(
    '<div style="padding:2px 2px">' +
      body +
      '<div style="display:flex;margin-top:16px"><button data-cbsid="CMP004" class="composebtn pri" style="flex:1" onclick="closeModal()">' +
      tx('Got it') +
      '</button></div></div>',
    false
  );
}
// The ERP receipt ledger — hash + outcome only, NEVER the raw payload. Chit link opens the co-held record.
function _erpReceiptsHTML() {
  var list = UI.acReceipts;
  var head =
    '<div class="sec" style="margin-top:16px">Receipts' +
    (Array.isArray(list) ? ' <span style="color:var(--grey);font-weight:400">(' + list.length + ')</span>' : '') +
    '</div>';
  if (list === undefined) return head + '<div style="padding:10px 2px;color:var(--grey);font-size:var(--fs-2)">' + tx('Loading…') + '</div>';
  if (UI.acReceiptsErr)
    return (
      head +
      '<div style="padding:10px 2px;color:var(--disp);font-size:var(--fs-2)">⚠ ' +
      esc(UI.acReceiptsErr) +
      ' <button data-cbsid="CMP009" class="composebtn" style="padding:2px 9px;font-size:var(--fs-1);margin-inline-start:6px" onclick="acLoadReceipts(\'' +
      esc(UI.acSel) +
      '\')">' +
      tx('Retry') +
      '</button></div>'
    );
  if (!list.length)
    return (
      head +
      '<div style="padding:10px 2px;color:var(--grey);font-size:var(--fs-2)">' +
      txf('No documents yet. Tap {btn} to run the cycle.', { btn: '<b>' + tx('📄 Send a test document') + '</b>' }) +
      '</div>'
    );
  var rows = list
    .map(function (item) {
      var oc = item.outcome || '',
        col = oc === 'processed' ? 'var(--ok-3)' : oc === 'failed' ? 'var(--disp)' : oc === 'duplicate' ? 'var(--warn-2)' : 'var(--grey-2)';
      return (
        '<div style="display:flex;align-items:center;gap:9px;padding:9px 0;border-bottom:1px dashed var(--line);font-size:var(--fs-2)">' +
        '<div style="flex:1;min-width:0"><b>' +
        esc(item.doc_ref || item.doc_type || 'document') +
        '</b>' +
        (item.doc_type ? ' <span style="color:var(--grey);font-size:var(--fs-1)">' + esc(item.doc_type) + '</span>' : '') +
        '<div style="color:var(--grey);font-size:var(--fs-1);margin-top:1px;font-family:monospace">#' +
        esc(String(item.payload_hash || '').slice(0, 12)) +
        '… · ' +
        esc((typeof _ago === 'function' ? _ago(item.received_at) : '') || '') +
        '</div></div>' +
        '<span style="font-weight:700;font-size:var(--fs-1);color:' +
        col +
        '">' +
        esc(oc) +
        '</span>' +
        (item.chit_id
          ? '<button data-cbsid="SCR002-B01" class="composebtn" style="padding:2px 9px;font-size:var(--fs-1)" onclick="openChit(\'' +
            esc(item.chit_id) +
            '\')">' +
            tx('Open chit') +
            '</button>'
          : '') +
        '</div>'
      );
    })
    .join('');
  return head + '<div style="font-size:var(--fs-1);color:var(--grey);margin:4px 0 2px">Hash + outcome only — the raw payload is never stored.</div>' + rows;
}
function _hdot(h) {
  return healthDot(h);
} // shared: helpers.js healthDot/sigLabel
function _sig(s) {
  return sigLabel(s);
}
function _tile(k, v) {
  return (
    '<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 11px;min-width:0;color:var(--on-card)"><div style="font-size:var(--fs-1);color:var(--grey);text-transform:uppercase;letter-spacing:.03em">' +
    k +
    '</div><div style="font-size:var(--fs-5);font-weight:800;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
    v +
    '</div></div>'
  );
}
function piCockpit(x) {
  var iot = acTypeOf(x) === 'iot',
    health = UI.acHealth || 'offline';
  var tchip = iot
    ? '<span class="optchip" style="background:var(--blue-tint-bg);color:var(--blue-2);border-color:var(--blue-tint-line)">' + tx('🛰️ IoT') + '</span>'
    : '<span class="optchip" style="background:var(--purple-tint);color:var(--blue);border-color:#ddcff2">' + tx('🔌 ERP') + '</span>';
  var ico = function (t, title, on) {
    return (
      '<button data-cbsid="SCR002-B02" title="' +
      title +
      '" onclick="' +
      on +
      '" style="border:1px solid var(--line);background:var(--card);border-radius:9px;width:34px;height:34px;cursor:pointer;font-size:15px;color:var(--on-card)">' +
      t +
      '</button>'
    );
  };
  var header =
    '<div style="position:sticky;top:0;background:var(--card);z-index:5;padding-bottom:10px;border-bottom:1px solid var(--line);color:var(--on-card)">' +
    '<button data-cbsid="SCR002-B03" class="dback" onclick="backToList()">‹ Co-assists</button>' +
    '<div style="display:flex;align-items:center;gap:9px;margin-top:6px"><span style="font-size:var(--fs-4);font-weight:700">' +
    esc(x.name) +
    '</span> ' +
    tchip +
    ' ' +
    _hdot(health) +
    '<span style="margin-inline-start:auto;display:inline-flex;gap:7px">' +
    ico('ℹ️', 'How it works', 'acHowItWorks(' + (iot ? 'true' : 'false') + ')') +
    ico('⚡', iot ? 'Test connection' : 'Ping — mark live', "acPing('" + x.id + "')") +
    ico('🔑', 'Connection string', 'UI.acProvOpen=!UI.acProvOpen;paintAcDetail()') +
    (iot ? ico('📦', 'Create package — one-drop Pi installer', "acCreatePackage('" + x.id + "')") : '') +
    ico('＋', 'Add ' + (iot ? 'device' : 'endpoint'), 'UI.acAddDev=!UI.acAddDev;paintAcDetail()') +
    ico(
      '🗑',
      'Delete this ' + (iot ? 'gateway' : 'system'),
      "acDeleteConnector('" + x.id + "','" + esc(String(x.name).replace(/\\/g, '\\\\').replace(/'/g, "\\'")) + "')"
    ) +
    '</span></div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:3px">📍 ' +
    esc(x.site || 'no site') +
    ' · ' +
    esc(health) +
    '</div></div>';
  var offline =
    health === 'offline'
      ? '<div style="background:var(--danger-tint);border:1px solid #f0c9c6;color:var(--disp);border-radius:9px;padding:9px 11px;font-size:var(--fs-2);font-weight:600;margin:10px 0">⚠ ' +
        (iot ? 'Gateway' : 'System') +
        ' OFFLINE — no ' +
        (iot ? 'device' : 'endpoint') +
        ' below can signal until it is back.</div>'
      : '';
  var prov = UI.acProvOpen ? _provPanel(iot, x.id) : '';
  var addf = UI.acAddDev ? _addDeviceForm(x, iot) : '';
  var _loadingT = UI.acConns === undefined;
  var _cn = _loadingT ? [] : UI.acConns || [];
  var _live = _cn.filter(function (item) {
    return item.signal === 'live';
  }).length;
  var _agoT = typeof _ago === 'function' ? _ago(UI.acLastSeen) : '';
  var tiles =
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:14px 0">' +
    _tile(iot ? 'Devices' : 'Endpoints', _loadingT ? '—' : _cn.length) +
    _tile(
      'Live now',
      _loadingT
        ? '—'
        : '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;vertical-align:middle;background:' +
            (_live > 0 ? 'var(--ok-3)' : 'var(--disp)') +
            ';color:' +
            (_live > 0 ? 'var(--on-ok)' : 'var(--on-danger)') +
            ';margin-inline-end:6px"></span>' +
            _live +
            ' <small style="font-size:var(--fs-2);color:var(--grey-2);font-weight:600">/ ' +
            _cn.length +
            '</small>'
    ) +
    _tile('Last signal', _loadingT ? '—' : _agoT || '—') +
    '</div>';
  var conns = UI.acConns,
    list;
  if (conns === undefined) list = '<div style="padding:16px;color:var(--grey);font-size:var(--fs-2)">' + tx('Loading…') + '</div>';
  else if (UI.acConnsErr)
    list =
      '<div style="padding:10px 2px;color:var(--disp);font-size:var(--fs-2)">⚠ ' +
      esc(UI.acConnsErr) +
      ' <button data-cbsid="CMP009" class="composebtn" style="padding:2px 9px;font-size:var(--fs-1);margin-inline-start:6px" onclick="acLoadDevices(\'' +
      x.id +
      '\')">' +
      tx('Retry') +
      '</button></div>';
  else if (!conns.length)
    list = '<div style="padding:10px 2px;color:var(--grey);font-size:var(--fs-2)">No ' + (iot ? 'devices' : 'endpoints') + ' yet. Tap ＋ to add one.</div>';
  else
    list = conns
      .map(function (item) {
        var cfg = item.conn_config || {};
        var det = iot
          ? [cfg.folder ? '📁 ' + cfg.folder : null, cfg.classes && cfg.classes.length ? '🏷 ' + cfg.classes.join('/') : null, cfg.topic, cfg.device_id]
              .filter(Boolean)
              .join(' · ')
          : cfg.path || '';
        return (
          '<div style="display:flex;align-items:center;gap:9px;padding:10px 0;border-bottom:1px dashed var(--line);font-size:var(--fs-2)"><div style="flex:1;min-width:0"><b>' +
          esc(item.ref) +
          '</b>' +
          (item.user_id || item.bridge_id
            ? ' <code style="background:var(--card);border:1px solid #eee;border-radius:5px;padding:0 5px;font-size:var(--fs-1);color:var(--grey)">' +
              esc(item.bridge_id) +
              '</code>'
            : '') +
          (det ? '<div style="color:var(--grey);font-size:var(--fs-1);margin-top:1px">' + esc(det) + '</div>' : '') +
          '</div>' +
          _sig(item.enabled === false ? 'silent' : item.signal) +
          '<button data-cbsid="SCR002-B04" class="composebtn" style="padding:2px 9px;font-size:var(--fs-1)" onclick="acToggleDevice(\'' +
          x.id +
          "'," +
          item.connection_id +
          ',' +
          (item.enabled ? 'false' : 'true') +
          ')">' +
          (item.enabled ? 'Disable' : 'Enable') +
          '</button></div>'
        );
      })
      .join('');
  // Obvious, labelled installer button (the bare 📦 header icon was too easy to miss) + an inline caution: this DOWNLOAD
  // reissues the key, so any device already running this gateway goes silent until reflashed. The confirm gates it too.
  var installerBtn = iot
    ? '<button data-cbsid="SCR002-B05" class="composebtn pri" style="width:100%;margin:8px 0 3px" onclick="acCreatePackage(\'' +
      x.id +
      '\')">' +
      tx('📦 Get the Pi installer') +
      '</button><div style="font-size:var(--fs-1);color:var(--warn-2);text-align:center;margin-bottom:8px;line-height:1.45">' +
      txf('⚠ Downloading {reissues} — a device already running this gateway goes silent until you reflash it with the new installer.', {
        reissues: '<b>' + tx('reissues the key') + '</b>'
      }) +
      '</div>'
    : '';
  // ERP has no installer; its one-tap live-run is a sample document through the real process-then-forget cycle.
  var erpTestBtn = !iot
    ? '<button data-cbsid="SCR002-B06" class="composebtn pri" style="width:100%;margin:8px 0 3px" onclick="acErpTest(\'' +
      x.id +
      '\')">' +
      tx('📄 Send a test document') +
      '</button><div style="font-size:var(--fs-1);color:var(--grey);text-align:center;margin-bottom:8px;line-height:1.45">' +
      txf('Runs the whole loop once with a sample document.', {}) +
      specNote(
        'connector.process-then-forget',
        'The real <b>process-then-forget</b> cycle: a receipt (hash + outcome) is kept and a co-held chit is sent. The raw payload is never stored.'
      ) +
      '</div>'
    : '';
  var govLink = iot
    ? '<button data-cbsid="SCR002-B07" class="composebtn" style="width:100%;margin:2px 0 9px;display:flex;align-items:center;justify-content:center;gap:7px;font-size:var(--fs-2)" onclick="if(typeof openBlueprint===\'function\')openBlueprint(\'iot-signal\')">🔒 What governs this signal — licence · sealed · open <span class=arw>→</span></button>'
    : '';
  return (
    header +
    tiles +
    govLink +
    installerBtn +
    erpTestBtn +
    offline +
    prov +
    addf +
    '<div class="sec" style="margin-top:14px">' +
    (iot ? 'Devices' : 'Endpoints') +
    (conns ? ' <span style="color:var(--grey);font-weight:400">(' + conns.length + ')</span>' : '') +
    '</div>' +
    list +
    (iot ? '' : _erpReceiptsHTML())
  );
}
function _provPanel(iot, aid) {
  var p = UI.acProv;
  if (!p) return '<div style="padding:10px 2px;color:var(--grey);font-size:var(--fs-2)">' + tx('Loading connection string…') + '</div>';
  var lines = iot
    ? 'Endpoint = ' +
      esc(p.endpoint || '') +
      '\nActorKey = ••••••••  (secret — Regenerate to issue a fresh one)\nBridgeIds:\n' +
      ((p.publishes || [])
        .map(function (item) {
          return '  ' + esc(item.user_id || item.bridge_id || '—') + '  ' + esc(item.ref || '');
        })
        .join('\n') || '  (none yet)')
    : 'Base URL = ' + esc(p.base_url || '—') + '\nAuth = ' + esc(p.auth_type || 'none') + (p.auth_ref ? ' (ref: ' + esc(p.auth_ref) + ')' : '');
  var fresh =
    iot && UI.acFreshKey
      ? '<div style="border:1px solid #bfe6c9;background:var(--ok-tint);border-radius:9px;padding:9px 11px;margin-top:9px;color:var(--on-card)"><div style="font-size:var(--fs-1);font-weight:700;color:var(--ok-2);margin-bottom:5px">✅ New ActorKey — copy it to the Pi NOW, it will not be shown again:</div><pre style="background:var(--chrome);color:var(--blue-tint-line);border-radius:6px;padding:9px 11px;font-size:var(--fs-2);overflow:auto;margin:0;user-select:all">' +
        esc(UI.acFreshKey) +
        '</pre></div>'
      : '';
  var regen =
    iot && aid
      ? '<div style="margin-top:9px"><button data-cbsid="SCR002-B08" class="composebtn" onclick="acRegenKey(\'' +
        esc(aid) +
        '\')">' +
        tx('♻ Reissue raw key (advanced)') +
        '</button><div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px">' +
        txf(
          'For a {dev} that cannot run the installer — shows the raw key once. For a Pi, use {btn} above instead. Either way, reissuing stops any device on the old key until it is reflashed.',
          {
            dev: '<b>' + tx('direct HTTPS device') + ' (ESP32 etc.)</b>',
            btn: '<b>' + tx('📦 Get the Pi installer') + '</b>'
          }
        ) +
        '</div></div>'
      : '';
  return (
    '<div style="border:1px solid var(--blue-tint-line);background:var(--blue-tint-bg);border-radius:9px;padding:10px 12px;margin:10px 0;color:var(--on-card)"><div style="font-weight:700;font-size:var(--fs-2);color:var(--blue-2);margin-bottom:4px">' +
    tx('🔑 Connection string') +
    '</div><pre style="background:var(--chrome);color:var(--blue-tint-line);border-radius:6px;padding:9px 11px;font-size:var(--fs-1);overflow:auto;margin:0;line-height:1.5">' +
    lines +
    '</pre>' +
    fresh +
    regen +
    '</div>'
  );
}
// Delete a connector — RULE: only when it has NO devices attached; the backend returns 409 otherwise (we surface it).
function acDeleteConnector(id, name) {
  var run = async function () {
    try {
      await api('connectorDelete', { params: { actorId: id } });
      if (typeof toast === 'function') toast('Deleted ' + (name || 'connector'));
      UI.acSel = null;
      UI.connectors = undefined;
      if (typeof backToList === 'function') backToList();
      if (typeof loadCoassists === 'function') loadCoassists();
    } catch (e) {
      if (typeof toast === 'function') toast((e && e.message) || 'Delete failed — it may have devices attached.');
    }
  };
  if (typeof confirmAsk === 'function')
    confirmAsk(
      'Delete connector',
      'Delete <b>' +
        esc(name || 'this connector') +
        '</b>? ' +
        txf('Only allowed if it has {none} — remove its devices first otherwise. This cannot be undone.', {
          none: '<b>' + tx('no devices attached') + '</b>'
        }) +
        '',
      'Delete',
      run,
      true
    );
  else if (window.confirm('Delete ' + (name || 'this connector') + '? Only if it has no devices attached.')) run();
}
function acRegenKey(id) {
  acReissueGate(id, 'key');
} // gated: name + one-time code (see acReissueGate)
function _addDeviceForm(x, iot) {
  var _asgOpts =
    '<option value="">— entity default —</option>' +
    (UI.acts || [])
      .filter(function (item) {
        return (typeof acTypeOf !== 'function' || acTypeOf(item) === 'human') && (typeof hatAssignable !== 'function' || hatAssignable(item.hat));
      })
      .map(function (item) {
        return '<option value="' + esc(item.id) + '">' + esc(item.name) + '</option>';
      })
      .join('');
  var spec = iot
    ? '<label class="fl">' +
      tx('Topic') +
      '</label><input data-cbsid="SCR002-I01" class="inp" id="ad_topic" data-testid="conn-topic" placeholder="sensors/line1/temp" style="width:100%"><label class="fl">' +
      tx('Device id') +
      '</label><input data-cbsid="SCR002-I02" class="inp" id="ad_dev" data-testid="conn-device-id" placeholder="edge-gw-01" style="width:100%">'
    : '<label class="fl">' +
      tx('Resource path') +
      '</label><input data-cbsid="SCR002-I03" class="inp" id="ad_path" data-testid="conn-path" placeholder="/odata/PurchaseOrders" style="width:100%">';
  return (
    '<div style="border:1px dashed #c9d2dd;border-radius:9px;padding:12px;margin:10px 0;background:var(--blue-tint-bg);color:var(--on-card)"><div style="font-weight:700;font-size:var(--fs-2);margin-bottom:2px">Add ' +
    (iot ? 'device' : 'endpoint') +
    '</div>' +
    '<label class="fl">' +
    tx('Name') +
    '</label><input data-cbsid="SCR002-I04" class="inp" id="ad_ref" data-testid="conn-device-name" placeholder="' +
    (iot ? 'Cold-store temp' : 'PO inbound') +
    '" style="width:100%">' +
    spec +
    (iot
      ? '<label class="fl">Folder — file its exceptions here <span style="font-weight:400;color:var(--grey)">(a name you choose, under this entity)</span></label><input data-cbsid="SCR002-I05" class="inp" id="ad_folder" placeholder="e.g. Gate log" style="width:100%">' +
        '<label class="fl">Keep — exception classes <span style="font-weight:400;color:var(--grey)">(comma-sep · blank = all; group / count by these)</span></label><input data-cbsid="SCR002-I06" class="inp" id="ad_classes" placeholder="lorry, tanker" style="width:100%">' +
        '<label class="fl">Default assignee <span style="font-weight:400;color:var(--grey)">(who this device\'s signals are assigned to — blank = entity default)</span></label><select data-cbsid="SCR002-S01" class="inp" id="ad_assignee" style="width:100%">' +
        _asgOpts +
        '</select>' +
        '<label class="fl">External email <span style="font-weight:400;color:var(--grey)">(optional — notify someone OUTSIDE the system by email; a notice, not the data)</span></label><input data-cbsid="SCR002-I07" class="inp" id="ad_notifyemail" type="email" placeholder="name@example.com" style="width:100%">'
      : '') +
    '<label class="fl">CC <span style="font-weight:400;color:var(--grey)">(optional — another entity id who also co-holds the proof)</span></label><input data-cbsid="SCR002-I08" class="inp" id="ad_cp" placeholder="another entity id" style="width:100%">' +
    '<div class="err" id="ad_err" style="margin-top:6px"></div>' +
    '<div style="display:flex;gap:8px;margin-top:10px"><button data-cbsid="CMP007" class="composebtn pri" onclick="acAddDevice(\'' +
    x.id +
    "'," +
    (iot ? 'true' : 'false') +
    ')">' +
    tx('Add') +
    '</button><button data-cbsid="CMP003" class="composebtn" onclick="UI.acAddDev=false;paintAcDetail()">' +
    tx('Cancel') +
    '</button></div></div>'
  );
}
async function acAddDevice(id, iot) {
  var ref = (val('ad_ref') || '').trim(),
    err = document.getElementById('ad_err');
  if (err) err.textContent = '';
  if (!ref) {
    if (err) err.textContent = 'A name is required.';
    return;
  }
  var _cls = (val('ad_classes') || '')
    .split(',')
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean);
  var config = iot
    ? {
        protocol: 'mqtts',
        topic: (val('ad_topic') || '').trim() || undefined,
        device_id: (val('ad_dev') || '').trim() || undefined,
        folder: (val('ad_folder') || '').trim() || undefined,
        classes: _cls.length ? _cls : undefined,
        default_assignee: (val('ad_assignee') || '').trim() || undefined,
        notify_email: (val('ad_notifyemail') || '').trim() || undefined
      }
    : { path: (val('ad_path') || '').trim() || undefined };
  var cp = (val('ad_cp') || '').trim() || undefined; // counterparty entity id — where this device's signals route as chits
  try {
    await api('connectorConnAdd', { params: { actorId: id }, body: { ref: ref, direction: 'in', config: config, counterparty_entity_id: cp } });
    UI.acAddDev = false;
    if (typeof toast === 'function') toast('Added.');
    await acLoadDevices(id);
  } catch (e) {
    if (err) err.textContent = (e && e.message) || 'Add failed';
  }
}
async function acToggleDevice(id, connId, enabled) {
  try {
    await api('connectorConnToggle', { params: { actorId: id, connId: connId }, body: { enabled: enabled } });
    await acLoadDevices(id);
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || 'Update failed');
  }
}
async function acPing(id) {
  try {
    await api('connectorPing', { params: { actorId: id }, body: {} });
    if (typeof toast === 'function') toast('Ping sent — marked live.');
    await acLoadDevices(id);
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || 'Ping failed');
  }
}
// ═══ CREATE PACKAGE → one-drop installer. Rotates the key (only a fresh key can be embedded — we store only the hash),
//     bundles endpoint + key + device routing + a long-running AGENT (heartbeat + spool drain w/ store-and-forward) +
//     a systemd service, all as an install.sh generated in-browser (key never sits at a URL). Run: sudo bash it on the Pi.
function _download(name, text) {
  try {
    var b = new Blob([text], { type: 'text/x-shellscript' });
    var u = URL.createObjectURL(b);
    var node = document.createElement('a');
    node.href = u;
    node.download = name;
    document.body.appendChild(node);
    node.click();
    setTimeout(function () {
      URL.revokeObjectURL(u);
      node.remove();
    }, 600);
  } catch (e) {
    if (typeof toast === 'function') toast('Download failed');
  }
}
function _agentJs() {
  return [
    '#!/usr/bin/env node',
    '// Chit & Bridge IoT agent (long-running). Heartbeats each device + drains a SPOOL directory (store-and-forward).',
    '// Your edge AI writes <name>.json into the spool, e.g:  {"bridge_id":"CB..","sub_type":"tanker","value":"1","image":"/path/frame.jpg"}',
    '// An event leaves the spool for sent/ ONLY on a 2xx answer; anything else (a refusal, a chit not delivered) keeps it here and it is sent again.',
    'var fs=require("fs"), path=require("path"), https=require("https"), URL=require("url").URL;',
    'var CFG=JSON.parse(fs.readFileSync(path.join(__dirname,"config.json"),"utf8"));',
    'var SPOOL=CFG.spool_dir||path.join(__dirname,"spool"), SENT=path.join(__dirname,"sent");',
    'try{ fs.mkdirSync(SPOOL,{recursive:true}); fs.mkdirSync(SENT,{recursive:true}); }catch(e){}',
    'function post(body){ return new Promise(function(res,rej){ var base=String(CFG.endpoint); if(base.slice(-1)==="/")base=base.slice(0,-1);',
    '  var u=new URL(base+"/api/connectors/ingest"); var data=JSON.stringify(body);',
    '  var r=https.request({method:"POST",hostname:u.hostname,port:u.port||443,path:u.pathname,headers:{"Content-Type":"application/json","X-Bridge-Key":CFG.key,"Content-Length":Buffer.byteLength(data)}},function(x){ var b=""; x.on("data",function(c){b+=c;}); x.on("end",function(){ if(x.statusCode<200||x.statusCode>=300){ var j; try{j=JSON.parse(b)||{};}catch(e){ j={message:b}; } rej(new Error(["HTTP",x.statusCode,j.code,String(j.message||b).slice(0,160)].filter(Boolean).join(" "))); } else{ try{res(JSON.parse(b));}catch(e){res(b);} } }); }); r.on("error",rej); r.write(data); r.end(); }); }',
    'function heartbeat(){ (CFG.devices||[]).forEach(function(d){ post({bridge_id:d.bridge_id,heartbeat_only:true}).catch(function(e){ console.error("[hb]",d.bridge_id,e.message); }); }); }',
    'function drain(){ var files=[]; try{ files=fs.readdirSync(SPOOL).filter(function(f){return f.slice(-5)===".json";}); }catch(e){ return; }',
    '  files.forEach(function(f){ var fp=path.join(SPOOL,f), ev; try{ ev=JSON.parse(fs.readFileSync(fp,"utf8")); }catch(e){ return; }',
    '    var proof; if(ev.image){ try{ proof=fs.readFileSync(path.isAbsolute(ev.image)?ev.image:path.join(SPOOL,ev.image)).toString("base64"); }catch(e){} }',
    '    post({bridge_id:ev.bridge_id,sub_type:ev.sub_type,signal:ev.signal||"exception",value:ev.value,unit:ev.unit,device_id:ev.device_id,proof:proof,proof_name:ev.image?path.basename(ev.image):undefined})',
    '      .then(function(out){ console.log("[sent]",f,(out&&out.chit_id)||""); try{ fs.renameSync(fp,path.join(SENT,f)); }catch(e){ console.error("[move to sent]",f,e.message); } if(out&&out.proof_err){ console.error("[proof kept]",f,out.proof_err); } else if(ev.image){ try{ fs.unlinkSync(path.isAbsolute(ev.image)?ev.image:path.join(SPOOL,ev.image)); }catch(e){ console.error("[image]",e.message); } } })',
    '      .catch(function(e){ console.error("[kept for retry]",f,e.message); }); });',
    '}',
    'console.log("[chitbridge] agent up · devices",(CFG.devices||[]).length,"· spool",SPOOL);',
    'heartbeat(); drain(); setInterval(function(){ heartbeat(); drain(); }, (CFG.heartbeat_sec||60)*1000);'
  ].join('\n');
}
function _buildInstaller(cfg) {
  var ndev = (cfg.devices || []).length,
    cfgJson = JSON.stringify(cfg, null, 2),
    agent = _agentJs();
  var list = [];
  list.push('#!/usr/bin/env bash');
  list.push('set -e');
  list.push('echo "== Chit and Bridge IoT agent installer =="');
  list.push('if ! command -v node >/dev/null 2>&1; then');
  list.push('  echo "Installing Node.js...";');
  list.push(
    '  (command -v apt-get >/dev/null 2>&1 && sudo apt-get update -y && sudo apt-get install -y nodejs) || { echo "Please install Node.js manually, then re-run."; exit 1; }'
  );
  list.push('fi');
  list.push('DIR=/opt/chitbridge');
  list.push('sudo mkdir -p "$DIR/spool" "$DIR/sent"');
  list.push('sudo tee "$DIR/config.json" >/dev/null <<\'CBCFG\'');
  list.push(cfgJson);
  list.push('CBCFG');
  list.push('sudo tee "$DIR/agent.js" >/dev/null <<\'CBAGENT\'');
  list.push(agent);
  list.push('CBAGENT');
  list.push("sudo tee /etc/systemd/system/chitbridge.service >/dev/null <<'CBSVC'");
  list.push('[Unit]');
  list.push('Description=Chit and Bridge IoT agent');
  list.push('After=network-online.target');
  list.push('Wants=network-online.target');
  list.push('[Service]');
  list.push('ExecStart=/usr/bin/env node /opt/chitbridge/agent.js');
  list.push('Restart=always');
  list.push('RestartSec=5');
  list.push('[Install]');
  list.push('WantedBy=multi-user.target');
  list.push('CBSVC');
  list.push('sudo systemctl daemon-reload');
  list.push('sudo systemctl enable chitbridge >/dev/null 2>&1 || true');
  list.push('sudo systemctl restart chitbridge');
  list.push('echo ""');
  list.push('echo "Installed and running. Devices: ' + ndev + '"');
  list.push('echo "Logs:  journalctl -u chitbridge -f"');
  list.push('echo "Spool: drop <event>.json (and image) into $DIR/spool to raise an exception"');
  return list.join('\n') + '\n';
}
function acCreatePackage(id) {
  acReissueGate(id, 'package');
}
// ── Reissue step-up (destructive): re-type the gateway name (the QUESTION) + a one-time code emailed to the ENTITY
//    (the PASSWORD). Only the entity or a manager delegate can reissue; the code always goes to the account email.
function acReissueGate(id, mode) {
  UI.acReissue = { id: id, mode: mode || 'package' };
  if (typeof modal !== 'function') {
    if (typeof toast === 'function') toast('Cannot open the reissue dialog.');
    return;
  }
  modal(
    '<div style="padding:2px 2px"><div style="font-weight:800;font-size:var(--fs-4);margin-bottom:4px">' +
      tx('⚠ Reissue device key') +
      '</div>' +
      '<div style="font-size:var(--fs-2);color:var(--grey-2);line-height:1.5;margin-bottom:12px">' +
      txf(
        'This issues a {newkey} — any device already running this gateway {stops} until you reflash it with the new installer. Only the owner or a manager may do this.',
        { newkey: '<b>' + tx('new key') + '</b>', stops: '<b>' + tx('stops') + '</b>' }
      ) +
      '</div>' +
      '<label class="fl">1 · Type the gateway\'s exact name</label><input data-cbsid="SCR002-I09" class="inp" id="rg_name" placeholder="gateway name" style="width:100%;margin-bottom:12px">' +
      '<label class="fl">' +
      tx('2 · One-time code (sent to the account email)') +
      '</label><div style="display:flex;gap:8px;align-items:center;margin-bottom:4px"><input data-cbsid="SCR002-I10" class="inp" id="rg_otp" inputmode="numeric" maxlength="6" placeholder="6-digit code" style="flex:1"><button data-cbsid="SCR002-B09" class="composebtn" onclick="acReissueSendCode()">' +
      tx('Send code') +
      '</button></div>' +
      '<div id="rg_msg" style="font-size:var(--fs-1);color:var(--blue-2);min-height:15px;margin-bottom:10px"></div>' +
      '<div style="display:flex;gap:10px"><button data-cbsid="CMP003" class="composebtn" style="flex:1" onclick="closeModal()">' +
      tx('Cancel') +
      '</button><button data-cbsid="SCR002-B10" class="composebtn pri" style="flex:1" onclick="acReissueSubmit()">' +
      tx('Reissue') +
      '</button></div>' +
      '</div>',
    false
  );
}
async function acReissueSendCode() {
  var node = document.getElementById('rg_msg');
  if (node) node.textContent = 'Sending…';
  try {
    var reply = await api('connectorReissueCode', { body: {} });
    if (node)
      node.innerHTML =
        'Code sent to <b>' +
        esc((reply && reply.email) || 'the account email') +
        '</b>.' +
        (reply && reply.dev_otp ? ' <span style="color:var(--warn-2)">Dev code <b>' + esc(reply.dev_otp) + '</b></span>' : '');
  } catch (e) {
    if (node) node.textContent = (e && e.message) || 'Could not send the code.';
  }
}
async function acReissueSubmit() {
  var g = UI.acReissue || {},
    id = g.id,
    mode = g.mode;
  var name = ((document.getElementById('rg_name') || {}).value || '').trim(),
    node = ((document.getElementById('rg_otp') || {}).value || '').trim();
  var m = document.getElementById('rg_msg');
  if (!name) {
    if (m) m.textContent = 'Type the gateway name.';
    return;
  }
  if (!/^[0-9]{6}$/.test(node)) {
    if (m) m.textContent = 'Enter the 6-digit code.';
    return;
  }
  if (m) m.textContent = 'Verifying…';
  try {
    var reply = await api('connectorRegen', { params: { actorId: id }, body: { name: name, otp: node } });
    var key = reply && reply.provision_key;
    if (!key) {
      if (m) m.textContent = 'No key issued.';
      return;
    }
    closeModal();
    if (mode === 'package') {
      var r = await api('connectorConns', { params: { actorId: id } });
      var devs = (Array.isArray(r) ? r : (r && r.connections) || []) /* ⚠️ collapsed to the array — see acLoadDevices */
        .filter(function (item) {
          return item.enabled !== false;
        })
        .map(function (item) {
          var cf = item.conn_config || {};
          return { bridge_id: item.bridge_id, ref: item.ref, folder: cf.folder || null, classes: cf.classes || null };
        });
      _download(
        'chitbridge-install.sh',
        _buildInstaller({
          endpoint: CFG.API_BASE /* HX1: the api this app talks to */,
          key: key,
          heartbeat_sec: 60,
          spool_dir: '/opt/chitbridge/spool',
          devices: devs
        })
      );
      UI.acFreshKey = null;
      if (typeof paintAcDetail === 'function') paintAcDetail(); // key is INSIDE the installer — never shown raw
      if (typeof toast === 'function') toast('Key reissued — installer downloaded (key is inside it). Reflash the Pi: sudo bash chitbridge-install.sh');
    } else {
      UI.acFreshKey = key;
      UI.acProvOpen = true;
      if (typeof paintAcDetail === 'function') paintAcDetail(); // direct-device path: the raw key IS the deliverable, shown once
      if (typeof toast === 'function') toast('New ActorKey issued — copy it now.');
    }
  } catch (e) {
    if (m) m.textContent = (e && e.message) || 'Reissue failed.';
  }
}

/* self-register the Tier-2 renderer so the generic dispatcher (acOpenManage) finds it after this module lazy-loads */
if (typeof window !== 'undefined' && window.ACTOR_MANAGE) {
  window.ACTOR_MANAGE.iot = piCockpit;
  window.ACTOR_MANAGE.erp = piCockpit;
}
