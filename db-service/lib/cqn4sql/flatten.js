'use strict'

const { indexColumns } = require('./projection-plan')
const { bindingFor } = require('./binding')

module.exports = { getColumnsForWildcard, getElementForRef, getFlatColumnsFor }

const columnsModule = require('./columns')
const sourcesModule = require('./sources')

const { keysOf, foreignKeysOf } = require('./model')

const { isCalculatedOnRead, defineProperty } = require('../utils')
const { getFullName, setElementOnColumns, idOnly, isAssocOrStruct } = require('./helpers')

/**
 * This function converts a wildcard into explicit columns.
 *
 * Based on the query's `$combinedElements` attribute, the function computes the flat column representations
 * and returns them. Additionally, it prepends the respective table alias to each column. Columns specified
 * in the `excluding` clause are ignored during this transformation.
 *
 * Furthermore, foreign keys (FK) for OData CSN and blobs are excluded from the wildcard expansion.
 *
 * @param {array} exclude - An optional list of columns to be excluded during the wildcard expansion.
 * @param {array} replace - An optional list of columns to replace during the wildcard expansion.
 * @param {string} baseName - the explicit alias of the column.
 * Only possible for anonymous expands on implicit table alias: `select from books { { * } as FOO }`
 *
 * @returns {Array} Returns an array of explicit columns derived from the wildcard.
 */
function getColumnsForWildcard(ctx, exclude = [], replace = [], baseName = null) {
  exclude = indexColumns(exclude)
  replace = indexColumns(replace)
  const wildcardColumns = []
  for (const k of Object.keys(ctx.query.$combinedElements)) {
    if (!exclude.has(k)) {
      const { index, tableAlias } = ctx.query.$combinedElements[k][0]
      const element = tableAlias.elements[k]
      // ignore FK for odata csn (but not for subquery sources where FK is not a separate element) / ignore blobs and vectors from wildcard expansion
      if (
        (!tableAlias.SELECT && isManagedAssocInFlatMode(element)) ||
        element.type === 'cds.LargeBinary' ||
        element.type === 'cds.Vector'
      )
        continue
      // for wildcard on subquery in from, just reference the elements
      if (tableAlias.SELECT && !element.elements && !element.target) {
        wildcardColumns.push(index ? { ref: [index, k] } : { ref: [k] })
      } else if (isCalculatedOnRead(element)) {
        wildcardColumns.push(columnsModule.resolveCalculatedElement(ctx, replace.get(k) || element))
      } else {
        const flatColumns = getFlatColumnsFor(
          ctx,
          element,
          { tableAlias: index, baseName },
          [],
          { exclude, replace },
          true,
        )
        wildcardColumns.push(...flatColumns)
      }
    }
  }
  return wildcardColumns

  /**
   * foreign keys are already part of the elements in a flat model
   * not excluding the associations from the wildcard columns would cause duplicate columns upon foreign key expansion
   * @param {CSN.element} e
   * @returns {boolean} true if the element is a managed association and the model is flat
   */
  function isManagedAssocInFlatMode(e) {
    return (
      e.isAssociation &&
      keysOf(e, ctx.state.metadata) &&
      (ctx.model.meta.transformation === 'odata' || ctx.model.meta.unfolded?.includes('structs'))
    )
  }
}

/**
 * Resolve `ref` within `def` and return the element
 *
 * @param {string[]} ref
 * @param {CSN.Artifact} def
 * @returns {CSN.Element}
 */
function getElementForRef(ctx, ref, def) {
  return ref.reduce((prev, res) => {
    return (
      (prev?.elements || foreignKeysOf(prev, ctx.state.metadata))?.[res] ||
      ctx.getDefinition(prev?.target)?.elements[res]
    ) // PLEASE REVIEW: should we add the .foreignKey check here for the non-ucsn case?
  }, def)
}

/**
 * Recursively expands a structured element into flat columns, representing all leaf paths.
 *
 * Structures → flat sub-element columns. Associations → flat foreign key columns.
 * Scalars → single column reference.
 *
 * @param {object} column - The element to expand (may be a ref with $refLinks, or a raw element definition).
 * @param {{
 *  baseName?: string,
 *  columnAlias?: string,
 *  tableAlias?: string
 * }} [names] - Naming context:
 *   - `baseName` — accumulated underscore-joined prefix for the flat column ref (e.g. `'address'` → `'address_street'`).
 *   - `columnAlias` — explicit alias for the output column. Defaults to `column.as` when omitted.
 *   - `tableAlias` — table alias prepended to the column ref.
 * @param {string[]} [csnPath=[]] - Accumulated CSN element path (used for `_csnPath` metadata on leaf columns).
 * @param {{ exclude?: Array, replace?: Array }} [excludeAndReplace] - Columns to exclude or replace during wildcard expansion.
 * @param {boolean} [isWildcard=false] - Whether this expansion originates from a wildcard; filters out LargeBinary and Vector.
 * @returns {object[]} Flat column(s) for the given element.
 */
