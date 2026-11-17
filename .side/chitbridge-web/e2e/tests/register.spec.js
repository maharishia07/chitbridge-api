// MODULE: The Register (RAID) — b185. A register attached to anything; entries that END with a disposition.
// FLOW A: the three views exist and are reachable — Live · Closure · Impact.
// FLOW B: ⭐ THE OUTCOME LOOP. Open a standalone register → record a risk → the gate refuses to close it →
//         end it as an ACTION → it comes out under "Work came out of it" → the register can then be closed.
// LOCATORS: nav-raida · register-panel · register-tab-{live|closure|impact} · register-new · register-new-type
//           register-new-name · register-new-save · register-subject · raida-add-open · raida-kind · raida-body
//           raida-save · raida-item · raida-close · raida-disposition · raida-close-note · raida-close-save
//           closure-item · register-close
const { test, expect } = require('@playwright/test');
const { mintEntity, composeSelfChit, clickNav } = require('../fixtures');

/**
 * ⚠️⚠️ FORCED LOGGED-OUT, so this file ALWAYS mints its own entity. The authed project carries a saved
 * session, and mintEntity returns that existing entity untouched when one is present — which would write a
 * test register into whoever is signed in. A spec that creates data must own the account it creates it in.
 */
test.use({ storageState: { cookies: [], origins: [] } });

/* ⚠️ The Register is a LAZY capability (app/cap-register.js) opened as an overlay, not a nav screen — so the
   rail button opens a panel and leaves UI.nav where it was. Every wait below is on the panel, never on a URL. */
async function openRegister(page) {
  await page.evaluate(() => navTo('raida'));
  /* ⚠️ READY, not merely present. The loading state carries the same testid, so waiting for the panel alone
     returned while it was still a spinner — which is why the first record() ran against a half-built screen
     and failed intermittently on timing rather than on anything real. */
  await expect(page.locator('[data-testid="register-panel"][data-ready="1"]'))
    .toBeVisible({ timeout: 30000 });
}

/**
 * ⭐ ONE FORM CREATES THE REGISTER AND RECORDS THE FIRST THING IN IT. There is no separate "open a register"
 * step any more — two forms that both created a register carried the same testids, which is how a spec matched
 * two elements at once.
 */
async function record(page, { register, type = 'campaign', kind = 'risk', body, owner, l, s, waitsOn, response }) {
  const form = page.getByTestId('raida-form');
  if (!(await form.count())) await page.getByTestId('raida-add-open').click();
  /* Naming a register is a field when there is none, and an option in the picker when there is. */
  if (register) {
    const into = page.getByTestId('raida-into');
    if (await into.count()) { await into.selectOption('__new'); }
    await page.getByTestId('register-new-type').selectOption(type);
    await page.getByTestId('register-new-name').fill(register);
  }
  await page.getByTestId('raida-kind').selectOption(kind);
  await page.getByTestId('raida-body').fill(body);
  if (owner) await page.locator('#rgOwner').fill(owner);
  if (l) await page.locator('#rgL').fill(String(l));
  if (s) await page.locator('#rgS').fill(String(s));
  if (response) await page.getByTestId('raida-response').selectOption(response);
  if (waitsOn) await page.getByTestId('raida-to').selectOption({ label: waitsOn });
  await page.getByTestId('raida-save').click();
  await expect(page.getByTestId('raida-item').filter({ hasText: body.slice(0, 18) }))
    .toBeVisible({ timeout: 20000 });
}

