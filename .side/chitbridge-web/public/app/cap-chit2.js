/* app/cap-chit2.js — DESIGN 2: the chit as LINE-LEVEL work (lazy; ensureCap('chit2')).
 *
 * Athi's design, 2026-08-12 (cb-two-levels.html), and his correction of my framing the same day:
 *   *"design 1 stands for the whole chit and 2 works for division of labour."*
 *
 * ── ⚠️ THIS IS NOT A SKIN OVER DESIGN 1 ─────────────────────────────────────────────────────────────────────────
 * The two differ in the ATOM OF WORK, not the look. Design 1: the chit is the unit — one status, one assignee.
 * Design 2: the LINE is the unit — Murugan has the onions, Selvam the potatoes, a co-assist is sourcing beans, all
 * at once. That cannot be rendered as a variant of the first, because it needs state Design 1 has nowhere to put.
 * So this is a separate module on its own route, reading the same endpoints. NOTHING in Design 1 is altered, and
 * the old page keeps working whatever happens here.
 *
 * ── ⭐ TWO LEVELS, AND THE SWITCH IS THE PRIVACY BOUNDARY ───────────────────────────────────────────────────────
 *   THEM — the shared record: their message, the order, what was delivered and paid. Both parties hold it.
 *   US   — ours alone: who is doing what, internal notes, and what the job has cost. The counterparty sees NONE of it.
 * That is not a UI convenience; it is the isolation decision made visible. Assignment and cost are private tables
 * under RLS, delivery is replicated to both copies. The switch shows a person which world they are typing into.
 *
 * Backend: b138 amendment · b142 chit_line · b143 assignment · b144 delivery · b145 cost.
 */
/* OWNS Design 2, the chit as line-level work (lines carry their own state and assignee)
 * CALLED BY app.html (ensureCap('chit2'), route #/chit2)
 * FLOW ensureCap -> c2PaneOrd reads the chit and its lines -> CBCart totals -> money through fmtMoney
 * CARD 01-rail-core-the-chit/chit-design-2 */
if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    c2AssignLines: { m: 'POST', p: '/api/chits/:id/assign-lines', ok: 'y' },
    c2DeliverLines: { m: 'POST', p: '/api/chits/:id/deliver-lines', ok: 'y' },
    c2CostsGet: { m: 'GET', p: '/api/chits/:id/costs', ok: 'y' },
    c2CostsAdd: { m: 'POST', p: '/api/chits/:id/costs', ok: 'y' },
    c2Reprice: { m: 'POST', p: '/api/chits/:id/reprice', ok: 'y' } // preview:true computes, writes nothing
  });
}
var C2 = {
  id: null,
  side: 'them',
  tab: 'msg',
  data: null,
  costs: null,
  busy: false,
  err: null,
  /* Which QUESTION the Work tab is answering. Athi, 2026-08-14: "the work tab has 3 views, one is assignment
     view, and another one is person view ... another one should be date and time view?" */
  work: 'line'
};

/* ── the shell ─────────────────────────────────────────────────────────────────────────────────────────────── */
var C2_TABS = {
  them: [
    ['msg', 'Message'],
    ['ord', 'Order'],
    ['del', 'Delivered &amp; paid']
  ],
  /**
   * ⚠️⚠️ THERE WERE TWO MONEY LEDGERS AND ONLY ONE COUNTED. The retired **Cost** tab wrote `chit_line_cost`
   * rows and never sent a `line_id`, so they attached to the chit, never reached a line, and never reached the
   * total the rest of the product shows. Meanwhile everything a person actually records — a part from the
   * catalogue, a hand-typed service charge — is written as an `add` EVENT on the line, with its money.
   *
   * ⭐⭐ Athi, 2026-08-24: *"at the chit level we have to see a tree of cost, for each service what are the item
   * cost and labour cost, so the final summary with the details are known… instead of notes, name it Summary,
   * so all the information can be seen at one place."* One ledger, one total, one place to read it.
   */
  us: [
    ['work', 'Work'],
    ['summary', 'Summary']
  ]
};

/**
 * ⚠️⚠️ THIS USED TO SET `UI.nav = 'chit2'`, WHICH REPLACED THE WHOLE SCREEN and threw away the list on the
 * left. Athi, 2026-08-23: *"the entire screen is occupied with the details, it is not two sided… this is how
 * every other screen is, but design 2 is entirely occupying both left and right half."*
 *
 * ⭐ Design 2 is an ALTERNATIVE DETAIL PAGE, not another screen — his framing: *"each type of service will
 * settle with one type of detail page."* So it sets a flag the detail pane reads, and the nav stays wherever
 * the person was. The list keeps its place, the divider keeps working, and going back is a change of renderer
 * rather than a change of screen.
 */
async function openChit2(id) {
  /* ⭐ DESIGN 2 IS THE TASK'S WORKFLOW VIEW (Athi, 2026-09-06 11:3x: "why is the order showing design 2 at all? the task only should be in design 2").
     A SENT copy — the Order — is the cart in Design 1, always. */
  if ((UI.folder === 'order' || UI.folder === 'drafts' || UI.folder === 'archive') && typeof openChit === 'function') {
    UI.chit2 = null;
    return openChit(id);
  }
  C2.id = id;
  C2.side = 'them';
  C2.tab = 'msg';
  C2.data = null;
  C2.costs = null;
  C2.err = null;
  UI.chit2 = id;
  /* Keep the row selected in the list, so the left half still shows WHICH chit is open. */
  if (typeof UI.sel !== 'undefined') UI.sel = id;
  /* An old bookmark may still land on nav='chit2'; send it to the list this chit belongs to. */
  if (UI.nav === 'chit2') UI.nav = UI.folder === 'order' ? 'order' : 'task';
  renderApp();
  await loadChit2();
}
function c2Side(s) {
  C2.side = s;
  C2.tab = C2_TABS[s][0][0];
  c2Paint();
}
function c2Tab(t) {
  C2.tab = t;
  c2Paint();
}
/**
 * ⭐ "Back" is now a change of RENDERER, not of screen: the same chit, read the other way. That is what makes
 * the two designs switchable rather than two destinations — the list never moved, so there is nothing to
 * return to.
 */
function c2Back() {
  /**
   * ⚠️⚠️ HAND THE FRESH NUMBERS BACK, OR DESIGN 1 SHOWS THE JOB AS IT WAS BEFORE THE WORK. The two designs are
   * two readings of ONE chit, and `UI.detail` was loaded when the chit was opened — before any part was taken
   * or any line delivered here. Switching renderer without carrying the delivery state across means the
   * employer presses Back from a job he just watched being done and the task window says nothing was spent.
   *
   * ⭐ Not a re-read: `GET /chits/:id` is twelve round trips and design 2 already holds the answer, applied
   * from the write responses. Copying it is the same fact, not a second opinion.
   */
  try {
    if (UI.detail && C2.data && UI.detail.id === C2.id) {
      if (C2.data.line_delivery) UI.detail.line_delivery = C2.data.line_delivery;
      if (C2.data.delivery_summary) UI.detail.delivery_summary = C2.data.delivery_summary;
    }
  } catch (e) {
    /* the switch must happen even if the carry cannot */
  }
  UI.chit2 = null;
  C2.id = null;
  if (UI.nav === 'chit2') UI.nav = UI.folder === 'order' ? 'order' : 'task';
  renderApp();
}
/* ⚠️ c2Toggle AND C2.open ARE GONE. They existed to expand a form INSIDE a row, which is the thing that made
   the page jump — every line below the tapped one moved down, then back up on close. Everything that edits now
   opens as an overlay, so there is no in-place expansion left to toggle. Leaving a dead toggle behind would
   invite the next person to reach for it. */

async function loadChit2() {
  C2.busy = true;
  c2Paint();
  try {
    /* ⚠️ MESSAGES ARE A SEPARATE FETCH. The chit endpoint does NOT carry them, so reading d.msgs would have made
       the Notes tab say "no internal notes yet" forever — including when there were some. A wrong empty state is
       worse than an error, because nobody investigates an empty screen. */
    var both = await Promise.all([
      api('chit', { params: { id: C2.id } }),
      api('messages', { params: { id: C2.id } }).catch(function () {
        return [];
      })
    ]);
    C2.data = both[0];
    C2.data.msgs = (both[1] || []).map(function (item) {
      return typeof mapApiMsg === 'function' ? mapApiMsg(item) : item;
    });
    C2.err = null;
    /* ⚠️ LOAD THE ROSTER OURSELVES. `UI.actors` is only populated by the assign/bulk-assign modals in app.html, so
       arriving here directly left the Assign dropdown EMPTY — no error, just a select with nothing in it and no
       way to guess why. Anything this screen needs, this screen fetches. */
    if (!(UI.actors || []).length) {
      try {
        var reply = await api('actors');
        UI.actors = (reply || []).map(function (x) {
          return typeof mapApiActor === 'function' ? mapApiActor(x) : x;
        });
      } catch (e) {
        UI.actors = [];
      }
    }
  } catch (e) {
    C2.err = (e && e.message) || 'Could not open this chit.';
  }
  C2.busy = false;
  c2Paint();
}
/* (loadChit2Costs is gone with the Cost tab — the Summary reads the line events, not a second ledger) */
/**
 * ⚠️⚠️ ONLY WHILE THIS CHIT IS STILL THE ONE ON SCREEN. This wrote `#mainbody` unconditionally, so a load that
 * was still in flight when someone opened a DIFFERENT chit painted design 2 back over it — design 2 for a chit
 * they had already left. It cost three test runs and looked like the design switch failing.
 *
 * ⭐ The third time today the same fault has appeared in a different function: `wlPaint` did it to whatever
 * screen you were on, a loader's `renderApp()` did it to an open modal, and this does it to another chit. A
 * paint that runs later than the thing that asked for it must check the world has not moved.
 */
function c2Paint() {
  if (typeof UI !== 'undefined' && UI.chit2 !== C2.id) return;
  /**
   * ⚠️⚠️ THE DETAIL PANE, NOT #mainbody — Athi, 2026-09-01: *"design 2 page comes for the full screen, not
   * like two page screen like design 1."*
   *
   * #mainbody holds the WHOLE panel: the chit list, the divider and the detail. Writing it threw the list
   * away on every repaint and left design 2 stretched across the window, while design 1 beside it keeps
   * list-left / detail-right. The shell was already right — renderDetail() returns chit2Screen() while
   * UI.chit2 is set — and this one line undid it on the very next paint.
   *
   * ⭐ paintSupDetail, paintCustDetail and paintProdDetail all write #detailpane and reset its class; this is
   * the same pattern. It also fixes mobile for free: the narrow-screen rule that swaps list for detail applies to
   * the pane this was bypassing, so design 2 never got it.
   */
  var node = document.getElementById('detailpane');
  if (node) {
    node.className = 'detail';
    node.innerHTML = chit2Screen();
    return;
  }
  /* Not built yet (first open from a screen with no detail pane) — let the shell build the panel. */
  if (typeof bgRenderApp === 'function') bgRenderApp();
  else if (typeof renderApp === 'function') renderApp();
}

/* ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────── */
var c2n = function (v) {
  return v === null || v === undefined || v === '' ? null : Number(v);
};
var c2q = function (l) {
  return [l.quantity, l.unit]
    .filter(function (x) {
      return x !== null && x !== undefined && x !== '';
    })
    .join(' ');
};
function c2Money(v) {
  return v === null || v === undefined ? '—' : inr(v);
} /* CU4: the shop's currency (inr), not always ₹ (inr_) */
/** RAIL-146: did the server take the money off this read (a co-assist who may not see cost)? the field it sends, never a sentence */
function c2CostHidden(read) {
  return !!(read && read.cost_hidden);
}
/** the lines with no price — none when the server HID the prices from this reader (a hidden price is not a missing one, and no catalogue can fill it) */
function c2UnpricedCount(read, lines) {
  if (c2CostHidden(read)) return 0;
  return lines.filter(function (e) {
    var l = e.live || e.original || {};
    return !e.removed && (l.price === null || l.price === undefined || Number(l.price) === 0);
  }).length;
}
/** RAIL-146: the fact a line shows when its price was hidden from this reader, instead of a blank */
function c2PriceHiddenFact(read, line) {
  return c2CostHidden(read) && line.price == null ? '<span class="cbcat-fact" style="color:var(--grey)">' + tx('price hidden') + '</span>' : '';
}
function c2Head(t, s) {
  return (
    '<div style="padding:11px 16px;border-bottom:1px solid var(--line)"><div style="font-weight:600;font-size:var(--fs-3)">' +
    t +
    '</div>' +
    (s ? '<div style="color:var(--grey);font-size:var(--fs-2);margin-top:2px">' + s + '</div>' : '') +
    '</div>'
  );
}
function c2Grp(d, s) {
  return (
    '<div style="padding:13px 16px 5px;display:flex;justify-content:space-between;align-items:baseline"><span style="font-size:var(--fs-1);letter-spacing:.09em;text-transform:uppercase;color:var(--grey);font-weight:600">' +
    d +
    '</span><span style="font-size:var(--fs-2);color:var(--grey)">' +
    (s || '') +
    '</span></div>'
  );
}

/* ⚠️ THE GREYING RULE. Athi asked whether the other lines are greyed — yes, and greyed beats hidden.
   Murugan packing onions needs to know potatoes are on the same Friday trip even though they are Selvam's;
   hiding them causes a second journey and a phone call. Context prevents errors, so everything stays readable
   and only the EMPHASIS moves. The narrow "just my lines, across every chit" view is /folders/worklist. */
