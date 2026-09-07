'use strict'

const cds = require('@sap/cds')

module.exports = {
  name: 'expand: simple',
  buildInput: () => cds.ql`SELECT from my.Authors { ID, books { title } }`,
}
