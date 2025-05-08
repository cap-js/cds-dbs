'use strict';

/*
 * Module for general (partial) CSN looper functions, respecting dictionaries and allowing
 * to pass custom callbacks for certain properties like "ref".
 *
 * Functions are also published in csnUtils.js for convenience.
 *
 * They should stay here due to the stricter linter rules for the time being.
 *
 * @module lib/transform/db/applyTransformations
 */


const { setProp } = require('../../base/model');
const { isAnnotationExpression } = require('../../base/builtins');


/**
 * @param {object} parent The "parent" of which we transform a property of
 * @param {string} prop The property of parent to start at
 * @param {object} customTransformers Map of prop to transform and function to apply
 * @param {Function[]} [artifactTransformers=[]] Transformations to run on the artifacts, like forEachDefinition
 * @param {applyTransformationsOptions} [_options={}]
 * @param {CSN.Path} path Path to parent
 * @returns {object} parent with transformations applied
 */
function applyTransformationsInternal( parent, prop, customTransformers, artifactTransformers, _options, path = [] ) {
  const options = { ..._options };
  if (!options.skipStandard)
    options.skipStandard = { $tableConstraints: true };
  else if (options.skipStandard.$tableConstraints === undefined)
    options.skipStandard = { ...options.skipStandard, ...{ $tableConstraints: true } };

  const transformers = {
    elements: dictionary,
    definitions: dictionary,
    actions: dictionary,
    params: dictionary,
    enum: dictionary,
    mixin: dictionary,
    ref: pathRef,
    $origin: () => {}, // no-op
    '@': annotation,
  };

  const csnPath = [ ...path ];
  const context = {};
  if (prop === 'definitions') {
    definitions( parent, 'definitions', parent.definitions );
  }
  else if (options.directDict) {
    for (const name of Object.getOwnPropertyNames( parent ))
      dictEntry( parent, name, parent[name] );
  }
  else {
    standard( parent, prop, parent[prop] );
  }
  return parent;

  /**
   * Default transformer for things that are not dictionaries or dictionary entries,
   * such as "type" or "keys".
   * The customTransformers are applied here (and only here).
   *
   * @param {object | Array} _parent the thing that has _prop
   * @param {string|number} _prop the name of the current property or index
   * @param {object} node The value of node[_prop]
   */
  function standard( _parent, _prop, node ) {
    if (!node || typeof node !== 'object' ||
        !{}.propertyIsEnumerable.call( _parent, _prop ) ||
        (options.skipIgnore && node.$ignore) ||
        options.skipStandard?.[_prop]
    )
      return;

    csnPath.push( _prop );

    if (Array.isArray(node)) {
      node.forEach( (n, i) => standard( node, i, n ) );
    }

    else {
      for (const name of Object.getOwnPropertyNames( node )) {
        const trans = transformers[name] || transformers[name.charAt(0)] || standard;
        if (customTransformers[name])
          customTransformers[name](node, name, node[name], csnPath, _parent, _prop, context);
        else if (options.processAnnotations && customTransformers['@'] && name.charAt(0) === '@')
          customTransformers['@'](node, name, node[name], csnPath, _parent, _prop, context);
        trans( node, name, node[name], csnPath );
      }
    }
    csnPath.pop();
  }

  /**
   * Transformer for dictionary entries.  Similar to standard(), but does not filter
   * based on the given name.  Otherwise, `options.skipStandards` could accidentally skip
   * dictionary entries (e.g. entity called `@Name`).
   *
   * @param {object | Array} dict the thing that has _prop
   * @param {string|number} entryName the name of the current property
   * @param {object} node The value of node[_prop]
   */
  function dictEntry( dict, entryName, node ) {
    if (!node || typeof node !== 'object' || (options.skipIgnore && node.$ignore))
      return;

    csnPath.push( entryName );
    for (const name of Object.getOwnPropertyNames( node )) {
      const trans = transformers[name] || transformers[name.charAt(0)] || standard;
      if (customTransformers[name])
        customTransformers[name](node, name, node[name], csnPath, dict, null, context);
      else if (options.processAnnotations && customTransformers['@'] && name.charAt(0) === '@')
        customTransformers['@'](node, name, node[name], csnPath, dict, null, context);
      trans( node, name, node[name], csnPath );
    }
    csnPath.pop();
  }

  /**
   * Transformer for things that are dictionaries - like "elements".
   *
   * @param {object | Array} node the thing that has _prop
   * @param {string|number} _prop the name of the current property
   * @param {object} dict The value of node[_prop]
   */
  function dictionary( node, _prop, dict ) {
    // Allow skipping dictionaries like actions in forRelationalDB
    if (options.skipDict?.[_prop] || dict == null) // with universal CSN, dictionaries might be null
      return;
    csnPath.push( _prop );
    context[`$in_${ _prop }`] = true;
    for (const name of Object.getOwnPropertyNames( dict ))
      dictEntry( dict, name, dict[name] );

    if (!Object.prototype.propertyIsEnumerable.call( node, _prop ))
      setProp(node, `$${ _prop }`, dict);
    csnPath.pop();
    context[`$in_${ _prop }`] = undefined;
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
    if (options.processAnnotations) {
      context.$annotation = { name: _prop, value: node };
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
      context.$annotation = undefined;
    }
  }

  /**
   * Special version of "dictionary" to apply artifactTransformers.
   *
   * @param {object | Array} node the thing that has _prop
   * @param {string|number} _prop the name of the current property
   * @param {object} dict The value of node[_prop]
   */
  function definitions( node, _prop, dict ) {
    csnPath.push( _prop );
    for (const name of Object.getOwnPropertyNames( dict )) {
      if (!isArtifactSkipped( dict, name )) {
        artifactTransformers.forEach(fn => fn(dict, name, dict[name], [ 'definitions' ]));
        dictEntry( dict, name, dict[name] );
      }
    }
    if (!Object.prototype.propertyIsEnumerable.call( node, _prop ))
      setProp(node, `$${ _prop }`, dict);
    csnPath.pop();
  }

  /**
   * Whether the given artifact `dict[name]` is skipped via options.
   *
   * @param {object} dict
   * @param {string} name
   * @returns {boolean}
   */
  function isArtifactSkipped( dict, name ) {
    return options && ((options.allowArtifact && !options.allowArtifact(dict[name], name)) ||
        (options.skipArtifact && options.skipArtifact(dict[name], name)) ||
        (options.skip?.includes(dict[name].kind))) ||
      false;
  }

  /**
   * Keep looping through the pathRef - because in a .ref we can have .args and .where
   *
   * @param {object | Array} node the thing that has _prop
   * @param {string|number} _prop the name of the current property
   * @param {any} _path The value of node[_prop]
   */
  function pathRef( node, _prop, _path ) {
    csnPath.push( _prop );
    _path.forEach( ( s, i ) => {
      if (s && typeof s === 'object') {
        if (options.drillRef) {
          standard(_path, i, s);
        }
        else {
          csnPath.push( i );
          if (s.args)
            standard( s, 'args', s.args );
          if (s.where)
            standard( s, 'where', s.where );
          csnPath.pop();
        }
      }
    } );
    csnPath.pop();
  }
}

