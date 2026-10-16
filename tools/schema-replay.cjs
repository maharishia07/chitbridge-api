/**
 * tools/schema-replay.cjs — READS migrations/ IN CHAIN ORDER AND JUDGES EACH FILE AGAINST THE SCHEMA RULES (SCHEMA-FIX1, 16 Oct).
 *
 * OWNS     the offline replay (no database): comment/dollar-quote stripping, statement splitting, a running model of tables · columns ·
 *          indexes · keys, and the rule checks R1–R17 of SCHEMA-ASSESSMENT-2026-10-16 "The GUARD".
 * CALLED BY tests/schema-lint.test.cjs (the gate). One copy: the schema inventory tool may call it too.
 * CHAIN    the order and the skip rules are tools/migrate.cjs's (BASELINE · chainFiles · CHAIN_SKIP) — never a third list.
 * LIMITS   it reads top-level statements. A DO block / EXECUTE format(...) is opaque to the rules (R11 still sees a table named in one),
 *          so the file that makes indexes in a loop says so with `-- schema-lint: allow R1 <reason>`. R14 judges new jsonb COLUMNS only.
 * FLOW     chain order → per file: strip → split → apply to model → judge rules → { file, rule, object }[] (minus header allows)
 */
'use strict';
const fs = require('fs'), path = require('path');
const { chainFiles } = require('./migrate.cjs');

const DIR = path.join(__dirname, '..', 'migrations');
const FIELDS_MD = path.join(__dirname, '..', 'docs', 'FIELDS.md');
const BASELINE_FILES = ['000_baseline.sql', '000_baseline_part2.sql'];
const NATIONAL_DEFAULT = /\bDEFAULT\s+'(IN|INR|India|Asia\/Kolkata|\+91|GST)'/;
const ONCE_ONLY_KEY = /^(client_ref|source_ref|external_id|idempotency_key|provider_msg_id|entry_no|bill_no)$/;
const MONEY_NAME = /(^|_)(amount|price|total|cost|fee|tax|balance|paid|due|rate)(_|$)/;
const BAD_MONEY_TYPE = /^(text|varchar(\(\d+\))?|character varying(\(\d+\))?|real|float\d*|double precision|numeric\(\s*\d+\s*,\s*2\s*\)|decimal\(\s*\d+\s*,\s*2\s*\))$/i;
/** a check that can only pass on production rows: IF NOT FOUND / IF count(…) <> n … THEN RAISE EXCEPTION */
const DATA_ASSERT = /(NOT\s+FOUND|count\s*\([^)]*\)\s*(<>|!=|=|<|>)\s*\d+)[^;]{0,200}?THEN\s+RAISE\s+EXCEPTION/i;
const TABLE_CONSTRAINT = /^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|EXCLUDE|LIKE)\b/i;
const NAME = '(?:"[^"]+"|[A-Za-z_][\\w$]*)(?:\\.(?:"[^"]+"|[A-Za-z_][\\w$]*))?';

