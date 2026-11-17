/* cap-service.js — a chit AS A SERVICE REQUEST. Lazy-loaded (ensureCap('service')).
 *
 * Athi, 2026-08-13: *"are you not bridging the gap for ITIL? the SLA clock cycle or whatever required?"*
 *
 * ── ⭐ THE SCREEN'S ONE JOB: SHOW BOTH NUMBERS ──────────────────────────────────────────────────────────────────
 * Every other service desk shows one elapsed time — its own. When a pause is disputed there are genuinely two
 * defensible answers, and picking one to display is taking a side in an argument the tool is supposed to settle.
 * So when they differ, both are shown, side by side, with the disagreement named.
 *
 * ⚠️ NOTHING HERE DECIDES ANYTHING. It does not auto-resolve, auto-accept a pause, or declare a winner. The same
 * discipline as the matcher and for the same reason: a confident wrong number is worse than a gap.
 
 * CALLED BY public/app.html   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
/*
 * OWNS      a chit as a service request: the screen that shows both elapsed numbers when a pause is disputed
 * CALLED BY ensureCap('service') in public/app.html:29755
 * FLOW      svcOpen(chit_id) -> load the service view -> both numbers side by side, the disagreement named, nothing decided
 * CARD      03-disputes-service-and-register/service-request-sla-pause
 */
var SVC = { id: null, data: null, busy: false, err: null, view: 'main' };

async function svcOpen(chit_id) {
  SVC.id = chit_id;
  SVC.data = null;
  SVC.err = null;
  SVC.busy = true;
  SVC.view = 'main';
  svcPaint();
  try {
    SVC.data = await api('svcGet', { params: { id: chit_id } });
  } catch (e) {
    SVC.err = (e && e.message) || 'Could not read the service clock.';
  }
  SVC.busy = false;
  svcPaint();
}
async function svcReload() {
  try {
    SVC.data = await api('svcGet', { params: { id: SVC.id } });
  } catch (e) { /* best effort: failing here changes nothing the user sees */ }
  svcPaint();
}

function svcDur(ms) {
  var n = Math.abs(Math.round(Number(ms) || 0)),
    m = Math.round(n / 60000);
  if (m < 60) return m + 'm';
  var h = Math.floor(m / 60),
    rm = m % 60;
  if (h < 24) return h + 'h' + (rm ? ' ' + rm + 'm' : '');
  var d = Math.floor(h / 24),
    rh = h % 24;
  return d + 'd' + (rh ? ' ' + rh + 'h' : '');
}
function svcChip(txt, tone) {
  var c = {
    bad: ['var(--disp)', 'var(--danger-tint)'],
    warn: ['var(--warn-2)', 'var(--warn-tint)'],
    ok: ['var(--ok-2)', 'var(--ok-tint)'],
    flat: ['var(--blue-2)', 'var(--blue-tint-bg)']
  }[tone || 'flat'];
  return (
    '<span style="font-size:var(--fs-1);font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:' +
    c[0] +
    ';background:' +
    c[1] +
    ';border-radius:5px;padding:2px 7px;white-space:nowrap">' +
    esc(txt) +
    '</span>'
  );
}

/**
 * The two clocks, side by side ONLY when they disagree.
 *
 * ⚠️ SHOWING BOTH ALWAYS WOULD TEACH PEOPLE TO IGNORE THE SECOND. On the overwhelming majority of requests nobody
 * disputes anything and the numbers are identical; a permanent second column becomes furniture, and then it is
 * invisible on the one request where it matters.
 */
