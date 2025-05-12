'use strict';

const { requireForeignKeyAccess } = require('../checks/onConditions');

/**
 * Check that associations in filters (in an exists expression) are only fk-accesses. Everything else is forbidden.
 *
 * @param {CSN.Artifact} parent
 * @param {string} name
 * @param {Array} expr
 */
function forbidAssocInExists( parent, name, expr ) {
  for (let i = 0; i < expr.length - 1; i++) {
    if (expr[i] === 'exists' && expr[i + 1].ref) {
      i++;
      const current = expr[i];

      const { _links } = expr[i];

      const assocs = _links.filter(link => link.art?.target).map(link => current.ref[link.idx]);

      checkForInvalidAssoc.call(this, assocs);
    }
  }
}

/**
 * Check that associations in filters (in an exists expression) are only fk-accesses. Everything else is forbidden.
 *
 * @param {object[]} assocs Array of refs of assocs - possibly with a .where to check
 */
function checkForInvalidAssoc( assocs ) {
  for (const assoc of assocs) {
    if (assoc.where) {
      for (let i = 0; i < assoc.where.length; i++) {
        const part = assoc.where[i];

        if (part._links && !(assoc.where[i - 1] && assoc.where[i - 1] === 'exists')) {
          for (const link of part._links) {
            if (link.art && link.art.target) {
              if (link.art.keys) { // managed - allow FK access
                const next = part._links[link.idx + 1];
                if (next !== undefined) { // there is a next path step - check if it is a fk
                  requireForeignKeyAccess(part, i, (errorIndex) => {
                    const { ref } = assoc.where[part.$path[part.$path.length - 1]];
                    this.error('ref-expecting-foreign-key', part.$path, { alias: ref[errorIndex], id: assoc.id, name: ref[link.idx] });
                  });
                }
                else { // no traversal, ends on managed
                  this.error('ref-unexpected-assoc', part.$path, { '#': 'managed-filter', id: assoc.id, name: assoc.where[part.$path[part.$path.length - 1]].ref[link.idx] });
                }
              }
              else { // unmanaged - always wrong
                this.error('ref-unexpected-assoc', part.$path, { '#': 'unmanaged-filter', id: assoc.id, name: assoc.where[part.$path[part.$path.length - 1]].ref[link.idx] });
              }
              // Recursively drill down if the assoc-step has a filter
              if (part.ref[link.idx].where)
                checkForInvalidAssoc.call(this, [ part.ref[link.idx] ]);
            }
          }
        }
      }
    }
  }
}

module.exports = {
  having: forbidAssocInExists,
  where: forbidAssocInExists,
  xpr: forbidAssocInExists,
};
