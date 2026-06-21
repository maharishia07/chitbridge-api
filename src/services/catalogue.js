const { pool } = require("../db");
const err = (s, m, c) => Object.assign(new Error(m), { status: s, code: c });
async function listCategories(entityId) {
  const { rows } = await pool.query(
    `select * from cb_catalogue_category where entity_id=$1 order by sort_by, name`, [entityId]);
  return rows;
}
async function createCategory({ entityId, name, image = null, currencyCode = "INR", sortBy = 0 }) {
  if (!name) throw err(400, "name required", "NAME_REQUIRED");
  const { rows } = await pool.query(
    `insert into cb_catalogue_category(entity_id,name,image,currency_code,sort_by)
     values ($1,$2,$3,$4,$5) returning *`, [entityId, name, image, currencyCode, sortBy]);
  return rows[0];
}
// tier = price_type the VIEWER is entitled to (Personal/Business/Employee). Omit = owner sees all.
async function listItems({ entityId, tier = null }) {
  const params = [entityId];
  let where = `entity_id=$1`;
  if (tier) { params.push(tier); where += ` and price_type=$2`; }
  const { rows } = await pool.query(
    `select * from cb_catalogue_item where ${where} order by sort_by, name`, params);
  return rows;
}
async function createItem(b) {
  if (!b.entityId) throw err(400, "entityId required", "ENTITY_REQUIRED");
  const { rows } = await pool.query(
    `insert into cb_catalogue_item
       (entity_id,name,price,currency_code,price_type,available_stock,section,category,
        out_of_stock,offer,discounted_price,discount_percentage,sort_by,
        field_json_data,tax_json_data,image_json_data)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
    [b.entityId, b.name||"", b.price||0, b.currencyCode||"INR", b.priceType||"Business",
     b.availableStock||"", b.section||"", b.category||"", !!b.outOfStock, b.offer||null,
     b.discountedPrice||0, b.discountPercentage||0, b.sortBy||0,
     b.fieldJsonData||null, b.taxJsonData||null, b.imageJsonData||null]);
  return rows[0];
}
async function updateItem(itemId, patch) {
  const allowed = ["name","price","price_type","available_stock","section","category",
    "out_of_stock","offer","discounted_price","discount_percentage","sort_by",
    "field_json_data","tax_json_data","image_json_data"];
  const sets = [], vals = []; let i = 1;
  for (const k of allowed) if (k in patch) { sets.push(`${k}=$${i++}`); vals.push(patch[k]); }
  if (!sets.length) throw err(400, "nothing to update", "NO_FIELDS");
  vals.push(itemId);
  const { rows } = await pool.query(
    `update cb_catalogue_item set ${sets.join(", ")}, updated_at=now() where id=$${i} returning *`, vals);
  if (!rows[0]) throw err(404, "item not found", "NOT_FOUND");
  return rows[0];
}
async function deleteItem(itemId) {                      // soft: mark out_of_stock + copy_flag off
  const { rows } = await pool.query(
    `update cb_catalogue_item set out_of_stock=true, updated_at=now() where id=$1 returning id`, [itemId]);
  if (!rows[0]) throw err(404, "item not found", "NOT_FOUND");
  return { id: rows[0].id, deleted: true };
}
module.exports = { listCategories, createCategory, listItems, createItem, updateItem, deleteItem };
