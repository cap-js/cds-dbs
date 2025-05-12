# ChangeLog of deprecated Features for cdx compiler and backends

<!-- markdownlint-disable MD024 -->
<!-- (no-duplicate-heading)-->

Note: `deprecated` features are listed in this ChangeLog just for information.
`deprecated` features will be removed after a certain grace period.

**Use `deprecated` features only transitional in productive mode.**

**When the `deprecated` option is set, the `beta` option is ignored,
and several new features are not available.**

## Version 6.0.2 - 2025-05-05

### Added `noQuasiVirtualAssocs`

If set, managed to-many associations will get foreign keys again.
In cds-compiler v6, managed to-many associations without explicit foreign keys
don't get `keys` anymore.  This flag restores v5 behavior.

### Added `noCompositionIncludes`

If set, generated entities for composition-of-named-aspect will not
get an `includes` property.

### Added `noPersistenceJournalForGeneratedEntities`

If set, `@cds.persistence.journal` will _not_ be propagated to generated entities,
including generated `.texts` entities for localized entities, nor generated entities
for compositions-of-aspect.

In cds-compiler v6, this annotation is copied to `.texts` entities as well as
generated composition-of-aspect entities it by default.

### Removed `includesNonShadowedFirst`

### Removed `eagerPersistenceForGeneratedEntities`

### Removed `noKeyPropagationWithExpansions`


## Version 4.2.0 - 2023-08-29

### Added `noKeyPropagationWithExpansions`

When this option is set, element `id` in types `Orig` and `I` are keys,
but `id` in `D` is not.

```cds
type Orig { key id: Integer };
type I: Orig {};
type D: Orig;
```

When this option is not set, element `id` in all three types are keys.

## Version 4.0.0 - 2023-06-06

### Added `downgradableErrors`

Allow to change the severity of some errors which are meant to stay errors in v4.

### Added `includesNonShadowedFirst`

Use this flag to keep adding elements from included definitions first, example:

```cds
entity A { one: Integer; two: String(10); three: Integer; }
entity E : A { two: String(12); }
// v3:  one, three, two
// v4:  one, two, three
```

### Added `ignoreSpecifiedQueryElements`

Use this flag if you want to ignore a query's `elements`, except for annotations and doc comments.
cds-compiler v3 and earlier simply ignored a query element except for its annotations.
cds-compiler v4 resolves the element's type.

### Removed `autoCorrectOrderBySourceRefs`

Instead of this deprecated flag, you can downgrade error message `ref-deprecated-orderby`.


## Version 3.1.0 - 2022-08-04

### Added `autoCorrectOrderBySourceRefs`

When this option is set, calling `compile` autocorrects direct `order by`
source element references without table alias for SELECT queries by adding the
table alias to the `ref`.

Using this option might lead to surprising results when elements are added to
existing models: `order by` specifications might change their semantics without
any extra messages.

## Version 3.0.0 - 2022-06-23

Version 3 of the cds-compiler removes all v2 deprecated flags.

### Add `eagerPersistenceForGeneratedEntities`

If enabled, the old behavior regarding `@cds.persistence.skip` and `@cds.persistence.exists`
is restored, i.e. these annotations are not copied from parent to generated child entities, nor
is `@cds.persistence.exists` copied to localized convenience views.

### Removed `createLocalizedViews`

### Removed `downgradableErrors`

### Removed `generatedEntityNameWithUnderscore`

### Removed `longAutoexposed`

### Removed `noElementsExpansion`

<!-- fully removed with 3.1.0 -->

### Removed `noInheritedAutoexposeViaComposition`

### Removed `noScopedRedirections`

### Removed `oldVirtualNotNullPropagation`

### Removed `parensAsStrings`

<!-- fully removed with 3.5.0 -->

### Removed `projectionAsQuery`

### Removed `redirectInSubQueries`

### Removed `renderVirtualElements`

### Removed `shortAutoexposed`

### Removed `unmanagedUpInComponent`

### Removed `v1KeysForTemporal`

## Version 2.13.0 - 2022-03-22

### Added `redirectInSubQueries`

When this option is set, we auto-redirect associations and composition also in
non-main queries, sometimes without rewriting the `keys`/`on` (there will be no
fix for this).

### Added `oldVirtualNotNullPropagation`

When this option is set, we do not propagate `notNull` along types.
Additionally, we propagate `notNull` and `virtual` from a query source element
to the sub elements of a query entity element, even if the property is not
propagated to the query entity element itself (like with type references).


## Version 2.2.0

### Added `noScopedRedirections`

When this option is set, the definition scope is not taken into account when
trying to find an implicit redirection target.  Setting the following
deprecated options also switches off scoped redirections (additionally to their
other effect): `noElementsExpansion`, `generatedEntityNameWithUnderscore`,
`shortAutoexposed`, `longAutoexposed`, `noInheritedAutoexposeViaComposition`.

### Added `noInheritedAutoexposeViaComposition`

When this option is set, only entities directly specified after `Composition of` are
auto-exposed, not entities used as target via explicit or implicit `redirected to`.

## Version 2.0.16

### Added `downgradableErrors`

Allow to change the severity of some errors which should stay to be an error.

### Added `shortAutoexposed`

When this option is set (and `generatedEntityNameWithUnderscore`), the names of
autoexposed entities are calculated according to the default compiler v1
behavior (without v1 options `dependentAutoexposed` and `longAutoexposed`).

## Version 2.0.10

### Added `longAutoexposed`

When this option is set (and `generatedEntityNameWithUnderscore`),
the names of auto-exposed entities are calculated according to the
compiler v1 option `longAutoexposed`.

### Added `generatedEntityNameWithUnderscore`

Keep using `_` is separator for generated auto-exposed entities and for entities
created for managed compositions.  It also disables a definition `A.B.C` if `A`
or `A.B` is a definition other than a context or service (v1 behavior).

## Version 2.0.4-ms1

### Added `createLocalizedViews`

Add localized convenience views in `for.odata`.

### Added `unmanagedUpInComponent`

Render association `up_` in composition component unmanaged.

## Version 2.0.2-ms1

### Added `renderVirtualElements`

Virtual elements are no longer rendered in views as `null as <id>` or added to potentially generated
draft tables. This behavior can be turned off with `renderVirtualElements` for backward compatibility.

### Added `parensAsStrings`

Represent parentheses in expressions with `'('` and `')'` in `xpr` arrays
instead of using nested `xpr`s or `list`.

### Added `v1KeysForTemporal`

Render old and broken temporal EDM API.

### Added `noElementsExpansion`

When setting it, association in sub elements are not automatically redirected,
and the sub elements cannot be annotated individually.

Do not use this.  Setting it might avoid some compile errors,
but in most cases the reported errors are rightly reported.

### Added `projectionAsQuery`

Render `projection` as `query` in CSN.
