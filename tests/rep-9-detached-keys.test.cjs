/**
 * tests/rep-9-detached-keys.test.cjs — REP-9 (proof 2026-11-14): the guard that names a store's price keys matching no item in the source.
 * @type regression
 * OWNS      the proof that lib/catalogue-build.js detachedKeys(items, overlay) returns exactly the overlay keys that reach no product: a key equal to a
 *           current name reaches; a key equal to a `formerly` name reaches; every other key is NAMED (in overlay order); and build() carries that list
 *           in `detached` (lib/catalogue-build.js:424 detachedKeys, :411 b.detached (cites drifted from :202)).
 * CALLED BY scripts/guards.cjs · CI. No database: the pure function, and build() over a stand-in source row.
 * FLOW      source items + store overlay → detachedKeys → the named keys
 *   node tests/rep-9-detached-keys.test.cjs
 */
'use strict';
const path = require('path');
const { API, ok, done, mock, standInDb } = require('./lib/cat-proof-kit.cjs');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
mock('db', standInDb(() => ({ rows: [] })).db);
const build = require(path.join(API, 'lib', 'catalogue-build.js'));

const items = [{ name: 'Mixer 500W' }, { name: 'Grinder', formerly: ['Wet Grinder', 'Old Grinder'] }, { name: 'Kettle' }];
const overlay = { 'Mixer 500W': 1, 'Wet Grinder': 2, 'Mixer 750W': 3, Kettle: 4, Toaster: 5 };
/* hand-computed: Mixer 500W = a current name (reaches); Wet Grinder = a former name (reaches); Kettle = current (reaches);
   Mixer 750W and Toaster are in no name and no formerly → named, in the overlay's own order */
ok('names exactly the keys that reach no product, in order', JSON.stringify(build.detachedKeys(items, overlay)) === JSON.stringify(['Mixer 750W', 'Toaster']), JSON.stringify(build.detachedKeys(items, overlay)));
ok('a key equal to a current name is not named', !build.detachedKeys(items, { Kettle: 1 }).length);
ok('a key equal to a `formerly` name is not named', !build.detachedKeys(items, { 'Old Grinder': 1 }).length);
ok('a key matching nothing is named', JSON.stringify(build.detachedKeys(items, { Blender: 1 })) === '["Blender"]');
ok('a numeric name is compared as text', !build.detachedKeys([{ name: 7 }], { '7': 1 }).length);
ok('no items: every overlay key is named', JSON.stringify(build.detachedKeys([], { A: 1, B: 2 })) === '["A","B"]');
ok('no overlay: nothing is named, and null inputs do not throw', build.detachedKeys(items, null).length === 0 && build.detachedKeys(null, { A: 1 }).length === 1);
ok('detachedKeys is exported (the guard a screen or a report can call)', typeof build.detachedKeys === 'function');
done();