function c2Mine(entry, assignMap) {
  /* ⚠️ SESSION.actorId, NOT identity_id — the latter does not exist on SESSION (app.html:1435 sets actorId for
     actors and entityId for everyone). Reading the wrong key would have silently marked NOTHING as yours: no
     error, no empty state, just a highlight that never appears. The worst kind of bug in a display rule. */
  var me = (SESSION && SESSION.actorId) || null;
  if (!me) return false; // signed in as the entity — every line is "yours", so emphasise none
  var a = assignMap && assignMap[entry.line_id];
  return !!(a && a.assignee_actor_id === me);
}

/* ── THEM · the message ────────────────────────────────────────────────────────────────────────────────────── */
function c2PaneMsg(d) {
  var h = d.header || {};
  var raw = (h.summary_json && h.summary_json.via) || {};

  /**
   * ⚠️ THE FIELD IS `raw_excerpt`, NOT `text`. Athi, 2026-08-13: *"Message tab does not have the message, original
   * text and the attachment, which is appearing in format-1."* Right — this read `raw.text || raw.raw_text`,
   * neither of which exists, so it silently fell through to the auto-subject and looked like a chit that simply
   * had no message. A key that does not exist fails as a plausible screen, not as an error.
   *
   * ⚠️ AND IT IS DELIBERATELY CAPPED AT 400 CHARS. summary_json is copied onto every party's copy, so the FULL
   * text lives as an attachment instead — which is why the attachment is not decoration here. The excerpt is the
   * glance; the file is the evidence.
   */
  var text = raw.raw_excerpt || '';
  var atts = (d.attachments || []).map(function (item) {
    return typeof mapAtt === 'function' ? mapAtt(item) : item;
  });
  /* Register the group so the existing lightbox can open these — same viewer Design 1 uses, not a second one. */
  if (typeof UI !== 'undefined') {
    UI.attGroups = UI.attGroups || {};
    UI.attGroups.chit2 = atts;
  }
  var origin = atts.filter(function (item) {
    return /original-message/i.test(item.n || '');
  });

  /**
   * ⭐⭐ THE HEADING NAMES WHOEVER ASKED, NOT THE ACCOUNT HOLDER. On a captured job the sender IS us — the
   * customer is a phone number that will never be an entity — so this read "Chola Auto Care" at the top of the
   * pane whose entire purpose is *their* side of the record, while their number sat at the bottom.
   *
   * Athi, 2026-08-24: *"data was not moving from customer to supplier."* It was captured, not moved, and the
   * screen told him neither.
   */
  var _asked = typeof askedBy === 'function' ? askedBy(raw) : null;
  var out = c2Head(
    esc(_asked ? _asked.who : h.sender_entity_display_name || 'Them'),
    (raw.channel ? esc(String(raw.channel).toUpperCase()) + ' · ' : '') + esc(typeof fmtAt === 'function' ? fmtAt(h.created_at) : '')
  );

  /* ⚠️ NOT A VERIFIED PARTY, said on the screen where their words are read. A phone number that messaged a
     business is not a counterparty, and nothing else here would distinguish the two six weeks later. */
  if (raw.sender_verified === false) {
    out +=
      '<div style="padding:9px 16px;background:var(--warn-tint);color:var(--warn-2);font-size:var(--fs-2);border-bottom:1px solid var(--line)">' +
      '⚠️ Not a verified party — a phone number wrote in, and the lines were read from those words by a co-assist.</div>';
  }

  out += '<div style="padding:16px">';
  if (text) {
    out +=
      '<div style="font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--grey);margin-bottom:6px">what they wrote</div>' +
      '<div style="font-size:var(--fs-3);line-height:1.9">' +
      esc(text) +
      (text.length >= 400 ? '<span style="color:var(--grey)"> … </span>' : '') +
      '</div>';
    if (origin.length) {
      out +=
        '<div style="margin-top:8px"><span data-cbsid="DTL006-C01" onclick="openLightbox(\'chit2\',' +
        atts.indexOf(origin[0]) +
        ')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-2)">' +
        tx('📄 open the full original') +
        '</span></div>';
    }
  } else {
    /**
     * ⚠️⚠️ "COMPOSED HERE" AND "NO CAPTURED MESSAGE" ARE NOT THE SAME FACT, and this said the first while
     * meaning the second. A job a CUSTOMER sent us through the app has no raw_excerpt — there was never a
     * message to excerpt — so the supplier's Them pane announced that their customer's order was something
     * they had written themselves. That is the same class of wrong as the heading naming the account holder.
     *
     * ⭐ What the customer asked for, on a chit like that, IS the lines they sent. So say who it came from and
     * point at them, rather than denying the customer exists. `live_set` is the current set — the supplier's
     * own interpretation is made of the same lines, which is exactly Athi's model: *"we store the customer
     * request but interpret the same according to job item."*
     */
    var _fromEntity = h.sender_entity_id && (typeof SESSION === 'undefined' || h.sender_entity_id !== SESSION.entity);
    if (_fromEntity) {
      var _n = (d.live_set || []).filter(function (e) {
        return !e.removed;
      }).length;
      out +=
        '<div style="font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--grey);margin-bottom:7px">What they asked for</div>' +
        '<div style="font-size:var(--fs-3);line-height:1.9">' +
        esc(h.sender_entity_display_name || 'They') +
        ' sent this as ' +
        _n +
        (_n === 1 ? ' line' : ' lines') +
        '. There is no written message — the order itself is the request.</div>' +
        '<div style="color:var(--grey);font-size:var(--fs-2);margin-top:8px">Work them on the Work tab; how you read them stays on your side.</div>';
    } else {
      out += '<div style="color:var(--grey);font-size:var(--fs-2)">No original message on this chit — it was composed here rather than received.</div>';
    }
  }
  out +=
    (raw.from
      ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:12px;padding-top:10px;border-top:1px solid var(--line)">from ' +
        esc(raw.from) +
        (raw.from_name ? ' · ' + esc(raw.from_name) : '') +
        '</div>'
      : '') + '</div>';

  /**
   * ⭐ WHAT THEY SAID THAT IS NOT A LINE ITEM. Athi, 2026-08-10: *"need to see each data the user provides, which
   * data item in the js schema it can fit in, if not keep it as a note or a comment."*
   * `unplaced` especially: a request that quietly lost its "deliver at 7pm" looks perfectly correct and is wrong,
   * and nobody would ever know which. Shown, not dropped.
   */
  var extras = [
    ['🕐', 'Wanted', raw.delivery_at],
    ['📍', 'Deliver to', raw.delivery_address],
    ['📝', 'They also said', raw.notes],
    ['⚠️', 'Could not be placed', raw.unplaced]
  ].filter(function (x) {
    return x[2];
  });
  if (extras.length) {
    out +=
      c2Grp('From the message', '') +
      extras
        .map(function (x) {
          return (
            '<div style="padding:8px 16px;border-bottom:1px solid var(--line);display:flex;gap:9px;font-size:var(--fs-2)">' +
            '<span style="width:16px">' +
            x[0] +
            '</span>' +
            '<span style="flex:1"><span style="color:var(--grey);font-size:var(--fs-1);display:block">' +
            esc(x[1]) +
            '</span>' +
            esc(x[2]) +
            '</span></div>'
          );
        })
        .join('');
  }

  /* ⚠️ TILES, NOT A LIST OF NAMES. The original is a file someone has to be able to OPEN — Athi's complaint was
     that a .txt asked to be downloaded instead of showing. attTileGrid + the shared lightbox handle it. */
  if (atts.length) {
    out +=
      c2Grp('Attached', String(atts.length)) +
      '<div style="padding:0 16px 16px">' +
      (typeof attTileGrid === 'function'
        ? attTileGrid(atts, 'chit2')
        : atts
            .map(function (item) {
              return esc(item.n || 'file');
            })
            .join(' · ')) +
      '</div>';
  }
  return out;
}

