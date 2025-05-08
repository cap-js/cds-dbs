// based on now removed libx/_runtime/common/generic/put.js

const cds = require('../../lib')

const getTemplate = require('../_runtime/common/utils/template')

/**
 * adds default value or null (if nullable) for each property that was not provided
 * and is neither key nor read-only (e.g., managed, virtual, etc.)
 */
module.exports = function prepare_put_requests(service, target, data) {
  // REVISIT: export a no op insetad of this early exit (requires to rewrite tests)
  if (!cds.env.runtime.put_as_replace) return

  const template = getTemplate('put', service, target, {
    pick: element => {
      if (!element.isAssociation && !element.key && !element._isReadOnly && !element['@cds.api.ignore']) {
        if (element.default) return { category: 'default', args: element.default }
        if (!element.notNull) return { category: 'null' }
      }
    },
    ignore: element => element._isAssociationStrict
  })
  if (template.elements.size === 0) return

  template.process(data, ({ row, key, element, plain }) => {
    if (!row || row[key] !== undefined) return

    const { category, args } = plain
    if (category === 'default') {
      row[key] = args.val
    } else if (category === 'null' && !element._isStructured) {
      row[key] = null
    }
  })
}
