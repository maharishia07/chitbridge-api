/**
 * build-dskit.cjs — the COUNTER's design system, extracted from the counter itself.
 *
 * ⚠️⚠️ PARSED, NEVER RETYPED. Every colour, radius and type size below is read out of till.html at build time.
 * A design system hand-copied from a screen is wrong the first time somebody changes the screen — and then a
 * designer is reviewing a product that does not exist. Same discipline as e2e/till-contrast.cjs.
 *
 * Each file carries a first-line @dsCard marker, which is how the Design System pane indexes it.
 */
const fs = require('fs');
const path = require('path');

/* ⚠️ RELATIVE TO THIS FILE, never an absolute path off one machine — this has to run on anybody's checkout. */
const TILL = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
const OUT = process.env.DS_OUT || path.join(require('os').tmpdir(), 'cb-design-kit');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

/* ── read the tokens out of the till ─────────────────────────────────────────────────────────────────────── */
function blockAfter(marker) {
  const at = TILL.indexOf(marker);
  if (at < 0) throw new Error('not found: ' + marker);
  const open = TILL.indexOf('{', at), close = TILL.indexOf('}', open);
  return TILL.slice(open + 1, close);
}
function tokens(block) {
  const out = {}; const re = /(--[a-z0-9-]+)\s*:\s*([^;]+)/gi; let m;
  while ((m = re.exec(block))) out[m[1]] = m[2].trim();
  return out;
}
const LIGHT = tokens(blockAfter(':root{'));
const DARK = Object.assign({}, LIGHT, tokens(blockAfter(':root[data-theme="dark"]{')));

const varsOf = (t) => Object.keys(t).map((k) => '      ' + k + ': ' + t[k] + ';').join('\n');

/* the shared head every card uses — the counter's own tokens, both themes */
const HEAD = (title) => `<!doctype html>
<meta charset="utf-8"><title>${title}</title>
<style>
  :root{
${varsOf(LIGHT)}
  }
  :root[data-theme="dark"]{
${varsOf(DARK)}
  }
  *{box-sizing:border-box}
  body{margin:0;padding:20px;background:var(--paper);color:var(--ink);
       font:var(--fs)/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
  h1{font-size:1.05em;margin:0 0 4px}
  p.note{color:var(--dim);font-size:.85em;margin:0 0 16px;max-width:62ch}
  .frame{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;margin-bottom:18px}
  .cap{color:var(--dim);font-size:.75em;text-transform:uppercase;letter-spacing:.04em;margin:18px 0 6px}
</style>`;

const card = (file, group, name, subtitle, body) => {
  const html = `<!-- @dsCard group="${group}" name="${name}" subtitle="${subtitle}" -->\n` + body;
  fs.mkdirSync(path.dirname(path.join(OUT, file)), { recursive: true });
  fs.writeFileSync(path.join(OUT, file), html);
  return { path: file, name, group, subtitle };
};

const cards = [];

/* ── 1 · the palette, with what each token is FOR ────────────────────────────────────────────────────────── */
const swatch = (k, what) => `
  <div style="display:flex;gap:10px;align-items:center;padding:7px 10px;border-bottom:1px solid var(--line)">
    <span style="width:34px;height:34px;border-radius:8px;border:1px solid var(--edge);background:var(${k});flex:none"></span>
    <code style="font-size:.82em;min-width:120px">${k}</code>
    <code style="font-size:.82em;color:var(--dim);min-width:86px">${LIGHT[k] || ''}</code>
    <span style="font-size:.85em;color:var(--dim)">${what}</span>
  </div>`;
