'use strict';

const {
  forEachDefinition, forAllQueries, getNormalizedQuery, forEachMemberRecursively,
} = require('../../model/csnUtils');
const { setAnnotationIfNotDefined } = require('./utils');
const { CompilerAssertion } = require('../../base/error');
const { isMagicVariable } = require('../../base/builtins');

/**
 * Set @Core.Computed on the elements of views (and projections) as well
 * as on calculated elements of entities and aspects.
 *
 * @param {CSN.Model} csn
 * @param {object} csnUtils
 */
function setCoreComputedOnViewsAndCalculatedElements( csn, csnUtils ) {
  const {
    artifactRef, getColumn, getElement, getOrigin,
  } = csnUtils;

  forEachDefinition(csn, (artifact, name, prop, path) => {
    if (artifact.query || artifact.projection) {
      // For events and types, the query is only used for inferring the element signature.
      // There, we don't want to set `@Core.Computed`.
      const queryForSignatureOnly = artifact.kind === 'type' || artifact.kind === 'event';
      forAllQueries(getNormalizedQuery(artifact).query, (query) => {
        const isTopLevelQuery = query.SELECT === (artifact.query?.SELECT || artifact.projection);
        if (query.SELECT && (!isTopLevelQuery || !queryForSignatureOnly))
          traverseQueryAndAttachCoreComputed(query, query.SELECT.elements || artifact.elements);
      }, path);
    }
    else if (artifact.kind === 'entity' || artifact.kind === 'aspect') {
      forEachMemberRecursively(artifact, (element) => {
        // Calculated elements, but simple references are ignored for on-read.
        // casts() are also computed. In CSN, they appear next to a `.ref`.
        if (element.value && (!element.value.ref || element.value.cast || element.value.stored))
          setAnnotationIfNotDefined(element, '@Core.Computed', true);
      }, path);
    }
  });
  /**
   * Attach @Core.Computed to elements resulting from calculated fields
   *
   * To do that, for a given element, we search for its matching column/subquery-element (its ancestor).
   * At the ancestor, we can see if it needs a @CoreComputed - check out {@link needsCoreComputed} for details.
   *
   *
   * @param {CSN.Query} query
   * @param {CSN.Elements} elements
   */
  function traverseQueryAndAttachCoreComputed( query, elements ) {
    for (const [ name, element ] of Object.entries(elements)) {
      const ancestor = getAncestor(element, name, query.SELECT);

      if (needsCoreComputed(ancestor)) // calculated field, function or virtual
        setAnnotationIfNotDefined(element, '@Core.Computed', true);
      if (ancestor && (ancestor.expand || ancestor.inline))
        traverseExpandInline(ancestor, attachCoreComputed);
    }

    /**
     * Get the ancestor of a given element - either a direct column that "caused" it, or an element
     * from some other artifact (table or view/subquery). The later happens via SELECT * and can be found by drilling down into the
     * FROM-clause.
     *
     * @param {CSN.Element} element
     * @param {string} name
     * @param {CSN.QuerySelect} base
     * @returns {CSN.Column|CSN.Element}
     */
    function getAncestor( element, name, base ) {
      const column = getColumn(element);
      if (column)
        return column;
      const from = getElementFromFrom(name, base.from);
      if (from)
        return from;
      // For .expand/.inline, we can find it via origin
      // Although I would have expected to find it via getColumn...
      const origin = getOrigin(element);
      if (origin)
        return origin;
      throw new CompilerAssertion(`Could not find ancestor for ${ JSON.stringify(element) } named ${ name }`);
    }

    /**
     * Get the element <name> from the given query-base (from of a select).
     *
     * For a simple ref to a table, resolve the ref and check the elements
     * For a UNION, drill down into the leading query
     * For a JOIN, check each join-argument
     * For a query with subelements, check the subelements
     *
     * @param {string} name
     * @param {object} base
     * @returns {CSN.Element}
     * @todo cleanup throw(s) - but leave in during dev
     */
    function getElementFromFrom( name, base ) {
      if (base.SELECT?.elements?.[name]) {
        return getAncestor(base.SELECT.elements[name], name, base.SELECT);
      }
      else if (base.ref) {
        let artifact = artifactRef.from(base);
        if (artifact.target)
          artifact = artifactRef(artifact.target);
        return artifact.elements[name];
      }
      else if (base.SET) {
        return getElementFromFrom(name, base.SET.args[0]);
      }
      else if (base.args && base.join) {
        return checkJoinSources(base.args, name);
      }

      throw new CompilerAssertion(`Element “${ name }” not found in: ${ JSON.stringify(base) }`);
    }

    /**
     * For the given JOIN-args, check if one of the join sources provides an element <name>
     *
     * @param {Array} args
     * @param {string} name
     * @returns {CSN.Element|null} Null if no element was found
     */
    function checkJoinSources( args, name ) {
      for (const arg of args) {
        if (arg.args) { // Join after join - A join B on <..> join C on <..>
          const result = checkJoinSources(arg.args, name);
          if (result)
            return result;
        }
        else { // All other cases - normal ref, a subselect, etc. pp
          const result = getElementFromFrom(name, arg);
          if (result)
            return result;
        }
      }

      return null;
    }

    /**
     * On a given column, attach @Core.Computed if needed
     *
     * @param {CSN.Column} column
     */
    function attachCoreComputed( column ) {
      if (needsCoreComputed(column))
        setAnnotationIfNotDefined(getElement(column), '@Core.Computed', true);
    }

    /**
     * Returns true, if the given columns element needs to be annotated with @Core.Computed.
     *
     * @param {CSN.Column} column
     * @returns {boolean}
     */
    function needsCoreComputed( column ) {
      return column &&
        (
          column.xpr || column.list || column.func || column.val !== undefined || column['#'] !== undefined || column.param ||
          column.SELECT || column.SET ||
          column.ref && (isMagicVariable(column.ref[0]) || column.ref[0] === '$parameters')
        );
    }

    /**
     * Call the given callback for all sub-things of a .expand/.inline and drill further down into other .expand/.inline
     *
     * @param {CSN.Column} column
     * @param {Function} callback
     */
    function traverseExpandInline( column, callback ) {
      if (column.expand) {
        column.expand.forEach((col) => {
          callback(col);
          traverseExpandInline(col, callback);
        });
      }
      else if (column.inline) {
        column.inline.forEach((col) => {
          callback(col);
          traverseExpandInline(col, callback);
        });
      }
    }
  }
}

module.exports = {
  setCoreComputedOnViewsAndCalculatedElements,
};
