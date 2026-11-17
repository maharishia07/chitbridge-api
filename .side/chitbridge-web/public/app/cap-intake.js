/* app/cap-intake.js — THE INTAKE INBOX. Lazy via ensureCap('intake'). · CARD 22-channels-capture-and-messaging/intake-screen
 *
 * OWNS      intakeScreen / paintIntake: the Intake inbox face (pending captures, structure, dismiss, make-a-chit confirm); no pipeline logic
 * FLOW      ensureCap(intake) -> intakeScreen paints -> read pending captures -> human confirm -> chit on the rail (server side)
 * CARD      22-channels-capture-and-messaging/intake-screen
 *
 * Athi, 2026-07-12: someone is chatting on WhatsApp or emailing, and they want it to become a chit on the rail.
 *
 * ── THE ONE PIPELINE (every channel is just an adapter) ──────────────────────────────────────────────────────────
 *     channel → webhook → CAPTURE (raw, untrusted) → AI STRUCTURE → HUMAN CONFIRM → CHIT on rail → notify back
 *
 * This file is the FACE of that pipeline and nothing else. The pipeline itself is already built and live:
 * routes/capture.js, lib/capture.js and migration b104 (the `capture` table, per-entity, WITH RLS). Verified against
 * production on 2026-08-09 — simulate, pending, structure and dismiss all answer 200. What was missing was a way to
 * SEE it from inside the app, which is why this is a screen and not a new subsystem. See SPEC-capture-connector.md.
 *
 * ── ⚠️ A MESSAGE IS A NOTICE. A CHIT IS AN OBLIGATION. ───────────────────────────────────────────────────────────
 * The human confirm is not a nicety, it is the governance boundary. Nothing here mints anything: "Make this a chit"
 * opens Compose with the lines already filled in, and a person still presses Send. An inbound WhatsApp message that
 * became an order by itself would be money crossing on the say-so of an unverified sender and an AI draft.
 *
 * ── ⚠️ THE STRUCTURED LINES GO THROUGH THE CART'S OWN DOOR ───────────────────────────────────────────────────────
 * CBCart.load() is the channel door — the same gate the + button passes through. So "2 boxes of bolts" lands on a
 * legal pack of 12, and 3 m of a cable with a 5 m minimum is REFUSED and reported rather than quietly rounded up.
 * A channel with its own path into the cart would bypass every order model the catalogue declares.
 *
 * ── WHAT IS NOT HERE YET ─────────────────────────────────────────────────────────────────────────────────────────
 * The WhatsApp/email WEBHOOKS exist in the API but are inert: they have no mapping from an inbound number/address to
 * a CB entity, and no BSP is configured. So the honest way in today is "Record a message" — the same createCapture
 * the webhook calls, driven by hand. That is the test surface the spec asked for, not a mock: it exercises the real
 * queue, the real AI structuring and the real convert.
 
 * CALLED BY public/app.html   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]  · CARD 22-channels-capture-and-messaging/intake-screen
 */

/* ── state ──────────────────────────────────────────────────────────────────────────────────────────────────── */
var _INTAKE = { list: null, busy: false, err: null, working: {}, sim: false, migrated: true };

function intakeScreen() {
  return (
    '<div class="list" style="flex:1;min-width:0">' +
    '<div class="lh"><div style="display:flex;align-items:center;gap:8px;margin-bottom:9px">' +
    '<span style="font-family:\'Space Grotesk\';font-weight:700;font-size:var(--fs-3)">' +
    tx('📥 Intake') +
    '</span>' +
    '<button data-cbsid="CMP016" onclick="openAssist(\'intake\')" title="Ask the assistant about this screen" style="border:1px solid var(--line);background:var(--card);color:var(--blue);border-radius:50%;width:20px;height:20px;font-weight:800;cursor:pointer;font-size:12px;line-height:1;flex:none">?</button>' +
    '<button data-cbsid="WRK003-B06" data-testid="intake-refresh" onclick="loadIntake()" style="margin-inline-start:auto;border:1px solid var(--line);background:var(--paper);border-radius:9px;padding:4px 9px;font-size:var(--fs-1);cursor:pointer;color:var(--on-bg)">' +
    tx('↻ Refresh') +
    '</button>' +
    '<button data-cbsid="WRK003-B07" data-testid="intake-simulate-open" onclick="intakeToggleSim()" style="border:1px solid var(--line);background:var(--paper);border-radius:9px;padding:4px 9px;font-size:var(--fs-1);cursor:pointer;color:var(--on-bg)">' +
    tx('✚ Record a message') +
    '</button>' +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);line-height:1.5">' +
    txf('A message is a {notice}; a chit is an {obligation}. Nothing here becomes a chit until you confirm it.', {
      notice: '<b>' + tx('notice') + '</b>',
      obligation: '<b>' + tx('obligation') + '</b>'
    }) +
    '</div>' +
    /**
     * ⚠️ WHICH SIDE OF THE TRADE THIS ENTITY IS ON LIVES IN SETTINGS, NOT HERE.
     *
     * I first put a checkbox on this screen. Athi, 2026-08-09: *"we are creating entity for a purpose, sell and
     * purchase never been the same entity. while testing we are trying to test all the possibility in the same
     * business, so for us it seems the same entity will do everything, but that is not going to be the case."*
     *
     * A per-message toggle models a business that changes sides between messages. Real ones do not — a shop sells,
     * a factory receives — so it is one entity setting, read server-side at raise, and this only POINTS at it.
     */
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:5px">Inbound lines are priced from your catalogue when this entity is set to <b>sell</b> — ' +
    '<a data-cbsid="WRK003-C01" onclick="navTo(\'settings\')" style="color:var(--blue);cursor:pointer;font-weight:600">Settings <span class=arw>→</span> ' +
    tx('Business rules') +
    '</a>.</div>' +
    '</div><div id="intake_body" style="flex:1;overflow:auto;padding:12px 14px">' +
    intakeBodyHTML() +
    '</div></div>'
  );
}
function intakeToggleSim() {
  _INTAKE.sim = !_INTAKE.sim;
  paintIntake();
}
function paintIntake() {
  var node = document.getElementById('intake_body');
  if (node) node.innerHTML = intakeBodyHTML();
}

