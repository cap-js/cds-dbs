// The builtin artifacts of CDS

// TODO: split this file
// - in base/: common definitions, datetime formats
// - in compiler/: XSN-specific
// - in ?: CSN-specific

'use strict';

const { builtinLocation } = require('../base/location');
const { setLink: setProp } = require('./utils');
const { isBetaEnabled } = require('../base/model');

// TODO: make type parameters a dict
const core = {
  String: { parameters: [ 'length' ], category: 'string' },
  LargeString: { category: 'string' },
  Binary: { parameters: [ 'length' ], category: 'binary' },
  LargeBinary: { category: 'binary' },
  Decimal: { parameters: [ 'precision', 'scale' ], category: 'decimal' },
  DecimalFloat: { category: 'decimal', deprecated: true },
  Integer64: { category: 'integer' },
  Integer: { category: 'integer' },
  UInt8: { category: 'integer' },
  Int16: { category: 'integer' },
  Int32: { category: 'integer' },
  Int64: { category: 'integer' },
  Double: { category: 'decimal' },
  Date: { category: 'dateTime' },
  Time: { category: 'dateTime' },
  DateTime: { category: 'dateTime' },
  Timestamp: { category: 'dateTime' },
  Boolean: { category: 'boolean' },
  UUID: { category: 'string' },
  Vector: { parameters: [ 'length' /* , 'type' */ ], category: 'vector' },
  Map: { category: 'map' },
  Association: { internal: true, category: 'relation' },
  Composition: { internal: true, category: 'relation' },
};

const coreHana = {
  // ALPHANUM: { parameters: [ 'length' ] },
  SMALLINT: { category: 'integer' },
  TINYINT: { category: 'integer' },
  SMALLDECIMAL: { category: 'decimal' },
  REAL: { category: 'decimal' },
  CHAR: { parameters: [ 'length' ], category: 'string' },
  NCHAR: { parameters: [ 'length' ], category: 'string' },
  VARCHAR: { parameters: [ 'length' ], category: 'string' },
  CLOB: { category: 'string' },
  BINARY: { parameters: [ 'length' ], category: 'binary' },
  // TODO: probably remove default for ST_POINT, ST_GEOMETRY (to be done in backend);
  ST_POINT: { parameters: [ { name: 'srid', literal: 'number', val: 0 } ], category: 'geo' },
  ST_GEOMETRY: { parameters: [ { name: 'srid', literal: 'number', val: 0 } ], category: 'geo' },
};

const typeParameters = {
  expectedLiteralsFor: {
    length: [ 'number' ],
    scale: [ 'number', 'string' ],
    precision: [ 'number' ],
    srid: [ 'number' ],
  },
};
// a.k.a "typeProperties"
typeParameters.list = Object.keys( typeParameters.expectedLiteralsFor );


// const hana = {
//   BinaryFloat: {},
//   LocalDate: {},
//   LocalTime: {},
//   UTCDateTime: {},
//   UTCTimestamp: {},
//   WithStructuredPrivilegeCheck: { kind: 'annotation' },
//   hana: { kind: 'context' },
// };