/* ── THEM · the order ──────────────────────────────────────────────────────────────────────────────────────── */
function c2PaneOrd(d) {
  var lines = d.live_set || [];
  var asg = d.line_assignment || {};
  var amended = lines.filter(function (e) {
    return e.history && e.history.length;
  }).length;
  /* ⚠️ COUNTED, NOT ASSUMED. "3 lines have no price" is the reason someone would reach for the catalogue at all,
     so it is stated on the header rather than left to be discovered line by line. */
  var unpriced = c2UnpricedCount(d, lines);
  var out = c2Head(
    'The order',
    lines.length +
      ' line' +
      (lines.length === 1 ? '' : 's') +
      (amended ? ' · ' + amended + ' amended' : '') +
      (unpriced ? ' · <span style="color:var(--warn-2)">' + unpriced + ' with no price</span>' : '')
  );
  out +=
    '<div style="padding:9px 16px;border-bottom:1px solid var(--line)">' +
    '<button data-cbsid="DTL006-B01" class="btn" onclick="c2RepricePreview()">₹ Price from catalogue</button>' +
    '<span style="font-size:var(--fs-1);color:var(--grey);margin-inline-start:9px">shows what would change before anything is written</span></div>';

  /**
   * ⭐⭐ GOODS THAT ARRIVED CAN BECOME YOUR OWN PRODUCTS — offered HERE, beside the lines, because that is
   * where somebody is standing when the question arises. A menu item would make it a chore to go and do
   * later, which is how forty products stay untyped for a month.
   * ⚠️ ONLY ON A RECEIPT, and it never claims a number before asking: the panel itself decides what is new,
   * what is already stocked and what is refused. Putting a count on this button would mean reading the
   * whole delivery on every paint of a pane nobody may open.
   */
  if (c2IsReceipt(d)) {
    out +=
      '<div style="padding:9px 16px;border-bottom:1px solid var(--line)">' +
      '<button data-cbsid="DTL006-B02" class="btn" data-testid="c2-adopt" onclick="c2Adopt()">🗂️ Add new products to my catalogue</button>' +
      '<span style="font-size:var(--fs-1);color:var(--grey);margin-inline-start:9px">shows what is new before anything is added</span></div>';
  }

  /* ⭐⭐ THE CHIT IS THE CART (Athi, 2026-09-06 10:19: "it has to be the exact cart and the values and the information — ditto, including the
     format"). This pane drew its own rows ("2 bag × ₹101.00") and no money block; a buyer saw ₹676.80 on the Suppliers screen and ₹752 here.
     Now a read-only cart is built from the chit's RECORDED lines (price · discount · offer · rate, as written at send) and the rows and
     the money block are the cart's own — CBCatUI.rowHTML; its money is read, not computed (below). What only this page adds — the pencil, the
     delivered chip, the remedy notes, their own words — comes in through the row's hooks. */
  var recLines = [],
    items = [];
  lines.forEach(function (e, index) {
    var l = e.live || e.original || {};
    var id = String(e.line_id || l.line_id || l.item_id || 'ln' + index);
    var q = Number(l.quantity != null ? l.quantity : l.qty) || 0,
      p = Number(l.price),
      off =
        l.offer && l.offer.line_off != null
          ? Number(l.offer.line_off)
          : Number(l.discount) || (l.offer && Number(l.offer.off)) || 0; /* decision 3: the row shows its own offers */
    var unit = isFinite(p) && q > 0 && off > 0 ? CBMoney.round(p - off / q) : null;
    var nestedD = {
      name: l.particulars || l.name || 'line',
      unit: l.unit || 'unit',
      price: isFinite(p) ? p : null,
      code: l.sku || l.code || null,
      hsn: l.hsn || null,
      deal_recorded:
        unit != null
          ? {
              unit: unit,
              off: off,
              label: (l.offer && l.offer.label) || 'offer',
              promise: (l.offer && l.offer.promise) || null,
              parts: l.offer && Array.isArray(l.offer.parts) ? l.offer.parts : null
            }
          : null
    };
    var tax = l.gst_rate != null ? { rate: Number(l.gst_rate), name: l.tax_name || 'GST' } : null;
    items.push({ item_id: id, item_data: nestedD, tax: tax, _e: e, _i: index, _l: l });
    if (!e.removed) recLines.push(l);
  });
  var cat = { shop: { bridge_id: 'chit', currency_code: d.detail && d.detail.currency_code }, offers: [], items: items };
  if (C2.cart) {
    try {
      C2.cart.destroy();
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  }
  C2.cart = CBCart.create(cat, { renderer: CBCatUI, listEl: 'c2_lines_none', barEl: 'c2_bar_none', barHideEmpty: true });
  items.forEach(function (item) {
    var q = Number(item._l.quantity != null ? item._l.quantity : item._l.qty) || 0;
    if (q > 0) C2.cart.setQty(item.item_id, q);
  });
  try {
    CBCatUI.ensureCss();
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  out +=
    '<div class="plist">' +
    items
      .map(function (it) {
        var e = it._e,
          i = it._i,
          l = it._l,
          mine = c2Mine(e, asg);
        var deliv = ((d.line_delivery || {})[e.line_id] || {}).delivered;
        var below =
          c2PriceHiddenFact(d, l) +
          (e.removed ? '<span class="cbcat-fact" style="color:var(--disp)">' + esc(e.removed_reason || 'removed') + '</span>' : '') +
          ((e.history || []).length ? '<span class="cbcat-fact" style="color:var(--grey)">amended ' + (e.history || []).length + '×</span>' : '') +
          (l.comment
            ? '<div style="margin-top:5px;font-size:var(--fs-2);color:var(--blue-2);background:var(--blue-tint-bg);border-radius:5px;padding:4px 8px;display:inline-block">' +
              esc(l.comment) +
              '</div>'
            : '') +
          (l.qty_unverified
            ? '<div style="margin-top:5px;font-size:var(--fs-1);color:var(--warn-2)">⚠️ this number does not appear in their message — check it</div>'
            : '') +
          (l.qty_rejected
            ? '<div style="margin-top:5px;font-size:var(--fs-1);color:var(--disp)">⚠️ quantity rejected — ' +
              esc(l.qty_rejected) +
              '. Fix it on the line.</div>'
            : '') +
          (l.raw_phrase
            ? '<div style="margin-top:5px;font-size:var(--fs-1);color:var(--grey);font-style:italic">they wrote “' + esc(l.raw_phrase) + '”</div>'
            : l.asked_as
              ? '<div style="margin-top:4px;font-size:var(--fs-1);color:var(--grey)">they wrote “' + esc(l.asked_as) + '”</div>'
              : '');
        return CBCatUI.rowHTML(
          C2.cart,
          { type: 'line', item: it, item_id: it.item_id, variant: '' },
          {
            readonly: true,
            testid: function () {
              return 'c2-line-' + i;
            },
            rowClass: function () {
              return (e.removed ? 'cbcat-removed' : '') + (mine ? ' c2-mine' : '');
            },
            below: function () {
              return below ? '<span class="cbcat-below">' + below + '</span>' : '';
            },
            control: function () {
              return (
                (deliv
                  ? '<span title="Part-delivered — correctable, but not below what has gone out" style="font-size:var(--fs-1);color:var(--warn-2);font-weight:700">◧ ' +
                    esc(String(deliv)) +
                    ' out</span> '
                  : '') +
                (e.removed
                  ? ''
                  : '<span data-cbsid="DTL006-C02" data-testid="amend-line" onclick="event.stopPropagation();c2AmendLine(' +
                    i +
                    ')" title="Fix this line" style="cursor:pointer;font-size:var(--fs-3);color:var(--grey);padding:0 6px">✎</span>')
              );
            }
          }
        );
      })
      .join('') +
    '</div>';
  /* ⭐ the money block is READ from the frozen bill, never worked out from the lines (Athi, 2026-10-02: "never ever recompute") — the Task
     detail's own reader (frozenMoneyHTML → CBSheet.moneyFor), so Content, Summary and this Order tab can never disagree about one chit. */
  var hh = (d && (d.header || d.chit)) || d || {};
  out += frozenMoneyHTML(
    {
      business_json: hh.business_json || (d && d.business_json) || null,
      summary_money: (hh.summary_json && hh.summary_json.money) || null, cost_hidden: c2CostHidden(d), order_billed: d.order_billed /* RAIL-146: "Amounts hidden", not "No issued figures"; ORD-1: an open order no bill names says "Not billed yet" */,
      currency: cat.shop.currency_code,
      isDraft: /^draft$/i.test(String(hh.current_status || hh.status || ''))
    },
    'c2-money',
    'c2-total'
  );
  return out;
}

/**
 * ── ⭐ THE CORRECTION CARD, WIRED INTO DESIGN 2 ─────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-08-13, testing a real Tamil order: *"it is not showing anything here?"* — and it never could. This
 * screen renders its own rows and had no reference to the amend card anywhere, so ✎ did not exist, the ⚠️ pick
 * badge did not exist, and a ₹0.00 line offered nothing to act on. The picker built for the ambiguity case was
 * reachable only from Design 1, on a screen he was not using.
 *
 * ⚠️ IT CALLS THE SHARED CARD, IT DOES NOT REBUILD ONE. amdOpen() in app.html owns the setup — the raw_phrase
 * fallback, the wantPick reset, the "query the catalogue by what they WROTE" rule. Each of those is a bug that
 * was found once; a second copy here would mean finding all three again.
 *
 * ⚠️ AND IT PASSES ITS OWN REFRESH. Without `after`, a correction saved here would reload Design 1's state and the
 * edit would look lost until a manual reload — the change would be committed and invisible, which is the worst of
 * both outcomes.
 */
/* ⚠️ `live_set` — the name this screen already uses in three other places. My first version read `d.live`, which
   is undefined, so every ✎ would have reported "that line is no longer on the chit": a plausible sentence, a
   working-looking screen, and completely wrong. The row index and the array must come from one source. */
/** ⚠️ a delivery, not any chit — purpose OR the counter's own goods-in stamp, since both shapes exist */
function c2IsReceipt(d) {
  var h = (d && (d.header || d.chit)) || d || {};
  var bj = h.business_json || (d && d.business_json) || {};
  return String(h.purpose || d.purpose || '') === 'receipt' || bj.doc === 'receipt';
}
/** opens the adopt panel for THIS delivery — the capability loads on demand, like every other lazy screen */
function c2Adopt() {
  var id = (C2 && (C2.id || (C2.data && C2.data.chit_id))) || null;
  if (!id) {
    if (typeof toast === 'function') toast('No delivery open');
    return;
  }
  ensureCap('adopt')
    .then(function () {
      adoptOpen(id);
    })
    .catch(function (e) {
      if (typeof toast === 'function') toast((e && e.message) || 'Could not open it');
    });
}

function c2Entry(i) {
  return ((C2.data || {}).live_set || [])[i] || null;
}

function c2AmendLine(i, wantPick) {
  var e = c2Entry(i);
  if (!e) {
    if (typeof toast === 'function') toast('That line is no longer on the chit');
    return;
  }
  /* app.html owns the card and is always present, but this capability is lazy-loaded — say so rather than throwing
     a ReferenceError into the console where nobody sees it. */
  if (typeof amdOpen !== 'function') {
    if (typeof toast === 'function') toast('The correction card is not loaded yet — try again');
    return;
  }
  amdOpen(e, i, C2.id, (C2.data && C2.data.rawText) || '', {
    after: function () {
      return loadChit2();
    }
  });
  /* Same rule as Design 1: the badge opens ON the picker, but never saves on selection — the quantity on an
     ambiguous line is often wrong too, and one save has to cover both. */
  if (wantPick) AMD.wantPick = true;
}

/* ── price from catalogue — PREVIEW, then apply ─────────────────────────────────────────────────────────────────
   Athi, 2026-08-13: *"either wholistically or for an individual item the price should be pulled in"* and
   *"always bring the entire content as an overlay box and perform the activity"*.

   ⚠️ THE PREVIEW IS NOT A COURTESY. Pricing a whole chit in one tap is the useful version and also the dangerous
   one — it can overwrite a figure the customer stated. Showing the exact list first turns a promise into a
   decision, and it costs one extra tap on an action performed rarely.
   ⚠️ AND IT IS AN OVERLAY, not an inline expansion, so the page does not jump under the reader's thumb. */
var C2R = { plan: null, busy: false, only_unpriced: false };

async function c2RepricePreview() {
  C2R.busy = true;
  c2RepricePaint();
  try {
    C2R.plan = await api('c2Reprice', { params: { id: C2.id }, body: { preview: true, only_unpriced: C2R.only_unpriced } });
  } catch (e) {
    C2R.plan = { error: (e && e.message) || 'Could not read the catalogue.' };
  }
  C2R.busy = false;
  c2RepricePaint();
}
function c2RepriceScope(v) {
  C2R.only_unpriced = !!v;
  c2RepricePreview();
}

function c2RepricePaint() {
  if (C2R.busy && !C2R.plan)
    return modal(
      '<h3 style="margin:0 0 10px">₹ Price from catalogue</h3><div style="color:var(--grey);font-size:var(--fs-2)"><span class="spin"></span> checking the catalogue…</div>', false, { pop: 'POP020' }
    );
  var p = C2R.plan || {};
  if (p.error)
    return modal(
      '<h3 style="margin:0 0 10px">₹ Price from catalogue</h3><div style="color:var(--disp);font-size:var(--fs-2)">' +
        esc(p.error) +
        '</div><button data-cbsid="CMP005" class="btn" style="width:100%;margin-top:12px" onclick="closeModal()">' +
        tx('Close') +
        '</button>', false, { pop: 'POP020' }
    );

  if (!p.has_catalogue) {
    return modal(
      '<h3 style="margin:0 0 6px">₹ Price from catalogue</h3>' +
        '<div style="font-size:var(--fs-2);color:var(--grey);margin-bottom:12px">' +
        txf('You have no catalogue yet, so there are no prices to pull. Add items under {cat}', { cat: '<b>' + tx('Catalogue') + '</b>' }) +
        ' and this will fill them in.</div>' +
        '<button data-cbsid="CMP005" class="btn" style="width:100%" onclick="closeModal()">' +
        tx('Close') +
        '</button>', false, { pop: 'POP020' }
    );
  }

  var will = p.will_price || [],
    need = p.needs_price || [];
  var body =
    '<div style="display:flex;gap:6px;margin-bottom:12px">' +
    [
      '<span data-cbsid="DTL006-C03" onclick="c2RepriceScope(false)" style="cursor:pointer;border:1px solid ' +
        (C2R.only_unpriced ? 'var(--line)' : 'var(--blue)') +
        ';' +
        (C2R.only_unpriced ? '' : 'background:var(--blue);color:var(--on-accent);font-weight:700;') +
        'border-radius:9px;padding:4px 11px;font-size:var(--fs-2)">' +
        tx('Every line') +
        '</span>',
      '<span data-cbsid="DTL006-C04" onclick="c2RepriceScope(true)" style="cursor:pointer;border:1px solid ' +
        (C2R.only_unpriced ? 'var(--blue)' : 'var(--line)') +
        ';' +
        (C2R.only_unpriced ? 'background:var(--blue);color:var(--on-accent);font-weight:700;' : '') +
        'border-radius:9px;padding:4px 11px;font-size:var(--fs-2)">' +
        tx('Only lines with no price') +
        '</span>'
    ].join('') +
    '</div>';

  body += will.length
    ? '<div style="font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--grey);margin-bottom:4px">Will change (' +
      will.length +
      ')</div>' +
      will
        .map(function (item) {
          return (
            '<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid var(--line);font-size:var(--fs-2)">' +
            '<span style="flex:1;min-width:0"><b>' +
            esc(item.particulars || '') +
            '</b>' +
            '<div style="font-size:var(--fs-1);color:var(--grey)"><span class=arw>→</span> ' +
            esc(item.matched) +
            (item.matched_by_spelling ? ' <span style="color:var(--warn-2)">' + tx('≈ matched by spelling') + '</span>' : '') +
            '</div>' +
            /* ⚠️ REPLACING A STATED FIGURE IS CALLED OUT. Filling an empty price and overwriting one the customer
               wrote are different acts, and only a person can say whether the second is right. */
            (item.replaces_stated_price ? '<div style="font-size:var(--fs-1);color:var(--warn-2)">replaces the price on the chit</div>' : '') +
            '</span><span style="text-align:end;font-variant-numeric:tabular-nums">' +
            (item.price != null ? '<s style="color:var(--grey)">' + c2Money(item.price) + '</s> ' : '') +
            '<b>' +
            c2Money(item.to) +
            '</b></span></div>'
          );
        })
        .join('')
    : '<div style="font-size:var(--fs-2);color:var(--grey)">Nothing to change — every line already matches the catalogue.</div>';

  /* ⚠️ WHAT CANNOT BE PRICED IS SHOWN HERE, NOT LEFT AT ZERO. Athi: "if the exact item not found, then highlight
     for the cost to be updated." A chit that looks priced while a third of it is not is the failure this avoids. */
  if (need.length) {
    body +=
      '<div style="margin-top:14px;font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--warn-2);margin-bottom:4px">⚠️ Needs a price from you (' +
      need.length +
      ')</div>' +
      need
        .map(function (item) {
          return (
            '<div style="padding:5px 0;border-top:1px solid var(--line);font-size:var(--fs-2)"><b>' +
            esc(item.particulars || '') +
            '</b> ' +
            '<span style="color:var(--grey)">' +
            esc(item.reason) +
            '</span></div>'
          );
        })
        .join('');
  }

  modal(
    '<h3 style="margin:0 0 4px">₹ Price from catalogue</h3>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:12px">Nothing is written until you confirm. Each change is recorded as an amendment — the old price stays struck through.</div>' +
      body +
      '<div style="display:flex;gap:8px;margin-top:16px">' +
      '<button data-cbsid="CMP003" class="btn" style="flex:1" onclick="closeModal()">' +
      tx('Cancel') +
      '</button>' +
      (will.length ? '<button data-cbsid="DTL006-B03" class="btn pri" style="flex:1" onclick="c2RepriceApply()">Apply ' + will.length + '</button>' : '') +
      '</div>', false, { pop: 'POP020' }
  );
}

async function c2RepriceApply() {
  try {
    var reply = await api('c2Reprice', { params: { id: C2.id }, body: { only_unpriced: C2R.only_unpriced } });
    closeModal();
    C2R.plan = null;
    await loadChit2();
    toast((reply && reply.applied ? reply.applied : 0) + ' line(s) priced — the old values are kept');
  } catch (e) {
    toast(MSG.fail('apply the prices', e));
  }
}

/* ── THEM · delivered & paid ───────────────────────────────────────────────────────────────────────────────── */
function c2PaneDel(d) {
  var prog = d.line_delivery || {};
  var sum = d.delivery_summary || null;
  var lines = (d.live_set || []).filter(function (e) {
    return !e.removed;
  });
  if (!sum) return c2Head('Delivered & paid') + '<div style="padding:16px;color:var(--grey);font-size:var(--fs-2)">Nothing delivered yet.</div>';

  /**
   * ⭐⭐ THE MONEY WAS COMPUTED AND NEVER SHOWN. Athi, 2026-08-23: *"can I see some tickets with real cost and
   * completion status now?"* — the completion half was here, the cost half was not. `line_delivery[id].charged`
   * sums the `add` events on a line (parts fitted, hours worked) and **no screen in the product rendered it**,
   * so a service job displayed its progress and never what it had come to.
   *
   * ⚠️ IT IS A RUNNING TOTAL, NOT AN INVOICE, and the wording has to carry that. On a service job the number
   * rises while the work happens and is only final when the last complaint closes — labelling it "total" would
   * invite someone to quote it to a customer mid-job.
   */
  var accrued = lines.reduce(function (total, e) {
    return total + Number((prog[e.line_id] || {}).charged || 0);
  }, 0);
  var out = c2Head(
    'Delivered & paid',
    sum.complete +
      ' of ' +
      sum.lines +
      ' complete' +
      (accrued ? ' · <b data-testid="c2-accrued">' + esc(inr(accrued)) + '</b> ' + tx('so far') : '') +
      (sum.divergent ? ' · <span style="color:var(--warn-2)">' + sum.divergent + ' disagreed</span>' : '')
  );

  out += lines
    .map(function (e) {
      var p = prog[e.line_id] || {};
      var l = e.live || e.original || {};
      var pct = p.ordered ? Math.min(100, Math.round(((p.delivered || 0) / p.ordered) * 100)) : 0;
      var state = p.complete
        ? '<span style="color:var(--ok-2);font-size:var(--fs-2)">complete</span>'
        : p.delivered
          ? '<span style="color:var(--warn-2);font-size:var(--fs-2)">part</span>'
          : '<span style="color:var(--grey);font-size:var(--fs-2)">not started</span>';
      return (
        '<div data-testid="c2-del-row" data-line="' +
        e.line_id +
        '" style="padding:11px 16px;border-bottom:1px solid var(--line)">' +
        '<div style="display:flex;justify-content:space-between"><span data-testid="c2-del-name" style="font-weight:500">' +
        esc(l.particulars || '') +
        '</span><span data-testid="c2-del-state">' +
        state +
        '</span></div>' +
        '<div data-testid="c2-del-count" style="margin-top:4px;font-size:var(--fs-2);color:var(--grey);font-variant-numeric:tabular-nums"><b style="color:var(--ink)">' +
        (p.delivered || 0) +
        '</b> of ' +
        (p.ordered == null ? '—' : p.ordered) +
        ' ' +
        esc(l.unit || '') +
        (p.pending ? ' · ' + p.pending + ' pending' : '') +
        (p.over ? ' · <span style="color:var(--warn-2)">' + p.over + ' over</span>' : '') +
        '</div>' +
        '<div style="margin-top:6px;height:4px;background:var(--line);border-radius:2px;overflow:hidden"><i style="display:block;height:100%;width:' +
        pct +
        '%;background:#2f6b4f"></i></div>' +
        /* ⚠️ THE THREE STATES ARE KEPT APART. "They have not confirmed yet" is the NORMAL case and must not wear the
         same badge as a real disagreement, or the badge stops being read. */
        (p.both_agree ? '<div style="margin-top:6px;font-size:var(--fs-1);color:var(--ok-2)">' + tx('✓ both of you recorded the same') + '</div>' : '') +
        (p.divergent
          ? '<div style="margin-top:6px;font-size:var(--fs-1);color:var(--warn-2)">⚠️ you recorded ' +
            p.delivered +
            ', they recorded ' +
            p.theirs +
            ' — both are shown, neither is corrected</div>'
          : '') +
        (p.unacknowledged ? '<div style="margin-top:6px;font-size:var(--fs-1);color:var(--grey)">they have not confirmed this yet</div>' : '') +
        ((p.events || []).length
          ? '<div style="margin-top:7px;font-size:var(--fs-1);color:var(--grey)">' +
            p.events
              .map(function (item) {
                return (
                  (item.quantity > 0 ? '+' : '') +
                  item.quantity +
                  ' ' +
                  esc(item.unit || '') +
                  ' · ' +
                  esc(item.mine ? 'you' : item.by || 'them') +
                  (item.reference ? ' · ' + esc(item.reference) : '')
                );
              })
              .join('<br>') +
            '</div>'
          : '') +
        /**
         * ⭐⭐ WHAT WAS FITTED AND WHO SPENT THE HOURS. `added` is the other half of a line's history — the `add`
         * events that accrue rather than draw down — and it is the whole of a service job: parts consumed, hours
         * worked, and a charge for each. Rendering only `events` showed a repair as "not started" while three
         * people had spent an afternoon on it.
         *
         * ⚠️ `by_actor`, not `by`. `by` is the entity that holds the copy; the PERSON is `by_actor`, and reading
         * the wrong one turns three mechanics into one company — the same mistake the proof made before Athi
         * asked to see the people.
         */
        ((p.added || []).length
          ? '<div style="margin-top:7px;font-size:var(--fs-1)">' +
            p.added
              .map(function (item) {
                var qty = item.quantity ? item.quantity + ' ' + esc(item.unit || '') + ' · ' : '';
                return (
                  '<div data-testid="c2-del-added" style="display:flex;justify-content:space-between;gap:8px;padding:1px 0">' +
                  '<span style="color:var(--grey)">' +
                  qty +
                  esc(item.particulars || '') +
                  (item.by_actor ? ' · ' + esc(item.by_actor) : '') +
                  '</span>' +
                  (item.amount ? '<span style="color:var(--ink);font-variant-numeric:tabular-nums">' + esc(inr(item.amount)) + '</span>' : '') +
                  '</div>'
                );
              })
              .join('') +
            (p.charged
              ? '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:3px;' +
                'padding-top:3px;border-top:1px solid var(--line)"><span style="color:var(--grey)">' +
                tx('this line, so far') +
                '</span><b data-testid="c2-del-charged" style="font-variant-numeric:tabular-nums">' +
                esc(inr(p.charged)) +
                '</b></div>'
              : '') +
            '</div>'
          : '') +
        /* ⚠️ RECORDING LIVES ON THE LINE ITSELF. The first version of this pane was read-only — you could watch a
         delivery but never make one, which meant the whole tab was a demo. Recording is the point; it is the
         action he performs twenty times a day, so it is one tap from the line rather than behind a menu. */
        '<div style="margin-top:9px;display:flex;gap:7px;align-items:center;flex-wrap:wrap">' +
        '<input data-cbsid="DTL006-I01" id="c2dq_' +
        e.line_id +
        '" data-testid="c2-dq" inputmode="decimal" placeholder="' +
        (p.pending ? String(p.pending) : 'qty') +
        '" style="width:74px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;font-size:var(--fs-2)">' +
        '<span style="font-size:var(--fs-2);color:var(--grey)">' +
        esc(l.unit || '') +
        '</span>' +
        '<input data-cbsid="DTL006-I02" id="c2dr_' +
        e.line_id +
        '" placeholder="reference (optional)" style="flex:1;min-width:110px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;font-size:var(--fs-2)">' +
        '<button data-cbsid="DTL006-B04" class="btn pri" data-testid="c2-delivered" onclick="c2Deliver(\'' +
        e.line_id +
        "','" +
        esc(l.unit || '') +
        '\')">' +
        tx('Delivered') +
        '</button>' +
        c2MatRowHTML(e.line_id) +
        (p.delivered
          ? '<button class="btn" title="Record a correcting entry — the original claim stays on the record" onclick="c2Deliver(\'' +
            e.line_id +
            "','" +
            esc(l.unit || '') +
            '\',true)">' +
            tx('Take back') +
            '</button>'
          : '') +
        '</div>' +
        '</div>'
      );
    })
    .join('');
  return out;
}
/**
 * c2Deliver(line_id, unit, back) — claim a delivery, or correct one.
 *
 * ⚠️ "TAKE BACK" SENDS A NEGATIVE QUANTITY, it does not delete anything. Both rows stay on the record, because
 * what was claimed on the day has to remain legible after somebody changes their mind — and because the other
 * party already holds a copy of the original claim.
 * ⚠️ EXCESS IS NOT BLOCKED HERE either. Delivering 11 against an order of 10 is normal; the API records it and
 * shows the excess. Refusing it in the browser would make the record disagree with the lorry.
 */
/**
 * ⭐⭐ ONE PLACE THAT APPLIES A DELIVERY WRITE'S ANSWER — and the reason it exists is the bug it fixes.
 *
 * ⚠️⚠️ TWO CALL SITES SET `line_delivery` AND NEITHER TOUCHED `delivery_summary`. So after closing every
 * complaint on a job, each LINE read "complete" while the HEADER above them still said *"0 of 2 lines
 * delivered"* — the screen contradicting itself, and the contradiction surviving until someone reopened the
 * chit. That is the cost of applying a response field by field at each call site: the next field added gets
 * applied at one of them.
 *
 * ⚠️ `delivery_summary` is taken ONLY from the server. Recomputing "how many are complete" here would be a
 * second definition of complete, beside `lib/deliverline.js`, and the two would part company the first time
 * either changed. Returns false when there is nothing to apply, so the caller falls back to the full reload.
 */
function c2ApplyProgress(r) {
  if (!r || !r.progress || !C2.data) return false;
  C2.data.line_delivery = r.progress;
  if (r.summary) C2.data.delivery_summary = r.summary;
  c2Paint();
  return true;
}

async function c2Deliver(line_id, unit, back) {
  var el = document.getElementById('c2dq_' + line_id);
  /* WX-P2P-19: the empty box SHOWS the pending quantity (its placeholder) — Delivered records what it shows, never "How many?" over a 2 */
  var typed = el ? el.value.trim() : '';
  var q = Number(typed || (!back && el && /^\d+(\.\d+)?$/.test(el.placeholder) ? el.placeholder : ''));
  if (!Number.isFinite(q) || q === 0) return toast('How many? (a number, and not zero)');
  var ref = (document.getElementById('c2dr_' + line_id) || {}).value || null;
  try {
    var reply = await postDeliverLines('c2DeliverLines', C2.id, [{ line_id: line_id, quantity: back ? -Math.abs(q) : Math.abs(q), unit: unit || null, reference: ref }]);
    /**
     * ⭐⭐ THE WRITE NOW CARRIES THE NEW STATE, so the screen stops asking for it. This ran `loadChit2()` — a
     * twelve-round-trip re-read measured at ~4.9s, MORE than the ~3.5s write it was confirming. Recording
     * effort and materials is the action a mechanic performs all day; it was the slowest thing in the product.
     *
     * ⚠️ Falls back to the full reload when the response has no `progress` — an older API, or the one moment
     * after a deploy when the two halves disagree. Slow and correct beats fast and stale.
     */
    if (!c2ApplyProgress(reply)) await loadChit2();
    toast(back ? 'Taken back — the original claim stays on the record' : 'Recorded');
  } catch (e) {
    toast(MSG.fail('record the delivery', e));
  }
}

/* ── US · work ─────────────────────────────────────────────────────────────────────────────────────────────── */
/**
 * ⭐ THREE VIEWS OF ONE SET OF ROWS — Athi, 2026-08-14.
 *
 * They are not three screens; they are three QUESTIONS asked of the same assignments:
 *   By line    what is left on each item, and who has it   — the fulfilment question
 *   By person  what is on each person's plate              — the "who do I chase" question
 *   By date    what is due when, overdue first             — the "what is late" question
 *
 * ⚠️ INTERNAL TABS, NOT A LONGER PAGE. The old pane stacked the person roll-up ON TOP of the line list, so both
 * were always half-visible and neither was readable — the screen answered every question at once and none of
 * them well. Switching costs nothing: no fetch, no state beyond which tab is lit.
 */
function c2WorkView(v) {
  C2.work = v;
  c2Paint();
}
/**
 * A grouping heading — the name is the loudest thing on the row, because it is what you are scanning for.
 * c2Grp() is a small grey uppercase LABEL, right for "What is left" and wrong for a person's name.
 */
/**
 * ⭐ THE SAME ROLL-UP, WITH DELIVERY. The worklist cannot say what is LEFT — byPerson does not carry deliveries —
 * but inside a chit we have them, so the breakdown can answer the question that actually matters on a work
 * screen: not how much was ordered, but how much is still owed.
 *
 * ⚠️ AND THE SAME UNIT RULE. A quantity is shown only when every line in the group shares one unit; across mixed
 * units it says so instead of adding numbers that do not add.
 */
function c2Rollup(entries, asg, prog) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var units = {},
    left = {},
    overdue = 0,
    done = 0;
  entries.forEach(function (e) {
    var l = e.live || e.original || {},
      p = (prog || {})[e.line_id] || {},
      a = (asg || {})[e.line_id] || {};
    var u = l.unit || '',
      q = c2n(l.quantity);
    if (q != null) {
      units[u] = (units[u] || 0) + q;
      var rem = Math.max(0, q - (p.delivered || 0));
      left[u] = (left[u] || 0) + rem;
      if (rem === 0) done++;
    }
    if (a.due_date) {
      var date = new Date(String(a.due_date).slice(0, 10) + 'T00:00:00');
      if (date < today && (q == null || Math.max(0, q - (p.delivered || 0)) > 0)) overdue++;
    }
  });
  var keys = Object.keys(units);
  var one = keys.length === 1 ? keys[0] : null;
  return {
    lines: entries.length,
    done: done,
    overdue: overdue,
    qtyLeft: one !== null ? Math.round(left[one] * 1000) / 1000 + (one ? ' ' + one : '') : null,
    mixed: keys.length > 1
  };
}
function c2RollupText(entries, asg, prog) {
  var r = c2Rollup(entries, asg, prog);
  var bits = [r.lines + ' line' + (r.lines === 1 ? '' : 's')];
  if (r.qtyLeft) bits.push(r.qtyLeft + ' left');
  else if (r.mixed) bits.push('mixed units');
  if (r.done) bits.push(r.done + ' done');
  var text = bits.join(' · ');
  if (r.overdue) text += ' · <span style="color:var(--disp);font-weight:700">' + r.overdue + ' overdue</span>';
  return text;
}
function c2GrpBig(title, right, tone) {
  return (
    '<div style="padding:14px 16px 6px;display:flex;justify-content:space-between;align-items:baseline;' +
    'border-top:1px solid var(--line);background:var(--card);color:var(--on-card)">' +
    '<span style="font-size:var(--fs-4);font-weight:800;color:' +
    (tone || 'var(--ink,#1c2128)') +
    '">' +
    title +
    '</span>' +
    '<span style="font-size:var(--fs-2);color:var(--grey)">' +
    (right || '') +
    '</span></div>'
  );
}
function c2WorkTabs() {
  var tabs = [
    ['line', 'By line'],
    ['person', 'By person'],
    ['date', 'By date']
  ];
  return (
    '<div style="display:flex;gap:6px;padding:9px 16px;border-bottom:1px solid var(--line)">' +
    tabs
      .map(function (item) {
        var on = (C2.work || 'line') === item[0];
        return (
          '<span data-cbsid="DTL006-C05" onclick="c2WorkView(&quot;' +
          item[0] +
          '&quot;)" data-testid="work-' +
          item[0] +
          '" style="cursor:pointer;font-size:var(--fs-2);' +
          'border:1px solid ' +
          (on ? 'var(--blue)' : 'var(--line)') +
          ';' +
          (on ? 'background:var(--blue);color:var(--on-accent);font-weight:700;' : '') +
          'border-radius:9px;padding:4px 11px">' +
          item[1] +
          '</span>'
        );
      })
      .join('') +
    '</div>'
  );
}
/** Overdue first — a date view that buried what is late under what is not would be worse than no date view. */
/** "Mon 17 Aug" — the actual date, because "This week" does not tell anyone which day to be ready. */
function c2DateLabel(d) {
  try {
    var t = new Date(String(d) + 'T00:00:00');
    return CBLocale.date(t, { weekday: 'short', day: '2-digit', month: 'short' });
  } catch (e) {
    return String(d);
  }
}
function c2DueBucket(due) {
  if (!due) return { k: 'zz', label: 'No date' };
  var d = String(due).slice(0, 10);
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var date = new Date(d + 'T00:00:00');
  var days = Math.round((date - today) / 86400000);
  if (days < 0) return { k: 'a', label: 'Overdue' };
  if (days === 0) return { k: 'b', label: 'Today' };
  if (days === 1) return { k: 'c', label: 'Tomorrow' };
  if (days <= 7) return { k: 'd', label: 'This week' };
  return { k: 'e', label: 'Later' };
}
function c2PaneWork(d) {
  var asg = d.line_assignment || {};
  var lines = (d.live_set || []).filter(function (e) {
    return !e.removed;
  });
  var out =
    '<div style="padding:9px 16px;background:var(--warn-tint);color:var(--warn-3);font-size:var(--fs-2);border-bottom:1px solid var(--line)">◍ Only your side sees this. The other party sees none of it.</div>';

  /* Who has what — the roll-up for THIS chit. The cross-chit version is /folders/worklist. */
  var people = {};
  lines.forEach(function (e) {
    var a = asg[e.line_id];
    var key = (a && a.assignee_name) || 'Unassigned';
    (people[key] = people[key] || []).push(e);
  });
  out += c2WorkTabs();
  var view = C2.work || 'line';
  prog = d.line_delivery || {};

  /**
   * ⭐ ONE ARRAY, THREE KEY ORDERS — Athi, 2026-08-14: *"it is just an array of data which has three different
   * views? product, by date by name; another one is name, date, product; third one is date, name and product?"*
   *
   * Exactly that, and his framing is better than the code I had written: I hand-rolled three branches for one
   * operation parameterised by the ORDER of its grouping keys, which is why I got the date view wrong twice in an
   * hour. Now the view is DATA — a list of keys — and the renderer is generic:
   *
   *   By line    []              the flat list
   *   By person  ['who','date']  person, then their dates
   *   By date    ['date','who']  date, then who owes it
   *
   * A fourth ordering is a line of configuration, not a fourth branch. And the row automatically drops whatever
   * the headings above it already said, so no view can repeat itself the way the first two did.
   */
  var GROUPERS = {
    who: {
      of: function (e) {
        return (asg[e.line_id] || {}).assignee_name || 'Unassigned';
      },
      label: function (k) {
        return esc(k);
      },
      sort: function (x, y) {
        if (x === 'Unassigned') return 1;
        if (y === 'Unassigned') return -1;
        return x.localeCompare(y);
      },
      tone: function (k) {
        return k === 'Unassigned' ? 'var(--grey)' : null;
      }
    },
    date: {
      of: function (e) {
        return ((asg[e.line_id] || {}).due_date || '').slice(0, 10);
      },
      /* The real date, with the relative word beside it — "This week" alone never says which day to be ready. */
      label: function (k) {
        if (!k) return 'No date';
        var b = c2DueBucket(k);
        return (
          esc(c2DateLabel(k)) +
          ' <span style="font-size:var(--fs-2);font-weight:600;color:' +
          (b.label === 'Overdue' ? 'var(--disp)' : 'var(--grey)') +
          '">· ' +
          b.label +
          '</span>'
        );
      },
      /* Undated last: it is the only work nobody is waiting for on a particular day. */
      sort: function (x, y) {
        if (!x) return 1;
        if (!y) return -1;
        return x.localeCompare(y);
      },
      tone: function (k) {
        return k && c2DueBucket(k).label === 'Overdue' ? 'var(--disp)' : null;
      }
    }
  };

  function renderGroup(rows, keys, depth) {
    if (!keys.length)
      return rows
        .map(function (e) {
          return c2WorkRow(e, asg, prog, view);
        })
        .join('');
    var list = GROUPERS[keys[0]],
      rest = keys.slice(1);
    var buckets = {};
    rows.forEach(function (e) {
      var k = list.of(e);
      (buckets[k] = buckets[k] || []).push(e);
    });
    return Object.keys(buckets)
      .sort(list.sort)
      .map(function (item) {
        var roll = c2RollupText(buckets[item], asg, prog);
        var head =
          depth === 0
            ? c2GrpBig((list.tone(item) === 'var(--disp)' ? '⚠️ ' : '') + list.label(item), roll, list.tone(item))
            : /* A nested heading is a sub-heading — quieter, or the two compete and neither reads as the grouping.
           It still carries its own roll-up: a breakdown that only totals at the top is a total, not a breakdown. */
              '<div style="padding:6px 16px 2px;display:flex;justify-content:space-between;align-items:baseline">' +
              '<span style="font-size:var(--fs-2);font-weight:700;color:var(--grey)">' +
              list.label(item) +
              '</span>' +
              '<span style="font-size:var(--fs-1);color:var(--grey)">' +
              roll +
              '</span></div>';
        return head + renderGroup(buckets[item], rest, depth + 1);
      })
      .join('');
  }

  var KEYS = { line: [], person: ['who', 'date'], date: ['date', 'who'] };
  if (!lines.length) return out + '<div style="padding:14px 16px;font-size:var(--fs-2);color:var(--grey)">No lines on this chit.</div>';
  if (view !== 'line') return out + renderGroup(lines, KEYS[view] || [], 0);

  /* ⭐ THE FLAT VIEW SUMMARISES ITSELF TOO. It had no roll-up: the breakdown only appeared once you GROUPED, so
     the view everyone lands on was the one view that never told you the totals. Found by DEL-03, not by looking —
     the grouped views looked complete, and the default looked normal because it always had. */
  out += c2Grp('What is left', c2RollupText(lines, asg, prog));
  /* Appears only once something is ticked — an empty toolbar teaches nothing and costs a row of height. */
  out += c2PickBarHTML();
  out += lines
    .map(function (e) {
      return c2WorkRow(e, asg, prog);
    })
    .join('');
  return out;
}

/**
 * ⭐ ONE ROW, THREE GROUPINGS — Athi, 2026-08-14, seeing the person view lose everything but the names:
 * *"each name underneath item name and quantity what is left etc, same way for date also, so it is three
 * different view of the same data but no information is missing."*
 *
 * He is right, and my first pass got it wrong in the way that matters: By person rendered a comma-joined list of
 * names and silently dropped the quantity, what was given, what is left, the due date and the divergence flag.
 * That is not a different VIEW of the data, it is less data — and the person who switched to it to see who to
 * chase would then have to switch back to find out what they owe.
 *
 * So the row is rendered ONCE, here, and every view groups the same rows under a different heading. A field added
 * to this function appears in all three, which is the only way three views stay three views of one thing.
 */
/**
 * ⚠️ THE ROW DROPS WHAT THE HEADING ALREADY SAID. Athi, 2026-08-14: *"under item name need not be repeated, do I
 * need to say all this? only the date."* Under a heading that reads LAXMAN, printing "◍ laxman" on every row is
 * noise that pushes the thing you came to read further down. ctx says which grouping is above:
 *   'person' → show the DATE only     'date' → show the PERSON only     'line' → show both
 */
function c2WorkRow(e, asg, prog, ctx) {
  var a = asg[e.line_id] || {};
  var l = e.live || e.original || {};
  var p = prog[e.line_id] || {};
  var ord = c2n(l.quantity),
    got = p.delivered || 0;
  var left = ord == null ? null : Math.max(0, Math.round((ord - got) * 1000) / 1000);
  var done = left === 0 && ord != null;
  /* Opens an OVERLAY rather than expanding underneath — the row keeps its height, so nothing below it moves. */
  /**
   * ⭐⭐ THE TICK IS WHY THIS EXISTS. Athi, 2026-08-23: *"I am trying to assign the task to individuals, need
   * multiselect here — group assign should be possible. Example, oil change and filter change should be for
   * the same person."* One person does the whole oil service; assigning it as two separate acts is the screen
   * making him say twice what he decided once.
   *
   * ⚠️ It is also the answer to *"each assignment takes time"*: the API already accepts `edits: [...]` as an
   * ARRAY and the UI was sending one edit per call, each followed by a FULL chit reload. Six lines meant six
   * writes and six re-reads, in sequence. Ticking six and assigning once is a single call and a single reload.
   *
   * ⚠️ The checkbox stops the click from opening the row overlay — `stopPropagation`, or ticking a line would
   * also open it, and the overlay would swallow the very selection being built.
   */
  var _ticked = !!(C2.pick && C2.pick[e.line_id]);
  /**
   * ⭐ THE ROW OPENS THE LINE CARD — the one in cap-worklist, which already carries the original message,
   * History, Add a delivery, Add a cost, Who and when and Internal notes for a single line. Athi, 2026-08-24:
   * *"if you open the panel here, all the details will be available… why can't you reuse?"*
   *
   * ⚠️ The ✎ still opens ASSIGN, so nothing that worked before needs a new habit — the row gained a
   * destination, it did not lose one.
   */
  return (
    '<div data-cbsid="DTL006-C06" data-testid="c2-work-row" data-line="' +
    e.line_id +
    '" onclick="openLineCard(C2.id,\'' +
    e.line_id +
    '\')" style="color:var(--on-card);padding:11px 16px;border-bottom:1px solid var(--line);cursor:pointer;' +
    (_ticked ? 'background:var(--blue-tint)' : '') +
    '">' +
    /* ⭐  so the phone can wrap it: the description takes the first line, and the status, money and
         controls sit underneath. On a laptop it stays the single row it has always been. */
    '<div class="c2wrow" style="display:flex;align-items:baseline;gap:8px">' +
    '<input data-cbsid="DTL006-I03" type="checkbox" data-testid="c2-pick-' +
    e.line_id +
    '"' +
    (_ticked ? ' checked' : '') +
    ' onclick="event.stopPropagation();c2Pick(\'' +
    e.line_id +
    '\')"' +
    ' title="' +
    esc(tx('Tick several, then assign them together')) +
    '"' +
    ' style="margin-top:3px;cursor:pointer;flex:0 0 auto">' +
    '<span style="flex:1;font-weight:500">' +
    esc(l.particulars || '') +
    '<span style="color:var(--grey);font-weight:400;font-size:var(--fs-2)"> · ' +
    esc(c2q(l)) +
    '</span></span>' +
    /**
     * ⭐ WHAT THE LINE HAS COST, ON THE WORK VIEW TOO. Athi, 2026-08-24: *"the value… should appear on every
     * line item in the whole chit."* This pane answered "how much is left and who has it" and never "what
     * has it come to" — so the one screen a supervisor scans to decide what to chase could not show which
     * jobs were consuming money.
     *
     * ⚠️ Blank, not ₹0, when nothing has been recorded. A zero here would be indistinguishable from a line
     * that genuinely cost nothing, and on this pane most lines legitimately have nothing yet.
     */
    /**
     * ⭐ THE SAME STATUS WORD DESIGN 1 SHOWS — `lineStatePill()` from the shell, not a third opinion. Athi,
     * 2026-08-24: *"do we have line level status, that should be visible outside in the same screen."* This
     * pane had a status all along and it was a **glyph**: `—` for nothing and `✓` for done, in a numeric
     * column, which reads as punctuation rather than as a state. Two screens now say "not started",
     * "in progress" and "done" in the same words, from the same delivery record.
     */
    (typeof lineStatePill === 'function' ? lineStatePill(p, a) : '') +
    '<span data-testid="c2-work-charged" style="width:74px;text-align:end;font-variant-numeric:tabular-nums;' +
    'font-size:var(--fs-2);color:var(--ok-2,#2f6b4f)">' +
    (p.charged ? esc(inr(p.charged)) : '') +
    '</span>' +
    '<span style="width:62px;text-align:end;font-variant-numeric:tabular-nums;font-size:var(--fs-3)">' +
    got +
    '</span>' +
    '<span style="width:62px;text-align:end;font-variant-numeric:tabular-nums;font-size:var(--fs-3);font-weight:' +
    (done ? '400' : '700') +
    ';color:' +
    (done ? 'var(--ok-2)' : 'var(--ink)') +
    '">' +
    (left === null ? '—' : done ? '✓' : left) +
    '</span>' +
    /* ⚠️ Say that the row goes somewhere. The row has carried `cursor:pointer` all along, which only tells
         you once the mouse is already on it — and tells a phone nothing at all. */
    '<a data-cbsid="CMP010" class="lineopen" data-testid="c2-work-open" role="button" tabindex="0"' +
    ' title="' +
    esc(tx('Open this line — history, delivery, cost, who and when')) +
    '"' +
    ' onclick="event.stopPropagation();openLineCard(C2.id,\'' +
    e.line_id +
    '\')">' +
    esc(tx('Open')) +
    '</a>' +
    '<span data-cbsid="DTL006-C07" data-testid="c2-work-assign" title="' +
    esc(tx('Assign this line')) +
    '"' +
    ' onclick="event.stopPropagation();c2AssignOpen(\'' +
    e.line_id +
    '\')"' +
    ' style="color:var(--grey);width:12px;text-align:end;font-size:var(--fs-2);cursor:pointer">✎</span></div>' +
    /* Who has it and when it is due — the two things that turn "what is left" into "who do I chase". */
    (function () {
      /* Each view puts what it groups by in the HEADING, so the row shows only what is left to say.
             By person → the date.   By date → nothing (date AND person are both headings).   By line → both. */
      var who = ctx === 'person' || ctx === 'date' ? '' : esc(a.assignee_name || ''); // both group by who
      var when = ctx === 'date' ? '' : a.due_date ? 'due ' + esc(String(a.due_date).slice(0, 10)) : '';
      var bits = [who, a.task ? esc(a.task) : '', when].filter(Boolean);
      if (!a.assignee_name)
        return '<div style="margin-top:4px;font-size:var(--fs-2);color:var(--grey)">unassigned' + (left ? ' · nobody is doing this' : '') + '</div>';
      if (!bits.length) return '';
      return (
        '<div style="margin-top:4px;font-size:var(--fs-2);color:var(--warn-2);background:var(--warn-tint);border-radius:5px;padding:3px 8px;display:inline-block">◍ ' +
        bits.join(' · ') +
        '</div>'
      );
    })() +
    (ctx === 'line' && (a.history || []).length
      ? '<div style="margin-top:4px;font-size:var(--fs-1);color:var(--grey)">was ' +
        esc(
          a.history
            .map(function (item) {
              return item.assignee_name || 'unassigned';
            })
            .join(' <span class=arw>→</span> ')
        ) +
        '</div>'
      : '') +
    /* ⚠️ SURFACED HERE TOO. A line the two parties disagree about is a line you cannot call finished, and this
         is the screen where someone decides what still needs doing. */
    (p.divergent
      ? '<div style="margin-top:4px;font-size:var(--fs-1);color:var(--warn-2)">⚠️ they say ' + p.theirs + ', you say ' + p.delivered + '</div>'
      : '') +
    '</div>'
  );
}
/**
 * ⚠️ AN OVERLAY, NOT AN INLINE EXPANSION. Athi, 2026-08-13: *"whenever a modification is being done, if you are
 * doing it as part of the page, the page is jumping up and down... always bring the entire content as an overlay
 * box and perform the activity and show the result in the line item."*
 *
 * This used to grow a form UNDER the tapped row, which pushed every line below it down the screen — so the thing
 * you were about to type into moved as you reached for it, and closing it moved everything back. A row that is
 * always the same height cannot do that. The result still lands on the line, which is the half that matters.
 */
function c2AssignOpen(line_id) {
  var d = C2.data || {};
  var e =
    (d.live_set || []).find(function (x) {
      return x.line_id === line_id;
    }) || {};
  var l = e.live || e.original || {};
  var a = (d.line_assignment || {})[line_id] || {};
  var roster = UI.actors || [];

  /* ⚠️ SAY SO WHEN THERE IS NOBODY TO ASSIGN TO. An empty dropdown is indistinguishable from a broken one, and
     the honest answer — "you have not added any co-assists" — is also the instruction. */
  if (!roster.length) {
    return modal(
      '<h3 style="margin:0 0 8px">Assign · ' +
        esc(l.particulars || '') +
        '</h3>' +
        '<div style="font-size:var(--fs-2);color:var(--grey);margin-bottom:12px">' +
        txf('No co-assists yet — add someone under {where} and they will appear here.', { where: '<b>' + tx('Co-assists') + '</b>' }) +
        '</div>' +
        '<button data-cbsid="CMP005" class="btn" style="width:100%" onclick="closeModal()">' +
        tx('Close') +
        '</button>', false, { pop: 'POP019' }
    );
  }
  var opts = roster
    .map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (a.assignee_actor_id === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>';
    })
    .join('');
  modal(
    '<h3 style="margin:0 0 3px">' +
      tx('Assign this line') +
      '</h3>' +
      '<div style="font-size:var(--fs-2);color:var(--grey);margin-bottom:14px">' +
      esc(l.particulars || '') +
      ' · ' +
      esc(c2q(l)) +
      '</div>' +
      '<label style="display:block;font-size:var(--fs-1);color:var(--grey);margin-bottom:3px">' +
      tx('ASSIGN TO') +
      '</label>' +
      '<select data-cbsid="DTL006-S01" id="c2a_' +
      line_id +
      '" data-testid="c2-assign-who" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid var(--line);border-radius:6px;font-size:var(--fs-3);margin-bottom:10px"><option value="">' +
      tx('Unassigned') +
      '</option>' +
      opts +
      '</select>' +
      '<div style="display:flex;gap:9px;margin-bottom:14px">' +
      '<div style="flex:1"><label style="display:block;font-size:var(--fs-1);color:var(--grey);margin-bottom:3px">' +
      tx('TASK') +
      '</label>' +
      '<input data-cbsid="DTL006-I04" id="c2t_' +
      line_id +
      '" data-testid="c2-assign-task" value="' +
      esc(a.task || '') +
      '" placeholder="packing" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid var(--line);border-radius:6px;font-size:var(--fs-3)"></div>' +
      '<div style="flex:1"><label style="display:block;font-size:var(--fs-1);color:var(--grey);margin-bottom:3px">' +
      tx('DUE') +
      '</label>' +
      '<input data-cbsid="DTL006-I05" id="c2d_' +
      line_id +
      '" data-testid="c2-assign-due" type="date" value="' +
      esc(a.due_date ? String(a.due_date).slice(0, 10) : '') +
      '" style="width:100%;box-sizing:border-box;padding:9px;border:1px solid var(--line);border-radius:6px;font-size:var(--fs-3)"></div></div>' +
      ((a.history || []).length
        ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:12px">previously ' +
          esc(
            a.history
              .map(function (item) {
                return item.assignee_name || 'unassigned';
              })
              .join(' <span class=arw>→</span> ')
          ) +
          '</div>'
        : '') +
      '<div style="display:flex;gap:8px"><button data-cbsid="CMP003" class="btn" style="flex:1" onclick="closeModal()">' +
      tx('Cancel') +
      '</button>' +
      '<button data-cbsid="DTL006-B05" class="btn pri" data-testid="c2-assign-do" style="flex:1" onclick="c2Assign(\'' +
      line_id +
      '\')">' +
      tx('Assign') +
      '</button></div>', false, { pop: 'POP019' }
  );
}
/**
 * ── TAKING MATERIAL FROM THE STORE ─────────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-08-23: *"when the employee is trying to fix the car, he takes material from the store — how does
 * he take it? In this screen how does he invoke his own or another network store catalogue?"*
 *
 * ⭐⭐ HE PICKS IT; HE DOES NOT TYPE IT. Until now a part was free text in "Add a cost" — a name and a number
 * typed by hand — so *"6 materials changed"* could never be reconciled against anything. `chit_line_cost` has
 * no catalogue column at all (kind · amount · minutes · rate · note), which is why the picker lives on the
 * LINE EVENT instead: an `add` event carries `particulars`, `quantity`, `unit`, `amount` **and `reference`**,
 * and the reference is the catalogue item id.
 *
 * ⚠️⚠️ AND HIS OWN STORE IS NOT THE SAME ACT AS ANOTHER STORE, which is why only one of them belongs here.
 * Taking oil off your own shelf is CONSUMPTION — it happens inside the job and needs no counterparty. Taking
 * it from another business is a PURCHASE: it needs their price, their agreement and a record both sides hold,
 * which is a chit, and the product already does it (Suppliers → browse → cart → order). Putting another
 * entity's catalogue behind this button would let someone consume stock they have not bought.
 *
 * ⚠️ The price comes from the CATALOGUE, not from the person. What a part costs is the shop's decision, made
 * once; a mechanic typing it at the car is how two invoices for the same filter end up different.
 */
