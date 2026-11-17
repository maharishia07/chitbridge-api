/* app/cap-dispute.js — the DISPUTE capability (the USP), lazy-loaded via ensureCap('dispute').
 *
 * WHY LAZY + GATED: dispute is an itemised, opt-in capability (BRD-dispute BR-D6). An entity that
 * doesn't hold 'dispute' never loads this file and sees no dispute nav / banner / composer toggle /
 * advanced-search option. Core loads it once, on the /me capabilities check, only when opted in.
 *
 * WHY IT LIVES HERE (not Core): everything dispute-specific is in ONE module — the screen, the raise/
 * resolve flow, the on-record banner, the composer toggle, and the shared roster renderers — so the
 * behaviour has a single home and can't drift across surfaces.
 *
 * DEPENDS on Core globals (shared, NOT duplicated here): api, modal/closeModal, esc, nm (name+fallback),
 * val, toast, MSG, openChit, UI/SESSION, lazyWrap, menuAssist, cap, chitIsSelf (self/opponent — actor
 * resolves to its parent entity), and the EP rows dispute/disputes/resolveDispute/disputeQueue.
 *
 * OWNS      the Disputes list (Tasks › Disputes), the sheet's dispute section (raise · talk · resolve), the on-record banner.
 * CALLED BY tasks.html (CBDispute.mount · CBDispute.open for ?view=disputes&chit=), chit-sheet.js (the section), app.html (the workshop's screen).
 * FLOW      CBDispute.mount(el) → listLoad reads the disputeQueue a page at a time → the list draws on CBList and the pager; a row opens the chit sheet (open) → inSheet reads and paints the chit's disputes (sheetRead · sheetPaint) → raise asks for a reason of 10 letters or more and sends it through CBAction.run → resolveAsk takes the resolution note and the list is read again.
 * CARD 03-disputes-service-and-register/disputes-per-party-confidential
 */

/** a failure this screen survives, said in words in the page log (cblog) instead of swallowed */
function disputeLogFailure(what, failure) {
  if (typeof cblog === 'function') cblog('warn', 'disputes: ' + what + ' — ' + ((failure && failure.message) || 'no answer'));
}

/* ── Shared roster renderers — ONE definition, used by BOTH the banner and the Disputes screen (was
 *    duplicated in two places, hence wrong-name/scope drift). A "party" = a dispute_participants row
 *    with role='party'; we exclude the viewer via chitIsSelf so you never see yourself as an opponent. */
function disputeParties(dispute) {
  return (dispute.participants || []).filter(function (item) {
    return item.role === 'party' && !chitIsSelf(item.entity_id, item.display_name);
  });
}
function disputeChips(parties, chipCls) {
  return parties
    .map(function (item) {
      var done = item.dispute_status === 'resolved';
      return '<span class="' + (chipCls || 'dpchip') + (done ? ' ok' : '') + '">' + nm(item.display_name, 'party') + (done ? ' ✓' : '') + '</span>';
    })
    .join('');
}
/* Resolve buttons — only the OPEN parties, only shown to the raiser (caller decides via `show`). One
 * button per party (per-party resolution, BR-D3); if no per-party split, a single chit-wide Resolve. */
function disputeResolveBtns(parties, chitId, disputeId, show, btnCls) {
  if (!show) return '';
  var open = parties.filter(function (item) {
    return item.dispute_status !== 'resolved';
  });
  var className = btnCls || 'db-res';
  var inner = open.length
    ? open
        .map(function (item) {
          return (
            '<button data-cbsid="TSK006-B01" class="' +
            className +
            '" data-testid="dispute-resolve-open" onclick="resolveDispute(\'' +
            chitId +
            "','" +
            disputeId +
            "','" +
            item.entity_id +
            "','" +
            encodeURIComponent(item.display_name || 'party') +
            '\')">Resolve ' +
            nm(item.display_name, 'party') +
            '</button>'
          );
        })
        .join('')
    : '<button data-cbsid="TSK006-B02" class="' +
      className +
      '" data-testid="dispute-resolve-open" onclick="resolveDispute(\'' +
      chitId +
      "','" +
      disputeId +
      '\')">' +
      tx('Resolve') +
      '</button>';
  return inner;
}

/* (disputeOppLabel + disputeFilterChips removed 2026-07-05 — the general-thread per-dispute chips are
 *  superseded by the Open|Closed dispute panel + per-dispute rooms below.) */

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * MESSAGING + LIST HOOKS — 2nd lazy pass (2026-07-05). Every dispute-specific branch that used to
 * live inside Core's msgBubble / mapApiMsg / messagesTab / doSendMessage / row-cell now lives HERE.
 * Core calls each via (typeof fn==='function'), so a customer — or Core before this module finishes
 * loading — degrades to plain messaging with ZERO dispute knowledge. cap-dispute loads for every
 * non-customer on boot, so these resolve wherever a dispute message can surface.
 * RULE (Athi): from here on, ALL dispute behaviour lands in THIS file only — Core stays dispute-blind.
 * These five are the "messaging helper API" a message-type capability plugs into (badge / byline /
 * filter / send-decorator / row-cell); a future cap could register the same way.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */

/* mapApiMsg → split the trailing "— actor@entity" provenance a dispute message carries into a byline.
 * Returns {by, body}; on a plain message (or no marker) by=null and body is unchanged. */
function disputeByline(body) {
  var text = body || '';
  if (!text) return { by: null, body: text, kind: null };
  var by = null;
  var byMatch = text.match(/\s+[—-]\s+(\S+@.+?)\s*$/); // actor provenance "— name@entity" → byline (KEEP: shows as "· by …")
  if (byMatch) {
    by = byMatch[1].trim();
    text = text.slice(0, byMatch.index).replace(/\s+$/, '');
  }
  var kind = null;
  var prefixMatch = text.match(/^\[(resolved|quality|quantity|delivery|payment|docs|other)\]\s*/i); // dispute prefix → strip (the badge already says it)
  if (prefixMatch) {
    kind = /resolved/i.test(prefixMatch[1]) ? 'resolved' : 'raised';
    text = text.slice(prefixMatch[0].length);
  }
  return { by: by, body: text, kind: kind };
}
/* list row → the one-glance dispute count: N open (red) · M resolved (green); '' when neither. */

/* ── Advanced-search dispute filter (was inline in Core toolbar + adv modal). The ⚠ N chip surfaces on
 *    task/order lists when open disputes exist (or the filter is on); toggling adds dispute='open' to
 *    UI.adv. dispSearchRow = the checkbox inside the advanced-search modal. Core calls both via typeof,
 *    so a customer / dispute-blind Core just omits them.
 *    NOTE (FR-D12): a stricter hasCap('dispute') gate is deliberately NOT applied — a non-opted entity can
 *    still be a dispute TARGET and needs to find the disputed record. Revisit if opt-in must fully hide it. */
function dispChipHtml() {
  if (['task', 'order'].indexOf(UI.folder) < 0) return '';
  var openCount = UI.disputeOpen || 0,
    on = (UI.adv || {}).dispute;
  if (!openCount && !on) return '';
  return (
    '<button data-cbsid="TSK006-B03" class="advbtn' +
    (on ? ' on' : '') +
    '" style="color:var(--disp);border-color:#f0c9c6' +
    (on ? ';background:var(--danger-tint)' : '') +
    '" onclick="event.stopPropagation();toggleDisputeFilter()" title="Chits with an open dispute">⚠ ' +
    openCount +
    '</button>'
  );
}
/** the advanced-search toggle: show only chits with an open dispute, or clear that filter */
function toggleDisputeFilter() {
  var advanced = UI.adv || {};
  if (advanced.dispute) {
    delete advanced.dispute;
  } else {
    advanced.dispute = 'open';
  }
  UI.adv = advanced;
  UI.sel = null;
  UI.detail = null;
  renderApp();
}
function dispSearchRow(advanced) {
  advanced = advanced || {};
  return (
    '<div class="advrow"><label>' +
    tx('Dispute') +
    '</label><label class="advchk"><input data-cbsid="TSK006-I01" type="checkbox" id="adv_disp" ' +
    (advanced.dispute ? 'checked' : '') +
    '> ⚠ Only open disputes</label></div>'
  );
}

