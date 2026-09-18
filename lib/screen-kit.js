// @stage tested
// @stage-note The screen library: colour schemes, key tiles, pickers, layouts and presets a counter (or any system) picks from.
/**
 * screen-kit.js — A LIBRARY OF SCREEN DESIGNS, SO A SHOP (OR ITS SYSTEM) PICKS THE LOOK THAT FITS IT (2026-09-17).
 *
 * Athi: *"my requirement is to have a library of different designs and colour schemes so people, or their system, can pick
 * up the required format."* The design came from a Claude Design handoff (quick keys, sell screen, screen library); this is
 * that handoff fitted to ChitBridge rather than copied: no React, no new tables — one pure file, run by the server and
 * vendored to the counter like every other engine (scripts/vendor-till.cjs → /engine/screen.js, window.CBScreen).
 *
 * WHAT IS IN IT — each a REGISTRY, so a new design is one entry, never a new code path:
 *   THEMES    colour schemes, as the counter's own CSS variables (--paper, --card, --ink …) plus a display font stack
 *   GROUP_COLOURS  the bar / tint / ink a quick-key group is drawn in
 *   TILES     how one quick key looks: classic · colourBlock · monogram · compactRow · hotkey · photo
 *   PICKERS   how a cashier chooses which groups show: popup · sideDrawer · fullScreen · bottomSheet · dayTimeline ·
 *             groupRail · tabStrip
 *   LAYOUTS   where every part of the sell screen sits on a device — and the rule that a layout may move a part into a
 *             tab, a step or a sheet, but NEVER drops one (SLOTS; tests/screen-kit.test.cjs enumerates them)
 *   PRESETS   named combinations of the four above (counterClassic is today's counter)
 *   resolve() the device → counter → shop order a setting is decided in
 *   autoLayout() the layout a screen of this size should get when nobody chose one
 *
 * ⚠️ PURE. No DOM, no storage, no money arithmetic: a tile is handed its price already formatted, and its actions as
 * attribute strings. What a key DOES stays the counter's; this file only decides what it LOOKS like.
 * ⚠️ OFFLINE. The counter works with the line down, so a theme's fonts always end in a system stack — a design that needs a
 * web font to be legible is not a design a counter can use.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CBScreen = api;
  else if (root) root.CBScreen = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SYS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif';
  const MONO = 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace';

  /**
   * ── THEMES ── the counter's own variable names, so choosing a theme is setting variables — nothing else changes.
   * lightCream IS today's counter (tokens from the handoff §8, which were taken from the counter).
   */
  const THEMES = {
    /**
     * ⭐⭐ lightCream and dark are NOT this library's own invention — till.html's applyLook() skips applying
     * their vars at all and relies on the counter's own static `:root{}` / `:root[data-theme="dark"]{}` CSS
     * instead ("Light is the library's light cream, which IS this page's light"). So these two entries exist
     * only to PREVIEW the real counter (Settings, the screen gallery) — and until now they previewed a palette
     * a shade off the one a shopkeeper actually gets (--ink #1D1B16 here vs the counter's real #141210, --ok
     * #16693F vs #1c7a4a, and more). Pinned to till.html's actual values so the preview never lies about the
     * live page again; tests/no-tax-reformula.test.cjs's guard pattern is the model for keeping it that way —
     * see the parity check in e2e/till-contrast.cjs.
     */
    /* ⚠️ THESE ARE THE HANDOFF'S §8 NUMBERS (ported into till.html 2026-09-18), not a designer's approximation
       of them. till.html's :root is the live source and e2e/till-contrast.cjs asserts these two agree — they
       drifted once (2026-09-17) and Settings previewed a theme no shopkeeper actually had. */
    lightCream: { label: 'Light cream', dark: false, vars: {
      '--paper': '#FCFAF5', '--panel': '#F3EFE6', '--card': '#FFFFFF', '--line': '#E6E0D2', '--edge': '#918B87',
      '--ink': '#1D1B16', '--dim': '#5E594D', '--ok': '#16693F', '--ok-tint': '#E8F4ED', '--warn': '#8E3517',
      '--warn-tint': '#FBEAE3', '--blue': '#1B4F8A', '--accent': '#F2B544' } },
    dark: { label: 'Dark', dark: true, vars: {
      '--paper': '#17150F', '--panel': '#14171B', '--card': '#211E18', '--line': '#3A352F', '--edge': '#6F6965',
      '--ink': '#F2EDE6', '--dim': '#A89F95', '--ok': '#4CC38A', '--ok-tint': '#173226', '--warn': '#F2A37A',
      '--warn-tint': '#3A2318', '--blue': '#7CB0E8', '--accent': '#F2A93B' } },
    paper: { label: 'Paper', dark: false, vars: {
      '--paper': '#FFFDF7', '--panel': '#F7F3EA', '--card': '#FFFFFF', '--line': '#151412', '--edge': '#151412',
      '--ink': '#151412', '--dim': '#4F4B44', '--ok': '#1F6B3A', '--ok-tint': '#EAF3EC', '--warn': '#C2381F',
      '--warn-tint': '#FBE9E5', '--blue': '#1B4F8A', '--accent': '#C2381F' } },
    navy: { label: 'Navy', dark: true, vars: {
      '--paper': '#0C1522', '--panel': '#0E1A29', '--card': '#0F1B2B', '--line': '#223449',
      /* ⭐ WAS #3B5470 — 2.22:1 on --card, 2.35:1 on --paper, both below WCAG 1.4.11's 3:1 for an input/button
         edge. Found by e2e/till-contrast.cjs the day it first measured Navy at all (2026-09-17); lightened to
         the strongest step still IN the steel-blue family rather than borrowing --blue. */
      '--edge': '#527191',
      '--ink': '#EAF2FA', '--dim': '#9FB2C6', '--ok': '#6FE3C1', '--ok-tint': '#12322E', '--warn': '#F5A38A',
      '--warn-tint': '#3A2420', '--blue': '#8CC2FF', '--accent': '#6FE3C1' } },
  };
  const THEME_FONTS = { display: SYS, ui: SYS, mono: MONO };

  /** ── GROUP COLOURS ── the four the design names, then a steady hue walk for any group beyond them */
  const GROUP_COLOURS = [
    { name: 'Morning', bar: '#E0A020', tint: '#FDF3DC', ink: '#7A5205' },
    { name: 'Afternoon', bar: '#D9602B', tint: '#FCE9DF', ink: '#8A3410' },
    { name: 'Evening', bar: '#7A62D9', tint: '#EEEAFB', ink: '#44308F' },
    { name: 'Night', bar: '#2F74C9', tint: '#E4EEFA', ink: '#174A87' },
  ];
  /** groupColour(i | name) — a group's colours: by a known name first, then by its position */
  function groupColour(which) {
    if (typeof which === 'string') {
      const hit = GROUP_COLOURS.find((g) => g.name.toLowerCase() === which.trim().toLowerCase());
      if (hit) return hit;
      let h = 0; for (let n = 0; n < which.length; n++) h = ((h << 5) - h + which.charCodeAt(n)) | 0;
      which = Math.abs(h);
    }
    const i = Math.max(0, Number(which) || 0);
    if (i < GROUP_COLOURS.length) return GROUP_COLOURS[i];
    const hue = (i * 67) % 360;
    return { name: '', bar: `hsl(${hue},60%,45%)`, tint: `hsl(${hue},70%,94%)`, ink: `hsl(${hue},60%,25%)` };
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** initials — "Idli batter" → IB; never an empty badge */
  function initials(name) {
    const words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    const out = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
    return out || '?';
  }

  /**
   * ── TILES ── tile(style, p) → HTML for one key.
   *   p = { name, price, unit, image, colour:{bar,tint,ink}, qty, soldOut, showPhoto, hotkey,
   *         attrs, hideAttrs, restoreAttrs, extra }
   *   price is ALREADY formatted (the counter's money renderer); attrs are attribute strings the counter supplies
   *   (data-testid, onclick …). A sold-out tile's whole face restores it.
   */
  function photoBox(p, cls) {
    const c = p.colour || groupColour(0);
    const img = p.image
      ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`
      : `<span class="sk-init" aria-hidden="true" style="background:${c.tint};color:${c.ink}">${esc(initials(p.name))}</span>`;
    return `<span class="${cls}">${img}</span>`;
  }
  const qtyBadge = (p, cls) => (p.qty > 0 ? `<span class="${cls || 'sk-qty'}">${esc(p.qty)}</span>` : '');
  const hideX = (p) => (p.soldOut ? '' : `<i class="sk-x" role="button" aria-label="sold out" ${p.hideAttrs || ''}>✕</i>`);
  const priceLine = (p) => `<span class="sk-price">${esc(p.price)}${p.unit ? ` <small>/ ${esc(p.unit)}</small>` : ''}</span>`;
  const TILES = {
    classic: { label: 'Classic', render(p) {
      const c = p.colour || groupColour(0);
      return `<button class="sk-tile sk-classic${p.soldOut ? ' sk-out' : ''}" ${p.soldOut ? p.restoreAttrs || '' : p.attrs || ''}>`
        + (p.showPhoto ? photoBox(p, 'sk-ph') : `<span class="sk-bar" style="background:${c.bar}"></span>`)
        + `<b class="sk-name">${esc(p.name)}</b>${priceLine(p)}${qtyBadge(p)}${hideX(p)}${p.extra || ''}`
        + (p.soldOut ? '<span class="sk-outlabel">SOLD OUT · tap to bring back</span>' : '') + '</button>';
    } },
    colourBlock: { label: 'Colour block', render(p) {
      const c = p.colour || groupColour(0);
      return `<button class="sk-tile sk-block${p.soldOut ? ' sk-out' : ''}" style="${p.soldOut ? '' : `background:${c.bar};color:#1D1B16`}" ${p.soldOut ? p.restoreAttrs || '' : p.attrs || ''}>`
        + `<b class="sk-name">${esc(p.name)}</b>${priceLine(p)}${qtyBadge(p, 'sk-qty sk-qty-dark')}${hideX(p)}${p.extra || ''}`
        + (p.soldOut ? '<span class="sk-outlabel">SOLD OUT · tap to bring back</span>' : '') + '</button>';
    } },
    monogram: { label: 'Monogram', render(p) {
      const c = p.colour || groupColour(0);
      return `<button class="sk-tile sk-mono${p.qty > 0 ? ' sk-inbill' : ''}${p.soldOut ? ' sk-out' : ''}" ${p.soldOut ? p.restoreAttrs || '' : p.attrs || ''}>`
        + `<span class="sk-badge" style="background:${c.tint};color:${c.ink}">${esc(initials(p.name))}${qtyBadge(p, 'sk-qty sk-qty-red')}</span>`
        + `<b class="sk-name">${esc(p.name)}</b>${priceLine(p)}${hideX(p)}${p.extra || ''}`
        + (p.soldOut ? '<span class="sk-stamp">SOLD OUT</span>' : '') + '</button>';
    } },
    compactRow: { label: 'Compact row', render(p) {
      const c = p.colour || groupColour(0);
      return `<button class="sk-tile sk-row${p.soldOut ? ' sk-out' : ''}" style="border-inline-start-color:${c.bar}" ${p.soldOut ? p.restoreAttrs || '' : p.attrs || ''}>`
        + `<b class="sk-name">${esc(p.name)}</b>${priceLine(p)}`
        + (p.qty > 0 ? `<span class="sk-step">× ${esc(p.qty)}</span>` : '') + `${hideX(p)}${p.extra || ''}`
        + (p.soldOut ? '<span class="sk-undo">Undo</span>' : '') + '</button>';
    } },
    hotkey: { label: 'Hotkey', render(p) {
      const c = p.colour || groupColour(0);
      return `<button class="sk-tile sk-hot${p.soldOut ? ' sk-out' : ''}" style="border-bottom-color:${c.bar}" ${p.soldOut ? p.restoreAttrs || '' : p.attrs || ''}>`
        + (p.hotkey != null ? `<span class="sk-key">${esc(p.hotkey)}</span>` : '')
        + `<b class="sk-name">${esc(p.name)}</b><span class="sk-price" style="color:${c.bar}">${esc(p.price)}</span>`
        + (p.qty > 0 ? `<span class="sk-qty sk-qty-bar" style="background:${c.bar}">×${esc(p.qty)}</span>` : '')
        + `${hideX(p)}${p.extra || ''}` + (p.soldOut ? `<span class="sk-outlabel">OUT${p.hotkey != null ? ' · key ' + esc(p.hotkey) + ' is free' : ''}</span>` : '')
        + '</button>';
    } },
    photo: { label: 'Photo', render(p) {
      return `<button class="sk-tile sk-photo${p.soldOut ? ' sk-out' : ''}" ${p.soldOut ? p.restoreAttrs || '' : p.attrs || ''}>`
        + photoBox(p, 'sk-ph sk-ph-big') + (p.qty > 0 ? `<span class="sk-inbill-tag">${esc(p.qty)} in bill</span>` : '')
        + `<b class="sk-name">${esc(p.name)}</b>${priceLine(p)}${hideX(p)}${p.extra || ''}`
        + (p.soldOut ? '<span class="sk-outlabel sk-outchip">SOLD OUT</span>' : '') + '</button>';
    } },
  };
  function tile(style, p) { return (TILES[style] || TILES.classic).render(p || {}); }

  /**
   * ── PICKERS ── how a cashier chooses which groups show. picker(style, m) → HTML.
   *   m = { groups:[{ id, name, colour, from, to, total, available, on }], openId, items:[{ id, name, on }],
   *         attrs:{ group(id), open(id), item(id), all, none, back, close } }  — attrs return attribute strings
   * Every picker offers the same two levels (groups, then one group's items); only the container differs.
   */
  const at = (m, k, v) => (m.attrs && typeof m.attrs[k] === 'function' ? m.attrs[k](v) : '');
  function groupRows(m) {
    return (m.groups || []).map((g) => {
      const c = g.colour || groupColour(g.name);
      return `<div class="sk-grow${g.on ? ' on' : ''}"><label><input type="checkbox"${g.on ? ' checked' : ''} ${at(m, 'group', g.id)}>`
        + `<span class="sk-gbar" style="background:${c.bar}"></span></label>`
        + `<a class="sk-gname" ${at(m, 'open', g.id)}>${esc(g.name)}</a>`
        + (g.from ? `<span class="sk-gwin">${esc(g.from)}–${esc(g.to || '')}</span>` : '')
        + `<span class="sk-gcount">${esc(g.available)}/${esc(g.total)}</span><span class="sk-chev" ${at(m, 'open', g.id)}>›</span></div>`;
    }).join('');
  }
  function itemRows(m) {
    const g = (m.groups || []).find((x) => x.id === m.openId) || {};
    return `<div class="sk-ihead"><a ${at(m, 'back')}>‹ ${esc(g.name || '')}</a><span><a ${at(m, 'all')}>Show all</a> · <a ${at(m, 'none')}>Hide all</a></span></div>`
      + (m.items || []).map((i) => `<label class="sk-irow"><input type="checkbox"${i.on ? ' checked' : ''} ${at(m, 'item', i.id)}> ${esc(i.name)}</label>`).join('');
  }
  const body = (m) => (m.openId ? itemRows(m) : groupRows(m));
  const shell = (cls, m, title) => `<div class="sk-picker ${cls}" role="dialog" aria-label="${esc(title || 'Quick keys')}">`
    + `<div class="sk-phead"><b>${esc(title || 'Quick keys')}</b><button class="sk-close" ${at(m, 'close')} aria-label="Close">✕</button></div>${body(m)}</div>`;
  const PICKERS = {
    popup: { label: 'Popup', render: (m) => shell('sk-popup', m) },
    sideDrawer: { label: 'Side drawer', render: (m) => shell('sk-drawer', m) },
    fullScreen: { label: 'Full screen', render: (m) => shell('sk-full', m) },
    bottomSheet: { label: 'Bottom sheet', render: (m) => shell('sk-sheet', m) },
    /* inline pickers: always on screen, no dialog */
    tabStrip: { label: 'Tab strip', inline: true, render: (m) => `<div class="sk-tabs" role="tablist">`
      + (m.groups || []).map((g) => `<button role="tab" class="sk-tab${g.on ? ' on' : ''}" style="--gbar:${(g.colour || groupColour(g.name)).bar}" ${at(m, 'group', g.id)}>${esc(g.name)} <small>${esc(g.available)}</small></button>`).join('') + '</div>' },
    groupRail: { label: 'Group rail', inline: true, render: (m) => `<div class="sk-rail">`
      + (m.groups || []).map((g) => { const c = g.colour || groupColour(g.name); const pct = g.total ? Math.round(100 * g.available / g.total) : 0;
        return `<label class="sk-railrow"><input type="checkbox" role="switch"${g.on ? ' checked' : ''} ${at(m, 'group', g.id)}><span>${esc(g.name)}</span>`
          + `<span class="sk-railbar"><i style="width:${pct}%;background:${c.bar}"></i></span></label>`; }).join('') + '</div>' },
    dayTimeline: { label: 'Day timeline', inline: true, render: (m) => `<div class="sk-day">`
      + (m.groups || []).map((g) => { const c = g.colour || groupColour(g.name);
        return `<button class="sk-dayblock${g.on ? ' on' : ''}" style="background:${g.on ? c.bar : c.tint};color:${g.on ? '#fff' : c.ink};flex:${Math.max(1, hours(g.from, g.to))}" ${at(m, 'group', g.id)}>`
          + `<b>${esc(g.name)}</b><small>${esc(g.from || '')}–${esc(g.to || '')}</small></button>`; }).join('') + '</div>' },
  };
  function hours(from, to) {
    const t = (s) => { const [h, mi] = String(s || '').split(':').map(Number); return (h || 0) + (mi || 0) / 60; };
    const d = t(to) - t(from); return d > 0 ? d : 1;
  }
  function picker(style, m) { return (PICKERS[style] || PICKERS.popup).render(m || {}); }

  /**
   * ── LAYOUTS ── where each part of the sell screen sits. EVERY layout places EVERY slot — in the page, a tab, a step or a
   * sheet — and never drops one (handoff §3: "an element may move … but must never be dropped").
   *   place: inline | tab | step | sheet   ·   shape: the counter's own CSS shape it maps to
   */
  const SLOTS = ['header', 'search', 'categories', 'quickKeys', 'results', 'shortcuts', 'customer', 'points', 'bill', 'totals', 'pay', 'actions', 'status'];
  const all = (place, over) => Object.assign(Object.fromEntries(SLOTS.map((s) => [s, place])), over || {});
  const LAYOUTS = {
    horizontal: { label: 'Horizontal', shape: 'wide', keysPerRow: 6, slots: all('inline') },
    vertical: { label: 'Vertical', shape: 'tall', keysPerRow: 5, slots: all('inline') },
    compact: { label: 'Compact', shape: 'wide', keysPerRow: 4, slots: all('inline', { quickKeys: 'tab', results: 'tab' }) },
    tablet: { label: 'Tablet', shape: 'wide', keysPerRow: 5, slots: all('inline', { pay: 'step' }) },
    phone: { label: 'Phone', shape: 'mobile', keysPerRow: 3,
      slots: all('inline', { customer: 'step', points: 'step', bill: 'step', totals: 'step', pay: 'step', actions: 'step', shortcuts: 'sheet' }) },
    handheld: { label: 'Handheld', shape: 'mobile', keysPerRow: 1,
      slots: all('inline', { results: 'sheet', customer: 'step', points: 'step', bill: 'step', totals: 'step', pay: 'step', actions: 'step', shortcuts: 'sheet' }) },
    timeline: { label: 'Timeline', shape: 'wide', keysPerRow: 6, slots: all('inline') },
    rail: { label: 'Rail', shape: 'wide', keysPerRow: 2, slots: all('inline') },
    auto: { label: 'Automatic', shape: 'auto', keysPerRow: null, slots: all('inline') },
  };
  /** missingSlots(layout) → the slots a layout fails to place (must be []) */
  function missingSlots(id) {
    const l = LAYOUTS[id]; if (!l) return SLOTS.slice();
    return SLOTS.filter((s) => ['inline', 'tab', 'step', 'sheet'].indexOf(l.slots[s]) < 0);
  }

  /** autoLayout({ width, height, touch, scanner }) — handoff §7, the layout a screen gets when nobody chose one */
  function autoLayout(v) {
    const w = Number(v && v.width) || 0, h = Number(v && v.height) || 0, touch = !!(v && v.touch);
    if (w && w <= 400 && v && v.scanner) return 'handheld';
    if (w && w < 480) return 'phone';
    if (h > w && h >= 1000) return 'vertical';
    if (touch && w >= 700 && w <= 1180) return 'tablet';
    if (w >= 900 && w < 1280) return 'compact';
    return 'horizontal';
  }

  const DENSITIES = { comfortable: { label: 'Comfortable' }, compact: { label: 'Compact' } };

  /** ── PRESETS ── named combinations (handoff §7). counterClassic is today's counter. */
  const PRESETS = {
    counterClassic: { label: 'Counter classic', note: 'light', layout: 'horizontal', tile: 'classic', picker: 'popup', theme: 'lightCream', photos: false },
    counterDark: { label: 'Counter dark', note: 'dark', layout: 'horizontal', tile: 'classic', picker: 'popup', theme: 'dark', photos: false },
    counterTimeline: { label: 'Counter timeline', note: 'day bar', layout: 'timeline', tile: 'colourBlock', picker: 'dayTimeline', theme: 'paper', photos: false },
    counterRail: { label: 'Counter rail', note: 'list keys', layout: 'rail', tile: 'compactRow', picker: 'groupRail', theme: 'navy', photos: false },
    compact: { label: 'Compact', note: '15″ terminal', layout: 'compact', tile: 'classic', picker: 'tabStrip', theme: 'lightCream', photos: false },
    kiosk: { label: 'Kiosk', note: 'vertical', layout: 'vertical', tile: 'photo', picker: 'popup', theme: 'lightCream', photos: true },
    tabletWaiter: { label: 'Tablet waiter', note: 'sell → pay', layout: 'tablet', tile: 'photo', picker: 'sideDrawer', theme: 'lightCream', photos: true },
    phoneOwner: { label: 'Phone', note: '3 steps', layout: 'phone', tile: 'classic', picker: 'bottomSheet', theme: 'lightCream', photos: false },
    handheldTable: { label: 'Handheld', note: 'scan + list', layout: 'handheld', tile: 'compactRow', picker: 'tabStrip', theme: 'lightCream', photos: false },
  };
  const DEFAULT = Object.assign({ preset: 'counterClassic', density: 'comfortable', cashierMayPersonalise: true }, PRESETS.counterClassic);
  const CHOICES = { layout: LAYOUTS, tile: TILES, picker: PICKERS, theme: THEMES, density: DENSITIES };

  /**
   * resolve(shop, counter, device) → the screen config in force. Order: device over counter over shop (handoff §5).
   * A `preset` at any level fills its fields first; explicit fields at that level then win. Unknown values fall back to the
   * default, never through — a stored name from a future version must not blank the screen.
   */
  function resolve(...levels) {
    let out = Object.assign({}, DEFAULT);
    for (const lv of levels) {
      if (!lv || typeof lv !== 'object') continue;
      if (lv.preset && PRESETS[lv.preset]) out = Object.assign(out, PRESETS[lv.preset], { preset: lv.preset });
      for (const k of Object.keys(lv)) if (k !== 'preset' && lv[k] !== undefined && lv[k] !== null) out[k] = lv[k];
    }
    for (const k of Object.keys(CHOICES)) if (!CHOICES[k][out[k]]) out[k] = DEFAULT[k];
    out.photos = !!out.photos;
    out.keysPerRow = Number(out.keysPerRow) || (LAYOUTS[out.layout] && LAYOUTS[out.layout].keysPerRow) || 6;
    return out;
  }

  /** themeVars(id) → the CSS variables to set, as an object; themeCss(id, selector) → a rule block */
  function themeVars(id) { return Object.assign({}, (THEMES[id] || THEMES.lightCream).vars); }
  function themeCss(id, sel) {
    const v = themeVars(id);
    return `${sel || ':root'}{${Object.keys(v).map((k) => `${k}:${v[k]}`).join(';')}}`;
  }

  /** ── THE LIBRARY'S OWN CSS ── one block, injected once by whoever draws with it (the counter, the gallery) */
  const CSS = `
.sk-grid{display:grid;gap:10px;grid-template-columns:repeat(var(--sk-per-row,6),minmax(0,1fr))}
.sk-tile{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-height:88px;padding:10px 12px;
  border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);font:inherit;text-align:start;cursor:pointer}
.sk-tile:focus-visible{outline:3px solid var(--ok);outline-offset:2px}
.sk-name{font-weight:700;line-height:1.2;overflow-wrap:anywhere}
.sk-price{color:var(--dim);font-size:.88em;margin-top:auto}
.sk-price small{font-size:1em}
.sk-bar{display:block;width:22px;height:4px;border-radius:2px}
.sk-x{position:absolute;top:4px;inset-inline-end:6px;font-style:normal;font-size:.8em;opacity:.45;padding:2px 5px;border-radius:6px}
.sk-x:hover{opacity:1;background:var(--warn-tint);color:var(--warn)}
.sk-qty{position:absolute;inset-inline-end:8px;bottom:8px;min-width:24px;height:24px;border-radius:12px;display:grid;place-items:center;
  background:var(--ok);color:#fff;font-weight:700;font-size:.8em;padding:0 6px}
.sk-qty-dark{background:#1D1B16}
.sk-qty-red{position:absolute;inset-inline-end:-6px;bottom:-6px;background:#D23E2A;min-width:18px;height:18px;font-size:.7em}
.sk-out{opacity:.72;border-style:dashed;background:repeating-linear-gradient(135deg,var(--panel,var(--paper)) 0 8px,var(--card) 8px 16px)!important;color:var(--dim)!important}
.sk-out .sk-name{text-decoration:line-through;color:var(--dim)!important}
.sk-out img{filter:grayscale(1)}
.sk-outlabel{font-size:.72em;font-weight:700;letter-spacing:.06em;color:var(--dim)}
.sk-block{border:0;color:#1D1B16}
.sk-block .sk-price{color:#1D1B16;font-weight:700}
.sk-mono.sk-inbill{border:2px solid var(--ink)}
.sk-badge{position:relative;display:grid;place-items:center;width:42px;height:42px;border-radius:10px;font-weight:800}
.sk-stamp{position:absolute;inset-inline-end:10px;bottom:14px;transform:rotate(-12deg);border:2px solid var(--warn);color:var(--warn);
  font-weight:800;padding:2px 8px;border-radius:6px;letter-spacing:.08em}
.sk-row{flex-direction:row;align-items:center;min-height:44px;border-radius:0;border-width:0 0 1px 4px;border-style:solid}
.sk-row .sk-price{margin:0 0 0 auto;white-space:nowrap}
.sk-row .sk-name{min-width:0}
.sk-row .sk-x{position:static;margin-inline-start:6px}
.sk-step{background:#1D1B16;color:#fff;border-radius:8px;padding:2px 8px;font-weight:700;margin-inline-start:8px;white-space:nowrap}
.sk-undo{margin-inline-start:auto;color:var(--blue);font-weight:700}
.sk-hot{background:#151412;color:#F1EEE8;border:0;border-bottom:3px solid;min-height:96px}
.sk-hot .sk-name{color:#F1EEE8}
.sk-key{display:grid;place-items:center;width:24px;height:24px;border:1px solid #555;border-radius:6px;font-size:.78em}
.sk-qty-bar{color:#151412}
.sk-photo{padding:0;overflow:hidden}
.sk-photo .sk-name,.sk-photo .sk-price{padding:0 12px}
.sk-photo .sk-price{padding-bottom:10px}
/* ⚠️⚠️ flex:0 0 auto — A PHOTO MUST NOT BE SQUEEZED. A tile is a column flex container, so this box (a flex
   item with a fixed height) shrank below it whenever the name and price wanted the room: a 384x384 photograph
   rendered 126x19, a sliver. Athi, 2026-09-18: *"the image size should not reduce, because the same panel can
   be used as a self service panel"* — measured and he was right. The tile grows instead; min-height is a
   floor, not a ceiling. --sk-ph is the lever a kiosk turns up. */
.sk-ph{display:block;flex:0 0 auto;width:100%;height:var(--sk-ph,56px);border-radius:8px;overflow:hidden}
.sk-ph-big{flex:0 0 auto;height:var(--sk-ph,78px);border-radius:0;border-bottom:3px solid var(--line)}
.sk-ph img{width:100%;height:100%;object-fit:cover;display:block}
.sk-init{display:grid;place-items:center;width:100%;height:100%;font-weight:800;font-size:1.3em}
.sk-inbill-tag{position:absolute;top:6px;inset-inline-start:6px;background:#151412;color:#fff;border-radius:10px;padding:1px 8px;font-size:.75em;font-weight:700}
.sk-outchip{position:absolute;top:6px;inset-inline-start:6px;background:#151412;color:#fff;border-radius:4px;padding:1px 6px}
.sk-picker{box-sizing:border-box;max-width:100%;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:16px;padding:10px 14px;min-width:300px;box-shadow:0 12px 40px rgba(0,0,0,.18)}
.sk-sheet{border-radius:22px 22px 0 0;width:100%}
.sk-full{position:fixed;inset:0;border-radius:0;z-index:50;overflow:auto}
.sk-drawer{position:fixed;top:0;bottom:0;inset-inline-end:0;width:min(380px,92vw);border-radius:16px 0 0 16px;z-index:50;overflow:auto}
.sk-phead{display:flex;justify-content:space-between;align-items:center;padding:4px 0 8px;border-bottom:1px solid var(--line)}
.sk-close{border:0;background:none;color:var(--dim);font-size:1.1em;cursor:pointer;min-width:44px;min-height:44px}
.sk-grow{display:grid;grid-template-columns:auto 1fr auto auto auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.sk-grow label{display:flex;gap:8px;align-items:center}
.sk-gbar{display:inline-block;width:6px;height:28px;border-radius:3px}
.sk-gname{color:var(--blue);font-weight:700;text-decoration:underline;cursor:pointer}
.sk-gwin,.sk-gcount{color:var(--dim);font-size:.85em;font-family:${MONO}}
.sk-chev{cursor:pointer;color:var(--dim);font-size:1.3em;padding:0 6px}
.sk-ihead{display:flex;justify-content:space-between;padding:8px 0}
.sk-ihead a{color:var(--blue);cursor:pointer}
.sk-irow{display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}
.sk-tabs{display:flex;gap:4px;overflow-x:auto}
.sk-tab{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:10px 10px 0 0;padding:8px 14px;font:inherit;cursor:pointer;border-bottom:3px solid transparent}
.sk-tab.on{border-bottom-color:var(--gbar);font-weight:700}
.sk-rail{display:flex;flex-direction:column;gap:8px;min-width:200px}
.sk-railrow{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;align-items:center}
.sk-railbar{grid-column:2;height:4px;background:var(--line);border-radius:2px;overflow:hidden}
.sk-railbar i{display:block;height:100%}
.sk-day{display:flex;gap:4px;width:100%}
.sk-dayblock{border:0;border-radius:10px;padding:8px 10px;text-align:start;font:inherit;cursor:pointer;display:flex;flex-direction:column}
.sk-tray{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 2px}
.sk-tray b{font-size:.78em;letter-spacing:.08em;color:var(--dim)}
.sk-trayitem{border:1px dashed var(--edge);border-radius:999px;background:var(--card);color:var(--dim);padding:4px 12px;font:inherit;cursor:pointer;text-decoration:line-through}
.sk-trayitem::after{content:" ↺";text-decoration:none;display:inline-block;margin-inline-start:4px}
`;

  return { THEMES, THEME_FONTS, GROUP_COLOURS, TILES, PICKERS, LAYOUTS, SLOTS, PRESETS, DENSITIES, DEFAULT, CSS,
           groupColour, initials, tile, picker, missingSlots, autoLayout, resolve, themeVars, themeCss, esc };
}));