/**
 * ⭐⭐ THREE SOURCES, ONE PICKER. Athi, 2026-08-23: *"here we should be able to pick up from own catalogue,
 * network store catalogue or maybe a supplier catalogue — but mostly the network store catalogue, accessed via
 * the supplier link."*
 *
 * ⭐ AND THE SUPPLIER LINK IS WHAT MAKES ALL THREE ONE MECHANISM. A network store is another entity, so its
 * parts are not ours to take — they are reachable because someone established a relationship, and that
 * relationship is the supplier link. So the source list is: our own shelf, then every supplier we have,
 * whether that supplier is a branch of our own network or an outside business. Nothing here needs to know
 * which, because the LINK already decided we may read their catalogue.
 *
 * ⚠️ WHAT IS RECORDED DIFFERS BY SOURCE, AND THAT MUST NOT BE BLURRED. Taking oil off our own shelf is
 * CONSUMPTION — no counterparty, no agreement. Taking it from another entity is a PURCHASE: they have a price,
 * they hold their own copy, and a record neither side can edit alone. The event below carries the source on
 * every non-own line so the purchase can be raised against it — see the note in c2TakeMaterial.
 */
var C2_OWN = '__own__';

function c2MatSources() {
  if (C2.matSrcs) return C2.matSrcs;
  C2.matSrcs = [{ id: C2_OWN, name: tx('Our own stock') }];
  api('supList')
    .then(function (reply) {
      var sups = (reply && (reply.suppliers || reply)) || [];
      if (Array.isArray(sups)) {
        C2.matSrcs = [{ id: C2_OWN, name: tx('Our own stock') }].concat(
          sups
            .map(function (item) {
              return { id: item.supplier_entity_id, name: item.nickname || item.display_name || tx('supplier'), listId: item.supplier_list_id };
            })
            .filter(function (item) {
              return item.id;
            })
        );
        c2Paint();
      }
    })
    .catch(function () {
      /* no suppliers reachable — our own stock is still a source */
    });
  return C2.matSrcs;
}

