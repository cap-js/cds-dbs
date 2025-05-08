'use strict';

const { isPersistedOnDatabase } = require('../model/csnUtils.js');

/**
 * Check that we don't have parameterized views - as we don't know yet how to represent them on postgres
 *
 * @param {object} parent Object with .params
 * @param {string} name Name of the params property on parent
 * @param {object} params params
 * @param {CSN.Path} path
 */
function checkForParams( parent, name, params, path ) {
  const artifact = this.csn.definitions[path[1]];
  if (artifact.kind === 'entity' && isPersistedOnDatabase(artifact) && artifact['@cds.persistence.exists'] !== true && parent.kind === 'entity') {
    if (artifact.query || artifact.projection) {
      if (this.options.sqlDialect === 'hana') {
        for (const pname in artifact.params) {
          if (pname.match(/\W/g) || pname.match(/^\d/) || pname.match(/^_/)) { // parameter name must be regular SQL identifier
            this.warning(null, [ ...path, 'params', pname ], 'Expecting regular SQL-Identifier');
          }
          else if (this.options.sqlMapping !== 'plain' && pname.toUpperCase() !== pname) { // not plain mode: param name must be all upper
            this.warning(null, [ ...path, 'params', pname ], { name: this.options.sqlMapping },
                         'Expecting parameter to be uppercase in naming mode $(NAME)');
          }
        }
      }
      else {
        this.error('ref-unexpected-params', [ ...path, 'params' ], { value: this.options.sqlDialect },
                   'Parameterized views can\'t be used with sqlDialect $(VALUE)');
      }
    }
    else {
      this.error(null, path, { '#': this.options.toSql ? 'sql' : 'std' }, {
        std: 'Table-like entities with parameters are not supported for conversion to SAP HANA CDS',
        sql: 'Table-like entities with parameters are not supported for conversion to SQL',
      });
    }
  }
}

function checkAssocsWithParams( member, memberName, prop, path ) {
  // Report an error on
  // - view with parameters that has an element of type association/composition
  // - association that points to entity with parameters
  if (member.target && this.csnUtils.isAssocOrComposition(member)) {
    if (this.artifact.params) {
      // HANA does not allow 'WITH ASSOCIATIONS' on something with parameters:
      // SAP DBTech JDBC: [7]: feature not supported: parameterized sql view cannot support association: line 1 col 1 (at pos 0)
      this.message('def-unexpected-paramview-assoc', path, { '#': 'source' });
    }
    else if (this.artifact['@cds.persistence.udf'] || this.artifact['@cds.persistence.calcview']) {
      // UDF/CVs w/o params don't support 'WITH ASSOCIATIONS'
      const anno = this.artifact['@cds.persistence.udf'] ? '@cds.persistence.udf' : '@cds.persistence.calcview';
      this.message('def-unexpected-calcview-assoc', path, { '#': 'source', anno });
    }
    if (this.csn.definitions[member.target].params) {
      // HANA does not allow association targets with parameters or to UDFs/CVs w/o parameters:
      // SAP DBTech JDBC: [7]: feature not supported: cannot support create association to a parameterized view
      this.message('def-unexpected-paramview-assoc', path, { '#': 'target' });
    }
    else if (this.csn.definitions[member.target]['@cds.persistence.udf'] || this.csn.definitions[member.target]['@cds.persistence.calcview']) {
      // HANA won't check the assoc target but when querying an association with target UDF, this is the error:
      // SAP DBTech JDBC: [259]: invalid table name: target object SYSTEM.UDF does not exist: line 3 col 6 (at pos 43)
      // CREATE TABLE F (id INTEGER NOT NULL);
      // CREATE FUNCTION UDF RETURNS TABLE (ID INTEGER) LANGUAGE SQLSCRIPT SQL SECURITY DEFINER AS BEGIN RETURN SELECT ID FROM F; END;
      // CREATE TABLE Y (  id INTEGER NOT NULL,  toUDF_id INTEGER) WITH ASSOCIATIONS (MANY TO ONE JOIN UDF AS toUDF ON (toUDF.id = toUDF_id));
      // CREATE VIEW U AS SELECT  id, toUDF.a FROM Y;
      const anno = this.csn.definitions[member.target]['@cds.persistence.udf'] ? '@cds.persistence.udf' : '@cds.persistence.calcview';
      this.message('def-unexpected-calcview-assoc', path, { '#': 'target', anno });
    }
  }
}

module.exports = {
  csnValidator: {
    params: checkForParams,
  },
  memberValidator: checkAssocsWithParams,
};
