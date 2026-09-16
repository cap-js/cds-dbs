'use strict'

const cds = require('@sap/cds')

module.exports = {
  name: 'expand: recursive depth 3',
  buildInput: () => cds.ql`SELECT from my.Genres { ID, parent { parent { parent { name }}} }`,
}
