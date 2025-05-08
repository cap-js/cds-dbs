'use strict';

const {
  applyTransformations,
  applyTransformationsOnNonDictionary,
  copyAnnotations,
  implicitAs,
  findAnnotationExpression,
} = require('../../model/csnUtils');
const { isBuiltinType, isMagicVariable } = require('../../base/builtins');
const transformUtils = require('../transformUtils');
const { csnRefs } = require('../../model/csnRefs');
const { setProp } = require('../../base/model');
const { forEach } = require('../../utils/objectUtils');
const { transformExpression } = require('./applyTransformations');
const { cloneCsnNonDict } = require('../../model/cloneCsn');
const { EdmTypeFacetNames } = require('../../edm/EdmPrimitiveTypeDefinitions');
const { adaptAnnotationsRefs } = require('../odata/adaptAnnotationRefs');

/**
 * Strip off leading $self from refs where applicable.
 * Only relevant for HDBCDS, because handling of `$self` is not implemented there.
 *
 * @param {object} parent
 * @param {string} prop
 * @param {CSN.Elements} elements
 */
function removeLeadingSelf( parent, prop, elements ) {
  for (const [ elementName, element ] of Object.entries(elements)) {
    if (element.on) {
      applyTransformationsOnNonDictionary(elements, elementName, {
        ref: (root, name, ref) => {
          // HDBCDS renderers seem to expect it to not be there...
          if (ref[0] === '$self' && ref.length > 1 && !isMagicVariable(ref[1]) && ref[1] !== '$projection' && ref[1] !== '$self')
            root.ref.shift();
        },
      });
    }
  }
}

/**
 * Resolve type references and turn things with `.items` into elements of type `LargeString`.
 *
 * Also, replace actions, events and functions with simply dummy artifacts.
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @param {WeakMap} resolved Cache for resolved refs
 * @param {string} pathDelimiter
 * @param {object} iterateOptions
 */
function resolveTypeReferences( csn, options, messageFunctions, resolved, pathDelimiter, iterateOptions = {} ) {
  /**
   * Remove .localized from the element and any sub-elements
   *
   * Only direct .localized usage should produce "localized things".
   * If we don't remove it here, the second compile step adds localized stuff again.
   *
   * @param {object} obj
   */
  function removeLocalized( obj ) {
    const stack = [ obj ];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current.localized)
        delete current.localized;


      if (current.elements)
        stack.push(...Object.values(current.elements));
    }
  }
  const { toFinalBaseType, csnUtils } = transformUtils.getTransformers(csn, options, messageFunctions, pathDelimiter);

  // We don't want to iterate over actions
  if (iterateOptions.skipDict && !iterateOptions.skipDict.actions)
    iterateOptions.skipDict.actions = true;
  else
    iterateOptions.skipDict = { actions: true };

  const replaceWithDummyKinds = { action: 1, function: 1, event: 1 };
  const stripItems = options.transformation === 'hdbcds' || options.transformation === 'sql';
  const removeItems = new Set();
  applyTransformations(csn, {
    type: (node, prop, type, path, parent, parentProp) => {
      if (parentProp === 'cast') {
        const e = csnUtils.getFinalTypeInfo(type, t => resolved.get(t)?.art || csnUtils.artifactRef(t));
        if (e.items && stripItems)
          removeItems.add(node);
        if (!e || e.items || e.elements)
          return;
      }
      if (!isBuiltinType(type)) {
        toFinalBaseType(node, resolved, true);


        if (node.items && stripItems) {
          removeItems.add(node);
        }
        else {
          if (node.items) // items could have unresolved types
            toFinalBaseType(node.items, resolved, true);

          // structured types might not have the child-types replaced.
          // Drill down to ensure this.
          const nextElements = node.elements || node.items?.elements;
          const stack = nextElements ? [ nextElements ] : [];
          while (stack.length > 0) {
            const elements = stack.pop();
            for (const e of Object.values(elements)) {
              toFinalBaseType(e, resolved, true);
              if (stripItems && e.items) {
                removeItems.add(e);
              }
              else {
                if (!options.toOdata && e.items) // items could have unresolved types
                  toFinalBaseType(e.items, resolved, true);
                const next = e.elements || e.items?.elements;
                if (next)
                  stack.push(next);
              }
            }
          }
        }

        const directLocalized = node.localized || false;
        if (!directLocalized && !options.toOdata)
          removeLocalized(node);
      }
    },
    items: node => removeItems.add(node),
  }, [ (definitions, artifactName, artifact) => {
    // Replace events, actions and functions with simple dummies - they don't have effect on forRelationalDB stuff
    // and that way they contain no references and don't hurt.

    // Do not do for OData
    // TODO:factor out somewhere else
    if (!options.toOdata && artifact.kind in replaceWithDummyKinds) {
      const dummy = { kind: artifact.kind };
      if (artifact.kind === 'event')
        dummy.elements = {}; // events must be structured for recompilation
      if (artifact.$location)
        setProp(dummy, '$location', artifact.$location);

      definitions[artifactName] = dummy;
    }
    // TODO: skipDict options as default function arguments not via Object.assign
  } ], iterateOptions);

  // no support for array-of - turn into CLOB/Text
  for (const node of removeItems) {
    node.type = 'cds.LargeString';
    delete node.items;
  }
  removeItems.clear();
}

