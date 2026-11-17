#!/usr/bin/env node
/**
 * attach-deferred.test.mjs — the deferred attach path, proven without a browser.
 *
 * ⭐ WHY THIS EXISTS AT ALL: `cbAttachPick` posts immediately against an existing chit_id, and a CART LINE HAS NO
 * CHIT. Staging is therefore not a convenience — it is the only correct shape for attaching a photo to something
 * that does not exist yet.
 *
 * The cases that matter are the failures, not the happy path:
 *   · a file too large is refused AT STAGE, never discovered at flush when the chit has already gone;
 *   · a flush that partly fails KEEPS the failures staged, because a chit that exists while its evidence does not
 *     is the broken promise this codebase keeps refusing;
 *   · nothing is uploaded twice.
 *
 * Run: node scripts/attach-deferred.test.mjs
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* A minimal browser: attach-ui only needs a file picker, a toast, an api() and a document to dispatch on. */
const toasts = [], posted = [];
let apiFails = 0, chosen = null;
const ctx = createContext({
  console,
  document: {
    getElementById: () => null,
    createElement: () => ({ style: {}, click() {}, appendChild() {} }),
    head: { appendChild() {} }, documentElement: { appendChild() {} },
    dispatchEvent() {}, body: { appendChild() {} }
  },
  CustomEvent: function () {},
  FileReader: class {
    readAsDataURL(f) { this.result = 'data:' + f.type + ';base64,' + Buffer.from(f._bytes).toString('base64');
                       setTimeout(() => this.onload && this.onload(), 0); }
  },
  toast: (m) => toasts.push(m),
  api: async (ep, o) => {
    if (apiFails > 0) { apiFails--; throw new Error('network'); }
    posted.push(o.body); return { id: 'att' + posted.length, name: o.body.name };
  },
  EP: { attUpload: { m: 'POST', p: '/api/attachments', ok: 'y' } },
  setTimeout, window: {}
});
runInContext(readFileSync(join(ROOT, 'public/app/attach-ui.js'), 'utf8'), ctx, { filename: 'attach-ui.js' });
/* the picker is the one thing a headless run cannot do — hand it whatever the test chose */
runInContext('cbAttachChoose = async function(){ return __choice; };', ctx);

const file = (name, size, type) => ({ name, size, type, _bytes: Buffer.alloc(Math.min(size, 8), 7) });
const set = (f) => { ctx.__choice = f; };

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (got === undefined ? '' : '  → ' + JSON.stringify(got))); } };

console.log('\n1 · staging holds, it does not send');
{
  set(file('crate.jpg', 1024, 'image/jpeg'));
  const e = await ctx.cbAttachStage('cc', { line_index: 0 });
  ok('a chosen file is staged', !!e && e.name === 'crate.jpg', e);
  ok('⭐ NOTHING was uploaded — there is no chit yet', posted.length === 0, posted.length);
  ok('it remembers which line it belongs to', ctx.cbAttachStaged('cc')[0].line_index === 0);
  ok('the File is held, not its base64 (memory, not 3× memory)', !!ctx.cbAttachStaged('cc')[0].file);
}

console.log('\n2 · ⚠️ refused at STAGE, never discovered at flush');
{
  const before = ctx.cbAttachStaged('cc').length;
  set(file('huge.png', 9 * 1024 * 1024, 'image/png'));
  const e = await ctx.cbAttachStage('cc', {});
  ok('⭐ a file over 6MB is refused the moment it is chosen', e === null);
  ok('…and is NOT staged', ctx.cbAttachStaged('cc').length === before);
  ok('…and says the size and the limit', /9 MB|the limit is/.test(toasts.join(' ')), toasts.slice(-1));

  set(file('empty.txt', 0, 'text/plain'));
  ok('an empty file is refused', (await ctx.cbAttachStage('cc', {})) === null);

  set(null);
  ok('cancelling is silent — cancelling is not an error', (await ctx.cbAttachStage('cc', {})) === null);
}

console.log('\n3 · flush sends what was held, against the chit that now exists');
{
  set(file('second.pdf', 2048, 'application/pdf'));
  await ctx.cbAttachStage('cc', { line_index: 2 });
  const r = await ctx.cbAttachFlush('cc', 'chit-123');
  ok('both staged files uploaded', r.uploaded.length === 2, r);
  ok('⭐ each carries the chit it is now pinned to', posted.every((p) => p.chit_id === 'chit-123'));
  ok('⭐ and its own line_index — the photo stays with its line',
     posted[0].line_index === 0 && posted[1].line_index === 2, posted.map((p) => p.line_index));
  ok('the bucket is emptied once everything landed', ctx.cbAttachStaged('cc').length === 0);

  const again = await ctx.cbAttachFlush('cc', 'chit-123');
  ok('⚠️ flushing twice does not upload twice', again.uploaded.length === 0 && posted.length === 2, posted.length);
}

console.log('\n4 · ⚠️⚠️ a partial failure must NOT lose the file');
{
  posted.length = 0;
  set(file('a.jpg', 100, 'image/jpeg')); await ctx.cbAttachStage('cx', {});
  set(file('b.jpg', 100, 'image/jpeg')); await ctx.cbAttachStage('cx', {});
  apiFails = 1;                                   // the FIRST upload fails
  const r = await ctx.cbAttachFlush('cx', 'chit-9');
  ok('the one that worked is reported as uploaded', r.uploaded.length === 1, r.uploaded.length);
  ok('the one that failed is reported, with a reason', r.failed.length === 1 && !!r.failed[0].why, r.failed);
  ok('⭐⭐ the FAILED file is STILL STAGED — a retry must be possible',
     ctx.cbAttachStaged('cx').length === 1 && ctx.cbAttachStaged('cx')[0].name === 'a.jpg',
     ctx.cbAttachStaged('cx').map((s) => s.name));
  ok('⭐ and the person is TOLD, not left to read a return value',
     /did not attach/.test(toasts.join(' ')), toasts.slice(-1));

  const r2 = await ctx.cbAttachFlush('cx', 'chit-9');
  ok('…and retrying then succeeds', r2.uploaded.length === 1 && ctx.cbAttachStaged('cx').length === 0);
}

console.log('\n5 · ⚠️ no chit, no upload');
{
  set(file('orphan.jpg', 100, 'image/jpeg')); await ctx.cbAttachStage('cz', {});
  const r = await ctx.cbAttachFlush('cz', null);
  ok('flushing without a chit uploads nothing', r.uploaded.length === 0);
  ok('…reports why', /no chit/.test(r.failed[0].why), r.failed);
  ok('…and keeps the file', ctx.cbAttachStaged('cz').length === 1);
}

console.log('\n6 · unstage');
{
  const k = ctx.cbAttachStaged('cz')[0].key;
  ctx.cbAttachUnstage('cz', k);
  ok('a staged file can be removed before it is ever sent', ctx.cbAttachStaged('cz').length === 0);
}

console.log('\n== RESULT ==  PASS ' + pass + '  ·  FAIL ' + fail);
process.exit(fail ? 1 : 0);
