'use strict';

const {
  applyTransformations,
  setDependencies,
  walkCsnPath,
  getUtils,
} = require('../../model/csnUtils');
const { implicitAs, columnAlias, pathId } = require('../../model/csnRefs');
const { setProp } = require('../../base/model');
const { forEach } = require('../../utils/objectUtils');
const { killNonrequiredAnno } = require('./killAnnotations');
const { featureFlags } = require('../featureFlags');

/**
 * For keys, columns, groupBy and orderBy, expand structured things.
 * Replace them with their flattened leaves, keeping the overall order intact.
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {string} pathDelimiter
 * @param {object} messageFunctions
 * @param {object} csnUtils
 * @param {object} [iterateOptions]
 */
function expandStructureReferences( csn, options, pathDelimiter, messageFunctions, csnUtils, iterateOptions = {} ) {
  const { error, info, throwWithAnyError } = messageFunctions;

  if (options.transformation === 'odata' || csn.meta?.[featureFlags]?.$expandInline)
    rewriteExpandInline();

  throwWithAnyError();

  const transformers = {
    keys: (parent, name, keys, path) => {
      parent.keys = expand(keys, path.concat('keys'), true);
    },
    columns: (parent, name, columns, path) => {
      const artifact = csn.definitions[path[1]];
      csnUtils.initDefinition(artifact); // potentially not initialized, yet
      if (!artifact['@cds.persistence.table']) {
        const root = csnUtils.get$combined({ SELECT: parent });
        // TODO: replace with the correct options.transformation?
        // Do not expand the * in OData for a moment, not to introduce changes
        // while the OData CSN is still official
        const isComplexQuery = parent.from.join !== undefined;
        if (!options.toOdata)
          parent.columns = replaceStar(root, columns, parent.excluding, isComplexQuery);
        // FIXME(v6): Remove argument "isComplexOrNestedQuery"; we use path.length > 4 to check
        // if we're inside the outermost "columns". If so, always prepend a table alias. See #11662
        parent.columns = expand(parent.columns, path.concat('columns'), true, isComplexQuery || path.length > 4);
      }
    },
    groupBy: (parent, name, groupBy, path) => {
      parent.groupBy = expand(groupBy, path.concat('groupBy'));
    },
    orderBy: (parent, name, orderBy, path) => {
      parent.orderBy = expand(orderBy, path.concat('orderBy'));
    },
    list: (parent, name, list, path) => {
      parent.list = expand(list, path.concat('list'));
    },
  };

  // To not have a whole model loop for such a "small" thing, we kill all non-sql-backend relevant annotations here
  if (options.transformation === 'sql' || options.transformation === 'hdbcds')
    transformers['@'] = killNonrequiredAnno;

  applyTransformations(csn, transformers, [], iterateOptions);

  /**
   * Turn .expand/.inline into normal refs. @cds.persistence.skip .expand with to-many (and all transitive views).
   * For such skipped things, error for usage of assoc pointing to them and ignore publishing of assoc pointing to them.
   */
  function rewriteExpandInline() {
    let cleanup = [];
    let _dependents;

    const entity = findAnEntity();
    const toDummify = [];

    applyTransformations(csn, {
      columns: (parent, name, columns, path) => {
        const artifact = csn.definitions[path[1]];
        // get$combined expects a SET/SELECT - so we wrap the parent
        // (which is the thing inside SET/SELECT)
        // We can directly use SELECT here, as only projections and SELECT can have .columns
        const root = csnUtils.get$combined({ SELECT: parent });
        if (!artifact['@cds.persistence.table']) {
          // Make root look like normal .elements - we never cared about conflict afaik anyway
          Object.keys(root).forEach((key) => {
            root[key] = root[key][0].element;
          });
          const rewritten = rewrite(root, parent.columns, parent.excluding);
          /*
           * Do not remove unexpandable many columns in OData
          */
          if (rewritten.toMany.length > 0 && !options.toOdata) {
            markAsToDummify(artifact, path[1]);
            rewritten.toMany.forEach(({ art }) => {
              error( null, art.$path || [ 'definitions', path[1] ], { name: `${ art.$env || path[1] }:${ art.ref.map(r => r.id || r) }` }, 'Unexpected .expand with to-many association $(NAME)');
            });
          }
          else {
            parent.columns = rewritten.columns;
          }
        }
      },
    });

    // OData must keep @cds.persistence.skip definitions
    // to present them in the API (and CSN)
    if (!options.toOdata)
      dummyfy();

    cleanup.forEach(fn => fn());

    csnUtils = getUtils(csn);

    const publishing = [];
    // OData must allow navigations to @cds.persistence.skip targets
    // as valid navigations in the API
    if (options.transformation !== 'odata') {
      applyTransformations(csn, {
        target: (parent, name, target, path) => {
          if (toDummify.indexOf(target) !== -1) {
            publishing.push({
              parent, name, target, path: [ ...path ],
            });
          }
        },
        from: check,
        columns: check,
        where: check,
        groupBy: check,
        orderBy: check,
        having: check,
        limit: check,
      });
    }


    /**
     * Check for usage of associations to skipped.
     * While we're at it, kill publishing of such assocs in columns.
     *
     * @param {object} parent
     * @param {string} name
     * @param {Array} parts
     * @param {CSN.Path} path
     */
    function check( parent, name, parts, path ) {
      const inColumns = name === 'columns';
      const kill = [];
      for (let i = 0; i < parts.length; i++) {
        const obj = parts[i];
        if (!(obj && obj.ref) || obj.$scope === 'alias')
          continue;

        const links = obj._links || csnUtils.inspectRef(path.concat([ name, i ])).links;

        if (!links)
          continue;

        // Don't check the last element - to allow association publishing in columns
        for (let j = 0; j < (inColumns ? links.length - 1 : links.length); j++) {
          const link = links[j];
          if (!link)
            continue;

          const { art } = link;
          if (!art)
            continue;

          const pathStep = obj.ref[j].id ? obj.ref[j].id : obj.ref[j];
          const target = art.target ? art.target : pathStep;
          if (toDummify.indexOf(target) !== -1) {
            error( null, obj.$path, {
              id: pathStep,
              elemref: obj,
              name,
              anno: '@cds.persistence.skip',
            }, 'Unexpected $(ANNO) annotation on Association target $(NAME) of $(ID) in path $(ELEMREF) was skipped because of .expand in conjunction with to-many');
          }
        }

        if (inColumns) {
          const { art } = links[links.length - 1];

          if (art) {
            const pathStep = obj.ref[obj.ref.length - 1].id ? obj.ref[obj.ref.length - 1].id : obj.ref[obj.ref.length - 1];
            const target = art.target ? art.target : pathStep;
            if (toDummify.indexOf(target) !== -1)
              kill.push(i);
          }
        }
      }

      for (let i = kill.length - 1; i >= 0; i--)
        parent[name].splice(kill[i]);
    }

    for (const {
      parent, target, path,
    } of publishing) {
      const last = parent.$path[parent.$path.length - 1];
      const grandparent = walkCsnPath(csn, parent.$path.slice(0, -1));

      if (typeof last === 'number')
        grandparent.splice(last);
      else
        delete grandparent[last];

      info(null, path, { name: last, target }, 'Ignoring association $(NAME) with target $(TARGET), because it was skipped because of .expand in conjunction with to-many');
    }

    /**
     * Mark the given artifact and all (transitively) dependent artifacts as `toDummify`.
     * This means that they will be replaced with simple dummy views in @dummify
     *
     * @param {CSN.Artifact} artifact
     * @param {string} name
     */
    function markAsToDummify( artifact, name ) {
      if (!_dependents && cleanup.length === 0)
        ({ cleanup, _dependents } = setDependencies(csn, csnUtils));

      const stack = [ [ artifact, name ] ];
      while (stack.length > 0) {
        const [ a, n ] = stack.pop();
        if (a[_dependents]) {
          forEach(a[_dependents], (dependentName, dependent) => {
            stack.push([ dependent, dependentName ]);
          });
        }
        toDummify.push(n);
      }
    }

    /**
     * Replace the artifacts in `toDummify` with simple dummy views as produced by createDummyView.
     */
    function dummyfy() {
      for (const artifactName of [ ...new Set(toDummify) ])
        csn.definitions[artifactName] = createDummyView(entity);
    }


    /**
     * Get the next base for resolving  a *.
     * Keep the current base unless we are now navigating into a structure or association.
     *
     * @param {CSN.Column} parent
     * @param {CSN.Artifact} base The current base
     * @returns {CSN.Artifact}
     */
    function nextBase( parent, base ) {
      if (parent.ref) {
        const finalBaseType = csnUtils.getFinalTypeInfo(parent._art.type);
        const art = parent._art;

        if (finalBaseType && (finalBaseType.type === 'cds.Association' || finalBaseType.type === 'cds.Composition'))
          return csn.definitions[art.target].elements;

        return art.elements || finalBaseType?.elements;
      }

      return base;
    }

    /**
     * Rewrite expand and inline to "normal" refs
     *
     * @param {CSN.Artifact} root All elements visible from the query source ($combined)
     * @param {CSN.Column[]} columns
     * @param {string[]} excluding
     * @returns {{columns: Array, toMany: Array}} Object with rewritten columns (.expand/.inline) and with any .expand + to-many
     */
    function rewrite( root, columns, excluding ) {
      const allToMany = [];
      const newThing = [];
      const containsExpandInline = columns.some(col => col.expand || col.inline);
      if (containsExpandInline) // Replace stars - needs to happen before resolving .expand/.inline since the .expand/.inline first path step affects the root *
        columns = replaceStar(root, columns, excluding);
      else
        return { columns, toMany: [] };

      for (const col of columns) {
        if (col.expand || col.inline) {
          const { expanded, toManys } = expandInline(root, col, col.ref || [], col.expand ? [ dbName(col) ] : []);

          allToMany.push(...toManys);
          newThing.push(...expanded);
        }
        else {
          newThing.push(col);
        }
      }

      return { columns: newThing, toMany: allToMany };
    }

    /**
     * Check whether the given object is a to-many association
     *
     * @param {CSN.Element} obj
     * @returns {boolean}
     */
    function isToMany( obj ) {
      if (!obj._art)
        return false;
      const eType = csnUtils.effectiveType(obj._art);
      return (eType.type === 'cds.Association' || eType.type === 'cds.Composition') && eType.cardinality && eType.cardinality.max !== 1;
    }

    /**
     * Rewrite the expand/inline. For expand, keep along the alias - for inline, only leaf-alias has effect.
     * Expand * into the corresponding leaves - correctly handling .excluding and shadowing.
     *
     * Iterative, to not run into stack overflow.
     *
     * @param {CSN.Artifact} root All elements visible from the query source ($combined)
     * @param {CSN.Column} col Column to expand
     * @param {Array} ref Ref so far
     * @param {Array} alias Any start-alias
     * @returns {{expanded: Array, toManys: Array}} Object with expanded .expand/.inline and with any .expand + to-many
     */
    function expandInline( root, col, ref, alias ) {
      const toManys = [];
      const expanded = [];
      const stack = [ [ root, col, ref, alias ] ];

      while (stack.length > 0) {
        const [ base, current, currentRef, currentAlias ] = stack.pop();
        if (isToMany(current) && current.expand) {
          expanded.push({
            expand: current.expand,
            ref: currentRef,
            as: currentAlias.join(pathDelimiter),
          });
          toManys.push({ art: current, ref: currentRef, as: currentAlias.join(pathDelimiter) });
        }
        else if (current.expand || current.inline) {
          const withoutStar = replaceStar(nextBase(current, base), current.expand || current.inline, current.excluding);
          current[current.expand ? 'expand' : 'inline'] = withoutStar;
          for (let i = withoutStar.length - 1; i >= 0; i--) {
            const sub = withoutStar[i];
            let subRef;
            if (sub.ref) {
              // Each expand/inline can introduce another layer of $self/$projection.  Since $self is
              // a path-breakout, we can simply use the ref without outer expand/inline-references.
              subRef = (sub.$scope === '$self') ? sub.ref : currentRef.concat(sub.ref);
            }
            else {
              subRef = currentRef;
            }
            stack.push([ nextBase(current, base), sub, subRef, !sub.inline ? currentAlias.concat(dbName(sub)) : currentAlias ]);
          }
        }
        else if (current.xpr || current.args) {
          // We need to re-write refs in the .xpr/.args so they stay resolvable - we need to prepend the currentRef
          rewriteExpressionArrays(current, currentRef);
          expanded.push(Object.assign({}, current, { as: currentAlias.join(pathDelimiter) } ));
        }
        else if (current.on || current.cast?.on) {
          rewriteOn(current, [ currentAlias.slice(0, -1).join(pathDelimiter) ]);
          expanded.push(Object.assign({}, current, { ref: currentRef, as: currentAlias.join(pathDelimiter) } ));
        }
        else if (current.val !== undefined || current.func !== undefined) {
          expanded.push(Object.assign(current, { as: currentAlias.join(pathDelimiter) }));
        }
        else if (current.$scope === '$magic' || current.$scope === '$self') {
          expanded.push(Object.assign({}, current, { as: currentAlias.join(pathDelimiter) } ));
        }
        else { // preserve stuff like .cast for redirection
          const thing = base[currentAlias[currentAlias.length - 1]];
          const value = current?._art?.value || thing?.value;
          if (value && !value.stored)
            error('query-unsupported-calc', current.$path || col.$path, { '#': 'inside' });
          expanded.push(Object.assign({}, current, { ref: currentRef, as: currentAlias.join(pathDelimiter) } ));
        }
      }

      return { expanded, toManys };
    }

    /**
     * Rewrite refs in the .xpr/.args to stay resolvable
     *
     * @param {object} parent Thing that has an .xpr/.args
     * @param {string[]} ref Ref so far
     */
    function rewriteExpressionArrays( parent, ref ) {
      const stack = [ [ parent, ref ] ];
      while (stack.length > 0) {
        const [ current, currentRef ] = stack.pop();
        if (current.xpr)
          rewriteSingleExpressionArray(current.xpr, currentRef, stack);
        if (current.args)
          rewriteSingleExpressionArray(current.args, currentRef, stack);
      }
    }

    /**
     * With a .cast.on  or .on in a .expand/.inline, we need to change the references,
     * since we change the overall scope of things (by "heaving" them up into "normal refs").
     *
     * So anything that does not have a $self/$projection infront gets the so-far-traveled alias,
     * since after the transformation it will basically be in "top-level".
     *
     * @param {object} parent
     * @param {Array} ref The so-far effective name (basically the will-be alias), as an array to treat like a ref
     */
    function rewriteOn( parent, ref ) {
      const stack = [ [ parent, ref ] ];
      while (stack.length > 0) {
        const [ current, currentRef ] = stack.pop();
        if (current.on)
          rewriteOnCondition(current.on, currentRef, stack);
        if (current.cast?.on)
          rewriteOnCondition(current.cast.on, currentRef, stack);
      }
    }

    /**
     * Actually rewrite the given oncondition. Once we find something to rewrite,
     * we preprend the currentRef.
     *
     * All stuff is pushed to the stack.
     *
     * @param {Array} on
     * @param {Array} currentRef
     * @param {Array} stack
     */
    function rewriteOnCondition( on, currentRef, stack ) {
      for (let i = 0; i < on.length; i++) {
        const part = on[i];
        if (part.ref && part.ref[0] !== '$self' && part.ref[0] !== '$projection') {
          part.ref = currentRef[0] ? [ currentRef[0], ...part.ref ] : part.ref;
          on[i] = part;
          stack.push([ part, part.ref ]);
        }
        else {
          stack.push([ part, currentRef ]);
        }
      }
    }

    /**
     * Rewrite the given expressionArray, prefixing currentRef to all refs
     *
     * @param {Array} expressionArray
     * @param {Array} currentRef
     * @param {Array} stack
     */
    function rewriteSingleExpressionArray( expressionArray, currentRef, stack ) {
      for (let i = 0; i < expressionArray.length; i++) {
        const part = expressionArray[i];
        if (part.ref) {
          part.ref = currentRef.concat(part.ref);
          expressionArray[i] = part;
          stack.push([ part, part.ref ]);
        }
        else {
          stack.push([ part, currentRef ]);
        }
      }
    }

    /**
     * Find any entity from the model so we can use it as the query source for our dummies.
     *
     * @returns {string|null} Name of any entity
     */
    function findAnEntity() {
      for (const name in csn.definitions) {
        if (Object.prototype.hasOwnProperty.call(csn.definitions, name) && csn.definitions[name].kind === 'entity' && !csn.definitions[name].query)
          return name;
      }
      return null;
    }

    /**
     * Create a simple dummy view marked with @cds.persistence.skip
     *
     * @param {string} source
     * @returns {CSN.Artifact}
     */
    function createDummyView( source ) {
      const elements = Object.create(null);
      elements.one = {
        '@Core.Computed': true,
        type: 'cds.Integer',
      };
      const artifact = {
        '@cds.persistence.skip': true,
        kind: 'entity',
        query: {
          SELECT: {
            from: {
              ref: [
                source,
              ],
            },
            columns: [
              {
                val: 1,
                as: 'one',
                cast: {
                  type: 'cds.Integer',
                },
              },
            ],
          },
        },
        elements,
      };

      setProp(artifact, '$wasToMany', true);

      return artifact;
    }
  }


  /**
   * Process thing and expand all structured refs inside
   *
   * @param {Array} thing
   * @param {CSN.Path} path
   * @param {boolean} [withAlias=false] Whether to "expand" the (implicit) alias as well.
   * @param {boolean} [isComplexOrNestedQuery]
   * @returns {Array} New array - with all structured things expanded
   */
  function expand( thing, path, withAlias = false, isComplexOrNestedQuery = false ) {
    const newThing = [];
    for (let i = 0; i < thing.length; i++) {
      const col = thing[i];
      if (col.ref && col.$scope !== '$magic') {
        const _art = col._art || csnUtils.inspectRef(path.concat(i)).art;
        if (_art && csnUtils.isStructured(_art))
          newThing.push(...expandRef(_art, col, withAlias, isComplexOrNestedQuery));
        else
          newThing.push(col);
      }
      else if (col.ref && col.$scope === '$magic' && ( col.ref[0] === '$user' || col.ref[0] === '$tenant' || col.ref[0] === '$session' ) && !col.as) {
        col.as = implicitAs(col.ref);
        newThing.push(col);
      }
      else if (col.cast?.type) {
        const _art = col.cast._type || csnUtils.inspectRef(path.concat(i, 'cast', 'type')).art;
        if (_art && csnUtils.isStructured(_art)) {
          // special case for `null as name : Struct`
          if (col.val === null) {
            newThing.push(...expandValAsStructure(_art, col, withAlias));
          }
          else {
            error('type-invalid-cast', path.concat(i, 'cast', 'type'), {
              '#': col.val !== undefined ? 'val-to-structure' : 'expr-to-structure', value: col.val,
            });
          }
        }
        else {
          newThing.push(col);
        }
      }
      else {
        newThing.push(col);
      }
    }

    return newThing;
  }

  /**
   * Expands a column, and calls leafCallback() when a leaf node is reached.
   *
   * @param {CSN.Element} art
   *     Structured Artifact which is used for expansion (and names, etc.).  For a ref, it's the
   *     underlying type or a cast-type, for a value, it's always the cast-type.
   * @param {string} colName
   *     Name of the column, that is used as the first name segment, e.g. a column `a` may end up in
   *     leafs `a_b` and `a_c`, if `art` has elements `b` and `c`.
   * @param {string[]} colTypeRef
   *     Expanded type for the column. Basically the path to the to-be-expanded `art`.
   * @param {(currentRef: any[], currentAlias: string[]) => object} leafCallback
   *    Callback when leaf nodes are reached. currentRef is the type reference for the expanded
   *    column.  currentAlias is the columns calculated alias.
   * @returns {object[]}
   */
  function _expandStructCol( art, colName, colTypeRef, leafCallback ) {
    const expanded = [];
    /** @type {Array<[CSN.Element, any[], string[]]>} */
    const stack = [ [ art, colTypeRef, [ colName ] ] ];
    while (stack.length > 0) {
      const [ current, currentRef, currentAlias ] = stack.pop();
      if (csnUtils.isStructured(current)) {
        // `cds.Map` may also be used
        const elements = Object.entries(current.elements || csnUtils.effectiveType(current).elements || {}).reverse();
        for (const [ name, elem ] of elements)
          stack.push([ elem, currentRef.concat(name), currentAlias.concat(name) ]);
      }
      else {
        const newCol = leafCallback(currentRef, currentAlias);
        expanded.push(newCol);
      }
    }

    return expanded;
  }

  /**
   * Expand the ref and - if requested - expand/set the alias with it.
   *
   * @param {CSN.Element} art
   * @param {object} root Column, ref in order by, etc.
   * @param {boolean} withAlias Whether to add an explicit flattened alias to the expanded columns/references.
   * @param {boolean} [isComplexOrNestedQuery]
   * @returns {Array}
   */
  function expandRef( art, root, withAlias, isComplexOrNestedQuery ) {
    return _expandStructCol(art, columnAlias(root), root.ref, ( currentRef, currentAlias) => {
      const obj = { ...root, ref: currentRef };
      if (withAlias) {
        obj.as = currentAlias.join(pathDelimiter);
        // alias was implicit - to later distinguish expanded s -> s.a from explicitly written s.a
        if (root.as === undefined)
          setProp(obj, '$implicitAlias', true);
      }

      // If our column/thing was cast to a structured type, we need to keep the "cast" insync with the
      // flattened out leaf elements that we turn the ref into
      if (obj.cast?.type) {
        const addedRef = currentRef.slice(root.ref.length);
        if (addedRef.length > 0) {
          // Decouple from other leafs
          obj.cast = { ...obj.cast };
          if (!obj.cast.type.ref)
            obj.cast.type = { ref: [ obj.cast.type ] };

          obj.cast.type.ref = [ ...obj.cast.type.ref, ...addedRef ];
        }
      }

      // The Java runtime, as of 2023-09-13, assumes that for _simple projections_, all references
      // are relative to the query source.  To avoid breaking that assumption unless necessary,
      // we only add the table alias if:
      //  - it is a complex query with possibly multiple available table aliases, or
      //  - the transformation is not for OData (which is used by Java), or
      //  - the first path step has the same name as the table alias (only one, as otherwise the query would be complex)
      if (typeof root.$env === 'string' && (isComplexOrNestedQuery || options.transformation !== 'odata' || root.$env === pathId(obj.ref[0])))
        obj.ref = [ root.$env, ...obj.ref ];

      if (iterateOptions.keepKeysOrigin) {
        setProp(obj, '$originalKeyRef', { ref: root.ref, as: root.as });
        setProp(obj, '$path', root.$path);
      }

      return obj;
    });
  }

  /**
   * Expand `null` columns which were cast to a structure, that is: `null as name : Struct`.
   * Requires that `col` has an alias.
   *
   * @param {CSN.Element} art
   * @param {object} col
   * @param {boolean} withAlias Whether to add an explicit flattened alias to the expanded columns/references.
   * @returns {Array}
   */
  function expandValAsStructure( art, col, withAlias ) {
    const colName = col.as || '';
    // Expression-columns may have an internal name such as `$_column_N`. If the name is internal,
    // we should not publish names based upon the internal name.
    const isInternal = !col.as || !Object.prototype.propertyIsEnumerable.call(col, 'as');

    return _expandStructCol(art, colName, col.cast.type?.ref || [ col.cast.type ], ( currentRef, currentAlias) => {
      const newCol = {
        ...col,
        val: col.val,
        cast: { type: { ref: currentRef } },
      };
      if (withAlias) {
        if (!isInternal)
          newCol.as = currentAlias.join(pathDelimiter);
        else
          setProp(newCol, 'as', currentAlias.join(pathDelimiter));
      }
      return newCol;
    });
  }

  /**
   * Get the effective name produced by the object
   *
   * @param {object} part A thing with a ref/as/func
   * @returns {string}
   */
  function dbName( part ) {
    if (part.as)
      return part.as;
    else if (part.ref)
      return implicitAs(part.ref);
    else if (part.func)
      return part.func;
    return null;
  }

  /**
   * Replace the star and correctly put shadowed things in the right place.
   *
   * @param {object} base The raw set of things a * can expand to
   * @param {Array} subs Things - the .expand/.inline or .columns
   * @param {string[]} [excluding=[]]
   * @param {boolean} [isComplexQuery=false] Wether the query is a single source select or something more complex
   * @returns {Array} If there was a star, expand it and handle shadowing/excluding, else just return subs
   */
  function replaceStar( base, subs, excluding = [], isComplexQuery = false ) {
    const stars = [];
    const names = Object.create(null);
    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i];
      if (sub !== '*') {
        const name = dbName(sub);
        names[name] = i;
      }
      else {
        // There should only be one * - but be prepared for more than one
        stars.push(i);
      }
    }


    // We have stars - replace/expand them
    if (stars.length > 0) {
      const replaced = Object.create(null);
      const final = [];
      const star = [];
      // Build the result of a * - for later use
      for (const part of Object.keys(base)) {
        if (excluding.indexOf(part) === -1) {
          // The thing is shadowed - ignore names present because of .inline, as those "disappear"
          if (names[part] !== undefined && !subs[names[part]].inline) { // Only works for a single * - but a second is forbidden anyway
            if (names[part] > stars[0]) { // explicit definitions BEFORE the star should stay "infront" of the star
              replaced[part] = true;
              star.push(subs[names[part]]);
            }
          }
          else { // the thing is not shadowed - use the name from the base
            const col = part.startsWith('$') ? { ref: [ base[part][0].parent, part ] } : { ref: [ part ] };
            if (isComplexQuery) // $env: tableAlias
              setProp(col, '$env', base[part][0].parent);

            star.push(col);
          }
        }
      }
      // Finally: Replace the stars and leave out the shadowed things
      for (const sub of subs) {
        if (sub !== '*' && !replaced[dbName(sub)])
          final.push(sub);
        else if (sub === '*')
          final.push(...star);
      }

      return final;
    }

    return subs;
  }
}

module.exports = {
  expandStructureReferences,
};
