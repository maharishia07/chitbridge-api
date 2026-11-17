/* app/cap-workforce.js — the CO-ASSIST (workforce) capability: FUNCTIONALITY only.
 * OWNS  the Co-assists screen (list, filters, sort, detail, create/invite/PIN/cover/shift/deactivate) and the actor-type registry
 * CARD 17-people-employees-hr-and-payroll/people-list-with-may-why
 * Injected by ensureCap('workforce') on first open of the Co-assists screen; classic script, shared global scope.
 * Screen + render + actions (create/invite/PIN/cover/shift/deactivate) + loadCoassists. NO help content
 * (co-assist help lives in app/cap-help.js, lazy). References eager Core/helpers globals at runtime:
 * api, mapApiActor, hatLabel/hatAssignable/HAT_LABEL, acType/acShc/acShLabel/acFlt/acDate/acLogin/acLbl,
 * addActorModal/submitActor/actorInviteModal/actorCleanupModal/confirmAsk, scr, esc, val, opt, toast,
 * modal/closeModal, announce, coId/acIdPrev, startDrag, openHelp, UI/SESSION/STORE.
 * Spec: chitbridge-api/docs/COASSIST-USECASES.md . Tests: COASSIST-REGRESSION.md.
 * CALLED BY public/app.html, public/app/cap-connector.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
/* ═══ ACTOR TYPE REGISTRY — build-one-add-more. The SINGLE list the core reads (filter · picker · detail · dispatch).
 *     Seeded built-in; DESIGNED to be fed by the GOVERNANCE layer later (merge via acMergeTypes) with zero core change.
 *     A type = {label, icon, capability, module, load, comingSoon}. New type = one entry (+ a lazy module, unless it's a
 *     variant of an existing module). comingSoon:true → the icon shows + a "coming soon" path, before any capability exists. ═══ */
window.ACTOR_TYPES = Object.assign(
  {
    human: { label: 'Person', icon: '👤', capability: null, module: null, load: null },
    iot: { label: 'IoT device', icon: '🛰️', capability: 'connector', module: 'connector', load: 'acLoadDevices' },
    erp: { label: 'ERP / API', icon: '🔌', capability: 'connector', module: 'connector', load: 'acLoadDevices' },
    ai: { label: 'AI assist', icon: '🤖', capability: null, module: null, load: null },
    cloud: { label: 'Cloud (Azure / AWS)', icon: '☁️', capability: 'cloud', module: null, load: null, comingSoon: true }
  },
  window.ACTOR_TYPES || {}
);
window.ACTOR_MANAGE = window.ACTOR_MANAGE || {}; // type -> Tier-2 management renderer (lazy modules self-register)
if (typeof piCockpit === 'function') {
  ACTOR_MANAGE.iot = ACTOR_MANAGE.iot || piCockpit;
  ACTOR_MANAGE.erp = ACTOR_MANAGE.erp || piCockpit;
}
// Per-type "how it works" — the ℹ️/i info affordance, uniform across EVERY co-assist type (was IoT-only). All are co-assists.
window.AC_TYPE_HOW = window.AC_TYPE_HOW || {
  human: {
    how: 'A person on your team who acts for the entity — with a hat that scopes what they can do. They log in, take Tasks, and advance chits on the same governed rail.'
  },
  iot: {
    how: 'A Pi or gateway that authenticates with its OWN key and PUSHES readings onto the rail — each exception becomes a co-held chit, filed into your folder. Same rail, same governance as a person.'
  },
  erp: {
    how: 'A business system that pushes documents over the rail — PROCESS-THEN-FORGET: we keep a receipt (hash + outcome), never the raw payload, and forward only the summary as a co-held chit.'
  },
  ai: {
    how: 'A governed AI that acts for you as a co-assist. Each AI assist is one SLOT (a work-pattern of the AI capability) at the cheapest sufficient rung. Invoking a live one runs it now; every action is a governed chit you can see and dispute — the model PROPOSES, the rail AUTHORISES, and rungs that decide always need a human. Model proposes, you confirm.'
  },
  cloud: { how: 'A cloud account (Azure / AWS) as a co-assist — coming soon. Same rail, same governance.' }
};
function acTypeInfo(t) {
  var reg = (window.ACTOR_TYPES || {})[t] || {},
    h = (window.AC_TYPE_HOW || {})[t];
  if (!h || typeof modal !== 'function') return;
  var lbl = (reg.label || t).split(/[ /]/)[0];
  var extra =
    t === 'iot'
      ? '<div style="margin-top:12px"><button data-cbsid="BUS005-B01" class="composebtn" onclick="closeModal();openShowcase(\'/iot-howitworks.html\',\'How IoT works\')">See the full walkthrough <span class=arw>→</span></button></div>'
      : '';
  modal(
    '<div style="padding:2px 2px"><div style="font-size:var(--fs-6)">' +
      (reg.icon || '') +
      '</div><div style="font-weight:800;font-size:var(--fs-4);margin-top:4px">' +
      esc(lbl) +
      ' — as a co-assist</div><div style="font-size:var(--fs-2);color:var(--ink-2);line-height:1.6;margin-top:8px">' +
      esc(h.how) +
      '</div>' +
      extra +
      '<div style="display:flex;margin-top:16px"><button data-cbsid="CMP004" class="composebtn pri" style="flex:1" onclick="closeModal()">' +
      tx('Got it') +
      '</button></div></div>',
    false
  );
}
// GOVERNANCE hook (invisible to end users): merge governed type defs (with their constraints) into the registry — no core change.
function acMergeTypes(defs) {
  if (defs && typeof defs === 'object') {
    Object.keys(defs).forEach(function (item) {
      window.ACTOR_TYPES[item] = Object.assign({}, window.ACTOR_TYPES[item] || {}, defs[item]);
    });
    if (typeof paintAcList === 'function') paintAcList();
    if (typeof renderApp === 'function') renderApp();
  }
}
/* ═══ AI ASSISTS — the 🤖 co-assist type. Each AI assist = one SLOT (a work-pattern of the ai@v1 capability), shown
 *     UNDER the AI type the way devices sit under an IoT gateway. The OWNER'S CONTROL lives here (enable + the rule),
 *     because a lit slot is an ACTOR whose every action is a chit you can dispute — Settings just REDIRECTS here.
 *     RULE per slot: rung is fixed; the human-gate can only be TIGHTENED from the rung floor (Crux 2). Registry +
 *     policy are client-side (localStorage) for first light — mint to entity_governance later. Invoking a LIVE slot
 *     runs it now (conform-verdict → the live compliance check). ═══ */
window.AI_SLOTS = window.AI_SLOTS || [
  {
    key: 'conform-verdict@v1',
    name: 'Compliance check',
    rung: 'summarise',
    status: 'live',
    invoke: 'checkCompliance',
    desc: 'Checks a transaction against a standard (food-safety@v1) — deterministic verdict + an AI remediation note.',
    gates: ['recommend-only', 'draft-then-confirm', 'autonomous'],
    defGate: 'recommend-only'
  },
  {
    key: 'catalogue-structure@v1',
    name: 'Catalogue builder',
    rung: 'extract',
    status: 'live',
    invoke: 'openCatalogueBuilder',
    desc: 'Structures a brand catalogue (Royale Play) into a client chooser — schema + colour, shared once; the retailer fills only commercials.',
    gates: ['draft-then-confirm', 'recommend-only'],
    defGate: 'draft-then-confirm'
  },
  {
    key: 'draft-chit@v1',
    name: 'Draft a chit',
    rung: 'draft',
    status: 'shaped',
    invoke: null,
    desc: 'Drafts a chit from your intent; you review and send. The AI never sends — your send is the confirm.',
    gates: ['draft-then-confirm'],
    defGate: 'draft-then-confirm'
  },
  {
    key: 'triage@v1',
    name: 'Inbox triage',
    rung: 'classify',
    status: 'shaped',
    invoke: null,
    desc: 'Sorts the inbox and flags likely disputes — surfaces, never decides.',
    gates: ['recommend-only', 'autonomous'],
    defGate: 'recommend-only'
  }
];
/**
 * Fetch ONE co-assist's identity record for the edit form.
 *
 * ⚠️ Keyed by subject id. See the note at the call site: a boolean latch here would render the previously
 * opened person's documents under the current person's name, and nothing on screen would say so.
 */
async function acLoadDocs(id) {
  if (UI._idocsForId === id) return;
  UI._idocsForId = id;
  UI._idocsFor = [];
  try {
    await ensureCap('iddocs');
    UI._idocsFor = await CBIdDocs.load(id);
    bgRenderApp();
    _capShowDetail();
  } catch (_) {
    /* additive — its absence must not take the edit form down */
  }
}
/* ⚠️ `SESSION.entityId`, NOT `entity_id` — the snake_case name is never set anywhere, so this fallback was
   dead and the key silently collapsed to 'cb_aipolicy_me' whenever SESSION.name was absent. Two entities on
   one browser would then have shared one AI-policy store. Found by the read-but-never-written sweep in
   e2e/session-keys.cjs, which was written to catch the same mistake I had just made in cap-admin.js. */