function c2MatSrc() {
  return C2.matSrc || C2_OWN;
}

/** A different shelf is a different list; nothing is cached, because the picker reads on open. */
function c2MatSetSrc(id) {
  C2.matSrc = id;
  c2Paint();
}

/**
 * The chosen shelf, read when the picker asks for it.
 *
 * ⚠️ 'sid', not 'id' — the EP was registered with that name, and a wrong param name does not throw: it leaves
 * ':sid' unfilled in the path and the call quietly 404s.
 */
function c2MatFetch() {
  var src = c2MatSrc();
  var got =
    src === C2_OWN
      ? api('prodList', { query: { limit: 200 } }).then(function (reply) {
          return Array.isArray(reply) ? reply : (reply && (reply.items || reply.products)) || [];
        })
      : /* ⚠️ Their catalogue, read through the supplier link — the same one the Suppliers screen uses, so a store
       that has published nothing to us shows nothing here either, rather than a different answer. */
        api('supCatalogue', { params: { sid: src } }).then(function (reply) {
          return Array.isArray(reply) ? reply : (reply && reply.items) || [];
        });
  return got.then(function (items) {
    return items
      .map(function (x) {
        var d = x.item_data || x;
        return Object.assign({}, d, { item_id: x.item_id || d.item_id, name: d.name || d.particulars || '' });
      })
      .filter(function (item) {
        return item.name;
      });
  });
}

