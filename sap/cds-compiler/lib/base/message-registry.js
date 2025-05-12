// Central registry for messages.

// `centralMessages` contains all details of a message-id except its standard texts
// (`standardTexts` exists for that).  Only `severity` is required, all other
// properties are optional.

// The user can specify "severity wishes" via the option `severities`.  Errors
// that don't have a `configurableFor` property cannot be reclassified by
// users.  If a module is used that is _not_ listed in `configurableFor` (if it
// is an array) property of the message then the message cannot be
// reclassified.

// We also allow `configurableFor` to have value `true` for errors which are
// always configurable; useful for issues like deprecated syntax variants which
// do not affect the compiler or CSN processors.  Temporarily, we also allow
// value `deprecated` for errors which are only configurable if the option
// `deprecated.downgradableErrors` is set.  If a string like `v6`, it works like
// `true`, but is meant to be removed with the next major version.

// Messages other than errors can always be reclassified by the user except if
// the module is listed in the message's `errorFor` property.

// __NEW__: If the future `poc` (proof of concept) or `sloppy` option is set,
// the module name `compile` is added to all configurable messages, i.e. to all
// `configurableFor` arrays.  (module `compile` includes all parsers and the
// core compiler).  This allows creators of _non-productive models_ to
// reclassify errors which usually cannot be reclassified, and continue the
// compilation but has the side effect that the result may be unstable, hence
// "sloppy": with an upcoming _minor_ version of the compiler, the compilation
// might lead to an error anyway or the compiled CSN might look different.

/* eslint @stylistic/js/no-multi-spaces: 0 */
/* eslint @stylistic/js/max-len: 0 */
/* eslint @stylistic/js/key-spacing: 0 */

'use strict';

const { CompilerAssertion } = require('./error');

/**
 * Central register of messages and their configuration.
 * Group by id-category.
 *
 * configurableFor: truthy = error can be downgraded in certain situations
 *  - true = can always be downgraded, we do not really care
 *  - 'v7': like `true`, but is intended to be removed with next major
 *  - [‹module›, …] = can be downgraded in compiler function ‹module›
 *  - 'deprecated' = severity can only be changed with deprecated.downgradableErrors
 *  - 'test' = severity can only be change with testMode; TODO: that was the plan,
 *    was first used with #11229, there is no implementation for it → works like true
 *
 * @type {Object<string, MessageConfig>}
 */
const centralMessages = {
  'api-deprecated-hdbcds': { severity: 'Error', configurableFor: true },
  'anno-definition':        { severity: 'Warning' },
  'anno-duplicate':         { severity: 'Error', configurableFor: true }, // does not hurt us
  'anno-duplicate-unrelated-layer': { severity: 'Error', configurableFor: true }, // does not hurt us
  'anno-unstable-array': { severity: 'Warning' },
  'anno-invalid-sql-element': { severity: 'Error', configurableFor: true },  // @sql.prepend/append - configurable for "I know what I'm doing"
  'anno-invalid-sql-struct': { severity: 'Error', configurableFor: true },  // @sql.prepend/append - configurable for "I know what I'm doing"
  'anno-invalid-sql-assoc': { severity: 'Error', configurableFor: true },  // @sql.prepend/append - configurable for "I know what I'm doing"
  'anno-invalid-sql-calc': { severity: 'Error', configurableFor: true },  // @sql.prepend/append - configurable for "I know what I'm doing"
  'anno-invalid-sql-kind': { severity: 'Error', configurableFor: true  },  // @sql.prepend/append - configurable for "I know what I'm doing"
  'anno-invalid-sql-view': { severity: 'Error', configurableFor: true  },  // @sql.prepend/append - configurable for "I know what I'm doing"
  'anno-invalid-sql-view-element': { severity: 'Error', configurableFor: true },  // @sql.prepend/append - configurable for "I know what I'm doing"
  'ext-undefined-action':  { severity: 'Warning' },
  'ext-undefined-art':     { severity: 'Warning' }, // for annotate statement (for CDL path root)
  'ext-undefined-def':     { severity: 'Warning' }, // for annotate statement (for CSN or CDL path cont)
  'ext-undefined-element': { severity: 'Warning' },
  'ext-undefined-key':     { severity: 'Warning' },
  'ext-undefined-param':   { severity: 'Warning' },
  'anno-unexpected-ellipsis': { severity: 'Error', configurableFor: 'deprecated' },
  'anno-unexpected-localized-skip': { severity: 'Error', configurableFor: true },

  'name-invalid-dollar-alias': { severity: 'Error', configurableFor: true },
  'name-deprecated-$self': { severity: 'Error', configurableFor: true },

  'type-invalid-items': { severity: 'Error' }, // not supported yet
  'assoc-as-type':  { severity: 'Error' }, // TODO: allow more, but not all
  'def-unexpected-nested-proj': { severity: 'Error', configurableFor: 'v4' },
  'def-unexpected-paramview-assoc': { severity: 'Error' },
  'def-unexpected-calcview-assoc': { severity: 'Error' },
  'chained-array-of': { severity: 'Error' },
  'def-missing-type':    { severity: 'Error', configurableFor: [ 'compile' ] },
  'def-missing-argument':    { severity: 'Error' },
  'check-proper-type-of': { severity: 'Info',  errorFor: [ 'for.odata', 'to.edmx', 'to.hdbcds', 'to.sql', 'to.hdi', 'to.rename', 'for.effective' ] },

  'def-duplicate-autoexposed': { severity: 'Error' },
  'def-unexpected-default': { severity: 'Error', configurableFor: 'test' },

  'expr-unexpected-filter': { severity: 'Error' },

  'empty-type':   { severity: 'Info' }, // only still an error in old transformers

  'ref-deprecated-orderby': { severity: 'Error', configurableFor: true },
  'ref-deprecated-self-element': { severity: 'Error', configurableFor: true },
  'ref-deprecated-variable': { severity: 'Warning' },
  'ref-invalid-type': { severity: 'Error' },
  'ref-unexpected-self': { severity: 'Error' },
  'ref-invalid-include': { severity: 'Error' },
  'type-unexpected-typeof': { severity: 'Error' },
  'type-unexpected-null': { severity: 'Error', configurableFor: true },
  'type-ignoring-argument': { severity: 'Error', configurableFor: true },
  'type-expected-builtin': { severity: 'Error', configurableFor: true },
  'type-expecting-service-target': { severity: 'Error', configurableFor: true },
  'ref-expecting-const': { severity: 'Error' },
  'ref-expecting-foreign-key': { severity: 'Error' },
  'ref-invalid-source': { severity: 'Error' },
  'ref-invalid-target': { severity: 'Error' },
  'ref-missing-self-counterpart': { severity: 'Error', configurableFor: true },
  'ref-sloppy-target': { severity: 'Error', configurableFor: 'v4' },

  'extend-repeated-intralayer': { severity: 'Warning' },
  'extend-unrelated-layer':     { severity: 'Info' },

  'ext-duplicate-extend-type': { severity: 'Error' },
  'ext-duplicate-extend-type-unrelated-layer': { severity: 'Error', configurableFor: true },

  'param-default': { severity: 'Error' }, // not supported yet

  'query-unexpected-assoc-hdbcds': { severity: 'Error' },
  'query-unexpected-structure-hdbcds': { severity: 'Error' },
  'query-ignoring-param-nullability': { severity: 'Info' },
  'query-expected-identifier': { severity: 'Error' },

  'recalculated-localized': { severity: 'Info' }, // KEEP: Downgrade in lib/transform/translateAssocsToJoins.js
  'redirected-implicitly-ambiguous': { severity: 'Error', configurableFor: true }, // does not hurt us - TODO: ref-ambiguous-target
  'type-ambiguous-target': { severity: 'Warning' },

  'ref-unexpected-autoexposed': { severity: 'Error' },
  'ref-unexpected-many-navigation': { severity: 'Error' },
  // Published! Used in @sap/cds-lsp; if renamed, add to oldMessageIds and contact colleagues
  'ref-undefined-art':    { severity: 'Error' },
  'ref-undefined-def':    { severity: 'Error' },
  'ref-undefined-var':    { severity: 'Error' },
  'ref-undefined-element': { severity: 'Error' },
  'anno-undefined-element': { severity: 'Error' },
  'ref-unknown-var': { severity: 'Info' },
  'ref-obsolete-parameters': { severity: 'Error', configurableFor: 'v4' },
  // does not hurt us, but makes it tedious to detect parameter refs
  'ref-undefined-param': { severity: 'Error' },
  'ref-undefined-enum': { severity: 'Warning', errorFor: [ 'to.sql', 'to.hdbcds', 'to.hdi' ] },
  'ref-unexpected-enum': { severity: 'Warning', errorFor: [ 'to.sql', 'to.hdbcds', 'to.hdi' ] },
  'anno-undefined-param': { severity: 'Error' },
  'ref-rejected-on': { severity: 'Error' },
  'ref-expected-element': { severity: 'Error' },

  'rewrite-key-not-covered-explicit': { severity: 'Error' },
  'rewrite-key-not-covered-implicit': { severity: 'Error' },
  'rewrite-key-not-matched-explicit': { severity: 'Error' },
  'rewrite-key-not-matched-implicit': { severity: 'Error' },

  'service-nested-context': { severity: 'Error', configurableFor: true }, // does not hurt compile, TODO
  'service-nested-service': { severity: 'Error' }, // not supported yet; TODO: configurableFor:'test'?

  'expr-unexpected-operator': { severity: 'Error', configurableFor: true },

  'syntax-deprecated-auto-union': { severity: 'Error', configurableFor: 'v4' },
  // Published! Used in @sap/cds-lsp; if renamed, add to oldMessageIds and contact colleagues
  // Also used by other projects that rely on double-quotes for delimited identifiers.
  'syntax-deprecated-ident': { severity: 'Error', configurableFor: true },
  'syntax-deprecated-property': { severity: 'Error', configurableFor: 'v4' }, // v0 prop
  'syntax-deprecated-value': { severity: 'Error', configurableFor: 'v4' },    // v0 prop
  // 'syntax-duplicate-annotate' came late with v3 - make it configurable as
  // fallback, but then parse.cdl is not supposed to work correctly (it can
  // then either issue an error or produce a CSN missing some annotations):
  'syntax-duplicate-annotate': { severity: 'Error' },
  'syntax-duplicate-clause': { severity: 'Error' },
  // remark: a hard syntax error in new parser for `null` together with `not null`
  'syntax-duplicate-equal-clause': { severity: 'Warning' },
  'syntax-invalid-name': { severity: 'Error' },
  'syntax-missing-as': { severity: 'Error', configurableFor: true },
  'syntax-missing-proj-semicolon': { severity: 'Warning' },
  'syntax-unexpected-after': { severity: 'Error' },
  'syntax-unexpected-filter': { severity: 'Error', configurableFor: true },
  'syntax-unexpected-many-one': { severity: 'Error' },
  'syntax-deprecated-ref-virtual': { severity: 'Error' },
  'syntax-unexpected-reserved-word': { severity: 'Error', configurableFor: true },
  'syntax-unknown-escape': { severity: 'Error', configurableFor: true },
  'syntax-unsupported-masked': { severity: 'Error', configurableFor: 'deprecated' },
  'syntax-unexpected-sql-clause': { severity: 'Error' }, // TODO: configurableFor:'tests'?
  'syntax-invalid-space': { severity: 'Error', configurableFor: 'test' },
  'syntax-expecting-space': { severity: 'Error' },
  'syntax-unexpected-anno': { severity: 'Error' },
  'migration-unsupported-key-change': { severity: 'Error', configurableFor: [ 'to.sql.migration', 'to.sql.migration-script' ] },
  'type-missing-enum-value': { severity: 'Error', configurableFor: 'test' },

  'def-missing-element': { severity: 'Error' },
  'def-missing-virtual': { severity: 'Error', configurableFor: true },
  'def-expected-structured': { severity: 'Error', configurableFor: true },
  'def-unsupported-calc-elem': { severity: 'Error', configurableFor: true },

  'def-invalid-key-cardinality': { severity: 'Error' },

  'odata-unexpected-array': { severity: 'Warning' },
  'odata-unexpected-assoc': { severity: 'Warning' },
  'odata-incomplete-constraints': { severity: 'Info' },
  'odata-invalid-name': { severity: 'Error', configurableFor: true },
  'odata-invalid-vocabulary-alias': { severity: 'Error', configurableFor: true },
  'odata-invalid-qualifier': { severity: 'Error', configurableFor: true },
  'odata-invalid-service-name': { severity: 'Warning' },
  'odata-invalid-param-type': { severity: 'Warning' },
  'odata-invalid-return-type': { severity: 'Warning' },
  'odata-missing-type': { severity: 'Error', configurableFor: true },
  'odata-invalid-scale': { severity: 'Error', configurableFor: true },
  'odata-unexpected-edm-facet': { severity: 'Error', configurableFor: true },
  'odata-invalid-external-type': { severity: 'Error', configurableFor: true },
  'odata-unexpected-edm-type': { severity: 'Error', configurableFor: true },
  'odata-unknown-edm-type': { severity: 'Error', configurableFor: true },
  'odata-missing-key':  { severity: 'Error', configurableFor: true },
  'odata-unexpected-arrayed-key':  { severity: 'Error', configurableFor: true },
  'odata-unexpected-nullable-key': { severity: 'Error', configurableFor: true },
  'odata-invalid-key-type': { severity: 'Warning' },
  'odata-invalid-property-name': { severity: 'Warning' },
  'odata-anno-preproc': { severity: 'Warning' },
  'odata-anno-dict': { severity: 'Warning' },
  'odata-anno-vocref': { severity: 'Warning' },
  'odata-anno-dict-enum': { severity: 'Error' },
  'odata-anno-value': { severity: 'Warning' },
  'odata-anno-type': { severity: 'Warning' },
  'odata-anno-def': { severity: 'Info' },
  'odata-duplicate-definition': { severity: 'Error' },
  'odata-duplicate-proxy': { severity: 'Warning' },

  'query-ignoring-assoc-in-union': { severity: 'Info' },

  // for to.sql.migration - cannot be supplied by the user!
  'migration-unsupported-precision-change': { severity: 'Error', configurableFor: [ 'to.sql.migration-script' ]  },
  'migration-unsupported-element-drop': { severity: 'Error', configurableFor: [ 'to.sql.migration-script' ] },
  'migration-unsupported-length-change': { severity: 'Error', configurableFor: [ 'to.sql.migration-script' ] },
  'migration-unsupported-scale-change': { severity: 'Error', configurableFor: [ 'to.sql.migration-script' ] },
  'migration-unsupported-change': { severity: 'Error', configurableFor: [ 'to.sql.migration-script' ] },
  'migration-unsupported-table-drop': { severity: 'Error', configurableFor: [ 'to.sql.migration-script' ] },
  // end of to.sql.migration specific
};

