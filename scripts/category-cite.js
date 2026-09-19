/**
 * scripts/category-cite.js — PRODUCTS ON THE LEGACY CATEGORY KEY, MADE TO CITE THE MASTER ([TILL-114]).
 *
 * Athi, 2026-09-19: *"do the migration for existing products — which existing products are we talking about
 * here?"*
 *
 * ── ⚠️⚠️⚠️ THE SECOND HALF OF THAT QUESTION IS THE POINT, AND I COULD NOT ANSWER IT ──────────────────────────
 *
 * I said "existing products carry the legacy key" without counting any. **This script's DRY RUN is the answer**
 * — it names the shop, the number, and every distinct category name it would create or cite. Nothing is
 * changed until somebody has read that.
 *
 * ── ⭐ WHY A SCRIPT AND NOT A NUMBERED MIGRATION, which is Athi's own earlier ruling ──────────────────────────
 *
 * On 2026-08-23 he asked: *"why do we need the migration? It is nothing but the existing catalogue that we pick
 * up, so why do we need a migration?"* scripts/dedupe-catalogue.js records the answer and it holds here:
 *   · **A migration is for SCHEMA** — a numbered step every environment must receive, in order, forever. This
 *     is rows in one shop's catalogue. Filing it as `bNNN` would tell every future environment to clean up a
 *     mess it never had.
 *   · **Going at the table bypasses the rules the product enforces.** `PATCH /api/products/:id` runs inside
 *     `withEntity()`, which sets the RLS context, so it cannot touch another entity's row even if asked. Hand
 *     -written SQL runs as the owner, where the only thing between a typo and somebody else's catalogue is the
 *     WHERE clause.
 *
 * So: the same doors the screens use — `POST /api/definitions` for a category, `PATCH /api/products/:id` with
 * `merge:true` for the citation.
 *
 * ── ⚠️⚠️ IT IS NON-DESTRUCTIVE, DELIBERATELY ─────────────────────────────────────────────────────────────────
 *
 * The legacy `category` string is **left exactly where it is**. catalogue-columns calls it *"read, never
 * written again"* — READ — and lib/categories.nameOf already prefers the master over it, so once a product
 * cites an id the old value is inert. Removing it would destroy the only record of what the shop originally
 * typed, on the strength of a case-insensitive name match. A migration that cannot be second-guessed afterwards
 * is not one I would run on somebody's catalogue. [[feedback-partial-writes-merge-patch]]
 *
 * ⚠️ MERGE, NEVER A WHOLE-RECORD WRITE. `merge:true` is an RFC 7386 patch: the one key moves and nothing else
 * does. Sending the whole item_data would overwrite a price somebody changed while this was running.
 *
 * ⭐ Idempotent — a product that already cites a category is skipped, so a second run finds nothing.
 *
 *     node scripts/category-cite.js                 ← DRY RUN. Answers "which products", changes nothing.
 *     node scripts/category-cite.js --apply         ← does it
 *     CB_SHOP_NAME=… CB_SHOP_EMAIL=… node scripts/category-cite.js    ← a different shop
 */
const P = require('./_proof');

const SHOP = process.env.CB_SHOP_NAME || 'Chola Auto Care';
const EMAIL = process.env.CB_SHOP_EMAIL || 'cholaauto@email.com';
const APPLY = process.argv.includes('--apply');

const dataOf = (x) => (x && x.item_data) || x || {};