/* ── On-record DISPUTE PANEL (was the banner) — the USP as a self-contained space ON the chit.
 *    Open|Closed tabs; each dispute is a selectable row that expands into its OWN ROOM: reason + its own
 *    message thread (only THIS dispute's messages) + an external-only compose + raiser resolve. A CLOSED
 *    dispute keeps its thread READ-ONLY (messages live forever — chit_messages are never deleted and stay
 *    visible to participants regardless of status). 1 or many disputes = identical interaction: pick → room.
 *    Dispute messaging is external-only (participant-scoped); internal team notes use the normal Messages tab. */
/* Pick a dispute from the dropdown → its ROOM opens as an overlay over the detail pane; ✕ closes it.
 * Nothing open by default (UI.dispSel=null). One room at a time — 1 or N disputes look identical. */
function disputeSelect(disputeId) {
  UI.dispSel = disputeId || null;
  UI.dispCompose = false;
  UI.dispFiles = [];
  var node = document.getElementById('detailpane');
  if (node) node.style.position = 'relative'; // anchor the absolute overlay to the pane
  paintDetail();
}
function disputeClose() {
  UI.dispSel = null;
  UI.dispCompose = false;
  UI.dispFiles = [];
  paintDetail();
}
function dispOpp(dispute) {
  var list = disputeParties(dispute);
  return list.length
    ? list
        .map(function (x) {
          return x.display_name || 'party';
        })
        .join(', ')
    : nm(dispute.raised_by_display_name, 'party');
}
/** one <optgroup> (OPEN or CLOSED) of the dispute picker: category · with whom · status, the chosen one selected */
function dispOptGroup(list, label) {
  if (!list.length) return '';
  return (
    '<optgroup label="' +
    label +
    '">' +
    list
      .map(function (item) {
        return (
          '<option value="' +
          esc(item.dispute_id) +
          '"' +
          (String(UI.dispSel) === String(item.dispute_id) ? ' selected' : '') +
          '>' +
          esc(cap(item.category || '') + ' · with ' + dispOpp(item) + ' · ' + (item.status === 'open' ? '● open' : '✓ resolved')) +
          '</option>'
        );
      })
      .join('') +
    '</optgroup>'
  );
}
/* the DETAIL dropdown (always shown when disputes exist) + the overlay when one is picked */
function disputeBanner(chit) {
  var all = (chit && chit.disputes) || [];
  var open = all.filter(function (item) {
    return item.status === 'open';
  });
  var closed = all.filter(function (item) {
    return item.status !== 'open';
  });
  if (!open.length && !closed.length) return '';
  var proof = chit.proof === 'ok' ? '<span class="db-proof">' + tx('⚖️ both-signed record') + '</span>' : '';
  var head =
    '<div class="db-row"><span class="db-tag">⚑ ' +
    (open.length ? open.length + ' dispute' + (open.length > 1 ? 's' : '') + ' open on this record' : 'Disputes (resolved)') +
    '</span>' +
    proof +
    '</div>';
  var dropdown =
    '<select data-cbsid="TSK006-S01" aria-label="' + esc(tx('Dispute')) + '" onchange="disputeSelect(this.value)" style="width:100%;margin-top:9px;padding:10px 12px;border:1px solid #e5c9c6;border-radius:9px;font-size:var(--fs-2);background:var(--card);color:var(--on-card);cursor:pointer">' +
    '<option value="">— pick one —</option>' +
    dispOptGroup(open, 'OPEN') +
    dispOptGroup(closed, 'CLOSED') +
    '</select>';
  var selected = UI.dispSel
    ? all.filter(function (item) {
        return String(item.dispute_id) === String(UI.dispSel);
      })[0]
    : null; // stale id (other chit) → no overlay
  return '<div class="dispbanner">' + head + dropdown + '</div>' + (selected ? disputeOverlay(chit, selected, open, closed) : '');
}
/* the overlay frame over the detail pane: header + ✕, a dropdown to switch, and the room */
function disputeOverlay(chit, dispute, open, closed) {
  var proof = chit.proof === 'ok' ? '<span class="db-proof">' + tx('⚖️ both-signed record') + '</span>' : '';
  var dropdown =
    '<select data-cbsid="TSK006-S02" aria-label="' + esc(tx('Dispute')) + '" onchange="disputeSelect(this.value)" style="width:100%;margin-bottom:12px;padding:8px 11px;border:1px solid #e5c9c6;border-radius:9px;font-size:var(--fs-2);background:var(--card);color:var(--on-card);cursor:pointer">' +
    dispOptGroup(open, 'OPEN') +
    dispOptGroup(closed, 'CLOSED') +
    '</select>';
  return (
    '<div style="position:absolute;inset:0;background:var(--card);display:flex;flex-direction:column;z-index:30;color:var(--on-card)">' +
    '<div style="display:flex;align-items:center;gap:8px;padding:13px 16px;border-bottom:1px solid var(--line);background:var(--danger-tint);color:var(--on-card)">' +
    '<span style="font-weight:700;color:var(--disp);font-size:var(--fs-3)">⚑ ' +
    esc(cap(dispute.category || '')) +
    '</span>' +
    proof +
    '<button data-cbsid="TSK006-B04" onclick="aiDisputeSummary(\'' +
    chit.id +
    "','" +
    dispute.dispute_id +
    '\')" title="AI summarises this dispute neutrally — it does not decide it" style="margin-inline-start:auto;border:1px solid var(--purple);background:var(--purple-tint);color:var(--purple);border-radius:9px;padding:6px 11px;cursor:pointer;font-size:var(--fs-2)">' +
    tx('✨ Summarize') +
    '</button>' +
    '<button data-cbsid="TSK006-B05" onclick="disputeClose()" style="margin-inline-start:8px;border:1px solid var(--line);background:var(--card);border-radius:9px;padding:6px 12px;cursor:pointer;font-size:var(--fs-2);color:var(--on-card)">' +
    tx('✕ Close') +
    '</button></div>' +
    '<div style="padding:15px 16px;overflow:auto;flex:1">' +
    dropdown +
    disputeRoomBox(chit, dispute) +
    '</div></div>'
  );
}
// AI dispute summary — invoked, neutral, INFORMATIONAL (resolve stays human, raiser-only). Reuses the global _aiMd (app.html).
async function aiDisputeSummary(chitId, disputeId) {
  var chit = UI.detail;
  if (!chit) {
    if (typeof toast === 'function') toast('Open the dispute first');
    return;
  }
  var dispute = (chit.disputes || []).filter(function (x) {
    return String(x.dispute_id) === String(disputeId);
  })[0];
  if (!dispute) return;
  if (typeof modal !== 'function' || typeof _aiMd !== 'function') {
    if (typeof toast === 'function') toast('AI unavailable here');
    return;
  }
  var msgs = (chit.dispMsgs || {})[dispute.dispute_id] || []; /* the room's rows as CBThread listed them (rtMountAll onList) */
  var ctx = {
    category: dispute.category,
    status: dispute.status,
    raised_by: dispute.raised_by_display_name,
    subject: chit.code,
    thread: msgs.map(function (item) {
      return { from: item.sender_display_name || item.from || '', text: item.message_text || item.body || '' };
    })
  };
  modal(
    '<div class="mhd"><div class="t">' +
      tx('✨ Summarize dispute') +
      '</div></div><div class="mbody" style="padding:16px"><div id="adbody" style="font-size:var(--fs-2);color:var(--grey)">✨ Summarizing…</div></div>',
    true
  );
  try {
    var res = await fetch(CFG.API_BASE + '/api/governance/ai-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token },
      body: JSON.stringify({ skill_id: 'dispute-summary', context: ctx })
    });
    var payload = await res.json();
    if (!res.ok || !payload || !payload.draft) throw new Error((payload && payload.message) || (res.status === 503 ? 'AI is not connected on this environment.' : 'Summary failed'));
    var html =
      '<style>' +
      (typeof _AI_MDCSS !== 'undefined' ? _AI_MDCSS : '') +
      '</style>' +
      '<div style="font-size:var(--fs-1);color:var(--purple);background:var(--blue-tint-bg);border:1px solid #ddd4f5;border-radius:9px;padding:8px 11px;margin-bottom:12px;line-height:1.5">🤖 <b>AI summary</b> — it does not decide the dispute. ' +
      (payload.usage ? '<span style="color:var(--grey)">· $' + payload.usage.est_cost_usd + '</span>' : '') +
      '</div>' +
      '<div class="amddoc" style="background:var(--card);border:1px solid var(--line);border-radius:9px;padding:15px 17px;max-height:56vh;overflow:auto;color:var(--on-card)">' +
      _aiMd(payload.draft) +
      '</div>' +
      '<div style="margin-top:12px;text-align:end"><button data-cbsid="TSK006-B06" onclick="closeModal()" style="font-size:var(--fs-2);font-weight:700;border:1px solid var(--line);background:var(--card);border-radius:9px;padding:9px 16px;cursor:pointer;color:var(--on-card)">' +
      tx('Done') +
      '</button></div>';
    var node = document.getElementById('adbody');
    if (node) node.innerHTML = html;
  } catch (e) {
    var bodyNode = document.getElementById('adbody');
    if (bodyNode)
      bodyNode.innerHTML =
        '<div style="font-size:var(--fs-2);color:var(--warn-2);background:var(--warn-tint);border:1px solid #f0dcae;border-radius:9px;padding:10px 12px">' +
        esc((e && e.message) || 'Summary failed') +
        '</div>';
  }
}
// AI resolution wording — invoked, neutral DRAFT; the raiser still decides whether to resolve (human gate holds). Reuses global aiRun.
function aiResolutionSuggest(chitId, disputeId) {
  var chit = UI.detail;
  if (!chit || typeof aiRun !== 'function') return;
  var dispute = (chit.disputes || []).filter(function (x) {
    return String(x.dispute_id) === String(disputeId);
  })[0];
  if (!dispute) return;
  var msgs = (chit.dispMsgs || {})[dispute.dispute_id] || []; /* the room's rows as CBThread listed them (rtMountAll onList) */
  aiRun(
    'resolution-suggest',
    {
      category: dispute.category,
      raised_by: dispute.raised_by_display_name,
      subject: chit.code,
      thread: msgs.map(function (item) {
        return { from: item.sender_display_name || item.from || '', text: item.message_text || item.body || '' };
      })
    },
    { title: '✨ Suggested resolution wording' }
  );
}
/** RAIL-121 (walk 2026-10-25 W17): the room names BOTH sides. `parties` leaves the viewer out (you are not your own opponent), which made the party that did not raise it
 *  see only the raiser; here the viewer is listed too, marked "(you)", so everyone reads the same two names. */
