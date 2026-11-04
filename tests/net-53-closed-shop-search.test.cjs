'use strict';
/**
 * tests/net-53-closed-shop-search.test.cjs — NET-53: a CLOSED shop is not searched inside its network (no database: reads the SQL text).
 * b833 re-states public.network_search() with one more filter. This proves the file keeps everything the baseline function has, and adds the closed filter.
 * Real-database proof: tests/network-truth.realstack.cjs NW-09 (runs on SIT).
 * OWNS: the b833 text check. CALLED BY: scripts/guards.cjs. CARD 04-network/README
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, 'migrations', f), 'utf8');
const base = read('000_baseline_2026-10-21.sql'), mig = read('b833_network_search_closed_shop.sql');
let n = 0, f = 0;
const check = (name, cond) => { n++; if (!cond) { f++; console.log('FAIL ' + name); } };
const norm = (s) => s.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
/** the function text: from CREATE [OR REPLACE] FUNCTION public.network_search up to its END $$; */
function fnOf(text) {
  const m = /CREATE (?:OR REPLACE )?FUNCTION public\.network_search[\s\S]*?\nEND \$\$;/.exec(text);
  return m ? m[0] : '';
}
const head = (fn) => norm(fn.slice(0, fn.indexOf('AS $$'))).replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION');
const bf = fnOf(base), mf = fnOf(mig);
check('baseline function found', bf.length > 500);
check('b833 function found', mf.length > 500);
check('signature, return list, language, SECURITY DEFINER and search_path are the baseline\'s', head(bf) === head(mf) && head(mf).length > 200);
check('SECURITY DEFINER kept', /SECURITY DEFINER/.test(mf));
check('search_path kept', /SET search_path TO 'public', 'pg_temp'/.test(mf));
check('network-only filter kept (path <@ v_root)', /e\.path <@ v_root/.test(mf));
check('visibility filter kept (public, network)', /i\.catalogue_visibility IN \('public', 'network'\)/.test(mf));
check('active identity filter kept', /i\.status = 'active'/.test(mf) && /ci\.is_active = true/.test(mf));
check('the closed filter is present, on the column and values the baseline defines', /AND coalesce\(i\.business_status, 'open'\) <> 'closed'/.test(mf)
  && /business_status character varying\(10\) DEFAULT 'open'/.test(base) && /ARRAY\['open'::character varying, 'closed'::character varying/.test(base));
check('the filter sits in the WHERE of the query, before ORDER BY', mf.indexOf("<> 'closed'") > mf.indexOf('WHERE e.path') && mf.indexOf("<> 'closed'") < mf.indexOf('ORDER BY'));
check('the only code change is that one filter', norm(mf.replace(/\n\s*AND coalesce\(i\.business_status, 'open'\) <> 'closed'/, '')) === norm(bf).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'));
check('cites NET-53 and Athi\'s line', /NET-53/.test(mf) && /network \+ closed, not visible to network also/.test(mf));
check('in one transaction', /^BEGIN;$/m.test(mig) && /^COMMIT;$/m.test(mig) && mig.indexOf('BEGIN;') < mig.indexOf('CREATE OR REPLACE FUNCTION') && mig.indexOf('CREATE OR REPLACE FUNCTION') < mig.indexOf('\nCOMMIT;'));
check('dropped first and the grant restored for cb_app, as the baseline has it', /DROP FUNCTION IF EXISTS public\.network_search\(text, text, integer\);/.test(mig) && /REVOKE ALL ON FUNCTION public\.network_search\([^)]*\) FROM PUBLIC;/.test(mig) && /GRANT EXECUTE ON FUNCTION public\.network_search\([^)]*\) TO cb_app;/.test(mig));
check('draft header', /DRAFT — NOT RUN IN PRODUCTION · Athi runs it/.test(mig));
check('COMMENT re-stated with the new sentence', /COMMENT ON FUNCTION public\.network_search\(p_caller_bridge text, p_q text, p_limit integer\) IS '[^]*NET-53/.test(mig));
const rb = mig.slice(mig.indexOf('-- ROLLBACK (run')).split('\n').map((l) => l.replace(/^-- ?/, '')).join('\n');
check('the ROLLBACK section restores the baseline body exactly, without the filter', norm(fnOf(rb)) === norm(bf).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION') && !/<> 'closed'/.test(fnOf(rb)));
check('no NUL byte', !mig.includes('\u0000'));
console.log(n + ' checks, ' + f + ' failed');
process.exitCode = f ? 1 : 0;
