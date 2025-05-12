# ChangeLog for cds compiler and backends

<!-- markdownlint-disable MD024 -->
<!-- markdownlint-disable MD004 -->
<!-- (no-duplicate-heading)-->

Note: `beta` fixes, changes and features are usually not listed in this ChangeLog but [here](doc/CHANGELOG_BETA.md).
The compiler behavior concerning `beta` features can change at any time without notice.

## Version 6.0.2 - Pre-release version - 2025-05-05

### Changed

- Namespace `cds.core` is no longer reserved by the cds-compiler. It is used by the CAP runtimes.
- Node 20 is now the minimum required version.
- compiler
  + Providing a filter for a function call now is a syntax error (was a warning before).
    Example: `count(*)[ uncheckedFilterRef > 0 ]`.
  + Providing a default value for an array-like action or function parameter is a syntax error now
    (was a warning  before). Example: `action A( par: many Integer default 42 )`.
  + Providing an annotation for an array-like element inside the type expression is no longer allowed
    (was a warning before), as this leads to unexpected results. Example: `bar: many String null @anno enum { symbol };`.
    Fix this by moving the annotation out of the type expression, e.g. before the element name.
  + A simple query inside parentheses (e.g. `entity V as (select from E)`) is no longer
    represented as `set` in CSN. Repeated `order by` or `limit` clauses are no longer allowed
    (e.g. `entity V as ( select from E order by id ) order by id;`).
  + Defining an element or parameter as `not null default now` now is an error.
  + A virtual element can be defined in a view without providing a value or reference.
    ```cds
    entity V as select from E { virtual a } //defines virtual element 'a'
    ```
    In this example, the compiler no longer tries to resolve the name of the virtual element as reference
    to an element of the view's data source.
  + If a select item selects an element of a virtual structure that itself is not explicitly marked as virtual,
    then the select item must be explicitly marked as virtual, too.
  + To-many associations without ON-condition no longer get a `keys` property, i.e. `Association to many Foo;` does not get
    any foreign keys.
  + Annotation `@cds.persistence.journal` is now propagated to generated entities, including `.texts` entities.
  + Doc Comments are no longer propagated; use option `propagateDocComments: true` to propagate them again.
- to.sql/to.hdi:
  + Default for option `booleanEquality` is `true`, i.e. `!=` is rendered as `IS DISTINCT FROM`
    or a similar expression and therefore has boolean logic instead of three-valued logic.
  + To-many associations with neither an explicit foreign key list (i.e. without `keys`) nor an ON-condition
    are reported as errors.
  + For SAP HANA, CDS associations are by default no longer reflected in the respective database tables and views by
    native HANA Associations (HANA SQL clause `WITH ASSOCIATIONS`). They can be switched on via configuration
    `cds.sql.native_hana_associations: true`.
  + A set of OData and SAP HANA functions are translated to database-specific variants.
    See <https://cap.cloud.sap/docs/guides/databases#standard-database-functions>.
- to.cdl:
  + Nested definition rendering is now the default, i.e. definitions inside services are
    rendered in `service { … }`, instead of being rendered top-level using their absolute name.
  + `to.cdl` no longer returns an entry `namespace`, only `model`.
- for.odata/to.edm(x): References to foreign keys in annotation expressions are now adjusted to directly
  reference the corresponding foreign key.

### Removed

- compiler:
  + v5 deprecated flags were removed, see [CHANGELOG_DEPRECATED.md](doc/CHANGELOG_DEPRECATED.md).
  + Option `compositionIncludes` is removed, as its default is `true`; instead, a deprecated flag was added.
- to.hdbcds: The HDBCDS backend is deprecated and can no longer be invoked.

## Version 5.9.2 - 2025-04-04

### Fixed

- to.edm(x): Revert addition of the attribute sap:filterable="false" to the NavigationProperty DraftAdministrativeData in OData V2

## Version 5.9.0 - 2025-03-28

### Added

- compiler:
  + Generated entities for compositions of named aspects now have an `include` on the named aspect,
    inheriting actions from the aspect.  This can be disabled via option `compositionIncludes: false`.
  + A warning is emitted for selected elements that are explicitly `virtual`, whose
    behavior will change in cds-compiler v6.
  + New warning for structures having a scalar default value.
  + New warning for localized structures, as they are not fully supported by the compiler.
  + The new parser (`newParser: true`) now supports operator `==`.
- to.cdl:
  + Definitions can now be rendered nested in services. A common namespace can be extracted, too.
    To use it, enabled options `renderCdlDefinitionNesting` and `renderCdlCommonNamespace`.
  + Annotation array values are pretty-printed to reduce whitespace.
- for.effective: Property `namespace` is no longer part of effective CSN.
- for.sql/hdi:
  + The new operator `==` is rendered as `IS NOT DISTINCT FROM` or an equivalent expression.
  + Using option `booleanEquality`, operator `!=` is rendered as `IS DISTINCT FROM` or an equivalent expression.

### Changed

- Update OData vocabularies: 'Common', 'Hierarchy'

### Fixed

- to.odata: Annotation expressions using `LabeledElement` were not correctly rendered into EDMX.

## Version 5.8.2 - 2025-03-07

### Fixed

- for.odata: Generate foreign key elements for events again.

## Version 5.8.0 - 2025-02-27

### Added

- Type definitions can now be projections on other types, i.e. `type Proj : projection on OtherType { elem }`.  
  Use it to create types based on other types, e.g. by selecting only certain elements.  
  Only available with the new parser (`newParser: true`)
- Analyze enum symbols like `#ENUM_SYMB` in all (sub) expressions and conditions.
  It can be validated if the compiler can deduce its `enum` type from its use context:
  + when the enum symbol is used as `default` value, `select` column expression,
    argument when navigating along an association to an entity with a parameter,
    or argument of a `cast` function call, or
  + when the enum symbol is compared to a reference or `cast` function call; we
    consider the operators `=`, `<>`, `!=`, `in`, `not in` and also analyze enum
    symbols as `when` operands if the `case` operand is a reference/`cast`.
  + We not only consider simple enum symbols, but also lists of enum symbols (on
    the right side of `in`/`not in`), and a `case … end` (sub) expression with
    enum symbols after the `then`s and/or the `else`.
  + An enum symbol can be validated if the deduced type is a direct or indirect
    `enum` type, or an managed association with one foreign key having an `enum` type.
  + For the effects in the compiler, IDE and backends, see the changelog entry for v5.7.0.
    Hint: the deprecated hdbcds backend does not support enum symbols.
  + Remark: the support for enum symbols used as annotation values is still limited.
- to.sql.migration: Allow extending `precision` of `cds.Decimal` and allow extending
  `scale` if `precision` is increased by at least the same amount.
- to.edm(x): `@assert.range` now supports "exclusive" values by writing values
  in parentheses such as `[ (1), (2) ]`, as well as "infinite" by using `[ _, _ ]`.
- for.odata/to.edm(x)/for.seal: Propagate annotation expressions from managed associations
  to the foreign keys

### Changed

- Top-level CSN property `csnInteropEffective` is ignored and no longer warned about.
- Update OData vocabularies: 'Analytics', 'Common', 'Hierarchy', 'UI'

### Fixed

- New CDL parser: parse all entity definitions using `projection on` without a
  terminating `;` if they had been accepted by the old parser, i.e. for compatibility,
  we gave up the idea of removing the existing special handling in this case.
- Old and new parser: issue a warning for an ignored filter on the result
  of a function or method call.
- CSN annotation expressions with value `true` for `=` were not checked.
- Annotation `@Core.Computed` was not set for select items that are paths into structured parameters.
- Annotation expression path rewriting has been improved.
  + Paths on foreign keys are rewritten.
- for.seal:
  + References into structured parameters were incorrectly flattened.
  + Set `@cds.persistence.name` only on persistence-relevant things.

## Version 5.7.4 - 2025-02-05

### Fixed

- New CDL Parser (option `newParser: true`)
  + Improve code completion
  + Fix further edge cases in error recovery


## Version 5.7.2 - 2025-01-30

### Fixed

- Fix edge case in error recovery of the new CDL parser (option `newParser: true`)


## Version 5.7.0 - 2025-01-24

### Added

- Analyze enum symbols like `#ENUM_SYMB`; support starts at the following places:
  + used as sole `default` value or `select` column expression
    if the element/column has a specified enum type, or
  + used as sole value (in parentheses) of an annotation assignment
    if there is a definition for that annotation having an enum type;
  + effects in compiler: complain if enum symbol is undefined
  + effects in the IDE with an upcoming version of cds-lsp when compiler option `newParser` is set:
    offer code completion and hover information,
  + effects in backends like `to.sql` (and potentially runtimes): enum symbol
    is replaced by corresponding string/integer value when appropriate.
- for.seal: Process foreign key annotations similar to to.edm(x)

### Changed

- CDL parser: it is now recommended to set the option `newParser` to make the compiler
  use a CDL parser with a significantly smaller footprint (among other things).
  New features might only work if this option is set, see above.

### Fixed

- CDL parser: doc comment parser was susceptible to ReDos
- to.sql/hdi: Paths inside calculated elements that are simple functions were not properly rewritten.
- for.odata: Re-add foreign keys in property `targetAspect` in the OData CSN.
- to.edm(x): In annotation translation, by default map `SemanticObjectMappingAbstract` to `SemanticObjectMappingType` to avoid regressions.
- to.cdl: Fix quoting of identifier `many` in `Composition of`/`Association to`
- for.seal: Allow annotation paths to end in `many`-elements, not just scalar, like we allow in for.odata

## Version 5.6.0 - 2024-12-12

### Added

- Allow to refer to draft state element `HasActiveEntity` and `HasDraftEntity` via variable `$draft` in annotation path expressions.
- for.odata|to.edm(x): Introduce annotating the generated foreign keys

### Changed

- Update OData vocabularies: 'Common', 'EntityRelationship', 'UI'

## Version 5.5.2 - 2024-12-02

### Fixed

- to.hdi|sql|edm[x]: Correctly handle `cds.Map`, ensure that it does not have `.elements` yet.

## Version 5.5.0 - 2024-11-22

### Added

- CDL parser: when the new experimental option `newParser` is used, the compiler
  uses a CDL parser with a significantly smaller footprint (among other things).
- to.sql|hdi.migration: For SAP HANA, render `ALTER` statements as one big statement to improve performance.
- to.sql.migration: Give more helpful comments when using option `script`.

### Changed

- Update OData vocabularies: 'Common', 'PersonalData', 'UI'.

## Version 5.4.4 - 2024-11-14

### Fixed

- Re-allow referring to mixins (and table aliases) in added columns
- Re-add foreign keys of named aspects to the OData CSN.


## Version 5.4.2 - 2024-11-06

### Fixed

- to.sql: For SQLite, map `cds.Map` to `JSON_TEXT` to ensure text affinity.