function _aiPolKey() {
  return 'cb_aipolicy_' + ((typeof SESSION !== 'undefined' && (SESSION.name || SESSION.entityId)) || 'me');
}
function aiPolicy() {
  try {
    return JSON.parse(localStorage.getItem(_aiPolKey()) || '{}') || {};
  } catch (_) {
    return {};
  }
}
function _aiPolSet(key, patch) {
  var p = aiPolicy();
  p[key] = Object.assign({}, p[key] || {}, patch);
  try {
    localStorage.setItem(_aiPolKey(), JSON.stringify(p));
  } catch (_) { /* storage blocked or full: the page works without it */ }
}
function aiSlotState(s) {
  var p = aiPolicy()[s.key] || {};
  return { enabled: p.enabled !== undefined ? !!p.enabled : false, gate: p.gate || s.defGate };
}
function aiToggle(key) {
  var s = (window.AI_SLOTS || []).find(function (x) {
    return x.key === key;
  });
  if (!s) return;
  var st = aiSlotState(s);
  _aiPolSet(key, { enabled: !st.enabled, gate: st.gate });
  if (typeof paintAcList === 'function') paintAcList();
  if (typeof toast === 'function') toast('AI assist ' + (!st.enabled ? 'enabled' : 'disabled') + ' — saved on this device (not yet in governance).');
}
function aiSetGate(key, g) {
  _aiPolSet(key, { gate: g });
  if (typeof paintAcList === 'function') paintAcList();
}
function acCount() {
  return (UI.acTypeF || 'all') === 'ai' ? (window.AI_SLOTS || []).length : acVisible().length;
}
function aiSlotInfo(key) {
  var s = (window.AI_SLOTS || []).find(function (x) {
    return x.key === key;
  });
  if (!s || typeof modal !== 'function') return;
  var st = aiSlotState(s);
  modal(
    '<div style="padding:2px 2px"><div style="font-size:var(--fs-6)">🤖</div><div style="font-weight:800;font-size:var(--fs-4);margin-top:4px">' +
      esc(s.name) +
      '</div>' +
      '<div style="font-size:var(--fs-1);color:var(--purple-2);font-family:\'Space Mono\',monospace;margin-top:2px">ai:' +
      esc(s.key) +
      ' · ' +
      esc(s.status) +
      ' · ' +
      (st.enabled ? 'enabled' : 'off') +
      '</div>' +
      '<div style="font-size:var(--fs-2);color:var(--ink-2);line-height:1.6;margin-top:8px">' +
      esc(s.desc) +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
      '<span class="optchip" style="background:var(--blue-tint);color:var(--blue-d);border-color:var(--blue-tint-line)">rung · ' +
      esc(s.rung) +
      ' (floor)</span>' +
      '<span class="optchip" style="background:var(--warn-tint);color:var(--warn-3);border-color:var(--blue-d)">human gate · ' +
      esc(st.gate) +
      '</span></div>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);background:var(--card);border:1px solid var(--line);border-radius:9px;padding:9px 11px;margin-top:12px;line-height:1.5">' +
      txf('The model {proposes}, the rail {authorises}, {you} confirm.', {
        proposes: '<b>' + tx('proposes') + '</b>',
        authorises: '<b>' + tx('authorises') + '</b>',
        you: '<b>' + tx('you') + '</b>'
      }) +
      /* ⭐ THE GUARANTEE STAYS, THE COLUMN NAMES GO. "the model proposes, the rail authorises, you confirm" is
       the promise a person needs before switching an AI on. `acted_by (deputy · model · delegator ·
       confirmed_by)` is the schema that keeps it, and "the rung sets the floor" is our governance grammar. */
      specNote(
        'ai.acted-by',
        'Every run is a chit recording <b>acted_by</b> (deputy · model · delegator · confirmed_by). ' +
          'The rung sets the floor — the gate can only be tightened.'
      ) +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-top:16px">' +
      (st.enabled && s.status === 'live' && s.invoke
        ? '<button data-cbsid="BUS005-B02" class="composebtn pri" style="flex:1" onclick="closeModal();' + esc(s.invoke) + '()">' + tx('▶ Invoke') + '</button>'
        : '') +
      '<button data-cbsid="CMP005" class="composebtn" style="flex:1" onclick="closeModal()">' +
      tx('Close') +
      '</button></div></div>',
    false
  );
}
function aiRowsHTML() {
  var slots = window.AI_SLOTS || [];
  var intro =
    '<div style="padding:11px 13px;font-size:var(--fs-1);color:var(--grey-2);line-height:1.5;border-bottom:1px solid var(--line)">' +
    txf(
      '🤖 AI assists act for you as co-assists — each is one {slot}. Turn one on and set its rule; every action it takes is a chit you can see and dispute.',
      {
        slot: '<b>' + tx('slot') + '</b>'
      }
    ) +
    specNote('ai.rung', 'The rung sets the floor — the human gate can only be tightened, never loosened.') +
    '</div>';
  /* ⚠️ NO ACTION. A slot is minted by the governance layer, not created from this screen — offering a button
     here would promise a power this reader does not have. */
  if (!slots.length) return intro + emptyState('🤖', tx('No AI assists yet'), tx('They light up as slots are enabled.'));
  return (
    intro +
    slots
      .map(function (item) {
        var st = aiSlotState(item),
          live = item.status === 'live',
          on = st.enabled;
        var dot = on ? (live ? 'var(--ok-3)' : 'var(--warn-2)') : 'var(--grey-2)';
        var gateOpts = (item.gates || [])
          .map(function (entry) {
            return '<option value="' + entry + '"' + (st.gate === entry ? ' selected' : '') + '>' + entry + '</option>';
          })
          .join('');
        var canInvoke = on && live && item.invoke;
        return (
          '<div class="row" style="cursor:default;align-items:flex-start">' +
          '<div style="width:9px;height:9px;border-radius:50%;flex:0 0 auto;margin-top:6px;background:' +
          dot +
          '"></div>' +
          '<div class="main2" style="width:100%;min-width:0"><div class="l1"><span class="code">' +
          esc(item.name) +
          '</span>' +
          '<span class="optchip" style="background:var(--purple-tint);color:var(--purple-2);border-color:transparent">🤖 ' +
          esc(item.key) +
          '</span>' +
          '<span class="amt" style="margin-inline-start:auto;font-size:var(--fs-1);color:' +
          (on ? (live ? 'var(--ok-3)' : 'var(--warn-2)') : 'var(--grey)') +
          ';font-weight:600">' +
          (on ? (live ? 'enabled · live' : 'enabled · shaped') : 'off') +
          '</span></div>' +
          '<div class="l2">' +
          esc(item.desc) +
          '</div>' +
          '<div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-top:8px">' +
          '<button data-cbsid="BUS005-B03" class="composebtn' +
          (on ? ' pri' : '') +
          '" style="padding:5px 12px;font-size:var(--fs-2)" onclick="aiToggle(\'' +
          esc(item.key) +
          '\')">' +
          (on ? '✓ Enabled' : 'Enable') +
          '</button>' +
          '<span class="optchip" style="background:var(--blue-tint);color:var(--blue-d);border-color:var(--blue-tint-line)">rung · ' +
          esc(item.rung) +
          '</span>' +
          '<label style="font-size:var(--fs-1);color:var(--grey);display:inline-flex;align-items:center;gap:5px">human gate <select data-cbsid="BUS005-S01" onchange="aiSetGate(\'' +
          esc(item.key) +
          '\',this.value)" style="border:1px solid var(--line);border-radius:6px;padding:3px 6px;font-size:var(--fs-1)"' +
          (on ? '' : ' disabled') +
          '>' +
          gateOpts +
          '</select></label>' +
          '</div>' +
          '<div style="margin-top:8px;display:flex;gap:6px;align-items:center">' +
          (canInvoke
            ? '<button data-cbsid="BUS005-B04" class="composebtn pri" style="padding:6px 12px;font-size:var(--fs-2)" onclick="' +
              esc(item.invoke) +
              '()">' +
              tx('▶ Invoke') +
              '</button>'
            : '<button data-cbsid="BUS005-B05" class="composebtn" style="padding:6px 12px;font-size:var(--fs-2);opacity:.55;cursor:not-allowed" disabled title="' +
              (!on ? 'Enable it first' : !live ? 'Shaped — not runnable yet' : 'Not invokable') +
              '">' +
              tx('▶ Invoke') +
              '</button>') +
          '<button data-cbsid="BUS005-B06" class="composebtn" style="padding:6px 10px;font-size:var(--fs-2)" onclick="aiSlotInfo(\'' +
          esc(item.key) +
          '\')">' +
          tx('How it works') +
          '</button>' +
          '</div>' +
          '</div></div>'
        );
      })
      .join('')
  );
}
// generic showcase opener — loads a STANDALONE HTML page FROM THE SERVER in an overlay iframe (no showcase markup in JS; content is an asset, fetched on demand). Reusable: openShowcase('/iot-howitworks.html','How IoT works').
// paneFrame — REUSABLE overlay sizing. Reuses the app's OWN two-panel coordinates (no guessing): laptop = fit the
// RIGHT/detail pane's MEASURED rect (the proven co-assist technique); mobile = bottom-HALF sheet. Any overlay uses this.
function paneFrame() {
  // FILL the content area (measured) — the #mainbody box: right of the left nav, below the top bar. That box IS both views:
  // laptop = the whole list+detail region → rounded panel; mobile = full-width content → full view, edge-to-edge.
  var mob = window.UI && UI.vp === 'mob';
  var node = document.getElementById('mainbody');
  var mr = node ? node.getBoundingClientRect() : null;
  if (mr && mr.width > 60 && mr.height > 120)
    return {
      css:
        'top:' +
        Math.round(mr.top) +
        'px;inset-inline-start:' +
        Math.round(mr.left) +
        'px;width:' +
        Math.round(mr.width) +
        'px;height:' +
        Math.round(mr.height) +
        'px',
      radius: mob ? '0' : '14px'
    };
  var bar = document.querySelector('.topbar');
  var barH = bar ? Math.round(bar.getBoundingClientRect().height) : 52;
  return { css: 'top:' + barH + 'px;inset-inline-start:0;inset-inline-end:0;bottom:0', radius: '0' }; // last-resort: full below the top bar
}
function openShowcase(url, title) {
  var f = paneFrame();
  var host = document.getElementById('showcaseHost') || document.createElement('div');
  host.id = 'showcaseHost';
  host.innerHTML =
    '<div data-cbsid="BUS005-C01" style="position:fixed;inset:0;background:rgba(15,22,32,.45);z-index:600" onclick="closeShowcase()"></div>' +
    '<div style="position:fixed;' +
    f.css +
    ';border-radius:' +
    f.radius +
    ';background:var(--card);z-index:601;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);display:flex;flex-direction:column;color:var(--on-card)">' +
    '<div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line);flex:none"><b style="font-size:var(--fs-3)">' +
    esc(title || 'How it works') +
    '</b><button data-cbsid="CMP005" onclick="closeShowcase()" title="Close" style="margin-inline-start:auto;border:0;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:var(--grey)">×</button></div>' +
    '<iframe src="' +
    esc(url) +
    '" title="' +
    esc(title || '') +
    '" style="flex:1;width:100%;border:0;display:block;background:var(--card);color:var(--on-card)"></iframe></div>';
  document.body.appendChild(host);
}
function closeShowcase() {
  var node = document.getElementById('showcaseHost');
  if (node) node.remove();
}
function coassistsScreen() {
  const _tf = UI.acTypeF || 'all';
  const _treg = (window.ACTOR_TYPES || {})[_tf] || null;
  const _shortLbl = _treg ? (_treg.label || _tf).split(/[ /]/)[0] : '';
  const _title = _tf !== 'all' && _treg ? (_treg.icon ? _treg.icon + ' ' : '') + esc(_shortLbl) + ' · co-assists' : '🧑‍🤝‍🧑 Co-assists';
  const _typeInfoBtn =
    _tf !== 'all' && (window.AC_TYPE_HOW || {})[_tf]
      ? `<button data-cbsid="BUS005-B07" onclick="acTypeInfo('${_tf}')" title="How ${esc(_shortLbl)} co-assists work" style="border:1px solid var(--blue-tint-line);background:var(--blue-tint-bg);color:var(--blue-2);border-radius:50%;width:20px;height:20px;font-weight:800;cursor:pointer;font-size:12px;line-height:1;flex:none">i</button>`
      : '';
  const list = `<div class="list">
    <div class="lh">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:9px"><span style="font-family:'Space Grotesk';font-weight:700;font-size:var(--fs-3)">${_title}</span><button data-cbsid="CMP016" onclick="openAssist('coassists')" title="Ask the assistant about this screen" style="border:1px solid var(--line);background:var(--card);color:var(--blue);border-radius:50%;width:20px;height:20px;font-weight:800;cursor:pointer;font-size:12px;line-height:1;flex:none">?</button>${_typeInfoBtn}</div>
      <div style="display:flex;gap:7px"><input data-cbsid="BUS005-I01" class="inp" id="ac_add" placeholder="New co-assist — person, device, system or agent" style="flex:1" readonly onclick="openActorWiz()"><button data-cbsid="BUS005-B08" class="composebtn" data-testid="coassist-new" onclick="openActorWiz()">+ New</button></div>
      <div class="srch" style="margin-top:8px">🔍 <input data-cbsid="BUS005-I02" placeholder="Search name, role, key" value="${esc(UI.acQ || '')}" oninput="UI.acQ=this.value;paintAcList()"></div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:var(--fs-1);color:var(--grey);flex-wrap:wrap">
        <span style="display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden">${['active', 'inactive', 'all'].map((item) => `<button data-cbsid="BUS005-B09" onclick="setAcFlt('${item}')" style="border:0;background:${acFlt() === item ? 'var(--blue)' : 'var(--card)'};color:${acFlt() === item ? 'var(--on-accent)' : 'var(--grey)'};font-weight:700;font-size:var(--fs-1);padding:4px 9px;text-transform:capitalize">${item}</button>`).join('')}</span>
        <span style="display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden">${['all']
          .concat(Object.keys(window.ACTOR_TYPES || {}))
          .map((item) => {
            var reg = (window.ACTOR_TYPES || {})[item] || {};
            var on = (UI.acTypeF || 'all') === item;
            var lbl = item === 'all' ? 'All' : (reg.icon ? reg.icon + ' ' : '') + (reg.label || item).split(/[ /]/)[0];
            return `<button data-cbsid="BUS005-B10" onclick="setAcTypeF('${item}')" title="${item === 'all' ? 'all types' : reg.label || item}${reg.comingSoon ? ' — coming soon' : ''}" style="border:0;background:${on ? 'var(--blue)' : 'var(--card)'};color:${on ? 'var(--on-accent)' : 'var(--grey)'};font-weight:700;font-size:var(--fs-1);padding:4px 9px;white-space:nowrap${reg.comingSoon ? ';font-weight:400;cursor:not-allowed;outline:1px dashed var(--grey);outline-offset:-3px' : ''}"${reg.comingSoon ? ' aria-disabled="true"' : ''}>${lbl}</button>`;
          })
          .join('')}</span>
        <span style="margin-inline-start:auto" id="ac_count">${acCount()}</span>${acSortSelect()}</div>
    </div>
    <div class="rows" id="ac_rows">${UI._acLoading && (UI.acTypeF || 'all') !== 'ai' ? '<div class="loadwrap"><span class="spin"></span> loading…</div>' : acRowsHTML()}</div>
  </div>`;
  const detail = `<div class="detail" id="detailpane">${acDetailHTML()}</div>`;
  const divider = `<div class="divider" id="divider" onmousedown="startDrag(event)" ontouchstart="startDrag(event)" role="separator" aria-label="Resize panes"><span class="grip"></span></div>`;
  const showDetail = UI.vp === 'mob' && UI.mdetail;
  return `<div class="panel ${showDetail ? 'showdetail' : ''}" id="panel" style="--lw:${UI.lw}px;--lh:${UI.lh}px">${list}${divider}${detail}</div>`;
}
/* ── Full-panel Add-actor WIZARD (2026-07-06) — one responsive frame BELOW the top bar, same on every step,
 *    back/forth, ≤2-3 fields per pane (rule: more detail → more panes). Type picker → type-specific steps →
 *    result. Panel top is MEASURED from .topbar at render (not hardcoded 52px) so it fits any device/font;
 *    content sits in a centred ≤560px column so 4"/6"/tablet/desktop all read right. Ready types create for
 *    real (Human→addActor · IoT→connectorCreate); explore types walk to a "how it works" preview. */
