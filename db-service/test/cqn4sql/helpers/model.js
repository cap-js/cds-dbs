'use strict'

const cds = require('@sap/cds')
module.exports.loadModel = async (path, { flatModel=false, options={} } = {}) => {
  const m = await cds.load(path).then(cds.linked)
  return flatModel ? cds.compile.for.nodejs(m, options) : m
}
