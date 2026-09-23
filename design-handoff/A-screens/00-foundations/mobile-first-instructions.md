# Mobile-first build instructions (counter menu + every screen)

For the CLI. Read together with `QUICK-KEYS-DESIGN-HANDOFF.md`. Rule: **write the phone layout first, then widen it.** Every media query adds columns; none of them adds or removes features.

---

## 1. Breakpoints and the ladder

```css
:root{--bp-sm:600px;--bp-md:900px;--bp-lg:1200px;--bp-xl:1600px}
```

| Name | Width | Typical device | Shape of a screen |
|---|---|---|---|
| `base` | < 600 | Phone, handheld POS | One column. Sections folded. Sticky action bar at the bottom |
| `sm` | 600–899 | Large phone, foldable open, small tablet portrait | One column, sections unfolded, 2 tiles per row |
| `md` | 900–1199 | Tablet, compact 15″ terminal | Two columns. Dialogs become centred cards |
| `lg` | 1200–1599 | Counter terminal | Three regions side by side (keys / bill / pay) |
| `xl` | 1600+ | Wide terminal, TV | Same as `lg` with wider gutters and more keys per row |

Write CSS with `min-width` only:

```css
.menu{display:flex;flex-direction:column;gap:10px}                 /* base */
@media (min-width:900px){.menu{display:grid;grid-template-columns:1fr 1fr;gap:16px}}
@media (min-width:1200px){.menu{grid-template-columns:1.1fr .9fr}}
```

Choose the layout by **container width, not by user agent**. Use a container query or `ResizeObserver` on the app shell so a foldable that opens mid-shift re-flows at once, with open sections and the current bill kept.

---

## 2. Rules that hold at every size

1. **Nothing is dropped.** A narrow screen folds, tabs, or steps content; it never removes an action or a field.
2. **Order never changes.** Groups and fields keep one order from phone to terminal, so muscle memory carries across devices.
3. **Touch targets** ≥ 44 × 44 px, and ≥ 48 px in the base range. Rows ≥ 56 px tall on phones.
4. **One thumb.** On `base`, primary actions sit in the bottom 40% of the screen. Destructive actions never sit next to a primary action.
5. **Type scale:** base body 15–16 px (never below 14), `md`+ 14–15 px, money and totals one step larger and bold. Respect the user's "Text size" setting by scaling `rem`, not by fixed px everywhere.
6. **Spacing scale:** 4 / 8 / 12 / 16 / 24 px. Side gutters: 14 px base, 16 px `sm`, 20 px `md`, 24 px `lg`+.
7. **Safe areas:** pad sticky bars with `env(safe-area-inset-bottom)`; add `env(safe-area-inset-left/right)` in landscape.
8. **No hover-only meaning.** Every hover state has a visible, non-hover counterpart (border, fill, tick).
9. **Keyboard parity.** Shortcuts (F2, F4, F6, F8, F9, F10, Esc, 3*, Ctrl ↑↓) work identically wherever a keyboard exists; the shortcut bar is hidden under `md` but the keys still work.
10. **Landscape phones and short screens:** when height < 500 px, sticky headers collapse to one line and dialogs scroll internally.
11. **Text may grow 30%** (translations, large-text setting) without clipping: no fixed heights on text rows, use `min-height`.

---

## 3. Patterns: what a component becomes at each size

