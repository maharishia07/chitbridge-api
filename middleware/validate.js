// middleware/validate.js — Input validation helpers
// CALLED BY routes/actors.js, routes/catalogue.js, routes/chits.js, routes/connections.js, routes/connectors.js (+4 more)   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
// FLOW      route's OpenAPI operation → schemaValidate(operation) → ajv over its body and url schemas → next() | 422 Problem listing every field at fault
// CARD      28-platform-and-operations/api-standard
// API-1 slice 1b (API-STANDARD S9, S4): schemaValidate(operation) checks a request against the route's OWN OpenAPI schema (ajv) and answers a refusal that lists EVERY field at fault.
// express-validator chains and validate() keep working for the routes that have not moved yet.
const { validationResult } = require('express-validator');
const Ajv2020 = require('ajv/dist/2020');
const { problem } = require('../lib/problem');

// Check validation results and return errors if any
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map((e) => ({
        field: e.path,
        message: e.msg
      }))
    });
  }
  next();
};

/**
 * validateAsProblem — validate()'s twin for a route that has moved to the standard (API-STANDARD S1): the SAME verdict from the same express-validator chains and the SAME old body
 * ({ error: 'Validation failed', details: [{ field, message }] }), answered as a Problem (400, code INVALID_INPUT) with those keys beside the Problem fields.
 */
const validateAsProblem = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const details = errors.array().map((e) => ({ field: e.path, message: e.msg }));
  return problem(req, res, { status: 400, code: 'INVALID_INPUT', detail: details[0].message, field: details[0].field, legacy: { error: 'Validation failed', details } });
};

// Sanitise string — remove dangerous characters
const sanitise = (str) => {
  if (!str) return str;
  return String(str)
    .trim()
    .replace(/[<>]/g, '') // remove HTML tags
    .substring(0, 1000); // max length
};

/**
 * isCalendarDay(value) — true only for a REAL calendar day written YYYY-MM-DD (2026-02-30 and 2026-13-01 are not days). CMP-23: a date column is fed
 * from a body, and Postgres answers a bad day with its own words (22007, 22008) under a 500; callers refuse it first.
 */
const isCalendarDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && isDay(value); // date only, through the one day rule (isDay, API-17)

/* one engine for the body (exact types: a number is not a string) and one for the URL (a query value is always text, so "5" may be the integer 5) */
const AJV_OPTIONS = { allErrors: true, strict: false, allowUnionTypes: true };
const bodyEngine = new Ajv2020(AJV_OPTIONS);
const urlEngine = new Ajv2020(Object.assign({ coerceTypes: true }, AJV_OPTIONS));
const DEFAULT_REFUSAL = { status: 422, code: 'INVALID_INPUT' };
const BODY_SENTENCE = 'Some of what was sent is missing or not valid.';

/** the JSON body schema of an OpenAPI operation, or null when it takes none */
const bodySchemaOf = (operation) => {
  const content = operation && operation.requestBody && operation.requestBody.content;
  return (content && content['application/json'] && content['application/json'].schema) || null;
};

/** the path and query parameters of an OpenAPI operation as one object schema, or null when it has none */
const urlSchemaOf = (operation) => {
  const given = ((operation && operation.parameters) || []).filter((item) => item.in === 'path' || item.in === 'query');
  if (!given.length) return null;
  const properties = {};
  given.forEach((item) => { properties[item.name] = item.schema || {}; });
  return { type: 'object', properties, required: given.filter((item) => item.required).map((item) => item.name) };
};

/** the field an ajv error is about: the missing property for "required", the key itself for one the schema does not list, else the path to the bad value (a.b.0 style) */
const fieldOf = (failure) => {
  const where = failure.instancePath.split('/').filter(Boolean);
  if (failure.keyword === 'required') where.push(failure.params.missingProperty);
  if (failure.keyword === 'additionalProperties') where.push(failure.params.additionalProperty); /* S33: the unknown key is named, not the body */
  return where.join('.') || '(body)';
};