function _chn(c) {
  var M = { whatsapp: ['var(--ok-2)', 'WhatsApp'], email: ['var(--blue)', 'Email'], web: ['var(--purple-2)', 'Web'], sms: ['var(--warn-2)', 'SMS'] };
  var m = M[c] || ['var(--grey-2)', String(c || 'channel')];
  return (
    '<span style="font-size:var(--fs-1);font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#fff;background:' +
    m[0] +
    ';border-radius:5px;padding:2px 7px">' +
    esc(m[1]) +
    '</span>'
  );
}
function intakeSimHTML() {
  if (!_INTAKE.sim) return '';
  return (
    '<div style="border:1px solid var(--line);border-radius:12px;padding:12px 13px;margin-bottom:12px;background:var(--paper);color:var(--on-bg)">' +
    '<div style="font-weight:700;font-size:var(--fs-2);margin-bottom:6px">' +
    tx('Record an inbound message') +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:8px">The WhatsApp and email webhooks exist but are not connected to a provider yet, so this is how a message gets onto the queue today. It goes through the SAME capture the webhook uses — nothing is faked.</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<select data-cbsid="WRK003-S02" class="inp" id="in_ch" data-testid="intake-sim-channel" style="max-width:130px"><option value="whatsapp">' +
    tx('WhatsApp') +
    '</option><option value="email">' +
    tx('Email') +
    '</option><option value="web">' +
    tx('Web') +
    '</option><option value="sms">' +
    tx('SMS') +
    '</option></select>' +
    '<input data-cbsid="WRK003-I04" class="inp" id="in_from" data-testid="intake-sim-from" placeholder="from — phone or email (required)" style="flex:1;min-width:150px">' +
    '</div>' +
    '<textarea data-cbsid="WRK003-T02" class="inp" id="in_text" data-testid="intake-sim-text" placeholder="what they wrote — e.g. need 2 boxes of bolts and 5 m cable by friday" style="width:100%;margin-top:8px;min-height:64px;font-family:inherit"></textarea>' +
    '<div style="margin-top:8px"><button data-cbsid="WRK003-B08" class="composebtn" data-testid="intake-sim-add" onclick="intakeSimulate()">' +
    tx('Add to the queue') +
    '</button></div>' +
    '</div>'
  );
}
/**
 * ── ⭐⭐ WHAT THE INTAKE QUEUE OFFERS, DECLARED ONCE ─────────────────────────────────────────────────────────────
 *
 * ⚠️ THIS IS THE LIST MOST CERTAIN TO GET LONG, and it had none of the five. Nothing here arrives because
 * somebody pressed a button — messages land from WhatsApp, email and the web, and they keep landing. A queue
 * that can only be scrolled is a queue that gets abandoned.
 *
 * ⚠️ NEWEST FIRST IS THE DEFAULT, and it is the order the queue already came in. What arrived while you were
 * away is the reason you opened this screen.
 *
 * ⭐ "STILL TO READ" IS THE FILTER THAT MATTERS. A capture with no draft on it is one nobody has looked at —
 * that is the working queue, and everything else is history. Channel comes second because on a busy day
 * WhatsApp and email are two different jobs. [[feedback-write-for-the-shopkeeper]]
 */