/**
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @param {WeakMap} resolved Cache for resolved refs
 * @param {string} pathDelimiter
 * @param {object} iterateOptions
 */
function flattenAllStructStepsInRefs( csn, options, messageFunctions, resolved, pathDelimiter, iterateOptions = {} ) {
  const adaptRefs = [];

  applyTransformations(csn, getStructStepsFlattener(csn, options, messageFunctions, resolved, pathDelimiter, adaptRefs), [], iterateOptions);

  adaptRefs.forEach(fn => fn());
}
/**
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @param {WeakMap} resolved Cache for resolved refs
 * @param {string} pathDelimiter
 * @param {Function[]} adaptRefs
 * @returns {object} applyTransformations transformer
 */
function getStructStepsFlattener( csn, options, messageFunctions, resolved, pathDelimiter, adaptRefs ) {
  const { inspectRef, effectiveType } = csnRefs(csn);
  const { flattenStructStepsInRef } = transformUtils.getTransformers(csn, options, messageFunctions, pathDelimiter);

  /**
   * For each step of the links, check if there is a type reference.
   * If there is, resolve it and store the result in a WeakMap.
   *
   * @param {Array} [links]
   * @todo seems too hacky
   * @returns {WeakMap} A WeakMap where a link is the key and the type is the value
   */
  function resolveLinkTypes( links = [] ) {
    const resolvedLinkTypes = new WeakMap();
    links.forEach((link) => {
      const { art } = link;
      if (art && art.type)
        resolvedLinkTypes.set(link, effectiveType(art));
    });

    return resolvedLinkTypes;
  }

  const transformer = {
    // @ts-ignore
    ref: (parent, prop, ref, path, _parent, _prop, context) => {
      const { links, art, scope } = inspectRef(path);
      const resolvedLinkTypes = resolveLinkTypes(links);
      setProp(parent, '$path', [ ...path ]);
      const lastRef = ref[ref.length - 1];
      const fn = (suspend = false, suspendPos = 0,
                  refFilter = _parent => true) => {
        let refChanged = false;
        if (refFilter(parent)) {
          const scopedPath = [ ...parent.$path ];
          // TODO: If foreign key annotations should be assigned via
          //       full path into target, uncomment this line and
          //       comment/remove setProp in expansion.js
          // setProp(parent, '$structRef', parent.ref);
          const flattenParameters = false; // structured parameters remain structured
          [ parent.ref, refChanged ] = flattenStructStepsInRef(ref, scopedPath, links, scope, resolvedLinkTypes, suspend, suspendPos, parent.$bparam, flattenParameters);
          resolved.set(parent, { links, art, scope });
          // Explicitly set implicit alias for things that are now flattened - but only in columns
          // TODO: Can this be done elegantly during expand phase already?
          if (parent.$implicitAlias) { // an expanded s -> s.a is marked with this - do not add implicit alias "a" there, we want s_a
            if (parent.ref[parent.ref.length - 1] === parent.as) // for a simple s that was expanded - for s.substructure this would not apply
              delete parent.as;
            delete parent.$implicitAlias;
          }
          // To handle explicitly written s.a - add implicit alias a, since after flattening it would otherwise be s_a
          else if (parent.ref[parent.ref.length - 1] !== lastRef &&
                      (insideColumns(scopedPath) || insideKeys(scopedPath)) &&
                      !parent.as) {
            parent.as = lastRef;
          }
        }

        return refChanged;
      };

      if (context?.$annotation) {
        const annotation = context.$annotation.value;
        adaptRefs.push((...args) => {
          const refChanged = fn(...args);
          if (refChanged && annotation['='])
            annotation['='] = true;
        });
      }
      else {
        // adapt queries later
        adaptRefs.push(fn);
      }
    },
  };


  /**
   * Return true if the path points inside columns
   *
   * @param {CSN.Path} path
   * @returns {boolean}
   */
  function insideColumns( path ) {
    return path.length >= 3 && (path[path.length - 3] === 'SELECT' || path[path.length - 3] === 'projection') && path[path.length - 2] === 'columns';
  }
  /**
   * Return true if the path points inside keys
   *
   * @param {CSN.Path} path
   * @returns {boolean}
   */
  function insideKeys( path ) {
    return path.length >= 3 && path[path.length - 2] === 'keys' && typeof path[path.length - 1] === 'number';
  }

  return transformer;
}

