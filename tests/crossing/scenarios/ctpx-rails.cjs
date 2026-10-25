'use strict';
// @type: system
/**
 * tests/crossing/scenarios/ctpx-rails.cjs — R0-R11 of the 25 Oct walk (WALK-2026-10-25-IN-AU.md, "Rigorous pass"): the return path between two installations.
 * OWNS      R0 (setup: a tagged chit from the buyer to the seller) · R1 status · R2 internal note stays home · R3/R4 messages · R5-R7 dispute cycle · R8 far side down (opt-in) · R9 attachment · R10/R11 cancel
 * CALLED BY scenarios/ctpx-registry.cjs
 * FLOW      each scenario: API as a shop (the screen's own routes) → wait for the ctp-return cron → read BOTH installations' rows (lib/flow.cjs) → compare
 * A scenario returns nothing; it records checks on `rec`. It may leave ids in ctx.state for the next one (the index lists `requires`).
 */
const flow = require('../lib/flow.cjs');
const { actors, statusAt } = flow;
const db = require('../lib/db.cjs');
const { sha256, waitFor, sleep } = require('../lib/compare.cjs');
const ssh = require('../lib/ssh.cjs');

/** make one tagged general chit from the buyer to the seller and wait until it is on the seller's installation */
async function makeChit(ctx, rec, id, label) {
  const a = await actors(ctx, id);
  const { stub } = await flow.addSupplier(ctx, a.bk, a.sk);
  if (!rec.check(stub && stub.supplier_entity_id, 'the seller is in the buyer\'s supplier list', 'supplier row missing after add')) return null;
  const sent = await a.buyer.send(flow.generalBody(ctx, stub, a.pair.seller, label));
  if (!rec.check(sent.ok && sent.body.chit_id, 'the chit is sent (' + label + ')', 'HTTP ' + sent.status + ' ' + JSON.stringify(sent.body).slice(0, 200))) return null;
  const arrived = await flow.waitCopy(ctx, a.sk, sent.body.chit_id);
  rec.check(arrived.ok, 'the chit reaches the seller\'s installation (waited ' + arrived.waitedMs + ' ms)', 'no copy for the seller after ' + arrived.waitedMs + ' ms');
  return arrived.ok ? { chit_id: sent.body.chit_id, stub } : null;
}

const R0 = {
  id: 'R0', title: 'setup: add the seller by address and send a tagged chit across', requires: [],
  async run(ctx, rec) {
    const made = await makeChit(ctx, rec, 'R0', 'status and messages');
    if (made) ctx.state.chitA = made;
  }
};

const R1 = {
  id: 'R1', title: 'seller status Open -> Act crosses (queue accepted, buyer sees the seller in_progress)', requires: ['R0'],
  async run(ctx, rec) {
    const a = await actors(ctx, 'R1');
    const { chit_id, stub } = ctx.state.chitA;
    const moved = await a.seller.put('/api/chits/' + chit_id + '/status', { status: 'in_progress', note: ctx.tag + ' R1' });
    rec.check(moved.ok, 'the seller moves the status (HTTP ' + moved.status + ')', JSON.stringify(moved.body).slice(0, 200));
    const seen = await waitFor(async () => (await statusAt(ctx, a.pair.buyer.installation, stub.supplier_entity_id, chit_id)) === 'in_progress', { timeoutMs: ctx.topo.waits.crossMs, everyMs: ctx.topo.waits.everyMs });
    rec.check(seen.ok, 'the buyer\'s installation shows the seller in_progress (' + seen.waitedMs + ' ms)', 'shadow status never became in_progress');
    const queue = await flow.queueOut(ctx, a.sk, chit_id);
    const row = queue.find((q) => q.kind === 'status');
    rec.check(row && row.status === 'accepted', 'the seller\'s queue row is accepted (kind status)', JSON.stringify(queue.slice(0, 3)));
  }
};

