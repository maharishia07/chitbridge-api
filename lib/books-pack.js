// @stage tested
// OWNS  the sealed books pack: its manifest (retention per country pack), its files, the Tally export beside it.
// CALLED BY routes/books.js (GET · POST /pack), lib/books-tally.
// FLOW  build(fy | exit) → entries · balances read → manifest (retention) → files → the sealed hash
// CARD 16-finance/books-pack
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

const sha = (text) =>
  crypto
    .createHash('sha256')
    .update(Buffer.isBuffer(text) ? text : Buffer.from(String(text), 'utf8'))
    .digest('hex');
function refuse(why) {
  const e = new Error(why);
  e.refused = true;
  return e;
}
function addYears(d, n) {
  return String(Number(d.slice(0, 4)) + n) + d.slice(4);
}
/**
 * W2-BOOKS (2026-10-15): how long this pack may be kept before the law lets it go — the COUNTRY PACK's number (engines v1.48.0: IN 8 financial years,
 * Companies Act s.128(5) · AU 5 · AE 5), counted from the year end (an exit pack: from today). A pack that states no number dates nothing and says so —
 * never another country's figure. The platform's own records floor (policy.RECORDS_FLOOR_YEARS, CO3) sits beside it: nothing is retired inside it.
 */
function retentionOf(pack, from) {
  const years = typeof pack.retentionYears === 'number' && pack.retentionYears > 0 ? pack.retentionYears : null;
  const cite = (pack.records && pack.records.cite) || null,
    floor_years = require('./policy').RECORDS_FLOOR_YEARS;
  if (!years) {
    require('./logger').warn('books-pack: the ' + pack.id + ' pack states no retentionYears — the pack is kept with no delete_after');
    return {
      years: null,
      from,
      delete_after: null,
      cite,
      floor_years,
      why: 'The ' + pack.id + ' pack states no retention period: kept until the owner decides.'
    };
  }
  return { years, from, delete_after: addYears(from, years), cite, floor_years, why: null };
}

/**
 * build(entity, { kind, fiscal_year, period, by, today }) → { pack_id, sha256, stored, manifest, bytes, zip? }
 * Reads inside one withEntity; stores outside it; records the pack row last (so a row always has its manifest).
 */
