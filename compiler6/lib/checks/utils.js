'use strict';

const { isBuiltinType } = require('../base/builtins');
const { RelationalOperators } = require('../transform/transformUtils');
/**
 * Prepare the ref steps so that they are loggable
 *
 * @param {any} refStep part of a ref
 * @returns {string} Loggable string
 */
function logReady( refStep ) {
  return refStep.id || refStep;
}

/**
 * Check that the opposite operand to a relational term is something
 * structured that can be used for tuple expansion. This can either be a
 * real 'elements' thing or a managed association/composition with foreign keys.
 *
 * The RHS may be 'null' or any value
 *
 * @param {Array} on the on condition which to check
 * @param {number} startIndex the index of the relational term in the on condition array
 * @returns {boolean} indicates whether the other side of a relational term is expandable
 */
function otherSideIsExpandableStructure( on, startIndex ) {
  if (on[startIndex - 1] && RelationalOperators.includes(on[startIndex - 1])) {
    const lhs = on[startIndex - 2];
    // if ever lhs is allowed to be a value uncomment this
    return /* lhs?.val !== undefined || */ isOk(resolveArtifactType.call(this, lhs?._art));
  }
  else if (on[startIndex + 1] && RelationalOperators.includes(on[startIndex + 1])) {
    const op = on[startIndex + 1];
    const rhs = on[startIndex + 2];
    if (op === 'is')
      // check for unary operator 'is [not] null' as token stream
      return rhs === 'null' || (rhs === 'not' && on[startIndex + 3] === 'null');
    // if ever rhs is allowed to be a value uncomment this
    return /* rhs?.val !== undefined || */ isOk(resolveArtifactType.call(this, rhs?._art));
  }
  return false;

  /**
   * Artifact is structured or a managed association/composition
   *
   * @param {CSN.Artifact} art Artifact
   * @returns {boolean} True if expandable
   */
  function isOk( art ) {
    return !!(art && (art.elements || (art.target && art.keys)));
  }
}

/**
 * Get the real type of an artifact
 *
 * @param {object} art Whatever _art by csnRefs can be - element or artifact
 * @returns {object} final artifact type
 */
function resolveArtifactType( art ) {
  const type = art?._type?.type || art?.type;
  if (type && !isBuiltinType(type))
    return this.csnUtils.getFinalTypeInfo(type);

  return art;
}

module.exports = {
  logReady,
  otherSideIsExpandableStructure,
  resolveArtifactType,
};
