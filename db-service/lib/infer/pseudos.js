'use strict'

// Define built-in types for pseudo references such as $user, $now and $tenant.
// Share this metadata between reference binding and inference compatibility.

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
