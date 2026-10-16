'use strict'

const cds = require('@sap/cds')

module.exports = {
  name: 'exists: recursive depth 3',
  buildInput: () => cds.ql`SELECT from my.Genres { ID } where exists parent.parent.parent`,
}
