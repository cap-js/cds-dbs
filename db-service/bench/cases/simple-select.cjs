'use strict'

const cds = require('@sap/cds')

module.exports = {
  name: 'Most Basic Select',
  buildInput: () => cds.ql`SELECT from my.Books { ID }`,
}
