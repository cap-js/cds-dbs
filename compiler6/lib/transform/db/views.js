'use strict';

const {
  getUtils, applyTransformationsOnNonDictionary, forEachDefinition,
} = require('../../model/csnUtils');
const { implicitAs, columnAlias, pathId } = require('../../model/csnRefs');
const { ModelError } = require('../../base/error');
const { setProp } = require('../../base/model');
const { cloneCsnNonDict } = require('../../model/cloneCsn');

/**
 * If a mixin association is published, return the mixin association.
 *
 * @param {CSN.Query} query Query of the artifact to check
 * @param {object} association Association (Element) published by the view
 * @param {string} associationName
 * @returns {object} The mixin association
 */
function getMixinAssocOfQueryIfPublished( query, association, associationName ) {
  if (query?.SELECT?.mixin) {
    const aliasedColumnsMap = Object.create(null);
    for (const column of query.SELECT.columns || []) {
      if (column.as && column.ref?.length === 1)
        aliasedColumnsMap[column.as] = column;
    }

    for (const elem of Object.keys(query.SELECT.mixin)) {
      const mixinElement = query.SELECT.mixin[elem];
      let originalName = associationName;
      if (aliasedColumnsMap[associationName])
        originalName = pathId(aliasedColumnsMap[associationName].ref[0]);

      if (elem === originalName)
        return { mixinElement, mixinName: originalName };
    }
  }
  return {};
}

/**
 * Check whether the given artifact uses the given mixin association.
 *
 * We can rely on the fact that there can be no usage starting with $self/$projection,
 * since lib/checks/selectItems.js forbids that.
 *
 * @param {CSN.Query} query Query of the artifact to check
 * @param {object} association Mixin association (Element) to check for
 * @param {string} associationName
 * @returns {boolean} True if used
 */
function usesMixinAssociation( query, association, associationName ) {
  if (query && query.SELECT && query.SELECT.columns) {
    for (const column of query.SELECT.columns) {
      if (typeof column === 'object' && column.ref && column.ref.length > 1 && (column.ref[0] === associationName || column.ref[0].id === associationName))
        return true;
    }
  }
  return false;
}

/**
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {{error: Function, info: Function}} messageFunctions
 * @returns {(query: CSN.Query, artifact: CSN.Artifact, artName: string, path: CSN.Path) => void} Transformer function for views
 */
