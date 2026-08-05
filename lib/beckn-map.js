// @stage tested
// @stage-note The Beckn <-> chit mapping as a readable TABLE plus a small applier. 22 assertions. Deliberately UNWIRED: alignment you can review and reject, with no new surface area to confuse the Saturday team run.
'use strict';
/**
 * beckn-map.js — the Beckn ↔ chit mapping, as a TABLE you can read.
 *
 * ── WHAT THIS IS ───────────────────────────────────────────────────────────────────────────────────────────────
 * Not a layer, and deliberately not clever code. It is a **table of rules** (`RULES`, below) plus about forty lines
 * that apply them. You can review the mapping by reading the table alone — `node -e "require('./lib/beckn-map')
 * .print()"` renders it as a matrix — without reading any JavaScript. The table IS the documentation, so there is
 * no separate document to drift out of date.
 *
 * ── WHY IT IS ADOPTION, NOT ENGINE ─────────────────────────────────────────────────────────────────────────────
 * Athi, 2026-08-05: *"can we differentiate between Beckn and CB, or do both become one?"*
 *
 * They cannot become one, because they are different KINDS of thing. **Beckn is a wire; a chit is a record.** A
 * wire protocol has no opinion about what you keep; a record system has no opinion about how messages travel. And
 * CB is NOT a superset — Beckn does discovery across strangers, which CB deliberately does not.
 *
 * The differentiation is not at risk structurally (Beckn has no field for per-copy or the seal, so those cannot
 * leak away). It is at risk through VOCABULARY DRIFT: if Beckn's order states start living in CB's state machine,
 * the record begins serving the protocol instead of the parties. So:
 *
 *   ▸ Beckn vocabulary lives HERE and never crosses into the engine.
 *   ▸ Beckn states map IN. They never become CB states.
 *   ▸ CB-only states — sealed, co-held, disputed-per-party — never map OUT. Rules with `cbOnly: true` have no
 *     Beckn path at all, and `toBeckn()` cannot emit them even by accident.
 *
 * This file is classified ADOPTION in tests/engine-boundary.test.js, so the engine may never import it.
 *
 * ── PROVENANCE, per rule ───────────────────────────────────────────────────────────────────────────────────────
 * `seen` records HOW each field is known:
 *   'live'  observed in a real on_confirm captured from reference software on 2026-08-05 (Beckn 1.1.0)
 *   'spec'  read from the published specification, NOT yet observed
 *   'cb'    a ChitBridge column, verified against migrations/000_baseline.sql
 * Anything marked 'spec' is a claim, not an observation. Treat those as the ones most likely to be wrong.
 *
 * ⚠️ VERSION. Athi chose to target **v2.0.0-lts**, because that is what the maintained ONIX adapter validates. The
 * live capture available to us was **1.1.0** (the sandbox image serves only 0.9.4 and 1.1.0). The fields below are
 * the ones stable across both, but the `seen:'live'` evidence is 1.1.0 evidence. Do not report this as
 * "v2.0.0 verified" until something has actually spoken 2.0.0 to us.
 */

/** Beckn action → CB purpose. ONE-WAY: this is how their vocabulary enters, never how ours leaves. */
const ACTION_TO_PURPOSE = {
  confirm: 'order',
  init:    'offer',      // a quote agreed but not confirmed — our negotiation shape
  select:  'enquiry',
  status:  null,         // a question about an existing chit, not a new one
  cancel:  null,
  update:  null,
};

/**
 * Beckn order state → CB chit status. ONE-WAY, and deliberately incomplete.
 *
 * Beckn's states are DOMAIN-SPECIFIC (retail and mobility differ) and, as of this writing, ONDC has an open issue
 * on exactly this mapping. So anything not listed stays null and the chit keeps the status it already had, rather
 * than being moved by a word we guessed at. Silence is safer than a wrong transition on a co-held record.
 */
const STATE_TO_STATUS = {
  Created:    'pending',
  Accepted:   'accepted',
  'In-progress': 'in_progress',
  Completed:  'completed',
  Cancelled:  'cancelled',
};

