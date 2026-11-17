/* fixture — a web e2e stand-in: it opens a page by string, deep-links a nav and evaluates a function by name */
'use strict';
async function run(page) {
  await page.goto('http://127.0.0.1:1/app.html#/app/pay');
  await page.evaluate(() => payScreen());
}
module.exports = { run };
