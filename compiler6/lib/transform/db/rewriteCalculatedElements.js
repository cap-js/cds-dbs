'use strict';

const { setProp } = require('../../base/model');
const { CompilerAssertion } = require('../../base/error');
const {
  forEachDefinition,
  applyTransformationsOnNonDictionary,
  applyTransformationsOnDictionary,
  implicitAs,
} = require('../../model/csnUtils');
const { getBranches } = require('./flattening');
const { getColumnMap } = require('./views');
const { cloneCsnNonDict } = require('../../model/cloneCsn');

const cloneCsnOptions = { hiddenPropertiesToClone: [ '_art', '_links', '$env', '$scope' ] };


/**
 * Rewrite usage of calculated Elements into the expression itself.
 * Delete calculated elements in entities after processing so they don't materialize on the db.
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {object} csnUtils
 * @param {string} pathDelimiter
 * @param {object} messageFunctions
 */
function rewriteCalculatedElementsInViews( csn, options, csnUtils, pathDelimiter, messageFunctions ) {
  const { inspectRef, effectiveType } = csnUtils;
  const { error } = messageFunctions;

  const views = [];
  const entities = [];

  // In this first pass, we rewrite all the .value things in tables into their most basic form
  forEachDefinition(csn, (artifact, artifactName) => {
    if (artifact.kind === 'entity') {
      if (artifact.query || artifact.projection) {
        views.push({ artifact, artifactName });
      }
      else if (artifact.elements) { // can happen with CSN input
        rewriteInEntity(artifact);
        entities.push({ artifact, artifactName });
      }
    }
  });

  // Replace calculated elements in filters, functions and other places (if the root-association element is in an entity).
  // Depends on the first pass!
  entities.forEach(({ artifactName }) => {
    applyTransformationsOnNonDictionary(csn.definitions, artifactName, {
      ref: (_parent, _prop, ref, _path, root, index) => {
        if (_parent._art?.value && !_parent._art.value.stored) {
          if (_parent._art.value.ref) {
            // Ensure that we don't break any navigation by only replacing the real element at the end
            const leafLength = getLeafLength(_parent._links);
            root[index].ref = [ ...root[index].ref.slice(0, -1 * leafLength), ..._parent._art.value.ref ];
            setProp(root[index], '_links', [ ...root[index]._links.slice(0, leafLength), ..._parent._art.value._links ]);
            setProp(root[index], '_art', _parent._art);
          }
          else {
            root[index] = _parent._art.value;
          }
          // Note: Depends on A2J rejecting deeply nested filters
          applyTransformationsOnNonDictionary(root, index, {
            ref: (__parent, _, _ref) => {
              if (_ref[0] === '$self' || _ref[0] === '$projection')
                __parent.ref = _ref.slice(-1);
            },
          });
        }
      },
    }, {
      drillRef: true,
      // skip "type" to avoid going into type.ref
      skipStandard: { type: 1 },
    }, [ 'definitions' ]);
  });


  // In this third pass, we process our views, generate .columns if needed and replace usage
  // of calculated elements with their respective `.value`.
  // This depends on the first pass!
  views.forEach(({ artifact, artifactName }) => {
    applyTransformationsOnNonDictionary(csn.definitions, artifactName, {
      SELECT: (parent, prop, SELECT, path) => {
        rewriteInView(SELECT, SELECT.elements || artifact.elements, path);
      },
      projection: (parent, prop, projection, path) => {
        parent.SELECT = projection; // Fake as SELECT so our path below will match in the applyTransformations...
        rewriteInView(parent.SELECT, artifact.elements, path);
        delete parent.SELECT;
      },
    }, {}, [ 'definitions' ]);
  });

  // Last pass, turn .value in tables into a simple 'val' so we don't need to rewrite/flatten properly - will kill them later
  entities.forEach(({ artifact, artifactName }) => {
    dummifyInEntity(artifact, [ 'definitions', artifactName ]);
  });

  /**
   * Get the length of the effective leaf - since structures are not flat yet it might be more than 1.
   * Walk from the back until we find the first association/composition.
   *
   * @param {object[]} links
   * @returns {number}
   */
  function getLeafLength( links ) {
    for (let i = links.length - 1; i >= 0; i--) {
      const { art } = links[i];
      if (art.target)
        return links.length - i - 1;
    }
    return links.length;
  }

  /**
   * Rewrite calculated-elements-columns in views/projections and replace them
   * with their "root"-expression.
   *
   * As a first step, we ensure that all views/projections have a .columns (see {@link calculateColumns}) and that
   * all calculated elements are addressed explicitly and not via a * (see {@link makeAllCalculatedElementsExplicitColumns}).
   *
   * Then, we check the `art` of each ref for a `.value` and rewrite accordingly.
   * We need to ensure that the scope of the rewritten expressions is still correct!
   * An `id` in the `.value` needs to point to the entity containing the element,
   * not to some random view element named `id`. See {@link absolutifyPaths} for
   * details on that.
   *
   * @param {CSN.QuerySelect} SELECT
   * @param {CSN.Elements} elements
   * @param {CSN.Path} path
   */
  function rewriteInView( SELECT, elements, path ) {
    const containsExpandInline = hasExpandInline(SELECT);
    let cleanupCallbacks;
    if (!SELECT.columns) // needs to happen for all subqueries!
      cleanupCallbacks = calculateColumns(elements, SELECT);
    else
      cleanupCallbacks = makeAllCalculatedElementsExplicitColumns(elements, SELECT, containsExpandInline);

    const name = SELECT.from.args ? undefined : SELECT.from.as || (SELECT.from.ref && implicitAs(SELECT.from.ref));

    if (!containsExpandInline) {
      applyTransformationsOnNonDictionary({ SELECT }, 'SELECT', {
        ref: (parent, prop, ref, p, root) => {
          const {
            art, env, links, scope,
          } = getRefInfo(parent, p);

          // calc element publishes association, treat as regular
          // unmanaged association
          const calcElementIsAssoc = art?.value && art.target;
          // TODO: Calculated elements on-write
          if (art?.value && !art.value.stored && !calcElementIsAssoc) {
            const alias = parent.as || implicitAs(parent.ref);
            // TODO: What about other scopes? expand/inline?
            const value = (scope !== 'ref-target') ? absolutifyPaths(env, art, ref, links, name).value : keepAssocStepsInRef(ref, links, art).value;

            // Is a shallow copy enough?
            if (art.value.cast)
              root[p[p.length - 1]] = { xpr: [ value ] };
            else
              root[p[p.length - 1]] = { ...value };

            if (p[p.length - 2] === 'columns')
              root[p[p.length - 1]].as = alias;
            else
              delete root[p[p.length - 1]].as;

            // If the calculated element has a type, use it. But only if the column did not have an explicit type.
            // Note: We should not check `art.type`, because we only need the type for columns, not filters.
            if (parent.cast)
              root[p[p.length - 1]].cast = parent.cast;
            else if (parent._element?.type)
              root[p[p.length - 1]].cast = { type: parent._element.type };

            // TODO: Copy annotations? May become relevant in the future
          }
        },
      }, {}, path);
    }

    cleanupCallbacks.forEach(fn => fn());
  }

  /**
   *
   * @param {CSN.QuerySelect} SELECT
   * @returns {boolean}
   */
  function hasExpandInline( SELECT ) {
    if (!SELECT.columns)
      return false;

    for (const column of SELECT.columns) {
      if (column.expand || column.inline)
        return true;
    }

    return false;
  }

  /**
   * Replace all nested .value things (in .xpr, in .ref) with their most-direct thing:
   * - A ref to a non-calculated element
   * - A .val
   * - An expression containing the above
   *
   * @param {CSN.Artifact} artifact The artifact currently being processed
   */
  function rewriteInEntity( artifact ) {
    let reorderElements = false;
    applyTransformationsOnDictionary(artifact.elements, {
      value: (parent, prop, value) => {
        if (value.stored)
          reorderElements = true;
        replaceValuesWithBaseValue(parent);
      },
    });
    // on-write must appear at the end of the elements. Order of the on-write between themselves
    // should be as written.
    if (reorderElements) {
      const newElements = Object.create(null);
      const onWrite = [];
      for (const name in artifact.elements) {
        const element = artifact.elements[name];
        if (element.value?.stored)
          onWrite.push(name);
        else
          newElements[name] = element;
      }
      // Add the on-write to the end
      onWrite.forEach((name) => {
        newElements[name] = artifact.elements[name];
      });

      artifact.elements = newElements;
    }
  }

  /**
   * Iteratively replace all .values with the most-basic form:
   * - a .val thing
   * - a .ref to a non-value thing
   *
   * @param {object} parent
   */
  function replaceValuesWithBaseValue( parent ) {
    if (parent.value.val !== undefined)
      return; // literal; no need to traverse

    const stack = [ { parent, value: parent.value } ];
    while (stack.length > 0) {
      const current = stack.pop();

      if (current.value.xpr) {
        applyTransformationsOnNonDictionary(current.value, 'xpr', {
          ref: (p, prop, ref, path, root ) => {
            stack.push({
              parent: root,
              value: p,
              isInXpr: true,
              refBase: current.refBase,
              linksBase: current.linksBase,
            });
          },
        }, { skipStandard: { where: true } });
      }
      else if (current.value.ref && current.value._art?.value && !current.value._art?.value.stored) {
        const linksBase = current.value._links;
        const refBase = current.value.ref;
        const newValue = replaceInRef(current.value, current.value._art.value, current.isInXpr, refBase, linksBase);
        const prop = Array.isArray(current.parent) ? current.parent.indexOf(current.value) : 'value';
        if (prop === -1)
          throw new CompilerAssertion('Calculated Elements: Value not in parent; should never happen!');
        current.parent[prop] = newValue;
        stack.push(Object.assign(current, { value: newValue, refBase, linksBase }));
      }
      else if (current.value.val) {
        if (current.isInXpr) { // inside of expressions we directly need the val
          current.parent.val = current.value.val;
          delete current.parent.value; // TODO: current.parent could be an array!
        }
        else { // outside of expressions, i.e. as normal elements, we need it in a .value wrapper
          current.parent.value = current.value;
        }
      }
    }
  }

  /**
   * A value referenced via a ref is replaced here
   * - kill the ref
   * - explicitly mention the value
   *
   * We either "trick" it into the correct place in an .xpr or we simply overwrite the existing .ref
   *
   * @param {object} oldValue
   * @param {object} newValue
   * @param {boolean} isInXpr
   * @param {Array} refBase
   * @param {Array} linksBase
   * @returns {object|Array}
   */
  function replaceInRef( oldValue, newValue, isInXpr, refBase, linksBase ) {
    const clone = { value: cloneCsnNonDict(newValue, cloneCsnOptions) };
    if (oldValue.stored)
      clone.value.stored = oldValue.stored;

    const refPrefix = refBase.slice(0, -1);
    const linksPrefix = linksBase.slice(0, -1);

    // We need to adapt the scope of all refs in the new .xpr, as it might have been at a different "root"
    applyTransformationsOnNonDictionary(clone, 'value', {
      ref: (p, prop, ref) => {
        if (ref[0] !== '$self' && ref[0] !== '$projection') {
          p.ref = [ ...refPrefix, ...ref ];
          if (p._links)
            p._links = [ ...linksPrefix, ...p._links ]; // TODO: Make non-enum, increment idx
        }
      },
    }, {
      // Do not rewrite refs inside an association-where; avoids endless loop
      skipStandard: { where: true },
    });
    return clone.value;
  }

  /**
   * For a `view V as select from E;` or a `entity P as projection on E;` calculate and
   * attach the .columns if they contain a calculated element so we can rewrite them in
   * the later steps.
   *
   * @param {CSN.Elements} elements Artifact elements
   * @param {object} carrier The thing that will "carry" the columns - .SELECT or .projection
   * @returns {Function[]} Cleanup callbacks that remove `_`-links.
   */
  function calculateColumns( elements, carrier ) {
    carrier.columns = [ '*' ];
    const cleanupCallbacks = makeAllCalculatedElementsExplicitColumns(elements, carrier, false);
    if (carrier.columns.length === 1 && carrier.columns[0] === '*')
      delete carrier.columns;
    return cleanupCallbacks;
  }

  /**
   *
   * @param {CSN.QuerySelect} SELECT
   * @returns {object}
   */
  function getDirectlyAddressableElements( SELECT ) {
    const { from } = SELECT;
    if (from.ref) {
      return from._art.elements;
    }
    else if (from.SELECT) {
      return from.SELECT.elements;
    }
    else if (from.SET) {
      // args[0] could be SELECT or UNION
      return getDirectlyAddressableElements({ from: from.SET.args[0] });
    }
    else if (from.args) {
      const mergedElements = Object.create(null);
      for (const arg of from.args) {
        if (arg.ref) {
          for (const elementName in arg._art.elements)
            mergedElements[elementName] = arg._art.elements[elementName];
        }
        else if (arg.SET) {
          return getDirectlyAddressableElements({ from: arg.SET.args[0] });
        }
        else if (arg.SELECT) { // TODO: UNION
          for (const elementName in arg.SELECT.elements)
            mergedElements[elementName] = arg.SELECT.elements[elementName];
        }
        else if (arg.args) { // TODO: Is it safe to do recursion here?
          for (const subarg of arg.args) {
            const elements = getDirectlyAddressableElements({ from: subarg });
            for (const elementName in elements)
              mergedElements[elementName] = elements[elementName];
          }
        }
        else {
          throw new CompilerAssertion(`Unhandled arg type: ${ JSON.stringify(arg, null, 2) }`);
        }
      }
      return mergedElements;
    }
    throw new CompilerAssertion(`Unhandled query type:  ${ JSON.stringify(SELECT, null, 2) }`);
  }

  /**
   * Ensure that all elements of the query that are calculated elements have an explicit column that we can rewrite.
   * If a field originally comes in via the *, then we need to add an explicit column for it.
   *
   * @param {CSN.Elements} elements
   * @param {CSN.QuerySelect} SELECT
   * @param {boolean} containsExpandInline
   * @returns {Function[]} Cleanup callbacks that remove `_`-links.
   */
  function makeAllCalculatedElementsExplicitColumns( elements, SELECT, containsExpandInline ) {
    const cleanupCallbacks = [];
    const root = getDirectlyAddressableElements(SELECT);
    const columnMap = getColumnMap( { SELECT }, csnUtils );
    const hasStar = SELECT.columns.includes('*');
    const unfoldingMap = {};
    let starContainsCalculated = false;
    let containsCalcOnRead = false;
    for (const name in elements) {
      const originalRef = columnMap[name] && columnMap[name].ref || [ name ];

      if (columnMap[name] || hasStar) {
        let element;
        if (columnMap[name]?.expand || columnMap[name]?.inline)
          element = elements[name]; // only the direct thing in .elements has the .excluding respected properly!
        else
          element = columnMap[name]?._art || columnMap[name]?._element || root[name] || elements[name];
        const branches = getBranches(element, name, effectiveType, pathDelimiter); // TODO: is our elements[name] really the root[name]?
        if (hasCalcOnReadLeaf(branches)) {
          containsCalcOnRead = true;
          const columns = [];
          for (const branchName in branches) {
            const branch = branches[branchName];
            const leafElement = branch.steps[branch.steps.length - 1];
            if (columnMap[branchName]) { // Existing column - don't overwrite, we need $env!
              columns.push(columnMap[branchName]);
            }
            else {
              // TODO: Hm, will we have a $env in the leaf of the thing then?
              const column = { ref: [ ...originalRef, ...branches[branchName].ref.slice(1) ], as: branchName };
              setProp(column, '_element', leafElement);
              cleanupCallbacks.push(() => delete column._element);
              columns.push(column);
            }
          }
          if (columnMap[name]) {
            unfoldingMap[name] = [ false, [ ...columns ] ];
          }
          else if (hasStar) { // Via * - just append
            starContainsCalculated = true;
            unfoldingMap[name] = [ true, [ ...columns ] ];
          }
        }
        else {
          if (usesCalcOnRead(branches))
            containsCalcOnRead = true;
          if (!columnMap[name] && hasStar) { // Via * - just append
            unfoldingMap[name] = [ true, [ { ref: [ name ] } ] ];
          }
          else { // just a random column - keep
            unfoldingMap[name] = [ false, [ columnMap[name] ] ];
          }
        }
      }
    }

    if (containsExpandInline && containsCalcOnRead) {
      error('query-unsupported-calc', SELECT.$path, { '#': 'std' });
    }
    else if (containsCalcOnRead) {
      const newColumns = [];
      if (hasStar && !starContainsCalculated)
        newColumns.push('*');
      for (const name in elements) {
        const [ isViaStar, columns ] = unfoldingMap[name];
        if (isViaStar && starContainsCalculated || !isViaStar)
          newColumns.push(...columns);
      }

      SELECT.columns = newColumns;
    }
    return cleanupCallbacks;
  }

  /**
   * Returns true if any leaf node is a calculated element on-read.
   * On-write behaves like regular elements, hence they do not count here.
   *
   * @param {object} branches
   * @returns {boolean}
   */
  function hasCalcOnReadLeaf( branches ) {
    for (const branchName in branches) {
      const branch = branches[branchName].steps;
      const leaf = branch[branch.length - 1];
      if (hasOnReadValue(leaf))
        return true;
    }

    return false;
  }

  /**
   * Returns true if the branch/column uses a calc-on-read,
   * for example in a filter.
   *
   * TODO: Enable calculated elements next to nested projections
   *
   * @param {object} branches
   * @returns {boolean}
   */
  function usesCalcOnRead( branches ) {
    let returnValue = false;
    for (const branchName in branches) {
      const column = branches[branchName]?.steps[0]?._column;
      if (column) {
        applyTransformationsOnNonDictionary({ column }, 'column', {
          // eslint-disable-next-line no-loop-func
          ref: (parent) => {
            if (hasOnReadValue(parent))
              returnValue = true;
          },
        }, {
          drillRef: true,
          // skip subqueries and nested projections
          // calculated elements and nested projections
          // only conflict on same level
          skipStandard: [ 'SELECT', 'expand', 'inline' ],
        });
      }
    }

    return returnValue;
  }

  /**
   * A leaf can reference a column which in turn references a real element - that might have a .value.
   * Find such cases.
   *
   * @param {object} baseLeaf Leaf to start at
   * @returns {boolean}
   */
  function hasOnReadValue( baseLeaf ) {
    const visited = new WeakSet();
    const stack = [ baseLeaf ];
    while (stack.length > 0) {
      const leaf = stack.pop();
      if (!visited.has(leaf)) { // Don't re-process things
        if (leaf.value && !leaf.value.stored)
          return true;
        else if (leaf._art)
          stack.push(leaf._art);
        else if (leaf['@Core.Computed'] && leaf._column && leaf._column !== baseLeaf)
          stack.push(leaf._column);
      }

      visited.add(leaf);
    }

    return false;
  }

  /**
   * We need to keep association steps in front of the paths - else they would lead into nothing
   *
   * @param {Array} artRef
   * @param {Array} links
   * @param {object} art
   * @returns {object}
   */
  function keepAssocStepsInRef( artRef, links, art ) {
    let lastAssocIndex = -1;
    for (let i = links.length - 1; i > -1; i--) {
      if (links[i].art.target) {
        lastAssocIndex = i;
        break;
      }
    }

    if (lastAssocIndex > -1) {
      const clone = { value: cloneCsnNonDict(art.value, cloneCsnOptions) };
      applyTransformationsOnNonDictionary(clone, 'value', {
        ref: (parent, prop, ref) => {
          parent.ref = [ ...artRef.slice(0, lastAssocIndex + 1), ...ref ];
          if (parent._links)
            parent._links = [ ...links.slice(0, lastAssocIndex + 1), ...parent._links ];
        },
      }, {
        skipStandard: { where: true }, // Do not rewrite refs inside of an association-where
      });

      return clone;
    }

    return art;
  }

  /**
   * In order to just replace them in views, our calculated elements need to reference absolute things, i.e. have a table alias in front!
   *
   * @param {string | object} env
   * @param {object} art
   * @param {Array} artRef
   * @param {Array} artLinks
   * @param {string|undefined} name
   * @todo this is probably very wonky and will break with some view hierarchy stuff etc!
   * @returns {object}
   */
  function absolutifyPaths( env, art, artRef, artLinks, name ) {
    const clone = { value: cloneCsnNonDict(art.value, cloneCsnOptions) };
    applyTransformationsOnNonDictionary(clone, 'value', {
      ref: (parent, prop, ref) => {
        const artifactName = typeof env === 'string' ? env : name;
        if (parent._links) {
          if (parent._links[0].art.kind !== 'entity') {
            if (artLinks[0].art.kind === 'entity' || artifactName === undefined) {
              parent.ref = [ ...artRef.slice(0, -1), ...ref ];
              setProp(parent, '_links', [ ...artLinks.slice(0, -1), ...parent._links ]); // TODO: increment idx
            }
            else {
              parent.ref = [ artifactName, ...artRef.slice(0, -1), ...ref ];
              setProp(parent, '_links', [ { idx: 0 }, ...artLinks.slice(0, -1), ...parent._links ]); // TODO: increment idx
            }
          }
          else if (parent.$scope === '$self') {
            if (artifactName !== undefined)
              parent.ref[0] = artifactName;
            else
              parent.ref = parent.ref.slice(-1);
          }
        }
      },
    }, {
      skipStandard: { where: true }, // Do not rewrite refs inside of an association-where
    });

    return clone;
  }

  /**
   * Get the ref-info
   * - either the cached _art etc.
   * - or calculate using inspectRef
   *
   * @param {object} parent
   * @param {CSN.Path} path
   * @returns {object}
   */
  function getRefInfo( parent, path ) {
    if (parent._art) {
      return {
        art: parent._art,
        env: parent.$env,
        links: parent._links,
        scope: parent.$scope,
      };
    }

    return inspectRef(path);
  }
}