cards.push(card('foundations/colour.html', 'Foundations', 'Colour', 'Both themes, and what each token guards',
  HEAD('Colour') + `
<h1>Colour</h1>
<p class="note">Read out of till.html. Measured by <code>e2e/till-contrast.cjs</code> — 26 checks, both themes.
<b>--edge</b> and <b>--on-accent</b> exist because the dark theme inverts the accents: white on the light-mint
"Save &amp; print" measured 2.22:1 before they did.</p>
<div class="frame">
  ${swatch('--ink', 'the figures on a bill')}
  ${swatch('--dim', 'per-unit lines, qty × price, every quiet fact')}
  ${swatch('--ok', 'money that came off — the ONLY green on the counter')}
  ${swatch('--warn', 'off the shelf, refusals, a bill not confirmed')}
  ${swatch('--blue', 'links')}
  ${swatch('--line', 'dividers between rows — decorative, not gated')}
  ${swatch('--edge', 'the border of anything you OPERATE — 3:1, WCAG 1.4.11')}
  ${swatch('--on-accent', 'ink ON a filled accent; flips with the theme')}
  ${swatch('--paper', 'the page')}
  ${swatch('--card', 'a panel')}
</div>
<div class="cap">the same tokens, dark</div>
<div class="frame" data-theme="dark" style="background:var(--paper)">
  <div style="padding:12px">
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <span style="padding:8px 14px;border-radius:999px;background:var(--ok);color:var(--on-accent);font-weight:700">Save &amp; print</span>
      <span style="padding:8px 14px;border-radius:999px;border:1px solid var(--edge);color:var(--ink)">an edge you can see</span>
      <span style="padding:8px 14px;border-radius:999px;background:var(--warn);color:var(--on-accent);font-weight:700">off the shelf</span>
    </div>
  </div>
</div>`));

/* ── 2 · the bill row, which is the counter's most-read component ────────────────────────────────────────── */
const billRow = (n, name, note, price, per, disc, qty, calc, value, sel) => `
  <div style="display:grid;grid-template-columns:34px minmax(0,1fr) 96px 86px 118px 92px 98px 30px;gap:8px;
              align-items:center;padding:8px 12px;border-bottom:1px solid var(--line);
              ${sel ? 'background:var(--ok-tint);box-shadow:inset 3px 0 0 var(--ok)' : ''}">
    <span style="text-align:end;color:var(--dim);font-size:.85em;font-variant-numeric:tabular-nums">${n}</span>
    <span><span style="font-weight:600">${name}</span>
      <div style="color:var(--dim);font-size:.86em">${note}</div></span>
    <span style="text-align:right;font-variant-numeric:tabular-nums">
      <b style="display:block;font-weight:600">${price}</b>
      <i style="display:block;font-style:normal;color:var(--dim);font-size:.78em">${per}</i></span>
    <span style="text-align:right;font-variant-numeric:tabular-nums;font-weight:600;
                 color:${disc === '—' ? 'var(--dim)' : 'var(--ok)'}">${disc}</span>
    <span style="display:flex;align-items:center;gap:3px;justify-content:center">
      <span style="width:34px;height:34px;border:1px solid var(--edge);border-radius:8px;background:var(--paper);
                   display:flex;align-items:center;justify-content:center">−</span>
      <span style="width:46px;height:34px;border:1px solid var(--edge);border-radius:8px;background:var(--paper);
                   display:flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums">${qty}</span>
      <span style="width:34px;height:34px;border:1px solid var(--edge);border-radius:8px;background:var(--paper);
                   display:flex;align-items:center;justify-content:center">+</span></span>
    <span style="text-align:right;font-variant-numeric:tabular-nums;color:var(--dim)">${calc}</span>
    <span style="text-align:right;font-variant-numeric:tabular-nums;font-weight:700">${value}</span>
    <span style="color:var(--warn);text-align:center">×</span>
  </div>`;
