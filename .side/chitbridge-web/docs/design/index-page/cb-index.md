# ChitBridge — index page

Build the page in the `html` block at the end. Standalone, no dependencies. Tokens in `:root`.

Screenshots: `index-with-alerts.png` · `index-all-well.png` · `index-phone.png`

---

## The idea

An index page earns its place by **explaining the system through how it is arranged**, not by
writing a paragraph about it. So the arrangement carries the model:

```
DAY TO DAY      Till          Catalogue        Accounts
                sells it      describes it     records it

LABS            Product · Offer · Combo · Tax
                work the number out first — nothing changes until you say so
```

Three boxes you live in, four labs you visit. That is the whole explanation, and it is
one sentence at the top:

> One shop, one set of numbers. The counter sells it, the catalogue describes it, the books record
> it — and the Labs are where you work a number out before any of them see it.

## Why the Labs are a family, not four more tiles

Seven equal tiles in a grid would say nothing. The Labs are **different in kind** from the other
three: they are sandboxes. Nothing a Lab computes reaches a bill until it is applied. That
distinction is the product's whole idea, so it gets its own tinted band, its own caption, and
smaller boxes — subordinate to the three, not equal to them.

## Every box carries a live fact

A tile with only a name is a menu item. A tile with a number is a reason to come back:

| Box | Facts |
|---|---|
| Till | `● Counter 1 open` · `12 bills · ₹4,280 today` |
| Catalogue | `112 products · 7 shelves` · `1 with no cost written down` |
| Accounts | `Books up to 26 Sep` · `3 bills not sent up` |
| Product Lab | `1 without a cost` |
| Offer Lab | `1 draft waiting` |
| Combo Lab | `3 combos · 10 modifiers` |
| Tax Lab | `no GSTIN — cash memos` |

**A fact that is a problem is amber**, and it is the same number as the alert above it — the
Catalogue's `1 with no cost` and Product Lab's `1 without a cost` are one fact seen from two doors.
Never let them disagree.

## Alerts, above everything

Only a failing thing earns a row — rule 6. When nothing is wrong the block is empty and the page is
three boxes and four labs, **123 px shorter**. Each alert carries the button that fixes it (rule 5)
and reuses the shape already designed for the till header, so the two screens agree.

## What is deliberately not here

- **No paragraphs about ChitBridge.** The shopkeeper opening this is not being sold to.
- **No equal-weight grid.** The hierarchy is the explanation.
- **No sales or volume figures beyond what the till already knows today.** Consistent with the Lab
  rule: if a number needs to know how much you sell over a period, it is not on this page.
- **Settings are a footer row**, not a box. Your shop, counters, co-assists, suppliers, connectors
  — visited rarely, so they do not take a tile each.

## Checks

1. Three boxes under `Day to day`; four under `Labs`. The Labs sit in a tinted band.
2. With no alerts, the alert block renders nothing at all — no empty container, no border.
3. Catalogue's "no cost" count and Product Lab's "without a cost" count come from one source.
4. Every alert has a fix button.
5. `document.scrollWidth === 390` at phone width; boxes stack, labs go one per row.
6. Under 250 words on the page.

---

## The file

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ChitBridge</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=IBM+Plex+Mono:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
:root{
  --page:#FCFAF5; --card:#FFFFFF; --panel:#F3EFE6;
  --line:#DDD6C6; --line-soft:#E6E0D2; --hair:#F0ECE2;
  --ink:#1D1B16; --muted:#5E594D; --faint:#8A8374; --ghost:#A8A295;
  --green:#16693F; --green-d:#0D4A2B; --green-t:#E8F4ED; --green-b:#A9D3BC;
  --amber:#E0A020; --amber-t:#FDF3DC; --amber-b:#EFD39A; --amber-i:#7A5205;
  --red:#C4562F; --red-t:#FBEAE3; --red-b:#E7B9A8; --red-i:#8E3517;
  --blue:#2F74C9; --blue-t:#E4EEFA; --blue-b:#B9D2EF; --blue-i:#174A87;
}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);
  font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:15px;line-height:1.45}
button,a{font:inherit;color:inherit} button{cursor:pointer}
.wrap{max-width:1080px;margin:0 auto;padding:26px 22px 60px}

/* ── head ─────────────────────────────────────────────────────────────── */
.top{display:flex;align-items:center;gap:13px;margin-bottom:6px;flex-wrap:wrap}
.brand{font-family:'Bricolage Grotesque',sans-serif;font-size:26px;font-weight:800;
  letter-spacing:-.025em;margin:0}
