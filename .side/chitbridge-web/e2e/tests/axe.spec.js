// AXE (reviewer §2) — keyboard operation depends on the a11y substrate: every interactive element focusable + labelled,
// a VISIBLE focus indicator, and adequate contrast. Runs axe-core on each screen and reports violations; the focus/label
// ones are the keyboard-critical ones to fix. Free, integrates with Playwright. Runs at the counter viewport (config).
const { test, expect } = require('@playwright/test');
const A = require('../lib/a11y-check.cjs');   /* the ONE axe check: vendored + pinned (e2e/vendor/axe-core), no npm axe dependency */
const TAGS = ['wcag2a', 'wcag2aa'];   /* this spec's long-standing level; the full WCAG 2.2 AA baseline is e2e/a11y-axe-report.cjs */
const { mintEntity } = require('../fixtures');

function report(label, results) {   /* results: A.check's shape, v.count = nodes */
  const crit = results.violations.filter(v => ['critical', 'serious'].includes(v.impact));
  console.log(`AXE ${label}: ${results.violations.length} violations (${crit.length} critical/serious)`);
  results.violations.forEach(v => console.log(`  - [${v.impact}] ${v.id}: ${v.help} (${v.count} nodes)`));
  const kbd = results.violations.filter(v => /focus|label|aria|name|tabindex|keyboard/i.test(v.id));
  if (kbd.length) console.log(`  KEYBOARD-CRITICAL (focus/label): ${kbd.map(v => v.id).join(', ')}`);
  return crit;
}

test.describe('Accessibility (axe) · the keyboard substrate', () => {
  test('[AXE-01] entry / sign-in screen — no critical a11y violations', async ({ page }) => {
    await page.goto('/app.html');
    const crit = report('entry', await A.check(page, { tags: TAGS }));
    expect(crit, 'critical/serious a11y violations on the entry screen').toHaveLength(0);
  });

  test('[AXE-02] app shell (after mint) — no critical a11y violations', async ({ page }) => {
    await mintEntity(page);
    const crit = report('app-shell', await A.check(page, { tags: TAGS }));
    expect(crit, 'critical/serious a11y violations in the app shell').toHaveLength(0);
  });

  test('[AXE-03] compose modal — no critical a11y violations (the counter\'s core form)', async ({ page }) => {
    await mintEntity(page);
    await page.getByTestId('nav-compose').click();
    const crit = report('compose', await A.check(page, { include: '#modalhost', tags: TAGS }));
    expect(crit, 'critical/serious a11y violations in the compose form').toHaveLength(0);
  });
});