/** CB status → Beckn state. Only the four we can state honestly; everything else is withheld (see toBeckn). */
const STATUS_TO_STATE = {
  pending:    'Created',
  accepted:   'Accepted',
  in_progress: 'In-progress',
  completed:  'Completed',
  cancelled:  'Cancelled',
};

/**
 * THE TABLE. Every row is one field relationship. Read this and you have read the mapping.
 *
 *   beckn     dotted path in the Beckn message, or null when Beckn has no such concept
 *   cb        the ChitBridge column or summary_json key, or null when CB has no such concept
 *   dir       'in'   Beckn → CB only
 *             'out'  CB → Beckn only
 *             'both' round-trips
 *             'none' NO path — present so the gap is visible rather than forgotten
 *   cbOnly    true = must never be emitted to the network. The differentiator, protected structurally.
 *   seen      'live' | 'spec' | 'cb'   (see PROVENANCE above)
 */
const RULES = [
  // ── the envelope ────────────────────────────────────────────────────────────────────────────────────────
  { beckn: 'context.transaction_id', cb: 'chit_id',        dir: 'both', seen: 'live',
    note: 'The conversation. Beckn spans many messages under one transaction_id; a chit is one record with a lifecycle.' },
  { beckn: 'context.message_id',     cb: 'summary_json.beckn.message_id', dir: 'both', seen: 'live',
    note: 'ONE STEP, not the record. Kept so a callback can be correlated; never used as the chit identity.' },
  { beckn: 'context.action',         cb: 'purpose',        dir: 'in',   seen: 'live', via: 'ACTION_TO_PURPOSE',
    note: 'Their vocabulary enters here and stops. confirm→order, init→offer.' },
  { beckn: 'context.domain',         cb: 'schema_id',      dir: 'in',   seen: 'live',
    note: 'CB already has a column for "which schema governs this". Beckn domain lands in it.' },
  { beckn: 'context.version',        cb: 'schema_version', dir: 'in',   seen: 'live',
    note: 'Recorded, never negotiated. We answer in the version we were asked in.' },
  { beckn: 'context.bap_id',         cb: 'sender_entity_bridge_id',  dir: 'both', seen: 'live',
    note: '⚠ A BAP is a PLATFORM; our entity is a BUSINESS. Not the same granularity — one BAP fronts many buyers.' },
  { beckn: 'context.bap_uri',        cb: 'summary_json.beckn.bap_uri', dir: 'both', seen: 'live',
    note: 'Where the callback goes. Stored on the chit so a reply can be sent later, asynchronously.' },
  { beckn: 'context.bpp_id',         cb: 'all_recipients[].bridge_id', dir: 'both', seen: 'live', note: 'Us, when we are the seller.' },
  { beckn: 'context.timestamp',      cb: 'created_at',     dir: 'both', seen: 'live', note: '' },
  { beckn: 'context.ttl',            cb: null,             dir: 'none', seen: 'live',
    note: 'Message freshness. A wire concern — a record does not expire because a message did.' },

  // ── the payload ─────────────────────────────────────────────────────────────────────────────────────────
  { beckn: 'message.order.id',       cb: 'chit_ref',       dir: 'both', seen: 'live', note: 'Their order id, kept as our cross-reference.' },
  { beckn: 'message.order.items[]',  cb: 'chit_detail.line_items', dir: 'both', seen: 'live', note: '' },
  { beckn: 'message.order.items[].quantity.count', cb: 'line_items[].qty', dir: 'both', seen: 'live', note: '' },
  { beckn: 'message.order.quote.price', cb: 'total_value + currency_code', dir: 'both', seen: 'live', via: 'money',
    note: '⚠ `value` is a STRING with currency in-band. Parsed into {amount,currency}, NEVER adopted as a number. ' +
          'The SUPPLIER\'S currency is final: a mismatch is refused, not converted.' },
  { beckn: 'message.order.billing',  cb: 'business_json.billing',   dir: 'both', seen: 'live', note: 'No CB column; carried whole.' },
  { beckn: 'message.order.fulfillments[]', cb: 'business_json.fulfillments', dir: 'both', seen: 'live',
    note: 'Logistics. CB carries it as evidence and does not act on it — the ERP does fulfilment.' },
  { beckn: 'message.order.payments[]', cb: 'business_json.payments', dir: 'both', seen: 'live',
    note: 'Recorded, never executed. CB moves no money.' },
  { beckn: 'message.order.cancellation_terms[]', cb: null, dir: 'none', seen: 'live',
    note: '⚠ UNRESOLVED. Policy, not record — no natural home yet. Deliberately unmapped rather than dropped into business_json by default.' },
  { beckn: 'message.order.state',    cb: 'current_status', dir: 'both', seen: 'spec', via: 'STATE_TO_STATUS',
    note: 'Deliberately INCOMPLETE both ways. Beckn states are domain-specific and unsettled; an unknown one moves nothing.' },

  // ── theirs, not ours ────────────────────────────────────────────────────────────────────────────────────
  { beckn: 'Authorization (xed25519)', cb: null, dir: 'none', seen: 'spec',
    note: 'Signing belongs to the adapter (ONIX / protocol-server). CB must never learn to sign — that code would be deleted.' },
  { beckn: 'registry / subscriber_id', cb: null, dir: 'none', seen: 'spec',
    note: 'Network membership. Deliberately not our path — see the claim ladder in BACKLOG-beckn-compatible.md.' },
  { beckn: 'search / on_search',     cb: null, dir: 'none', seen: 'spec',
    note: 'DISCOVERY ACROSS STRANGERS. Beckn does this and CB does not. This is the row proving CB is not a superset.' },

  // ── ours, not theirs — the differentiators ──────────────────────────────────────────────────────────────
  { beckn: null, cb: 'entity_id (per copy)', dir: 'none', cbOnly: true, seen: 'cb',
    note: 'THE PRODUCT. One Beckn message becomes TWO owned rows. Beckn has no field for the second one.' },
  { beckn: null, cb: 'the seal',             dir: 'none', cbOnly: true, seen: 'cb',
    note: 'Nothing in Beckn makes two copies verifiably identical. It rides INSIDE the envelope, invisible to the network.' },
  { beckn: null, cb: 'chit_disputes (per party)', dir: 'none', cbOnly: true, seen: 'cb',
    note: 'Beckn has `support`. That is a help desk, not a private siding with per-party scoping.' },
  { beckn: null, cb: 'trace / co-held edge',  dir: 'none', cbOnly: true, seen: 'cb', note: '' },
  { beckn: null, cb: 'order_input (7 presets)', dir: 'none', cbOnly: true, seen: 'cb',
    note: 'What the business RECEIVES. Beckn assumes commerce; 5 of our 7 presets have no Beckn equivalent.' },
];

