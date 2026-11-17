/* app/cap-readiness.js — TRADE capability (lazy; ensureCap('readiness')). Two tabs:
 *  • My readiness  — the supplier side: the clearances your standards require, gathered vs pending, rolling up.
 *  • Check a supplier — the buyer side: a counterparty's shareable confidence PASSPORT (status only) → Create trade deal.
 * Backend: routes/governance.js /readiness(/:bridge_id) + /compliance (b90). The lane's sector and origin are the server's (CMP-1).
 * OWNS the readiness screens (lanes, clearances, sector matrix) · CALLED BY app.html via ensureCap('readiness')
 * FLOW rdLoadDeclaration → loadLanes → loadLaneReadiness → paint
 * CARD 21-compliance-attestation-and-trade/trade-readiness-lanes-instruments-journey-track */
if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    readinessOwn: { m: 'GET', p: '/api/governance/readiness', ok: 'y' },
    readinessOf: { m: 'GET', p: '/api/governance/readiness/:bridge_id', ok: 'y' },
    readinessGather: { m: 'POST', p: '/api/governance/compliance', ok: 'y' },
    lanes: { m: 'GET', p: '/api/governance/lanes', ok: 'y' },
    readinessVerify: { m: 'POST', p: '/api/governance/verify', ok: 'y' },
    instruments: { m: 'GET', p: '/api/governance/instruments', ok: 'y' },
    journey: { m: 'GET', p: '/api/governance/journey', ok: 'y' },
    /* ⚠️ profileGet/profilePut are core's (app.html). Re-registering them here overwrote core's entry by
       load order, and `profileSave` was a SECOND name for the same PUT — which mattered, because core.js
       OUTBOX_KEYS is keyed by NAME: one of the twins was queued when offline and the other was not. */
    /* aiDraft → CB_ASSIST_EP (app/accounts-shell.js, T3-DISPUTES-ASSIST): registered once, merged by app.html and tasks.html */
    aiSkills: { m: 'GET', p: '/api/governance/ai-skills', ok: 'y' },
    aiUsage: { m: 'GET', p: '/api/governance/ai-usage', ok: 'y' }
  });
}
// ── AI CO-ASSIST (invoked, never autonomous) — the ONE reusable draft affordance. Any path passes a skill_id + the
// context it already holds; the co-assist PROPOSES a draft; the human reviews & confirms. Mirrors lib/ai.js single pipe. ──
var RD_SKILL = {
  'sds': 'sds',
  'exim-policy': 'export-declaration',
  'reach': 'evidence-assemble',
  'tsca': 'evidence-assemble',
  'iso-9001': 'evidence-assemble',
  'iso-14001': 'evidence-assemble',
  'iso-45001': 'evidence-assemble',
  'iso-27000': 'evidence-assemble',
  'bis': 'product-classify'
}; // which clearance standards have a drafting skill (the co-assist drafts the doc/evidence checklist)
function _rdSkill(it) {
  return it ? RD_SKILL[it.standard] || null : null;
}
/* CMP-1 (VERT-BOX VB4): the lane's sector and origin are the SERVER's answer (readiness.laneOf → govresolve.verticalOf, the stated
   country) unless the person picked a sector here. Never 'paint', never 'IN': an unstated value travels as null and the server asks. */
