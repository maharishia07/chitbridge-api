// lib/capture.js — the CAPTURE pipeline. An inbound message (WhatsApp/email/web/…) becomes a PENDING capture; the AI
// structures it into a draft; a human confirms; the confirmed draft is sent as a chit via the PROVEN /api/chits/send
// path (the human-confirm gate stays exactly there). This module owns the capture queue only — it never creates a chit
// directly (that would replicate the chit_deliver machinery). Per-entity, WITH RLS. See SPEC-capture-connector.md.
const { withEntity } = require('../db');
const gs1 = require('./gs1');   // (10) batch · (17) expiry · (21) serial — the instance, carried on the movement

function _missing(e) { const err = new Error('Capture not migrated yet (b104).'); err.status = 503; err.code = 'CAPTURE_STORE_MISSING'; return (e && (e.code === '42P01' || e.code === '42703')) ? err : e; }
const CHANNELS = ['whatsapp', 'email', 'web', 'sms', 'other'];

// record an inbound message as a pending capture (the untrusted raw text is stored, not yet a chit).
async function createCapture(entity_id, { channel, sender_ref, sender_name, subject, raw_text, media_refs, to_ref, provider_msg_id }) {
  const ch = CHANNELS.includes(String(channel)) ? channel : 'other';
  const text = String(raw_text || '').trim();
  if (!text) { const e = new Error('raw_text required'); e.status = 400; throw e; }
  /**
   * ⚠️ A REDELIVERY IS NOT A NEW ORDER (b129). Providers retry: Meta re-sends a webhook it believes failed, and
   * that retry is indistinguishable from the customer sending the same words again — except by the provider's own
   * message id, which is stable across retries and different for a genuinely repeated message.
   *
   * Without this a human working the intake inbox sees two identical requests, converts both in good faith, and
   * the shop ships twice. So a duplicate returns the EXISTING capture rather than erroring: from the provider's
   * point of view the delivery succeeded, which is what stops it retrying again.
   */
  if (provider_msg_id) {
    try {
      const dup = await withEntity(entity_id, (c) => c.query(
        `SELECT id, channel, sender_ref, sender_name, subject, raw_text, status, created_at
           FROM capture WHERE entity_id = $1 AND channel = $2 AND provider_msg_id = $3 LIMIT 1`,
        [entity_id, ch, String(provider_msg_id)]));
      if (dup.rows[0]) return Object.assign(dup.rows[0], { duplicate: true });
    } catch (_) { /* pre-b129 → fall through and insert as before */ }
  }
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      /* ⚠️ to_ref = WHICH OF OUR LINES they wrote to. The webhook has always known it (metadata.display_phone_number)
         and threw it away. Without it a reply cannot be sent FROM the number the customer messaged — and with two
         bound numbers, guessing which of your businesses is talking to a customer is not acceptable. (b126) */
      `INSERT INTO capture (entity_id, channel, sender_ref, sender_name, subject, raw_text, media_refs, to_ref, provider_msg_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING id, channel, sender_ref, sender_name, subject, raw_text, status, created_at`,
      [entity_id, ch, sender_ref || null, sender_name || null, subject || null, text.slice(0, 8000),
       JSON.stringify(Array.isArray(media_refs) ? media_refs.slice(0, 20) : []), to_ref || null,
       provider_msg_id ? String(provider_msg_id) : null]));
    /* the bell: an inbound message landed — rung a beat later, once the transaction around this insert has committed */
    try { const _row = r.rows[0], _who = sender_name || sender_ref || null, _ch = ch; setTimeout(() => { try { require('./events').emit([entity_id], { kind: 'capture', id: _row && _row.id, who: _who, channel: _ch }); } catch (_) {} }, 400); } catch (_) {}
    return r.rows[0];
  } catch (e) {
    /* ⚠️ The unique index is the real guard — the SELECT above races against a simultaneous redelivery, and two
       retries arriving together would both find nothing and both insert. On a collision, return what won. */
    if (e && e.code === '23505' && provider_msg_id) {
      try {
        const dup = await withEntity(entity_id, (c) => c.query(
          `SELECT id, channel, sender_ref, sender_name, subject, raw_text, status, created_at
             FROM capture WHERE entity_id = $1 AND channel = $2 AND provider_msg_id = $3 LIMIT 1`,
          [entity_id, ch, String(provider_msg_id)]));
        if (dup.rows[0]) return Object.assign(dup.rows[0], { duplicate: true });
      } catch (_) {}
    }
    throw _missing(e);
  }
}

