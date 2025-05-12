// Render functions for toSql.js

'use strict';

const { getResultingName } = require('../../model/csnUtils');
const { smartId, delimitedId } = require('../../sql-identifier');
const { ModelError } = require('../../base/error');

/**
 * Render a given referential constraint as part of a SQL CREATE TABLE statement, or as .hdbconstraint artefact.
 *
 * @param {CSN.ReferentialConstraint} constraint Content of the constraint
 * @param {string} indent Indent to render the SQL with
 * @param {boolean} toUpperCase Whether to uppercase the identifier
 * @param {CSN.Model} csn CSN
 * @param {CSN.Options} options is needed for the naming mode and the sql dialect
 * @param {boolean} [alterConstraint=false] whether the constraint should be rendered as part of an ALTER TABLE statement
 *
 * @returns {string} SQL statement which can be used to create the referential constraint on the db.
 */
function renderReferentialConstraint( constraint, indent, toUpperCase, csn, options, alterConstraint = false ) {
  const quoteId = getIdentifierUtils(csn, options).quoteSqlId;
  if (toUpperCase) {
    constraint.identifier = constraint.identifier.toUpperCase();
    constraint.foreignKey = constraint.foreignKey.map(fk => fk.toUpperCase());
    constraint.parentKey = constraint.parentKey.map(fk => fk.toUpperCase());
    constraint.dependentTable = constraint.dependentTable.toUpperCase();
    constraint.parentTable = constraint.parentTable.toUpperCase();
  }

  const renderAsHdbconstraint = options.transformation === 'hdbcds' ||
                                options.src === 'hdi';

  const { sqlMapping, sqlDialect } = options;
  let result = '';
  result += `${ indent }CONSTRAINT ${ quoteId(constraint.identifier) }\n`;
  if (renderAsHdbconstraint)
    result += `${ indent }ON ${ quoteId(getResultingName(csn, sqlMapping, constraint.dependentTable)) }\n`;
  if (!alterConstraint) {
    result += `${ indent }FOREIGN KEY(${ constraint.foreignKey.map(quoteId).join(', ') })\n`;
    result += `${ indent }REFERENCES ${ quoteId(getResultingName(csn, sqlMapping, constraint.parentTable)) }(${ constraint.parentKey.map(quoteId).join(', ') })\n`;
    const onDeleteRemark = constraint.onDeleteRemark ? ` -- ${ constraint.onDeleteRemark }` : '';

    // omit 'RESTRICT' action for ON UPDATE / ON DELETE, because it interferes with deferred constraint check
    if (sqlDialect === 'sqlite' || sqlDialect === 'postgres') {
      if (constraint.onDelete === 'CASCADE' )
        result += `${ indent }ON DELETE ${ constraint.onDelete }${ onDeleteRemark }\n`;
    }
    else {
      result += `${ indent }ON UPDATE RESTRICT\n`;
      result += `${ indent }ON DELETE ${ constraint.onDelete }${ onDeleteRemark }\n`;
    }
  }
  // constraint enforcement / validation must be switched off using sqlite pragma statement
  // constraint enforcement / validation not supported by postgres
  if (options.transformation === 'hdbcds' || (options.toSql && sqlDialect !== 'sqlite' && sqlDialect !== 'postgres')) {
    result += `${ indent }${ !constraint.validated ? 'NOT ' : '' }VALIDATED\n`;
    result += `${ indent }${ !constraint.enforced ? 'NOT ' : '' }ENFORCED\n`;
  }
  // for sqlite and postgreSQL, the DEFERRABLE keyword is required
  result += `${ indent }${ sqlDialect === 'sqlite' || sqlDialect === 'postgres' ? 'DEFERRABLE ' : '' }INITIALLY DEFERRED`;
  return result;
}

/**
 * Get functions which can be used to prepare and quote SQL identifiers based on the options provided.
 *
 * @param {CSN.Options} options
 * @returns quoteSqlId and prepareIdentifier function
 */
function getIdentifierUtils( csn, options ) {
  return { quoteSqlId, prepareIdentifier, renderArtifactName };
  /**
   * Return 'name' with appropriate "-quotes.
   * Additionally perform the following conversions on 'name'
   * If 'options.sqlMapping' is 'plain'
   *   - replace '.' or '::' by '_'
   * else if 'options.sqlMapping' is 'quoted'
   *   - replace '::' by '.'
   * Complain about names that collide with known SQL keywords or functions
   *
   * @param {string} name Identifier to quote
   * @returns {string} Quoted identifier
   */
  function quoteSqlId( name ) {
    name = prepareIdentifier(name);

    switch (options.sqlMapping) {
      case 'plain':
        return smartId(name, options.sqlDialect);
      case 'quoted':
        return delimitedId(name, options.sqlDialect);
      case 'hdbcds':
        return delimitedId(name, options.sqlDialect);
      default:
        return undefined;
    }
  }

  /**
     * Prepare an identifier:
     * If 'options.sqlMapping' is 'plain'
     *   - replace '.' or '::' by '_'
     * else if 'options.sqlMapping' is 'quoted'
     *  - replace '::' by '.'
     *
     * @param {string} name Identifier to prepare
     * @returns {string} Identifier prepared for quoting
     */
  function prepareIdentifier( name ) {
    // Sanity check
    if (options.sqlDialect === 'sqlite' && options.sqlMapping !== 'plain')
      throw new ModelError(`Not expecting ${ options.sqlMapping } names for 'sqlite' dialect`);


    switch (options.sqlMapping) {
      case 'plain':
        return name.replace(/(\.|::)/g, '_');
      case 'quoted':
        return name.replace(/::/g, '.');
      case 'hdbcds':
        return name;
      default:
        throw new ModelError(`No matching rendering found for naming mode ${ options.sqlMapping }`);
    }
  }

  /**
   * Given the following artifact name: namespace.prefix.entity.with.dot, render the following,
   * depending on the naming mode:
   * - plain: NAMESPACE_PREFIX_ENTITY_WITH_DOT
   * - quoted: namespace.prefix.entity_with_dot
   * - hdbcds: namespace::prefix.entity_with_dot
   *
   *
   * @param {string} artifactName Artifact name to render
   *
   * @returns {string} Artifact name
   */
  function renderArtifactName( artifactName ) {
    return quoteSqlId(getResultingName(csn, options.sqlMapping, artifactName));
  }
}


module.exports = {
  renderReferentialConstraint,
  getIdentifierUtils,
};
