'use strict';

const {
  applyTransformationsOnNonDictionary, isAssociationOperand, isDollarSelfOrProjectionOperand,
} = require('../../model/csnUtils');

const { setProp } = require('../../base/model');
const { forEach } = require('../../utils/objectUtils');
const { cloneCsnNonDict } = require('../../model/cloneCsn');
const { ModelError } = require('../../base/error');

/**
 * Get a function that transforms $self backlinks
 * @param {object} csnUtils
 * @param {object} messageFunctions
 * @param {CSN.Options} options
 * @param {string} pathDelimiter
 * @param {boolean} doA2J
 * @returns {import('../../model/csnUtils').genericCallback} callback for forEachDefinition
 */
function getBacklinkTransformer( csnUtils, messageFunctions, options, pathDelimiter, doA2J = true ) {
  let prepend$self = false;
  return transformSelfInBacklinks;
  /**
   * @param {CSN.Artifact} artifact
   * @param {string} artifactName
   * @param {any} dummy unused Parameter
   * @param {CSN.Path} path
   */
  function transformSelfInBacklinks( artifact, artifactName, dummy, path ) {
    prepend$self = false;
    // Fixme: For toHana mixins must be transformed, for toSql -d hana
    // mixin elements must be transformed, why can't toSql also use mixins?
    if (options.transformation === 'effective' && artifact.elements || artifact.kind === 'entity' || artifact.query || (options.forHana && options.sqlMapping === 'hdbcds' && artifact.kind === 'type'))
      processDict(artifact.elements, path.concat([ 'elements' ]));
    if (artifact.query?.SELECT?.mixin) {
      prepend$self = options.transformation === 'effective';
      processDict(artifact.query.SELECT.mixin, path.concat([ 'query', 'SELECT', 'mixin' ]));
    }

    /**
     * Loop over the dict and start the processing.
     *
     * @param {object} dict .elements or .mixin
     * @param {Array} subPath Path into the dict
     */
    function processDict( dict, subPath ) {
      forEach(dict, (elemName, elem) => {
        if (elem.on && csnUtils.isAssocOrComposition(elem))
          processBacklinkAssoc(elem, elemName, artifact, artifactName, subPath.concat([ elemName, 'on' ]));
      });
    }
  }


  /**
   * If the association element 'elem' of 'art' is a backlink association, massage its ON-condition
   * (in place) so that it
   * - compares the generated foreign key fields of the corresponding forward
   *   association with their respective keys in 'art' (for managed forward associations)
   * - contains the corresponding forward association's ON-condition in "reversed" form,
   *   i.e. as seen from 'elem' (for unmanaged associations)
   * Otherwise, do nothing.
   * @param {CSN.Element} elem
   * @param {string} elemName
   * @param {CSN.Artifact} art
   * @param {string} artName
   * @param {CSN.Path} pathToOn
   */
  function processBacklinkAssoc( elem, elemName, art, artName, pathToOn ) {
    // Don't add braces if it is a single expression (ignoring superfluous braces)
    // TODO: This check is too simplistic and probably adds superfluous parentheses.
    const multipleExprs = elem.on.length > 3;
    elem.on = processExpressionArgs(elem.on, pathToOn);
    const column = csnUtils.getColumn(elem);
    if (column?.cast?.on) // avoid difference between column and element
      column.cast.on = elem.on;

    /**
     * Process the args
     *
     * @param {Array} xprArgs
     * @param {CSN.Path} path
     * @returns {Array} Array of parsed expression
     */
    function processExpressionArgs( xprArgs, path ) {
      const result = [];
      let i = 0;
      while (i < xprArgs.length) {
      // Only token tripel `<path>, '=', <path>` are of interest here
        if (i < xprArgs.length - 2 && xprArgs[i + 1] === '=') {
        // Check if one side is $self and the other an association
        // (if so, replace all three tokens with the condition generated from the other side, in parentheses)
          if (isDollarSelfOrProjectionOperand(xprArgs[i]) && isAssociationOperand(xprArgs[i + 2], path.concat([ i + 2 ]), csnUtils.inspectRef)) {
            const assoc = csnUtils.inspectRef(path.concat([ i + 2 ])).art;
            const backlinkName = xprArgs[i + 2].ref[xprArgs[i + 2].ref.length - 1];
            const comparison = transformDollarSelfComparison(
              xprArgs[i + 2], assoc, backlinkName,
              elem, elemName, art, artName, path.concat([ i ])
            );

            if (multipleExprs)
              result.push({ xpr: comparison });
            else
              result.push(...comparison);

            i += 3;
            attachBacklinkInformation(backlinkName);
          }
          else if (isDollarSelfOrProjectionOperand(xprArgs[i + 2]) && isAssociationOperand(xprArgs[i], path.concat([ i ]), csnUtils.inspectRef)) {
            const assoc = csnUtils.inspectRef(path.concat([ i ])).art;
            const backlinkName = xprArgs[i].ref[xprArgs[i].ref.length - 1];
            const comparison = transformDollarSelfComparison(xprArgs[i], assoc, backlinkName, elem, elemName, art, artName, path.concat([ i + 2 ]));

            if (multipleExprs)
              result.push({ xpr: comparison });
            else
              result.push(...comparison);

            i += 3;
            attachBacklinkInformation(backlinkName);
          }
          // Otherwise take one (!) token unchanged
          else {
            result.push(xprArgs[i]);
            i++;
          }
        }
        // Process subexpressions - but keep them as subexpressions
        else if (xprArgs[i].xpr) {
          result.push({ xpr: processExpressionArgs(xprArgs[i].xpr, path.concat([ i, 'xpr' ])) });
          i++;
        }
        // Take all other tokens unchanged
        else {
          result.push(xprArgs[i]);
          i++;
        }
      }
      return result;

      /**
       * The knowledge whether an association was an `<up_>` association in a
       * `$self = <comp>.<up_>` comparison, is important for the foreign key constraints.
       * By the time we generate them, such on-conditions are already transformed
       * --> no more `$self` in the on-conditions, that is why we need to remember it here.
       *
       * @param {string} backlinkName name of `<up_>` in a `$self = <comp>.<up_>` comparison
       */
      function attachBacklinkInformation( backlinkName ) {
        if (elem.$selfOnCondition) {
          elem.$selfOnCondition.up_.push(backlinkName);
        }
        else {
          setProp(elem, '$selfOnCondition', {
            up_: [ backlinkName ],
          });
        }
      }
    }
  }

  /**
   * Return the condition to replace the comparison `<assocOp> = $self` in the ON-condition
   * of element <elem> of artifact 'art'. If there is anything to complain, use location <loc>
   *
   * @param {any} assocOp
   * @param {CSN.Element} assoc
   * @param {string} assocName
   * @param {CSN.Element} elem
   * @param {string} elemName
   * @param {CSN.Artifact} art
   * @param {string} artifactName
   * @param {CSN.Path} path
   * @returns {Array} New on-condition
   */
  function transformDollarSelfComparison( assocOp, assoc, assocName, elem, elemName, art, artifactName, path ) {
    // Check: The forward link <assocOp> must point back to this artifact
    // FIXME: Unfortunately, we can currently only check this for non-views (because when a view selects
    // a backlink association element from an entity, the forward link will point to the entity,
    // not to the view).
    // FIXME: This also means that corresponding key fields should be in the select list etc ...
    if (!art.query && !art.projection && assoc.target && assoc.target !== artifactName) {
      messageFunctions.error( null, path, { id: '$self', name: artifactName, target: assoc.target },
                              'Expected association using $(ID) to point back to $(NAME) but found $(TARGET)' );
    }

    // Check: The forward link <assocOp> must not contain '$self' in its own ON-condition
    if (assoc.on) {
      const containsDollarSelf = assoc.on.some(isDollarSelfOrProjectionOperand);

      if (containsDollarSelf) {
        messageFunctions.error(null, path, { name: '$self' },
                               'An association that uses $(NAME) in its ON-condition can\'t be compared to $(NAME)');
      }
    }

    if (!assoc.keys && !assoc.on) {
      // Interpret no ON-condition/no keys like empty 'keys'.
      if (options.transformation !== 'effective')
        elem.$ignore = true;
      return [];
    }

    if (assoc.keys) {
      // Transform comparison of $self to managed association into AND-combined foreign key comparisons
      if (assoc.keys.length > 0)
        return transformDollarSelfComparisonWithManagedAssoc(assocOp, assoc, assocName, elemName, art, path);

      if (options.transformation !== 'effective')
        elem.$ignore = true;
      return [];
    }
    else if (assoc.on) {
      // Transform comparison of $self to unmanaged association into "reversed" ON-condition
      return transformDollarSelfComparisonWithUnmanagedAssoc(assocOp, assoc, assocName, elemName, art, path);
    }

    throw new ModelError(`Expected either managed or unmanaged association in $self-comparison: ${ JSON.stringify(elem.on) }`);
  }


  /**
   * For a condition `<elemName>.<assoc> = $self` in the ON-condition of element <elemName>,
   * where <assoc> is a managed association, return a condition comparing the generated
   * foreign key elements <elemName>.<assoc>_<fkey1..n> of <assoc> to the corresponding
   * keys in this artifact.
   * For example, `ON elem.ass = $self` becomes `ON elem.ass_key1 = key1 AND elem.ass_key2 = key2`
   * (assuming that `ass` has the foreign keys `key1` and `key2`)
   * @param {any} assocOp
   * @param {CSN.Element} assoc
   * @param {string} originalAssocName
   * @param {string} elemName
   * @param {CSN.Artifact} art
   * @param {CSN.Path} path
   * @returns {Array} New on-condition
   */
  function transformDollarSelfComparisonWithManagedAssoc( assocOp, assoc, originalAssocName, elemName, art, path) {
    const conditions = [];
    // if the element was structured then it was flattened => change of the delimiter from '.' to '_'
    // this is done in the flattening, but as we do not alter the onCond itself there should be done here as well
    const assocName = originalAssocName.replace(/\./g, pathDelimiter);
    elemName = elemName.replace(/\./g, pathDelimiter);

    assoc.keys.forEach((k) => {
      // Depending on naming conventions, the foreign key may two path steps (hdbcds) or be a single path step with a flattened name (plain, quoted)
      // With to.hdbcds in conjunction with hdbcds naming, we need to NOT use the alias - else we get deployment errors
      const keyName = k.as && doA2J ? [ k.as ] : k.ref;
      const fKeyPath = !doA2J ? [ assocName, ...keyName ] : [ `${ assocName }${ pathDelimiter }${ keyName[0] }` ];
      // FIXME: _artifact to the args ???
      const a = [
        {
          ref: [ elemName, ...fKeyPath ],
        },
        { ref: k.ref },
      ];

      if (prepend$self)
        a[1].ref = [ '$self', ...a[1].ref ];

      // Not without a2j so we can rely on a certain model state
      if (doA2J && prepend$self && art.elements[k.ref[1]] || !prepend$self && !art.elements[k.ref[0]])
        messageFunctions.message('ref-missing-self-counterpart', path, { prop: k.ref[0], name: assocName });
      conditions.push([ a[0], '=', a[1] ]);
    });

    return conditions.reduce((prev, current) => {
      if (prev.length === 0)
        return [ ...current ];

      return [ ...prev, 'and', ...current ];
    }, []);
  }

  /**
   * For a condition `<elemName>.<assoc> = $self` in the ON-condition of element <elemName>,
   * where <assoc> is an unmanaged association, return the ON-condition of <assoc> as it would
   * be written from the perspective of the artifact containing association <elemName>.
   * For example, `ON elem.ass = $self` becomes `ON a = elem.x AND b = elem.y`
   * (assuming that `ass` has the ON-condition `ON ass.a = x AND ass.b = y`)
   *
   * @param {any} assocOp
   * @param {CSN.Element} assoc
   * @param {string} originalAssocName
   * @param {string} elemName
   * @param {CSN.Artifact} art
   * @param {CSN.Path} path
   * @returns {Array} New on-condition
   */
  function transformDollarSelfComparisonWithUnmanagedAssoc( assocOp, assoc, originalAssocName, elemName, art, path ) {
    // if the element was structured then it may have been flattened => change of the delimiter from '.' to '_'
    // this is done in the flattening, but as we do not alter the onCond itself there should be done here as well
    elemName = elemName.replace(/\./g, pathDelimiter);
    const assocName = originalAssocName.replace(/\./g, pathDelimiter);
    // clone the onCond for later use in the path transformation
    const newOnCond = cloneCsnNonDict(assoc.on, options);
    applyTransformationsOnNonDictionary({ on: newOnCond }, 'on', {
      ref: (parent, prop, ref) => {
        let sourceSide = false;
        // we are in the "path" from the forwarding assoc => need to remove the first part of the path
        if (ref[0] === assocName) {
          ref.shift();
          if (prepend$self)
            ref.unshift('$self');

          sourceSide = true;
        }
        else if (ref.length > 1 && ref[0] === '$self' && ref[1] === assocName) {
          // We could also have a $self in front of the assoc name - so we would need to shift twice
          ref.shift();
          ref.shift();
          if (prepend$self)
            ref.unshift('$self');

          sourceSide = true;
        }
        else { // we are in the backlink assoc "path" => need to push at the beginning the association's id
          ref.unshift(elemName);
          // if there was a $self identifier in the forwarding association onCond
          // we do not need it anymore, as we prepended in the previous step the back association's id
          if (ref[1] === '$self')
            ref.splice(1, 1);
        }

        // Not without a2j so we can rely on a certain model state
        if (doA2J && sourceSide && (prepend$self && !art.elements[ref[1]] || !prepend$self && !art.elements[ref[0]]))
          messageFunctions.message('ref-missing-self-counterpart', path, { '#': 'unmanaged', prop: ref[0], name: assocName });
      },
    });
    return newOnCond;
  }
}

module.exports = {
  getBacklinkTransformer,
};
