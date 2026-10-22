/*
 * OWNS      the channel map: which inbound number / address belongs to which entity, and who may grant it.
 * CALLED BY routes/channels.js · routes/capture.js webhooks.
 * FLOW      addBinding → platform approveBinding → send only from a verified line
 * CARD      11-crm-and-marketing/channels
 */
// lib/channels.js — the CHANNEL MAP: which inbound number / address belongs to which entity.
//
// The capture pipeline (b104) has been complete except for one thing: when a message arrives on a public webhook,
// whose intake inbox does it go in? routes/capture.js has carried the answer as a comment since it was written —
// "the entity comes from the number→entity MAP, NEVER the payload (else it is S1 on a public endpoint)". This is
// that map, and `ownerOf` is the only way the webhook is allowed to ask.
//
// See migration b123 and SPEC-capture-connector.md.
// ⚠️ `query`, not `pool`. The db module exports pool as a lazy GETTER — destructuring it at require time
// evaluates it before the pool exists, and this file is required at boot.
const { withEntity, query, readBatch } = require('../db');
const log = require('./logger');
const schema = require('./schema');
const pager = require('./page-limit');
const OUTBOUND_DEFAULT = 50,
  OUTBOUND_MAX = 200; /* receipts per page (b126's own cap, now a page) */
const OUTBOUND_STATUSES = ['queued', 'sent', 'failed', 'refused']; /* ?status= narrows the list to one outcome */

function _missing(e) {
  const err = new Error('Channels not migrated yet (b123).');
  err.status = 503;
  err.code = 'CHANNEL_STORE_MISSING';
  return e && (e.code === '42P01' || e.code === '42703' || e.code === '42883') ? err : e;
}

/**
 * The channels we can actually receive on, and what each one needs before it can.
 *
 * ⚠️ `provider` IS READ FROM THE ENVIRONMENT, NOT DECLARED HERE. A panel that says "WhatsApp: connected" because
 * someone typed a number in is worse than one that says nothing — the customer's message would vanish and the
 * screen would insist everything was fine. Connected means the server really holds the secret.
 */
const CHANNELS = [
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    hint: 'Meta Cloud API or a BSP (Twilio · Gupshup · 360dialog)',
    addressLabel: 'Business number',
    placeholder: '+919876543210',
    env: ['WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN']
  },
  {
    key: 'email',
    name: 'Email',
    hint: 'inbound parse (SendGrid · Mailgun · Postmark), or forward-to-chit',
    addressLabel: 'Inbound address',
    placeholder: 'orders@yourshop.com',
    env: ['EMAIL_INBOUND_SECRET']
  },
  {
    key: 'sms',
    name: 'SMS',
    hint: 'not wired yet — the adapter is the only missing piece',
    addressLabel: 'Number',
    placeholder: '+919876543210',
    env: ['SMS_INBOUND_SECRET']
  },
  { key: 'web', name: 'Web form', hint: 'the public intake link — no provider needed', addressLabel: 'Form key', placeholder: 'orders', env: [] }
];

/** ⚠️ NORMALISE BEFORE STORING. "+91 98765 43210", "+919876543210" and "919876543210" are one number, and a map
 *  that treats them as three will silently fail to match the one the provider actually sends. */
function normalise(channel, address) {
  const text = String(address || '').trim();
  if (!text) return '';
  if (channel === 'whatsapp' || channel === 'sms') {
    const digits = text.replace(/[^\d]/g, '');
    return digits ? '+' + digits.replace(/^0+/, '') : '';
  }
  return text.toLowerCase();
}

function providerReady(ch) {
  return (ch.env || []).length === 0 || (ch.env || []).every((item) => !!process.env[item]);
}