/** the plain sentence for one failure: what is wrong with which field */
const sentenceOf = (failure, field) => {
  if (failure.keyword === 'required') return field + ' is needed.';
  if (failure.keyword === 'type') return field + ' must be ' + (Array.isArray(failure.params.type) ? failure.params.type.join(' or ') : 'a ' + failure.params.type) + '.';
  if (failure.keyword === 'additionalProperties') return field + ' is not accepted here.'; /* API-3 strict input: refused, never dropped */
  if (failure.keyword === 'enum') return field + ' must be one of: ' + failure.params.allowedValues.join(', ') + '.';
  return field + ' ' + failure.message + '.';
};

const KIND_CODES = { required: 'MISSING_FIELD', additionalProperties: 'UNKNOWN_FIELD' };

/** errorsOf(validator, value) → [] when the value fits the schema, else one {field, code, detail} per field at fault (every one, not the first) */
function errorsOf(validator, value) {
  if (validator(value)) return [];
  const seen = new Set();
  return validator.errors
    .map((failure) => {
      const field = fieldOf(failure);
      const kind = { code: KIND_CODES[failure.keyword] || 'WRONG_VALUE' };
      return { field, code: kind.code, detail: sentenceOf(failure, field) };
    })
    .filter((item) => !seen.has(item.field + item.code) && seen.add(item.field + item.code));
}

/**
 * schemaValidate(operation, options?) — express middleware. operation = the route's OpenAPI operation (requestBody + parameters).
 * options.status/code/legacy keep an outward route on its old refusal (S2: 400 and its frozen body) until its next major; default is S4's 422 INVALID_INPUT.
 * options.legacy(errors, req) → the frozen body for the first failure (the request is there for a body that counts what was sent, as definitions' two chains did).
 */
function schemaValidate(operation, options) {
  const choice = options || {};
  const bodyCheck = bodySchemaOf(operation) && bodyEngine.compile(bodySchemaOf(operation));
  const urlCheck = urlSchemaOf(operation) && urlEngine.compile(urlSchemaOf(operation));
  /* the middleware itself: reads req.body and the url facts, lets a fitting request on, refuses the rest with every field named */
  const schemaValidated = function schemaValidated(req, res, next) {
    const urlFacts = Object.assign({}, req.query, req.params);
    const failures = (urlCheck ? errorsOf(urlCheck, urlFacts) : []).concat(bodyCheck ? errorsOf(bodyCheck, req.body === undefined ? {} : req.body) : []);
    if (!failures.length) return next();
    return problem(req, res, {
      status: choice.status || DEFAULT_REFUSAL.status,
      code: choice.code || DEFAULT_REFUSAL.code,
      detail: failures.length === 1 ? failures[0].detail : BODY_SENTENCE,
      field: failures[0].field,
      errors: failures,
      legacy: choice.legacy ? choice.legacy(failures, req) : undefined
    });
  };
  /* the register and the contract-test generator find a route's schema check by these two properties */
  schemaValidated.schemaOperation = operation;
  schemaValidated.schemaOptions = choice;
  return schemaValidated;
}

/** a real calendar day (YYYY-MM-DD, optionally followed by a time): "7", "abc" and 2026-02-30 are not */
const isDay = (text) => {
  const found = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(text);
  if (!found) return false;
  const calendarDay = new Date(Date.UTC(+found[1], +found[2] - 1, +found[3]));
  return calendarDay.getUTCFullYear() === +found[1] && calendarDay.getUTCMonth() === +found[2] - 1 && calendarDay.getUTCDate() === +found[3];
};

/**
 * queryDay(...names) — express middleware (API-17, BH-6): each named query value, when given, must be ONE real day, else 400 VALIDATION_FAILED before any read.
 * Postgres refuses "7" or "abc" for a timestamp with its own words, and that used to surface as a 500. An absent or empty value is left to the handler.
 */
const queryDay = (...names) =>
  function queryDayChecked(req, res, next) {
    const failures = names
      .filter((name) => req.query[name] !== undefined && req.query[name] !== '' && !(typeof req.query[name] === 'string' && isDay(req.query[name].trim())))
      .map((name) => ({ field: name, code: 'WRONG_VALUE', detail: name + ' must be a date (YYYY-MM-DD).' }));
    if (!failures.length) return next();
    return problem(req, res, { status: 400, code: 'VALIDATION_FAILED', detail: failures[0].detail, field: failures[0].field, errors: failures });
  };

module.exports = { queryDay, validate, validateAsProblem, sanitise, isCalendarDay, schemaValidate, errorsOf, bodySchemaOf, urlSchemaOf, bodyEngine };
