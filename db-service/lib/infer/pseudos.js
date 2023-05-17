'use strict'

// REVISIT: we should always return cds.linked elements
// > e.g. cds.linked({definitions:{pseudos}})
const pseudos = {
  elements: {
    $user: {
      elements: {
        id: { type: 'cds.String' },
        locale: { type: 'cds.String' }, // deprecated
        tenant: { type: 'cds.String' }, // deprecated
      },
    },
    $now: { type: 'cds.Timestamp' },
    $at: { type: 'cds.Timestamp' },
    $from: { type: 'cds.Timestamp' },
    $to: { type: 'cds.Timestamp' },
    $locale: { type: 'cds.String' },
    $tenant: { type: 'cds.String' },
  },
}

module.exports = { pseudos }
