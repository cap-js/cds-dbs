# ChangeLog of Beta Features for cdx compiler and backends

<!-- markdownlint-disable MD024 -->
<!-- markdownlint-disable MD004 -->
<!-- (no-duplicate-heading)-->

Note: `beta` fixes, changes and features are listed in this ChangeLog just for information.
The compiler behavior concerning `beta` features can change at any time without notice.
**Don't use `beta` fixes, changes and features in productive mode.**

## Version 6.0.2 - 2025-05-05

### Added `v7preview`

Use this beta flag to enable features that will be available for cds-compiler v7.
It also enables new warnings and errors that are intended for the next version.

### Removed `v6preview`

Features are now enabled by default.

## Version 5.8.0 - 2025-02-27

### Added `v6preview`

Use this beta flag to enable features that will be available for cds-compiler v6.
It also enables new warnings and errors that are intended for the next version.

## Version 5.3.0 - 2024-09-25

### Removed `optionalActionFunctionParameters`

It is now enabled by default.

## Version 5.0.0 - 2024-05-29

## Removed `v5preview`

It is now enabled by default.

## Version 4.9.0 - 2024-04-25

### Removed `odataAnnotationExpressions`

It is now enabled by default.

### Removed `odataPathsInAnnotationExpressions`

It is now enabled by default.

### Removed `annotationExpressions`

It is now enabled by default.

### Added `temporalRawProjection`

Enables revocation of temporal where clause in projections of temporal entities if the
`@cds.valid { from, to }` annotations on the projection elements have falsy values.

## Version 4.8.0 - 2024-03-21

### Removed `vectorType`

It is now always enabled.

### Added `v5preview`

Sneak preview into incompatible changes that are about to be shipped with compiler version 5.

## Version 4.6.0 - 2024-01-26

### Added `vectorType`

Using this beta flag, the new type `cds.Vector` is available for modeling.

## Version 4.5.0 - 2023-12-08

### Added `odataAnnotationExpressions`

This flag allows to use expressions as annotation values, e.g.
`@anno: (1+2)` and to enable OData specific transformations on those expressions.

### Added `tenantVariable`

If this beta flag is enabled, variable `$tenant` can be used without explicit replacement value.

### Added feature "associations as direct calculated element values"

This beta feature does not require a flag.  It is now possible to use associations with
filters as direct values of calculated elements (on-read), e.g. `calc = assoc[ID = 1]`.

## Version 4.3.0 - 2023-09-29

### Removed `associationDefault`

This flag is now the default. Managed associations with exactly one foreign key can now
have a default value.

## Version 4.1.0 - 2023-07-28

### Added `associationDefault`

With this beta flag enabled, managed associations with exactly one foreign key can now
have a default value.

### Removed `aspectWithoutElements`

Aspects without elements can now be defined without beta flag, e.g. `aspect A;`.

## Version 4.0.0 - 2023-06-06

### Removed `v4preview`

`v4preview` is now the default.

### Removed `calculatedElementsOnWrite`

It is now enabled by default.  The feature is still "beta".

### Removed `ignoreAssocPublishingInUnion`

The behavior is now the default.  If you still want to get an error message for
ignored published associations in unions, you can change the severity of message
`query-ignoring-assoc-in-union` to an error via `options.severities`.

## Version 3.9.2 - 2023-04-27

### Removed `odataOpenType`

This feature is now set to production mode.

## Version 3.9.0 - 2023-04-20

### Added `calculatedElementsOnWrite`

Allows to define calculated elements "on-write" in entities and aspects.
For example:

```cds
entity E { one: Integer; two = one + 1 stored; };
```

When a row is added to `E`, column `two` will be set automatically
in databases supporting generated columns.

## Version 3.8.0 - 2023-03-27

### Added `v4preview`

This beta flags tries to imitate cds-compiler v4 behavior.
This includes new compiler messages as well as potentially breaking changes.

Enable this beta flag to ease upgrading to cds-compiler v4.

This flag does not guarantee full compatibility with v4, but only
helps to identify potential issues as soon as possible.

### Removed `calculatedElements`

Now enabled per default.

## Version 3.7.0 - 2023-02-22

### Added `annotationExpressions`

This option allows to use expressions as annotation values, e.g.
`@anno: (1+2)`.

### Added `calculatedElements`

Allows to define calculated elements in entities and aspects.  When used in views, they
are replaced by their value, for example:

```cds
entity E { one: Integer; two = one + 1; };
entity P as projection on E { two };
// P is the same as:
entity P as projection on E { one + 1 as two };
```

This allows to define calculations centrally at the entity, which can be used by
other views.

## Version 3.5.0 - 2022-12-07

### Added `odataTerms`

Allows to introduce and use new `Edm.Term`s in an OData API
based on CDS annotations. Annotations must be service members,
they can't be autoexposed.

