#!/usr/bin/env node
/**
 * e2e/walk-settings.cjs - CB SETTINGS, WALKED (SET1, 2026-10-13: settings.html + app/cap-shop.js + app/cap-country.js mounted in its pane).
 * Black box: it presses what an owner presses - Your shop (the Business fields + the business identity rows the till reads the state from),
 * Save, a refused Save, Country (CS1's rows) and Continue - and reads what the screen says. A FIXTURE shop; the API is a stand-in answering
 * inside the page, so nothing leaves the runner and nothing is written anywhere.
 * Then RULE 13 (owner, 13 Oct): both sections, in Cream (light) and Dark, at 1366 and 390 px - AA contrast of every text element
 * (lib/theme-measure.cjs, the same eyes as crm-themes / standards-page), no clipped text, no inner sideways scroll, no fixed control over
 * content, no link to app.html, and the copy within the text budget (no doc defines one yet: a hint or line of copy is at most 140
 * characters and two sentences - said here, so the number is visible).
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-settings.cjs      headless
 *   node e2e/walk-settings.cjs --show                                watch it
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-settings-NN.png.
 */
'use strict';
const W = require('./lib/walk.cjs');
const { measure } = require('./lib/theme-measure.cjs');
const C = require('./lib/contract.cjs');   /* M43: every answer for a route in the API contract is held to it (RAIL-LAB-SRV1: the facts family) */
const J = C.json;
const crmApi = require('./lib/crm-api.cjs');   /* RAIL-LAB-SRV1: the rail card (GET /api/facts/rail) from its one builder */

