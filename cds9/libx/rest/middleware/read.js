module.exports = exports = adapter => exports.read.bind(adapter)

/**
 * @type {import('express').Handler}
 * @this import('../RestAdapter')
 */
exports.read = async function (req, res) {
  const { _query: query, _target: target, _data: data, _params: params } = req

  let result,
    status = 200

  result = await this.service.dispatch(this.request4({ query, data, params, req, res }))

  // 204 or 404?
  if (result == null && query.SELECT.one) {
    if (target.ref.length > 1) status = 204
    else throw { code: 404 }
  }

  // REVISIT: Still needed with cds-mtxs?
  // compat for mtx returning strings instead of objects
  if (typeof result === 'object' && result !== null && '$count' in result) {
    result = { count: result.$count, value: result }
  } else if (typeof result === 'number') {
    result = result.toString()
  }

  return { result, status }
}