async function listPending(entity_id) {
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT id, channel, sender_ref, sender_name, subject, raw_text, media_refs, status, structured, chit_id, to_ref, created_at
       FROM capture WHERE entity_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 200`, [entity_id]));
    return { captures: r.rows };
  } catch (e) { if (_missing(e).status === 503) return { captures: [], note: 'capture not migrated (b104)' }; throw e; }
}

async function getCapture(entity_id, id) {
  const r = await withEntity(entity_id, (c) => c.query('SELECT * FROM capture WHERE id = $1 AND entity_id = $2', [id, entity_id]));
  return r.rows[0] || null;
}

// AI-structure a capture (invoked → proposes). Saves + returns the structured draft; the human still confirms at send.
async function structureCapture(entity_id, id) {
  const cap = await getCapture(entity_id, id);
  if (!cap) { const e = new Error('Capture not found'); e.status = 404; throw e; }
  const ai = require('./ai');
  /**
   * ⚠️ A PHOTOGRAPHED ORDER IS STILL AN ORDER (b126/b127). A customer who sends a picture of a handwritten list
   * has told us exactly as much as one who typed it — the difference is ours to bridge, not theirs.
   *
   * So: if the capture carries images and we can actually fetch them, read them with the vision skill. If we
   * cannot — no WHATSAPP_TOKEN, media expired, not an image — fall back to the text skill unchanged. The photo
   * still sits on the capture for a human to open, which is the honest degrade: a picture we could not read is
   * not a message we lost.
   */
  let images = [];
  try { images = await require('./whatsapp-media').imagesFor(cap, 4); } catch (_) { images = []; }
  const skill = images.length ? 'photo-to-chit' : 'message-to-chit';
  const out = await ai.invokeSkill(entity_id, skill, {
    channel: cap.channel, from: cap.sender_ref || cap.sender_name || '', message: cap.raw_text,
    ...(images.length ? { images } : {}) });
  const structured = (out && out.data) || null;
  /* ⚠️ A NULL READING IS NOT "READ IT AGAIN". It used to fall through here and surface later as "Read the message
     first — a request needs lines, and nothing has read them yet", which is the message you get when nothing has
     been ATTEMPTED. So a long order that was cut off looked identical to one nobody had touched, and the obvious
     response — press the button again — reproduced it forever. invokeSkill now throws with the actual reason
     (truncated vs unparseable) and that error is allowed to travel. */
  if (!structured) {
    const e = new Error('The reader returned nothing usable for this message. Nothing was saved.');
    e.status = 422; throw e;
  }
  await withEntity(entity_id, (c) => c.query('UPDATE capture SET structured = $1::jsonb, updated_at = now() WHERE id = $2 AND entity_id = $3',
    [JSON.stringify(structured), id, entity_id]));
  return { capture_id: id, structured, note: out && out.note, usage: out && out.usage };
}

// mark a capture converted once the human has sent the chit via /api/chits/send (chit_id passed back).
async function markConverted(entity_id, id, chit_id) {
  const r = await withEntity(entity_id, (c) => c.query(
    `UPDATE capture SET status = 'converted', chit_id = $1, updated_at = now()
     WHERE id = $2 AND entity_id = $3 AND status = 'pending' RETURNING id, status, chit_id`, [chit_id || null, id, entity_id]));
  if (!r.rows[0]) { const e = new Error('Capture not found or already handled'); e.status = 404; throw e; }
  return r.rows[0];
}

async function dismissCapture(entity_id, id) {
  const r = await withEntity(entity_id, (c) => c.query(
    `UPDATE capture SET status = 'dismissed', updated_at = now() WHERE id = $1 AND entity_id = $2 AND status = 'pending' RETURNING id, status`, [id, entity_id]));
  if (!r.rows[0]) { const e = new Error('Capture not found or already handled'); e.status = 404; throw e; }
  return r.rows[0];
}

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *  raisePayload — a message becomes a REQUEST addressed to the entity, carrying where it came from.
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Athi, 2026-08-09: *"what we need is creating a chit and send it to the entity as a request."*
 *
 * This is a better shape than walking Compose, and the reason is worth writing down: walking Compose has the
 * BUSINESS authoring the customer's request, in the customer's voice, and the customer never sees it. What actually
 * happened is that someone outside asked for something. A request that says so — and says who asked, on which line,
 * in which message — is the honest record.
 *
 * ── ⚠️ THE CUSTOMER IS NOT A RECIPIENT, AND MUST NOT BE ────────────────────────────────────────────────────────
 * /api/chits/send resolves every recipient to a live platform entity and 404s a name that does not resolve. A
 * WhatsApp number is not an entity. That gate is right and is not worked around here: the sender is the ORIGIN of
 * the request, not a party to it, and origins belong in provenance. Inventing a shadow entity for every stranger
 * who messages a business would put unverified identities on the rail, which is the one thing the rail is for.
 *
 * So the chit is authored by the ENTITY (whose channel it is, whose credentials it is), addressed to ITSELF, and
 * the stranger is recorded in `business_json.via`.
 *
 * ── ⚠️ IT RETURNS A PAYLOAD. IT DOES NOT CREATE A CHIT. ────────────────────────────────────────────────────────
 * There is exactly one send path and it is /api/chits/send. Minting here would fork chit_deliver — the divergence
 * this module's header already refuses. The caller posts this payload to the one send, then calls /convert. So the
 * human confirm gate is untouched: a person still presses the button that sends.
 *
 * ── ⚠️ PROVENANCE IS STAMPED FROM THE CAPTURE ROW, NEVER FROM THE CALLER ───────────────────────────────────────
 * `via` is built here, from what the webhook actually recorded. A provenance block the client composes is a claim
 * about itself; one read off the stored row is a record. They are not the same evidence and only one is worth
 * putting on a chit.
 */
async function raisePayload(entity_id, id, opts) {
  /**
   * ⚠️ `trade_side` DECIDES, AND IT IS THE ENTITY'S SETTING — not a flag the browser sends.
   *
   * A CATALOGUE PRICE IS A SELL-SIDE PRICE. For a shop taking an order that is exactly right. For a factory
   * receiving milk it is the wrong side of the trade: pricing an inbound supply notice off what the factory SELLS
   * at puts a number on the record that nobody agreed and that flatters one party.
   *
   * Athi, 2026-08-09: *"we are creating entity for a purpose, sell and purchase never been the same entity."* So
   * it does not change message to message, and I had it wrong as a per-raise toggle. It is read here, server-side,
   * from Settings → Policy flags. `opts.useCatalogue` survives only so a caller can narrow further; it can turn
   * the catalogue OFF but never on, because a receiving entity must not be talked into sell-side pricing by a
   * request body.
   */
  const flags = await require('./policy').get(entity_id);
  const useCatalogue = flags.trade_side !== 'receive' && !(opts && opts.useCatalogue === false);
  const cap = await getCapture(entity_id, id);
  if (!cap) { const e = new Error('Capture not found'); e.status = 404; throw e; }
  if (cap.status !== 'pending') { const e = new Error('That message has already been handled'); e.status = 409; throw e; }
  const s = cap.structured || null;
  if (!s) { const e = new Error('Read the message first — a request needs lines, and nothing has read them yet'); e.status = 409; throw e; }
  /**
   * ── ⚠️ THE PRICE COMES FROM YOUR CATALOGUE, NOT FROM THE MESSAGE ───────────────────────────────────────────────
   * Athi, 2026-08-09: *"attach the storefront price on raise."* A request priced at ₹0 because a stranger did not
   * quote themselves is not a request anyone can answer, and re-typing the prices is the work nobody does twice.
   *
   * MATCHED EXACTLY, OR BY AN UNAMBIGUOUS CONTAINMENT, OR NOT AT ALL. "cement" finding the one catalogue line
   * containing the word is a match; "cement" finding three is a guess, and a guess here prices someone's order
   * off the wrong product. Ambiguity is REFUSED and reported, never resolved by picking the first row — the same
   * rule the cart already applies to quantities.
   *
   * ⚠️ AND IF THEY NAMED A PRICE, OURS DOES NOT SILENTLY WIN. A customer writing "20 bags at 340" has stated a
   * figure; overwriting it invisibly with the shelf price is how a disagreement becomes a dispute six weeks later.
   * The catalogue price is used — it is ours to charge — but the difference is RECORDED and shown.
   */
  const money = require('./money');
  /**
   * ⚠️ THE SAME MATCHER THE CONSOLIDATION USES (lib/itemmatch.js). Athi, 2026-08-11: *"fix the matcher, use
   * synonyms in raise too."*
   *
   * This path had its own, weaker matcher: exact name or substring, no synonyms, no variants, no misspellings. So
   * "thakkali" resolved to Tomato when the wholesaler ran his consolidation and did NOT resolve minutes earlier
   * when the same message became a chit — no canonical name, no catalogue price, on the record people actually
   * read. One matcher now, so the two cannot drift again.
   */
  const itemmatch = require('./itemmatch');
  const norm2 = itemmatch.norm;
  const cat = useCatalogue ? await itemmatch.loadCatalogue(entity_id) : { items: [], variantsOf: {} };

  /**
   * ⭐ THE CLOSED-CLASS CHECK (lib/numerals.js) — a number is not an AI judgment.
   *
   * Athi, 2026-08-11: `pathu kilo` came back as 5. That is a money error, and `pathu` is a table lookup.
   *
   * ⭐ TWO STRENGTHS, AND WHICH ONE RUNS DEPENDS ON THE LINE (b141 landed 2026-08-13).
   *
   *   STRONG — the line carries `raw_phrase`, the customer's own words for THAT line. The quantity is compared
   *   against the numerals in those words, and on disagreement the value is REJECTED: quantity → null, flagged
   *   for a human. `pathu kilo` extracted as 5 dies here. This is the handover doc's T-1, properly.
   *
   *   WEAK — no raw_phrase (an older capture, or the model declined to point at any words). Then all we can ask
   *   is whether the number appears ANYWHERE in the message. That cannot produce a false rejection, but it is
   *   partial: with several lines, a wrong quantity coinciding with another line's number slips through. So it
   *   FLAGS and keeps the value.
   *
   * ⚠️ THE STRONG CHECK REJECTS AND THE WEAK ONE DOES NOT, and that asymmetry is the point. Nulling a quantity on
   * a partial check would destroy good orders to catch some bad ones; nulling on an exact per-line comparison
   * destroys only wrong ones. Same guard, different confidence, different consequence.
   *
   * ⚠️ IT NEVER SUBSTITUTES ITS OWN ANSWER. Even when it knows the phrase says 10, it writes null and flags —
   * a checker that quietly overwrote the model would just be a second, dumber model with no audit trail.
   */
  const numerals = require('./numerals');
  const msgNums = numerals.numeralsIn(cap.raw_text || '').map((n) => n.value);

  const priced = { from_catalogue: 0, unpriced: 0, ambiguous: [], asked_differs: [], variant_unspecified: [],
                   quantity_unverified: [], quantity_rejected: [] };
  let currency = null;
  const line_items = (s.line_items || []).slice(0, 50).map((l) => {
    const name = String(l.particulars || l.description || 'item').slice(0, 200);
    const phrase = String(l.raw_phrase || '').trim().slice(0, 400);
    let qty = l.qty == null ? 1 : Number(l.qty) || 0;
    let qtyUnverified = false, qtyRejected = null;

    if (phrase && l.qty != null) {
      /* STRONG: compare against this line's own words. */
      const v = numerals.verifyQuantity(phrase, qty);
      if (v.ok === false) {
        qtyRejected = { name, phrase, extracted: qty, reason: v.reason,
                        ...(v.expected != null ? { phrase_says: v.expected } : {}),
                        ...(v.among ? { phrase_has: v.among } : {}) };
        if (priced.quantity_rejected.length < 8) priced.quantity_rejected.push(qtyRejected);
        qty = null;                       // ⚠️ rejected, NOT corrected
      }
    } else {
      /* WEAK: only when the model actually extracted a number. `l.qty == null` means we defaulted to 1, and
         checking a default against the message would flag every unquantified line as invented. */
      qtyUnverified = (l.qty != null) && msgNums.length > 0 && !msgNums.includes(qty);
      if (qtyUnverified && priced.quantity_unverified.length < 8) {
        priced.quantity_unverified.push({ name, extracted: qty, message_has: msgNums });
      }
    }
    const asked = Number(l.rate != null ? l.rate : l.price) || 0;   // what THEY said, if anything
    const m = itemmatch.match(name, l.comment, cat);
    let price = asked, unit = l.unit || null, canonical = null, variantFlag = null;
    let ambiguousFlag = null, ambiguousCount = 0, variantCands = null;
    let ref = null;
    if (m.item) {
      const ours = money.amountOf(m.item.price);
      if (ours != null) {
        price = ours; priced.from_catalogue++;
        if (!currency) currency = money.currencyOf(m.item.price) || null;
        if (asked > 0 && Math.abs(asked - ours) > 0.005 && priced.asked_differs.length < 5) {
          priced.asked_differs.push({ name, asked, ours });
        }
      }
      unit = m.item.unit || unit;
      /**
       * ⚠️ THE CATALOGUE'S NAME GOES ON THE CHIT — that is what "authoritative" means, and it is the answer to
       * "thakkali, milk, vengayam — are we not getting the unique name in English?". The line now reads Tomato.
       *
       * ⚠️ AND WHAT THEY ACTUALLY WROTE IS KEPT (`asked_as`). Replacing a customer's word without recording it
       * would lose the only evidence of what they asked for — and six weeks later "we sent Tomato, they say they
       * ordered thakkali" has to be settleable from the record, not from memory. Same rule as `asked_unit`.
       */
      canonical = m.item.name + (m.item.variant ? ' ' + m.item.variant : '');
      /* ⚠️ VARIANT NOT NAMED → FLAGGED, NEVER PICKED. The catalogue has grade 1 and grade 2, the message said only
         "orange": choosing one is inventing the order, and it would look perfectly correct on the chit. */
      if (m.variant_unspecified) {
        variantFlag = m.variants || [];
        /* The same picker answers both questions, so the same shortlist is carried. A grade that was never named
           and a name that answers to three items are one problem to the person looking at the row: which of these
           did they mean, and what does it cost. */
        variantCands = (m.candidates || []).slice(0, 6);
        canonical = m.item.name;                 // the base name only — the grade is genuinely unknown
        price = asked; priced.unpriced_variant = (priced.unpriced_variant || 0) + 1;
        if (priced.variant_unspecified.length < 5) priced.variant_unspecified.push({ name, variants: m.variants });
      }
      if (m.fuzzy) priced.matched_by_spelling = (priced.matched_by_spelling || 0) + 1;
      /**
       * ── ⭐ THE CATALOGUE REFERENCE, STAMPED ONCE ────────────────────────────────────────────────────────────
       * Athi, 2026-08-13: *"does the chit carry the sku reference … so next time when you look at it you may be
       * able to use it directly?"* It did not. The only link between a line and the item that priced it was the
       * NAME — so every later read re-matched, and renaming a product silently broke every chit that referenced
       * it.
       *
       * ⚠️ IT IS PROVENANCE, NOT A LOOKUP. The line keeps its own frozen name, price and unit exactly as before;
       * this rides beside them. If anything ever RESOLVED the line through this reference at read time, retiring
       * an item or changing its price would retroactively alter a document both parties had already agreed —
       * which is the one thing a chit exists to prevent.
       *
       * ⚠️ NOT STAMPED WHEN THE VARIANT WAS NEVER NAMED, and this is the trap. decideVariant returns a FALLBACK
       * item so the line still has a name to show — but that fallback is one arbitrary grade out of several, and
       * writing its item_id would assert exactly the identity the matcher just refused to choose. A refusal that
       * quietly stamps an id is worse than no id at all: it looks resolved.
       *
       * `how` is the trust ladder — exact · synonym · contains · fuzzy — so a dispute can tell a line the buyer
       * chose himself from one a spelling-guess produced.
       */
      if (!m.variant_unspecified && (m.item.item_id || m.item.sku)) {
        ref = { ...(m.item.item_id ? { item_id: m.item.item_id } : {}),
                ...(m.item.sku ? { sku: m.item.sku } : {}),
                how: m.how || 'exact',
                /* ⭐ WHAT IT WAS AT THIS MOMENT, not merely which row it is. An id points at something that keeps
                   moving; `as_of` + `hash` fix the base, so a year later "the price has changed since this order"
                   is a checkable fact rather than an argument. See itemmatch.stampOf. */
                ...(m.item.version ? { version: m.item.version } : {}),
                ...(m.item.as_of ? { as_of: m.item.as_of } : {}),
                hash: itemmatch.stampOf(m.item) };
      }
    } else if (m.ambiguous) {
      /**
       * Several catalogue lines answer to this name, so any price would be a coin toss. Unpriced; a person picks.
       *
       * ⚠️ THE FLAG NOW LANDS ON THE LINE, NOT ONLY IN A SUMMARY — and the old placement made the refusal
       * unresolvable in two separate ways. The summary was capped at 5, so a sixth ambiguous line was invisible
       * everywhere; and even within the cap it lived on the chit, not the row, so the row a person was looking at
       * gave no hint that its price had been withheld. The shortlist travels with the line it belongs to.
       *
       * ⚠️ CAPPED AT 6 CANDIDATES PER LINE. A one-character phrase against a large catalogue can answer to
       * dozens; a radio list of dozens is not a decision, and the whole shortlist would ride in every chit read.
       * `matches` keeps the true count, so the screen can say "6 of 11 shown" rather than quietly truncating.
       */
      ambiguousFlag = (m.candidates || []).slice(0, 6);
      ambiguousCount = m.matches || ambiguousFlag.length;
      if (priced.ambiguous.length < 5) priced.ambiguous.push({ name, matches: m.matches });
    }
    if (!price) priced.unpriced++;
    /**
     * ⚠️ THE QUALIFIERS TRAVEL WITH THE LINE. Athi, 2026-08-10: *"any other adjective etc should be captured as a
     * comment for the same line item."* "Briyani × 4" and "Briyani × 4, extra leg piece, extra spicy, schezwan"
     * are different orders, and only one of them is what the customer asked for. Dropping the modifiers is not a
     * formatting loss — it is delivering the wrong food, and the chit would look perfectly correct while doing it.
     *
     * ⚠️ unit_size IS CARRIED BUT NEVER INFERRED. "2 crates" cannot be totalled against "25 kg" unless somebody
     * states what a crate holds. Carrying the size when it IS stated is what makes an honest conversion possible;
     * inventing it is the money error. Same discipline as the currency invariant.
     *
     * Every field is omitted when empty, so a plain line stays exactly the shape it has always been.
     */
    const comment = String(l.comment || '').trim().slice(0, 500);
    const usize = String(l.unit_size || '').trim().slice(0, 40);
    const uprice = Number(l.unit_price != null ? l.unit_price : l.rate) || 0;
    return {
      /* canonical when the catalogue knows it; the sender's own phrase otherwise. asked_as keeps what they wrote. */
      particulars: canonical || name, quantity: qty, price,
      total: Math.round((qty * price + Number.EPSILON) * 100) / 100,
      ...(unit ? { unit } : {}),
      ...(usize ? { unit_size: usize } : {}),
      ...(uprice ? { unit_price: uprice } : {}),
      ...(comment ? { comment } : {}),
      ...(canonical && norm2(canonical) !== norm2(name) ? { asked_as: name } : {}),
      ...(variantFlag ? { variant_unspecified: variantFlag } : {}),
      /* ⭐ THE SHORTLIST, ON THE ROW IT BELONGS TO — what a person picks from. `needs_human` puts it in the same
         queue as an unverified quantity, because it is the same kind of problem: a number on this chit that no
         machine is entitled to decide. */
      ...(ambiguousFlag && ambiguousFlag.length
        ? { ambiguous: ambiguousFlag, ambiguous_count: ambiguousCount, needs_human: true } : {}),
      ...(variantCands && variantCands.length ? { variant_candidates: variantCands, needs_human: true } : {}),
      /* The catalogue row this line came from — an identifier, not a resolution. See the stamp above. */
      ...(ref ? { ref } : {}),
      /* What THEY said the unit was, kept even when the catalogue overrode it — so "they ordered a crate, we
         priced a kg" is answerable later instead of being an argument. */
      ...(l.unit && unit && String(l.unit) !== String(unit) ? { asked_unit: String(l.unit).slice(0, 40) } : {}),
      /* ⭐ THE CUSTOMER'S OWN WORDS FOR THIS LINE (b141). Athi, 2026-08-13: *"this page does not have all the raw
         text I guess for each of the line item. This will give confidence to the person; the right message is
         interpreted."* It is the only thing on the row that was not produced by a machine, so it is the only
         thing that can settle whether the machine was right. */
      ...(phrase ? { raw_phrase: phrase } : {}),
      /* ⭐ THE LOT, IF THE MESSAGE CARRIED ONE. GS1 (10) batch · (17) expiry · (21) serial — the identity of THIS
         consignment, which is a fact about the movement and never about the product.
         ⚠️ READ, NEVER INVENTED. If the sender did not name a batch there is no batch: a line that quietly grew
         one would be asserting a consignment identity nobody stated, and a recall would then trust it. */
      ...(gs1.lotOf(l.lot || l) ? { lot: gs1.lotOf(l.lot || l) } : {}),
      /* ⚠️ ON THE LINE, not only in a summary nobody opens. A quantity that appears nowhere in the customer's
         own words is the one number on this chit most likely to be wrong, and the person confirming it should
         see that on the row they are confirming. */
      ...(qtyUnverified ? { qty_unverified: true, needs_human: true } : {}),
      /* ⚠️ REJECTED, NOT CORRECTED — quantity is null and the reason travels with it, so the screen can say
         "they wrote pathu, the reader said 5" rather than silently showing a number nobody can defend. */
      ...(qtyRejected ? { qty_rejected: qtyRejected.reason, needs_human: true,
                          ...(qtyRejected.phrase_says != null ? { phrase_says: qtyRejected.phrase_says } : {}) } : {}),
    };
  });
  if (!line_items.length) { const e = new Error('Nothing was read out of that message that could be requested'); e.status = 409; throw e; }
  const who = cap.sender_name || cap.sender_ref || 'an unknown sender';
  // ⚠️ SAY WHAT IT IS, ON THE SUBJECT LINE. Athi: *"make it as whatsapp req."* A badge is enough on screen; the
  //    subject is what survives into a PDF, an export and a search six months later, where no badge renders.
  const CHREQ = { whatsapp: 'WhatsApp request', email: 'Email request', sms: 'SMS request', web: 'Web request' };
  const label = CHREQ[cap.channel] || 'Request';
  return {
    // ⚠️ `inquiry`, NOT `order`. Nobody has agreed to anything. An inbound request that entered the ledger as an
    //    order would be an obligation minted by a stranger's message, which is the whole thing being avoided.
    purpose: 'inquiry',
    subject: (label + ' — ' + String(s.subject || ('from ' + who))).slice(0, 500),
    line_items,
    // Addressed to the entity itself: their received copy IS the request in their inbox. There is no other party.
    recipients: [{ self: true, role: 'to' }],
    /* ⚠️ TASK ONLY — NO ORDER COPY. Athi: *"make the order copy none, it will create a task."* The entity did not
       send this; someone outside asked. An Order copy would put it in their Sent list and claim they raised it
       themselves, which is the one thing the record must not say. The suppression is declared on the chit
       (summary_json.copy_policy, source:'request'), so the missing copy is governed and not a hole. */
    self_copy: 'received',
    business_json: {
      via: {
        channel: cap.channel,
        from: cap.sender_ref || null,
        from_name: cap.sender_name || null,
        to: cap.to_ref || null,                       // WHICH of their lines was written to (b126)
        provider_msg_id: cap.provider_msg_id || null, // the provider's own id — stable across retries (b129)
        capture_id: cap.id,
        received_at: cap.created_at,
        read_by: 'co-assist',                         // the lines are an AI's reading of someone else's words
        /* ⚠️ SAID OUT LOUD, ON THE CHIT. A phone number that messaged a business is not a verified counterparty,
           and six weeks later nothing else on the record would distinguish it from one. */
        sender_verified: false,
        /* ⚠️ WHAT THEY ACTUALLY WROTE, ON THE CHIT ITSELF. Athi, 2026-08-09: *"the copy is attached along with the
           message so it can be verified against."* Exactly right, and it is the difference between a reading you
           can check and a reading you must trust: the lines below are a co-assist's interpretation, and an
           interpretation with the original beside it can be disputed on the evidence.
           CAPPED, because summary_json is copied onto every party's copy — the FULL text goes on as an attachment
           (see `original` below), which is where a long message belongs. */
        /**
         * ⚠️ EVERY FACT THE SENDER GAVE, KEPT SOMEWHERE. Athi, 2026-08-10: *"need to see each data the user
         * provides, which data item in the js schema it can fit in, if not keep it as a note or a comment."*
         *
         * So the chit carries the order-level facts that have no column of their own — when they want it, where,
         * and anything the reader could not place at all. `unplaced` is deliberately surfaced rather than dropped:
         * a request that lost its "deliver at 7pm" looks perfectly correct and is wrong, and nobody would ever
         * know which. Making the leftovers visible is the difference between a gap and a silent gap.
         */
        ...(String(s.delivery_at || '').trim() ? { delivery_at: String(s.delivery_at).trim().slice(0, 120) } : {}),
        ...(String(s.delivery_address || '').trim() ? { delivery_address: String(s.delivery_address).trim().slice(0, 300) } : {}),
        ...(String(s.notes || '').trim() ? { notes: String(s.notes).trim().slice(0, 800) } : {}),
        ...(String(s.unplaced || '').trim() ? { unplaced: String(s.unplaced).trim().slice(0, 800) } : {}),
        raw_excerpt: String(cap.raw_text || '').slice(0, 400),
        media_count: Array.isArray(cap.media_refs) ? cap.media_refs.length : 0,
        /* ⚠️ HOW EACH LINE GOT ITS PRICE, on the chit. Whether a figure came from your shelf, from the customer's
           own words, or from nowhere at all is the difference between a quote and a guess — and it is unreadable
           afterwards unless it was written down at the time. */
        label,
        priced: {
          from_catalogue: priced.from_catalogue, unpriced: priced.unpriced,
          ambiguous: priced.ambiguous, asked_differs: priced.asked_differs,
          // Recorded, because "no price" and "we chose not to look" are different facts about the same chit.
          catalogue_used: useCatalogue,
        },
      },
      ...(currency ? { currency } : {}),
    },
    /**
     * ⚠️ THE ORIGINAL MESSAGE, TO BE ATTACHED AS EVIDENCE — the caller uploads this to the chit after sending.
     *
     * It is not decoration. A structured line is an AI's claim about what someone meant; the message is what they
     * said. Attachments already replicate per-entity-per-copy, so each party ends up HOLDING the original rather
     * than holding a pointer to ours — which is the whole difference when the two readings disagree later.
     *
     * ⚠️ MEDIA IS NOT INCLUDED YET. A photographed order's image lives at the provider and is fetched on demand;
     * carrying it onto the chit needs the media fetch at send time. `media_count` above says how many are missing
     * rather than letting a chit imply the photo came with it.
     */
    original: {
      filename: 'original-message-' + String(cap.channel || 'chit') + '.txt',
      text: [
        'ORIGINAL MESSAGE — as received, not interpreted',
        '',
        'Channel        : ' + (cap.channel || ''),
        'From           : ' + (cap.sender_name ? cap.sender_name + ' <' + (cap.sender_ref || '') + '>' : (cap.sender_ref || 'unknown')),
        'To (our line)  : ' + (cap.to_ref || '(not recorded)'),
        'Received       : ' + (cap.created_at || ''),
        'Provider msg id: ' + (cap.provider_msg_id || '(none)'),
        'Attachments    : ' + (Array.isArray(cap.media_refs) && cap.media_refs.length
          ? cap.media_refs.length + ' held at the provider, not copied onto this chit' : 'none'),
        'Sender verified: NO — this is a phone number that wrote in, not a checked party',
        '',
        '--- what they wrote ---',
        String(cap.raw_text || ''),
      ].join('\n'),
    },
  };
}

/**
 * consolidationInput(entity_id) — the raised requests, in the shape the consolidator totals (W-1).
 *
 * ⚠️ IT READS THE CHITS, NOT THE CAPTURES. A capture is what someone said; a CHIT is what was accepted onto the
 * record. Consolidating from captures would total messages a human had dismissed, and would keep totalling a
 * request that was later voided — the requirement he sources against must be the record, not the inbox.
 *
 * ⚠️ AND THE STORE COMES FROM THE SENDER'S NUMBER, resolved through lib/stores.js. The WhatsApp profile name is
 * whatever the shop typed into their phone and changes without warning; the number is the key.
 */
async function consolidationInput(entity_id, opts = {}) {
  const stores = require('./stores');
  const select = require('./select');
  const rows = await select.rows(entity_id, { direction: 'received', since: opts.since, limit: 2000 });

  const out = [];
  for (const r of rows) {
    const via = ((r.summary_json || {}).via) || {};
    if (via.channel !== 'whatsapp' && via.channel !== 'email' && via.channel !== 'sms') continue;   // channel-born only
    const det = await withEntity(entity_id, (c) => c.query(
      'SELECT line_items FROM chit_detail WHERE chit_id = $1 AND entity_id = $2 LIMIT 1', [r.chit_id, entity_id]));
    const lines = ((det.rows[0] || {}).line_items) || [];
    if (!lines.length) continue;

    const store = await stores.resolve(entity_id, via.from, via.from_name);
    /* ⚠️ THE DATE IS WHAT THE MESSAGE SAID, RESOLVED — and null when it said nothing. `delivery_at` is verbatim
       prose ("friday", "7pm"); only a real date may total. Anything unresolved stays null so the consolidator
       flags it date-unspecified rather than quietly assuming today. */
    const fulfil = _resolveDate(via.delivery_at, r.created_at);
    out.push({
      store_id: store ? store.store_id : (via.from || 'unknown'),
      store_name: store ? store.display_name : (via.from_name || via.from || 'unknown'),
      store_provisional: store ? !!store.provisional : true,
      chit_id: r.chit_id,
      fulfil_date: fulfil,
      stated_when: via.delivery_at || null,
      /* W-11: the store's default address unless the message named a different one — and the override is FLAGGED,
         because delivering to the wrong place is a real operational error, not a cosmetic one. */
      deliver_to: via.delivery_address || (store && store.address) || null,
      address_overridden: !!(via.delivery_address && store && store.address && via.delivery_address !== store.address),
      lines: lines.map((l) => ({ particulars: l.particulars, comment: l.comment || '', qty: Number(l.quantity) || 0, unit: l.unit || '' })),
    });
  }
  return out;
}

/**
 * ⚠️ "FRIDAY" IS NOT A DATE UNTIL IT IS ONE, and if it cannot be resolved it must stay null. The directive is
 * explicit: no stated date → flag date-unspecified, never assume today. Assuming today is the failure that sources
 * the right quantity on the wrong morning, and it looks completely normal on screen.
 */
const _DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function _resolveDate(said, from) {
  const s = String(said || '').toLowerCase().trim();
  if (!s) return null;
  const iso = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const base = new Date(from || Date.now());
  if (/\btomorrow\b/.test(s)) { const d = new Date(base); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }
  if (/\btoday\b/.test(s))    { return base.toISOString().slice(0, 10); }
  for (let i = 0; i < 7; i++) {
    if (new RegExp('\\b' + _DAYS[i] + '\\b').test(s)) {
      const d = new Date(base);
      const delta = ((i - d.getDay()) + 7) % 7 || 7;   // the NEXT such day; "friday" on a Friday means next Friday
      d.setDate(d.getDate() + delta);
      return d.toISOString().slice(0, 10);
    }
  }
  return null;   // a time with no day ("7pm") is not a fulfilment date — flagged, never guessed
}

module.exports = { createCapture, listPending, getCapture, structureCapture, markConverted, dismissCapture, raisePayload, consolidationInput, _resolveDate, CHANNELS };
