'use strict'

const cds = require('@sap/cds')

module.exports = {
  name: 'assoc-to-join: recursive depth 3',
  buildInput: () => cds.ql`SELECT from my.Genres { ID, parent.parent.parent.name }`,
}