## Version 5.4.0 - 2024-10-24

### Added

- to.edm(x): `cds.Map` as empty open complex type with name `cds_Map` or if the definition
  has been assigned `@open: false` as empty closed complex type `cds_Map_closed` in OData V4.

### Changed

- Update OData vocabularies: 'Capabilities', 'Common', 'Core', 'PersonalData', 'PDF', 'UI'.
- to.cdl: Identifiers using non-ASCII unicode characters, as introduced in v4.4.0, are no longer quoted.
- For propagated expressions as annotation values, the `=` is changed as well, if it is a simple identifier.

### Fixed

- compiler: Some invalid CDL snippets could crash the parser and compiler.
- to.edm(x): OData V2: `Core.Links` watermark annotation has a `xmlns` attribute now.
- for.seal: Remove unapplied extensions from CSN.
- to.sql.migration: Handle `ALTER COLUMN` for columns with `NOT NULL` and a default value.


## Version 5.3.2 - 2024-10-08

### Fixed

- to.sql|hdi|hdbcds|effective: Handle subexpressions in conjunction with exists predicate.


## Version 5.3.0 - 2024-09-25

### Added

- compiler:
  + A warning is emitted if a string enum's values are longer than the specified length.
  + ON-condition rewriting has been improved and now supports secondary associations.
- to.edm(x): Support optional action and function parameters in OData V4. The following rules apply:
  + A parameter declared `not null` without default value is mandatory.
  + A **function** parameter declared `null` without default value is mandatory.
  + An **action** parameter declared `null` without default value is optional as it is equivalent to
    `@Core.OptionalParameter { DefaultValue: null }`.
  + A parameter with a default value is optional and the default value is rendered as
    `@Core.OptionalParameter { DefaultValue: <value> }` regardless of its nullability.
  + `@Core.OptionalParameter: true` can be used to turn a mandatory parameter into an optional parameter
    (especially function parameters) and to signal an unspecified default value in the API if the parameter
    has no default clause.
  + `@Core.OptionalParameter: false` turns the creation of a `@Core.OptionalParameter: { Default: ... }`
    annotation off.
  + A default clause or `@Core.OptionalParameter: <bool>` have no effect on an explicit binding parameter.
  + Mandatory and optional **action** parameters may appear in any order.
  + Optional **function** parameters must not be followed by mandatory parameters.
- to.edm: Forward `@OpenAPI {...}` into EDM Json with option `--odata-openapi-hints`.
- cdsc: Option `--transitive-localized-views` was added.

### Fixed

- CDL parser: Issue warning if annotation assignments have been written
  at an invalid position inside a type expressions.
- CDL parser: Issue warning for arrayed parameter with default value.
- to.cdl: Arrayed parameters with default values were not rendered correctly.

## Version 5.2.0 - 2024-08-27

### Added

- to.edm(x): Add `@Core.Links { rel: 'author', href: 'https://cap.cloud.sap' };` as watermark to lead schema.
- to.sql.migration: Introduce option `script` to aid in generation of manual migration scripts by not aborting when encountering lossy changes.

### Changed

- for.odata: No longer reject default values on action/function parameters.
- to.edm(x): Raise warning for default values on action/function parameters that they are ignored.

### Fixed

- compiler: Fix extensions with bound actions using an explicit binding parameter in `parseCdl` CSN.
- for.odata, to.edm(x): Fix some issues with resolving annotation expressions in nested objects and
  reliably replace value of `=` attribute with `true` after processing.

## Version 5.1.2 - 2024-08-05

### Fixed

- compiler: In parseCdl mode, bound actions specifying the binding parameter with `$self` did not work.


## Version 5.1.0 - 2024-07-25

### Added

- cdsc: Option `--stdin` was added to support input via standard input, e.g. `cat file.cds | cdsc --stdin`
- Allow to refer to draft state element `IsActiveEntity` via variable `$draft.IsActiveEntity` in annotation path expressions.
  + for.odata: During draft augmentation `$draft.IsActiveEntity` is rewritten to `$self.IsActiveEntity` for all draft enabled
    entities (root and sub nodes but not for named types or entity parameters).
  + to.edm(x): (V4 only) Allow to refer to an entity element in a bound action via `$self` and not only via explicit binding parameter
    in an annotation path expression. The API generator will prefix the path with the actual binding parameter name (explicit, annotation or
    default).

### Changed

- Update OData vocabularies: 'Common', 'Core', 'HTML5', 'UI'.
- to.cdl|hdbcds|hdi|sql: Remove `generated by` comment.

### Fixed

