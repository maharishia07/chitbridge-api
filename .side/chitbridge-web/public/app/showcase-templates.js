/**
 * showcase-templates.js — THE SHOWCASE TEMPLATE MECHANISM (round S2; REQUIREMENT.md "Not one design — a template collection").
 *
 * A template is a list of registered SECTIONS under ONE DATA CONTRACT. The page never reads the raw catalogue:
 * contractOf(data) builds the contract (shop profile · categories · items), copying ONLY the fields below — so cost,
 * stock counts and anything the shop did not publish cannot reach any template, present or future (the test walks every template).
 *
 *   contract = { shop:{name,line,place,hours,open,phone,whatsapp,logo,url,currency},
 *                categories:[{id,name}], items:[{id,name,photo,category,price,unit,note,sizes[],showcaseOnly}] }
 *
 * Registry names are `showcase.<vertical>.<template>@1.0` rows in app/pages.json (N03 grammar; chitbridge-api data/pages.json is
 * a byte copy). The shop's choice is the policy flag `showcase_template` (+ `showcase_sections`, the mix), read on the public
 * catalogue as shop.showcase — one source. Mix-and-match = section assembly: assemble(name, sections) reorders/drops sections of
 * the same template; it never forks one.
 *
 * Reuse: the cart engine and its FACES stay in app/cart.js — FACE below is only the words a face wears (DECISIONS: enquiry ·
 * order · quote · booking); money is painted through the host's formatter (CBLocale.money), never computed here.
 * Pure string functions, no DOM access — the shop page and the owner preview both call render().
 *
 * OWNS      CBShowcase: TEMPLATES · DEFAULT · contractOf (the one data contract) · assemble (section mix) · render (the page's HTML)
 * CALLED BY shop.html (contractOf + render on the shop page and the owner preview) · app/cap-showcase.js (TEMPLATES, DEFAULT) · app/cap-admin.js (DEFAULT) · loaded by shop.html, crm.html and app.html (<script src>)
 * FLOW      shop.html reads the public catalogue → contractOf(data) → render(contract, opts) → the template's sections → the page paints; cap-showcase draws one button per TEMPLATES entry
 * CARD      11-crm-and-marketing/showcase
 */
