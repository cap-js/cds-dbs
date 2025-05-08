'use strict';

const { forAllQueries, forEachDefinition, walkCsnPath } = require('../../../model/csnUtils');
const { setProp } = require('../../../base/model');
const { getHelpers } = require('./utils');

/**
 * Turn a `exists assoc[filter = 100]` into a `exists (select 1 as dummy from assoc.target where <assoc on condition> and assoc.target.filter = 100)`.
 *
 * Sample: select * from E where exists assoc[filter=100]
 *
 * E: assoc with target F, id as key
 * F: id as key, filter: Integer
 *
 * For a managed association `assoc`:
 * - For each of the foreign keys, create <assoc.target, assoc.target.key.ref> = <query source, assoc name, assoc.target.key.ref>
 *
 * Given the sample above:
 * - F.id = E.assoc.id -> which will later on be translated to the real foreign key E.assoc_id
 *
 * The final subselect looks like (select 1 as dummy from F where F.id = E.assoc.id and filter = 100).
 *
 * For an unmanaged association:
 * - For each part of the on-condition, we check:
 *   + Is it part of the target side: <assoc>.<path> is turned into <assoc.target>.<path>
 *   + Is it part of the source side: <path> is turned into <query source>.<path> - a leading $self is stripped-off
 *   + Is it something else: Don't touch it, leave as is
 *
 * Given that `assoc` from above has the on-condition assoc.id = id, we would generate the following:
 * - F.id = E.id
 *
 * The final subselect looks like (select 1 as dummy from E where F.id = E.id and filter = 100).
 *
 * For a $self backlink:
 * - For $self = <assoc>.<another-assoc>, we do the following for each foreign key of <another-assoc>
 *   + <assoc>.<another-assoc>.<fk> -> <assoc.target>.<another-assoc>.<fk>
 *   + Afterwards, we get the corresponding key from the source side: <query-source>.<fk>
 *   + And turn this into a comparison: <assoc.target>.<another-assoc>.<fk> = <query-source>.<fk>
 *
 * So for the sample above, given an on-condition like $self = assoc.backToE, we would generate:
 * - F.backToE.id = E.id
 *
 * The final subselect looks like (select 1 as dummy from E where F.backToE.id = E.id and filter = 100).
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {Function} error
 * @param {Function} inspectRef
 * @param {Function} initDefinition
 * @param {Function} dropDefinitionCache
 */
