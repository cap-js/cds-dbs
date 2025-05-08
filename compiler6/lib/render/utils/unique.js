'use strict';

/**
 * Render the "CONSTRAINT <XY>;" for HDI or SQL.
 *
 * @param {object} constraint The constraint to add
 * @param {string} constraintName Name of the constraint - needs to be escaped on caller side
 * @param {string} tableName Name of the table with the constraint - needs to be escaped on caller side
 * @param {function} quoteSqlId Usual rendering function
 * @param {object} options Options
 * @returns {string}
 */
function renderUniqueConstraintString( constraint, constraintName, tableName, quoteSqlId, options ) {
  const c = constraint.paths;
  const refs = c.map(cpath => quoteSqlId(cpath.ref[0])).join(', ');
  if (options.src === 'hdi')
    return `UNIQUE INVERTED INDEX ${ constraintName } ON ${ tableName } (${ refs })`;

  return `CONSTRAINT ${ constraintName } UNIQUE (${ refs })`;
}
/**
 * Render the "ALTER TABLE XY DROP CONSTRAINT <Z>;"
 *
 * @param {object} constraint The constraint to drop
 * @param {string} constraintName Name of the constraint - needs to be escaped on caller side
 * @param {string} tableName Name of the table with the constraint - needs to be escaped on caller side
 * @param {function} quoteSqlId Usual rendering function
 * @returns {string}
 */
function renderUniqueConstraintDrop( constraint, constraintName, tableName, quoteSqlId ) {
  return `ALTER TABLE ${ tableName } DROP CONSTRAINT ${ quoteSqlId(constraintName) };`;
}

/**
 * Render the "ALTER TABLE XY ADD CONSTRAINT <Z>;"
 *
 * @param {object} constraint The constraint to add
 * @param {string} constraintName Name of the constraint - needs to be escaped on caller side
 * @param {string} tableName Name of the table with the constraint - needs to be escaped on caller side
 * @param {function} quoteSqlId Usual rendering function
 * @param {object} options Options
 * @returns {string}
 */
function renderUniqueConstraintAdd( constraint, constraintName, tableName, quoteSqlId, options ) {
  return `ALTER TABLE ${ tableName } ADD ${ renderUniqueConstraintString(constraint, constraintName, tableName, quoteSqlId, options) };`;
}

module.exports = {
  renderUniqueConstraintString,
  renderUniqueConstraintDrop,
  renderUniqueConstraintAdd,
};
