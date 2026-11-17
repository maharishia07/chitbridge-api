'use strict';
/**
 * tests/sec-75-actor-settings-entity.test.cjs — SEC-75 P1 slice: entity_actor_settings is under RLS (b842), so every statement that names it
 * runs on a client bound to the shop (withEntity). Offline: reads the source.
 * CARD 28-platform-and-operations/rls-census
 *
 * OWNS       the rule "no bare query on entity_actor_settings": each SQL statement naming it sits inside a withEntity(...) callback.
 * CALLED BY  scripts/guards.cjs
 * FLOW       api source → each statement naming the table → nearest withEntity( above it, same function → must exist
 */
const fs = require('fs'),
  path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0,
  fail = 0;
const check = (name, cond, extra) => {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.error('  ✗ ' + name + (extra ? '   ' + extra : ''));
  }
};

const SQL_VERB = /(FROM|INTO|UPDATE)\s+entity_actor_settings\b/;
const BARE = /(?:^|[^.\w])(db|query|pool)\(/; /* a bare db( / query( / pool( call: not through a bound client */

/** the statement is inside a withEntity callback when a withEntity( opens above it and no function-level db( call sits between */
function unbound(file) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  const bad = [];
  lines.forEach((line, i) => {
    if (!SQL_VERB.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) return;
    let j = i,
      bound = false,
      bare = false;
    for (; j >= Math.max(0, i - 60); j--) {
      if (/withEntity\(/.test(lines[j]) || /async function \w+\(client/.test(lines[j]) || /\(client, entity_id\)/.test(lines[j])) {
        bound = true;
        break;
      }
      if (BARE.test(lines[j]) && !/withEntity/.test(lines[j])) {
        bare = true;
        break;
      }
    }
    if (!bound || bare) bad.push(file + ':' + (i + 1));
  });
  return bad;
}
const FILES = ['routes/actors.js', 'routes/chits.js', 'lib/workpattern.js', 'lib/workroute.js'];
const bad = FILES.flatMap(unbound);
check('every statement on entity_actor_settings runs under withEntity (' + FILES.length + ' files)', bad.length === 0, bad.join(', '));

/* planted specimen: the checker itself catches a bare query */
const tmp = path.join(ROOT, 'tests', '.sec75-specimen.tmp.js');
fs.writeFileSync(tmp, 'const r = await db(`SELECT x FROM entity_actor_settings WHERE entity_id = $1`, [e]);\n');
check('the checker flags a bare db() read (red specimen)', unbound('tests/.sec75-specimen.tmp.js').length === 1);
fs.unlinkSync(tmp);

/* nothing else in the api names the table */
const walk = (d) =>
  fs
    .readdirSync(path.join(ROOT, d), { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? /node_modules|migrations|tests|\.git/.test(e.name)
          ? []
          : walk(path.join(d, e.name))
        : /\.(js|cjs)$/.test(e.name)
          ? [path.join(d, e.name)]
          : []
    );
const others = ['routes', 'lib', 'src', 'middleware', 'scripts']
  .filter((d) => fs.existsSync(path.join(ROOT, d)))
  .flatMap(walk)
  .map((f) => f.split(path.sep).join('/'))
  .filter((f) => !FILES.includes(f) && SQL_VERB.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
check('no other file reads or writes entity_actor_settings', others.length === 0, others.join(', '));

console.log('\n  ' + (fail ? '✗ ' + fail + ' failed' : '✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