## Version 3.4.0 - 2022-10-26

### Added `aspectWithoutElements`

- Aspects can now be defined without elements, e.g. `aspect A;`. This allows the definition of annotation-only aspects.
 Views can be extended by such an aspect. For example:
  ```cds
  entity V as projection on SomeEntity;
  @anno aspect A;
  extend V with A;
  ```

### Added `sqlMigration`

- to.sql.migration: Offer something similar to to.hdi.migration, but for general SQL. Don't offer a complete out-of-the-box schema evolution, instead only
allow lossless, easy to revert actions like adding a column or extending a string length.

## Version 3.3.0 - 2022-09-29

### Removed `nestedProjections`

- This is now the default - see CHANGELOG entry for 3.3.0.

### Fixed `nestedProjections`

- Issue an error for an unexpected `as ‹alias›` for references with `inline`;
  people likely have confused `inline` with `expand`.
- Resolving references in the user-provided `on` condition of projected or newly-defined
  associations inside `expand` and `inline` now works correctly.
- Correct `key` propagation for references with `expand` or `inline`.
- If an element is projected with sibling `expand`, the original data structure is usually
  _not preserved_ (why use an `expand` if it is?).  Therefore, the compiler cannot auto-rewrite
  the `on` condition of unmanaged associations if such an element is referred to in the original
  `on` condition.  In that case, provide your own via `…: redirected to … on ‹condition›`.

## Version 3.1.0 - 2022-08-04

### Added `optionalActionFunctionParameters`

- to.edm(x): Annotate optional function/action parameters with `@Core.OptionalParameter` for OData V4.
  An action/function parameter is optional if
  1) it is already annotated with `@Core.OptionalParameter` regardless of its definition.
  2) it has a default value (including null), regardless of it's nullability
  3) it has NO default value but is nullable (the implicit default value is null)

  If a mandatory parameter (not null and no default value) appears after an optional
  parameter, a warning is raised, Core.OptionalParameter requires that all optional
  parameters appear rightmost.

### Added `odataOpenType`

- to.edm(x): Support annotation `@open` on entity and structured type level to declare the
  corresponding entity/complex type to be `OpenType=true`. If an open structured type is declared
  closed (with a falsy annotation value), the corresponding EDM type is closed as well and suffixed
  with `_closed` (or `_open` vice versa).
  No further checks are performed on possibly open foreign or primary key types nor on eventually
  bucket elements to store the additional data.

## Version 3.0.0 - 2022-06-23

### Removed `addTextsLanguageAssoc`

Instead, use the option `addTextsLanguageAssoc`, which is available since v2.8.0.

## Version 2.12.0 - 2022-01-25

### Added `sqlSnippets`

- to.sql/hdi/hdbcds: Introduce the annotations `@sql.prepend` and `@sql.append` that allow inserting user-written SQL snippets into the compiler generated content.

## Version 2.11.0 - 2021-12-02

### Removed `foreignKeyConstraints`

## Version 2.10.4 - 2021-11-05

### Fixed `nestedProjections`

- to.sql/hdi/hdbcds: Correctly handle a `*` at the not-first place in the query

## Version 2.6.0 - 2021-08-23

### Removed `pretransformedCSN`

### Removed `renderSql`

### Removed `keylessManagedAssoc`

This is now the default - see CHANGELOG entry for 2.6.0

### Fixed `nestedProjections`

- to.sql/hdi/hdbcds: now work correctly when nested projections are used

### Fixed `foreignKeyConstraints`

- Always use the name of the association / backlink compared to
  `$self` as name suffix for a constraint
- Composition of one always result in:
  + ON DELETE RESTRICT
  + ON UPDATE RESTRICT
- Composition of one w/o backlink will result in a constraint in
  the entity where the composition is defined

## Version 2.4.4 - 2021-07-02

### Added `nestedProjections`

- Support `expand`: columns can look like `assoc_or_struct_or_tabalias { col_expression1, … }`,
  `longer.ref as name { *, … } excluding { … }`, `{ col_expression1 as sub1, … } as name`, etc.
- Support `inline`: columns can look like `assoc_or_struct_or_tabalias.{ col_expression1, … }`,
  `longer.ref[filter = condition].{ *, … } excluding { … }`, `assoc_or_struct_or_tabalias.*`, etc.
- _Some checks are missing and will be added! Minor changes might occur._
- **The SQL backends might not work properly yet if nested projections are used!**

## Version 2.4.2 - 2021-07-01

### Added `keylessManagedAssoc`

- Support managed associations without foreign keys. Associations targeting a definition without primary keys or with an
  explicit empty foreign key tuple or with empty structured elements as foreign keys and their corresponding `$self`
  comparisons do not describe the relationship between the source and the target entity.
  These associations can be used to establish API navigations but cannot be used to access elements in the target
  entity as they cannot be transformed into a valid JOIN expression.
  Consequently, these associations are not added to the `WITH ASSOCIATIONS` clause or forwarded to HANA CDS.
  Managed Associations without foreign keys must be enabled with `--beta: keylessManagedAssoc`