const get = (obj, path) => String(path || '').split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

/**
 * toChit(becknMessage) → the parts of a chit a Beckn message can fill.
 *
 * Returns a PLAIN OBJECT and writes nothing. Minting stays with the route that owns chit_deliver, so this module
 * can be read, tested and rejected without touching anything that runs.
 */
function toChit(msg, opts = {}) {
  const ctx = (msg && msg.context) || {};
  const order = (msg && msg.message && msg.message.order) || {};
  const warnings = [];

  const purpose = ACTION_TO_PURPOSE[ctx.action];
  if (purpose === undefined) warnings.push(`unknown action "${ctx.action}" — no purpose assigned`);

  // The supplier's currency is FINAL. An incoming price is a CLAIM to check, never a value to adopt.
  let total = null, currency = null;
  const q = order.quote && order.quote.price;
  if (q) {
    const claimed = String(q.currency || '').trim().toUpperCase();
    const governed = String(opts.currency || '').trim().toUpperCase();
    if (governed && claimed && claimed !== governed) {
      const e = new Error(`This catalogue is priced in ${governed}; the incoming order claims ${claimed}. The currency comes from the business, not the message.`);
      e.status = 409; e.claimed = claimed; e.governed = governed; throw e;
    }
    const n = Number(q.value);                       // ⚠ a STRING on the wire
    if (!Number.isFinite(n)) warnings.push(`quote.price.value "${q.value}" is not a number — total withheld`);
    else { total = n; currency = governed || claimed || null; }
  }

  const status = order.state ? STATE_TO_STATUS[order.state] : undefined;
  if (order.state && status === undefined) warnings.push(`unknown order.state "${order.state}" — status unchanged`);

  return {
    chit_id: ctx.transaction_id || null,
    purpose: purpose || null,
    chit_ref: order.id || null,
    schema_id: ctx.domain || null,
    schema_version: ctx.version || ctx.core_version || null,
    current_status: status || null,
    line_items: (order.items || []).map((it) => ({
      name: (it.descriptor && it.descriptor.name) || it.id || 'item',
      qty: (it.quantity && it.quantity.count) != null ? Number(it.quantity.count) : null,
      ref: it.id || null,
    })),
    total_value: total,
    currency_code: currency,
    business_json: {
      billing: order.billing || null,
      fulfillments: order.fulfillments || null,
      payments: order.payments || null,
    },
    summary_json: { beckn: { message_id: ctx.message_id || null, bap_uri: ctx.bap_uri || null, action: ctx.action || null } },
    warnings,
  };
}

