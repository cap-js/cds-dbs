'use strict';

const { forEachGeneric } = require('../model/csnUtils');
const { otherSideIsExpandableStructure, resolveArtifactType } = require('./utils');
const { pathId } = require('../model/csnRefs');

// Only to be used with validator.js - a correct this value needs to be provided!

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
 * Check that the other side of the comparison is a valid $self backlink
 *
 * - operator "="
 * - nothing but "$self", no further steps
 *
 * @param {Array} on On-Condition
 * @param {number} startIndex Index of the current expression to "look around"
 * @returns {boolean} True if valid
 */
function otherSideIsValidDollarSelf( on, startIndex ) {
  if (on[startIndex - 1] && on[startIndex - 1] === '=') {
    if (on[startIndex - 2]) {
      const { ref } = on[startIndex - 2];
      return ref && ref.length === 1 && ( ref[0] === '$self' || ref[0] === '$projection' );
    }
    return false;
  }
  else if (on[startIndex + 1] && on[startIndex + 1] === '=') {
    if (on[startIndex + 2]) {
      const { ref } = on[startIndex + 2];
      return ref && ref.length === 1 && ( ref[0] === '$self' || ref[0] === '$projection' );
    }
    return false;
  }
  return false;
}

/**
 * Validate an on-condition
 *
 * - no traversal of unmanaged associations
 * - only use managed associations to access their foreign keys
 * - no filters
 * - no parameters
 * - must end in scalar type - unless $self comparison
 *
 * @param {object} member Member
 * @param {string} memberName Name of the member
 * @param {string} property Current property (part of forEachMember)
 * @param {CSN.Path} path CSN Path to current member
 */
function validateOnCondition( member, memberName, property, path ) {
  if (member && member.on) {
    // complain about nullability constraint on managed composition
    if (member.targetAspect && {}.hasOwnProperty.call(member, 'notNull')) {
      this.warning(null, path.concat([ 'on' ]), {},
                   'Unexpected nullability constraint defined on managed composition');
    }
    for (let i = 0; i < member.on.length; i++) {
      if (member.on[i].ref) {
        const { ref } = member.on[i];
        // eslint-disable-next-line prefer-const
        let { _links, _art, $scope } = member.on[i];
        if (!_links)
          continue;
        const validDollarSelf = otherSideIsValidDollarSelf(member.on, i);
        const validStructuredElement = otherSideIsExpandableStructure.call(this, member.on, i);
        for (let j = 0; j < _links.length - 1; j++) {
          let hasPathError = false;
          const csnPath = path.concat([ 'on', i, 'ref', j ]);

          // For error messages
          const id = logReady(ref[j]);
          const elemref = { ref };
          const stepArt = _links[j].art;
          if (stepArt.target &&
              !(stepArt === member ||
                ref[j] === '$self' ||
                ref[j] === '$projection' ||
                (validDollarSelf && j === _links.length - 1))) {
            if (stepArt.on) {
              // It's an unmanaged association - traversal is always forbidden
              this.error('ref-unexpected-navigation', csnPath, { '#': 'unmanaged', id, elemref });
              hasPathError = true;
            }
            else {
              // It's a managed association - access of the foreign keys is allowed
              requireForeignKeyAccess(member.on[i], j, (errorIndex) => {
                this.error('ref-unexpected-navigation', csnPath, {
                  '#': 'std', id, elemref, name: ref[errorIndex].id || ref[errorIndex],
                });
                hasPathError = true;
              });
            }
          }
          if (stepArt.virtual) {
            this.error(null, csnPath, { id, elemref }, //
                       'Virtual elements can\'t be used in ON-conditions, step $(ID) of path $(ELEMREF)');
            hasPathError = true;
          }
          if (ref[j].where) {
            this.error('ref-unexpected-filter', csnPath, { '#': 'on-condition', id, elemref });
            hasPathError = true;
          }
          if (ref[j].args) {
            this.error('ref-unexpected-args', csnPath, { '#': 'on-condition', id, elemref });
            hasPathError = true;
          }

          if (hasPathError)
            break; // avoid too many consequent errors
        }

        if (_art && !($scope === '$self' && ref.length === 1)) {
          const type = resolveArtifactType.call(this, _art);
          if (type) {
          // For error messages
            const onPath = path.concat([ 'on', i, 'ref', ref.length - 1 ]);
            // Paths of an ON condition may end on a structured element or an association only if:
            // 1) Both operands in the expression end on a structured element or on
            //    a managed association (that are both expandable)
            // 2) Path ends on an association (managed or unmanaged) and the other operand is a '$self'

            // If this path ends structured or on an association, perform the check:
            if (
              ((type.target && type.keys || type.elements) && validStructuredElement ||
              (type.target && validDollarSelf)) && !type.virtual
            ) {
              // Do nothing - handled by lib/checks/nonexpandableStructured.js
            }
            else if (type.items && !type.virtual) {
              this.error(null, onPath, { elemref: { ref } },
                         'ON-conditions can\'t use array-like elements, path $(ELEMREF)');
            }
            else if (type.virtual) {
              this.error(null, onPath, { elemref: { ref } },
                         'Virtual elements can\'t be used in ON-conditions, path $(ELEMREF)');
            }
            else if (type.on) {
              // Path leaf is an unmanaged association, can't use an unmanaged assoc as operand
              this.error('ref-unexpected-navigation', onPath, { '#': 'unmanagedleaf', id: logReady(ref[ref.length - 1]), elemref: { ref } });
            }
          }
        }
      }
    }
  }
}


