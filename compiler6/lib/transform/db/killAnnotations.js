'use strict';

const { sqlServiceAnnotation } = require('./processSqlServices');

const requiredAnnos = {
  '@cds.persistence.skip': true,
  '@cds.persistence.exists': true,
  '@cds.persistence.table': true,
  '@cds.persistence.journal': true, // Build checks on it
  '@cds.tenant.independent': true,
  '@sql.append': true,
  '@sql.prepend': true,
  '@sql.replace': true, // We do a check on this, no real function
  '@assert.unique': true, // We do a check on this, no real function
  '@assert.integrity': true,
  '@cds.valid.from': true,
  '@cds.valid.to': true,
  '@cds.valid.key': true,
  '@odata.draft.enabled': true,
  '@fiori.draft.enabled': true,
  '@cds.persistence.calcview': true,
  '@cds.persistence.udf': true,
  '@cds.autoexpose': true,
  '@cds.autoexposed': true,
  '@cds.redirection.target': true,
  '@Core.Computed': true,
  [sqlServiceAnnotation]: true,
  '@cds.external': true, // for external ABAP SQL services and data products for now
};

/**
 *
 * @param {object} carrier
 * @param {string} annoKey
 */
function killNonrequiredAnno( carrier, annoKey ) {
  if (!requiredAnnos[annoKey] && !annoKey.startsWith('@assert.unique.'))
    delete carrier[annoKey];
}


module.exports = { killNonrequiredAnno };
