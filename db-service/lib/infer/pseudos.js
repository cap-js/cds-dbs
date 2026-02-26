'use strict'

const cds = require('@sap/cds')
const { String, Timestamp } = cds.builtin.types

const pseudos = {
  elements: {
    $user: {
      elements: {
        id: String,
        locale: String, // deprecated
        tenant: String, // deprecated
      },
    },
    $now: Timestamp,
    $at: Timestamp,
    $from: Timestamp,
    $to: Timestamp,
    $locale: String,
    $tenant: String,
  },
}

module.exports = { pseudos }
