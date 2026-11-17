/* list-ctl-css.js — the look of CBList (app/list-ctl.js): the one stylesheet the list unit injects once (#cblist_css).
 * OWNS      the list unit's CSS text: design tokens only, a fallback for every one, so a bare page renders right; the list's own tap rules, phone cards and forced-colors rules.
 * CALLED BY app/list-ctl.js (at the end of its own file: CBListParts.css(kit) gives back CSS, which injectCss writes into one <style id="cblist_css">). Loaded BEFORE app/list-ctl.js by every page that loads it.
 * FLOW      page loads this file → then list-ctl.js → list-ctl.js asks CBListParts.css({ PHONE_MAX }) → injectCss(el) writes it on the first mount
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/list-control
 * Split out of list-ctl.js (shrink W2, 2026-11-17): the text is byte for byte what the unit carried; only the file it lives in changed.
 */
(function (root) {
  'use strict';
  root.CBListParts = root.CBListParts || {};
  /** the list unit's stylesheet, part 1 of 8 (the list's custom properties, the head and the toolbar): one string per rule group, tokens only with a fallback for each */
  const CSS_P1 = [
      '.cbl{--cl-page:var(--page,var(--paper,#FCFAF5));--cl-card:var(--card,#FFFFFF);--cl-panel:var(--panel,#F3EFE6);--cl-line:var(--line,#DDD6C6);--cl-soft:var(--line-soft,#E6E0D2);--cl-hair:var(--hair,#F0ECE2);',
      '--cl-ink:var(--ink,#1D1B16);--cl-muted:var(--muted,#5E594D);--cl-faint:var(--faint,#8A8374);--cl-ghost:var(--ghost,#A8A295);',
      '--cl-gband:color-mix(in srgb,var(--cl-blue) 13%,var(--cl-page));--cl-zebra:var(--zebra,color-mix(in srgb,var(--cl-ink) 9%,var(--cl-card)));--cl-hov:color-mix(in srgb,var(--cl-blue) 8%,var(--cl-card));',
      '--cl-green:var(--green,#16693F);--cl-amber-t:var(--amber-t,#FDF3DC);--cl-amber-b:var(--amber-b,#EFD39A);--cl-amber-i:var(--amber-i,#7A5205);',
      '--cl-red-t:var(--red-t,#FBEAE3);--cl-red-b:var(--red-b,#E7B9A8);--cl-red-i:var(--red-i,#8E3517);',
      '--cl-blue:var(--blue,#2F74C9);--cl-blue-t:var(--blue-t,#E4EEFA);--cl-blue-b:var(--blue-b,#B9D2EF);--cl-blue-i:var(--blue-i,#174A87);',
      '--cl-shadow:var(--shadow,0 10px 28px rgba(29,27,22,.16));--cl-ui:var(--f-ui,"IBM Plex Sans","Segoe UI",system-ui,sans-serif);--cl-display:var(--f-display,"Bricolage Grotesque","Segoe UI",system-ui,sans-serif);--cl-num:var(--f-num,"IBM Plex Mono",ui-monospace,"Cascadia Mono",monospace);',
      'display:flex;flex-direction:column;min-width:0;min-height:0;box-sizing:border-box;position:relative;background:var(--cl-page);color:var(--cl-ink);font:calc(15px * var(--k,1))/1.45 var(--cl-ui);container-type:inline-size;container-name:screen;text-align:start;letter-spacing:normal;text-transform:none}',
      '.cbl *,.cbl *::before,.cbl *::after{box-sizing:border-box}',
      '.cbl button,.cbl select,.cbl input{font:inherit;color:inherit}.cbl button{cursor:pointer;min-height:0;line-height:1.3}',
      '.cbl :focus-visible{outline:2px solid var(--cl-blue);outline-offset:2px}',
      '.cbl .cbl-num{font-family:var(--cl-num);font-variant-numeric:tabular-nums}',
      /* row 1 · the title row */
    '.cbl .cbl-title{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;padding:8px 20px 6px;border-bottom:1px solid var(--cl-soft);background:var(--cl-page)}',
      '.cbl .cbl-title h1{font:800 calc(24px * var(--k,1))/1.1 var(--cl-display);margin:0;letter-spacing:-.01em;text-wrap:balance;color:var(--cl-ink)}',
      '.cbl .cbl-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--cl-line);background:var(--cl-card);border-radius:999px;padding:3px 10px;margin:0;font-size:calc(13.5px * var(--k,1));white-space:nowrap}',
      '.cbl .cbl-title .cbl-chip{white-space:normal;max-width:100%;min-width:0;text-align:start;border-radius:14px;line-height:1.3}',
      '.cbl .cbl-chip.period{font-family:var(--cl-num);font-size:calc(13px * var(--k,1))}',
      '.cbl .cbl-chip.warn{background:var(--cl-amber-t);border-color:var(--cl-amber-b);color:var(--cl-amber-i);font-weight:600}',
      '.cbl .cbl-chip.bad{background:var(--cl-red-t);border-color:var(--cl-red-b);color:var(--cl-red-i);font-weight:600}',
      '.cbl .cbl-chip.ask{background:var(--cl-blue-t);border-color:var(--cl-blue-b);color:var(--cl-blue-i);font-weight:600}.cbl .cbl-chip.ask[aria-pressed=true]{background:var(--cl-blue);border-color:var(--cl-blue);color:var(--on-accent,#fff)}',
      '.cbl .cbl-chip.warn::before,.cbl .cbl-chip.bad::before{content:"⚠"}',
      '.cbl button.cbl-chip.warn::after,.cbl button.cbl-chip.bad::after{content:"›";opacity:.7}',
      /* row 2 · tools */
    '.cbl .cbl-tools[hidden]{display:none}',
      '.cbl .cbl-tools{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;padding:6px 20px 6px;background:var(--cl-page)}',
      '.cbl .cbl-search{flex:1 1 200px;min-width:0;display:flex;align-items:center;gap:6px;border:1px solid var(--cl-line);background:var(--cl-card);border-radius:9px;padding:0 10px;height:34px}',
      '.cbl .cbl-search input{border:0;outline:0;background:none;flex:1;min-width:0;font-size:calc(14px * var(--k,1));padding:0;margin:0;height:auto;box-shadow:none}',
      '.cbl .cbl-search:focus-within{border-color:var(--cl-blue)}'
  ];
  /** the list unit's stylesheet, part 2 of 8 (the column header, the rows and the cells): one string per rule group, tokens only with a fallback for each */
  const CSS_P2 = [
      /* the pill border follows the focus; the ring is the input's own (next line), so the focused element itself shows it (WCAG 2.4.7, 2.4.11) */
    '.cbl .cbl-search input:focus-visible{outline:2px solid var(--cl-blue);outline-offset:1px;border-radius:4px}',
      '.cbl .cbl-tbtn{height:34px;display:inline-flex;align-items:center;gap:5px;border:1px solid var(--cl-line);background:var(--cl-card);border-radius:9px;padding:0 10px;font-size:calc(13.5px * var(--k,1));white-space:nowrap;margin:0}',
      '.cbl .cbl-tbtn[aria-pressed="true"],.cbl .cbl-tbtn.on{border-color:var(--cl-blue-b);background:var(--cl-blue-t);color:var(--cl-blue-i);font-weight:600}',
      '.cbl .cbl-needs{border-color:var(--warn,#B7791F);background:var(--warn-tint,#FFF4D6);color:var(--warn-3,#7A4B00);font-weight:600}.cbl .cbl-needs[aria-pressed="true"]{background:var(--warn,#B7791F);border-color:var(--warn-3,#7A4B00);color:var(--on-accent,#fff)}',
      '.cbl .cbl-needs.clear{border-color:var(--cl-line);background:var(--cl-card);color:var(--grey,#5E594D);font-weight:400;cursor:default}.cbl .cbl-needs-prog{font-size:calc(13px * var(--k,1));color:var(--grey,#5E594D);white-space:nowrap}',
      '.cbl .cbl-tools:has(.cbl-needs) .cbl-search{flex:1 1 120px}',
      '.cbl .cbl-tbtn .badge{background:var(--cl-blue);color:var(--cl-card);border-radius:999px;font-size:calc(11px * var(--k,1));padding:0 6px;font-weight:700}',
      '.cbl .cbl-glab{font-size:calc(12px * var(--k,1));color:var(--cl-muted);white-space:nowrap;margin-inline-end:-2px}',
      '@media (max-width:1100px){.cbl .cbl-tools{gap:5px 6px;padding-inline:12px}.cbl .cbl-seg button{padding:0 6px}.cbl .cbl-count{padding:0 2px}.cbl .cbl-search{flex-basis:170px}}',
      /* GROUP as one labelled dropdown ("Group ▾ None"): opts.group.as = 'select' */
    '.cbl .cbl-gsel{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--cl-line);background:var(--cl-card);border-radius:9px;height:34px;padding:0 6px 0 10px;margin:0}',
      '.cbl .cbl-gsel .cbl-glab{margin:0;font-weight:600}',
      '.cbl .cbl-gsel select{border:0;background:none;height:32px;padding:0 2px;font-size:calc(13.5px * var(--k,1));font-weight:600;color:var(--cl-ink);cursor:pointer;max-width:170px}',
      '.cbl .cbl-gsel:focus-within{border-color:var(--cl-blue)}',
      /* SAVED VIEWS as tabs above the tools row: one tap sets the list's own filters (no second filter engine) */
    '.cbl .cbl-views{display:flex;align-items:center;gap:6px;padding:2px 20px 6px;background:var(--cl-page);overflow-x:auto;scrollbar-width:none}',
      '.cbl .cbl-views::-webkit-scrollbar{display:none}',
      '.cbl .cbl-title .cbl-views.in-title{padding:0;background:none;overflow:visible;flex-wrap:wrap}',
      '.cbl .cbl-vtab{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;height:30px;border:1px solid var(--cl-line);background:var(--cl-card);border-radius:999px;padding:0 12px;font-size:calc(13px * var(--k,1));font-weight:600;white-space:nowrap;margin:0;color:var(--cl-ink)}',
      '.cbl .cbl-vtab .n{font-family:var(--cl-num);font-size:calc(11.5px * var(--k,1));color:var(--cl-muted);font-weight:500}',
      '.cbl .cbl-vtab[aria-selected="true"]{background:var(--cl-ink);border-color:var(--cl-ink);color:var(--cl-page)}',
      '.cbl .cbl-vtab[aria-selected="true"] .n{color:var(--cl-page)}',
      /* a column heading's own filter (opts.columns[].hfilter = a filter key) */
    '.cbl .cbl-hf{border:0;background:none;padding:0 2px;margin:0;color:var(--cl-blue-i);font-size:calc(11px * var(--k,1));line-height:1;cursor:pointer;border-radius:5px;min-width:24px;height:24px;flex:none;position:relative;z-index:3}',
      '.cbl .cbl-hf.on{background:var(--cl-blue-t);font-weight:800}',
      '.cbl .cbl-pop.hf{position:absolute;inset-inline-end:auto;min-width:170px;padding:6px;text-transform:none;letter-spacing:normal}',
      '.cbl .cbl-pop.hf button{display:block;width:100%;text-align:start;border:0;background:none;border-radius:7px;padding:6px 10px;font-size:calc(13.5px * var(--k,1));color:var(--cl-ink)}',
      '.cbl .cbl-pop.hf button:hover{background:var(--cl-hov)}',
      '.cbl .cbl-pop.hf button[aria-checked="true"]{background:var(--cl-blue-t);color:var(--cl-blue-i);font-weight:700}'
  ];
  /** the list unit's stylesheet, part 3 of 8 (the group heads, the next level and the states): one string per rule group, tokens only with a fallback for each */
  const CSS_P3 = [
      /* an action that this login may not do stays on screen, greyed, with its sentence */
    '.cbl .cbl-act{display:inline-flex;flex-direction:column;align-items:flex-start;gap:2px}',
      '.cbl .cbl-btn:disabled{opacity:.55;cursor:not-allowed}',
      '.cbl .cbl-why{font-size:calc(11.5px * var(--k,1));color:var(--cl-muted);max-width:26ch;line-height:1.3}',
      '.cbl .cbl-seg{display:inline-flex;border:1px solid var(--cl-line);border-radius:9px;overflow:hidden;background:var(--cl-card);height:34px}',
      '.cbl .cbl-seg button{border:0;background:none;padding:0 10px;font-size:calc(13.5px * var(--k,1));border-inline-start:1px solid var(--cl-soft);margin:0;border-radius:0}',
      '.cbl .cbl-seg button:first-child{border-inline-start:0}',
      '.cbl .cbl-seg button[aria-pressed="true"]{background:var(--cl-ink);color:var(--cl-page);font-weight:600}',
      '.cbl .cbl-ico{width:34px;justify-content:center;padding:0}',
      '.cbl .cbl-count{font-family:var(--cl-num);font-size:calc(13px * var(--k,1));color:var(--cl-muted);padding:0 4px;white-space:nowrap}',
      '.cbl .cbl-fchips{display:flex;flex-wrap:wrap;gap:6px;width:100%}.cbl .cbl-fchips:empty{display:none}',
      '.cbl .cbl-fchip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--cl-blue-b);background:var(--cl-blue-t);color:var(--cl-blue-i);border-radius:999px;padding:1px 4px 1px 10px;font-size:calc(12.5px * var(--k,1))}',
      '.cbl .cbl-fchip button{border:0;background:none;color:inherit;width:20px;height:20px;border-radius:50%;padding:0}',
      '.cbl .cbl-anchor{position:relative}',
      '.cbl .cbl-pop{position:absolute;top:calc(100% + 6px);inset-inline-end:0;z-index:20;background:var(--cl-card);border:1px solid var(--cl-line);border-radius:12px;box-shadow:var(--cl-shadow);padding:10px 12px;min-width:220px;max-height:min(70vh,480px);overflow:auto;font-size:calc(13.5px * var(--k,1));text-transform:none;font-weight:400;letter-spacing:normal;color:var(--cl-ink)}',
      '.cbl .cbl-pop.left{inset-inline-end:auto;inset-inline-start:0}',
      '.cbl .cbl-notes{display:flex;flex-direction:column;align-items:flex-start;gap:6px}',
      '.cbl .cbl-pop h4{margin:4px 0 6px;font-size:calc(11px * var(--k,1));letter-spacing:.07em;text-transform:uppercase;color:var(--cl-muted);font-weight:700}',
      '.cbl .cbl-pop .f{display:grid;grid-template-columns:80px 1fr;align-items:center;gap:8px;margin:6px 0}',
      '.cbl .cbl-pop select{border:1px solid var(--cl-line);border-radius:7px;background:var(--cl-card);padding:3px 6px}',
      '.cbl .cbl-preset{display:grid;gap:2px}',
      '.cbl .cbl-preset button{text-align:start;border:0;background:none;border-radius:7px;padding:5px 8px}',
      '.cbl .cbl-preset button[aria-pressed="true"]{background:var(--cl-blue-t);color:var(--cl-blue-i);font-weight:600}',
      '.cbl .cbl-custom{display:flex;gap:6px;align-items:center;margin-top:6px;font-size:calc(13px * var(--k,1))}',
      '.cbl .cbl-custom input{border:1px solid var(--cl-line);border-radius:7px;padding:2px 6px;background:var(--cl-card);font-family:var(--cl-num);font-size:calc(12.5px * var(--k,1));width:128px}',
      '.cbl .cbl-btn{border:1px solid var(--cl-line);background:var(--cl-card);border-radius:9px;padding:3px 10px;font-size:calc(13px * var(--k,1));font-weight:500}',
      '.cbl .cbl-acts{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}',
      '.cbl .cbl-colrow{display:flex;align-items:center;gap:6px;padding:2px 0}',
      '.cbl .cbl-colrow label{flex:1 1 auto!important;display:flex!important;flex-direction:row!important;align-items:center!important;gap:7px!important;padding:3px 8px;border-radius:6px;cursor:pointer;white-space:nowrap;margin:0;font-weight:400}',
      '.cbl .cbl-colrow label:has(input:checked){background:var(--cl-blue-t);color:var(--cl-blue-i);font-weight:600}'
  ];
  /** the list unit's stylesheet, part 4 of 8 (the popovers, the chooser and the filters): one string per rule group, tokens only with a fallback for each */
  const CSS_P4 = [
      '.cbl .cbl-colrow input{accent-color:var(--cl-blue);width:14px;height:14px}',
      '.cbl .cbl-mv{width:24px;height:24px;border:1px solid var(--cl-line);background:var(--cl-card);border-radius:6px;padding:0;font-size:calc(12px * var(--k,1));flex:0 0 auto}',
      '.cbl .cbl-mv:disabled{opacity:.3;cursor:default}.cbl .cbl-mvsp{width:24px;flex:0 0 auto}',
      '.cbl .cbl-noroom{font-size:calc(11.5px * var(--k,1));color:var(--cl-amber-i);margin-inline-start:4px}',
      /* row 3 · the column header + the rows: ONE scroll area, the header sticky inside it */
    '.cbl .cbl-list{flex:1;min-height:0;overflow:auto;border-top:1px solid var(--cl-line);background:var(--cl-card);container-type:inline-size;container-name:list;overscroll-behavior:contain}',
      '.cbl .cbl-grid{display:grid;min-width:max-content}.cbl .cbl-grid.cbl-lines,.cbl .cbl-grid.cbl-fit{min-width:0}',
      '.cbl .cbl-hdr{position:sticky;top:0;z-index:5;display:grid;background:var(--cl-panel);border-bottom:1.5px solid var(--cl-line)}',
      '.cbl .cbl-hc{position:relative;display:flex;align-items:center;gap:4px;padding:7px 12px;font-size:calc(12px * var(--k,1));font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--cl-muted);white-space:nowrap;min-width:0;user-select:none}',
      '.cbl .cbl-hc.r{justify-content:flex-end}',
      '.cbl .cbl-hc .sort{border:0;background:none;padding:0;font:inherit;color:inherit;letter-spacing:inherit;text-transform:inherit;display:inline-flex;gap:3px;align-items:center}',
      '.cbl .cbl-hc .sort{min-width:0;max-width:100%}.cbl .cbl-hc .sort .cbl-hl{min-width:0;white-space:normal;overflow-wrap:anywhere;text-align:start;line-height:1.25}',
      /* the resize grip (24 px, centred on the column edge) covers the last 12 px of its cell: the filter caret stays inside that line and the last column's grip (24 px, inside) gets its room (QA-156) */
    '.cbl .cbl-hc:last-child:has(.cbl-hf),.cbl .cbl-hc.r.sortable:last-child{padding-inline-end:26px}',
      '.cbl .cbl-hc .arrow{color:var(--cl-blue);font-size:calc(11px * var(--k,1))}',
      '.cbl .cbl-rz{position:absolute;inset-inline-end:-12px;top:0;bottom:0;width:24px;cursor:col-resize;z-index:2;border:0;background:none;padding:0;touch-action:none}',
      /* T3-COMPAT: the LAST column's handle stays inside the grid — hung 4 px past its edge it gave every filled list a 4 px sideways scroll (rule 13) */
    '.cbl .cbl-hc:last-child > .cbl-rz{inset-inline-end:0}',
      /* a 24 px filter button would make the header row 4 px taller: its cell gives the height back in padding */
    '.cbl .cbl-hc:has(.cbl-hf){padding-block:5px}',
      '.cbl .cbl-hc:has(.sort){padding-block:0}',
/* a sortable heading: its 32 px tap target IS the row (7 px above and below it made the header 46 px and pushed the first Day book row to 232 px = 30.2%); the target stays 32 px */
    '.cbl .cbl-hc:last-child > .cbl-rz::after{inset-inline-start:auto;inset-inline-end:4px}',
      '.cbl .cbl-hc:last-child > .cbl-rz:hover::after,.cbl .cbl-hc:last-child > .cbl-rz:focus-visible::after,.cbl .cbl-hc:last-child > .cbl-rz.drag::after{inset-inline-start:auto;inset-inline-end:3px}',
      '.cbl .cbl-rz::after{content:"";position:absolute;inset-inline-start:11px;top:6px;bottom:6px;width:1px;background:var(--cl-line)}',
      '.cbl .cbl-rz:hover::after,.cbl .cbl-rz:focus-visible::after,.cbl .cbl-rz.drag::after{width:3px;inset-inline-start:10px;background:var(--cl-blue)}',
      '.cbl .cbl-row{display:grid;align-items:center;border-bottom:1px solid var(--cl-hair);cursor:pointer;position:relative}',
      /* ZEBRA (Athi, 2026-10-09): every other data row, one shade from a theme token (--zebra, else the ink mixed 4% into the card, so every theme keeps its contrast); a group head, the hover row and the selected row stay distinct; a multi-line row is ONE stripe */
    '.cbl .cbl-row.z,.cbl .cbl-lrec.z{background:var(--cl-zebra)}',
      '.cbl .cbl-row:hover{background:var(--cl-hov)}'
  ];
  /** the list unit's stylesheet, part 5 of 8 (the phone cards and the container query): one string per rule group, tokens only with a fallback for each */
  function cssPart5(phoneMax) {
    return [
      '.cbl .cbl-row.sel{background:var(--cl-blue-t);box-shadow:inset 0 0 0 2px var(--cl-blue)}',
      '.cbl .cbl-cell{padding:8px 12px;min-width:0;overflow-wrap:break-word;word-break:normal}',
      '.cbl .cbl-cell.r{text-align:end}',
      '.cbl .cbl-cell.mono{font-family:var(--cl-num);font-variant-numeric:tabular-nums;font-size:calc(13.5px * var(--k,1))}',
      '.cbl .cbl-cell.strong{font-weight:700}',
      '.cbl .cbl-lead{padding:8px 0 8px 12px;display:flex;align-items:center}',
      '.cbl .cbl-tw{display:inline-block;width:14px;color:var(--cl-faint);transition:transform .15s}',
      '.cbl .cbl-open>.cbl-cell>.cbl-tw,.cbl .cbl-open .cbl-tw{transform:rotate(90deg)}',
      '.cbl .cbl-link{color:var(--cl-blue);text-decoration:underline;text-underline-offset:2px;font-family:var(--cl-num);font-size:calc(13.5px * var(--k,1))}',
      '.cbl .cbl-dim{color:var(--cl-faint)}',
      '.cbl .cbl-group{position:sticky;top:var(--cl-hdr-h,35px);z-index:3;display:flex;flex-wrap:wrap;gap:2px 8px;align-items:baseline;padding:6px 12px;background:var(--cl-gband);color:var(--cl-ink);border-top:1px solid var(--cl-line);border-bottom:1px solid var(--cl-line);border-inline-start:4px solid var(--cl-blue);font-size:calc(12px * var(--k,1));text-transform:uppercase;letter-spacing:.04em}',
      '.cbl .cbl-row.ing>:first-child{padding-inline-start:28px}.cbl .cbl-lrec.ing{padding-inline-start:28px}',
      '.cbl .cbl-group b{font-weight:700}.cbl .cbl-group .fig{font-family:var(--cl-num);font-size:calc(12px * var(--k,1));color:var(--cl-ink);text-transform:none;letter-spacing:0}',
      /* W15-108 (Athi, 15 Nov: "i have no idea which one is header, which one i can expand, which one is information"): a band is TINTED caps with its total at the right; a row that opens carries a bordered ▸ button and lights across the whole row;
       what it opens to is an INDENTED panel with a rule at its left, holding an info strip and then a real sub-table under its own grey header; information is never drawn like a button */
    '.cbl .cbl-next{background:var(--cl-page);border-bottom:1px solid var(--cl-soft);margin:0 0 6px 26px;padding:8px 12px 10px 14px;border-inline-start:3px solid var(--cl-blue);cursor:default;overflow-wrap:break-word;word-break:normal}',
      '.cbl .cbl-row[aria-expanded]>.cbl-cell .cbl-tw,.cbl .cbl-row[aria-expanded] .cbl-tw{border:1px solid var(--cl-line);border-radius:6px;background:var(--cl-card);color:var(--cl-ink);font-size:calc(13px * var(--k,1))}/* the LOOK only (W15-108): its size is the tap rule below (32 px laptop, 44 px phone) - a width here out-ranks it (24 px drew, walk-list-tap 52 XX) */',
      '@media (max-width:' + phoneMax + 'px){.cbl .cbl-row[aria-expanded] .cbl-tw{margin-inline:-6px 6px}}',
      /* the bordered 44 px caret sits inside the card, not over its edge */
    '.cbl .cbl-row[aria-expanded]:hover{background:var(--cl-hov)}.cbl .cbl-row[aria-expanded]:hover .cbl-tw{border-color:var(--cl-blue)}',
      '.cbl .cbl-group .fig{margin-inline-start:auto}',
      '.cbl .cbl-nstrip{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline;padding:2px 0 8px;color:var(--cl-muted);font-size:calc(12px * var(--k,1))}',
      '.cbl .cbl-nstrip>span,.cbl .cbl-nstrip .cbl-nchip{padding:0}.cbl .cbl-nstrip b{color:var(--cl-ink);font-family:var(--cl-num);font-weight:600}',
      '.cbl .cbl-nchip{border:1px solid var(--cl-line);border-radius:999px;background:var(--cl-card);color:var(--cl-ink);padding:2px 10px;min-height:24px;cursor:pointer;font:inherit}.cbl .cbl-nchip:hover{border-color:var(--cl-blue)}.cbl .cbl-nchip[aria-pressed="true"]{background:var(--cl-blue-t);border-color:var(--cl-blue);font-weight:700}',
      '.cbl .cbl-ntab{min-width:1000px;display:flex;flex-direction:column;border:1px solid var(--cl-line);border-radius:8px;background:var(--cl-card);overflow:hidden}',
      '.cbl .cbl-nthead{display:flex;align-items:center;background:var(--cl-gband);border-bottom:1px solid var(--cl-line);font-size:calc(11px * var(--k,1));text-transform:uppercase;letter-spacing:.04em;color:var(--cl-muted)}',
      '.cbl .cbl-ntrow{display:flex;align-items:center;border-bottom:1px solid var(--cl-hair);font-size:calc(13.5px * var(--k,1))}.cbl .cbl-ntrow:last-child{border-bottom:0}',
      '.cbl .cbl-ntc{flex:0 0 auto;padding:5px 8px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box}.cbl .cbl-ntc.first{flex:1 1 90px}.cbl .cbl-ntc.r{text-align:end}',
      '.cbl .cbl-ntc button.cbl-nsort{all:unset;cursor:pointer;display:inline-flex;gap:3px;align-items:center;min-height:24px;text-transform:inherit;letter-spacing:inherit}.cbl .cbl-ntc button.cbl-nsort:focus-visible{outline:2px solid var(--cl-blue)}',
      '.cbl .cbl-nempty{padding:10px;color:var(--cl-muted)}'
    ];
  }
  /** the list unit's stylesheet, part 6 of 8 (tick boxes, forced colors and the small controls): one string per rule group, tokens only with a fallback for each */
  const CSS_P6 = [
      '.cbl .cbl-ntab.cards{min-width:0}.cbl .bk-tabwrap{overflow-x:auto}.cbl .cbl-ntab.cards .cbl-ntc.end{margin-inline-start:auto}.cbl .cbl-ntab.cards .cbl-ntc{overflow:visible}',
      '@media (max-width:700px){.cbl .bk-tabwrap{overflow:visible}.cbl .cbl-ntab.cards .cbl-nthead{display:none}.cbl .cbl-ntab.cards .cbl-ntrow{flex-wrap:wrap;align-items:center;gap:2px 10px;padding:6px 8px}.cbl .cbl-ntab.cards .cbl-ntrow::after{content:"";flex:0 0 100%;order:2;height:0}.cbl .cbl-ntab.cards .cbl-ntrow .cbl-ntc{width:auto!important;padding:0;flex:0 0 auto;order:1}.cbl .cbl-ntab.cards .cbl-ntrow .cbl-ntc[data-ln="0"]{display:none}.cbl .cbl-ntab.cards .cbl-ntrow .cbl-ntc[data-ln="2"]{order:3}.cbl .cbl-ntab.cards .cbl-ntrow .cbl-ntc.end{margin-inline-start:auto}.cbl .cbl-ntab.cards .cbl-ntrow .cbl-ntc.first{flex:0 0 auto}.cbl .bk-bands{display:grid;grid-template-columns:1fr 1fr;gap:6px}.cbl .bk-bands .bk-bw{display:none}.cbl .bk-bands>span{grid-column:1/-1}}',
      '.cbl .bk-needs .cbl-nchip{padding:0 8px;min-height:22px;font-size:calc(12px * var(--k,1))}.cbl .bk-needs .bk-need-more{color:var(--cl-muted)}',
      '.cbl .cbl-next .gist{color:var(--cl-muted);font-size:calc(13px * var(--k,1));margin-bottom:6px}',
      /* ☰ lines */
    '.cbl .cbl-lrec{border-bottom:1px solid var(--cl-hair);padding:8px 12px;cursor:pointer}',
      '.cbl .cbl-lrec:hover{background:var(--cl-hov)}',
      '.cbl .cbl-lrec.sel{background:var(--cl-blue-t);box-shadow:inset 0 0 0 2px var(--cl-blue)}',
      '.cbl .cbl-lline{display:flex;gap:4px 10px;align-items:baseline}',
      '.cbl .cbl-lflow{flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:2px 0}',
      '.cbl .cbl-lflow > span:not(:last-child)::after{content:"·";color:var(--cl-ghost);margin:0 7px}',
      '.cbl .cbl-lamt{font-family:var(--cl-num);font-weight:700;white-space:nowrap}',
      '.cbl .cbl-lgist{color:var(--cl-muted);font-size:calc(13px * var(--k,1));padding-inline-start:22px;margin-top:1px}',
      /* states */
    '.cbl .cbl-state{padding:44px 20px;text-align:center;color:var(--cl-muted)}',
      '.cbl .cbl-state .big{font:700 calc(18px * var(--k,1)) var(--cl-display);color:var(--cl-ink);margin-bottom:4px}',
      '.cbl .cbl-state .cbl-btn{margin-top:10px}',
      '.cbl .cbl-end{text-align:center;padding:12px 10px;font:calc(12px * var(--k,1)) var(--cl-num);color:var(--cl-muted)}',
      '.cbl .cbl-end button{margin-inline-end:8px;border:1px solid var(--cl-blue);background:var(--cl-blue);color:var(--cl-card);border-radius:9px;padding:5px 11px;font-weight:700}',
      '.cbl .cbl-skel{height:36px;margin:8px 12px;border-radius:8px;background:linear-gradient(90deg,var(--cl-hair),var(--cl-panel),var(--cl-hair));background-size:200% 100%;animation:cbl-sk 1.2s infinite linear}',
      '@keyframes cbl-sk{to{background-position:-200% 0}}',
      '@media (prefers-reduced-motion: reduce){.cbl .cbl-skel{animation:none}.cbl .cbl-tw{transition:none}}',
      '.cbl .cbl-foot{padding:8px 12px;border-top:1px solid var(--cl-soft)}',
      '.cbl .cbl-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
      /* a phone, or any narrow pane: one card per row, label : value, nothing sideways (a container query, not the page width) */
    '@container list (max-width: 620px){',
      '.cbl .cbl-grid{min-width:0;grid-template-columns:minmax(0,1fr)}/* R47: a card never grows its one track past the box (Parties scrolled sideways at 390) */.cbl .cbl-hdr{display:none}',
      '.cbl .cbl-row{display:flex;flex-wrap:wrap;gap:0 10px;padding:8px 12px;margin:8px 10px;border:1px solid var(--cl-line);border-radius:12px;background:var(--cl-card)}',
      '.cbl .cbl-row .cbl-cell{padding:2px 0}',
      '.cbl .cbl-row .cbl-cell.cbl-actline{flex:1 1 auto;order:9;text-align:start;align-self:center}.cbl .cbl-row .cbl-cell.cbl-actline:empty{display:none}'
  ];
  /** the list unit's stylesheet, part 7 of 8 (the remaining small rules): one string per rule group, tokens only with a fallback for each */
  function cssPart7(phoneMax) {
    return [
      '.cbl .cbl-row .cbl-cell[data-l]:not([data-l=""])::before{content:attr(data-l) " ";color:var(--cl-faint);font-size:calc(11px * var(--k,1));letter-spacing:.05em;text-transform:uppercase;margin-inline-end:4px;font-family:var(--cl-ui);font-weight:600}',
      '.cbl .cbl-row .cbl-cell.first{width:100%;font-weight:600}.cbl .cbl-row .cbl-cell.amt{margin-inline-start:auto}',
      '.cbl .cbl-row .cbl-lead{position:absolute;inset-inline-end:8px;top:6px;padding:0}',
      '.cbl .cbl-next{margin:-6px 10px 8px;border-radius:0 0 12px 12px;padding-inline-start:14px}',
      '.cbl .cbl-lline{flex-wrap:wrap}.cbl .cbl-lamt{margin-inline-start:auto}.cbl .cbl-lflow{flex:1 1 100%;order:2}',
      '}',
      '@container screen (max-width: 640px){',
      '.cbl .cbl-title{padding:8px 16px 6px;gap:5px 8px}.cbl .cbl-tools{padding:6px 16px;gap:6px}.cbl .cbl-title h1{font-size:calc(21px * var(--k,1))}.cbl .cbl-search{flex-basis:100%}',
      '.cbl .cbl-pop,.cbl .cbl-pop.left{position:fixed;inset-inline:8px;top:auto;bottom:8px;max-height:min(70%,520px);min-width:0;z-index:30}',
      '.cbl .cbl-chip{font-size:calc(12px * var(--k,1));padding:3px 9px}.cbl .cbl-chip.period{font-size:calc(12px * var(--k,1))}.cbl .cbl-seg button,.cbl .cbl-tbtn{padding:0 8px}.cbl .cbl-ico{padding:0}',
      '}',
      /* UX-137 TAP RULE (Athi 10 Nov): a desktop control is 32 px at least, a phone's 44 px; a word beside a toolbar icon leaves a phone (the aria-label keeps it) */
    '.cbl .cbl-tw{display:inline-flex;align-items:center;justify-content:center;width:32px;min-height:32px;margin-inline:-9px 6px;margin-block:-8px;vertical-align:middle}/* REP-73 B5: a gap on the end side, so the box never sits over the first letter of the name (it was -9px on both sides) */.cbl .cbl-search input{align-self:stretch}',
      '.cbl .cbl-ico{width:auto;min-width:34px}.cbl .cbl-w{font-size:calc(13px * var(--k,1))}.cbl .cbl-ico .cbl-w{margin-inline-start:1px}',
      '.cbl .cbl-chip,.cbl .cbl-btn,.cbl .cbl-vtab,.cbl .cbl-seg button,.cbl .cbl-tbtn,.cbl .cbl-end button,.cbl .cbl-fchip button,.cbl .cbl-hf,.cbl .cbl-mv,.cbl .cbl-hc .sort,.cbl .cbl-pop button{min-height:32px}',
      '.cbl .cbl-vtab{height:auto}.cbl .cbl-mv,.cbl .cbl-mvsp{width:32px;height:32px}.cbl .cbl-hf,.cbl .cbl-fchip button,.cbl .cbl-seg button{min-width:32px}.cbl .cbl-fchip button{width:auto;height:auto}',
      '.cbl .cbl-search,.cbl .cbl-gsel{min-height:34px}.cbl .cbl-pop select,.cbl .cbl-custom input{min-height:32px}.cbl input[type="checkbox"]{width:24px;height:24px}',
      '@media (max-width:' + phoneMax + 'px){.cbl .cbl-w{display:none}.cbl .cbl-chip,.cbl .cbl-btn,.cbl .cbl-vtab,.cbl .cbl-seg button,.cbl .cbl-tbtn,.cbl .cbl-end button,.cbl .cbl-fchip button,.cbl .cbl-hf,.cbl .cbl-mv,.cbl .cbl-hc .sort,.cbl .cbl-pop button,.cbl .cbl-search,.cbl .cbl-gsel,.cbl .cbl-pop select,.cbl .cbl-custom input{min-height:44px}',
      '.cbl .cbl-tbtn,.cbl .cbl-seg,.cbl .cbl-search,.cbl .cbl-gsel{height:auto}.cbl .cbl-ico,.cbl .cbl-mv,.cbl .cbl-mvsp,.cbl .cbl-hf,.cbl .cbl-fchip button,.cbl .cbl-seg button{min-width:44px}.cbl .cbl-mv,.cbl .cbl-mvsp{width:44px;height:44px}.cbl input[type="checkbox"]{width:24px;height:24px}',
      /* the phone head stays within its 30% with 44 px controls: tighter gaps, the count beside the icon row */
    '.cbl .cbl-title{padding-block:4px 2px;gap:2px 8px}.cbl .cbl-tools{gap:4px 4px}.cbl .cbl-count{padding:0}.cbl .cbl-search input{min-height:44px;margin-block:-1px}',
      '.cbl .cbl-tw{width:44px;min-height:44px;margin-inline:-15px 4px;margin-block:0}',
      /* UI9: a head that says reserve:true keeps its title row at the height of the chip the data will bring (chip-less lists keep their short row), so the toolbar below never jumps (QA-156) */
    '.cbl .cbl-title.reserve h1{min-height:44px;display:flex;align-items:center}}',
      /* the pager pair every server-paged page draws with CBList.pager: 32 px on a desktop, 44 on a phone, outside the list's own box */
    'button.act.quiet.cbl-pgbtn,.cbl button.cbl-pgbtn{min-height:32px;min-width:32px}@media (max-width:' + phoneMax + 'px){button.act.quiet.cbl-pgbtn,.cbl button.cbl-pgbtn{min-height:44px;min-width:44px}}',
      /* a tick box: 24 px and never squeezed on a wide screen; on a phone the box is drawn small (22 px) inside a 44 px hit area (an unstyled native box cannot take a bigger one) */
    '.cbl input[data-selrow],.cbl input[data-col]{flex:none}',
      '@media (max-width:' + phoneMax + 'px){.cbl input[data-selrow],.cbl input[data-col]{-webkit-appearance:none;appearance:none;width:44px;height:44px;margin:0;border:0;background:none;display:inline-grid;place-content:center;cursor:pointer}',
      '.cbl input[data-selrow]::before,.cbl input[data-col]::before{content:"";width:22px;height:22px;box-sizing:border-box;border:2px solid var(--cl-muted);border-radius:5px;background:var(--cl-card);color:var(--cl-card);font-size:15px;line-height:18px;text-align:center;font-weight:700}'
    ];
  }
  /** the list unit's stylesheet, part 8 of 8 (the last rules): one string per rule group, tokens only with a fallback for each */
  function cssPart8(phoneMax) {
    return [
      '.cbl input[data-selrow]:checked::before,.cbl input[data-col]:checked::before{content:"✓";background:var(--cl-blue);border-color:var(--cl-blue)}.cbl input[data-col]:disabled{opacity:.5}}',
      '@media (forced-colors: active){.cbl input[data-selrow]::before,.cbl input[data-col]::before{forced-color-adjust:none;background:Canvas;color:Canvas;border-color:ButtonText}.cbl input[data-selrow]:checked::before,.cbl input[data-col]:checked::before{background:Highlight;color:HighlightText;border-color:Highlight}}',
      '.cbl .cbl-viewpop{display:flex;flex-direction:column;gap:8px;align-items:stretch}.cbl .cbl-viewpop .cbl-seg{align-self:flex-start}.cbl .cbl-viewpop .cbl-ico{justify-content:flex-start}.cbl .cbl-viewpop .cbl-w{display:inline}'
    ];
  }
  /** the whole stylesheet text for a phone breakpoint (the standard's 700 px): the parts in order, one rule group a line */
  function cssText(phoneMax) {
    return [].concat(CSS_P1, CSS_P2, CSS_P3, CSS_P4, cssPart5(phoneMax), CSS_P6, cssPart7(phoneMax), cssPart8(phoneMax)).join('\n');
  }
  root.CBListParts.css = cssText;
})(typeof window !== 'undefined' ? window : this);
