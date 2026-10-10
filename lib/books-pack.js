// @stage tested
// @stage-note [BOOKS v2] The handover pack: month · year · exit — built by CBBookPack from the shop's rows, each file
// @stage-note hashed, the manifest chained to the previous pack, stored via lib/storage-object (Supabase, no SDK), acknowledged.
'use strict';
const CLOCK = require('./shop-clock');
/**
 * lib/books-pack.js — OFFLOAD AND HAND OVER (SPEC-books-v2 §6, RESEARCH-ledger-offload §5).
 *
 * ⭐ THE PACK IS CBBookPack.build's: SAF-T-shaped JSON, Tally XML, the trial balance (opening · movement · closing),
 *   ledgers, day book, ageing, a code book, and a manifest with every file's SHA-256, the control totals and the
 *   PREVIOUS pack's hash (so a missing or altered month breaks the chain where anyone can see it). This file reads the
 *   rows, hands the engine a hash function (node crypto), zips, stores, and records the row.
 * ⭐ Added here beside the engine's files: the change log (Rule 3) and, for a month, GSTR-1 JSON (lib/tax-lines).
 * ⭐ THE TALLY FILES are the connector adapter's (lib/books-tally.js), not the engine's tally.xml — manifest.tally_xml_status
 *   says 'adapter', or 'unverified' when it had to fall back.
 * ⚠️ NOTHING IS DELETED BECAUSE A PACK EXISTS. Only an ACKNOWLEDGED pack may later let detail older than the retention
 *   window be summarised away — and that purge is NOT built (it waits on Athi and a CA, SPEC-books §9).
 * ⚠️ A pack stays inside one financial year (the engine refuses otherwise). An EXIT pack is this year's, from its first
 *   day to today; earlier years are their own year packs — said in the manifest, never silently absent.
 */
const crypto = require('crypto');
const B = require('./books');
const E = require('./books-engines');
const S = require('./books-store');

const sha = (text) => crypto.createHash('sha256').update(Buffer.isBuffer(text) ? text : Buffer.from(String(text), 'utf8')).digest('hex');
function refuse(why) { const e = new Error(why); e.refused = true; return e; }
function addYears(d, n) { return String(Number(d.slice(0, 4)) + n) + d.slice(4); }

/**
 * build(entity, { kind, fiscal_year, period, by, today }) → { pack_id, sha256, stored, manifest, bytes, zip? }
 * Reads inside one withEntity; stores outside it; records the pack row last (so a row always has its manifest).
 */