/* ⭐ 'docs' is a THIRD step on the human path only. Athi, 2026-08-20: *"yes, add it to the create form too."*
   A machine has no PAN, so IoT/ERP/AI keep two steps — the wizard already branches by type, and adding the
   step to all four would have asked a Raspberry Pi for its Aadhaar. */
var AW_STEPS = { human: ['who', 'hat', 'docs'], iot: ['gw', 'mode'], erp: ['sys', 'conn'], ai: ['agent', 'guard'] };
function _awCap(k) {
  return ((typeof SESSION !== 'undefined' && SESSION.capabilities) || []).indexOf(k) >= 0;
}
function _awReady(t) {
  return t === 'human' ? true : t === 'ai' ? _awCap('ai') : _awCap('connector');
}
function openActorWiz() {
  UI.awType = null;
  UI.awStep = 0;
  UI.awData = {};
  UI.awErr = null;
  UI.awResult = null;
  /* ⚠️ CLEARED ON OPEN. Held documents surviving into the NEXT person's creation would file one employee's
     PAN against another — the single worst outcome this screen has available to it. */
  UI.awDocs = null;
  if (typeof ensureCap === 'function')
    ensureCap('iddocs')
      .then(awRender)
      .catch(function () {});
  awRender();
}
function awClose() {
  var node = document.getElementById('actorwiz');
  if (node) node.remove();
}
function awDownloadPkg() {
  try {
    if (UI.awInstaller && typeof _download === 'function') _download('chitbridge-install.sh', UI.awInstaller);
    else if (typeof toast === 'function') toast('Package not ready — open the gateway and hit 📦 Create package (it re-creates the same installer).');
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
}
function awHost() {
  var node = document.getElementById('actorwiz');
  if (!node) {
    node = document.createElement('div');
    node.id = 'actorwiz';
    node.setAttribute('data-pop', 'POP018');
    document.body.appendChild(node);
  }
  return node;
}
function awCapture() {
  UI.awData = UI.awData || {};
  ['aw_name', 'aw_key', 'aw_hat', 'aw_site', 'aw_mode', 'aw_baseurl', 'aw_authref', 'aw_role', 'aw_under'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) UI.awData[id] = el.value;
  });
  /* ⚠️⚠️ THE DOCUMENT FIELDS MUST BE CAPTURED HERE OR THEY ARE LOST. awRender rebuilds the whole wizard body
     on every step change, so anything typed and not lifted into UI.awData is destroyed by pressing Back —
     silently, with the field simply empty on return. Same failure the compose modal had. */
  try {
    if (typeof CBIdDocs !== 'undefined') {
      UI.awDocs = UI.awDocs || {};
      CBIdDocs.ORDER.forEach(function (item) {
        var el = document.getElementById('idoc_' + item);
        if (el) UI.awDocs[item] = el.value;
      });
      var node = document.getElementById('idoc_consent');
      if (node) UI.awDocs._consent = !!node.checked;
    }
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
}
function awPick(t) {
  UI.awType = t;
  UI.awStep = 0;
  UI.awErr = null;
  awRender();
}
function awNext() {
  awCapture();
  var s = AW_STEPS[UI.awType] || [];
  if (UI.awStep >= s.length - 1) {
    awFinish();
  } else {
    UI.awStep++;
    UI.awErr = null;
    awRender();
  }
}
function awBack() {
  awCapture();
  UI.awErr = null;
  if (UI.awStep === 'done') {
    UI.awStep = (AW_STEPS[UI.awType] || []).length - 1;
    UI.awResult = null;
  } else if (UI.awStep === 0) {
    UI.awType = null;
  } else {
    UI.awStep--;
  }
  awRender();
}
async function awFinish() {
  awCapture();
  var t = UI.awType,
    d = UI.awData || {};
  if (!_awReady(t)) {
    UI.awResult = _awPreviewHtml(t);
    UI.awStep = 'done';
    UI.awErr = null;
    awRender();
    return;
  }
  if (t === 'human') {
    var name = (d.aw_name || '').trim(),
      key = (d.aw_key || '').toLowerCase().trim();
    if (!name || key.length < 4) {
      UI.awErr = 'A display name and a User ID of 4+ characters are required.';
      awRender();
      return;
    }
    if (!/^[a-z0-9]+$/.test(key)) {
      UI.awErr = 'User ID: lowercase letters and numbers only.';
      awRender();
      return;
    }
    /**
     * ⚠️ SENDS access_level AND `hat` TOGETHER until b173 is run. The API accepts both and prefers the level;
     * sending only the level against a pre-b173 database would write NULL into a column that does not exist
     * yet and leave every check falling back to the default. Belt and braces for exactly the window between
     * deploy and migration — which is always non-zero here, because Athi runs migrations by hand.
     */
    var _lvl = d.aw_hat || 'editor';
    var _hatCompat = { editor: 'act', commenter: 'audit', viewer: 'view_only' }[_lvl] || 'act';
    try {
      var reply = await api('addActor', { body: { display_name: name, actor_key: key, access_level: _lvl, hat: _hatCompat } });
      var lf = (reply && (reply.login_format || (reply.actor && reply.actor.login_format))) || (typeof coId === 'function' ? coId(key) : key);
      var otp = (reply && (reply.otp || reply.dev_otp)) || '';
      UI.awResult =
        '<div style="text-align:center"><div style="font-size:var(--fs-7);margin:8px 0 6px">✉️</div><div style="font-weight:700;font-size:var(--fs-4)">' +
        tx('Invite ready') +
        '</div><div style="font-size:var(--fs-2);color:var(--ink-2);line-height:1.7;margin-top:10px">User ID <b>' +
        esc(lf) +
        '</b><br>one-time code <b>' +
        esc(otp || '—') +
        '</b><br><br>Share these — they set a PIN and start on shift.</div></div>';
      /**
       * ⭐⭐ TWO STEPS, AND THEY CANNOT BE ONE. A document is filed AGAINST an identity, and the identity does
       * not exist until addActor returns — so the fields are held client-side through the wizard and posted
       * once there is an id to attach them to.
       *
       * ⚠️ AND A FAILURE HERE MUST NOT READ AS A FAILED HIRE. The co-assist is already created and their
       * invite is already valid; a document that did not save is a correction, not a rollback. So it is
       * reported as an addendum on the success screen rather than thrown, and the person can be fixed up
       * from the edit form.
       */
      var _newId = reply && reply.actor && reply.actor.identity_id;
      if (_newId && UI.awDocs) {
        try {
          await ensureCap('iddocs');
          var _sent = 0,
            _bad = [];
          for (var count = 0; count < CBIdDocs.ORDER.length; count++) {
            var _sc = CBIdDocs.ORDER[count],
              _v = (UI.awDocs[_sc] || '').trim();
            if (!_v) continue;
            var _res = await fetch(CFG.API_BASE + '/api/identity/documents/' + _sc, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token },
              body: JSON.stringify({ value: _v, consent: !!UI.awDocs._consent, identity_id: _newId })
            });
            if (_res.ok) _sent++;
            else {
              var _j = await _res.json().catch(function () {
                return {};
              });
              _bad.push(_sc + ' — ' + (_j.message || _res.status));
            }
          }
          if (_sent) UI.awResult += '<div class="misnote" style="margin-top:10px">' + _sent + ' document(s) submitted for verification.</div>';
          if (_bad.length)
            UI.awResult +=
              '<div class="misnote" style="margin-top:8px;color:var(--warn-3)">Not saved: ' +
              esc(_bad.join(' · ')) +
              '. The co-assist WAS created — add these from their profile.</div>';
        } catch (_) {
          /* the hire stands; the documents are a correction */
        }
        UI.awDocs = null;
      }
      UI.awStep = 'done';
      UI.awErr = null;
      awRender();
      if (UI.nav === 'coassists' && typeof loadCoassists === 'function') loadCoassists();
    } catch (e) {
      UI.awErr = (e && e.message) || 'Create failed';
      awRender();
    }
    return;
  }
  // Pull mode (subscribe to the customer's broker) is not built yet — gate it as coming-soon, never create a dead connector.
  if (t === 'iot' && (d.aw_mode || 'push') === 'pull') {
    UI.awResult =
      '<div style="text-align:center"><div style="font-size:var(--fs-7);margin:8px 0 6px">🔌</div><div style="font-weight:700;font-size:var(--fs-4)">' +
      tx('Pull mode — coming soon') +
      '</div><div style="font-size:var(--fs-2);color:var(--ink-2);line-height:1.6;margin-top:10px">' +
      txf('Subscribing to {your} MQTT broker: ⏳ pending. For now use', { your: '<b>' + tx('your') + '</b>' }) +
      ' <b>' +
      tx('Push') +
      '</b>: a Pi / edge box we hand a one-line installer to. ‹ Back one step to switch to Push.</div><div style="font-size:var(--fs-1);color:var(--blue-2);background:var(--blue-tint);border:1px solid var(--blue-tint-line);border-radius:9px;padding:9px 11px;margin-top:14px">✨ Explore mode — not activated yet.</div></div>';
    UI.awStep = 'done';
    UI.awErr = null;
    awRender();
    return;
  }
  var cfg =
    t === 'iot' ? { mode: d.aw_mode || 'push' } : { base_url: (d.aw_baseurl || '').trim() || undefined, auth_ref: (d.aw_authref || '').trim() || undefined };
  var nm2 = (d.aw_name || '').trim();
  if (nm2.length < 2) {
    UI.awErr = 'A name of at least 2 characters is required.';
    awRender();
    return;
  }
  try {
    var r2 = await api('connectorCreate', { body: { display_name: nm2, type: t, site: (d.aw_site || '').trim() || undefined, config: cfg } });
    var pk = r2 && r2.provision_key;
    if (t === 'iot' && pk) {
      // Build the one-drop installer NOW (with the key we just received) but HOLD it — do NOT auto-download. The user
      // clicks 'Download' when they're ready to run it on the Pi. Same key, so nothing gets invalidated.
      UI.awInstaller = null;
      try {
        if (typeof ensureCap === 'function') await ensureCap('connector');
        if (typeof _buildInstaller === 'function')
          UI.awInstaller = _buildInstaller({
            endpoint: CFG.API_BASE /* HX1: the api this app talks to */,
            key: pk,
            heartbeat_sec: 60,
            spool_dir: '/opt/chitbridge/spool',
            devices: []
          });
      } catch (_) { /* best effort: failing here changes nothing the user sees */ }
      UI.awResult =
        '<div style="text-align:center"><div style="font-size:var(--fs-7);margin:8px 0 6px">🛰️</div><div style="font-weight:700;font-size:var(--fs-4)">' +
        tx('Gateway created') +
        '</div>' +
        (UI.awInstaller
          ? '<div style="font-size:var(--fs-2);color:var(--ink-2);line-height:1.6;margin-top:10px">' +
            txf('Its one-drop installer is {ready} (key inside). Download it when you are ready to set up the Pi:', { ready: '<b>' + tx('ready') + '</b>' }) +
            '</div><button data-cbsid="BUS005-B11" class="composebtn pri" style="margin-top:12px" onclick="awDownloadPkg()">' +
            tx('📦 Download install package') +
            '</button><div style="font-size:var(--fs-1);color:var(--grey);margin-top:10px">Then run <span style="background:var(--chrome);color:var(--blue-tint-line);border-radius:6px;padding:1px 6px;font:11px ui-monospace,Consolas,monospace">sudo bash chitbridge-install.sh</span> on the Pi, and add its <b>devices</b> here.<br><b>Didn\'t download, or lost it?</b> Open the gateway <span class=arw>→</span> <b>' +
            tx('📦 Create package') +
            '</b> — a re-created package is identical (same gateway, fresh key). Re-creation and creation give you the exact same thing.</div>'
          : '<div style="font-size:var(--fs-2);color:var(--ink-2);margin-top:10px">' +
            txf('Open it in Co-assists {arrow} {btn} to get the installer.', {
              arrow: '<span class=arw>→</span>',
              btn: '<b>' + tx('📦 Create package') + '</b>'
            }) +
            '</div>') +
        '</div>';
    } else {
      UI.awResult =
        '<div style="text-align:center"><div style="font-size:var(--fs-7);margin:8px 0 6px">🔌</div><div style="font-weight:700;font-size:var(--fs-4)">' +
        tx('System connected') +
        '</div><div style="font-size:var(--fs-2);color:var(--ink-2);margin-top:10px">Add its endpoints in Connectors.</div></div>';
    }
    UI.awStep = 'done';
    UI.awErr = null;
    UI.connectors = undefined;
    awRender();
    if (UI.nav === 'coassists' && typeof loadCoassists === 'function') loadCoassists(); // refresh the panel so the new Pi/system shows immediately
  } catch (e) {
    UI.awErr = (e && e.message) || 'Create failed';
    awRender();
  }
}
function _awPreviewHtml(t) {
  var m = {
    erp: { ic: '🔌', nm: 'ERP / API', how: "The system's endpoints exchange records over the governed rail — processed then forgotten (receipt only)." },
    ai: { ic: '🤖', nm: 'AI agent', how: 'A governed AI drafts / answers under your rules — every action it takes is a chit you can see and dispute.' },
    iot: { ic: '🛰️', nm: 'IoT device', how: 'A Pi publishes readings to the connection string we issue — they become chits over the rail.' }
  }[t] || { ic: '', nm: t, how: '' };
  return (
    '<div style="text-align:center"><div style="font-size:var(--fs-7);margin:8px 0 6px">' +
    m.ic +
    '</div><div style="font-weight:700;font-size:var(--fs-4)">' +
    m.nm +
    ' — how it works</div><div style="font-size:var(--fs-2);color:var(--ink-2);line-height:1.6;margin-top:10px">' +
    m.how +
    '</div><div style="font-size:var(--fs-1);color:var(--blue-2);background:var(--blue-tint);border:1px solid var(--blue-tint-line);border-radius:9px;padding:9px 11px;margin-top:14px">✨ Explore mode — not activated for your entity yet.</div></div>'
  );
}
function awRender() {
  var d = UI.awData || {}; // render THROUGH the app's shared modal() → same placement/backdrop/responsive as every other dialog
  function fld(id, label, ph) {
    return (
      '<div style="margin-bottom:20px"><label class="fl" style="display:block;margin-bottom:5px">' +
      label +
      '</label><input data-cbsid="BUS005-I10" class="inp" id="' +
      id +
      '" data-testid="' +
      id +
      '" placeholder="' +
      ph +
      '" value="' +
      esc(d[id] || '') +
      '" style="width:100%"></div>'
    );
  }
  function selF(id, label, opts) {
    return (
      '<div style="margin-bottom:20px"><label class="fl" style="display:block;margin-bottom:5px">' +
      label +
      '</label><select data-cbsid="BUS005-S06" class="inp" id="' +
      id +
      '" style="width:100%">' +
      opts
        .map(function (item) {
          return '<option value="' + item[0] + '"' + (String(d[id]) === item[0] ? ' selected' : '') + '>' + item[1] + '</option>';
        })
        .join('') +
      '</select></div>'
    );
  }
  function how(x) {
    return (
      '<div style="font-size:var(--fs-2);color:var(--grey);background:var(--card);border:1px solid var(--line);border-radius:9px;padding:10px 12px;line-height:1.5;margin-top:12px">' +
      x +
      '</div>'
    );
  }
  var body = '',
    title = '',
    sub = '',
    dots = '',
    foot = '';
  if (UI.awType === null) {
    title = 'Add a co-assist';
    sub = 'What kind of co-assist? People, devices, systems and agents can all act for you.';
    var types = [
      ['human', '👤', 'Human', 'A person who acts for you'],
      ['iot', '🛰️', 'IoT device', 'A Pi / gateway that sends signals'],
      ['erp', '🔌', 'ERP / API', 'Connect a business system'],
      ['ai', '🤖', 'AI agent', 'An autonomous co-assist']
    ];
    body =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      types
        .map(function (item) {
          var nestedRdy = _awReady(item[0]);
          return (
            '<div data-cbsid="BUS005-C02" data-testid="coassist-type-' +
            item[0] +
            '" onclick="awPick(\'' +
            item[0] +
            '\')" onmouseover="this.style.borderColor=\'var(--blue)\'" onmouseout="this.style.borderColor=\'#e5e2dd\'" style="border:1px solid #e5e2dd;border-radius:14px;padding:14px;cursor:pointer;' +
            (nestedRdy ? '' : 'opacity:.72') +
            '"><div style="font-size:var(--fs-5)">' +
            item[1] +
            '</div><div style="font-weight:700;font-size:var(--fs-3);margin-top:6px">' +
            item[2] +
            '</div><div style="font-size:var(--fs-1);color:var(--grey-2);margin-top:2px;line-height:1.35">' +
            item[3] +
            '</div><span style="display:inline-block;margin-top:9px;font-size:var(--fs-1);font-weight:700;border-radius:20px;padding:1px 9px;' +
            (nestedRdy ? 'background:var(--ok-tint);color:var(--ok-2)' : 'background:var(--blue-tint);color:var(--blue-2)') +
            '">' +
            (nestedRdy ? 'ready' : 'explore') +
            '</span></div>'
          );
        })
        .join('') +
      '</div>';
    foot = '<button data-cbsid="CMP003" class="composebtn" style="flex:1" onclick="awClose()">' + tx('Cancel') + '</button>';
  } else {
    var steps = AW_STEPS[UI.awType] || [],
      rdy = _awReady(UI.awType);
    var icN = { human: ['👤', 'Human'], iot: ['🛰️', 'IoT device'], erp: ['🔌', 'ERP / API'], ai: ['🤖', 'AI agent'] }[UI.awType];
    title = icN[0] + ' ' + icN[1] + (rdy ? '' : ' · explore');
    dots =
      '<div style="display:flex;gap:6px;margin:0 0 14px">' +
      steps
        .map(function (item, index) {
          var st = UI.awStep === 'done' || index < UI.awStep ? 'var(--blue-2)' : index === UI.awStep ? 'var(--blue)' : 'var(--warn-tint)';
          return '<span style="height:4px;flex:1;border-radius:3px;background:' + st + '"></span>';
        })
        .join('') +
      '<span style="height:4px;flex:1;border-radius:3px;background:' +
      (UI.awStep === 'done' ? 'var(--blue)' : 'var(--warn-tint)') +
      ';color:' +
      (UI.awStep === 'done' ? 'var(--on-accent)' : 'var(--on-card)') +
      '"></span></div>';
    if (UI.awStep === 'done') {
      sub = rdy ? 'Done' : 'Preview';
      body = UI.awResult || '';
      // Guard the duplicate-create: after a REAL create, do NOT offer Back (it would land on a live Create button and
      // make a 2nd connector). Only Done. Explore/preview created nothing, so Back is safe there.
      foot = rdy
        ? '<button data-cbsid="CMP004" class="composebtn pri" data-testid="coassist-wiz-done" style="flex:1" onclick="awClose()">' + tx('Done') + '</button>'
        : '<button data-cbsid="CMP006" class="composebtn" style="flex:1" data-testid="coassist-wiz-back" onclick="awBack()">‹ Back</button><button data-cbsid="CMP004" class="composebtn pri" data-testid="coassist-wiz-done" style="flex:1" onclick="awClose()">' +
          tx('Got it') +
          '</button>';
    } else {
      var sk = steps[UI.awStep];
      if (sk === 'who')
        body =
          fld('aw_name', 'Display name', 'Anitha') +
          fld('aw_key', 'User ID (sign-in)', 'anitha') +
          how('They sign in with this User ID under your entity + a one-time code, then set a PIN.');
      /* ⭐ b173 — three levels from ACCESS_CHOICES (app.html), not five hats hardcoded here. This list lived
         in two screens and a reference tab; it now lives once, beside the function that reads it. */
      else if (sk === 'hat') body = selF('aw_hat', 'Access', ACCESS_CHOICES) + how('Only an Editor can be assigned work.');
      /* ⭐ THE SHARED MODULE AGAIN — third surface, still one implementation. Empty docs because the person
         does not exist yet; noButton because the wizard's own Next/Finish drives the submit. */
      else if (sk === 'docs')
        body =
          (typeof CBIdDocs !== 'undefined' ? CBIdDocs.html([], 'owner', { noButton: true }) : '<div class="misnote">' + tx('Loading…') + '</div>') +
          how('Optional now — they can add or correct these themselves later.');
      else if (sk === 'gw')
        body =
          fld('aw_name', 'Gateway name', 'Line-1 Gateway') +
          fld('aw_site', 'Site', 'Chennai') +
          how('One Pi = one gateway; its sensors are connections (BridgeIds) under it.');
      else if (sk === 'mode')
        body =
          selF('aw_mode', 'What is sending the data?', [
            ['push', '📟 A Pi / edge box I will set up — recommended'],
            ['pull', '🔌 My existing MQTT broker / cloud — coming soon']
          ]) + how('Push: we generate a one-line installer to flash on the Pi. Pull (we subscribe to your broker) is on the roadmap — not live yet.');
      else if (sk === 'sys')
        body =
          fld('aw_name', 'System name', 'Acme SAP') + fld('aw_site', 'Site', 'HQ') + how('One system = one co-assist; its endpoints are connections under it.');
      else if (sk === 'conn')
        body =
          fld('aw_baseurl', 'Base URL', 'https://sap.acme.com/api') +
          fld('aw_authref', 'Auth reference (secret NAME)', 'ACME_SAP_KEY') +
          how('We store a reference to the secret, never the raw key.');
      else if (sk === 'agent')
        body =
          fld('aw_name', 'Agent name', 'Draft-bot') +
          fld('aw_role', 'Role', 'drafts replies for review') +
          how('Every action it takes is a chit you can see and dispute.');
      else if (sk === 'guard')
        body =
          selF('aw_under', 'Acts under', [
            ['rules', 'your rules only'],
            ['approval', 'your rules + human approval']
          ]) + how('Governed: it can only do what your rules allow.');
      sub = UI.awStep + 1 + ' of ' + steps.length;
      if (UI.awErr) body += '<div style="color:var(--disp);font-size:var(--fs-2);margin-top:10px">' + esc(UI.awErr) + '</div>';
      var nextLbl = UI.awStep === steps.length - 1 ? tx(rdy ? 'Create' : 'See result') : tx('Next ›');
      foot =
        '<button data-cbsid="CMP006" class="composebtn" style="flex:1" data-testid="coassist-wiz-back" onclick="awBack()">‹ Back</button><button data-cbsid="BUS005-B23" class="composebtn pri" style="flex:1" data-testid="coassist-wiz-next" onclick="awNext()">' +
        nextLbl +
        '</button>';
    }
  }
  // RESPONSIVE placement: FULL-SCREEN on mobile (fill · generous gaps · buttons in a bottom bar — like the
  // co-assist screens), a comfortable CENTRED CARD on laptop (not a full-bleed sheet). Below the measured bar.
  var host = awHost(),
    mob = UI.vp === 'mob' || (typeof window !== 'undefined' && window.innerWidth < 640),
    barH = (document.querySelector('.topbar') || {}).offsetHeight || 52;
  var head =
    '<div style="padding:16px 18px;border-bottom:1px solid #f0efec"><div style="max-width:520px;margin:0 auto;display:flex;align-items:flex-start;gap:10px"><div style="flex:1"><div style="font-size:var(--fs-4);font-weight:700">' +
    title +
    '</div>' +
    (sub ? '<div style="font-size:var(--fs-2);color:var(--grey);margin-top:3px">' + sub + '</div>' : '') +
    '</div><button data-cbsid="CMP005" onclick="awClose()" style="border:1px solid var(--line);background:var(--card);border-radius:9px;width:32px;height:32px;cursor:pointer;flex:none;color:var(--on-card)">✕</button></div>' +
    (dots ? '<div style="max-width:520px;margin:0 auto">' + dots + '</div>' : '') +
    '</div>';
  var mid = '<div style="flex:1;overflow:auto;padding:22px 18px"><div style="max-width:520px;margin:0 auto">' + body + '</div></div>';
  var footbar =
    '<div style="border-top:1px solid #f0efec;padding:14px 18px"><div style="max-width:520px;margin:0 auto;display:flex;gap:12px">' + foot + '</div></div>';
  // ONE comfortable centred card, both mobile & laptop: sized to its content (never a full-screen sheet), dim
  // backdrop, bounded height with the body scrolling if a step ever gets long. Near-full-width on a phone.
  // Fill the SAME region the co-assist screens use: measure #panel (the current screen container) and match its
  // exact start/end. Mobile → the full screen below the header; laptop → the content pane (NOT the whole viewport).
  // Reuses the app's own coordinates instead of guessing — content lives inside via head/mid(scroll)/footbar.
  var pane = document.getElementById('panel') || document.querySelector('.panel');
  var r = pane ? pane.getBoundingClientRect() : null;
  /**
   * ⚠️⚠️ CLAMP TO THE VIEWPORT, OR THE FOOTER FALLS OFF THE BOTTOM OF THE WORLD. Athi, 2026-08-23, on the IoT
   * wizard: *"I couldn't progress after the first step"* — with a screenshot showing the fields and NO Next
   * button anywhere.
   *
   * The cause is this line. It copies #panel's rect onto a `position:fixed` box, and a fixed box is measured
   * from the VIEWPORT while the rect it is copying is not: whenever `#panel` is taller than what remains below
   * its top — a long screen, or a page scrolled down so `r.top` is small and `r.height` still large — the box
   * runs past the bottom edge. The frame is `overflow:hidden` and fixed, so nothing scrolls it back: the
   * footer exists, is painted, and cannot be reached or clicked. Playwright says it plainly — *"element is
   * outside of the viewport"* — after 45 attempts to scroll to something that will never come into view.
   *
   * ⚠️ The height must be what is AVAILABLE, never what was measured. Both are needed: `top` clamped at 0 for
   * a pane scrolled above the fold, and height capped at the space left under it.
   */
  var vh = (typeof window !== 'undefined' && window.innerHeight) || 0;
  var top = r ? Math.max(0, Math.round(r.top)) : barH;
  var avail = vh ? Math.max(0, vh - top) : r ? Math.round(r.height) : 0;
  var h = r ? Math.min(Math.round(r.height), avail) : 0;
  var pos =
    r && h > 240
      ? 'top:' + top + 'px;inset-inline-start:' + Math.round(r.left) + 'px;width:' + Math.round(r.width) + 'px;height:' + h + 'px'
      : 'top:' + barH + 'px;inset-inline-start:0;inset-inline-end:0;bottom:0';
  host.innerHTML =
    '<div style="position:fixed;' +
    pos +
    ';background:var(--card);z-index:400;display:flex;flex-direction:column;overflow:hidden;box-shadow:-8px 0 24px rgba(0,0,0,.08);color:var(--on-card)">' +
    head +
    mid +
    footbar +
    '</div>';
}
/* ══ CONNECTOR (Pi / system) handled IN Co-assists — the separate Connectors page is dismounted. When the
 *    selected actor is a connector, acDetailHTML renders this COCKPIT instead of the human profile. Principle:
 *    STATIC stuff (health · connection string · add) lives in the STICKY TOP as icons; the DEVICE LIST scrolls
 *    below (so 15 devices never bury the connection string). Reuses the connector API (b62). ══ */
