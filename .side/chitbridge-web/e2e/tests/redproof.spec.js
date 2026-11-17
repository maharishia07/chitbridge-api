// RED-PROOF — the reviewer's rule: a test that can't go RED proves nothing. This one is GREEN normally, and RED when run
// with CB_REDPROOF=1 (it then asserts a DELIBERATELY WRONG locator), demonstrating the suite catches a broken/missing
// screen. Saturday: run it both ways to show red-on-break, green-on-fix, before counting any module "done".
const { test, expect } = require('@playwright/test');

test('[RED-01] RED-PROOF · the suite catches a broken screen', async ({ page }) => {
  await page.goto('/app.html');
  await page.getByText('Create an entity').click();   // entry is Sign-in-first → reach the onboarding welcome
  const testid = process.env.CB_REDPROOF ? 'onb-getstarted-DELIBERATELY-BROKEN' : 'onb-getstarted';
  await expect(page.getByTestId(testid)).toBeVisible();   // GREEN normally · RED with CB_REDPROOF=1
});
