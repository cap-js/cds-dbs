'use strict'

const cds = require('@sap/cds')

module.exports = {
  name: 'exists: simple',
  buildInput: () => cds.ql`SELECT from my.Books { ID } where exists author`,
}