.shop{font-size:13.5px;color:var(--faint)}
.grow{flex:1}
.avatar{width:34px;height:34px;border-radius:50%;background:var(--panel);border:1px solid var(--line);
  display:grid;place-items:center;font-size:12px;font-weight:700;color:var(--muted)}
/* one sentence. The arrangement does the rest of the explaining. */
.idea{font-size:14.5px;color:var(--muted);margin:0 0 20px;max-width:56ch}

/* ── anything wrong, before anything else ─────────────────────────────── */
.alerts{display:flex;flex-direction:column;gap:8px;margin-bottom:22px}
.al{display:flex;align-items:center;gap:11px;padding:11px 15px;border-radius:12px;font-size:13.5px}
.al .ic{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;
  font-size:12px;font-weight:800;color:#fff;flex:0 0 auto}
.al b{font-weight:700}
.al .fix{margin-left:auto;height:32px;padding:0 13px;border-radius:9px;border:1px solid currentColor;
  background:rgba(255,255,255,.55);font-size:12.5px;font-weight:700;white-space:nowrap}
.al.bad{background:var(--red-t);border:1px solid var(--red-b);color:var(--red-i)}
.al.bad .ic{background:var(--red-i)}
.al.warn{background:var(--amber-t);border:1px solid var(--amber-b);color:var(--amber-i)}
.al.warn .ic{background:var(--amber-i)}

/* ── the three you work in ────────────────────────────────────────────── */
.cap{display:flex;align-items:center;gap:11px;margin:0 0 11px}
.cap b{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--ghost);font-weight:700}
.cap i{flex:1;height:1px;background:var(--line-soft);font-style:normal}
.cap span{font-size:12.5px;color:var(--faint)}

.main{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:28px}
.box{display:block;width:100%;text-align:left;background:var(--card);border:1px solid var(--line);
  border-radius:15px;padding:18px 19px;position:relative;transition:border-color .12s,transform .12s}
.box:hover{border-color:var(--green);transform:translateY(-1px)}
.box .g{width:42px;height:42px;border-radius:12px;background:var(--panel);display:grid;
  place-items:center;font-size:19px;color:var(--muted);margin-bottom:13px}
.box h3{font-family:'Bricolage Grotesque',sans-serif;font-size:19px;font-weight:800;
  letter-spacing:-.015em;margin:0}
.box .what{font-size:13.5px;color:var(--muted);margin:3px 0 0;line-height:1.35}
.box .facts{display:flex;flex-direction:column;gap:3px;margin-top:15px;padding-top:13px;
  border-top:1px solid var(--hair)}
.box .f{display:flex;align-items:baseline;gap:8px;font-size:13px;color:var(--muted)}
.box .f b{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;
  font-size:15px;font-weight:700;color:var(--ink)}
.box .f.dn b,.box .f.dn{color:var(--amber-i)}
.box .f.live{color:var(--green-d)} .box .f.live .dot{width:7px;height:7px;border-radius:50%;
  background:var(--green);display:inline-block}
.box .go{position:absolute;top:18px;right:18px;color:var(--ghost);font-size:17px}
.box:hover .go{color:var(--green)}

/* ── the labs, a family, visibly different from the three ─────────────── */
.labs{background:var(--panel);border:1px solid var(--line-soft);border-radius:16px;padding:17px 18px}
.lgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:11px;margin-top:12px}
.lab{display:block;text-align:left;background:var(--card);border:1px solid var(--line);
  border-radius:13px;padding:15px 16px;transition:border-color .12s,transform .12s}
.lab:hover{border-color:var(--green);transform:translateY(-1px)}
.lab .g{font-size:17px;color:var(--faint);margin-bottom:9px;display:block}
.lab b{display:block;font-size:15px;font-weight:700;letter-spacing:-.01em}
.lab span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;line-height:1.35}
.lab .st{display:inline-flex;align-items:center;gap:6px;margin-top:11px;font-size:12px;
  font-weight:600;color:var(--faint);font-family:'IBM Plex Mono',monospace}
.lab .st.on{color:var(--blue-i)}
.lab .st.dn{color:var(--amber-i)}

.foot{margin-top:26px;padding-top:16px;border-top:1px solid var(--hair);
  display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--faint)}
.foot a{color:var(--muted);text-decoration:none;font-weight:600}
.foot a:hover{color:var(--ink);text-decoration:underline;text-underline-offset:3px}