function disputeRoster(dispute, parties, mine) {
  var mineRows = (dispute.participants || []).filter(function (item) {
    return item.role === 'party' && chitIsSelf(item.entity_id, item.display_name) && String(item.display_name || '') !== String(dispute.raised_by_display_name || '');
  });
  return [nm(dispute.raised_by_display_name, '—') + ' (raiser)' + (mine ? ' (' + tx('you') + ')' : '')]
    .concat(
      mineRows.map(function (item) {
        return nm(item.display_name, 'party') + ' (' + tx('you') + ')';
      }),
      parties.map(function (item) {
        return nm(item.display_name, 'party');
      })
    )
    .join(' · ');
}
/* one dispute's room: participants · own message wall (latest first, attachments) · New-message (text+attach) · Resolve */
function disputeRoomBox(chit, dispute) {
  var readonly = dispute.status !== 'open';
  var mine = chitIsSelf(dispute.raised_by_entity_id, dispute.raised_by_display_name);
  var parties = disputeParties(dispute);
  var statusChip = readonly
    ? '<span style="color:var(--ok-2);font-size:var(--fs-1);font-weight:700">' + tx('✓ resolved') + '</span>'
    : '<span style="color:var(--disp);font-size:var(--fs-1);font-weight:700">' + tx('● open') + '</span>';
  var resolve = readonly ? '' : disputeResolveBtns(parties, chit.id, dispute.dispute_id, mine, 'db-res');
  var suggestBtn =
    readonly || typeof aiRun !== 'function'
      ? ''
      : '<button data-cbsid="TSK006-B07" onclick="aiResolutionSuggest(\'' +
        chit.id +
        "','" +
        dispute.dispute_id +
        '\')" title="AI suggests neutral resolution wording — you decide whether to resolve" style="font-size:var(--fs-1);font-weight:700;border:1px solid var(--purple);background:var(--purple-tint);color:var(--purple);border-radius:6px;padding:5px 10px;cursor:pointer">' +
        tx('✨ Suggest wording') +
        '</button>';
  var resolveWrap = resolve || suggestBtn ? '<span style="display:inline-flex;gap:6px;flex-wrap:wrap">' + suggestBtn + resolve + '</span>' : '';
  var roster = disputeRoster(dispute, parties, mine);
  var to = parties.length
    ? parties
        .map(function (item) {
          return item.display_name || 'party';
        })
        .join(', ')
    : 'participants';
  /* ⭐ R02 — the room's thread IS CBThread (app/rail-thread.js), mounted by app.html's rtMountAll after the paint: dispute-scoped
     (is_dispute + dispute_id, external only — the roster's audience), read-only once resolved; the test ids the dispute specs drive. */
  var host =
    '<div data-rt="' +
    esc(
      JSON.stringify({
        chit_id: chit.id,
        dispute_id: dispute.dispute_id,
        channel: 'external',
        readOnly: readonly,
        party: to,
        ids: { text: 'dispute-room-input', send: 'dispute-room-send' }
      })
    ) +
    '" data-testid="rt-disp"></div>';
  return (
    '<div style="border:1px solid #f0c9c6;border-radius:12px;padding:13px 14px">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="db-cat">' +
    esc(cap(dispute.category || '')) +
    '</span>' +
    (parties.length ? '<span style="font-size:var(--fs-2);color:var(--grey)">with ' + disputeChips(parties, 'dpchip') + '</span>' : '') +
    '<span style="margin-inline-start:auto;display:inline-flex;gap:9px;align-items:center">' +
    statusChip +
    resolveWrap +
    '</span></div>' +
    '<div style="font-size:var(--fs-2);color:var(--grey-2);margin:10px 0 2px">Participants: <b>' +
    esc(roster) +
    '</b></div>' +
    '<div style="display:flex;align-items:center;margin:13px 0 7px"><span style="font-size:var(--fs-2);font-weight:700;color:var(--grey-2)">' +
    tx('Messages · latest first') +
    '</span></div>' +
    '<div style="max-height:420px;overflow:auto">' +
    host +
    '</div></div>'
  );
}
/* Composer "reply in the dispute" toggle + per-dispute filter chips REMOVED 2026-07-05 — dispute messaging
 * moved INTO each dispute's room (see disputeRoom/sendDisputeMsg above). The general Messages tab is now
 * normal (Internal/External only, dispute messages hidden). Dispute channel = external-only, in the room. */

/* ── Disputes screen (the opt-in queue, BR-D4): every disputed record, split raised-by-you / against-you,
 *    each card reusing the shared roster renderers. Loaded lazily; the nav is capability-gated. */
