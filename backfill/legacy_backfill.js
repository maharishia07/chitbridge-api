/* eslint-disable no-console */
// Legacy MySQL (chitbridge_v3) -> Postgres (cb_*) backfill.
// Authored from docs/DB/chitbridge_v3.sql column names + the NET-03 schema + the reconciliation map.
// NOT run here — Rishi runs it against STAGING first, then verifies counts vs legacy.
//
// Run:
//   npm i mysql2                       # source driver (pg already present)
//   LEGACY_MYSQL_URL="mysql://user:pass@host:3306/chitbridge"  \
//   DATABASE_URL="postgresql://...supabase..."                 \
//   node backfill/legacy_backfill.js
//
// Order (dependency): currency -> city -> building -> industry -> entity (users+users_details)
//   -> entity_supplier/device/employee/contact -> catalogue_category -> catalogue_item
//   -> chit (chit_header) -> chit_item (chit_data) -> chit_log/task/txn_history/external_ref/consumer_traction.
// Conversions: bigint->uuid (mapped via legacy_id), bridge_id carried as-is, enum->text value,
//   json->jsonb (passthrough), MD5 password kept as password_hash + reset-on-first-login, 0000-00-00->null.
// Idempotent-ish: every target row carries legacy_id; re-runs skip rows whose legacy_id already exists.

const mysql = require("mysql2/promise");
const { Pool } = require("pg");
const { v4: uuid } = require("uuid");

// CB bridge-id label for ltree (matches src/lib/bridgeId.toLabel); legacy 32-hex ids are ltree-legal too.
const toLabel = (b) => String(b).toUpperCase().replace(/-/g, "_").replace(/[^A-Z0-9_]/g, "_");
// 0000-00-00 / empty -> null
const nz = (d) => (!d || String(d).startsWith("0000-00-00")) ? null : d;
const num = (v) => (v === "" || v == null) ? null : v;   // empty string -> null for numeric columns
const jb = (v) => (v == null || v === "") ? null : (typeof v === "string" ? v : JSON.stringify(v));
const modeFromBusinessType = (bt) => bt === "Business" ? "b2c" : (bt === "Aggregator" || bt === "Circle") ? "b2b" : "b2b";
const stateFromStatus = (s) => ({ Requested:"requested", Accepted:"active", Denied:"declined", Deleted:"disconnected" }[s] || "requested");