/** The whole panel in one read: every channel, whether its provider is configured, and this entity's bindings. */
async function listChannels(entity_id) {
  let rows = [],
    note = null;
  try {
    const COLS = 'id, channel, address, label, provider_ref, status, verified_at, verified_via, templates, created_at';
    /* ⚠️ SELF-HEALING ON auto_raise (b131). Naming a column that does not exist yet would 503 the WHOLE Channels
       panel on a pre-b131 database — losing every binding from the screen to show one toggle. Ask for it, and on
       42703 ask again without it: the panel works either way and auto-raise simply reads off. */
    let r;
    try {
      /* ⭐ ONE network round trip (db.readBatch) — this include is on every app open; a transaction here was four. */
      const sql = `SELECT ${COLS}, auto_raise FROM channel_binding WHERE entity_id = $1 ORDER BY channel, created_at`;
      try {
        r = (await readBatch(entity_id, null, [{ text: sql, params: [entity_id] }]))[0];
      } catch (eb) {
        if (eb && eb.code === '42703') throw eb;
        r = await withEntity(entity_id, (c) => c.query(sql, [entity_id]));
      }
    } catch (e1) {
      if (!(e1 && e1.code === '42703')) throw e1;
      r = await withEntity(entity_id, (c) => c.query(`SELECT ${COLS} FROM channel_binding WHERE entity_id = $1 ORDER BY channel, created_at`, [entity_id]));
    }
    rows = r.rows;
  } catch (e) {
    if (_missing(e).status === 503) note = 'channels not migrated (b123)';
    else throw e;
  }
  return {
    note,
    channels: CHANNELS.map((item) => ({
      key: item.key,
      name: item.name,
      hint: item.hint,
      address_label: item.addressLabel,
      placeholder: item.placeholder,
      // ⚠️ Two different facts, kept apart. A provider can be configured with nothing bound to it, and a number
      // can be bound with no provider behind it — and only the pair actually receives anything.
      provider_configured: providerReady(item),
      /**
       * ⚠️ INBOUND AND OUTBOUND ARE DIFFERENT CREDENTIALS, so they are different facts. The app secret lets us
       * RECEIVE and verify; sending needs WHATSAPP_TOKEN, which a business may reasonably not have. A panel that
       * reported one "connected" state would promise replies it cannot send. (b126)
       */
      outbound_configured: item.key === 'whatsapp' ? !!process.env.WHATSAPP_TOKEN : false,
      /* What the business must submit to Meta, verbatim, so the panel can SHOW it rather than describe it (b128). */
      templates: item.key === 'whatsapp' ? require('./whatsapp-templates').forDisplay() : [],
      bindings: rows.filter((b) => b.channel === item.key)
    }))
  };
}

/**
 * The outbound receipts (b126) — what we tried to say back, and what became of it.
 *
 * ⚠️ RECEIPTS YOU CANNOT READ ARE NOT RECEIPTS. Logging refusals is only worth doing if the shop can see them:
 * "we never told the customer, and here is why" is exactly the fact that needs surfacing, and it is invisible
 * everywhere else — the chit changed status quite happily.
 */
async function listOutbound(entity_id, params) {
  const asked = params && typeof params === 'object' ? params : { limit: params },
    pg = pager.pageArgs(asked, OUTBOUND_DEFAULT, OUTBOUND_MAX),
    purpose = asked.purpose ? String(asked.purpose) : null,
    status = OUTBOUND_STATUSES.indexOf(String(asked.status)) >= 0 ? String(asked.status) : null,
    page = { limit: pg.limit || OUTBOUND_DEFAULT, offset: pg.offset }; /* not asked = the first page, as before this had a pager */
  try {
    const withMkt = await schema.hasColumn('channel_outbound', 'send_ref');
    if (purpose && !withMkt) return Object.assign({ outbound: [], migrated: false, code: 'MKT_NOT_MIGRATED', note: 'Offers sent arrives after the next update.' }, pager.pageOut('outbound', [], pg, 0));
    const read = await withEntity(entity_id, (db) => readOutbound(db, entity_id, { withMkt, purpose, status, page }));
    const rows = read.rows.map((item) => Object.assign({}, item, { reason_code: require('./marketing-results').reasonCodeOf(item) })); /* the code a screen words a not-sent receipt by */
    return Object.assign({ migrated: withMkt }, pager.pageOut('outbound', rows, pg, read.total));
  } catch (e) {
    if (_missing(e).status === 503) return { outbound: [], total: 0, page: 1, limit: page.limit, note: 'outbound not migrated (b126)' };
    throw e;
  }
}