function disputesScreen() {
  return (
    '<div style="padding:14px;max-width:760px;margin:0 auto"><div class="sec" style="font-size:var(--fs-3);margin-bottom:3px;display:flex;align-items:center;gap:9px">' +
    tx('⚖️ Disputes') +
    '<button data-cbsid="TSK006-B08" onclick="openAssist(\'disputes\')" title="About this screen" style="border:1px solid var(--line);background:var(--card);color:var(--blue);border-radius:50%;width:22px;height:22px;font-weight:800;cursor:pointer;font-size:13px;line-height:1;flex:none">?</button></div><div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:10px">' +
    txf('Explore {q} to know more about this screen.', { q: '<b data-cbsid="TSK006-C01" onclick="openAssist(\'disputes\')" style="cursor:pointer;color:var(--blue)">?</b>' }) +
    '</div><div id="disprows"><div class="loadwrap"><span class="spin"></span> loading…</div></div></div>'
  );
}
/**
 * ── ⭐⭐ THE DISPUTE QUEUE — the one list where "how long has this been open" is the question ────────────────────
 *
 * ⚠️⚠️ THE TWO SECTIONS ARE A MODE, NOT A FILTER, and they stay. "Raised by you" and "Against you" are two
 * different jobs — one you are pursuing, one you are answering — and collapsing them into a dropdown would make
 * a person choose a side before seeing that they have work on both. The controls sit ABOVE both and narrow
 * both, so a search for "damaged" shows what you raised and what was raised against you, still separated.
 *
 * ⚠️ OLDEST FIRST IS THE DEFAULT, and it is the server's own order — deliberately, because it is the opposite
 * of every other list here. Everywhere else the newest thing is the interesting one; in a dispute queue the
 * OLDEST open item is the one rotting, and putting it at the bottom is how it stays there.
 */
var _DISP = { mine: [], other: [], loaded: false };

/** the Disputes list's controls (listCtl): the search text and a filter over the categories present */
function dispCtl() {
  var all = _DISP.mine.concat(_DISP.other);
  var cats = [];
  all.forEach(function (item) {
    if (item.category && cats.indexOf(item.category) < 0) cats.push(item.category);
  });
  cats.sort();
  return listCtl('disputes', {
    rows: function () {
      return _DISP.mine.concat(_DISP.other);
    },
    text: function (dispute) {
      return [dispute.auto_subject, dispute.purpose, dispute.category, dispute.reason, dispute.raised_by_display_name, dispute.scope, dispute.resolution_note].filter(Boolean).join(' ');
    },
    noun: tx('dispute'),
    plural: tx('disputes'),
    filters: [
      /* ⭐ OPEN FIRST, because a resolved dispute is a record and an open one is work. */
      {
        key: 'status',
        label: tx('Status'),
        all: tx('Open and resolved'),
        options: [
          { v: 'open', label: tx('Still open') },
          { v: 'resolved', label: tx('Resolved') }
        ],
        match: function (dispute, value) {
          return value === 'open' ? dispute.status === 'open' : dispute.status !== 'open';
        }
      }
    ].concat(
      cats.length > 1
        ? [
            {
              key: 'category',
              label: tx('Kind'),
              all: tx('Every kind'),
              options: cats.map(function (item) {
                return { v: item, label: cap(item) };
              }),
              match: function (dispute, value) {
                return dispute.category === value;
              }
            }
          ]
        : []
    ),
    sorts: [
      {
        key: 'old',
        label: tx('Oldest first'),
        cmp: function (left, right) {
          return Date.parse(left.created_at || 0) - Date.parse(right.created_at || 0);
        }
      },
      {
        key: 'new',
        label: tx('Newest first'),
        cmp: function (left, right) {
          return Date.parse(right.created_at || 0) - Date.parse(left.created_at || 0);
        }
      },
      {
        key: 'kind',
        label: tx('By kind'),
        cmp: function (left, right) {
          return String(left.category || '').localeCompare(String(right.category || ''));
        }
      }
    ],
    repaint: function () {
      paintDisputes();
    }
  });
}

/** one dispute, as a card. canResolve = the "raised by you" side (raiser-only resolve, BR-D3). */
function dispCardHTML(dispute, canResolve) {
  var parties = disputeParties(dispute);
  var roster = parties.length
    ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">' +
      parties
        .map(function (item) {
          return (
            '<span class="optchip ' +
            (item.dispute_status === 'resolved' ? 'on' : 'brk') +
            '">' +
            nm(item.display_name, 'party') +
            ' · ' +
            (item.dispute_status === 'resolved' ? '✓ resolved' : 'open') +
            '</span>'
          );
        })
        .join('') +
      '</div>'
    : '';
  var btns = disputeResolveBtns(parties, dispute.chit_id, dispute.dispute_id, canResolve && dispute.status === 'open', 'composebtn');
  var resolveRow = btns ? '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' + btns + '</div>' : '';
  return (
    '<div class="card" data-testid="disp-card" style="border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:9px">' +
    '<div style="display:flex;justify-content:space-between;gap:8px"><b>' +
    esc(dispute.auto_subject || dispute.purpose || 'chit') +
    '</b><span class="optchip ' +
    (dispute.status === 'open' ? 'brk' : 'on') +
    '">' +
    esc(dispute.status) +
    '</span></div>' +
    '<div style="font-size:var(--fs-2);color:var(--ink);margin:5px 0"><b>' +
    esc(cap(dispute.category || '')) +
    '</b> — ' +
    esc(dispute.reason || '') +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey)">raised by ' +
    nm(dispute.raised_by_display_name, '—') +
    ' · ' +
    esc(dispute.scope || '') +
    (dispute.resolution_note ? ' · ✓ ' + esc(dispute.resolution_note) : '') +
    '</div>' +
    roster +
    resolveRow +
    '</div>'
  );
}

/**
 * ⭐ PAINT, SEPARATE FROM LOAD. Every control repaints; none of them refetches. Asking the server again because
 * somebody typed a letter is how a search box becomes slow enough to feel broken.
 * [[feedback-loader-never-repaints-open-form]]
 */
function paintDisputes() {
  var host = document.getElementById('disprows');
  if (!host) return;
  dispCtl();
  var matched = listCtlView('disputes').matched;
  var inSet = {};
  matched.forEach(function (item) {
    inSet[item.dispute_id] = 1;
  });
  var mine = _DISP.mine.filter(function (item) {
    return inSet[item.dispute_id];
  });
  var other = _DISP.other.filter(function (item) {
    return inSet[item.dispute_id];
  });
  /* ⚠️ the sections keep the ENGINE's order, not the server's — filter() above preserves _DISP order, so each
     section is re-ordered here to match whatever sort is chosen. */
  var pos = {};
  matched.forEach(function (item, index) {
    pos[item.dispute_id] = index;
  });
  var byOrder = function (left, right) {
    return pos[left.dispute_id] - pos[right.dispute_id];
  };
  mine.sort(byOrder);
  other.sort(byOrder);
  var none = '<div style="color:var(--grey);font-size:var(--fs-2);padding:6px">None</div>';
  host.innerHTML =
    menuAssist('disputes') +
    '<div style="margin:2px 0 4px;font-size:var(--fs-1);color:var(--grey)" id="disp_count">' +
    listCtlCountHTML('disputes') +
    '</div>' +
    listCtlToolbarHTML('disputes') +
    '<div class="sec" style="font-size:var(--fs-2);color:var(--grey);margin:12px 0 4px">' +
    tx('Raised by you') +
    ' (' +
    mine.length +
    ')</div>' +
    lazyWrap(
      'dm',
      mine,
      function (dispute) {
        return dispCardHTML(dispute, true);
      },
      none
    ) +
    '<div class="sec" style="font-size:var(--fs-2);color:var(--grey);margin:14px 0 4px">' +
    tx('Against you / awaiting') +
    ' (' +
    other.length +
    ')</div>' +
    lazyWrap(
      'do',
      other,
      function (dispute) {
        return dispCardHTML(dispute, false);
      },
      none
    );
}

/** fetch the dispute queue (mine and the other party's) into _DISP and paint the rows */
async function loadDisputes() {
  var host = document.getElementById('disprows');
  if (!host) return;
  try {
    var reply = await api('disputeQueue');
    _DISP.mine = reply.my_disputes || [];
    _DISP.other = reply.other_disputes || [];
    _DISP.loaded = true;
    /* ⚠️ a fresh read is a fresh list: whatever was revealed of the old one means nothing about this one */
    try {
      if (LAZY) {
        delete LAZY.dm;
        delete LAZY.do;
      }
    } catch (failure) {
      disputeLogFailure('the revealed-state of the old list was not reset', failure); // the disputes are repainted just below
    }
    paintDisputes();
  } catch (e) {
    host.innerHTML = scrErr(e, tx('disputes'), 'loadDisputes()');
  }
}

