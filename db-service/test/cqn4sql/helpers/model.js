'use strict'

const cds = require('@sap/cds')
/**
 * Loads the combined model for all cqn4sql and cds.infer tests
 * @param {string|string[]} [path] - Path(s) to the model files, defaults to combined schema
 */
module.exports.loadModel = async ({ flat=false, options={} } = {}, path = [__dirname + '/../model/index']) => {
  const m = await cds.load(path).then(cds.linked)
  return flat ? cds.compile.for.nodejs(m, options) : m
}