/** one page of receipts (newest first) and the whole count — b776 adds who it went to and the consent proof; ONE transaction, two statements */
async function readOutbound(db, entity_id, { withMkt, purpose, status, page }) {
  const where = ['o.entity_id = $1'],
    args = [entity_id];
  if (purpose) {
    args.push(purpose);
    where.push('o.purpose = $' + args.length);
  }
  if (status) {
    args.push(status);
    where.push('o.status = $' + args.length);
  }
  const cols = 'o.id, o.chit_id, o.capture_id, o.channel, o.from_ref, o.to_ref, o.body, o.status, o.reason, o.provider_msg_id, o.created_at',
    mktCols = withMkt ? ', o.party_id, o.purpose, o.send_ref, o.basis, i.display_name AS party_name' : '',
    join = withMkt ? 'LEFT JOIN identities i ON i.identity_id = o.party_id' : '';
  const rows = await db.query(
    `SELECT ${cols}${mktCols} FROM channel_outbound o ${join} WHERE ${where.join(' AND ')}
      ORDER BY o.created_at DESC, o.id LIMIT ${page.limit} OFFSET ${page.offset}`,
    args
  );
  const total = await db.query(`SELECT count(*)::int AS n FROM channel_outbound o WHERE ${where.join(' AND ')}`, args);
  return { rows: rows.rows, total: total.rows[0].n };
}

/**
 * setTemplate — the business states that Meta has approved a template on THEIR number.
 *
 * ⚠️ THIS IS AN ENTITY ACTION, unlike verifying the binding itself. The platform cannot know what Meta approved
 * on someone else's WhatsApp Business Account — only the owner can see that screen. So the owner asserts it, and
 * asserting wrongly costs them a rejected send, not anyone else's isolation. That is why the trust boundary sits
 * differently here than it does for `verified`, where a wrong claim would have reached another business's messages.
 *
 * ⚠️ Only 'approved' or 'pending'. An unknown state would be neither a yes nor a no, and this decision has to be
 * one or the other every time a message is about to cost money.
 */
/**
 * setAutoRaise — turn hands-free raising on or off for ONE bound line (b131).
 *
 * ⚠️ THE SWITCH IS NOT THE PERMISSION. Turning it on says "I want this line handled without me"; whether the line
 * is really yours is still the VERIFICATION's job, and channel_owner_binding refuses an unverified row whatever
 * this says. Two independent conditions, deliberately.
 */
async function setAutoRaise(entity_id, id, on) {
  try {
    const r = await withEntity(entity_id, (c) =>
      c.query(
        `UPDATE channel_binding SET auto_raise = $3, updated_at = now()
        WHERE id = $1 AND entity_id = $2 RETURNING id, address, status, auto_raise`,
        [id, entity_id, !!on]
      )
    );
    if (!r.rows.length) {
      const e = new Error('Binding not found');
      e.status = 404;
      throw e;
    }
    return r.rows[0];
  } catch (e) {
    if (e && e.status) throw e;
    if (e && e.code === '42703') {
      const m = new Error('Auto-raise is not migrated on this environment (b131).');
      m.status = 503;
      throw m;
    }
    throw _missing(e);
  }
}

async function setTemplate(entity_id, id, name, state, byPlatform) {
  const tpl = require('./whatsapp-templates');
  if (!tpl.TEMPLATES[name]) {
    const e = new Error('Unknown template');
    e.status = 400;
    throw e;
  }
  if (['approved', 'pending'].indexOf(state) < 0) {
    const e = new Error('State must be approved or pending');
    e.status = 400;
    throw e;
  }
  /* SEC-FIX3 S7: "approved" is Meta's word, passed on by the platform — a shop may only say it is waiting */
  if (state === 'approved' && !byPlatform) {
    const e = new Error('Only the platform can mark a template approved.');
    e.status = 403;
    throw e;
  }
  try {
    const r = await withEntity(entity_id, (c) =>
      c.query(
        `UPDATE channel_binding SET templates = jsonb_set(COALESCE(templates,'{}'::jsonb), $3::text[], to_jsonb($4::text), true),
              updated_at = now()
        WHERE id = $1 AND entity_id = $2 RETURNING id, address, templates`,
        [id, entity_id, '{' + name + '}', state]
      )
    );
    if (!r.rows.length) {
      const e = new Error('Binding not found');
      e.status = 404;
      throw e;
    }
    return r.rows[0];
  } catch (e) {
    if (e && e.status) throw e;
    throw _missing(e);
  }
}

