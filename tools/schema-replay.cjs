/**
 * tools/schema-replay.cjs — READS migrations/ IN CHAIN ORDER AND JUDGES EACH FILE AGAINST THE SCHEMA RULES R1–R17 (SCHEMA-FIX1, 16 Oct).
 * CARD 28-platform-and-operations/schema-lint
 *
 * OWNS       the offline replay (no database): comment and dollar-quote stripping, statement splitting, a running model of tables ·
 *            columns · keys · indexes, and the rule checks of SCHEMA-ASSESSMENT-2026-10-16 "The GUARD".
 * CALLED BY  tests/schema-lint.test.cjs (the gate, registered in scripts/guards.cjs). One copy: a schema inventory may call it too.
 * CHAIN      the order and the skip rules are tools/migrate.cjs's (chainFiles) — never a third list.
 * LIMITS     it reads top-level statements. A DO block or EXECUTE format(...) is opaque to the rules (R11 still sees a table NAMED in one),
 *            so a file that builds indexes in a loop says so with `-- schema-lint: allow R1 <reason>`. R14 judges new jsonb COLUMNS only.
 * FLOW       chain order → per file: strip → split → fold into the model → judge R1–R17 → { file, rule, object, allowed }[]
 */
'use strict';
const fs = require('fs'),
  path = require('path');
const { chainFiles } = require('./migrate.cjs');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const FIELDS_DICTIONARY = path.join(__dirname, '..', 'docs', 'FIELDS.md');
const BASELINE_FILES = ['000_baseline.sql', '000_baseline_part2.sql'];
const NATIONAL_DEFAULT = /\bDEFAULT\s+'(IN|INR|India|Asia\/Kolkata|\+91|GST)'/;
const ONCE_ONLY_KEY = /^(client_ref|source_ref|external_id|idempotency_key|provider_msg_id|entry_no|bill_no)$/;
const MONEY_NAME = /(^|_)(amount|price|total|cost|fee|tax|balance|paid|due|rate)(_|$)/;
const BAD_MONEY_TYPE =
  /^(text|varchar(\(\d+\))?|character varying(\(\d+\))?|real|float\d*|double precision|numeric\(\s*\d+\s*,\s*2\s*\)|decimal\(\s*\d+\s*,\s*2\s*\))$/i;
const TIMESTAMP_WITHOUT_ZONE = /^timestamp(\s+without\s+time\s+zone)?(\(\d\))?(\s+without\s+time\s+zone)?$/;
/** a check that can only pass on production rows: IF NOT FOUND / IF count(…) <> n … THEN RAISE EXCEPTION */
const DATA_ASSERT = /(NOT\s+FOUND|count\s*\([^)]*\)\s*(<>|!=|=|<|>)\s*\d+)[^;]{0,200}?THEN\s+RAISE\s+EXCEPTION/i;
const TABLE_CONSTRAINT = /^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|EXCLUDE|LIKE)\b/i;
const NAME = '(?:"[^"]+"|[A-Za-z_][\\w$]*)(?:\\.(?:"[^"]+"|[A-Za-z_][\\w$]*))?';
const PLAIN_INDEX_COLUMN = /^"?[A-Za-z_]\w*"?(\s+(ASC|DESC|NULLS\s+(FIRST|LAST)|[a-z_]+_ops))*$/i;

/* ── reading text ─────────────────────────────────────────────────────────────────────────────────────────── */