(async () => {
  console.log('\n══ CATEGORY CITATIONS ' + (APPLY ? '· APPLYING' : '· DRY RUN (nothing will change)') + ' ══\n');

  const token = await P.signIn(EMAIL, SHOP);
  if (!token) { console.log('sign-in failed for ' + SHOP); process.exit(1); }
  const auth = { token };

  /* ── what is actually there ─────────────────────────────────────────────────────────────────────────── */
  const r = await P.j('/api/products?limit=500', auth);
  const items = (r.b && (r.b.items || r.b)) || [];
  if (!Array.isArray(items)) { console.log('unexpected catalogue shape'); process.exit(1); }

  /**
   * ⚠️ THE THREE STATES, COUNTED SEPARATELY, because only one of them is work — and reporting them together
   * would make a healthy catalogue look like a problem.
   */
  const needs = [], already = [], none = [];
  for (const it of items) {
    const d = dataOf(it);
    const cites = Array.isArray(d.categories) && d.categories.length;
    const legacy = typeof d.category === 'string' && d.category.trim();
    if (cites) already.push(it);
    else if (legacy) needs.push({ it, name: d.category.trim() });
    else none.push(it);
  }

  console.log(SHOP + ' — ' + items.length + ' product(s) read\n');
  console.log('  already citing a category   ' + already.length);
  console.log('  ON THE LEGACY KEY           ' + needs.length + (needs.length ? '   ← this is the work' : ''));
  console.log('  no category at all          ' + none.length + '   (left alone — nothing to cite)\n');

  if (!needs.length) {
    console.log('  Nothing to do. Either this shop never used the legacy key, or it has already been run.\n');
    return;
  }

  /* ── which categories, and which exist ──────────────────────────────────────────────────────────────── */
  const wanted = [...new Set(needs.map((n) => n.name))].sort();
  const dr = await P.j('/api/definitions?kind=category&all=1', auth);
  const defs = (dr.b && (dr.b.definitions || dr.b)) || [];
  const byLower = new Map();
  for (const d of (Array.isArray(defs) ? defs : [])) {
    if (d && d.name) byLower.set(String(d.name).toLowerCase(), d);
  }

  console.log('  the categories these products name:');
  const toCreate = [];
  for (const w of wanted) {
    const hit = byLower.get(w.toLowerCase());
    const n = needs.filter((x) => x.name === w).length;
    console.log('    ' + (hit ? 'have ' : 'NEW  ') + w.padEnd(26) + n + ' product' + (n === 1 ? '' : 's')
      + (hit && hit.name !== w ? '   (matches existing "' + hit.name + '")' : ''));
    if (!hit) toCreate.push(w);
  }
  console.log('');

  if (!APPLY) {
    console.log('  DRY RUN — would create ' + toCreate.length + ' category(ies) and set a citation on '
      + needs.length + ' product(s).');
    console.log('  The legacy `category` string stays on every one of them, untouched.');
    console.log('  Re-run with --apply to do it.\n');
    return;
  }

  /* ── create what is missing ─────────────────────────────────────────────────────────────────────────── */
  for (const name of toCreate) {
    /* ⚠️ `live`, not draft: these categories are cited by products that are on sale now. A draft would
       resolve to nothing on the counter, which is the defect this whole change is closing. */
    const c = await P.j('/api/definitions', { method: 'POST', body: { kind: 'category', name, status: 'live' } }, auth);
    const made = c.b && (c.b.definition || c.b);
    if (!made || !made.definition_id) { console.log('  could not create "' + name + '" — stopping, nothing further changed'); process.exit(1); }
    byLower.set(name.toLowerCase(), made);
    console.log('  created  ' + name);
  }

  /* ── cite it, one product at a time, through the door the screen uses ───────────────────────────────── */
  let done = 0, failed = 0;
  for (const { it, name } of needs) {
    const def = byLower.get(name.toLowerCase());
    if (!def) { failed++; console.log('  no category for "' + name + '" — skipped'); continue; }
    const id = it.item_id || it.id;
    /**
     * ⚠️ MERGE. The one key moves; the price, the stock and the legacy `category` string all stay exactly as
     * they are. A whole-record write here would clobber anything changed while this was running.
     */
    const u = await P.j('/api/products/' + id,
      { method: 'PATCH', body: { merge: true, item_data: { categories: [def.definition_id] } } }, auth);
    if (u.s >= 200 && u.s < 300) { done++; }
    else { failed++; console.log('  ' + (dataOf(it).name || id) + ' — refused (' + u.s + ')'); }
  }

  console.log('\n  cited  ' + done + '\n  failed ' + failed);
  console.log('  the legacy `category` value is still on every product — nothing was removed.\n');
})();