async function addBinding(entity_id, { channel, address, label, provider_ref }) {
  const ch = CHANNELS.find((item) => item.key === channel);
  if (!ch) {
    const e = new Error('Unknown channel');
    e.status = 400;
    throw e;
  }
  const addr = normalise(channel, address);
  if (!addr) {
    const e = new Error(ch.addressLabel + ' is required');
    e.status = 400;
    throw e;
  }
  try {
    const r = await withEntity(entity_id, (c) =>
      c.query(
        /* provider_ref = Meta's phone_number_id. A SEND is addressed by it — the display number cannot be used for
         that — so it is accepted at bind time and patchable afterwards. (b126) */
        `INSERT INTO channel_binding (entity_id, channel, address, label, provider_ref)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, channel, address, label, provider_ref, status, created_at`,
        [entity_id, channel, addr, String(label || '').slice(0, 80) || null, String(provider_ref || '').trim() || null]
      )
    );
    return r.rows[0];
  } catch (e) {
    /**
     * ⚠️ 23505 IS EXPECTED, AND WHAT IT MEANS MUST NOT BE OVERSHARED. The unique index is global, so this fires
     * when ANOTHER entity already holds the address — a row this caller cannot see and must not learn about
     * beyond the fact that it cannot have it. "Already in use" and nothing else.
     */
    if (e && e.code === '23505') {
      const c = new Error('That ' + ch.addressLabel.toLowerCase() + ' is already in use.');
      c.status = 409;
      throw c;
    }
    throw _missing(e);
  }
}

/**
 * approveBinding — the PLATFORM grants `verified`. Not the claimant, and not a challenge the claimant can satisfy.
 *
 * ⚠️ WHY THERE IS NO SELF-SERVICE VERIFY. For an inbound business line the obvious design — send a code to the
 * number, have it sent back — proves nothing: the claimant is the one shown the code, and the number is reachable
 * by anyone, so A can message B's number with A's own code and "prove" A owns it. A challenge is only proof when
 * the claimant cannot also satisfy it.
 *
 * The authority is whoever PROVISIONS the number. Today that is the platform operator (this function, behind
 * CB_ADMIN_KEY); once Meta Embedded Signup exists it becomes the onboarding handshake itself, which is Meta
 * telling us whose number it is — and then `verified_via` says which of the two granted it.
 */
async function setProviderRef(entity_id, id, provider_ref) {
  try {
    const r = await withEntity(entity_id, (c) =>
      c.query(
        /* SEC-FIX3 S7: a changed phone_number_id is a NEW claim — the platform's grant is withdrawn until it checks the number again */
        `UPDATE channel_binding SET provider_ref = $3, updated_at = now(),
              status = CASE WHEN provider_ref IS DISTINCT FROM $3 THEN 'declared' ELSE status END,
              verified_at = CASE WHEN provider_ref IS DISTINCT FROM $3 THEN NULL ELSE verified_at END,
              verified_via = CASE WHEN provider_ref IS DISTINCT FROM $3 THEN NULL ELSE verified_via END
        WHERE id = $1 AND entity_id = $2
        RETURNING id, address, provider_ref, status`,
        [id, entity_id, String(provider_ref || '').trim() || null]
      )
    );
    if (!r.rows.length) {
      const e = new Error('Binding not found');
      e.status = 404;
      throw e;
    }
    return r.rows[0];
  } catch (e) {
    if (e && e.status) throw e;
    throw _missing(e);
  }
}

async function approveBinding(id, via) {
  return _setStatus(id, 'verified', via || 'platform');
}

/** Revoke a grant — a number that changes hands must stop resolving to the old owner immediately. */
async function revokeBinding(id) {
  return _setStatus(id, 'declared', null);
}

