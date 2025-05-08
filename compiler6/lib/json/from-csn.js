// CSN frontend - transform CSN into XSN


// TODO: re-check extensions handling - set kind early!, ...
// TODO: restrict 'actions' etc better in annotate statements - also/only consider parent property!
// TODO: extend E { extend elem { extend sub } }

'use strict';

/**
 * Overview of properties in schema specifications (values in 'schema' dictionary):
 *
 * @typedef {object} SchemaSpec
 *
 * @property {TransformerFunction}  [type]
 *     Transformation and test function (i.e. type). The first four arguments are the same for
 *     all functions.  Further ones may be accepted as well.
 *
 * @property {string}  [class]
 *     A schemaClass. Possible values are keys of the variable "schemaClasses".
 *     Essentially all properties of the class are copied.
 *
 * @property {Function}  [arrayOf]
 *     Alternative to "type". The property should be an array. Value is passed to arrayOf().
 *     Value is ignored if "type" is set. Then it is only used for better error messages.
 *
 * @property {Function}  [dictionaryOf]
 *     Alternative to "type". The property should be an object in dictionary form (i.e.
 *     Object.<string, type>).  Value is passed to dictionaryOf(). Value is ignored if "type"
 *     is set. Then it is only used for better error messages.
 *
 * @property {Object.<string, SchemaSpec>}  [schema]
 *     If some sub-properties have a different semantic in this property than the default then
 *     switch the currently used spec to this value.
 *
 * @property {string}  [prop]
 *     Name of the property. compileSchema() sets it to the dictionary key by default.
 *
 * @property {string}  [msgProp]
 *     Display name of the property. compileSchema() sets it to the dictionary key
 *     (+ optional '[]') by default.
 *
 * @property {string}  [msgVariant]
 *     Use this message variant instead of the default one.
 *     Allows more precise and detailed error messages.
 *
 * @property {string|string[]|Function|false}  [requires]
 *     If the value is a(n array of) string, then (one of) the given sub-property is required.
 *     If a function, that function issues its own message.
 *     If `undefined` (default), then at least one property is required.
 *     If false, then no sub-properties are required.
 *
 * @property {boolean}  [noPrefix]
 *     Only used for '#' at the moment. Signals that the entry should not be used for keys
 *     like '#key'.  `getSchema(...)` normally checks if `schema[prop]` exists and if not, checks
 *     for `schema[prop.charAt(0)]`.
 *     This is intended for annotations and similar (which start with special characters).
 *
 * @property {boolean}  [ignore]
 *     Don't issue warnings.
 *
 * @property {string[]}  [optional]
 *     Optional sub-properties that may be used. Warnings are issued if unknown properties are set.
 *
 * @property {string}  [defaultKind]
 *     Default kind for sub-elements, e.g. objects in "elements".
 *
 * @property {string[]|Function} [inKind]
 *     Specifies in what definition type this property may be used, e.g. "virtual" may only be
 *     used for elements. If it is a function then it takes two arguments "kind" and "parentSpec"
 *     should return a boolean.
 *
 * @property {string[]}  [validKinds]
 *     What "kind" values are possible in a definition. The root "definitions" properties allows
 *     more kinds than e.g. definitions inside "elements".
 *
 * @property {string|string[]|Object}  [onlyWith]
 *     Defines that the property *must* be used with one of these properties.
 *     If an object, it maps the kind value to a string or array of strings.
 *
 * @property {number}           [minLength]
 *     Minimum number of elements that an array must have.
 *
 * @property {boolean}            [inValue]
 *     Puts the value into an XSN property "value", e.g. { value: ... }
 *
 * @property {string[]}         [xorGroups]
 *     Corresponding xor groups. It references a value of xorGroups. If set then only one property
 *     of the xorGroup may be set, e.g. if target is set, elements may not.
 *     If you are looking for a `notWith` (which should be symmetric), this is your property.
 *
 * @property {string}               [xsnOp]
 *     Defines the operator to be used for XSN. Used for SET and SELECT. See queryTerm().
 *
 * @property {string}            [vZeroFor]
 *     Marks the property as a CSN 0.1.0 property. It is replaced by this CSN 1.0
 *     property (value of vZeroFor).
 *
 * @property {string}         [vZeroIgnore]
 *     Marks the property as a CSN 0.1.0 property. The property is ignored and a warning may be
 *     issues about it.
 *
 * @property {string}        [xorException]
 *     A property name that is allowed besides another property of an xorGroup (as an exception
 *     to the rule).
 *
 * @property {boolean}        [ignoreExtra]
 *     Whether extra properties are ignored and not put into $extra.
 */

/**
 * @typedef {Function} TransformerFunction
 * @param {object} obj
 * @param {object} xsn
 * @param {object} csn
 * @param {object} prop
 * @param {...any} any Further arguments.
 * @returns {any} XSN property (e.g. string, object, ...)
 */

const { dictAdd } = require('../base/dictionaries');
const { quotedLiteralPatterns } = require('../compiler/builtins');
const { isAnnotationExpression } = require('../base/builtins');
const { CompilerAssertion } = require('../base/error');
const { Location } = require('../base/location');
const { XsnSource } = require('../compiler/xsn-model');
const { xsnAsTree, splitClauses } = require('../parsers/XprTree');

const $location = Symbol.for('cds.$location');

let inExtensions = null;

let vocabInDefinitions = null;  // must be reset!