function getViewTransformer( csn, options, messageFunctions ) {
  const csnUtils = getUtils(csn);
  const {
    get$combined, isAssocOrComposition,
    inspectRef, queryOrMain, // csnRefs
  } = csnUtils;
  const pathDelimiter = options.forHana && (options.sqlMapping === 'hdbcds') ? '.' : '_';
  const { error, info } = messageFunctions;
  const doA2J = !(options.transformation === 'hdbcds' && options.sqlMapping === 'hdbcds');

  return transformViewOrEntity;

  /**
   *
   * check all queries/subqueries for mixin publishing inside of unions -> forbidden in hdbcds
   *
   * @param {CSN.Query} query
   * @param {CSN.Elements} elements
   * @param {CSN.Path} path
   */
  function checkForMixinPublishing( query, elements, path ) {
    for (const elementName in elements) {
      const element = elements[elementName];
      if (element.target) {
        let colLocation;
        for (let i = 0; i < query.SELECT.columns.length; i++) {
          const col = query.SELECT.columns[i];
          if (col.ref && col.ref.length === 1) {
            if (!colLocation && col.ref[0] === elementName)
              colLocation = i;


            if (col.as === elementName)
              colLocation = i;
          }
        }
        if (colLocation) {
          const matchingCol = query.SELECT.columns[colLocation];
          const possibleMixinName = matchingCol.ref[0];
          const isMixin = query.SELECT.mixin[possibleMixinName] !== undefined;
          if (element.target && isMixin) {
            error(null, path.concat([ 'columns', colLocation ]), { id: elementName, name: possibleMixinName, '#': possibleMixinName === elementName ? 'std' : 'renamed' }, {
              std: 'Element $(ID) is a mixin association and can\'t be published in a UNION',
              renamed: 'Element $(ID) is a mixin association ($(NAME))and can\'t be published in a UNION',
            });
          }
        }
      }
    }
  }

  /**
   * For things that are not explicitly found in the columns but still present in the elements, add them to the columnMap.
   *
   * This can happen for:
   * - projections, as we might not have .columns at all
   * - *, as we don't resolve it for hdbcds with hdbcds-naming
   *
   * We ensure that we attach a table alias before each column
   *
   * @param {CSN.Query} query
   * @param {boolean} isProjection
   * @param {boolean} isSelectStar
   * @param {object} $combined
   * @param {object} columnMap
   * @param {string} elemName
   */
  function addProjectionOrStarElement( query, isProjection, isSelectStar, $combined, columnMap, elemName ) {
    // Prepend an alias if present
    let alias = (isProjection || isSelectStar) &&
    (query.SELECT.from.as || (query.SELECT.from.ref && implicitAs(query.SELECT.from.ref)));
    // In case of * and no explicit alias
    // find the source of the col by looking at $combined and prepend it
    if (isSelectStar && !alias && !isProjection) {
      if (!$combined)
        $combined = get$combined(query);


      const matchingCombined = $combined[elemName];
      // Internal errors - this should never happen!
      if (matchingCombined.length > 1) { // should already be caught by compiler
        throw new ModelError(`Ambiguous name - can't be resolved: ${ elemName }. Found in: ${ matchingCombined.map(o => o.parent) }`);
      }
      else if (matchingCombined.length === 0) { // no clue how this could happen? Invalid CSN?
        throw new ModelError(`No matching entry found in UNION of all elements for: ${ elemName }`);
      }
      alias = matchingCombined[0].parent;
    }
    if (alias)
      columnMap[elemName] = { ref: [ alias, elemName ] };
    else
      columnMap[elemName] = { ref: [ elemName ] };
  }

  /**
   * So far, we only added foreign keys to elements - we also need to create corresponding columns
   * and respect aliasing etc.
   *
   * @todo Maybe this can be done earlier, during flattening/expansion already?
   * @param {object} columnMap
   * @param {CSN.Element} elem
   * @param {string} elemName
   */
  function addForeignKeysToColumns( columnMap, elem, elemName ) {
    const assocCol = columnMap[elemName];
    if (assocCol && assocCol.ref) {
      elem.keys.forEach((foreignKey) => {
        const ref = cloneCsnNonDict(assocCol.ref, options);
        ref[ref.length - 1] = [ getLastRefStepString(ref) ].concat(foreignKey.as).join(pathDelimiter);
        const result = {
          ref,
        };
        if (assocCol.as) {
          const columnName = `${ assocCol.as }${ pathDelimiter }${ foreignKey.as }`;
          result.as = columnName;
        }

        if (assocCol.key)
          result.key = true;

        const colName = result.as || getLastRefStepString(ref);
        columnMap[colName] = result;
      });
    }
  }


  /**
   * Check for invalid association publishing (in Union or in Subquery) (for hdbcds) and
   * create the __clone for publishing stuff.
   *
   * @todo Factor out the checks
   * @param {CSN.Query} query
   * @param {object} elements
   * @param {object} columnMap
   * @param {WeakMap} publishedMixins Map to collect the published mixins
   * @param {CSN.Element} elem
   * @param {string} elemName
   * @param {CSN.Path} elementsPath Path pointing to elements
   * @param {CSN.Path} queryPath Path pointing to the query
   */
  function handleAssociationElement( query, elements, columnMap, publishedMixins, elem, elemName, elementsPath, queryPath ) {
    if (isUnion(queryPath) && options.transformation === 'hdbcds') {
      if (doA2J) {
        info('query-ignoring-assoc-in-union', queryPath, { name: elemName, '#': elem.keys ? 'managed' : 'std' });
        elem.$ignore = true;
      }
      else {
        error(null, queryPath, { name: elemName }, 'Association $(NAME) can\'t be published in a SAP HANA CDS UNION');
      }
    }
    else if (queryPath.length > 4 && options.transformation === 'hdbcds') { // path.length > 4 -> is a subquery
      error(null, queryPath, { name: elemName },
            'Association $(NAME) can\'t be published in a subquery');
    }
    else {
      const isNotMixinByItself = checkIsNotMixinByItself(query, columnMap, elemName);
      const { mixinElement, mixinName } = getMixinAssocOfQueryIfPublished(query, elem, elemName);
      if (isNotMixinByItself || mixinElement !== undefined) {
        // If the mixin is only published and not used, only display the __ clone. Kill the "original".
        if (mixinElement !== undefined && !usesMixinAssociation(query, elem, elemName))
          delete query.SELECT.mixin[mixinName];


        // Create an unused alias name for the MIXIN - use 3 _ to avoid collision with usings
        let mixinElemName = `___${ mixinName || elemName }`;
        while (elements[mixinElemName])
          mixinElemName = `_${ mixinElemName }`;

        // Copy the association element to the MIXIN clause under its alias name
        // Needs to be a deep copy, as we transform the on-condition
        const mixinElem = cloneCsnNonDict(elem, options);

        if (query.SELECT && !query.SELECT.mixin)
          query.SELECT.mixin = Object.create(null);

        // Clone 'on'-condition, pre-pending '$projection' to paths where appropriate,
        // and fixing the association alias just created

        if (mixinElem.on) {
          mixinElem.on = applyTransformationsOnNonDictionary(mixinElem, 'on', {
            ref: (parent, prop, ref, refpath) => {
              if (ref[0] === elemName) {
                ref[0] = mixinElemName;
              }
              else if (!(ref[0] && ref[0].startsWith('$'))) {
                ref.unshift('$projection');
              }
              else if (ref[0] && ref[0].startsWith('$')) {
                // TODO: I think this is non-sense. Stuff with $ is either magic or must start with $self, right?
                const { scope } = inspectRef(refpath);
                if (scope !== '$magic' && scope !== '$self')
                  ref.unshift('$projection');
              }
              parent.ref = ref;
              return ref;
            },
          }, {}, elementsPath.concat(elemName));
        }

        if (!mixinElem.$ignore)
          columnMap[elemName] = { ref: [ mixinElemName ], as: elemName };

        if (query.SELECT) {
          query.SELECT.mixin[mixinElemName] = mixinElem;

          publishedMixins.set(mixinElem, true);
        }
      }
    }
  }

  /**
   * If following an association, explicitly set the implicit alias
   * due to an issue with HANA - only for hdbcds-hdbcds, I assume flattening
   * takes care of this for the other cases already
   *
   * @param {CSN.Column} col
   * @param {CSN.Path} path
   */
  function addImplicitAliasWithAssoc( col, path ) {
    if (!col.as && col.ref && col.ref.length > 1) {
      const { links } = inspectRef(path);
      if (links && links.slice(0, -1).some(({ art }) => art && isAssocOrComposition(art)))
        col.as = getLastRefStepString(col.ref);
    }
  }

  /**
   * If simply selecting from a param like `:param`, we need to add an implicit alias like `:param as param`
   * due to an issue with HANA
   *
   * @param {CSN.Column} col
   */
  function addImplicitAliasWithLonelyParam( col ) {
    if (!col.as && col.param)
      col.as = getLastRefStepString(col.ref);
  }


  /**
   * Loop over the columns and call all the given functions with the column and the path
   *
   * @param {Function[]} functions
   * @param {CSN.Column[]} columns
   * @param {CSN.Path} path
   */
  function processColumns( functions, columns, path ) {
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      functions.forEach(fn => fn(col, path.concat(i)));
    }
  }

  /**
   * @param {CSN.Query} query
   * @param {CSN.Artifact} artifact
   * @param {string} artName
   * @param {CSN.Path} path
   */
  function transformViewOrEntity( query, artifact, artName, path ) {
    const ignoreAssociations = options.sqlDialect === 'hana' && options.withHanaAssociations === false;
    csnUtils.initDefinition(artifact);
    const { elements } = queryOrMain(query, artifact); // TODO: use queryForElements
    // We use the elements from the leading query/main artifact - adapt the path
    const elementsPath = elements === artifact.elements ? path.slice(0, 2).concat('elements') : path.concat('elements');
    const queryPath = path;

    let hasNonAssocElements = false;
    const isSelect = query && query.SELECT;
    const isProjection = !!artifact.projection || query && query.SELECT && !query.SELECT.columns;
    const columnMap = getColumnMap(query, csnUtils);
    const isSelectStar = query && query.SELECT && query.SELECT.columns && query.SELECT.columns.indexOf('*') !== -1;

    // check all queries/subqueries for mixin publishing inside of unions -> forbidden in hdbcds
    if (query && options.transformation === 'hdbcds' && query.SELECT && query.SELECT.mixin && path.indexOf('SET') !== -1)
      checkForMixinPublishing(query, elements, path);

    // Second walk through the entity elements: Deal with associations (might also result in new elements)
    // Will be initialized JIT inside the elements-loop
    let $combined;

    const publishedMixins = new WeakMap();

    for (const elemName in elements) {
      const elem = elements[elemName];

      if (isSelect) {
        if (!columnMap[elemName])
          addProjectionOrStarElement(query, isProjection, isSelectStar, $combined, columnMap, elemName);

        // For associations - make sure that the foreign keys have the same "style"
        // If A.assoc => A.assoc_id, else if assoc => assoc_id or assoc as Assoc => Assoc_id
        if (elem.keys && doA2J)
          addForeignKeysToColumns(columnMap, elem, elemName);
      }
      // Views must have at least one element that is not an unmanaged assoc
      if (!elem.on && !elem.$ignore)
        hasNonAssocElements = true;

      // (180 b) Create MIXINs for association elements in projections or views (those that are not mixins by themselves)
      // CDXCORE-585: Allow mixin associations to be used and published in parallel
      if (query !== undefined && elem.target)
        handleAssociationElement(query, elements, columnMap, publishedMixins, elem, elemName, elementsPath, queryPath);
    }

    if (query && !hasNonAssocElements) {
      // Complain if there are no elements other than unmanaged associations or associations without keys.
      error('def-missing-element', [ 'definitions', artName ], { '#': 'view' });
    }

    if (isSelect) {
      // Build new columns from the column map - bring elements and columns back in sync basically
      query.SELECT.columns = Object.keys(elements).filter(elem => !elements[elem].$ignore && !(elements[elem].target && ignoreAssociations)).map(key => stripLeadingSelf(columnMap[key]));
      // If following an association, explicitly set the implicit alias
      // due to an issue with HANA - this seems to only have an effect on ref files with hdbcds-hdbcds, so only run then
      const columnProcessors = [];
      if (options.transformation === 'hdbcds' || options.transformation === 'sql' && options.sqlDialect === 'hana')
        columnProcessors.push(addImplicitAliasWithLonelyParam);
      if (options.transformation === 'hdbcds' && options.sqlMapping === 'hdbcds')
        columnProcessors.push(addImplicitAliasWithAssoc);

      if (columnProcessors.length > 0)
        processColumns(columnProcessors, query.SELECT.columns, path.concat('columns'));

      delete query.SELECT.excluding;  // just to make the output of the new transformer the same as the old

      // A2J turned usages into JOINs, we must now remove all non-published mixins (i.e. only keep the clones)
      if (query.SELECT.mixin && doA2J) {
        for (const [ name, mixin ] of Object.entries(query.SELECT.mixin)) {
          if (!publishedMixins.has(mixin))
            delete query.SELECT.mixin[name];
        }
      }
    }
  }
}

