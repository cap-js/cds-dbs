'use strict'

module.exports = { processRuntimeViews, addWith, updateRefsWithRTVAlias }

const transformOwned = require('./transform')

const cloneCqn = require('./clone')
const { defineProperty, hasOwnSkip, isRuntimeView } = require('../utils')

/**
 * If the target entity is annotated with persistence skip and has an underlying db entity,
 * we treat it as a runtime view and transform it into a CTE.
 *
 * @param {object} transformedQuery - The query object to be transformed.
 * @param {string} model - The data model used for inference and transformation.
 */
function processRuntimeViews(ctx, transformedQuery, model) {
  const currentDef = transformedQuery._target

  if (hasOwnSkip(currentDef)) {
    if (!isRuntimeView(currentDef)) throw new Error(`${currentDef.name} is not a runtime view`)

    addWith(ctx, currentDef, transformedQuery, model)
    updateRefsWithRTVAlias(ctx, transformedQuery._with, transformedQuery)
  }
}

/**
 * Recursively call cqn4sql for all nested runtime views to calculate cte and
 * add it as a with clause to the transformed query.
 * Alias the runtime view with a unique alias and update all references to the runtime view to point to the alias.
 *
 * @param {object} rootDefinition - The root definition of the query. This is used to recursively process nested runtime views.
 * @param {object} transformedQuery - The query object to be transformed.
 * @param {string} model - The data model used for infer and cqn4sql.
 */
function addWith(ctx, rootDefinition, transformedQuery, model) {
  if (!rootDefinition?.query) return

  // early exit if already processed
  if (transformedQuery._with?.some(w => w._source === rootDefinition)) return

  const q = cloneCqn(rootDefinition.query)
  if (q.SELECT) {
    if (!q.SELECT.columns) q.SELECT.columns = ['*']
    if (q.SELECT.columns.includes('*')) {
      // cache element names for faster lookup
      const existingColumns = new Set(q.SELECT.columns.map(col => col.as || col.ref?.at(-1)).filter(Boolean))

      for (let el of rootDefinition.elements) {
        if (el.type === 'cds.LargeBinary' && !existingColumns.has(el.name)) {
          q.SELECT.columns.push({ ref: [el.name] })
        }
      }
    }
  }
  q._with = transformedQuery._with
  const transformedDQ = transformOwned(q, model, ctx.useTechnicalAlias, ctx.state)

  if (q.SELECT?.from?.args) {
    for (const arg of transformedDQ.SELECT.from.args) {
      addWith(ctx, arg.$refLinks.at(-1).definition, transformedDQ, model)
      arg.as ??= arg.ref.at(-1).split('.').at(-1) // apply @sap/cds-compiler default alias
      updateRefsWithRTVAlias(ctx, transformedDQ._with, transformedDQ, arg.ref)
    }
  }

  const newWiths = transformedDQ._with || []
  const rootDefinitionName = rootDefinition.name

  defineProperty(transformedDQ, '_source', rootDefinition)
  const alias = `RTV_${ctx.getImplicitAlias(rootDefinitionName)}`
  transformedDQ.as = transformedDQ.joinTree.addNextAvailableTableAlias(alias, newWiths, rootDefinitionName)

  // update SELECT.from with runtime view alias
  if (hasOwnSkip(transformedDQ._target)) updateRefsWithRTVAlias(ctx, transformedDQ._with, transformedDQ)

  if (transformedDQ._with) delete transformedDQ._with
  newWiths.push(transformedDQ)

  // propagate with clauses
  transformedQuery._with = newWiths
}

function updateRefsWithRTVAlias(ctx, _with, query, ref) {
  if (!_with?.length) return

  const _updateRef = ref => {
    const refAlias = ref[0]
    if (/RTV_$/.test(refAlias)) return
    for (const w of _with) {
      const aliasValue = w.joinTree._queryAliases.get(refAlias)
      if (aliasValue) {
        ref[0] = aliasValue
        if (query.joinTree?._queryAliases) {
          query.joinTree._queryAliases.set(refAlias, aliasValue)
        }
        break
      }
    }
  }

  if (ref) return _updateRef(ref)

  if (query.SELECT.from.args) for (const arg of query.SELECT.from.args) _updateRef(arg.ref)
  else if (query.SELECT.from.ref) _updateRef(query.SELECT.from.ref)
}
