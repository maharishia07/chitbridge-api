'use strict';
/**
 * tests/connectors-truth.realstack.cjs — CONNECTORS / MOVE-IN TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §16; CON-8).
 *
 * OWNS      the box-truth cases CN-01..CN-11 written as real-stack kases (CN-05 and CN-06 as recorded `gap:` kases) · the offline builders they use
 *           (csvOf, decisionsOf, unzipStored, sentencesOf), loadable with no server: node -e "require('./tests/connectors-truth.realstack.cjs')"
 * CALLED BY S41 (CI runs each tests/*-truth.realstack.cjs on its own) · by hand: node tests/connectors-truth.realstack.cjs   (one realstack file at a time on :3100)
 * FLOW      three fresh shops (India, Australia, Emirates) → every write through its route (move-in preflight / preview / import, products import preflight,
 *           connector catalogue, kit download, books pack) → the database is only READ (customer_list, catalogue_items, move_in_import)
 * CARD      23-connectors-and-integrations/README · 14-accounting/move-in-from-xero-quickbooks
 *
 * Cases here: CN-01 books from another country refused whole, 0 rows · CN-02 a tax code with no exact match is held, the sentence tells the owner to pick ·
 * CN-03 129 open invoices keep a proof per document, party, tax code (and per account on a chart import), 0 differences · CN-04 no stated country is refused,
 * the statement is recorded · CN-07 IN: contacts and untaxed items land, taxed rows held, bills refused · CN-08 a CSV with bad rows is read before it becomes
 * data, with reasons · CN-09 the connector list per country · CN-10 the kit ships blanks · CN-11 the Tally files come from the one writer, and only for India.
 * KNOWN GAPS (`gap:` kases, a FAIL is a RECORDED finding, never red, never fixed here): CN-05 numbering does not continue theirs (MOVE-IN-GAPS W2.4) ·
 * CN-06 a number over 16 characters is not held for its length in India (W2.4; India bills are refused whole until CON-11) · CN-11b no Australia books pack can be built (reg-au has no pack.export, lib/bookpack.js:61).
 * NOT YET TRUE, LISTED ONLY (no field or route exists to observe, so a kase would assert a made-up shape):
 *   CN-12 a live connector's each sync re-runs the proof and drift raises a flag: lib/move-in-proof.js builds one proof per import; no sync path calls it
 *         and no drift flag exists (CONNECT-BACKLOG CON-10 "re-proof on each live sync"; routes/integrations.js POST /books has no proof step).
 *   CN-13 a source "prices exclude tax" flag copied as-is and shown in the summary: lib/move-in.js KINDS has no price-basis column, so no request can carry it
 *         (MOVE-IN-GAPS W2.5 "price basis", its own round).
 *   CN-02's second half "the owner picks a code": the hold sentence says so, but no route releases a held row with a picked code (W1.2 lists it; no door yet).
 * ⚠️ PM/BOX-TRUTH-TESTS §16 still reads CN-01 "G-2 forces AU at lib/move-in.js:198": stale. The gate is lib/move-in-gate.js (W1.1, landed 18 Oct); CN-01 runs plain.
 * Local only; the database is only read.
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, API, kase, expect, freshShop, finish } = H;
const door = H.j;
const mustOk = H.ok;

const RUN_ID = 'cn' + (Date.now() % 1e8).toString(36); /* a User ID is 8 to 20 characters */
const SOURCE_XERO = 'xero';
const COUNTRY_INDIA = 'IN';
const COUNTRY_AUSTRALIA = 'AU';
const CODE_COUNTRY = 'MOVE_IN_COUNTRY';
const CODE_UNSTATED = 'MOVE_IN_COUNTRY_UNSTATED';
const HOLD_TAX_CODE = 'tax_code';
const STATUS_REFUSED = 422;
const DOCUMENT_COUNT = 129;
const DOCUMENT_PARTIES = 3;
const TAX_KNOWN = 'GST on Income';
const TAX_UNKNOWN = 'ZZ NO SUCH CODE';
const TAX_INDIA_TAXED = 'GST 18%';
const NUMBER_LAST = 'INV-A12';
const NUMBER_NEXT = 'INV-A13';
const NUMBER_TOO_LONG = 'INV-' + '7'.repeat(20);
const CHART_CODES = ['7771', '7772'];
const OPENING_MINOR = 100000;
const TALLY_FILES = ['tally-masters.xml', 'tally-vouchers.xml'];
const GAP_CN05 = 'MOVE-IN-GAPS-REQUIREMENT W2.4 (numbering continues theirs); CONNECT-BACKLOG CON-10: move-in keeps no last number and no series, the counter series is client-side (routes/till.js claimSeries)';
const GAP_CN06 = 'MOVE-IN-GAPS-REQUIREMENT W2.4 (IN number over 16 characters held); CONNECT-BACKLOG CON-11: India bills are refused whole (lib/move-in-gate.js notReady), no length rule exists';
const GAP_CN11B = 'the Australia pack (lib/reg-au.js, engines) carries no pack.export, so lib/bookpack.js:61 refuses to build any Australia books pack (422); lib/books-pack.js:150 not_for_country is never reached';
const SETUP_INDIA = { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: false } };
const SETUP_AUSTRALIA = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: false } };
const SETUP_EMIRATES = { country: 'AE', currency: 'AED', fy_start_month: 1, timezone: 'Asia/Dubai', tax: { registered: false } };