function intakeCtl() {
  var drafted = function (c) {
    return !!(c.structured || (_INTAKE.working[c.id] || {}).structured);
  };
  /* ⚠️ the channels offered are the ones PRESENT — a shop with no SMS should not be offered an SMS filter that
     can only ever empty its own list. And with one channel there is nothing to choose between, so none is drawn. */
  var chans = [];
  (_INTAKE.list || []).forEach(function (item) {
    if (item.channel && chans.indexOf(item.channel) < 0) chans.push(item.channel);
  });
  chans.sort();
  return listCtl('intake', {
    rows: function () {
      return _INTAKE.list || [];
    },
    /* ⚠️ THE RAW TEXT IS SEARCHED, because that is what a person remembers — "the one about bolts" */
    text: function (c) {
      return [c.sender_name, c.sender_ref, c.channel, c.raw_text].filter(Boolean).join(' ');
    },
    noun: tx('message'),
    plural: tx('messages'),
    filters: [
      {
        key: 'state',
        label: tx('Read yet'),
        all: tx('Read or not'),
        options: [
          { v: 'todo', label: tx('Still to read') },
          { v: 'done', label: tx('Already drafted') }
        ],
        match: function (c, v) {
          return v === 'todo' ? !drafted(c) : drafted(c);
        }
      }
    ].concat(
      chans.length > 1
        ? [
            {
              key: 'channel',
              label: tx('Channel'),
              all: tx('Every channel'),
              options: chans.map(function (item) {
                return { v: item, label: item };
              }),
              match: function (c, v) {
                return c.channel === v;
              }
            }
          ]
        : []
    ),
    sorts: [
      {
        key: 'new',
        label: tx('Newest first'),
        cmp: function (a, b) {
          return Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0);
        }
      },
      {
        key: 'old',
        label: tx('Oldest first'),
        cmp: function (a, b) {
          return Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0);
        }
      },
      {
        key: 'who',
        label: tx('Sender A–Z'),
        cmp: function (a, b) {
          return String(a.sender_name || a.sender_ref || '').localeCompare(String(b.sender_name || b.sender_ref || ''));
        }
      }
    ],
    repaint: function () {
      paintIntake();
    }
  });
}
function intakeBodyHTML() {
  if (_INTAKE.busy && !_INTAKE.list) return intakeSimHTML() + '<div class="loadwrap"><span class="spin"></span> reading the queue…</div>';
  /* b104 is applied in production, but an environment without it answers 503 — say which it is, because "no
     messages" and "the table does not exist" look identical on screen and mean completely different things. */
  if (!_INTAKE.migrated)
    return (
      '<div style="background:var(--gold-soft);border:1px solid var(--gold-line);border-radius:9px;padding:11px 13px;font-size:var(--fs-2);color:var(--warn-3)">' +
      'The intake queue is not migrated on this environment (b104). The screen is here; the table is not.</div>'
    );
  if (_INTAKE.err)
    return (
      intakeSimHTML() +
      '<div style="background:var(--danger-tint);border:1px solid #f0c9c6;border-radius:9px;padding:11px 13px;font-size:var(--fs-2);color:var(--disp)">' +
      esc(_INTAKE.err) +
      '</div>'
    );
  intakeCtl();
  var L = listCtlView('intake').matched;
  /* ⭐ THE CONTROLS ARE DRAWN EVEN WHEN NOTHING MATCHES. A search that empties the queue must not also remove
     the box you would use to undo it — that is a dead end wearing an empty state. */
  var bar =
    '<div style="margin-bottom:4px;font-size:var(--fs-1);color:var(--grey)" id="intake_count">' +
    listCtlCountHTML('intake') +
    '</div>' +
    listCtlToolbarHTML('intake') +
    '<div style="height:10px"></div>';
  /**
   * ⚠️⚠️ THIS WORE `class="empty"` AND USED NONE OF IT. Every measurement — padding, alignment, the icon's
   * font-size, both text colours — was re-specified inline, so the class was decoration on a private
   * implementation. That is worse than an honest hand-roll: it reads as "uses the shared empty state" to anyone
   * scanning, and it drifts from the real one silently, because nothing connects them.
   *
   * ⚠️ NO ACTION OFFERED, DELIBERATELY. Nothing arrives here because someone pressed a button — a message lands
   * from WhatsApp or email or the web. The next step belongs to the sender, so there is none to put here.
   */
  if (!L.length)
    return (
      intakeSimHTML() +
      bar +
      listCtlEmptyHTML('intake', '📥', tx('Nothing waiting'), tx('Messages from WhatsApp, email and the web land here — raw, until you turn one into a chit.'))
    );
  return intakeSimHTML() + bar + listCtlRowsHTML('intake', intakeCardHTML, '');
}
function intakeCardHTML(c) {
  var w = _INTAKE.working[c.id] || {},
    s = c.structured || w.structured;
  return (
    '<div class="cap" data-testid="intake-row" style="border:1px solid var(--line);border-radius:12px;padding:12px 13px;margin-bottom:10px;background:var(--card);color:var(--on-card)">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
    _chn(c.channel) +
    '<span style="font-size:var(--fs-1);color:var(--grey)">' +
    esc(c.sender_name || c.sender_ref || 'unknown sender') +
    '</span>' +
    (c.sender_name && c.sender_ref
      ? '<span style="font-size:var(--fs-1);color:var(--grey);font-family:ui-monospace,Menlo,monospace">' + esc(c.sender_ref) + '</span>'
      : '') +
    '<span style="margin-inline-start:auto;font-size:var(--fs-1);color:var(--grey)">' +
    esc(
      String(c.created_at || '')
        .slice(0, 16)
        .replace('T', ' ')
    ) +
    '</span></div>' +
    /* ⚠️ THE RAW TEXT IS UNTRUSTED and is shown as TEXT, never as markup. esc() is the whole guard: a capture is a
       stranger's words arriving from outside the rail. */
    '<div style="font-size:var(--fs-2);margin:8px 0;white-space:pre-wrap">' +
    esc(c.raw_text || '') +
    '</div>' +
    (s ? intakeDraftHTML(c, s) : '') +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:9px">' +
    /* TWO doors out of a read message, and they are not the same act. RAISE files it as a request, unedited, in
       the sender's terms — one press, because most inbound messages need nothing more. MAKE A CHIT opens Compose
       to edit, price and address it, which is what you want when the message is a starting point rather than the
       thing itself. Neither sends anything without a person pressing it. */
    (s
      ? '<button data-cbsid="WRK003-B09" class="composebtn" data-testid="intake-raise" ' +
        (w.busy ? 'disabled' : '') +
        ' onclick="intakeRaise(\'' +
        esc(c.id) +
        '\')" title="File as a request in your inbox, in their words">' +
        (w.busy ? 'Raising…' : '📥 Raise as a request') +
        '</button>' +
        '<button data-cbsid="WRK003-B10" data-testid="intake-make-chit" onclick="intakeMakeChit(\'' +
        esc(c.id) +
        '\')" style="border:1px solid var(--line);background:var(--card);border-radius:9px;padding:9px 15px;font-size:var(--fs-2);font-weight:700;cursor:pointer;color:var(--on-card)" title="Open Compose to edit, price and address it before sending">Make this a chit <span class=arw>→</span></button>'
      : '<button data-cbsid="WRK003-B11" class="composebtn" data-testid="intake-structure" ' +
        (w.busy ? 'disabled' : '') +
        ' onclick="intakeStructure(\'' +
        esc(c.id) +
        '\')">' +
        (w.busy ? '✨ Reading…' : '✨ Structure it') +
        '</button>') +
    '<button data-cbsid="WRK003-B12" data-testid="intake-dismiss" onclick="intakeDismiss(\'' +
    esc(c.id) +
    '\')" style="border:1px solid var(--line);background:var(--card);border-radius:9px;padding:9px 15px;font-size:var(--fs-2);font-weight:700;cursor:pointer;color:var(--grey)">' +
    tx('Dismiss') +
    '</button>' +
    /* ⚠️ THE CONFIRM STEP MUST SHOW WHAT IT IS ASKING YOU TO CONFIRM. Athi, 2026-08-11, after finding that
       "konjam spiciya" and "periya bottle" were nowhere on screen: this card renders only particulars + qty + unit,
       so comment, unit_size, unit_price and unplaced were invisible whether the reader captured them or not — at
       exactly the moment a person decides whether the reading is right. A button that shows the actual JSON is the
       difference between tuning a prompt and guessing at one. */
    '<button data-cbsid="WRK003-B13" data-testid="intake-json" onclick="intakeShowJson(\'' +
    esc(c.id) +
    '\')" title="See exactly what was read, and what the chit would carry" style="border:1px solid var(--line);background:var(--card);border-radius:9px;padding:9px 13px;font-size:var(--fs-2);font-weight:700;cursor:pointer;font-family:ui-monospace,Menlo,monospace;color:var(--on-card)">{ } JSON</button>' +
    '</div>' +
    (w.err ? '<div style="color:var(--disp);font-size:var(--fs-2);margin-top:6px">' + esc(w.err) + '</div>' : '') +
    '</div>'
  );
}
function intakeDraftHTML(c, s) {
  var li = s.line_items || [];
  return (
    '<div style="background:var(--blue-tint-bg);border:1px solid #e4dff6;border-radius:9px;padding:10px 12px;margin-top:8px;font-size:var(--fs-2);color:var(--on-card)">' +
    '<div style="font-weight:700;margin-bottom:4px">✨ AI draft <span style="font-weight:400;color:var(--grey)">— proposed, not evidence. You confirm.</span></div>' +
    (s.subject ? '<div style="margin-bottom:4px"><b>Subject:</b> ' + esc(s.subject) + '</div>' : '') +
    li
      .map(function (item) {
        return (
          '<div style="display:flex;justify-content:space-between;padding:3px 0;border-top:1px dashed var(--line);font-size:var(--fs-2)">' +
          /**
           * ⚠️ THE QUALIFIERS RENDER WITH THE LINE. This showed only particulars + qty + unit, so "konjam spiciya"
           * and "periya bottle" were invisible whether the reader had captured them or not — at exactly the moment a
           * person decides whether the reading is right. A confirm step must show what it is asking you to confirm.
           */
          '<span>' +
          esc(item.particulars || 'item') +
          (item.comment ? '<span style="color:var(--warn-3)"> · ' + esc(item.comment) + '</span>' : '') +
          '</span>' +
          '<span style="color:var(--grey);white-space:nowrap">' +
          esc(String(item.qty == null ? '' : item.qty)) +
          ' ' +
          esc(item.unit || '') +
          (item.unit_size ? ' (' + esc(item.unit_size) + ')' : '') +
          (item.unit_price ? ' @' + esc(String(item.unit_price)) : '') +
          '</span></div>'
        );
      })
      .join('') +
    /* Order-level facts that have no line of their own — and `unplaced` in red, because a fact the reader could
         not place is the single most useful thing on this card when tuning. */
    ['delivery_at', 'delivery_address', 'notes']
      .filter(function (item) {
        return s[item];
      })
      .map(function (item) {
        return '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:3px">' + esc(item.replace('_', ' ')) + ': ' + esc(s[item]) + '</div>';
      })
      .join('') +
    (s.unplaced ? '<div style="font-size:var(--fs-1);color:var(--disp);margin-top:3px">⚠️ not placed anywhere: ' + esc(s.unplaced) + '</div>' : '') +
    (s.notes ? '<div style="margin-top:5px;color:var(--grey)">' + esc(s.notes) + '</div>' : '') +
    '</div>'
  );
}