## Version 2.4.0 - 2021-06-28

### Changed `foreignKeyConstraints`

- `toSql`/`toHdbcds`: omit constraint generation if the option `skipDbConstraints` is set
- If the database constraints are switched off by the global option,
  render constraints nevertheless if an association / composition
  is annotated with `@cds.persistence.assert.integrity: true`
- omit constraint generation if an association / composition
  is annotated with `@cds.persistence.assert.integrity: false`
  -> for managed compositions, the `up_` link in the compositions target entity
  will not result in a constraint if the composition is annotated as described

## Version 2.0.8

### Added `foreignKeyConstraints`

to.sql/to.hdi: If the beta option `foreignKeyConstraints` is supplied,
referential constraints are generated for compliant associations and compositions.

## Version 2.0.2

### Removed `dontRenderVirtualElements`

Virtual elements are no longer rendered in views as `null as <id>` or
added to potentially generated draft tables. This behavior can be turned off
with deprecated option `renderVirtualElements` for backward compatibility.

### Removed `originalKeysForTemporal`

### Removed `odataDefaultValues`

OData: Default values for EntityType properties are rendered always.

### Removed `subElemRedirections`

This option is now enabled by default.

### Removed `keyRefError`

## Version 1.44.0

### Added `addTextsLanguageAssoc`

When the beta option `addTextsLanguageAssoc` is set to true and
the model contains an entity `sap.common.Languages` with an element `code`,
all generated texts entities additionally contain an element `language`
which is an association to `sap.common.Languages` using element `locale`.

## Version 1.43.0

### Changed `subElemRedirections`

When the beta option `subElemRedirections` is set to true,
_all_ array (new!) and structure types are expanded when referenced:
managed associations (and compositions to entities) in that array are
implicitly redirected when necessary.
See [below for details](#version-1300---2020-06-12).

Nested array types (without intermediate structure types) are not supported.

### Added `ignoreAssocPublishingInUnion`

For `to.hdbcds`, with beta flag `ignoreAssocPublishingInUnion` in conjunction with dialect
`hanaJoins`, unmanaged associations in UNIONs are silently ignored and managed associations
are replaced by their foreign keys and silently ignored

## Version 1.36.0 - 2020-08-07

### Added `mapAssocToJoinCardinality`

Analog to the feature `cardinality for explicit joins`, the association to
join transformation algorithm now experimentally supports join cardinalities as well.
The default cardinality `MANY TO ONE` is added to the join node if no cardinality has
been specified.

### Added `odataDefaultValues`

OData: Enables the rendering of default values for EntityType properties.

### Added `originalKeysForTemporal`

OData: The original entity keys are not enhanced with `@cds.valid.from` or replaced with
`@cds.valid.key` elements. The `@Core.AlternateKeys` only mentions the `@cds.valid.key` element.

### Added `dontRenderVirtualElements`

Virtual elements are no longer rendered in views as `null as <id>` or added to potentially generated
draft tables. This behavior can be turned off with `renderVirtualElements` for backward compatibility.

### Removed `noJoinsForForeignKeys`

The association to join transformation treats foreign key accesses with priority now.

### Removed `uniqueconstraints`

Unique constraints are now generally available.

## Version 1.33.0 - 2020-08-24

### Added `hanaAssocRealCardinality`

Render JOIN cardinality in native HANA association if provided. If no cardinality has been specified.

## Version 1.32.0 - 2020-07-10

### Removed `aspectCompositions`

Aspect compositions aka managed compositions are now available without beta option.
_Warning_: the CSN representation can still change.

## Version 1.31.0 - 2020-06-26

### Changed `subElemRedirections`

Signal an error
if an unmanaged association as sub element is to be implicitly redirected,
as we do not automatically rewrite the `on` condition in that situation yet.

## Version 1.30.0 - 2020-06-12

### Added `subElemRedirections`

When the beta option `subElemRedirections` is set to true,
_all_ structure types are expanded when referenced:

- managed associations (and compositions to entities) are implicitly redirected
  when necessary,
- sub elements of referred structure types can be annotated individually,
- the resulting CSN is bigger (will be reduced in the future if possible)
  as `type` references to structures will now have a sibling `elements`.

This option does not enable:

- rewriting the `on` conditions of associations in sub elements,
- aspect compositions as sub elements,
- `localized` sub elements,
- `key` property on sub elements.

## Version 1.23.0

### Added `keyRefError`

Always signal an error (instead of just a warning in some cases),
if not all references in the `keys` of a managed associations
are projected in the new target.
