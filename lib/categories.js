// @stage tested
// @stage-note The category master, read WITHOUT the tax gate. A category is not a tax fact, and reading it
// @stage-note through lib/tax-shelf made a shop's own categories invisible to it for want of a GSTIN.
'use strict';
/**
 * categories.js — A SHOP'S OWN CATEGORIES, READ AS THEMSELVES ([TILL-114]).
 *
 * ── ⚠️⚠️⚠️ THE DEFECT THIS EXISTS TO CLOSE ───────────────────────────────────────────────────────────────────
 *
 * `lib/catalogue-columns.js` states the model plainly:
 *     `categories`      "the Categories screen owns these; a product cites them by id"
 *     `category`        "the legacy single-category key — **read, never written again**"
 *
 * The counter read the legacy one. So a product categorised the CORRECT way — `categories: ['9c33…']` and no
 * `category` — arrived at the till with no category at all, and fell out of the chips and the By-category view.
 * Nothing failed; the product simply had no group.
 *
 * ⚠️⚠️ AND THE NAMES WERE ONLY REACHABLE THROUGH A TAX-GATED DOOR. The snapshot already loads
 * `taxShelf.readShelf()`, which returns `categories` beside the slabs — but that function's own note says
 * *"readShelf() answers null for a seller with no GSTIN."* So an UNREGISTERED shop, which is most small shops
 * and the entire reason the counter's front door exists, could not get its own category names, for the same
 * reason its tax is zero.
 *
 * ⭐ A CATEGORY IS NOT A TAX FACT. Widening the tax shelf would have tied the two together harder; this reads
 * the master on its own terms. [[feedback-name-vs-behaviour]]
 *
 * ── ⚠️ WHY THE WRITE IS HERE TOO, AND WHAT IT IS NOT ──────────────────────────────────────────────────────────
 * routes/definitions.js is where a person AUTHORS a definition: validation, rule checks, versions, notes. This
 * file does not reproduce that and must not. `ensureCategories` handles the degenerate case only — a category
 * has no rules — so that minting a starter catalogue can cite real ids instead of writing the legacy key back.
 * Anything richer belongs on the Categories screen.
 */

/** ⚠️ retired categories are excluded: a product may still cite one, and its name still resolves for display */
const LIST_SQL = `SELECT definition_id, name, status
                    FROM definition
                   WHERE entity_id = $1 AND kind = 'category'
                   ORDER BY name`;

/**
 * ⭐ every category this shop has, live or draft, as { id, name, status }.
 * @param io { withEntity } — injected, so this file needs no db handle of its own and stays testable
 */
async function listCategories(entity_id, io) {
  const r = await io.withEntity(entity_id, (db) => db.query(LIST_SQL, [entity_id]));
  return (r.rows || []).map((x) => ({ id: x.definition_id, name: x.name, status: x.status }));
}

/**
 * ⭐⭐ id → name, for resolving what a product cites.
 * ⚠️ A MAP, not a list, because the caller is resolving per product and a linear scan per row is the O(n²)
 * this codebase keeps being told about: *"if it is greater than O(1), it is not required."*
 */
async function categoryNames(entity_id, io) {
  const out = new Map();
  for (const c of await listCategories(entity_id, io)) out.set(String(c.id), c.name);
  return out;
}

/**
 * ⭐⭐ nameOf(item, names) — what this product's category is CALLED, whatever way it was recorded.
 *
 * ⚠️ THE ORDER IS THE HISTORY, and every step of it is real data somewhere:
 *   1. `categories[0]` resolved through the master — the correct, current model
 *   2. `category_names[0]` — the travelling copy a counterparty sent us, which we cannot resolve to our own ids
 *   3. `category` — the legacy key, still on every product written before the Categories screen existed
 * ⚠️ Pure and synchronous, so it can be called per row without a round trip. The same order lib/network-catalogue
 * already uses; this puts it in one place instead of two.
 */
function nameOf(item, names) {
  const d = item || {};
  const ids = Array.isArray(d.categories) ? d.categories : [];
  for (const id of ids) {
    const n = names && names.get ? names.get(String(id)) : null;
    if (n) return n;
  }
  if (Array.isArray(d.category_names) && d.category_names[0]) return String(d.category_names[0]);
  return d.category ? String(d.category) : null;
}

/**
 * ⭐⭐ ensureCategories(entity_id, names, io) → Map(name → id)
 *
 * Creates the ones that are missing and returns ids for all of them, so a caller can CITE rather than write the
 * legacy key back.
 *
 * ⚠️⚠️ MATCHED CASE-INSENSITIVELY ON THE NAME, which is the whole point of a master: a shop that already has
 * "Vegetables" must not acquire "vegetables" beside it. That is exactly the pollution free-text categories
 * cause, and creating a second one here would be us causing it.
 *
 * ⚠️ CREATED `live`, not draft. A starter catalogue's categories are cited by products that are on sale the
 * same minute; a draft category would resolve to nothing on the till. The draft state is for a person
 * authoring on the Categories screen, which is a different act.
 */
async function ensureCategories(entity_id, wanted, io) {
  const want = [...new Set((wanted || []).map((n) => String(n == null ? '' : n).trim()).filter(Boolean))];
  const out = new Map();
  if (!want.length) return out;

  const have = await listCategories(entity_id, io);
  const byLower = new Map();
  for (const c of have) byLower.set(c.name.toLowerCase(), c);

  const missing = [];
  for (const n of want) {
    const hit = byLower.get(n.toLowerCase());
    if (hit) out.set(n, hit.id);
    else missing.push(n);
  }
  if (!missing.length) return out;

  /**
   * ⚠️⚠️ ONE TRANSACTION, BOTH ROWS — the same rule routes/definitions.js states: *"A definition whose version 1
   * failed to write is a definition with no rules — it would list on the shelf, resolve to nothing."* A category
   * carries no rules, but the pair is still the unit.
   */
  await io.withEntity(entity_id, async (db) => {
    for (const n of missing) {
      const d = await db.query(
        `INSERT INTO definition (entity_id, kind, sub_kind, name, note, status, current_version, created_by)
         VALUES ($1, 'category', NULL, $2, NULL, 'live', 1, $3) RETURNING definition_id`,
        [entity_id, n.slice(0, 120), io.by || null]);
      const id = d.rows[0].definition_id;
      /* ⚠️ entity_id IS A COLUMN HERE TOO — omitted, the version row is scoped to nothing under RLS and the
         category resolves to nothing on the shelf. routes/definitions.js writes it; so must this. */
      await db.query(
        `INSERT INTO definition_version (definition_id, version, entity_id, rules, note, created_by)
         VALUES ($1, 1, $2, '{}'::jsonb, $3, $4)`,
        [id, entity_id, 'created with a starter catalogue', io.by || null]);
      out.set(n, id);
    }
  });
  return out;
}

module.exports = { listCategories, categoryNames, nameOf, ensureCategories, LIST_SQL };