/**
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @param {string} pathDelimiter
 * @param {object} iterateOptions
 */
function flattenElements( csn, options, messageFunctions, pathDelimiter, iterateOptions = {} ) {
  const { error } = messageFunctions;
  const { flattenStructuredElement, csnUtils } = transformUtils.getTransformers(csn, options, messageFunctions, pathDelimiter);
  const { isAssocOrComposition, effectiveType } = csnUtils;
  const transformers = {
    elements: flatten,
  };

  applyTransformations(csn, transformers, [], iterateOptions);

  /**
   * Flatten a given .elements or .params dictionary - keeping the order consistent.
   *
   * @param {object} parent The parent object having dict at prop - parent[prop] === dict
   * @param {string} prop
   * @param {object} dict
   * @param {CSN.Path} path
   */
  function flatten( parent, prop, dict, path ) {
    if (!parent[prop].$orderedElements)
      setProp(parent[prop], '$orderedElements', []);
    forEach(dict, (elementName, element) => {
      if (element.elements) {
        // Ignore the structured element, replace it by its flattened form
        element.$ignore = true;

        const branches = getBranches(element, elementName, effectiveType, pathDelimiter);
        const flatElems = flattenStructuredElement(element, elementName, [], path.concat([ 'elements', elementName ]));

        for (const flatElemName in flatElems) {
          if (parent[prop][flatElemName]) {
            // TODO: combine message ID with generated FK duplicate
            // do the duplicate check in the construct callback, requires to mark generated flat elements,
            // check: Error location should be the existing element like @odata.foreignKey4
            error('name-duplicate-element', path.concat([ 'elements', elementName ]),
                  { '#': 'flatten-element-exist', name: flatElemName });
          }

          const flatElement = flatElems[flatElemName];

          // Check if we have a valid notNull chain
          const branch = branches[flatElemName].steps;
          if (flatElement.notNull !== false && !branch.some(s => !s.notNull))
            flatElement.notNull = true;

          if (flatElement.type && isAssocOrComposition(flatElement) && flatElement.on) {
            // unmanaged relations can't be primary key
            delete flatElement.key;
            if (options.transformation !== 'effective') {
              const process = endIndex => function processRef(_parent, _prop, xpr) {
                const prefix = flatElement._flatElementNameWithDots.split('.').slice(0, endIndex).join(pathDelimiter);
                const possibleFlatName = prefix + pathDelimiter + xpr[0];
                /*
                      when element is defined in the current name resolution scope, like
                        entity E {
                          key x: Integer;
                              s : {
                              y : Integer;
                              a3 : association to E on a3.x = y;
                              }
                        }
                      We need to replace y with s_y and a3 with s_a3 - we must take care to not escape our local scope
                    */
                if (flatElems[possibleFlatName])
                  xpr[0] = possibleFlatName;
              };
              transformExpression(flatElement, 'on', {
                ref: process(-1),
              });
            }
          }
          parent[prop].$orderedElements.push([ flatElemName, flatElement ]);
          // Still add them - otherwise we might not detect collisions between generated elements.
          parent[prop][flatElemName] = flatElement;
        }
      }
      else {
        parent[prop].$orderedElements.push([ elementName, element ]);
      }
    });

    // $orderedElements is removed by reducing and assigning a new dictionary
    parent[prop] = parent[prop].$orderedElements.reduce((elements, [ name, element ]) => {
      // rewrite $path to match the flattened dictionary entry
      // ([ 'definitions', artName ] remain constant
      setProp(element, '$path', [ ...path, prop, name ]);
      elements[name] = element;
      return elements;
    }, Object.create(null));
  }
}

