
'use strict';

const {
  forEachDefinition,
  getResultingName,
} = require('../model/csnUtils');
const { forEach } = require('../utils/objectUtils');
const { transformForRelationalDBWithCsn } = require('../transform/forRelationalDB');

const {
  renderReferentialConstraint, getIdentifierUtils,
} = require('./utils/sql');
const { sortCsn } = require('../model/cloneCsn');

/**
 * Used only by `cdsc manageConstraints`.
 * Not part of our API, yet.
 *
 * @param {CSN.Model} csn
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @param {CSN.Options} options
 */
function alterConstraintsWithCsn( csn, options, messageFunctions ) {
  const { error, warning } = messageFunctions;

  const {
    drop, alter, src, violations, sqlDialect,
  } = options;

  if (!sqlDialect || sqlDialect === 'h2' || sqlDialect === 'plain')
    warning(null, null, { prop: sqlDialect || 'plain' }, 'Referential Constraints are not available for sql dialect $(PROP)');

  if (drop && alter)
    // eslint-disable-next-line cds-compiler/message-no-quotes
    error(null, null, 'Option “--drop” can\'t be combined with “--alter”');

  // Of course, we want the database constraints
  options.assertIntegrityType = options.assertIntegrityType || 'DB';

  const transformedOptions = _transformSqlOptions(csn, options);
  const forSqlCsn = transformForRelationalDBWithCsn(csn, transformedOptions, messageFunctions);

  if (violations && src && src !== 'sql') {
    error(null, null, { value: '--violations', othervalue: src },
          'Option $(VALUE) can\'t be combined with source style $(OTHERVALUE)');
  }

  let intermediateResult;
  if (violations)
    intermediateResult = listReferentialIntegrityViolations(forSqlCsn, transformedOptions);
  else
    intermediateResult = manageConstraints(options.testMode ? sortCsn(forSqlCsn) : forSqlCsn, transformedOptions);

  return intermediateResult;
}

// TODO: Remove / Move to api/options.js once alterConstraintsWithCsn is available outside bin/cdsc
function _transformSqlOptions( csn, options ) {
  const { src } = options;

  const prepareOptions = require('../api/options');
  options = prepareOptions.to.sql(options);
  options.src = src;
  // Merge options with defaults.
  options = Object.assign({ sqlMapping: 'plain', sqlDialect: 'plain' }, options);
  options.toSql = true;
  if (!options.src && !options.csn)
    options.src = 'sql';
  return options;
}

/**
 * This render middleware can be used to generate SQL DDL ALTER TABLE <table> ALTER / ADD / DROP CONSTRAINT <constraint> statements for a given CDL model.
 * Moreover, it can be used to generate .hdbconstraint artifacts.
 * Depending on the options.manageConstraints provided, the VALIDATED / ENFORCED flag of the constraints can be adjusted.
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @returns a map holding the constraint identifier as key and the corresponding, rendered SQL statement / hdbconstraint artifact as value.
 */
function manageConstraints( csn, options ) {
  const indent = options.src === 'hdi' ? '  ' : ''; // indent `.hdbconstraint`
  // either ALTER TABLE statements or .hdbconstraint artifacts
  const resultArtifacts = {};
  const { quoteSqlId } = getIdentifierUtils(csn, options);
  forEachDefinition(csn, (artifact) => {
    if (artifact.$tableConstraints?.referential) {
      forEach(artifact.$tableConstraints.referential, (fileName, constraint) => {
        resultArtifacts[fileName] = manageConstraint(constraint, csn, options, indent, quoteSqlId);
      });
    }
  });
  return resultArtifacts;
}