/**
 * ── TAKING MATERIAL FROM A SHELF ───────────────────────────────────────────────────────────────────────────
 *
 * ⚠️⚠️ THIS WAS A <select> AND A qty BOX, WHICH IS THE PICKER ATHI HAD ALREADY REJECTED ONCE. He said it about
 * the worklist first — *"why can you not bring our storefront catalogue menu which has everything"* — and then
 * again here: *"it has to bring the existing UI with the search bar and pass the data back to the screen it
 * called."* A dropdown cannot search, cannot show a picture, cannot take three parts at once, and behaves
 * unlike the catalogue people already know from Compose and Suppliers.
 *
 * ⭐ So the line offers WHICH SHELF (a real choice — our own stock, or any supplier), and the picker itself is
 * 'CBPick', the one module. One button, one catalogue, several parts in one act.
 */
function c2MatRowHTML(line_id) {
  var srcs = c2MatSources();
  /* The source picker shows even when a shelf is empty — "this supplier has nothing" is an answer, and hiding
     the control would read as the feature being missing. */
  var srcSel =
    srcs.length > 1
      ? '<select data-cbsid="DTL006-S02" data-testid="c2-mat-src" onchange="c2MatSetSrc(this.value)" style="padding:6px 8px;' +
        'border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--on-card);font-size:var(--fs-2)">' +
        srcs
          .map(function (item) {
            return '<option value="' + esc(item.id) + '"' + (item.id === c2MatSrc() ? ' selected' : '') + '>' + esc(item.name) + '</option>';
          })
          .join('') +
        '</select>'
      : '';
  return (
    '<div style="flex-basis:100%;height:0"></div>' +
    srcSel +
    '<button data-cbsid="DTL006-B06" class="btn" data-testid="c2-take-material" onclick="c2TakeMaterial(\'' +
    line_id +
    '\')"' +
    ' title="' +
    esc(tx('Records what was used against this line, at the catalogue price')) +
    '">' +
    '🛒 ' +
    esc(tx('Take materials')) +
    '</button>'
  );
}

