// MODULE: Helpdesk / Assistant — the reviewer's FIRST Playwright flow (clean, deterministic; no open-source pieces).
// FLOW A (runnable now): mint → open the assistant → ask a library question → a deterministic answer shows (no LLM).
// FLOW B (skeleton): a helpdesk publishes a Q&A (KB) → a user asks → the published answer serves live.
// LOCATORS: assistant-open · assist-input · assist-ask · assist-suggest-* · nav-assistreview · kb-question/answer/context/publish/new
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');

test.describe('Module · Helpdesk / Assistant', () => {
  test('[HELP-01] open the assistant and ask — deterministic library answer', async ({ page }) => {
    await mintEntity(page);
    await expect(page.getByTestId('nav-compose')).toBeVisible();   // app shell loaded
    await test.step('open the assistant', async () => {
      await page.getByTestId('assistant-open').click();
      await expect(page.getByTestId('assist-input')).toBeVisible();
    });
    await test.step('ask a question → an answer renders', async () => {
      await page.getByTestId('assist-input').fill('how do I assign a task?');
      await page.getByTestId('assist-ask').click();
      await expect(page.locator('#assist_ans')).not.toBeEmpty();   // deterministic library floor answered
    });
  });

  // KB publish → serve-live needs a HELPDESK entity (the 🧠 Assistant / nav-assistreview screen is gated to helpdesks).
  test.skip('[HELP-02] KB: publish an answer, then it serves live (needs a helpdesk entity)', async ({ page }) => {
    // TODO(Step 3): sign in as the helpdesk entity → getByTestId('nav-assistreview').click()
    //   → kb-question.fill(...) → kb-answer.fill(...) → kb-publish.click()
    //   → assistant-open → assist-input.fill(same question) → assist-ask → expect the published answer.
  });
});
