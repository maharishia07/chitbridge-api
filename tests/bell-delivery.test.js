'use strict';
/**
 * bell-delivery.test.js — A BELL IS WATCHED FOR DELIVERY, NOT FOR CONNECTION ([TILL-167], BACKLOG TILL-146).
 *
 * ── ⚠️⚠️⚠️ WHAT THIS DEFENDS ────────────────────────────────────────────────────────────────────────────
 *
 * Every counter and every TV was deaf until 2026-09-17 and nothing said so, because the only question ever
 * asked was "is the stream connected?". An EventSource that is OPEN and delivering nothing is, from the
 * inside, identical to one that is open with nothing to deliver. [[project-bell-was-deaf]]
 *
 * ⚠️⚠️ AND THE FIRST FIX WOULD HAVE MADE IT WORSE. The counter listened for a named `ping` event — but the
 * server sent `: ping`, an SSE **comment**, which fires NO listener of any kind. Every healthy bell would
 * have fallen silent after the threshold and been torn down and rebuilt on every 30s tick. Caught by reading
 * the server instead of trusting the word "ping" in a comment.
 *
 * So the server now sends BOTH: the comment (proxies need it) and a named event (clients need it).
 *
 * Run: node tests/bell-delivery.test.js   · no DB, no browser.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const EVENTS = fs.readFileSync(path.join(API, 'lib', 'events.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

console.log('\nTHE SERVER SENDS SOMETHING A CLIENT CAN HEAR\n');

/**
 * ⚠️⚠️⚠️ THE ONE THAT WOULD HAVE CAUGHT MY OWN BUG. A line beginning with ':' is a comment in the SSE wire
 * format. It keeps a proxy from closing the stream and it is invisible to every JS listener.
 */
it('⚠️⚠️⚠️ the heartbeat is a NAMED event, not only a comment', () => {
  const hb = EVENTS.slice(EVENTS.indexOf('const hb = setInterval'), EVENTS.indexOf('}, HEARTBEAT_MS)'));
  assert.ok(/': ping/.test(hb), 'the proxy comment is gone — some proxies will close the stream');
  assert.ok(/'event: ping\\n/.test(hb),
    'the heartbeat is a comment only, so no client can tell a quiet bell from a dead one');
});

it('and it carries a time, so a client can measure staleness', () => {
  assert.ok(/data: \{"t":' \+ Date\.now\(\)/.test(EVENTS), 'the ping carries no timestamp');
});

it('the beat is fast enough to be missed noticeably', () => {
  const m = EVENTS.match(/HEARTBEAT_MS = (\d+) \* (\d+)/);
  assert.ok(m, 'the heartbeat interval is gone');
  const ms = Number(m[1]) * Number(m[2]);
  assert.ok(ms <= 30000, 'the server beats every ' + (ms / 1000) + 's — too slow to notice a deaf bell quickly');
});

console.log('\nAND THE COUNTER MEASURES DELIVERY\n');

it('it records every arrival, not only the ones it acts on', () => {
  assert.ok(/function bellHeard\(\)/.test(PAGE), 'nothing records that anything arrived');
  assert.ok(/addEventListener\('ping', bellHeard\)/.test(PAGE), 'the heartbeat is not listened for');
  const cb = PAGE.slice(PAGE.indexOf("addEventListener('cb'"), PAGE.indexOf("addEventListener('cb'") + 400);
  assert.ok(/bellHeard\(\)/.test(cb), 'a real event does not count as delivery');
});

/** ⭐ the threshold must come from the server's actual beat, not from a guess */
it('⭐ the deaf threshold is several beats, and says which', () => {
  const m = PAGE.match(/BELL_DEAF_MS = (\d+);\s*\/\*([^*]*)\*\//);
  assert.ok(m, 'the threshold is gone');
  const hb = 25000;
  assert.ok(Number(m[1]) >= hb * 2, 'the threshold is under two beats — a healthy bell would be torn down');
  assert.ok(/25s|HEARTBEAT_MS/.test(m[2]), 'the threshold does not say what beat it is derived from: ' + m[2]);
});

/**
 * ⚠️⚠️ A DEAF BELL MUST BE CLOSED. bellUp() refuses to reconnect while BELL is truthy, so a stream that has
 * stopped delivering would otherwise be held open for ever by the guard meant to stop thrashing.
 */
it('⚠️⚠️ a deaf bell is closed and rebuilt, not waited on', () => {
  const w = PAGE.slice(PAGE.indexOf('function bellWatch(){'), PAGE.indexOf('function bellWatch(){') + 400);
  assert.ok(/BELL\.close\(\)/.test(w), 'it does not close the dead stream');
  assert.ok(/BELL = null/.test(w), 'it does not clear the flag that blocks reconnection');
  assert.ok(/BELL_AT = 0/.test(w), 'the 20s anti-thrash timer would delay the rebuild');
  assert.ok(/bellUp\(\)/.test(w), 'nothing rebuilds it');
});

it('and the watcher rides the tick that already existed', () => {
  assert.ok(/setInterval\(function\(\)\{ bellWatch\(\); bellUp\(\); \}, 30000\)/.test(PAGE),
    'the watcher is not on the bell tick — a second timer is a second path');
});

/** ⭐⭐ the capability row asks about DELIVERY now, which is the whole point */
it('⭐⭐ the watch row asks whether it is delivering, not whether the line is up', () => {
  const at = PAGE.indexOf("{ id:'bell',");
  assert.ok(at > 0, 'the bell row is gone from the registry');
  const row = PAGE.slice(at, PAGE.indexOf('},', at));
  assert.ok(/bellLive\(\)/.test(row),
    'the row still only asks about the line — it would have reported green through the whole outage');
});

it('and a counter that cannot answer does not invent a fault', () => {
  const at = PAGE.indexOf("{ id:'bell',");
  const row = PAGE.slice(at, PAGE.indexOf('},', at));
  assert.ok(/catch \(_\) \{ return true; \}/.test(row), 'a thrown probe would report the bell as deaf');
});

console.log('\n' + pass + ' checks passed\n');