/** the source with comments removed, dollar-quoted bodies kept */
function stripComments(source) {
  const noLineComments = source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  return noLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
}
/** the source with comments gone and every dollar-quoted body blanked to $$ (the rules read statements, not procedure bodies) */
function stripForStatements(source) {
  return stripComments(source).replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, '$$$$');
}
/** top-level statements: split on ; outside quotes */
function splitStatements(text) {
  const statements = [];
  let current = '',
    inQuote = false;
  for (const char of text) {
    if (char === "'") inQuote = !inQuote;
    if (char === ';' && !inQuote) {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}
/** the text between the first "(" at/after `from` and its matching ")", and what follows it */
function parenBody(statement, from) {
  const open = statement.indexOf('(', from || 0);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < statement.length; i++) {
    if (statement[i] === '(') depth++;
    if (statement[i] === ')' && --depth === 0) return { inner: statement.slice(open + 1, i), after: statement.slice(i + 1) };
  }
  return null;
}
const DEPTH_CHANGE = { '(': 1, ')': -1 };
/** split on commas that are not inside parentheses or quotes */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0,
    current = '',
    inQuote = false;
  for (const char of text) {
    if (char === "'") inQuote = !inQuote;
    if (!inQuote) depth += DEPTH_CHANGE[char] || 0;
    const isSeparator = char === ',' && depth === 0 && !inQuote;
    if (isSeparator) {
      parts.push(current.trim());
      current = '';
    } else current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
const unquote = (identifier) =>
  String(identifier)
    .replace(/"/g, '')
    .replace(/^public\./, '')
    .toLowerCase();
const columnNames = (text) => splitTopLevel(text).map((part) => unquote(part.trim().split(/\s+/)[0]));

/** a column definition "name type rest…" → { name, type, rest } */
function parseColumn(definition) {
  const match = new RegExp('^(' + NAME + ')\\s+([\\s\\S]+)$').exec(definition.trim());
  if (!match) return null;
  const typeEnd = match[2].search(/\s+(NOT\s+NULL|NULL|DEFAULT|PRIMARY|UNIQUE|REFERENCES|CHECK|CONSTRAINT|GENERATED|COLLATE)\b/i);
  const type = (typeEnd < 0 ? match[2] : match[2].slice(0, typeEnd)).trim().replace(/\s+/g, ' ');
  return { name: unquote(match[1]), type: type.toLowerCase(), rest: typeEnd < 0 ? '' : match[2].slice(typeEnd) };
}

/* ── the running model: what the chain has made so far ─────────────────────────────────────────────────────── */

class Model {
  constructor() {
    this.tables = new Map();
    this.known = new Set();
  }
  /** the model of one table, made on first ask */
  table(name) {
    if (!this.tables.has(name)) this.tables.set(name, { columns: new Map(), keys: [], indexes: [] });
    return this.tables.get(name);
  }
}
/** every key and index of a table as { columns, partial, unique } */
const keysAndIndexes = (table) => table.indexes.concat(table.keys.map((key) => ({ columns: key, partial: false, unique: true })));
/** an entry whose first n columns are exactly these */
const leadsWith = (entries, columns) =>
  entries.some((entry) => entry.columns.length >= columns.length && columns.every((name, position) => entry.columns[position] === name));
/** a PRIMARY KEY / UNIQUE constraint or unique index of the table that includes the column */
const uniqueIncludes = (table, column) => keysAndIndexes(table).some((entry) => entry.unique && entry.columns.includes(column));

const emptyFacts = () => ({
  columns: [],
  created: [],
  foreignKeys: [],
  indexes: [],
  touched: [],
  destructive: [],
  ifNotExistsWithKey: [],
  knownExtra: [],
  rls: { enable: new Set(), force: new Set(), policy: new Set() }
});

/** add one column, with the keys its inline clauses declare */
function addColumn(model, tableName, column, facts) {
  const table = model.table(tableName);
  table.columns.set(column.name, column);
  facts.columns.push({ table: tableName, ...column });
  if (/\bPRIMARY\s+KEY\b|\bUNIQUE\b/i.test(column.rest)) table.keys.push([column.name]);
  if (/\bREFERENCES\b/i.test(column.rest)) facts.foreignKeys.push({ table: tableName, columns: [column.name] });
}
/** a table-level constraint: PRIMARY KEY (a,b) · UNIQUE (a,b) · FOREIGN KEY (a) REFERENCES … */
function addConstraint(model, tableName, definition, facts) {
  const listed = parenBody(definition);
  if (!listed) return;
  const kind = definition.slice(0, definition.indexOf('(')),
    columns = columnNames(listed.inner);
  if (/\b(PRIMARY\s+KEY|UNIQUE)\b/i.test(kind)) model.table(tableName).keys.push(columns);
  if (/\bFOREIGN\s+KEY\b/i.test(kind)) facts.foreignKeys.push({ table: tableName, columns });
}
/** CREATE TABLE → the table's columns, keys and foreign keys; a TEMP table is only remembered as a name */
function applyCreateTable(model, statement, facts) {
  const head = new RegExp(
    '^CREATE\\s+(?:(?:GLOBAL\\s+|LOCAL\\s+)?(?:TEMP|TEMPORARY)\\s+|UNLOGGED\\s+)?TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?(' + NAME + ')',
    'i'
  ).exec(statement);
  if (!head) return;
  const name = unquote(head[2]);
  model.known.add(name);
  if (/^CREATE\s+(GLOBAL\s+|LOCAL\s+)?(TEMP|TEMPORARY)\b/i.test(statement)) return;
  facts.created.push({ table: name });
  const body = parenBody(statement, head[0].length);
  if (!body) return;
  foldTableItems(model, name, body.inner, facts);
  if (head[1] && /\bREFERENCES\b|\bFOREIGN\s+KEY\b/i.test(body.inner)) facts.ifNotExistsWithKey.push(name);
}
/** the items between the parentheses of CREATE TABLE: table constraints, and columns with their inline keys */
function foldTableItems(model, tableName, innerText, facts) {
  model.table(tableName);
  for (const item of splitTopLevel(innerText)) {
    if (TABLE_CONSTRAINT.test(item)) {
      addConstraint(model, tableName, item.replace(/^CONSTRAINT\s+\S+\s+/i, ''), facts);
      continue;
    }
    const column = parseColumn(item);
    if (column) addColumn(model, tableName, column, facts);
  }
}
/** one clause of an ALTER TABLE: ADD COLUMN, or ADD CONSTRAINT PRIMARY KEY / UNIQUE / FOREIGN KEY */
function applyAlterClause(model, tableName, clause, facts) {
  const addColumnMatch = /^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]+)$/i.exec(clause);
  if (addColumnMatch) {
    const column = parseColumn(addColumnMatch[1]);
    if (column) addColumn(model, tableName, column, facts);
    return;
  }
  const addKey = /^ADD\s+(?:CONSTRAINT\s+\S+\s+)?((?:PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY)[\s\S]*)$/i.exec(clause);
  if (addKey) addConstraint(model, tableName, addKey[1], facts);
}
/** ALTER TABLE → the touched table, RLS switches, dropped columns, and each ADD clause */
function applyAlterTable(model, statement, facts) {
  const match = new RegExp('^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(' + NAME + ')\\s+([\\s\\S]*)$', 'i').exec(statement);
  if (!match) return;
  const name = unquote(match[1]),
    action = match[2];
  facts.touched.push(name);
  if (/\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(action)) facts.rls.enable.add(name);
  if (/\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(action)) facts.rls.force.add(name);
  if (/\bDROP\s+COLUMN\b/i.test(action)) facts.destructive.push('DROP COLUMN ' + name);
  splitTopLevel(action).forEach((clause) => applyAlterClause(model, name, clause, facts));
}
/** CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] name ON table [USING m] (cols) [WHERE …] */
function applyCreateIndex(model, statement, facts) {
  const head = new RegExp(
    '^CREATE\\s+(UNIQUE\\s+)?INDEX\\s+(CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(' + NAME + ')?\\s*ON\\s+(?:ONLY\\s+)?(' + NAME + ')',
    'i'
  ).exec(statement);
  if (!head) return;
  const tableName = unquote(head[4]),
    body = parenBody(statement, head[0].length);
  if (!body) return;
  const isPlain = splitTopLevel(body.inner).every((part) => PLAIN_INDEX_COLUMN.test(part));
  const index = {
    name: unquote(head[3] || ''),
    columns: isPlain ? columnNames(body.inner) : [],
    partial: /\bWHERE\b/i.test(body.after),
    unique: !!head[1],
    hasExpression: !isPlain
  };
  const table = model.table(tableName);
  facts.touched.push(tableName);
  facts.indexes.push({ table: tableName, ...index, concurrently: !!head[2], earlier: keysAndIndexes(table).slice() });
  table.indexes.push(index);
  if (index.unique && !index.partial && isPlain) table.keys.push(index.columns);
}
function applyPolicy(statement, facts) {
  const match = new RegExp('^(?:CREATE\\s+POLICY\\s+\\S+|DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?\\S+)\\s+ON\\s+(' + NAME + ')', 'i').exec(statement);
  if (!match) return;
  facts.touched.push(unquote(match[1]));
  if (/^CREATE/i.test(statement)) facts.rls.policy.add(unquote(match[1]));
}
/** destructive statements, and the views / functions / schemas a file makes (they are "known" names for R11) */
function noteStatement(statement, facts) {
  if (/^DROP\s+TABLE\b/i.test(statement) && !/\bTEMP|_tmp|^DROP\s+TABLE\s+(IF\s+EXISTS\s+)?_/i.test(statement)) facts.destructive.push('DROP TABLE');
  if (/^TRUNCATE\b/i.test(statement)) facts.destructive.push('TRUNCATE');
  if (/^DELETE\s+FROM\b/i.test(statement)) facts.destructive.push('DELETE ' + (/^DELETE\s+FROM\s+(\S+)/i.exec(statement)[1] || ''));
  const made = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?(?:VIEW|FUNCTION|SCHEMA)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/i.exec(statement);
  if (made) facts.knownExtra.push(unquote(made[1]));
}
/** table names a file creates or renames ANYWHERE in its text (a DO block too): they are "known" from then on */
function learnNames(model, source) {
  const text = stripComments(source);
  const created = new RegExp('CREATE\\s+(?:UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(' + NAME + ')', 'gi');
  const renamed = new RegExp('ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?' + NAME + '\\s+RENAME\\s+TO\\s+(' + NAME + ')', 'gi');
  for (const pattern of [created, renamed]) for (const match of text.matchAll(pattern)) model.known.add(unquote(match[1]));
}
/** read one file into the running model → the facts it contributes */
function readFile(model, source) {
  const facts = emptyFacts();
  learnNames(model, source);
  for (const statement of splitStatements(stripForStatements(source))) {
    applyCreateTable(model, statement, facts);
    applyAlterTable(model, statement, facts);
    applyCreateIndex(model, statement, facts);
    applyPolicy(statement, facts);
    noteStatement(statement, facts);
  }
  facts.knownExtra.forEach((name) => model.known.add(name));
  return facts;
}

/* ── the rules ────────────────────────────────────────────────────────────────────────────────────────────── */

const hasEntityId = (facts, tableName) => facts.columns.some((column) => column.table === tableName && column.name === 'entity_id');
const isClosedByRls = (facts, tableName) => facts.rls.enable.has(tableName) && facts.rls.force.has(tableName) && facts.rls.policy.has(tableName);
const label = (tableName, columns) => tableName + '(' + columns.join(',') + ')';
/** the bodies of the DO blocks (a one-off script's own asserts; a function body's RAISE is a runtime guard and stays) */
function doBlocks(source) {
  return [...stripComments(source).matchAll(/\bDO\s+(?:LANGUAGE\s+\w+\s+)?\$([A-Za-z_]\w*)?\$([\s\S]*?)\$\1\$/g)].map((match) => match[2]);
}
/** dollar-quote delimiters that do not pair up */
function unpairedDollarTags(source) {
  const counts = {};
  for (const tag of stripComments(source).match(/\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/g) || []) counts[tag] = (counts[tag] || 0) + 1;
  return Object.keys(counts).filter((tag) => counts[tag] % 2);
}
/** what is wrong with the file's dollar quoting: the delimiters that do not pair, or the b185 shape `END $;` */
function unterminatedBlocks(source) {
  const unpaired = unpairedDollarTags(source);
  if (unpaired.length) return [unpaired.join(',')];
  return /\bEND\s+\$\s*;/.test(stripComments(source)) ? ['END $;'] : [];
}
const objects = (names) => names.map((object) => ({ object }));
const header = (source, pattern) => pattern.test(source);

/** each rule: (facts, model, ctx = { source, fileName, fieldsText }) → [{ object }] */
const RULES = {
  R1: (facts, model) =>
    objects(facts.foreignKeys.filter((key) => !leadsWith(keysAndIndexes(model.table(key.table)), key.columns)).map((key) => label(key.table, key.columns))),
  R2: (facts) => objects(facts.created.filter((made) => hasEntityId(facts, made.table) && !isClosedByRls(facts, made.table)).map((made) => made.table)),
  R3: (facts, model) =>
    objects(
      facts.created
        .filter((made) => hasEntityId(facts, made.table) && !leadsWith(keysAndIndexes(model.table(made.table)), ['entity_id']))
        .map((made) => made.table)
    ),
  R4: (facts) => objects(facts.columns.filter((column) => TIMESTAMP_WITHOUT_ZONE.test(column.type)).map((column) => column.table + '.' + column.name)),
  R5: (facts) =>
    objects(
      facts.columns
        .filter((column) => MONEY_NAME.test(column.name) && !/_minor$/.test(column.name) && BAD_MONEY_TYPE.test(column.type))
        .map((column) => column.table + '.' + column.name)
    ),
  R6: (facts, model, ctx) => {
    const found = NATIONAL_DEFAULT.exec(stripForStatements(ctx.source));
    return found ? objects([found[1]]) : [];
  },
  R7: (facts, model) =>
    objects(
      facts.columns
        .filter((column) => ONCE_ONLY_KEY.test(column.name) && !uniqueIncludes(model.table(column.table), column.name))
        .map((column) => column.table + '.' + column.name)
    ),
  R8: (facts) => objects(facts.indexes.filter(repeatsAnEarlierIndex).map((index) => label(index.table, index.columns))),
  R9: (facts) => objects(facts.ifNotExistsWithKey),
  R10: (facts, model, ctx) => objects(unterminatedBlocks(ctx.source)),
  R11: (facts, model) => objects(facts.touched.filter((name) => !model.known.has(name) && !/^(pg_|information_schema)/.test(name) && !name.includes('.'))),
  R12: (facts, model, ctx) =>
    !header(ctx.source, /^--\s*fresh-db:\s*skip\b/m) && doBlocks(ctx.source).some((body) => DATA_ASSERT.test(body)) ? objects(['RAISE EXCEPTION on data']) : [],
  R13: (facts, model, ctx) =>
    facts.indexes.some((index) => index.concurrently) && /^\s*BEGIN\s*;/im.test(stripComments(ctx.source)) ? objects(['CONCURRENTLY inside BEGIN']) : [],
  R14: (facts, model, ctx) =>
    objects(
      facts.columns
        .filter((column) => /^jsonb?$/.test(column.type) && !new RegExp('\\b' + column.name + '\\b').test(ctx.fieldsText))
        .map((column) => column.table + '.' + column.name)
    ),
  R15: (facts, model, ctx) => (facts.destructive.length && !header(ctx.source, /^--\s*DESTRUCTIVE:\s*approved\s+\S+\s+\S+/m) ? objects(facts.destructive) : []),
  R16: (facts, model, ctx) => (facts.created.length && !header(ctx.source, /^--\s*OWNER:\s*\S+/m) ? objects(facts.created.map((made) => made.table)) : []),
  R17: (facts, model, ctx) =>
    /^(000_baseline|migration_b|net0|sim0|purge_|READ-)/.test(ctx.fileName) || /^b\d+[a-z]?_[A-Za-z0-9_]+\.sql$/.test(ctx.fileName)
      ? []
      : objects([ctx.fileName])
};
/** a plain, non-unique, full index that is the same as, or a leading part of, one the table already had */
function repeatsAnEarlierIndex(index) {
  if (index.partial || index.unique || index.hasExpression || !index.columns.length) return false;
  return index.earlier.some(
    (other) =>
      !other.partial &&
      !other.hasExpression &&
      other.columns.length >= index.columns.length &&
      index.columns.every((name, position) => other.columns[position] === name)
  );
}

/** `-- schema-lint: allow R5 R6 reason` header lines → { rules: Set, lines: [...] } */
function allowedRules(source) {
  const rules = new Set(),
    lines = [];
  for (const match of source.matchAll(/^--\s*schema-lint:\s*allow\s+((?:R\d+[\s,]*)+)(.*)$/gim)) {
    (match[1].match(/R\d+/g) || []).forEach((rule) => rules.add(rule));
    lines.push(match[0].trim());
  }
  return { rules, lines };
}

/* ── the replay ───────────────────────────────────────────────────────────────────────────────────────────── */

/** every migration file in judging order: the chain, then what the chain skips (one-off data scripts, net0x, root-era files) */
function orderedFiles() {
  const everything = fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')),
    chain = BASELINE_FILES.concat(chainFiles());
  return chain.filter((file) => everything.includes(file)).concat(everything.filter((file) => !chain.includes(file)).sort());
}
/** tables the non-chain files create exist for every chain file (net0x, sim01 … are run by other paths): learn their names first */
function seedAmbientNames(model, files) {
  const chain = new Set(BASELINE_FILES.concat(chainFiles()));
  for (const file of files.filter((name) => !chain.has(name))) learnNames(model, fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
}
/** the violations of one file, each once, marked allowed when the header excuses its rule */
function judgeFile(file, facts, model, context) {
  const allow = allowedRules(context.source),
    found = [];
  for (const rule of Object.keys(RULES)) {
    const seen = new Set();
    for (const hit of RULES[rule](facts, model, context)) {
      if (!seen.has(hit.object)) {
        seen.add(hit.object);
        found.push({ file, rule, object: hit.object, allowed: allow.rules.has(rule) });
      }
    }
  }
  return { found, allowLines: allow.lines.map((line) => file + ': ' + line) };
}
/** replay → { files, violations: [{ file, rule, object, allowed }], allows } */
function replay() {
  const files = orderedFiles(),
    model = new Model(),
    violations = [],
    allows = [];
  const fieldsText = fs.existsSync(FIELDS_DICTIONARY) ? fs.readFileSync(FIELDS_DICTIONARY, 'utf8') : '';
  seedAmbientNames(model, files);
  for (const file of files) {
    const source = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const judged = judgeFile(file, readFile(model, source), model, { source, fileName: file, fieldsText });
    violations.push(...judged.found);
    allows.push(...judged.allowLines);
  }
  return { files, violations, allows };
}
const keyOf = (violation) => violation.file + '|' + violation.rule + '|' + violation.object;

module.exports = { replay, keyOf, allowedRules, RULES, readFile, Model };