/* ── the API calls. Each one narrow, each one saying what failed. ────────────────────────────────────────────── */
async function loadIntake(quiet) {
  _INTAKE.busy = true;
  _INTAKE.err = null;
  paintIntake();
  try {
    var reply = await api('capturePending');
    _INTAKE.list = (reply && reply.captures) || [];
    _INTAKE.migrated = true;
  } catch (e) {
    // 503 is the migration gate the route declares, not a fault — tell them apart.
    if (/not migrated|b104|503/i.test((e && e.message) || '')) {
      _INTAKE.migrated = false;
    } else _INTAKE.err = (e && e.message) || 'Could not read the intake queue.';
    _INTAKE.list = _INTAKE.list || [];
  }
  _INTAKE.busy = false;
  paintIntake();
  /**
   * ⭐ SAY WHAT THE READ FOUND. An empty queue repaints to exactly the same screen, so without this the
   * button is indistinguishable from a dead one — which is how Athi described the board’s own refresh
   * before it was fixed. ⚠️ Only on a HAND press: `quiet` is passed by the callers that load on open, and a
   * toast nobody asked for on every screen entry is its own kind of noise.
   */
  if (!quiet && typeof toast === 'function') {
    if (_INTAKE.err) toast(_INTAKE.err, true);
    else if (_INTAKE.migrated === false) toast('The intake queue is not switched on yet for this shop.');
    else toast(_INTAKE.list.length ? 'Intake re-read \u2014 ' + _INTAKE.list.length + ' waiting' : 'Intake re-read \u2014 nothing waiting');
  }
}
async function intakeSimulate() {
  var ch = val('in_ch') || 'whatsapp',
    from = (val('in_from') || '').trim(),
    text = (val('in_text') || '').trim();
  if (!text) {
    toast('Type what they wrote first.', true);
    return;
  }
  /**
   * ⚠️⚠️ WHO IT IS FROM IS NOT OPTIONAL. Athi, 2026-08-24, on testing design 2 with captured jobs: *"data was
   * not moving from customer to supplier."* The jobs he tested on had this box empty, so `sender_ref` was null,
   * `summary_json.via.from` was null, and every screen that asks "who asked for this" had nobody to name — the
   * chit read as the workshop writing to itself, which is what made the whole Them side look hollow.
   *
   * ⭐ A REAL WEBHOOK ALWAYS CARRIES IT (the provider supplies the number), so this only ever bites the
   * hand-driven path — which is precisely the path used for testing, and therefore the path that decides what
   * the product is believed to do.
   */
  if (!from) {
    toast('Say who it is from — a phone number or an email. Without it the job has no customer.', true);
    var node = document.getElementById('in_from');
    if (node) node.focus();
    return;
  }
  try {
    await api('captureSimulate', { body: { channel: ch, sender_ref: from, sender_name: from, raw_text: text } });
    var t = document.getElementById('in_text');
    if (t) t.value = '';
    await loadIntake(true);
  } catch (e) {
    toast((e && e.message) || 'Could not record the message', true);
  }
}
async function intakeStructure(id) {
  _INTAKE.working[id] = { busy: true };
  paintIntake();
  try {
    var reply = await api('captureStructure', { params: { id: id } });
    _INTAKE.working[id] = { structured: (reply && reply.structured) || null };
  } catch (e) {
    _INTAKE.working[id] = { err: (e && e.message) || 'AI could not read that message.' };
  }
  paintIntake();
}
function intakeDismiss(id) {
  confirmAsk(
    'Dismiss this message?',
    'It stays on the capture queue as <b>dismissed</b> — a receipt that it arrived and was not turned into a chit.',
    'Dismiss',
    function () {
      _intakeDismiss(id);
    }
  );
}
async function _intakeDismiss(id) {
  try {
    await api('captureDismiss', { params: { id: id } });
    await loadIntake(true);
  } catch (e) {
    toast((e && e.message) || 'Could not dismiss it', true);
  }
}
/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *  intakeRaise — the message becomes a REQUEST addressed to you, in their words, one press.
 * ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Athi, 2026-08-09: *"what we need is creating a chit and send it to the entity as a request."*
 *
 * ⚠️ A TASK, NOT AN ORDER. It is a SELF-CHIT with the Order copy suppressed, so it lands in your inbox and NOT in
 * your Sent list. You did not raise this — someone outside asked — and a copy in Sent would claim otherwise. The
 * suppression is declared on the chit (copy_policy, source:'request'), so the missing copy is governed, not a hole.
 *
 * ⚠️ AND IT IS AN `inquiry`, NOT AN `order`. Nobody has agreed to anything: a stranger asked, and answering is
 * still yours to do. A request that entered the ledger as an order would be an obligation minted by a message.
 *
 * ⚠️ THE SENDER IS NOT A RECIPIENT. /api/chits/send resolves every recipient to a live entity and refuses a name
 * that does not; a WhatsApp number is not an entity, and inventing one for every stranger would put unverified
 * identities on the rail. They are the ORIGIN, recorded in business_json.via — WHICH line they wrote to, WHICH
 * provider message it was, and that they are NOT verified.
 *
 * The payload is built SERVER-SIDE from the stored capture row (POST /api/capture/:id/raise, which creates
 * nothing) and then goes through the ONE send. Provenance a browser composes is a claim about itself; provenance
 * read off the row the webhook wrote is a record.
 */
