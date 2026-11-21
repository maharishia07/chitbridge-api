#!/usr/bin/env node
// @type: unit
/**
 * books-evidence-attach.test.cjs — S1 of REQ-2026-11-20-evidence-and-classification-checks: a receipt on a posted entry, in units (no database, no network).
 *
 * OWNS      the proof of lib/books-evidence-attach.js (seat, type by first bytes, size, entry of THIS shop, add-only, nothing stored on a refusal) and of the widened reads in lib/books-evidence.js (a file on an entry counts as evidence,
 *           the exact-copy note, the SQL that never names a column the migration b887 has not added).
 * CALLED BY CI · node tests/books-evidence-attach.test.cjs   (the real stack proof is tests/books-evidence-s1.realstack.cjs)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
const path = require('path');
const dbPath = require.resolve('../db');
const calls = { withEntity: 0 };
let entryRows = [{ ok: 1 }]; /* what "is this entry in THIS shop" answers */
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: [], rowCount: 0 }), withEntity: async (entity, fn) => { calls.withEntity += 1; return fn({ query: async () => ({ rows: entryRows }) }); } } };
const storage = require('../lib/storage');
const Attach = require('../lib/books-evidence-attach');
const Evidence = require('../lib/books-evidence');

let failed = 0, total = 0;
function check(name, cond, seen) { total += 1; if (cond) return; failed += 1; console.log('  FAIL  ' + name + (seen === undefined ? '' : '\n        ' + JSON.stringify(seen))); }

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(40, 3)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(60, 4)]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(40, 5)]);
const b64 = (buf) => buf.toString('base64');
const ENTRY = '11111111-1111-4111-8111-111111111111';
const SHOP = '22222222-2222-4222-8222-222222222222';
const owner = () => ({ identity: { identity_id: SHOP, identity_type: 'entity' }, headers: {} });
const actor = (level) => ({ identity: { identity_id: 'a1', identity_type: 'actor', parent_entity_id: SHOP, access_level: level }, headers: {} });