// CSN property names reserved for CAP
const ourpropsRegex = /^(?:[_$=#@][a-zA-Z]*[0-9]*|[a-zA-Z]+[0-9]*)$/;

// Sync with definition in to-csn.js:
const typeProperties = [
  // do not include CSN v0.1.0 properties here:
  'target', 'elements', 'enum', 'items',
  'cardinality', // for association publishing in views
  'type', 'length', 'precision', 'scale', 'srid', 'localized', 'notNull',
  'keys', 'on',                 // only with 'target'
];
const exprProperties = [
  // do not include CSN v0.1.0 properties here:
  'ref', 'xpr', 'list', 'val', '#', 'func', 'SELECT', 'SET', // Core Compiler checks SELECT/SET
  'param', 'literal', 'args', 'cast', // only with 'ref'/'ref'/'val'/'func'
];

// Groups of properties which cannot be used together:
const xorGroups = {
  // include CSN v0.1.0 properties here:
  ':type': [
    'target', 'targetAspect', 'elements', 'items', // xorException: target+targetAspect
    'length', 'precision', 'scale', 'srid', // xorException: precision+scale
  ],
  ':enum': [ 'target', 'targetAspect', 'elements', 'enum', 'items' ],
  ':expr': [                    // see also xorException property in schema
    'ref', 'xpr', 'list', 'val', '#', 'func', 'SELECT', 'SET', 'expand',
    '=', 'path', 'value', 'op', // '='/'path' is CSN v0.1.0 here
  ],
  ':col': [ 'expand', 'inline' ],
  ':ext': [ 'annotate', 'extend' ], // TODO: better msg for test/negative/UnexpectedProperties.csn
  ':assoc': [
    'on', 'keys',
    'foreignKeys', 'onCond', // 'foreignKeys'/'onCond' is CSN v0.1.0
  ],
  ':on': [ 'on', 'default' ],

  // TODO - improve consequential errors: assume no name given with `join` or `inline`?
  as: [ 'as', 'join', 'inline' ],
  scope: [ 'param' ],
  quantifier: [ 'some', 'any', 'distinct', 'all' ],
  // quantifiers 'some' and 'any are 'xpr' token strings in CSN v1.0
};

// Functions reading properties which do not count for the message
// 'Object in $(PROP) must have at least one property'
const functionsOfIrrelevantProps = [ ignore, extra, explicitName ];

const schemaClasses = {
  condition: {
    arrayOf: exprOrString,
    type: condition,
    msgVariant: 'or-string',    // for 'syntax-expecting-object'
    // TODO: also specify requires here, and adapt onlyWith()
    optional: exprProperties,
  },
  expression: {
    type: expr,
    optional: exprProperties,
  },
  natnumOrStar: {
    type: natnumOrStar,
    msgVariant: 'or-asterisk',  // for 'syntax-expecting-unsigned-int'
  },
  columns: {
    arrayOf: selectItem,
    msgVariant: 'or-asterisk',  // for 'syntax-expecting-object'
    defaultKind: '$column',
    validKinds: [], // pseudo kind '$column'
    // A column with only as+cast.type is a new association
    requires: [ 'ref', 'cast', 'xpr', 'val', '#', 'func', 'list',
      'SELECT', 'SET', 'expand', 'virtual' ],
    schema: {
      xpr: {
        class: 'condition',
        type: xprInValue,
        xorException: 'func', // see xorGroup :expr; for window functions
        inKind: [ '$column' ],
        inValue: true,
      },
      cast: {                   // CDL-style type cast
        // see “global” `cast` schema for SQL `cast` function
        type: embed,
        inValue: false,
        optional: typeProperties,
        inKind: [ '$column' ],
      },
      '=': {
        // by not setting `vZeroFor`, we disallow `=` in `columns`.
        // CSN v0.1 didn't have columns, so this isn't breaking v0.1 compatibility.
        type: ignore,
      },
    },
  },
};

// TODO: also have stricter tests for strings in in xpr/args, join, op, sort, nulls ?

const schema = compileSchema( {
  requires: {
    type: renameTo( 'dependencies', arrayOf( stringVal, val => (val.literal === 'string') ) ),
  },
  i18n: {
    dictionaryOf: i18nLang,
  },
  // definitions: ------------------------------------------------------------
  definitions: {
    dictionaryOf: definition,
    defaultKind: 'type',
    validKinds: [
      'entity', 'type', 'aspect', 'action', 'function', 'context', 'service', 'event', 'annotation',
    ],
    // requires: { entity: ['elements', 'query', 'includes'] } - not, make it work w/o elements
  },
  vocabularies: {
    dictionaryOf: definition,
    defaultKind: 'annotation',
    validKinds: [],
  },
  extensions: {
    arrayOf: definition,
    defaultKind: 'annotate',
    validKinds: [],             // use annotate/extend instead of kind
    requires: [ 'extend', 'annotate' ],
  },
  enum: {
    type: enumDict,
    dictionaryOf: definition,
    defaultKind: 'enum',
    validKinds: [ 'enum' ],
    inKind: [ 'element', 'type', 'param', 'annotation', 'annotate', 'extend' ],
  },
  elements: {
    type: elementsDict,
    dictionaryOf: definition,
    defaultKind: 'element',
    validKinds: [ 'element' ],
    requires: requiresOnWithBothTargetProps,
    inKind: [
      'element',
      'type',
      'aspect',
      'entity',
      'param',
      'annotation',
      'event',
      'annotate',
      'extend',
    ],
  },
  actions: {
    dictionaryOf: actions,
    defaultKind: 'action',
    validKinds: [ 'action', 'function' ],
    onlyWith: { aspect: 'elements' },
    inKind: [ 'entity', 'aspect', 'annotate', 'extend' ],
  },
  params: {
    dictionaryOf: definition,
    defaultKind: 'param',
    validKinds: [ 'param' ],
    inKind: [ 'entity', 'action', 'function', 'annotate' ], // TODO: 'extend'?
  },
  mixin: {
    dictionaryOf: definition,
    defaultKind: 'mixin',
    validKinds: [],
  },
  columns: {
    class: 'columns',
    inKind: [ 'extend' ], // only valid in extend and SELECT/projection
  },
  expand: {
    class: 'columns',
    xorException: 'ref',        // see xorGroup :expr
    inKind: [ '$column' ],      // only valid in $column
  },
  inline: {
    class: 'columns',
    onlyWith: 'ref',
    inKind: [ '$column' ], // only valid in $column
  },
  keys: {
    arrayOf: definition,
    type: keys,
    defaultKind: 'key',
    validKinds: [],
    requires: 'ref',
    onlyWith: 'target',
    inKind: [ 'element', 'type', 'param' ],
  },
  foreignKeys: {                 // CSN v0.1.0 property -> use 'keys'
    vZeroFor: 'keys',
    inKind: [],
    dictionaryOf: definition,
    defaultKind: 'key',
    validKinds: [],
  },
  // kind and name: ----------------------------------------------------------
  kind: {
    type: validKind,
    inKind: (( kind, parentSpec ) => !inExtensions && parentSpec.validKinds.length),
  },
  annotate: {
    type: kindAndName,
    inKind: [ 'annotate' ],
  },
  extend: {
    type: kindAndName,
    inKind: [ 'extend' ],
  },
  as: {
    // remark: 'as' does not count as "relevant" property in standard check that
    // an object has >0 props, see const functionsOfIrrelevantProps.
    type: explicitName,
    inKind: [ '$column', 'key' ],
  },
  // type properties (except: elements, enum, keys, on): ---------------------
  type: {
    type: typeArtifactRef,
    msgVariant: 'or-object',    // for 'syntax-expecting-string',
    optional: [ 'ref' ],
    inKind: [ 'element', 'type', 'param', 'mixin', 'event', 'annotation', 'extend' ],
    schema: {
      ref: {
        arrayOf: typeRefItem,
        type: renameTo( 'path', typeRef ),
        minLength: 1,
        requires: 'id',
        optional: [ 'id' ],
        ignoreExtra: true, // custom properties inside `ref` ignored.
      },
    },
  },
  targetAspect: {
    type: artifactRef,
    xorException: inferredTargetEntityForAspect, // usually allows `target`
    msgVariant: 'or-object',    // for 'syntax-expecting-string',
    requires: 'elements',
    optional: [ 'elements' ], // 'elements' for ad-hoc aspect compositions
    inKind: [ 'element' ],
  },
  target: {
    type: artifactRef,
    xorException: inferredTargetEntityForAspect, // usually allows `targetAspect`
    msgVariant: 'or-object',    // for 'syntax-expecting-string',
    requires: 'elements',
    optional: [ 'elements' ], // 'elements' for ad-hoc COMPOSITION OF (gensrc style CSN)
    inKind: [ 'element', 'type', 'mixin', 'param' ],
  },
  cardinality: {                // there is an extra def for 'from'
    type: object,
    optional: [ 'src', 'min', 'max' ],
    inKind: [ 'element', 'type', 'mixin' ],
    onlyWith: [ 'target', 'targetAspect', 'where' ], // also in 'ref[]'
  },
  items: {
    type: object,
    optional: typeProperties, // TODO: think of items: {}, then requires: false
    inKind: [ 'element', 'type', 'param', 'annotation' ],
  },
  localized: {
    type: boolOrNull,
    inKind: [ 'element', 'type', 'param', 'annotation' ],
  },
  length: {
    type: natnum,
    inKind: [ 'element', 'type', 'param', 'annotation', 'extend' ],
    // we do not require a 'type', too - could be useful alone in a 'cast'
  },
  precision: {
    type: natnum,
    xorException: 'scale',      // see xorGroup :type
    inKind: [ 'element', 'type', 'param', 'annotation', 'extend' ],
  },
  scale: {
    type: scalenum,
    xorException: 'precision',  // see xorGroup :type
    inKind: [ 'element', 'type', 'param', 'annotation', 'extend' ],
  },
  srid: {
    type: natnum,
    inKind: [ 'element', 'type', 'param', 'annotation' ], // no 'extend'!
  },
  srcmin: {                        // in 'cardinality'
    type: renameTo( 'sourceMin', natnum ),
  },
  src: {                        // in 'cardinality'
    class: 'natnumOrStar',
    type: renameTo( 'sourceMax', natnumOrStar ),
  },
  min: {                        // in 'cardinality'
    type: renameTo( 'targetMin', natnum ),
  },
  max: {                        // in 'cardinality'
    class: 'natnumOrStar',
    type: renameTo( 'targetMax', natnumOrStar ),
  },
  sourceMax: {
    class: 'natnumOrStar',
    vZeroFor: 'src',
  },
  targetMin: {
    vZeroFor: 'min',
    type: natnum,
  },
  targetMax: {
    class: 'natnumOrStar',
    vZeroFor: 'max',
  },
  // expression properties (except: SELECT, SET): ----------------------------
  ref: {
    arrayOf: refItem,
    type: renameTo( 'path', arrayOf( refItem ) ),
    msgVariant: 'or-object',    // for 'syntax-expecting-string',
    minLength: 1,
    requires: 'id',
    optional: [
      'id', 'args', 'cardinality', 'where',
      // Support once we allow them in non-parse-only CDL.
      // 'groupBy', 'having', 'orderBy', 'limit',
    ],
    xorException: 'expand',     // see xorGroup :expr
    inKind: [ '$column', 'key' ],
  },
  id: {                         // in 'ref' item
    type: string,
  },
  param: {
    type: asScope,              // is bool, stored as string in XSN property 'scope'
    onlyWith: 'ref',
    inKind: [ '$column' ],
  },
  func: {
    type: func,
    xorException: 'xpr',       // see xorGroup :expr
    inKind: [ '$column' ],
  },
  args: {
    class: 'condition',
    type: args,
    schema: {                   // named arguments cannot directly have a string
      '-named': {               // '-named' and '-' must not exist top-level
        prop: 'args', dictionaryOf: expr, optional: exprProperties,
      },
    },
    onlyWith: [ 'func', 'id', 'op' ],
    inKind: [ '$column' ],
  },
  xpr: {
    class: 'condition',
    type: xpr,
    xorException: 'func',       // see xorGroup :expr
    // special treatment in $column
  },
  list: {
    class: 'condition',
    type: list,
    inKind: [ '$column' ],
  },
  val: {
    type: value,
    inKind: [ '$column', 'enum' ],
    xorException: '#',          // see xorGroup :expr
    // see also extra handling for 'element' in extension, see definition()
  },
  literal: {
    type: literal,
    onlyWith: 'val',
    inKind: [ '$column', 'enum' ], // 'element' sometimes in extension
  },
  '#': {
    noPrefix: true,             // schema spec for '#', not for '#whatever'
    type: symbol,
    // Note: We emit a warning if '#' is used in enums.  Because the compiler
    // can generate CSN like this, we need to be able to parse it.
    inKind: [ '$column', 'enum' ],
    xorException: 'val',        // see xorGroup :expr
    // see also extra handling for 'element' in extension, see definition()
  },
  path: {                     // in CSN v0.1.0 'foreignKeys'
    vZeroFor: 'ref',
    inKind: [],
    inValue: true,
    type: vZeroRef,
  },
  '=': {                        // v0.1.0 { "=": "A.B" } for v1.0 { "ref": ["A", "B"] }
    noPrefix: true,             // schema spec for '=', not for '=whatever'
    vZeroFor: 'ref',
    inKind: [],                 // still used in annotation assignments...
    type: vZeroRef,             // ...see property '@' / function annotation()
  },
  // primary query properties: -----------------------------------------------
  query: {
    type: embed,
    optional: [ 'SELECT', 'SET' ],
    inKind: [ 'entity', 'event' ],
  },
  projection: {
    type: queryTerm,
    xsnOp: 'SELECT',
    requires: 'from',
    optional: [
      'from', 'all', 'distinct', 'columns', 'excluding', // no 'mixin'
      'where', 'groupBy', 'having', 'orderBy', 'limit',
    ],
    inKind: [ 'entity', 'event', 'type' ],
  },
  SELECT: {
    type: queryTerm,
    xsnOp: 'SELECT',
    requires: 'from',
    optional: [
      'from', 'mixin', 'all', 'distinct', 'columns', 'excluding',
      'where', 'groupBy', 'having', 'orderBy', 'limit', 'elements',
    ],
    inKind: [ '$column' ],
    schema: {
      elements: {
        dictionaryOf: definition,
        type: ( ...a ) => {
          dictionaryOf( definition )( ...a );
        },                      // ignore, but test
        defaultKind: 'element',
        validKinds: [ 'element' ],
      },
    },
  },
  SET: {
    type: queryTerm,
    xsnOp: '$query',            // might be overwritten by 'op'
    requires: 'args',
    optional: [ 'op', 'all', 'distinct', 'args', 'orderBy', 'limit' ],
    schema: {
      args: {
        arrayOf: embed,         // like query
        type: queryArgs,
        minLength: 1,
        optional: [ 'SELECT', 'SET' ],
      },
    },
    inKind: [ '$column' ],
  },
  op: {                                   // used for UNION etc. in CSN v1.0
    vZeroFor: 'xpr',
    vZeroIgnore: 'call', // is also used in CSN v0.1.0 for "normal" expressions
    type: setOp,
    onlyWith: 'args',
  },
  join: {
    type: join,                 // string like 'cross' - TODO: test for valid ones?
  },
  from: {
    type: fromObject,
    optional: [ 'ref', 'join', 'cardinality', 'args', 'on', 'SELECT', 'SET', 'as' ],
    schema: {
      cardinality: {
        type: object,
        optional: [ 'srcmin', 'src', 'min', 'max' ],
        onlyWith: 'join',
      },
      args: {
        arrayOf: fromObject,
        minLength: 2,
        optional: [ 'ref', 'join', 'cardinality', 'args', 'on', 'SELECT', 'SET', 'as' ],
        onlyWith: 'join',
        schema: {},             // 'args' in 'args' in 'from' is same as 'args' in 'from'
      },
    },
  },
  some: { type: asQuantifier }, // probably just CSN v0.1.0
  any: { type: asQuantifier },  // probably just CSN v0.1.0
  distinct: { type: asQuantifier },
  all: { type: asQuantifier },
  // further query properties: -----------------------------------------------
  excluding: {
    inKind: [ '$column' ],
    arrayOf: string,
    type: excluding,
  },
  on: {
    class: 'condition',
    onlyWith: [ 'target', 'join' ],
    inKind: [ 'element', 'mixin' ],
  },
  onCond: {
    vZeroFor: 'on',
    inKind: [],
    type: renameTo( 'on', expr ),
    optional: exprProperties,
  },
  where: {
    class: 'condition',
  },
  groupBy: {
    arrayOf: expr, optional: exprProperties,
  },
  having: {
    class: 'condition',
  },
  orderBy: {
    arrayOf: expr, optional: [ 'sort', 'nulls', ...exprProperties ],
  },
  sort: {
    type: stringVal,
  },
  nulls: {
    type: stringVal,            // TODO: test for valid ones?
  },
  limit: {
    type: object, requires: 'rows', optional: [ 'rows', 'offset' ],
  },
  rows: {
    class: 'expression',
  },
  offset: {
    class: 'expression',
  },
  // miscellaneous properties in definitions: --------------------------------
  doc: {
    type: stringValOrNull,
    msgVariant: 'or-null',      // for 'syntax-expecting-string'
    inKind: () => true,         // allowed in all definitions (including columns and extensions)
  },
  '@': {                        // for all properties starting with '@'
    noPrefix: false,            // just '@' is no CSN property
    prop: '@‹anno›',            // which property name do messages use for annotation assignments?
    type: annotation,
    // allowed in all definitions except mixins (including columns and extensions)
    inKind: kind => (kind !== 'mixin'),
    schema: {
      '-expr': { // '-expr' and '-' must not exist top-level
        prop: '@‹anno›',
        type: object,
        optional: [
          '=', '#', 'xpr', 'ref', 'val', 'list',
          'literal', 'func', 'args', 'param',
          'cast',
        ],
        schema: {
          '=': {
            type: renameTo( '$tokenTexts', stringOrBool ),
            xorGroups: null, // reset xorGroup; allow '=' for all :expr
          },
        },
      },
    },
  },
  abstract: {                   // v1: with 'abstract', an entity becomes an aspect
    type: abstract,
    inKind: [ 'entity', 'aspect' ], // 'aspect' because 'entity' is replaced by 'aspect' early
  },
  key: {
    type: boolOrNull,
    inKind: [ 'element', '$column' ],
  },
  masked: {
    type: masked,
    inKind: [ 'element' ],
  },
  notNull: {
    type: boolOrNull,
    inKind: [ 'element', 'param', 'type' ], // TODO: $column  - or if so: in 'cast'?
  },
  virtual: {
    type: boolOrNull,
    inKind: [ 'element', '$column' ],
  },
  cast: {                    // SQL `cast` function
    // see `cast` sub schema inside `columns` for CDL-style type cast
    type: embed,
    // see also call of eventualCast() for every (expression) object
    inValue: false,             // should have no relevance
    optional: [ 'type', 'length', 'precision', 'scale', 'srid' ],
  },
  default: {
    class: 'expression',
    inKind: [ 'element', 'param', 'type' ],
  },
  includes: {
    arrayOf: stringRef,
    inKind: [ 'entity', 'type', 'aspect', 'event', 'extend' ],
  },
  returns: {
    type: returnsDefinition,
    defaultKind: 'param',
    validKinds: [ 'param' ],
    inKind: [ 'action', 'function', 'annotate' ],
  },
  technicalConfig: {            // treat it like external_property
    type: extra,
    inKind: [ 'entity' ],
  },
  $syntax: {
    type: dollarSyntax,
    ignore: true,
    inKind: [ 'entity', 'type', 'aspect' ],
  },
  origin: {                     // old-style CSN
    type: vZeroDelete, ignore: true,
  },
  source: {                     // CSN v0.1.0 query not supported (is error)
    type: ignore,
  },
  value: {
    class: 'expression',        // calculated elements
    vZeroFor: 'val',            // CSN v0.1.0 property for `val` in enum def
    // type: annoValue,
    inKind: [ 'element', 'enum' ], // TODO: Remove "enum" again; currently for extensions
    optional: exprProperties.concat([ 'stored' ]),
  },
  stored: {
    type: boolOrNull,
  },
  // ignored: ----------------------------------------------------------------
  $location: {                  // special
    ignore: true, type: ignore,
  },
  $generatedFieldName: {
    ignore: true, type: ignore, // TODO: do we need to do something?
  },
  namespace: {
    type: namespace,
  },
  meta: {                       // meta information
    type: ignore,               // TODO: should we test s/th here?
  },
  version: {                    // deprecated top-level property
    type: ignore,
  },
  messages: {                   // deprecated top-level property
    type: ignore,
  },
  options: {                    // deprecated top-level property
    type: ignore,
  },
  csnInteropEffective: {
    type: ignore,               // by https://github.com/SAP/csn-interop-specification
  },
  indexNo: {                    // CSN v0.1.0, but ignored without message
    ignore: true, type: ignore,
  },
  // TODO: should we keep $parens ?
  $generated: {
    type: string,
  },
  $: {
    noPrefix: false,            // just '$' is no CSN property
    type: ignore,
    ignore: true,
  }, // including $origin
  _: {
    noPrefix: false,            // just '_' is no CSN property
    type: ignore,
    ignore: true,
  },
} );

const topLevelSpec = {
  msgProp: '',                  // falsy '' for top-level
  type: object,
  optional: [
    'requires', 'definitions', 'vocabularies', 'extensions', 'i18n',
    'namespace', 'version', 'messages', 'meta', 'options', '@', '$location',
    'csnInteropEffective',
  ],
  requires: false,              // empty object OK
  schema,
};

// Module variables, schema compilation, and functors ------------------------

/** @type {(id, location, textOrArguments, texts?) => void} */
// eslint-disable-next-line no-unused-vars
let message = (_id, loc, textOrArguments, texts) => undefined;
/** @type {(id, location, textOrArguments, texts?) => void} */
// eslint-disable-next-line no-unused-vars
let error = (id, loc, textOrArguments, texts) => undefined;
/** @type {(id, location, textOrArguments, texts?) => void} */
// eslint-disable-next-line no-unused-vars
let warning = (id, loc, textOrArguments, texts) => undefined;
/** @type {(id, location, textOrArguments, texts?) => void} */
// eslint-disable-next-line no-unused-vars
let info = (id, loc, textOrArguments, texts) => undefined;

let csnVersionZero = false;
let csnFilename = '';
let virtualLine = 1;
/** @type {CSN.Location[]} */
let dollarLocations = [];
let arrayLevelCount = 0;

/**
 * @param {Object.<string, SchemaSpec>} specs
 * @param {object} [proto]
 * @returns {Object.<string, SchemaSpec>}
 */
function compileSchema( specs, proto = null ) {
  // no prototype to protect against evil-CSN properties 'toString' etc.
  const r = Object.assign( Object.create( proto ), specs );
  for (const p of Object.keys( specs )) {
    const s = r[p];
    if (s.class) {
      const scs = schemaClasses[s.class];
      for (const c of Object.keys( scs )) {
        if (s[c] == null)
          s[c] = scs[c];
      }
    }
    if (s.prop == null)
      s.prop = p;
    if (s.msgProp == null)
      s.msgProp = (s.arrayOf || s.dictionaryOf) ? `${ s.prop }[]` : s.prop;
    if (s.schema)
      s.schema = compileSchema( s.schema, r );
    if (!s.type) {
      if (s.arrayOf)
        s.type = arrayOf( s.arrayOf );
      else if (s.dictionaryOf)
        s.type = dictionaryOf( s.dictionaryOf );
      else
        throw new CompilerAssertion( `Missing type specification for property "${ p }"` );
    }

    if (s.xorGroups === undefined) {
      // Only set xorGroup once. Could already be set through shared sub-schema
      // of schemaClasses or be explicitly set.
      s.xorGroups = [];
      for (const group in xorGroups) {
        if (xorGroups[group].includes(p))
          s.xorGroups.push(group);
      }
    }
  }
  if (proto)
    return r;
  // Set property 'inValue' in main schema only:
  for (const prop of exprProperties) {
    if (r[prop].inValue === undefined)
      r[prop].inValue = true;
  }
  return r;
}

function renameTo( xsnProp, fn ) {
  return function renamed( val, spec, xsn, csn ) {
    const r = fn( val, spec, xsn, csn );
    if (r !== undefined)
      xsn[xsnProp] = r;
  };
}

function arrayOf( fn, filter = undefined ) {
  return function arrayMap( val, spec, xsn, csn ) {
    if (!isArray( val, spec ))
      return undefined;
    const r = val.map( (v) => {
      ++virtualLine;
      return fn( v, spec, xsn, csn ) || { location: location() };
    } );
    const minLength = spec.minLength || 0;
    if (minLength > val.length) {
      error( 'syntax-incomplete-array', location(true),
             { prop: spec.prop, n: minLength, '#': minLength === 1 ? 'one' : 'std' });
    }
    if (val.length)
      ++virtualLine;          // [] in one JSON line
    if (filter)
      return r.filter(filter);
    return r;
  };
}

// Generic functions, objects (std signature) --------------------------------

function ignore( obj ) {
  if (obj && typeof obj === 'object') {
    const array = (Array.isArray( obj )) ? obj : Object.values( obj );
    if (!array.length)
      return;                   // {}, [] in one JSON line
    virtualLine += 1 + array.length;
    array.forEach( ignore );
  }
}

function embed( obj, spec, xsn ) {
  Object.assign( xsn, object( obj, spec ) ); // TODO: $location?
}

function extra( node, spec, xsn ) {
  if (!xsn.$extra)
    xsn.$extra = Object.create(null);
  xsn.$extra[spec.prop] = node;
  return ignore( node );
}

function eventualCast( obj, spec, xsn ) {
  if (!obj.cast || spec.optional && !spec.optional.includes('cast'))
    return xsn;
  xsn.op = { val: 'cast', location: xsn.location };
  const r = { location: xsn.location };
  xsn.args = [ r ];
  return r;
}

function object( obj, spec ) {
  if (!isObject( obj, spec ))
    return undefined;
  pushLocation( obj );
  const r = { location: location() };
  const xor = {};
  const csnProps = Object.keys( obj );
  const o = eventualCast( obj, spec, r ); // do s/th special for CAST
  let relevantProps = 0;
  if (csnProps.length) {
    ++virtualLine;
    const expected = (p => spec.optional.includes(p));
    for (const p of csnProps) {
      const s = getSpec( spec, obj, p, xor, expected );
      // TODO: count illegal properties with Error msg as relevant to avoid 2nd error
      if (!functionsOfIrrelevantProps.includes( s.type ))
        ++relevantProps;
      const v = (s.inValue) ? o : r;
      const val = s.type( obj[p], s, v, obj, p );
      if (val !== undefined)
        v[p] = val;
      ++virtualLine;
    }
  }
  const { requires } = spec;
  if (requires === undefined || requires === true) {
    // console.log(csnProps,JSON.stringify(spec))
    if (!relevantProps) {
      error( 'syntax-incomplete-object', location(true),
             { '#': (obj.as != null ? 'as' : 'std'), prop: spec.msgProp, otherprop: 'as' } );
    }
  }
  else if (requires) {
    // console.log(csnProps,JSON.stringify(spec))
    onlyWith( spec, requires, obj, null, xor, () => true );
  }
  popLocation( obj );
  return r;
}

function vZeroDelete( o, spec ) { // for old-CSN property 'origin'
  if (!csnVersionZero) {
    message( 'syntax-deprecated-property', location(true),
             { '#': 'zero', prop: spec.msgProp } );
  }
  ignore( o );
}

// Definitions, dictionaries and arrays of definitions (std signature) -------

function definition( def, spec, xsn, csn, name ) {
  if (!isObject( def, spec )) {
    return {
      kind: (inExtensions ? 'annotate' : spec.defaultKind),
      name: { id: '', location: location() },
      location: location(),
    };
  }
  pushLocation( def );
  const savedInExtensions = inExtensions;
  let kind = calculateKind( def, spec ); // might set inExtensions
  const r = (kind === '$column') ? { location: location() } : { location: location(), kind };
  const xor = {};
  const { prop } = spec;
  const kind0 = (spec.validKinds.length || spec.prop === 'extensions') && kind;
  const csnProps = Object.keys( def );

  // For compatibility, extension property `elements` could actually be an `enum`:
  if (savedInExtensions === '' && prop === 'elements' && // in extend property `elements`
      !Object.keys( def ).some( couldNotBeEnumProperty )) {
    r.$syntax = 'enum';         // could be an enum
    if (def.val !== undefined || def['#'] !== undefined)
      kind = 'enum';            // for function expected(), i.e. allow property `val`/`#`
  }

  if (csnProps.length) {
    const valueName = (prop === 'keys' || prop === 'foreignKeys' ? 'targetElement' : 'value');
    // the next is basically object() + the inValue handling
    ++virtualLine;
    for (const p of csnProps) {
      const s = getSpec( spec, def, p, xor, expected, kind0 );
      const v = !s.inValue && r || r[valueName] || (r[valueName] = { location: location() });
      const val = s.type( def[p], s, v, def, p );
      if (val !== undefined)
        v[p] = val;
      ++virtualLine;
    }
  }
  if (!r.name && name != null) {
    r.name = { id: name, location: r.location };
    if (prop === 'columns' || prop === 'keys' || prop === 'foreignKeys')
      r.name.$inferred = 'as';
  }
  if (spec.requires)
    onlyWith( spec, spec.requires, def, null, xor, () => true );

  inExtensions = savedInExtensions;
  popLocation( def );
  if (kind !== 'annotation' || prop === 'vocabularies')
    return r;
  if (!vocabInDefinitions) {
    vocabInDefinitions = Object.create(null);
    vocabInDefinitions[$location] = location();
  }
  vocabInDefinitions[name] = r;     // deprecated: anno def in 'definitions'
  return undefined;

  function expected( p, s ) {
    if (!Array.isArray(s.inKind))
      return s.inKind && s.inKind( kind, spec );
    return s.inKind.includes( kind ) &&
      // for an 'annotate', both 'annotate' and the "host" kind must be expected
      (!inExtensions || s.inKind.includes( inExtensions ) ||
       // extending elements in returns can be without 'returns' in CSN
       // see function elementsDict() for detail, TODO: remove finally
       inExtensions === 'action' && p === 'elements');
  }
}

function namespace( ref, spec ) {
  const ns = stringRef(ref, spec);
  return ns ? { kind: 'namespace', name: ns } : null;
}

function couldNotBeEnumProperty( prop ) {
  // returns true for `value` (which we allow with warning when extending an enum with `elements`)
  const inKind = schema[prop]?.inKind; // undefined for annotations, $location, …
  // inKind for annotation assignments is function -> can be for enum
  return Array.isArray( inKind ) && inKind.includes( 'element' );
}

function actions( def, spec, xsn, csn, name ) {
  if (def.kind === 'extend' && (def.elements || def.enum)) {
    // TODO: Handle this case in extend.js; already done for `returns`
    //       See message ext-expecting-returns
    error( 'syntax-unexpected-property', location(true), {
      '#': def.kind,
      prop: def.enum ? 'enum' : 'elements',
      parentprop: spec.msgProp,
      kind: def.kind,
    } );
  }
  return definition( def, spec, xsn, csn, name );
}

// A dictionary is expected. Uses spec.dictionaryOf. If unset, default is "definition".
function dictionaryOf( elementFct ) {
  return function dictionary( dict, spec ) {
    if (!dict || typeof dict !== 'object' || Array.isArray( dict )) {
      error( 'syntax-expecting-object', location(true),
             { prop: spec.prop }); // spec.prop, not spec.msgProp!
      return ignore( dict );
    }
    const r = Object.create(null);
    r[$location] = location();
    const allNames = Object.keys( dict );
    if (!allNames.length)
      return r;                   // {} in one JSON line
    ++virtualLine;
    for (const name of allNames) {
      if (!name) {
        message( 'syntax-invalid-name', location(true),
                 { '#': 'dict', parentprop: spec.prop } );
      }
      const val = elementFct( dict[name], spec, r, dict, name );
      if (val !== undefined)
        r[name] = val;
      ++virtualLine;
    }
    return r;
  };
}

function keys( array, spec, xsn ) {
  if (!isArray( array, spec ))
    return;
  const r = Object.create(null);
  r[$location] = location();
  if (array.length)
    ++virtualLine; // possibly empty array
  for (const def of array) {
    const id = def.as || implicitName( def.ref );
    const name = (typeof id === 'string') ? id : '';
    // definer will complain about repeated names
    dictAdd( r, name, definition( def, spec, r, array, name ) );
    ++virtualLine;
  }
  xsn.foreignKeys = r;
}

// Use with spec.msgVariant: 'or-asterisk'
function selectItem( def, spec, xsn, csn ) {
  if (def === '*')              // compile() will complain about repeated '*'s
    return { val: '*', location: location() };

  return definition( def, spec, xsn, csn, null ); // definer sets name
}

function returnsDefinition( def, spec, xsn, csn ) {
  return definition( def, spec, xsn, csn, '' );
}

// Temporary function as long as the message below is not a hard error
function elementsDict( def, spec, xsn ) {
  const elements = dictionaryOf( definition )( def, spec );
  if (inExtensions !== 'action')
    return elements;
  warning( 'syntax-expecting-returns', elements[$location],
           { prop: 'elements', parentprop: 'returns' },
           // eslint-disable-next-line @stylistic/js/max-len
           'Expecting property $(PROP) to be put into an object for property $(PARENTPROP) when annotating action return structures' );
  xsn.returns = { kind: 'annotate', elements, location: elements[$location] };
  return undefined;
}

function enumDict( def, spec, xsn ) {
  const dict = dictionaryOf( definition )( def, spec );
  if (!inExtensions)
    return dict;
  xsn.elements = dict;          // normalize to `elements` for `annotate`
  return undefined;
}

// For v1 CSNs with annotation definitions
function attachVocabInDefinitions( csn ) {
  if (!csn.vocabularies) {
    csn.vocabularies = vocabInDefinitions;
  }
  else {
    for (const name in vocabInDefinitions)
      dictAdd( csn.vocabularies, name, vocabInDefinitions[name] );
  }
}

// Kind, names and references (std signature) --------------------------------

function kindAndName( id, spec, xsn ) {
  const { prop } = spec;
  xsn.kind = prop;              // TODO: set this in definition
  if (!string( id, spec ))
    return;
  xsn.name = { path: [ { id, location: location() } ], location: location() };
}

function explicitName( id, spec, xsn ) {
  if (string( id, spec ))
    xsn.name = { id, location: location() };
}

function abstract( val, spec, xsn, csn ) {
  const strange = csn.kind !== 'entity';
  if (strange || !csnVersionZero) {
    warning( 'syntax-deprecated-abstract', location(true),
             { '#': strange ? 'strange-kind' : 'std', prop: 'abstract', kind: 'entity' } );
  }
  boolOrNull( val, spec );
}

function dollarSyntax( val, spec, xsn, csn ) {
  if (csn.kind === 'type' && val === 'aspect') {
    warning( 'syntax-deprecated-dollar-syntax', location(true),
             { '#': 'aspect', prop: '$syntax', kind: 'aspect' } );
    return ignore( val );
  }
  else if (xsn.kind === 'entity') {
    if (val === 'projection') {
      warning( 'syntax-deprecated-dollar-syntax', location(true),
               {
                 '#': 'projection',
                 prop: '$syntax',
                 siblingprop: 'projection',
                 otherprop: 'query',
               } );
      return string( val, spec );
    }
    if (val === 'entity' || val === 'view')
      return string( val, spec );
  }
  warning( 'syntax-deprecated-dollar-syntax', location(true), { prop: '$syntax' } );
  return ignore( val );
}

function validKind( val, spec, xsn ) {
  if (val === xsn.kind)         // has been set in definition - the same = ok!
    return undefined;           // already set in definition
  if (val === 'view' && xsn.kind === 'entity') {
    warning( 'syntax-deprecated-kind', location(true),
             { prop: spec.msgProp, value: 'entity' },
             'Replace value in $(PROP) by $(VALUE)' );
  }
  else if (val !== 'entity' && val !== 'type' || xsn.kind !== 'aspect') {
    error( 'syntax-invalid-kind', location(true), { prop: spec.msgProp },
           'Invalid value for property $(PROP)' );
  }
  return ignore( val );
}

function typeArtifactRef( ref, spec ) {
  if (ref && typeof ref === 'object' && !Array.isArray( ref )) {
    if (ref.ref?.length === 1)
      return artifactRef( ref, { ...spec, ignoreExtra: true } );
  }
  return artifactRef( ref, spec );
}

function fromObject( ref, spec ) {
  const r = object( ref, spec );
  if (r?.path?.length > 1)
    r.scope = 1; // `type`/`from` ref in CSN: elements start after definitions name
  return r;
}

// Use with spec.msgVariant: 'or-object'
function artifactRef( ref, spec ) {
  if (!ref || typeof ref !== 'string') {
    if (!ref || typeof ref !== 'object' || Array.isArray( ref ))
      return string( ref, spec );
    // use error message 'syntax-expecting-string' (string more likely than object):
    return (!ref || typeof ref !== 'object' || Array.isArray( ref ))
      ? string( ref, spec )
      : fromObject( ref, spec );
  }
  if (spec.prop !== 'type')
    return stringRef( ref, spec );
  // now the CSN v0.1.0 type of: 'Artifact..e1.e2'; error if not csnVersionZero
  const idx = ref.indexOf('..');
  if (idx < 0)
    return stringRef( ref, spec );
  if (!csnVersionZero) {
    message( 'syntax-deprecated-value', location(true),
             { '#': 'zero-replace', prop: spec.msgProp, value: '{ ref: […] }' } );
  }
  const r = refSplit( ref.substring( idx + 2 ), 'type' );
  r.path.unshift( { id: ref.substring( 0, idx ), location: location() } );
  r.scope = 1;
  return r;
}

function stringRef( ref, spec ) {
  return string( ref, spec ) &&
    { path: [ { id: ref, location: location() } ], location: location() };
}

// with spec.msgVariant: 'or-object'
function refItem( item, spec ) {
  if (typeof item === 'string' && item)
    return { id: item, location: location() };
  if (item && typeof item === 'object' && !Array.isArray( item ))
    return object( item, spec );
  // use error message 'syntax-expecting-string' (string more likely than object):
  return string( item, spec );
}

function asScope( scope, spec, xsn ) {
  if (scope)
    xsn.scope = spec.prop;
  boolOrNull( scope, spec );
}

function vZeroRef( name, spec, xsn ) {
  if (!string( name, spec ))
    return;
  const path = name.split('.');
  if (!path.every( id => id)) { // TODO: why just warning?
    warning( 'syntax-invalid-zero-ref', location(true), { prop: spec.msgProp },
             'Invalid string reference in property $(PROP)' );
  }
  xsn.path = path.map( id => ({ id, location: location() }) );
}

// Specific values and annotations (std signature) ---------------------------

function boolOrNull( val, spec ) {
  if ([ true, false, null ].includes( val ))
    return { val, location: location() };
  warning( 'syntax-expecting-boolean', location(true), { prop: spec.msgProp },
           'Expecting boolean or null for property $(PROP)' );
  ignore( val );
  return { val: !!val, location: location() };
}

function string( val, spec ) {
  if (typeof val === 'string' && val)
    return val;
  error( 'syntax-expecting-string', location(true),
         { '#': spec.msgVariant, prop: spec.msgProp } );
  return ignore( val );
}

function stringOrBool( val, spec ) {
  if (typeof val === 'string' && val || typeof val === 'boolean')
    return val;
  error( 'syntax-expecting-string', location(true),
         { '#': spec.msgVariant || 'or-bool', prop: spec.msgProp } );
  return ignore( val );
}

function stringVal( val, spec ) {
  if (typeof val === 'string' && val)
    //  XSN TODO: do not require literal
    return { val, literal: 'string', location: location() };
  error( 'syntax-expecting-string', location(true), { prop: spec.msgProp },
         'Expecting non-empty string for property $(PROP)' );
  return ignore( val );
}

function stringValOrNull( val, spec ) {
  if (val === null)
    return { val, location: location() };

  return stringVal(val, spec);
}

function scalenum( val, spec ) {
  if ([ 'floating', 'variable' ].includes(val))
    return { val, literal: 'string', location: location() }; // XSN TODO: remove `literal`
  return natnum(val, spec );
}

function natnum( val, spec ) {
  if (typeof val === 'number' && val >= 0 && Number.isSafeInteger( val ))
    return { val, location: location() };
  const loc = location(true);
  error( 'syntax-expecting-unsigned-int', loc,
         { '#': spec.msgVariant || 'csn', prop: spec.msgProp, op: '*' } );
  return ignore( val );
}

// Use with spec.msgVariant !
function natnumOrStar( val, spec ) {
  return (val === '*')
    ? { val, location: location() }
    : natnum( val, spec );
}

function symbol( id, spec, xsn ) { // for CSN property '#'
  if (!string( id, spec ))
    return;
  xsn.literal = 'enum';         // CSN cannot have both '#' and 'literal'
  xsn.sym = { id, location: location() };
}

/**
 * Wrapper around the default `ref` spec: Don't allow references of length 1 for types.
 */
function typeRef( val, spec, xsn, csn ) {
  // e.g. { ref: [ 'T' ] }
  if (Array.isArray(val) && val.length <= 1)
    warning( 'syntax-deprecated-type-ref', location(true), { '#': 'std', prop: 'type' });

  return arrayOf(spec.arrayOf)(val, spec, xsn, csn);
}

/**
 * Similar to refItem(), but warns that the item should be a string if `id` is the only CSN
 * property inside the ref-item.
 */
function typeRefItem( val, spec, xsn, csn ) {
  // e.g. [ 'T', { id: 'elem', other_prop: true } ]
  // avoid duplicate messages for single-item reference, see typeRef()
  if (val && csn.ref?.length > 1 && typeof val === 'object' && val.id) {
    const ownKeysCount = Object.keys(val).filter(key => ourpropsRegex.test(key)).length;
    if (ownKeysCount === 1)
      warning('syntax-deprecated-type-ref', location(true), { '#': 'ref-item', prop: 'ref[]' });
  }
  return refItem(val, spec);
}

/**
 * returns:
 *  - false = no "...",
 *  - true = "..." without UP TO,
 *  - 'upTo' = "..." with UP TO
 *
 * @returns {string|boolean}
 */
function isEllipsis( val ) {
  return val && typeof val === 'object' && '...' in val && Object.keys(val).length === 1 &&
    (val['...'] === true || 'upTo');
}

function annoValue( val, spec ) {
  if (val == null)              // TODO: reject undefined
    return { val, literal: 'null', location: location() };
  const lit = typeof val;
  if (lit !== 'object')
    return { val, literal: lit, location: location() };
  if (Array.isArray( val )) {
    /** @type {string|boolean} */
    let seenEllipsis = false;
    if (arrayLevelCount > 0) {  // TODO: also inside structure (possible in CSN!)
      if (val.some( isEllipsis )) { // remark: check is via parsing rules in CDL
        error( 'syntax-unexpected-ellipsis', location(true),
               { '#': 'csn-nested', prop: '...' } );
      }
    }
    else {
      for (const item of val) {
        if (seenEllipsis !== true) { // no `...` yet, or only `... up to`
          seenEllipsis = isEllipsis( item ) || seenEllipsis;
        }
        else if (isEllipsis( item )) { // `...`with or without UP TO
          error( 'syntax-unexpected-ellipsis', location(true),
                 { '#': 'csn-duplicate', prop: '...', code: '{ "...": true }' } );
          break;
        }
      }
    }
    arrayLevelCount++;
    const retval = {
      location: location(),
      val: arrayOf( annoValue )( val, spec ),
      literal: 'array',
    };
    arrayLevelCount--;
    if (seenEllipsis === 'upTo') {
      error( 'syntax-missing-ellipsis', location(true), // at closing bracket
             { code: '{ "...": ‹up to value› }', newcode: '{ "...": true }' } );
    }
    return retval;
  }
  else if (typeof val['='] === 'string' || val['='] === true) {
    // An object with `=` is an expression if and only if:
    //  - there is exactly one property ('=')
    //  - there is at least one other expression property (e.g. "xpr")
    const valKeys = Object.keys( val );
    if (valKeys.length === 1 && typeof val['='] === 'string') {
      ++virtualLine;
      const r = refSplit( val['='], '=' ); // i.e. no extra `variant` stuff
      ++virtualLine;
      return r;
    }
    else if (isAnnotationExpression( val )) {
      const s = schema['@'].schema['-expr'];
      const r = { location: location() };
      Object.assign( r, object( val, s ) );
      return r;
    }
    // fallthrough -> unchecked structure
  }
  if (typeof val['#'] === 'string') {
    if (Object.keys( val ).length === 1) {
      ++virtualLine;
      const xsn = { location: location() };
      symbol( val['#'], schema['#'], xsn );
      ++virtualLine;
      return xsn;
    }
  }
  else if (val['...'] !== undefined && Object.keys( val ).length === 1) {
    // TODO: only if not nested - see error above
    ++virtualLine;
    const ell = val['...'];
    const r = {
      val: '...',
      literal: 'token',
      location: location(),
    };
    if (ell !== true)
      r.upTo = annoValue( ell, schema['@'] );
    ++virtualLine;
    return r;
  }
  const r = { struct: Object.create(null), literal: 'struct', location: location() };
  ++virtualLine;
  for (const name of Object.keys( val )) {
    r.struct[name] = annotation( val[name], schema['@'], null, val, name );
    ++virtualLine;
  }
  return r;
}

function annotation( val, spec, xsn, csn, name ) {
  // not used for the value
  const id = (xsn ? name.substring(1) : name);
  if (!id)              // `"@": …` is already syntax-unknown-property
    message( 'syntax-invalid-name', location(true), { '#': '{}' } );

  const n = { id, location: location() };
  const r = annoValue( val, spec );
  r.name = n;
  return r;
}

// Expressions, conditions (std signature) -----------------------------------

function value( val, spec, xsn, csn ) { // for CSN property 'val'
  if (val && typeof val === 'object') {
    error( 'syntax-expecting-scalar', location(true), { prop: spec.msgProp },
           'Expecting scalar values for property $(PROP)' );
    return ignore( val );
  }
  if (!xsn.literal) // might be overwritten; only set if literal type is valid
    xsn.literal = (val === null) ? 'null' : typeof val;

  const valType = (val == null) ? val === null && 'null' : typeof val;
  const pattern = typeof csn.literal === 'string' && quotedLiteralPatterns[csn.literal];
  if (pattern && valType &&
      (valType === pattern.json_type || valType === pattern.secondary_json_type)) {
    if (pattern.test_fn && !pattern.test_fn( val )) {
      warning( 'syntax-invalid-literal', location(),
               { '#': pattern.test_variant, prop: spec.msgProp } );
    }
    if (pattern.unexpected_char && pattern.unexpected_char.test( val ))
      warning( 'syntax-invalid-literal', location(), { '#': pattern.unexpected_variant } );
  }
  return val;
}

function literal( lit, spec, xsn, csn ) {
  if (!string( lit, spec ))
    return undefined;
  const valType = (csn.val == null) ? csn.val === null && 'null' : typeof csn.val;
  const pattern = quotedLiteralPatterns[lit];
  if (!pattern) {
    error( 'syntax-invalid-string', location(true), { prop: spec.msgProp } );
  }
  else if (valType &&
           valType !== pattern.json_type && valType !== pattern.secondary_json_type) {
    warning( 'syntax-invalid-literal', location(), {
      // 'literal' value can be different to 'string' with JSON string type:
      '#': (valType === 'string') ? 'typeof' : 'expecting',
      otherprop: 'val',
      rawvalue: lit,
      op: valType,
    } );
  }
  else {
    return lit;
  }
  return ignore( lit );
}

function func( val, spec, xsn ) {
  if (!string( val, spec ))
    return undefined;
  xsn.op = { val: 'call', location: location() };
  return { path: [ { id: val, location: location() } ], location: location() };
}

function xpr( exprs, spec, xsn, csn ) {
  if (csn.func) {
    if (!exprs.length) {
      error( 'syntax-incomplete-array', location(true),
             { prop: 'xpr', siblingprop: 'func', '#': 'suffix' });
    }
    xsn.suffix = exprArgs( exprs, spec );
    if (exprs.length > 2)
      xsn.suffix = xsnAsTree( exprs, xsn.suffix, xsn.op.location ).args;
    else if (exprs.length === 2 && exprs[0] === 'over' && exprs[1]?.xpr && !exprs[1].func)
      xsn.suffix[1].args = splitClauses( xsn.suffix[1].args );
  }
  else {
    // setting $parens here would not always be correct; thus, keep distinction
    // between 'xpr' and 'ixpr' (”internal” `xpr` = without implicit parens)
    xsn.op = { val: 'xpr', location: location() };
    xsn.args = exprArgs( exprs, spec );
    if (exprs.length > 2)
      xsn.args = xsnAsTree( exprs, xsn.args, xsn.op.location ).args;
  }
}

function list( exprs, spec, xsn ) {
  xsn.op = { val: 'list', location: location() };
  xsn.args = arrayOf( exprOrString )( exprs, spec );
}

function xprInValue( exprs, spec, xsn, csn ) {
  // if the top-level xpr is just for a cast:
  if (exprs.length === 1 && exprs[0].cast) {
    const x = {};
    xpr( exprs, spec, x, csn );
    Object.assign( xsn, x.args[0] );
  }
  else {
    xpr( exprs, spec, xsn, csn );
  }
}

function args( exprs, spec ) {
  if (Array.isArray( exprs )) {
    const xsn = arrayOf( exprOrString )( exprs, spec );
    if (xsn.length) {
      const last = xsn.at( -1 );
      if (last?.op?.val === 'xpr' && last.args.length > 4) // `order by` in last arg?
        last.args = splitClauses( last.args );
    }
    return xsn;
  }
  else if (!exprs || typeof exprs !== 'object') {
    error( 'syntax-expecting-args', location(true),
           { prop: spec.prop }, // spec.prop, not spec.msgProp!
           'Expecting array or object for property $(PROP)' );
    return ignore( exprs );
  }
  const r = Object.create(null);
  ++virtualLine;
  const s = spec.schema['-named'];
  for (const id of Object.keys( exprs )) {
    const a = expr( exprs[id], s );
    if (a) {
      a.name = { id, location: a.location };
      r[id] = a;
    }
    ++virtualLine;
  }
  return r;
}

function expr( e, spec ) {
  if (Array.isArray( e )) {
    if (e.length > 1) {         // struct-xpr
      const loc = location();
      const xsn = exprArgs( e, spec );
      return (e.length < 3)     // optimization
        ? { op: { val: 'ixpr', location: loc }, args: xsn, location: loc }
        : xsnAsTree( e, xsn, loc );
    }
    else if (e.length === 1) { // CSN v.0.1.0 way for parentheses
      const loc = location();
      if (e[0] && !e[0].op)       // do not complain with 'op' (for which we complain)
        replaceZeroValue( spec, 'zero-parens' );
      ++virtualLine;
      const r = expr( e[0], spec );
      if (!r)
        return r;
      if (r.$parens)
        r.$parens.push( loc );
      else
        r.$parens = [ loc ];
      ++virtualLine;
      return r;
    }
  }
  else if (e === null || [ 'string', 'number', 'boolean' ].includes( typeof e )) {
    //  && spec.optional.includes( 'val' )) ?
    replaceZeroValue( spec, 'zero-replace', '{ val: ‹value› }' );
    return annoValue( e, spec );
  }
  return object( e, spec );
}

// with spec.msgVariant: 'or-string'
function exprOrString( val, spec ) {
  return (typeof val === 'string' && !csnVersionZero)
    ? { val, literal: 'token', location: location() }
    : expr( val, spec );
}

// mark path argument of 'exists' predicate with $expected:'exists'
function exprArgs( cond, spec ) {
  const rxsn = arrayOf( exprOrString )( cond, spec );
  // TODO: do that in definer.js, neither here nor in CDL parser
  if (Array.isArray( rxsn )) {
    for (let i = 0; i < rxsn.length - 1; i++) {
      // TODO: disallow param ref - write test
      if (cond[i] === 'exists' && rxsn[i + 1].path)
        rxsn[++i].$expected = 'exists';
    }
  }
  return rxsn;
}

function condition( cond, spec ) {
  const loc = location();
  const xsn = exprArgs( cond, spec );
  // TODO sql-like backends: with the commented `return`, test3 generated sql
  // files will not have the unnecessary `(…)` around `on` anymore → extra PR
  const tree = (cond.length < 3) ? xsn : xsnAsTree( cond, xsn, loc ).args;
  return { op: { val: 'xpr', location: loc }, args: tree, location: loc };
  // return (cond.length < 3)      // optimization
  //   ? { op: { val: 'ixpr', location: loc }, args: xsn, location: loc }
  //   : xsnAsTree( cond, xsn, loc );
}

// Queries (std signature) ---------------------------------------------------

function queryTerm( term, spec, xsn ) { // for CSN properties 'SELECT' and 'SET'
  // TODO: re-check $location: pushLocation( term ) / popLocation( term )
  xsn.query = object( term, spec );
  if (!xsn.query)
    return;
  // XSN TODO: remove op query and subquery?
  if (!xsn.query.op) {
    xsn.query.op = {
      val: (spec.prop !== 'SET' ? 'SELECT' : '$query'),
      location: location(),     // XSN TODO: work without location everywhere
    };
  }
  if (spec.prop !== 'SET' && !xsn.query.from)
    xsn.query.from = null;      // make it clear that SELECT is used with parse error
  if (spec.prop === 'projection')
    xsn.$syntax = 'projection';
}

function asQuantifier( quantifier, spec, xsn ) {
  if (quantifier)
    xsn.quantifier = { val: spec.prop, location: location() };
  boolOrNull( quantifier, spec );
}

function excluding( array, spec, xsn ) {
  if (!isArray( array, spec ))
    return;
  const r = Object.create(null);
  r[$location] = location();
  if (array.length)
    ++virtualLine; // possibly empty array
  for (const ex of array) {
    const id = string( ex, spec ) || '';
    dictAdd( r, id, { name: { id, location: location() }, location: location() },
             duplicateExcluding );
    ++virtualLine;
  }
  xsn.excludingDict = r;
}

function duplicateExcluding( name, loc ) {
  error( 'syntax-duplicate-excluding', loc, { '#': 'csn', name, prop: 'excluding[]' } );
}

function masked( val, spec ) {
  message( 'syntax-unsupported-masked', location(), { '#': 'csn', prop: 'masked' } );
  return boolOrNull( val, spec );
}

function setOp( val, spec ) { // UNION, ...
  // similar to string(), but without literal
  return string( val, spec ) && { val, location: location() };
}

function join( val, spec, xsn ) {
  if (!string( val, spec ))
    return undefined;
  const loc = location();
  xsn.op = { val: 'join', location: loc };
  return { val, location: loc };
}

function queryArgs( val, spec, xsn, csn ) {
  if (Array.isArray( val ) && val.length > 1 && !csn.op) {
    // Make it error 'syntax-missing-property#sibling' in v6:
    message( 'syntax-deprecated-auto-union', location(true),
             { siblingprop: 'args', prop: 'op' },
             'Object with property $(SIBLINGPROP) must also have a property $(PROP)' );
    xsn.op = { val: 'union', location: location() };
  }
  return arrayOf( object )( val, spec ).map( q => q.query );
}

// i18n ------------------------------

function i18nLang( val, spec, xsn, csn, langKey ) {
  /** @type {SchemaSpec} */
  const keySpec = { dictionaryOf: translations, prop: langKey };
  return dictionaryOf( translations )( val, keySpec );
}

function translations( keyVal, spec, xsn, csn, textKey ) {
  if (typeof keyVal === 'string') // allow empty string
    return { val: keyVal, literal: 'string', location: location() };
  error( 'syntax-expecting-translation', location(true),
         { prop: textKey, language: spec.prop },
         'Expecting string for text key $(PROP) of language $(LANGUAGE)' );
  return ignore( keyVal );
}

// Helper functions for objects and definitions ------------------------------

function getSpec( parentSpec, csn, prop, xor, expected, kind ) {
  const p0 = schema[prop] ? prop : prop.charAt(0);
  const s = (parentSpec.schema || schema)[p0];
  if (!s || s.noPrefix === (prop !== p0) ) {
    if (prop && !ourpropsRegex.test( prop )) {
      if (parentSpec.ignoreExtra)
        return { prop, type: ignore };
      return { prop, type: extra };
    }
    // TODO v6: No warning with --sloppy (does not exist, yet)
    //          Intention: Ignore unknown properties.
    warning( 'syntax-unknown-property', location(true), { prop },
             'Unknown CSN property $(PROP)' );
    return { type: ignore };
  }
  else if (!expected( p0, s )) {
    if (s.ignore)
      return { type: ignore };
    if (s.vZeroIgnore && s.vZeroIgnore === csn[prop]) { // for "op": "call"
      message( 'syntax-deprecated-property', location(true), { '#': 'zero', prop } );
      return { type: ignore };
    }
    const zero = s.vZeroFor;
    if (zero) {                 // (potential) CSN v0.1.0 property
      const groups = s.xorGroups;
      if (expected( zero, schema[zero] ) && !(groups.length && groups.every(group => xor[group]))) {
        replaceZeroProp( prop, zero );
        for (const group of groups)
          xor[group] = prop;
        onlyWith( s, s.onlyWith, csn, prop, xor, expected );
        return s;
      }
    }
    // eslint-disable-next-line no-nested-ternary
    const variant = kind && s.inKind
      ? ([ 'extend', 'annotate' ].includes(kind) ? kind : 'kind')
      : (parentSpec.msgProp ? 'prop' : 'top');
    error( 'syntax-unexpected-property', location(true),
           {
             '#': variant,
             prop,
             parentprop: parentSpec.msgProp,
             kind,
           } );
  }
  else if (checkAndSetXorGroup( s.xorGroups, s.xorException, prop, xor, csn )) {
    // TODO: If all targets of onlyWith are xor-excluded/ignore, also exclude/ignore this one.
    onlyWith( s, s.onlyWith, csn, prop, xor, expected );
    return s;
  }
  // else ignore
  return { type: ignore };
}

function calculateKind( def, spec ) {
  if (inExtensions) {
    inExtensions = spec.defaultKind;
    return 'annotate';
  }
  if (spec.prop === 'extensions') {
    inExtensions = (def.extend) ? '' : 'annotate';
    return (def.extend) ? 'extend' : 'annotate';
  }
  const kind = (def.kind === 'view') ? 'entity' : def.kind; // 'view' is CSN v0.1.0
  if (kind === 'extend' && inExtensions === '') // valid extend -> keep inExtensions
    return 'extend';
  inExtensions = null;
  if (!spec.validKinds.includes( kind ))
    return spec.defaultKind;
  return (def.abstract || def.$syntax === 'aspect')
    ? 'aspect'           // deprecated abstract entity or kind:type for aspects
    : kind;
}

function requiresOnWithBothTargetProps( csn ) {
  if (!csn.on && csn.target && csn.targetAspect &&
      inferredTargetEntityForAspect( 'target', 'targetAspect', csn )) {
    error( 'syntax-missing-property', location(true), {
      '#': 'bothTargets',
      siblingprop: 'targetAspect',
      otherprop: 'target',
      prop: 'on',
    } );
  }
}

function onlyWith( spec, need, csn, prop, xor, expected ) {
  if (!need)
    return spec;
  if (typeof need === 'object' && !Array.isArray( need )) {
    need = need[csn.kind];
    if (!need)
      return spec;
  }
  if (typeof need === 'string') {
    if (need in csn)            // TODO: enumerable ?
      return spec;
  }
  else if (typeof need === 'function') {
    need( csn, prop );
    return spec;
  }
  else if (need.some( n => n in csn )) {
    return spec;
  }
  else {
    const allowed = need.filter( p => expected( p, spec ));
    // There should be at least one elem, otherwise the spec is wrong;
    // first try to find element which is not excluded
    need = allowed.find( p => !schema[p].xorGroups?.some(g => xor[g]) ) || allowed[0];
  }
  if (prop) {
    error( 'syntax-missing-property', location(true), // location at $(PROP)
           { '#': 'sibling', prop: need, siblingprop: prop } );
    xor['no:req'] = prop;
  }
  // TODO: does no:req work? check test3/NestedProjections/Basics/SyntaxErrorsCsn.err.csn
  else if (!xor['no:req']) {
    error( 'syntax-missing-property', location(true), // TODO: re-check columns, expand, inline
           {
             '#': spec.prop,
             prop: need,
             parentprop: spec.msgProp,
             otherprop: 'annotate',
           } );
  }
  return spec;
}

/**
 * @param {string[]} groups
 * @param {string|Function} exception
 * @param {string} prop
 * @param {object} xor
 * @return {boolean}
 */
function checkAndSetXorGroup( groups, exception, prop, xor, csn ) {
  if (!groups || groups.length === 0)
    return true;
  let silent = false;
  return groups.every((group) => {
    const siblingprop = xor[group];
    if (!siblingprop) {
      xor[group] = prop;
      return true;
    }
    if (siblingprop === exception)
      return true;
    if (typeof exception === 'function') {
      const r = exception( prop, siblingprop, csn, silent );
      if (r === false)           // error reported
        silent = true;
      if (r != null)
        return r;
    }
    if (!silent) {
      error( 'syntax-unexpected-property', location(true), { '#': 'sibling', prop, siblingprop } );
      silent = true;
    }
    return false;
  });
}

function inferredTargetEntityForAspect( prop, siblingprop, csn, silent = true ) {
  if (siblingprop !== 'target' && siblingprop !== 'targetAspect')
    return null;
  const { target } = csn;
  if (typeof target !== 'object' || !target?.elements)
    return true;
  if (!silent) {
    error( 'syntax-unexpected-property', location(true), {
      '#': prop,
      prop,
      siblingprop,
      subprop: 'elements',
    } );
  }
  return false;
}

function implicitName( ref ) {
  // careful, the input CSN might be wrong!
  const item = ref && ref[ref.length - 1];
  return (typeof item === 'object') ? item && item.id : item;
}

function replaceZeroProp( prop, otherprop ) {
  if (csnVersionZero)
    return;
  message( 'syntax-deprecated-property', location(true),
           { '#': 'zero-replace', prop, otherprop } );
}

// Other helper functions, locations -----------------------------------------

function isArray( array, spec ) {
  if (Array.isArray( array ))
    return array;
  error( 'syntax-expecting-array', location(true), { prop: spec.prop },
         'Expecting array for property $(PROP)' );
  return ignore( array );
}

function isObject( obj, spec ) {
  if (obj && typeof obj === 'object' && !Array.isArray( obj ))
    return obj;
  const loc = location(true);
  error( 'syntax-expecting-object', loc,
         { '#': spec.msgVariant || 'std', prop: spec.msgProp, op: '*' });
  return ignore( obj );
}

function refSplit( name, prop ) {
  const path = name.split('.');
  if (prop && (prop === '{}' || prop === '#' ? !name : !path.every( id => id)))
    message( 'syntax-invalid-name', location(true), { '#': prop, prop } );
  return { path: path.map( id => ({ id, location: location() }) ), location: location() };
}

function replaceZeroValue( spec, msgVariant, newValue ) {
  if (!csnVersionZero && !spec.vZeroFor) {
    message( 'syntax-deprecated-value', location(true),
             { '#': msgVariant, prop: spec.msgProp, value: newValue } );
  }
}

/**
 * @param {boolean} [enforceJsonPos]
 * @returns {CSN.Location}
 */
function location( enforceJsonPos ) {
  return !enforceJsonPos && dollarLocations.length &&
    dollarLocations[dollarLocations.length - 1] || {
    __proto__: Location.prototype,
    file: csnFilename,
    line: virtualLine,
    col: 0,
  };
}

function pushLocation( obj ) {
  // TODO: virtualLine is not really correct if $location is enumerable (is usually not)
  const loc = obj.$location;
  if (loc === undefined)
    return;
  if (loc && typeof loc === 'object' && !Array.isArray( loc )) {
    dollarLocations.push( loc.line ? { __proto__: Location.prototype, ...loc } : null );
    return;
  }
  else if (!loc || typeof loc !== 'string') {
    if (loc)
      dollarLocations.push( null ); // must match with popLocation()
    error( 'syntax-expecting-object', location(true), { prop: '$location' } );
  }
  // hidden feature: string $location
  const m = /:(\d+)(?::(\d+))?$/.exec( loc ); // extra '^'s at end deliberately left out
  if (!m) {                     // without location or with '^'s: do not use
    dollarLocations.push( null );
  }
  else {
    const line = Number( m[1] );
    const column = m[2] && Number( m[2] ) || 0;
    const file = loc.substring( 0, m.index );
    dollarLocations.push({
      __proto__: Location.prototype, file, line, col: column,
    } );
  }
}

function popLocation( obj ) {
  if (obj.$location)
    dollarLocations.pop();
}

function resetHeapModuleVars() {
  vocabInDefinitions = null;
  dollarLocations = [];
  message = () => undefined;
  error = () => undefined;
  warning = () => undefined;
  info = () => undefined;
}

// API -----------------------------------------------------------------------

/**
 * Transform the CSN to XSN (augmented CSN)
 *
 * @param {CSN.Model} csn
 * @param {string} filename
 * @param {CSN.Options} options
 * @returns {object} Augmented CSN (a.k.a XSN)
 */
function toXsn( csn, filename, options, messageFunctions ) {
  csnVersionZero = csn.version && csn.version.csn === '0.1.0';
  csnFilename = filename;
  virtualLine = 1;
  dollarLocations = [];
  arrayLevelCount = 0;
  inExtensions = null;
  vocabInDefinitions = null;

  const xsn = new XsnSource( 'json' ); // TODO: 'csn'? LSP does not use $frontend


  ({
    message, error, warning, info,
  } = messageFunctions);

  if (csnVersionZero) {
    warning( 'syntax-deprecated-csn-version', location(true), {},
             'Parsing CSN version 0.1.0' );
  }
  const r = object( csn, topLevelSpec );
  if (vocabInDefinitions)
    attachVocabInDefinitions( r );
  if (csn.$sources && Array.isArray( csn.$sources ) &&
      csn.$sources.every( fname => typeof fname === 'string' ))
    // non-enumerable or enumerable, ignore with wrong value
    r.$sources = csn.$sources;
  resetHeapModuleVars();
  return Object.assign( xsn, r );
}


function augment( csn, filename = 'csn.json', options = {}, messageFunctions = {} ) {
  try {
    return toXsn( csn, filename, options, messageFunctions );
  }
  catch ( e ) {
    resetHeapModuleVars();
    throw e;
  }
}

function parse( source, filename = 'csn.json', options = {}, messageFunctions = {} ) {
  try {
    return augment( JSON.parse(source), filename, options, messageFunctions );
  }
  catch ( e ) {
    resetHeapModuleVars();
    if (!(e instanceof SyntaxError))
      throw e;
    const xsn = new XsnSource();
    const msg = e.message;
    const p = /in JSON at position ([0-9]+)/.exec( msg );
    let line = 1;
    let column = 0;
    if (p) {
      const end = Number( p[1] );
      let eol = 0;
      const nl = /\n/g;
      while (nl.test( source )) {
        if (nl.lastIndex >= end)
          break;
        eol = nl.lastIndex;
        ++line;
      }
      column = end - eol + 1;
    }
    const loc = new Location(
      filename,
      line,
      column
    );
    messageFunctions.error( 'syntax-invalid-json', loc, { msg },
                            'Invalid JSON: $(MSG)' );
    return xsn;
  }
}

module.exports = { augment, parse };