@media(max-width:860px){ .main{grid-template-columns:1fr} .lgrid{grid-template-columns:1fr 1fr} }
@media(max-width:520px){
  .wrap{padding:16px 14px 44px}
  .brand{font-size:22px}
  .lgrid{grid-template-columns:1fr}
  .al{flex-wrap:wrap} .al .fix{margin-left:33px;width:auto}
}
</style>
</head>
<body>
<div class="wrap">

  <div class="top">
    <h1 class="brand">ChitBridge</h1>
    <span class="shop">Mayur Bhavan · Counter 1</span>
    <span class="grow"></span>
    <span class="avatar" title="Mayur Bhavan">MB</span>
  </div>
  <p class="idea">One shop, one set of numbers. The counter sells it, the catalogue
    describes it, the books record it — and the Labs are where you work a number out
    before any of them see it.</p>

  <div class="alerts" id="alerts"></div>

  <div class="cap"><b>Day to day</b><i></i></div>
  <div class="main">

    <button class="box">
      <span class="go">›</span>
      <span class="g">▤</span>
      <h3>Till</h3>
      <p class="what">Take money at the counter.</p>
      <span class="facts">
        <span class="f live"><span class="dot"></span>Counter 1 open</span>
        <span class="f"><b>12</b> bills · <b>₹4,280</b> today</span>
      </span>
    </button>

    <button class="box">
      <span class="go">›</span>
      <span class="g">▦</span>
      <h3>Catalogue</h3>
      <p class="what">What this shop sells, and at what price.</p>
      <span class="facts">
        <span class="f"><b>112</b> products · <b>7</b> shelves</span>
        <span class="f dn"><b>1</b> with no cost written down</span>
      </span>
    </button>

    <button class="box">
      <span class="go">›</span>
      <span class="g">₹</span>
      <h3>Accounts</h3>
      <p class="what">What the shop made, and what it owes.</p>
      <span class="facts">
        <span class="f">Books up to <b>26 Sep</b></span>
        <span class="f dn"><b>3</b> bills not sent up</span>
      </span>
    </button>

  </div>

  <div class="labs">
    <div class="cap" style="margin:0">
      <b>Labs</b><span>Work the number out first. Nothing changes until you say so.</span><i></i>
    </div>
    <div class="lgrid">

      <button class="lab">
        <span class="g">◈</span>
        <b>Product Lab</b>
        <span>Cost, price, and what each one leaves you.</span>
        <span class="st dn">1 without a cost</span>
      </button>

      <button class="lab">
        <span class="g">%</span>
        <b>Offer Lab</b>
        <span>Discounts, and whether they clear your margin.</span>
        <span class="st on">1 draft waiting</span>
      </button>

      <button class="lab">
        <span class="g">▣</span>
        <b>Combo Lab</b>
        <span>Two things at one price, and the choices before a bill.</span>
        <span class="st">3 combos · 10 modifiers</span>
      </button>

      <button class="lab">
        <span class="g">§</span>
        <b>Tax Lab</b>
        <span>GST slabs, and what prints on a bill.</span>
        <span class="st dn">no GSTIN — cash memos</span>
      </button>

    </div>
  </div>

  <div class="foot">
    <a href="#">Your shop</a>
    <a href="#">Counters &amp; keys</a>
    <a href="#">Co-assists</a>
    <a href="#">Suppliers</a>
    <a href="#">Connectors</a>
    <span class="grow"></span>
    <span>Prices read 09:12 today</span>
  </div>

</div>

<script>
/* Only a failing thing earns a row here. When everything is fine this block is
   empty and the page is three boxes and four labs. */
var ALERTS=[
  {lvl:'bad',  ic:'!', t:'Prices are 38 hours old',
   s:'Read at 22:18 on Friday. Bills may be wrong.', fix:'Re-read the shop'},
  {lvl:'warn', ic:'↑', t:'3 bills not sent up',
   s:'From 19:40 onwards.', fix:'Send them'}
];
document.getElementById('alerts').innerHTML=ALERTS.map(function(a){
  return '<div class="al '+a.lvl+'"><span class="ic">'+a.ic+'</span>'+
    '<span><b>'+a.t+'</b> &nbsp;'+a.s+'</span>'+
    (a.fix?'<button class="fix">'+a.fix+'</button>':'')+'</div>';
}).join('');
</script>
</body>
</html>
```