/**
 * Ensure that only foreign keys of the association `parent.ref[refIndex]` are accessed in `parent.ref`.
 * If a non-fk field is accessed, `noForeignKeyCallback` is invoked.
 *
 * @param {object} parent
 *     Object containing `ref` and `_links` from csnRefs.
 *
 * @param {number} refIndex
 *     Index of the to-be-checked association in `parent.ref`
 *
 * @param {(errorIndex: number) => void} noForeignKeyCallback
 *     Called if there are non-fk path steps.  Argument is index in `parent.ref` that is faulty.
 *     If a fk-step is missing, `errorIndex` will be `> parent.ref.length`.
 */
function requireForeignKeyAccess( parent, refIndex, noForeignKeyCallback ) {
  const { _links } = parent;
  const ref = [ ...parent.ref ]; // copy so the original ref stays untouched
  const assoc = _links[refIndex].art;
  const nextLink = _links[refIndex + 1]?.art;

  if (nextLink?.value) {
    const resolved = resolveCalculatedElementRef(nextLink);
    if (resolved)
      ref.splice(refIndex + 1, 1, ...resolved);
  }

  const next = pathId(ref[refIndex + 1]);
  let possibleKeys = next && assoc.keys.filter(r => r.ref[0] === next);
  if (!possibleKeys || possibleKeys.length === 0) {
    noForeignKeyCallback(refIndex + 1);
  }
  else {
    // For cases where `Association to T { struct.one, struct.two };` is used instead of `{ struct }`.
    // We know that `{ struct, struct.one }` is not possible, so no prefix check required.
    // If `ref.length` does not cover any full foreign key, then we call noForeignKeyCallback()
    // as well.  This could happen for `struct.one` as foreign key, and `assoc.struct = …`
    // in ON-condition.
    let fkIndex = 0;
    let success = false;
    while (!success && possibleKeys.length > 0 && refIndex + fkIndex + 1 < ref.length) {
      const pathStep = ref[refIndex + fkIndex + 1].id || ref[refIndex + fkIndex + 1];

      // Function is immediately executed, before next iteration of loop. Access is fine.
      // eslint-disable-next-line no-loop-func
      possibleKeys = possibleKeys.filter((r) => {
        const result = r.ref[fkIndex] === pathStep;
        if (result && r.ref.length - 1 === fkIndex)
          success = true; // full fk matched

        return result;
      });
      ++fkIndex;
    }
    if (!success)
      noForeignKeyCallback(refIndex + fkIndex);
  }
}


/**
 * Run the above validations also for mixins.
 *
 * @param {CSN.Query} query query object
 * @param {CSN.Path} path path to the query
 */
function validateMixinOnCondition( query, path ) {
  if (query.SELECT && query.SELECT.mixin)
    forEachGeneric( query.SELECT, 'mixin', validateOnCondition.bind(this), path );
}

/**
 * As calculated elements are only resolved in a later transformation step,
 * we must provide a way to check whether a calc element references e.g.
 * a foreign key somewhere down the line.
 *
 * In the following example, `G:indirect` is eventually a foreign key of `G:toG`,
 * hence it is allowed to be used in e.g. an infix filter:
 * @example
 *  ```
 *  entity G {
 *      key id  : Integer;
 *          idx : Integer;
 *          toG: Association to G { idx };
 *          cidx = idx;
 *          indirect = cidx;
 *   }
 *
 *   view V as select from G where exists toG[toG.indirect = 1];
 *                                                ^^^^^^^^
 *   ```
 *
 * @param {CSN.Element} calculatedElement
 * @returns {CSN.ArtifactReference} the resolved element or the calculated element itself if it is complex
 */
function resolveCalculatedElementRef( calculatedElement ) {
  if (calculatedElement.value.ref) {
    const { _links } = calculatedElement.value;
    const leaf = _links[_links.length - 1];
    // TODO: once #11538 is available, checking the leaf for `.value`
    // is not enough anymore.
    if (leaf.art.value)
      return resolveCalculatedElementRef(leaf.art);
    return calculatedElement.value.ref;
  }

  return null;
}

module.exports = { validateOnCondition, validateMixinOnCondition, requireForeignKeyAccess };
