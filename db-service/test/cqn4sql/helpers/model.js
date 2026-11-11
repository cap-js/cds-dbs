'use strict'

const cds = require('@sap/cds')
const freezeData = require('./freezeData')
/**
 * Loads and freezes the combined test model after linking and optional compilation.
 * @param {string|string[]} [path] - Path(s) to the model files, defaults to combined schema
 */
module.exports.loadModel = async ({ flat=false, options={} } = {}, path = [__dirname + '/../model/index']) => {
  const m = await cds.load(path).then(cds.linked)
  return freezeData(flat ? cds.compile.for.nodejs(m, options) : m)
}
