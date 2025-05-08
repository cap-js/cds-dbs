module.exports = exports = adapter => exports.delete.bind(adapter)

/**
 * @type {import('express').Handler}
 * @this import('../RestAdapter')
 */
exports.delete = async function (req, res) {
  const { _query: query, _data: data, _params: params } = req

  await this.service.dispatch(this.request4({ query, data, params, req, res }))

  return { result: null, status: 204 }
}