function getFlatColumnsFor(ctx, column, names, csnPath = [], excludeAndReplace, isWildcard = false) {
  if (!column) return column
  if (column.val || column.func || column.SELECT) return [column]

  const structsAreUnfoldedAlready = ctx.model.meta.unfolded?.includes('structs')
  let { baseName, columnAlias = column.as, tableAlias } = names || {}
  if (excludeAndReplace)
    excludeAndReplace = {
      exclude: indexColumns(excludeAndReplace.exclude),
      replace: indexColumns(excludeAndReplace.replace),
    }
  const { exclude, replace } = excludeAndReplace || {}
  const { $refLinks, flatName, isJoinRelevant } = column
  let firstNonJoinRelevantAssoc, stepAfterAssoc
  let element = $refLinks ? $refLinks[$refLinks.length - 1].definition : column
  if (isWildcard && (element.type === 'cds.LargeBinary' || element.type === 'cds.Vector')) return []
  if (element.on && !keysOf(element, ctx.state.metadata)) return [] // unmanaged doesn't make it into columns
  if (element.virtual === true) return []

  if (!isJoinRelevant && flatName) baseName = flatName
  else if (isJoinRelevant) {
    const earlyResult = resolveJoinRelevantNames()
    if (earlyResult) return earlyResult
  } else if (!baseName && structsAreUnfoldedAlready) {
    baseName = element.name // name is already fully constructed
  } else {
    baseName = baseName ? `${baseName}_${element.name}` : getFullName(element)
  }

  // now we have the name of the to be expanded column
  // it could be a structure, an association or a scalar
  // check if the column shall be skipped
  // e.g. for wildcard elements which have been overwritten before
  if (exclude && getReplacement(exclude)) return []
  const replacedBy = getReplacement(replace)
  if (replacedBy) {
    // the replacement alias is the baseName of the flat structure
    // e.g. `office.{ *, address.city as floor }`
    // for the `ref: [ office, floor ]` we find the replacement
    // `ref: [ office, address, city]` so the `baseName` of the replacement
    if (replacedBy.as) replacedBy.as = baseName
    // we might have a new base ref
    if (replacedBy.ref && replacedBy.ref.length > 1)
      baseName = getFullName(replacedBy.$refLinks?.[replacedBy.$refLinks.length - 2].definition)
    if (replacedBy.isJoinRelevant)
      // we need to provide the correct table alias
      tableAlias = sourcesModule.getTableAlias(ctx, replacedBy)

    if (replacedBy.expand) return [{ as: baseName }]

    return getFlatColumnsFor(ctx, replacedBy, { baseName, columnAlias: replacedBy.as, tableAlias }, csnPath)
  }

  csnPath = [...csnPath, element.name]

  if (keysOf(element, ctx.state.metadata)) return flattenForeignKeys()
  if (element.elements && element.type !== 'cds.Map') return flattenStructElements()
  return buildScalarColumn()

  function flattenStructElements() {
    const flatRefs = []
    for (const e of Object.values(element.elements)) {
      const alias = columnAlias ? `${columnAlias}_${e.name}` : null
      flatRefs.push(
        ...getFlatColumnsFor(
          ctx,
          e,
          { baseName, columnAlias: alias, tableAlias },
          csnPath,
          excludeAndReplace,
          isWildcard,
        ),
      )
    }
    return flatRefs
  }

  function buildScalarColumn() {
    const flatRef = tableAlias ? { ref: [tableAlias, baseName] } : { ref: [baseName] }
    if (column.cast) {
      flatRef.cast = column.cast
      if (!columnAlias) columnAlias = baseName
    }
    if (column.sort) flatRef.sort = column.sort
    if (columnAlias) flatRef.as = columnAlias
    setElementOnColumns(flatRef, element)
    defineProperty(flatRef, '_csnPath', csnPath)
    return [flatRef]
  }

  function getReplacement(from) {
    return from?.get(element.name)
  }

  function resolveJoinRelevantNames() {
    const binding = bindingFor(ctx, column)
    const leafAssocIndex = binding.foreignKeyIndex
    firstNonJoinRelevantAssoc = column.$refLinks[leafAssocIndex] || binding.association
    stepAfterAssoc = column.$refLinks.at(leafAssocIndex + 1) || column.$refLinks.at(-1)
    const targetElements =
      firstNonJoinRelevantAssoc.definition.elements ||
      foreignKeysOf(firstNonJoinRelevantAssoc.definition, ctx.state.metadata)
    if (targetElements && stepAfterAssoc.definition.name in targetElements) {
      element = firstNonJoinRelevantAssoc.definition
      baseName = getFullName(firstNonJoinRelevantAssoc.definition)
      columnAlias = column.as || column.ref.slice(0, -1).map(idOnly).join('_')
    } else {
      baseName = getFullName(column.$refLinks.at(-1).definition)
    }

    if (column.element && !isAssocOrStruct(column.element)) {
      columnAlias =
        column.as ||
        (leafAssocIndex === -1
          ? columnAlias
          : column.ref
              .slice(leafAssocIndex - 1)
              .map(idOnly)
              .join('_'))
      const res = { ref: [tableAlias, bindingFor(ctx, column).columnName], as: columnAlias }
      setElementOnColumns(res, column.element)
      return [res]
    }
    return null
  }

  function flattenForeignKeys() {
    const flatColumns = []
    for (const k of keysOf(element, ctx.state.metadata)) {
      const fkElement = getElementForRef(ctx, k.ref, ctx.getDefinition(element.target))
      // if only one part of a foreign key is requested, only flatten the partial key
      const shouldFlatten =
        !$refLinks || // the association is passed as element, not as ref --> flatten full foreign key
        element === $refLinks.at(-1).definition || // the association is the leaf of the ref --> flatten full foreign key
        fkElement === stepAfterAssoc.definition // the foreign key is the leaf of the ref --> only flatten this specific foreign key
      if (!shouldFlatten) continue

      // e.g. if foreign key is accessed via infix filter - use join alias to access key in target
      const fkBaseName =
        !firstNonJoinRelevantAssoc || firstNonJoinRelevantAssoc.onlyForeignKeyAccess
          ? `${baseName}_${k.as || k.ref.at(-1)}`
          : k.ref.at(-1)
      const fkPath = [...csnPath, k.ref.at(-1)]

      if (fkElement.elements) {
        // structured key
        for (const e of Object.values(fkElement.elements)) {
          let alias
          if (columnAlias) {
            const fkName = k.as
              ? `${k.as}_${e.name}` // foreign key might also be re-named: `assoc { id as foo }`
              : `${k.ref.join('_')}_${e.name}`
            alias = `${columnAlias}_${fkName}`
          }
          flatColumns.push(
            ...getFlatColumnsFor(
              ctx,
              e,
              { baseName: fkBaseName, columnAlias: alias, tableAlias },
              fkPath,
              excludeAndReplace,
              isWildcard,
            ),
          )
        }
      } else if (fkElement.isAssociation) {
        // assoc as key
        flatColumns.push(
          ...getFlatColumnsFor(
            ctx,
            fkElement,
            { baseName, columnAlias, tableAlias },
            csnPath,
            excludeAndReplace,
            isWildcard,
          ),
        )
      } else {
        // leaf reached
        let flatColumn
        if (columnAlias) {
          // if the column has an explicit alias AND the original ref
          // directly resolves to the foreign key, we must not append the fk name to the column alias
          // e.g. `assoc.fk as FOO` => columns.alias = FOO
          //      `assoc as FOO`    => columns.alias = FOO_fk
          let fkAlias = columnAlias
          if (!(column.as && fkElement === column.$refLinks?.at(-1).definition))
            fkAlias = `${columnAlias}_${k.as || k.ref.join('_')}`
          flatColumn = { ref: [fkBaseName], as: fkAlias }
        } else {
          flatColumn = { ref: [fkBaseName] }
        }
        if (tableAlias) flatColumn.ref.unshift(tableAlias)

        // in a flat model, we must assign the foreign key rather than the key in the target
        const flatForeignKey = ctx.getDefinition(element.parent.name)?.elements[fkBaseName]
        setElementOnColumns(flatColumn, flatForeignKey || fkElement)
        defineProperty(flatColumn, '_csnPath', csnPath)
        flatColumns.push(flatColumn)
      }
    }
    return flatColumns
  }
}
