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
  const res = {}; tables.forEach((item) => (res[item] = new Set()));
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
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((item) => re.test(item)).sort() : [];
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
  const ok = new Set((allow || []).map((item) => item.replace(/\\/g, '/')));
  const hits = [];
  for (const f of walk(root, [])) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    if (ok.has(rel) || rel === 'lib/field-ledger.js' || rel === 'lib/cmdb.js') continue;
    const t = fs.readFileSync(f, 'utf8');
    for (const p of patterns) if (new RegExp(p).test(t)) { hits.push(rel + ' ~ ' + p); break; }
  }
  return hits;
}

/* ── W1-SET (FLD2, 2026-10-15): the SHOP's flags and the PERSON's prefs have a dictionary entry ──────────────────────────
 * The dictionary is docs/FIELDS.md. Two places a setting key is born, read from the source like the columns above:
 *   · a policy flag        lib/policy.js FLAGS           → `policy_flags.<key>`
 *   · a person's pref      routes/entities.js PREF_SETS  → `ui_prefs.<key>` · `locale_prefs.<key>`
 * undocumentedSettings(root) names every key with no row — 31 flags had none when this was written. */

/** the stores a setting key lives in, as the dictionary spells them */
const SETTING_STORES = ['policy_flags', 'ui_prefs', 'locale_prefs'];

/** policyFlagKeys(root) → the FLAGS keys of lib/policy.js, in file order (a two-space-indented `key: { type:` line) */
function policyFlagKeys(root) {
  const source = fs.readFileSync(path.join(root, 'lib', 'policy.js'), 'utf8');
  const start = source.indexOf('const FLAGS = {');
  const flagsBlock = source.slice(start, source.indexOf('\n};', start));
  const keys = [];
  const flagLine = /^ {2}([a-z_][a-z0-9_]*):\s*\{\s*type:/gm;
  let match;
  while ((match = flagLine.exec(flagsBlock))) keys.push(match[1]);
  return keys;
}

/** prefKeys(root) → { ui_prefs: [key], locale_prefs: [key] } from routes/entities.js PREF_SETS (`column: '…'` … `keys: […]`) */
function prefKeys(root) {
  const source = fs.readFileSync(path.join(root, 'routes', 'entities.js'), 'utf8');
  const setsBlock = source.slice(source.indexOf('const PREF_SETS = {'));
  const out = {};
  const columnThenKeys = /column:\s*'([a-z_]+)'[\s\S]*?keys:\s*\[([^\]]*)\]/g;
  let match;
  while ((match = columnThenKeys.exec(setsBlock))) {
    out[match[1]] = match[2].split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  return out;
}

/**
 * dictionaryKeys(root) → the Set of `<store>.<key>` docs/FIELDS.md has a row for. A row's key cell is backticked; a run of sibling
 * keys is written `locale_prefs.nu` · `.hc` · `.ca` — the short `.hc` form inherits the store named just before it on the line.
 */
function dictionaryKeys(root) {
  const dictionary = fs.readFileSync(path.join(root, 'docs', 'FIELDS.md'), 'utf8');
  const storeRe = new RegExp('^(' + SETTING_STORES.join('|') + ')\\.([a-z_][a-z0-9_]*)');
  const found = new Set();
  for (const line of dictionary.split('\n')) {
    let store = null;
    for (const token of line.match(/`[^`]+`/g) || []) {
      const text = token.slice(1, -1);
      const full = storeRe.exec(text);
      if (full) { store = full[1]; found.add(full[1] + '.' + full[2]); continue; }
      const short = /^\.([a-z_][a-z0-9_]*)$/.exec(text);
      if (short && store) found.add(store + '.' + short[1]);
    }
  }
  return found;
}

/** undocumentedSettings(root) → every `<store>.<key>` the code defines and the dictionary does not name */
function undocumentedSettings(root) {
  const documented = dictionaryKeys(root);
  const defined = policyFlagKeys(root).map((item) => 'policy_flags.' + item);
  const prefs = prefKeys(root);
  for (const store of Object.keys(prefs)) for (const key of prefs[store]) defined.push(store + '.' + key);
  return defined.filter((item) => !documented.has(item));
}

module.exports = { PRODUCT_TABLES, SETTING_STORES, columns, loadLedger, formInputs, readers, sqlFiles,
  policyFlagKeys, prefKeys, dictionaryKeys, undocumentedSettings };