(async () => {
  console.log('-- the type is read from the first bytes --');
  check('png, jpeg and pdf are accepted by their bytes', Attach.typeOf(PNG) === 'image/png' && Attach.typeOf(JPG) === 'image/jpeg' && Attach.typeOf(PDF) === 'application/pdf');
  check('an .exe is refused, so is HEIC, so is nothing', Attach.typeOf(EXE) === null && Attach.typeOf(HEIC) === null && Attach.typeOf(Buffer.alloc(0)) === null);

  console.log('-- who may attach --');
  check('the owner may', Attach.mayAttach(owner()) === true);
  check('an editor seat may', Attach.mayAttach(actor('editor')) === true);
  check('an auditor (commenter) and a viewer may not', Attach.mayAttach(actor('commenter')) === false && Attach.mayAttach(actor('viewer')) === false);
  check('a key, a request naming a member\'s books (a firm), a grant identity may not', Attach.mayAttach(Object.assign(owner(), { api_key: 'k' })) === false && Attach.mayAttach(Object.assign(owner(), { headers: { 'x-books-for': SHOP } })) === false && Attach.mayAttach(Object.assign(owner(), { acting_for_grant: 'g' })) === false);

  console.log('-- put: refusals store nothing --');
  const stored = [];
  storage.putForParticipants = async (file) => { stored.push(file); return 'f' + stored.length; };
  let ready = true;
  storage.hasEntryColumns = async () => ready;
  storage.listForEntries = async () => [];
  const body = (buf, extra) => Object.assign({ entry_id: ENTRY, name: 'receipt.png', data_base64: b64(buf) }, extra);
  let out = await Attach.put(actor('commenter'), SHOP, body(PNG));
  check('an auditor-seat attach is 403 with a sentence', out.refuse && out.refuse.status === 403 && /owner|edit/i.test(out.refuse.detail || JSON.stringify(out.refuse)), out);
  ready = false;
  out = await Attach.put(owner(), SHOP, body(PNG));
  check('migration not run: 503 in words, nothing stored, no database asked', out.refuse && out.refuse.status === 503 && stored.length === 0 && calls.withEntity === 0, out);
  ready = true;
  out = await Attach.put(owner(), SHOP, body(Buffer.concat([PNG, Buffer.alloc(7 * 1024 * 1024)])));
  check('7 MB is refused (413)', out.refuse && out.refuse.status === 413 && stored.length === 0, out.refuse && out.refuse.status);
  out = await Attach.put(owner(), SHOP, body(EXE, { name: 'run.exe' }));
  check('an .exe is refused (415)', out.refuse && out.refuse.status === 415, out);
  out = await Attach.put(owner(), SHOP, body(EXE, { name: 'photo.png', mime: 'image/png' }));
  check('an .exe renamed .png (image mime) is refused by its bytes (415)', out.refuse && out.refuse.status === 415 && stored.length === 0, out);
  out = await Attach.put(owner(), SHOP, body(HEIC, { name: 'photo.heic' }));
  check('HEIC is out (415)', out.refuse && out.refuse.status === 415, out);
  entryRows = [];
  out = await Attach.put(owner(), SHOP, body(PNG));
  check('an entry that is not in this shop answers 404 (the same for a made-up id)', out.refuse && out.refuse.status === 404 && stored.length === 0, out);
  out = await Attach.put(owner(), SHOP, body(PNG, { entry_id: 'not-an-id' }));
  check('a junk entry id answers the same 404', out.refuse && out.refuse.status === 404, out);

  console.log('-- put: the write --');
  entryRows = [{ ok: 1 }];
  Evidence.entryFilesFor = Evidence.entryFilesFor; /* the real one, over the stand-in handle below */
  out = await Attach.put(owner(), SHOP, body(PNG));
  const sha = require('crypto').createHash('sha256').update(PNG).digest('hex');
  check('a PNG on an entry of this shop is stored: one row, the shop\'s own, with its hash and the verified type', out.ok && stored.length === 1 && stored[0].entry_id === ENTRY && stored[0].sha256 === sha && stored[0].mime === 'image/png' && JSON.stringify(stored[0].participants) === JSON.stringify([SHOP]) && !stored[0].chit_id, stored[0]);
  out = await Attach.put(owner(), SHOP, body(JPG, { name: 'second.jpg' }));
  check('a second file ADDS (two stored; the first is never touched)', out.ok && stored.length === 2, stored.length);
  out = await Attach.put(actor('editor'), SHOP, body(PDF, { name: 'bill.pdf' }));
  check('an edit seat attaches a PDF', out.ok && out.ok.mime === 'application/pdf', out);

  console.log('-- add-only --');
  storage.meta = async (id) => (id === '33333333-3333-4333-8333-333333333333' ? { id, entry_id: ENTRY } : { id, entry_id: null, chit_id: 'c' });
  let refused = await Attach.guardChange(SHOP, '33333333-3333-4333-8333-333333333333');
  check('delete / replace of a file on an entry is 409 ATTACHMENT_ADD_ONLY', refused && refused.status === 409 && refused.code === 'ATTACHMENT_ADD_ONLY', refused);
  check('a file on a chit is not this guard\'s: it falls through unchanged', (await Attach.guardChange(SHOP, '44444444-4444-4444-8444-444444444444')) === null);
  ready = false;
  check('before the migration the guard asks nothing and falls through', (await Attach.guardChange(SHOP, '33333333-3333-4333-8333-333333333333')) === null);
  ready = true;

  console.log('-- the evidence reads --');
  const sqls = [];
  const handle = { query: async (sql) => { sqls.push(sql); return { rows: [{ mine: ENTRY, other: '55555555-5555-4555-8555-555555555555', entry_no: 'J-0007' }] }; } };
  storage.listForChits = async () => [];
  storage.listForEntries = async () => [{ id: 'f1', name: 'r.png', mime: 'image/png', size: 41, entry_id: ENTRY, sha256: sha }];
  const items = [{ item: { entry_id: ENTRY }, chit_id: null }, { item: { entry_id: '66666666-6666-4666-8666-666666666666' }, chit_id: null }];
  await Evidence.attach(handle, items, { flag: false });
  const ev = items[0].item.evidence;
  check('a file on the entry counts: count 1, the same file shape, doc stays null', ev.count === 1 && ev.files.length === 1 && Object.keys(ev.files[0]).sort().join() === 'id,mime,name,size' && ev.doc === null, ev);
  check('the same file on another entry carries the exact-copy note naming it', ev.duplicate && ev.duplicate.entry_no === 'J-0007' && /same file as entry J-0007/i.test(ev.duplicate.note), ev.duplicate);
  check('an entry with no file and no twin is silent', items[1].item.evidence.count === 0 && !items[1].item.evidence.duplicate && items[1].item.evidence.files.length === 0);
  storage.listForEntries = async () => [{ id: 'f9', name: 'other.png', mime: 'image/png', size: 41, entry_id: ENTRY, sha256: 'x'.repeat(64) }];
  handle.query = async () => ({ rows: [] });
  const quiet = [{ item: { entry_id: ENTRY }, chit_id: null }];
  await Evidence.attach(handle, quiet, { flag: false });
  check('a genuinely different receipt (another hash) is silent', quiet[0].item.evidence.count === 1 && !quiet[0].item.evidence.duplicate);

  const seen = [];
  const spy = { query: async (sql) => { seen.push(sql); return { rows: [{ total: 0, nodoc: 0, none: 0 }] }; } };
  ready = true;
  await Evidence.isEvidence(spy, SHOP, ENTRY);
  check('isEvidence reads a file on an entry when the columns are there', /a\.entry_id/.test(seen[0]), seen[0]);
  seen.length = 0;
  ready = false;
  await Evidence.isEvidence(spy, SHOP, ENTRY);
  await Evidence.attentionIn(spy, SHOP, { pack: null, cur: 'AUD' }, '2026-01-01', '2026-12-31');
  check('before the migration no read names entry_id (no 42703, no 500)', seen.length > 0 && seen.every((sql) => !/entry_id\s*(=|IS)\s*(je|a)\.|e\.entry_id|a\.entry_id/.test(sql.replace(/je\.entry_id = ANY/g, ''))), seen.filter((sql) => /a\.entry_id|e\.entry_id/.test(sql)));
  seen.length = 0;
  ready = true;
  await Evidence.attentionIn(spy, SHOP, { pack: null, cur: 'AUD' }, '2026-01-01', '2026-12-31');
  check('with the columns, no_source and no_file exclude an entry that holds its own file', /e\.entry_id = je\.entry_id/.test(seen.join('\n')), seen[0]);

  console.log('\n  ' + total + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('  CRASH ' + (e && e.stack)); process.exit(1); });