const R2 = {
  id: 'R2', title: 'buyer internal note stays home; an external marker sent after it arrives without it', requires: ['R0'],
  async run(ctx, rec) {
    const a = await actors(ctx, 'R2');
    const { chit_id } = ctx.state.chitA;
    const note = ctx.tag + ' internal-only note R2';
    const marker = ctx.tag + ' marker after the note R2';
    const first = await a.buyer.post('/api/chits/' + chit_id + '/messages', { message_text: note, thread_type: 'internal' });
    rec.check(first.ok, 'the internal note is saved', 'HTTP ' + first.status);
    const second = await a.buyer.post('/api/chits/' + chit_id + '/messages', { message_text: marker, thread_type: 'external' });
    rec.check(second.ok, 'the external marker is sent', 'HTTP ' + second.status);
    const there = await flow.waitMessage(ctx, a.sk, chit_id, marker);
    rec.check(there.ok, 'the marker (sent AFTER the note) reached the seller', 'marker never arrived');
    const sellerRows = await flow.messages(ctx, a.sk, chit_id);
    rec.check(!sellerRows.some((m) => m.message_text === note), 'the internal note is NOT on the seller\'s installation', 'the note leaked to the seller');
    const buyerRows = await flow.messages(ctx, a.bk, chit_id);
    rec.check(buyerRows.some((m) => m.message_text === note && m.thread_type === 'internal'), 'the note is on the buyer\'s own copy as internal', 'note missing at home');
  }
};

const R3 = {
  id: 'R3', title: 'external message with ₹ é — arrives intact, one message id, one row per party', requires: ['R0'],
  async run(ctx, rec) {
    const a = await actors(ctx, 'R3');
    const { chit_id } = ctx.state.chitA;
    const text = ctx.tag + ' R3 ₹ é — done';
    const sent = await a.buyer.post('/api/chits/' + chit_id + '/messages', { message_text: text, thread_type: 'external' });
    rec.check(sent.ok && sent.body.message_id, 'the message is sent', 'HTTP ' + sent.status);
    const there = await flow.waitMessage(ctx, a.sk, chit_id, text);
    rec.check(there.ok, 'the text arrives exactly (₹ é — intact)', 'no identical text on the seller\'s installation');
    const mine = (await flow.messages(ctx, a.bk, chit_id)).filter((m) => m.message_text === text);
    const theirs = (await flow.messages(ctx, a.sk, chit_id)).filter((m) => m.message_text === text);
    rec.check(mine.length === 1 && theirs.length === 1, 'one row on each side', 'rows: buyer ' + mine.length + ', seller ' + theirs.length);
    rec.check(mine[0] && theirs[0] && mine[0].message_id === theirs[0].message_id, 'the same message id on both', 'ids differ');
  }
};

const R4 = {
  id: 'R4', title: 'seller reply arrives at the buyer', requires: ['R0'],
  async run(ctx, rec) {
    const a = await actors(ctx, 'R4');
    const { chit_id } = ctx.state.chitA;
    const text = ctx.tag + ' R4 reply from the seller';
    const sent = await a.seller.post('/api/chits/' + chit_id + '/messages', { message_text: text, thread_type: 'external' });
    rec.check(sent.ok, 'the seller replies', 'HTTP ' + sent.status);
    const there = await flow.waitMessage(ctx, a.bk, chit_id, text);
    rec.check(there.ok, 'the reply reaches the buyer (' + there.waitedMs + ' ms)', 'no reply on the buyer\'s installation');
    const queue = await flow.queueOut(ctx, a.sk, chit_id);
    rec.check(queue.some((q) => q.kind === 'message' && q.status === 'accepted'), 'a message queue row is accepted', JSON.stringify(queue.slice(-3)));
  }
};

const R5 = {
  id: 'R5', title: 'dispute raised (Docs, targeted) appears with the same id on both sides', requires: ['R0'],
  async run(ctx, rec) {
    const a = await actors(ctx, 'R5');
    const { chit_id, stub } = ctx.state.chitA;
    const raised = await a.buyer.post('/api/chits/' + chit_id + '/disputes', { category: 'docs', reason: ctx.tag + ' R5 the documents do not match', target_entity_id: stub.supplier_entity_id });
    rec.check(raised.ok && raised.body.dispute_id, 'the buyer raises the dispute (HTTP ' + raised.status + ')', JSON.stringify(raised.body).slice(0, 200));
    if (!raised.body.dispute_id) return;
    ctx.state.disputeId = raised.body.dispute_id;
    const there = await flow.waitDisputes(ctx, a.sk, chit_id, (rows) => rows.some((d) => d.dispute_id === raised.body.dispute_id));
    rec.check(there.ok, 'the seller\'s installation holds the SAME dispute id (' + there.waitedMs + ' ms)', 'dispute never arrived');
    const rows = there.ok ? there.value : [];
    rec.check(rows.some((d) => d.dispute_id === raised.body.dispute_id && d.status === 'open' && d.category === 'docs'), 'open, category docs', JSON.stringify(rows));
  }
};

