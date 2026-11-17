// MODULE: Capture — WhatsApp / email / web inbound → chit. This is the pipeline test (transport SIMULATED via intake.html;
// real WhatsApp/email inbound needs a provider + number→entity map + HMAC secret — the webhooks exist but are inert).
// FLOW: open intake → login → simulate an inbound message → it lands in the inbox → (AI) structure → create chit.
// LOCATORS: cap-channel · cap-from · cap-text · cap-simulate · cap-structure · cap-create-chit  (+ #lg_email/#lg_otp/#lg_btn)
const { test, expect } = require('@playwright/test');
require('../fixtures').needCode(test);   // SEC1: no sign-in code for this target (E2E_TESTER_CODE) → the file SKIPS with a CI warning
const { uniqueEmail, DEV_OTP } = require('../fixtures');

test.describe('Module · Capture (WhatsApp / email → chit)', () => {
  test('[CAP-01] simulate an inbound message → it appears in the intake inbox', async ({ page }) => {
    const email = uniqueEmail();
    await test.step('open intake + login', async () => {
      await page.goto('/intake.html');
      await page.locator('#lg_email').fill(email);
      await page.locator('#lg_btn').click();                 // send code
      await page.locator('#lg_otp').fill(DEV_OTP);
      await page.locator('#lg_btn').click();                 // verify → inbox
      await expect(page.getByTestId('cap-text')).toBeVisible();
    });
    await test.step('simulate a WhatsApp message', async () => {
      await page.getByTestId('cap-channel').selectOption('whatsapp');
      await page.getByTestId('cap-from').fill('+919876543210');
      await page.getByTestId('cap-text').fill('Need 40 drums of white primer, deliver to Chennai next week');
      await page.getByTestId('cap-simulate').click();
      await expect(page.getByText(/white primer/i)).toBeVisible();   // capture card is in the inbox
    });
  });

  // Structure + create is AI-gated: invokeSkill('message-to-chit') needs ANTHROPIC_API_KEY (else 503).
  test.skip('[CAP-02] structure with AI → create chit (needs ANTHROPIC_API_KEY)', async ({ page }) => {
    // TODO: cap-structure → the AI draft renders → cap-create-chit → "Created chit on the rail".
  });
});