/**
 * ⚠️ 'add', NOT 'deliver'. Fitting a compressor is not "2 of a brake service" — the part accrues against the
 * job, it does not draw the job down. That is the rule the whole service model rests on.
 *
 * ⚠️⚠️ THE SOURCE IS PART OF THE RECORD, NOT A DETAIL. Our own shelf and a supplier's shelf produce the same
 * cost on the job and mean completely different things afterwards: one is stock consumed, the other is money
 * owed to another business. Writing them identically would make the two indistinguishable a week later, when
 * it matters.
 *
 * ⚠️ THE PURCHASE IS NOT RAISED HERE, AND THAT IS DELIBERATE. A part taken from a supplier ought to end in a
 * chit to them — their copy, their price, both sides holding it. Doing that silently from a picker would
 * commit an entity to an order it never saw. Recorded with its origin so the purchase CAN be raised against
 * it; whether per part, per job or per day is Athi's call, not a default.
 */
async function c2TakeMaterial(line_id) {
  var src = c2MatSrc();
  var srcName =
    (
      c2MatSources().find(function (item) {
        return item.id === src;
      }) || {}
    ).name || '';
  var own = src === C2_OWN;
  var picked = await CBPick.open({
    title: tx('Take materials'),
    subtitle: own ? tx('Our own stock') : srcName,
    confirm: tx('Add to this line'),
    cartTitle: tx('Materials to add'),
    emptyHint: tx('Press + on what was used'),
    emptyAll: own
      ? tx('Your catalogue is empty — add parts under Catalogue and they can be taken from here.')
      : txf('{name} has not published anything you can take yet.', { name: srcName }),
    catalogue: c2MatFetch
  });
  if (!picked || !picked.length) return;
  try {
    var rows = picked.map(function (item) {
      return {
        line_id: line_id,
        kind: 'add',
        particulars: item.name + (own ? '' : ' (' + srcName + ')'),
        quantity: item.qty,
        unit: item.unit,
        amount: item.amount,
        reference: item.item_id,
        note: own ? null : 'from ' + srcName
      };
    });
    var reply = await postDeliverLines('c2DeliverLines', C2.id, rows);
    if (!c2ApplyProgress(reply)) await loadChit2();
    toast(txf('{n} added to this line', { n: rows.length }));
  } catch (e) {
    toast(MSG.fail('record the material', e));
  }
}

/**
 * ⭐⭐ APPLY THE ANSWER; DO NOT ASK THE QUESTION AGAIN. Measured 2026-08-23, against the live API:
 *
 *     assign one line          3,481 ms
 *     the reload right after   4,892 ms      ← MORE than the write it was confirming
 *     one assignment           8,373 ms
 *     six, one at a time      50,238 ms
 *
 * Athi: *"it drags like hell… people will forget using computer."* More than half of every action was the app
 * re-reading the WHOLE chit to learn a fact the server had just handed back in the response. `GET /chits/:id`
 * is twelve round trips; nothing on this screen needed eleven of them.
 *
 * ⚠️ THE SERVER'S ANSWER WINS WHERE IT GIVES ONE. `out.assignments` is what was actually stored — using the
 * values we SENT would make the screen show our intention rather than the record, and those differ exactly
 * when something went wrong. The sent values are the fallback only, for an older API that returns nothing.
 *
 * ⚠️ And this is a LOCAL APPLY, not an optimistic one: the write has already succeeded when this runs. Nothing
 * is painted before the server agrees, so there is no state to roll back.
 */
function c2ApplyAssignments(resp, ids, actor, name) {
  var d = C2.data;
  if (!d) return;
  d.line_assignment = d.line_assignment || {};
  var served = (resp && resp.assignments) || null;
  if (served && served.length) {
    served.forEach(function (item) {
      if (item && item.line_id) d.line_assignment[item.line_id] = item;
    });
  } else {
    ids.forEach(function (line_id) {
      var prev = d.line_assignment[line_id] || {};
      d.line_assignment[line_id] = Object.assign({}, prev, {
        line_id: line_id,
        assignee_actor_id: actor || null,
        assignee_name: actor ? name : null,
        assignee_type: actor ? 'human' : null
      });
    });
  }
  c2Paint();
}

/* ── GROUP ASSIGN ──────────────────────────────────────────────────────────────────────────────────────── */
function c2Pick(line_id) {
  C2.pick = C2.pick || {};
  if (C2.pick[line_id]) delete C2.pick[line_id];
  else C2.pick[line_id] = true;
  c2Paint();
}
function c2PickCount() {
  return Object.keys(C2.pick || {}).length;
}
function c2PickClear() {
  C2.pick = {};
  c2Paint();
}

/**
 * The bar that appears once anything is ticked. It sits at the top of the list rather than the bottom because
 * the tick that opens it is at the top, and a control that appears somewhere the eye is not already looking
 * gets missed.
 */
function c2PickBarHTML() {
  var n = c2PickCount();
  if (!n) return '';
  /* ⚠️ Same rule the single-assign modal already states: an empty dropdown is indistinguishable from a broken
     one, and the honest answer is also the instruction. */
  if (!(UI.actors || []).length) {
    return (
      '<div style="color:var(--on-card);padding:9px 16px;background:var(--blue-tint);border-bottom:1px solid var(--line);' +
      'font-size:var(--fs-2)">' +
      esc(txf('{n} selected', { n: n })) +
      ' — ' +
      esc(tx('no co-assists yet; add someone under Co-assists and they will appear here.')) +
      '</div>'
    );
  }
  var opts =
    '<option value="">' +
    esc(tx('Choose a person…')) +
    '</option>' +
    (UI.actors || [])
      .map(function (item) {
        return '<option value="' + esc(item.id) + '">' + esc(item.name) + '</option>';
      })
      .join('');
  return (
    '<div style="color:var(--on-card);display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:9px 16px;' +
    'background:var(--blue-tint);border-bottom:1px solid var(--line)">' +
    '<b style="font-size:var(--fs-2)">' +
    esc(txf('{n} selected', { n: n })) +
    '</b>' +
    '<select data-cbsid="DTL006-S03" id="c2pick_actor" style="flex:1;min-width:150px;padding:6px 9px;border:1px solid var(--line);' +
    'border-radius:8px;background:var(--card);color:var(--on-card);font-size:var(--fs-2)">' +
    opts +
    '</select>' +
    '<button data-cbsid="DTL006-B07" class="btn pri" data-testid="c2-assign-many" onclick="c2AssignMany()" style="padding:6px 14px">' +
    esc(tx('Assign together')) +
    '</button>' +
    '<button data-cbsid="CMP014" onclick="c2PickClear()" style="border:1px solid var(--line);background:var(--card);' +
    'color:var(--on-card);border-radius:8px;padding:6px 11px;font-size:var(--fs-2);cursor:pointer">' +
    esc(tx('Clear')) +
    '</button></div>'
  );
}

/**
 * ⭐ ONE CALL, ONE RELOAD. `edits` was always an array; sending it one element at a time was the whole cost.
 * Six lines used to be six writes and six full chit reads in sequence — this is one of each.
 */
async function c2AssignMany() {
  var ids = Object.keys(C2.pick || {});
  if (!ids.length) return;
  var node = document.getElementById('c2pick_actor');
  var actor = node ? node.value : '';
  var name = node && node.selectedIndex > 0 ? node.options[node.selectedIndex].text : null;
  if (!actor) {
    toast(tx('Choose a person first'));
    return;
  }
  try {
    var reply = await api('c2AssignLines', {
      params: { id: C2.id },
      body: {
        edits: ids.map(function (line_id) {
          return { line_id: line_id, assignee_actor_id: actor, assignee_name: name, assignee_type: 'human' };
        })
      }
    });
    C2.pick = {};
    c2ApplyAssignments(reply, ids, actor, name);
    toast(txf('{n} assigned to {name}', { n: ids.length, name: name }));
  } catch (e) {
    toast(MSG.fail('assign the lines', e));
  }
}

async function c2Assign(line_id) {
  var node = document.getElementById('c2a_' + line_id);
  var actor = node ? node.value : '';
  var name = node && node.selectedIndex > 0 ? node.options[node.selectedIndex].text : null;
  var task = (document.getElementById('c2t_' + line_id) || {}).value || null;
  var due = (document.getElementById('c2d_' + line_id) || {}).value || null;
  try {
    /* ⚠️ assignee_actor_id IS SENT EXPLICITLY, null included — the API refuses an omitted key, because
       "unassign" and "never assigned" are different facts and it will not guess which was meant. */
    var reply = await api('c2AssignLines', {
      params: { id: C2.id },
      body: { edits: [{ line_id: line_id, assignee_actor_id: actor || null, assignee_name: name, assignee_type: 'human', task: task, due_date: due }] }
    });
    c2ApplyAssignments(reply, [line_id], actor, name);
    /* ⚠️ THE OVERLAY STAYED UP AFTER A SUCCESSFUL ASSIGN — you pressed Assign, a toast flashed behind the box,
       and the only way on was Cancel, which reads like the assign did not take. Every other apply on this
       screen closes (c2RepriceApply does), and there is nothing left to type into a line you just assigned. */
    closeModal();
    toast(actor ? 'Assigned to ' + name : 'Unassigned');
  } catch (e) {
    toast(MSG.fail('assign the line', e));
  }
}

/* ── US · summary ─────────────────────────────────────────────────────────────────────────────────────── */
/**
 * ⭐⭐ THE TREE: EVERY SERVICE, WHAT WENT INTO IT, AND WHAT IT CAME TO.
 *
 * Athi, 2026-08-24: *"at the chit level we have to see a tree of cost — for each service, what are the item
 * cost and labour cost etc, so the final summary with the details are known. Instead of notes, name it
 * Summary, so all the information can be seen at one place."*
 *
 * ⭐ EVERY NUMBER HERE ALREADY EXISTED. A person working a line records a part from the catalogue or a
 * hand-typed charge, and both are written as an `add` EVENT on that line carrying particulars, quantity,
 * unit, amount and who. So this is a reading of what is already recorded — no new table, no new write, and
 * nothing that can drift from the figure the rest of the screen shows, because it IS that figure.
 *
 * ⚠️⚠️ AND IT REPLACES THE COST TAB, WHICH WAS A SECOND LEDGER THAT NEVER COUNTED. `c2AddCost` wrote
 * `chit_line_cost` rows without a `line_id`, so they hung off the chit, belonged to no service, and never
 * reached the total. Two money records in one screen is how "what we spent" and "what the lines came to"
 * became different numbers. One ledger now.
 *
 * ⚠️ A LINE WITH NOTHING AGAINST IT IS STILL LISTED, showing a dash. A summary that hides the untouched
 * services answers "what has been spent" and quietly refuses "what is left to do" — which on a seven-fault
 * job is the more urgent of the two.
 */