/** file text with comments gone and every dollar-quoted body blanked to $$ (the rules read statements, not procedure bodies) */
function stripForStatements(src) {
  const noLine = src.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  return noLine.replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, '$$$$');
}
/** the same, keeping bodies: used only to learn which table NAMES a file creates anywhere */
function stripComments(src) {
  return src.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
}
/** top-level statements: split on ; outside quotes and parentheses */
function splitStatements(text) {
  const out = []; let cur = '', quote = false;
  for (const ch of text) {
    if (ch === "'") quote = !quote;
    if (ch === ';' && !quote) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** the text between the first "(" and its matching ")" and what follows it */
function parenBody(stmt, from) {
  const open = stmt.indexOf('(', from || 0); if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < stmt.length; i++) {
    if (stmt[i] === '(') depth++;
    if (stmt[i] === ')' && --depth === 0) return { inner: stmt.slice(open + 1, i), after: stmt.slice(i + 1), end: i };
  }
  return null;
}
/** split on commas that are not inside parentheses or quotes */
function splitTop(text) {
  const out = []; let depth = 0, cur = '', quote = false;
  for (const ch of text) {
    if (ch === "'") quote = !quote;
    if (!quote) { if (ch === '(') depth++; if (ch === ')') depth--; }
    if (ch === ',' && depth === 0 && !quote) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const unquote = (id) => String(id).replace(/"/g, '').replace(/^public\./, '').toLowerCase();
const colList = (text) => splitTop(text).map((c) => unquote(c.trim().split(/\s+/)[0]));

/** a column definition "name type rest…" → { name, type, rest } */
function parseColumn(def) {
  const m = new RegExp('^(' + NAME + ')\\s+([\\s\\S]+)$').exec(def.trim());
  if (!m) return null;
  const typeEnd = m[2].search(/\s+(NOT\s+NULL|NULL|DEFAULT|PRIMARY|UNIQUE|REFERENCES|CHECK|CONSTRAINT|GENERATED|COLLATE)\b/i);
  const type = (typeEnd < 0 ? m[2] : m[2].slice(0, typeEnd)).trim().replace(/\s+/g, ' ');
  return { name: unquote(m[1]), type: type.toLowerCase(), rest: typeEnd < 0 ? '' : m[2].slice(typeEnd) };
}

class Model {
  constructor() { this.tables = new Map(); this.known = new Set(); }
  table(name) {
    if (!this.tables.has(name)) this.tables.set(name, { cols: new Map(), keys: [], indexes: [], fks: [] });
    return this.tables.get(name);
  }
}

/** one column added to a table, with the keys its inline clauses declare */
function addColumn(model, tableName, col, fileFacts) {
  const t = model.table(tableName); t.cols.set(col.name, col);
  fileFacts.columns.push({ table: tableName, ...col });
  if (/\bPRIMARY\s+KEY\b|\bUNIQUE\b/i.test(col.rest)) t.keys.push([col.name]);
  if (/\bREFERENCES\b/i.test(col.rest)) { t.fks.push([col.name]); fileFacts.fks.push({ table: tableName, cols: [col.name], inline: true }); }
}
/** a table-level constraint: PRIMARY KEY (a,b) · UNIQUE (a,b) · FOREIGN KEY (a) REFERENCES … */
function addConstraint(model, tableName, def, fileFacts) {
  const t = model.table(tableName), cols = parenBody(def);
  if (!cols) return;
  const list = colList(cols.inner);
  if (/\b(PRIMARY\s+KEY|UNIQUE)\b/i.test(def.slice(0, def.indexOf('(')))) t.keys.push(list);
  if (/\bFOREIGN\s+KEY\b/i.test(def.slice(0, def.indexOf('(')))) { t.fks.push(list); fileFacts.fks.push({ table: tableName, cols: list, inline: false }); }
}
function applyCreateTable(model, stmt, facts) {
  const head = new RegExp('^CREATE\\s+(?:(?:GLOBAL\\s+|LOCAL\\s+)?(?:TEMP|TEMPORARY)\\s+|UNLOGGED\\s+)?TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?(' + NAME + ')', 'i').exec(stmt);
  if (!head) return;
  const isTemp = /^CREATE\s+(GLOBAL\s+|LOCAL\s+)?(TEMP|TEMPORARY)\b/i.test(stmt), name = unquote(head[2]);
  model.known.add(name);
  if (isTemp) return;
  facts.created.push({ table: name, ifNotExists: !!head[1] });
  const body = parenBody(stmt, head[0].length); if (!body) return;
  model.table(name);
  for (const item of splitTop(body.inner)) {
    if (TABLE_CONSTRAINT.test(item)) { addConstraint(model, name, item.replace(/^CONSTRAINT\s+\S+\s+/i, ''), facts); continue; }
    const col = parseColumn(item); if (col) addColumn(model, name, col, facts);
  }
  if (head[1] && /\bREFERENCES\b|\bFOREIGN\s+KEY\b/i.test(body.inner)) facts.ifNotExistsFk.push(name);
}
function applyAlterTable(model, stmt, facts) {
  const m = new RegExp('^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(' + NAME + ')\\s+([\\s\\S]*)$', 'i').exec(stmt);
  if (!m) return;
  const name = unquote(m[1]);
  facts.touched.push(name);
  if (/\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(m[2])) facts.rls.enable.add(name);
  if (/\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(m[2])) facts.rls.force.add(name);
  const renamed = /^RENAME\s+TO\s+(\S+)/i.exec(m[2]);
  if (renamed) model.known.add(unquote(renamed[1]));
  if (/\bDROP\s+COLUMN\b/i.test(m[2])) facts.destructive.push('DROP COLUMN ' + name);
  for (const clause of splitTop(m[2])) {
    const add = /^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]+)$/i.exec(clause);
    if (add) { const col = parseColumn(add[1]); if (col) addColumn(model, name, col, facts); continue; }
    const con = /^ADD\s+(?:CONSTRAINT\s+\S+\s+)?((?:PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY)[\s\S]*)$/i.exec(clause);
    if (con) addConstraint(model, name, con[1], facts);
  }
}
/** CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] name ON table [USING m] (cols) [WHERE …] */
function applyCreateIndex(model, stmt, facts) {
  const m = new RegExp('^CREATE\\s+(UNIQUE\\s+)?INDEX\\s+(CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(' + NAME + ')?\\s*ON\\s+(?:ONLY\\s+)?(' + NAME + ')', 'i').exec(stmt);
  if (!m) return;
  const table = unquote(m[4]), body = parenBody(stmt, m[0].length); if (!body) return;
  const parts = splitTop(body.inner), plain = parts.every((p) => /^"?[A-Za-z_]\w*"?(\s+(ASC|DESC|NULLS\s+(FIRST|LAST)|[a-z_]+_ops))*$/i.test(p));
  const cols = plain ? colList(body.inner) : [], partial = /\bWHERE\b/i.test(body.after);
  const idx = { name: unquote(m[3] || ''), cols, partial, unique: !!m[1], expr: !plain };
  facts.touched.push(table);
  facts.indexes.push({ table, ...idx, concurrently: !!m[2], before: model.table(table).indexes.concat(model.table(table).keys.map((k) => ({ cols: k, partial: false, unique: true }))) });
  model.table(table).indexes.push(idx);
  if (idx.unique && !partial && plain) model.table(table).keys.push(cols);
}
function applyOnTarget(stmt, facts) {
  const m = new RegExp('^(?:CREATE\\s+POLICY\\s+\\S+|DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?\\S+)\\s+ON\\s+(' + NAME + ')', 'i').exec(stmt);
  if (!m) return;
  facts.touched.push(unquote(m[1]));
  if (/^CREATE/i.test(stmt)) facts.rls.policy.add(unquote(m[1]));
}
function noteStatement(stmt, facts) {
  if (/^DROP\s+TABLE\b/i.test(stmt) && !/\bTEMP|_tmp|^DROP\s+TABLE\s+(IF\s+EXISTS\s+)?_/i.test(stmt)) facts.destructive.push('DROP TABLE');
  if (/^TRUNCATE\b/i.test(stmt)) facts.destructive.push('TRUNCATE');
  if (/^DELETE\s+FROM\b/i.test(stmt)) facts.destructive.push('DELETE ' + (/^DELETE\s+FROM\s+(\S+)/i.exec(stmt)[1] || ''));
  const v = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?(?:VIEW|FUNCTION|SCHEMA)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/i.exec(stmt);
  if (v) facts.knownExtra.push(unquote(v[1]));
}

const emptyFacts = () => ({ columns: [], created: [], fks: [], indexes: [], touched: [], destructive: [], ifNotExistsFk: [], knownExtra: [],
  rls: { enable: new Set(), force: new Set(), policy: new Set() } });

/** read one file into the running model → the facts it contributes */
function readFile(model, src) {
  const facts = emptyFacts();
  for (const m of stripComments(src).matchAll(new RegExp('CREATE\\s+(?:UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(' + NAME + ')', 'gi'))) model.known.add(unquote(m[1]));
  for (const m of stripComments(src).matchAll(new RegExp('ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?' + NAME + '\\s+RENAME\\s+TO\\s+(' + NAME + ')', 'gi'))) model.known.add(unquote(m[1]));
  for (const stmt of splitStatements(stripForStatements(src))) {
    applyCreateTable(model, stmt, facts); applyAlterTable(model, stmt, facts); applyCreateIndex(model, stmt, facts);
    applyOnTarget(stmt, facts); noteStatement(stmt, facts);
  }
  facts.knownExtra.forEach((n) => model.known.add(n));
  return facts;
}

/** a key or index that leads with exactly these columns (the first n columns equal) */
const leadsWith = (entries, cols) => entries.some((e) => e.cols.length >= cols.length && cols.every((c, i) => e.cols[i] === c));
const allKeys = (t) => t.indexes.concat(t.keys.map((k) => ({ cols: k, partial: false, unique: true })));

/* ── the rules: each takes (facts, model, src, fileName) and returns [{ rule, object }] ── */
const RULES = {
  R1: (f, model) => f.fks.filter((k) => !leadsWith(allKeys(model.table(k.table)), k.cols)).map((k) => ({ object: k.table + '(' + k.cols.join(',') + ')' })),
  R2: (f) => f.created.filter((c) => hasEntityId(f, c.table) && !(f.rls.enable.has(c.table) && f.rls.force.has(c.table) && f.rls.policy.has(c.table))).map((c) => ({ object: c.table })),
  R3: (f, model) => f.created.filter((c) => hasEntityId(f, c.table) && !leadsWith(allKeys(model.table(c.table)), ['entity_id'])).map((c) => ({ object: c.table })),
  R4: (f) => f.columns.filter((c) => /^timestamp(\s+without\s+time\s+zone)?(\(\d\))?(\s+without\s+time\s+zone)?$/.test(c.type)).map((c) => ({ object: c.table + '.' + c.name })),
  R5: (f) => f.columns.filter((c) => MONEY_NAME.test(c.name) && !/_minor$/.test(c.name) && BAD_MONEY_TYPE.test(c.type)).map((c) => ({ object: c.table + '.' + c.name })),
  R6: (f, model, src) => (NATIONAL_DEFAULT.test(stripForStatements(src)) ? [{ object: NATIONAL_DEFAULT.exec(stripForStatements(src))[1] }] : []),
  R7: (f, model) => f.columns.filter((c) => ONCE_ONLY_KEY.test(c.name) && !keyIncludes(model.table(c.table), c.name)).map((c) => ({ object: c.table + '.' + c.name })),
  R8: (f) => f.indexes.filter((i) => !i.partial && !i.unique && !i.expr && i.cols.length && i.before.some((b) => !b.partial && !b.expr && b.cols.length >= i.cols.length && i.cols.every((c, n) => b.cols[n] === c))).map((i) => ({ object: i.table + '(' + i.cols.join(',') + ')' })),
  R9: (f) => f.ifNotExistsFk.map((t) => ({ object: t })),
  R10: (f, model, src) => { const code = stripComments(src), odd = oddDollarTags(code); return odd.length || /\bEND\s+\$\s*;/.test(code) ? [{ object: odd.join(',') || 'END $;' }] : []; },
  R11: (f, model) => f.touched.filter((t) => !model.known.has(t) && !/^(pg_|information_schema|public$)/.test(t) && !/\./.test(t)).map((t) => ({ object: t })),
  R12: (f, model, src) => (!/^--\s*fresh-db:\s*skip\b/m.test(src) && doBlocks(src).some((b) => DATA_ASSERT.test(b)) ? [{ object: 'RAISE EXCEPTION on data' }] : []),
  R13: (f, model, src) => (f.indexes.some((i) => i.concurrently) && /^\s*BEGIN\s*;/im.test(stripComments(src)) ? [{ object: 'CONCURRENTLY inside BEGIN' }] : []),
  R14: (f, model, src, file, fieldsText) => f.columns.filter((c) => /^jsonb?$/.test(c.type) && !new RegExp('\\b' + c.name + '\\b').test(fieldsText)).map((c) => ({ object: c.table + '.' + c.name })),
  R15: (f, model, src) => (f.destructive.length && !/^--\s*DESTRUCTIVE:\s*approved\s+\S+\s+\S+/m.test(src) ? f.destructive.map((d) => ({ object: d })) : []),
  R16: (f, model, src) => (f.created.length && !/^--\s*OWNER:\s*\S+/m.test(src) ? f.created.map((c) => ({ object: c.table })) : []),
  R17: (f, model, src, file) => (/^(000_baseline|migration_b|net0|sim0|purge_|READ-)/.test(file) || /^b\d+[a-z]?_[A-Za-z0-9_]+\.sql$/.test(file) ? [] : [{ object: file }])
};
/** a PRIMARY KEY / UNIQUE constraint or unique index of the table that includes the column */
function keyIncludes(t, col) { return allKeys(t).some((e) => e.unique && e.cols.includes(col)); }
/** the bodies of the DO blocks (a one-off script's own asserts; a function body's RAISE is a runtime guard and stays) */
function doBlocks(src) {
  return [...stripComments(src).matchAll(/\bDO\s+(?:LANGUAGE\s+\w+\s+)?\$([A-Za-z_]\w*)?\$([\s\S]*?)\$\1\$/g)].map((m) => m[2]);
}
function hasEntityId(f, table) { return f.columns.some((c) => c.table === table && c.name === 'entity_id'); }
function oddDollarTags(code) {
  const counts = {}; for (const t of (code.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').match(/\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/g) || [])) counts[t] = (counts[t] || 0) + 1;
  return Object.keys(counts).filter((k) => counts[k] % 2);
}
/** `-- schema-lint: allow R5 R6 reason` header lines → { rules: Set, lines: [...] } */
function allowedRules(src) {
  const rules = new Set(), lines = [];
  for (const m of src.matchAll(/^--\s*schema-lint:\s*allow\s+((?:R\d+[\s,]*)+)(.*)$/gim)) {
    (m[1].match(/R\d+/g) || []).forEach((r) => rules.add(r)); lines.push(m[0].trim());
  }
  return { rules, lines };
}

/** every migration file in judging order: the chain, then what the chain skips (one-off data scripts, net0x, root-era files) */
function orderedFiles() {
  const all = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')), chain = BASELINE_FILES.concat(chainFiles());
  return chain.filter((f) => all.includes(f)).concat(all.filter((f) => !chain.includes(f)).sort());
}
/** known-table seed: tables the non-chain files create exist for every chain file (net0x, sim01 … are run by other paths) */
function seedAmbient(model, files) {
  const chain = new Set(BASELINE_FILES.concat(chainFiles()));
  for (const f of files.filter((x) => !chain.has(x))) readFile(model, fs.readFileSync(path.join(DIR, f), 'utf8'));
}

/** replay → [{ file, rule, object, allowed }] for every file, plus the allow lines seen */
function replay() {
  const files = orderedFiles(), model = new Model(), out = [], allows = [];
  const fieldsText = fs.existsSync(FIELDS_MD) ? fs.readFileSync(FIELDS_MD, 'utf8') : '';
  seedAmbient(model, files);
  const ambientTables = new Set(model.known); model.tables.clear();
  for (const file of files) {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8'), facts = readFile(model, src), allow = allowedRules(src);
    allow.lines.forEach((l) => allows.push(file + ': ' + l));
    for (const rule of Object.keys(RULES)) {
      const seen = new Set();
      for (const hit of RULES[rule](facts, model, src, file, fieldsText)) {
        if (seen.has(hit.object)) continue; seen.add(hit.object);
        out.push({ file, rule, object: hit.object, allowed: allow.rules.has(rule) });
      }
    }
  }
  return { files, violations: out, allows, ambientTables };
}
const keyOf = (v) => v.file + '|' + v.rule + '|' + v.object;

module.exports = { replay, keyOf, allowedRules, RULES, readFile, Model, splitStatements, stripForStatements, orderedFiles };