/**
 * Get not just the leaves, but all branches of a structured element.
 *
 * @param {object} element Structured element
 * @param {string} elementName Name of the structured element
 * @param {Function} effectiveType
 * @param {string} pathDelimiter
 * @returns {object} Returns a dictionary, where the key is the flat name of the branch and the value is an array of element-steps.
 */
function getBranches( element, elementName, effectiveType, pathDelimiter ) {
  const branches = {};
  const subbranchNames = [];
  const subbranchElements = [];
  walkElements(element, elementName);
  /**
   * Walk the element chain
   *
   * @param {object} e
   * @param {string} name
   */
  function walkElements( e, name ) {
    if (isBuiltinType(e.type)) {
      branches[subbranchNames.concat(name).join(pathDelimiter)] = { steps: subbranchElements.concat(e), ref: subbranchNames.concat(name) };
    }
    else {
      const subelements = e.elements || effectiveType(e).elements;
      if (subelements) {
        subbranchElements.push(e);
        subbranchNames.push(name);
        for (const [ subelementName, subelement ] of Object.entries(subelements))
          walkElements(subelement, subelementName);

        subbranchNames.pop();
        subbranchElements.pop();
      }
      else {
        branches[subbranchNames.concat(name).join(pathDelimiter)] = { steps: subbranchElements.concat(e), ref: subbranchNames.concat(name) };
      }
    }
  }
  return branches;
}

/**
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @param {string} pathDelimiter
 * @param {boolean} flattenKeyRefs
 * @param {object} csnUtils
 * @param {object} iterateOptions
 */