function svcClockBlock(c, r) {
  if (!c.has_target) {
    return (
      '<div style="background:var(--warn-tint);border:1px solid #e6d9a8;border-radius:9px;padding:11px 13px;font-size:var(--fs-2);color:var(--warn-3)">' +
      '<b>' +
      tx('No priority set yet') +
      '</b> — so there is no target, and nothing is being reported as late. ' +
      'Set impact and urgency to start measuring.</div>'
    );
  }
  var big = function (label, val, breached) {
    return (
      '<div style="flex:1;min-width:120px">' +
      '<div style="font-size:var(--fs-1);font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--grey)">' +
      esc(label) +
      '</div>' +
      '<div style="font-size:var(--fs-5);font-weight:800;font-variant-numeric:tabular-nums;color:' +
      (breached ? 'var(--disp)' : 'var(--ink,#1c2128)') +
      '">' +
      esc(val) +
      '</div></div>'
    );
  };
  var agreed =
    '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
    big('responded in', svcDur(c.as_agreed.respond_ms), c.as_agreed.respond_breached) +
    big('running time', svcDur(c.as_agreed.resolve_ms), c.as_agreed.resolve_breached) +
    big('target', svcDur(c.as_agreed.resolve_target_ms), false) +
    '</div>';

  if (!c.contested_changes_outcome) {
    return (
      agreed +
      '<div style="margin-top:7px">' +
      (c.as_agreed.resolve_breached ? svcChip('resolve breached', 'bad') : svcChip('within target', 'ok')) +
      (c.as_agreed.respond_breached ? ' ' + svcChip('response breached', 'bad') : '') +
      (c.disputed_pauses ? ' ' + svcChip(c.disputed_pauses + ' pause rejected', 'warn') : '') +
      '</div>'
    );
  }

  /* ⭐ The case this whole module exists for: the two parties' arithmetic disagrees. */
  return (
    agreed +
    '<div style="margin-top:12px;border:1.5px solid #c98b2f;border-radius:9px;overflow:hidden">' +
    '<div style="background:var(--warn-tint);padding:8px 12px;font-size:var(--fs-1);font-weight:700;color:var(--warn-3)">' +
    '⚖️ The two sides do not agree — ' +
    esc(svcDur(c.disputed_pause_ms)) +
    ' of paused time is rejected</div>' +
    '<div style="display:flex;gap:0;flex-wrap:wrap">' +
    '<div style="flex:1;min-width:150px;padding:11px 13px;border-inline-end:1px solid var(--line)">' +
    '<div style="font-size:var(--fs-1);font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--grey)">as agreed · every pause honoured</div>' +
    '<div style="font-size:var(--fs-5);font-weight:800;font-variant-numeric:tabular-nums;color:' +
    (c.as_agreed.resolve_breached ? 'var(--disp)' : 'var(--ok-2)') +
    '">' +
    esc(svcDur(c.as_agreed.resolve_ms)) +
    '</div>' +
    '<div style="margin-top:3px">' +
    (c.as_agreed.resolve_breached ? svcChip('breached', 'bad') : svcChip('within target', 'ok')) +
    '</div></div>' +
    '<div style="flex:1;min-width:150px;padding:11px 13px">' +
    '<div style="font-size:var(--fs-1);font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--grey)">contested · rejected pauses removed</div>' +
    '<div style="font-size:var(--fs-5);font-weight:800;font-variant-numeric:tabular-nums;color:' +
    (c.contested.resolve_breached ? 'var(--disp)' : 'var(--ok-2)') +
    '">' +
    esc(svcDur(c.contested.resolve_ms)) +
    '</div>' +
    '<div style="margin-top:3px">' +
    (c.contested.resolve_breached ? svcChip('breached', 'bad') : svcChip('within target', 'ok')) +
    '</div></div>' +
    '</div>' +
    '<div style="padding:9px 12px;font-size:var(--fs-1);color:var(--grey);border-top:1px solid var(--line);line-height:1.5">' +
    'Both figures come from the same record. Neither side is being overruled — the pause below is what has to be settled.</div>' +
    '</div>'
  );
}

