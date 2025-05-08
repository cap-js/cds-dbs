
'use strict';

const { checkCSNVersion } = require('../json/csnVersion');
const { forEachDefinition } = require('../model/csnUtils');
const { transformForRelationalDBWithCsn } = require('../transform/forRelationalDB');
const { getIdentifierUtils } = require('./utils/sql');


/**
 * Generate SQL DDL rename statements for a migration, renaming existing tables and their
 * columns so that they match the result of "toHana" or "toSql" with the 'plain' option for names.
 * Expects the naming convention of the existing tables to be either 'quoted' or 'hdbcds' (default).
 * The following options control what is actually generated (see help above):
 *   options : {
 *     sqlMapping :  existing names, either 'quoted' or 'hdbcds' (default)
 *   }
 * Return a dictionary of top-level artifacts by their names, like this:
 * { "foo" : "RENAME TABLE \"foo\" ...",
 *   "bar::wiz" : "RENAME VIEW \"bar::wiz\" ..."
 * }
 *
 * @todo clarify input parameters
 * @param {CSN.Model} inputCsn CSN?
 * @param {CSN.Options} options Transformation options
 * @param {object} messageFunctions
 * @returns {object} A dictionary of name: rename statement
 */
function toRename( inputCsn, options, messageFunctions ) {
  const { warning, throwWithError } = messageFunctions;

  // Merge options with defaults.
  // TODO: Use api/options.js if this ever becomes an official API.
  options = Object.assign({ sqlMapping: 'hdbcds', sqlDialect: 'hana' }, options);
  checkCSNVersion(inputCsn, options);

  // Let users know that this is internal
  warning(null, null, 'Generation of SQL rename statements is a beta feature and might change in the future');

  // FIXME: Currently, 'toRename' implies transformation for HANA (transferring the options to forRelationalDB)
  const csn = transformForRelationalDBWithCsn(inputCsn, options, messageFunctions);
  messageFunctions.setModel(csn);
  const hdbcdsOrQuotedIdentifiers = getIdentifierUtils(csn, options);
  const plainIdentifiers = getIdentifierUtils(csn, { sqlDialect: 'hana', sqlMapping: 'plain' });

  // forRelationalDB looses empty contexts and services, add them again so that toRename can calculate the namespaces
  forEachDefinition(csn, (artifact, artifactName) => {
    if ((artifact.kind === 'context' || artifact.kind === 'service') && csn.definitions[artifactName] === undefined)
      csn.definitions[artifactName] = artifact;
  });

  const result = Object.create(null);

  // Render each artifact on its own
  for (const artifactName in csn.definitions) {
    const sourceStr = renameTableAndColumns(artifactName, csn.definitions[artifactName]);
    if (sourceStr !== '')
      result[artifactName] = sourceStr;
  }

  throwWithError();

  return {
    rename: result,
    options,
  };

  /**
   * If 'art' is a non-view entity, generate SQL statements to rename the corresponding
   * table and its columns from the naming conventions given in 'options.sqlMapping'
   * (either 'quoted' or 'hdbcds') to 'plain'. In addition, drop any existing associations
   * from the columns (they would likely become invalid anyway).
   * Do not rename anything if the names are identical.
   *
   * @param {string} artifactName Name of the artifact to rename
   * @param {CSN.Artifact} art CSN artifact
   * @returns {string} RENAME statements
   */
  function renameTableAndColumns( artifactName, art ) {
    let resultStr = '';
    if (art.kind === 'entity' && !art.query) {
      const beforeTableName = hdbcdsOrQuotedIdentifiers.renderArtifactName(artifactName);
      const afterTableName = plainIdentifiers.renderArtifactName(artifactName);

      if (beforeTableName.toUpperCase() === `"${ afterTableName }"`)
        resultStr += `  --EXEC 'RENAME TABLE ${ beforeTableName } TO ${ afterTableName }';\n`;
      else if (beforeTableName !== afterTableName)
        resultStr += `  EXEC 'RENAME TABLE ${ beforeTableName } TO ${ afterTableName }';\n`;


      resultStr += Object.keys(art.elements).map((name) => {
        const e = art.elements[name];
        let str = '';

        const beforeColumnName = hdbcdsOrQuotedIdentifiers.quoteSqlId(name);
        const afterColumnName = plainIdentifiers.quoteSqlId(name);

        if (!e.$ignore) {
          if (e.target)
            str = `  EXEC 'ALTER TABLE ${ afterTableName } DROP ASSOCIATION ${ beforeColumnName }';\n`;
          else if (beforeColumnName.toUpperCase() === `"${ afterColumnName }"` ) // Basically a no-op - render commented out
            str = `    --EXEC 'RENAME COLUMN ${ afterTableName }.${ beforeColumnName } TO ${ afterColumnName }';\n`;
          else if (beforeColumnName !== afterColumnName)
            str = `    EXEC 'RENAME COLUMN ${ afterTableName }.${ beforeColumnName } TO ${ afterColumnName }';\n`;
        }
        return str;
      }).join('');
    }
    return resultStr;
  }
}

module.exports = {
  toRename,
};
