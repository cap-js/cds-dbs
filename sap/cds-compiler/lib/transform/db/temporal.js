'use strict';

const {
  getNormalizedQuery, forEachMember,
} = require('../../model/csnUtils');
const { implicitAs } = require('../../model/csnRefs');
const { setProp, isBetaEnabled } = require('../../base/model');
const { getTransformers } = require('../transformUtils');

const validToString = '@cds.valid.to';
const validFromString = '@cds.valid.from';
/**
 * Get the forEachDefinition callback function that adds a where condition to views that
 * - are annotated with @cds.valid.from and @cds.valid.to,
 * - have only one @cds.valid.from and @cds.valid.to,
 * - and both annotations come from the same entity
 *
 * If the view has one of the annotations but the other conditions are not met, an error will be raised.
 *
 * @param {CSN.Model} csn
 * @param {object} messageFunctions
 * @param {Function} messageFunctions.info
 * @param {object} csnUtils
 * @param {object} options
 * @returns {(artifact: CSN.Artifact, artifactName: string) => void} Callback for forEachDefinition applying the where-condition to views.
 */
function getViewDecorator( csn, messageFunctions, csnUtils, options ) {
  const { info } = messageFunctions;
  const { get$combined } = csnUtils;
  return addTemporalWhereConditionToView;
  /**
   * Add a where condition to views that
   * - are annotated with @cds.valid.from and @cds.valid.to,
   * - have only one @cds.valid.from and @cds.valid.to,
   * - and both annotations come from the same entity
   *
   * If the view has one of the annotations but the other conditions are not met, an error will be raised.
   *
   * @param {CSN.Artifact} artifact
   * @param {string} artifactName
   */
  function addTemporalWhereConditionToView( artifact, artifactName ) {
    const normalizedQuery = getNormalizedQuery(artifact);
    if (normalizedQuery && normalizedQuery.query && normalizedQuery.query.SELECT) {
      // BLOCKER: We need information to handle $combined
      // What we are trying to achieve by this:
      // Forbid joining/selecting from two or more temporal entities
      // Idea: Follow the query-tree and check each from
      // Collect all source-entities and compute our own $combined
      const $combined = get$combined(normalizedQuery.query);
      const [ from, to ] = getFromToElements($combined);
      // exactly one validFrom & validTo
      if (from.length === 1 && to.length === 1) {
        // and both are from the same origin
        if (from[0].source === to[0].source && from[0].parent === to[0].parent) {
          const omitWhereClause = isBetaEnabled(options, 'temporalRawProjection') &&
            hasFalsyTemporalAnnotations(normalizedQuery.query.SELECT, artifact.elements, from[0], to[0]);
          if (!omitWhereClause) {
            const fromPath = {
              ref: [
                from[0].parent,
                from[0].name,
              ],
            };

            const toPath = {
              ref: [
                to[0].parent,
                to[0].name,
              ],
            };

            const validFrom = { ref: [ '$valid', 'from' ] };
            const validTo = { ref: [ '$valid', 'to' ] };

            const cond = { xpr: [ fromPath, '<', validTo, 'and', toPath, '>', validFrom ] };

            if (normalizedQuery.query.SELECT.where) // if there is an existing where-clause, extend it by adding 'and (temporal clause)'
              normalizedQuery.query.SELECT.where = [ { xpr: normalizedQuery.query.SELECT.where }, 'and', cond ];
            else
              normalizedQuery.query.SELECT.where = [ cond ];
          }
        }
        else {
          info(null, [ 'definitions', artifactName ],
               { source: `${ from[0].errorParent }.${ from[0].name }`, target: `${ to[0].errorParent }.${ to[0].name }` },
               'No temporal WHERE clause added as $(SOURCE) and $(TARGET) are not of same origin');
        }
      }
      else if (from.length > 0 || to.length > 0) {
        const missingAnnotation = from.length > to.length ? validToString : validFromString;
        info(null, [ 'definitions', artifactName ],
             { anno: missingAnnotation },
             'No temporal WHERE clause added because $(ANNO) is missing');
      }
    }
  }

  /**
   * Get all elements tagged with @cds.valid.from/to from the union of all entities of the from-clause.
   *
   * @param {any} combined union of all entities of the from-clause
   * @returns {Array[]} Array where first field is array of elements with @cds.valid.from, second field is array of elements with @cds.valid.to.
   */
  function getFromToElements( combined ) {
    const from = [];
    const to = [];
    for (const name in combined) {
      let elt = combined[name];
      if (!Array.isArray(elt))
        elt = [ elt ];
      elt.forEach((e) => {
        if (e.element[validFromString])
          from.push(e);
        if (e.element[validToString])
          to.push(e);
      });
    }

    return [ from, to ];
  }

  /**
   * Check if the given SELECT has a falsy @cds.valid.from and a falsy @cds.valid.to
   *
   * @param {CSN.QuerySelect} SELECT
   * @param {CSN.Elements} elements
   * @param {object} from
   * @param {object} to
   * @returns {boolean} True if both are present and false.
   */
  function hasFalsyTemporalAnnotations( SELECT, elements, from, to ) {
    let fromElement = elements[from.name];
    let toElement = elements[to.name];

    if (SELECT.columns) {
      for (const col of SELECT.columns) {
        if (col.ref) {
          const implicitAlias = implicitAs(col.ref);
          if (implicitAlias === from.name)
            fromElement = elements[col.as || implicitAlias];
          else if (implicitAlias === to.name)
            toElement = elements[col.as || implicitAlias];
        }
      }
    }
    return fromElement && !fromElement[validFromString] &&
           toElement && !toElement[validToString];
  }
}