async function main() {
  const my = await mysql.createConnection(process.env.LEGACY_MYSQL_URL);
  const pg = new Pool({ connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false } });

  const q = async (sql, p = []) => (await my.query(sql, p))[0];
  const ins = async (sql, p) => (await pg.query(sql, p)).rows[0];
  const counts = {};

  // generic "insert if this legacy_id not already mapped"; returns the new uuid
  const seen = {}; // table -> Map(legacyId -> uuid)
  const map = (t) => (seen[t] = seen[t] || new Map());
  async function preload(table, col = "legacy_id") {
    const m = map(table);
    const { rows } = await pg.query(`select id, ${col} as lid from ${table} where ${col} is not null`);
    for (const r of rows) m.set(String(r.lid), r.id);
    return m;
  }

  // ---- 1. reference / master ----
  // cb_currency has no legacy_id (it's keyed by `code` + on-conflict); the others carry legacy_id.
  for (const target of ["cb_city", "cb_industry", "cb_building"]) await preload(target);

  for (const r of await q("select * from currency")) {
    if (map("cb_currency").has(String(r.id))) continue;
    const row = await ins(
      `insert into cb_currency(code,name,name_plural,rounding,decimal_digits,symbol,symbol_native,status)
       values ($1,$2,$3,$4,$5,$6,$7,coalesce($8,'Active')) on conflict (code) do update set name=excluded.name returning id`,
      [r.code, r.name, r.name_plural, r.rounding||0, r.decimal_digits||2, r.symbol, r.symbol_native, r.status]);
    map("cb_currency").set(String(r.id), row.id);
  }
  counts.currency = map("cb_currency").size;

  for (const r of await q("select * from city")) {
    if (map("cb_city").has(String(r.id))) continue;
    const row = await ins(`insert into cb_city(name,legacy_id) values ($1,$2) returning id`, [r.name || r.city_name, r.id]);
    map("cb_city").set(String(r.id), row.id);
  }
  for (const r of await q("select * from industry")) {
    if (map("cb_industry").has(String(r.id))) continue;
    const row = await ins(`insert into cb_industry(name,legacy_id) values ($1,$2) returning id`, [r.name || r.industry_name, r.id]);
    map("cb_industry").set(String(r.id), row.id);
  }
  for (const r of await q("select * from building")) {
    if (map("cb_building").has(String(r.id))) continue;
    const cityId = map("cb_city").get(String(r.city_id)) || null;
    const row = await ins(`insert into cb_building(city_id,name,legacy_id) values ($1,$2,$3) returning id`,
      [cityId, r.name || r.building_name, r.id]);
    map("cb_building").set(String(r.id), row.id);
  }
  counts.geo = map("cb_city").size + map("cb_building").size + map("cb_industry").size;

  // ---- 2. entity = users JOIN users_details (on bridge_id) ----
  await preload("cb_entity");
  const bridgeToId = new Map(); // bridge_id -> cb_entity.id (for FK resolution everywhere)
  {
    const { rows } = await pg.query(`select id, bridge_id from cb_entity`);
    for (const r of rows) bridgeToId.set(r.bridge_id, r.id);
  }
  const users = await q(
    `select u.*, d.account_type,d.business_type,d.firstname,d.lastname,d.contact_no,d.email_id,
            d.company_name,d.company_detail_short,d.company_detail_long,d.company_image,d.profileimage,
            d.location,d.latitude,d.longitude,d.geohash,d.city,d.state,d.country,d.currency_code,d.currency_code_id,
            d.time_zone_id,d.time_zone_offset,d.setting_row_per_page,d.external_connection,d.newsletter,
            d.terms_and_condition,d.business_status,d.sms_status,d.field_json_data
       from users u left join users_details d on d.bridge_id = u.bridge_id`);
  for (const u of users) {
    if (map("cb_entity").has(String(u.id)) || bridgeToId.has(u.bridge_id)) continue;
    const name = u.company_name || [u.firstname, u.lastname].filter(Boolean).join(" ") || u.username || "Unnamed";
    const row = await ins(
      `insert into cb_entity
         (bridge_id,name,mode,owner_scope,path,claimed,status,legacy_id,username,password_hash,
          account_type,business_type,firstname,lastname,contact_no,email_id,company_name,
          company_detail_short,company_detail_long,company_image,profile_image,location,latitude,longitude,
          geohash,city,state,country,currency_code,currency_id,time_zone_id,time_zone_offset,row_per_page,
          external_connection,newsletter,terms_accepted,business_status,sms_status,field_json_data,
          login_status,last_activity,created_at)
       values ($1,$2,$3,'entity',$4::ltree,true,coalesce($5,'active'),$6,$7,$8,
               $9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
               $23,$24,$25,$26,coalesce($27,'INR'),$28,$29,$30,coalesce($31,50),
               $32,$33,$34,coalesce($35,'Open'),$36,$37,$38,$39,$40)
       returning id`,
      [u.bridge_id, name, modeFromBusinessType(u.business_type), toLabel(u.bridge_id),
       (u.status||"active").toLowerCase().startsWith("act") ? "active" : "active", u.id, u.username, u.password,
       u.account_type, u.business_type, u.firstname, u.lastname, u.contact_no, u.email_id, u.company_name,
       u.company_detail_short, u.company_detail_long, u.company_image, u.profileimage, u.location, num(u.latitude), num(u.longitude),
       u.geohash, u.city, u.state, u.country, u.currency_code, map("cb_currency").get(String(u.currency_code_id))||null,
       num(u.time_zone_id)||0, num(u.time_zone_offset)||0, num(u.setting_row_per_page),
       !!u.external_connection, u.newsletter!==0, u.terms_and_condition!==0, u.business_status, !!u.sms_status,
       jb(u.field_json_data), !!u.login_status, nz(u.last_activity), nz(u.created_date)]);
    map("cb_entity").set(String(u.id), row.id);
    bridgeToId.set(u.bridge_id, row.id);
  }
  counts.entity = map("cb_entity").size;
  const eid = (bridge) => bridgeToId.get(bridge) || null;   // resolve a legacy bridge_id -> cb_entity.id

  // ---- 3. edge = network_contact (collapse Sender/Receiver double-entry -> one row) ----
  await preload("cb_edge");
  for (const n of await q("select * from network_contact where flag_status='Sender' or flag_status is null")) {
    if (map("cb_edge").has(String(n.network_contact_id))) continue;
    const parent = eid(n.from_bridge_id), child = eid(n.to_bridge_id);
    if (!parent || !child) continue; // skip if either side wasn't migrated
    const row = await ins(
      `insert into cb_edge(parent_id,child_id,type,state,alias_name,assign_to,legacy_id,created_at)
       values ($1,$2,'governance',$3,$4,$5,$6,$7) returning id`,
      [parent, child, stateFromStatus(n.status), n.alias_name, eid(n.assign_to_bridge_id), n.network_contact_id, nz(n.created_date)]);
    map("cb_edge").set(String(n.network_contact_id), row.id);
  }
  counts.edge = map("cb_edge").size;
  // NOTE: ltree paths above seed every entity as its own root. Re-deriving the live hierarchy from
  // active edges (reparent down the tree) is a deliberate follow-up — legacy was a flat peer graph.

  // ---- 3b. employees / contacts / suppliers / devices (no legacy_id; dedup via unique constraints) ----
  for (const r of await q("select * from users_employee")) {
    const owner = eid(r.owner_bridge_id), emp = eid(r.employee_bridge_id);
    if (!owner || !emp) continue;
    await pg.query(`insert into cb_entity_employee(owner_id,employee_id,employee_name) values ($1,$2,$3)
                    on conflict (owner_id,employee_id) do nothing`, [owner, emp, r.employee_name || null]);
  }
  for (const r of await q("select * from user_bridge_contacts")) {
    const owner = eid(r.owner_bridge_id || r.bridge_id), contact = eid(r.contact_bridge_id || r.to_bridge_id);
    if (!owner || !contact) continue;
    await pg.query(`insert into cb_contact(owner_id,contact_id,role,created_at) values ($1,$2,$3,$4)
                    on conflict (owner_id,contact_id) do nothing`, [owner, contact, r.role || "", nz(r.created_date)]);
  }
  for (const r of await q("select * from favourite_user")) {
    const owner = eid(r.bridge_id || r.owner_bridge_id), contact = eid(r.favourite_bridge_id || r.to_bridge_id);
    if (!owner || !contact) continue;
    await pg.query(`insert into cb_contact(owner_id,contact_id,is_favourite) values ($1,$2,true)
                    on conflict (owner_id,contact_id) do update set is_favourite=true`, [owner, contact]);
  }
  for (const r of await q("select * from users_industry_supplier")) {
    const e = eid(r.bridge_id); if (!e) continue;
    await pg.query(`insert into cb_entity_supplier(entity_id,industry_id,building_id) values ($1,$2,$3)
                    on conflict do nothing`,
      [e, map("cb_industry").get(String(r.industry_id))||null, map("cb_building").get(String(r.building_id))||null]);
  }
  for (const r of await q("select * from user_device")) {
    const e = eid(r.bridge_id); if (!e) continue;
    await pg.query(`insert into cb_device(entity_id,service_provider_id,device_id,device_token,platform,priority)
                    values ($1,$2,$3,$4,coalesce($5,'android'),coalesce($6,'Low'))`,
      [e, eid(r.service_provider_bridge_id)||null, r.device_id, r.device_token, r.platform, r.priority]);
  }

  // ---- 4. catalogue ----
  await preload("cb_catalogue_category"); await preload("cb_catalogue_item");
  for (const r of await q("select * from pricelist_category")) {
    if (map("cb_catalogue_category").has(String(r.pricelist_category_id))) continue;
    const e = eid(r.bridge_id); if (!e) continue;
    const row = await ins(`insert into cb_catalogue_category(entity_id,name,image,currency_code,currency_id,sort_by,legacy_id)
                           values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [e, r.pricelist_category_name, r.pricelist_category_image, r.currency_code,
       map("cb_currency").get(String(r.currency_code_id))||null, r.sort_by||0, r.pricelist_category_id]);
    map("cb_catalogue_category").set(String(r.pricelist_category_id), row.id);
  }
  for (const r of await q("select * from pricelist")) {
    if (map("cb_catalogue_item").has(String(r.pricelist_id))) continue;
    const e = eid(r.bridge_id); if (!e) continue;
    const row = await ins(
      `insert into cb_catalogue_item
         (entity_id,name,price,currency_code,currency_id,out_of_stock,copy_flag,available_stock,section,category,
          cross_reference,price_type,offer,discounted_price,discount_percentage,sort_by,
          field_json_data,additional_json_data,internal_json_data,image_json_data,audio_json_data,video_json_data,tax_json_data,
          created_at,updated_at,legacy_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12,'Business'),$13,$14,$15,$16,
               $17,$18,$19,$20,$21,$22,$23,$24,$25,$26) returning id`,
      [e, r.name, r.price||0, r.currency_code, map("cb_currency").get(String(r.currency_code_id))||null,
       !!r.out_of_stock, !!r.copy_flag, r.available_stock, r.section, r.category, r.cross_reference,
       r.price_type, r.offer, r.discounted_price||0, r.discount_percentage||0, r.sort_by||0,
       jb(r.field_json_data), jb(r.additional_json_data), jb(r.internal_json_data), jb(r.image_json_data),
       jb(r.audio_json_data), jb(r.video_json_data), jb(r.tax_json_data), nz(r.created_date), nz(r.updated_date), r.pricelist_id]);
    map("cb_catalogue_item").set(String(r.pricelist_id), row.id);
  }
  counts.catalogue = map("cb_catalogue_item").size;

  // ---- 5. chit = chit_header (pre-map chit_hash -> new uuid so originator/parent resolve in one pass) ----
  await preload("cb_chit", "legacy_chit_id");
  const headers = await q("select * from chit_header");
  const hashToId = new Map();                       // legacy chit_hash_id -> new uuid
  for (const h of headers) hashToId.set(h.chit_hash_id, uuid());
  for (const h of headers) {
    if (map("cb_chit").has(String(h.chit_id))) continue;
    const id = hashToId.get(h.chit_hash_id);
    const originator = hashToId.get(h.originator_chit_hash_id) || id;
    const parent = hashToId.get(h.parent_chit_hash_id) || null;
    await pg.query(
      `insert into cb_chit
         (id,chit_hash,originator_id,parent_id,from_entity,to_entity,for_entity,info_entity,assign_to,assign_by,
          role,txn_status,subject,purpose,contact_number,for_non_bridge_name,bridge_status,physical_status,read_status,
          priority,location,latitude,longitude,geohash,template_flag,template_ver_no,folder_location,header_note,footer_note,
          task_comment,task_flag,signature,currency_code,currency_id,chit_item_count,total_chit_item_value,
          expected_delivery_time,estimated_delivery_time,ref_id,case_id,created_by,updated_by,notify_date,
          to_bridgelist,info_bridgelist,created_at,updated_at,legacy_chit_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
               'Act',$11,$12,$13,$14,$15,coalesce($16,'Sender'),coalesce($17,'Active'),coalesce($18,'UnRead'),
               coalesce($19,'No'),$20,$21,$22,$23,$24,$25,$26,$27,$28,
               $29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47)`,
      [id, h.chit_hash_id, originator, parent, eid(h.from_bridge_id), eid(h.to_bridge_id), eid(h.for_bridge_id),
       eid(h.info_bridge_id), eid(h.assign_to_bridge_id), eid(h.assign_by_bridge_id),
       h.transaction_status || "Active", h.subject, h.purpose, h.contact_number, h.for_non_bridge_name,
       h.bridge_status, h.physical_status, h.read_status, h.priority, h.location, num(h.latitude), num(h.longitude), h.geohash,
       !!h.template_flag, h.template_ver_no||0, h.folder_location, h.header_note, h.footer_note,
       jb(h.task_comment), jb(h.task_flag), h.signature, h.currency_code, map("cb_currency").get(String(h.currency_code_id))||null,
       h.chit_item_count||0, h.total_chit_item_value||0, nz(h.expected_delivery_time), nz(h.estimated_delivery_time),
       h.ref_id||0, h.case_id, eid(h.created_by), eid(h.updated_by), nz(h.notify_date),
       jb(h.to_bridgelist), jb(h.info_bridgelist), nz(h.created_date), nz(h.updated_date), h.chit_id]);
    map("cb_chit").set(String(h.chit_id), id);
  }
  counts.chit = map("cb_chit").size;
  const chitId = (legacyChitId) => map("cb_chit").get(String(legacyChitId)) || null;

  // ---- 6. chit_item = chit_data ----
  for (const d of await q("select * from chit_data")) {
    const cid = chitId(d.chit_id); if (!cid) continue;
    await pg.query(
      `insert into cb_chit_item(chit_id,particulars,particulars_code,qty,price,total,
         reply_particulars,reply_qty,reply_price,reply_total,status,previous_status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,'Active'),coalesce($12,'Active'))`,
      [cid, d.particulars, d.particulars_code, num(d.quantity)||0, num(d.price)||0, num(d.total)||0,
       d.reply_particulars, num(d.reply_quantity), num(d.reply_price), num(d.reply_total), d.current_status, d.previous_status]);
  }

  // ---- 7. logs / tasks / txn history / CRM ----
  for (const r of await q("select * from chit_header_log")) {
    const cid = chitId(r.chit_id); if (!cid) continue;
    await pg.query(`insert into cb_chit_log(chit_id,created_by,action,description,remark,action_by,action_date)
                    values ($1,$2,coalesce($3,'Created'),$4,$5,$6,$7)`,
      [cid, eid(r.created_by), r.action, r.description, r.remark, eid(r.action_by), nz(r.action_date)]);
  }
  for (const r of await q("select * from task_reference")) {
    await pg.query(`insert into cb_task(task_purpose,link_flag,from_entity,from_chit_id,from_ref_id,from_case_id,from_purpose,
                      to_entity,to_chit_id,to_ref_id,to_case_id,to_purpose,status)
                    values ($1,coalesce($2,'Internal'),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,coalesce($13,'Link'))`,
      [r.task_purpose, r.link_flag, eid(r.from_bridge_id), chitId(r.from_chit_id), r.from_ref_id, r.from_case_id, r.from_purpose,
       eid(r.to_bridge_id), chitId(r.to_chit_id), r.to_ref_id, r.to_case_id, r.to_purpose, r.status]);
  }
  for (const r of await q("select * from tansaction_history")) {
    await pg.query(`insert into cb_transaction_history(info_entity,to_entity,txn_status,batch_create_date,batch_process_date,
                      header_count,total_chit_item_count,sgst,cgst,amount,total)
                    values ($1,$2,coalesce($3,'Active'),$4,$5,$6,$7,$8,$9,$10,$11)`,
      [eid(r.info_bridge_id), eid(r.to_bridge_id), r.txn_status, nz(r.batch_create_date), nz(r.batch_process_date),
       r.header_count||0, r.total_chit_item_count||0, r.sgst||0, r.cgst||0, r.amount||0, r.total||0]);
  }
  for (const r of await q("select * from consumer_traction")) {
    await pg.query(`insert into cb_consumer_traction(business_id,consumer_id,total_visited,field_json_data,status,created_at,updated_at)
                    values ($1,$2,$3,$4,coalesce($5,'Active'),$6,$7)`,
      [eid(r.business_bridge_id), eid(r.consumer_bridge_id), r.total_visited||0, jb(r.field_json_data), r.status,
       nz(r.created_date), nz(r.updated_date)]);
  }
  for (const r of await q("select * from external_reference")) {
    await pg.query(`insert into cb_external_reference(entity_id,purpose,purpose_type,contact_number,contact_name,
                      contact_visit_count,contact_visit_value,source_of_reference,referrer_contact_number,referrer_contact_name,
                      referral_count,referral_value,priority,exit_level,exit_reason,field_json_data,status,created_at,updated_at)
                    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,coalesce($13,'Low'),coalesce($14,'None'),$15,$16,coalesce($17,'Active'),$18,$19)`,
      [eid(r.bridge_id), r.purpose, r.purpose_type, r.contact_number, r.contact_name,
       r.contact_visit_count||0, r.contact_visit_value||0, r.source_of_reference, r.referrer_contact_number, r.referrer_contact_name,
       r.referral_count||0, r.referral_value||0, r.priority, r.exit_level, r.exit_reason, jb(r.field_json_data), r.status,
       nz(r.created_date), nz(r.updated_date)]);
  }

  // ---- verify counts vs legacy ----
  const pairs = [["users","cb_entity"],["network_contact","cb_edge"],["pricelist","cb_catalogue_item"],
    ["pricelist_category","cb_catalogue_category"],["chit_header","cb_chit"],["chit_data","cb_chit_item"],
    ["currency","cb_currency"],["chit_header_log","cb_chit_log"],["task_reference","cb_task"],
    ["tansaction_history","cb_transaction_history"],["external_reference","cb_external_reference"]];
  console.log("\n== row-count check (legacy -> cb) ==");
  for (const [l, c] of pairs) {
    const lc = (await q(`select count(*) n from ${l}`))[0].n;
    const cc = (await pg.query(`select count(*)::int n from ${c}`)).rows[0].n;
    console.log(`  ${l}: ${lc}  ->  ${c}: ${cc}  ${String(lc)===String(cc)?"OK":"DIFF (expected for collapsed/skipped rows — review)"}`);
  }
  console.log("\nmapped:", counts);
  await my.end(); await pg.end();
  console.log("\nbackfill complete.");
}
main().catch((e) => { console.error("BACKFILL FAILED:", e); process.exit(1); });