function handleManagedAssociationsAndCreateForeignKeys( csn, options, messageFunctions, pathDelimiter, flattenKeyRefs, csnUtils, iterateOptions = {} ) {
  const { error } = messageFunctions;
  const { inspectRef, isStructured } = csnUtils;
  const { flattenStructStepsInRef, flattenStructuredElement } = transformUtils.getTransformers(csn, options, messageFunctions, pathDelimiter);
  if (flattenKeyRefs) {
    applyTransformations(csn, {
      keys: (element, prop, keys, path) => {
        // replace foreign keys that are managed associations by their respective foreign keys
        flattenFKs(element, path.at(-1), path);
      },
    }, [], Object.assign({
      skipIgnore: false,
      allowArtifact: artifact => (artifact.kind === 'entity' || artifact.kind === 'type'),
      skipDict: { actions: true },
    }, iterateOptions));
  }
  createForeignKeyElements();

  /**
   * Flattens all foreign keys
   *
   * Structures will be resolved to individual elements with scalar types
   *
   * Associations will be replaced by their respective foreign keys
   *
   * If a structure contains an assoc, this will also be resolved and vice versa
   *
   * @param {*} assoc
   * @param {*} assocName
   * @param {*} path
   */
  function flattenFKs( assoc, assocName, path ) {
    if (!assoc.keys)
      return; // managed to-many assoc

    // TODO Depth first search and not iterate mark and sweep approach
    let finished = false;
    while (!finished) {
      const newKeys = [];
      finished = processKeys(newKeys);
      assoc.keys = newKeys;
    }

    // @ts-ignore
    /**
     * Walk over the keys and replace structures by their leafs, managed associations by their foreign keys and keep scalar values as-is.
     *
     * @param {object[]} collector New keys array to collect the flattened stuff in
     * @returns {boolean} True if all keys are scalar - false if there are things that still need to be processed.
     */
    function processKeys( collector ) {
      const inferredAlias = '$inferredAlias';

      let done = true;
      for (let i = 0; i < assoc.keys.length; i++) {
        const pathToKey = path.concat([ 'keys', i ]);
        const { art } = inspectRef(pathToKey);
        const { ref } = assoc.keys[i];
        if (isStructured(art)) {
          done = false;
          const flat = flattenStructuredElement(art, ref[ref.length - 1], [], pathToKey);
          Object.keys(flat).forEach((flatElemName) => {
            const key = assoc.keys[i];
            const clone = cloneCsnNonDict(assoc.keys[i], options);
            if (clone.as) {
              const lastRef = clone.ref[clone.ref.length - 1];
              // Cut off the last ref part from the beginning of the flat name
              const flatBaseName = flatElemName.slice(lastRef.length);
              // Join it to the existing table alias
              clone.as += flatBaseName;
              // do not loose the $ref for nested keys
              if (key.$ref) {
                let aliasedLeaf = key.$ref[key.$ref.length - 1];
                aliasedLeaf += flatBaseName;
                setProp(clone, '$ref', key.$ref.slice(0, key.$ref.length - 1).concat(aliasedLeaf));
              }
            }
            if (clone.ref) {
              clone.ref[clone.ref.length - 1] = flatElemName;
              // Now we need to properly flatten the whole ref
              [ clone.ref ] = flattenStructStepsInRef(clone.ref, pathToKey);
            }
            if (!clone.as) {
              clone.as = flatElemName;
              // TODO: can we use $inferred? Does it have other weird side-effects?
              setProp(clone, inferredAlias, true);
            }
            // Directly work on csn.definitions - this way the changes take effect in csnRefs/inspectRef immediately
            // Add the newly generated foreign keys to the end - they will be picked up later on
            // Recursive solutions run into call stack issues
            collector.push(clone);
          });
        }
        else if (art.target) {
          done = false;
          // Directly work on csn.definitions - this way the changes take effect in csnRefs/inspectRef immediately
          // Add the newly generated foreign keys to the end - they will be picked up later on
          // Recursive solutions run into call stack issues
          art.keys?.forEach(key => collector.push(cloneAndExtendRef(key, assoc.keys[i], ref)));
        }
        else if (assoc.keys[i].ref && !assoc.keys[i].as) {
          setProp(assoc.keys[i], inferredAlias, true);
          assoc.keys[i].as = assoc.keys[i].ref[assoc.keys[i].ref.length - 1];
          collector.push(assoc.keys[i]);
        }
        else {
          collector.push(assoc.keys[i]);
        }
      }
      return done;
    }

    /**
     * Clone base and extend the .ref and .as of the clone with the .ref and .as of ref.
     *
     * @param {object} key A foreign key entry (of a managed assoc as a fk of another assoc)
     * @param {object} base The fk-ref that has key as a fk
     * @param {Array} ref
     * @returns {object} The clone of base
     */
    function cloneAndExtendRef( key, base, ref ) {
      const clone = cloneCsnNonDict(base, options );
      if (key.ref) {
        // We build a ref that contains the aliased fk - that element will be created later on, so this ref is not resolvable yet
        // Therefore we keep it as $ref - ref is the non-aliased, resolvable "clone"
        // Later on, after we know that these foreign key elements are created, we replace ref with this $ref
        let $ref;
        if (base.$ref) {
          // if a base $ref is provided, use it to correctly resolve association chains
          const refChain = [ base.$ref[base.$ref.length - 1] ].concat(key.as || key.ref);
          $ref = base.$ref.slice(0, base.$ref.length - 1).concat(refChain);
        }
        else {
          $ref = base.ref.concat(key.as || key.ref); // Keep along the aliases
        }
        setProp(clone, '$ref', $ref);
        clone.ref = clone.ref.concat(key.ref);
      }

      if (!clone.as && clone.ref && clone.ref.length > 0) {
        clone.as = ref[ref.length - 1] + pathDelimiter + (key.as || key.ref.join(pathDelimiter));
        // TODO: can we use $inferred? Does it have other weird side-effects?
        setProp(clone, '$inferredAlias', true);
      }
      else {
        clone.as += pathDelimiter + (key.as || key.ref.join(pathDelimiter));
      }

      return clone;
    }
  }

  /**
   * Create the foreign key elements in all .elements things
   */
  function createForeignKeyElements() {
    const transformers = {
      elements: createFks,
    };

    applyTransformations(csn, transformers, [], Object.assign({ skipIgnore: false }, iterateOptions));

    /**
     * Process a given .elements or .params dictionary and create foreign key elements
     *
     * @param {object} parent The thing HAVING params or elements
     * @param {string} prop
     * @param {object} dict The params or elements thing
     * @param {CSN.Path} path
     */
    function createFks( parent, prop, dict, path ) {
      const orderedElements = [];
      Object.entries(dict).forEach(([ elementName, element ]) => {
        orderedElements.push([ elementName, element ]);
        const eltPath = path.concat(prop, elementName);
        const fks = createForeignKeys(csnUtils, eltPath, element, elementName, csn, options, pathDelimiter);

        // finalize the generated foreign keys
        const refCount = fks.reduce((acc, fk) => {
          // count duplicates
          if (acc[fk[0]])
            acc[fk[0]]++;
          else
            acc[fk[0]] = 1;

          // check for name clash with existing elements
          if (parent[prop][fk[0]]) {
            // error location is the colliding element
            error('name-duplicate-element', eltPath, { '#': 'flatten-fkey-exists', name: fk[0], art: elementName });
          }
          // attach a proper $path
          setProp(element, '$path', eltPath);
          return acc;
        }, Object.create(null));

        // set default for single foreign key from association (if available)
        if (element.default?.val !== undefined && fks.length === 1)
          fks[0][1].default = element.default;

        // check for duplicate foreign keys
        Object.entries(refCount).forEach(([ name, occ ]) => {
          if (occ > 1)
            error('name-duplicate-element', eltPath, { '#': 'flatten-fkey-gen', name, art: elementName });
        });
        if (element.keys) {
          element.keys.forEach((key, i) => {
            // Assumption: If all key refs have been flattened, there is a
            // 1:1 match to the corresponding foreign key element. Order is the
            // same, so an index access should work
            if (flattenKeyRefs) {
              key.$generatedFieldName = fks[i][0];
              key.ref = [ (key.$ref || key.ref).join(pathDelimiter) ];
              delete key.$ref;
              const fk = fks[i][1];
              if (options.transformation === 'effective')
                copyAnnotations(key, fk);
            }
          });

          if (options.transformation === 'effective')
            delete element.default;
        }

        if (options.transformation === 'effective') {
          adaptAnnotationsRefs(fks, csnUtils, messageFunctions, eltPath);
          const validAnnoNames = Object.keys(element).filter(pn => pn[0] === '@' && findAnnotationExpression(element, pn));
          fks.forEach(fk => copyAnnotations(element, fk[1], false, {}, validAnnoNames));
        }
        orderedElements.push(...fks);
      });

      parent[prop] = orderedElements.reduce((elementsAccumulator, [ name, element ]) => {
        elementsAccumulator[name] = element;
        return elementsAccumulator;
      }, Object.create(null));
    }
  }
}