- compiler: checks for associations now work for nested projections of the form `association.{ id }`
- to.edm(x): No `Nullable` attribute for `$ReturnType` of `Collection(<entity type>)` [OData V4 CSDL, section 12.8 Return Type](https://docs.oasis-open.org/odata/odata-csdl-xml/v4.01/odata-csdl-xml-v4.01.html#sec_ReturnType)
- to.sql|hdi|hdbcds: Detect and error on "cross-eyed" backlinks, where we cannot construct a valid on-condition.
- to.sql|hdi.migration: Correctly detect that a view was dropped - this was previously just silently ignored.


## Version 5.0.6 - 2024-07-10

### Fixed

- for.seal: Don't generate DRAFT artifacts.

## Version 5.0.4 - 2024-06-26

### Fixed

- CDL parser: an `extend entity` and `extend aspect` with an extensions for the
  same element now correctly leads to an error, because it resulted in part of the
  extension being simply dropped.  Remark: an `extend type` and the recommended
  plain `extend` led to an error in that situation already before.
- to.sql: Conditions inside filters in combination with foreign key aliases were
          not properly translated in rare cases.
- Update OData Vocabularies: 'PDF', 'UI'.

## Version 5.0.2 - 2024-06-14

### Changed

- API `CompilationError` will serialize the first compiler error in `e.message`
- cdsc: `--without-hana-associations` is changed to `--with-hana-associations`

### Fixed

- to.edm(x):
  + Respect `AppliesTo` specification in term definitions for actions and functions.
  + Make message `odata-spec-violation-namespace` a warning again.

## Version 5.0.0 - Pre-release version - 2024-05-29

This is a preview version for the major release and contains breaking changes. It should not be used for production.

### Changed

- Node 18 is now the minimum required version.
- API `CompilationError`s will no longer serialize all compiler messages into `e.message`.
  Use `e.messages[]` instead or `e.toString()` to serialize errors into a string.
- CDL parser: Annotations that can't be applied are now rejected.
- compiler:
  + `extend` statements on "namespaces" (paths that are not definitions) are now always errors.
  + non-structured events are rejected
  + `$self` references in JOINs are rejected if they could lead to issues in SQL rendering.
  + non-string enum definitions must have a value.
  + A top-level definition `$self` is rejected. `$self` is considered a reserved name.
  + `$at.from`/`$at.to` are deprecated; use `$valid.from`/`$valid.to` instead.
- to.hdbcds: The HDBCDS backend is now considered deprecated.
- to.edm(x):
  + Set default nullability to `true` for collection like properties (was `false` before).
  + Raise message ids `odata-spec-violation-namespace`, `odata-spec-violation-no-key` from warning to error.
- to.sql:
  + `@cds.persistence.exists` is _not_ propagated to generated localization views (`localized.*`)
  + Option `fewerLocalizedViews` is now enabled by default.
  + Option `betterSqliteSessionVariables` is now enabled by default.

### Fixed

- for.odata: Propagate all `@odata { Type, MaxLength, Precision, Scale, SRID }` to generated foreign keys.

### Removed

- API: Deprecated functions `preparedCsnToEdmx` and `preparedCsnToEdm` were removed.
  Use `to.edm(x)` instead.

## Version 4.9.10 - 2025-04-29

### Fixed

- Added option `allowMixinInProjectionExtension` which allows referring to mixins in `extend projection`.
  This was forbidden in cds-compiler v4, but re-introduced in v5.5.  Users wanting to migrate from cds-compiler
  v3 to v4 can use this option for easier migration.

## Version 4.9.8 - 2024-07-29

### Fixed

- compiler: Fix extensions with bound actions using an explicit binding parameter in `parseCdl` CSN.
- to.edm(x): No `Nullable` attribute for `$ReturnType` of `Collection(<entity type>)` [OData V4 CSDL, section 12.8 Return Type](https://docs.oasis-open.org/odata/odata-csdl-xml/v4.01/odata-csdl-xml-v4.01.html#sec_ReturnType)

## Version 4.9.6 - 2024-07-15

### Fixed

- for.seal: Don't generate DRAFT artifacts.
- for.odata: Propagate all `@odata { Type, MaxLength, Precision, Scale, SRID }` to generated foreign keys.
- to.edm(x): Respect `AppliesTo` specification in term definitions for actions and functions.
- to.sql: Conditions inside filters in combination with foreign key aliases were not properly translated in rare cases.

## Version 4.9.4 - 2024-05-21

### Fixed

- to.sql:
  + always include `tenant` column in foreign key references.
  + reject `tenantDiscriminator` option only if sql dialect is `hana` and if  `withHanaAssociations` option is set.

## Version 4.9.2 - 2024-05-13

### Fixed

- compiler: Rewriting annotation expression paths in structures of projections has been improved.
- to.edm(x):
  + Operator `/` represents `DivBy` operator, explicit `DivBy` is replaced with `Div` as integer division.
- to.sql: consider all associations in tenant dependent entity for referential constraint generation

## Version 4.9.0 - 2024-04-25

### Added

- compiler: Annotations with expressions are now rewritten when propagated.
- for.seal: Added API function that produces a CSN for SEAL.
- for.odata/to.edm(x): Support annotation path expressions including path flattening.

### Changed

- parser: A space between `.` and `*`/`{` (nested projections) is now a warning.  
  Use `bin/cds_remove_invalid_whitespace.js` to automatically fix this warning.
- compiler:
  + Published compositions with filters are changed to associations.
  + Expressions as annotation values are rejected for few known annotations that don't expect them.
- Update OData vocabularies: 'Aggregation', 'Capabilities', 'Common', 'Hierarchy', 'PersonalData', 'Session', 'UI'.
- to.edm(x): Exposed anonymous parameter types are now prefixed with `ap`, `bap` and `ep` for actions, bound actions and entities.

### Fixed

- compiler:
  + Deprecated `$parameters` is no longer proposed in code completion.
  + Duplicate mixin definitions lead to failing name resolution.
- to.cdl: Types were always rendered for associations with filters, even if it would lead to a compilation failure.
- to.edm(x):
  + Fix a recursion bug in entity parameter handling.
  + Fix event exclusion in service preprocessing.

## Version 4.8.0 - 2024-03-21

### Added

- compiler: Type `cds.Vector` was added.  It is mapped to `REAL_VECTOR` on SAP HANA.
- Support associations to/from entities with parameters for SAP HANA SQL (hdi/direct).
- to.sql/to.hdi:
  + SAP HANA keywords `ABSOLUTE`, `REAL_VECTOR`, and `ST_ASESRIJSON` are now included for smart quoting.
  + PostgreSQL keyword `SYSTEM_USER` is now included for smart quoting.
- API: Added `to.sql.postgres.keywords` and `to.sql.h2.keywords`.
  They contain keywords for the respective SQL dialect.

### Changed

- compiler: Overriding an included element must not change the type to an association
  if it wasn't an association before and vice versa.
- Update OData vocabularies: 'Authorization', 'Common', 'UI'.

### Fixed

- compiler: `cast()`s to structured types and associations are now rejected. They could lead to crashes before.
- to.edm(x):
  + Reject action/function return types that are declared `many of many`.
  + Render user defined annotation type `cds.Integer` as `Edm.Int`.
- to.sql|hdi|hdbcds:
  + Correctly handle `.list` during flattening.
  + Improve handling of `.items`.
- to.sql|hdi.migration:
  + Turn types and aspects into dummies to reduce CSN size.
  + Correctly detect a removed `.default` and forcefully set the default to `null`.

## Version 4.7.6 - 2024-02-29

### Fixed

- OData: Restored compatibility with the Java runtime.
  Drafts generation was applied twice.


## Version 4.7.4 - 2024-02-27

### Fixed

- OData: Fixed infinite recursion in draft handling for nested recursive compositions.


## Version 4.7.2 - 2024-02-26

### Fixed

- Restored compatibility with `@sap/cds-dk` for Java runtime.



## Version 4.7.0 - 2024-02-23

### Added

- compiler: Virtual elements can now be referenced in expressions in annotation.

### Changed

- Update OData vocabularies: 'Authorization', 'Common', 'Hierarchy', 'UI'.
- to.edm(x): `@cds.odata.valuelist` renders all non-key elements of the value help list as `ValueListProperty`.

### Fixed

- CDL parser: a `select` after two or more `(`s in an expression or condition
  could cause some constructs in that query, such as `virtual`, to be not properly parsed.
- compiler: published associations with filters sometimes had the filter applied twice
  if used in inline aspect compositions
- to.sql|hdi|hdbcds[.migration]:
  + With `withHanaAssociations`: `false`, remove the association elements from the final CSN in order
    to correctly detect them during migration scenarios and
  with generated `hdbcds`.
  + Skip expensive processing (for calculated elements and nested projections) if the model doesn't use it.
  + Don't greedily set alias on subqueries if not required.
  + Remove bound actions and turn all non-database relevant artifacts into dummies to simplify and shrink CSN.

## Version 4.6.2 - 2024-02-02

### Fixed

- compiler: Fix incorrect error about type properties if deprecated flag `ignoreSpecifiedQueryElements` is set.
- Update OData vocabularies: 'Authorization', 'Common'.


## Version 4.6.0 - 2024-01-26

### Added

- compiler: Events can now be projections on other structured events and types.
- to.cdl: `parseCdl` and `gensrc` style CSN (a.k.a. `inferred` and `xtended`) is now supported as input.

### Changed

- Update OData vocabularies: 'Aggregation', 'Validation'
- to.sql/hdi/hdbcds: Removed warnings for number and type of keys in draft-enabled entities.

### Fixed

- compiler:
  + ON-conditions of associations with filters in calculated elements were incorrectly rewritten when included
    in other entities, and the filter was applied twice in some scenarios.
  + redirecting an association with filter did not rewrite paths relative to the redirection target.
  + Unknown type references with an explicit named type argument such as `Unknown(length: 10)` crashed.
- to.edm(x):
  + `@Core.IsURL` is not rendered in combination with `@Core.MediaType` (V4 only).
  + No 'odata-navigation' warning for association targets annotated with `@cds.autoexpose: false`.
  + No empty annotation in API, when a non-existent base annotation is annotated  
    (eg. `@Common.Label.@Core.Description` without `@Common.Label`).
  + Don't crash if value for `$Type` is not a string.
  + Generated foreign keys of type `cds.UUID` that are also primary key are not annotated with
    `@Core.ComputedDefaultValue`. This is a follow up correction to [4.5.0](#version-450---2023-12-08)


## Version 4.5.0 - 2023-12-08

### Added

- compiler/parser
  + Annotations can have any expressions as value, like `@Anno: ( ref + 1 )`.
    References are checked to be valid element references,
    inherited values might become invalid due to element renaming.
    This feature is still experimental, and
    might not be supported by all backends or runtimes at the moment.
  + A single `annotate` statement can now be used to annotate parameters, elements and
    bound actions in one statement.
- to.edm(x): Key elements of type `cds.UUID` are annotated with `@Core.ComputedDefaultValue` if they are
  defined directly in the entity. Elements of type `cds.UUID` that are defined in a named structured type
  and used to define a key element are not annotated, instead a warning is raised if such elements are
  not annotated with `@Core.ComputedDefaultValue`.
- to.sql|hdi: Add option `withHanaAssociations` which, for sqlDialect `hana`, allows suppressing
  the generation of the `WITH ASSOCIATIONS`.

### Changed

- Update OData Vocabulary: 'Common'.
- api: Reject CSN as input in backends, if it is a CSN in flavor `parsed` with a non-empty `requires` array.
  Reason being that the model is not considered a "full" CSN, as dependencies were not resolved.

### Fixed

- compiler:
  + Fix false positives of cyclic dependencies for calculated elements.
  + Fix cardinality on source associations when publishing them with a filter (+ different cardinality)
    in a projection.  The cardinality was incorrectly changed on the source as well.
- CDL parser:
  + More numbers that would lose relevant digits due to precision loss are
    stored as strings in CSN (i.e. `{ "literal":"number", "val": "1.0000000000000001" }`).
  + Nested table expressions and queries in the FROM clause (with surrounding parentheses)
    could cause some constructs such as `virtual` to be not properly parsed.
- to.hdi.migration: Don't drop-create the primary key when only a doc-comment has changed.
- to.cdl: Fix edge case where `@A.![B#]` was not rendered correctly.

### Removed

- to.edm(x): Remove option `--odata-open-type` introduced with [4.4.0](#version-440---2023-11-09).

## Version 4.4.4 - 2023-11-24

### Fixed

- to.hdi.migration: Changes in only `doc`-comments should not result in a drop-create of the primary key.

## Version 4.4.2 - 2023-11-17

### Fixed

- for.odata: Fix crash when using a projection with associations as action parameter type.
- to.edm(x): `Edm.AnyPropertyPath` is hard to `Edm.PropertyPath`. As there is no dynamic path evaluation,
  `Edm.NavigationPropertyPath` must be enforced via `$edmJson`.
  `Edm.AnyPropertyPath` has been used in `@Aggregation.ApplySupported.GroupableProperties` for the first
  time after vocabulary update with [4.4.0](#version-440---2023-11-09).

## Version 4.4.0 - 2023-11-09

### Added

- compiler: International letters such as `ä` can now be used in CDS identifiers without quoting.
  Unicode letters similar to JavaScript are allowed.
- to.edm(x):
  + Allow to render all complex types within a requested service as `OpenType=true` with option `--odata-open-type`.
    Explicit `@open: false` annotations are not overwritten.
  + Allow to annotate the generated draft artifacts but not generated foreign keys (as with any other managed association).
- to.sql|hdi|hdbcds: Allow annotating the generated `.drafts` tables.

### Changed

- CDL parser: improve error recovery inside structured annotation values
- Update OData vocabularies: 'Aggregation', 'Common', 'Core', 'Hierarchy', 'ODM', 'UI'.

### Fixed

- parser:
  + `/**/` was incorrectly parsed as an unterminated doc-comment, leading to parse errors.
  + Doc-comments consisting only of `*` were not correctly parsed.
- compiler: do not propagate `default`s in a CSN of flavor `xtended`/`gensrc`.
- to.hana: Fix various bugs in association to join translation. Support `$self` references
  in filter expressions.
- to.edm(x): Omit `EntitySet` attribute on `Edm.FunctionImport` and `Edm.ActionImport` that return
  a singleton.
- to.sql|hdi.migration: Improve handling of primary key changes - detect them and render corresponding drop-create.

## Version 4.3.2 - 2023-10-25

### Fixed

- compiler: Fix auto-exposure of composition target entities inside anonymous composition target aspects.
- to.hana: Fix a bug in association to join translation, expect ON condition operand to be a function without arguments.

## Version 4.3.0 - 2023-09-29

### Added

- compiler: it is possible to publish associations with filters in views.
  Managed associations become unmanaged ones.  For example:  
  ```cds
  entity Proj as projection on Base {
    assoc[id = 1],
  };
  ```

### Changed

- Update OData vocabularies: 'Aggregation', 'Capabilities', 'Common', 'PDF', 'PersonalData', 'UI'.

### Fixed

- parser: Chained methods without arguments such as `b` in `a().b.c()` were lost.
- compiler:
  + Type arguments in `cast()` functions, whose column also has an explicit type set, were not
    properly checked.  Now the `cast()`s type and type arguments are checked.
  + SQL function `STDDEV(*)` was not parsable.
  + In views, published association's ON-conditions containing `$projection` are now rewritten
    to `$self` in the CSN `elements` property.  This ensures recompilability of the CSN.

## Version 4.2.4 - 2023-09-14

### Fixed

- OData: For compatibility with the Java runtime, don't prepend table aliases to column aliases unless necessary.

## Version 4.2.2 - 2023-08-31

### Fixed

- to.sql|hdi.migration: Fix bug that caused a migration to be rendered for the HANA CDS types that were removed from the CSN

## Version 4.2.0 - 2023-08-29

### Added

- Compiler:
  + Option `moduleLookupDirectories: [ 'strings' ]` can be used to specify additional module lookup
    directories, similar to `node_modules/`.
  + LIMIT and OFFSET clauses can now contain expressions, including parameter references.
- to.edm(x):
  + Detect spec violation `scale` > `precision`.
- to.sql/for.odata:
  + With the new option `fewerLocalizedViews: true|false`, an entity/view will not get a localized convenience
    view, if it only has associations to localized entities/views.  Only if there is actually a localized
    element (e.g. new localized element or reference to one), will it get a convenience view.
- to.sql
  + In a localized scenario, create foreign key constraints for the generated `.texts` entities.
  + Casting `null` to a structure such as `null as field : StructT` is now supported.  For each leaf element,
    an additional `null as field_name` column is added.

### Changed

- Compiler:
  + Selecting fields of structures or associations (without filters) are now candidates for ON-condition
    rewrites: It is no longer necessary to select the struct/association directly.
  + Consistently handle the case when type elements are defined to be a `key`:
    the `key` property is not only preserved with `includes`, but also in other cases.
    Use option `deprecated.noKeyPropagationWithExpansions` to switch to the v3 behavior.
  + When including aspects or entities into structured type definitions,
    do not add actions to the type.
  + An `annotate` statement in the `extensions` section of a CSN now consistently uses the
    `elements` property even if the `annotate` is intended to be used for an enum symbol.
    Before v4.2, the compiler has used the `enum` property in a CSN of flavor `xtended`
    (`gensrc`) if it was certain that it was to be applied to an enum symbol.
- to.cdl: If a definition has an `actions` property, an `actions {…}` block is now always rendered,
  and is not ignored if empty.
- to.sql:
  + For SQL dialect "sqlite", `cds.DateTime` is now rendered as `DATETIME_TEXT` instead of `TIMESTAMP_TEXT`.
  + Casting a literal (except `null`) to a structure now yields a proper error.
  + `.texts` entities annotated with `@cds.persistence.skip` (without their original entity having that annotation)
    lead to deployment issues later.  It is now an error.

### Fixed

- Compiler:
  + Reject invalid reference in the `on` of `join`s already while compiling,
    not just when calling the (SQL) backend.
  + Correct the calculation of annotation assignments on the return structure of actions
    when both `annotate … with {…}` and `annotate … with returns {…}` had been used
    on the same structure element.  Ensure that it works when non-applied, too.
  + Do not remove or invent `actions` properties with zero actions or functions in it.
  + Correct auto-redirection of direct cycle associations: if the source and target of a
    model association are the same entity, and the main artifact of the service association
    based on the model association is a suitable auto-redirection target, then use it
    as new target, independently from the value of `@cds.redirection.target`.
- to.cdl: Indirectly structured types (`type T: Struct;`) with `includes` (`extend T with T2;`), are now properly rendered.
- to.sql/hdi/hdbcds:
  + Views on views with parameters did not have localized convenience views based on
  other localized views (missing `localized.` prefix in FROM clause)
  + Run less checks on entities marked with `@cds.persistence.exists`
  + Correctly render SELECT items where the column name conflicts with a table alias
- to.sql: Casting expressions to a structured type yields a proper error instead of strange compiler error.
- to.edm(x):
  + Don't expand `@mandatory` if element has an annotation with prefix `@Common.FieldControl.`.
  + Fix a bug when referencing nested many structures, especially referring to a managed association via
  `$self` comparison.
  + Improve handling of non-collection annotation values for collection-like vocabulary types.
  + Don't render `Scale: variable` for `cds.Decimal(scale:0)`.
- to.sql|hdi.migration:
  + Fixed a bug that caused rendering of `ALTER` statements to abort early and not render some statements.
  + CSN output now only contains real `cds` builtins, no early remapping to HANA CDS types or similar.
- to.sql.migration: Don't drop-create views marked with `@cds.persistence.exists`

### Removed

## Version 4.1.2 - 2023-07-31

### Fixed

- to.hdi.migration: Changes in constraints are not rendered as part of the .hdbmigrationtable file,
  as they belong in other HDI artifacts

## Version 4.1.0 - 2023-07-28

### Added

- Calculated elements "on-read" can now reference localized elements.
- Aliases for columns inside sub-queries are now optional, also for expressions.
- for.odata/to.hdi/to.sql: Specified default value on a managed association is forwarded to a foreign key
  if association has exactly one foreign key.
- CDL: Annotation-only aspects having no `elements` and `actions` can now be defined with
  the CDL syntax `@Anno… aspect Name;`.  They cannot be extended with elements or actions
  in order to ensure that they can always be used to extend non-structures.
  To allow the former but not the latter, use `@Anno… aspect Name {…};`.
- to.sql: Support session variables for h2

### Changed

- api: Function `isInReservedNamespace(name)` handles name `cds` as being in a reserved namespace as well.
- `CompilationError.messages` are now sorted severity aware. Errors are listed first.
- Compiler:
  + Improve the calculation of semantic code completion candidates.
  + Some checks, like those for valid `on` conditions of associations,
    are now already done with `compile` and not just the backends.
  + SQL `cast()`s must always have a `type` property
  + Type properties such as `precision` or `length` must be accompanied by a type (possibly inferred).
- for.odata/to.hdi/to.sql: No longer reject unmanaged associations as foreign keys of a managed association.
  Instead, ignore such references during ON-condition rewriting and foreign key generation. Referring to
  unmanaged associations is incompatible with SAP HANA CDS naming mode 'hdbcds'.
- to.sql: Rework session variables for postgres.
- Update OData vocabularies: 'Common', 'HTML5', 'PersonalData', 'UI'.

### Fixed

- Compiler:
  + ensure that annotations of elements in anonymous aspects of managed compositions
    are not lost.
  + issue error for definitions like `entity Self as projection on Base { $self.* };`
    instead of simply concluding that the projection has zero elements.
  + do not report a invalid cyclic dependency if associations between two entities
    are valid cycles.
  + Element type references can again follow associations (removed v4.0 incompatibility).
- to.sql:
  + `$self` references inside a nested projection using `$self` was incorrectly resolved.
  + associations to entities marked with `@cds.persistence.skip` were not properly
    checked inside nested projections.
  + Select items casting `null` to an arrayed type work again, e.g. `null as ManyType`.
- to.sql/hdi/hdbcds: Raise a nice error message for `@sql.append` on managed associations/compositions,
  as we do for structured error messages.
- to.cdl: Annotations with multiple qualifiers (`#`) are now rendered correctly.
- to.edm(x): Revert change introduced with [3.9.0](#version-390---2023-04-20)
    "Correct referential constraint calculation for `[0..1]` backlink associations".
- for.odata: Process shortcut annotations sequence independent.
- to.sql.migration:
  + Respect unique and referential constraints for delta calculation.
  + Added a configurable error for primary key additions, as those will lead to errors if the table
    contains data. This could lead to inconsistent states if
    some deployments succeed and others fail, so by default it is an error.

### Removed

- Compiler:
  + forbid wildcards in projection extensions: `extend … with columns { * )`.
  + forbid column references such as `$user.*`, `$user.{id}` and `$user {id}`.

## Version 4.0.2 - 2023-06-22

### Fixed

- to.sql.migration: When drop-creating views, also drop-create (transitively) dependent views.
- to.edm(x):
  + Forward `@odata.singleton { nullable }` annotation to parameter entity.
  + Annotations assigned to a parameterized entity are propagated to the parameter entity if the annotation is
    applicable to either an `edm.EntitySet` or `edm.Singleton`. This especially covers all `@Capabilities` and their
    shortcut forms like `@readonly` and `@insertonly`. The original annotation is not removed from the original entity.
    Annotations that should be rendered at the parameter `edm.EntityType` can be qualified with `$parameters`.
    Explicitly qualified annotations are removed from the original entity allowing individual assignments.


## Version 4.0.0 - 2023-06-06

### Added

- Calculated elements "on-write" are now supported, e.g. `elem = field + 1 stored;` will be rendered in SQL
  as `GENERATED ALWAYS AS`.
- compiler:
  + `returns` of actions and functions can now be annotated, e.g.

    ```cds
    action A() returns @direct { … };
    annotate A with returns {
      @anno val;
    }
    ```
  + It is now possible to use `*/` inside doc comments by escaping it `*\/`.  Only this exact string can be escaped.
  + Functions `parse.expr` and `parse.cql` now support `group by`, `having`, `order by`, `limit`, and `offset` in infix filters.
  + In expressions, you can now use function names after the `new` keyword which do
    not start with `st_`, if the name is followed by an open parenthesis.

### Changed

- API:
  + `messageContext()` is now deprecated; use `messageStringMultiline()` instead with `config.sourceMap`.
  + `messageString(err, config)` has a new signature; the old one is still supported for backward compatibility.
  + Option `docComment: false` now removes doc comments during compilation even for CSN.
    If this option is not defined, doc comments are checked, but not put into CSN.
- compiler:
  + CSN: Specified elements of queries are now resolved and checked (previously ignored except for annotations).
    Type properties (`length`, …) and some element properties are now taken from the specified elements
    instead of relying only on the elements inferred by the compiler.
  + CSN: Compiler accepts CSN input with CSN version `0.1.0` (produced by cds-compiler version 1.10.0 and older)
    only if the version attribute is properly set, i.e. `"version": {"csn": "0.1.0"}`.
  + CSN: Type properties (`length`, `precision`, `scale`, and `srid`) next to `elements` or `items` in CSN input
    is now an error.  Previously ignored.
  + An extension of the form `extend Def with { name = 42 };` is now represented in parsed CSN as
    adding a calculated element.
  + `having` as the first word in an infix filter is now interpreted as keyword. Write `![having]`
    to have it parsed as identifier.
  + If a definition overrides elements of an included definition, it is sorted according
    to the included definition's element order.  This is similar to how `*` works in projections.
    It is no longer possible to overwrite a scalar element with a structure and vice versa.
  + Two included definitions cannot have the same element. The including entity must override the element.
  + If a type with properties precision and scale is extended, the `extend` statement must extend both properties.
  + `annotate E:elem with actions {};` is now a parser error and no longer a compiler error.
    Only relevant if you use `parseCdl`-style CSN.
  + Annotations (and other properties) are now propagated to `returns` as well, if the returned artifact
    is a non-entity, e.g. a type.
  + `annotate E with returns {…}` is now only applied to actions/functions. Previous compiler versions
    autocorrected the `annotate` statements to apply them to an entity's elements.
  + Calculated elements can't refer to localized elements.
  + Table aliases can't be used in `extend Query with columns {…}` any longer. Use direct element references instead.
  + Table alias and mixin names can no longer start with `$`. Choose a different name. With this change
    we avoid unexpected name resolution effects in combination with built-in `$`-variables.
  + A semicolon is now required after a type definition like `type T : many {} null`.
  + Message ID `duplicate-autoexposed` was changed to `def-duplicate-autoexposed`.
  + Bare `$projection` are rejected. Use `$self` instead.
- Update OData vocabularies 'Common', 'UI'.
- to.sql:
  + Change default `length` for `cds.String` for all SQL dialects except `hana` to 255.
  + for the sql dialect `postgres`, the `ON DELETE RESTRICT` / `ON UPDATE RESTRICT` rules
    are omitted from the referential constraint definitions.
- to.cdl:
  + If associations are used inside `items`, an error is emitted instead of rendering invalid CDL.
  + `items` inside `items`, where the outer one does not have a `type`, is now always an error,
    because it can't be rendered in CDL

### Fixed

- compiler:
  + `parseCdl` CSN did not include correct `...` entries for annotations containing `... up to`
  + Type references inside calculated elements were not always correctly resolved.
  + `USING` empty files were incorrectly marked as "not found".
  + Correct the handling of `$self` references in nested projections and filters in queries.
  + If an association was inside `items`, e.g. via type chains, the compiler crashes instead of emitting proper errors.
  + References in the user-provided `on` conditions of associations with a to be
    auto-redirected model entity as target were not always resolved correctly.
    Complain in error situations.
  + Make extend code robust against prototype-polluted JS classes.
- Localized convenience views for projections (not views) did not have references rewritten.
  This only affects CSN, the SQL result was correct.
- Calculated elements in composition-of-aspect lost their `value` when generating composition targets.
- to.sql/to.hdi/for.odata: Foreign keys in ON-conditions were not always properly checked and flattened if explicit
  `keys` were provided that reference structures.
- Extending bound actions with elements is not possible, but was not reported by the compiler and elements were silently lost.
- for.odata:
  + Don't propagate `@odata { Type, MaxLength, Precision, Scale }` from structured to flattened leaf elements.
  + Remove `type: null` attribute from element definitions referencing an undefined type via `type of`.
- to.edm(x):
  + Don't reject untyped properties that are API typed with a valid `@odata.Type` annotation.
  + Render correct `EntitySetPath` and annotation target path for actions/functions with explicit binding parameter.
- to.cdl: ParseCdl-style CSN containing annotations with `...` were not properly rendered.

### Removed

- NodeJs 14 is no longer supported.
- `CompileMessage` no longer has property `location`, which was deprecated in v2.1.0, but `$location`,
  which is supported since v2.1.0
- compiler:
  + It is no longer possible to write `type of $self.‹elem›` to refer to the element `‹Def›.‹elem›`
    where `‹Def›` is the main artifact where the type expression is embedded in. Replace by `type of <Def>:‹elem›`.
  + Element type references can no longer follow associations, i.e. `E:assoc.id` is not allowed
    (v4.0 only, re-introduced with v4.1).
  + "Smart type references" such as `Entity.myElement` instead of `Entity:myElement`
    are removed, because since - `Entity.myElement` could also be a definition,
    creating ambiguities. This did not work always, anyway.

## Version 3.9.12 - 2023-12-06

### Fixed

- compiler:
  + SQL function `STDDEV(*)` was not parsable.
  + Numbers in scientific notation `-1e1` were sometimes not recognized via CSN input.
- for.odata: Fix crash when using a projection with associations as action parameter type.
- for.hana: Fix a bug in association to join translation, expect ON condition operand to be a function without arguments.
- to.edm(x):
  + Omit `EntitySet` attribute on `Edm.FunctionImport` and `Edm.ActionImport` that return a singleton.
  + Don't render `Scale: variable` for `cds.Decimal(scale:0)`.
- to.sql/hdi/hdbcds: consider `having` predicate for `exists` expansion

## Version 3.9.10 - 2023-08-25

### Fixed

- to.edm(x): Error reporting for incorrect handling of "Collection()" has been improved.
- to.sql/hdi/hdbcds: Views on views with parameters did not have localized convenience views based on
  other localized views (missing `localized.` prefix in FROM clause)
- to.sql: Casting expressions to a structured type yields a proper error instead of strange compiler error.
- to.sql.migration: Don't drop-create views marked with `@cds.persistence.exists` or `@cds.persistence.skip`

## Version 3.9.8 - 2023-08-03

### Fixed

- to.edm(x):
  + Don't expand `@mandatory` if element has an annotation with prefix `@Common.FieldControl.`.
  + Fix a bug when referencing nested many structures, especially referring to a managed association via
  `$self` comparison.
- to.sql/hdi/hdbcds: Detect navigation into arrayed structures and raise helpful errors instead of running into internal errors.

## Version 3.9.6 - 2023-07-27

### Fixed

- to.edm(x): Revert change introduced with [3.9.0](#version-390---2023-04-20)
    "Correct referential constraint calculation for `[0..1]` backlink associations".
- for.odata: Process shortcut annotations sequence independent.

## Version 3.9.4 - 2023-06-07

### Fixed

- compiler: `USING` empty files were incorrectly marked as "not found".
- Localized convenience views for projections (not views) did not have references rewritten.
  This only affects CSN, the SQL result was correct.
- to.edm(x): Render correct EntitySetPath and annotation target path for actions/functions
  with explicit binding parameter.

## Version 3.9.2 - 2023-04-27

### Fixed

- Fix crash in core compiler which occurred when CAP was used in a node environments
  where an enumerable property was added to `Array.prototype`.
- to.edm(x):
  + Publicly release `@open`.
  + No `DefaultValue` for `Edm.NavigationProperty`.

## Version 3.9.0 - 2023-04-20

### Added

- Variables `$valid.from` and `$valid.to` have been added to the compiler.
  They behave the same as `$at.from` and `$at.to`.
- to.edm(x):
  + Add `--odata-vocabularies` to pass a dictionary `{ <prefix>: { Alias, Namespace, Uri } }`
    into the EDM generation. `<prefix>` must match the value of `Alias`. Entries are ignored
    if they are incomplete, malformed, redefine an official OASIS/SAP vocabulary or match the name
    of the current service. Annotations of the form `@<prefix>.<annotation>` are added to the API
    without evaluation including an `edm:Reference`. It is in the users responsibility to provide
    a URI that a client can resolve against a valid vocabulary document.
  + Support annotation `@open` on entity and structured type level to declare the corresponding
    entity/complex type to be `OpenType=true`. If an open structured type is declared closed
    (with a falsy annotation value), the corresponding EDM type is closed as well and suffixed
    with `_closed` (or `_open` vice versa).
    No further checks are performed on possibly open foreign or primary key types nor on eventually
    bucket elements to store the additional data.

### Changed

- compiler: Parameter references in filters such as `assoc[field < :Param]` are now allowed.
- In the compiled CSN, sort the non-enumerable `$sources` property
  according to the reversed layered extension order.
- Update OData vocabulary 'Common', 'ODM', 'UI'.
- to.cdl: If an identifier contains illegal characters (e.g. newline), we no longer produces
  invalid CDL, but emit an error instead.

### Fixed

- to.edm(x):
  + Fix spec requirement: "Navigation properties of complex types MUST NOT specify a partner".
  + Set default target cardinality for unspecified `composition of {}` to `[0..1]`.
  + Correct referential constraint calculation for `[0..1]` backlink associations.
- for.hana/for.odata: Reject final unmanaged assoc path step in ON Condition if preceded with `$self`.
- to.cdl: Parentheses around expressions containing conditions were sometimes missing.
- to.sql/hdi/hdbcds:
  + Detect and process calculated elements in functions like `upper`.
  + Better detection of calculated elements in `.expand`/`.inline`.
  + Entities with calculated elements sometimes had incorrect types. This happened, for example,
    if they were marked with `@odata.draft.enabled`

## Version 3.8.2 - 2023-03-30

### Fixed

- parser: Identifiers that are keywords were not allowed in annotation values inside arrays
- compiler: Compatibility against cds-lsp was restored.
- to.sql/hdbcds/hdi/edm(x): Fix a crash for sub-queries inside nested expressions of on-conditions of JOINs.

## Version 3.8.0 - 2023-03-27

### Added

- compiler:
  + Table aliases for sub-queries are no longer required.
  + A time zone designator can now be used in time literals, e.g. `time'16:41:01+01:30'`or `time'16:41:01Z'`.
- Calculated elements ("on-read") are now enabled per default.  
  When used in views, they are replaced by their value, for example:
  ```cds
  entity E { one: Integer; two = one + 1; };
  entity P as projection on E { two };
  // P is the same as:
  entity P as projection on E { one + 1 as two };
  ```
  This allows to define calculations centrally at the entity, which can be used by
  other views.
- In CDL, a ternary operator was added as a shortcut for `CASE` expressions:  
  `a ? b : c` is a shortcut for `CASE WHEN a THEN b ELSE c END`.  There is no CSN
  representation. The ternary operator is rendered as a `CASE` expression in CSN.
- In CDL and CSN, `not null` can now also be used in type definitions.
- In CDL (and CSN as before), elements can be defined without specifying a type.

### Changed

- API: We now report an error for most backends, if the input CSN has
  `meta.flavor == 'xtended'`, because only client/inferred CSN is supported.
- Update OData vocabularies 'PersonalData', 'UI'
- for.odata: Shortcut annotations `@label`, `@title`, `@description`, `@readonly` are no longer
  removed from the OData processed CSN.
- to.cdl:
  + Annotation arrays are split into multiple lines, if a single line would be too long.
  + Nested `SELECT`s are put into separate lines to make them more readable.
  + (Annotation) paths are quoted less often.
- to.sql: The list of reserved SAP HANA identifiers was updated (for smart quoting).

### Fixed

- The CSN parser now accepts bare `list`s in `columns[]`, similar to the CDL parser.
- to.cdl:
  + Delimited identifiers in filters are now surrounded by spaces if necessary, to avoid `]]`
    being interpreted as an escaped bracket.
- to.edm(x):
  + Remove empty `Edm.EntityContainer` again. Removal of an empty entity container has been
    revoked with [3.5.0](#fixed-7) which was wrong. An empty container must not be rendered
    as it is not spec compliant.
  + Correctly resolve chained enum symbols.
  + Fix a program abort during structured rendering in combination with `--odata-foreign-keys`
    and foreign keys in structured types.
  + Correctly render paths to nested foreign keys as primary key in structured mode with
    `--odata-foreign-keys`.
- to.hdi/to.sql/to.edm(x):
  + Reject unmanaged associations as ON-condition path end points.
  + Fix bug in message rendering for tuple expansion.
  + Correctly detect invalid @sql.append/prepend in projections.
- to.hdi/to.sql: The list of SAP HANA keywords was updated to the latest version.

### Removed

- for.odata: Undocumented shortcut annotation `@important` has been removed.


## Version 3.7.2 - 2023-02-24

### Fixed

- CSN parser: Structured annotations containing `=` were accidentally interpreted as expressions,
  even though the corresponding beta flag was not set.


## Version 3.7.0 - 2023-02-22

### Added

- Several `annotate` statement can append/prepend values
  to the same array-valued annotation without an `anno-duplicate` error,
  even if there is no `using from` dependency between the involved sources
- SQL methods such as `point.ST_X()` can be used in views.
- The SQL `new` keyword can be used for `ST_*` types such as `new ST_POINT('Point(0.5 0.5)') )`

### Changed

- Update OData vocabularies 'Common', 'Core', 'Measures', 'PDF', 'UI'.
- to.edm(x): Empty complex types are no longer warned about as they are allowed.

### Fixed

- `parse.cql` and `parse.expr` no longer ignore type arguments such as `cast(field as String(12))`.
  One argument is interpreted as `length` and two are interpreted as `precision` and `scale`, similar to
  how custom types and their arguments are interpreted.
- Previously, the compiler could not always find a unique redirection target if there were
  one direct projection on the model target and two or more projections on that projection.
- The performance of compiler-checks for deeply nested expressions/queries has been improved
- Fix various bugs in Association to Join translation:
  + Recursive `$self` dereferencing
  + Correct resolution of table alias in non-bijective `$self` backlink associations in combination with
    explicit redirection.
- to.edm(x): Process value help list convenience annotations on unbound action parameters.


## Version 3.6.2 - 2023-02-06

### Fixed

- to.hdi(.migration): Don't render `-- generated by cds-compiler version` comment at the top of the HDI-based
  artifacts, as this caused HDI to detect the file as `changed`
  and redeploy, causing way longer deployment times. Old behavior can be enabled with option `generatedByComment: true`.
- to.sql/hdi/hdbcds: Correctly handle variables like `$user` in `exists` filters.

## Version 3.6.0 - 2023-01-25

### Added

- API: There are new API functions for `to.cdl`: `smartId`, `smartFunctionId` and `delimitedId`.
- CDL parser: when defining a parameter for entities, actions or functions,
  you can use a regular identifier for its name even if that is a reserved name like `in`.
- The first parameter of a bound action or function can be typed with `$self` or `many $self`
  even if no type named `$self` exists.
- If an aspect `sap.common.TextsAspect` exists in the `sap.common` context, it will be included
  in all `.texts` entities. This allows to extend `.texts` entities via extending the aspect.  
  Example:
  ```cds
  entity E {
    key id : Integer;
    content: localized String;
  }
  extend sap.common.TextsAspect with {
    elem: String;
  };
  // from @sap/cds common.cds
  aspect sap.common.TextsAspect {
    key locale: String;
  }
  ```
- to.edm(x): Support explicit binding parameter `<id>: [many] $self` for OData V4 only.
  The explicit binding parameter is rendered as any other parameter and `$self` is replaced with
  the binding type but only if no `$self` definition exists in the model. This gives full control
  over the binding parameter including name, nullability, default value and annotations.
  The explicit binding parameter is ignored for OData V2 and has precedence over `@cds.odata.bindingparameter`.

### Changed

- Many messages concerning the CDL and CSN syntax are improved:
  affects message ids (`syntax-…`), message texts and the error locations.
- Duplicate doc-comments are now errors, similar to duplicate annotations.
- Update OData vocabularies 'Aggregation', 'Analytics', 'Capabilities','Common', 'ODM', 'Offline',
  'PDF', 'Session', 'UI'.

### Fixed

- If an entity with parameters is auto-exposed, the generated projection now has
  the same formal parameters and its query forwards these parameters to the origin entity.
- to.hdbcds: Aliases for foreign `keys` were not quoted if necessary.
- to.cdl:
  + Aliases for `expand` and foreign `keys` were not quoted if necessary.
  + Query functions that are CDL keywords were not properly quoted.
  + CSN `doc` properties containing `*/` resulted in invalid CDL.
    To avoid compilation issues, `*/` is escaped as `*\/`.
- to.edm(x): Respect record type hint `$Type` in EDM JSON as  full qualified `@type` URI property.

## Version 3.5.4 - 2023-01-10

### Fixed

- Allow window functions also with a deprecated flag being set.
- to.edm(x): Fix program abort due to malformed error location in EDM annotation preprocessing.
- to.sql/hdi/hdbcds: The option `pre2134ReferentialConstraintNames` can be used to omit the referential
  constraint identifier prefix `c__`.

## Version 3.5.2 - 2022-12-20

### Fixed

- to.sql/hdi/hdbcds: Don't process references in actions, as they have no impact on the database - avoids internal errors.

## Version 3.5.0 - 2022-12-07

### Added

- grammar: `localized` is now allowed in select items as well, to force the creation of convenience views.
- to.edm(x):
  + Validate annotation values of OASIS/SAP vocabulary term definitions against `@Validation.AllowedValues`.
  + Reveal dangling type references in produced EDM.
  + `@Capabilities` 'pull up' introduced with [3.3.0](#version-330---2022-09-29) must now be switched
    on with option `odataCapabilitiesPullup`.
- If option `addTextsLanguageAssoc` is set but ignored by the compiler, an info message is emitted.
  This can happen if, e.g., the `sap.common.Languages` entity is missing.
- Add OData vocabularies 'Offline' and 'PDF'.

### Changed

- to.edm(x):
  + Vocabulary references to `Common` and `Core` are added to the generated EDM by default to allow
    usage of these vocabularies in http messages even if the terms are not being used in the EDM itself.
  + API representation of enum types as `@Validation.AllowedValues` has been shifted from `for.odata` to
    `to.edm(x)`. This allows to reuse imported enum types in new APIs.
  + Messages raised from the EDM annotation renderer have been reworked with message id and enhanced message
    position including the annotation under investigation.
  + `@Validation.AllowedValues` annotation as introduced for enum elements with
    [1.44.2](./doc/CHANGELOG_ARCHIVE.md#version-1442---2020-10-09)
    are now always rendered into the API regardless of `@assert.range`.
- to.cdl: The input CSN is no longer cloned for client-CSN and parseCdl-CSN,
  as the renderer does not modify it.
- A new warning is emitted if compositions of anonymous aspects are used with the `Association`
  keyword instead of `Composition`. Replace the former with the latter to fix the warning.
- The previous info messages about annotating undefined artifacts (e.g. `anno-undefined-art`)
  are now warnings.

### Removed

- to.edm(x): 'Empty Schema' warning has been removed.

### Fixed

- Enums with a structured base type were accidentally not warned about if used in annotation definitions.
- for.odata/for.hana: Instead of parenthesising tuple expansion with `()`, put
  newly created expression in a `xpr` expression, if the term has more than one expansion.
- Annotation on indirect or inferred enum values were sometimes lost
- to.cdl:
  + Certain keywords of special functions no longer add superfluous parentheses.
  + Extension rendering now supports type extensions as well as `key` for elements.
  + Builtins that clashed names with implicit contexts were not rendered with `cds.` prefix.
  + Unknown artifacts (as can happen in parseCdl-style CSN) are now rendered as `USING` statements.
  + Type extensions in `csn.extensions` (e.g. for `length`) are now rendered.
- to.edm(x):
  + Fix a bug in type exposure when using `@cds.external` complex types.
  + Don't remove empty `Edm.EntityContainer`.
  + Aspects with actions outside of services are no longer warned about.
- for.hana: Fix a foreign key replacement bug during association to join translation.

## Version 3.4.4 - 2022-11-25

### Fixed

- compiler: CSN flavor `gensrc` (known as `xtended` in `@sap/cds`) lost annotations
  on enum values and projection columns.

## Version 3.4.2 - 2022-11-11

### Fixed

- Don't propagate `@cds.external` (The CDS Importer adds `@cds.external` for all
  imported definitions beginning with cds-dk@6.3.0, see CAP release log).
- for.odata: Ignore all `@cds.external` definitions.
- to.sql: For sql dialect `h2`, don't turn a Decimal with length 0 into a Decfloat.
- Extending a projection with an aspect could result in incorrect auto-redirection.
- Annotations of aspects were not properly propagated to projections under some order-specific circumstances.

## Version 3.4.0 - 2022-10-26

### Added

- to.sql: Add support for sql dialect `h2`, which renders SQL for H2 2.x.
- Projections can now be extended by annotation-only aspects, e.g. `extend P with MyAspect;`.

### Fixed

- Properly report an error for bare `$self` references,
  except in the `on` condition of unmanaged associations.
- Do not dump with references to CDS variables like `$now` in `expand`/`inline`.
- Properly report an error when trying to `cast` a column to an association.
- to.cdl: Identifiers that are always keywords in special functions are now escaped.
- to.edm(x):
  + Nested annotation was not applied if outer annotation has value zero.
  + Fix `AppliesTo=ComplexType, TypeDefinition` term definition directive.
- to.sql/hdi/hdbcds:
  + Properly report an error for `exists` with `$self.managed-association`
  + For sql dialect `hana`, add an implicit alias when using `:param` in the select list
  + Handle `$self` and magic variables during expansion of nested projections

## Version 3.3.2 - 2022-09-30

### Fixed

- to.edm(x): Set `Scale` (V4) or `@sap:variable-scale` (V2) attributes correctly when overwriting `cds.Decimal`
  with `@odata.Scale`.
- to.sql: For dialect `postgres`, add braces around `$now`, `$at.from` and `$at.to`.

## Version 3.3.0 - 2022-09-29

### Added

- Nested projections can be used without `beta` option:
  + Support `expand`: columns can look like `assoc_or_struct_or_tabalias { col_expression1, … }`,
    `longer.ref as name { *, … } excluding { … }`, `{ col_expression1 as sub1, … } as name`, etc.
  + Support `inline`: columns can look like `assoc_or_struct_or_tabalias.{ col_expression1, … }`,
    `longer.ref[filter = condition].{ *, … } excluding { … }`, `assoc_or_struct_or_tabalias.*`, etc.
- to.sql/hdi/hdbcds/edm(x)/for.odata: Allow to structure comparison against `is [not] null`.
- to.sql: Support dialect `postgres` - generates SQL intended for PostgreSQL. Not supported are `cds.hana` data types and views with parameters.

### Changed

- A valid redirection target does not depend on parameters anymore.  This
  change could induce a redirection error, which could easily solved by assigning
  `@cds.redirection.target: false` to the entity with “non-matching” parameters.
- Properly issue an error when projecting associations with parameter
  references in the `on` condition.  Before this change, the compiler dumped
  when projecting such an association in a view on top.
- Update OData vocabularies 'Capabilities', 'Common', 'UI'.
- to.cdl:
  + Extensions are now always put into property `model` of `to.cdl()`s result.
  + Actions on views and projections are now rendered as part of the definition, instead of an extension.
- to.edm(x): `@Capabilities` 'pull up' supports all counterpart properties of `@Capabilities.NavigationPropertyRestriction`
  except for properties `NavigationProperty` and `Navigability`.
- to.hdi: Updated list of `keywords` which must be quoted in naming mode `plain`.
- to.sql/hdi/hdbcds/edm(x)/for.odata: Reject structure comparison with operators `<,>,<=,>=`. Message id `expr-unexpected-operator`
  is downgradable to a warning.

### Fixed

- Do not issue a warning anymore when adding elements via multiple `extend` statements in the same file.
- An info message for annotating builtins through `extend` statements is now reported, similar to `annotate`.
- Fix auto-redirection for target of new assoc in query entity
- for.odata: `@readonly/insertonly/mandatory: false` are not expanded.

## Version 3.2.0 - 2022-08-30

### Added

- New Integer types with these mappings:

  | CDS       | OData     | SQL      | HANA CDS      |
  | --------- | --------- | -------- | ------------- |
  | cds.UInt8 | Edm.Byte  | TINYINT  | hana.TINYINT  |
  | cds.Int16 | Edm.Int16 | SMALLINT | hana.SMALLINT |
  | cds.Int32 | Edm.Int32 | INTEGER  | cds.Integer   |
  | cds.Int64 | Edm.Int64 | BIGINT   | cds.Integer64 |

- Properties of type definitions and types of direct elements can now be extended,
  e.g. `extend T with (length: 10);`

- CDL parser: support SQL function `substr_regexpr` with its special argument syntax.

### Fixed

- An internal dump could have occurred in certain situations
  for models with cyclic type definitions.
- Annotations on inferred enum elements of views were lost during recompilation.
- to.cdl: Annotations on enum value in query elements were lost.
- for.odata: Allow dynamic shortcut annotation values (`$edmJson`).
- to.edm(x):
  + Don't overwrite annotations of input model.
  + Ignore `null` values in `$edmJson` strings.
- to.hdi.migration: Don't interpret bound action changes as element changes.

## Version 3.1.2 - 2022-08-19

### Fixed

- to.edm(x):
  + `@Capabilities` 'pull up' for containment trees should not prefix the
    dynamic annotation paths of the root container.
  + Remove service namespace prefix of a parameter type for function/action annotation targets
    in multi schema mode if the parameter type is defined in an alternative schema.

## Version 3.1.0 - 2022-08-04

### Added

- Extending an artifact with multiple includes in one extend statement is now possible:
  `extend SomeEntity with FirstInclude, SecondInclude;`
- Aspects can now have actions and functions, similar to entities.  Aspects can be extended by actions as well.
- `cdsc`:
  + `toCsn` now supports `--with-locations` which adds a `$location` property to artifacts
  + `toHana`/`toSql` now supports `--disable-hana-comments`, which disables rendering of doc-comments for HANA.
- to.hdi/sql/hdbcds: Support FK-access in `ORDER BY` and `GROUP BY`
- to.hdi.migration: Detect an implicit change from `not null` to `null` and render corresponding `ALTER`

### Changed

- compiler: If an unknown file extension is used but the file starts with
  an opening curly brace (`{`), it will be parsed as CSN.
- to.edm(x): In V4 containment mode, pull up `@Capabilities` annotations from the containees to the root container (set)
  and translate them into corresponding `@Capabilities.NavigationRestrictions`. If a `NavigationRestriction` is already available
  for that containment path, capabilities are merged into this path. Capability annotation value paths are prefixed with
  the navigation restriction path.
  The capability 'pull up' has an effect on entity annotations only. `@Capabilities` assignments on compositions are not pulled
  up but rendered to the association type which is important to enable dynamic capabilities on 'to-many' relations and to avoid
  ambiguities in entity set capabilities.
- Update OData vocabularies 'Analytics', 'Capabilities', 'Common', 'Core', 'DataIntegration', 'Graph', 'PersonalData', 'UI', 'Validation'.

### Fixed

- Syntax of date/time literals are now checked against ISO 8601. If the format is invalid, a warning is emitted.
- The code completion directly after the `(` for functions with special syntax
  now suggests all valid keywords, like for `extract` or `locate_regexpr`.
- compiler:
  + `cast(elem as EnumType)` crashed the compiler.
  + Annotations on sub-elements in query entities were lost during re-compilation.
  + An association's cardinality was lost for new associations published in projections.
  + Annotations on indirect action parameters were lost in CSN flavor `gensrc`.
  + Re-allow `annotate` statements referring to the same element twice,
    even if there are annotation assignments for sub elements.
  + If a file's content starts with `{` and if neither file extension is known nor
    `fallbackParser` is set, assume the source is CSN.
- all backends: references in `order by` _expressions_ are correctly resolved.
- to.edm(x):
  + Allow cross service references for unmanaged associations and improve warning message for muted associations.
  + Nested `@UI.TextArrangement` has precedence over `@TextArrangement` shortcut annotation for `@Common.Text`.
- to.hdi.migration:
  + Doc comments rendered the _full doc comment_ instead of only the first paragraph, as `to.hdi` does.
  + Respect option `disableHanaComments` when rendering the `ALTER` statements
- to.hdi/sql/hdbcds:
  + Check for invalid usages of `$self` and give helpful errors
  + Correctly resolve association-steps in the from-clause in conjunction with `exists`

## Version 3.0.2 - 2022-07-05

### Fixed

- to.sql: For `sqlDialect` `plain`, `$now` is replaced by `CURRENT_TIMESTAMP` again.
- compiler:
  + Don't crash if a USING filename is invalid on the operating system, e.g. if `\0` is used.
  + Info messages for annotations on localized convenience views are only emitted for unknown ones.
  + Improve error message for an `extend` statement which had added a new element
    and tried to extend that element further.  Similarly for a new action.
    (If you consider this really of any use, use two `extend` statements.)
- for.odata: expand `@readonly`/`@insertonly` on aspects as for entities into `@Capabilities`.
- to.edm(x):
  + Exclude managed association as primary key on value list annotation preprocessing.
  + Don't render annotations for aspects defined in a service.

## Version 3.0.0 - 2022-06-23

### Added

- Instead of requiring all files on startup, they are required on an as-needed basis to reduce startup times.
- CDL parser: support SQL functions `locate_regexpr`, `occurrences_regexpr`,
  `replace_regexpr` and `substring_regexpr` with their special argument syntax.
- CDL parser: the names `trim` and `extract` are not reserved anymore.

### Changed

- cds-compiler now requires Node 14.
- `compile()` and its derivates now use `fs.realpath.native()` instead of `fs.realpath()`.
- CDL parser:
  + Multi-line doc comments without leading `*` were inconsistently trimmed.
  + As before, a structure value for an annotation assignment in a CDL source is flattened,
    i.e. `@Anno: { foo: 1, @bar: 2 }` becomes `@Anno.foo: 1 @Anno.@bar: 2`.
    Now, the structure property name `$value` is basically ignored:
    `@Anno: { $value: 1, @bar: 2 }` becomes `@Anno: 1 @Anno.@bar: 2`.
    The advantage is that overwriting or appending the annotation value works as expected.
  + Keywords `not null` is only valid after `many String enum {...}` and no longer after `String`.
- `@cds.persistence.skip` and `@cds.persistence.exists` are both copied to generated child artifacts
  such as localized convenience views, texts entities and managed compositions.
- Update OData vocabularies 'Common', 'UI'.
- (Sub-)Elements of localized convenience views can now be annotated, e.g. `annotate localized.E:elem`.
- `getArtifactCdsPersistenceName` now enforces the `csn` argument and can optionally have the `sqlDialect` passed in.
- `getElementCdsPersistenceName` can optionally have the `sqlDialect` passed in.

### Removed

- All v2 deprecated flags.
- Keyword `masked`.
- CDL parser: `*` is not parsed anymore as argument to all SQL functions;
  it is now only allowed for `count`, `min`, `max`, `sum`, `avg`, `stddev`, `var`.
- All non-SNAPI options.

## Version 2.15.10 - 2023-01-26

### Fixed

- If an entity with parameters is auto-exposed, the generated projection now has
  the same formal parameters and its query forwards these parameters to the origin entity.
- to.edm(x): Respect record type hint `$Type` in EDM JSON as full qualified `@type` URI property.

## Version 2.15.8 - 2022-08-02

### Fixed

- to.edm(x): Nested `@UI.TextArrangement` has precedence over `@TextArrangement` shortcut annotation for `@Common.Text`.
- to.hdi.migration:
  + Respect option `disableHanaComments` when rendering the `ALTER` statements
  + Doc comments rendered the _full doc comment_ instead of only the first paragraph, as `to.hdi` does.
- compiler: An association's cardinality was lost for associations published in projections.

## Version 2.15.6 - 2022-07-26

### Fixed

- Annotations on sub-elements were lost during re-compilation.

## Version 2.15.4 - 2022-06-09

### Fixed

- for.odata:
  + Fix derived type to scalar type resolution with intermediate `many`.
- to.edm(x):
  + (V4 structured) Fix key paths in combination with `--odata-foreign-keys`.
  + Add `Edm.PrimitiveType` to `@odata.Type`.
  + (V4 JSON) Render constant expressions for `Edm.Stream` and `Edm.Untyped`.
  + Fix a bug in target path calculation for `NavigationPropertyBinding`s to external references.
  + Render inner annotations even if `$value` is missing.
- Update OData vocabularies 'Common', 'UI'.
- to.sql/to.hdbcds/to.hdi: "type of"s in `cast()`s could lead to type properties being lost.

## Version 2.15.2 - 2022-05-12

### Fixed

- Option `cdsHome` can be used instead of `global.cds.home` to specify the path to `@sap/cds/`.
- to.edm(x):
  + Set anonymous nested proxy key elements to `Nullable:false` until first named type is reached.
  + Enforce `odata-spec-violation-key-null` on explicit foreign keys of managed primary key associations.
  + Proxies/service cross references are no longer created for associations with arbitrary ON conditions.
    Only managed or `$self` backlink association targets are proxy/service cross reference candidates.
  + Explicit foreign keys of a managed association that are not a primary key in the target are exposed in the proxy.
  + If an association is primary key, the resulting navigation property is set to `Nullable:false` in structured mode.

## Version 2.15.0 - 2022-05-06

### Added

- A new warning is emitted if `excluding` is used without a wildcard, since this does
  not have any effect.
- All scalar types can now take named arguments, e.g. `MyString(length: 10)`.
  For custom scalar types, one unnamed arguments is interpreted as length, two arguments are interpreted
  as precision and scale, e.g. `MyDecimal(3,3)`.
- If the type `sap.common.Locale` exists, it will be used as type for the `locale` element
  of generated texts entities.  The type must be a `cds.String`.
- to.cdl: Extend statements (from `extensions`) can now be rendered.
- Add OData vocabulary 'Hierarchy'.
- CDL: New associations can be published in queries, e.g. `assoc : Association to Target on assoc.id = id`

### Changed

- to.edm(x):
  + perform inbound qualification and spec violation checks as well as most/feasible EDM preprocessing steps
    on requested services only.
  + Open up `@odata { Type, MaxLength, Precision, Scale, SRID }` annotation.  
    The annotations behavior is defined as follows:
    + The element/parameter must have a scalar CDS type. The annotation is not applied on named types
      (With the V2 exception where derived type chains terminating in a scalar type are resolved).
    + The value of `@odata.Type` must be a valid `EDM` type for the rendered protocol version.
    + If `@odata.Type` can be applied, all canonic type facets (`MaxLength`, `Precision`, `Scale`, `SRID`) are
      removed from the Edm Node and the new facets `@odata { MaxLength, Precision, Scale, SRID }` are applied.
      Non Edm type conformant facets are ignored (eg. `@odata { Type: 'Edm.Decimal', MaxLength: 10, SRID: 0 }`).
    + Type facet values are not evaluated.
  + V2: Propagate `@Core.MediaType` annotation from stream element to entity type if not set.
- to.edm: Render constant expressions in short notation.
- Update OData Vocabularies: 'Common', 'Graph', 'Validation'.

### Fixed

- to.cdl:
  + Annotations of elements of action `returns` are now rendered as `annotate` statements.
  + Annotations on columns (query sub-elements) were not always rendered.
  + Doc comments on bound actions were rendered twice.
  + Unapplied annotations for action parameters were not rendered.
  + Unions and joins are correctly put into parentheses.
  + Add parentheses around certain expressions in function bodies that require it, such as `fct((1=1))`.
- to.edm(x):
  + Fix a bug in top level and derived type `items` exposure leading to undefined type rendering.
  + Fix a naming bug in type exposure leading to false reuse types, disguising invididual type
    modifications (such as annotations, (auto-)redirections, element extensions).
  + Ignore `@Aggregation.default`.
  + Consolidate message texts and formatting.
  + Fix navigation property binding in cross service rendering mode.
  + Remove partner attribute in proxy/cross service navigations.
- Core engine (function `compile`):
  + Annotations for new columns inside `extend projection` blocks were not used.
  + Extending an unknown select item resulted in a crash.
  + Extending a context/service with columns now correctly emits an error.
  + Unmanaged `redirected to` in queries did not check whether the source is an association.
- parseCdl: `extend <art> with enum {...}` incorrectly threw a compiler error.
- API: `compile()` used a synchronous call `fs.realpathSync()` on the input filename array.  
  Now the asynchronous `fs.realpath()` is used.
- On-conditions in localized convenience views may be incorrectly rewritten if an element
  has the same as a localized entity.
- to.sql/hdi/hdbcds:
  + No referential constraint is generated for an association if its parent
  or target entity are annotated with `@cds.persistence.exists: true`.
  + Fix rendering of virtual elements in subqueries
  + Correctly process subqueries in JOINs
- to.sql/hdi: Queries with `UNION`, `INTERSECT` and similar in expressions are now enclosed in parentheses.

## Version 2.14.0 - 2022-04-08

### Added

- cdsc:
  + `--quiet` can now be used to suppress compiler output, including messages.
  + `--options <file.json>` can be used to load compiler options. A JSON file is expected. Is compatible to CDS `package.json`
    and `.cdsrc.json` by first looking for `cdsc` key in `cds`, then for a `cdsc` key and otherwise uses the full JSON file.
  + `--[error|warn|info|debug] id1,id2` can be used to reclassify specific messages.
- Add OData Vocabularies: 'DataIntegration', 'JSON'.
  
### Changed

- Update OData Vocabularies: 'UI'.

### Fixed

- to.cdl:
  + Delimited identifiers as the last elements of arrays in annotation values are now
    rendered with spaces in between, to avoid accidentally escaping `]`.
  + Identifiers in includes and redirection targets were not quoted if they are reserved keywords.
- to.edm(x): Correctly rewrite `@Capabilities.ReadRestrictions.ReadByKeyRestrictions` into
  `@Capabilities.NavigationPropertyRestriction` in containment mode.

## Version 2.13.8 - 2022-03-29

### Fixed

- to.hdbcds/hdi/sql: Correctly handle `localized` in conjunction with `@cds.persistence.exists` and `@cds.persistence.skip`

## Version 2.13.6 - 2022-03-25

### Fixed

- to.hdbcds/hdi/sql: Correctly handle `localized` in conjunction with `@cds.persistence.exists`

## Version 2.13.4 - 2022-03-22

No changes compared to Version 2.13.0; fixes latest NPM tag

## Version 2.13.2 - 2022-03-22

No changes compared to Version 2.13.0; fixes latest NPM tag

## Version 2.13.0 - 2022-03-22

### Added

- CDL syntax:
  + Allow to `extend E:elem` and `annotate E:elem` instead of having to write deeply nested statements.
  + Enable `default` values as part of scalar type definitions.
  + The following `extend` syntax variants are now possible:
    ```cds
    extend … with elements { … }
    extend … with definitions { … }
    extend … with columns { … }
    extend … with enum { … }
    extend … with actions { … }
    ```
    This syntax expresses _how_ an artifact is extended instead of _what_ is extended.
  + Using `ORDER BY` in generic functions such as SAP HANA's `first_value` is now possible.
- Make API function `compileSources` accept CSN objects as file content
- to.edm(x): Annotate view parameters with `@sap.parameter: mandatory` (V2) and `@Common.FieldControl: #Mandatory` (V4).
- to.sql/hdi/hdbcds: Introduce the annotations `@sql.prepend` and `@sql.append` that allow inserting user-written SQL
  snippets into the compiler generated content. Changes in annotations `@sql.prepend` and `@sql.append` are now reflected
  in the output of `to.hdi.migration`. This enables CDS Build to produce `.hdbmigrationtable` files translating such model
  changes into schema changes.
- API: Lists of keywords for various backends are available as `to.<backend>[.<config>].keywords`, e.g. `to.sql.sqlite.keywords`.
- for.odata/to.edm(x): The draft composition hull is now also taking into account compositions in subelements.

### Changed

- In query entities inside services, only auto-redirect associations and compositions
  in the main query of the entity.
- An element now inherits the property `notNull` from its query source (as
  before) or its type (like it does for most other properties);
  `notNull` is then not further propagated to its sub elements anymore.
- A structure element inherits the property `virtual` from its query source (as
  before), but does not further propagate `virtual` to its sub elements
  (semantically of course, but the CSN is not cluttered with it);
  there is a new warning if a previously `virtual` query entity
  element is now considered to be non-virtual.
- Do not propagate annotation value `null`.
  The value `null` of an annotation (and `doc`) is used to stop the inheritance
  of an annotation value.  This means than other than that, a value `null` should
  not be handled differently to not having set that annotation.
- In the effective CSN, the structure type is only expanded if something has changed
  for associations: the `target` (`keys` does not change if the `target` does not change)
  unmanaged associations as sub elements are not supported anyway.
- In the effective CSN, “simple” type properties like `length`, `precision`,
  `scale` and `srid` are propagated even for a propagation via type.
- Update OData Vocabularies: 'Capabilities', 'Common', 'Core', 'UI'.
- to.sql:
  + For SQL dialect `hana` referential constraints are now appended
    as `ALTER TABLE ADD CONSTRAINT` clause to the end of `schema.sql`.
    With option `constraintsInCreateTable` constraints are rendered into the
    `CREATE TABLE` statement.
  + Referential constraint names are now prefixed with `c__`.

### Fixed

- Properly resolve references inside anonymous aspects:
  + references starting with `$self.` made the compiler dump.
  + a simple `$self` did  not always work as expected (it represents the entity created via the anonymous aspect).
  + other references inside deeply nested anonymous aspects induced a compilation error.
- compiler: `()` inside `ORDER BY` clause was not correctly set.
- parse.cdl: References in `ORDER BY` and filters are now correctly resolved.
- Issue error when trying to introduce managed compositions of aspects in `mixin`s
- Issue error in all cases for type references to unmanaged associations.
- Avoid dump when extending an illegal definition with a name starting with `cds.`.
- to.sql/to.cdl/to.hdbcds/to.hdi: Render `cast()` inside `ORDER BY`, `GROUP BY` and `HAVING` properly.
- to.sql/hdi/hdbcds:
  + `$self` was incorrectly treated as a structured path step.
  + Correctly handle table alias in on-condition of mixin in `exists` expansion.
  + Correctly handle table `$self` references to aliased fields in on-condition of mixin association
    during `exists` expansion.
- to.edm: Don't escape `&` as `&amp;`.
- to.edmx: Escaping compliant to XML specification:
  + `&` and `<` are always escaped.
  + `>` is not escaped, unless it appears in text values as `]]>`.
  + `"` is escaped in attribute values only.
  + Control characters are always escaped.
- Ellipsis (`...`) in annotations in different layers but without base annotation now produces an error.
  The old but incorrect behavior can be re-enabled with option `anno-unexpected-ellipsis-layers`.

## Version 2.12.0 - 2022-01-25

### Added

- CDL parser: You can now use multiline string literals and text blocks.  
  Use backticks (\`) for string literals that can span multiple lines and can use JavaScript-like escape
  sequences such as `\u{0020}`.  You can also use three backticks (\`\`\`) for strings (a.k.a. text blocks)
  which are automatically indentation-stripped and can have an optional language identifier that is used
  for syntax highlighting, similar to markdown.  In difference to the former, text blocks require the
  opening and closing backticks to be on separate lines.
  Example:
  ````
  @annotation: `Multi
   line\u{0020}strings`

  @textblock: ```xml
              <summary>
                <detail>The root tag has no indentation in this example</detail>
              </summary>
              ```
  ````

- Enhance the ellipsis operator `...` for array annotations by an `up to ‹val›`:
  only values in the array of the base annotation up to (including) the first match
  of the specified `‹val›` are included at the specified place in the final array value.
  An array annotation can have more than on `... up to ‹val›` items and must also
  have a pure `...` item after them.  
  A structured `‹val›` matches if the array item is also a structure and all property
  values in `‹val›` are equal to the corresponding property value in the array value;
  it is not necessary to specify all properties of the array value items in `‹val›`.
  Example
  ```
  @Anno: [{name: one, val: 1}, {name: two, val: 2}, {name: four, val: 4}]
  type T: Integer;
  @Anno: [{name: zero, val: 0}, ... up to {name: two}, {name: three, val: 3}, ...]
  annotate T;
  ```
- for.odata: Support `@cds.on {update|insert}` as replacement for deprecated `@odata.on { update|insert }` to
  set `@Core.Computed`.

### Changed

- Update OData Vocabularies 'Aggregation', 'Capabilities', 'Common', 'Core', PersonalData, 'Session', 'UI'

### Fixed

- to.sql/hdi/hdbcds: With `exists`, ensure that the precedence of the existing association-on-conditions and where-conditions is kept by adding braces.
- to.sql/hdi: Window function suffixes are now properly rendered.
- to.sql: `$self` comparisons inside aspects are not checked and won't result in an error anymore.
- to.hdbcds:
  + Correctly apply the "."-to-"_"-translation algorithm to artifacts that are marked with `@cds.persistence.exists`.
  + Message with ID `anno-hidden-exists` (former `anno-unstable-hdbcds`) is now
    only issued if the compiler generates a SAP HANA CDS artifact which would hide
    a native database object from being resolved in a SAP HANA CDS `using … as …`.
- to.cdl: Annotation paths containing special characters such as spaces or `@` are now quoted, e.g. `@![some@annotation]`.
- compiler: A warning is emitted for elements of views with localized keys as the localized property is ignored for them.



## Older Versions

The change log for older entries can be found at
[`doc/CHANGELOG_ARCHIVE.md`](doc/CHANGELOG_ARCHIVE.md).