async function intakeRaise(id) {
  _INTAKE.working[id] = Object.assign({}, _INTAKE.working[id], { busy: true, err: null });
  paintIntake();
  try {
    // ⚠️ NO use_catalogue FROM HERE. The entity's trade_side decides it, server-side — a receiving entity must not
    //    be talked into sell-side pricing by a request body.
    var reply = await api('captureRaise', { params: { id: id } });
    UI._captureId = id; // sendChit files the receipt: this capture became that chit
    /**
     * ⚠️ THE ORIGINAL MESSAGE RIDES ALONG AS EVIDENCE. Athi, 2026-08-09: *"the copy is attached along with the
     * message so it can be verified against."*
     *
     * The lines on this chit are a co-assist's reading of someone else's words. A reading with the original beside
     * it can be checked and disputed; a reading without one has to be trusted. Attachments already replicate
     * per-entity-per-copy, so each party HOLDS the original rather than a pointer to ours — which is exactly the
     * difference that matters when two readings disagree months later.
     */
    var files = [];
    if (reply.original && reply.original.text) {
      try {
        files.push(new File([reply.original.text], reply.original.filename || 'original-message.txt', { type: 'text/plain' }));
      } catch (_) {
        /* older engines: a chit with the lines but no evidence beats no chit at all */
      }
    }
    var r = await sendChit({
      recipients: (reply.recipients || []).map(function (x) {
        return { name: '', role: x.role || 'to', self: !!x.self };
      }),
      subject: reply.subject,
      line_items: reply.line_items || [],
      purpose: reply.purpose,
      business_json: reply.business_json,
      self_copy: reply.self_copy,
      files: files,
      onError: function (m) {
        _INTAKE.working[id] = { err: m };
        paintIntake();
      }
    });
    if (!r) {
      _INTAKE.working[id] = Object.assign({}, _INTAKE.working[id], { busy: false });
      paintIntake();
      return;
    }
    /* sendChit already navigates to the Task list and reloads it — the request is on screen where it landed. The
       intake queue is re-read too, because /convert has just taken this message off it. */
    await loadIntake(true);
  } catch (e) {
    UI._captureId = null;
    _INTAKE.working[id] = Object.assign({}, _INTAKE.working[id], { busy: false, err: (e && e.message) || 'Could not raise it as a request.' });
    paintIntake();
  }
}
/**
 * intakeMakeChit — the CONFIRM GATE, and the only route from a message to the rail.
 *
 * ⚠️ IT OPENS COMPOSE. It does not send. The lines are proposed by an AI from a stranger's message; a person reads
 * them, fixes what is wrong, addresses it, and presses Send. That gap is the whole difference between a notice and
 * an obligation.
 *
 * ⚠️ AND THE LINES GO THROUGH CBCart.load(), the same gate the + button uses — so the catalogue's order models
 * apply to an inbound WhatsApp message exactly as they do to a human pressing +. "2 boxes" of a pack-of-12 becomes
 * 24; 3 m of a 5 m-minimum cable is REFUSED and reported, never rounded up to fit. A channel that wrote straight
 * into the cart would mint orders the catalogue says cannot exist.
 */