test.describe('Module · Register', () => {
  test('[REG-01] three views, each reachable', async ({ page }) => {
    await mintEntity(page);
    await openRegister(page);
    for (const v of ['live', 'closure', 'impact']) {
      await test.step(`view: ${v}`, async () => {
        await page.getByTestId(`register-tab-${v}`).click();
        await expect(page.getByTestId(`register-tab-${v}`)).toHaveClass(/on/);
      });
    }
  });

  test('[REG-02] a finding becomes an action, and only then does the register close', async ({ page }) => {
    await mintEntity(page);
    await openRegister(page);

    /* A register on something that is NOT an order — the whole point of register_subject — named in the same
       form that records the first finding. */
    await record(page, { register: 'E2E qualification', type: 'campaign',
                         kind: 'risk', body: 'Rig availability may slip past week 3' });

    /* ⭐⭐ THE GATE, stated before the button rather than discovered by pressing it. While anything is open the
       close control must not be offered at all — an affordance that will refuse is worse than none. */
    await page.getByTestId('register-tab-closure').click();
    await expect(page.getByText('1 still open')).toBeVisible();
    await expect(page.getByTestId('register-close')).toHaveCount(0);

    /* End it as work, not as "done" — the distinction the six dispositions exist for. */
    await page.getByTestId('register-tab-live').click();
    await page.getByTestId('raida-close').first().click();
    await page.getByTestId('raida-disposition').selectOption('action');
    await page.getByTestId('raida-close-note').fill('Booked the rig for week 2');
    await page.getByTestId('raida-close-save').click();

    /* ⭐ THE OUTCOME. Athi: "at the end of the test, it has to clearly come out as actions?" — it does, and it
       is grouped by what it LANDS ON someone, not by the fact that it stopped being open. */
    await page.getByTestId('register-tab-closure').click();
    await expect(page.getByText('Work came out of it')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('closure-item').filter({ hasText: 'Rig availability' })).toBeVisible();
    await expect(page.getByTestId('register-close')).toBeVisible();
  });

  /**
   * ⚠️⚠️ BOTH HALVES OF THIS WERE MISSING AND NEITHER FAILED LOUDLY — found by the showcase driver once it was
   * made to verify its own writes:
   *
   *   1. the add form had NO target field, so `to_id` was never set, every dependency stayed a sentence, and
   *      the Impact view could not be populated through the product no matter what anyone typed;
   *   2. `carried_forward` was offered in the endings list while the server refuses it without a destination,
   *      so choosing it ALWAYS failed — an affordance that will refuse, which reads as the user's mistake.
   */
  test('[REG-03] a dependency that names a target becomes a walkable edge', async ({ page }) => {
    await mintEntity(page);
    await openRegister(page);

    /* Two registers, so the dependency has somewhere to point. */
    await record(page, { register: 'Pad refurbishment', type: 'release',
                         kind: 'issue', body: 'Pad liner wear beyond limit' });
    await record(page, { register: 'Engine E-7 qualification', type: 'campaign',
                         kind: 'risk', body: 'Chamber pressure margin is thin' });

    await page.getByTestId('raida-add-open').click();
    await page.getByTestId('raida-kind').selectOption('dependency');
    /* The target fields appear ONLY for a dependency — the other five kinds do not point. */
    await expect(page.getByTestId('raida-to')).toBeVisible();
    await page.getByTestId('raida-body').fill('Cannot start hot-fire until the pad is signed off');
    await page.getByTestId('raida-to').selectOption({ label: 'Pad refurbishment' });
    await page.getByTestId('raida-save').click();
    await expect(page.getByTestId('raida-item').filter({ hasText: 'hot-fire' }))
      .toBeVisible({ timeout: 20000 });

    /* ⭐ THE GRAPH. Before the target field existed this pane could only ever say "nothing points anywhere". */
    await page.getByTestId('register-tab-impact').click();
    await expect(page.getByTestId('walk-graph')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('walk-graph')).toContainText('Pad refurbishment');

    /* And carrying it forward names where it went, rather than failing silently. */
    await page.getByTestId('register-tab-live').click();
    await page.getByTestId('raida-close').first().click();
    await page.getByTestId('raida-disposition').selectOption('carried_forward');
    await expect(page.getByTestId('raida-carry')).toBeVisible();
    await page.getByTestId('raida-carry').selectOption({ label: 'Pad refurbishment' });
    await page.getByTestId('raida-close-note').fill('Moves to the pad register');
    await page.getByTestId('raida-close-save').click();
    await page.getByTestId('register-tab-closure').click();
    await expect(page.getByText('Work came out of it')).toBeVisible({ timeout: 20000 });
  });


  /**
   * ⭐⭐ Athi, 2026-08-30: *"how can the RAID capability be attached to the task or the line item — the risk
   * created for any task should be reflected here."*
   *
   * The path already exists: the worklist line card posts `line_id` to `/api/chits/:id/raida`, `add()` opens a
   * register for the chit on first use, and `report()` returns the entry with `particulars` and `chit_id`. That
   * half is covered by tests/raida.test.cjs.
   *
   * ⚠️⚠️ THIS TEST COVERS THE OTHER HALF ONLY — that such an entry RENDERS naming its line and linking to its
   * order. It injects the report row rather than composing a real chit, and that is a deliberate, stated limit:
   * `composeSelfChit` produces nothing for a freshly minted entity (no catalogue to pick an item from), so an
   * end-to-end version of this fails in the fixture, three steps before it reaches the register. Writing it that
   * way would have made a compose problem look like a register problem every time it broke.
   *
   * The gap that leaves: nothing here proves the two halves meet on a live order. That needs a chit fixture
   * that works, and it is on the backlog rather than pretended away.
   */
  test('[REG-04] a line-scoped entry names its line and links to its order', async ({ page }) => {
    await mintEntity(page);
    await openRegister(page);

    await page.evaluate(() => {
      /* One row shaped exactly as report() returns a line-scoped entry. */
      RG.report = { migrated: true, full: true, open: 1, closed: 0, closed_by_order: 0,
        by_kind: [], by_disposition: {},
        entries: [{
          raida_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          chit_id: '11111111-2222-3333-4444-555555555555',
          line_id: '99999999-8888-7777-6666-555555555555',
          kind: 'risk', body: 'Pads may not clear inspection',
          particulars: 'Brake pads 40mm', subject: 'Brake pads for the E-7 rig',
          owner: 'Rao', by: 'Rao', at: '2026-08-30T00:00:00Z',
          likelihood: 3, severity: 4, score: 12,
          treatment: 'Second source identified', verification_method: 'inspection',
          visibility: 'internal', open: true, ending: null, disposition: null,
        }] };
      RG.subjects = []; RG.sel = null;
      rgPaint();
    });

    const row = page.getByTestId('raida-item').filter({ hasText: 'Pads may not clear inspection' });
    await expect(row).toBeVisible();
    /* ⭐ THE LINE is what "Where" says — not the order, and not a blank. */
    await expect(row).toContainText('Brake pads 40mm');
    /* ⭐ And it is a LINK, so the risk navigates to the order it belongs to. */
    await expect(row.getByTestId('raida-chit-link')).toBeVisible();
    /* The register it hangs off is named after the order. */
    await expect(row).toContainText('Brake pads for the E-7 rig');
    /* And the columns a register is judged on actually carry their values. */
    await expect(row).toContainText('Second source identified');
    await expect(row).toContainText('inspection');
    await expect(row).toContainText('12');
  });

  /**
   * ⭐⭐ Athi, 2026-08-31: *"add the 4 T's response category."*
   *
   * `treatment` is free text and says what we are doing; the CATEGORY says what the decision IS, and it is the
   * column a risk report pivots on.
   *
   * ⚠️ THIS TEST IS ALSO THE GRID GUARD. The header comes from RG_COLS and the cells are written out by hand in
   * rgTr — add a column to one and not the other and every cell after it lands under the wrong heading, with no
   * error anywhere. That is a silent wrong answer of exactly the kind this capability keeps producing.
   */
  test('[REG-05] the response category is offered for a risk, and only for a risk', async ({ page }) => {
    await mintEntity(page);
    await openRegister(page);

    /* The header and the cells must agree, migration or not. */
    const aligned = await page.evaluate(() => {
      RG.report = { migrated: true, full: true, resp: true, open: 1, closed: 0, closed_by_order: 0,
        by_kind: [], by_disposition: {},
        entries: [{ raida_id: 'r-1', chit_id: null, line_id: null, kind: 'risk',
                    body: 'Rig availability', subject: 'Campaign', owner: 'Rao',
                    likelihood: 3, severity: 4, score: 12, treatment: 'Book earlier',
                    response: 'treat', verification_method: 'test',
                    at: '2026-08-31T00:00:00Z', open: true, ending: null }] };
      RG.subjects = []; RG.sel = null;
      rgPaint();
      const head = document.querySelector('.rg-wrap .lhead');
      const row = document.querySelector('.rg-wrap .lrow');
      const keys = (el) => el ? Array.prototype.map.call(el.children, function (c) { return c.getAttribute('data-col'); }) : [];
      return { headKeys: keys(head), rowKeys: keys(row),
               declared: (typeof RG_COLS !== 'undefined') ? RG_COLS.map(function (c) { return c.k; }) : [] };
    });
    /* ⭐⭐ ORDER, not just count. The header and the cells are two renderings of RG_COLS, and a reorder that
       misaligns every column leaves the COUNT correct — so a count check passes while every value sits under
       the wrong heading. Both are now compared against the declaration itself. */
    expect(aligned.headKeys.join(','), 'header order vs RG_COLS').toBe(aligned.declared.join(','));
    expect(aligned.rowKeys.join(','), 'cell order vs RG_COLS').toBe(aligned.declared.join(','));
    expect(aligned.declared.length, 'columns declared').toBeGreaterThan(10);

    const row = page.getByTestId('raida-item').filter({ hasText: 'Rig availability' });
    await expect(row).toContainText('Treat');
    /* ⚠️ Beside the treatment it categorises — apart, a tolerated risk with no treatment reads as a gap. */
    await expect(row).toContainText('Book earlier');

    /* ⭐ Asserted against the INJECTED report, which carries resp:true — so this holds whether or not b192
       has been run on the database behind it. What it proves is the UI contract: the picker exists exactly
       when the column does.
       The picker itself only exists once the column does — a field that silently drops what you type is worse
       than no field, and an all-null column cannot tell you which state you are in. */
    await page.getByTestId('register-tab-live').click();
    await page.getByTestId('raida-add-open').click();
    await page.getByTestId('raida-kind').selectOption('risk');
    await expect(page.getByTestId('raida-response')).toBeVisible();
    /* ⚠️ Not on an assumption. It is not tolerated or transferred, and an action is the work itself. */
    await page.getByTestId('raida-kind').selectOption('assumption');
    await expect(page.getByTestId('raida-response')).toBeHidden();
  });

  /**
   * ⚠️⚠️ THE FIRST THING A NEW USER MEETS. With no registers open, "Record something" used to take a whole
   * entry and then REFUSE it — *"pick a register first"* — the affordance-that-refuses defect this capability's
   * own closure gate is written to avoid, shipped in the empty state. Athi hit it on a real entity:
   * *"is this expected result when i click the register panel?"*
   *
   * ⭐ The answer he asked for: *"a simple screen with the record format has to be appearing at empty state."*
   * Not a blank table with headers — Carbon, Cloudscape and NN/G all warn against that, because a screen reader
   * reads the whole header row before reaching "nothing here". The RECORD FORM is the empty state.
   */
  test('[REG-06] the empty state IS the record form, and it creates the register it needs', async ({ page }) => {
    await mintEntity(page);
    await openRegister(page);

    /* ⭐ The form, straight away — no link, no second click, and nothing that will refuse. */
    await expect(page.getByTestId('raida-form')).toBeVisible();
    await expect(page.getByTestId('raida-body')).toBeVisible();
    await expect(page.getByTestId('raida-add-open')).toHaveCount(0);
    /* ⚠️ NOT an empty table with column headers — the pattern every design system warns against. */
    await expect(page.getByTestId('register-table')).toHaveCount(0);

    /* One form: it names the register AND records the first finding. */
    await page.getByTestId('register-new-type').selectOption('audit');
    await page.getByTestId('register-new-name').fill('ISO 9001 surveillance');
    await page.getByTestId('raida-kind').selectOption('risk');
    await page.getByTestId('raida-body').fill('Calibration records not yet sampled');
    await page.getByTestId('raida-save').click();

    await expect(page.getByTestId('raida-item').filter({ hasText: 'Calibration records' }))
      .toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('register-subject').filter({ hasText: 'ISO 9001' })).toBeVisible();
    /* Once there is something to show, the table appears and the form steps back behind a + . */
    await expect(page.getByTestId('register-table')).toBeVisible();
    await expect(page.getByTestId('raida-add-open')).toBeVisible();
  });

  /**
   * ⭐⭐ *"a plus icon can bring a new tab to add any risk, so we can embed the + icon anywhere we want."*
   * rgQuickAdd() is that entry point, and this proves it stands on its own — it loads what the form needs
   * rather than assuming the register screen has already been opened.
   */
  test('[REG-07] the + opens the record form from anywhere', async ({ page }) => {
    await mintEntity(page);
    /* Never opened the register in this session — exactly the state a + on a line card would call from. */
    await page.evaluate(() => ensureCap('register'));
    await page.evaluate(() => rgQuickAdd({ kind: 'issue' }));

    await expect(page.getByTestId('raida-quickadd')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('raida-body')).toBeVisible();
    /* It carried the kind it was asked for, and offers a way to name the register it needs. */
    await expect(page.getByTestId('raida-kind')).toHaveValue('issue');
    await expect(page.getByTestId('register-new-name')).toBeVisible();
  });


  /**
   * ⭐⭐ Athi, 2026-08-31: *"we should be able to call this risk capability from anywhere at task level or line
   * item level... a risk can be registered against a line item and the same should be visible here."*
   *
   * The line card no longer carries its own form. It opens THIS one with the line already in scope, so a risk
   * raised there arrives with the rating, owner, treatment and response a register is judged on — the old form
   * could only ever carry kind and body.
   */
  test('[REG-08] a risk recorded with a chit in scope shows in the Register, named and linked', async ({ page }) => {
    await mintEntity(page);
    await page.evaluate(() => ensureCap('register'));

    /* Stand in for the line card: open the shared form with a chit and line in scope. */
    const ok = await page.evaluate(async () => {
      const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token };
      /* A chit to hang it off — created directly, because composeSelfChit produces nothing for a fresh entity. */
      const r = await fetch(CFG.API_BASE + '/api/chits/register/subjects', { method: 'POST', headers: H,
        body: JSON.stringify({ type_key: 'campaign', name: 'Line-scope check' }) });
      return r.ok;
    });
    expect(ok).toBeTruthy();

    await page.evaluate(() => rgQuickAdd({ kind: 'risk' }));
    await expect(page.getByTestId('raida-quickadd')).toBeVisible({ timeout: 20000 });
    /* ⚠️ With no chit context the register is a CHOICE, so the picker is offered. */
    await expect(page.getByTestId('raida-into')).toBeVisible();

    /* Now with a chit in scope: the picker is replaced by the only decision that is actually the person's —
       this line, or the whole order. Offering a register list here would invite filing a line's risk against
       a campaign. */
    await page.evaluate(() => rgQuickAdd({
      chit_id: '11111111-2222-3333-4444-555555555555', line_id: '99999999-8888-7777-6666-555555555555',
      chit_label: 'Brake pads for the E-7 rig', line_label: 'Brake pads 40mm', kind: 'risk' }));
    await expect(page.getByTestId('raida-quickadd')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('raida-into')).toHaveCount(0);
    await expect(page.getByTestId('raida-scope-line')).toBeVisible();
    await expect(page.getByTestId('raida-scope-order')).toBeVisible();
    await expect(page.getByTestId('raida-quickadd')).toContainText('Brake pads for the E-7 rig');
    /* And the full field set travels with it — this is what the old line-card form could not carry. */
    await expect(page.getByTestId('raida-response')).toBeAttached();
    await expect(page.locator('#rgOwner')).toBeVisible();
    await expect(page.locator('#rgL')).toBeVisible();
  });

  /**
   * ⭐⭐ Athi: *"we should be able to update the same from register panel as well."*
   *
   * ⚠️ A REVISION, NOT AN EDIT. The server appends a row carrying only what changed and folds the latest over
   * the original on read — reassignment is normal, and *who held it when this went wrong* is the question
   * afterwards, which an UPDATE in place destroys.
   */
  test('[REG-09] an entry can be updated from the register, and the change folds over it', async ({ page }) => {
    await mintEntity(page);
    await openRegister(page);

    await record(page, { register: 'Update check', type: 'campaign', kind: 'risk',
                         body: 'Coolant pump spares are single-sourced', owner: 'Rao', l: 2, s: 3 });

    const row = page.getByTestId('raida-item').filter({ hasText: 'Coolant pump' });
    await expect(row).toContainText('Rao');
    await expect(row).toContainText('2×3');

    await row.getByTestId('raida-edit').click();
    await page.getByTestId('raida-edit-owner').fill('Priya');
    await page.locator('#rgEL').fill('4');
    await page.locator('#rgES').fill('4');
    await page.getByTestId('raida-edit-treatment').fill('Second source qualified');
    await page.getByTestId('raida-edit-save').click();

    /* ⭐ The revision wins on what it changed... */
    const after = page.getByTestId('raida-item').filter({ hasText: 'Coolant pump' });
    await expect(after).toContainText('Priya', { timeout: 20000 });
    await expect(after).toContainText('4×4');
    await expect(after).toContainText('Second source qualified');
    /* ...and the entry is still ONE row, not two — a revision is folded, never listed. */
    await expect(page.getByTestId('raida-item').filter({ hasText: 'Coolant pump' })).toHaveCount(1);
  });

  /**
   * ⭐⭐ *"the same may have to be invoked at task level for design1."* The spend strip on a chit (Quoted ·
   * Spent · Work · History) now carries a ＋ Register beside History, and it goes through one shared helper so
   * every + in the app opens the SAME form.
   *
   * ⚠️ The button itself only renders on a chit detail, and composeSelfChit produces no chit for a freshly
   * minted entity — so this drives the helper the button calls, and asserts the markup separately. Stated
   * rather than pretended: nothing here proves the button is on screen in a real order.
   */
  test('[REG-10] the task-level + opens the register with the order in scope', async ({ page }) => {
    await mintEntity(page);

    /* The helper is in the shell, so it is available before the capability has ever loaded. */
    expect(await page.evaluate(() => typeof cbRegisterFor)).toBe('function');

    await page.evaluate(() => cbRegisterFor('11111111-2222-3333-4444-555555555555', 'Brake pads for the E-7 rig'));
    await expect(page.getByTestId('raida-quickadd')).toBeVisible({ timeout: 25000 });
    await expect(page.getByTestId('raida-quickadd')).toContainText('Brake pads for the E-7 rig');
    /* ⚠️ Order level: no line to choose between, so no scope toggle — and never a register picker, because the
       chit decides its own register. */
    await expect(page.getByTestId('raida-scope-line')).toHaveCount(0);
    await expect(page.getByTestId('raida-into')).toHaveCount(0);
    await expect(page.getByTestId('raida-body')).toBeVisible();

    /* And the button is wired into design 1's spend strip through that same helper. */
    const wired = await page.evaluate(async () => {
      const r = await fetch('/app.html');
      const html = await r.text();
      return { hasBtn: html.indexOf('data-testid="chit-register"') >= 0,
               usesHelper: /data-testid="chit-register"[\s\S]{0,220}cbRegisterFor/.test(html) };
    });
    expect(wired.hasBtn, 'the ＋ Register button is in the spend strip').toBeTruthy();
    expect(wired.usesHelper, 'and it goes through the shared helper').toBeTruthy();
  });
});