/**
 * This is the internal version of the foreign key procedure.
 *
 * If element is not a managed association, an empty array is returned
 *
 * @param {object} csnUtils
 * @param {Array|object} path CSN path pointing to element or the result of a previous call to inspectRef
 * @param {CSN.Element} element
 * @param {string} prefix Element name
 * @param {CSN.Model} csn
 * @param {object} options
 * @param {string} pathDelimiter
 * @param {number} lvl
 * @param {object} originalKey
 * @returns {Array[]} First element of every sub-array is the foreign key name, second is the foreign key definition
 */
function createForeignKeys( csnUtils, path, element, prefix, csn, options, pathDelimiter, lvl = 0, originalKey = { }) {
  const special$self = !csn?.definitions?.$self && '$self';
  const isInspectRefResult = !Array.isArray(path);

  let fks = [];
  if (!element)
    return fks;

  let finalElement = element;
  let finalTypeName; // TODO: Find a way to not rely on $path?
  // TODO: effectiveType's return value is 'path' for the next inspectRef
  if (element.type && !isBuiltinType(element.type) && element.type !== special$self) {
    const tmpElt = csnUtils.effectiveType(element);
    // effective type resolves to structs and enums only but not scalars
    if (Object.keys(tmpElt).length) {
      finalElement = tmpElt;
      finalTypeName = finalElement.$path[1];
    }
    else {
      // unwind a derived type chain to a scalar type
      while (finalElement?.type && !isBuiltinType(finalElement?.type)) {
        finalTypeName = finalElement.type;
        finalElement = csn.definitions[finalElement.type];
      }
    }
  }

  if (!finalElement)
    return [];

  if (finalElement.target && !finalElement.on) {
    finalElement.keys?.forEach((key, keyIndex) => {
      const continuePath = getContinuePath([ 'keys', keyIndex ]);
      const alias = key.as || implicitAs(key.ref);
      const result = csnUtils.inspectRef(continuePath);
      fks = fks.concat(createForeignKeys(csnUtils, result, result.art, alias, csn, options, pathDelimiter, lvl + 1, lvl === 0 ? {
        ref: key.ref, as: key.as, $path: key.$path, $originalKeyRef: key.$originalKeyRef,
      } : originalKey));
    });
  }
  // return if the toplevel element is not a managed association
  else if (lvl === 0) {
    return fks;
  }
  else if (finalElement.elements) {
    Object.entries(finalElement.elements).forEach(([ elemName, elem ]) => {
      // Skip already produced foreign keys
      if (!elem['@odata.foreignKey4']) {
        const continuePath = getContinuePath([ 'elements', elemName ]);
        fks = fks.concat(createForeignKeys(csnUtils, continuePath, elem, elemName, csn, options, pathDelimiter, lvl + 1, originalKey));
      }
    });
  }
  // we have reached a leaf element, create a foreign key
  else if (finalElement.type == null || isBuiltinType(finalElement.type)) {
    const newFk = Object.create(null);
    [ 'type', 'length', 'scale', 'precision', 'srid', 'default', '@odata.Type', ...EdmTypeFacetNames.map(f => `@odata.${ f }`) ].forEach((prop) => {
      // copy props from original element to preserve derived types!
      if (element[prop] !== undefined)
        newFk[prop] = element[prop];
    });
    return [ [ prefix, newFk, originalKey ] ];
  }

  fks.forEach((fk) => {
    // prepend current prefix
    fk[0] = `${ prefix }${ pathDelimiter }${ fk[0] }`;
    // if this is the entry association, decorate the final foreign keys with the association props
    if (lvl === 0) {
      if (options.transformation !== 'effective')
        fk[1]['@odata.foreignKey4'] = prefix;
      if (options.transformation === 'odata' || options.transformation === 'effective') {
        const validAnnoNames = Object.keys(element).filter(pn => pn[0] === '@' && !findAnnotationExpression(element, pn));
        copyAnnotations(element, fk[1], true, {}, validAnnoNames);
      }
      // propagate not null to final foreign key
      for (const prop of [ 'notNull', 'key' ]) {
        if (element[prop] !== undefined)
          fk[1][prop] = element[prop];
      }
      if (element.$location)
        setProp(fk[1], '$location', element.$location);
    }
  });
  return fks;


  /**
   * Get the path to continue resolving references
   *
   * If we are currently inside of a type, we need to start our path fresh from that given type.
   * Otherwise, we would try to resolve .elements on a thing that does not exist.
   *
   * We also respect if we have a previous inspectRef result as our base.
   *
   * @param {Array} additions
   * @returns {CSN.Path}
   */
  function getContinuePath( additions ) {
    if (csn.definitions[finalElement.type])
      return [ 'definitions', finalElement.type, ...additions ];
    else if (finalTypeName)
      return [ 'definitions', finalTypeName, ...additions ];
    else if (isInspectRefResult)
      return [ path, ...additions ];
    return [ ...path, ...additions ];
  }
}

module.exports = {
  resolveTypeReferences,
  flattenAllStructStepsInRefs,
  flattenElements,
  removeLeadingSelf,
  handleManagedAssociationsAndCreateForeignKeys,
  getBranches,
  getStructStepsFlattener,
};