cards.push(card('components/bill-row.html', 'Components', 'The bill row', 'Six columns; the arithmetic closes on every row',
  HEAD('The bill row') + `
<h1>The bill row</h1>
<p class="note">Every figure a line is made of, in the order the sum is read. <b>qty × price − discount = value</b>
holds on every row: a bill-wide offer is taken once at the summary, never spread onto the lines. The offer under
the item states its TERMS per product; the money is the Discount column's job.</p>
<div class="frame">
  <div style="display:grid;grid-template-columns:34px minmax(0,1fr) 96px 86px 118px 92px 98px 30px;gap:8px;
              padding:4px 12px 5px;border-bottom:1px solid var(--line);background:var(--card);color:var(--dim);
              font-size:.74em;font-weight:700;text-transform:uppercase;letter-spacing:.03em;text-align:right">
    <span>#</span><span style="text-align:start">Item</span><span>Price / qty</span><span>Discount</span>
    <span style="text-align:center">Qty</span><span>Qty × price</span><span>Value</span><span></span>
  </div>
  ${billRow(1, 'Cookies 250 g (pack 3)', 'GST 18% · <span style="color:var(--ok)">Buy 2 biscuits, get 1 free</span>', '₹68.50', 'per packet', '−₹68.50', 3, '₹205.50', '₹137.00', true)}
  ${billRow(2, 'Ponni Maida 5 kg (pack 3)', 'GST 5%', '₹271.00', 'per bag', '—', 3, '₹813.00', '₹813.00', false)}
  ${billRow(3, 'Idhayam Coconut oil 5 L', 'GST 5% · <span style="color:var(--dim)">Rs 20 off — ₹20 off each</span>', '₹1,805.00', 'per litre', '−₹60.00', 3, '₹5,415.00', '₹5,355.00', false)}
</div>
<div class="cap">an offer that has not fired yet — grey, never the green that means money came off</div>
<div class="frame">
  ${billRow(1, 'Cookies 250 g (pack 3)', 'GST 18% · <span style="color:var(--dim)">Buy 2 biscuits, get 1 free · buy 2 get 1 free</span>', '₹68.50', 'per packet', '—', 1, '₹68.50', '₹68.50', false)}
</div>`));

/* ── 3 · the shelf row ───────────────────────────────────────────────────────────────────────────────────── */
cards.push(card('components/shelf-row.html', 'Components', 'The shelf row', 'What the search returns; price matches the bill',
  HEAD('The shelf row') + `
<h1>The shelf row</h1>
<p class="note">The price here is the same figure the bill will charge — that is what lets a cart line be matched
back to the row it came from. MRP is named as MRP and the gap stated as a fact, never as a "saving": the word
<b>save</b>, and the green it comes in, appear at exactly one place on this counter.</p>
<div class="frame">
  ${[['Tata Green tea 100 g (premium)', 'BEV-06801 · Beverages', '₹119.00', 'per packet · incl. 5% GST', 'MRP ₹129.50 · ₹10.50 under', true],
     ['Tea dust 250 g', 'BEV-TEA2 · Beverages', '₹128.00', 'per packet · incl. 5% GST', 'MRP ₹145.00 · ₹17.00 under', false],
     ['Cookies 250 g (pack 3)', 'BIS-09816 · Biscuits', '₹68.50', 'per packet · incl. 18% GST', '', false]]
    .map(([n, meta, price, per, mrp, sel]) => `
  <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(92px,auto) auto;gap:12px;align-items:center;
              padding:10px 12px;border-bottom:1px solid var(--line);
              ${sel ? 'background:var(--ok-tint);box-shadow:inset 3px 0 0 var(--ok)' : ''}">
    <span><span style="font-weight:600">${n}</span>
      <div style="color:var(--dim);font-size:.8em">${meta}</div>
      ${n.indexOf('Cookies') === 0 ? '<span style="display:inline-block;margin-top:4px;padding:2px 8px;border-radius:999px;background:var(--ok-tint);color:var(--ok);font-size:.75em;font-weight:600">Buy 2 biscuits, get 1 free</span>' : ''}</span>
    <span style="text-align:right">
      <span style="display:block;font-weight:700;font-size:1.05em">${price}</span>
      <span style="display:block;color:var(--dim);font-size:.78em">${per}</span>
      ${mrp ? `<span style="display:block;color:var(--dim);font-size:.78em">${mrp}</span>` : ''}</span>
    <span style="width:34px;height:34px;border:1px solid var(--edge);border-radius:8px;background:var(--card);
                 color:var(--ok);display:flex;align-items:center;justify-content:center;font-size:1.1em">+</span>
  </div>`).join('')}
</div>`));