(function (root) {
  'use strict';

  /* the words a cart face wears (design §4); the machinery is the one cart engine */
  var FACE = {
    enquiry: { icon: '♡', title: 'Shortlist', finish: 'Send your enquiry', item: '♡' },
    order: { icon: '🛍', title: 'Order', finish: 'Place the order', item: 'Order' },
    quote: { icon: '🧾', title: 'List', finish: 'Ask for a price', item: '＋' },
    booking: { icon: '📅', title: 'Booking', finish: 'Ask for the date', item: '📅' }
  };

  /* every section a template may use — one renderer each; a template only picks and orders them */
  var SECTIONS = {
    strip: function (c) {
      return (
        '<header class="sc-strip"><span class="sc-logo" aria-hidden="true">' +
        (c.shop.logo ? '<img src="' + esc(c.shop.logo) + '" alt="" width="36" height="36">' : esc(c.shop.name.charAt(0).toUpperCase())) +
        '</span><h1 class="sc-name">' +
        esc(c.shop.name) +
        '</h1><button data-cbsid="SCR062-B01" type="button" class="sc-ic" data-sc="share" aria-label="Share" title="Share">⤴ Share</button></header>'
      );
    },
    facts: function (c) {
      var s = c.shop;
      return (
        '<div class="sc-facts"><span class="sc-line">' +
        esc([s.line, s.place].filter(Boolean).join(' · ')) +
        '</span>' +
        (s.hours ? '<span class="sc-hrs"><span class="sc-open' + (s.open ? ' on' : '') + '" aria-hidden="true">●</span> ' + esc(s.hours) + '</span>' : '') +
        (s.phone ? '<a class="sc-ic" href="tel:' + esc(s.phone) + '" aria-label="Call" title="Call">📞 Call</a>' : '') +
        (s.whatsapp
          ? '<a class="sc-ic" href="https://wa.me/' + esc(String(s.whatsapp).replace(/\D/g, '')) + '" aria-label="WhatsApp" title="WhatsApp">💬 WhatsApp</a>'
          : '') +
        '</div>'
      );
    },
    find: function (c) {
      return (
        '<div class="sc-find"><input data-cbsid="SCR062-I01" type="search" class="sc-q" data-sc="search" aria-label="Search" placeholder="🔍">' +
        (c.categories.length
          ? '<div class="sc-chips">' +
            c.categories
              .map(function (item) {
                return '<button data-cbsid="SCR062-B02" type="button" class="sc-chip" data-sc-cat="' + esc(item.id) + '">' + esc(item.name) + '</button>';
              })
              .join('') +
            '</div>'
          : '') +
        '</div>'
      );
    },
    gallery: function (c, t) {
      return (
        '<main class="sc-grid">' +
        c.items
          .map(function (item) {
            return card(item, c, t);
          })
          .join('') +
        '</main>' +
        emptyLine(c)
      );
    },
    menu: function (c, t) {
      return (
        '<main class="sc-menu">' +
        byCategory(c)
          .map(function (item) {
            return (
              '<h2 class="sc-h2">' +
              esc(item.name) +
              '</h2>' +
              item.items
                .map(function (entry) {
                  return menuRow(entry, c, t);
                })
                .join('')
            );
          })
          .join('') +
        '</main>' +
        emptyLine(c)
      );
    },
    specs: function (c, t) {
      return (
        '<main class="sc-specs">' +
        byCategory(c)
          .map(function (item) {
            return (
              '<h2 class="sc-h2">' +
              esc(item.name) +
              '</h2>' +
              item.items
                .map(function (entry) {
                  return specRow(entry, c, t);
                })
                .join('')
            );
          })
          .join('') +
        '</main>' +
        emptyLine(c)
      );
    },
    services: function (c, t) {
      return (
        '<main class="sc-services">' +
        c.items
          .map(function (item) {
            return serviceCard(item, c, t);
          })
          .join('') +
        '</main>' +
        emptyLine(c)
      );
    },
    found: function (c) {
      return c.owner
        ? '<aside class="sc-found" data-sc="found"><code>' +
            esc(c.shop.url || '') +
            '</code><button data-cbsid="SCR062-B03" type="button" class="sc-ic" data-sc="copy" aria-label="Copy" title="Copy">⧉</button>' +
            '<div class="sc-guide">Google Profile: paste link</div><div class="sc-guide">Facebook About: paste link</div></aside>'
        : '';
    }
  };

  /* the registered templates: name → vertical, cart face, ordered sections (design §1 hierarchy: window · facts · find · range) */
  var TEMPLATES = {
    'showcase.designer.gallery@1.0': { vertical: 'designer', template: 'gallery', face: 'enquiry', sections: ['strip', 'facts', 'find', 'gallery', 'found'] },
    'showcase.food.menu@1.0': { vertical: 'food', template: 'menu', face: 'order', sections: ['strip', 'facts', 'find', 'menu', 'found'] },
    'showcase.paint.specs@1.0': { vertical: 'paint', template: 'specs', face: 'quote', sections: ['strip', 'facts', 'find', 'specs', 'found'] },
    'showcase.services.booking@1.0': { vertical: 'services', template: 'booking', face: 'booking', sections: ['strip', 'facts', 'find', 'services', 'found'] }
  };
  var DEFAULT = 'showcase.designer.gallery@1.0';
  var RANGE = { gallery: 1, menu: 1, specs: 1, services: 1 }; /* the sections that draw the range — at least one must survive a mix */

  var CSS =
    '.sc{max-width:1180px;margin:0 auto;padding:0 16px;font-family:var(--font-body,inherit);color:var(--ink,#1c2430);overflow-x:hidden}' +
    '.sc-strip,.sc-facts{display:flex;align-items:center;gap:8px;padding:10px 0}.sc-name{flex:1;min-width:0;margin:0;font-size:20px;font-weight:800;font-family:var(--font-head,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.sc-logo{width:36px;height:36px;border-radius:10px;background:var(--accent,#3F66A6);color:var(--on-accent,#fff);display:grid;place-items:center;overflow:hidden;flex:none;font-weight:800}' +
    '.sc-ic{min-width:44px;height:44px;padding:0 8px;gap:4px;font-size:14px;white-space:nowrap;border:0;background:none;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:inherit}' +
    '.sc-facts{flex-wrap:wrap}.sc-hrs{font-size:14px;color:var(--grey,#5f6b7a)}.sc-line{flex:1;min-width:0;font-size:14px;color:var(--grey,#5f6b7a)}.sc-open{color:var(--bad,#b3261e)}.sc-open.on{color:var(--ok,#1e7a46)}' +
    '.sc-find{padding:6px 0}.sc-q{width:100%;box-sizing:border-box;height:40px;border:1px solid var(--line,#dfe3e8);border-radius:10px;padding:0 12px;font-size:16px}' +
    '.sc-chips{display:flex;gap:8px;overflow-x:auto;padding:8px 0}.sc-chip{flex:none;border:1px solid var(--line,#dfe3e8);background:var(--card,#fff);border-radius:999px;padding:6px 12px;font-size:14px;cursor:pointer}' +
    '.sc-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}@media(min-width:768px){.sc-grid{grid-template-columns:repeat(3,1fr)}}@media(min-width:1366px){.sc-grid{grid-template-columns:repeat(4,1fr)}}' +
    '.sc-card{min-width:0;position:relative}.sc-ph{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:12px;background:var(--wash,#eef0f2)}.sc-cap{display:flex;gap:6px;align-items:center;padding:6px 2px;font-size:14px}.sc-cap b{flex:1;min-width:0;font-weight:600;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}' +
    '.sc-h2{font-size:16px;margin:14px 0 4px}.sc-row{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line,#dfe3e8)}.sc-row .sc-t{flex:1;min-width:0}.sc-row .sc-t b{display:block;font-weight:600}.sc-row small{color:var(--grey,#5f6b7a);font-size:13px}' +
    '.sc-none{display:grid;place-items:center;background:var(--accent,#3F66A6);color:var(--on-accent,#fff);font-weight:800;font-family:var(--font-head,inherit)}.sc-ph.sc-none{font-size:40px}.sc-th.sc-none{font-size:22px}.sc-th{width:56px;height:56px;border-radius:10px;object-fit:cover;flex:none;background:var(--wash,#eef0f2)}.sc-price{font-weight:700;white-space:nowrap}.sc-add{min-height:40px;min-width:40px;border:1px solid var(--accent,#3F66A6);background:var(--card,#fff);color:var(--accent,#3F66A6);border-radius:10px;font-size:15px;cursor:pointer}' +
    '.sc-spec{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}.sc-spec i{font-style:normal;font-size:12px;border:1px solid var(--line,#dfe3e8);border-radius:6px;padding:1px 6px}' +
    '.sc-services{display:grid;gap:10px}.sc-svc{display:flex;gap:10px;align-items:center;border:1px solid var(--line,#dfe3e8);border-radius:12px;padding:10px;background:var(--card,#fff)}' +
    '.sc-found{margin:16px 0;padding:12px;border:1px dashed var(--line,#dfe3e8);border-radius:12px;font-size:13px}.sc-empty{padding:24px 0;color:var(--grey,#5f6b7a)}';

  function emptyLine(c) {
    return c.items.length ? '' : '<div class="sc-empty">Nothing on display</div>';
  }
  function byCategory(c) {
    var names = {},
      order = [],
      groups = {};
    c.categories.forEach(function (item) {
      names[item.id] = item.name;
    });
    c.items.forEach(function (item) {
      var k = item.category && names[item.category] ? item.category : '';
      if (!groups[k]) {
        groups[k] = [];
        order.push(k);
      }
      groups[k].push(item);
    });
    return order.map(function (item) {
      return { name: item ? names[item] : '', items: groups[item] };
    });
  }
  /* a price only where the shop chose to show one; "showcase only" items carry no price words at all */
  function priceOf(i, c, t) {
    return i.showcaseOnly || i.price == null ? '' : '<span class="sc-price">' + esc(t.money ? t.money(i.price, c.shop.currency) : i.price) + '</span>';
  }
  function act(i, t) {
    var f = FACE[t.face];
    return '<button data-cbsid="SCR062-B04" type="button" class="sc-add" data-sc-add="' + esc(i.id) + '" aria-label="' + esc(f.title) + '">' + f.item + '</button>';
  }
  function photo(i, cls) {
    return i.photo
      ? '<img class="' +
          cls +
          '" src="' +
          esc(i.photo) +
          '" alt="' +
          esc(i.name) +
          '" width="' +
          (cls === 'sc-ph' ? 320 : 56) +
          '" height="' +
          (cls === 'sc-ph' ? 400 : 56) +
          '" loading="lazy">'
      : '<span class="' + cls + ' sc-none" aria-hidden="true">' + esc(String(i.name).charAt(0).toUpperCase()) + '</span>';
  }
  function card(i, c, t) {
    return (
      '<article class="sc-card" data-item="' +
      esc(i.id) +
      '" data-cat="' +
      esc(i.category || '') +
      '">' +
      photo(i, 'sc-ph') +
      '<div class="sc-cap"><b>' +
      esc(i.name) +
      '</b>' +
      priceOf(i, c, t) +
      act(i, t) +
      '</div></article>'
    );
  }
  /* menuRow and serviceCard are one markup with a different tag, class, text-block style and note separator: the shape names those four */
  var MENU_SHAPE = { tag: 'div', cls: 'sc-row', tStyle: '', noteBr: '' };
  var SVC_SHAPE = { tag: 'article', cls: 'sc-svc', tStyle: ' style="flex:1;min-width:0"', noteBr: '<br>' };
  function itemBlock(shape, i, c, t) {
    return (
      '<' +
      shape.tag +
      ' class="' +
      shape.cls +
      '" data-item="' +
      esc(i.id) +
      '" data-cat="' +
      esc(i.category || '') +
      '">' +
      (i.photo ? photo(i, 'sc-th') : '') +
      '<div class="sc-t"' +
      shape.tStyle +
      '><b>' +
      esc(i.name) +
      '</b>' +
      (i.note ? shape.noteBr + '<small>' + esc(i.note) + '</small>' : '') +
      '</div>' +
      priceOf(i, c, t) +
      act(i, t) +
      '</' +
      shape.tag +
      '>'
    );
  }
  function menuRow(i, c, t) {
    return itemBlock(MENU_SHAPE, i, c, t);
  }
  function specRow(i, c, t) {
    return (
      '<div class="sc-row" data-item="' +
      esc(i.id) +
      '" data-cat="' +
      esc(i.category || '') +
      '">' +
      photo(i, 'sc-th') +
      '<div class="sc-t"><b>' +
      esc(i.name) +
      '</b><div class="sc-spec">' +
      (i.unit ? '<i>' + esc(i.unit) + '</i>' : '') +
      (i.sizes || [])
        .map(function (item) {
          return '<i>' + esc(item) + '</i>';
        })
        .join('') +
      '</div></div>' +
      priceOf(i, c, t) +
      act(i, t) +
      '</div>'
    );
  }
  function serviceCard(i, c, t) {
    return itemBlock(SVC_SHAPE, i, c, t);
  }

  /** the ONE data contract. Copies named fields only — nothing else of the catalogue row survives (cost cannot ride along). */
  function contractOf(data, opts) {
    data = data || {};
    opts = opts || {};
    var s = data.shop || {},
      sh = s.showcase || {};
    var items = (data.items || [])
      .map(function (item) {
        var d = (item && item.item_data) || {};
        var imgs =
          item.photo ||
          item._photo ||
          d.image_url ||
          (Array.isArray(d.images) && d.images[0]) ||
          (Array.isArray(d.media) && d.media[0] && (d.media[0].url || d.media[0])) ||
          '';
        var price = item.price != null ? item.price : d.price;
        return {
          id: String(item.item_id || d.item_id || item.id || ''),
          name: String(item.name || d.name || d.product || ''),
          photo: typeof imgs === 'string' ? imgs : '',
          category: item.category || d.category || '',
          price: price == null || price === '' ? null : price,
          unit: item.unit || d.unit || '',
          note: String(d.description || d.desc || ''),
          sizes: Array.isArray(d.sizes) ? d.sizes.map(String) : [],
          showcaseOnly: !!(d.showcase_only || item.showcase_only)
        };
      })
      .filter(function (item) {
        return item.id && item.name;
      });
    return {
      owner: !!opts.owner,
      shop: {
        name: String(s.display_name || 'Shop'),
        line: String(s.tagline || s.about || ''),
        place: String(s.address || ''),
        hours: String(s.hours || ''),
        open: (s.business_status || 'open') === 'open',
        phone: String(s.phone || ''),
        whatsapp: String(s.whatsapp || ''),
        logo: s.logo_url || '',
        url: String(opts.url || ''),
        currency: s.currency_code || null
      } /* CART-REG1: none stated → none (the page's money fn prints the bare amount) */,
      categories: (data.categories || [])
        .map(function (item) {
          return { id: String(item.id || item.definition_id || item.name), name: String(item.name || '') };
        })
        .filter(function (item) {
          return item.name;
        }),
      items: items,
      choice: { template: sh.template || '', sections: Array.isArray(sh.sections) ? sh.sections : [] }
    };
  }

  /** the template's section list after the shop's mix: unknown keys dropped, the template's own order kept for the rest; the range always stays */
  function assemble(name, sections) {
    var t = TEMPLATES[name] || TEMPLATES[DEFAULT];
    var want = Array.isArray(sections) && sections.length ? sections : null;
    var list = t.sections.filter(function (item) {
      return SECTIONS[item] && (!want || want.indexOf(item) >= 0 || RANGE[item]);
    });
    return list;
  }

  /** the template a shop uses: its choice if registered, else the vertical's seed, else gallery */
  function pick(choice, vertical) {
    if (choice && TEMPLATES[choice]) return choice;
    var hit = Object.keys(TEMPLATES).filter(function (item) {
      return TEMPLATES[item].vertical === vertical;
    })[0];
    return hit || DEFAULT;
  }

  /** the page body for a contract; opts: { template, sections, money } (template/sections default to the shop's own choice) */
  function render(c, opts) {
    opts = opts || {};
    var name = pick(opts.template || (c.choice && c.choice.template), opts.vertical),
      t = TEMPLATES[name];
    var ctx = { face: t.face, money: opts.money };
    var body = assemble(name, opts.sections || (c.choice && c.choice.sections))
      .map(function (item) {
        return SECTIONS[item](c, ctx);
      })
      .join('');
    return '<style>' + CSS + '</style><div class="sc" data-template="' + esc(name) + '" data-face="' + esc(t.face) + '">' + body + '</div>';
  }

  var api = {
    FACE: FACE,
    SECTIONS: Object.keys(SECTIONS),
    TEMPLATES: TEMPLATES,
    DEFAULT: DEFAULT,
    contractOf: contractOf,
    assemble: assemble,
    pick: pick,
    render: render
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CBShowcase = api;
})(typeof self !== 'undefined' ? self : this);
