'use strict'

const cds = require('@sap/cds')

module.exports = {
  name: 'assoc-to-join: simple',
  buildInput: () => cds.ql`SELECT from my.Books { ID, author.name }`,
}