async function build(entity, opt) {
  const o = opt || {};
  const kind = ['month', 'year', 'exit'].indexOf(o.kind) >= 0 ? o.kind : null;
  if (!kind) throw refuse('A pack is a month, a year, or an exit.');
  const { withEntity } = require('../db');
  const today = o.today || CLOCK.now().toISOString().slice(0, 10);
  const got = await withEntity(entity, async (h) => {
    const c = await B.ledgerCtx(h, entity); const A = E.packs();
    const fy = kind === 'exit' ? A.fiscalYearOf(today, c.pack) : String(o.fiscal_year || '');
    const range = kind === 'month' ? A.periodRange(fy, Number(o.period), c.pack) : A.fyRange(fy, c.pack);
    if (!range) throw refuse(kind === 'month' ? 'Which month?' : 'Which year?');
    if (kind === 'exit') range.end = today;
    const prev = B.addDays(range.start, -1);
    const linesFrom = A.fiscalYearOf(prev, c.pack) === fy ? B.monthStart(c.pack, prev) : range.start;
    const raw = await S.ledgerLines(h, entity, linesFrom, range.end, null);
    const lines = raw.map(E.lineOf);
    const partyRows = await S.parties(h, entity);
    const parties = partyRows.map((p) => ({ party_id: p.party_id, party_no: p.party_no, name: p.nickname || p.name, legal_name: p.legal_name,
      side: p.supplier && !p.customer ? 'supplier' : 'customer', state_code: p.state_code, tax_ids: p.gstin ? [{ scheme: 'GSTIN', value: p.gstin }] : [] }));
    /* created_at is a MOMENT: its day is the shop's (dayOf), never E.ymd — that reads `date` columns */
    const dayOf = require('./books-hooks').dayOf, country = (c.s && c.s.country) || 'IN';
    const items = (await S.items(h, entity, null, null)).filter((i) => dayOf(i.created_at, country) <= range.end).map(E.itemOf);
    const me = (await h.query(`SELECT display_name, gstn, country FROM identities WHERE identity_id = $1`, [entity])).rows[0] || {};
    const billNos = await S.billNos(h, entity, Array.from(new Set(items.map((i) => String(i.against_ref)))));
    return { c, fy, range, raw, lines, partyRows, parties, items, me, billNos, balances: await B.yearBalances(h, entity, fy, c),
             changes: await S.changes(h, entity, range.start, range.end), last: await S.lastPack(h, entity) };
  });
  const BP = E.bookpack();
  const input = { kind, entity: { id: String(entity), name: got.me.display_name || null, tax_id: got.me.gstn || null, country: got.me.country || null },
    fiscal_year: got.fy, period: kind === 'month' ? Number(o.period) : undefined, from: kind === 'exit' ? got.range.start : undefined, to: kind === 'exit' ? got.range.end : undefined,
    created_at: CLOCK.now().toISOString(), software: { name: 'ChitBridge', version: 'books-v2' }, pack: got.c.pack, parties: got.parties, lines: got.lines,
    balances: got.balances, items: got.items, prev_sha256: got.last ? got.last.sha256 : null };
  const built = BP.build(input, { hash: sha });
  let files = built.files.filter((f) => f.name !== 'manifest.json').map((f) => ({ name: f.name, data: f.content, rows: f.rows }));
  const pending = [];

  /**
   * ⭐ THE TALLY FILES COME FROM THE CONNECTOR'S ADAPTER (critic M7) — the one Tally writer that has met a real TallyPrime —
   * through lib/books-tally.js, and REPLACE the engine's tally.xml. If that cannot be built the engine's file stays and the
   * manifest says 'unverified' with the reason: never a silent swap either way.
   */
  let tally = { status: 'unverified', why: null };
  try {
    const dp = require('./money').decimals(got.c.pack.currency || 'INR');
    const byEntry = new Map();
    got.raw.filter((l) => E.ymd(l.posting_date) >= got.range.start).forEach((l) => {
      let e = byEntry.get(l.entry_id);
      if (!e) { e = { entry_id: l.entry_id, entry_no: l.entry_no, posting_date: E.ymd(l.posting_date), event_type: l.event_type, narration: l.narration, lines: [] }; byEntry.set(l.entry_id, e); }
      e.lines.push({ code: l.code, party_id: l.party_id, dr_minor: Number(l.dr_minor), cr_minor: Number(l.cr_minor) });
    });
    const t = require('./books-tally').build({ entries: Array.from(byEntry.values()), accounts: got.c.chart, parties: got.partyRows, items: got.items,
      bill_nos: got.billNos, company: null, dec: (m) => BP.dec(m, dp) });
    files = files.filter((f) => f.name !== 'tally.xml').concat(t.files);
    tally = t.summary;
  } catch (e) { tally = { status: 'unverified', why: 'The adapter could not build the Tally files (' + String(e && e.message).slice(0, 160) + ') — tally.xml here is the engine\'s own, never imported into TallyPrime.' }; }

  /* ⭐ beside the engine's files: the change log (Rule 3), and GSTR-1 for a month */
  const q = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : (/^[=+\-@]/.test(s) ? "'" + s : s); };
  const log = ['at,by,table_name,row_id,field,old,new'].concat(got.changes.map((r) => [r.at && r.at.toISOString ? r.at.toISOString() : r.at, r.by, r.table_name, r.row_id, r.field, r.old, r.new].map(q).join(','))).join('\r\n') + '\r\n';
  files.push({ name: 'change_log.csv', data: log, rows: got.changes.length });
  if (kind === 'month') {
    try {
      const TC = require('./tax-copy'); const T = require('./tax-lines');
      const led = await TC.ledgerFor(entity, got.range.start.slice(0, 7));
      files.push({ name: 'gstr1.json', data: JSON.stringify(T.gstr1(led.ledger, led.me, led.bounds.period), null, 1) + '\n', rows: 1 });
    } catch (e) { pending.push('gstr1.json could not be built: ' + String(e && e.message).slice(0, 120)); }
  }
  if (kind === 'exit') pending.push('Earlier financial years are in their own year packs (a pack stays inside one year).');
  pending.push('Invoice PDFs are not held as files today.');
  /* ⭐ ONE manifest, sealed once (CBBookPack.seal): every file in the zip is listed with its size and SHA-256, and the
     manifest's own hash covers the list, the control totals, the Tally status and the previous pack's hash. */
  const hashes = {};
  const open = Object.assign({}, built.manifest, { tally_xml_status: tally.status, tally, pending,
    files: files.map((f) => { hashes[f.name] = sha(f.data); return { file: f.name, bytes: Buffer.byteLength(f.data, 'utf8'), rows: f.rows == null ? null : f.rows, sha256: null }; }) });
  const manifest = BP.seal(open, hashes, sha);
  const manifestText = JSON.stringify(manifest, null, 1) + '\n';
  const zip = require('./zip-store').zip(files.concat([{ name: 'manifest.json', data: manifestText }]));
  const hash = manifest.sha256;
  const pack_id = crypto.randomUUID();
  let storage_path = null;
  try {
    const O = require('./storage-object');
    if (await O.available()) { storage_path = String(entity) + '/books/' + pack_id; await O.put(storage_path, zip, 'application/zip'); }
  } catch (e) { storage_path = null; manifest.stored_error = String(e && e.message).slice(0, 200); }
  const fyEnd = (E.packs().fyRange(got.fy, got.c.pack) || {}).end || today;
  const delete_after = addYears(kind === 'exit' ? today : fyEnd, 8);   /* India: 8 years from the year end (per country pack later) */
  const row = await withEntity(entity, (h) => S.insertPack(h, entity, { pack_id, kind, fiscal_year: got.fy, period: kind === 'month' ? Number(o.period) : null,
    by: o.by, sha256: hash, prev_sha256: input.prev_sha256, manifest, storage_path, delete_after }));
  return { pack_id: row.pack_id, sha256: hash, stored: !!storage_path, manifest, bytes: zip.length, zip: storage_path ? null : zip };
}

/** the stored zip, or { stored: false } when it was never stored */
async function download(entity, pack_id) {
  const { withEntity } = require('../db');
  const p = await withEntity(entity, (h) => S.pack(h, entity, pack_id));
  if (!p) return { found: false };
  if (!p.storage_path) return { found: true, stored: false, pack: p };
  const bytes = await require('./storage-object').get(p.storage_path);
  return { found: true, stored: true, pack: p, bytes };
}

module.exports = { build, download, sha };