/**
 * Walk the given path and check if we are in a UNION.
 * This will return true when it is called on the subquery inside of a SET.args property.
 *
 * @param {CSN.Path} path
 * @returns {boolean}
 */
function isUnion( path ) {
  const subquery = path[path.length - 1];
  const queryIndex = path[path.length - 2];
  const args = path[path.length - 3];
  const unionOperator = path[path.length - 4];
  return path.length > 3 && (subquery === 'SET' || subquery === 'SELECT') && typeof queryIndex === 'number' && queryIndex >= 0 && args === 'args' && unionOperator === 'SET';
}

/**
 * Strip of leading $self of the ref
 *
 * @param {object} col A column
 * @returns {object}
 */
function stripLeadingSelf( col ) {
  if (col.ref && col.ref.length > 1 && col.ref[0] === '$self')
    col.ref = col.ref.slice(1);

  return col;
}

/**
 * Check that the given element is not a simple mixin-publishing
 *
 * @param {CSN.Query} query
 * @param {object} columnMap
 * @param {string} elementName
 * @returns {boolean}
 */
function checkIsNotMixinByItself( query, columnMap, elementName ) {
  if (query?.SELECT?.mixin) {
    const col = columnMap[elementName];

    if (!col.ref) // No ref -> new association, but not a mixin.
      return true;

    // Use getLastRefStepString - with hdbcds.hdbcds and malicious CSN input we might have .id
    const realName = getLastRefStepString(col.ref);
    // If the element is not part of the mixin => True
    return query.SELECT.mixin[realName] === undefined;
  }
  // the artifact does not define any mixins, the element cannot be a mixin
  return true;
}