/**
 * Get the forEachDefinition callback function that collects all usages of @cds.valid.from/to/key and checks that
 * - the assignment is on a valid element
 * - the annotation is only assigned once
 * - key is only used in conjunction with from and to
 *
 * Furthermore, @cds.valid.from and @cds.valid.key is processed - @cds.valid.from is marked as key or marked as unique if @cds.valid.key is used.
 * If @cds.valid.key is used, the real key-elements have their key-property removed (set non-enumerable as $key) and instead the @cds.valid.key-marked elements have it added.
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {string} pathDelimiter
 * @param {object} messageFunctions
 * @param {Function} messageFunctions.error
 * @returns {(artifact: CSN.Artifact, artifactName: string) => void} Callback for forEachDefinition processing the annotations.
 */
function getAnnotationHandler( csn, options, pathDelimiter, messageFunctions ) {
  const { error } = messageFunctions;
  const {
    extractValidFromToKeyElement, checkAssignment, checkMultipleAssignments, recurseElements,
  } = getTransformers(csn, options, messageFunctions, pathDelimiter);

  return handleTemporalAnnotations;
  /**
   * @param {CSN.Artifact} artifact
   * @param {string} artifactName
   */
  function handleTemporalAnnotations( artifact, artifactName ) {
    const validFrom = [];
    const validTo = [];
    const validKey = [];

    recurseElements(artifact, [ 'definitions', artifactName ], (member, path) => {
      const [ f, t, k ] = extractValidFromToKeyElement(member, path);
      validFrom.push(...f);
      validTo.push(...t);
      validKey.push(...k);
    });

    if (artifact.kind === 'entity' && !artifact.query) {
      validFrom.forEach(obj => checkAssignment(validFromString, obj.element, obj.path, artifact));
      validTo.forEach(obj => checkAssignment(validToString, obj.element, obj.path, artifact));
      validKey.forEach(obj => checkAssignment('@cds.valid.key', obj.element, obj.path, artifact));
      checkMultipleAssignments(validFrom, validFromString, artifact, artifactName);
      checkMultipleAssignments(validTo, validToString, artifact, artifactName, true);
      checkMultipleAssignments(validKey, '@cds.valid.key', artifact, artifactName);
    }

    // if there is an cds.valid.key, make this the only primary key
    // otherwise add all cds.valid.from to primary key tuple
    if (validKey.length) {
      if (!validFrom.length || !validTo.length) {
        error(null, [ 'definitions', artifactName ],
              { name: '@cds.valid.from', id: '@cds.valid.to', anno: '@cds.valid.key' },
              'Expecting $(NAME) and $(ID) if $(ANNO) is used');
      }

      forEachMember(artifact, (member) => {
        if (member.key) {
          member.unique = true;
          delete member.key;
          // Remember that this element was a key in the original artifact.
          // This is needed for localized convenience view generation.
          setProp(member, '$key', true);
        }
      });
      validKey.forEach((member) => {
        member.element.key = true;
      });

      validFrom.forEach((member) => {
        member.element.unique = true;
      });
    }
    else {
      validFrom.forEach((member) => {
        member.element.key = true;
      });
    }
  }
}


module.exports = {
  getViewDecorator,
  getAnnotationHandler,
};
