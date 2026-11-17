/**
 * catalogue-lines.js — ONE walk from a catalogue payload to a list of display rows.
 *
 * OWNS      the one walk from a catalogue payload to display rows (cbLineRows), the media embed and gallery (cbMediaGallery), and the category ancestors (cbCatgAncestors)
 * CALLED BY public/shop.html (cbLineRows, cbMediaGallery, cbCatgAncestors), public/app.html (cbMediaGallery only), public/app/cart.js (cbLineRows), public/app/core.js (cbCatgAncestors); loaded by script tag on shop, app, cart-design, network-design, storefront-design, supplier-design
 * FLOW      a catalogue payload { items, groups } ──▶ cbLineRows() ──▶ ordered rows [product heading | line] ──▶ each surface styles them in its own CSS
 * CARD      06-catalogue-pim/items-create-edit-bulk-status
 *
 * Athi, 2026-08-06: *"fix the supplier view as well — this should not be a separate code, it is another entry point
 * for the same view."*
 *
 * He is right, and it is the same point he made about the READ a week earlier (SPEC-one-path-many-principals):
 * *"there is no difference between a storefront or a B2B relationship… all paths remain the same."* We took that
 * seam at the read — `buildPublicView` is one implementation serving the public storefront, the B2B supplier view
 * and a network peer — and then rendered it twice. So the storefront learned to group variants and the supplier
 * view did not, which is exactly the divergence the shared read exists to prevent.
 *
 * This file is the missing half: the walk from `{items, groups}` to an ordered list of rows. Both surfaces call it
 * and then style the rows in their own house style — shop.html is a public page in its own CSS, app.html is the
 * signed-in app. Sharing the LOGIC is the requirement; sharing the CSS would be a different and worse thing.
 *
 * ── WHAT IT RETURNS ────────────────────────────────────────────────────────────────────────────────────────────
 *   [ { type:'product', label, count, options },      ← a heading, only when a product has MORE THAN ONE line
 *     { type:'line', item, variant, item_id },        ← the purchasable line; `variant` is '' when ungrouped
 *     … ]
 *
 * ── THE RULES, IN ONE PLACE SO BOTH SURFACES OBEY THEM ─────────────────────────────────────────────────────────
 *   1. No groups → the flat list, exactly as before. Every catalogue that has not declared variants is untouched.
 *   2. A group of ONE is not a group — it renders as the plain product it is, with no empty hierarchy.
 *   3. Anything the grouping did not cover is STILL SHOWN. A product that vanished because it lacked a group value
 *      would be the silent-drop failure that keeps recurring in this codebase.
 *   4. Order is the server's. It decided lines-in-listed-order and products-newest-first deliberately; re-sorting
 *      here would take that decision away from it and put it back in the hands of whatever order the array arrived.
 */
