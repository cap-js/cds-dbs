'use strict';

const { forEachGeneric, applyTransformationsOnNonDictionary } = require('../model/csnUtils');

// Only to be used with validator.js - a correct this value needs to be provided!

/**
 * Validate select items of a query. If a column reference starts with $self or
 * $projection, it must not contain association steps.
 * Furthermore, for to.hdbcds, window functions are not allowed.
 *
 * For to.hdbcds-hdbcds, structures and managed associations are not allowed
 * as they are not flattened - @see rejectManagedAssociationsAndStructuresForHdbcdsNames
 *
 * @param {CSN.Query} query query object
 * @todo Why do we care about this with $self?
 */
function validateSelectItems( query ) {
  const { SELECT } = query;
  if (!SELECT)
    return;

  /**
   * Check the given assoc filter for usage of $self - in an assoc-filter, you must only
   * address things on the target side of the association, not from global scope.
   *
   * @param {object} parent
   * @param {string} prop
   * @param {Array} where
   */
  function checkFilterForInvalid$Self( parent, prop, where ) {
    where.forEach((whereStep) => {
      if (whereStep.ref && ( whereStep.ref[0] === '$projection' || whereStep.ref[0] === '$self')) {
        this.error('expr-where-unexpected-self', whereStep.$path,
                   { name: whereStep.ref[0] },
                   'Path steps inside of filters must not start with $(NAME)');
      }
    });
  }

  const aTCB = (parent, prop) => {
    applyTransformationsOnNonDictionary(parent, prop, {
      where: checkFilterForInvalid$Self.bind(this),
    }, { skipStandard: { on: true }, drillRef: true });
  };

  const transformers = {
    /*
    columns: aTCB,
    groupBy: aTCB,
    having: aTCB,
    where: aTCB,
    */
    orderBy: aTCB, // filters in order by imply a join, not allowed
    from: aTCB, // $self refs in from clause filters are not allowed
  };

  if (this.options.transformation === 'hdbcds') {
    transformers.xpr = (parent) => {
      if (parent.func) {
        this.error(null, parent.$path, {},
                   'Window functions are not supported by SAP HANA CDS');
      }
    };
  }

  applyTransformationsOnNonDictionary(query, 'SELECT', transformers );

  // .call() with 'this' to ensure we have access to the options
  rejectManagedAssociationsAndStructuresForHdbcdsNames.call(this, SELECT, SELECT.$path);
}


/**
 * For the to.hdbcds transformation with naming mode 'hdbcds', structures and managed associations are not flattened/resolved.
 * It is therefore not possible to publish such elements in a view.
 * This function iterates over all published elements of a query artifact and asserts that no such elements are published.
 *
 * @param {CSN.Artifact} queryArtifact the query artifact which should be checked
 * @param {CSN.Path} artifactPath the path to that artifact
 */
function rejectManagedAssociationsAndStructuresForHdbcdsNames( queryArtifact, artifactPath ) {
  if (this.options.transformation === 'hdbcds' && this.options.sqlMapping === 'hdbcds') {
    forEachGeneric(queryArtifact, 'elements', (selectItem, elemName, prop, elementPath) => {
      if (this.csnUtils.isManagedAssociation(selectItem))
        this.error('query-unexpected-assoc-hdbcds', elementPath);
      if (this.csnUtils.isStructured(selectItem))
        this.error('query-unexpected-structure-hdbcds', elementPath);
    }, artifactPath);
  }
}

module.exports = { validateSelectItems, rejectManagedAssociationsAndStructuresForHdbcdsNames };
