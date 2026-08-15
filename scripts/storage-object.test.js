#!/usr/bin/env node
/**
 * storage-object.test.js — the parts of the object adapter that can be proven WITHOUT a bucket.
 *
 * ⚠️ This is not the acceptance test. The list that actually gates switching `STORAGE_ADAPTER` lives in
 * C:\dev\SPEC-object-storage.md §7 and needs a real bucket, real credentials and a second party's session — in
 * particular *"party B cannot read party A's object"*, which can only be proven from B's session and is the one
 * that matters most. What this file covers is everything that would otherwise only be checked by eye: the naming
 * convention, the refusal to run unconfigured, and the safe default.
 *
 * Run: node scripts/storage-object.test.js
 */
'use strict';
const obj = require('../lib/storage-object');

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (got === undefined ? '' : '  → ' + JSON.stringify(got))); }
};

console.log('\nstorage-object · the naming convention');
{
  const ent = 'e1f2a3b4-1111-2222-3333-444455556666';
  const id  = 'a1b2c3d4-9999-8888-7777-666655554444';
  const k   = obj.objectKey(ent, id, new Date(Date.UTC(2026, 7, 15)));

  ok('entity_id is the FIRST segment — the isolation boundary leads', k.split('/')[0] === ent, k);
  ok('date partition is yyyy/mm, zero-padded', k.split('/')[1] === '2026' && k.split('/')[2] === '08', k);
  ok('the last segment is the attachment row id — 1:1, so delete-row/delete-object is trivial',
     k.split('/')[3] === id, k);
  ok('exactly four segments — no surprises to write a bucket policy around', k.split('/').length === 4, k);

  /* ⚠️ These two are the privacy rules, and they are easy to undo by accident later. */
  ok('⚠️ NO filename in the key — a key is a URL and a filename leaks who trades with whom',
     !/\.(pdf|png|jpe?g|docx?|xlsx?)$/i.test(k), k);
  ok('⚠️ NO extension — the mime lives in the row and must stay the single source of truth',
     k.indexOf('.') === -1, k);

  const jan = obj.objectKey(ent, id, new Date(Date.UTC(2026, 0, 3)));
  ok('January pads to 01 (lexicographic listing only works if every month is two digits)',
     jan.split('/')[2] === '01', jan);

  ok('the same inputs always give the same key — a key is derived, never stored twice',
     obj.objectKey(ent, id, new Date(Date.UTC(2026, 7, 15))) === k);
}

console.log('\nstorage-object · refuses to pretend');
{
  ok('configured() is false without S3_ENDPOINT/S3_KEY', obj.configured() === false, obj.configured());

  /* ⭐ THE IMPORTANT ONE. An unconfigured store must THROW, never silently succeed — a put that quietly does
     nothing produces an attachment row whose bytes never existed, and in a dispute an empty file that downloads
     cleanly is worse than an error, because the error gets investigated and the empty file gets believed. */
  let threw = false;
  obj.put('x/y/z', Buffer.from('hi'), 'text/plain').catch(() => { threw = true; }).finally(() => {
    ok('⭐ put() REJECTS when unconfigured — it never silently no-ops', threw);

    let threwGet = false;
    obj.get('x/y/z').catch(() => { threwGet = true; }).finally(() => {
      ok('get() rejects when unconfigured', threwGet);

      console.log('\nstorage · the safe default');
      const storage = require('../lib/storage');
      ok('⭐ STORAGE_ADAPTER defaults to db — this work changes no behaviour by itself',
         storage.STORE === 'db', storage.STORE);
      ok('the db adapter is still the one exported (putForParticipants present)',
         typeof storage.putForParticipants === 'function');
      ok('reads stay shape-tolerant (getBlob present and unchanged in shape)',
         typeof storage.getBlob === 'function');

      console.log('\n== RESULT ==  PASS ' + pass + '  ·  FAIL ' + fail);
      process.exit(fail ? 1 : 0);
    });
  });
}
