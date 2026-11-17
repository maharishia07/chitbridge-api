/**
 * tests/con-74-send-via-whitelist.test.cjs — CON-74 · the `via` (channel provenance) rider on POST /send is whitelisted key by key, capped, sender_verified forced to a real boolean.
 * OWNS      the proof that routes/chits.js sendViaOf drops unknown keys, caps text, keeps sender_verified a boolean and refuses a `via` that names no channel.
 * CALLED BY scripts/guards.cjs (P2 PROOF pass 2026-11-14)
 * FLOW      routes/chits.js text → the real sendViaOf + its helpers lifted into a vm sandbox (the route is not exported; nothing was copied) → hand-computed answers
 * CARD      23-connectors-and-integrations
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ok, done, API } = require('./lib/cat-proof-kit.cjs');

const src = fs.readFileSync(path.join(API, 'routes', 'chits.js'), 'utf8').replace(/\r\n/g, '\n');
const fn = (name) => { const s = src.indexOf('\nfunction ' + name + '('); if (s < 0) throw new Error(name + ' is gone'); return src.slice(s, src.indexOf('\n}\n', s) + 3); };
const line = (name) => { const s = src.indexOf('\nconst ' + name + ' ='); if (s < 0) throw new Error(name + ' is gone'); return src.slice(s, src.indexOf('\n', s + 1)); };
const sb = vm.createContext({});
vm.runInContext([line('capText'), line('clampCount'), line('firstFive'), fn('pricedProvenanceOf'), fn('sendViaOf'), 'this.sendViaOf = sendViaOf;'].join('\n'), sb);
const via = (bj) => JSON.parse(JSON.stringify(sb.sendViaOf(bj) === null ? null : sb.sendViaOf(bj)));

console.log('\nCON-74 · the via whitelist on /send');
const base = { channel: 'whatsapp', from: '919800000001' };
ok('sender_verified "true" (a string) is NOT verified: false', via({ via: Object.assign({}, base, { sender_verified: 'true' }) }).sender_verified === false);
ok('sender_verified 1 is NOT verified: false', via({ via: Object.assign({}, base, { sender_verified: 1 }) }).sender_verified === false);
ok('sender_verified true is verified: true', via({ via: Object.assign({}, base, { sender_verified: true }) }).sender_verified === true);
ok('sender_verified absent is false (a real boolean, not undefined)', via({ via: base }).sender_verified === false);
ok('channel capped at 24 characters', via({ via: { channel: 'c'.repeat(40) } }).channel.length === 24);
ok('from capped at 64, from_name at 120, notes at 800, raw_excerpt at 400', (() => { const v = via({ via: { channel: 'e', from: 'a'.repeat(100), from_name: 'b'.repeat(200), notes: 'n'.repeat(1000), raw_excerpt: 'r'.repeat(900) } }); return v.from.length === 64 && v.from_name.length === 120 && v.notes.length === 800 && v.raw_excerpt.length === 400; })());
ok('an unknown key is dropped, not carried', !('evil' in via({ via: Object.assign({ evil: '<x>' }, base) })) && !('__proto__x' in via({ via: base })));
ok('media_count clamps to 0..20 (99 → 20, -5 → 0, junk → 0)', via({ via: Object.assign({ media_count: 99 }, base) }).media_count === 20 && via({ via: Object.assign({ media_count: -5 }, base) }).media_count === 0 && via({ via: Object.assign({ media_count: 'x' }, base) }).media_count === 0);
ok('a via naming no channel is noise: null', via({ via: { from: '1' } }) === null);
ok('an array or a string as via is refused: null', via({ via: ['a'] }) === null && via({ via: 'whatsapp' }) === null && via({}) === null);
ok('the priced counts clamp to 0..999', (() => { const v = via({ via: Object.assign({ priced: { from_catalogue: 5000, unpriced: -3 } }, base) }); return v.priced.from_catalogue === 999 && v.priced.unpriced === 0; })());
done();
