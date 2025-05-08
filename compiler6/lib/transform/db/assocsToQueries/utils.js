'use strict';

const { getRealName } = require('../../../render/utils/common');
const { ModelError } = require('../../../base/error');

/**
 * Some shared transformation utilities between exists rewriting and general assoc to subselect rewriting
 *
 * @param {CSN.Model} csn
 * @param {Function} inspectRef
 * @param {Function} error
 * @returns {object}
 */
function getHelpers( csn, inspectRef, error ) {
  return {
    getBase,
    firstLinkIsEntityOrQuerySource,
    getFirstAssoc,
    translateManagedAssocToWhere,
    getQuerySources,
    translateUnmanagedAssocToWhere,
  };

  /**
   * Get the name of the source-side query source
   *
   * @param {string | Array | null} queryBase
   * @param {boolean} isPrefixedWithTableAlias
   * @param {CSN.Column} current
   * @param {CSN.Path} path
   * @returns {string}
   */
  function getBase( queryBase, isPrefixedWithTableAlias, current, path ) {
    if (typeof queryBase === 'string') // alias
      return queryBase;
    else if (queryBase) // ref
      return queryBase.length > 1 ? queryBase[queryBase.length - 1] : getRealName(csn, queryBase[0]);
    else if (isPrefixedWithTableAlias)
      return current.ref[0];
    return getParent(current, path);
  }

  /**
   * For a given xpr, check in which entity/query source the ref "is".
   *
   * If the ref already starts with an entity/query source, simply return the first ref step.
   * Otherwise, use $env to figure it out:
   * - $env=<string> -> the string is the source
   * - $env=<number> && $scope='mixin' -> the current query is the source
   * - $env=<number> && $scope!=='mixin' -> such refs start with entity/query source, are already handled
   * - $env=true -> does not apply for "EXISTS" handling, only happens in ORDER BY or explicit on-cond redirection
   *
   * If we have a ref but no $env, throw to trigger recompile - but such cases should have already led to a recompile with
   * the validator/enricher.
   *
   * Since we only call this function when it is not just a simple SELECT FROM X,
   * we can be sure that resolving the ref requires $env information.
   *
   * @param {object} xpr
   * @param {CSN.Path} path
   * @returns {string|undefined} undefined in case of errors
   * @throws {Error} Throws if xpr.ref but no xpr.$env
   * @todo $env is going to be removed from CSN, but csnRefs will provide it
   */
  // eslint-disable-next-line consistent-return
  function getParent( xpr, path ) {
    if (firstLinkIsEntityOrQuerySource(xpr, path)) {
      return xpr.ref[0];
    }
    else if (xpr.$env) {
      if (typeof xpr.$env === 'string') {
        return xpr.$env;
      }
      else if (typeof xpr.$env === 'number') {
        if (xpr.$scope === 'mixin')
          return '';
        return error(null, xpr.$path, '$env with number is not handled yet - report this error!');
      }

      return error(null, xpr.$path, 'Boolean $env is not handled yet - report this error!');
    }
    else if (xpr.ref) {
      throw new ModelError('Missing $env and missing leading artifact ref - throwing to trigger recompilation!');
    }
  }

  /**
   * Check (using inspectRef -> links), whether the first path step is an entity or query source
   *
   * @param {object} obj
   * @param {CSN.Path} objPath
   * @returns {boolean}
   */
  function firstLinkIsEntityOrQuerySource( obj, objPath ) {
    const { links } = getLinksAndArt(obj, objPath);
    return links && (links[0].art.kind === 'entity' || links[0].art.query || links[0].art.from);
  }

  /**
   * From the given expression (having inspectRef -> links), find the first association.
   *
   * @param {object} xprPart
   * @param {CSN.Path} path
   * @returns {{head: Array, root: CSN.Element, ref: string|object, tail: Array}} The first assoc (root), the corresponding ref (ref), anything before the ref (head) and the rest of the ref (tail).
   */
  function getFirstAssoc( xprPart, path ) {
    const { links, art } = getLinksAndArt({}, path);
    for (let i = 0; i < xprPart.ref.length - 1; i++) {
      if (links[i].art?.target) {
        return {
          head: (i === 0 ? [] : xprPart.ref.slice(0, i)),
          root: links[i].art,
          ref: xprPart.ref[i],
          tail: xprPart.ref.slice(i + 1),
        };
      }
    }
    const { ref } = xprPart;
    return {
      head: (ref.length === 1 ? [] : ref.slice(0, ref.length - 1)),
      root: art,
      ref: ref.at(-1),
      tail: [],
    };
  }

  /**
   * Translate an `EXISTS <managed assoc>` into a part of a WHERE condition.
   *
   * For each of the foreign keys, do:
   * + build the target side by prefixing `target` in front of the ref
   * + build the source side by prefixing `base` (if not already part of `current`)
   *  and the assoc name itself (current) in front of the ref
   * + Compare source and target with `=`
   *
   * If there is more than one foreign key, join with `and`.
   *
   * The new tokens are immediately added to the WHERE of the subselect
   *
   * @param {CSN.Element} root
   * @param {string} target
   * @param {boolean} isPrefixedWithTableAlias
   * @param {string} base
   * @param {Token} current
   * @returns {object[]} The stuff to add to the where
   */
  function translateManagedAssocToWhere( root, target, isPrefixedWithTableAlias, base, current ) {
    if (current.$scope === '$self') {
      error('ref-unexpected-self', current.$path, { '#': 'exists', id: current.ref[0], name: 'exists' });
      return [];
    }

    const whereExtension = [];
    for (let j = 0; j < root.keys.length; j++) {
      const lop = { ref: [ target, ...root.keys[j].ref ] }; // target side
      const rop = { ref: (isPrefixedWithTableAlias ? [] : [ base ]).concat([ ...toRawRef(current.ref), ...root.keys[j].ref ]) }; // source side

      if (j > 0)
        whereExtension.push('and');

      whereExtension.push(...[ lop, '=', rop ]);
    }

    return whereExtension;
  }

  /**
   * Translate an `EXISTS <unmanaged assoc>` into a part of a WHERE condition.
   *
   * A valid $self-backlink is handled in translateDollarSelfToWhere.
   *
   * For an ordinary unmanaged association, we do the following for each part of the on-condition:
   * - target side: We prefix the real target and cut off the assoc-name from the ref
   * - source side w/ leading $self: We remove the $self and add the source side entity/query source
   * - source side w/o leading $self: We simply add the source side entity/query source in front of the ref
   * - all other: Leave intact, usually operators
   *
   * @param {CSN.Element} root
   * @param {string} target
   * @param {boolean} isPrefixedWithTableAlias
   * @param {string} base
   * @param {Token} current
   * @returns {object[]} The stuff to add to the where
   */
  function translateUnmanagedAssocToWhere( root, target, isPrefixedWithTableAlias, base, current ) {
    const whereExtension = [];

    for (let j = 0; j < root.on.length; j++)
      j = processExpressionPart(root.on, root.$path.concat('on'), j, whereExtension);

    return whereExtension;

    /**
     * Process the given expression and apply the steps described above.
     *
     * @param {Array} expression Expression we are processing
     * @param {CSN.Path} path Path to the expression
     * @param {number} expressionIndex Index in the current expression, imporant for paths and stuff
     * @param {Array} collector Array to collect the processed expressionparts into
     * @returns {number} How far along expression we have processed - so the main loop can jump ahead
     */
    function processExpressionPart(expression, path, expressionIndex, collector) {
      const part = expression[expressionIndex];

      if (part?.xpr) {
        const xpr = { xpr: [] };
        for (let i = 0; i < part.xpr.length; i++)
          i = processExpressionPart(part.xpr, path.concat(expressionIndex, 'xpr'), i, xpr.xpr);

        collector.push(xpr);
        return expressionIndex;
      }

      // we can only resolve stuff on refs - skip literals like =
      // but also keep along stuff like null and undefined, so compiler
      // can have a chance to complain/ we can fail later nicely maybe
      if (!(part && part.ref)) {
        collector.push(part);
        return expressionIndex;
      }

      // root.$path should be safe - we can only reference things in exists that exist when we enrich
      // so all of them should have a $path.
      const { art, links } = getLinksAndArt(part, path.concat(expressionIndex));
      // Dollar Self Backlink
      if (isValidDollarSelf(expression[expressionIndex], path.concat(expressionIndex), expression[expressionIndex + 1], expression[expressionIndex + 2], path.concat(expressionIndex + 2 ))) {
        if (expression[expressionIndex].ref[0] === '$self' && expression[expressionIndex].ref.length === 1)
          collector.push(...translateDollarSelfToWhere(base, target, expression[expressionIndex + 2], path.concat(expressionIndex + 2 )));
        else
          collector.push(...translateDollarSelfToWhere(base, target, expression[expressionIndex], path.concat(expressionIndex)));

        return expressionIndex + 2;
      }
      else if (links && links[0].art === root) { // target side
        collector.push({ ref: [ target, ...part.ref.slice(1) ] });
      }
      else if (part.$scope === '$self') { // source side - "absolute" scope
        const column = part._art._column;
        if (column && column.as) { // Replace with the "original" expression (the .ref, .xpr etc.)
          collector.push(translateToSourceSide(column));
        }
        else {
          collector.push(assignAndDeleteAsAndKey({}, part, { ref: [ base, ...part.ref.slice(1) ] }));
        }
      }
      else if (art) { // source side - with local scope
        if (isPrefixedWithTableAlias || part.$scope === 'alias')
          collector.push({ ref: [ ...current.ref.slice(0, -1), ...part.ref ] });
        else
          collector.push({ ref: [ base, ...current.ref.slice(0, -1), ...part.ref ] });
      }
      else { // operator - or any other leftover
        collector.push(part);
      }

      return expressionIndex;
    }


    /**
     * Run Object.assign on all of the passed in parameters and delete a .as and .key at the end
     *
     * @param {...any} args
     * @returns {object} The merged args without an .as and .key property
     */
    function assignAndDeleteAsAndKey( ...args ) {
      const obj = Object.assign.apply(null, args);
      delete obj.as;
      delete obj.key;
      return obj;
    }
    /**
     * Translate the given obj (a column-like thing) into an expression that we can use in the WHERE.
     * - Strip off $self/$projection and correctly replace with source expression
     * - Drill further down into .xpr
     * - Correctly set table alias in front of ref
     *
     * @param {object} obj
     * @returns {object}
     */
    function translateToSourceSide( obj ) {
      if (obj.ref) {
        if (obj.$scope === '$self') { // TODO: Check with this way down, do we keep the links?
          const column = obj._art._column;
          if (column && column.as)
            return translateToSourceSide(column);
          return assignAndDeleteAsAndKey({}, obj, { ref: [ base, ...obj.ref.slice(1) ] });
        }
        else if (typeof obj.$env === 'string') {
          return assignAndDeleteAsAndKey({}, obj, { ref: [ obj.$env, ...obj.ref ] });
        }

        return assignAndDeleteAsAndKey({}, obj, { ref: [ ...obj.ref ] });
      }
      else if (obj.xpr) { // we need to drill further down into .xpr
        return assignAndDeleteAsAndKey({}, obj, { xpr: obj.xpr.map(translateToSourceSide) });
      }
      else if (obj.args) {
        return assignAndDeleteAsAndKey({}, obj, { args: obj.args.map(translateToSourceSide) });
      }

      return obj;
    }

    /**
     * Check that an expression triple is a valid $self
     *
     * @param {Token} leftSide
     * @param {CSN.Path} pathLeft
     * @param {Token} middle
     * @param {Token} rightSide
     * @param {CSN.Path} pathRight
     * @returns {boolean}
     */
    function isValidDollarSelf( leftSide, pathLeft, middle, rightSide, pathRight ) {
      if (leftSide && leftSide.ref && rightSide && rightSide.ref && middle === '=') {
        const right = inspectRef(pathRight);
        const left = inspectRef(pathLeft);

        if (!right || !left)
          return false;

        const rightSideArt = right.art;
        const leftSideArt = left.art;

        return leftSide.ref[0] === '$self' && leftSide.ref.length === 1 && rightSideArt && rightSideArt.target ||
               rightSide.ref[0] === '$self' && rightSide.ref.length === 1 && leftSideArt && leftSideArt.target;
      }

      return false;
    }
  }

  /**
   * Turn the would-be on-condition of a $self backlink into a WHERE condition.
   *
   * Prefix the target/source side base accordingly and build the source = target comparisons.
   *
   * @param {string} base The source entity/query source name
   * @param {string} target The target entity/query source name
   * @param {object} assoc The association element - the "not-$self" side of the comparison
   * @param {CSN.Path} path
   * @returns {TokenStream} The WHERE representing the $self comparison
   */
  function translateDollarSelfToWhere( base, target, assoc, path ) {
    const where = [];
    const { art } = getLinksAndArt(assoc, path);
    if (art.keys) {
      for (let i = 0; i < art.keys.length; i++) {
        const lop = { ref: [ target, ...assoc.ref.slice(1), ...art.keys[i].ref ] }; // target side
        const rop = { ref: [ base, ...art.keys[i].ref ] }; // source side
        if (i > 0)
          where.push('and');

        where.push(...[ lop, '=', rop ]);
      }
    }
    else if (art.on) {
      for (let i = 0; i < art.on.length; i++) {
        const part = art.on[i];
        const partInspect = getLinksAndArt(part, art.$path.concat([ 'on', i ]));
        if (partInspect.links && partInspect.links[0].art === art) { // target side
          where.push({ ref: [ base, ...part.ref.slice(1) ] });
        }
        else if (part.$scope === '$self') { // source side - "absolute" scope
          // Same message as in forRelationalDB/transformDollarSelfComparisonWithUnmanagedAssoc
          error(null, part.$path, { name: '$self' },
                'An association that uses $(NAME) in its ON-condition can\'t be compared to "$self"');
        }
        else if (partInspect.art) { // source side - with local scope
          where.push({ ref: [ target, ...assoc.ref.slice(1, -1), ...part.ref ] });
        }
        else { // operator - or any other leftover
          where.push(part);
        }
      }
    }
    return where;
  }

  /**
   * Turn a ref-array into an array of strings.
   *
   * @param {Array} ref Array of strings or objects with `id`
   * @returns {string[]}
   */
  function toRawRef( ref ) {
    return ref.map(r => (r.id ? r.id : r));
  }

  /**
   * Get the source aliases from a query - drill down somewhat into joins (is that correct?)
   *
   * @param {CSN.Query} query
   * @returns {object}
   */
  function getQuerySources( query ) {
    const sources = Object.create(null);
    if (query.from.as)
      sources[query.from.as] = query.from.as;
    else if (query.from.args)
      return Object.assign(sources, getJoinSources(query.from.args));
    else if (query.from.ref)
      sources[query.from.ref[query.from.ref.length - 1]] = query.from.ref[query.from.ref.length - 1];

    return sources;
  }

  /**
   * Get the source aliases from a join
   *
   * @param {Array} args Join args
   * @returns {object}
   */
  function getJoinSources( args ) {
    let sources = Object.create(null);
    for (const join of args) {
      if (join.as) {
        sources[join.as] = join.as;
      }
      else if (join.args) {
        const subSources = getJoinSources(join.args);
        sources = Object.assign(sources, subSources);
      }
      else if (join.ref) {
        sources[join.ref[join.ref.length - 1]] = join.ref[join.ref.length - 1];
      }
    }

    return sources;
  }

  /**
   * Use cacjed _links and _art or calculate via inspectRef
   * @param {object} obj
   * @param {CSN.Path} objPath
   * @returns {object}
   */
  function getLinksAndArt(obj, objPath) {
    if (obj._links)
      return { links: obj._links, art: obj._art };
    return inspectRef(objPath);
  }
}


module.exports = { getHelpers };

/**
 * @typedef {Token[]} TokenStream Array of tokens.
 */

/**
 * @typedef {string|object} Token Could be an object or a string - strings are usually operators.
 */