(function (root) {
  'use strict';

  function cbLineRows(data) {
    var items = (data && data.items) || [];
    var groups = (data && data.groups) || [];
    if (!items.length) return [];

    // Rule 1 — nothing declared, nothing to group.
    if (!groups.length) {
      return items.map(function (p) {
        return { type: 'line', item: p, item_id: p.item_id, variant: '' };
      });
    }

    var byId = {};
    items.forEach(function (item) {
      byId[item.item_id] = item;
    });

    var rows = [];
    var shown = {};
    groups.forEach(function (g) {
      var lines = (g.lines || [])
        .map(function (item) {
          return { l: item, p: byId[item.item_id] };
        })
        .filter(function (x) {
          return x.p;
        });
      if (!lines.length) return;
      lines.forEach(function (x) {
        shown[x.l.item_id] = true;
      });

      // Rule 2 — a group of one is just a product.
      if (lines.length === 1) {
        rows.push({ type: 'line', item: lines[0].p, item_id: lines[0].l.item_id, variant: '' });
        return;
      }
      // `gid` marks which heading a line belongs to. The row list is FLAT, so without it nothing downstream can
      // tell where a group ends — rule 3's ungrouped leftovers are 'line' rows too, and a "select all in this
      // group" control walking forward until the next heading would silently swallow them. Additive: every
      // existing consumer ignores it and renders exactly as before.
      var gid = 'g' + rows.length;
      rows.push({
        type: 'product',
        label: g.label || '',
        count: lines.length,
        gid: gid,
        options: Object.keys(g.options || {})
          .map(function (item) {
            return (g.options[item] || []).join(' · ');
          })
          .join('  ')
      });
      lines.forEach(function (x) {
        rows.push({ type: 'line', item: x.p, item_id: x.l.item_id, variant: x.l.variant || '', gid: gid });
      });
    });

    // Rule 3 — never drop a line just because no group claimed it.
    items.forEach(function (p) {
      if (!shown[p.item_id]) rows.push({ type: 'line', item: p, item_id: p.item_id, variant: '' });
    });
    return rows;
  }

  /* ⚠️ THE PICKER MOVED. It briefly lived here; it is now app/cart-ui.js, which owns the cart for all four
     ordering screens. The old cbPick* names survive as thin adapters over CBCart (see cart-ui.js) so no
     call site had to change, but there is ONE implementation. This file is back to what it should be: the
     WALK, and nothing else. */

  /**
   * ⭐ cbMediaGallery — ONE renderer for a product's pictures and videos, used by the product page's Media row and by
   * the storefront (shop.html): what the owner sees in the row IS what the customer gets. Pictures come through the
   * API (never a bucket URL); a video is an EMBED of the link the owner pasted (YouTube/Vimeo — the API parsed it).
   *   cbMediaGallery(d, { apiBase, itemId, size:'tile'|'phone', onRemove })
   */
  root.cbMediaEmbed = function (m) {
    if (!m || m.kind !== 'video') return '';
    if (m.embed) return m.embed;
    if (m.provider === 'youtube' && m.vid) return 'https://www.youtube-nocookie.com/embed/' + m.vid;
    if (m.provider === 'vimeo' && m.vid) return 'https://player.vimeo.com/video/' + m.vid;
    return '';
  };
  root.cbMediaGallery = function (d, o) {
    o = o || {};
    var list = Array.isArray(d && d.media) ? d.media : [];
    var pic = function (x) {
      return x.key ? (o.apiBase || '') + '/api/products/media/' + encodeURIComponent(o.itemId || '') + '/' + encodeURIComponent(x.id) : x.url || '';
    };
    var phone = o.size === 'phone';
    var w = phone ? '100%' : '140px',
      h = phone ? '190px' : '100px';
    var tiles = list.map(function (x) {
      var inner;
      if (x.kind === 'video') {
        var src = root.cbMediaEmbed(x);
        inner = src
          ? '<iframe src="' +
            esc(src) +
            '" title="' +
            esc(x.name || 'video') +
            '" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen style="width:100%;height:' +
            h +
            ';border:0;display:block;background:#000"></iframe>'
          : '<video src="' + esc(pic(x)) + '" controls preload="metadata" style="width:100%;height:' + h + ';object-fit:cover;display:block"></video>';
      } else if (x.kind === 'image') {
        inner =
          '<img src="' + esc(pic(x)) + '" alt="' + esc(x.name || '') + '" loading="lazy" style="width:100%;height:' + h + ';object-fit:cover;display:block">';
      } else {
        inner = '<div style="height:' + h + ';display:flex;align-items:center;justify-content:center;color:#888">📄</div>';
      }
      var cap = phone
        ? ''
        : '<div style="padding:4px 6px;font-size:11px;color:#777;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' +
          esc(x.name || '') +
          '">' +
          esc(x.name || '') +
          '</div>';
      var del = o.onRemove
        ? '<button data-cbsid="SCR055-B01" type="button" data-testid="prod-media-del-' +
          esc(x.id) +
          '" style="position:absolute;top:4px;inset-inline-end:4px;padding:2px 6px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer" onclick="' +
          esc(o.onRemove.replace('{id}', String(x.id))) +
          '">✕</button>'
        : '';
      return (
        '<div data-testid="prod-media-' +
        esc(x.id) +
        '" style="position:relative;width:' +
        w +
        ';border:1px solid #e3e3e3;border-radius:9px;overflow:hidden;background:#fff">' +
        inner +
        cap +
        del +
        '</div>'
      );
    });
    if (!tiles.length && d && d.image) {
      tiles.push(
        '<div data-testid="prod-media-cover" style="width:' +
          w +
          ';border:1px solid #e3e3e3;border-radius:9px;overflow:hidden;background:#fff"><img src="' +
          esc(d.image) +
          '" alt="" loading="lazy" style="width:100%;height:' +
          h +
          ';object-fit:cover;display:block"></div>'
      );
    }
    if (!tiles.length) return '';
    /* the count first — '3 pictures · 1 video' — then, on a phone, ONE ROW that swipes sideways (scroll-snap, like every
     product gallery a customer already knows); on the product page the tiles wrap. Athi, 2026-09-04: 'scrollable, not
     vertically, horizontally, and it has to show how many images, videos'. */
    var nImg =
      list.filter(function (x) {
        return x.kind === 'image';
      }).length + (tiles.length && !list.length ? 1 : 0);
    var nVid = list.filter(function (x) {
      return x.kind === 'video';
    }).length;
    var count = [nImg ? nImg + (nImg === 1 ? ' picture' : ' pictures') : '', nVid ? nVid + (nVid === 1 ? ' video' : ' videos') : '']
      .filter(Boolean)
      .join(' · ');
    var head =
      '<div data-testid="prod-media-count" style="font-size:11.5px;color:#777;padding:2px 0 4px">' +
      esc(count) +
      (phone && tiles.length > 1 ? ' · swipe ›' : '') +
      '</div>';
    if (phone) {
      var strip = tiles
        .map(function (item) {
          return item
            .replace('style="position:relative;width:' + w, 'style="position:relative;flex:0 0 88%;scroll-snap-align:start;width:' + w)
            .replace('style="width:' + w, 'style="flex:0 0 88%;scroll-snap-align:start;width:' + w);
        })
        .join('');
      return (
        head +
        '<div data-testid="prod-media" style="display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding:2px 0 8px;scrollbar-width:thin">' +
        strip +
        '</div>'
      );
    }
    return head + '<div data-testid="prod-media" style="display:flex;gap:8px;flex-wrap:wrap;padding:6px 0">' + tiles.join('') + '</div>';
  };
  root.cbLineRows = cbLineRows;

  /**
   * ⭐ ONE WALK UP THE CATEGORY TREE (2026-09-28, M40) — an offer on a PARENT category reaches its children.
   * The app's product page did this (core.js catgWithAncestors, over the definitions store); the storefront matched an
   * offer's category exactly, so "10% off Fruits" never reached a product filed under "Fruits › Dried Fruits" in the
   * shop window while the owner's own preview showed it. One walker, told how each store reads a category:
   *   the app's definitions  { definition_id, rules: { parent } }   ·   the public payload  { id, parent }
   * Returns the ids first, then each ancestor once, closest first. A cycle or a runaway chain stops at 16 hops.
   */
  function cbCatgAncestors(ids, cats, parentOf, idOf) {
    var out = (ids || []).map(String).filter(Boolean),
      seen = {};
    out.forEach(function (id) {
      seen[id] = true;
    });
    if (!cats || !cats.length) return out;
    var pOf =
      parentOf ||
      function (c) {
        return c && c.parent;
      };
    var iOf =
      idOf ||
      function (c) {
        return c && (c.id != null ? c.id : c.definition_id);
      };
    var by = {};
    cats.forEach(function (item) {
      var k = iOf(item);
      if (k != null) by[String(k)] = item;
    });
    out.slice().forEach(function (id) {
      var p = pOf(by[id]),
        hops = 0;
      while (p != null && p !== '' && !seen[String(p)] && hops++ < 16) {
        seen[String(p)] = true;
        out.push(String(p));
        p = pOf(by[String(p)]);
      }
    });
    return out;
  }
  root.cbCatgAncestors = cbCatgAncestors;
  if (typeof module !== 'undefined' && module.exports) module.exports = { cbLineRows: cbLineRows, cbCatgAncestors: cbCatgAncestors };
})(typeof window !== 'undefined' ? window : globalThis);
