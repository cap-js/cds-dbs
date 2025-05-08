const cds = require('../../cds')
const { DRAFT_COLUMNS_MAP } = require('../../common/constants/draft')

const _getStaticOrders = req => {
  const { target: entity, query } = req
  const ordersFromKeys = []

  if (req.target._isSingleton || query.SELECT.limit) {
    const keys = [...(entity.keys || [])].filter(k => !k.isAssociation).map(k => k.name)
    for (const key of keys) {
      if (!(key in DRAFT_COLUMNS_MAP)) {
        ordersFromKeys.push({ by: { '=': key }, implicit: true })
      }
    }
  }

  if (entity.query && entity.query.SELECT && entity.query.SELECT.orderBy) {
    const orderBy = entity.query.SELECT.orderBy
    const ordersFromView = orderBy.map(keyName => ({
      by: { '=': keyName.ref[keyName.ref.length - 1] },
      desc: keyName.sort === 'desc'
    }))
    return [...ordersFromView, ...ordersFromKeys]
  }

  return ordersFromKeys
}

const _addDefaultSortOrder = (req, select) => {
  // "static orders" = the orders not from the query options
  let staticOrders = _getStaticOrders(req)

  // remove defaultOrder if not part of group by
  const groupBy = select?.groupBy || select?.from?.SELECT?.groupBy

  if (groupBy?.length > 0) staticOrders = staticOrders.filter(d => groupBy.some(e => e.ref[0] === d.by['=']))

  if (!staticOrders.length) return

  if (select?.from?.SELECT?.groupBy?.length > 0) select = select.from.SELECT
  select.orderBy = select.orderBy ?? []
  select.orderBy.push(
    ...staticOrders
      .filter(d => !select.orderBy.find(o => o.ref && o.ref.join('_') === d.by['=']))
      .map(d => {
        const orderByRef = { ref: [d.by['=']], sort: d.desc ? 'desc' : 'asc' }
        if (d.implicit) orderByRef.implicit = true
        return orderByRef
      })
  )
}

/**
 * 1. query options --> already set in req.query
 * 2. orders from view
 * 3. orders from keys if singleton or limit is set
 *
 * @param req
 */
const handle_sorting = function (req) {
  if (!req.query || !req.query.SELECT || req.query.SELECT.one) return

  let select = req.query.SELECT

  // do not sort for /$count queries or queries only using aggregations
  if (select.columns && select.columns.length && select.columns.every(col => col.func)) {
    return
  }

  if (select.from && select.from.SELECT) {
    // add default sort to root query
    _addDefaultSortOrder(req, select)

    // apply default sort to bottom-most sub-query
    while (select.from.SELECT) select = select.from.SELECT
  }
  _addDefaultSortOrder(req, select)
}
handle_sorting._initial = true

/**
 * handler registration
 */
module.exports = cds.service.impl(function () {
  this.before('READ', '*', handle_sorting)
})

// needed in lean draft
module.exports.handler = handle_sorting