const R6 = {
  id: 'R6', title: 'dispute message from the seller reaches the raiser', requires: ['R5'],
  async run(ctx, rec) {
    const a = await actors(ctx, 'R6');
    const { chit_id } = ctx.state.chitA;
    const text = ctx.tag + ' R6 dispute message';
    const sent = await a.seller.post('/api/chits/' + chit_id + '/messages', { message_text: text, thread_type: 'external', is_dispute: true, dispute_id: ctx.state.disputeId });
    rec.check(sent.ok, 'the seller posts a dispute message (HTTP ' + sent.status + ')', JSON.stringify(sent.body).slice(0, 200));
    const there = await flow.waitMessage(ctx, a.bk, chit_id, text);
    rec.check(there.ok, 'it reaches the buyer', 'dispute message never arrived');
    rec.check(there.ok && there.value.is_dispute === true && there.value.dispute_id === ctx.state.disputeId, 'tagged to the same dispute', JSON.stringify(there.value));
  }
};

const R7 = {
  id: 'R7', title: 'dispute resolved by the raiser: both sides resolved, same note', requires: ['R5'],
  async run(ctx, rec) {
    const a = await actors(ctx, 'R7');
    const { chit_id } = ctx.state.chitA;
    const note = ctx.tag + ' R7 settled';
    const done = await a.buyer.put('/api/chits/' + chit_id + '/disputes/' + ctx.state.disputeId + '/resolve', { resolution_note: note });
    rec.check(done.ok, 'the raiser resolves (HTTP ' + done.status + ')', JSON.stringify(done.body).slice(0, 200));
    const there = await flow.waitDisputes(ctx, a.sk, chit_id, (rows) => rows.some((d) => d.dispute_id === ctx.state.disputeId && d.status === 'resolved'));
    rec.check(there.ok, 'the seller\'s copy is resolved (' + there.waitedMs + ' ms)', 'never resolved there');
    const mine = (await flow.disputes(ctx, a.bk, chit_id)).find((d) => d.dispute_id === ctx.state.disputeId);
    const theirs = there.ok ? there.value.find((d) => d.dispute_id === ctx.state.disputeId) : null;
    rec.check(mine && theirs && mine.status === 'resolved' && mine.resolution_note === theirs.resolution_note, 'same resolution note on both', JSON.stringify({ mine, theirs }));
  }
};

/** R8 stops the far side's api for ~100 s: infrastructure, so it only runs with --allow-outage and always starts it again */
const R8 = {
  id: 'R8', title: 'far side down, two messages: held in order, delivered after it returns', requires: ['R0'], needsFlag: 'allowOutage',
  async run(ctx, rec) {
    const a = await actors(ctx, 'R8');
    const { chit_id } = ctx.state.chitA;
    const far = a.pair.seller.installation;
    const apiBox = ssh.container(ctx.topo, far, 'api');
    const m1 = ctx.tag + ' R8 first while down';
    const m2 = ctx.tag + ' R8 second while down';
    await ssh.run(ctx.topo, far, 'sudo docker stop ' + apiBox);
    try {
      rec.check((await a.buyer.post('/api/chits/' + chit_id + '/messages', { message_text: m1, thread_type: 'external' })).ok, 'first message saved at home while the far side is down', 'send failed');
      await sleep(1500);
      rec.check((await a.buyer.post('/api/chits/' + chit_id + '/messages', { message_text: m2, thread_type: 'external' })).ok, 'second message saved at home', 'send failed');
      await sleep(Math.min(ctx.topo.waits.outageMs, 60000));
    } finally {
      await ssh.run(ctx.topo, far, 'sudo docker start ' + apiBox);
    }
    const up = await flow.waitMessage(ctx, a.sk, chit_id, m2);
    rec.check(up.ok, 'both arrive after the far side returns (' + up.waitedMs + ' ms; the retry waits for the next cron minute, W21)', 'second message never arrived');
    const rows = (await flow.messages(ctx, a.sk, chit_id)).filter((m) => m.message_text === m1 || m.message_text === m2);
    rec.check(rows.length === 2 && rows[0].message_text === m1, 'stored in the order written', JSON.stringify(rows.map((r) => r.message_text)));
    const mine = (await flow.messages(ctx, a.bk, chit_id)).find((m) => m.message_text === m1);
    const gap = rows.length && mine ? Math.abs(new Date(rows[0].created_at) - new Date(mine.created_at)) : null;
    rec.known('W19', gap !== null && gap < 20000, 'a held message keeps the WRITING time on the receiver (today it shows the arrival time)');
  }
};