function svcPauseRow(p) {
  var open = !p.paused_to;
  var state = p.accepted === true ? svcChip('accepted', 'ok') : p.accepted === false ? svcChip('rejected', 'bad') : svcChip('not answered', 'flat');
  /* ⚠️ THE ACCEPT/REJECT CONTROL NEVER APPEARS ON MY OWN CLAIM. The server refuses it, and offering a button that
     always errors is worse than not offering one. */
  var answer =
    !p.mine && p.accepted === null && !open
      ? '<div style="display:flex;gap:6px;margin-top:7px">' +
        '<button data-cbsid="SCR008-B01" class="btn" style="flex:1;font-size:var(--fs-2)" onclick="svcAnswer(\'' +
        esc(p.pause_id) +
        '\',true)">' +
        tx('Accept this pause') +
        '</button>' +
        '<button data-cbsid="SCR008-B02" class="btn" style="flex:1;font-size:var(--fs-2);color:var(--disp)" onclick="svcAnswer(\'' +
        esc(p.pause_id) +
        '\',false)">' +
        tx('Reject — the clock kept running') +
        '</button></div>'
      : '';
  var endBtn =
    p.mine && open
      ? '<button data-cbsid="SCR008-B03" class="btn" style="width:100%;margin-top:7px;font-size:var(--fs-2)" onclick="svcEndPause(\'' +
        esc(p.pause_id) +
        '\')">' +
        tx('End this pause') +
        '</button>'
      : '';
  return (
    '<div style="border-top:1px solid var(--line);padding:10px 0">' +
    '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">' +
    '<span style="font-size:var(--fs-2);font-weight:700">' +
    esc(String(p.reason || '').replace(/_/g, ' ')) +
    '</span>' +
    '<span style="display:flex;gap:5px">' +
    (open ? svcChip('running', 'warn') : '') +
    state +
    '</span></div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">' +
    esc(CBLocale.datetime(p.paused_from)) +
    (p.paused_to ? ' → ' + esc(CBLocale.datetime(p.paused_to)) : ' → still paused') +
    ' · claimed by ' +
    esc(p.mine ? 'you' : p.claimed_by_name || 'the other party') +
    '</div>' +
    (p.note ? '<div style="font-size:var(--fs-2);margin-top:3px">' + esc(p.note) + '</div>' : '') +
    answer +
    endBtn +
    '</div>'
  );
}

function svcPaint() {
  if (SVC.busy && !SVC.data)
    return modal(
      '<h3 style="margin:0 0 10px">' +
        tx('Service clock') +
        '</h3><div style="font-size:var(--fs-2);color:var(--grey)"><span class="spin"></span> reading…</div>', false, { pop: 'POP079' }
    );
  if (SVC.err)
    return modal(
      '<h3 style="margin:0 0 8px">' +
        tx('Service clock') +
        '</h3><div style="font-size:var(--fs-2);color:var(--disp)">' +
        esc(SVC.err) +
        '</div>' +
        '<button data-cbsid="CMP005" class="btn" style="width:100%;margin-top:12px" onclick="closeModal()">' +
        tx('Close') +
        '</button>', false, { pop: 'POP079' }
    );
  var d = SVC.data || {};

  if (!d.tracked) {
    /* Not an error state — most chits are not service requests, and saying so plainly beats an empty panel. */
    return modal(
      '<h3 style="margin:0 0 4px">' +
        tx('Track as a service request') +
        '</h3>' +
        '<div style="font-size:var(--fs-2);color:var(--grey);margin-bottom:12px">Starts a response and a resolution clock. Impact and urgency are kept apart on purpose — together they decide the priority, and collapsing them into one field is how everything becomes a P1.</div>' +
        svcPickers(d) +
        '<div style="display:flex;gap:8px;margin-top:14px">' +
        '<button data-cbsid="CMP003" class="btn" style="flex:1" onclick="closeModal()">' +
        tx('Cancel') +
        '</button>' +
        '<button data-cbsid="SCR008-B04" class="btn pri" style="flex:1" onclick="svcStart()">' +
        tx('Start the clock') +
        '</button></div>', false, { pop: 'POP207' }
    );
  }

  var c = d.clock || {},
    r = d.record || {};
  var pauses = d.pauses || [];
  var iPaused = pauses.some(function (item) {
    return item.mine && !item.paused_to;
  });

  modal(
    '<h3 style="margin:0 0 3px">Service clock' +
      (c.priority ? ' <span style="font-size:var(--fs-2);color:var(--blue-2);font-weight:800">' + esc(c.priority) + '</span>' : '') +
      '</h3>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:12px">' +
      (r.impact ? esc(r.impact) + ' impact · ' + esc(r.urgency) + ' urgency · ' : '') +
      (c.resolved ? 'resolved' : c.paused_now ? 'paused' : 'running') +
      '</div>' +
      svcClockBlock(c, r) +
      '<div style="margin-top:16px;font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--grey)">Pauses (' +
      pauses.length +
      ')</div>' +
      (pauses.length
        ? pauses.map(svcPauseRow).join('')
        : '<div style="font-size:var(--fs-2);color:var(--grey);padding:8px 0">None — the clock has run continuously.</div>') +
      '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">' +
      (c.responded ? '' : '<button data-cbsid="SCR008-B05" class="btn" style="flex:1;min-width:120px" onclick="svcRespond()">' + tx('Mark responded') + '</button>') +
      (iPaused || c.resolved ? '' : '<button data-cbsid="SCR008-B06" class="btn" style="flex:1;min-width:120px" onclick="svcPauseAsk()">' + tx('Pause the clock') + '</button>') +
      (c.resolved ? '' : '<button data-cbsid="SCR008-B07" class="btn pri" style="flex:1;min-width:120px" onclick="svcResolveAsk()">' + tx('Resolve') + '</button>') +
      '<button data-cbsid="CMP005" class="btn" style="flex:1;min-width:90px" onclick="closeModal()">' +
      tx('Close') +
      '</button></div>', false, { pop: 'POP079' }
  );
}

