// check-syntax.js — validate the inline JS in public/app.html + the public/app/*.js modules.
// app.html is a monolith with one big inline <script>; node --check can't see it, so we extract + vm.Script it.
// Run:  node scripts/check-syntax.js   (exit 1 on any syntax error)
/*
 * OWNS      the syntax check of the inline JS in public/app.html and the public/app/*.js modules
 * CALLED BY package.json:10 (check:syntax); .github/workflows/ci.yml:33
 * FLOW      extract the inline scripts -> vm.Script each -> exit 1 on any syntax error
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/walks-and-the-e2e-harness
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;

// 1) inline <script> blocks in EVERY public/*.html page (skip external src= ones).
// Not just app.html: shop.html is the customer-facing storefront and carries its own inline script — a syntax error
// there is just as fatal, and it used to sail past this check.
const pubDir = path.join(root, 'public');
for (const page of fs
  .readdirSync(pubDir)
  .filter((item) => item.endsWith('.html'))
  .sort()) {
  const html = fs.readFileSync(path.join(pubDir, page), 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m,
    index = 0,
    count = 0;
  while ((m = re.exec(html)) !== null) {
    if (/\bsrc\s*=/.test(m[1] || '')) continue;
    index++;
    try {
      new vm.Script(m[2], { filename: `${page}#inline-${index}` });
    } catch (e) {
      failed++;
      count++;
      console.log('SYNTAX FAIL  ' + page + ' inline #' + index + ': ' + e.message);
    }
  }
  console.log(page + ': ' + index + ' inline script(s) — ' + (count ? 'FAIL' : 'OK'));
}

// 2) the JS modules under public/app/
const appDir = path.join(root, 'public', 'app');
if (fs.existsSync(appDir)) {
  for (const f of fs.readdirSync(appDir).filter((item) => item.endsWith('.js'))) {
    try {
      new vm.Script(fs.readFileSync(path.join(appDir, f), 'utf8'), { filename: 'app/' + f });
      console.log('public/app/' + f + ' — OK');
    } catch (e) {
      failed++;
      console.log('SYNTAX FAIL  public/app/' + f + ': ' + e.message);
    }
  }
}

if (failed) {
  console.log('\ncheck-syntax: FAIL (' + failed + ')');
  process.exit(1);
}
console.log('check-syntax: PASS');
