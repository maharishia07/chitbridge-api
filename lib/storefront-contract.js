/*
 * OWNS      the contract of the public storefront doors of routes/catalogue.js (the 11 anyone may call with no sign-in): each door's OpenAPI
 *           operation (S9), the old validation refusal (S2), the old bodies the storefront reads, and the 5xx bodies that fail closed (S8).
 *           public/shop.html and public/store.html read `error`, `message`, `code`, `details`, `ok` and `why`: every refusal keeps them word
 *           for word beside the Problem fields (frozen in docs/contracts/api-legacy.json).
 * CALLED BY routes/catalogue.js (schemaValidate on the five body doors, router.openapi) → tools/api-register.cjs · tools/api-contract-tests.cjs ·
 *           /api/openapi.json · tests/api-problem-storefront.test.cjs.
 * FLOW      operation → schemaValidate(operation, refusalFor(chain)) → trimmed(...) → the door's own checks, each a Problem with its old body
 * CARD      10-online-shop-and-storefront-orders/order-start-confirm
 */
'use strict';
const { problemResponse } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const membership = require('./network-membership');

/* ── the contract: each door's OpenAPI operation, the ONE source the register, the contract tests, schemaValidate and /api/openapi.json share ──
   ⭐ STRICT INPUT (API-3): every body lists the keys the door reads and refuses any other (additionalProperties: false), in the old
   validation words. A key nobody reads was dropped without a word before, and a caller never learned its field went nowhere.
   ⚠️ A body declares only what the old express-validator chain checked (otp, observed, line_items): every later check answers in its
   own old words. A type on `phone` would turn the old 422 "Enter a valid phone number." into a 400, so the contact keys carry none. */