function svcPickers(d) {
  var opt = function (list, id, label) {
    return (
      '<label class="fl">' +
      label +
      '</label><select data-cbsid="SCR008-S01" id="' +
      id +
      '" class="inp" style="width:100%;margin-bottom:10px">' +
      (list || [])
        .map(function (x) {
          return '<option value="' + esc(x) + '">' + esc(x) + '</option>';
        })
        .join('') +
      '</select>'
    );
  };
  return opt(d.impacts, 'svc_impact', 'Impact — how much of the business is affected') + opt(d.urgencies, 'svc_urgency', 'Urgency — how fast it degrades');
}

async function svcStart() {
  var node = (document.getElementById('svc_impact') || {}).value;
  var u = (document.getElementById('svc_urgency') || {}).value;
  try {
    await api('svcSet', { params: { id: SVC.id }, body: { impact: node, urgency: u } });
    toast('Service clock started');
    await svcReload();
  } catch (e) {
    toast(MSG.fail('start the clock', e));
  }
}
async function svcRespond() {
  try {
    await api('svcRespond', { params: { id: SVC.id }, body: {} });
    toast('Response recorded');
    await svcReload();
  } catch (e) {
    toast(MSG.fail('record the response', e));
  }
}
function svcPauseAsk() {
  var reasons = (SVC.data && SVC.data.pause_reasons) || [];
  modal(
    '<h3 style="margin:0 0 4px">' +
      tx('Pause the clock') +
      '</h3>' +
      '<div style="font-size:var(--fs-2);color:var(--grey);margin-bottom:12px">The other party sees this pause and can accept or reject it. If they reject it, both figures are shown and neither is overruled.</div>' +
      '<label class="fl">' +
      tx('Why') +
      '</label><select data-cbsid="SCR008-S02" id="svc_reason" class="inp" style="width:100%;margin-bottom:10px">' +
      reasons
        .map(function (x) {
          return '<option value="' + esc(x) + '">' + esc(String(x).replace(/_/g, ' ')) + '</option>';
        })
        .join('') +
      '</select>' +
      '<label class="fl">' +
      tx('Note (what you are waiting for)') +
      '</label>' +
      '<input data-cbsid="SCR008-I01" id="svc_note" class="inp" style="width:100%;margin-bottom:10px" placeholder="asked for the serial number on 14 Aug">' +
      '<label style="display:flex;gap:8px;align-items:center;font-size:var(--fs-2)"><input data-cbsid="SCR008-I02" type="checkbox" id="svc_onother"> This is waiting on <b>them</b></label>' +
      '<div style="display:flex;gap:8px;margin-top:14px">' +
      '<button data-cbsid="CMP006" class="btn" style="flex:1" onclick="svcPaint()">' +
      tx('Back') +
      '</button>' +
      '<button data-cbsid="SCR008-B08" class="btn pri" style="flex:1" onclick="svcDoPause()">' +
      tx('Pause') +
      '</button></div>'
  );
}
async function svcDoPause() {
  var reason = (document.getElementById('svc_reason') || {}).value;
  var note = (document.getElementById('svc_note') || {}).value;
  var on = !!(document.getElementById('svc_onother') || {}).checked;
  try {
    await api('svcPause', { params: { id: SVC.id }, body: { reason: reason, note: note, on_counterparty: on } });
    toast('Clock paused');
    await svcReload();
  } catch (e) {
    toast(MSG.fail('pause the clock', e));
  }
}
async function svcEndPause(pid) {
  try {
    await api('svcPauseEnd', { params: { id: SVC.id, pid: pid }, body: {} });
    toast('Clock restarted');
    await svcReload();
  } catch (e) {
    toast(MSG.fail('end the pause', e));
  }
}
async function svcAnswer(pid, accepted) {
  try {
    await api('svcPauseAnswer', { params: { id: SVC.id, pid: pid }, body: { accepted: accepted } });
    toast(accepted ? 'Pause accepted' : 'Rejected — the clock is now contested');
    await svcReload();
  } catch (e) {
    toast(MSG.fail('answer the pause', e));
  }
}
function svcResolveAsk() {
  var codes = (SVC.data && SVC.data.resolution_codes) || [];
  modal(
    '<h3 style="margin:0 0 4px">' +
      tx('Resolve') +
      '</h3>' +
      '<div style="font-size:var(--fs-2);color:var(--grey);margin-bottom:12px">What was done. Whether they accept it is a separate step — that gap is the record, not a gap in the record.</div>' +
      '<label class="fl">' +
      tx('Resolution') +
      '</label><select data-cbsid="SCR008-S03" id="svc_code" class="inp" style="width:100%;margin-bottom:10px">' +
      codes
        .map(function (x) {
          return '<option value="' + esc(x) + '">' + esc(String(x).replace(/_/g, ' ')) + '</option>';
        })
        .join('') +
      '</select>' +
      '<label class="fl">' +
      tx('Note') +
      '</label><input data-cbsid="SCR008-I03" id="svc_rnote" class="inp" style="width:100%">' +
      '<div style="display:flex;gap:8px;margin-top:14px">' +
      '<button data-cbsid="CMP006" class="btn" style="flex:1" onclick="svcPaint()">' +
      tx('Back') +
      '</button>' +
      '<button data-cbsid="SCR008-B09" class="btn pri" style="flex:1" onclick="svcDoResolve()">' +
      tx('Resolve') +
      '</button></div>'
  );
}
async function svcDoResolve() {
  var code = (document.getElementById('svc_code') || {}).value;
  var note = (document.getElementById('svc_rnote') || {}).value;
  try {
    await api('svcResolve', { params: { id: SVC.id }, body: { resolution_code: code, note: note } });
    toast('Resolved');
    await svcReload();
  } catch (e) {
    toast(MSG.fail('resolve', e));
  }
}

/* ⚠️ THE ENTRY POINT IS NOT HERE, AND IT CANNOT BE. `openServiceClock()` lives in app.html, because the function
   that LOADS a lazy capability cannot itself be inside the file it loads — nothing would ever be able to call it.
   Written here once by mistake, which is exactly how a lazy module ends up permanently unreachable. */