function handleExists( csn, options, error, inspectRef, initDefinition, dropDefinitionCache ) {
  const {
    getBase,
    firstLinkIsEntityOrQuerySource,
    getFirstAssoc,
    translateManagedAssocToWhere,
    getQuerySources,
    translateUnmanagedAssocToWhere,
  } = getHelpers(csn, inspectRef, error);
  const generatedExists = new WeakMap();
  forEachDefinition(csn, (artifact, artifactName) => {
    // drop cache: Otherwise, the projection/query hack below won't work, because csnRefs
    // thinks that the artifact was already initialized (including all queries).
    dropDefinitionCache(artifact);
    if (artifact.projection) // do the same hack we do for the other stuff...
      artifact.query = { SELECT: artifact.projection };

    if (artifact.query) {
      forAllQueries(artifact.query, function handleExistsQuery(query, path) {
        if (!generatedExists.has(query)) {
          const toProcess = []; // Collect all expressions we need to process here
          if (query.SELECT?.where?.length > 1)
            toProcess.push([ path.slice(0, -1), path.concat('where') ]);

          if (query.SELECT?.having?.length > 1)
            toProcess.push([ path.slice(0, -1), path.concat('having') ]);

          if (query.SELECT?.columns)
            toProcess.push([ path.slice(0, -1), path.concat('columns') ]);

          if (query.SELECT?.from.on)
            toProcess.push([ path.slice(0, -1), path.concat([ 'from', 'on' ]) ]);

          for (const [ , exprPath ] of toProcess) {
            const expr = nestExists(exprPath);
            walkCsnPath(csn, exprPath.slice(0, -1))[exprPath[exprPath.length - 1]] = expr;
          }

          while (toProcess.length > 0) {
            const [ queryPath, exprPath ] = toProcess.pop();
            // Re-init caches for this artifact
            dropDefinitionCache(artifact);
            initDefinition(artifact);
            // leftovers can happen with nested exists - we then need to drill down into the created SELECT
            // to check for further exists
            const { result, leftovers } = processExists(queryPath, exprPath);
            walkCsnPath(csn, exprPath.slice(0, -1))[exprPath[exprPath.length - 1]] = result;
            leftovers.reverse();
            toProcess.push(...leftovers); // any leftovers - schedule for further processing
          }
          // Make sure we leave csnRefs usable
          dropDefinitionCache(artifact);
          initDefinition(artifact);
        }
      }, [ 'definitions', artifactName, 'query' ]);
    }

    if (artifact.projection) { // undo our hack
      artifact.projection = artifact.query.SELECT;

      delete artifact.query;
    }
  });

  /**
   * Get the index of the first association that is found - starting the
   * search at the given startIndex.
   *
   * @param {number} startIndex Where to start searching
   * @param {object[]} links links for a ref, produced by inspectRef
   * @returns {number|null} Null if no association was found
   */
  function getFirstAssocIndex( startIndex, links ) {
    for (let i = startIndex; i < links.length; i++) {
      if (links[i] && links[i].art && links[i].art.target)
        return i;
    }

    return null;
  }

  /**
   * For a given ref-array, this function is called for the first assoc-ref in the array.
   *
   * It then runs over the rest of the array and puts all other steps in the first assocs filter.
   * If the rest contains another assoc, we put all following things into that assocs filter and
   * add the sub-assoc to the previous assoc filter.
   *
   * Or in other words:
   * - exists toF[1=1].toG[1=1].toH[1=1] is found
   * - we get called with toF[1=1].toG[1=1].toH[1=1]
   * - we return toF[1=1 and exists toG[1=1 and exists toH[1=1]]]
   *
   * @param {number} startIndex The index of the thing AFTER _main in the ref-array
   * @param {string|object} startAssoc The path step that is the first assoc
   * @param {Array} startRest Any path steps after startAssoc
   * @param {CSN.Path} path to the overall ref where _main is contained
   * @returns {Array} Return the now-nested ref-array
   */
  function nestFilters( startIndex, startAssoc, startRest, path ) {
    let revert;
    if (!startAssoc.where) { // initialize first filter if not present
      if (typeof startAssoc === 'string') {
        startAssoc = {
          id: startAssoc,
          where: [],
        };
        revert = () => {
          startAssoc = startAssoc.id;
        };
      }
      else {
        startAssoc.where = [];
        revert = () => {
          delete startAssoc.where;
        };
      }
    }
    const stack = [ [ null, startAssoc, startRest, startIndex ] ];
    const { links } = inspectRef(path);
    while (stack.length > 0) {
      // previous: to nest "up" if the previous assoc did not originally have a filter
      // assoc: the assoc path step
      // rest: path steps after assoc
      // index: index of after-assoc in the overall ref-array - so we know where to start looking for the next assoc
      const workPackage = stack.pop();
      const [ previous, , rest, index ] = workPackage;
      let [ , assoc, , ] = workPackage;

      const firstAssocIndex = getFirstAssocIndex(index, links);

      const head = rest.slice(0, firstAssocIndex - index);
      const nextAssoc = rest[firstAssocIndex - index];
      const tail = rest.slice(firstAssocIndex - index + 1);

      const hasAssoc = nextAssoc !== undefined;

      if (!assoc.where && hasAssoc) { // no existing filter - and there is stuff we need to nest afterwards
        if (typeof assoc === 'string') {
          assoc = {
            id: assoc,
            where: [],
          };
          // We need to "hook" this into the previous filter.
          // Since we create a new object, we don't have a handy reference we can just manipulate
          if (previous)
            previous.where[previous.where.length - 1] = { ref: [ assoc ] };
        }
        else {
          assoc.where = [];
        }
      }
      else if (assoc.where && assoc.where.length > 0 && (hasAssoc || rest.length > 0)) {
        assoc.where.push('and');
      } // merge with existing filter

      if (hasAssoc)
        assoc.where.push('exists', { ref: [ ...head, nextAssoc ] });
      else if (rest.length > 0)
        assoc.where.push({ ref: rest });

      if (hasAssoc)
        stack.push([ assoc, nextAssoc, tail, firstAssocIndex ]);
    }

    // Seems like we did not have anything to nest into the filter - then kill it
    if (startAssoc.where.length === 0 && revert !== undefined)
      revert();

    return startAssoc;
  }

  /**
   * Walk to the expr using the given path and scan it for the "exists" + "ref" pattern.
   * If such a pattern is found, nest association steps therein into filters.
   *
   * @param {CSN.Path} exprPath
   * @returns {Array}
   */
  function nestExists( exprPath ) {
    const expr = walkCsnPath(csn, exprPath);
    for (let i = 0; i < expr.length; i++) {
      if (i < expr.length - 1 && expr[i] === 'exists' && expr[i + 1].ref) {
        i++;
        const current = expr[i];
        const {
          ref, head, tail,
        } = getFirstAssoc(current, exprPath.concat(i));

        const newThing = [ ...head, nestFilters(head.length + 1, ref, tail, exprPath.concat([ i ])) ];
        expr[i].ref = newThing;
      }
    }

    return expr;
  }

  /**
   * Process the given expr of the given query and translate a `EXISTS assoc` into a `EXISTS (subquery)`. Also, return paths to things we need to process in a second step.
   *
   * @param {CSN.Path} queryPath Path to the query-object
   * @param {CSN.Path} exprPath Path to the expression-array to process
   * @returns {{result: TokenStream, leftovers: Array[]}} result: A new token stream expression - the same as expr, but with the expanded EXISTS, leftovers: path-tuples to further subqueries to process.
   */
  function processExists( queryPath, exprPath ) {
    const toContinue = [];
    const newExpr = [];
    const query = walkCsnPath(csn, queryPath);
    const expr = walkCsnPath(csn, exprPath);
    const queryBase = query.SELECT.from.ref ? (query.SELECT.from.as || query.SELECT.from.ref) : null;
    const sources = getQuerySources(query.SELECT);

    for (let i = 0; i < expr.length; i++) {
      if (i < expr.length - 1 && expr[i] === 'exists' && expr[i + 1].ref) {
        i++;
        const current = expr[i];
        const isPrefixedWithTableAlias = firstLinkIsEntityOrQuerySource({}, exprPath.concat(i));
        const base = getBase(queryBase, isPrefixedWithTableAlias, current, exprPath.concat(i));
        const { root, ref } = getFirstAssoc(current, exprPath.concat(i));

        const subselect = getSubselect(root.target, ref, sources);

        const target = subselect.SELECT.from.as; // use subquery alias as target - prevent shadowing
        const extension = root.keys ? translateManagedAssocToWhere(root, target, isPrefixedWithTableAlias, base, current) : translateUnmanagedAssocToWhere(root, target, isPrefixedWithTableAlias, base, current);

        if (options.tenantDiscriminator) {
          const targetEntity = csn.definitions[root.target];
          if (!targetEntity['@cds.tenant.independent']) {
            subselect.SELECT.where.push(
              { ref: [ target, 'tenant' ] }, '=', { ref: [ base, 'tenant' ] }, 'AND'
            );
          }
        }

        // TODO: add tenant comparison here ?
        if (extension.length > 3) {
          // make on-condition part sub-xpr to ensure precedence is kept
          subselect.SELECT.where.push({ xpr: extension });
        }
        else {
          subselect.SELECT.where.push(...extension);
        }

        newExpr.push('exists');
        if (ref?.where) {
          const remappedWhere = remapExistingWhere(target, ref.where, exprPath, current);
          subselect.SELECT.where.push('and');
          if (remappedWhere.length > 3)
            subselect.SELECT.where.push( { xpr: remappedWhere } );
          else
            subselect.SELECT.where.push( ...remappedWhere );
        }

        newExpr.push(subselect);
        toContinue.push([ exprPath.concat(newExpr.length - 1), exprPath.concat([ newExpr.length - 1, 'SELECT', 'where' ]) ]);
      }
      else { // Drill down into other places that might contain a `EXISTS <assoc>`
        if (expr[i].xpr) {
          const { result, leftovers } = processExists(queryPath, exprPath.concat([ i, 'xpr' ]));
          expr[i].xpr = result;
          toContinue.push(...leftovers);
        }
        if (expr[i].args && Array.isArray(expr[i].args)) {
          const { result, leftovers } = processExists(queryPath, exprPath.concat([ i, 'args' ]));
          expr[i].args = result;
          toContinue.push(...leftovers);
        }
        newExpr.push(expr[i]);
      }
    }

    return { result: newExpr, leftovers: toContinue };
  }

  /**
   * Build an initial subselect for the final `EXISTS <subselect>`.
   *
   * @param {string} target The target of `EXISTS <assoc>` - will be selected from
   * @param {string|object} assocRef The ref "being" the association
   * @param {object} _sources Object containing the names of the query sources of the current query
   * @returns {CSN.Query}
   */
  function getSubselect( target, assocRef, _sources ) {
    let subselectAlias = `_${ assocRef.id ? assocRef.id : assocRef }_exists`;

    while (_sources[subselectAlias])
      subselectAlias = `_${ subselectAlias }`;

    const subselect = {
      SELECT: {
        // use alias to prevent shadowing of upper-level table alias
        from: { ref: [ target ], as: subselectAlias },
        columns: [ { val: 1, as: 'dummy' } ],
        where: [],
      },
    };

    if (assocRef.args) // copy named arguments
      subselect.SELECT.from.ref = [ { id: target, args: assocRef.args } ];

    setProp(subselect.SELECT.from, '_art', csn.definitions[target]);
    setProp(subselect.SELECT.from, '_links', [ { idx: 0, art: csn.definitions[target] } ]);

    // Because the generated things don't have _links, _art etc. set
    // We could also make getParent more robust to calculate the links JIT if they are missing
    generatedExists.set(subselect, true);

    const nonEnumElements = Object.create(null);
    nonEnumElements.dummy = {
      type: 'cds.Integer',
    };

    setProp(subselect.SELECT, 'elements', nonEnumElements);

    return subselect;
  }


  /**
   * If the assoc-base for EXISTS <assoc> has a filter, we need to merge this filter into the WHERE-clause of the subquery.
   *
   * This function does this by adding the assoc target before all the refs so that the refs are resolvable in the WHERE.
   *
   * This function also rejects $self paths in filter conditions.
   *
   * @param {string} target
   * @param {TokenStream} where
   * @param {CSN.Path} path path to the part, used if error needs to be thrown
   * @param {CSN.Artifact} parent the host of the `where`, used if error needs to be thrown
   *
   * @returns {TokenStream} where The input-where with the refs transformed to absolute ones
   */
  function remapExistingWhere( target, where, path, parent ) {
    return where.map((part) => {
      if (part.$scope === '$self') {
        error('ref-unexpected-self', path, { '#': 'exists-filter', elemref: parent, id: part.ref[0] });
      }
      else if (part.ref && part.$scope !== '$magic') {
        part.ref = [ target, ...part.ref ];
        return part;
      }

      return part;
    });
  }
}


module.exports = handleExists;

/**
 * @typedef {Token[]} TokenStream Array of tokens.
 */

/**
 * @typedef {string|object} Token Could be an object or a string - strings are usually operators.
 */