function manageConstraint( constraint, csn, options, indent, quoteSqlId ) {
  const renderAlterConstraintStatement = options.alter && options.src !== 'hdi';
  const renderedConstraint = renderReferentialConstraint(constraint, indent, false, csn, options, renderAlterConstraintStatement);
  if (options.src === 'hdi' && !options.drop)
    return renderedConstraint;
  let alterTableStatement = '';
  alterTableStatement += `${ indent }ALTER TABLE ${ quoteSqlId(getResultingName(csn, options.sqlMapping, constraint.dependentTable)) }`;
  if (renderAlterConstraintStatement)
    alterTableStatement += `\n${ indent }ALTER ${ renderedConstraint };`;
  else if (options.drop)
    alterTableStatement += `${ indent } DROP CONSTRAINT ${ quoteSqlId(constraint.identifier) };`;
  else
    alterTableStatement += `\n${ indent }ADD ${ renderedConstraint };`;

  return alterTableStatement;
}

/**
 * For a given csn model with foreign keys constraints, generate SELECT statements
 * which can be used to SELECT all rows of the dependent table which violate the referential integrity.
 *
 * @param {CSN.Model} csn
 * @returns a map holding the constraint identifier as key and the corresponding rendered SQL-SELECT statement as value.
 */
function listReferentialIntegrityViolations( csn, options ) {
  const { quoteSqlId } = getIdentifierUtils(csn, options);
  const referentialConstraints = getListOfAllConstraints(csn);
  const resultArtifacts = {};
  const indent = '    ';
  const increaseIndent = str => `    ${ str }`;
  // helper function to reduce parent key / foreign key array to a comma separated string which can be used in a select clause
  const keyStringReducer = prefix => (prev, curr, index) => (index > 0 ? `${ prev },\n${ curr } AS "${ prefix }:${ curr }"` : prev);
  // helper function to reduce the parent key / foreign key arrays of a referential constraint to a join list which can be used in a where clause
  const joinPkWithFkReducer = (constraint, subQueryAlias, mainQueryAlias) => (prev, curr, index) => (index > 0
    ? `${ prev } AND
    ${ increaseIndent(indent) }"${ mainQueryAlias }".${ quoteSqlId(constraint.foreignKey[index]) } = ${ subQueryAlias }.${ quoteSqlId(constraint.parentKey[index]) }`
    : increaseIndent(increaseIndent(indent)) + prev);

  Object.entries(referentialConstraints).forEach(([ identifier, constraint ], index) => {
    let selectViolations = 'SELECT\n';
    // this column indicates which SELECT revealed the integrity violation
    // and helps to identify the corrupted table
    selectViolations += `${ index } as "SELECT-ID",\n`;
    // SELECT <primary_key>,
    const primaryKeyList = selectPrimaryKeyColumns(constraint);
    if (primaryKeyList)
      selectViolations += `${ primaryKeyList },\n`;
    // ... <foreign_key>
    selectViolations += selectForeignKeyColumns(constraint);
    const mainQueryAlias = `MAIN_${ index }`;
    // ... FROM <dependent table> AS "${index}"
    selectViolations += `\nFROM ${ quoteAndGetResultingName(constraint.dependentTable) } AS "${ mainQueryAlias }"\n`;
    // ... WHERE NOT (<(part of) foreign key is null>)
    selectViolations += whereNotForeignKeyIsNull(constraint);
    /*
    ... AND NOT EXISTS (
            SELECT * FROM <parent_table> WHERE <dependent_table>.<foreign_key> = <parent_table>.<parent_key>
        )
    */
    selectViolations += andNoMatchingPrimaryKeyExists(constraint, mainQueryAlias);
    resultArtifacts[identifier] = selectViolations;
  });

  /**
   * Generate a SELECT list holding all primary key columns of the dependent table found in the referential constraint.
   *
   * @param {CSN.ReferentialConstraint} constraint
   * @returns comma separated list of primary key columns
   */
  function selectPrimaryKeyColumns( constraint ) {
    const pkReducer = keyStringReducer('K');
    const primaryKeyOfDependentTable = Object.keys(csn.definitions[constraint.dependentTable].elements)
      .filter((key) => {
        const element = csn.definitions[constraint.dependentTable].elements[key];
        return element.key && element.type !== 'cds.Association' && element.type !== 'cds.Composition';
      });
    // if no primary key is set in the table
    if (primaryKeyOfDependentTable.length === 0)
      return '';
    return primaryKeyOfDependentTable.reduce(pkReducer, `${ quoteSqlId(primaryKeyOfDependentTable[0]) } AS "K:${ primaryKeyOfDependentTable[0] }"`);
  }

  /**
   * Generate a SELECT list holding all foreign key columns found in the referential constraint.
   *
   * @param {CSN.ReferentialConstraint} constraint
   * @returns comma separated list of foreign key columns
   */
  function selectForeignKeyColumns( constraint ) {
    const fkReducer = keyStringReducer('FK');
    return constraint.foreignKey.reduce(fkReducer, `${ quoteSqlId(constraint.foreignKey[0]) } AS "FK:${ constraint.foreignKey[0] }"`);
  }

  /**
   * Generate SQL WHERE condition asserting to true if none of the foreign key parts has a NULL value in the DB.
   *
   * @param {CSN.ReferentialConstraint} constraint
   * @returns WHERE NOT ( <foreign_key IS NULL ... ) statement
   */
  function whereNotForeignKeyIsNull( constraint ) {
    let whereNot = `${ indent }WHERE NOT (\n`;
    whereNot += constraint.foreignKey
      .reduce((prev, curr, index) => {
        if (index > 0)
          return `${ prev } OR \n${ increaseIndent(indent) }${ quoteSqlId(curr) } IS NULL`;
        return increaseIndent(indent) + prev;
      }, `${ quoteSqlId(constraint.foreignKey[0]) } IS NULL`);
    whereNot += `\n${ indent })`;
    return whereNot;
  }

  /**
   * Generate SQL sub-SELECT, listing all rows of the parent table where no matching primary key column for the respective foreign key is found.
   *
   * @param {CSN.ReferentialConstraint} constraint
   * @param {string} mainQueryAlias
   * @returns AND NOT EXISTS ( SELECT * FROM <parent_table> WHERE <dependent_table>.<foreign_key> = <parent_table>.<parent_key> ) statement
   */
  function andNoMatchingPrimaryKeyExists( constraint, mainQueryAlias ) {
    let andNotExists = `\n${ indent }AND NOT EXISTS (\n`;
    andNotExists += `${ increaseIndent(indent) }SELECT * FROM ${ quoteAndGetResultingName(constraint.parentTable) }`;
    // add an alias to both queries so that they can be distinguished at all times
    const subQueryAlias = '"SUB"';
    andNotExists += ` AS ${ subQueryAlias }`;
    andNotExists += '\n';
    const joinListReducer = joinPkWithFkReducer(constraint, subQueryAlias, mainQueryAlias);
    andNotExists += `${ increaseIndent(indent) }WHERE (\n`;
    andNotExists += constraint.foreignKey
      .reduce(joinListReducer,
              `"${ mainQueryAlias }".${ quoteSqlId(constraint.foreignKey[0]) } = ${ subQueryAlias }.${ quoteSqlId(constraint.parentKey[0]) }`);
    andNotExists += `\n${ increaseIndent(indent) })`;
    andNotExists += `\n${ indent });`;
    return andNotExists;
  }

  function quoteAndGetResultingName( id ) {
    return quoteSqlId(getResultingName(csn, options.sqlMapping, id));
  }

  return resultArtifacts;
}


function getListOfAllConstraints( csn ) {
  const referentialConstraints = {};
  forEachDefinition(csn, (artifact) => {
    if (artifact.$tableConstraints && artifact.$tableConstraints.referential) {
      forEach(artifact.$tableConstraints.referential, (identifier, referentialConstraint) => {
        referentialConstraints[identifier] = referentialConstraint;
      });
    }
  });
  return referentialConstraints;
}

module.exports = {
  alterConstraintsWithCsn,
  manageConstraints,
  manageConstraint,
  listReferentialIntegrityViolations,
};