/**
 * ⚠️ THE GRANT RUNS ON THE SECURITY DEFINER RAIL, and it has to.
 *
 * FORCE ROW LEVEL SECURITY applies to the table owner too, so a context-free UPDATE from cb_app sees NOTHING —
 * not everything. The first version of this was a plain query() and returned 404 for a binding that plainly
 * existed. withEntity() is no help either: the platform operator is not an entity, and scoping to some entity's
 * context would only ever reach that entity's own rows, which is the gap rather than the fix.
 *
 * channel_set_status() is the same shape as channel_owner(): one function, one job, no listing, and it accepts
 * only the two statuses the rung actually has.
 */
async function _setStatus(id, status, via) {
  try {
    const r = await query('SELECT * FROM channel_set_status($1,$2,$3)', [id, status, via]);
    if (!r.rows.length) {
      const e = new Error('Binding not found');
      e.status = 404;
      throw e;
    }
    return r.rows[0];
  } catch (e) {
    if (e && e.status) throw e;
    throw _missing(e);
  }
}

async function removeBinding(entity_id, id) {
  try {
    const r = await withEntity(entity_id, (c) => c.query(`DELETE FROM channel_binding WHERE id = $1 AND entity_id = $2 RETURNING id`, [id, entity_id]));
    if (!r.rows.length) {
      const e = new Error('Not found');
      e.status = 404;
      throw e;
    }
    return { ok: true, id };
  } catch (e) {
    if (e && e.status) throw e;
    throw _missing(e);
  }
}

/**
 * ownerOf — WHO OWNS THIS ADDRESS. The only question a webhook may ask, and the only one this answers.
 *
 * ⚠️ Goes through the SECURITY DEFINER `channel_owner()` because the caller has NO SESSION: a provider POST has
 * no entity to set on the connection, so under FORCE RLS a direct SELECT sees nothing and every inbound message
 * would be silently dropped. The function returns a uuid or nothing — it cannot list, cannot filter, and exposes
 * no label, name or message.
 *
 * ⚠️ VERIFIED BINDINGS ONLY (b124). channel_owner() filters on status, so a DECLARED claim resolves to nothing —
 * a claim is not a permission. That is what stops entity A binding entity B's number and receiving B's messages.
 *
 * Returns null when nothing is bound OR the binding is unverified, which the webhook must treat as "not for us" —
 * never as an error, and never as a reason to fall back to anything in the payload.
 */
async function ownerOf(channel, address) {
  const addr = normalise(channel, address);
  if (!addr) return null;
  try {
    const r = await query('SELECT channel_owner($1,$2) AS entity_id', [channel, addr]);
    return (r.rows[0] && r.rows[0].entity_id) || null;
  } catch (e) {
    log.fellBack('channels ownerOf: the read failed — answered with nothing', e);
    return null;
  } // not migrated / no binding → not for us. The webhook stays inert, never 500s.
}

/**
 * bindingFor — the owner AND the line's settings, in ONE SECURITY DEFINER call (b131).
 *
 * ⚠️ WHY NOT ownerOf() THEN A SELECT. The webhook has no tenant context, and channel_binding is under FORCE RLS, so
 * a context-free SELECT for auto_raise would return nothing rather than the row — silently reading "off" for every
 * line. Verified-only, same as channel_owner.
 */
async function bindingFor(channel, address) {
  const addr = normalise(channel, address);
  if (!addr) return null;
  try {
    const r = await query('SELECT * FROM channel_owner_binding($1,$2)', [channel, addr]);
    return r.rows[0] || null;
  } catch (e) {
    log.fellBack('channels bindingFor: the read failed — answered with nothing', e);
    return null;
  } // pre-b131 → caller falls back to ownerOf and auto-raise stays off
}

module.exports = {
  CHANNELS,
  listChannels,
  listOutbound,
  setTemplate,
  setProviderRef,
  addBinding,
  approveBinding,
  revokeBinding,
  removeBinding,
  ownerOf,
  bindingFor,
  setAutoRaise,
  normalise,
  providerReady
};