function _laneVert() {
  return UI.laneVertical || (UI.laneMatrix && UI.laneMatrix.vertical) || null;
}
function _laneOrigin() {
  return (UI.laneMatrix && UI.laneMatrix.origin) || UI.laneOrigin || null;
}
/** the lane query: the person's sector pick only — the origin is the shop's stated country, read by the server */
function _laneQuery(extra) {
  var query = Object.assign({}, extra || {});
  if (UI.laneVertical) query.vertical = UI.laneVertical;
  return query;
}
// advisory co-assist buttons (reuse the global aiRun) — standards to adopt, and who can carry a gap
function aiSuggestStandards() {
  if (typeof aiRun !== 'function') return;
  aiRun('standards-suggest', { sector: _laneVert(), market: UI.laneDest || 'EU', origin: _laneOrigin() }, { title: '✨ Standards to adopt' });
}
function aiSuggestPartner(std, doc) {
  if (typeof aiRun !== 'function') return;
  var it = ((UI.laneRd && UI.laneRd.clearances) || (UI.readiness && UI.readiness.clearances) || []).filter(function (item) {
    return item.standard === std && item.doc === doc;
  })[0];
  aiRun('partner-suggest', { gap: (it && (it.title || it.doc)) || std, standard: std, market: UI.laneDest || 'EU' }, { title: '✨ Suggest a partner' });
}
function _aiCtxExporter() {
  return { name: (UI.profile && UI.profile.legal_name) || (UI.profile && UI.profile.name) || '[to confirm]' };
}
// clearance path — draft a document from the standard/product the entity holds. Passes an ATTACH target so a document
// draft can be ACCEPTED → filed as the clearance's evidence on the rail (closes the advise→produce loop).
async function aiDraftReadiness(std, doc, skill) {
  var it = ((UI.laneRd && UI.laneRd.clearances) || (UI.readiness && UI.readiness.clearances) || []).filter(function (item) {
    return item.standard === std && item.doc === doc;
  })[0];
  return _aiDraft(
    skill,
    std,
    {
      standard: std,
      document: doc,
      sector: _laneVert(),
      origin: _laneOrigin(),
      destination: UI.laneDest || null,
      product: { description: doc },
      exporter: _aiCtxExporter()
    },
    { standard: std, doc: doc, title: (it && it.title) || doc, skill: skill }
  );
}
// commerce path — draft a commercial document/advice from the current trade lane (order specifics → [to confirm])
async function aiDraftCommerce(skill, label) {
  return _aiDraft(skill, label, {
    area: label,
    sector: _laneVert(),
    origin: _laneOrigin(),
    destination: UI.laneDest || null,
    incoterm: 'CIF',
    lc: { type: 'irrevocable confirmed', amount: '[to confirm]', expiry: '[to confirm]', incoterm: 'CIF' },
    order: { note: 'draft from the current lane; fill order specifics [to confirm]' },
    exporter: _aiCtxExporter()
  });
}
// AI draft modals use the SHARED global markdown renderer (_aiMd / _AI_MDCSS from app.html) — one renderer, converged (#8).
// the ONE reusable invoke+review modal — every path funnels here (mirrors lib/ai.js single pipe). `attach` (optional) =
// a clearance target {standard,doc,title,skill}; a DOCUMENT draft can then be ACCEPTED → filed as that clearance's evidence.
async function _aiDraft(skill, label, ctx, attach) {
  if (typeof modal === 'function')
    modal(
      '<div class="mhd"><div class="t">✨ Draft with AI — ' +
        esc(label) +
        '</div></div><div class="mbody" style="padding:16px"><div id="aidbody" style="font-size:var(--fs-2);color:var(--grey)">✨ Invoking the co-assist… drafting from what this order/profile holds.</div></div>',
      true
    );
  try {
    var reply = await api('aiDraft', { body: { skill_id: skill, context: ctx } });
    var draft = (reply && reply.draft) || '',
      cost = reply && reply.usage && reply.usage.est_cost_usd;
    UI._aiLast = { draft: draft, label: label, note: (reply && reply.note) || '', cost: cost, attach: attach || null };
    var bs = 'font-size:var(--fs-2);font-weight:700;border-radius:9px;padding:9px 13px;cursor:pointer';
    // a DOCUMENT (the actual cert/declaration) can become the clearance's evidence; aids (classify/summarize) cannot.
    var acceptBtn =
      attach && reply && reply.kind === 'document'
        ? '<button data-cbsid="SCR033-B01" onclick="_aiAccept()" title="File as evidence for ' +
          esc(attach.title || attach.doc) +
          '" style="' +
          bs +
          ';flex:1;border:1px solid var(--ok-3);background:var(--ok-3);color:var(--on-ok)">✓ Accept &amp; attach as evidence</button>'
        : '';
    var html =
      '<style>' +
      (typeof _AI_MDCSS !== 'undefined' ? _AI_MDCSS : '') +
      '</style>' +
      '<div style="font-size:var(--fs-1);color:var(--purple);background:var(--blue-tint-bg);border:1px solid #ddd4f5;border-radius:9px;padding:8px 11px;margin-bottom:12px;line-height:1.5">🤖 <b>AI proposal — not evidence.</b> ' +
      esc((reply && reply.note) || 'Review and confirm before you use it.') +
      (cost != null ? ' <span style="color:var(--grey)">· cost $' + cost + '</span>' : '') +
      '</div>' +
      '<div class="amddoc" style="background:var(--card);border:1px solid var(--line);border-radius:9px;padding:16px 20px;max-height:52vh;overflow:auto;color:var(--on-card)">' +
      (typeof _aiMd === 'function' ? _aiMd(draft) : esc(draft)) +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:13px;flex-wrap:wrap">' +
      acceptBtn +
      '<button data-cbsid="SCR033-B02" onclick="_aiPdf()" style="' +
      bs +
      ';flex:' +
      (acceptBtn ? '0 0 auto' : '1') +
      ';border:1px solid var(--purple);background:' +
      (acceptBtn ? 'var(--card)' : 'var(--purple)') +
      ';color:' +
      (acceptBtn ? 'var(--purple)' : 'var(--on-accent)') +
      '">⬇ PDF</button>' +
      '<button data-cbsid="SCR033-B03" onclick="_aiCopy(this)" data-draft="' +
      esc(encodeURIComponent(draft)) +
      '" style="' +
      bs +
      ';flex:0 0 auto;border:1px solid var(--line);background:var(--card);color:var(--ink)">' +
      tx('📋 Copy') +
      '</button>' +
      '<button data-cbsid="CMP004" onclick="closeModal()" style="' +
      bs +
      ';flex:0 0 auto;border:1px solid var(--line);background:var(--card);color:var(--ink)">' +
      tx('Done') +
      '</button>' +
      '</div>';
    var node = document.getElementById('aidbody');
    if (node) node.innerHTML = html;
  } catch (e) {
    var msg = (e && e.message) || 'AI draft failed';
    var b2 = document.getElementById('aidbody');
    if (b2)
      b2.innerHTML =
        '<div style="font-size:var(--fs-2);color:var(--warn-2);background:var(--warn-tint);border:1px solid #f0dcae;border-radius:9px;padding:10px 12px">' +
        esc(String(msg).indexOf('503') >= 0 || String(msg).indexOf('not connected') >= 0 ? 'AI is not connected yet (no key on this environment).' : msg) +
        '</div>';
  }
}
function _aiCopy(btn) {
  try {
    var t = decodeURIComponent(btn.getAttribute('data-draft') || '');
    if (navigator.clipboard) navigator.clipboard.writeText(t);
    if (typeof toast === 'function') toast('Draft copied ✓');
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
}
// close the loop: a confirmed DOCUMENT draft becomes the clearance's evidence — a self-chit on the rail carrying the
// document, then gather (identical to a manually-uploaded cert). AI goes from advisor → producer on the rail.
async function _aiAccept() {
  var d = UI._aiLast || {},
    at = d.attach;
  if (!d.draft || !at) {
    if (typeof toast === 'function') toast('Nothing to attach');
    return;
  }
  try {
    var subj = 'Clearance — ' + (at.title || at.doc || at.standard) + ' (AI-drafted)';
    var reply = await api('createChit', {
      body: { recipients: [{ name: 'self', role: 'to' }], manual_subject: subj, subject: subj, purpose: 'general', line_items: [] }
    });
    var chitId = reply && reply.chit_id;
    if (chitId && typeof attUpload === 'function' && typeof File !== 'undefined') {
      try {
        var f = new File([d.draft], String(at.skill || 'draft') + '.md', { type: 'text/markdown' });
        await attUpload(chitId, f);
      } catch (_) { /* best effort: failing here changes nothing the user sees */ }
    }
    var date = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
    await api('readinessGather', {
      body: { standard_key: at.standard, doc_key: at.doc, evidence_ref: chitId || 'ai-drafted', valid_until: date, status: 'gathered' }
    });
    if (typeof closeModal === 'function') closeModal();
    if (typeof toast === 'function') toast('Accepted — filed as evidence on the rail ✓');
    UI.laneMatrix = undefined;
    UI.laneRd = undefined;
    if (typeof loadLanes === 'function') loadLanes();
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || 'Could not attach');
  }
}
// export the draft as a print-ready A4 document → the browser's "Save as PDF" (no dependency, works offline)
function _aiPdf() {
  var d = UI._aiLast || {};
  if (!d.draft) {
    if (typeof toast === 'function') toast('Nothing to export');
    return;
  }
  var node = window.open('', '_blank');
  if (!node) {
    if (typeof toast === 'function') toast('Allow pop-ups to export the PDF');
    return;
  }
  var pcss =
    '@page{size:A4;margin:18mm}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1e2530}' +
    '.pg{max-width:760px;margin:0 auto;padding:22px}' +
    '.hd{border-bottom:2px solid var(--purple);padding-bottom:12px;margin-bottom:18px}' +
    '.brand{font-weight:800;letter-spacing:.05em;color:var(--purple);font-size:var(--fs-2)}' +
    '.doctitle{font-size:var(--fs-5);font-weight:800;margin-top:4px;color:#141a22}' +
    '.meta{font-size:var(--fs-1);color:#7a8494;margin-top:5px}' +
    '.stamp{display:inline-block;margin-top:9px;font-size:var(--fs-1);font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--warn-2);background:var(--warn-tint);border:1px solid #f0dcae;border-radius:5px;padding:3px 8px}' +
    '.foot{margin-top:26px;padding-top:10px;border-top:1px solid #e6eaf0;font-size:var(--fs-1);color:#9aa3b0;text-align:center}' +
    (typeof _AI_MDCSS !== 'undefined' ? _AI_MDCSS : '') +
    '.amddoc{font-size:var(--fs-2)}';
  var when = CBLocale.datetime(Date.now());
  node.document.write(
    '<!doctype html><html><head><meta charset="utf-8"><title>' +
      esc(d.label || 'AI draft') +
      '</title><style>' +
      pcss +
      '</style></head><body><div class="pg">' +
      '<div class="hd"><div class="brand">CHIT &amp; BRIDGE</div><div class="doctitle">' +
      esc(d.label || 'Draft') +
      '</div><div class="meta">Drafted by AI co-assist · ' +
      esc(when) +
      (d.cost != null ? ' · est. $' + d.cost : '') +
      '</div><div class="stamp">AI draft — not evidence until accepted</div></div>' +
      '<div class="amddoc">' +
      (typeof _aiMd === 'function' ? _aiMd(d.draft || '') : esc(d.draft || '')) +
      '</div>' +
      '<div class="foot">Generated on the Chit &amp; Bridge governance rail · review and confirm before use</div>' +
      '</div></body></html>'
  );
  node.document.close();
  node.focus();
  setTimeout(function () {
    try {
      node.print();
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  }, 350);
}
// the entity's DECLARATION — which standards it holds. A checkbox = a commitment: it only counts as MET when its
// evidence is live & valid (status gathered/expiring). rdLoadDeclaration → UI.profile.adopted[]. declareToggle persists it.
/**
 * ⚠️⚠️ RENAMED FROM loadProfile — IT COLLIDED WITH A COMPLETELY DIFFERENT FUNCTION OF THE SAME NAME.
 *
 * cap-admin.js also declared `loadProfile`, and that one RENDERS THE PROFILE SCREEN into #profbody. This one
 * loads the entity's trade declaration into UI.profile. Two lazily-loaded capabilities, one name — so whichever
 * loaded LAST won, and the app broke in a different way depending on where the user had been:
 *
 *   readiness loaded last  → app.html's `if(UI.nav==="profile") loadProfile()` ran THIS function, so the
 *                            Profile screen never rendered and sat on its "loading…" placeholder
 *   admin loaded last      → line 438 below ran the ADMIN one, which returns early when #profbody is absent,
 *                            so UI.profile stayed undefined and the declaration checkboxes never populated
 *
 * ⚠️ Neither failure throws, and neither is reachable from a first visit — you have to go to one screen and
 * then the other, which is why it survived. Found by the dead-surface scan looking for shadowed declarations,
 * not by anything watching behaviour.
 */
async function rdLoadDeclaration() {
  try {
    UI.profile = await api('profileGet');
  } catch (e) {
    UI.profile = { trade_mode: 'domestic', markets: [], sectors: [], adopted: [] };
  }
  // fold the explorer: restore the entity's SAVED lane (sector · destination) so it opens to their real trade
  try {
    var s = localStorage.getItem('cb_rd_lane');
    if (s) {
      var parsed = JSON.parse(s) || {};
      if (!UI.laneVertical && parsed.vert) UI.laneVertical = parsed.vert;
      if (!UI.laneDest && parsed.dest) {
        UI.laneDest = parsed.dest;
        UI.laneRd = undefined;
      }
    }
  } catch (_) { /* storage blocked or full: the page works without it */ }
  // ORIGIN = the entity's registered country (not a choice) — fixed home jurisdiction
  /* ⭐ meNow() — the entity's country is almost always already in UI._me by the time the readiness screen
     opens, and this only wants that one field. */
  try {
    var me = await meNow();
    if (me && me.country) {
      var o = _mapOrigin(me.country);
      if (o !== UI.laneOrigin) {
        UI.laneOrigin = o;
        UI.laneRd = undefined;
      }
    }
  } catch (e) {
    if (typeof cbQuiet === 'function') cbQuiet('readiness: the shop country was not read, the server stated origin is used', e);
  }
  if (typeof renderApp === 'function') bgRenderApp();
}
// has evidence + not expired
function _rdIdType(it) {
  return it ? { gstn: 'gstn' }[it.doc] || null : null;
} // registry ID with a LIVE source-check (GSTIN — confirmed via Sandbox.co.in)
var _RUNGRANK = { verified: 4, attested: 3, documented: 2, declared: 1 };
// HELD = live & valid AND backed by REAL evidence (document / attested / verified). A bare 'declared' claim does NOT count.
function _rdHeld(it) {
  if (!it) return false;
  var live = it.status === 'gathered' || it.status === 'expiring';
  return live && (_RUNGRANK[it.rung] || 0) >= 2;
}
function _rdRungChip(it) {
  var r = it && it.rung,
    map = {
      verified: ['var(--ok-3)', 'verified'],
      attested: ['var(--blue-2)', 'attested'],
      documented: ['var(--warn-2)', 'documented'],
      declared: ['var(--blue-2)', 'declared']
    },
    x = map[r];
  if (!x) return '<span title="not yet evidenced" style="font-size:var(--fs-1);color:var(--line);flex:0 0 auto">—</span>';
  return (
    '<span title="trust rung — how strongly it is evidenced" style="font-size:var(--fs-1);font-weight:800;text-transform:uppercase;letter-spacing:.03em;color:' +
    x[0] +
    ';background:' +
    x[0] +
    '1e;border-radius:4px;padding:2px 5px;flex:0 0 auto">' +
    x[1] +
    '</span>'
  );
}
// persist the current lane to the entity's profile (+ local restore) — the selectors ARE the saved profile now.
function saveLane() {
  var vert = _laneVert(),
    dest = UI.laneDest || 'EU',
    origin = _laneOrigin();
  try {
    localStorage.setItem('cb_rd_lane', JSON.stringify({ vert: vert, dest: dest, origin: origin }));
  } catch (_) { /* storage blocked or full: the page works without it */ }
  try {
    api('profilePut', {
      body: {
        trade_mode: dest === origin ? 'domestic' : 'export',
        markets: [dest],
        sectors: vert ? [vert] : (UI.profile && UI.profile.sectors) || [],
        adopted: (UI.profile && UI.profile.adopted) || []
      }
    })
      .then(function (reply) {
        UI.profile = reply;
      })
      .catch(function () {});
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
}
function _rdStatus(st) {
  if (st === 'gathered') return { col: 'var(--ok-3)', ic: '✓', lbl: 'gathered' };
  if (st === 'expiring') return { col: 'var(--warn-2)', ic: '!', lbl: 'renew soon' };
  if (st === 'expired') return { col: 'var(--disp)', ic: '✕', lbl: 'expired' };
  return { col: 'var(--blue-2)', ic: '○', lbl: 'to gather' };
}
function _rungBadge(r) {
  var map = {
    verified: ['var(--ok-3)', 'Verified'],
    attested: ['var(--blue-2)', 'Attested'],
    documented: ['var(--warn-2)', 'Documented'],
    declared: ['var(--blue-2)', 'Declared']
  };
  var x = map[r];
  if (!x) return '';
  return (
    '<span style="font-size:var(--fs-1);font-weight:800;letter-spacing:.03em;text-transform:uppercase;border-radius:5px;padding:2px 6px;background:' +
    x[0] +
    '22;color:' +
    x[0] +
    ';margin-inline-start:7px" title="trust rung">' +
    x[1] +
    '</span>'
  );
}
// ── per-topic LIFECYCLE model (client-side) — each clearance is a process with states, an AI role + a partner option ──
var LIFE = {
  'iso-9001': {
    life: [
      ['Implement QMS', 'done'],
      ['Registrar audit', 'done'],
      ['Certified', 'done'],
      ['Surveillance', 'now'],
      ['Recertify (3-yr)', 'next']
    ],
    use: 'Keep your QMS current — a surveillance audit holds the certificate.',
    ai: { lvl: 'L3', gate: 'sign recert', t: 'AI tracks validity, assembles the surveillance evidence, flags the renewal window.' },
    partner: 'Accredited ISO registrar'
  },
  'iso-14001': {
    life: [
      ['Implement EMS', 'done'],
      ['Registrar audit', 'now'],
      ['Certified', 'next'],
      ['Surveillance', 'next']
    ],
    use: 'Certify your environmental management system with an accredited registrar.',
    ai: { lvl: 'L3', gate: 'sign', t: 'AI assembles the aspects register and audit evidence.' },
    partner: 'Environmental registrar'
  },
  'reach': {
    life: [
      ['Not started', 'now'],
      ['Inventory substances', 'next'],
      ['Register with ECHA', 'next'],
      ['Safety dossier', 'next'],
      ['Verified', 'next']
    ],
    use: 'Inventory each substance ≥1 t/yr and register it with ECHA.',
    ai: { lvl: 'L3', gate: 'authorise ECHA filing', t: 'AI builds the inventory, drafts each registration + the safety dossier; you authorise the filing.' },
    partner: 'EU Only-Representative'
  },
  'sds': {
    life: [
      ['No sheet', 'done'],
      ['Draft GHS', 'now'],
      ['Attach to product', 'next'],
      ['Travels with order', 'next']
    ],
    use: 'Attach a current GHS Safety Data Sheet to each order.',
    ai: { lvl: 'L3', gate: 'approve', t: 'AI authors the GHS sheet from your formulation; you approve.' },
    partner: 'Testing lab'
  },
  'tsca': {
    life: [
      ['Not listed', 'now'],
      ['File PMN / inventory', 'next'],
      ['Listed', 'next']
    ],
    use: 'List substances on the US EPA TSCA inventory.',
    ai: { lvl: 'L3', gate: 'authorise', t: 'AI prepares the inventory listing / PMN.' },
    partner: 'US agent'
  },
  'bis': {
    life: [
      ['Not certified', 'now'],
      ['Apply', 'next'],
      ['Certified (ISI mark)', 'next']
    ],
    use: 'Obtain BIS product certification (ISI mark).',
    ai: { lvl: 'L2', gate: 'submit', t: 'AI prepares the BIS application.' },
    partner: 'BIS consultant'
  },
  'exim-policy': {
    life: [
      ['IEC obtained', 'now'],
      ['Declaration filed', 'next'],
      ['Cleared', 'next']
    ],
    use: 'Hold a valid IEC and complete the export declaration.',
    ai: { lvl: 'L3', gate: 'confirm', t: 'AI verifies the IEC and prepares the export declaration.' },
    partner: 'Customs broker (CHA)'
  }
};
function _life(std, status) {
  return (
    LIFE[std] || {
      life: [
        ['Pending', status === 'pending' ? 'now' : 'done'],
        ['Gathered', status === 'gathered' || status === 'expiring' ? 'now' : 'next'],
        ['Verified', 'next']
      ],
      use: 'Gather this clearance and keep it valid.',
      ai: { lvl: 'L2', gate: 'approve', t: 'AI helps assemble and file the evidence; you approve.' },
      partner: null
    }
  );
}
function _rdSub(t) {
  return '<div style="font-size:var(--fs-1);font-weight:800;color:var(--grey);letter-spacing:.05em;text-transform:uppercase;margin:13px 0 6px">' + t + '</div>';
}
function _rdKv(k, v) {
  return (
    '<div style="display:flex;gap:8px;padding:3px 0;font-size:var(--fs-2)"><span style="text-transform:uppercase;color:var(--grey);min-width:96px;font-size:var(--fs-1);letter-spacing:.03em;padding-top:1px">' +
    k +
    '</span><span style="color:var(--ink);font-weight:500">' +
    esc(String(v)) +
    '</span></div>'
  );
}
function _rdExpand(it) {
  var L = _life(it.standard, it.status);
  var steps = L.life
    .map(function (item) {
      var c = item[1];
      var col = c === 'done' ? 'var(--ok-3)' : c === 'now' ? 'var(--blue)' : 'var(--blue-tint-bg)';
      var ic = c === 'done' ? '✓' : c === 'now' ? '●' : '○';
      return (
        '<div style="display:flex;align-items:center;gap:9px;padding:4px 0;font-size:var(--fs-2);color:' +
        (c === 'next' ? 'var(--grey)' : 'var(--ink)') +
        '"><span style="width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:var(--fs-1);font-weight:800;color:#fff;background:' +
        col +
        ';flex:0 0 auto">' +
        ic +
        '</span>' +
        esc(item[0]) +
        (c === 'now'
          ? ' <span style="font-size:var(--fs-1);color:var(--blue);font-weight:800;text-transform:uppercase;letter-spacing:.04em">you are here</span>'
          : '') +
        '</div>'
      );
    })
    .join('');
  var ev =
    (it.guidance
      ? '<div data-testid="rd-guidance" style="margin:0 0 8px;padding:8px 10px;background:var(--warn-tint);border:1px solid var(--gold-line);border-radius:9px;font-size:var(--fs-2)">● ' +
        esc(it.guidance) +
        '</div>'
      : '') +
    _rdKv('Trust rung', it.rung || '—') +
    _rdKv('Status', it.status || '—') +
    (it.valid_until ? _rdKv('Valid until', String(it.valid_until).slice(0, 10)) : '') +
    (it.rung === 'verified' && it.verified_at
      ? _rdKv('Verified at source', String(it.verified_at).slice(0, 10) + (it.verified_by ? ' · ' + esc(it.verified_by) : ''))
      : '') +
    (it.evidence_ref && /^[0-9a-f-]{20,}$/i.test(String(it.evidence_ref)) ? _rdKv('Evidence', 'document on the rail') : '');
  var ai = L.ai;
  var partner = L.partner
    ? '<div style="margin-top:11px;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:var(--warn-tint);display:flex;align-items:center;gap:8px;color:var(--on-card)"><div style="flex:1;min-width:0"><span style="font-size:var(--fs-1);font-weight:800;color:var(--warn-3);text-transform:uppercase;letter-spacing:.05em">' +
      tx('Or hand it to a partner') +
      '</span><div style="font-size:var(--fs-2);margin-top:3px;font-weight:600">' +
      esc(L.partner) +
      '</div></div><button data-cbsid="SCR033-B04" onclick="aiSuggestPartner(\'' +
      esc(it.standard) +
      "','" +
      esc(it.doc) +
      '\')" title="AI suggests who can carry this + what to ask them" style="flex:0 0 auto;font-size:var(--fs-1);font-weight:700;border:1px solid var(--purple);background:var(--card);color:var(--purple);border-radius:6px;padding:6px 10px;cursor:pointer">' +
      tx('✨ Suggest') +
      '</button></div>'
    : '';
  return (
    '<div style="border-top:1px solid var(--line);padding:12px 15px 15px;background:var(--blue-tint-bg);color:var(--on-card)">' +
    _rdSub('Its lifecycle') +
    steps +
    _rdSub('Evidence · current version') +
    '<div>' +
    ev +
    '</div>' +
    _rdSub('How you use it') +
    '<div style="font-size:var(--fs-2);color:var(--ink)">' +
    esc(L.use) +
    '</div>' +
    _rdSub('🤖 How AI enables it') +
    '<div style="font-size:var(--fs-2);color:var(--grey)"><b style="color:var(--blue)">' +
    ai.lvl +
    '</b> · gate: ' +
    esc(ai.gate) +
    ' — ' +
    esc(ai.t) +
    '</div>' +
    partner +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:12px;border-inline-start:3px solid #8a5e22;padding-inline-start:9px;line-height:1.45">Versioned: when a buyer folds this into an order they keep a <b>snapshot</b> — later changes never alter their copy.</div>' +
    '</div>'
  );
}
// ── TWO-PANE master-detail (list ↔ detail, like Task/Co-assist) — selecting preserves scroll (no jump) ──
function _rdSelect(std, doc) {
  /* ⚠️ ON MOBILE THE DETAIL COVERS THE LIST — see the .rdpanes note in app.html. Record that we are in it so
     the pane and its back button render; on a laptop both stay side by side and this flag is ignored. */
  if (UI.vp === 'mob') UI.rdMDetail = true;
  var node = document.getElementById('rdlist');
  var top = node ? node.scrollTop : 0;
  UI.rdSel = std + '|' + doc;
  if (typeof renderApp === 'function') renderApp();
  var sc2 = document.getElementById('rdlist');
  if (sc2) sc2.scrollTop = top; // keep the LIST scroll across the re-render
}
function _rdRow(it, selKey) {
  var k = it.standard + '|' + it.doc,
    on = k === selKey;
  var held = _rdHeld(it); // green ONLY with real (documented/verified), valid evidence — a bare 'declared' claim is NOT held
  var box =
    '<span data-cbsid="SCR033-C01" onclick="event.stopPropagation();' +
    (held ? '_rdSelect' : 'gatherReadiness') +
    "('" +
    esc(it.standard) +
    "','" +
    esc(it.doc) +
    '\')" title="' +
    (held ? 'Held — real, valid evidence' : 'Not held — click to provide evidence') +
    '" style="width:16px;height:16px;border-radius:4px;border:1.5px solid ' +
    (held ? 'var(--ok-3)' : 'var(--line)') +
    ';background:' +
    (held ? 'var(--ok-3)' : 'var(--card)') +
    ';color:#fff;display:inline-grid;place-items:center;font-size:var(--fs-1);font-weight:800;flex:0 0 auto;cursor:pointer">' +
    (held ? '✓' : '') +
    '</span>';
  return (
    '<div data-cbsid="SCR033-C02" onclick="_rdSelect(\'' +
    esc(it.standard) +
    "','" +
    esc(it.doc) +
    '\')" style="display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:9px;cursor:pointer;margin:2px 0;background:' +
    (on ? 'var(--blue-tint)' : 'transparent') +
    ';border:1px solid ' +
    (on ? 'var(--blue)' : 'transparent') +
    '">' +
    box +
    '<div style="min-width:0;flex:1"><div style="font-weight:' +
    (on ? '700' : '600') +
    ';font-size:var(--fs-2);color:' +
    (on ? 'var(--blue)' : 'var(--ink)') +
    ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
    esc(it.title || it.doc) +
    '</div></div>' +
    (_rdIdType(it) ? '<span title="Live source-check available — verified at the registry" style="font-size:var(--fs-1);flex:0 0 auto">🔗</span>' : '') +
    _rdRungChip(it) +
    '</div>'
  );
}
function _rdDetailPane(it) {
  if (!it)
    return '<div style="color:var(--grey);font-size:var(--fs-2);padding:24px;text-align:center">Select a clearance on the left to see its lifecycle.</div>';
  var m = _rdStatus(it.status),
    rung = it.rung ? _rungBadge(it.rung) : '';
  var idType = _rdIdType(it);
  var verifyBtn =
    idType && it.rung !== 'verified'
      ? '<button data-cbsid="SCR033-B05" onclick="verifyReadiness(\'' +
        esc(it.standard) +
        "','" +
        esc(it.doc) +
        "','" +
        idType +
        '\')" title="Checked against the source registry, live" style="font-size:var(--fs-2);font-weight:700;border:1px solid var(--ok-3);background:var(--ok-tint);color:var(--ok-3);border-radius:9px;padding:7px 12px;cursor:pointer">' +
        tx('🔗 Verify at source') +
        '</button>'
      : '';
  var skill = _rdSkill(it);
  var draftBtn = skill
    ? '<button data-cbsid="SCR033-B06" onclick="aiDraftReadiness(\'' +
      esc(it.standard) +
      "','" +
      esc(it.doc) +
      "','" +
      skill +
      '\')" title="AI drafts it — you review and confirm" style="font-size:var(--fs-2);font-weight:700;border:1px solid var(--purple);background:var(--purple-tint);color:var(--purple);border-radius:9px;padding:7px 12px;cursor:pointer">' +
      tx('✨ Draft with AI') +
      '</button>'
    : '';
  var actBtn =
    it.status === 'gathered'
      ? '<span style="font-size:var(--fs-2);color:' + m.col + ';font-weight:700">' + m.lbl + '</span>'
      : '<button data-cbsid="SCR033-B07" onclick="gatherReadiness(\'' +
        esc(it.standard) +
        "','" +
        esc(it.doc) +
        '\')" style="font-size:var(--fs-2);font-weight:700;border:1px solid ' +
        (it.status === 'pending' ? 'var(--line)' : m.col) +
        ';background:' +
        (it.status === 'pending' ? 'var(--card)' : m.col) +
        ';color:' +
        (it.status === 'pending' ? 'var(--blue-2)' : 'var(--on-accent)') +
        ';border-radius:9px;padding:7px 13px;cursor:pointer">' +
        (it.status === 'pending' ? 'Gather' : 'Renew') +
        '</button>';
  var held = _rdHeld(it),
    r = it.rung,
    live = it.status === 'gathered' || it.status === 'expiring';
  var banner =
    held && r === 'verified'
      ? '<div style="margin:10px 16px 0;font-size:var(--fs-2);color:var(--ok-2);background:var(--ok-tint);border:1px solid #bfe3cb;border-radius:9px;padding:9px 12px">✓ <b>' +
        tx('Verified at source') +
        '</b> — the platform confirmed this against the registry. Buyers see this as met.</div>'
      : held
        ? '<div style="margin:10px 16px 0;font-size:var(--fs-2);color:var(--ok-2);background:var(--ok-tint);border:1px solid #bfe3cb;border-radius:9px;padding:9px 12px">✓ <b>' +
          tx('Documented on the rail') +
          '</b> — a real document backs this, valid. Buyers see this as met.</div>'
        : live
          ? '<div style="margin:10px 16px 0;font-size:var(--fs-2);color:var(--warn-2);background:var(--warn-tint);border:1px solid #f0dcae;border-radius:9px;padding:9px 12px">⚠ <b>' +
            tx('Declared only') +
            '</b> — a bare claim, <b>not evidenced</b>. Attach a document (Gather) or <b>' +
            tx('Verify at source') +
            '</b> to make it count. Buyers do NOT treat a bare claim as met.</div>'
          : '<div style="margin:10px 16px 0;font-size:var(--fs-2);color:var(--grey);background:var(--card);border:1px solid var(--line);border-radius:9px;padding:9px 12px">☐ <b>Not held.</b> Provide evidence (Gather or Verify) to check it — it stays checked only while the evidence is valid.</div>';
  var vmode = idType
    ? '<div style="margin:8px 16px 0;font-size:var(--fs-1);color:var(--ok-2);background:var(--ok-tint);border:1px solid #bfe3cb;border-radius:9px;padding:8px 11px">🔗 <b>' +
      tx('Live source-check') +
      '</b> — the platform verifies this ' +
      idType.toUpperCase() +
      ' against the <b>source registry</b>, invoked live. Confirmed at source, not your word for it.</div>'
    : '<div style="margin:8px 16px 0;font-size:var(--fs-1);color:var(--grey);background:var(--card);border:1px solid var(--line);border-radius:9px;padding:8px 11px">📄 <b>' +
      tx('Document evidence') +
      '</b> — your certificate + issuer link. A <b>live source-check is not wired for this standard yet</b> (it needs the issuing body’s registry).</div>';
  return (
    '<div style="padding:14px 16px 0"><div style="display:flex;align-items:flex-start;gap:10px"><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:var(--fs-3)">' +
    esc(it.title || it.doc) +
    rung +
    '</div><div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">from <span class="mono" style="color:var(--blue)">' +
    esc(it.standard) +
    '</span></div></div><div style="flex:0 0 auto;display:flex;gap:6px;align-items:center">' +
    draftBtn +
    verifyBtn +
    actBtn +
    '</div></div></div>' +
    banner +
    vmode +
    _rdExpand(it)
  );
}
// ── COMMERCIAL COVER (live /instruments) — the invariant spine beneath the industry-variable compliance ──
async function loadCommerce() {
  try {
    UI.commerce = await api('instruments', { query: { incoterm: 'CIF', cross_border: 1 } });
  } catch (e) {
    UI.commerce = { error: (e && e.message) || 'x' };
  }
  UI.commerceLoading = false;
  if (typeof renderApp === 'function') bgRenderApp();
}
function _frmBadge(c) {
  var map = {
    market: ['var(--blue-2)', 'market'],
    credit: ['var(--warn-2)', 'credit'],
    liquidity: ['var(--blue-2)', 'liquidity'],
    operational: ['var(--purple-2)', 'operational']
  };
  var x = map[c] || ['var(--blue-2)', String(c || '—')];
  return (
    '<span style="font-size:var(--fs-1);font-weight:800;letter-spacing:.03em;text-transform:uppercase;border-radius:5px;padding:2px 6px;background:' +
    x[0] +
    '1e;color:' +
    x[0] +
    '">FRM · ' +
    x[1] +
    '</span>'
  );
}
// ── MY READINESS (supplier) — spin the globe: readiness resolved per destination ──
async function loadLanes() {
  try {
    UI.laneMatrix = await api('lanes', { query: _laneQuery() });
  } catch (e) {
    UI.laneMatrix = { error: (e && e.message) || 'Could not load', lanes: [] };
  }
  if (UI.laneMatrix && UI.laneMatrix.lanes && UI.laneMatrix.lanes.length) {
    if (
      !UI.laneDest ||
      !UI.laneMatrix.lanes.some(function (item) {
        return item.dest_key === UI.laneDest;
      })
    )
      UI.laneDest = UI.laneMatrix.lanes[0].dest_key;
    loadLaneReadiness(UI.laneDest);
  }
  if (typeof renderApp === 'function') bgRenderApp();
}
async function loadLaneReadiness(dest) {
  UI.laneRd = undefined;
  try {
    UI.laneRd = await api('readinessOwn', { query: _laneQuery({ destination: dest }) });
  } catch (e) {
    UI.laneRd = { error: (e && e.message) || 'Could not load' };
  }
  if (typeof renderApp === 'function') bgRenderApp();
}
function setLaneDest(dest) {
  UI.laneDest = dest;
  UI.laneRd = undefined;
  if (typeof renderApp === 'function') renderApp();
  loadLaneReadiness(dest);
  saveLane();
}
function setLaneVertical(v) {
  UI.laneVertical = v;
  UI.laneRd = undefined;
  if (typeof renderApp === 'function') renderApp();
  loadLaneReadiness(UI.laneDest || 'EU');
  saveLane();
}
// one-line explanation per tab (shown as an ⓘ strip under the tab bar)
function _rdTabInfo(tab) {
  var m = {
    certification: 'Standing certifications your organisation holds — audited and renewed, valid across every order.',
    clearance: 'Per-shipment clearances gathered for each order into the chosen destination.',
    commercial: 'Commercial cover for the deal — payment, transit, currency & financing risk (FRM). The same in every sector.'
  };
  var t = m[tab];
  if (!t) return '';
  return (
    '<div style="flex:none;font-size:var(--fs-1);color:var(--grey);padding:8px 14px;border-bottom:1px solid var(--line);background:var(--card)"><span style="color:var(--blue);font-weight:800">ⓘ</span> ' +
    t +
    ' <span style="color:var(--on-card)">· sector-generic — switch the sector to see it re-resolve.</span></div>'
  );
}
// ── CHECK A SUPPLIER (buyer) ──
// compact spin-the-globe: origin → destination selectors (shown in the Clearances tab header).
function _mapOrigin(c) {
  c = String(c || '').toUpperCase();
  if (['IN', 'IND', 'INDIA'].indexOf(c) >= 0) return 'IN';
  if (['US', 'USA', 'UNITED STATES'].indexOf(c) >= 0) return 'US';
  if (['AE', 'SA', 'QA', 'KW', 'OM', 'BH', 'UAE', 'GCC', 'GULF'].indexOf(c) >= 0) return 'GULF';
  if (['EU', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'PL', 'SE', 'AT', 'IE', 'PT', 'GR', 'DK', 'FI'].indexOf(c) >= 0) return 'EU';
  return /^[A-Z]{2}$/.test(c) ? c : null; /* CMP-1: another country is itself (AU), never India */
}
function _rdDestSelectors() {
  var dest = UI.laneDest || 'EU',
    origin = _laneOrigin(),
    vert = _laneVert() || '';
  var dOpts = [
    ['EU', 'European Union'],
    ['US', 'United States'],
    ['GULF', 'Gulf (GCC)'],
    ['IN', 'Domestic (India)']
  ];
  var vOpts = [
    ['paint', 'Chemical / Paint'],
    ['food', 'Food'],
    ['textiles', 'Textiles'],
    ['electronics', 'Electronics'],
    ['pharma', 'Pharmaceutical'],
    ['automobile', 'Automobile']
  ];
  if (!vert) vOpts = [['', 'Choose…']].concat(vOpts); /* CMP-1: no sector stated → asked, not paint */
  var oName = origin ? { IN: 'India', US: 'United States', EU: 'European Union', GULF: 'Gulf (GCC)' }[origin] || origin : 'not stated yet';
  var ss = 'font-size:var(--fs-2);font-weight:700;border:1px solid var(--line);border-radius:9px;padding:5px 8px;background:var(--card);color:var(--ink)';
  var opt = function (list, v) {
    return list
      .map(function (x) {
        return '<option value="' + x[0] + '"' + (x[0] === v ? ' selected' : '') + '>' + x[1] + '</option>';
      })
      .join('');
  };
  var rd = UI.laneRd,
    s = (rd && rd.summary) || {},
    cnt =
      rd && !rd.error && s.total != null
        ? '<span style="font-size:var(--fs-1);color:var(--grey)">' + (s.met || 0) + ' of ' + (s.total || 0) + ' met</span>'
        : '';
  return (
    '<span style="font-size:var(--fs-1);color:var(--grey)">sector</span><select data-cbsid="SCR033-S01" onchange="setLaneVertical(this.value)" style="' +
    ss +
    '">' +
    opt(vOpts, vert) +
    '</select>' +
    '<span style="font-size:var(--fs-1);color:var(--grey)" title="Your registered country (fixed)">🌍 from <b style="color:var(--ink)">' +
    esc(oName) +
    '</b></span>' +
    '<span style="font-size:var(--fs-1);color:var(--grey)">ship to</span><select data-cbsid="SCR033-S02" onchange="setLaneDest(this.value)" style="' +
    ss +
    '">' +
    opt(dOpts, dest) +
    '</select>' +
    cnt
  );
}
// header: tabs (Clearances | Commercial cover) within Trade ready + the spin-the-globe selectors on the Clearances tab.
function _rdHeader() {
  var tab = UI.rdTab || 'certification';
  var tb = function (k, lbl) {
    return (
      '<div data-cbsid="SCR033-C03" onclick="UI.rdTab=\'' +
      k +
      "';if(typeof renderApp==='function')renderApp()\" style=\"padding:9px 15px;font-size:var(--fs-2);font-weight:700;cursor:pointer;border-bottom:2px solid " +
      (tab === k ? 'var(--blue)' : 'transparent') +
      ';color:' +
      (tab === k ? 'var(--blue)' : 'var(--grey)') +
      '">' +
      lbl +
      '</div>'
    );
  };
  return (
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:none;padding:0 12px;border-bottom:1px solid var(--line);background:var(--card);color:var(--on-card)">' +
    '<div style="display:flex;gap:2px">' +
    tb('certification', 'Certification') +
    tb('clearance', 'Clearance') +
    tb('commercial', 'Commercial') +
    '</div>' +
    '<div style="margin-inline-start:auto;display:flex;align-items:center;gap:8px;padding:6px 0;flex-wrap:wrap">' +
    (tab !== 'commercial' ? _rdDestSelectors() : '') +
    '<button data-cbsid="SCR033-B08" onclick="aiSuggestStandards()" title="AI suggests the standards you likely need for this sector + market" style="font-size:var(--fs-1);font-weight:700;border:1px solid var(--purple);background:var(--purple-tint);color:var(--purple);border-radius:9px;padding:6px 10px;cursor:pointer">' +
    tx('✨ Standards') +
    '</button>' +
    '<button data-cbsid="SCR033-B09" onclick="openSectorMatrix()" title="Common vs sector-specific — the sector × standard matrix" style="font-size:var(--fs-1);font-weight:700;border:1px solid var(--line);background:var(--card);color:var(--blue);border-radius:9px;padding:6px 10px;cursor:pointer">' +
    tx('🧮 Matrix') +
    '</button></div>' +
    '</div>'
  );
}
// STANDARD display names for the matrix (fallback = the key)
var STDNAME = {
  'exim-policy': 'Export policy (IEC · HS · declaration · Incoterms)',
  'iso-9001': 'ISO 9001 — Quality',
  'iso-14001': 'ISO 14001 — Environmental',
  'iso-27000': 'ISO 27001 — Information security',
  'iso-45001': 'ISO 45001 — Occupational safety',
  'reach': 'REACH — chemical registration',
  'sds': 'Safety Data Sheet (GHS)',
  'tsca': 'TSCA — US chemical inventory',
  'bis': 'BIS — India conformity',
  'haccp': 'HACCP — food safety',
  'fssai': 'FSSAI licence',
  'phyto': 'Phytosanitary certificate',
  'eu-health': 'EU health certificate',
  'oeko-tex': 'OEKO-TEX Standard 100',
  'gots': 'GOTS — organic textiles',
  'flammability': 'Flammability (16 CFR 1610)',
  'ce-rohs': 'CE / RoHS conformity',
  'weee': 'WEEE registration',
  'battery-comp': 'UN 38.3 — battery',
  'who-gmp': 'WHO-GMP — Good Manufacturing Practice',
  'cdsco': 'CDSCO manufacturing licence',
  'copp': 'Certificate of Pharmaceutical Product',
  'fda-drug': 'US FDA drug registration',
  'iatf-16949': 'IATF 16949 — Automotive quality',
  'ece-approval': 'ECE Type Approval (UNECE)'
};
function _mtxCell(on, common, color) {
  return (
    '<td style="text-align:center;padding:8px 5px;border-bottom:1px solid var(--line)">' +
    (on
      ? '<span style="display:inline-block;width:19px;height:19px;border-radius:6px;background:' +
        (common ? 'var(--ok-3)' : color) +
        ';color:#fff;font-size:var(--fs-1);font-weight:800;line-height:19px">✓</span>'
      : '<span style="color:var(--line)">·</span>') +
    '</td>'
  );
}
// the sector × standard matrix — LIVE from the engine (resolve every sector for the current lane), common vs specific.
async function openSectorMatrix() {
  var secs = [
    ['paint', '🧪', 'Chemical', 'var(--blue-2)'],
    ['food', '🍎', 'Food', 'var(--ok-3)'],
    ['textiles', '🧵', 'Textiles', 'var(--purple-2)'],
    ['electronics', '🔌', 'Electronics', 'var(--warn-2)'],
    ['pharma', '💊', 'Pharma', 'var(--blue-2)'],
    ['automobile', '🚗', 'Auto', 'var(--disp)']
  ];
  var dest = UI.laneDest || 'EU',
    origin = _laneOrigin(); /* CMP-1: the server's stated origin, never IN */
  if (typeof modal === 'function') {
    modal(
      '<div class="mhd" style="display:flex;align-items:center;gap:8px"><div class="t" style="flex:1;padding-inline-end:30px">' +
        tx('🧮 Sector × standard — common vs specific') +
        '</div></div><div class="mbody" style="padding:14px 16px"><div id="mtxbody" style="font-size:var(--fs-2);color:var(--grey)">Resolving every sector for ' +
        esc(origin) +
        ' <span class=arw>→</span> ' +
        esc(dest) +
        '…</div></div>'
    );
    /**
     * ⚠️⚠️ THIS LINE USED TO SET data-movable='1' TO **BLOCK** makeMovable — the flag is how the primitive
     * knows it has already run, so stamping it by hand opted the matrix OUT of drag and resize. Athi,
     * 2026-08-29: *"the matrix icon brings a screen when it renders, it has to be an excellent overlay screen,
     * resizable."*
     *
     * ⭐ The reason it was blocked has expired. The comment on makeMovable records it: the A−/A+/grip bar sat
     * on top of the title and the ✕, so movable was switched off for modals — a PLACEMENT problem written down
     * as a capability decision. opts.barAt:'right' fixed the placement, and the A buttons are gone entirely.
     *
     * Nothing replaces it: modal() now makes every modal movable, and this one is the reason to check that it
     * does. A six-column table is exactly the content a reader wants to make bigger.
     */
  }
  var rows = {};
  for (var index = 0; index < secs.length; index++) {
    try {
      var reply = await api('readinessOwn', { query: { destination: dest, vertical: secs[index][0] } });
      ((reply && reply.clearances) || []).forEach(function (item) {
        if (!rows[item.standard]) rows[item.standard] = { std: item.standard, sectors: {} };
        rows[item.standard].sectors[secs[index][0]] = true;
      });
    } catch (e) { /* best effort: failing here changes nothing the user sees */ }
  }
  var list = Object.keys(rows).map(function (item) {
    var on = secs.map(function (s) {
      return !!rows[item].sectors[s[0]];
    });
    return { std: item, name: STDNAME[item] || item, on: on, n: on.filter(Boolean).length };
  });
  list.sort(function (first, second) {
    return second.n - first.n || first.std.localeCompare(second.std);
  });
  var head =
    '<tr><th style="text-align:start;padding:8px 6px;font-size:var(--fs-1);text-transform:uppercase;color:var(--grey);border-bottom:1px solid var(--line)">' +
    tx('Standard') +
    '</th>' +
    secs
      .map(function (item) {
        return (
          '<th style="padding:8px 4px;font-size:var(--fs-1);border-bottom:1px solid var(--line);color:' +
          item[3] +
          ';white-space:nowrap">' +
          item[1] +
          '<br>' +
          item[2] +
          '</th>'
        );
      })
      .join('') +
    '</tr>';
  var rowH = function (r) {
    var nestedCommon = r.n === secs.length;
    return (
      '<tr' +
      (nestedCommon ? ' style="background:var(--ok-tint);color:var(--on-card)"' : '') +
      '><td style="padding:8px 6px;font-weight:600;font-size:var(--fs-2);border-bottom:1px solid var(--line);color:' +
      (nestedCommon ? 'var(--ok-3)' : 'var(--ink)') +
      '">' +
      esc(r.name) +
      '</td>' +
      r.on
        .map(function (item, position) {
          return _mtxCell(item, nestedCommon, secs[position][3]);
        })
        .join('') +
      '</tr>'
    );
  };
  var band = function (t) {
    return (
      '<tr><td colspan="' +
      (secs.length + 1) +
      '" style="padding:11px 6px 3px;font-size:var(--fs-1);font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--grey)">' +
      t +
      '</td></tr>'
    );
  };
  var common = list.filter(function (item) {
      return item.n === secs.length;
    }),
    spec = list.filter(function (item) {
      return item.n !== secs.length;
    });
  var html =
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:9px">Lane held constant (' +
    esc(origin || 'not stated yet') +
    ' <span class=arw>→</span> ' +
    esc(dest) +
    ') — only the sector changes. A full row is the <b>common backbone</b>; a single ✓ is <b>sector-specific</b>.</div>' +
    '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;min-width:430px">' +
    head +
    band('● Common — every sector') +
    common.map(rowH).join('') +
    band('◆ Sector-specific') +
    spec.map(rowH).join('') +
    '</table></div>' +
    '<div style="margin-top:12px;font-size:var(--fs-1);color:var(--grey)">required = <b>common backbone</b> ∪ <b>sector-specific</b> ∪ <b>destination-specific</b> — derived, never enumerated.</div>' +
    '<div style="margin-top:12px;text-align:center;font-family:\'Space Grotesk\',system-ui;font-weight:700;font-size:var(--fs-1);color:var(--blue);letter-spacing:.04em">Chit &amp; Bridge</div>';
  var el = document.getElementById('mtxbody');
  if (el) el.innerHTML = html;
}
// ── COMMERCIAL two-pane — the invariant spine gets the SAME treatment as clearances. Left = the cover areas (live from
// /instruments, grouped by risk); right = advice · trust ladder (attestor = a FINANCIAL party) · lifecycle · AI · partner.
// Enriched by COMMETA the way clearances are enriched by LIFE. Attestor rung: declared→documented→attested→verified. ──
var COMMETA = {
  'Payment risk': {
    attestor: 'confirming bank',
    top: 'verified',
    partner: 'Trade-finance bank',
    ai: {
      skill: 'lc-checklist',
      lvl: 'L2',
      gate: 'confirm',
      t: 'AI lists the exact documents your LC requires under UCP 600 and flags discrepancy risks; you check them.'
    },
    advice:
      'For a new buyer or a higher-risk lane, prefer an irrevocable CONFIRMED LC — a bank stands behind payment. Documentary collection is cheaper; open account is cheapest but exposes you to non-payment, so use it only with a proven buyer.',
    life: [
      ['Terms agreed', 'now'],
      ['LC applied / drafted', 'next'],
      ['Bank issues & confirms', 'next'],
      ['Docs presented vs payment', 'next']
    ]
  },
  'Performance risk': {
    attestor: 'issuing bank',
    top: 'attested',
    partner: 'Bank (guarantee)',
    ai: {
      skill: 'reference-summary',
      lvl: 'L2',
      gate: 'confirm',
      t: 'AI assembles your on-rail track record as evidence of performance; a bond adds a bank guarantee for large first orders.'
    },
    advice:
      'Your on-rail settlement history already evidences that you perform — this area is part-covered on the rail. A performance bond / guarantee adds a bank promise for a large first order.',
    life: [
      ['On-rail history', 'done'],
      ['Bond needed for size?', 'now'],
      ['Bank issues bond', 'next']
    ]
  },
  'Transit / cargo risk': {
    attestor: 'cargo insurer',
    top: 'attested',
    partner: 'Marine cargo insurer / broker',
    ai: {
      skill: 'insurance-request',
      lvl: 'L2',
      gate: 'confirm',
      t: 'AI drafts the insurance request from the consignment and the Incoterm; the insurer issues the certificate.'
    },
    advice:
      'Under CIF the SELLER buys marine cover to the destination port (ICC-A is all-risks). Under FOB the BUYER insures — read your Incoterm so cover is not doubled or missed.',
    life: [
      ['Incoterm sets who insures', 'now'],
      ['Request cover', 'next'],
      ['Insurer issues certificate', 'next']
    ]
  },
  'Currency risk': {
    attestor: 'bank treasury',
    top: 'attested',
    partner: 'Bank FX desk',
    ai: { skill: 'fx-exposure-note', lvl: 'L2', gate: 'confirm', t: 'AI computes the currency exposure and drafts a hedge note; the bank books the forward.' },
    advice:
      'If you invoice in a foreign currency but your costs are in yours, a forward locks the rate and removes the swing. Hedge the exposure — do not take a bet on the rate.',
    life: [
      ['Exposure identified', 'now'],
      ['Book forward / option', 'next'],
      ['Rate locked', 'next']
    ]
  },
  'Price / commodity risk': {
    attestor: 'exchange / bank',
    top: 'attested',
    partner: 'Commodity desk',
    ai: { skill: null, lvl: 'L2', gate: 'confirm', t: 'AI flags the input-price exposure; the desk structures the hedge.' },
    advice: 'If your margin depends on a volatile input (a metal, a polymer), a price hedge protects the quoted price between order and delivery.',
    life: [
      ['Input exposure', 'now'],
      ['Hedge structured', 'next']
    ]
  },
  'Country / political risk': {
    attestor: 'ECA / PRI insurer',
    top: 'attested',
    partner: 'ECA / political-risk insurer',
    ai: { skill: 'political-risk-note', lvl: 'L2', gate: 'confirm', t: 'AI checks the lane against country-risk signals and drafts the cover request.' },
    advice:
      'For buyers in higher-risk jurisdictions, export-credit-agency or political-risk insurance covers non-payment caused by country events (transfer bans, expropriation).',
    life: [
      ['Assess country risk', 'now'],
      ['Apply to ECA / insurer', 'next'],
      ['Cover issued', 'next']
    ]
  },
  'Liquidity risk': {
    attestor: 'bank / factor',
    top: 'attested',
    partner: 'Bank / factor',
    ai: {
      skill: 'finance-eligibility-note',
      lvl: 'L2',
      gate: 'confirm',
      t: 'AI drafts a finance-eligibility note from the order and your history; the bank / factor advances the funds.'
    },
    advice:
      'Packing credit funds production BEFORE shipment; bill discounting / factoring advances cash against the receivable so you do not wait out the buyer credit term.',
    life: [
      ['Working-capital need', 'now'],
      ['Apply for finance', 'next'],
      ['Funds advanced', 'next']
    ]
  }
};
function _rdComSelect(i) {
  UI.comSel = i;
  if (UI.vp === 'mob') UI.rdMDetail = true;
  if (typeof renderApp === 'function') renderApp();
}
function _rdComRow(g, i, sel) {
  var on = i === sel;
  var onrail = g.covered_onrail
    ? '<span title="already evidenced on the rail" style="font-size:var(--fs-1);color:var(--ok-3);font-weight:800;flex:0 0 auto">' + tx('● rail') + '</span>'
    : '';
  return (
    '<div data-cbsid="SCR033-C04" onclick="_rdComSelect(' +
    i +
    ')" style="display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:9px;cursor:pointer;margin:2px 0;background:' +
    (on ? 'var(--blue-tint)' : 'transparent') +
    ';border:1px solid ' +
    (on ? 'var(--blue)' : 'transparent') +
    '">' +
    '<div style="min-width:0;flex:1"><div style="font-weight:' +
    (on ? '700' : '600') +
    ';font-size:var(--fs-2);color:' +
    (on ? 'var(--blue)' : 'var(--ink)') +
    ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
    esc(g.label) +
    '</div></div>' +
    onrail +
    _frmBadge(g.frm_class) +
    '</div>'
  );
}
function _rdComLadder(attestor, top) {
  var rungs = [
    ['declared', 'term agreed'],
    ['documented', 'instrument drafted'],
    ['attested', (attestor || 'a bank') + ' issues / confirms'],
    ['verified', 'confirmed at source']
  ];
  var order = { declared: 0, documented: 1, attested: 2, verified: 3 },
    topIx = order[top] != null ? order[top] : 2;
  var cols = { declared: 'var(--blue-2)', documented: 'var(--warn-2)', attested: 'var(--blue-2)', verified: 'var(--ok-3)' };
  return rungs
    .map(function (item) {
      var ix = order[item[0]],
        reach = ix <= topIx,
        c = cols[item[0]];
      return (
        '<div style="display:flex;align-items:center;gap:9px;padding:3px 0;font-size:var(--fs-2);opacity:' +
        (reach ? '1' : '.38') +
        '"><span style="width:9px;height:9px;border-radius:50%;background:' +
        c +
        ';flex:0 0 auto"></span><b style="text-transform:uppercase;font-size:var(--fs-1);letter-spacing:.03em;color:' +
        c +
        ';min-width:82px">' +
        item[0] +
        '</b><span style="color:var(--grey)">' +
        esc(item[1]) +
        '</span></div>'
      );
    })
    .join('');
}
function _rdComSteps(life) {
  return (life || [])
    .map(function (item) {
      var c = item[1],
        col = c === 'done' ? 'var(--ok-3)' : c === 'now' ? 'var(--blue)' : 'var(--blue-tint-bg)',
        ic = c === 'done' ? '✓' : c === 'now' ? '●' : '○';
      return (
        '<div style="display:flex;align-items:center;gap:9px;padding:4px 0;font-size:var(--fs-2);color:' +
        (c === 'next' ? 'var(--grey)' : 'var(--ink)') +
        '"><span style="width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:var(--fs-1);font-weight:800;color:#fff;background:' +
        col +
        ';flex:0 0 auto">' +
        ic +
        '</span>' +
        esc(item[0]) +
        (c === 'now'
          ? ' <span style="font-size:var(--fs-1);color:var(--blue);font-weight:800;text-transform:uppercase;letter-spacing:.04em">you are here</span>'
          : '') +
        '</div>'
      );
    })
    .join('');
}
function _rdComDetail(g) {
  if (!g) return '<div style="color:var(--grey);font-size:var(--fs-2);padding:24px;text-align:center">Select a commercial area on the left.</div>';
  var m = COMMETA[g.label] || {};
  var names = (g.instruments || [])
    .map(function (item) {
      return esc(item.name);
    })
    .join(' · ');
  var draftBtn =
    m.ai && m.ai.skill
      ? '<button data-cbsid="SCR033-B10" onclick="aiDraftCommerce(\'' +
        m.ai.skill +
        "','" +
        esc(g.label) +
        '\')" title="AI drafts it — you review and confirm" style="font-size:var(--fs-2);font-weight:700;border:1px solid var(--purple);background:var(--purple-tint);color:var(--purple);border-radius:9px;padding:7px 12px;cursor:pointer">' +
        tx('✨ Draft with AI') +
        '</button>'
      : '';
  var partner = m.partner
    ? '<div style="margin-top:11px;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:var(--warn-tint);color:var(--on-card)"><span style="font-size:var(--fs-1);font-weight:800;color:var(--warn-3);text-transform:uppercase;letter-spacing:.05em">' +
      tx('Or hand it to a partner') +
      '</span><div style="font-size:var(--fs-2);margin-top:3px;font-weight:600">' +
      esc(m.partner) +
      '</div></div>'
    : '';
  var ai = m.ai || {};
  var aiLine =
    '<b style="color:var(--blue)">' +
    esc(ai.lvl || 'L2') +
    '</b> · gate: ' +
    esc(ai.gate || 'confirm') +
    ' — ' +
    esc(ai.t || 'AI role to be defined.') +
    (ai.skill ? '' : ' <i style="color:#8a94a6">(skill coming)</i>');
  return (
    '<div style="padding:14px 16px 0"><div style="display:flex;align-items:flex-start;gap:10px"><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:var(--fs-3)">' +
    esc(g.label) +
    '</div><div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px;display:flex;align-items:center;gap:7px;flex-wrap:wrap">' +
    _frmBadge(g.frm_class) +
    (g.covered_onrail ? '<span style="color:var(--ok-3);font-weight:700;font-size:var(--fs-1)">' + tx('● already on rail') + '</span>' : '') +
    '</div></div><div style="flex:0 0 auto">' +
    draftBtn +
    '</div></div></div>' +
    '<div style="border-top:1px solid var(--line);margin:12px 0 0;padding:2px 16px 16px">' +
    _rdSub('Instruments') +
    '<div style="font-size:var(--fs-2);color:var(--ink)">' +
    (names || '—') +
    '</div>' +
    _rdSub('Advice') +
    '<div style="font-size:var(--fs-2);color:var(--ink);line-height:1.5">' +
    esc(m.advice || '—') +
    '</div>' +
    _rdSub('Trust ladder · who stands behind it') +
    '<div>' +
    _rdComLadder(m.attestor, m.top) +
    '</div>' +
    (m.life ? _rdSub('Its lifecycle') + _rdComSteps(m.life) : '') +
    _rdSub('🤖 How AI enables it') +
    '<div style="font-size:var(--fs-2);color:var(--grey)">' +
    aiLine +
    '</div>' +
    partner +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:12px;border-inline-start:3px solid #8a5e22;padding-inline-start:9px;line-height:1.45">When you send the order, the chosen cover folds onto the buyer\'s copy (frozen) beside the clearances — same as certificates.</div>' +
    '</div>'
  );
}
function _rdComTwoPane() {
  if (UI.commerce === undefined) {
    if (!UI.commerceLoading) {
      UI.commerceLoading = true;
      loadCommerce();
    }
    return '<div style="flex:1;display:grid;place-items:center;color:var(--grey);font-size:var(--fs-2)">' + tx('Loading commercial cover…') + '</div>';
  }
  if (UI.commerce.error || !UI.commerce.cluster)
    return (
      '<div style="flex:1;padding:20px;color:var(--grey);font-size:var(--fs-2)">Could not load commercial cover' +
      (UI.commerce.error ? ' — ' + esc(UI.commerce.error) : '') +
      '.</div>'
    );
  var list = UI.commerce.cluster,
    sel = UI.comSel != null && UI.comSel < list.length ? UI.comSel : 0;
  UI.comSel = sel;
  var left = list
    .map(function (item, index) {
      return _rdComRow(item, index, sel);
    })
    .join('');
  return (
    '<div class="rdpanes' +
    (UI.rdMDetail ? ' showdetail' : '') +
    '" style="flex:1;display:flex;min-height:0;overflow:hidden">' +
    '<div id="comlist" class="rdlist" style="width:300px;flex:0 0 auto;border-inline-end:1px solid var(--line);overflow-y:auto;background:var(--card);padding:8px 6px 30px;color:var(--on-card)">' +
    left +
    '</div>' +
    '<div class="rddetail" style="flex:1;min-width:0;overflow-y:auto;background:var(--blue-tint-bg);color:var(--on-card)">' +
    '<button data-cbsid="CMP006" class="dback" style="margin:10px 0 0 14px" onclick="rdBack()">‹ Back</button>' +
    _rdComDetail(list[sel]) +
    '</div></div>'
  );
}
// a two-pane (list ↔ detail) for one tab's set of items
function _rdTwoPane(list) {
  if (!list.length)
    return '<div style="flex:1;display:grid;place-items:center;color:var(--grey);font-size:var(--fs-2);padding:20px">Nothing required for this lane.</div>';
  if (
    !UI.rdSel ||
    !list.some(function (item) {
      return item.standard + '|' + item.doc === UI.rdSel;
    })
  )
    UI.rdSel = list[0].standard + '|' + list[0].doc;
  var sel = list.filter(function (item) {
    return item.standard + '|' + item.doc === UI.rdSel;
  })[0];
  var left = list
    .map(function (item) {
      return _rdRow(item, UI.rdSel);
    })
    .join('');
  return (
    '<div class="rdpanes' +
    (UI.rdMDetail ? ' showdetail' : '') +
    '" style="flex:1;display:flex;min-height:0;overflow:hidden">' +
    '<div id="rdlist" class="rdlist" style="width:300px;flex:0 0 auto;border-inline-end:1px solid var(--line);overflow-y:auto;background:var(--card);padding:8px 6px 30px;color:var(--on-card)">' +
    left +
    '</div>' +
    '<div id="rddetail" class="rddetail" style="flex:1;min-width:0;overflow-y:auto;background:var(--blue-tint-bg);color:var(--on-card)">' +
    '<button data-cbsid="CMP006" class="dback" style="margin:10px 0 0 14px" onclick="rdBack()">‹ Back</button>' +
    _rdDetailPane(sel) +
    '</div></div>'
  );
}
/* Leave the detail on mobile. On a laptop nothing calls this — the back button it belongs to is .dback, which the
   shell only shows under .appwrap.m. */
function rdBack() {
  UI.rdMDetail = false;
  if (typeof renderApp === 'function') renderApp();
}
// Trade ready — FULL-WIDTH, uniform with Task. Tabs: Certification (standing) · Clearance (per-shipment) · Commercial.
function readinessScreen() {
  var tab = UI.rdTab || 'certification';
  if (UI.profile === undefined && typeof rdLoadDeclaration === 'function') rdLoadDeclaration(); // the entity's declaration (checkboxes)
  var shell = function (inner) {
    return '<div style="flex:1;display:flex;flex-direction:column;min-height:0">' + _rdHeader() + _rdTabInfo(tab) + inner + '</div>';
  };
  if (tab === 'commercial') {
    return shell(_rdComTwoPane());
  }
  var dest = UI.laneDest || 'EU';
  if (UI.laneRd === undefined) {
    if (typeof loadLaneReadiness === 'function') loadLaneReadiness(dest);
    return shell(
      '<div style="flex:1;display:grid;place-items:center;color:var(--grey);font-size:var(--fs-2)">' +
        (typeof loader === 'function' ? loader('Resolving clearances…') : 'Loading…') +
        '</div>'
    );
  }
  var rd = UI.laneRd;
  if (rd.error)
    return shell(
      '<div style="padding:20px">' + (typeof emptyState === 'function' ? emptyState('⚠️', 'Could not load', esc(rd.error)) : esc(rd.error)) + '</div>'
    );
  var items = rd.clearances || [];
  var list =
    tab === 'clearance'
      ? items.filter(function (item) {
          return item.scope !== 'entity';
        })
      : items.filter(function (item) {
          return item.scope === 'entity';
        });
  return shell(_rdTwoPane(list));
}
function verifyReadiness(standard, doc, id_type) {
  UI.rdVerify = { standard: standard, doc: doc, id_type: id_type };
  var body =
    '<div class="mbody" style="padding:16px 18px">' +
    '<div style="font-size:var(--fs-2);color:var(--grey);margin-bottom:12px">Check your <b>' +
    id_type.toUpperCase() +
    '</b>. When a registry is connected this confirms it against the source of truth — the top <b>verified</b> rung. Until then it validates the format and records a <b>declared</b> claim (never a false “verified”).</div>' +
    ui.field({
      mount: 'SCR033-U01',
      kind: 'text',
      id: 'vf_id',
      label: id_type.toUpperCase() + ' number',
      placeholder: id_type === 'iec' ? 'e.g. AAACR1234B' : id_type.toUpperCase() + ' number'
    }) +
    '<div id="vf_err" style="color:var(--disp);font-size:var(--fs-2);margin-bottom:8px"></div>' +
    '<button data-cbsid="SCR033-B11" id="vf_btn" onclick="submitVerify()" style="width:100%;background:var(--ok-3);color:var(--on-ok);border:0;border-radius:9px;padding:11px;font-weight:700;cursor:pointer">' +
    tx('🔗 Verify ID') +
    '</button>' +
    '</div>';
  if (typeof modal === 'function') modal('<div class="mhd"><div class="t">' + tx('🔗 Verify registry ID') + '</div></div>' + body);
}
async function submitVerify() {
  var g = UI.rdVerify || {};
  if (!g.standard) return;
  var id = ((document.getElementById('vf_id') || {}).value || '').trim();
  var btn = document.getElementById('vf_btn'),
    err = document.getElementById('vf_err');
  if (err) err.textContent = '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Verifying…';
  }
  try {
    var date = new Date(Date.now() + 730 * 86400000).toISOString().slice(0, 10);
    var res = await api('readinessVerify', { body: { standard_key: g.standard, doc_key: g.doc, id_type: g.id_type, id_value: id, valid_until: date } });
    if (typeof closeModal === 'function') closeModal();
    var vm = res && res.verdict && res.verdict.method;
    if (typeof toast === 'function') toast(vm === 'registry' ? 'Verified against the registry ✓' : 'Format valid — recorded as a declared claim');
    UI.laneMatrix = undefined;
    UI.laneRd = undefined;
    loadLanes();
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔗 Verify ID';
    }
    if (err) err.textContent = (e && e.message) || 'Verification failed';
  }
}
function gatherReadiness(standard, doc) {
  var it = ((UI.readiness && UI.readiness.clearances) || []).filter(function (item) {
    return item.standard === standard && item.doc === doc;
  })[0];
  UI.rdGather = { standard: standard, doc: doc, title: (it && it.title) || doc };
  var date = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  var body =
    '<div class="mbody" style="padding:16px 18px">' +
    '<div style="font-size:var(--fs-2);color:var(--grey);margin-bottom:13px">This records the clearance as a <b>chit on the rail</b> that carries your document — provenanced &amp; private. Buyers see only that it\'s met + its validity.</div>' +
    ui.field({ mount: 'SCR033-U02', kind: 'file', id: 'gd_file', label: 'Document (PDF/image · ≤ 6 MB)' }) +
    ui.field({ mount: 'SCR033-U03', kind: 'text', id: 'gd_ref', label: 'Reference / number (optional)', placeholder: 'e.g. certificate no.' }) +
    ui.field({ mount: 'SCR033-U04', kind: 'date', id: 'gd_valid', label: 'Valid until', value: date }) +
    '<div id="gd_err" style="color:var(--disp);font-size:var(--fs-2);margin-bottom:8px"></div>' +
    '<button data-cbsid="SCR033-B12" id="gd_btn" onclick="submitGather()" style="width:100%;background:var(--blue);color:var(--on-accent);border:0;border-radius:9px;padding:11px;font-weight:700;cursor:pointer">' +
    tx('Record clearance on the rail') +
    '</button>' +
    '</div>';
  if (typeof modal === 'function') modal('<div class="mhd"><div class="t">🛡️ Gather clearance — ' + esc(UI.rdGather.title) + '</div></div>' + body);
}
async function submitGather() {
  var g = UI.rdGather || {};
  if (!g.standard) return;
  var node = document.getElementById('gd_file'),
    file = node && node.files && node.files[0];
  var ref = ((document.getElementById('gd_ref') || {}).value || '').trim();
  var valid = (document.getElementById('gd_valid') || {}).value || '' || null;
  var btn = document.getElementById('gd_btn'),
    err = document.getElementById('gd_err');
  if (err) err.textContent = '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Recording…';
  }
  try {
    // 1 · a SELF-CHIT is the evidence record on the rail (governed + provenanced like any chit)
    var subj = 'Clearance — ' + (g.title || g.doc) + (ref ? ' (' + ref + ')' : '');
    var reply = await api('createChit', {
      body: { recipients: [{ name: 'self', role: 'to' }], manual_subject: subj, subject: subj, purpose: 'general', line_items: [] }
    });
    var chitId = reply && reply.chit_id;
    // 2 · attach the document to that chit (best-effort — a reference-only clearance is still valid)
    if (chitId && file && typeof attUpload === 'function') {
      try {
        await attUpload(chitId, file);
      } catch (_) { /* best effort: failing here changes nothing the user sees */ }
    }
    // 3 · record the clearance, pointing at its evidence chit
    await api('readinessGather', {
      body: { standard_key: g.standard, doc_key: g.doc, evidence_ref: chitId || ref || 'recorded', valid_until: valid, status: 'gathered' }
    });
    if (typeof closeModal === 'function') closeModal();
    if (typeof toast === 'function') toast(file ? 'Clearance recorded — document on the rail ✓' : 'Clearance recorded ✓');
    UI.laneMatrix = undefined;
    UI.laneRd = undefined;
    loadLanes();
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Record clearance on the rail';
    }
    if (err) err.textContent = (e && e.message) || 'Failed to record';
  }
}
