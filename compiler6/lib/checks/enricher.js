// This is very similar to lib/model/enrichCsn - but the goal and the execution differ a bit:
// - enrichCsn is used to enhance ref files for testing.
// - this file is used as a "pre-loading" step of the CSN validations.

'use strict';

const { csnRefs } = require('../model/csnRefs');
const { setProp } = require('../base/model');
const { isAnnotationExpression } = require('../base/builtins');

/**
 * The following properties are attached as non-enumerable where appropriate:
 *
 *- `_type`, `_includes` and `_targets` have as values the
 *  referred artifacts which are returned by function `artifactRef`.
 *- `_links`, `_art` and `$scope` as sibling properties of `ref` have as values
 *  the artifacts/members returned by function `inspectRef`.
 *- `$path` has the csnPath to reach that property.
 *
 * @param {CSN.Model} csn CSN to enrich in-place
 * @param {enrichCsnOptions} [options={}]
 * @returns {{ csn: CSN.Model, cleanup: () => void }} CSN with all ref's pre-resolved
 */
function enrichCsn( csn, options ) {
  const transformers = {
    elements: dictionary,
    definitions: dictionary,
    actions: dictionary,
    params: dictionary,
    enum: dictionary,
    mixin: dictionary,
    ref: pathRef,
    type: simpleRef,
    target,
    includes: simpleRef,
    columns,
    '@': annotation,
  };
  let cleanupCallbacks = [];

  const cleanup = () => {
    cleanupCallbacks.forEach(fn => fn());
    cleanupCallbacks = [];
  };

  const { inspectRef, artifactRef, getElement } = csnRefs( csn );
  const csnPath = [];
  if (csn.definitions)
    dictionary( csn, 'definitions', csn.definitions );
  return { csn, cleanup };

  function standard( parent, prop, node ) {
    if (!node || typeof node !== 'object' || !{}.propertyIsEnumerable.call( parent, prop ))
      return;

    csnPath.push( prop );
    setProp(node, '$path', [ ...csnPath ]);
    cleanupCallbacks.push(() => delete node.$path);

    if (Array.isArray(node)) {
      node.forEach( (n, i) => standard( node, i, n ) );
    }
    else {
      for (const name of Object.getOwnPropertyNames( node )) {
        const trans = transformers[name] || transformers[name.charAt(0)] || standard;
        trans( node, name, node[name] );
      }
    }
    csnPath.pop();
  }

  function dictionary( node, prop, dict ) {
    setProp(node, '$path', [ ...csnPath ]);
    cleanupCallbacks.push(() => delete node.$path);
    csnPath.push( prop );

    for (const name of Object.getOwnPropertyNames( dict ))
      standard( dict, name, dict[name] );

    if (!Object.prototype.propertyIsEnumerable.call( node, prop )) {
      setProp(node, `$${ prop }`, dict);
      cleanupCallbacks.push(() => delete node[`$${ prop }`]);
    }
    csnPath.pop();
  }


  /**
   * Transformer for things that are annotations. When we have a "=" plus an expression of some sorts,
   * we treat it like a "standard" thing.
   *
   * @param {object | Array} _parent the thing that has _prop
   * @param {string|number} _prop the name of the current property or index
   * @param {object} node The value of node[_prop]
   */
  function annotation( _parent, _prop, node ) {
    if (options.enrichAnnotations) {
      if (isAnnotationExpression(node)) {
        standard(_parent, _prop, node);
      }
      else if (node && typeof node === 'object') {
        csnPath.push(_prop);

        if (Array.isArray(node)) {
          node.forEach( (n, i) => annotation( node, i, n ) );
        }
        else {
          for (const name of Object.getOwnPropertyNames( node ))
            annotation( node, name, node[name] );
        }

        csnPath.pop();
      }
    }
  }

  function columns( parent, prop, node ) {
    // Establish the link relationships
    parent[prop].forEach((column) => {
      const element = getElement(column);
      if (element) {
        setProp(column, '_element', element);
        cleanupCallbacks.push(() => delete column._element);
        setProp(element, '_column', column);
        cleanupCallbacks.push(() => delete element._column);
      }
    });
    standard(parent, prop, node);
  }

  function simpleRef( node, prop, ref ) {
    setProp(node, '$path', [ ...csnPath ]);
    cleanupCallbacks.push(() => delete node.$path);

    if (typeof ref === 'string') {
      const art = artifactRef( ref, null );
      if (art || !ref.startsWith( 'cds.')) {
        setProp(node, `_${ prop }`, art);
        cleanupCallbacks.push(() => delete node[`_${ prop }`]);
      }
    }
    else if (Array.isArray( ref )) {
      // e.g. `includes: [ 'E' ]`, which gets a parallel `_includes`.
      setProp(node, `_${ prop }`, ref.map( r => artifactRef( r, null ) ));
      cleanupCallbacks.push(() => delete node[`_${ prop }`]);
    }
    else if (typeof ref === 'object') {
      // e.g. type refs via `{ type: { ref: [ 'E', 'field' ] } }
      standard(node, prop, ref);
      const art = artifactRef( ref, null );
      if (art) {
        setProp(node, `_${ prop }`, art);
        cleanupCallbacks.push(() => delete node[`_${ prop }`]);
      }
    }
  }

  function pathRef( node, prop, path ) {
    const {
      links, art, scope, $env,
    } = inspectRef( csnPath );
    if (links) {
      setProp(node, '_links', links);
      cleanupCallbacks.push(() => delete node._links);
    }
    if (art) {
      setProp(node, '_art', art );
      cleanupCallbacks.push(() => delete node._art);
    }
    if ($env) {
      setProp(node, '$env', $env );
      cleanupCallbacks.push(() => delete node.$env);
    }
    setProp(node, '$scope', scope);
    cleanupCallbacks.push(() => delete node.$scope);
    setProp(node, '$path', [ ...csnPath ]);
    cleanupCallbacks.push(() => delete node.$path);

    csnPath.push( prop );
    path.forEach( ( s, i ) => {
      if (s && typeof s === 'object') {
        csnPath.push( i );
        if (s.args)
          standard( s, 'args', s.args );
        if (s.where)
          standard( s, 'where', s.where );
        csnPath.pop();
      }
    } );
    csnPath.pop();
  }

  /**
   * A target is either an anonymous aspect (with elements, etc.) via gensrc or a reference.
   *
   * @param {object} parent
   * @param {string} prop
   * @param {any} node
   */
  function target( parent, prop, node ) {
    if (node?.elements) // e.g. via gensrc
      standard(parent, prop, node);
    else
      simpleRef(parent, prop, node);
  }
}

module.exports = enrichCsn;

/**
 * @typedef {object} enrichCsnOptions
 * @property {boolean} [enrichAnnotations=false] Wether to process annotations and call custom transformers on them
 */
