/**
 * e2e/seed.js — M3, the seeded demo entity.
 *
 * Backlog M3: *"Multiplier: every visual probe today measured EMPTY SCREENS. Also the end-to-end showcase and
 * the new-joiner landing."*
 *
 * ⚠️⚠️ AN EMPTY SCREEN IS THE ONE STATE THAT PASSES EVERYTHING. No rows means no long subject to overflow, no
 * flag to mis-colour, no second currency to add up wrongly, no dispute bar, no unread dot. Every visual check
 * in this suite has been measuring the easiest possible page and reporting it as the product.
 *
 * ⭐⭐ AND IT IS EXACTLY WHY THEME-01 FAILS IN A FULL BATCH AND PASSES ALONE. The contrast audit walks every
 * text node on screen; a 64-spec run leaves the shared account full, so the batch reaches states the solo run
 * never does. Seeding makes the honest measurement available at the cost of ONE spec instead of sixty-four —
 * the batch was never flaky, it was just better informed.
 *
 * ⚠️ IT WRITES TO PRODUCTION, AND THAT IS NOT NEW. `mintEntity` already creates a real entity on the real API
 * every time this suite runs. Seeding adds rows to an entity that is already disposable and already exists;
 * it does not touch anyone's real business. ⚠️ It must therefore NEVER be pointed at a real entity — the
 * guard for that is that it only ever runs against whatever `mintEntity` handed back.
 *
 * ⭐ IT MINTS THROUGH `sendChit`, NOT THROUGH THE API DIRECTLY. That is the single mint path every screen
 * uses, so a seeded chit is frozen, fanned out and filed exactly like one a person sent. A seed that takes a
 * shortcut produces data the product cannot produce, and then the screens built on it prove nothing.
 *
 * ⭐ SELF-CHITS, SO ONE SEND FILLS BOTH TRACKS. A chit addressed to yourself fans out to two copies — one in
 * Order (sent) and one in Task (received) — so six sends populate twelve rows across both rails without
 * needing a second entity and a second sign-in.
 */

/**
 * ⚠️ THE REFERENCES ARE THE IDEMPOTENCY KEY. Re-running must not append — the shared `authed` account persists
 * between runs, and a seed that grows every time turns "measured on 12 rows" into an unrepeatable number.
 * These read as ordinary order references because they are on screen; `SO-1180` is the one looked for.
 */
const SEED_ROWS = [
  { ref: 'SO-1180', subject: 'Cartons of 6 — August delivery', priority: 'normal' },
  { ref: 'SO-1181', subject: 'Replacement pallet — line 4',     priority: 'urgent' },
  { ref: 'SO-1182', subject: 'Q3 pricing review',               priority: 'high' },
  { ref: 'PO-4471', subject: 'Damaged consignment on arrival',  priority: 'normal', dispute: 'open' },
  { ref: 'PO-4472', subject: 'Short delivery — February',       priority: 'normal', dispute: 'resolved' },
  { ref: 'SO-1183', subject: 'Packaging spec — draft',          priority: 'normal', draft: true },
];

const SEED_PRODUCTS = [
  { name: 'Corrugated carton, 6-pack', unit: 'carton', price: 250, code: 'CTN-6',  desc: 'Double-wall, 320×240×180mm.' },
  { name: 'Pallet wrap, 500mm',        unit: 'roll',   price: 890, code: 'WRP-500', desc: '23 micron, 1.5kg net.' },
];

/** The subject as it appears on a row — reference first, so the list is scannable and the key is findable. */
const subjectOf = (r) => r.ref + ' · ' + r.subject;

/**
 * Populate the signed-in entity. Idempotent: if `SO-1180` is already filed, nothing is written.
 *
 * @param {import('@playwright/test').Page} page  a page already signed in (call after mintEntity)
 * @param {{force?: boolean}} [opts]  force re-seeds even if the marker is present
 * @returns {Promise<{seeded: boolean, chits: number, products: number, reason?: string}>}
 */