/* ── Raise flow (FR-D1): candidates = everyone on the chit except me (chitIsSelf); ticking parties makes
 *    it a TARGETED dispute (only those parties see it, BR-D2); none ticked = chit-wide. */
async function quickDispute(idArg, opt) {
  var ids = idArg ? [idArg] : typeof needTarget === 'function' ? needTarget() : [];
  if (!ids.length) return;
  if (ids.length > 1) {
    toast('Raise a dispute on one chit at a time — each is its own matter.');
    return;
  }
  var id = ids[0];
  MODALS.disp = { id, parties: [], back: !!(opt && opt.back) };
  var partyRows = '';
  try {
    var reply = await api('chit', { params: { id } });
    var header = (reply && reply.header) || reply || {};
    var seen = {};
    var parties = (header.all_recipients || []).filter(function (x) {
      return x && x.entity_id && !chitIsSelf(x.entity_id, x.display_name) && !seen[x.entity_id] && (seen[x.entity_id] = 1);
    });
    MODALS.disp.parties = parties;
    if (parties.length) {
      partyRows =
        '<div style="font-size:var(--fs-2);color:var(--grey);margin:9px 0 3px">Which parties <span style="color:#9aa3ad">(none = all involved)</span></div>' +
        parties
          .map(function (item) {
            return (
              '<label style="display:flex;gap:8px;align-items:center;padding:3px 0;font-size:var(--fs-2);cursor:pointer"><input data-cbsid="TSK006-I02" type="checkbox" class="dispparty" value="' +
              item.entity_id +
              '"> ' +
              nm(item.display_name, 'party') +
              ' <span style="font-size:var(--fs-1);color:var(--grey);text-transform:uppercase">' +
              esc(item.role || '') +
              '</span></label>'
            );
          })
          .join('');
    }
  } catch (failure) {
    disputeLogFailure('the parties to tick could not be read, the form opens without them', failure); // it then raises against everyone involved
  }
  ui.dialog({
    mount: 'TSK006-U01', pop: 'POP189', titleText: tx('⚑ Raise dispute'),
    body:
      '<div style="font-size:var(--fs-2);color:var(--grey);margin-bottom:7px">Category, reason (10+ characters)<br>Parties get notified</div><select data-cbsid="TSK006-S03" id="dispcat" data-testid="dispute-category" style="width:100%;margin-bottom:8px;padding:8px;border:1px solid var(--line);border-radius:6px"><option value="quality">' +
      tx('Quality') +
      '</option><option value="quantity">' +
      tx('Quantity') +
      '</option><option value="delivery">' +
      tx('Delivery') +
      '</option><option value="payment">' +
      tx('Payment') +
      '</option><option value="docs">' +
      tx('Docs') +
      '</option><option value="other" selected>' +
      tx('Other') +
      '</option></select>' +
      partyRows +
      '<textarea data-cbsid="TSK006-T01" id="dispreason" data-testid="dispute-reason" oninput="window.CBOffline&&CBOffline.saveDraft(\'disp.reason.' +
      id +
      '\',this.value)" placeholder="e.g. Quantity short by 2 units — please replace">' +
      esc((window.CBOffline && CBOffline.loadDraft('disp.reason.' + id)) || '') +
      '</textarea>',
    footerHtml: '<button data-cbsid="TSK006-B09" onclick="closeModal()">' +
      tx('Cancel') +
      '</button><button data-cbsid="TSK006-B10" class="danger" data-testid="dispute-raise" onclick="confirmDispute()">' +
      tx('Raise dispute') +
      '</button>'
  });
}
/** raise the dispute from the sheet: a reason of at least 10 characters and a category, then POST it */
async function confirmDispute() {
  var id = MODALS.disp.id,
    back = !!MODALS.disp.back;
  var el = document.getElementById('dispreason');
  var reason = (el ? el.value : '').trim();
  var node = (document.getElementById('dispcat') || {}).value || 'other';
  if (reason.length < 10) {
    toast('Reason must be at least 10 characters');
    return;
  }
  var parties = [].slice.call(document.querySelectorAll('.dispparty:checked')).map(function (e) {
    return e.value;
  });
  closeModal();
  var body = { category: node, reason };
  if (parties.length) body.participant_entity_ids = parties;
  try {
    var _dr2 = await api('dispute', { params: { id }, body });
    if (window.CBOffline) CBOffline.clearDraft('disp.reason.' + id);
    if (_dr2 && _dr2.warning) toast(_dr2.warning);
    var rowIndex = UI.rows.findIndex(function (x) {
      return x.id === id;
    });
    if (rowIndex >= 0) UI.rows[rowIndex].dispute = true;
  } catch (e) {
    toast(MSG.fail('raise the dispute', e));
    return;
  }
  if (typeof refreshRollup === 'function') refreshRollup();
  toast(MSG.disputeRaised(1));
  if (typeof announce === 'function') announce('Dispute raised');
  if (back && typeof openChitSheet === 'function') {
    openChitSheet(id);
    return;
  } /* raised from the chit sheet: back to the sheet, the page behind untouched */
  if (UI.sel === id) {
    UI.dtab = 'messages';
    await openChit(id);
  } else {
    renderApp();
  }
}