async function intakeMakeChit(id) {
  var c = (_INTAKE.list || []).filter(function (x) {
    return x.id === id;
  })[0];
  var w = _INTAKE.working[id] || {};
  var s = (c && c.structured) || w.structured;
  if (!c || !s) return;
  // The chit carries WHERE IT CAME FROM in its subject line, so provenance is readable six weeks later.
  var subj = s.subject || 'From ' + (c.sender_name || c.sender_ref || c.channel);
  UI._captureId = id; // sendChit records the linkage once a chit really exists
  /**
   * ⚠️ PROVENANCE TRAVELS WITH THE LINES, and it is handed over BEFORE compose opens.
   *
   * Athi, 2026-08-09: *"it just opened the compose screen, the data is not going to the chit."* It was going to the
   * chit. What it was not doing was SAYING so: compose opened on an empty cart reading "Press + on what this chit
   * is for" while it fetched the catalogue, and the lines landed below the fold a second or two later. Arriving
   * work that announces nothing cannot be told apart from work that never arrived.
   */
  var CHN = { whatsapp: 'a WhatsApp message', email: 'an email', sms: 'an SMS', web: 'the web' };
  await compose({
    subject: subj,
    origin: { kind: 'capture', channel: c.channel, channelName: CHN[c.channel] || 'a ' + c.channel + ' message', from: c.sender_name || c.sender_ref || null }
  });
  if (!UI._ccCart) return;
  var res = UI._ccCart.load(
    (s.line_items || []).map(function (item) {
      return {
        name: item.particulars || item.description,
        qty: item.qty == null ? 1 : item.qty,
        unit: item.unit,
        price: item.rate != null ? item.rate : item.price
      };
    })
  );
  if (typeof ccAddPicked === 'function') ccAddPicked(); // the placed lines become chit lines, through the one gate
  /* ⚠️ WHAT COULD NOT BE PLACED IS REPORTED, never silently dropped — a refused line is a real request the
     catalogue's own rules would not accept at that quantity. It goes on the ORIGIN BANNER, not in cc_err: cc_err
     is cleared by the next repaint, so the one message explaining a missing line had the shortest life of anything
     on the screen. Then repaint the step, so the lines lead and the banner counts them. */
  if (CC.origin) CC.origin.refused = (res && res.refused) || [];
  if (UI._ccFlow) UI._ccFlow.paint();
  if (typeof ccPaintStepParts === 'function') ccPaintStepParts();
}

/* ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *  { } JSON — what was read, and what the chit would actually carry.
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Athi, 2026-08-11: *"create a json structure as part of the display… so i can just click and see what the json
 * consists of. so we can see how the complex stuff is going to work."*
 *
 * ⚠️ THREE STAGES, BECAUSE THE INTERESTING PART IS THE TRANSFORMATION. Showing only the AI's output tells you what
 * it heard; showing only the chit tells you what survived. The gap between them is where a lost "konjam spiciya"
 * or an invented unit actually happens, and you cannot tune a prompt you can only see one end of.
 *
 *   1 · THE MESSAGE      what the sender actually wrote, verbatim
 *   2 · WHAT WAS READ    the AI's structured output — comment, unit_size, unit_price, unplaced and all
 *   3 · WHAT THE CHIT GETS  the raise payload: catalogue matching applied, prices attached, flags raised
 *
 * ⚠️ STAGE 3 CREATES NOTHING. /raise is a pure read that returns what WOULD be sent — the same call the button
 * uses, minus the send. So this is a preview in the honest sense, not a dry-run that half-commits.
 */
async function intakeShowJson(id) {
  var c = (_INTAKE.list || []).filter(function (x) {
    return x.id === id;
  })[0];
  if (!c) return;
  var w = _INTAKE.working[id] || {};
  var structured = c.structured || w.structured || null;

  modal(
    '<div class="mhd"><div class="t">{ } What the reader saw</div>' +
      '<div class="s">the message <span class=arw>→</span> what was read <span class=arw>→</span> what the chit would carry</div></div>' +
      '<div class="mbody" id="ijson"><div style="padding:18px;color:var(--grey);font-size:var(--fs-2)"><span class="spin"></span> building…</div></div>' +
      '<div class="mfoot"><button data-cbsid="CMP005" class="composebtn" onclick="closeModal()">' +
      tx('Close') +
      '</button></div>',
    true
  );

  /* Stage 3 needs the server, and it may legitimately refuse — nothing read yet (409), or not migrated. A refusal
     is INFORMATION here, so it is shown rather than swallowed: "it would not raise, and here is why". */
  var payload = null,
    payErr = null;
  if (structured) {
    try {
      payload = await api('captureRaise', { params: { id: id } });
    } catch (e) {
      payErr = (e && e.message) || 'could not build the chit payload';
    }
  }

  var host = document.getElementById('ijson');
  if (!host) return;
  host.innerHTML =
    _jsonBlock('1 · THE MESSAGE — verbatim, as it arrived', {
      channel: c.channel,
      from: c.sender_ref,
      from_name: c.sender_name,
      to_line: c.to_ref,
      received_at: c.created_at,
      text: c.raw_text,
      media: (c.media_refs || []).length
    }) +
    _jsonBlock('2 · WHAT WAS READ — the co-assist\u2019s output' + (structured ? '' : ' (press \u2728 Structure it first)'), structured || '(not read yet)') +
    (payErr
      ? _note('3 · WHAT THE CHIT WOULD CARRY \u2014 refused: ' + payErr)
      : _jsonBlock('3 · WHAT THE CHIT WOULD CARRY — after the catalogue is applied', payload || '(only available once it has been read)')) +
    '<div style="padding:10px 14px;font-size:var(--fs-1);color:var(--grey);line-height:1.6;border-top:1px solid var(--line)">' +
    txf(
      '\u26A0\uFE0F {read} A qualifier the sender wrote should appear as {comment} on its line; a size like {size} as {unitsize}; a stated price as {unitprice}. Anything the reader could not place lands in {unplaced} \u2014 if that is empty and something is still missing from the message, the reader dropped it silently, and that is the bug worth telling us about.',
      {
        read: '<b>' + tx('Read stage 2 against stage 3.') + '</b>',
        comment: '<b>comment</b>',
        size: '&ldquo;periya&rdquo; ' + tx('or') + ' &ldquo;500ml&rdquo;',
        unitsize: '<b>unit_size</b>',
        unitprice: '<b>unit_price</b>',
        unplaced: '<b>unplaced</b>'
      }
    ) +
    '</div>';
}

