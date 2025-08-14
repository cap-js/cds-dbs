'use strict'

const cds = require('@sap/cds')
/**
 * Loads the combined model for all cqn4sql and cds.infer tests
 * @param {string|string[]} [path] - Path(s) to the model files, defaults to combined schema
 */
module.exports.loadModel = async (path = [__dirname + '/../model/index'], { flatModel=false, options={} } = {}) => {
  const m = await cds.load(path).then(cds.linked)
  return flatModel ? cds.compile.for.nodejs(m, options) : m
}