const refused = problemResponse;
const json = (schema) => ({ 'application/json': { schema } });
const text = { type: 'string' };
const maybeText = { type: ['string', 'null'] };
const anything = (description) => ({ description });
const closed = (required, properties) => ({ type: 'object', required, properties, additionalProperties: false });
/** the old chain: trim(), then 6 to 64 characters — a code typed with a space either side still counts, as it did */
const TYPED_CODE = {
  description: 'the code sent by /order/start or /support/start (spaces either side are trimmed)',
  examples: ['K4X9QZ'], // the shape only: 6 to 64 characters — never a real or fixed code (tests/tester-code.test.cjs)
  anyOf: [
    { type: 'string', pattern: '^\\s*\\S[\\s\\S]{4,62}\\S\\s*$' },
    { type: 'integer', minimum: 100000 }
  ]
};
const CONTACT = {
  phone: anything('the shopper’s phone — give a phone OR an email, not both'),
  email: anything('the shopper’s email'),
  identifier: anything('a phone or an email, whichever the shopper typed (an @ makes it an email)')
};
const FAULT = refused('a fault of ours — the body says nothing of its cause');
const NO_SHOP = refused('no shop by that handle — the same answer for one that never existed, is closed to the public or sealed');
const NO_CONTACT = refused('no phone or email, both, or one that is not valid');
const BAD_BODY = refused('a key this door does not read, or a field the old checks refused (the old 400 "Validation failed" body)');
const CODE_REFUSED = refused('no code was asked for, it is wrong or it has expired');
const CODE_SENT = closed(['message', 'channel'], {
  message: text,
  channel: { type: 'string', enum: ['phone', 'email'] },
  dev_otp: anything('a local stack only (lib/dev-otp.js)')
});
const PAGE = { total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' }, capped: { type: 'boolean' }, cap_note: text };

const NETWORK_STORE_OPERATION = {
  summary: 'A network’s public products as one store, searchable by category (no node or department is named)',
  tags: ['storefront'],
  security: [],
  responses: {
    200: {
      description: 'the products, one page',
      content: json(
        closed(
          ['network_id', 'categories', 'count', 'products'],
          Object.assign({ network_id: text, categories: { type: 'array', items: text }, count: { type: 'integer' }, products: { type: 'array' } }, PAGE)
        )
      )
    },
    404: refused('no network store by that name'),
    500: FAULT,
    503: refused('who is in the network could not be read just now — said, never "no products"')
  }
};
const NETWORK_ORDER_OPERATION = {
  summary: 'A signed-in storefront customer orders across a network: one order chit to the operator, silent fragments to each store',
  tags: ['storefront'],
  security: [{ bearer: [] }],
  requestBody: {
    required: true,
    content: json(
      closed([], {
        items: { description: '[{ product_id, qty }] — checked by the door after the network flag and the sign-in, in its old words' },
        customer: anything('sent by public/store.html before SEC-FIX2 C6 and not read since: the sign-in names the customer')
      })
    )
  },
  responses: {
    200: {
      description: 'the order, as the customer sees it (no store is named)',
      content: json(
        closed(['ok', 'order_id', 'item_count', 'total', 'currency', 'fragment_count'], {
          ok: { type: 'boolean' },
          order_id: text,
          item_count: { type: 'integer' },
          total: { type: 'number' },
          currency: maybeText,
          fragment_count: { type: 'integer' }
        })
      )
    },
    400: refused('a key this door does not read, or no items'),
    401: refused('sign in at the store to order'),
    403: refused('network ordering is off here, or the sign-in belongs to a store outside this network (it is public that the network exists)'),
    404: refused('no network store by that name, or none of the products is in it'),
    409: refused('the network has no operator, or the database refused the order on purpose'),
    500: FAULT
  }
};
const NETWORK_FRONT_OPERATION = {
  summary: 'The network storefront: every public department of a network root, through the one public view',
  tags: ['storefront'],
  security: [],
  responses: {
    200: {
      description: 'the network front',
      content: json(
        closed(['network', 'departments', 'categories', 'count'], {
          network: { type: ['object', 'null'] },
          departments: { type: 'array' },
          categories: { type: 'array' },
          count: { type: 'integer' },
          currencies: { type: 'array' },
          query: text,
          truncated: { type: 'object' }
        })
      )
    },
    404: refused('no shop by that handle, or a network with no public department — the same answer'),
    500: FAULT,
    503: refused('who is in the network could not be read just now')
  }
};
const SHOP_VIEW_OPERATION = {
  summary: 'One shop’s public catalogue (its card only when it asks customers to sign in first)',
  tags: ['storefront'],
  security: [],
  responses: {
    200: {
      description: 'the public view, or the card and a sign-in code',
      content: json(
        closed(['shop'], {
          shop: { type: 'object' },
          sign_in: { type: 'object' },
          schema: anything('the catalogue’s columns'),
          fields: anything('the catalogue’s fields'),
          items: { type: 'array' },
          groups: anything('the item groups'),
          lines: anything('the one catalogue read'),
          catalogue_summary: anything('counts'),
          unpriced_hidden: anything('how many unpriced items were kept back'),
          offers: { type: 'array' },
          categories: { type: 'array' },
          finishes: anything('the finishes a paint shop sells'),
          preview: { type: 'object' }
        })
      )
    },
    404: NO_SHOP,
    500: FAULT
  }
};
const CAPTURE_FIELDS_OPERATION = {
  summary: 'What the order form must ask the customer for, from this shop’s standards',
  tags: ['storefront'],
  security: [],
  responses: {
    200: { description: 'the fields', content: json(closed(['shop', 'fields'], { shop: maybeText, fields: { type: 'array' } })) },
    404: NO_SHOP,
    500: FAULT
  }
};
/* API-3 S36: the two money doors require one key per attempt (middleware/idempotency.js requireKey) */
const ONE_KEY_PER_ATTEMPT = [
  {
    in: 'header',
    name: 'Idempotency-Key',
    required: true,
    description: 'one per attempt, the same one when that attempt is sent again (a lost answer, a second tap); held per shop and contact',
    schema: { type: 'string', minLength: 1, maxLength: 200 }
  }
];
const ORDER_START_OPERATION = {
  summary: 'Order first: a phone or an email gets a code (the shopper’s row is made on the first ask)',
  tags: ['storefront'],
  security: [],
  parameters: ONE_KEY_PER_ATTEMPT,
  requestBody: { required: true, content: json(closed([], Object.assign({ name: anything('what the shop calls the shopper') }, CONTACT))) },
  responses: {
    200: { description: 'the code is on its way', content: json(CODE_SENT) },
    400: refused('a key this door does not read'),
    403: refused('the shop is closed and takes no orders'),
    404: NO_SHOP,
    409: refused('the same Idempotency-Key is still being answered'),
    422: refused('no phone or email, no Idempotency-Key, or the Idempotency-Key was already used with another body'),
    500: FAULT
  }
};
const SUPPORT_PREVIEW_OPERATION = {
  summary: 'Who a buyer’s report would reach, and whether the shop is taking them (never its folders or people)',
  tags: ['storefront'],
  security: [],
  responses: {
    200: {
      description: 'who gets it',
      content: json(
        closed(['ok', 'to_name', 'accepting', 'urgency'], {
          ok: { type: 'boolean' },
          to_name: maybeText,
          accepting: { type: 'boolean' },
          urgency: { type: 'array' }
        })
      )
    },
    404: NO_SHOP,
    500: FAULT
  }
};
const SUPPORT_START_OPERATION = {
  summary: 'The code for a complaint rather than an order — a closed shop still takes one',
  tags: ['storefront'],
  security: [],
  requestBody: { required: true, content: json(closed([], Object.assign({ name: anything('what the shop calls the shopper') }, CONTACT))) },
  responses: {
    200: { description: 'the code is on its way', content: json(CODE_SENT) },
    400: BAD_BODY,
    404: NO_SHOP,
    422: NO_CONTACT,
    500: FAULT
  }
};
const SUPPORT_OPERATION = {
  summary: 'A buyer raises a problem with the shop, proved by the code; the shop’s own routing answers it',
  tags: ['storefront'],
  security: [],
  requestBody: {
    required: true,
    content: json(
      closed(
        ['otp', 'observed'],
        Object.assign(
          {
            otp: TYPED_CODE,
            observed: {
              description: 'what went wrong, in the buyer’s words',
              examples: ['The parcel came open'],
              anyOf: [{ type: 'string', pattern: '\\S' }, { type: 'number' }]
            },
            severity: anything('Sev-1 … Sev-4; anything else is Sev-3')
          },
          CONTACT
        )
      )
    )
  },
  responses: {
    200: {
      description: 'sent',
      content: json(
        closed(['sent', 'ref', 'to'], { sent: { type: 'boolean' }, ref: maybeText, to: maybeText, routed: anything('where the shop’s routing put it') })
      )
    },
    400: refused('a key this door does not read, nothing said, or no code / a wrong or expired one'),
    404: NO_SHOP,
    422: NO_CONTACT,
    500: FAULT,
    502: refused('the shop takes no reports yet — said, never a green tick')
  }
};
const ORDER_CONFIRM_OPERATION = {
  summary: 'The code, then the order: re-priced against the shop’s own catalogue, the code spent once, both copies minted, a customer token',
  tags: ['storefront'],
  security: [],
  parameters: ONE_KEY_PER_ATTEMPT,
  requestBody: {
    required: true,
    content: json(
      closed(
        ['otp', 'line_items'],
        Object.assign(
          {
            otp: TYPED_CODE,
            line_items: {
              type: 'array',
              minItems: 1,
              examples: [[{ name: 'Rice', qty: 1 }]],
              description: 'the lines; every price is re-read from the shop’s catalogue, never taken from here'
            },
            name: anything('what the shop calls the shopper'),
            location: anything('where to deliver (coarse, the shopper’s consent)'),
            fulfilment: anything("'pickup' or delivery"),
            requested_delivery: anything('{ date, time } asked for, not agreed'),
            remark: anything('a note to the shop'),
            captured: anything('the fields capture-fields asked for')
          },
          CONTACT
        )
      )
    )
  },
  responses: {
    200: {
      description: 'placed',
      content: json(
        closed(['message', 'chit_id', 'shop', 'summary', 'token'], {
          message: text,
          chit_id: text,
          shop: maybeText,
          summary: { type: 'object' },
          token: text,
          documents: { type: 'array' }
        })
      )
    },
    400: refused('a key this door does not read, no code or an empty order, the order was not started, or the code is wrong or expired'),
    403: refused('the shop is closed and takes no orders'),
    404: NO_SHOP,
    409: refused(
      'this order was already sent, the same Idempotency-Key is still being answered (the second tap), a line mixes currencies, or the database refused it on purpose'
    ),
    422: refused(
      'no phone or email, a line the shop’s catalogue refuses (not sold here, no price, out of stock, too many forms), no Idempotency-Key, or the Idempotency-Key was already used with another body'
    ),
    500: FAULT,
    503: refused('a form’s template could not be read just now — nothing was placed')
  }
};
const LOGIN_VERIFY_OPERATION = {
  summary: 'A returning shopper signs in with the code (no order) and gets a customer token for this shop',
  tags: ['storefront'],
  security: [],
  requestBody: { required: true, content: json(closed(['otp'], Object.assign({ otp: TYPED_CODE }, CONTACT))) },
  responses: {
    200: { description: 'signed in', content: json(closed(['message', 'token'], { message: text, token: text, name: maybeText })) },
    400: refused('a key this door does not read, no code, no account yet, or a wrong or expired code'),
    404: NO_SHOP,
    422: NO_CONTACT,
    500: FAULT
  }
};

/** the doors as the register keys them: 'METHOD /express/path' under the /api/catalogue mount */
const OPERATIONS = {
  'GET /network-store/:networkId': NETWORK_STORE_OPERATION,
  'POST /network-store/:networkId/order': NETWORK_ORDER_OPERATION,
  'GET /network/:bridge_id': NETWORK_FRONT_OPERATION,
  'GET /:bridge_id': SHOP_VIEW_OPERATION,
  'GET /:bridge_id/capture-fields': CAPTURE_FIELDS_OPERATION,
  'POST /:bridge_id/order/start': ORDER_START_OPERATION,
  'GET /:bridge_id/support/preview': SUPPORT_PREVIEW_OPERATION,
  'POST /:bridge_id/support/start': SUPPORT_START_OPERATION,
  'POST /:bridge_id/support': SUPPORT_OPERATION,
  'POST /:bridge_id/order/confirm': ORDER_CONFIRM_OPERATION,
  'POST /:bridge_id/login/verify': LOGIN_VERIFY_OPERATION
};
/** openapiPaths(mount) → router.openapi.paths: each door under its mount, {param} style */
function openapiPaths(mount) {
  const paths = {};
  Object.entries(OPERATIONS).forEach(([key, operation]) => {
    const [method, route] = key.split(' ');
    const full = (mount + route).replace(/:([A-Za-z_]+)/g, '{$1}');
    (paths[full] = paths[full] || {})[method.toLowerCase()] = operation;
  });
  return paths;
}

/* ── the old answers the storefront reads (docs/contracts/api-legacy.json): frozen ── */
const UNKNOWN_KEY_WORDS = 'Not accepted here';
/**
 * refusalFor(chain) → the schemaValidate options that keep the old 400 "Validation failed" body: one {field, message} per field at fault, in the
 * old chain's order, its own message where the chain had one ('Invalid value' where it had none). chain = [[field, message?], …].
 */
function refusalFor(chain) {
  const order = chain.map(([field]) => field);
  const words = Object.fromEntries(chain.filter((link) => link[1]).map(([field, message]) => [field, message]));
  const rank = (field) => (order.indexOf(field) < 0 ? order.length : order.indexOf(field));
  /* the frozen body: each field once, the old chain order first, then any key the door does not read */
  const legacy = (failures) => {
    const once = failures.filter((failure, index) => failures.findIndex((other) => other.field === failure.field) === index);
    const sorted = once.slice().sort((first, second) => rank(first.field) - rank(second.field));
    return {
      error: 'Validation failed',
      details: sorted.map((failure) => ({
        field: failure.field,
        message: failure.code === 'UNKNOWN_FIELD' ? UNKNOWN_KEY_WORDS : words[failure.field] || 'Invalid value'
      }))
    };
  };
  return { status: 400, code: 'INVALID_INPUT', legacy };
}
/** trimmed(...fields) → middleware: the old chain's trim() — a value is turned to text and trimmed, so the door reads what it always read */
function trimmed(...fields) {
  return function trimmedFields(req, res, next) {
    fields.forEach((field) => {
      const value = req.body && req.body[field];
      if (value !== undefined && value !== null) req.body[field] = String(value).trim();
    });
    next();
  };
}

const NO_SHOP_BODY = { error: 'Not found', message: 'Shop not found' };
const SHOP_CLOSED = { error: 'Shop closed', message: 'This shop is currently closed and not accepting orders.' };
const NO_SUCH_NETWORK = { error: 'Not found', code: 'NO_SUCH_NETWORK', message: 'There is no network store by that name.' };
const SIGN_IN_FIRST = { error: 'Unauthorised', code: 'SIGN_IN_FIRST', message: 'Sign in at the store to order.' };
const NETWORK_ORDERS_OFF = {
  error: 'Disabled',
  code: 'NETWORK_ORDERS_OFF',
  may: false,
  why: 'Network ordering is not switched on here.',
  message: 'Network ordering is not switched on here.'
};
const NOT_THIS_NETWORK = {
  error: 'Forbidden',
  code: 'NOT_THIS_NETWORK',
  message: "Your sign-in belongs to another store. Sign in at this network's store to order."
};
const NETWORK_NOT_READ = { error: 'Network not read', message: membership.READ_FAILED_WORDS, code: membership.READ_FAILED };
/** oldBody(error, message) → the storefront's old refusal body, the two keys shop.html reads */
const oldBody = (error, message) => ({ error, message });
/* fail closed: a 5xx keeps the old `error` and says nothing of its cause (S8) */
const failedAs = (error) => oldBody(error, SAFE_SENTENCE);
const FAILED = {
  STOREFRONT: failedAs('Storefront failed'),
  NETWORK_ORDER: failedAs('Order failed'),
  NETWORK_FRONT: failedAs('Network storefront failed'),
  CATALOGUE: failedAs('Catalogue failed'),
  CAPTURE_FIELDS: failedAs('Capture fields failed'),
  ORDER_START: failedAs('Order start failed'),
  SEND_CODE: failedAs('Could not send the code'),
  SEND_REPORT: failedAs('Could not send it'),
  SUBMISSION: failedAs('Submission rejected'),
  REPRICE: failedAs('Order rejected'),
  ORDER: failedAs('Order failed'),
  SIGN_IN: failedAs('Sign-in failed')
};
/* SEC-81c: before sign-in an unknown contact and a refused code get one answer, in SEC-81's own sentence (lib/otp, #333) */
const { SIGNIN_REFUSED_SENTENCE } = require('./otp');
const SIGN_IN_REFUSED = oldBody('Sign-in failed', SIGNIN_REFUSED_SENTENCE); /* login/verify: the body routes/signin.js answers */
const VERIFY_REFUSED = oldBody('Verify failed', SIGNIN_REFUSED_SENTENCE); /* support, order/confirm */
const PREVIEW_NO_SHOP = { ok: false, why: 'This shop could not be found.' };
const PREVIEW_FAILED = { ok: false, why: 'Could not check where this would go.' };

module.exports = {
  OPERATIONS,
  openapiPaths,
  refusalFor,
  trimmed,
  oldBody,
  NO_SHOP: NO_SHOP_BODY,
  SHOP_CLOSED,
  NO_SUCH_NETWORK,
  SIGN_IN_FIRST,
  NETWORK_ORDERS_OFF,
  NOT_THIS_NETWORK,
  NETWORK_NOT_READ,
  FAILED,
  SIGN_IN_REFUSED,
  VERIFY_REFUSED,
  PREVIEW_NO_SHOP,
  PREVIEW_FAILED
};