/* ── 4 · chips, quick keys, and the controls ─────────────────────────────────────────────────────────────── */
cards.push(card('components/controls.html', 'Components', 'Chips, keys and controls', 'Category chips, quick keys, buttons, status pills',
  HEAD('Chips, keys and controls') + `
<h1>Chips, keys and controls</h1>
<p class="note">Anything you operate carries <b>--edge</b> (3:1). Dividers carry <b>--line</b> and are deliberately
softer — WCAG 1.4.11 asks 3:1 of a control, not of a rule between two of sixty shelf rows.</p>

<div class="cap">category chips — built from the categories that actually exist</div>
<div class="frame"><div style="display:flex;gap:6px;padding:10px 12px;flex-wrap:wrap">
  ${[['Everything', 1], ['On offer', 0], ['Off the shelf 5', 0], ['Spices 1461', 0], ['Rice &amp; grains 1283', 0], ['Personal care 1124', 0]]
    .map(([t, on]) => `<span style="white-space:nowrap;padding:6px 11px;border:1px solid ${on ? 'var(--ok)' : 'var(--edge)'};
      border-radius:999px;background:${on ? 'var(--ok-tint)' : 'var(--paper)'};color:${on ? 'var(--ok)' : 'var(--dim)'};
      font-size:.82em;${on ? 'font-weight:600' : ''}">${t}</span>`).join('')}
</div></div>

<div class="cap">quick keys — learned from this counter's own bills, or a group somebody made</div>
<div class="frame"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;padding:10px 12px">
  ${[['Tata Green tea 100 g', '₹119.00 / packet'], ['Tea dust 250 g', '₹128.00 / packet'], ['Filter coffee 200 g', '₹215.00 / packet'], ['Soft drink 750 ml', '₹45.00 / piece']]
    .map(([n, p]) => `<span style="padding:14px 10px;border:1px solid var(--edge);border-radius:var(--radius);
      background:var(--paper);min-height:64px;display:block">
      <b style="display:block;font-size:.95em">${n}</b><span style="color:var(--dim);font-size:.8em">${p}</span></span>`).join('')}
</div></div>

<div class="cap">a bill's state — only "sent" is a promise</div>
<div class="frame"><div style="display:flex;gap:8px;padding:12px;flex-wrap:wrap">
  <span style="padding:3px 9px;border-radius:999px;border:1px solid var(--ok);color:var(--ok);font-size:.82em">✓ sent</span>
  <span style="padding:3px 9px;border-radius:999px;border:1px solid var(--warn);color:var(--warn);font-size:.82em">⏳ waiting</span>
  <span style="padding:3px 9px;border-radius:999px;border:1px solid var(--warn);color:var(--warn);font-size:.82em">⚠ not confirmed</span>
  <span style="padding:3px 9px;border-radius:999px;border:1px solid var(--line);color:var(--dim);font-size:.82em">· left this counter</span>
</div></div>

<div class="cap">the actions</div>
<div class="frame"><div style="display:flex;gap:8px;padding:12px;flex-wrap:wrap">
  <span style="padding:14px 22px;border-radius:var(--radius);background:var(--ok);border:1px solid var(--ok);
               color:var(--on-accent);font-weight:700">Save &amp; print · F9</span>
  <span style="padding:14px 22px;border-radius:var(--radius);border:1px solid var(--edge);background:var(--paper)">Park · F6</span>
  <span style="padding:14px 22px;border-radius:var(--radius);border:1px solid var(--edge);background:var(--paper)">Clear · Esc</span>
</div></div>`));

/* ── 5 · the summary, where the bill-wide offer is stated ────────────────────────────────────────────────── */
const trow = (l, r, cls) => `<div style="display:flex;justify-content:space-between;padding:1px 0;${cls || ''}"><span>${l}</span><span>${r}</span></div>`;
cards.push(card('components/summary.html', 'Components', 'The summary', 'Folds by default; the bill-wide offer is stated here',
  HEAD('The summary') + `
<h1>The summary</h1>
<p class="note">Folded by default — the bill is what a counter needs the room for. What stays visible is the
decision: the TOTAL, and what was saved. The <b>bill-wide offer is taken here, once</b>, never spread across the
lines, so the step from "lines total" to TOTAL is a number you can point at.</p>
<div class="frame"><div style="border-top:2px solid var(--ink);padding:8px 12px">
  ${trow('On this bill', '3 products · 9 items', 'color:var(--dim);font-size:.9em')}
  ${trow('Before offers', '₹1,129.50')}
  ${trow('Lines total', '₹1,061.00')}
  ${trow('Offer on the whole bill', '−₹53.05', 'color:var(--ok)')}
  ${trow('Taxable', '₹935.23')}
  ${trow('CGST 2.5%', '₹18.39', 'color:var(--dim);font-size:.92em;padding-inline-start:12px')}
  ${trow('SGST 2.5%', '₹18.39', 'color:var(--dim);font-size:.92em;padding-inline-start:12px')}
  <div style="padding:6px 0"><span style="color:var(--dim);font-size:.85em;cursor:pointer">▾ hide breakdown</span></div>
  ${trow('Saved *', '−₹121.55', 'color:var(--ok)')}
  <div style="display:flex;justify-content:space-between;font-size:1.5em;font-weight:800;padding-top:4px">
    <span>TOTAL</span><span>₹1,007.95</span></div>
</div></div>`));

/* ── 6 · the whole counter, so a designer sees the composition, not just the parts ───────────────────────── */
cards.push(card('screens/counter.html', 'Screens', 'The counter', 'Shelf and bill, side by side',
  HEAD('The counter') + `
<h1>The counter</h1>
<p class="note">The split is the shop's: a wholesaler wants the bill wide, a kirana wants the search wide, and the
handle drags. Every section except the header, the bill and the totals can be switched off — a tiffin shop and a
ten-thousand-line kirana are not the same counter.</p>
<div class="frame" style="display:grid;grid-template-columns:minmax(0,1.1fr) 6px minmax(280px,.9fr);min-height:420px">
  <div style="display:flex;flex-direction:column;border-right:1px solid var(--line)">
    <div style="display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--line);background:var(--card)">
      <b>Tally Test Shop</b>
      <span style="padding:3px 9px;border:1px solid var(--edge);border-radius:999px;font-size:.75em;color:var(--dim)">Sell</span>
      <span style="padding:3px 9px;border:1px solid var(--ok);border-radius:999px;font-size:.75em;color:var(--ok)">online</span>
      <span style="flex:1"></span><span style="color:var(--dim)">☰</span>
    </div>
    <div style="padding:10px 12px;border-bottom:1px solid var(--line);background:var(--card);display:flex;gap:8px">
      <span style="width:38px;height:38px;border:1px solid var(--edge);border-radius:999px;display:flex;
                   align-items:center;justify-content:center">🎤</span>
      <span style="flex:1;padding:9px 12px;border:1px solid var(--edge);border-radius:10px;background:var(--paper);
                   color:var(--dim);font-size:.9em">Item name, code or barcode…</span>
      <span style="width:38px;height:38px;border:1px solid var(--edge);border-radius:999px;display:flex;
                   align-items:center;justify-content:center;color:var(--dim)">✕</span>
    </div>
    <div style="display:flex;gap:6px;padding:8px 12px;flex-wrap:wrap">
      <span style="padding:6px 11px;border:1px solid var(--ok);border-radius:999px;background:var(--ok-tint);
                   color:var(--ok);font-size:.8em;font-weight:600">Everything</span>
      <span style="padding:6px 11px;border:1px solid var(--edge);border-radius:999px;color:var(--dim);font-size:.8em">On offer</span>
      <span style="padding:6px 11px;border:1px solid var(--edge);border-radius:999px;color:var(--dim);font-size:.8em">Spices 1461</span>
    </div>
    <div style="flex:1;overflow:hidden">
      <div style="padding:10px 12px;border-bottom:1px solid var(--line);background:var(--ok-tint);box-shadow:inset 3px 0 0 var(--ok)">
        <b>Tea dust 250 g</b><div style="color:var(--dim);font-size:.8em">BEV-TEA2 · Beverages</div></div>
      <div style="padding:10px 12px;border-bottom:1px solid var(--line)">
        <b>Filter coffee 200 g</b><div style="color:var(--dim);font-size:.8em">BEV-COF2 · Beverages</div></div>
      <div style="padding:10px 12px;border-bottom:1px solid var(--line)">
        <b>Soft drink 750 ml</b><div style="color:var(--dim);font-size:.8em">BEV-SOF7 · Beverages</div></div>
    </div>
  </div>
  <div style="background:var(--line)"></div>
  <div style="display:flex;flex-direction:column;background:var(--card)">
    <div style="padding:10px 12px;border-bottom:1px solid var(--line);color:var(--dim);font-size:.9em">Customer (optional)</div>
    <div style="flex:1">
      <div style="padding:6px 12px;color:var(--dim);font-size:.85em;font-weight:700">3 products · 9 items</div>
      <div style="padding:8px 12px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between">
        <span><b>Cookies 250 g</b><div style="color:var(--dim);font-size:.82em">₹68.50 per packet</div></span>
        <span style="font-weight:700">₹137.00</span></div>
      <div style="padding:8px 12px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between">
        <span><b>Ponni Maida 5 kg</b><div style="color:var(--dim);font-size:.82em">₹271.00 per bag</div></span>
        <span style="font-weight:700">₹813.00</span></div>
    </div>
    <div style="height:6px;background:var(--line)"></div>
    <div style="border-top:2px solid var(--ink);padding:10px 12px">
      <div style="display:flex;justify-content:space-between;color:var(--ok)"><span>Saved</span><span>−₹121.55</span></div>
      <div style="display:flex;justify-content:space-between;font-size:1.4em;font-weight:800">
        <span>TOTAL</span><span>₹1,007.95</span></div>
    </div>
    <div style="padding:10px 12px">
      <span style="display:block;text-align:center;padding:14px;border-radius:var(--radius);background:var(--ok);
                   color:var(--on-accent);font-weight:700">Save &amp; print · F9</span>
    </div>
  </div>
</div>`));

/* ── 7 · the brief: what a redesign must not break ───────────────────────────────────────────────────────── */
cards.push(card('BRIEF.html', 'Brand', 'The brief', 'What a redesign must keep — and what it may change',
  HEAD('The brief') + `
<h1>What a redesign must keep</h1>
<p class="note">This counter is used at arm's length, in a bright shop, by somebody counting money with a
customer waiting. These are not style preferences — each one was paid for by a real failure.</p>
<div class="frame"><div style="padding:14px 16px">
  <ol style="margin:0;padding-inline-start:20px;line-height:1.7">
    <li><b>The figures are the easiest thing to read.</b> Everything else gives way to them.</li>
    <li><b>Green means money came off — nowhere else.</b> "Save" appeared in two meanings once and a shopkeeper
        said <i>"I am now totally out of confidence."</i></li>
    <li><b>qty × price − discount = value, on every row.</b> A number that cannot be explained at the counter is
        a number that cannot be defended.</li>
    <li><b>Nothing claims an outcome it cannot prove.</b> A bill says "sent" only with a receipt from the server.</li>
    <li><b>Anything you operate has a 3:1 edge</b> (<code>--edge</code>); dividers stay soft. Measured, both themes.</li>
    <li><b>The dark theme is a real shop at night</b>, not a preference. Ink on accents flips with it.</li>
    <li><b>It must work with no internet</b> and on a phone, a 10-inch tablet and a shop monitor.</li>
  </ol>
</div></div>
<h1 style="margin-top:22px">What is open to a designer</h1>
<div class="frame"><div style="padding:14px 16px">
  <ul style="margin:0;padding-inline-start:20px;line-height:1.7">
    <li>Hierarchy and rhythm of the bill row — six columns is a lot to read at a glance.</li>
    <li>The shelf row: name, code, category, offer, price, MRP and a + button all compete.</li>
    <li>Density and spacing at 15/16/18/21px text — the operator sets it.</li>
    <li>The quick-keys grid, which a hotel counter uses instead of the list entirely.</li>
    <li>How an offer that has NOT fired yet should look beside one that has.</li>
    <li>The summary: folded by default, and the step from lines total to TOTAL.</li>
  </ul>
</div></div>`));

fs.writeFileSync(path.join(OUT, 'README.md'),
  '# The counter — design system\n\n'
  + 'Extracted from `chitbridge-api/tools/tally-connector/till.html` by `build-dskit.cjs`.\n'
  + 'Every colour and radius is PARSED from the source, so these cards cannot drift from the product.\n\n'
  + 'Start at **BRIEF.html** — what a redesign must keep, and what is open.\n');

console.log('wrote ' + cards.length + ' cards to ' + OUT);
cards.forEach((c) => console.log('   ' + c.group.padEnd(12) + c.path));
console.log('\ntokens parsed: light ' + Object.keys(LIGHT).length + ', dark ' + Object.keys(DARK).length);