/**
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 */
function processCalculatedElementsInEntities( csn, options ) {
  forEachDefinition(csn, (artifact, definitionName) => {
    if (artifact.kind === 'entity' && !(artifact.query || artifact.projection))
      removeDummyValueInEntity(artifact, [ 'definitions', definitionName ], options);
  });
}


/**
 * In an entity, remove all instances of calculated elements.
 *
 * @param {CSN.Artifact} artifact
 * @param {CSN.Path} path
 * @param {CSN.Options} options
 * @todo calculated elements that "live" on the database?
 * @todo error when artifact is empty afterwards? Probably better as a CSN check!
 */
function removeDummyValueInEntity( artifact, path, options ) {
  applyTransformationsOnDictionary(artifact.elements, {
    value: (parent, prop, value, p, elements) => {
      if (!value.stored) {
        if (options.transformation === 'effective' && parent.on)
          delete parent.value;
        else
          delete elements[p.at(-1)];
      }
    },
  }, {}, path.concat( 'elements' ));
}

/**
 * In an entity, turn all instances of calculated elements into an = 1. This way,
 * we don't have to rewrite any scope there and can kill them after A2J, see {@link processCalculatedElementsInEntities}.
 *
 * @param {CSN.Artifact} artifact
 * @param {CSN.Path} path
 */
function dummifyInEntity( artifact, path ) {
  applyTransformationsOnDictionary(artifact.elements, {
    value: (parent, _prop, value) => {
      if (!value.stored)
        parent.value = { val: 'DUMMY' };
    },
  }, {}, path);
}

module.exports = {
  rewriteCalculatedElementsInViews,
  processCalculatedElementsInEntities,
};