/**
 * Return the string value of the last ref step - so either the .id or the last step.
 *
 * We cannot use implicitAs, as this causes problems for structured things with hdi-hdbcds naming
 *
 * @param {Array} ref
 * @returns {string}
 */
function getLastRefStepString( ref ) {
  const last = ref[ref.length - 1];
  if (last.id)
    return last.id;
  return last;
}

/**
 * This function is similar to csnRefs()' `columnName()`, but does not split the
 * last `col.ref` segment on `.`.
 *
 * TODO: The HDBCDS backend relies on this. Also the HDI backend relies
 *       on this for virtual elements somehow.  That can probably be fixed
 *       by using csnRefs()'s `getElement()`.
 * TODO: Remove this function; update HDBCDS/HDI
 *
 * @param {CSN.Column} col
 * @returns {string}
 */
function columnNameForMap( col ) {
  return col.as || (!col.args && col.func) || (col.ref && getLastRefStepString( col.ref ));
}

/**
 * Build a map of the resulting names (i.e. the element name of the column) and references
 * to the respective columns.
 * This can later be used to match from elements to columns.
 *
 * @param {CSN.Query} query
 * @param {object} csnUtils
 * @returns {object}
 */
function getColumnMap( query, csnUtils ) {
  const map = Object.create(null);
  if (query?.SELECT?.columns) {
    query.SELECT.columns.forEach((col) => {
      if (col !== '*') {
        // Fallback to csnUtils for columns without any alias (internal one is created)
        const as = columnNameForMap(col) || csnUtils.getColumnName( col );
        if (as && !map[as])
          map[as] = col;
      }
    });
  }
  return map;
}


/**
 * Ensure that each column in the CSN has a name.  A column does not have
 * a name if the column is an expression and there is no explicit alias.
 * In that case an internal alias (from csnRefs()) is used and made explicit
 * via non-enumerable `as`.
 *
 * For HDBCDS, the alias is made explicit as an enumerable property, because
 * HDBCDS does not support expressions as columns without aliases.
 *
 * Notes:
 *  - The alias is removed after A2J: we rely on the compiler ignoring non-enumerable CSN properties.
 *  - We can't use e.g. `$as`, as csnRefs() does not use that property, and it must not
 *    invent another name for the column (could happen after flattening).
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {object} csnUtils
 */
function ensureColumnNames( csn, options, csnUtils ) {
  forEachDefinition(csn, (def) => {
    csnUtils.initDefinition(def);
    for (const query of csnUtils.$getQueries(def) || []) {
      for (const col of query._select.columns || []) {
        if (col !== '*' && !columnAlias(col)) {
          if (options.transformation === 'hdbcds')
            col.as = csnUtils.getColumnName(col);
          else
            setProp(col, 'as', csnUtils.getColumnName(col));
        }
      }
    }
  });
}

module.exports = {
  getViewTransformer,
  getColumnMap,
  ensureColumnNames,
};