/**
 * Loop through the model, applying the custom transformations on the node's matching.
 *
 * Each transformer gets:
 * - the parent having the property
 * - the name of the property
 * - the value of the property
 * - the path to the property
 *
 * @param {object} csn CSN to enrich in-place
 * @param {object} customTransformers Map of _prop to transform and function to apply
 * @param {Function[]} [artifactTransformers=[]] Transformations to run on the artifacts, like forEachDefinition
 * @param {applyTransformationsOptions} [options={}]
 * @returns {object} CSN with transformations applied
 */
function applyTransformations( csn, customTransformers = {}, artifactTransformers = [], options = { } ) {
  if (options.skipIgnore === undefined)
    options.skipIgnore = true;

  if (csn?.definitions)
    return applyTransformationsInternal(csn, 'definitions', customTransformers, artifactTransformers, options);
  return csn;
}


/**
 * Instead of looping through the whole model, start at a given thing (like an on-condition),
 * as long as it is not a dictionary.
 *
 * Each transformer gets:
 * - the parent having the property
 * - the name of the property
 * - the value of the property
 * - the path to the property
 *
 * @param {object} parent The "parent" of which we transform a property of
 * @param {string} prop The property of parent to start at
 * @param {object} customTransformers Map of prop to transform and function to apply
 * @param {applyTransformationsOptions} [options={}]
 * @param {CSN.Path} path Path pointing to parent
 * @returns {object} parent[prop] with transformations applied
 */
function applyTransformationsOnNonDictionary( parent, prop, customTransformers = {}, options = {}, path = [] ) {
  return applyTransformationsInternal(parent, prop, customTransformers, [], options, path)[prop];
}

/**
 * Instead of looping through the whole model, start at a given thing (like .elements),
 * as long as it is a dictionary.
 *
 * Each transformer gets:
 * - the parent having the property
 * - the name of the property
 * - the value of the property
 * - the path to the property
 *
 *
 * @param {object} dictionary Dictionary to enrich in-place
 * @param {object} customTransformers Map of prop to transform and function to apply
 * @param {applyTransformationsOptions} [options={}]
 * @param {CSN.Path} path Path pointing to parent
 * @returns {object} dictionary with transformations applied
 */
function applyTransformationsOnDictionary( dictionary, customTransformers = {}, options = {}, path = [] ) {
  return applyTransformationsInternal(dictionary, null, customTransformers, [], { directDict: true, ...options }, path);
}