// Old/Deprecated message IDs that we only still use for backwards-compatibility.
// We keep them in a separate array for easier access. No need to go through all
// existing messages and search for the old one in `oldNames` property.
// The keys will be added to `oldNames` of the new message, which is used for reclassification.
const oldMessageIds = {
  __proto__: null,

  'old-anno-duplicate': 'anno-duplicate', // Example

  'assoc-in-array': 'type-invalid-items',
  'duplicate-autoexposed': 'def-duplicate-autoexposed',
  'expr-no-filter': 'expr-unexpected-filter',
  'check-proper-type': 'def-missing-type',

  // All odata messages were renamed in v6. Some were split up into separate ones.
  'odata-spec-violation-array': 'odata-unexpected-array',
  'odata-spec-violation-assoc': 'odata-unexpected-assoc',
  'odata-spec-violation-constraints': 'odata-incomplete-constraints',
  'odata-spec-violation-id': [ 'odata-invalid-name', 'odata-invalid-vocabulary-alias', 'odata-invalid-qualifier' ],
  'odata-spec-violation-namespace': 'odata-invalid-service-name',
  'odata-spec-violation-param': 'odata-invalid-param-type',
  'odata-spec-violation-returns': 'odata-invalid-return-type',
  'odata-spec-violation-type': [ 'odata-unexpected-edm-facet', 'odata-missing-type', 'odata-invalid-scale', 'odata-unexpected-edm-type', 'odata-invalid-external-type' ],
  'odata-spec-violation-type-unknown': 'odata-unknown-edm-type',
  'odata-spec-violation-no-key': 'odata-missing-key',
  'odata-spec-violation-key-array': 'odata-unexpected-arrayed-key',
  'odata-spec-violation-key-type': 'odata-invalid-key-type',
  'odata-spec-violation-key-null': 'odata-unexpected-nullable-key',
  'odata-spec-violation-property-name': 'odata-invalid-property-name',
  'odata-definition-exists': [ 'odata-duplicate-definition', 'odata-duplicate-proxy' ],
};

// Set up the old-to-new message ID mapping in the message registry.
for (const oldName in oldMessageIds) {
  if (centralMessages[oldName])
    throw new CompilerAssertion(`Mapping from ${ oldName } not possible: ID is still used in message registry.`);

  const newNames = Array.isArray(oldMessageIds[oldName]) ? oldMessageIds[oldName] : [ oldMessageIds[oldName] ];
  for (const newName of newNames) {
    if (!centralMessages[newName])
      throw new CompilerAssertion(`Mapping from ${ oldName } to new message ID ${ newName } does not exist!`);
    centralMessages[newName].oldNames ??= [ ];
    centralMessages[newName].oldNames.push(oldName);
  }
}


// For messageIds, where no text has been provided via code (central def).
// DO NOT CHANGE THE VARIABLE NAME!
// If you change it, keep in sync with scripts/eslint/rules/message-text.js