async function seedDemo(page, opts = {}) {
  const out = await page.evaluate(async ({ rows, products, force, mark }) => {
    const log = { seeded: false, chits: 0, products: 0, errors: [] };

    /**
     * ── already done? ─────────────────────────────────────────────────────────────────────────────────
     *
     * ⚠️⚠️ THE FIRST VERSION GUESSED THE RESPONSE SHAPE AND THE GUESS WAS WRONG. `api('inbox')` returns the
     * ARRAY, not `{chits:[…]}` — `pgNext` reads `const raw = (res || [])` and maps it directly. So this check
     * looked for a subject inside an object that had no rows to look through, found nothing, and reported
     * "not seeded" every time.
     *
     * ⭐ AND THE FAILURE WAS SILENT IN THE WORST DIRECTION: an idempotency check that always says "no" turns
     * a seed into an appender. Running it twice produced twelve chits, not six. The same wrong guess also
     * broke the dispute lookup below, so the two flags this seed exists to create were the two it missed.
     *
     * ⚠️ CHECK THE SHAPE OF A RESPONSE BEFORE BRANCHING ON IT. `r.chits || r.rows || r.items` reads like
     * defensiveness and is actually three guesses wearing a fallback chain — none of them the answer, and the
     * `|| []` at the end made all three fail quietly.
     */
    if (!force) {
      try {
        const r = await api('inbox', { query: { limit: 200 } });
        const have = (Array.isArray(r) ? r : (r && (r.chits || r.rows || r.items)) || [])
          .some((c) => String(c.manual_subject || '').indexOf(mark) === 0);
        if (have) return { ...log, reason: 'already seeded' };
      } catch (e) {
        /* ⚠️ A FAILED CHECK IS NOT "NOT SEEDED". Falling through would double the data every time the list
           call happened to fail, which is precisely when nobody is watching. */
        return { ...log, reason: 'could not read the list, so nothing was written: ' + e.message };
      }
    }

    const made = [];
    for (const row of rows) {
      try {
        /* the app's own mint path — same freeze, same fan-out, same filing as a person sending it */
        const r = await sendChit({
          recipients: [{ name: (window.UI && UI._me && UI._me.name) || 'self', role: 'to', self: true }],
          subject: row.ref + ' · ' + row.subject,
          priority: row.priority,
          isDraft: !!row.draft,
          line_items: [],
          schema_values: {},
          /**
           * ⚠️⚠️ `sendChit` DOES NOT THROW ON FAILURE — it calls `onError` and returns. So an empty handler
           * here does not "ignore a cosmetic toast", it SWALLOWS the only report of a failed send, and the
           * `log.chits++` below then counted an attempt as a chit. The first run reported `chits: 6` with no
           * errors while the account stayed empty.
           *
           * ⭐ A COUNTER THAT COUNTS ATTEMPTS IS WORSE THAN NO COUNTER, because it reads like evidence.
           */
          onError: (m) => { log.errors.push(row.ref + ' send: ' + m); },
        });
        /* ⚠️ AND THE RETURN VALUE IS THE PROOF, not the absence of an exception — a real send comes back with
           a chit_id, so that is what gets counted. */
        if (r && r.chit_id) { log.chits++; made.push({ row, id: r.chit_id }); }
        else if (!log.errors.some((x) => x.indexOf(row.ref) === 0)) {
          log.errors.push(row.ref + ': no chit_id came back');
        }
      } catch (e) { log.errors.push(row.ref + ': ' + e.message); }
    }

    /**
     * ⚠️ DISPUTES ARE RAISED FROM THE LIST, NOT FROM THE SEND. `sendChit` does not return the received copy's
     * id, and a dispute belongs on the copy the complaining party holds — so the ids are read back off the
     * filed list rather than guessed from the send response.
     */
    try {
      const r = await api('inbox', { query: { limit: 200 } });
      const filed = Array.isArray(r) ? r : (r && (r.chits || r.rows || r.items)) || [];
      for (const m of made) {
        if (!m.row.dispute) continue;
        const hit = filed.filter((c) => String(c.manual_subject || '').indexOf(m.row.ref) === 0)[0];
        if (!hit) { log.errors.push(m.row.ref + ': filed copy not found, no dispute raised'); continue; }
        const id = hit.chit_id;
        try {
          /* ⚠️ the reason must be at least 10 characters — confirmDispute enforces it and so does the route */
          const d = await api('dispute', { params: { id },
            body: { category: 'quality', reason: 'Seeded for measurement: ' + m.row.subject + '.' } });
          if (m.row.dispute === 'resolved') {
            const did = (d && (d.dispute_id || (d.dispute && d.dispute.dispute_id))) || null;
            if (did) {
              await api('resolveDispute', { params: { id, disputeId: did },
                body: { resolution_note: 'Seeded: settled by credit note.' } });
            } else { log.errors.push(m.row.ref + ': dispute id not returned, left open'); }
          }
        } catch (e) { log.errors.push(m.row.ref + ' dispute: ' + e.message); }
      }
    } catch (e) { log.errors.push('reading back the list: ' + e.message); }

    /* ── a catalogue, so the storefront and picker are not empty either ───────────────────────────────── */
    for (const p of products) {
      try { await api('prodAdd', { body: { item_data: p } }); log.products++; }
      catch (e) { log.errors.push('product ' + p.code + ': ' + e.message); }
    }

    log.seeded = log.chits > 0;
    return log;
  }, { rows: SEED_ROWS, products: SEED_PRODUCTS, force: !!opts.force, mark: SEED_ROWS[0].ref });

  return out;
}

module.exports = { seedDemo, SEED_ROWS, SEED_PRODUCTS, subjectOf };