/**
 * toBeckn(chit, opts) → an on_confirm body.
 *
 * THE CB-ONLY GUARANTEE IS STRUCTURAL: this function reads only the fields named in RULES with dir 'out' or 'both'.
 * There is no path by which a sealed flag, a per-copy entity_id or a dispute can reach the network, because nothing
 * here ever looks at them. A test asserts the output carries none of those keys.
 */
function toBeckn(chit, opts = {}) {
  const c = chit || {};
  const b = (c.summary_json && c.summary_json.beckn) || {};
  const state = STATUS_TO_STATE[c.current_status] || undefined;   // unknown → omitted, never guessed

  return {
    context: {
      domain: c.schema_id || opts.domain || null,
      action: 'on_confirm',
      version: c.schema_version || opts.version || null,
      bap_id: opts.bap_id || null,
      bap_uri: b.bap_uri || opts.bap_uri || null,
      bpp_id: opts.bpp_id || null,
      bpp_uri: opts.bpp_uri || null,
      transaction_id: c.chit_id || null,
      message_id: opts.message_id || null,    // a NEW id per message — never the one we received
      timestamp: opts.timestamp || null,      // supplied by the caller; this module reads no clock
    },
    message: {
      order: {
        id: c.chit_ref || c.chit_id || null,
        ...(state ? { state } : {}),
        items: (c.line_items || []).map((li) => ({
          id: li.ref || null,
          descriptor: { name: li.name || 'item' },
          quantity: { count: li.qty != null ? li.qty : null },
        })),
        ...(c.total_value != null && c.currency_code
          ? { quote: { price: { currency: c.currency_code, value: String(c.total_value) } } }   // STRING, as the wire expects
          : {}),
      },
    },
  };
}

/** Render the table so a person can review the mapping without reading code. */
function print(opts = {}) {
  const w = (s, n) => String(s == null ? '—' : s).padEnd(n).slice(0, n);
  const lines = [];
  lines.push('BECKN ↔ CHIT — mapping rules');
  lines.push('dir: in = Beckn→CB · out = CB→Beckn · both = round-trips · none = NO path (gap made visible)');
  lines.push('seen: live = observed in a real captured message (1.1.0) · spec = read, not observed · cb = our schema');
  lines.push('');
  lines.push(w('BECKN', 40) + w('CHITBRIDGE', 34) + w('DIR', 6) + 'SEEN');
  lines.push('─'.repeat(94));
  for (const r of RULES) {
    lines.push(w(r.beckn, 40) + w(r.cb, 34) + w(r.dir, 6) + (r.cbOnly ? r.seen + '  ★ CB-ONLY' : r.seen));
    if (opts.notes !== false && r.note) lines.push('    ' + r.note);
  }
  lines.push('');
  const n = (d) => RULES.filter((r) => r.dir === d).length;
  lines.push(`${RULES.length} rules — both:${n('both')} in:${n('in')} out:${n('out')} none:${n('none')}` +
             `   ★ CB-only:${RULES.filter((r) => r.cbOnly).length}   spec-only (unverified):${RULES.filter((r) => r.seen === 'spec').length}`);
  return lines.join('\n');
}

module.exports = { RULES, ACTION_TO_PURPOSE, STATE_TO_STATUS, STATUS_TO_STATE, toChit, toBeckn, print, get };