const walk = async (w) => {
  const { page, ctx, base } = w;
  const S = { calls: [], refuseSave: false, csDone: false };
  const ME = { display_name: 'Fixture Shop', gstn: '33AABCK1234F1Z6', address: '12 Bazaar Street, Madurai', business_status: 'active', currency_code: 'INR', country_code: 'IN' };
  const VAULT = { sections: [{ type: 'identity', label: '', rows: [
    { name: 'Legal name', tag: 'legal_name', value: 'Fixture Shop Pvt Ltd' }, { name: 'Address', tag: 'address', value: '12 Bazaar Street' },
    { name: 'City', tag: 'city', value: 'Madurai' }, { name: 'State', tag: 'state', value: 'Tamil Nadu' }, { name: 'PIN / ZIP', tag: 'pincode', value: '625001' }] }] };
  const CS = () => ({ migrated: true, done: S.csDone, required: !S.csDone, country: { code: 'IN', name: 'India' }, currency: 'INR', fy_start_month: 4,
    tax: { registered: true, number: '33AABCK1234F1Z6', scheme: 'gst' }, source: {}, pack: { id: 'IN', version: '1.0.0', books: true, code: null, why: null } });

  await ctx.route('**/api/**', async (r) => {
    const q = r.request(), p = new URL(q.url()).pathname, m = q.method();
    let body = null; try { body = q.postData() ? JSON.parse(q.postData()) : null; } catch (_) {}
    if (m !== 'GET') S.calls.push(m + ' ' + p + (body ? ' ' + JSON.stringify(body) : ''));
    if (p === '/api/entities/me') return J(r, 200, { entity: ME });
    if (p === '/api/entities/profile' && m === 'PATCH') {
      if (S.refuseSave) return J(r, 403, { message: 'Only the owner can change the shop details.' });
      Object.assign(ME, body); return J(r, 200, { ok: true });
    }
    if (p === '/api/governance/profile' && m === 'GET') return J(r, 200, { vault: VAULT, vault_version: 'v7', vault_encrypted: true });
    if (p === '/api/governance/profile/vault' && m === 'PUT') return J(r, 200, { vault: VAULT, version: 'v8' });
    if (p === '/api/governance/country-setup') { if (m === 'PUT') S.csDone = true; return J(r, 200, CS()); }
    if (p === '/api/facts/rail') return J(r, 200, crmApi.railFacts({ suppliers: 0, customers: 0, in: 0, out: 0, stuck: 0 }));
    return J(r, 200, {});
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const wrote = (re) => S.calls.filter((c) => re.test(c)).length;
  const shop = async () => { await page.goto(base + '/settings.html#/shop'); await page.waitForSelector('[data-testid="shop-card"]', { timeout: 20000 }); await page.waitForSelector('[data-testid="vault-only-identity"]', { timeout: 10000 }); await page.waitForTimeout(300); };
  const country = async () => { await page.goto(base + '/settings.html#/country'); await page.waitForSelector('[data-testid="cs-rows"]', { timeout: 20000 }); await page.waitForTimeout(300); };

  await shop();
  await w.step('T1', 'CB Settings -> Your shop: the GSTIN and address the bill prints, and the business identity with its state and PIN', async () => {
    const card = await page.$eval('[data-testid="shop-card"]', (n) => [...n.querySelectorAll('input,textarea')].map((i) => i.value).join(' | ')).catch(() => '');
    const idv = await page.$eval('[data-testid="vault-only-identity"]', (n) => [...n.querySelectorAll('input,textarea,select')].map((i) => i.value).join(' | ')).catch(() => '');
    return { ok: /33AABCK1234F1Z6/.test(card) && /Bazaar/.test(card) && /Tamil Nadu/.test(idv) && /625001/.test(idv), saw: 'shop: ' + card.slice(0, 70) + ' · identity: ' + idv.slice(0, 70) };
  });
  await w.step('T2', 'Your shop -> change the address -> Save -> one PATCH, "Shop details saved."', async () => {
    const before = wrote(/PATCH \/api\/entities\/profile/);
    await page.fill('#pf_addr', '14 Bazaar Street, Madurai'); await page.press('#pf_addr', 'Tab'); await page.waitForTimeout(1300);   /* WALK-REG 2026-10-16 R19: no Save button - the field saves itself, "Saved" beside it */
    const n = wrote(/PATCH \/api\/entities\/profile/) - before, toast = await txt('[data-testid="saved-pf_addr"]'), hidden = await page.$eval('[data-testid="shop-save"]', (b) => getComputedStyle(b).display === 'none');
    return { ok: n === 1 && /14 Bazaar/.test(S.calls[S.calls.length - 1] || '') && /Saved/.test(toast) && hidden, saw: n + ' PATCH; beside the field "' + toast + '"; Save hidden ' + hidden };
  });
  await w.step('T3', 'Your shop -> Save refused by the server -> its sentence painted under the fields, never a raw error', async () => {
    S.refuseSave = true; await shop();
    await page.fill('#pf_addr', '15 Bazaar Street'); await page.press('#pf_addr', 'Tab'); await page.waitForTimeout(1300);   /* WALK-REG 2026-10-16 R19: autosave */
    const e = await txt('[data-testid="shop-err"]'); S.refuseSave = false;
    return { ok: /Only the owner can change the shop details/.test(e) && !/403|undefined|Error/.test(e), saw: '"' + e + '"' };
  });
  /* SET-WALK1 W25: Save sends a MERGE-PATCH of what moved (nothing moved → nothing sent, said in words); the state row's change travels alone, with the version */
  await w.step('T4', 'Your shop -> the identity card -> Save with nothing changed -> no PUT, "Nothing to save."; change the state -> one PUT: the version + a patch of that row only', async () => {
    await shop(); const before = S.calls.filter((c) => /PUT \/api\/governance\/profile\/vault/.test(c)).length;
    await page.$eval('[data-testid="vault-save"]', (b) => b.click()); await page.waitForTimeout(500); const none = S.calls.filter((c) => /PUT \/api\/governance\/profile\/vault/.test(c)).length === before, toast = await txt('#toast');
    const st = page.locator('[data-testid="vault-only-identity"] input[value="Tamil Nadu"]'); await st.fill('Kerala'); await st.press('Tab'); await page.waitForTimeout(1300);   /* WALK-REG 2026-10-16 R19: autosave on change; the hidden Save still answers "Nothing to save." above */   /* WALK-REG 2026-10-16: found by its value — the section label input is gone on Your business */
    const put = S.calls.filter((c) => /PUT \/api\/governance\/profile\/vault/.test(c)).pop() || '';
    return { ok: none && /Nothing to save/.test(toast) && /"version":"v7"/.test(put) && /"t:state":\{[^}]*Kerala/.test(put) && !/Tamil Nadu/.test(put) && !/legal_name/.test(put), saw: 'no PUT ' + none + ' · "' + toast + '" · ' + put.slice(40, 200) };
  });
  await w.step('T5', 'Settings -> Country: the rows (country · money · year · tax), each with where it came from; the sidebar marks Country', async () => {
    await page.click('text=Country >> nth=0').catch(() => {}); await page.waitForSelector('[data-testid="cs-rows"]', { timeout: 10000 });
    const c = await txt('[data-testid="cs-val-country"]'), t = await txt('[data-testid="cs-title"]');
    return { ok: /India/.test(c) && /Country setup/.test(t) && /#\/country$/.test(page.url()), saw: t + ' · ' + c + ' · ' + page.url().replace(base, '') };
  });
  await w.step('T6', 'Country -> Continue -> one PUT, "Country set." and back to Your shop (never to the workshop)', async () => {
    await page.click('[data-testid="cs-save"]'); await page.waitForSelector('[data-testid="shop-card"]', { timeout: 8000 });
    return { ok: wrote(/PUT \/api\/governance\/country-setup/) === 1 && /settings\.html#\/shop$/.test(page.url()), saw: wrote(/PUT \/api\/governance\/country-setup/) + ' PUT · now at ' + page.url().replace(base, '') };
  });
  /* FX-QA1 (QA-W1 finding 3): the field words come from the shop's country pack (helpers.js packWord), never a typed "GSTIN" / "PIN" */
  await w.step('T6A', 'Your shop in Australia · the UAE · India -> the pack\'s words: ABN · Postcode / TRN · P.O. Box · Emirate / GSTIN · PIN', async () => {
    const words = async (cc) => {
      ME.country = cc; ME.country_code = cc;
      await page.goto(base + '/settings.html?cc=' + cc + '#/shop'); await page.waitForSelector('[data-testid="vault-only-identity"]', { timeout: 20000 }); await page.waitForTimeout(300);   /* a fresh load: a same-hash goto keeps the page */
      return page.evaluate(() => ({ lic: (document.querySelector('label.fl') || {}).textContent || '', why: '' /* WALK-REG 2026-10-16: shop-why removed by decision */,
        sug: [...document.querySelectorAll('#vsug_identity option')].map((o) => o.value).join(',') }));
    };
    const au = await words('AU'), ae = await words('AE'), ind = await words('IN');
    const ok = /^ABN/.test(au.lic) && !/GSTIN|PIN/.test(au.lic + au.why + au.sug) && /Postcode/.test(au.sug)
      && /^TRN/.test(ae.lic) && !/GSTIN|PIN/.test(ae.lic + ae.why + ae.sug) && /P\.O\. Box/.test(ae.sug) && /Emirate/.test(ae.sug)
      && /^GSTIN/.test(ind.lic) && /,PIN,/.test(ind.sug);
    return { ok, saw: 'AU "' + au.lic.split(' ')[0] + '" · "' + au.why.trim() + '" · ' + au.sug.split(',').slice(4, 6) + ' | AE "' + ae.lic.split(' ')[0] + '" · ' + ae.sug.split(',').slice(4, 6) + ' | IN "' + ind.lic.split(' ')[0] + '" · "' + ind.why.trim() + '"' };
  });

  /* ── RULE 13: two themes × two widths × two sections ── */
  const audit = () => page.evaluate(() => {
    const host = document.getElementById('set'), out = { clip: [], frameClip: [], scroll: [], cover: [], app: [], budget: [] };
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    document.querySelectorAll('body *').forEach((el) => {
      if (!vis(el) || el.closest('#cb-avatar,#toast,script,style')) return;
      const cs = getComputedStyle(el), hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
      if (/auto|scroll/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el !== document.documentElement && el !== document.body) out.scroll.push(el.tagName + '.' + el.className + ' ' + el.scrollWidth + '>' + el.clientWidth);
      if (hasText && (cs.textOverflow === 'ellipsis' || /hidden|clip/.test(cs.overflowX)) && el.scrollWidth > el.clientWidth + 1) (host.contains(el) ? out.clip : out.frameClip).push(el.textContent.trim().slice(0, 40));
      const href = (el.getAttribute('href') || '') + ' ' + (el.getAttribute('onclick') || '');
      if (/app\.html/.test(href)) out.app.push(el.outerHTML.slice(0, 80));
    });
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.scroll.push('page ' + document.documentElement.scrollWidth + '>' + window.innerWidth);
    /* a fixed/sticky control over content: the centre of every control in the pane must hit the control itself */
    host.querySelectorAll('button,input,select,textarea,a').forEach((c) => {
      if (!vis(c)) return; c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && hit !== c && !c.contains(hit) && !hit.contains(c) && !hit.closest('#toast')) out.cover.push((c.dataset.testid || c.id || c.tagName) + ' under ' + (hit.id || hit.className || hit.tagName));
    });
    host.querySelectorAll('p,.hint,.sub,.err').forEach((n) => {
      const t = n.textContent.replace(/\s+/g, ' ').trim(); if (!t) return;
      const sentences = t.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length;
      if (t.length > 140 || sentences > 2) out.budget.push(t.length + ' chars / ' + sentences + ' sentences: "' + t.slice(0, 50) + '…"');
    });
    window.scrollTo(0, 0);
    return out;
  });
  let k = 0; const frameClip = new Set();
  for (const theme of ['cream', 'dark']) {
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      for (const sec of ['shop', 'country']) {
        k++;
        await w.step('T' + (6 + k), sec + ' · ' + theme + ' · ' + width + ' px -> AA contrast, no clipping, no inner sideways scroll, nothing floating over a control, no app.html link, copy in budget', async () => {
          if (sec === 'shop') await shop(); else await country();
          await page.evaluate((t) => { CBAvatar.applyTheme(t); }, theme); await page.waitForTimeout(150);
          const pairs = await page.evaluate(measure), bad = pairs.filter((x) => !x.grad && x.ratio < x.need);
          const a = await audit();
          const fails = [].concat(bad.map((x) => 'contrast ' + x.ratio + ' "' + x.text + '"'), a.clip.map((x) => 'clipped "' + x + '"'), a.scroll.map((x) => 'scroll ' + x),
            a.cover.map((x) => 'covered ' + x), a.app.map((x) => 'app.html ' + x), a.budget.map((x) => 'budget ' + x));
          a.frameClip.forEach((x) => frameClip.add(x));
          return { ok: !fails.length && pairs.length > 5,   /* WALK-REG 2026-10-16: fewer texts on the slimmer page */ saw: pairs.length + ' texts measured, lowest ' + Math.min.apply(null, pairs.map((x) => x.ratio)) + (fails.length ? ' · ' + fails.slice(0, 4).join(' · ') : ' · clean') };
        });
      }
    }
  }
  await page.evaluate(() => { CBAvatar.applyTheme('cream'); }).catch(() => {});
  /* the shared frame (page-frame.js / shell.js) ellipsises the shop's name in its top bar on a phone — on every small app (employees.html the same); said, not hidden */
  if (frameClip.size) w.note('T15', 'the shared frame\'s top bar at 390 px (not this page\'s pane)', 'ellipsised: ' + [...frameClip].join(' · '));
  if (w.errs.length) w.note('T99', 'page errors seen during the walk', w.errs.slice(0, 3).join(' | '));
};
walk.opts = { viewport: { width: 1366, height: 900 } };
W.run('settings', walk);