const specialFunctions = compileFunctions( {
  // TODO: use lower-case
  '': [                         // the default
    {
      intro: [ 'ALL', 'DISTINCT' ],
      introMsg: [],             // do not list them in code completion
    },
    {},
  ],
  ROUND: [
    null, null, {               // 3rd argument: rounding mode
      expr: [ 'ROUND_HALF_UP', 'ROUND_HALF_DOWN', 'ROUND_HALF_EVEN',
        'ROUND_UP', 'ROUND_DOWN', 'ROUND_CEILING', 'ROUND_FLOOR' ],
    },
  ],
  TRIM: [
    {
      intro: [ 'LEADING', 'TRAILING', 'BOTH' ],
      expr: [ 'LEADING', 'TRAILING', 'BOTH' ],
      separator: [ 'FROM' ],
    },
  ],
  EXTRACT: [
    {
      expr: [ 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND' ],
      separator: [ 'FROM' ],
    },
  ],
  COUNT: [
    {
      expr: [ '*' ],
      intro: [ 'ALL', 'DISTINCT' ],
    },
  ],
  MIN: 'COUNT',
  MAX: 'COUNT',
  SUM: 'COUNT',
  AVG: 'COUNT',
  STDDEV: 'COUNT',
  VAR: 'COUNT',
  LOCATE_REGEXPR: [
    {
      intro: [ 'START', 'AFTER' ],
      separator: [ 'FLAG', 'IN', 'FROM', 'OCCURRENCE', 'GROUP' ],
    },
  ],
  OCCURRENCES_REGEXPR: [
    {
      separator: [ 'FLAG', 'IN', 'FROM' ],
    },
  ],
  REPLACE_REGEXPR: [
    {
      separator: [ 'FLAG', 'IN', 'WITH', 'FROM', 'OCCURRENCE' ],
      expr: [ 'ALL' ],
    },
  ],
  SUBSTRING_REGEXPR: [
    {
      separator: [ 'FLAG', 'IN', 'FROM', 'OCCURRENCE', 'GROUP' ],
    },
  ],
  SUBSTR_REGEXPR: 'SUBSTRING_REGEXPR',
} );

function compileFunctions( special ) {
  const compiled = {};
  for (const [ name, val ] of Object.entries( special ))
    compiled[name] = (typeof val === 'string' ? special[val] : val).map( compileArg );
  return compiled;
}

function compileArg( src ) {
  if (!src)
    return src;
  const tgt = {
    intro: src.intro || [],
    expr: src.expr || [],
    separator: src.separator || [],
  };
  for (const generic of [ 'intro', 'expr', 'separator' ]) {
    // intro before expr: if both intro and expr, tag as 'expr'
    for (const token of src[generic] || [])
      tgt[token] = generic;
  }
  // As GenericIntro is always together with GenericExpr, only mention those
  // which are not already proposed for GenericExpr:
  tgt.introMsg = src.introMsg || tgt.intro.filter( token => tgt[token] === 'intro' );
  return tgt;
}

/**
 * Variables that have special meaning in CDL/CSN.
 */
const magicVariables = {
  $user: {
    // always available
    elements: { id: {}, locale: {} },
    // Allow $user.<any>
    $uncheckedElements: true,
    // Allow shortcut in CDL: `$user` becomes `$user.id` in CSN.
    $autoElement: 'id',
  },
  $at: { // $at is considered deprecated since cds-compiler v5
    elements: {
      from: {}, to: {},
    },
    // Require that elements are accessed, i.e. no $at, only $at.<element>.
    $requireElementAccess: true,
    deprecated: true, // $at is deprecated; use $valid
  },
  $valid: {
    elements: {
      from: {}, to: {},
    },
    // Require that elements are accessed, i.e. no $valid, only $valid.<element>.
    $requireElementAccess: true,
  },
  $now: {},
  $tenant: { $requiresBetaFlag: 'tenantVariable' },
  $session: {
    // In ABAP CDS session variables are accessed in a generic way via
    // the pseudo variable $session.
    $uncheckedElements: true,
    $requireElementAccess: true,
  },
  $draft: {
    elements: {
      IsActiveEntity: {},
      HasActiveEntity: {},
      HasDraftEntity: {},
    },
    // Require that elements are accessed, i.e. no $draft, only $draft.<element>.
    $requireElementAccess: true,
    // See reference semantics in shared.js
    $onlyInExprCtx: [ 'annotation', 'annoRewrite' ],
  },
};

// see lib/render/renderUtil.js for DB-specific magic vars, specified in CAP CDS  via function

const dateRegEx = /^(-?\d{4})-(\d{1,2})-(\d{1,2})$/;
//                      YYYY -     MM  -   dd
const timeRegEx = /^T?(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:Z|[+-]\d{2}(?::\d{2})?)?$/;
//                  T     HH   :    mm      :    ss         TZD
// eslint-disable-next-line @stylistic/js/max-len, sonarjs/regex-complexity
const timestampRegEx = /^(-?\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,7})?)?(?:Z|[+-]\d{2}(?::\d{2})?)?$/;
//                          YYYY  -  MM   -  dd    T    HH   :   mm     :  ss     . fraction     TZD
// eslint-disable-next-line sonarjs/regex-complexity
const numberRegEx = /^[ \t]*[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?[ \t]*$/i;

/**
 * Patterns for literal token tests and creation.  The value is a map from the
 * `prefix` argument of function `quotedliteral` to the following properties:
 *  - `test_msg`: error message which is issued if `test_fn` fails.
 *  - `test_fn`: function called with argument `value`, fails falsy return value
 *  - `unexpected_msg`: error message which is issued if `unexpected_char` matches
 *  - `unexpected_char`: regular expression matching an illegal character in `value`,
 *    the error location is only correct for a literal <prefix>'<value>'
 * TODO: we might do a range check (consider leap seconds, i.e. max value 60),
 *       but always allow Feb 29 (no leap year computation)
 * Notes:
 *  - Dates/Times as defined in ISO 8601, see <https://en.wikipedia.org/wiki/ISO_8601>
 */
const quotedLiteralPatterns = {
  x: {
    test_variant: 'uneven-hex',
    test_fn: (str => Number.isInteger( str.length / 2 )),
    unexpected_variant: 'invalid-hex',
    unexpected_char: /[^0-9a-f]/i,
    json_type: 'string',
  },
  time: {
    test_variant: 'time',
    test_fn: (x) => {
      // Leading `T` allowed in ISO 8601.
      const match = x.match( timeRegEx );
      return match !== null && checkTime( match[1], match[2], match[3] );
    },
    json_type: 'string',
  },
  date: {
    test_variant: 'date',
    test_fn: (x) => {
      const match = x.match( dateRegEx );
      return match !== null && checkDate( match[1], match[2], match[3] );
    },
    json_type: 'string',
  },
  timestamp: {
    test_variant: 'timestamp',
    test_fn: (x) => {
      const match = x.match( timestampRegEx );
      return match !== null && checkDate( match[1], match[2], match[3] ) &&
        checkTime( match[4], match[5], match[6] );
    },
    json_type: 'string',
  },
  // and only for CSN parser:
  null: {
    json_type: 'null',          // modulo JSON typeof weirdness
  },
  boolean: {
    json_type: 'boolean',
  },
  number: {
    test_variant: 'number',
    test_fn: (x => numberRegEx.test( x )),
    json_type: 'number',
    secondary_json_type: 'string',
  },
  string: {
    json_type: 'string',
  },
};

/**
 * Check that the given date is within boundaries.
 * We can't use Date.parse() since that also allows non-standard values (2022-02-31 for example).
 * Checks according to ISO 8601.
 *
 * @returns {boolean} True if the date is valid.
 */
function checkDate( year, month, day ) {
  // Negative years are allowed
  year = Math.abs( Number.parseInt( year, 10 ) );
  month = Number.parseInt( month, 10 );
  day = Number.parseInt( day, 10 );
  // If any is NaN, the condition will be false.
  // Year 0 does not exist, but ISO 8601 allows it and defines it as 1 BC.
  return !Number.isNaN( year ) && month > 0 && month < 13 && day > 0 && day < 32;
}

/**
 * Check that the given time is within boundaries.
 * Checks according to ISO 8601.
 *
 * @returns {boolean} True if the date is valid.
 */
function checkTime( hour, minutes, seconds ) {
  hour = Number.parseInt( hour, 10 );
  minutes = Number.parseInt( minutes, 10 );
  seconds = seconds ? Number.parseInt( seconds, 10 ) : 0;
  if (hour === 24) // allow 24:00:00 (ISO 8601 version earlier than 2019)
    return minutes === 0 && seconds === 0;
  // If any is NaN, the condition will be false.
  return hour >= 0 && hour < 24 &&
    minutes >= 0 && minutes < 60 &&
    seconds >= 0 && seconds < 61; // we allow 60 for lead seconds
}

/** All types belong to one category. */
const typeCategories = {
  string: [],
  integer: [],
  dateTime: [],
  time: [],
  decimal: [],
  binary: [],
  boolean: [],
  relation: [],
  geo: [],
  vector: [],
  map: [],
};
// Fill type categories with `cds.*` types
Object.keys( core ).forEach( (type) => {
  if (core[type].category)
    typeCategories[core[type].category].push( `cds.${ type }` );
} );
// Fill type categories with `cds.hana.*` types
Object.keys( coreHana ).forEach( (type) => {
  if (coreHana[type].category)
    typeCategories[coreHana[type].category].push( `cds.hana.${ type }` );
} );

/** @param {string} typeName */
function isGeoTypeName( typeName ) {
  return typeCategories.geo.includes( typeName );
}

/**
 * Add CDS builtins like the `cds` namespace with types like `cds.Integer` to
 * `definitions` of the XSN model as well as to `$builtins`.
 *
 * @param {XSN.Model} model XSN model without CDS builtins
 */
function initBuiltins( model ) {
  const { options } = model;
  setMagicVariables( magicVariables );
  // namespace:"cds" stores the builtins ---
  const cds = createNamespace( 'cds', 'reserved' );
  model.definitions.cds = cds;

  // Also add the core artifacts to model.definitions`
  const c = { ...core };
  model.$builtins = env( c, 'cds.', cds );
  model.$builtins.cds = cds;

  // namespace:"cds.hana" stores HANA-specific builtins ---
  const hana = createNamespace( 'cds.hana', 'reserved' );
  model.definitions['cds.hana'] = hana;
  model.$builtins.hana = hana;
  cds._subArtifacts.hana = hana;
  env( coreHana, 'cds.hana.', hana );
  model.$internal = { $frontend: '$internal' };
  // namespace:"localized" reserved ---
  model.definitions.localized = createNamespace( 'localized', 'reserved' );
  return;

  function createNamespace( name, builtin ) {
    const art = {
      kind: 'namespace',
      // builtin namespaces don't have a cds file, so no location available
      name: { id: name, location: builtinLocation() },
      blocks: [],
      builtin,
      location: builtinLocation(),
    };
    setProp( art, '_subArtifacts', Object.create( null ) );
    return art;
  }

  /**
   * Insert the builtins into the parent's `_subArtifacts` dictionary without the
   * prefix and into the model's `definitions` dictionary prefixed.
   *
   * @param {object} builtins Object containing the builtin types.
   * @param {string} prefix Type prefix, e.g. 'cds.'
   * @param {object} parent
   * @returns {object} Artifacts dictionary with the builtin artifacts without prefixes.
   */
  function env( builtins, prefix, parent ) {
    const artifacts = Object.create( null );
    for (const name of Object.keys( builtins )) {
      const id = prefix + name;
      // TODO: reconsider whether to set a type to itself - looks wrong
      const art = {
        kind: 'type', builtin: true, name: { id },
      };
      if (parent)
        parent._subArtifacts[name] = art;
      setProp( art, '_origin', '' );
      setProp( art, '_effectiveType', art );
      setProp( art, '_deps', [] );
      Object.assign( art, builtins[name] );
      if (!art.internal)
        artifacts[name] = art;
      model.definitions[id] = art;
    }
    return artifacts;
  }

  function setMagicVariables( builtins ) {
    const elements = Object.create( null );
    model.$magicVariables = { kind: '$magicVariables', elements };
    for (const id in builtins) {
      const magic = builtins[id];
      if (magic.$requiresBetaFlag && !isBetaEnabled( options, magic.$requiresBetaFlag ))
        continue;

      // TODO: rename to $builtinFunction
      const art = {
        kind: 'builtin',        // TODO: $var
        name: { id },
      };
      elements[id] = art;
      setProp( art, '_parent', model.$magicVariables );

      if (magic.$autoElement)
        art.$autoElement = magic.$autoElement;
      if (magic.$uncheckedElements)
        art.$uncheckedElements = magic.$uncheckedElements;
      if (magic.$requireElementAccess)
        art.$requireElementAccess = magic.$requireElementAccess;
      if (magic.deprecated)
        art.deprecated = magic.deprecated;
      if (magic.$onlyInExprCtx)
        art.$onlyInExprCtx = magic.$onlyInExprCtx;

      createMagicElements( art, magic.elements );
      if (options.variableReplacements?.[id])
        createMagicElements( art, options.variableReplacements[id] );
      // setProp( art, '_effectiveType', art );
    }
  }

  function createMagicElements( art, elements ) {
    if (!elements)
      return;

    const names = Object.keys( elements );
    if (names.length > 0 && !art.elements)
      art.elements = Object.create( null );

    for (const id of names) {
      const magic = {
        kind: 'builtin',        // TODO: '$var'
        name: { id },
      };
      // Propagate this property so that it is available for sub-elements.
      if (art.$uncheckedElements)
        magic.$uncheckedElements = art.$uncheckedElements;
      if (art.$onlyInExprCtx)
        magic.$onlyInExprCtx = art.$onlyInExprCtx;
      setProp( magic, '_parent', art );
      // setProp( magic, '_effectiveType', magic );
      if (elements[id] && typeof elements[id] === 'object')
        createMagicElements( magic, elements[id] );

      art.elements[id] = magic;
    }
  }
}

module.exports = {
  typeParameters,
  specialFunctions,
  quotedLiteralPatterns,
  initBuiltins,
  isGeoTypeName,
};