const centralMessageTexts = {
  'api-deprecated-hdbcds': 'Support for generating hdbcds output is deprecated with @sap/cds-compiler v5 and later',
  'api-invalid-option': {
    std: 'Invalid option $(NAME)!',
    deprecated: 'Option $(NAME) is no longer supported! Use latest API options instead',
    magicVars: 'Option $(PROP) is no longer supported! Use $(OTHERPROP) instead. See <https://cap.cloud.sap/docs/guides/databases#configuring-variables> for details',
    value: 'Expected option $(PROP) to have $(VALUE). Found: $(OTHERVALUE)',
    value2: 'Expected option $(OPTION) to have value $(VALUE) or $(RAWVALUE); found: $(OTHERVALUE)',
    type: 'Expected option $(OPTION) to be of type $(VALUE). Found: $(OTHERVALUE)',
    forbidden: 'Option $(OPTION) can\'t be used with API function $(MODULE)',
  },
  'def-upcoming-virtual-change': {
    std: 'This select item is a new element in cds-compiler v6, but only supported with the new parser',
  },
  'query-invalid-virtual-struct': 'For a virtual structure in a query, use a defined structure type, or add $(CODE) when you meant to specify references',

  'api-invalid-variable-replacement': {
    std: 'Option $(OPTION) does not support $(NAME)',
    user: 'Option $(OPTION) expects $(PROP) instead of $(OTHERPROP). See <https://cap.cloud.sap/docs/guides/databases#configuring-variables> for details',
    locale: 'Option $(OPTION) expects $(PROP) instead of $(OTHERPROP). See <https://cap.cloud.sap/docs/guides/databases#configuring-variables> for details',
    noDollar: 'Option $(OPTION) does not know $(NAME). Did you forget a leading $(CODE)?',
  },

  'api-invalid-combination': {
    std: 'Invalid option combination found: $(OPTION) and $(PROP)', // unused
    'valid-structured': 'Structured OData is only supported with OData version v4',
    'sql-dialect-and-naming': 'sqlDialect $(NAME) can\'t be combined with sqlMapping $(PROP)',
    'tenant-and-naming': 'Option $(OPTION) can\'t be combined with sqlMapping $(PROP) - expected sqlMapping $(VALUE)',
    'dry-and-script': 'script:true must be combined with dry:true, found $(VALUE)',
    'hana-migration': 'SQL dialect $(VALUE) is not supported with API function "to.sql.migration" - use HDI via "to.hdi" and "to.hdi.migration"',
    'effectiveServiceName-and-type-resolution': 'Option $(NAME) can\'t be used without $(PROP)',
  },
  'api-unexpected-combination': {
    std: 'Unexpected option combination: $(OPTION) and $(PROP)', // unused
    'beta-no-test':'Option $(OPTION) was used. This option should not be used in productive scenarios!',
  },
  'api-unexpected-option': 'Option $(OPTION) can\'t be used in backend $(MODULE)',
  'api-invalid-lookup-dir': {
    std: '',
    slash: 'Expected directory $(VALUE) in option $(OPTION) to end with $(OTHERVALUE)',
    relative: 'Expected directory $(VALUE) in option $(OPTION) to not start with $(OTHERVALUE)',
  },
  'api-unsupported-csn-flavor': {
    std: 'Module $(NAME) expects a client/inferred CSN, not $(OPTION)',
    'parsed-requires': 'Module $(NAME) expects a client/inferred CSN, or a parsed CSN without dependencies, but found $(PROP) property',
  },

  'anno-duplicate': {
    std: 'Duplicate assignment with $(ANNO)',
    doc: 'Duplicate assignment with a doc comment',
  },
  'anno-duplicate-same-file': {
    std: 'Duplicate assignment with $(ANNO), using last',
    doc: 'Duplicate assignment with a doc comment, using last',
  },
  'anno-duplicate-unrelated-layer': {
    std: 'Duplicate assignment with $(ANNO)',
    doc: 'Duplicate assignment with a doc comment',
  },
  'anno-unstable-array': 'Unstable order of array items due to repeated assignments for $(ANNO)',
  'anno-mismatched-ellipsis': 'An array with $(CODE) can only be used if there is an assignment below with an array value',
  'anno-unexpected-ellipsis': 'No base annotation available to apply $(CODE)',

  'anno-unexpected-localized-skip': {
    std: 'Compiler generated entity $(NAME) must not be annotated with $(ANNO) if $(ART) is not skipped',
    view: 'Compiler generated view $(NAME) must not be annotated with $(ANNO) if $(ART) is not skipped',
  },

  'anno-missing-rewrite': {
    std: 'Assign a value for $(ANNO); the value inherited from $(ART) can\'t be rewritten due to $(ELEMREF)',
    unsupported: 'Assign a value for $(ANNO); the value inherited from $(ART) can\'t be rewritten due to unsupported $(ELEMREF)',
    param: 'Assign a value for $(ANNO); the value inherited from $(ART) can\'t be rewritten due to parameter reference $(ELEMREF)',
  },

  'chained-array-of': '"Array of"/"many" must not be chained with another "array of"/"many" inside a service',

  'check-proper-type-of': {
    std: 'Referred element $(NAME) of $(ART) does not contain proper type information',
    derived: 'Referred type of $(ART) does not contain proper type information',
    managedAssocForeignKey: 'Foreign key $(NAME) of managed association $(ART) must have a type',
    managedCompForeignKey: 'Foreign key $(NAME) of managed composition $(ART) must have a type',
  },

  'name-duplicate-element': {
    std: 'Generated element $(NAME) conflicts with another element',
    'flatten-element-gen': 'Generated element $(NAME) conflicts with other generated element',
    'flatten-element-exist': 'Flattened name of structured element conflicts with existing element $(NAME)',
    'flatten-fkey-gen': 'Duplicate definition of foreign key element $(NAME) for association $(ART)',
    'flatten-fkey-exists': 'Generated foreign key element $(NAME) for association $(ART) conflicts with existing element',
  },
  'name-invalid-dollar-alias': {
    std: 'An alias name starting with $(NAME) might shadow a special variable; replace by another name',
    $tableAlias: 'A table alias name must not start with $(NAME); choose another name',
    $tableImplicit: 'The resulting table alias starts with $(NAME); choose another name with $(KEYWORD)',
    mixin: 'A mixin name starting with $(NAME) might shadow a special variable; replace by another name',
  },

  'name-missing-alias': {
    std: 'Missing table alias for this subquery',
    duplicate: 'Missing table alias for this subquery; add $(CODE) to fix name clash of internal and explicit table alias',
    hdbcds: 'Missing table alias for a subquery; SAP HANA CDS requires table aliases',
  },

  // Syntax messages, both CDL and CSN parser: ----------------------------------
  'syntax-deprecated-abstract': {
    std: 'Abstract entity definitions are deprecated; use aspect definitions instead',
    'strange-kind': 'The property $(PROP) is deprecated; expecting it only with kind $(KIND) to define an aspect',
  },
  'syntax-duplicate-excluding': {
    std: 'Duplicate $(NAME) in the $(KEYWORD) clause',
    csn: 'Duplicate $(NAME) in property $(PROP)',
  },
  'syntax-expecting-unsigned-int': { // TODO: test all in SyntaxOnly/
    std: 'A safe non-negative integer is expected here',
    normal: 'A non-negative integer number is expected here',
    unsafe: 'The provided integer is too large',
    csn: 'Expecting a non-negative integer for property $(PROP)',
    'or-asterisk': 'Expecting a non-negative integer or string $(OP) for property $(PROP)',
  },
  'syntax-ignoring-decimal': {
    std: 'Ignoring decimal places, because an integer was expected',
  },
  'syntax-unexpected-anno': {
    std: 'Annotations can\'t be used in a column with $(CODE)',
    doc: 'Doc comments can\'t be used in a column with $(CODE)',
  },
  'syntax-unexpected-after': {
    std: 'Unexpected $(KEYWORD) after annotation assignment',
    many: 'Unexpected $(KEYWORD) after array type',
    enum: 'Unexpected annotation assignment after enum type',
  },
  'syntax-unexpected-filter': 'Unexpected filter on the result of a function call',
  'syntax-unexpected-many-one': 'Replace $(CODE) with $(DELIMITED) to avoid an ambiguity with managed compositions of anonymous aspects',
  'syntax-deprecated-ref-virtual': {
    std: 'Use $(DELIMITED) at the beginning of the column expression',
    ref: 'Use $(DELIMITED) to refer to the element $(NAME) at the beginning of the column expression',
    func: 'Use $(DELIMITED) when calling the function $(NAME) at the beginning of the column expression',
  },
  'syntax-invalid-name': {
    std: 'Identifier must consist of at least one character', // only via delimited id
    // as: 'String in property $(PROP) must not be empty', // expecting non-empty string is ok
    '{}': 'Property name in structured value must not be empty', // CSN anno val
    dict: 'Property name in dictionary $(PARENTPROP) must not be empty',
    '=': 'The dot-separated name parts in property $(PROP) must not be empty',
    type: 'The dot-separated element name parts in property $(PROP) must not be empty', // CSN v0
  },
  'syntax-invalid-literal': {
    std: 'Invalid literal value',
    'uneven-hex': 'A binary literal must have an even number of characters',
    'invalid-hex': 'A binary literal must only contain characters ‹0-9›, ‹a-f› and ‹A-F›',
    time: 'A time literal must look like ‹hh:mm:ss› or ‹hh:mm› where each letter represents a digit. A timezone is optional',
    date: 'A date literal must look like ‹YYYY-MM-DD› where each letter represents a digit',
    timestamp: 'A timestamp literal must look like ‹YYYY-MM-DD hh:mm:ss.u…u› or ‹YYYY-MM-DD hh:mm› where each letter represents a digit, ‹u…u› represents 1 to 7 digits. A timezone is optional',
    number: 'The string value in property $(PROP) does not represent a number',
    expecting: 'Expecting literal type $(OP) for the value in property $(OTHERPROP)',
    typeof: 'String $(RAWVALUE) is no valid literal type for the string value in property $(OTHERPROP)',
  },
  'syntax-invalid-source': {
    std: 'The given source is invalid', // unused
    'cdl-stackoverflow': 'The parser ran into a stack overflow. Does your CDS file contain too many nested artifacts?',
  },
  'syntax-missing-ellipsis': 'Expecting an array item $(NEWCODE) after an item with $(CODE)',
  'syntax-unexpected-ellipsis': {
    std: 'Unexpected array item $(CODE)',
    duplicate: 'Unexpected array item $(CODE) after previous $(CODE) without $(KEYWORD)',
    'csn-duplicate': 'Unexpected object with property $(PROP) after previous array item $(CODE)',
    'csn-nested': 'Unexpected object with property $(PROP) in nested array',
  },
  'syntax-invalid-anno': {
    std: 'Unexpected $(OFFENDING), invalid annotation value, expecting $(EXPECTING)',
    empty: 'Unexpected $(OFFENDING), empty structure flattens to nothing, expecting $(EXPECTING)',
    ellipsis: 'Unexpected $(OFFENDING) in inner array value, expecting $(EXPECTING)',
    bracket: 'Missing array item $(CODE) before $(OFFENDING), expecting $(EXPECTING)',
  },
  'syntax-unsupported-masked': { // configurable Error
    std: 'The keyword $(KEYWORD) is not supported',
    csn: 'The property $(PROP) is not supported',
  },

  // Syntax messages, CDL parser  -----------------------------------------------
  // 'syntax-deprecated-auto-as', 'syntax-deprecated-ident'
  'syntax-duplicate-annotate': 'You can\'t refer to $(NAME) repeatedly with property $(PROP) in the same annotate statement',
  'syntax-duplicate-argument': {
    std: 'Duplicate value for parameter $(NAME)',
    type: 'Duplicate value for type parameter $(NAME)',
  },
  'syntax-duplicate-clause': {
    std: 'You have already provided this clause',
    cardinality: 'You have already provided a target cardinality $(CODE) instead, at line $(LINE), column $(COL)',
    notNull: 'You have already provided $(CODE) instead, at line $(LINE), column $(COL) below',
    orderByLimit: 'You have already provided $(CODE) before',
  },
  'syntax-duplicate-equal-clause': {
    std: 'You have already provided the same clause',
    cardinality: 'You have already provided the target cardinality $(CODE) at line $(LINE), column $(COL)',
    notNull: 'You have already provided $(CODE) at line $(LINE), column $(COL)',
  },
  'syntax-duplicate-extend': {
    std: 'You can\'t define and refer to $(NAME) repeatedly in the same extend statement',
    define: 'You can\'t refer to $(NAME) in the same extend statement where it was defined',
    extend: 'You can\'t refer to $(NAME) repeatedly in the same extend statement',
  },
  // 'syntax-duplicate-anno', 'syntax-duplicate-doc-comment', 'syntax-duplicate-property',
  // 'syntax-duplicate-wildcard'
  'syntax-invalid-path-separator': {
    std: 'Invalid reference path separator', // unused
    dot: 'Use a $(NEWCODE), not a $(CODE) after the arguments or filter on an entity',
    colon: 'Use a $(NEWCODE), not a $(CODE) between the element names in a reference',
  },
  // 'syntax-ignoring-doc-comment' (Info)
  'syntax-unexpected-reserved-word': '$(CODE) is a reserved word - write $(DELIMITED) instead if you want to use it as name',
  'syntax-invalid-text-block': 'Missing newline in text block',
  // 'syntax-missing-newline' (Warning), 'syntax-missing-as',
  // 'syntax-missing-token'
  'syntax-unexpected-extension': {
    std: 'Unexpected $(KEYWORD) inside $(CODE) block',
    'new-parser': 'Unexpected $(OFFENDING) inside $(CODE) block, expecting $(EXPECTING)',
  },
  'syntax-unexpected-token': {
    std: 'Mismatched $(OFFENDING), expecting $(EXPECTING)',
    unwanted: 'Extraneous $(OFFENDING), expecting $(EXPECTING)',
    noRepeatedCardinality: 'Unexpected $(OFFENDING), cardinality already provided at $(LOCATION) via $(CODE), expecting $(EXPECTING)',
    nestedExpand: 'Unexpected $(OFFENDING), nested projections are valid after a reference only, expecting $(EXPECTING)',
  },
  'syntax-unexpected-vocabulary': {
    std: 'Annotations can\'t be defined inside contexts or services', // used inside extensions
    service: 'Annotations can\'t be defined inside services',
    context: 'Annotations can\'t be defined inside contexts',
    'extend-new': 'Unexpected $(OFFENDING) definition inside a context or service, expecting $(EXPECTING)',
    'service-new': 'Unexpected $(OFFENDING) definition inside a service, expecting $(EXPECTING)',
    'context-new': 'Unexpected $(OFFENDING) definition inside a context, expecting $(EXPECTING)',
  },
  // 'syntax-unexpected-alias' (is 'syntax-unexpected-property' in CSN)
  'syntax-unsupported-param': {
    std: 'Parameter not supported', // unused
    dynamic: 'Dynamic parameter $(CODE) is not supported',
    positional: 'Positional parameter $(CODE) is not supported',
  },
  'syntax-unexpected-sql-clause': {
    std: 'Unexpected $(KEYWORD) clause for path filter',
  },

  // Syntax messages, CSN parser - default: Error  ------------------------------
  'syntax-deprecated-dollar-syntax': {
    std: 'The property $(PROP) is deprecated; its value is ignored',
    projection: 'The property $(PROP) is deprecated; use property $(SIBLINGPROP) instead of $(OTHERPROP) for the query',
    aspect: 'The property $(PROP) is deprecated; change the kind of the current definition to $(KIND) instead',
  },
  'syntax-deprecated-property': {  // Configurable error
    std: 'Deprecated property $(PROP)', // unused
    zero: 'Deprecated CSN v0.1.0 property $(PROP) is ignored',
    'zero-replace': 'Replace CSN v0.1.0 property $(PROP) by $(OTHERPROP)',
  },
  'syntax-deprecated-value': {  // Configurable error
    std: 'Deprecated representation of the value in property $(PROP)',
    'zero-parens': 'Deprecated CSN v0.1.0 representation of expressions in parentheses',
    'zero-replace': 'Replace CSN v0.1.0 value in $(PROP) by $(VALUE)',
  },
  'syntax-deprecated-type-ref': {
    std: 'Expecting a string as value for property $(PROP) for a reference to a definition',
    'ref-item': 'Expecting a string as value for property $(PROP) for a type reference to an element',
  },

  'syntax-expecting-object': {
    std: 'Expecting object for property $(PROP)',
    'or-asterisk': 'Expecting object or string $(OP) for property $(PROP)',
    'or-string': 'Expecting object or non-empty string for property $(PROP)',
  },
  'syntax-expecting-string': {
    std: 'Expecting non-empty string for property $(PROP)',
    'or-object': 'Expecting non-empty string or object for property $(PROP)',
    'or-bool': 'Expecting non-empty string or boolean for property $(PROP)',
    'or-null': 'Expecting non-empty string or null for property $(PROP)',
  },
  // 'syntax-expecting-boolean' (Warning), 'syntax-expecting-scalar',
  // 'syntax-expecting-args', 'syntax-expecting-translation', 'syntax-expecting-array'
  'syntax-incomplete-array': {  // location at ']'
    std: 'Expecting array in $(PROP) to have at least $(N) items',
    one: 'Expecting array in $(PROP) to have at least one item',
    suffix: 'With sibling property $(SIBLINGPROP), expecting array in $(PROP) to have at least one item',
  },
  'syntax-incomplete-object': { // location at '}'
    std: 'Object in $(PROP) must have at least one valid CSN property',
    as: 'Object in $(PROP) must have at least one valid CSN property other than $(OTHERPROP)',
  },
  'syntax-invalid-string': {
    std: 'Invalid string value in property $(PROP)',
  },
  // 'syntax-invalid-ref' (Warning?), 'syntax-invalid-kind', 'syntax-invalid-literal' (Warning)
  'syntax-missing-property': {  // location at sibling or '}' otherwise
    std: 'Object in $(PARENTPROP) must have the property $(PROP)',
    sibling: 'Object with property $(SIBLINGPROP) must also have a property $(PROP)',
    bothTargets: 'Object with properties $(SIBLINGPROP) and $(OTHERPROP) must also have a property $(PROP)',
    columns: 'Object in $(PARENTPROP) must have an expression property like $(PROP)',
    extensions: 'Object in $(PARENTPROP) must have the property $(PROP) or $(OTHERPROP)',
  },
  'syntax-unexpected-property': {
    std: 'Unexpected CSN property $(PROP)',
    sibling: 'CSN property $(PROP) is not expected in an object with property $(SIBLINGPROP)',
    target: 'CSN property $(PROP) with sub property $(SUBPROP) is not expected in an object with property $(SIBLINGPROP)',
    targetAspect: 'CSN property $(PROP) is not expected in an object with property $(SIBLINGPROP) having sub property $(SUBPROP)',
    prop: 'CSN property $(PROP) is not expected in $(PARENTPROP)',
    top: 'CSN property $(PROP) is not expected top-level',
    kind: 'CSN property $(PROP) is not expected by a definition of kind $(KIND)',
    extend: 'CSN property $(PROP) is not expected by an extend in $(PARENTPROP)',
    annotate: 'CSN property $(PROP) is not expected by an annotate in $(PARENTPROP)',
  },
  'def-invalid-calc-elem': {
    std: 'Invalid calculated element',
    key: 'A primary key element can\'t be calculated',
    virtual: 'A virtual element can\'t be calculated',
    localized: 'A localized element can\'t be calculated',
    default: 'An element with a default value can\'t be calculated',
    event: 'An event can\'t have calculated elements',
    type: 'A type can\'t have calculated elements',
    action: 'An action can\'t have calculated elements',
    function: 'A function can\'t have calculated elements',
    annotation: 'Annotation definitions can\'t have calculated elements',
    param: 'Parameters can\'t have calculated elements',
  },
  'def-invalid-name': {
    std: 'The character \'.\' is not allowed in identifiers',
    element: 'The character \'.\' is not allowed in element names',
    param: 'The character \'.\' is not allowed in parameter names',
    action: 'The character \'.\' is not allowed in bound action names',
    function: 'The character \'.\' is not allowed in bound function names',
  },
  'ref-invalid-calc-elem': {
    std: 'Can\'t include artifact with calculated element',
    event: 'An event can\'t include an artifact with calculated elements',
    type: 'A type can\'t include an artifact with calculated elements',
    annotation: 'An annotation can\'t include an artifact with calculated elements',
  },
  'def-unsupported-calc-elem': {
    std: 'Calculated elements are not supported, yet',
    nested: 'Calculated elements in structures are not supported, yet',
    'on-write': 'Calculated elements on-write are not supported, yet',
    hdbcds: 'Calculated elements on-write are not supported for HDBCDS',
  },
  // 'syntax-unknown-property' (Warning? Better configurable Error)

  'expr-unexpected-argument': {
    // TODO: change to `Arguments…`
    std: 'Parameters can only be provided when navigating along associations',
    from: 'Parameters can only be provided for the source entity or associations',
    tableAlias: 'Arguments can\'t be provided for table aliases, only when navigating along associations',
    // no-params TODO: extra message id or a variant of expr-undefined-param
    'no-params': 'Unexpected arguments for entity $(ART) without parameters',
  },
  'expr-unexpected-filter': {
    std: 'A filter can only be provided when navigating along associations',
    // to help users for `… from E:toF { toF[…].x }`
    tableAlias: 'A filter can only be provided when navigating along associations, but found table alias',
    from: 'A filter can only be provided for the source entity or associations',
    'model-only': 'A filter can\'t be provided for a to-many association without ON-condition',
  },

  // multi-line strings: --------------------------------------------------------
  'syntax-unknown-escape': 'Unknown escape sequence $(CODE)',
  'syntax-invalid-escape': {
    std: 'Invalid escape sequence $(CODE)',
    octal: 'Octal escape sequences are not supported. Use unicode escapes instead',
    whitespace: 'Unknown escape sequence: Can\'t escape whitespace',
    codepoint: 'Undefined code-point for $(CODE)',
    'unicode-hex': 'Expecting hexadecimal numbers for unicode escape but found $(CODE)',
    'hex-count': 'Expecting $(COUNT) hexadecimal numbers for escape sequence but found $(CODE)',
    'unicode-brace': 'Missing closing brace for unicode escape sequence',
    'language-identifier': 'Escape sequences in text-block\'s language identifier are not allowed',
  },
  'syntax-missing-escape':  {
    std: 'Missing escape. Replace $(CODE) with $(NEWCODE)',
    placeholder: 'Placeholders are not supported. Replace $(CODE) with $(NEWCODE)',
  },

  // Messages for erroneous references -----------------------------------------
  // location at erroneous reference (if possible)
  'ref-deprecated-orderby': 'Replace source element reference $(ID) by $(NEWCODE); auto-corrected',
  'ref-missing-self-counterpart' : {
    std: 'Expected to find a matching element in $self-comparison for foreign key $(PROP) of association $(NAME)',
    unmanaged: 'Expected to find a matching element in $self-comparison for $(PROP) of association $(NAME)',
  },
  'ref-unexpected-self': {
    std: 'Unexpected $(ID) reference; is valid only in ON-conditions of unmanaged associations',
    on: 'Unexpected $(ID) reference; is valid only if compared to be equal to an association of the target side',
    subQuery: 'Unexpected $(ID) reference in a sub query',
    setQuery: 'Unexpected $(ID) reference in a query on the right side of $(OP)',
    exists: 'With $(NAME), path steps must not start with $(ID)',
    'exists-filter': 'Unexpected $(ID) reference in filter of path $(ELEMREF) following “EXISTS” predicate',
  },
  'ref-unexpected-map': {
    std: 'Unexpected reference to an element of type $(TYPE)', // unused
    keys: 'Unexpected reference to an element of type $(TYPE) in foreign keys',
    onCond: 'Unexpected reference to an element of type $(TYPE) in an ON-condition',
  },
  'ref-undefined-def': {
    std: 'Artifact $(ART) has not been found',
    // TODO: proposal 'No definition of $(NAME) found',
    element: 'Artifact $(ART) has no element $(MEMBER)',
  },
  'ref-undefined-param': 'Entity $(ART) has no parameter $(ID)',
  'anno-undefined-param': {
    std: 'Entity $(ART) has no parameter $(ID)',
    entity: 'Entity $(ART) has no parameter $(ID)',
    action: 'Action $(ART) has no parameter $(ID)',
  },
  'ref-undefined-art': {
    std: 'No artifact has been found with name $(ART)',
    namespace: 'No artifact has been found with name $(ART) which can be extended with annotations',
    localized: 'Can\'t extend localized definitions, only annotate them using an $(KEYWORD) statement',
  },
  // TODO: proposal 'No definition found for $(NAME)',
  'ref-undefined-element': {
    std: 'Element $(ART) has not been found',
    element: 'Artifact $(ART) has no element $(MEMBER)',
    target: 'Target entity $(ART) has no element $(ID)',
    aspect: 'Element $(ID) has not been found in the anonymous target aspect',
    query: 'The current query has no element $(ART)',
    alias: 'Element $(ART) has not been found in the sub query for alias $(ALIAS)',
    virtual: 'Element $(ART) has not been found. Use $(CODE) to add virtual elements in queries',
  },
  'anno-undefined-element': {
    std: 'Element $(ART) has not been found',
    element: 'Artifact $(ART) has no element $(MEMBER)',
    target: 'Target entity $(ART) has no element $(ID)',
    query: 'The current query has no element $(ART)',
    alias: 'Element $(ART) has not been found in the sub query for alias $(ALIAS)',
    aspect: 'Element $(ID) has not been found in the anonymous target aspect',
  },
  'ref-undefined-var': {
    std: 'Variable $(ID) has not been found',
    alias: 'Variable $(ID) has not been found. Use table alias $(ALIAS) to refer an element with the same name',
    self: 'Variable $(ID) has not been found. Use $(ALIAS) to refer an element with the same name',
    value: 'No value found for variable $(ID). Use option $(OPTION) to specify a value for $(ID)',
  },
  'ref-undefined-enum': 'Enum symbol $(ID) is not defined in $(TYPE)',
  'ref-unexpected-enum': {
    std: 'Unexpected enum reference $(ENUM)',
    symbolDef: 'References to other values are not allowed as enum values',
    untyped: 'Unexpected enum reference $(ENUM); no type can be inferred for it',
    invalidType: 'Unexpected enum reference $(ENUM) as value for a non-enum type $(TYPE)',
  },
  'ref-unknown-var': {
    std: 'No replacement found for special variable $(ID)',
  },
  'ref-unexpected-draft-enabled': 'Composition in draft-enabled entity can\'t lead to another entity with $(ANNO)',
  'ref-rejected-on': {          // TODO: currently not used - just remove?
    std: 'Do not refer to a artefact like $(ID) in the explicit ON of a redirection', // Not used
    mixin: 'Do not refer to a mixin like $(ID) in the explicit ON of a redirection',
    alias: 'Do not refer to a source element (via table alias $(ID)) in the explicit ON of a redirection',
  },
  'ref-expected-element': {
    std: 'Expected element reference',
    magicVar: 'Only elements of variable $(ID) can be selected',
  },
  'ref-expected-direct-structure': {
    std: '$(ART) can\'t be extended because it originates from an include',
    elements: '$(ART) can\'t be extended by elements/enums because it originates from an include',
  },
  'ref-unexpected-many-navigation': {
    std: 'Unexpected navigation into arrayed structure',
  },
  'ref-unexpected-scope': {
    std: 'Unexpected parameter reference',
    calc: 'Calculated elements can\'t use parameter references',
  },
  'ref-unexpected-structured': {
    std: 'Unexpected usage of structured type $(ELEMREF)',
    expr: 'Structured elements can\'t be used in expressions',
  },
  'ref-unexpected-virtual': {
    std: 'Unexpected reference to virtual element $(NAME)', // "std" currently unused
    expr: 'Virtual elements can\'t be used in expressions',
    fkey: 'Virtual elements can\'t be used as foreign keys for managed associations',
  },
  'ref-unexpected-assoc': {
    std: 'Unexpected reference to association $(NAME)', // "std" currently unused
    unmanaged: 'Unexpected reference to an unmanaged association',
    'self-unmanaged': 'Unexpected column reference starting with $(ALIAS) to an unmanaged association',
    'with-filter': 'Unexpected reference to an association with filter',
    'self-with-filter': 'Unexpected column reference starting with $(ALIAS) to an association with filter',
    self: 'A reference to an unmanaged association is only valid when compared via $(CODE)',
    expr: 'Associations can\'t be used as values in expressions',
    'expr-comp': 'Compositions can\'t be used as values in expressions',
    'assoc-stored': 'Associations and compositions can\'t be used as values in stored calculated elements',

    'managed-filter': 'Unexpected managed association $(NAME) in filter expression of $(ID)',
    'unmanaged-filter': 'Unexpected unmanaged association $(NAME) in filter expression of $(ID)',
  },
  'ref-unexpected-calculated': {
    std: 'Unexpected reference to calculated element',
    on: 'Calculated elements (on-read) can\'t be used in ON-conditions of unmanaged associations',
    fkey: 'Calculated elements (on-read) can\'t be used as foreign keys for managed associations',
  },
  'ref-unexpected-localized': {
    std: 'Unexpected reference to localized element $(NAME)', // "std" currently unused
    calc: 'Calculated elements "on-write" can\'t refer to localized elements',
  },

  'ref-unexpected-navigation': {
    std:       'Can\'t follow association $(ID) in path $(ELEMREF) in an ON-condition; only foreign keys can be referred to, but not $(NAME)',
    unmanaged: 'Can\'t follow association $(ID) in path $(ELEMREF) in an ON-condition',
    unmanagedleaf: 'Unexpected unmanaged association as final path step of $(ELEMREF) in an ON-condition',
    'calc-non-fk':    'Can\'t follow association $(ID) in path $(ELEMREF) in a stored calculated element; only foreign keys can be referred to, but not $(NAME)',
    'calc-unmanaged': 'Can\'t follow association $(ID) in path $(ELEMREF) in a stored calculated element',
  },
  'ref-unexpected-filter': {
    std: 'Unexpected filter in path $(ELEMREF)', // unused
    'on-condition': 'ON-conditions must not contain filters, step $(ID) of path $(ELEMREF)',
    calc:  'Unexpected filter in path $(ELEMREF) of stored calculated element; only simple paths can be used here',
  },
  'ref-unexpected-args': {
    std: 'Unexpected arguments in path $(ELEMREF)', // unused
    'on-condition': 'ON-conditions must not contain parameters, step $(ID) of path $(ELEMREF)',
    calc: 'Unexpected arguments in path $(ELEMREF) of stored calculated element; only simple paths can be used here',
  },
  'ref-unsupported-type': {
    std: 'Type $(TYPE) is not supported',
    dialect: 'Type $(TYPE) is not supported for SQL dialect $(VALUE)',
    hana: 'Type $(TYPE) is only supported for SQL dialect $(VALUE), not $(OTHERVALUE)',
    hdbcds:'Type $(TYPE) is not supported in HDBCDS',
    odata: 'Type $(TYPE) is not supported for OData $(VERSION)',
  },
  'ref-unexpected-var': {
    std: 'Variable $(NAME) can\'t be used here',
    annotation: 'Variable $(NAME) can only be used in annotation values',
  },

  'rewrite-not-supported': {
    // TODO: Better text ?
    std: 'The ON-condition is not rewritten here - provide an explicit ON-condition',
    'inline-expand': 'The ON-condition is not rewritten in nested projections - provide an explicit ON-condition',
    secondary: 'The ON-condition is not rewritten due to multiple associations in this path - provide an explicit ON-condition',
  },
  'rewrite-not-projected': {
    std: 'Projected association $(NAME) uses non-projected element $(ELEMREF)',
    element: 'Projected association $(NAME) uses non-projected element $(ELEMREF) of $(ART)',
  },
  'type-unsupported-rewrite': {
    std:  'Rewriting the ON-condition not supported here', // unused: merge with 'rewrite-not-supported'
    'sub-element': 'Rewriting the ON-condition of unmanaged association in sub element is not supported',
  },
  'rewrite-undefined-key': 'Can\'t redirect association $(NAME), as redirection target $(TARGET) does not project element $(ID), which is required to match foreign key of $(NAME)',

  'type-unexpected-typeof': {
    std: 'Unexpected $(KEYWORD) for the type reference here',
    type: 'Unexpected $(KEYWORD) for the type of a type definition',
    param: 'Unexpected $(KEYWORD) for the type of a parameter definition',
    select: 'Unexpected $(KEYWORD) for type references in queries',
    annotation: '$(KEYWORD) can\'t be used in annotation definitions',
  },
  'type-unexpected-assoc': {
    std: 'An unmanaged association can\'t be used as type',
  },
  'type-missing-enum-value': {
    std: 'Missing value for non-string enum element $(NAME)',
    numeric: 'Missing value for numeric enum element $(NAME)',
  },
  'type-missing-argument': 'Missing value for argument $(NAME) in reference to type $(ID)',
  'type-ignoring-argument': 'Too many arguments for type $(ART)',
  'type-unexpected-argument': {
    std: 'Too many arguments for type $(ART)', // we use config 'type-ignoring-argument' instead
    type: 'Unexpected argument $(PROP) for type $(ART) with base type $(TYPE)',
    builtin: 'Unexpected argument $(PROP) for type $(ART)',
    'non-scalar': 'Only scalar types can have arguments',
    // TODO: the following variants look like for an upcoming type-invalid-argument:
    max: 'Expecting argument $(PROP) for type $(TYPE) to not exceed $(NUMBER)',
    min: 'Expecting argument $(PROP) for type $(TYPE) to be greater than or equal to $(NUMBER)',
    'incorrect-type': 'Expected $(NAMES) for argument $(PROP), but found $(CODE)',
  },
  'type-unexpected-foreign-keys': 'A managed aspect composition can\'t have a foreign keys specification. Use composition-of-entity or remove foreign keys',
  'type-unexpected-on-condition': 'A managed aspect composition can\'t have a specified ON-condition. Use composition-of-entity or remove the ON-condition',

  'type-invalid-items': {
    std: 'Unexpected $(PROP)', // unused
    nested: 'Unexpected $(PROP) inside $(PROP)',
    assoc: 'Unexpected association inside $(PROP)',
    comp: 'Unexpected composition inside $(PROP)',
  },

  'type-unexpected-default': {
    std: 'Unexpected $(KEYWORD) on an association/composition', // unused
    multi: 'Unexpected $(KEYWORD); expected exactly one foreign key in combination with default value, but found $(COUNT)',
    structuredKey: 'Unexpected $(KEYWORD) in combination with structured foreign key $(NAME); $(KEYWORD) requires a non-structured foreign key',
    onCond: 'Unexpected $(KEYWORD) on an association/composition with ON-condition; $(KEYWORD) requires exactly one foreign key',
    targetAspect: 'Unexpected $(KEYWORD) on composition of aspect',
    map: 'Unexpected $(KEYWORD) for type $(TYPE)',
  },
  'type-unexpected-null': {
    std: 'Unexpected default value $(VALUE) for non-nullable artifact',

    typeDefaultNull: 'Unexpected default value $(VALUE) for non-nullable type',
    typeNotNull: 'Unexpected $(KEYWORD) for type with default value $(VALUE)',
    elementDefaultNull: 'Unexpected default value $(VALUE) for non-nullable element',
    elementNotNull: 'Unexpected $(KEYWORD) for element with default value $(VALUE)',
    paramDefaultNull: 'Unexpected default value $(VALUE) for non-nullable parameter',
    paramNotNull: 'Unexpected $(KEYWORD) for parameter with default value $(VALUE)',
  },
  'type-expecting-service-target': {
    std: 'Expecting service entity $(TARGET)',
    ref: 'Expecting service entity $(TARGET); its element $(ID) referred to at line $(LINE), column $(COL) is not from an element with the same name in the provided model target',
    key: 'Expecting service entity $(TARGET); its key element $(ID) is not from a key element with the same name in the provided model target',
    missing: 'Expecting service entity $(TARGET); it does not have the key element $(ID) of the provided model target',
    order: 'Expecting service entity $(TARGET); its key elements are in a different order than those of the provided model target',
  },

  'anno-builtin': 'Builtin types should not be annotated nor extended. Use custom type instead',
  'ext-undefined-def': 'Artifact $(ART) has not been found',
  'ext-undefined-art': 'No artifact has been found with name $(ART)',
  'ext-undefined-element': {
    std: 'Element $(NAME) has not been found',
    element: 'Artifact $(ART) has no element $(NAME)',
    enum: 'Artifact $(ART) has no enum $(NAME)',
    returns: 'Return value of $(ART) has no element $(NAME)',
    'enum-returns': 'Return value of $(ART) has no enum $(NAME)',
  },
  'ext-undefined-key': 'Foreign key $(NAME) has not been found',
  'ext-undefined-action': {
    std: 'Action $(ART) has not been found',
    action: 'Artifact $(ART) has no action $(NAME)',
  },
  'ext-undefined-param': {
    std: 'Parameter $(ART) has not been found',
    param: 'Artifact $(ART) has no parameter $(NAME)',
  },

  // annotation checks against their definition
  'anno-expecting-value': {
    std:  'Expecting a value for the annotation; see annotation definition for $(ANNO)',
    type:  'Expecting a value of type $(TYPE) for the annotation',
  },

  'def-unexpected-paramview-assoc': {
    std: 'unused',
    source: 'Unexpected definition of an association in an entity with parameters',
    target: 'Expected association target to have no parameters',
  },
  'def-unexpected-nested-proj': {
    std: 'Unexpected $(CODE)',
    var: 'Unexpected $(CODE) after reference to CDS variable',
    struct: 'Unexpected $(CODE); can only be used after a reference to a structure or association',
    init: 'Unexpected $(CODE); can only be used after a reference to a structure, association or table alias',
  },
  'def-unexpected-calcview-assoc': {
    std: 'unused',
    source: 'Unexpected definition of an association in an entity annotated with $(ANNO)',
    target: 'Expected association target not to be annotated with $(ANNO)',
  },
  'def-invalid-key': {
    std: 'The current element can\'t be defined as primary key', // (unused)
    unmanaged: 'Unmanaged associations/compositions can\'t be defined as primary key',
    composition: 'Managed aspect compositions can\'t be defined as primary key',
  },
  'def-unexpected-key': {
    std: '$(ART) can\'t have additional keys',
    virtual: 'Unexpected $(PROP) for virtual element',
    // TODO: Better message?
    include: '$(ART) can\'t have additional keys (through include)',
    invalidType: 'Unexpected $(PROP) for element of type $(TYPE)',
  },
  'def-unexpected-localized': {
    std: 'Unexpected $(KEYWORD)',
    map: 'Unexpected $(KEYWORD) for map type',
    elements: '$(ART) can\'t have localized elements',
    // TODO: Better message?
    include:  '$(ART) can\'t have localized elements (through include)',
  },
  'def-unexpected-localized-struct': '$(KEYWORD) is not fully supported for structures',
  'def-unexpected-localized-anno': 'Annotations can\'t have localized elements',
  'type-unexpected-structure': {
    std: 'Unexpected structured type', // unused variant
    calc: 'A structured type can\'t be used for calculated elements',
  },
  'type-unexpected-many': {
    std: 'Unexpected arrayed type', // unused variant
    calc: 'An arrayed type can\'t be used for calculated elements',
    'calc-implicit': 'An arrayed type can\'t be used for calculated elements (due to direct reference $(ELEMREF))',
    'calc-cast': 'An arrayed type can\'t be used for calculated elements (via cast)',
  },

  'def-missing-element': {
    std: 'Expecting entity to have at least one element which is neither virtual nor calculated',
    view: 'Expecting view to have at least one non-virtual element',
  },

  'def-missing-argument': {
    std: 'Expected function $(NAME) to have $(N) arguments, received $(LITERAL)',
    alternative: 'Expected function $(NAME) to have $(N) or $(M) arguments, received $(LITERAL)',
  },

  'def-invalid-texts-aspect': {
    std: '$(ART) is not valid', // unused
    'no-aspect': '$(ART) must be an aspect',
    key: '$(ART) must be a key',
    'no-key': '$(ART) must not be key',
    missing: '$(ART) must have an element $(NAME)',
  },
  'def-invalid-element-type': {
    std: 'Element $(ELEMREF) of $(ART) must be of type $(TYPE)',
    'texts-aspect-locale': 'Element $(ELEMREF) of $(ART) must be of type $(TYPE) or $(OTHERTYPE)',
  },

  'def-expected-structured': 'Events must either be structured or be projections',

  'duplicate-definition': {
    std: 'Duplicate definition of $(NAME)',
    absolute: 'Duplicate definition of artifact $(NAME)',
    annotation: 'Duplicate definition of annotation vocabulary $(NAME)',
    element: 'Duplicate definition of element $(NAME)',
    enum: 'Duplicate definition of enum $(NAME)',
    key: 'Duplicate definition of key $(NAME)',
    action: 'Duplicate definition of action or function $(NAME)',
    param: 'Duplicate definition of parameter $(NAME)',
    alias: 'Duplicate definition of table alias or mixin $(NAME)',
    'include-elements': 'Duplicate element $(NAME) through multiple includes $(SORTED_ARTS)',
    'include-actions': 'Duplicate action or function $(NAME) through multiple includes $(SORTED_ARTS)',
  },
  'ref-invalid-element': {
    std: 'Invalid element reference',
    $tableAlias: 'Can\'t refer to source elements of table alias $(ID)',
    mixin: 'Can\'t refer to the query\'s own mixin $(ID)',
    $self: 'Can\'t refer to the query\'s own elements',
  },
  'ref-invalid-override': {
    std: 'Overridden element of include must not change its type drastically', // unused
    'new-not-structured': 'Expected element $(NAME) to be structured, because it overrides the included element from $(ART)',
    'old-not-structured': 'Expected element $(NAME) to be scalar, because it overrides the included element from $(ART)',
    missing: 'Expected element $(ID) to have at least all the same sub-elements as included artifacts, but it is missing $(NAME)',

    'new-not-target': 'Expected element $(NAME) to be an association, because it overrides the included element from $(ART)',
    'old-not-target': 'Expected element $(NAME) not to be an association, because it overrides the included element from $(ART)',
  },

  'ref-expecting-$self': 'Use $(NEWCODE) instead of $(CODE) here or remove $(CODE) altogether if possible; the compiler has rewritten it to $(NEWCODE) in CSN',
  'ref-expecting-assoc': {
    std: 'Expecting path $(ELEMREF) following “EXISTS” predicate to end with association/composition',
    'with-type': 'Expecting path $(ELEMREF) following “EXISTS” predicate to end with association/composition, found $(TYPE)',
  },
  'ref-expecting-const': 'A constant expression or variable is expected here',
  'ref-expecting-foreign-key': 'Expecting foreign key access after managed association $(NAME) in filter expression of $(ID), but found $(ALIAS)',
  'ref-invalid-target': {
    std: 'Expecting an entity as target',
    composition: 'Expecting an entity or aspect as composition target',
    bare: 'Expecting the target aspect to have elements',
    aspect: 'Expecting an aspect in property $(PROP)', // `targetAspect` in CSN input
    redirected: 'Expecting an entity as target; a target aspect can\'t be specified for redirections',
    // a `target aspect alone` would be more correct, but confusing if in `target`
    // property, which is the standard (extra text variants would be too much):
    entity: 'Expecting an entity as target; a target aspect can\'t be specified for projection elements',
    event: 'Expecting an entity as target; a target aspect can\'t be specified in an event',
    select: 'Expecting an entity as target; a target aspect can\'t be specified in a query',
    type: 'Expecting an entity as target; a target aspect can\'t be specified for a type',
    param: 'Expecting an entity as target; a target aspect can\'t be specified for a parameter',
    annotation: 'Expecting an entity as target; a target aspect can\'t be specified for an annotation',
    sub: 'Expecting an entity as target; a target aspect can\'t be specified for a sub element',
  },
  'ref-invalid-include': {
    std: 'An explicitly structured entity, type, aspect, or event is expected here',
    bare : 'An aspect without elements is expected here',
    param: 'A type, entity, aspect or event without parameters is expected here',
  },
  'ref-invalid-type': {
    std: 'A type or an element is expected here',
    param: 'A type, an element, or a service entity is expected here',
    event: 'A type, an element, an event, or a service entity is expected here',
  },
  'ref-invalid-source': {
    std: 'A query source must be an entity or an association element',
    event: 'An event\'s projection source must be an entity, structured type, aspect, event, or an association element',
    type: 'A type\'s projection source must be an entity, structured type, aspect, event, or an association element',
  },
  'extend-columns': {
    std: 'Artifact $(ART) can\'t be extended with columns, only simple views/projections without JOINs and UNIONs can',
    join: 'Artifact $(ART) can\'t be extended with columns, because it contains a JOIN',
    union: 'Artifact $(ART) can\'t be extended with columns, because it contains a UNION',
  },
  'extend-repeated-intralayer': 'Unstable element order due to repeated extensions in same layer',
  'extend-unexpected-include': 'Can\'t extend $(META) with includes',

  'ext-duplicate-same-file': 'Duplicate extension with $(PROP) in same file',
  'ext-duplicate-extend-type': 'Duplicate type extension for type $(TYPE)',
  'ext-duplicate-extend-type-unrelated-layer': 'Duplicate type extension for type $(TYPE)',
  'ext-invalid-type-property':  {
    std: 'Type property $(PROP) can only be extended',
    indirect: 'Type property $(PROP) can only be extended if directly provided at the definition',
    'new-prop': 'Type property $(PROP) can only be extended, not added',
    string: 'Only numerical properties can be extended, but found string for $(PROP)',
    number: 'Value of type property $(PROP) must be $(NUMBER) or higher, it can\'t be smaller than originally provided',
    scale: 'With the extension for type property $(OTHERPROP), the value of $(PROP) must be $(NUMBER) or higher',
  },
  'ext-missing-type-property': 'Type extension with property $(PROP) must also have property $(OTHERPROP) because $(ART) has both',

  'ref-expected-scalar-type': {
    std: 'Only scalar type definitions can be extended with type properties',
    unsupported: 'Only integer-, decimal-, binary-, and string-types can be extended but found $(PROP)',
    inferred: 'Only direct types can be extended',
  },

  'query-undefined-element': {
    std: 'Target $(TARGET) of $(NAME) is missing element $(ID); use $(KEYWORD) with an explicit ON-condition',
    redirected: 'Target $(TARGET) of $(NAME) is missing element $(ID); add an ON-condition to $(KEYWORD)',
  },
  'query-unexpected-assoc-hdbcds': 'Publishing a managed association in a view is not possible for “hdbcds” naming mode',    // eslint-disable-line cds-compiler/message-no-quotes
  'query-unexpected-structure-hdbcds': 'Publishing a structured element in a view is not possible for “hdbcds” naming mode', // eslint-disable-line cds-compiler/message-no-quotes
  'query-ignoring-param-nullability': {
    std: 'Ignoring nullability constraint on parameter when generating SAP HANA CDS view',
    sql: 'Ignoring nullability constraint on parameter when generating SQL view',
  },
  'query-ignoring-filter': {
    std: 'Ignoring filter on published association due to explicit redirection', // unused
    onCond: 'Ignoring filter on published association due to explicit redirection with ON-condition',
    fKey: 'Ignoring filter on published association due to explicit redirection with explicit foreign keys',
  },
  'query-expected-identifier': {
    std: 'Expected identifier for select item',
    assoc: 'Expected identifier as the association\'s name',
  },
  'query-unsupported-calc': {
    std: 'Using nested projections next to calculated elements is not supported, yet',
    inside: 'Using calculated elements in nested projections is not supported, yet',
  },
  'query-mismatched-element': {
    std: 'Specified element $(NAME) differs from inferred element in property $(PROP)',
    type: 'Expected type of specified element $(NAME) to be the same as the inferred element\'s type',
    typeName: 'Expected type $(TYPE) of specified element $(NAME) to be the same as the inferred element\'s type $(OTHERTYPE)',
    typeExtra: 'Element $(NAME) does not have an inferred type property, but an unexpected type $(TYPE) was specified',
    missing: 'Specified element $(NAME) differs from inferred element: it is missing property $(PROP)',
    extra: 'Specified element $(NAME) differs from inferred element: it has an additional property $(PROP)',
    target: 'Expected target $(TARGET) of specified element $(NAME) to be the same as the inferred element\'s target $(ART)',
    foreignKeys: 'Expected foreign keys of specified element $(NAME) to be the same as the inferred element\'s foreign keys',
    unmanagedToManaged: 'Unexpected foreign keys in specified element $(NAME); inferred element is a managed association',
    prop: 'Value for $(PROP) of the specified element $(NAME) does not match the inferred element\'s value',
    enumExtra: 'Specified element $(NAME) differs from inferred element: it has an additional enum element $(ID)',
    enumVal: 'Specified element $(NAME) differs from inferred element: it has a different value for enum element $(ID)',
  },
  'query-unexpected-property': {
    std: 'Unexpected property $(PROP) in the specified element $(NAME)',
    calculatedElement: 'Unexpected property $(PROP) in the specified element $(NAME); calculated elements are not supported in queries',
  },
  'query-ignoring-assoc-in-union': {
    managed: 'Ignoring managed association $(NAME) that is published in a UNION',
    std: 'Ignoring association $(NAME) that is published in a UNION',
  },
  'query-missing-element': {
    std: 'Element $(ID) is missing in specified elements',
    enum: 'Enum $(ID) is missing in specified enum values',
    foreignKeys: 'Foreign key $(ID) is missing in specified foreign keys',
  },
  'query-unspecified-element': {
    std: 'Element $(ID) does not result from the query',
    foreignKeys: 'Foreign key $(ID) does not result from the query',
  },

  // ID published! Used in stakeholder project; if renamed, add to oldMessageIds
  'redirected-to-complex': {
    std: 'Redirection involves the complex view $(ART); add an explicit ON-condition/foreign keys to redirection',
    target: 'The redirected target $(ART) is a complex view; add an explicit ON-condition/foreign keys to redirection',
    targetOp: 'The redirected target $(ART) is a complex view with $(KEYWORD); add an explicit ON-condition/foreign keys to redirection',
  },

  'ref-sloppy-target': 'An entity or an aspect (not type) is expected here',

  'ref-ambiguous': {
    std: 'Replace ambiguous $(ID) by $(NAMES)',
    few: 'Replace ambiguous $(ID) by $(NAMES) or a new table alias for sub-queries that don\'t have one',
    none: 'Ambiguous $(ID) requires an explicit table alias, but there are none: add table aliases to all sub-queries to disambiguate $(ID)',
  },

  'ref-special-in-extend': {
    std: 'In an added column, $(ID) refers to the element of the projection source $(ART), not the table alias or mixin',
    alias: 'In an added column, $(ID) refers to the element of the projection source $(ART), not the table alias',
    mixin: 'In an added column, $(ID) refers to the element of the projection source $(ART), not the mixin',
  },

  'type-managed-composition': {
    std: 'Managed compositions can\'t be used in types', // yet
    sub: 'Managed compositions can\'t be used in sub elements',
    aspect: 'Aspect $(ART) with managed compositions can\'t be used in types', // yet
    entity: 'Entity $(ART) with managed compositions can\'t be used in types', // yet
  },

  'type-unsupported-key-sqlite': {
    std: 'Added element $(ID) is a primary key change and will not work with dialect $(NAME)',
    changed: 'Changed element $(ID) is a primary key change and will not work with dialect $(NAME)',
  },

  'type-invalid-cast': {
    std: 'Can\'t cast to $(TYPE)',
    'to-structure': 'Can\'t cast to a structured type',
    'from-structure':  'Structured elements can\'t be cast to a different type',
    'expr-to-structure': 'Can\'t cast an expression to a structured type',
    'val-to-structure': 'Can\'t cast $(VALUE) to a structured type',
    'from-assoc': 'Invalid type cast on an association',
    assoc: 'Can\'t cast to an association',
  },

  // -----------------------------------------------------------------------------------
  // Expressions
  // -----------------------------------------------------------------------------------
  'type-invalid-cardinality': {
    std: 'Invalid value $(VALUE) for cardinality', // unused variant
    sourceMax: 'Invalid value $(PROP) for maximum source cardinality, expecting a positive number or $(OTHERPROP)',
    targetMax: 'Invalid value $(PROP) for maximum target cardinality, expecting a positive number or $(OTHERPROP)',
    targetMin: 'Invalid value $(PROP) for minimum target cardinality, expecting a non-negative number',
    sourceMin: 'Invalid value $(PROP) for minimum source cardinality, expecting a non-negative number',
    sourceVal: 'Source minimum cardinality must not be greater than source maximum cardinality',
    targetVal: 'Target minimum cardinality must not be greater than target maximum cardinality',
  },

  'i18n-different-value': 'Different translation for key $(PROP) of language $(OTHERPROP) in unrelated layers',

  'expr-missing-foreign-key': {
    std: 'Path step $(ID) of $(ELEMREF) has no valid foreign keys',
    publishingFilter: 'Can\'t publish managed association $(ID) with filter, as it must have at least one foreign key',
  },

  // tenenat isolation via discriminator column:
  'tenant-invalid-alias-name': {
    std: 'Can\'t have a table alias named $(NAME) in a tenant-dependent entity',
    implicit: 'Provide an explicit table alias name; do not use $(NAME)',
    mixin: 'Can\'t define a mixin named $(NAME) in a tenant-dependent entity',
  },
  'tenant-invalid-composition': {
    std: 'Can\'t define a composition of a tenant-independent entity $(TARGET) in a tenant-dependent entity',
    type: 'Can\'t use type $(TYPE) with a composition of a tenant-independent entity in a tenant-dependent entity',
  },
  'tenant-invalid-target': {
    std: 'Can\'t define an association to a tenant-dependent entity $(TARGET) in a tenant-independent entity',
    type: 'Can\'t use type $(TYPE) with an association to a tenant-dependent entity in a tenant-independent entity',
  },

  // -----------------------------------------------------------------------------------
  // OData Message section starts here
  // -----------------------------------------------------------------------------------
  // OData version dependent messages
  'odata-unexpected-array': 'Unexpected array type for OData $(VERSION)',
  'odata-invalid-param-type' : 'Expected parameter to be typed with either scalar or structured type for OData $(VERSION)',
  'odata-invalid-return-type': 'Expected $(KIND) to return one or many values of scalar, complex, entity or view type for OData $(VERSION)',
  'odata-unexpected-assoc': 'Unexpected association in structured type for OData $(VERSION)',
  'odata-incomplete-constraints': 'Partial referential constraints produced for OData $(VERSION)',
  'odata-invalid-name': {
    std: 'Expected OData name $(ID) to start with an alphabetic character or underscore, followed by a maximum of 127 alphabetic characters, digits, or underscores',
    v2firstChar: 'Unexpected first character $(PROP) of OData name $(ID) for OData $(VERSION)',
  },
  'odata-invalid-vocabulary-alias': 'Expected value $(VALUE) of OData vocabulary reference attribute $(ID) to start with an alphabetic character or underscore, followed by a maximum of 127 alphabetic characters, digits, or underscores',
  'odata-invalid-qualifier': 'Expected OData annotation qualifier $(ID) to start with an alphabetic character or underscore, followed by a maximum of 127 alphabetic characters, digits, or underscores',
  // version independent messages
  'odata-unexpected-nullable-key': {
    std: 'Expected key element $(NAME) to be not nullable', // flat
    scalar: 'Expected key element $(NAME) to be not nullable', // structured
  },
  'odata-unexpected-arrayed-key': {
    std: 'Unexpected array type for primary key $(NAME)',
    assoc: 'Unexpected target cardinality $(VALUE) for primary key $(NAME)',
  },
  'odata-invalid-key-type': {
    std: 'Unexpected $(TYPE) mapped to $(ID) as type for key element $(NAME)', // structured
    scalar: 'Unexpected $(TYPE) mapped to $(ID) as type for key element', // flat
  },
  'odata-missing-key': 'Expected entity to have a primary key',
  'odata-unknown-edm-type': 'Unknown EDM Type $(TYPE)',
  'odata-unexpected-edm-type': {
    std: 'Unexpected EDM Type $(TYPE) for OData $(VERSION)',
    anno: 'Unexpected EDM Type $(TYPE) for OData $(VERSION) in $(ANNO)',
  },
  'odata-missing-type': 'Expected element to have a type',
  'odata-unexpected-edm-facet': {
    std: 'Unexpected EDM Type facet $(NAME) of type $(TYPE) for OData $(VERSION)',
    anno: 'Unexpected EDM Type facet $(NAME) of type $(TYPE) for OData $(VERSION) in $(ANNO)',
  },
  'odata-invalid-external-type': 'Referenced type $(TYPE) marked as $(ANNO) can\'t be rendered as $(CODE) in service $(NAME) for OData $(VERSION)',
  'odata-invalid-scale': {
    std: 'Expected scale $(NUMBER) to be less than or equal to precision $(RAWVALUE)',
    anno: 'Expected scale $(NUMBER) to be less than or equal to precision $(RAWVALUE) in $(ANNO)',
  },
  'odata-invalid-property-name': 'Expected element name to be different from declaring $(META)',
  'odata-invalid-service-name': {
    std: 'Expected service name not to be one of the reserved names $(NAMES)',
    length: 'Expected service name not to exceed 511 characters',
  },
  // Other odata/edm errors
  'odata-duplicate-proxy': 'No proxy entity created due to name collision with existing definition $(NAME) of kind $(KIND)',
  'odata-duplicate-definition': {
    std: 'Entity can\'t be created due to name collision with existing definition $(NAME)',
    anno: 'Name of annotation definition $(ANNO) conflicts with existing service definition',
  },
  'odata-navigation': {
    std: 'No OData navigation property generated, target $(TARGET) is outside of service $(SERVICE)',
    onCond: 'No OData navigation property generated for association with arbitrary ON-condition and target $(TARGET) outside of service $(SERVICE)',
  },
  'odata-parameter-order': 'Unexpected mandatory after optional parameter',
  'odata-key-recursive': 'Unexpected recursive key $(NAME)',
  'odata-key-uuid-default-anno': 'Expected element of type $(TYPE) to be annotated with $(ANNO) when used as primary key in $(ID)',
  'odata-ignoring-param-default': {
    std: 'Ignoring default value',
    xpr: 'Ignoring unexpected expression as default value',
    colitem: 'Ignoring unexpected default value for a structured or collection like parameter',
  },
  // -----------------------------------------------------------------------------------
  // All odata-anno MUST have a '$(ANNO)' parameter to indicate error location
  // -----------------------------------------------------------------------------------
  // Annotation Preprocessing:
  // -----------------------------------------------------------------------------------
  'odata-anno-preproc': {
    std: 'unused message text',
    nokey: 'Expected target $(NAME) to have a key element for $(ANNO)',
    multkeys: 'Expected target $(NAME) to have only one key element for $(ANNO)',
    vhlnokey: 'Expected value help list entity $(NAME) to have a key element for $(ANNO)',
    vhlmultkeys: 'Expected value help list entity $(NAME) to have only one key element for $(ANNO)',
    notforentity: 'Unexpected usage of $(ANNO) for an entity',
    viaassoc: 'Expected value to be a path for $(ANNO)',
    noassoc: 'Expected association $(ID) to exist for $(ANNO)',
    vallistignored: '$(NAME) is ignored for $(ANNO) as $(CODE) is present',
    notastring: 'Expected value to be a string for $(ANNO)',
    notexist: 'Expected entity $(ID) to exist for $(ANNO)',
    txtarr: 'Expected $(ANNO) shortcut to have a $(NAME) annotation',
  },
  // -----------------------------------------------------------------------------------
  // GenericTranslation:
  // -----------------------------------------------------------------------------------
  'odata-anno-dict': {
    // ANNO w/o sub elements, term qualifiers and context stack
    std: 'Vocabulary dictionary inconsistency: Type $(TYPE) not found for $(ANNO)',
    experimental: '$(ANNO) is experimental and can be changed or removed at any time, do not use productively!',
    redefinition: '$(ANNO) is an official OASIS/SAP annotation and can\'t be redefined',
  },
  'odata-anno-vocref': {
    std: 'Vocabulary reference $(ID) doesn\'t match alias $(NAME), reference is ignored',
    redef: 'Vocabulary reference $(ID) is the alias of the official OASIS/SAP vocabulary $(TYPE) which can\'t be redefined, reference is ignored',
    service: 'Vocabulary reference collides with service $(NAME), reference is ignored',
    malformed: 'Vocabulary reference $(ID) has invalid or missing value for attribute $(NAME), reference is ignored',
  },
  'odata-anno-dict-enum': {
    std : 'Unexpected annotation definition $(NAME) with many enum type',
    type: 'Unexpected annotation definition $(NAME) with many enum type $(TYPE)',
    value: 'Expected all enum elements of type $(TYPE) to have a value in annotation definition $(NAME)',
  },
  'odata-anno-value': {
    nested: 'Missing $(STR) annotation for $(ANNO)',
    // -----------------------------------------------------------------------------------
    // All messages of odata-anno-value below here MUST have $(ANNO) filled with msgctx.anno
    // -----------------------------------------------------------------------------------
    enum: 'Value $(VALUE) is not one out of $(RAWVALUES) for $(ANNO) of type $(TYPE)',
    std: 'Unexpected value $(VALUE) for $(ANNO) of type $(TYPE)',
    incompval: 'Unexpected $(STR) value for $(ANNO) of type $(TYPE)',
    nestedCollection: 'Nested collections are not supported for $(ANNO)',
    enuminCollection: 'Enum inside collection is not supported for $(ANNO)',
    multexpr: 'EDM JSON code contains more than one dynamic expression: $(RAWVALUES) for $(ANNO)',
  },
  'odata-anno-type': {
    std: '$(NAME) is not a known property for $(ANNO) of type $(TYPE)',
    unknown: '$(TYPE) is not a known vocabulary type for $(ANNO)',
    abstract: 'Unexpected abstract type $(TYPE) for $(ANNO), use $(CODE) to specify a concrete type',
    derived: 'Expected specified $(TYPE) to be derived from $(NAME) for $(ANNO)',
    literal: 'Expected value $(RAWVALUE) of specified $(CODE) to be a string literal for $(ANNO)',
  },
  'odata-anno-def': {
    // All $(ANNO) w/o sub elements, term qualifiers and context stack
    std: '$(ANNO) is not a known annotation in an official OASIS/SAP namespace',
    deprecated: '$(ANNO) is deprecated. $(DEPR)',
    notapplied: '$(ANNO) is not applied (AppliesTo: $(RAWVALUES))',
  },
  'odata-anno-xpr': {
    std: 'unused',
    notadynexpr: '$(OP) is not a renderable dynamic expression in $(ANNO)',
    use: 'Function $(OP) is not a renderable dynamic expression in $(ANNO), use $(CODE) instead',
    canonfuncalias: 'Expected function name $(CODE) to be of the form $(META).$(OTHERMETA) for $(OP) in $(ANNO)',
    unexpected: 'Unexpected expression in $(ANNO)',
  },
  'odata-anno-xpr-type': {
    std: 'Expected one qualified type name for $(OP) in $(ANNO)',
    edm: 'Expected a qualified EDM type name for $(OP) in $(ANNO) but found $(TYPE)',
  },
  'odata-anno-xpr-args': {
    std: 'Unexpected arguments for $(OP) in $(ANNO)',
    exactly: 'Expected exactly $(COUNT) argument(s) for $(OP) in $(ANNO)',
    atleast: 'Expected at least $(COUNT) argument(s) for $(OP) in $(ANNO)',
    atmost: 'Expected at most $(COUNT) argument(s) for $(OP) in $(ANNO)',
    wrongcount: 'Expected exactly one $(PROP) for $(OP) in $(ANNO)',
    wrongval: 'Unexpected value for $(OP) in $(ANNO)',
    wrongval_meta: 'Expected value for $(OP) to be a $(META) in $(ANNO)',
    wrongval_meta_list: 'Expected value for $(OP) to be a $(META) or $(RAWVALUES) in $(ANNO)',
  },
  'odata-anno-xpr-ref': {
    std: '$(ANNO) can\'t be propagated to $(NAME) because path $(ELEMREF) is not resolvable via type reference $(CODE)',
    args: 'Unexpected arguments or filters in $(ELEMREF) in $(ANNO)',
    flatten_builtin: 'Expected path $(ELEMREF) in $(ANNO) to end in a scalar typed leaf element while flattening $(NAME)',
    flatten_builtin_type: 'Expected path $(ELEMREF) in $(ANNO) to end in a scalar typed leaf element while flattening',
    invalid: 'Invalid path $(ELEMREF) in $(ANNO)',
    // genericTranslation
    notaparam: 'EDM Element path $(ELEMREF) can\'t be used in $(ANNO) which is applied to a parameter entity',
    notaneelement: 'EDM Parameter path $(ELEMREF) can\'t be used in $(ANNO) which is applied to a type entity',
    notrendered: 'EDM Path step $(COUNT) of $(ELEMREF) in $(ANNO) refers to an unrendered property in the OData API',
    magic: 'Unexpected magic variable $(ELEMREF) in $(ANNO)',
    bparam_v2_expl: 'Unexpected explicit binding parameter path $(ELEMREF) for OData $(VERSION) in $(ANNO)',
    bparam_v2_impl: 'Unexpected implicit binding parameter path $(ELEMREF) for OData $(VERSION) in $(ANNO)',
    // forOdata/generateForeignKeys
    fk_substitution: 'Expected foreign key path $(ELEMREF) in $(ANNO) to end in a scalar typed leaf element',
  },
  // -----------------------------------------------------------------------------------
  // OData Message section ends here, no messages below this line
  // -----------------------------------------------------------------------------------
  // -----------------------------------------------------------------------------------
  // to.sql.migration specific error messages
  // -----------------------------------------------------------------------------------
  'migration-unsupported-key-change': {
    std: 'Added element $(ID) is a primary key change and will not work if the table contains data',
    changed: 'Changed element $(ID) is a primary key change and will not work if the table contains data',
  },
  'migration-unsupported-precision-change': {
    std: 'Changed element $(ID) is a lossy precision change and is not supported',
    script: 'Changed element $(ID) is a lossy precision change and might lead to data loss',
  },
  'migration-unsupported-element-drop': {
    std: 'Dropping elements is not supported',
    script: 'Dropping elements leads to data loss',
  },
  'migration-unsupported-length-change': {
    std: 'Changed element $(ID) is a length reduction and is not supported',
    script: 'Changed element $(ID) is a length reduction and might lead to data loss',
  },
  'migration-unsupported-scale-change': {
    std: 'Changed element $(ID) is a lossy scale change and is not supported',
    script: 'Changed element $(ID) is a lossy scale change and might lead to data loss',
  },
  'migration-unsupported-change': {
    std: 'Changed element $(ID) is a lossy type change from $(NAME) to $(TYPE) and is not supported',
    script: 'Changed element $(ID) is a lossy type change from $(NAME) to $(TYPE) and might lead to data loss',
  },
  'migration-unsupported-table-drop': {
    std: 'Dropping tables is not supported',
    script: 'Dropping tables leads to data loss',
  },
  // -----------------------------------------------------------------------------------
  // to.sql.migration specific error messages end here
  // -----------------------------------------------------------------------------------
};

/**
 * Configuration for a message in the central message register.
 *
 * @typedef {object} MessageConfig
 * @property {MessageSeverity} severity Default severity for the message.
 * @property {string[]|'deprecated'|'v4'|'test'|true} [configurableFor]
 *        Whether the error can be reclassified to a warning or lower.
 *        If not `true` then an array is expected with specified modules in which the error is downgradable.
 *        Only has an effect if default severity is 'Error'.
 *        'deprecated': severity can only be changed with deprecated.downgradableErrors.
 * @property {string[]} [errorFor] Array of module names where the message shall be reclassified to an error.
 * @property {boolean} [throughMessageCall]
 *        If set, it means that a message-id was added to the registry in test-mode through a `message.<severity>()`
 *        call.  Used for ensuring that all calls with the same message-id have the same severity.
 * @property {string[]} [oldNames] Aliases for the message id. Used for reclassification as well as "explain" messages.
 *                                 Don't set this property directly! Append to object oldMessageIds instead!
 */

// console.log('FOO')

module.exports = { centralMessages, centralMessageTexts, oldMessageIds };