/* Pretty, escaped, scrollable, and copyable. ⚠️ esc() is not optional: this is a stranger's words plus an AI's
   reading of them, which is precisely the input that must never reach the DOM as markup. */
function _jsonBlock(title, obj) {
  var txt = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  var id = 'jb' + Math.random().toString(36).slice(2, 8);
  return (
    '<div style="border-bottom:1px solid var(--line)">' +
    '<div style="display:flex;align-items:center;gap:8px;padding:9px 14px 5px">' +
    '<span style="font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--grey)">' +
    esc(title) +
    '</span>' +
    '<span data-cbsid="WRK003-C02" onclick="_copyJson(\'' +
    id +
    '\')" style="margin-inline-start:auto;font-size:var(--fs-1);color:var(--blue);cursor:pointer">copy</span>' +
    '</div>' +
    '<pre id="' +
    id +
    '" style="margin:0;padding:0 14px 12px;font:11.5px/1.55 ui-monospace,Menlo,Consolas,monospace;' +
    'white-space:pre-wrap;word-break:break-word;max-height:46vh;overflow:auto;color:var(--on-card)">' +
    esc(txt) +
    '</pre></div>'
  );
}
function _note(t) {
  return (
    '<div style="padding:11px 14px;font-size:var(--fs-2);color:var(--warn-2);background:var(--gold-soft);border-bottom:1px solid var(--line)">' +
    esc(t) +
    '</div>'
  );
}
function _copyJson(id) {
  var el = document.getElementById(id);
  if (!el) return;
  try {
    navigator.clipboard.writeText(el.textContent);
    if (typeof toast === 'function') toast('copied');
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
}