let database = null;

/* ── offline builders: no server needed ── */
const csvCell = (value) => (/[",\n]/.test(String(value)) ? '"' + String(value).replace(/"/g, '""') + '"' : String(value));
/** a CSV text: the header line, then one line per row (each row an array of cells) */
const csvOf = (headers, rows) => [headers].concat(rows).map((cells) => cells.map(csvCell).join(',')).join('\n') + '\n';
/** the confirmed columns a person sends back after a preflight: every guessed column that has a field */
const decisionsOf = (guess) => guess.filter((entry) => entry.field).map((entry) => ({ incoming: entry.incoming, field: entry.field }));
/** every sentence a move-in answer carries: the refusal, the held and skipped rows' reasons */
const sentencesOf = (reply) => [reply.b.message, reply.b.detail, reply.b.error].concat((reply.b.rows || []).map((row) => row.why)).filter(Boolean).join(' | ');
const codeOf = (reply) => reply.b.code || '';
/** the entries of a STORE zip (lib/zip-store.js: no compression) → { name: Buffer } */
function unzipStored(buffer) {
  const files = {};
  let at = 0;
  while (at + 30 <= buffer.length && buffer.readUInt32LE(at) === 0x04034b50) {
    const size = buffer.readUInt32LE(at + 18);
    const nameLength = buffer.readUInt16LE(at + 26);
    const extraLength = buffer.readUInt16LE(at + 28);
    const start = at + 30 + nameLength + extraLength;
    files[buffer.toString('utf8', at + 30, at + 30 + nameLength)] = buffer.subarray(start, start + size);
    at = start + size;
  }
  return files;
}
const contactsCsv = (names) => csvOf(['ContactName', 'EmailAddress'], names.map((name) => [name, '']));
const itemsCsv = (rows) => csvOf(['Code', 'Name', 'SalesUnitPrice', 'SalesTaxRate'], rows);
const billsCsv = (rows) => csvOf(['ContactName', 'InvoiceNumber', 'InvoiceAmountDue', 'DueDate', 'Tax codes'], rows);
/** DOCUMENT_COUNT open invoices spread over the named parties; amount n is (100 + n).50 */
const documentRows = (names, prefix) =>
  Array.from({ length: DOCUMENT_COUNT }, (_, index) => [names[index % names.length], prefix + '-' + (index + 1), String(100 + index) + '.50', '2026-08-15', TAX_KNOWN]);
const documentsTotalMinor = () => Array.from({ length: DOCUMENT_COUNT }, (_, index) => (100 + index) * 100 + 50).reduce((sum, minor) => sum + minor, 0);

/* ── the doors ── */
async function moveBody(shop, kind, csv, extra) {
  const base = { kind, source: SOURCE_XERO, csv };
  const read = mustOk(await door('/api/books/move-in/preflight', { method: 'POST', token: shop.token, body: base }), 'preflight ' + kind).b;
  return Object.assign({ decisions: decisionsOf(read.guess), source_country: COUNTRY_AUSTRALIA }, base, extra);
}
const movePost = (shop, route, body) => door('/api/books/move-in/' + route, { method: 'POST', token: shop.token, body });
const movePreview = async (shop, kind, csv, extra) => movePost(shop, 'preview', await moveBody(shop, kind, csv, extra));
const moveImportRaw = async (shop, kind, csv, extra) => movePost(shop, 'import', Object.assign({ confirm: true }, await moveBody(shop, kind, csv, extra)));
const moveImport = async (shop, kind, csv, extra) => mustOk(await moveImportRaw(shop, kind, csv, extra), 'import ' + kind).b;
const importsOf = async (shop) => mustOk(await door('/api/books/move-in/imports', { token: shop.token }), 'imports').b;

/* ── reads of the database (only SELECT) ── */
async function partiesOf(shop) {
  return (await database.query('SELECT count(*)::int AS n FROM customer_list WHERE owner_entity_id = $1', [shop.entity])).rows[0].n;
}
async function itemNames(shop, prefix) {
  const found = await database.query(`SELECT item_data->>'name' AS name FROM catalogue_items WHERE entity_id = $1 AND item_data->>'name' LIKE $2`, [shop.entity, prefix + '%']);
  return found.rows.map((row) => row.name);
}
async function itemCount(shop) {
  return (await database.query('SELECT count(*)::int AS n FROM catalogue_items WHERE entity_id = $1', [shop.entity])).rows[0].n;
}
const keptProofs = async (shop) => (await database.query('SELECT source_country, country_how FROM move_in_import WHERE entity_id = $1', [shop.entity])).rows;

/** a fresh shop in a country, the ledger on (a precondition, through its own route) */
async function shopIn(tag, label, setup, ledgerOn) {
  const shop = await freshShop(RUN_ID + tag, label);
  if (setup !== SETUP_INDIA) mustOk(await door('/api/governance/country-setup', { method: 'PUT', token: shop.token, body: setup }), label + ' country');
  if (ledgerOn) mustOk(await door('/api/books/enable', { method: 'POST', token: shop.token }), label + ' books on');
  return shop;
}
const kitJson = async (shop, connector) => {
  const reply = await fetch(API + '/api/integrations/download/' + connector, { headers: { authorization: 'Bearer ' + shop.token } });
  expect(reply.status === 200, 'kit download HTTP ' + reply.status);
  const files = unzipStored(Buffer.from(await reply.arrayBuffer()));
  const name = Object.keys(files).find((entry) => /connector\.json$/.test(entry));
  expect(Boolean(name), 'no connector.json in the zip: ' + Object.keys(files).join(', '));
  return JSON.parse(files[name].toString('utf8'));
};
const mayById = async (shop) => {
  const list = mustOk(await door('/api/integrations/catalogue', { token: shop.token }), 'catalogue').b.connectors;
  return Object.fromEntries(list.map((connector) => [connector.id, connector.may]));
};
async function packOf(shop) {
  const made = mustOk(await door('/api/books/packs', { method: 'POST', token: shop.token, body: { kind: 'exit' } }), 'books pack').b;
  return { manifest: made.manifest, names: made.manifest.files.map((file) => file.name) };
}
/** two postable accounts of the shop's chart, and an opening entry between them (a precondition, through the route) */
async function openingEntry(shop) {
  const chart = mustOk(await door('/api/books/accounts', { token: shop.token }), 'chart').b.accounts;
  const postable = chart.filter((account) => !account.is_group && account.role !== 'debtors' && account.role !== 'creditors');
  expect(postable.length >= 2, 'the chart has fewer than two postable accounts');
  const rows = [{ code: postable[0].code, dr_minor: OPENING_MINOR, cr_minor: 0 }, { code: postable[1].code, dr_minor: 0, cr_minor: OPENING_MINOR }];
  mustOk(await door('/api/books/opening', { method: 'POST', token: shop.token, body: { rows, client_ref: RUN_ID + '-open' } }), 'opening entry');
}

/* ── the kases ── */
async function moveInRefusals(india) {
  await kase('CN-01', 'books from Australia into an India shop: the whole file is refused with a sentence and a code, 0 rows written', async () => {
    const before = await partiesOf(india);
    const csv = contactsCsv(['Refused ' + RUN_ID]);
    const preview = await movePreview(india, 'contacts', csv, { source_country: COUNTRY_AUSTRALIA });
    const imported = await moveImportRaw(india, 'contacts', csv, { source_country: COUNTRY_AUSTRALIA });
    expect([preview.status, imported.status].every((status) => status === STATUS_REFUSED), 'HTTP ' + preview.status + ' / ' + imported.status + ' (expected 422 both)');
    expect(codeOf(preview) === CODE_COUNTRY && codeOf(imported) === CODE_COUNTRY, 'codes ' + codeOf(preview) + ' / ' + codeOf(imported));
    expect(/Australia/.test(sentencesOf(imported)) && /Nothing was imported/.test(sentencesOf(imported)), 'sentence: ' + sentencesOf(imported).slice(0, 200));
    expect((await partiesOf(india)) === before, 'a party was written by a refused import');
  });
}

async function holdsOnItems(australia) {
  const known = 'Flat white ' + RUN_ID, unknown = 'Mystery ' + RUN_ID;
  const csv = itemsCsv([['FW-' + RUN_ID, known, '4.50', TAX_KNOWN], ['MY-' + RUN_ID, unknown, '9.00', TAX_UNKNOWN]]);
  const out = await moveImport(australia, 'items', csv, {});
  const held = out.rows.filter((row) => row.code === HOLD_TAX_CODE);
  expect(out.added === 1 && out.held === 1 && held.length === 1, 'added ' + out.added + ' held ' + out.held + ' rows ' + JSON.stringify(out.rows).slice(0, 200));
  expect(/pick one of your own codes/.test(held[0].why), 'the hold does not tell the owner to pick a code: ' + held[0].why);
  expect((await itemNames(australia, 'Flat white ' + RUN_ID)).length === 1, 'the item with the known code did not land');
  expect((await itemNames(australia, 'Mystery ' + RUN_ID)).length === 0, 'the held item was written');
}

async function holdAndProof(australia) {
  await kase('CN-02', 'an item whose tax code has no exact match is HELD with code tax_code and a sentence that tells the owner to pick; the exact one lands', () => holdsOnItems(australia));
  await kase('CN-03', DOCUMENT_COUNT + ' open invoices: a proof per document, per party and per tax code is kept, 0 differences, and it reads back', async () => {
    const names = ['Proof A ' + RUN_ID, 'Proof B ' + RUN_ID, 'Proof C ' + RUN_ID];
    await moveImport(australia, 'contacts', contactsCsv(names), {});
    const out = await moveImport(australia, 'open_bills', billsCsv(documentRows(names, 'P' + RUN_ID)), { side: 'receivable' });
    expect(out.added === DOCUMENT_COUNT && out.held === 0 && out.skipped === 0, 'added ' + out.added + ' held ' + out.held + ' skipped ' + out.skipped);
    const proof = out.proof;
    expect(proof.documents.length === DOCUMENT_COUNT && proof.documents.every((document) => document.bill_ref && document.ours_minor > 0), 'documents ' + proof.documents.length);
    expect(proof.parties.length === DOCUMENT_PARTIES && proof.parties.reduce((sum, party) => sum + party.documents, 0) === DOCUMENT_COUNT, 'parties ' + JSON.stringify(proof.parties).slice(0, 200));
    expect(proof.parties.reduce((sum, party) => sum + party.net_minor, 0) === documentsTotalMinor(), 'the parties do not add up to the documents');
    expect(proof.tax_codes.some((entry) => entry.code === TAX_KNOWN) && proof.differences === 0, 'tax codes ' + JSON.stringify(proof.tax_codes) + ' differences ' + proof.differences);
    const back = (await importsOf(australia)).imports.find((entry) => entry.import_id === out.import_id);
    expect(out.proof_stored === true && back && back.proof.documents.length === DOCUMENT_COUNT, 'the proof did not read back (stored ' + out.proof_stored + ')');
  });
  await kase('CN-03b', 'a chart import keeps a proof per account, each with their code', async () => {
    const csv = csvOf(['Code', 'Name', 'Type'], [[CHART_CODES[0], 'Truth bank ' + RUN_ID, 'BANK'], [CHART_CODES[1], 'Truth expense ' + RUN_ID, 'EXPENSE']]);
    const out = await moveImport(australia, 'accounts', csv, {});
    const theirs = out.proof.accounts.map((account) => account.their_code).sort();
    expect(out.added === 2 && JSON.stringify(theirs) === JSON.stringify(CHART_CODES), 'added ' + out.added + ' proof accounts ' + JSON.stringify(out.proof.accounts).slice(0, 200));
  });
}

async function statedCountry(australia) {
  await kase('CN-04', 'a file with no country stated is refused until stated, and the statement is recorded', async () => {
    const csv = contactsCsv(['Stated ' + RUN_ID]);
    const unstated = await movePreview(australia, 'contacts', csv, { source_country: undefined });
    expect(unstated.status === STATUS_REFUSED && codeOf(unstated) === CODE_UNSTATED, 'HTTP ' + unstated.status + ' code ' + codeOf(unstated));
    const out = await moveImport(australia, 'contacts', csv, { source_country: COUNTRY_AUSTRALIA });
    expect(out.proof.source_country === COUNTRY_AUSTRALIA && out.proof.country_how === 'stated', 'proof says ' + out.proof.source_country + ' / ' + out.proof.country_how);
    const kept = (await keptProofs(australia)).filter((row) => row.source_country === COUNTRY_AUSTRALIA && row.country_how === 'stated');
    expect(kept.length >= 1, 'no move_in_import row records the stated country');
  });
  await kase('CN-05', 'the last source number INV-A12 is kept and the next invoice is INV-A13', async () => {
    const name = 'Numbering ' + RUN_ID;
    await moveImport(australia, 'contacts', contactsCsv([name]), {});
    const out = await moveImport(australia, 'open_bills', billsCsv([[name, NUMBER_LAST, '10.00', '2026-08-15', TAX_KNOWN]]), { side: 'receivable' });
    const everything = JSON.stringify(out) + JSON.stringify(await importsOf(australia));
    expect(everything.indexOf(NUMBER_NEXT) >= 0, 'nothing in the import answer or the proof names the next number ' + NUMBER_NEXT);
  }, GAP_CN05);
}

async function indiaLanes(india) {
  await kase('CN-06', 'an India invoice number over 16 characters is held for its length, never cut', async () => {
    const name = 'Long number ' + RUN_ID;
    await moveImport(india, 'contacts', contactsCsv([name]), { source_country: COUNTRY_INDIA });
    const reply = await movePreview(india, 'open_bills', billsCsv([[name, NUMBER_TOO_LONG, '10.00', '2026-08-15', '']]), { source_country: COUNTRY_INDIA });
    const added = (reply.b.rows || []).filter((row) => row.action === 'add').length;
    expect(added === 0, 'the long number was planned to land');
    expect(/\b16\b/.test(sentencesOf(reply)), 'no sentence names the 16-character rule: ' + sentencesOf(reply).slice(0, 200));
  }, GAP_CN06);
  await kase('CN-07', 'India shop: contacts and an untaxed item land, a taxed item is held, bills are refused', async () => {
    const people = await moveImport(india, 'contacts', contactsCsv(['India one ' + RUN_ID, 'India two ' + RUN_ID]), { source_country: COUNTRY_INDIA });
    expect(people.added === 2, 'contacts added ' + people.added);
    const csv = itemsCsv([['U-' + RUN_ID, 'Untaxed ' + RUN_ID, '10', ''], ['T-' + RUN_ID, 'Taxed ' + RUN_ID, '20', TAX_INDIA_TAXED]]);
    const items = await moveImport(india, 'items', csv, { source_country: COUNTRY_INDIA });
    expect(items.added === 1 && items.held === 1 && items.rows.some((row) => row.code === HOLD_TAX_CODE), 'items added ' + items.added + ' held ' + items.held);
    expect((await itemNames(india, 'Untaxed ' + RUN_ID)).length === 1 && (await itemNames(india, 'Taxed ' + RUN_ID)).length === 0, 'the untaxed item did not land, or the taxed one did');
    const bills = await movePreview(india, 'open_bills', billsCsv([['India one ' + RUN_ID, 'IN-1', '10.00', '2026-08-15', '']]), { source_country: COUNTRY_INDIA });
    expect(bills.status === STATUS_REFUSED && codeOf(bills) === CODE_COUNTRY, 'bills HTTP ' + bills.status + ' code ' + codeOf(bills));
  });
}

async function csvAndCatalogue(india, australia, emirates) {
  await kase('CN-08', 'a CSV with bad rows is read before it becomes data: each bad row has its line and its reason, and nothing is written', async () => {
    const before = await itemCount(india);
    const csv = csvOf(['name', 'price', 'sku'], [['Tea ' + RUN_ID, 'abc', 'S1-' + RUN_ID], ['', '12', 'S2-' + RUN_ID], ['Tea two ' + RUN_ID, '5', 'S1-' + RUN_ID]]);
    const read = mustOk(await door('/api/products/import/preflight', { method: 'POST', token: india.token, body: { csv } }), 'preflight').b;
    const errors = read.report.issues.filter((issue) => issue.severity === 'error');
    expect(read.dry_run === true && read.report.ready === false, 'dry_run ' + read.dry_run + ' ready ' + read.report.ready);
    expect([2, 3].every((line) => errors.some((issue) => issue.row === line && issue.message)), 'errors ' + JSON.stringify(errors).slice(0, 240));
    expect(errors.every((issue) => String(issue.message).length > 0) && (await itemCount(india)) === before, 'a reason is empty or the preflight wrote data');
  });
  await kase('CN-09', 'the connector list is per country: India all, Australia and the Emirates Tally greyed with a code, Till and CSV always', async () => {
    const indian = await mayById(india), australian = await mayById(australia), emirati = await mayById(emirates);
    expect(Object.values(indian).every((may) => may.ok === true), 'India: ' + JSON.stringify(indian).slice(0, 200));
    for (const [country, may] of [[COUNTRY_AUSTRALIA, australian], ['AE', emirati]]) {
      expect(may.tally.ok === false && may.tally.code === 'NOT_FOR_COUNTRY' && Boolean(may.tally.why), country + ' tally ' + JSON.stringify(may.tally));
      expect(may.zoho.code === 'NOT_YET_FOR_COUNTRY' && may.till.ok === true && may.csv.ok === true, country + ' zoho/till/csv ' + JSON.stringify([may.zoho, may.till, may.csv]));
    }
    const refused = await door('/api/integrations/download/tally', { token: australia.token });
    expect(refused.status === 409 && refused.b.code === 'NOT_FOR_COUNTRY', 'AU tally download HTTP ' + refused.status + ' ' + JSON.stringify(refused.b).slice(0, 160));
  });
  await kase('CN-10', 'the downloaded kit ships blanks, not placeholders: the Zoho block is empty strings, no "YOUR ..." text, the key is the shop\'s own', async () => {
    const config = await kitJson(india, 'zoho');
    expect(config.zoho.org === '' && config.zoho.token === '' && config.configured === false, 'zoho block ' + JSON.stringify(config.zoho) + ' configured ' + config.configured);
    expect(!/YOUR /.test(JSON.stringify(config)) && !/^PASTE/.test(config.key), 'a placeholder is in the kit: ' + JSON.stringify(config).slice(0, 200));
  });
}

async function tallyWriter(india, australia) {
  await kase('CN-11', 'the Tally files in the books pack come from the one adapter writer (masters + vouchers) for India', async () => {
    await openingEntry(india);
    const indian = await packOf(india);
    expect(indian.manifest.tally_xml_status === 'adapter', 'India tally_xml_status ' + indian.manifest.tally_xml_status);
    expect(TALLY_FILES.every((file) => indian.names.includes(file)) && !indian.names.includes('tally.xml'), 'India files ' + indian.names.join(', '));
  });
  await kase('CN-11b', 'an Australia books pack is built and says its Tally files are not for the country (no tally-* file)', async () => {
    const australian = await packOf(australia);
    expect(australian.manifest.tally_xml_status === 'not_for_country', 'AU tally_xml_status ' + australian.manifest.tally_xml_status);
    expect(!australian.names.some((file) => /tally/.test(file)), 'AU files ' + australian.names.join(', '));
  }, GAP_CN11B);
}

async function main() {
  console.log('\n── connectors truth on ' + H.API + ' · run ' + RUN_ID + ' ──');
  mustOk(await door('/health'), 'health');
  database = new Client({ connectionString: DB });
  await database.connect();
  try {
    const india = await shopIn('i', 'Connectors India', SETUP_INDIA, true);
    const australia = await shopIn('a', 'Connectors Australia', SETUP_AUSTRALIA, true);
    const emirates = await shopIn('e', 'Connectors Emirates', SETUP_EMIRATES, false);
    await runAll(india, australia, emirates);
  } finally {
    await database.end();
  }
  finish('connectors-truth', process.env.CONNECTORS_TRUTH_JSON, { run: RUN_ID });
}
/** the groups run one after another so the database reads stay in order (CN-11 last: its books need what the others moved in) */
async function runAll(india, australia, emirates) {
  await moveInRefusals(india);
  await holdAndProof(australia);
  await statedCountry(australia);
  await indiaLanes(india);
  await csvAndCatalogue(india, australia, emirates);
  await tallyWriter(india, australia);
}

module.exports = { csvOf, decisionsOf, sentencesOf, unzipStored, documentRows, documentsTotalMinor, contactsCsv, itemsCsv, billsCsv, RUN_ID };

if (require.main === module) {
  main().catch((error) => {
    console.error('connectors truth could not run:', error && error.message);
    process.exit(2);
  });
}