| Pattern | base (phone) | `sm` | `md` (tablet) | `lg`+ (terminal) |
|---|---|---|---|---|
| Menu / settings | Full-height sheet, folded sections | Sheet, unfolded | Centred dialog, 2 columns | Centred dialog, 2 columns, wider |
| Tabs (Settings) | Folded sections, or a select at the top | Scrollable tab strip | Side list of tabs | Side list, always visible |
| Bill lines | Cards: name on line 1, qty stepper + value on line 2 | Same, denser | Table without the QTY×PRICE column | Full table, all columns |
| Product results | Two lines per row, price right | Same | Row with MRP and savings | Row with code, category, MRP, savings, + button |
| Quick keys | 3 per row | 4 | 5 | 6 (or by `keysPerRow`) |
| Group picker | Bottom sheet | Bottom sheet | Side drawer | Popup or full-screen picker |
| Pay | Its own step | Its own step | Step or panel | Inline panel |
| Primary action | Sticky bottom bar, full width | Sticky bar | In the panel footer | In the panel footer |
| Dialog | Sheet, 92% height, drag handle | Sheet | Card, max 720 px | Card, max 880 px |
| Toast / banner | Above the sticky bar | Above the bar | Top-right | Top-right |

---

## 4. The counter menu, size by size

**Groups, in this order, always:** Bills · Shop & prices · This counter · How it looks · Careful.

### base (< 600) — the chosen base design
- Full-height sheet with a drag handle, opened from ≡.
- Header: counter name, shop, online dot, time, close button (40 px).
- Five **folded sections**. Each closed row: icon square (36 px), title, one-line summary, chevron. Row ≥ 60 px.
- **Bills** opens by default; only one section open at a time (accordion). Opening scrolls that section's first row into view.
- "How it looks" holds the three selects and the six on/off switches, one per row.
- **Careful** is last, in a warm-red bordered box, with the line "These two stop billing for a moment. Everything is sent and checked first." Both actions ask for confirmation.
- Footer: "Nobody signed in · Sign in · F7" and the version.

### sm (600–899)
- Same sheet, sections **unfolded** (the "one after another" version).
- Action rows go two per row where the text fits; "How it looks" switches go two per row.

### md (900–1199)
- Centred dialog, max 720 px wide: actions in the left column, "How it looks" in the right column, Careful as a full-width strip at the bottom.

### lg+ (1200+)
- The chosen wide panel, max 880 px: three action cards left, look card right, Careful strip at the bottom, "Sign in · F7" in the header.

### Behaviour, all sizes
- Esc closes; focus returns to the ≡ button; focus is trapped inside while open.
- The sheet/dialog is `role="dialog"` with `aria-modal="true"` and a label; section headers are `<button aria-expanded>`.
- Look settings apply **immediately** (no Save) and are stored per device; a toast confirms nothing, the change is the feedback.
- Any action that leaves the sell screen closes the menu first.

---

## 5. Settings dialog (same rules)

- Tabs: Counter · Screen · Bill · Quick keys · Pay · Voice · Device.
- base: the tabs become **folded sections** in that order, or a select labelled "Section" at the top. Sticky footer with Close and Save.
- `md`+: tabs become a **side list** on the left, content on the right, footer buttons bottom-right. Save stays disabled until something changes; "Kept on this device" sits under the buttons.
- Each field is a real `<label>` + input, stacked on base, two per row from `md`.
- A status block (like the GSTIN card) is a stacked list on base: label, then value under it. Never let a label column squeeze a value onto three lines.
- Show "not set" values in the warn colour with a short explanation next to them, on its own line: `GSTIN — not set · no GST is charged`.

---

## 6. Performance and offline on phones

- First paint under 2 s on a mid-range Android; keep the sell screen's critical CSS inline.
- Virtualize lists beyond 50 rows (product results, bills).
- Quick-key photos: load the 96 px copy on phones, 192 px on tablets, 384 px on terminals; cache them at sync so photos work offline.
- Show the offline state in the header chip, and keep every action working locally that the spec says is offline-capable.

---

## 7. Test matrix (Playwright)

Run every screen at: 360×640, 390×844, 412×915, 540×720 (foldable closed), 768×1024, 820×1180, 1024×768, 1180×820, 1366×768, 1600×900, 1080×1920.

For each: no horizontal scroll; no clipped text; every slot present; primary action reachable without scrolling on base; 4.5:1 text contrast; tab order top to bottom; the reference basket total reads ₹2,750.25.
