// @stage tested
// @stage-note The field ledger's facts (migration columns, product form inputs, readers of a not-used field).
// @stage-note Used by tests/field-ledger.test.cjs and C:/dev/toolset/fields/build.cjs; no route reaches it, by design.
'use strict';
/**
 * lib/field-ledger.js — THE FIELD LEDGER'S FACTS, read from the repo. Pure: no database, no request. (2026-10-09)
 *
 * Athi: *"we should not be leaving any field unturned."* The ledger of an item kind is a CMDB record
 * (data/cmdb/CAP-FIELDS-<KIND>-<n>.json, lib/cmdb.js `fields`). This file reads the three places a product field can
 * be born and says which of them the ledger does not know:
 *   · a COLUMN in a migration (catalogue_items, catalogue_item_version, schema_fields, catalogue_item_schedule)
 *   · a form INPUT on the product page (ct_… ids in the web app's app.html)
 *   · a READER of a field the ledger says is "not used"
 * The guard is tests/field-ledger.test.cjs. The generator is C:/dev/toolset/fields/build.cjs. One parser, here.
 */
const fs = require('fs'), path = require('path');

/** the tables whose every column is a product field (the item's own tables) */
const PRODUCT_TABLES = ['catalogue_items', 'catalogue_item_version', 'schema_fields', 'catalogue_item_schedule'];

function sqlFiles(root) {
  const out = [];
  for (const d of [root, path.join(root, 'migrations')]) {
    if (!fs.existsSync(d)) continue;
    for (const n of fs.readdirSync(d)) if (/\.sql$/i.test(n)) out.push(path.join(d, n));
  }
  return out;
}

/** columns(root, tables) → { table: [column] } from CREATE TABLE + ALTER … ADD/DROP COLUMN, across every migration */
function columns(root, tables) {
  const res = {}; tables.forEach((t) => (res[t] = new Set()));
  for (const f of sqlFiles(root)) {
    const s = fs.readFileSync(f, 'utf8').replace(/\r/g, '').replace(/--[^\n]*/g, '');
    for (const t of tables) {
      const re = new RegExp('CREATE TABLE (?:IF NOT EXISTS )?(?:public\\.)?' + t + '\\s*\\(([\\s\\S]*?)\\n\\);', 'gi');
      let m;
      while ((m = re.exec(s))) {
        for (const line of m[1].split('\n')) {
          const c = /^\s*([a-z_][a-z0-9_]*)\s+[a-z]/i.exec(line);
          if (c && !/^(primary|foreign|unique|constraint|check)$/i.test(c[1])) res[t].add(c[1]);
        }
      }
      const re2 = new RegExp('ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(?:public\\.)?' + t + '\\s+([^;]*);', 'gi');
      while ((m = re2.exec(s))) {
        let c;
        const add = /ADD COLUMN (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)/gi;
        while ((c = add.exec(m[1]))) res[t].add(c[1]);
        const drop = /DROP COLUMN (?:IF EXISTS )?([a-z_][a-z0-9_]*)/gi;
        while ((c = drop.exec(m[1]))) res[t].delete(c[1]);
      }
    }
  }
  const o = {};
  for (const t of tables) o[t] = [...res[t]];
  return o;
}

/** loadLedger(root, 'PRODUCT') → every `fields` row of CAP-FIELDS-PRODUCT*.json, in file order */
function loadLedger(root, kind) {
  const dir = path.join(root, 'data', 'cmdb');
  const re = new RegExp('^CAP-FIELDS-' + String(kind).toUpperCase() + '(-\\d+)?\\.json$');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => re.test(n)).sort() : [];
  const rows = [];
  for (const n of files) {
    const rec = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
    for (const f of (rec.fields || [])) rows.push(f);
  }
  return { files, rows };
}

/** formInputs(appHtml) → the ct_… ids of input/select/textarea tags (the product form), dynamic ct_f_${…} ones excluded */
function formInputs(html) {
  const ids = new Set();
  const tag = /<(?:input|select|textarea)\b[^>]*>/gi;
  let m;
  while ((m = tag.exec(html))) {
    const id = /\bid=\\?["']?(ct_[a-z0-9_]+)(?![a-z0-9_]*\$)/i.exec(m[0]);
    if (id && !/^ct_f_$/.test(id[1])) ids.add(id[1]);
  }
  /* inputs a helper builds (fld('ct_name', …)) never show up as a tag: the form READS them with val("ct_…") */
  const rd = /\bval\(\s*["'](ct_[a-z0-9_]+)["']\s*\)/g;
  while ((m = rd.exec(html))) ids.add(m[1]);
  return [...ids].sort();
}

function walk(dir, out) {
  for (const n of fs.readdirSync(dir)) {
    if (/^(node_modules|\.git|tests?|data|docs|migrations|public|scripts)$/.test(n)) continue;
    const p = path.join(dir, n), st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out); else if (/\.(js|cjs)$/.test(n)) out.push(p);
  }
  return out;
}

/** readers(root, patterns, allow) → files under lib/ routes/ middleware/ jobs that match a pattern and are not allowed */
function readers(root, patterns, allow) {
  const ok = new Set((allow || []).map((a) => a.replace(/\\/g, '/')));
  const hits = [];
  for (const f of walk(root, [])) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    if (ok.has(rel) || rel === 'lib/field-ledger.js' || rel === 'lib/cmdb.js') continue;
    const t = fs.readFileSync(f, 'utf8');
    for (const p of patterns) if (new RegExp(p).test(t)) { hits.push(rel + ' ~ ' + p); break; }
  }
  return hits;
}

module.exports = { PRODUCT_TABLES, columns, loadLedger, formInputs, readers, sqlFiles };