/**
 * transformExpression is a lightweight version of applyTransformations
 * used primarily to transform annotation expressions.
 * If propName is undefined, all properties of parent are transformed.
 * @param {object} parent Start node
 * @param {string|number} parentName Start at specific property of parent
 * @param {object} transformers Map of callback functions
 * @param {CSN.Path} path Path to parent
 * @param {object} ctx bucket to tunnel various info into the transformers
 * @returns {object} transformed node
 */
function transformExpression( parent, parentName, transformers, path = [], ctx = undefined ) {
  const callT = (t, childName, child) => {
    const ct = t[childName];
    if (ct) {
      if (Array.isArray(ct))
        ct.forEach(cti => cti(child, childName, child[childName], path, parent, parentName, ctx));
      else
        ct(child, childName, child[childName], path, parent, parentName, ctx);
    }
  };
  if (parentName != null) {
    const child = parent[parentName];
    if (!child || typeof child !== 'object' ||
        !{}.propertyIsEnumerable.call( parent, parentName ))
      return parent;

    path = [ ...path, parentName ];
    if (Array.isArray(child)) {
      child.forEach( (n, i) => transformExpression( child, i, transformers, path, ctx ) );
    }
    else {
      for (const childName of Object.getOwnPropertyNames( child )) {
        if (Array.isArray(transformers))
          transformers.forEach(t => callT(t, childName, child));
        else
          callT(transformers, childName, child);
        transformExpression(child, childName, transformers, path, ctx);
      }
    }
  }
  else {
    for (parentName of Object.getOwnPropertyNames( parent ))
      transformExpression( parent, parentName, transformers, path, ctx );
  }
  return parent;
}

/**
 * Drill into an annotation value and inspect each (sub-)object value if it is
 * an annotation expression. If so, call the real transformExpression that will
 * execute the callbacks (most likely reference rewriting), continue otherwise
 *
 * @param {object} parent Start node
 * @param {string|number} propName Start at specific property of parent
 * @param {object} transformers Map of callback functions
 * @param {CSN.Path} path Path to parent
 * @returns {object} transformed node
 */
function transformAnnotationExpression( parent, propName, transformers, path = [] ) {
  if (propName != null) {
    const child = parent[propName];
    if (!child || typeof child !== 'object' ||
        !{}.propertyIsEnumerable.call( parent, propName ))
      return parent;

    if (isAnnotationExpression(child))
      return transformExpression(parent, propName, transformers, path, { annoExpr: child });

    path = [ ...path, propName ];
    if (Array.isArray(child)) {
      child.forEach( (n, i) => transformAnnotationExpression( child, i, transformers, path ) );
    }
    else {
      for (const cpn of Object.getOwnPropertyNames( child ))
        transformAnnotationExpression(child, cpn, transformers, path);
    }
  }
  else {
    for (propName of Object.getOwnPropertyNames( parent ))
      transformAnnotationExpression( parent, propName, transformers, path );
  }
  return parent;
}

/**
 * Merge an array of transformer-objects into a single one, set the this-value of every subfunction to "that"
 *
 * @param {object[]} transformers transformers
 * @param {object} that Value for this
 * @returns {object} Remapped transformers.
 */
function mergeTransformers( transformers, that ) {
  const remapped = {};
  for (const transformer of transformers) {
    for (const [ n, fns ] of Object.entries(transformer)) {
      if (!remapped[n])
        remapped[n] = [];

      if (Array.isArray(fns)) {
        remapped[n].push((parent, name, prop, path, parentParent, opt, context) => fns.forEach(
          fn => fn.bind(that)(parent, name, prop, path, parentParent, opt, context)
        ));
      }
      else {
        remapped[n].push((parent, name, prop, path, parentParent, opt, context) => fns.bind(that)(parent, name, prop, path, parentParent, opt, context));
      }
    }
  }

  for (const [ n, fns ] of Object.entries(remapped))
    remapped[n] = (parent, name, prop, path, parentParent, opt, context) => fns.forEach(fn => fn.bind(that)(parent, name, prop, path, parentParent, opt, context));


  return remapped;
}

module.exports = {
  mergeTransformers,
  transformExpression,
  transformAnnotationExpression,
  applyTransformations,
  applyTransformationsOnNonDictionary,
  applyTransformationsOnDictionary,
};


/**
 * @typedef {object} applyTransformationsOptions
 * @property {(artifact: CSN.Artifact, name: string) => boolean} [allowArtifact] to only allow certain artifacts
 * @property {(artifact: CSN.Artifact, name: string) => boolean} [skipArtifact] to skip certain artifacts
 * @property {boolean} [drillRef] whether to drill into infix/args
 * @property {string[]} [skip] skip definitions from certain kind
 * @property {object} [skipStandard] stop drill-down on certain "standard" props
 * @property {object} [skipDict] stop drill-down on certain "dictionary" props
 * @property {boolean} [skipIgnore=true] Whether to skip $ignore elements or not
 * @property {boolean} [directDict=false] Implicitly set via applyTransformationsOnDictionary
 * @property {boolean} [processAnnotations=false] Wether to process annotations and call custom transformers on them
 */