async function build(entity, opt) {
  const o = opt || {};
  const kind = ['month', 'year', 'exit'].indexOf(o.kind) >= 0 ? o.kind : null;
  if (!kind) throw refuse('A pack is a month, a year, or an exit.');
  const { withEntity } = require('../db');
  const today = o.today || CLOCK.today(); /* T2-NATDEF: the one day reader — no shop zone here yet, so UTC as before */
  const got = await withEntity(entity, async (h) => {
    const c = await B.ledgerCtx(h, entity);
    const A = E.packs();
    const fy = kind === 'exit' ? A.fiscalYearOf(today, c.pack) : String(o.fiscal_year || '');
    const range = kind === 'month' ? A.periodRange(fy, Number(o.period), c.pack) : A.fyRange(fy, c.pack);
    if (!range) throw refuse(kind === 'month' ? 'Which month?' : 'Which year?');
    if (kind === 'exit') range.end = today;
    const prev = B.addDays(range.start, -1);
    const linesFrom = A.fiscalYearOf(prev, c.pack) === fy ? B.monthStart(c.pack, prev) : range.start;
    const list = await S.ledgerLines(h, entity, linesFrom, range.end, null);
    const lines = list.map(E.lineOf);
    const partyRows = await S.parties(h, entity);
    const parties = partyRows.map((item) => ({
      party_id: item.party_id,
      party_no: item.party_no,
      name: item.nickname || item.name,
      legal_name: item.legal_name,
      side: item.supplier && !item.customer ? 'supplier' : 'customer',
      state_code: item.state_code,
      tax_ids: item.gstin ? [{ scheme: 'GSTIN', value: item.gstin }] : []
    }));
    /* created_at is a MOMENT: its day is the shop's (dayOf), never E.ymd — that reads `date` columns */
    const dayOf = require('./books-hooks').dayOf,
      zone = c.s || null; /* the shop's zone (M210) */
    const items = (await S.items(h, entity, null, null)).filter((item) => dayOf(item.created_at, zone) <= range.end).map(E.itemOf);
    const me = (await h.query(`SELECT display_name, gstn, country FROM identities WHERE identity_id = $1`, [entity])).rows[0] || {};
    const billNos = await S.billNos(h, entity, Array.from(new Set(items.map((item) => String(item.against_ref)))));
    return {
      c,
      fy,
      range,
      raw: list,
      lines,
      partyRows,
      parties,
      items,
      me,
      billNos,
      balances: await B.yearBalances(h, entity, fy, c),
      changes: await S.changes(h, entity, range.start, range.end),
      last: await S.lastPack(h, entity)
    };
  });
  const BP = E.bookpack();
  const input = {
    kind,
    entity: { id: String(entity), name: got.me.display_name || null, tax_id: got.me.gstn || null, country: got.me.country || null },
    fiscal_year: got.fy,
    period: kind === 'month' ? Number(o.period) : undefined,
    from: kind === 'exit' ? got.range.start : undefined,
    to: kind === 'exit' ? got.range.end : undefined,
    created_at: CLOCK.now().toISOString(),
    software: { name: 'ChitBridge', version: 'books-v2' },
    pack: got.c.pack,
    parties: got.parties,
    lines: got.lines,
    balances: got.balances,
    items: got.items,
    prev_sha256: got.last ? got.last.sha256 : null
  };
  const built = BP.build(input, { hash: sha });
  let files = built.files.filter((item) => item.name !== 'manifest.json').map((item) => ({ name: item.name, data: item.content, rows: item.rows }));
  const pending = [];

  /**
   * ⭐ THE TALLY FILES COME FROM THE CONNECTOR'S ADAPTER (critic M7) — the one Tally writer that has met a real TallyPrime —
   * through lib/books-tally.js, and REPLACE the engine's tally.xml. If that cannot be built the engine's file stays and the
   * manifest says 'unverified' with the reason: never a silent swap either way.
   */
  /* ⭐ CX0: Tally XML and GSTR-1 are India's own (reg-in `export` · gst-returns) — another country's pack gets neither, and the manifest SAYS so.
     (accounts-packs v1.20 answers India's chart with `fallback: true` for a country it has no pack for — that is not India either.) */
  const india = !got.c.pack.fallback && String(got.c.pack.id || got.c.pack.country || '').toUpperCase() === 'IN';
  let tally = { status: 'unverified', why: null };
  if (!india) {
    tally = { status: 'not_for_country', why: "Tally files are India's — not built for this country." };
    files = files.filter((item) => item.name !== 'tally.xml');
  } else
    try {
      const dp = require('./money').decimals(got.c.pack.currency);
      const byEntry = new Map();
      got.raw
        .filter((item) => E.ymd(item.posting_date) >= got.range.start)
        .forEach((item) => {
          let e = byEntry.get(item.entry_id);
          if (!e) {
            e = {
              entry_id: item.entry_id,
              entry_no: item.entry_no,
              posting_date: E.ymd(item.posting_date),
              event_type: item.event_type,
              narration: item.narration,
              lines: []
            };
            byEntry.set(item.entry_id, e);
          }
          e.lines.push({ code: item.code, party_id: item.party_id, dr_minor: Number(item.dr_minor), cr_minor: Number(item.cr_minor) });
        });
      const t = require('./books-tally').build({
        entries: Array.from(byEntry.values()),
        accounts: got.c.chart,
        parties: got.partyRows,
        items: got.items,
        bill_nos: got.billNos,
        company: null,
        dec: (m) => BP.dec(m, dp)
      });
      files = files.filter((item) => item.name !== 'tally.xml').concat(t.files);
      tally = t.summary;
    } catch (e) {
      tally = {
        status: 'unverified',
        why:
          'The adapter could not build the Tally files (' +
          String(e && e.message).slice(0, 160) +
          ") — tally.xml here is the engine's own, never imported into TallyPrime."
      };
    }

  /* ⭐ beside the engine's files: the change log (Rule 3), and GSTR-1 for a month */
  const q = (v) => {
    const text = v == null ? '' : String(v);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : /^[=+\-@]/.test(text) ? "'" + text : text;
  };
  const log =
    ['at,by,table_name,row_id,field,old,new']
      .concat(
        got.changes.map((item) =>
          [item.at && item.at.toISOString ? item.at.toISOString() : item.at, item.by, item.table_name, item.row_id, item.field, item.old, item.new]
            .map(q)
            .join(',')
        )
      )
      .join('\r\n') + '\r\n';
  files.push({ name: 'change_log.csv', data: log, rows: got.changes.length });
  if (kind === 'month' && india) {
    try {
      const TC = require('./tax-copy');
      const T = require('./tax-lines');
      const led = await TC.ledgerFor(entity, got.range.start.slice(0, 7));
      files.push({ name: 'gstr1.json', data: JSON.stringify(T.gstr1(led.ledger, led.me, led.bounds.period), null, 1) + '\n', rows: 1 });
    } catch (e) {
      pending.push('gstr1.json could not be built: ' + String(e && e.message).slice(0, 120));
    }
  }
  if (kind === 'exit') pending.push('Earlier financial years are in their own year packs (a pack stays inside one year).');
  pending.push('Invoice PDFs are not held as files today.');
  /* ⭐ ONE manifest, sealed once (CBBookPack.seal): every file in the zip is listed with its size and SHA-256, and the
     manifest's own hash covers the list, the control totals, the Tally status and the previous pack's hash. */
  const hashes = {};
  const fyEnd = (E.packs().fyRange(got.fy, got.c.pack) || {}).end || today,
    retention = retentionOf(got.c.pack, kind === 'exit' ? today : fyEnd); /* W2-BOOKS: the pack's years, never a typed 8 — inside the sealed manifest */
  const open = Object.assign({}, built.manifest, {
    tally_xml_status: tally.status,
    tally,
    pending,
    retention,
    files: files.map((item) => {
      hashes[item.name] = sha(item.data);
      return { file: item.name, bytes: Buffer.byteLength(item.data, 'utf8'), rows: item.rows == null ? null : item.rows, sha256: null };
    })
  });
  const manifest = BP.seal(open, hashes, sha);
  const manifestText = JSON.stringify(manifest, null, 1) + '\n';
  const zip = require('./zip-store').zip(files.concat([{ name: 'manifest.json', data: manifestText }]));
  const hash = manifest.sha256;
  const pack_id = crypto.randomUUID();
  let storage_path = null;
  try {
    const O = require('./storage-object');
    if (await O.available()) {
      storage_path = String(entity) + '/books/' + pack_id;
      await O.put(storage_path, zip, 'application/zip');
    }
  } catch (e) {
    storage_path = null;
    manifest.stored_error = String(e && e.message).slice(0, 200);
  }
  const delete_after = retention.delete_after;
  const row = await withEntity(entity, (h) =>
    S.insertPack(h, entity, {
      pack_id,
      kind,
      fiscal_year: got.fy,
      period: kind === 'month' ? Number(o.period) : null,
      by: o.by,
      sha256: hash,
      prev_sha256: input.prev_sha256,
      manifest,
      storage_path,
      delete_after
    })
  );
  return { pack_id: row.pack_id, sha256: hash, stored: !!storage_path, manifest, bytes: zip.length, zip: storage_path ? null : zip };
}

/** the stored zip, or { stored: false } when it was never stored */
async function download(entity, pack_id) {
  const { withEntity } = require('../db');
  const p = await withEntity(entity, (h) => S.pack(h, entity, pack_id));
  if (!p) return { found: false };
  if (!p.storage_path) return { found: true, stored: false, pack: p };
  const bytes = await require('./storage-object').get(p.storage_path, entity); // C4: the pack's bytes are read as the shop's own
  return { found: true, stored: true, pack: p, bytes };
}

module.exports = { build, download, sha };