function c2PaneSummary(d) {
  var prog = d.line_delivery || {};
  var asg = d.line_assignment || {};
  var lines = (d.live_set || []).filter(function (e) {
    return !e.removed;
  });
  var total = 0,
    items = 0;

  var body = lines
    .map(function (e) {
      var l = e.live || e.original || {};
      var p = prog[e.line_id] || {};
      var a = asg[e.line_id] || {};
      var added = p.added || [];
      var charged = Number(p.charged || 0);
      total += charged;
      items += added.length;

      /* The service heading: what it is, who has it, where it has got to, what it has come to. */
      var head =
        '<div class="c2sline">' +
        '<span class="c2sname">' +
        esc(l.particulars || '') +
        '</span>' +
        (typeof lineStatePill === 'function' ? lineStatePill(p, a) : '') +
        (a.assignee_name ? '<span class="c2swho">' + esc(a.assignee_name) + '</span>' : '') +
        '<span class="c2samt">' +
        (charged ? esc(inr(charged)) : '—') +
        '</span></div>';

      /* ⚠️ Grouped by KIND, not left as one list: "what did the parts come to, and what did the labour" is the
       question a shop asks, and a flat list of six rows makes a person add them up by eye. */
      var byKind = {};
      added.forEach(function (item) {
        /* An entry priced by the hour is labour; anything carrying a catalogue reference is a part; the rest
         is a charge someone typed. The words are the shop's, not the schema's. */
        var k = /hour|hr/i.test(String(item.unit || '')) ? 'Labour' : item.reference ? 'Parts' : 'Other charges';
        (byKind[k] = byKind[k] || []).push(item);
      });

      var detail = Object.keys(byKind)
        .map(function (item) {
          var rows = byKind[item];
          var sub = rows.reduce(function (sum, entry) {
            return sum + Number(entry.amount || 0);
          }, 0);
          /* ⚠️ NO SUBTOTAL FOR A KIND WITH ONE ITEM — it would print the same figure twice, one line apart, and
         a number repeated for no reason is a number a reader has to stop and reconcile. */
          return (
            '<div class="c2skind"><span>' +
            esc(tx(item)) +
            '</span>' +
            '<span>' +
            (sub && rows.length > 1 ? esc(inr(sub)) : '') +
            '</span></div>' +
            rows
              .map(function (entry) {
                var q = entry.quantity ? entry.quantity + ' ' + esc(entry.unit || '') : '';
                return (
                  '<div class="c2sitem"><span class="c2sit">' +
                  esc(entry.particulars || '') +
                  '</span>' +
                  '<span class="c2sq">' +
                  q +
                  '</span>' +
                  '<span class="c2sby">' +
                  esc(entry.by_actor || '') +
                  '</span>' +
                  '<span class="c2sm">' +
                  (entry.amount ? esc(inr(entry.amount)) : '') +
                  '</span></div>'
                );
              })
              .join('')
          );
        })
        .join('');

      return '<div class="c2sgrp">' + head + detail + '</div>';
    })
    .join('');

  /* The one figure the whole screen agrees on — the same sum the strip above shows. */
  var foot =
    '<div class="c2stot"><span>' +
    tx('Total recorded') +
    '</span>' +
    '<b>' +
    esc(inr(total)) +
    '</b></div>' +
    '<div class="c2snote">' +
    esc(
      txf('{n} entr(y/ies) across {m} service(s)', { n: items, m: lines.length })
        .replace('(y/ies)', items === 1 ? 'y' : 'ies')
        .replace('(s)', lines.length === 1 ? '' : 's')
    ) +
    '</div>';

  return (
    '<div class="c2sum" data-testid="c2-summary">' +
    (typeof booksBlockHTML === 'function' ? booksBlockHTML(d) : '') +
    '<div class="c2shdr">' +
    esc(tx('Everything recorded on this job, service by service.')) +
    '</div>' +
    (lines.length ? body : '<div class="c2sempty">' + esc(tx('No services on this chit yet.')) + '</div>') +
    foot +
    '</div>'
  );
}

/**
 * ⭐⭐ THE SAME STRIP DESIGN 1 CARRIES — quoted, spent so far, how much of the work is done — because a
 * person switching between the two readings of one chit must not have to relearn where the money is.
 * Athi, 2026-08-24: *"the spend strip you have in design 1 has to be there in design 2 as well."*
 *
 * ⚠️ chitSpendStrip() lives in the shell and takes a CHIT-SHAPED object, so design 2 hands it one rather
 * than growing a second strip that would drift the first time either changed.
 *
 * ACC-348b: the amount and its currency are the api's bill_total (the detail's own answer) first, the header's summary_json (ACC-206 D1,
 * never delivery_summary: it has no money) only when an older api sends none; a total whose copies disagree is said under the strip.
 */
function c2SpendHTML(reply, header, delivery) {
  var wire = reply.bill_total;
  var summary = header.summary_json;
  var strip =
    typeof chitSpendStrip === 'function'
      ? '<div style="padding:8px 14px 2px">' +
        chitSpendStrip({
          id: C2.id,
          amt: billTotalOf(summary, (reply.detail && reply.detail.total_value) || header.total_value, wire) || 0,
          currency: (wire && wire.currency_code) || (summary && summary.currency_code),
          cost_hidden: c2CostHidden(reply) /* RAIL-146: the server took the money off this read (a cost-blind co-assist): the strip says "hidden" */,
          delivery_summary: delivery,
          line_delivery: reply.line_delivery,
          line_assignment: reply.line_assignment,
          order_billed: reply.order_billed /* W36: "Not billed yet" on an order */,
          _status: header.current_status /* a cancelled or rejected bill shows Mark paid disabled (chitNoPayWhy reads it) */
        }) +
        '</div>'
      : '';
  return strip + billNoticeHTML(wire);
}

/* ── the screen ────────────────────────────────────────────────────────────────────────────────────────────── */
function chit2Screen() {
  if (C2.busy && !C2.data)
    return '<div style="flex:1;min-height:0;overflow-y:auto;padding-bottom:var(--scroll-tail)"><div style="padding:26px;color:var(--grey)"><span class="spin"></span> opening…</div></div>';
  if (C2.err)
    return (
      '<div style="flex:1;min-height:0;overflow-y:auto;padding-bottom:var(--scroll-tail)"><div style="padding:26px;color:var(--disp)">' +
      esc(C2.err) +
      '</div></div>'
    );
  var d = C2.data;
  if (!d)
    return '<div style="flex:1;min-height:0;overflow-y:auto;padding-bottom:var(--scroll-tail)"><div style="padding:26px;color:var(--grey)">Nothing open.</div></div>';
  var h = d.header || {};
  var sum = d.delivery_summary;

  var side = ['them', 'us']
    .map(function (item) {
      var on = C2.side === item;
      return (
        '<button data-cbsid="DTL006-B08" data-testid="c2-side-' +
        item +
        '" onclick="c2Side(\'' +
        item +
        '\')" style="flex:1;border:1px solid ' +
        (on ? 'var(--accent)' : 'var(--line)') +
        ';background:' +
        (on ? 'var(--accent)' : 'transparent') +
        ';color:' +
        (on ? 'var(--on-accent)' : 'var(--grey)') +
        ';font:inherit;font-size:var(--fs-3);padding:9px 0;cursor:pointer;font-weight:' +
        (on ? '600' : '400') +
        ';border-radius:' +
        (item === 'them' ? '8px 0 0 8px' : '0 8px 8px 0') +
        '">' +
        (item === 'them' ? 'Them' : 'Us') +
        '<span style="display:block;font-size:var(--fs-1);opacity:.9;font-weight:400">' +
        (item === 'them' ? 'the shared record' : 'our side only') +
        '</span></button>'
      );
    })
    .join('');

  var tabs = C2_TABS[C2.side]
    .map(function (item) {
      var on = C2.tab === item[0];
      return (
        '<button data-cbsid="DTL006-B09" data-testid="c2-tab-' +
        item[0] +
        '" onclick="c2Tab(\'' +
        item[0] +
        '\')" style="flex:1;background:none;border:0;border-bottom:2px solid ' +
        (on ? 'var(--ink,#1c1a17)' : 'transparent') +
        ';font:inherit;font-size:var(--fs-2);color:' +
        (on ? 'var(--ink)' : 'var(--grey)') +
        ';padding:10px 4px;cursor:pointer;font-weight:' +
        (on ? '600' : '400') +
        '">' +
        item[1] +
        '</button>'
      );
    })
    .join('');

  var pane = { msg: c2PaneMsg, ord: c2PaneOrd, del: c2PaneDel, work: c2PaneWork, summary: c2PaneSummary }[C2.tab] || c2PaneWork;

  /**
   * ⚠️ THE MENU IS FROZEN; ONLY THE LINES SCROLL. Athi, 2026-08-13: *"you need to always freeze the menu part and
   * only the line item has to roll, otherwise it is difficult to work with."*
   *
   * The first version put everything in ONE scrolling box, so the side switch and the tabs rolled away the moment
   * a chit had more than a screenful of lines — and on a phone, changing tab then meant scrolling back to the top
   * first. Now the outer box is a flex COLUMN that does not scroll, the header is a fixed-height child, and only
   * the pane carries `overflow-y:auto`.
   *
   * ⚠️ The outer element must still be `flex:1;min-height:0` — #mainbody is a flex column and `.main` is
   * `overflow:hidden`, so without min-height:0 the pane grows past the viewport and nothing scrolls at all.
   */
  return (
    '<div style="flex:1;min-height:0;display:flex;flex-direction:column;background:var(--card);color:var(--on-card)">' +
    '<div style="flex:none">' + // ← the frozen part
    '<div style="padding:10px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px">' +
    '<span data-cbsid="CMP006" onclick="c2Back()" style="cursor:pointer;color:var(--blue);font-size:var(--fs-2)">‹ Back</span>' +
    /* ⭐ CLASSED `dt` SO THE SCREEN CODE CAN FIND IT. Athi, 2026-09-12: *"if i open design 2, the name does
       not appear"* — this header is design 2's own markup and shares nothing with the classic detail, so the
       stamper had nothing to hook onto. One class, and the same stamper works here as everywhere else
       rather than a second copy that knows about this file. */
    '<span class="dt" style="font-weight:600;font-size:var(--fs-3);flex:1;min-width:0;overflow-wrap:anywhere">' +
    esc(h.manual_subject || h.auto_subject || 'Chit') +
    '</span>' +
    /**
     * ⭐⭐ THE SWITCH IS A CONTROL NOW, NOT A LABEL. It read "design 2" as plain grey text — a statement of
     * where you were with no way to leave, so the only exit was Back to the list and then in again by another
     * door. Athi: *"design 2 and design 1 can be switchable, right?"* Two readings of ONE chit; the way to the
     * other reading belongs on the reading you are in.
     */
    '<button data-cbsid="DTL006-B10" type="button" data-testid="c2-to-design1" onclick="c2Back()"' +
    ' title="' +
    esc(tx('Read this chit as one unit of work instead of line by line')) +
    '"' +
    ' style="border:1px solid var(--line);background:var(--card);color:var(--on-card);border-radius:8px;' +
    'padding:3px 9px;font-size:var(--fs-1);cursor:pointer;white-space:nowrap">' +
    tx('design 2') +
    ' <span style="opacity:.8">→ ' +
    tx('design 1') +
    '</span></button></div>' +
    /* N03: a chit made with a page this install does not have says so here too (CBPage, app/page.js) */
    (typeof CBPage !== 'undefined' ? CBPage.noteHTML(h.business_json) : '') +
    '<div style="padding:10px 16px 0;display:flex">' +
    side +
    '</div>' +
    '<div style="padding:7px 16px 0;font-size:var(--fs-1);color:var(--grey);text-align:center">' +
    (C2.side === 'them' ? 'Both parties hold everything on this side' : 'Assignment, notes and cost — they never see this') +
    '</div>' +
    /**
     * ⭐ THE DOOR TO THE SERVICE CLOCK — and until now there wasn't one.
     *
     * ⚠️ `openServiceClock()` existed in app.html and NOTHING CALLED IT. Two references in the whole codebase:
     * the definition, and a comment in cap-service.js saying "the entry point is not here, it lives in app.html".
     * It did — uncalled. So svcGet/svcRespond/svcResolve/svcPause, the whole SLA capability, was unreachable: a
     * shipped feature with no way in, which is the kind of thing that stays unnoticed precisely because nobody
     * can stumble over it.
     *
     * ⚠️ IT OPENS ONTO AN HONEST 503 UNTIL b147 IS RUN. svcOpen catches the error and shows the server's own
     * words ("The service clock needs b147 on this environment"), so the door tells the truth about the room
     * rather than pretending or crashing.
     *
     * It sits on the US side because an SLA is how WE are serving — the counterparty never sees this side.
     */
    (C2.side === 'us'
      ? '<div style="padding:6px 16px 0;text-align:center">' +
        '<span data-cbsid="DTL006-C08" data-testid="c2-service-clock" onclick="openServiceClock(\'' +
        C2.id +
        '\')"' +
        ' style="cursor:pointer;font-size:var(--fs-2);color:var(--blue)">⏱ Service clock &amp; SLA</span></div>'
      : '') +
    c2SpendHTML(d, h, sum) +
    '<div style="display:flex;border-bottom:1px solid var(--line);margin-top:10px">' +
    tabs +
    '</div>' +
    '</div>' +
    '<div style="flex:1;min-height:0;overflow-y:auto;padding-bottom:var(--scroll-tail)">' +
    pane(d) +
    '</div>' + // ← the only thing that rolls
    '</div>'
  );
}