const R9 = {
  id: 'R9', title: 'attachment crosses by reference and is byte-identical (sha256)', requires: ['R0'],
  async run(ctx, rec) {
    const a = await actors(ctx, 'R9');
    const { chit_id } = ctx.state.chitA;
    const bytes = Buffer.from('walk-po-terms ' + ctx.runId + '\nNet 30 days. Ship by sea. ₹ é —\n', 'utf8');
    const name = 'crossing-' + ctx.runId + '.txt';
    const up = await a.buyer.post('/api/attachments', { chit_id, name, mime: 'text/plain', data_base64: bytes.toString('base64') });
    rec.check(up.ok && up.body.id, 'the buyer uploads (HTTP ' + up.status + ')', JSON.stringify(up.body).slice(0, 200));
    const there = await waitFor(async () => (await flow.attachments(ctx, a.sk, chit_id)).find((r) => r.name === name) || null, { timeoutMs: ctx.topo.waits.crossMs, everyMs: ctx.topo.waits.everyMs });
    rec.check(there.ok, 'the seller\'s installation lists the file (' + there.waitedMs + ' ms)', 'attachment never arrived');
    if (!there.ok) return;
    const mine = await a.buyer.get('/api/attachments/' + up.body.id);
    const theirs = await a.seller.get('/api/attachments/' + there.value.id);
    const digests = [sha256(bytes), sha256(mine.raw), sha256(theirs.raw)];
    rec.check(digests.every((d) => d === digests[0]), 'sha256 identical: original, buyer\'s copy, seller\'s copy', digests.map((d) => d.slice(0, 12)).join(' / '));
    rec.check(Number(there.value.size) === bytes.length, 'size ' + bytes.length + ' bytes on the far side', 'size ' + there.value.size);
  }
};

const R10 = {
  id: 'R10', title: 'buyer withdraws (cancel request): seller copy not cancelled, request stamped', requires: [],
  async run(ctx, rec) {
    const made = await makeChit(ctx, rec, 'R10', 'cancel request');
    if (!made) return;
    ctx.state.chitB = made;
    const a = await actors(ctx, 'R10');
    const voided = await a.buyer.put('/api/chits/' + made.chit_id + '/void', { reason: ctx.tag + ' R10 withdrawn by the buyer' });
    rec.check(voided.ok, 'the buyer withdraws (HTTP ' + voided.status + ')', JSON.stringify(voided.body).slice(0, 200));
    const there = await flow.waitCopyWhere(ctx, a.sk, made.chit_id, (c) => c.cancel_requested);
    rec.check(there.ok, 'the seller\'s copy carries the cancel request (' + there.waitedMs + ' ms)', 'cancel_requested never stamped on the seller');
    rec.check(there.ok && there.value.current_status !== 'cancelled', 'the seller\'s copy is NOT cancelled (it must confirm)', 'status ' + (there.value && there.value.current_status));
    const mine = await flow.copy(ctx, a.bk, made.chit_id);
    rec.check(mine && mine.cancel_requested, 'the request is stamped on the buyer\'s copy too', JSON.stringify(mine && mine.cancel_requested));
  }
};

const R11 = {
  id: 'R11', title: 'seller confirms the cancel: cancelled and confirmed on both sides', requires: ['R10'],
  async run(ctx, rec) {
    const a = await actors(ctx, 'R11');
    const { chit_id } = ctx.state.chitB;
    const done = await a.seller.put('/api/chits/' + chit_id + '/status', { status: 'cancelled', note: ctx.tag + ' R11 agreed' });
    rec.check(done.ok, 'the seller cancels (HTTP ' + done.status + ')', JSON.stringify(done.body).slice(0, 200));
    const there = await flow.waitCopyWhere(ctx, a.bk, chit_id, (c) => c.cancel_confirmed && c.current_status === 'cancelled');
    rec.check(there.ok, 'the buyer\'s copy is cancelled and confirmed (' + there.waitedMs + ' ms)', 'buyer copy: ' + JSON.stringify(there.value));
    const theirs = await flow.copy(ctx, a.sk, chit_id);
    rec.check(theirs && theirs.current_status === 'cancelled', 'the seller\'s copy is cancelled', 'status ' + (theirs && theirs.current_status));
  }
};

module.exports = { scenarios: [R0, R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11], makeChit };