/* ── Resolve flow (BR-D3): raiser-only; per party (partyId) or chit-wide (no partyId). */
function resolveDispute(chitId, disputeId, partyId, partyNameEnc) {
  var partyName = partyNameEnc ? decodeURIComponent(partyNameEnc) : '';
  var withParty = partyName
    ? '<div style="font-size:var(--fs-2);color:var(--grey);margin-bottom:8px">Resolving with <b>' +
      esc(partyName) +
      '</b>; others stay open</div>'
    : '';
  ui.dialog({
    mount: 'TSK006-U02', pop: 'POP065', titleText: 'Resolve dispute' + (partyName ? ' — ' + partyName : ''),
    body: withParty +
      '<label class="fl">' +
      tx('Resolution note (required)') +
      '</label><textarea data-cbsid="TSK006-T02" id="resnote" data-testid="dispute-resolve-note" oninput="window.CBOffline&&CBOffline.saveDraft(\'disp.resolve.' +
      disputeId +
      '\',this.value)" placeholder="How was this resolved…">' +
      esc((window.CBOffline && CBOffline.loadDraft('disp.resolve.' + disputeId)) || '') +
      '</textarea><div class="err" id="res_err"></div>',
    footerHtml: '<button data-cbsid="TSK006-B11" onclick="closeModal()">' +
      tx('Cancel') +
      '</button><button data-cbsid="TSK006-B12" class="pri" data-testid="dispute-resolve-submit" onclick="submitResolve(\'' +
      chitId +
      "','" +
      disputeId +
      "','" +
      (partyId || '') +
      '\')">' +
      tx('Resolve') +
      '</button>'
  });
}
/** resolve a dispute: a resolution note is required, then POST it and say so */
async function submitResolve(chitId, disputeId, partyId) {
  var note = val('resnote');
  var err = document.getElementById('res_err');
  if (err) err.textContent = '';
  if (!note) {
    if (err) err.textContent = 'A resolution note is required.';
    return;
  }
  var body = { resolution_note: note };
  if (partyId) body.target_entity_id = partyId;
  try {
    var reply = await api('resolveDispute', { params: { id: chitId, disputeId }, body });
    if (window.CBOffline) CBOffline.clearDraft('disp.resolve.' + disputeId);
    closeModal();
    toast(MSG.disputeResolved());
    if (document.getElementById('disprows')) loadDisputes();
    if (UI.sel === chitId) {
      var rowIndex = UI.rows.findIndex(function (x) {
        return x.id === chitId;
      });
      // FULLY resolved → 0 open, but bump the resolved count so openChit STILL fetches disputes (else the Closed
      // dispute + its wall vanish). Partial (per-party) resolve leaves dispute=true, so the fetch already fires.
      if (rowIndex >= 0 && reply && reply.status === 'resolved') {
        UI.rows[rowIndex].dispute = false;
        UI.rows[rowIndex].dispResolved = (UI.rows[rowIndex].dispResolved || 0) + 1;
      }
      await openChit(chitId);
    }
  } catch (e) {
    if (err) err.textContent = e.message;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * ⭐ CBDispute — THE DISPUTE CAPABILITY IN A SMALL APP (T3-DISPUTES-ASSIST, 14 Oct: CB Tasks & Orders › Disputes; a dispute is work).
 *
 * The SAME capability as the workshop screen above, carried by this file so there is one home for dispute behaviour — but drawn the
 * small app's way, needing none of the workshop's globals (UI · modal · listCtl · lazyWrap · chitIsSelf):
 *   mount(el)          the list — CBList, server-paged (GET /chits/disputes/queue ?status · side · q · sort · page · limit): search,
 *                      filters (Where it is · Side), sort (oldest first — the queue's own rule, above), the pager, the count. A row opens
 *                      the CHIT SHEET (CBSheet.open — the one chit popup), never a page of its own.
 *   inSheet(el, id)    the chit sheet's dispute section (chit-sheet.js gives it a place): each dispute with whom · why · where it stands,
 *                      its own room (CBThread, dispute-scoped), Resolve and Raise — shown always, greyed WITH the server's sentence
 *                      (GET /chits/:id/disputes → actions.raise · disputes[].actions.resolve, api lib/dispute-may). Who a dispute may name
 *                      is the server's (raise_parties); "with whom" is the server's (others) — the page decides nothing.
 * Every write goes through CBAction (M64): Raise (POST /chits/:id/disputes) · Resolve (PUT …/resolve, per party or all).
 * REUSE: CBList (list-ctl.js) · CBSheet (chit-sheet.js) · CBThread (rail-thread.js) · CBAction (accounts-shell.js) · CBTasks.actRow
 *   (cap-tasks.js) · disputeByline (above) · CB_DISPUTE_EP (accounts-shell.js) · CBLocale.date.
 * Flow (docs/process/flows.json, rows added this round): DSP step 1 · raise (mount · raise) · DSP step 2 · resolve (inSheet · resolve).
 * NEW PATH (rule 4): the workshop's list (paintDisputes) and forms (quickDispute · resolveDispute) are app.html modals over its globals and
 *   ask nothing of the server; lifting them would have meant shimming six globals into every small app. The workshop keeps them; moving
 *   app.html onto CBDispute is the next step (named in the PR).
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var node = { el: null, rows: [], total: 0, page: 1, limit: 50, counts: null, q: '', filt: { status: 'open' }, sort: 'old', list: null, focus: null };
  var sheetState = { id: null, el: null, data: null, err: null, raising: false, talk: {}, threads: {} };
  var KIND = { quality: 'Quality', quantity: 'Quantity', delivery: 'Delivery', payment: 'Payment', docs: 'Documents', other: 'Other' };

  function T(words) {
    return typeof root.tx === 'function' ? root.tx(words) : words;
  }
  function $(id) {
    return root.document.getElementById(id);
  }
  function say(level, msg) {
    if (typeof root.cblog === 'function') root.cblog(level, msg);
  }
  function call(key, options) {
    if (typeof EP !== 'undefined' && root.CB_DISPUTE_EP) for (var name in root.CB_DISPUTE_EP) if (!EP[name]) EP[name] = root.CB_DISPUTE_EP[name];
    return root.api(key, options);
  }
  function kindWord(kind) {
    return T(KIND[kind] || 'Other');
  }
  function dayWord(ts) {
    if (!ts) return '';
    try {
      return root.CBLocale.date(ts, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      say('warn', 'dispute date unreadable: ' + ts);
      return String(ts).slice(0, 10);
    }
  }
  function withWord(dispute) {
    return (
      (dispute.others || [])
        .map(function (item) {
          return item.display_name || T('a party');
        })
        .join(', ') || T('everyone on the chit')
    );
  }
  function actRow(id, label, verdict, extra, className, stampCode) {
    return root.CBTasks.actRow(id, label, verdict, extra, className, stampCode);
  }
  function failWords(e, what) {
    if (e && e.status === 403) return T('This sign-in cannot open disputes');
    if (e && e.status === 404) return T("Couldn't find") + ' ' + T(what);
    return T("Couldn't read") + ' ' + T(what) + '. ' + T('Check the connection and try again.');
  }

  /* ── the list (DSP step 1 · the queue) ── */
  function query() {
    var params = { status: node.filt.status || 'all', sort: node.sort, page: node.page, limit: node.limit };
    if (node.filt.side) params.side = node.filt.side;
    if (node.q) params.q = node.q;
    return params;
  }
  function listLoad() {
    return call('disputeQueue', { query: query() }).then(
      function (reply) {
        reply = reply || {};
        if (reply.code === 'DISPUTES_NOT_SET_UP') return listFail(null, T('Disputes are not set up on this server yet.'));
        node.rows = Array.isArray(reply.rows) ? reply.rows : [];
        node.total = reply.total == null ? node.rows.length : Number(reply.total);
        node.counts = reply.counts || null;
        if (!node.list) listMount();
        else
          node.list.refresh({
            rows: function () {
              return node.rows;
            }
          });
        bar();
      },
      function (e) {
        say('error', 'disputes: the queue could not be read — ' + ((e && e.message) || e));
        listFail(e);
      }
    );
  }
  function listFail(e, words) {
    if (!node.el) return;
    if (node.list) {
      try {
        node.list.destroy();
      } catch (x) {
        say('warn', 'disputes: list teardown — ' + x.message);
      }
      node.list = null;
    }
    node.el.innerHTML =
      '<div class="empty" data-testid="dp-fail"><div class="t">' +
      esc(words || failWords(e, 'the disputes')) +
      '</div>' +
      '<button data-cbsid="TSK006-B13" type="button" class="act" id="dp_retry" data-testid="dp-retry">' +
      esc(T('Try again')) +
      '</button></div>';
    $('dp_retry').onclick = function () {
      mount(node.el);
    };
  }
  function bar() {
    var barNode = $('dp_bar');
    if (!barNode) return;
    var counts = node.counts;
    barNode.innerHTML = counts
      ? '<span class="tk-count" data-testid="dp-count"><b>' +
        esc(counts.open) +
        '</b> ' +
        esc(T('open')) +
        ' · ' +
        esc(counts.resolved) +
        ' ' +
        esc(T('resolved')) +
        '</span>'
      : '';
  }
  function pages() {
    return Math.max(1, Math.ceil(node.total / node.limit));
  }
  function pagerHTML() {
    if (node.total <= node.limit) return '';
    var pageCount = pages();
    return (
      '<div class="tk-act dp-pager" data-testid="dp-pager"><button data-cbsid="TSK006-B14" type="button" class="act quiet" data-dp-page="-1" data-testid="dp-prev"' +
      (node.page <= 1 ? ' disabled' : '') +
      '>‹ ' +
      esc(T('Back')) +
      '</button>' +
      '<span class="sub" data-testid="dp-page">' +
      esc(T('Page')) +
      ' ' +
      node.page +
      ' ' +
      esc(T('of')) +
      ' ' +
      pageCount +
      '</span>' +
      '<button data-cbsid="TSK006-B15" type="button" class="act quiet" data-dp-page="1" data-testid="dp-next"' +
      (node.page >= pageCount ? ' disabled' : '') +
      '>' +
      esc(T('Next')) +
      ' ›</button></div>'
    );
  }
  function whereCell(dispute) {
    var nestedOpen = dispute.status === 'open';
    return (
      '<span class="tag ' +
      (nestedOpen ? 'amber' : 'green') +
      '" data-testid="dp-word-' +
      esc(dispute.dispute_id) +
      '">' +
      esc(T(nestedOpen ? 'Open' : 'Resolved')) +
      '</span> ' +
      '<span class="sub">' +
      esc(T(dispute.mine ? 'You raised' : 'Against you')) +
      '</span>'
    );
  }
  function cols() {
    return [
      {
        key: 'what',
        label: T('What'),
        prio: 1,
        w: 240,
        html: true,
        value: function (dispute) {
          return dispute.auto_subject || '';
        },
        cell: function (dispute) {
          return '<b>' + esc(dispute.auto_subject || dispute.purpose || T('Chit')) + '</b> <span class="sub">' + esc(kindWord(dispute.category)) + '</span>';
        }
      },
      {
        key: 'where',
        label: T('Where it is'),
        prio: 2,
        w: 190,
        html: true,
        cell: whereCell,
        value: function (dispute) {
          return dispute.status;
        }
      },
      { key: 'with', label: T('With'), prio: 3, w: 170, cell: withWord, value: withWord },
      {
        key: 'why',
        label: T('Why'),
        prio: 4,
        w: 260,
        cell: function (dispute) {
          return dispute.reason || '';
        }
      },
      {
        key: 'when',
        label: T('Raised on'),
        prio: 5,
        w: 130,
        cell: function (dispute) {
          return dayWord(dispute.created_at);
        }
      },
      {
        key: 'note',
        label: T('How it ended'),
        prio: 6,
        w: 220,
        cell: function (dispute) {
          return dispute.resolution_note || '';
        }
      }
    ];
  }
  function listMount() {
    var host = $('dp_list');
    if (!host) return;
    node.list = root.CBList.mount(host, {
      key: 'disputes',
      t: T,
      rows: function () {
        return node.rows;
      },
      id: function (dispute) {
        return dispute.dispute_id;
      },
      rowTid: function (dispute) {
        return 'dp-row-' + dispute.dispute_id;
      },
      columns: cols(),
      defaultCols: ['what', 'where', 'with'],
      filters: [
        {
          key: 'status',
          label: T('Where it is'),
          all: T('Open and resolved'),
          options: [
            { v: 'open', label: T('Still open') },
            { v: 'resolved', label: T('Resolved') }
          ]
        },
        {
          key: 'side',
          label: T('Side'),
          all: T('Both sides'),
          options: [
            { v: 'mine', label: T('Raised by you') },
            { v: 'against', label: T('Against you') }
          ]
        }
      ],
      sorts: [
        { key: 'old', label: T('Oldest first') },
        { key: 'new', label: T('Newest first') }
      ],
      preset: { filt: { status: 'open' } },
      presetIsDefault: true /* UX-94: an empty "Still open" is the empty state below, not a filter that matches nothing */,
      remote: {
        filters: true,
        total: function () {
          return node.total;
        },
        foot: pagerHTML,
        onQuery: function (list) {
          node.q = String(list.q || '').trim();
          node.filt = list.filt || {};
          if (list.sort && list.sort.key) node.sort = list.sort.key === 'new' ? 'new' : 'old';
          node.page = 1;
          listLoad();
        }
      },
      onOpen: function (dispute) {
        open(dispute);
      },
      empty: { title: T('No disputes.'), sub: T('When you or the other side raise one on a bill or order, it shows here.') }
    });
  }
  /** a row → the chit sheet, with this dispute's room open (the sheet's dispute section reads the focus) */
  function open(picked) {
    node.focus = { chit: picked.chit_id, dispute: picked.dispute_id };
    if (root.CBSheet && root.CBSheet.open) return root.CBSheet.open(picked.chit_id);
    say('error', 'disputes: the chit sheet is not on this page');
  }
  function mount(el) {
    node.el = el;
    node.page = 1;
    if (node.list) {
      try {
        node.list.destroy();
      } catch (x) {
        say('warn', 'disputes: list teardown — ' + x.message);
      }
      node.list = null;
    }
    el.innerHTML =
      '<div class="tk-top" id="dp_bar" data-testid="dp-bar"></div><div class="tk-list" id="dp_list" data-testid="dp-list"><div class="loadwrap"><span class="spin"></span> ' +
      esc(T('Loading')) +
      '</div></div>';
    $('dp_list').innerHTML = '';
    el.onclick = function (e) {
      var pagerButton = e.target && e.target.closest ? e.target.closest('[data-dp-page]') : null;
      if (!pagerButton || pagerButton.disabled) return;
      node.page = Math.min(pages(), Math.max(1, node.page + Number(pagerButton.getAttribute('data-dp-page'))));
      listLoad();
    };
    return listLoad();
  }

  /* ── the chit sheet's section (DSP step 1 · raise · DSP step 2 · resolve) ── */
  function inSheet(el, id) {
    sheetState = { id: id, el: el, data: null, err: null, raising: false, talk: {}, threads: {} };
    if (node.focus && node.focus.chit === id && node.focus.dispute) sheetState.talk[node.focus.dispute] = true;
    sheetRead();
  }
  function sheetRead() {
    var id = sheetState.id,
      el = sheetState.el;
    return call('disputes', { params: { id: id } })
      .then(
        function (reply) {
          if (sheetState.id !== id) return;
          sheetState.data = reply || { disputes: [] };
          sheetState.err = null;
          sheetPaint();
        },
        function (e) {
          if (sheetState.id !== id) return;
          say('error', "disputes: this chit's disputes could not be read — " + ((e && e.message) || e));
          sheetState.err = failWords(e, 'the disputes on this chit');
          sheetPaint();
        }
      )
      .then(function () {
        return el;
      });
  }
  function disputeHTML(dispute) {
    var idText = esc(dispute.dispute_id);
    return (
      '<div class="tk-panel" data-testid="dp-one-' +
      idText +
      '">' +
      '<div class="tk-line-top"><b>' +
      esc(kindWord(dispute.category)) +
      '</b> ' +
      whereCell(dispute) +
      '</div>' +
      '<div class="sub" data-testid="dp-with-' +
      idText +
      '">' +
      esc(T('With')) +
      ' ' +
      esc(withWord(dispute)) +
      ' · ' +
      esc(T('raised by')) +
      ' ' +
      esc(dispute.raised_by_display_name || '') +
      ' · ' +
      esc(dayWord(dispute.created_at)) +
      '</div>' +
      '<div data-testid="dp-why-' +
      idText +
      '">' +
      esc(dispute.reason || '') +
      '</div>' +
      (dispute.resolution_note ? '<div class="sub">✓ ' + esc(dispute.resolution_note) + '</div>' : '') +
      '<div class="tk-line-acts">' +
      actRow('dp_res_' + idText, T('Resolve'), (dispute.actions && dispute.actions.resolve) || { ok: false, say: T('Resolve is not answered for this dispute') }, '', '', 'TSK006-B16') +
      '<div class="tk-act"><button data-cbsid="TSK006-B17" type="button" class="act quiet" id="dp_talk_' +
      idText +
      '" data-testid="dp_talk_' +
      idText +
      '">' +
      esc(T(sheetState.talk[dispute.dispute_id] ? 'Hide messages' : 'Messages')) +
      '</button></div></div>' +
      '<div id="dp_rmore_' +
      idText +
      '"></div>' +
      '<div id="dp_room_' +
      idText +
      '" data-testid="dp-room-' +
      idText +
      '"' +
      (sheetState.talk[dispute.dispute_id] ? '' : ' hidden') +
      '></div></div>'
    );
  }
  function raiseHTML() {
    var parties = (sheetState.data && sheetState.data.raise_parties) || [];
    return (
      '<div class="tk-panel" data-testid="dp-raise-form"><label class="sub" for="dp_cat">' +
      esc(T('What is wrong?')) +
      '</label>' +
      '<select data-cbsid="TSK006-S04" class="inp" id="dp_cat" data-testid="dp-cat">' +
      Object.keys(KIND)
        .map(function (item) {
          return '<option value="' + item + '"' + (item === 'other' ? ' selected' : '') + '>' + esc(kindWord(item)) + '</option>';
        })
        .join('') +
      '</select>' +
      '<label class="sub" for="dp_reason">' +
      esc(T('Say what happened (at least 10 letters)')) +
      '</label>' +
      '<textarea data-cbsid="TSK006-T03" class="inp" id="dp_reason" data-testid="dp-reason" rows="3" maxlength="1000"></textarea>' +
      (parties.length
        ? '<div class="sub">' +
          esc(T('Between which parties? None ticked = everyone on the chit.')) +
          '</div>' +
          parties
            .map(function (item, index) {
              return (
                '<label class="sub"><input data-cbsid="TSK006-I03" type="checkbox" class="dp-party" value="' +
                esc(item.entity_id) +
                '" data-testid="dp-party-' +
                index +
                '"> ' +
                esc(item.display_name || T('a party')) +
                '</label>'
              );
            })
            .join('')
        : '') +
      '<button data-cbsid="TSK006-B18" type="button" class="act" id="dp_raise_go" data-testid="dp-raise-go">' +
      esc(T('Raise dispute')) +
      '</button></div>'
    );
  }
  function sheetPaint() {
    var el = sheetState.el;
    if (!el) return;
    Object.keys(sheetState.threads).forEach(function (item) {
      try {
        sheetState.threads[item].destroy();
      } catch (x) {
        say('warn', 'disputes: room teardown — ' + x.message);
      }
    });
    sheetState.threads = {};
    var keep = $('dp_out') ? $('dp_out').textContent : '';
    var html = '<div class="cs-sec">' + esc(T('Disputes')) + '</div>';
    if (sheetState.err)
      html +=
        '<div class="cs-mute" data-testid="dp-sheet-fail">' +
        esc(sheetState.err) +
        ' <button data-cbsid="TSK006-B19" type="button" class="act quiet" id="dp_sheet_retry">' +
        esc(T('Try again')) +
        '</button></div>';
    else if (!sheetState.data) html += '<div class="cs-mute">' + esc(T('Reading…')) + '</div>';
    else {
      var list = sheetState.data.disputes || [];
      html += list.length ? list.map(disputeHTML).join('') : '<div class="sub" data-testid="dp-none">' + esc(T('No dispute on this chit.')) + '</div>';
      html +=
        actRow('dp_raise', T('⚑ Raise a dispute'), (sheetState.data.actions && sheetState.data.actions.raise) || { ok: false, say: T('Raise is not answered for this chit') }, '', '', 'TSK006-B20') +
        (sheetState.raising ? raiseHTML() : '');
    }
    html += '<div id="dp_out" class="tk-out" role="status" data-testid="dp-out">' + esc(keep) + '</div>';
    el.innerHTML = html;
    var element = $('dp_sheet_retry');
    if (element)
      element.onclick = function () {
        sheetState.err = null;
        sheetPaint();
        sheetRead();
      };
    if (!sheetState.data) return;
    var nestedNode = $('dp_raise');
    if (nestedNode && !nestedNode.disabled)
      nestedNode.onclick = function () {
        raiseAsk();
      };
    var localNode = $('dp_raise_go');
    if (localNode)
      localNode.onclick = function () {
        raise(localNode);
      };
    (sheetState.data.disputes || []).forEach(function (item) {
      var disputeKey = item.dispute_id,
        target = $('dp_res_' + disputeKey),
        innerNode = $('dp_talk_' + disputeKey);
      if (target && !target.disabled)
        target.onclick = function () {
          resolveAsk(item);
        };
      if (innerNode)
        innerNode.onclick = function () {
          sheetState.talk[disputeKey] = !sheetState.talk[disputeKey];
          sheetPaint();
        };
      if (sheetState.talk[disputeKey]) room(item);
    });
  }
  /** one dispute's room: CBThread, dispute-scoped (the roster's audience), read-only once resolved — mounted only when asked for */
  function room(dispute) {
    var box = $('dp_room_' + dispute.dispute_id);
    if (!box || !root.CBThread) return;
    sheetState.threads[dispute.dispute_id] = root.CBThread.mount(box, {
      chit_id: sheetState.id,
      dispute_id: dispute.dispute_id,
      channel: 'external',
      readOnly: dispute.status !== 'open',
      party: withWord(dispute),
      context: { host: 'tasks-dispute' },
      decorate: typeof disputeByline === 'function' ? disputeByline : undefined
    }); /* CBThread hands decorate the message TEXT */
  }
  function raiseAsk() {
    sheetState.raising = true;
    sheetPaint();
    var element = $('dp_reason');
    if (element) {
      element.focus();
      if (element.scrollIntoView) element.scrollIntoView({ block: 'center' });
    }
  }
  function changed() {
    return sheetRead().then(function () {
      if (node.el && root.document.body.contains(node.el)) return listLoad();
    });
  }
  function raise(btn) {
    var reason = String(($('dp_reason') || {}).value || '').trim(),
      kindChoice = ($('dp_cat') || {}).value || 'other';
    if (reason.length < 10) {
      $('dp_out').textContent = T('Say a little more — at least 10 letters.');
      return;
    }
    var parties = [].slice.call(sheetState.el.querySelectorAll('.dp-party:checked')).map(function (x) {
      return x.value;
    });
    var body = { category: kindChoice, reason: reason };
    if (parties.length) body.participant_entity_ids = parties;
    return root.CBAction.run(
      btn,
      function () {
        return call('dispute', { params: { id: sheetState.id }, body: body });
      },
      {
        key: 'dp-raise-' + sheetState.id,
        failed: T("The dispute didn't go through"),
        out: 'dp_out',
        outcome: function (reply) {
          sheetState.raising = false;
          $('dp_out').textContent = T('Dispute raised. The other side is told.') + (reply && reply.warning ? ' ' + reply.warning : '');
          changed();
        }
      }
    );
  }
  function resolveAsk(dispute) {
    var host = $('dp_rmore_' + dispute.dispute_id);
    if (!host) return;
    var nestedOpen = (dispute.others || []).filter(function (item) {
      return item.role === 'party' && item.dispute_status !== 'resolved';
    });
    host.innerHTML =
      '<div class="tk-panel">' +
      (nestedOpen.length > 1
        ? '<label class="sub" for="dp_rwho">' +
          esc(T('With whom?')) +
          '</label><select data-cbsid="TSK006-S05" class="inp" id="dp_rwho" data-testid="dp-rwho"><option value="">' +
          esc(T('Everyone still open')) +
          '</option>' +
          nestedOpen
            .map(function (item) {
              return '<option value="' + esc(item.entity_id) + '">' + esc(item.display_name || T('a party')) + '</option>';
            })
            .join('') +
          '</select>'
        : '') +
      '<label class="sub" for="dp_rnote">' +
      esc(T('How was it settled?')) +
      '</label><textarea data-cbsid="TSK006-T04" class="inp" id="dp_rnote" data-testid="dp-rnote" rows="2" maxlength="1000"></textarea>' +
      '<button data-cbsid="TSK006-B21" type="button" class="act" id="dp_rgo" data-testid="dp-rgo">' +
      esc(T('Resolve')) +
      '</button></div>';
    $('dp_rnote').focus();
    $('dp_rgo').onclick = function () {
      var note = String($('dp_rnote').value || '').trim(),
        element = $('dp_rwho') ? $('dp_rwho').value : '';
      if (!note) {
        $('dp_out').textContent = T('Say how it was settled first.');
        return;
      }
      var body = { resolution_note: note };
      if (element) body.target_entity_id = element;
      root.CBAction.run(
        $('dp_rgo'),
        function () {
          return call('resolveDispute', { params: { id: sheetState.id, disputeId: dispute.dispute_id }, body: body });
        },
        {
          key: 'dp-resolve-' + dispute.dispute_id,
          failed: T("That didn't resolve it"),
          out: 'dp_out',
          outcome: function (reply) {
            $('dp_out').textContent = reply && reply.fully_resolved === false ? T('Resolved with them. Still open for the others.') : T('Resolved.');
            changed();
          }
        }
      );
    };
  }

  /* sheet: false until a page opts in (tasks.html sets it) — the chit sheet then paints inSheet; app.html's sheet keeps the workshop's own form */
  root.CBDispute = { open: open, mount: mount, reload: listLoad, inSheet: inSheet, raise: raiseAsk, sheet: false, EP: root.CB_DISPUTE_EP };
})(typeof window !== 'undefined' ? window : globalThis);