function acRefilter() {
  UI.acSel = null;
  UI.acDet = null;
  UI.acManageOpen = false;
  UI.acManageLoading = false;
  UI.acManageErr = null;
  var node = document.getElementById('mainbody');
  if (node) node.innerHTML = mainBody();
  if (UI.vp !== 'mob') {
    var f = typeof acVisible === 'function' ? acVisible()[0] : null;
    if (f) selectActor(f.id, true);
  }
} // UNIFORM: any filter change resets the detail + lands on the first record header (desktop)
function setAcTypeF(t) {
  UI.acTypeF = t;
  acRefilter();
} // filter by actor TYPE
function acTypeOf(x) {
  return (UI._connMap || {})[x.id] || x.type || 'human';
} // connector_type (iot/erp) wins, else the actor type
/**
 * ── ⭐⭐ THE ORDER OF THE CO-ASSISTS ────────────────────────────────────────────────────────────────────
 *
 * ⚠️ ON SHIFT FIRST IS THE DEFAULT, not A–Z, and that is the one decision on this screen. The question a
 * shopkeeper opens this list with is 'who can take this now' — an alphabetical list answers a question nobody
 * asked and buries the answer to the one they did. Busiest first is the same question from the other end: who
 * to stop giving work to.
 */
var AC_SORTS = {
  shift: {
    label: 'On shift first',
    cmp: function (a, b) {
      return _acShiftRank(a) - _acShiftRank(b) || String(acLbl(a)).localeCompare(String(acLbl(b)));
    }
  },
  az: {
    label: 'Name A–Z',
    cmp: function (a, b) {
      return String(acLbl(a)).localeCompare(String(acLbl(b)));
    }
  },
  za: {
    label: 'Name Z–A',
    cmp: function (a, b) {
      return String(acLbl(b)).localeCompare(String(acLbl(a)));
    }
  },
  load: {
    label: 'Busiest first',
    cmp: function (a, b) {
      return (Number(b.load) || 0) - (Number(a.load) || 0);
    }
  }
};
function _acShiftRank(x) {
  return x.shift === 'on_shift' ? 0 : x.shift === 'on_break' ? 1 : 2;
}
function acSortKey() {
  return AC_SORTS[UI.acSort] ? UI.acSort : 'shift';
}
function acSortSelect() {
  return (
    '<select data-cbsid="BUS005-S02" class="inp" data-testid="coassist-sort" aria-label="' +
    esc(tx('Sort order')) +
    '" title="' +
    esc(tx('Sort order')) +
    '" style="width:auto;padding:3px 6px;font-size:var(--fs-1)" onchange="setAcSort(this.value)">' +
    Object.keys(AC_SORTS)
      .map(function (item) {
        return '<option value="' + item + '"' + (acSortKey() === item ? ' selected' : '') + '>' + esc(tx(AC_SORTS[item].label)) + '</option>';
      })
      .join('') +
    '</select>'
  );
}
function setAcSort(v) {
  UI.acSort = v;
  try {
    if (LAZY) delete LAZY.ac;
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  paintAcList();
}
function acVisible() {
  let list = (UI.acts || []).filter((x) => (acFlt() === 'all' ? true : acFlt() === 'inactive' ? x.status !== 'active' : x.status === 'active'));
  const tf = UI.acTypeF || 'all';
  if (tf !== 'all') list = list.filter((x) => acTypeOf(x) === tf);
  const q = (UI.acQ || '').trim().toLowerCase();
  if (q) list = list.filter((x) => ((x.name || '') + ' ' + (x.role || '') + ' ' + (x.key || '') + ' ' + (x.type || '')).toLowerCase().includes(q));
  /* ⚠️ a COPY. The filters above already return a new array, so today this slice changes nothing — it is here
     for the day somebody adds an "all" fast path that hands back UI.acts itself, at which point sorting in
     place would reorder the screen's own array under everything else reading it. e2e/list-order carries that
     as a LATENT guard and says so, rather than counting it as proven. [[feedback-repaint-locally]] */
  var _s = AC_SORTS[acSortKey()];
  return _s ? list.slice().sort(_s.cmp) : list;
}
function _ago(ts) {
  return timeAgo(ts);
} // shared: helpers.js timeAgo
// IoT/ERP list row — health + last-active + device count (NOT the human hat/shift/invite/tasks row)
function _iotRowHTML(x) {
  var info = (UI._connInfo || {})[x.id] || {};
  var t = info.type || (typeof acTypeOf === 'function' && acTypeOf(x)) || 'iot';
  var iot = t !== 'erp';
  var h = info.health || 'offline';
  var hc = healthColor(h);
  var ago = _ago(info.last_seen);
  var cnt = info.count != null ? info.count : 0;
  var dim = x.status !== 'active' ? 'opacity:.55' : '';
  var typechip =
    '<span class="optchip" style="background:' +
    (iot ? 'var(--blue-tint-bg)' : 'var(--purple-tint)') +
    ';color:' +
    (iot ? 'var(--blue-2)' : 'var(--purple-2)') +
    ';border-color:transparent">' +
    (iot ? '🛰️ IoT' : '🔌 ERP') +
    '</span>';
  return `<div data-cbsid="BUS005-C03" class="row ${x.id === UI.acSel ? 'sel' : ''}" data-ac="${x.id}" style="${dim}" onclick="selectActor('${x.id}')">
    <div style="width:9px;height:9px;border-radius:50%;flex:0 0 auto;margin-top:5px;background:${hc}"></div>
    <div class="main2"><div class="l1"><span class="code">${esc(x.name)}</span>${typechip}<span class="amt" style="margin-inline-start:auto;font-size:var(--fs-1);color:${hc};font-weight:600">${esc(h)}${ago ? ' · ' + esc(ago) : ''}</span></div>
      <div class="l2">📍 ${esc(info.site || x.site || 'no site')} · <b>${cnt}</b> ${iot ? (cnt === 1 ? 'device' : 'devices') : cnt === 1 ? 'endpoint' : 'endpoints'}</div></div>
    <div class="rowgo" aria-hidden="true">›</div></div>`;
}
function acRowHTML(x) {
  if (typeof acTypeOf === 'function') {
    var _ct = acTypeOf(x);
    if (_ct === 'iot' || _ct === 'erp') return _iotRowHTML(x);
  }
  const dim = x.status !== 'active' ? 'opacity:.55' : '';
  const coverNm = x.del ? (UI._acNames || {})[x.del] || '—' : '';
  const coversNames = (UI._coversNames || {})[x.id] || [];
  const coverLines =
    x.del || coversNames.length
      ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:3px;line-height:1.45">' +
        (x.del ? '🛡 Covered by <b style="color:var(--ink);font-weight:600">' + coverNm + '</b>' : '') +
        (x.del && coversNames.length ? '<br>' : '') +
        (coversNames.length ? '🤝 Covers for <b style="color:var(--ink);font-weight:600">' + coversNames.join(', ') + '</b>' : '') +
        '</div>'
      : '';
  return `<div data-cbsid="BUS005-C04" class="row ${x.id === UI.acSel ? 'sel' : ''}" data-ac="${x.id}" style="${dim}" onclick="selectActor('${x.id}')">
    <div style="width:9px;height:9px;border-radius:50%;flex:0 0 auto;margin-top:5px;background:${x.shift === 'on_shift' ? 'var(--ok-3)' : x.shift === 'on_break' ? 'var(--warn-2)' : 'var(--grey-2)'}"></div>
    <div class="main2"><div class="l1"><span class="code">${esc(x.name)}</span><span class="optchip" style="background:var(--blue-tint);color:var(--blue-d);border-color:var(--blue-tint-line)">${hatLabel(x.hat)}</span>${x.pinSet ? '' : x.invite ? '<span class="optchip" style="background:var(--warn-tint);color:var(--warn-3);border-color:var(--warn-3)">' + tx('⏳ invite') + '</span>' : ''}<span class="amt" style="margin-inline-start:auto;font-size:var(--fs-1);color:var(--grey)">${x.load}/${x.max || '∞'}</span></div>
      <div class="l2">${esc(x.role || '—')} · <span class="mono">${acLogin(x)}</span> <span class="optchip ${acShc(x.shift)}">${acShLabel(x.shift)}</span>${x.status !== 'active' ? '<span class="optchip off">' + esc(x.status) + '</span>' : ''}${x.shift !== 'on_shift' && x.returnDate ? ' · returns ' + acDate(x.returnDate) : ''}</div>${coverLines}</div>
    <div class="rowgo" aria-hidden="true">›</div></div>`;
}
function acRowsHTML() {
  if ((UI.acTypeF || 'all') === 'ai') return aiRowsHTML();
  const r = acVisible();
  if (!r.length) {
    const _tf = UI.acTypeF || 'all';
    const _reg = (window.ACTOR_TYPES || {})[_tf]; /**
     * ⚠️⚠️ "NOTIFY ME →" WAS A FAKE. Blue, bold, with an arrow — every signal of a link — and no onclick at
     * all. A reader on a coming-soon screen clicks the one thing offered, nothing happens, and they learn the
     * app's affordances cannot be trusted. There is no notify mechanism to wire it to, so it is gone: saying
     * less is honest, and looking clickable while being inert is not.
     */
    if (_reg && _reg.comingSoon)
      return emptyState(
        _reg.icon || '✨',
        esc(_reg.label) + ' — ' + tx('coming soon'),
        txf('This capability is not enabled yet. When it is, you will add {label} co-assists right here — same flow, new type.', { label: esc(_reg.label) })
      );
    /* ⭐ THE SUB MAY CARRY HTML (see emptyState) so the how-it-works link survives — and "then add one with
       + New above" stops pointing at a button elsewhere, because the action is now on this card. */
    if (_tf === 'iot')
      return emptyState(
        '🛰️',
        tx('No IoT devices yet'),
        tx('A Pi on the rail in one drop.') +
          ' <a data-cbsid="BUS005-C05" href="#" onclick="openShowcase(\'/iot-howitworks.html\',\'How IoT works\');return false" style="color:var(--blue);font-weight:600">' +
          tx('see how it works') +
          ' <span class=arw>→</span></a>',
        { label: tx('+ New co-assist'), onclick: 'openActorWiz()' }
      );
    return emptyState('🧑‍🤝‍🧑', 'No co-assists', 'People, devices and AI that work alongside you.', { label: '+ New co-assist', onclick: 'openActorWiz()' });
  }
  const cc = {},
    cn = {},
    nm = {};
  (UI.acts || []).forEach((item) => {
    const _l = acLbl(item);
    nm[item.id] = _l;
    if (item.del) {
      cc[item.del] = (cc[item.del] || 0) + 1;
      (cn[item.del] = cn[item.del] || []).push(_l);
    }
  });
  UI._coversCount = cc;
  UI._coversNames = cn;
  UI._acNames = nm; // reverse-delegate maps (name+userid labels), once
  /* ⭐ lazyWrap draws 50 and reveals the rest — a shop with a fleet of sensors has hundreds of these. */
  return lazyWrap('ac', r, acRowHTML);
}
function paintAcList() {
  const node = document.getElementById('ac_rows');
  if (node) node.innerHTML = acRowsHTML();
  const c = document.getElementById('ac_count');
  if (c) c.textContent = acCount();
}
function paintAcDetail() {
  const node = document.getElementById('detailpane');
  if (node) {
    node.className = 'detail';
    node.innerHTML = acDetailHTML();
  }
}
function selectActor(id, silent) {
  UI.acSel = id;
  UI.acMode = 'view';
  UI.acDet = (UI.acts || []).find((item) => item.id === id) || null;
  if (UI.vp === 'mob' && !silent) {
    UI.mdetail = true;
    const node = document.getElementById('panel');
    if (node) node.classList.add('showdetail');
  }
  paintAcList();
  paintAcDetail();
  if (UI.acDet && typeof acTypeOf === 'function') {
    var _st = acTypeOf(UI.acDet);
    var _sreg = (window.ACTOR_TYPES || {})[_st] || {};
    if (_sreg.capability) {
      UI.acManageOpen = false;
      UI.acManageLoading = false;
      UI.acManageErr = null;
      UI.acConns = undefined;
      UI.acProv = undefined;
      UI.acProvOpen = false;
      UI.acAddDev = false;
      UI.acFreshKey = null;
    }
  } // connector selected: instant Tier-1, management loads on drill
}
function setAcMode(m) {
  UI.acMode = m;
  paintAcDetail();
}
function setAcFlt(f) {
  UI.acFlt = f;
  acRefilter();
} // active/inactive filter - same uniform reset + reselect
/* ═══ TWO-TIER DISPATCHER (view layer) — Tier-1 = instant header summary from flags; Tier-2 = lazy management.
 *     acOpenManage is the invocation: show spinner → ensureCap(module) → per-type data load → render the cockpit. ═══ */
async function acOpenManage(id) {
  var x =
    (UI.acts || []).find(function (item) {
      return item.id === id;
    }) || UI.acDet;
  if (!x) return;
  UI.acSel = id;
  UI.acDet = x;
  UI.acManageOpen = true;
  UI.acManageErr = null;
  var _t = typeof acTypeOf === 'function' ? acTypeOf(x) : 'human';
  var reg = (window.ACTOR_TYPES || {})[_t] || {};
  if (!(window.ACTOR_MANAGE || {})[_t] && reg.module && typeof ensureCap === 'function') {
    UI.acManageLoading = true;
    paintAcDetail();
    try {
      await ensureCap(reg.module);
    } catch (e) {
      UI.acManageErr = (e && e.message) || 'Could not load management';
    }
    UI.acManageLoading = false;
  }
  if (reg.load && typeof window[reg.load] === 'function') {
    try {
      window[reg.load](id);
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  } // per-type data fetch (repaints when done)
  paintAcDetail();
}
function _acTierSummary(x) {
  var _t = typeof acTypeOf === 'function' ? acTypeOf(x) : 'human';
  var reg = (window.ACTOR_TYPES || {})[_t] || {};
  var info = (UI._connInfo || {})[x.id] || {};
  var h = info.health || 'offline';
  var hc = healthColor(h);
  var cnt = info.count != null ? info.count : 0;
  return (
    '<div style="padding:16px">' +
    '<button data-cbsid="BUS005-B12" class="dback" onclick="backToList()">‹ Co-assists</button>' +
    '<div style="display:flex;align-items:center;gap:11px;margin-top:8px"><span style="font-size:var(--fs-6)">' +
    (reg.icon || '🔌') +
    '</span>' +
    '<div style="min-width:0"><div style="font-size:var(--fs-4);font-weight:800">' +
    esc(x.name) +
    '</div><div style="font-size:var(--fs-2);color:var(--grey)">' +
    esc(reg.label || '') +
    ' · 📍 ' +
    esc(info.site || x.site || 'no site') +
    '</div></div>' +
    '<span style="margin-inline-start:auto;display:inline-flex;align-items:center;gap:6px;font-weight:700;font-size:var(--fs-2);color:' +
    hc +
    '"><span style="width:9px;height:9px;border-radius:50%;background:' +
    hc +
    ';display:inline-block"></span>' +
    esc(h) +
    '</span></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:15px 0">' +
    '<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:11px 12px;color:var(--on-card)"><div style="font-size:var(--fs-1);color:var(--grey);text-transform:uppercase;letter-spacing:.03em">' +
    tx('Devices') +
    '</div><div style="font-size:var(--fs-5);font-weight:800;margin-top:2px">' +
    cnt +
    '</div></div>' +
    '<div style="background:var(--card);border:1px solid var(--line);border-radius:12px;padding:11px 12px;color:var(--on-card)"><div style="font-size:var(--fs-1);color:var(--grey);text-transform:uppercase;letter-spacing:.03em">' +
    tx('Health') +
    '</div><div style="font-size:var(--fs-4);font-weight:800;margin-top:4px;color:' +
    hc +
    '">' +
    esc(h) +
    '</div></div>' +
    '</div>' +
    '<button data-cbsid="BUS005-B13" class="composebtn pri" style="width:100%;padding:13px;font-size:var(--fs-3);display:flex;align-items:center;justify-content:center;gap:8px" onclick="acOpenManage(\'' +
    x.id +
    '\')"><span style="font-size:var(--fs-4)">🛠️</span> Click to open the ' +
    esc(reg.label || '') +
    ' cockpit <span style="opacity:.85"><span class=arw>→</span></span></button>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:8px;text-align:center">👆 Opens its devices, connection string &amp; package — loaded on click.</div></div>'
  );
}
function _acTierLoader(x) {
  var _t = typeof acTypeOf === 'function' ? acTypeOf(x) : '';
  var reg = (window.ACTOR_TYPES || {})[_t] || {};
  return (
    '<div style="padding:16px"><button data-cbsid="BUS005-B14" class="dback" onclick="backToList()">‹ Co-assists</button>' +
    '<div style="padding:46px 16px;text-align:center;color:var(--grey)"><span class="spin" style="display:inline-block;margin-bottom:12px"></span><div>Loading ' +
    esc(reg.label || '') +
    ' cockpit…</div>' +
    (UI.acManageErr
      ? '<div style="color:var(--disp);margin-top:12px;font-size:var(--fs-2)">' +
        esc(UI.acManageErr) +
        ' <button data-cbsid="CMP009" class="composebtn" style="padding:2px 9px;font-size:var(--fs-1);margin-inline-start:6px" onclick="acOpenManage(\'' +
        x.id +
        '\')">' +
        tx('Retry') +
        '</button></div>'
      : '') +
    '</div></div>'
  );
}
function acDetailHTML() {
  const x = UI.acDet;
  if (!x) return emptyState('🧑‍🤝‍🧑', tx('Select a co-assist'), tx('Pick one to see their profile, shift and access — or manage them.'));
  var _dt = typeof acTypeOf === 'function' ? acTypeOf(x) : 'human';
  var _dreg = (window.ACTOR_TYPES || {})[_dt] || {};
  if (_dreg.capability) {
    if (!(UI.acManageOpen && UI.acSel === x.id)) return _acTierSummary(x);
    var _mh = (window.ACTOR_MANAGE || {})[_dt];
    if (UI.acManageLoading || typeof _mh !== 'function') return _acTierLoader(x);
    return _mh(x);
  } // TWO-TIER: instant summary, management loads on drill
  const back = `<button data-cbsid="BUS005-B15" class="dback" onclick="backToList()">‹ Co-assists</button>`;
  /* ⚠️ `--ink` IS TEXT, NOT A SURFACE — same bug as the catalogue View/Edit segment. In dark it inverts to
     near-white and the selected segment becomes white-on-white (1.21:1). Selected = --accent + --on-accent. */
  const seg = (m, l) =>
    `<button data-cbsid="BUS005-B16" onclick="setAcMode('${m}')" style="border:0;background:${(UI.acMode === 'edit' ? 'edit' : 'view') === m ? 'var(--accent)' : 'var(--card)'};color:${(UI.acMode === 'edit' ? 'edit' : 'view') === m ? 'var(--on-accent)' : 'var(--grey)'};font-size:var(--fs-2);font-weight:700;padding:6px 15px">${l}</button>`;
  const toggle = `<div style="display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden;margin-top:10px">${seg('view', 'View')}${seg('edit', 'Edit')}</div>`;
  const head = `<div class="dh">${back}<div class="dt">${esc(x.name)} <span class="optchip ${acShc(x.shift)}">${acShLabel(x.shift)}</span></div><div class="ds">${esc(x.role || '—')} · <span class="mono">${acLogin(x)}</span></div>${toggle}</div>`;
  let body, bar;
  if (UI.acMode === 'edit') {
    body = `<div class="sec">${tx('Edit — co-assist profile')}</div>
      <label class="fl">${tx('Display name')}</label><input data-cbsid="BUS005-I03" class="inp" id="ac_ename" value="${esc(x.name)}">
      <label class="fl">${tx('Role')} <span style="color:var(--grey);font-weight:400;font-size:var(--fs-1)">— ${tx('a label; it grants nothing')}</span></label><input data-cbsid="BUS005-I04" class="inp" id="ac_erole" value="${esc(x.role || '')}" placeholder="e.g. Dispatch, Accounts">
      <label class="fl">Access <span style="color:var(--grey);font-weight:400;font-size:var(--fs-1)">— only an Editor can be assigned work</span></label>
      <select data-cbsid="BUS005-S03" class="inp" id="ac_ehat" style="max-width:320px">${ACCESS_CHOICES.map((item) => '<option value="' + item[0] + '"' + (accessLevelOf(x) === item[0] ? ' selected' : '') + '>' + esc(item[1]) + '</option>').join('')}</select>
      ${
        /* ⭐ REACH IS A SEPARATE SWITCH, NOT A LEVEL. Five hat names could never express "an editor who
            sees every branch" — there was no sixth name, and adding one is how five becomes eight.

            ⚠️⚠️ AND IT IS NOT ENFORCED YET, SO THE LABEL MUST NOT CLAIM IT IS. Nothing filters chits by
            placement node today — RLS scopes on entity_id alone, so EVERY co-assist already sees every
            chit in the business. There is no restriction for this flag to lift. It records the intent
            and is the right shape for when node-scoped reading arrives; until then it changes nothing,
            and "reach ignores their node" would sell an owner a control that does not act. IAM-SPEC §32.
            Same failure mode as self_copy_pref: declared, visible, inert. */ ''
      }
      <label class="fl" style="display:flex;align-items:center;gap:7px;cursor:pointer">
        <input data-cbsid="BUS005-I05" type="checkbox" id="ac_ewhole" ${x.whole_entity ? 'checked' : ''} style="width:auto;margin:0">
        <span>Sees the whole business <span style="color:var(--grey);font-weight:400;font-size:var(--fs-1)">— everyone does today; recorded for when branches are scoped</span></span>
      </label>
      <label class="fl">${tx('Leave-cover delegate (covers auto-assigned work while on leave)')}</label><select data-cbsid="BUS005-S04" class="inp" id="ac_edel" style="max-width:240px"><option value="">— none —</option>${(
        UI.acts || []
      )
        .filter((item) => item.id !== x.id && hatAssignable(item.hat))
        .map((item) => '<option value="' + esc(item.id) + '"' + (x.del === item.id ? ' selected' : '') + '>' + esc(item.name) + '</option>')
        .join('')}</select>
      <label class="fl">${tx('Max concurrent tasks')}</label><input data-cbsid="BUS005-I06" class="inp" id="ac_emax" inputmode="numeric" value="${x.max || ''}" style="width:120px">
      <label class="fl">${tx('Phone')}</label><input data-cbsid="BUS005-I07" class="inp" id="ac_ephone" value="${esc(x.phone || '')}" placeholder="optional">
      ${
        /* ⭐⭐ THE IDENTITY RECORD, FROM THE SHARED MODULE. Athi, 2026-08-20: *"we have to add as part of
            coassist registration and it has to be visible here… as a separate module to update." The very same
            block renders on the employee's own profile — one implementation, two audiences, because a second
            copy is a second place for the Aadhaar sentence to go missing.

            ⚠️ mode is 'owner' here: it names who filed each document and ASKS for consent, which self-service
            does not need because submitting your own IS consenting. */ ''
      }
      <div class="sec" style="margin-top:14px">${tx('Identity record')}</div>
      ${typeof CBIdDocs !== 'undefined' ? CBIdDocs.html(UI._idocsFor || [], 'owner', { subject: x.id }) : '<div class="misnote">' + tx('Loading…') + '</div>'}
      <div class="err" id="ac_ederr" style="margin-top:8px"></div>
      <div style="font-size:var(--fs-1);color:var(--warn-3);background:var(--gold-soft);border:1px solid var(--gold-line);border-radius:9px;padding:9px 11px;margin-top:10px;line-height:1.5"><b>${tx('Stage B')}</b> — profile edit needs <span class="mono">${tx('PATCH /api/actors/:id')}</span>  2014 23f3 pending on this server.</div>`;
    /* ⚠️ LATCHED PER SUBJECT, not a plain boolean — opening Ravi then Priya must refetch, and a single
       "already loaded" flag would show Ravi's record under Priya's name. That is the worst possible failure
       for this particular screen. */
    acLoadDocs(x.id);
    bar = `<button data-cbsid="CMP001" class="pri" onclick="saveActor('${x.id}')">${tx('Save')}</button><button data-cbsid="CMP003" onclick="setAcMode('view')">${tx('Cancel')}</button>`;
  } else {
    const pct = x.max ? Math.min(100, Math.round((x.load / x.max) * 100)) : 0;
    const kv = (l, v) =>
      `<div style="display:flex;gap:10px;padding:9px 13px;border-bottom:1px dashed var(--line);font-size:var(--fs-2);align-items:baseline"><b style="min-width:104px;color:var(--grey);font-weight:600;font-size:var(--fs-1);text-transform:uppercase;letter-spacing:.4px">${l}</b><span style="font-weight:600;flex:1">${v == null || v === '' ? '—' : v}</span></div>`;
    const hatV =
      '<span class="optchip" style="background:var(--blue-tint);color:var(--blue-d);border-color:var(--blue-tint-line)">' +
      hatLabel(x.hat) +
      '</span>' +
      (hatAssignable(x.hat) ? '' : ' <span style="font-size:var(--fs-1);color:var(--grey)">not assignable</span>');
    const coversFor = (UI.acts || []).filter((item) => item.del === x.id).map((item) => acLbl(item));
    const prof = `<div class="sec">${tx('Profile')}</div><div class="itab" style="border:1px solid var(--line);border-radius:12px;overflow:hidden">
      ${kv('Name', esc(x.name))}
      ${kv('Login', '<span class="mono">' + acLogin(x) + '</span>')}
      ${kv('Role', esc(x.role || ''))}
      ${kv('Type', acType(x.type))}
      ${kv('Hat', hatV)}
      ${kv('Max tasks', (x.max || '∞') + '')}
      ${kv('Last got task', x.lastAssigned ? acDate(x.lastAssigned) : '—')}
      ${kv('Phone', x.phone ? esc(x.phone) : '')}
      ${kv('Joined', acDate(x.created))}
      ${kv('Last active', acDate(x.last))}</div>`;
    const work = `<div class="sec">Shift &amp; load</div><div class="itab" style="padding:11px 12px">
      <div style="display:flex;align-items:center;gap:8px"><span class="optchip ${acShc(x.shift)}">${acShLabel(x.shift)}</span><span style="font-size:var(--fs-2);color:var(--grey)">${x.status === 'active' ? 'active' : esc(x.status)}</span></div>
      ${x.shift !== 'on_shift' && (x.breakSince || x.returnDate) ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:6px">' + (x.breakSince ? 'On break since ' + acDate(x.breakSince) : '') + (x.returnDate ? (x.breakSince ? ' · ' : '') + 'returns ' + acDate(x.returnDate) : '') + '</div>' : ''}
      <div style="font-size:var(--fs-2);margin-top:9px">Load · <b>${x.load}</b> / ${x.max || '∞'} tasks</div><div style="height:8px;background:var(--blue-tint-bg);border-radius:5px;overflow:hidden;margin-top:6px;color:var(--on-card)"><span style="display:block;height:100%;background:var(--blue);border-radius:5px;width:${pct}%;color:var(--on-accent)"></span></div></div>`;
    const eng = `<div class="sec">${tx('Access / engagement')}</div><div style="font-size:var(--fs-1);color:var(--warn-3);background:var(--gold-soft);border:1px solid var(--gold-line);border-radius:9px;padding:9px 11px;line-height:1.5">Per-co-assist engagement (view-only · act · audit · MIS) is <b>planned, not enforced yet</b> — today a co-assist acts within the entity's scope. Default-deny per node is the roadmap.</div>`;
    const coverName = x.del ? acLbl((UI.acts || []).find((item) => item.id === x.del)) : '';
    const coverSection =
      '<div class="sec">' +
      tx('Leave cover') +
      '</div><div class="itab" style="border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:10px">' +
      '<div style="padding:10px 13px;border-bottom:1px dashed var(--line)"><div style="font-size:var(--fs-1);color:var(--blue-d);text-transform:uppercase;letter-spacing:.4px;font-weight:700">' +
      tx('🛡 Covered by') +
      '</div><div style="font-size:var(--fs-2);margin-top:3px;line-height:1.45">' +
      (x.del
        ? '<b>' + coverName + '</b> takes over <b>' + esc(x.name) + '</b>&rsquo;s work when ' + esc(x.name) + ' is away.'
        : '<span style="color:var(--grey)">No cover set — nobody takes ' + esc(x.name) + '&rsquo;s work when away.</span>') +
      '</div></div>' +
      '<div style="padding:10px 13px"><div style="font-size:var(--fs-1);color:var(--ok-2);text-transform:uppercase;letter-spacing:.4px;font-weight:700">' +
      tx('🤝 Covers for') +
      '</div><div style="font-size:var(--fs-2);margin-top:3px;line-height:1.45">' +
      (coversFor.length
        ? '<b>' + esc(x.name) + '</b> takes over <b>' + coversFor.join(', ') + '</b>&rsquo;s work when they&rsquo;re away.'
        : '<span style="color:var(--grey)">' + esc(x.name) + ' isn&rsquo;t anyone&rsquo;s cover yet.</span>') +
      '</div></div>' +
      '</div>';
    const loginState = x.pinSet
      ? '<div class="sec">' +
        tx('Login') +
        '</div><div style="' +
        _CARD +
        ';background:var(--ok-tint);border-color:var(--ok-2);color:var(--on-card)"><div style="font-size:var(--fs-2);color:var(--ok-2);font-weight:600">✓ Active — PIN set. They sign in with their User ID + PIN.</div></div>'
      : /* SEC2: the list never carries the code (pin_state) — the card says one is waiting and where it went, never what it is */
        x.invite
        ? '<div class="sec">' +
          tx('Login — pending invite') +
          '</div><div style="' +
          _CARD +
          ';background:var(--blue-tint);border-color:var(--blue-tint-line);color:var(--on-card)"><div style="font-size:var(--fs-1);color:var(--blue-d);text-transform:uppercase;letter-spacing:.4px;font-weight:700">' +
          tx('User ID') +
          '</div><div class="mono" style="font-weight:700;font-size:var(--fs-2);word-break:break-all">' +
          esc(acLogin(x)) +
          '</div><div style="font-size:var(--fs-1);color:var(--blue-d);margin-top:6px">' +
          tx('A first code is waiting. It was sent to their e-mail. Lost it? Use Re-invite below.') +
          '</div></div>'
        : '<div class="sec">' +
          tx('Login — pending') +
          '</div><div style="' +
          _CARD +
          ';background:var(--warn-tint);border-color:var(--warn-3);color:var(--on-card)"><div style="font-size:var(--fs-2);color:var(--warn-3)">' +
          txf('No active one-time code and no PIN yet — use {reinvite} below to issue a code.', { reinvite: '<b>' + tx('Re-invite') + '</b>' }) +
          '</div></div>';
    /* ⭐ A CONNECTOR IS NOT A PERSON (Athi, 2026-09-06, the Tally kit's card: "type says human? hat says editor"). A kit or a device has
       no login to re-invite, nobody covers its leave, and it takes no tasks — what matters is WHAT it is, WHERE it runs and WHEN it last
       checked in. Same row, same rail, a different card. */
    const isConn = x.type === 'connector' || x.type === 'iot_device' || !!x.connector;
    if (isConn) {
      const c = x.cfg || {};
      const ago = x.lastSeen ? acDate(x.lastSeen) : '—';
      const stale = x.lastSeen && Date.now() - new Date(x.lastSeen).getTime() > 20 * 60 * 1000;
      const conn =
        '<div class="sec">' +
        tx('Connector') +
        '</div><div class="itab" style="padding:11px 12px">' +
        kv(tx('System'), esc(c.adapter || x.connector || '—') + (c.version ? ' <span style="color:var(--grey)">v' + esc(c.version) + '</span>' : '')) +
        kv(tx('Runs on'), esc(x.site || c.host || '—')) +
        kv(
          tx('Last seen'),
          '<span class="optchip ' +
            (stale ? '' : 'ok') +
            '" style="' +
            (stale ? 'color:var(--warn-2);background:var(--warn-tint)' : '') +
            '">' +
            esc(ago) +
            '</span>' +
            (stale ? ' <span style="font-size:var(--fs-1);color:var(--grey)">' + tx('not checking in — open the system and run start') + '</span>' : '')
        ) +
        kv(tx('Kit'), '<span class="mono">' + esc(c.kit_id || '—') + '</span>') +
        (c.counters
          ? kv(
              tx('Counters'),
              esc(
                Object.entries(c.counters)
                  .map(function (e) {
                    return e[0] + ' ' + e[1];
                  })
                  .join(' · ')
              )
            )
          : '') +
        '</div>';
      body = prof + conn + eng;
    } else {
      body = prof + coverSection + loginState + work + eng;
    }
    if (x.status === 'active') {
      bar =
        (x.type === 'human'
          ? x.pinSet
            ? `<button data-cbsid="BUS005-B17" onclick="acResetPin('${x.id}')" title="PIN forgotten or locked — clear it and issue a fresh code">${tx('🔑 Reset PIN')}</button>`
            : isConn
              ? ''
              : `<button data-cbsid="BUS005-B18" onclick="acReinvite('${x.id}')" title="No PIN set yet — re-issue their one-time code">${tx('✉️ Re-invite')}</button>`
          : '') +
        `<button data-cbsid="BUS005-B19" class="warn" onclick="acStatus('${x.id}','deactivate')" title="Suspend access — tasks return to the pool, reversible">${tx('🚫 Deactivate')}</button>`;
    } else {
      bar = `<button data-cbsid="BUS005-B20" class="pri" onclick="acStatus('${x.id}','reactivate')" title="Restore access and issue a fresh one-time code so they can sign in again.">${tx('↩ Reactivate')}</button><button data-cbsid="BUS005-B21" class="warn" onclick="acStatus('${x.id}','remove')" title="Permanently remove this co-assist. This cannot be undone.">${tx('🗑 Remove permanently')}</button>`;
    }
  }
  return `${head}<div class="db">${body}</div><div class="actbar">${bar}</div>`;
}
/* acShift removed (dead) — entity set-shift used the self-only /break route (400 for entity); actors self-manage shift. Entity set-shift = backlog. */
async function acReinvite(id) {
  const x = (UI.acts || []).find((item) => item.id === id) || {};
  try {
    const reply = await api('actorOtp', { params: { id } });
    const otp = (reply && (reply.otp || reply.dev_otp)) || '';
    const lf = (reply && reply.login_format) || acLogin(x);
    actorInviteModal('✉️ New code — ' + (x.name || 'co-assist'), x.name, lf, otp, reply);
  } catch (e) {
    toast(MSG.fail('re-invite', e));
  }
}
function acResetPin(id) {
  const x = (UI.acts || []).find((item) => item.id === id) || {};
  confirmAsk(
    'Reset PIN',
    'Reset <b>' + esc(x.name || 'this co-assist') + '</b>&rsquo;s PIN? A new one-time code is issued and they set a new PIN on next login.',
    'Reset PIN',
    async function () {
      try {
        const reply = await api('actorPinReset', { params: { id } });
        const otp = (reply && (reply.otp || reply.dev_otp)) || '';
        const lf = (reply && reply.login_format) || acLogin(x);
        actorInviteModal('🔑 PIN reset — ' + (x.name || 'co-assist'), x.name, lf, otp, reply);
      } catch (e) {
        toast(MSG.fail('reset the PIN', e));
      }
    }
  );
}
function acStatus(id, action) {
  const x = (UI.acts || []).find((item) => item.id === id);
  if (!x) return;
  const routed = x.load > 0 ? ' ' + txn('Their {count} active task returns to the pool.', 'Their {count} active tasks return to the pool.', x.load) : '';
  const run = async function () {
    const body = { action };
    if (x.load > 0) body.task_action = 'pool';
    if (action === 'remove') body.confirm = 'REMOVE';
    try {
      const reply = await api('actorStatus', { params: { id }, body });
      UI.acSel = null;
      UI.acDet = null;
      UI.mdetail = false;
      await loadCoassists();
      if (action === 'reactivate') {
        const otp = (reply && (reply.otp || reply.dev_otp)) || '';
        const lf = (reply && reply.login_format) || acLogin(x);
        actorInviteModal('↩ ' + (x.name || 'co-assist') + ' reactivated', x.name, lf, otp, reply);
      } else {
        const parts = [];
        if (reply && reply.tasks_routed > 0)
          parts.push(
            reply.tasks_routed +
              ' task' +
              (reply.tasks_routed > 1 ? 's' : '') +
              (body.task_action === 'actor' ? ' reassigned to a colleague' : ' returned to the pool')
          );
        if (reply && reply.had_cover) parts.push('own leave-cover cleared');
        if (reply && reply.covers_removed > 0)
          parts.push(
            txn('was leave-cover for {count} — that cover link removed', 'was leave-cover for {count} — those cover links removed', reply.covers_removed)
          );
        if (reply && reply.was_default_assignee) parts.push('was the default auto-assign assignee — cleared');
        if (reply && reply.disputes_cleared > 0)
          parts.push(reply.disputes_cleared + ' dispute hand-off' + (reply.disputes_cleared > 1 ? 's' : '') + ' cleared');
        actorCleanupModal(action, x.name, parts);
      }
    } catch (e) {
      toast(MSG.fail('update the co-assist', e));
    }
  };
  if (action === 'deactivate')
    confirmAsk(
      'Deactivate co-assist',
      txf('Deactivate <b>{name}</b>? They can no longer sign in until reactivated.', { name: esc(x.name) }) + esc(routed),
      'Deactivate',
      run,
      true
    );
  else if (action === 'remove')
    confirmAsk('Remove permanently', txf('Permanently remove <b>{name}</b>? This cannot be undone.', { name: esc(x.name) }) + esc(routed), 'Remove', run, true);
  else run();
}
async function saveActor(id) {
  const err = document.getElementById('ac_ederr');
  if (err) err.textContent = '';
  /**
   * ⚠️ ac_ehat NOW HOLDS A LEVEL, NOT A HAT — the id is unchanged so every other reference to it still works,
   * but the VALUE it carries changed with b173. Sending it as `hat` would have posted 'editor' into a column
   * whose CHECK allows only the old five, and the PATCH would 400 with a validation error nobody could read.
   *
   * ⚠️ `hat` IS SENT ALONGSIDE, mapped back, until b173 is run. The API prefers access_level; against a
   * pre-migration database the level column does not exist and only the hat lands. The window between deploy
   * and migration is always non-zero here, because migrations are run by hand.
   */
  const _lvl = val('ac_ehat') || undefined;
  const _hatCompat = _lvl ? { editor: 'act', commenter: 'audit', viewer: 'view_only' }[_lvl] || 'act' : undefined;
  const _whole = (function () {
    const el = document.getElementById('ac_ewhole');
    return el ? !!el.checked : undefined;
  })();
  const body = {
    display_name: val('ac_ename') || undefined,
    actor_role: val('ac_erole') || null,
    max_tasks: +val('ac_emax') || undefined,
    phone: val('ac_ephone') || null,
    access_level: _lvl,
    hat: _hatCompat,
    whole_entity: _whole
  };
  try {
    await api('actorEdit', { params: { id }, body });
    const x = (UI.acts || []).find((item) => item.id === id);
    const delEl = document.getElementById('ac_edel');
    if (delEl && delEl.value !== ((x && x.del) || '')) {
      await api('actorDelegate', { params: { id }, body: { delegate_actor_id: delEl.value || null } });
      if (x) x.del = delEl.value || null;
    }
    if (x) {
      if (body.display_name) x.name = body.display_name;
      x.role = body.actor_role;
      if (body.max_tasks) x.max = body.max_tasks;
      x.phone = body.phone;
      if (body.hat) x.hat = body.hat;
    }
    UI.acMode = 'view';
    // Action-state discipline: only this record's row + the detail change — the rest of the list is untouched (no reload).
    const node = document.querySelector('.row[data-ac="' + id + '"]');
    if (node && x) {
      node.outerHTML = acRowHTML(x);
    } else {
      paintAcList();
    }
    paintAcDetail();
    toast('Co-assist updated ✓');
    if (typeof announce === 'function') announce(((x && x.name) || 'Co-assist') + ' updated');
  } catch (e) {
    if (err) err.textContent = e.message;
  }
}
async function loadCoassists() {
  UI._acLoading = true;
  const node = document.getElementById('ac_rows');
  if (node) node.innerHTML = '<div class="loadwrap"><span class="spin"></span> loading…</div>';
  try {
    const actorRows = await api('actors', { query: { status: 'all' } });
    const actors = (Array.isArray(actorRows) ? actorRows : []).map(mapApiActor);
    UI.acts = actors;
    STORE.actors = actors;
    UI._acLoading = false;
    paintAcList(); // fetch ALL — client acFlt tabs categorize (active incl. on-break, inactive=deactivated/removed)
    if (UI.acSel && !UI.acts.some((item) => item.id === UI.acSel)) {
      UI.acSel = null;
      UI.acDet = null;
    }
    if (!UI.acSel && UI.acts.length && UI.vp !== 'mob') {
      const f = acVisible()[0];
      if (f) selectActor(f.id, true);
      else paintAcDetail();
    } else paintAcDetail();
    loadConnMap(); // annotate which co-assists are CONNECTORS (graceful; needs the connector capability + b57)
  } catch (e) {
    UI._acLoading = false;
    const element = document.getElementById('ac_rows');
    if (element) element.innerHTML = scrErr(e, 'co-assists', 'loadCoassists()');
  }
}
/* A connector is a non-human co-assist. Annotate the actor list with its connector type (iot/erp) by fetching the
   connector register. Graceful no-op if the capability is off or b57 isn't applied (so this never breaks the page). */
async function loadConnMap() {
  try {
    if (!((SESSION.capabilities || []).indexOf('connector') >= 0)) {
      UI._connMap = {};
      return;
    }
    if (typeof ensureCap === 'function') {
      await ensureCap('connector');
    } // registers the connectorList EP + selectConnector for Manage
    const reply = await api('connectorList');
    const map = {},
      info = {};
    ((reply && reply.connectors) || []).forEach(function (item) {
      map[item.identity_id] = item.connector_type;
      info[item.identity_id] = { type: item.connector_type, health: item.health, count: item.connection_count, last_seen: item.last_seen, site: item.site };
    });
    UI._connMap = map;
    UI._connInfo = info;
    paintAcList();
    if (UI.acDet) paintAcDetail();
  } catch (_) {
    UI._connMap = UI._connMap || {};
  } // b57 not applied / capability off -> simply don't annotate
}
// (removed dead: _connChip + manageConnector + connSec — connectors render via the two-tier registry path, not the human profile)
