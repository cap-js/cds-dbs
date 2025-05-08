'use strict';

const { isBuiltinType } = require('../../base/builtins');
const { setProp } = require('../../base/model');
const { applyTransformations, implicitAs, copyAnnotations, isDeepEqual } = require('../../model/csnUtils');
const { EdmTypeFacetNames } = require('../../edm/EdmPrimitiveTypeDefinitions');
const { adaptAnnotationsRefs } = require('./adaptAnnotationRefs');

function createForeignKeyElements(csn, options, messageFunctions, csnUtils, iterateOptions = {}) {

    const { error } = messageFunctions;

    applyTransformations(csn, { elements: createForeignKeysInCsn, params: createForeignKeysInCsn},
                         [], iterateOptions);

    /**
     * Process a given elements or params dictionary and create foreign key elements.
     *
     * @param {object} parent The thing HAVING params or elements
     * @param {string} prop
     * @param {object} dict The params or elements thing
     * @param {CSN.Path} path
     */
    function createForeignKeysInCsn( parent, prop, dict, path ) {
      const orderedElements = [];
      // First, generate the FK elements for given element
      Object.entries(dict).forEach(([elementName, element]) => {
        orderedElements.push([ elementName, element ]);
        if (!csnUtils.isManagedAssociation(element)) return;
        const elementPath = path.concat(prop, elementName);
        const generatedForeignKeys = createForeignKeysForElement(elementPath, element, elementName, csn, options, '_');

        // Second, finalize the generated FK elements
        const refCount = generatedForeignKeys.reduce((acc, fk) => {
          // count duplicates
          if (acc[fk.prefix])
            acc[fk.prefix]++;
          else
            acc[fk.prefix] = 1;

          // check for name clash with existing elements
          if (parent[prop][fk.prefix] && isDeepEqual(element, parent[prop][fk.prefix], true)) {
            // error location is the colliding element
            error('name-duplicate-element', elementPath, { '#': 'flatten-fkey-exists', name: fk.prefix, art: elementName });
          }
          // attach a proper $path
          setProp(element, '$path', elementPath);
          return acc;
        }, Object.create(null));

        // set default for single foreign key from association (if available)
        if (element.default?.val !== undefined && generatedForeignKeys.length === 1)
        generatedForeignKeys[0].foreignKey.default = element.default;

        // check for duplicate foreign keys
        Object.entries(refCount).forEach(([ name, occ ]) => {
          if (occ > 1)
            error('name-duplicate-element', elementPath, { '#': 'flatten-fkey-gen', name, art: elementName });
        });
        if (element.keys) {
          if (options.transformation === 'effective')
            delete element.default;
        }

        adaptAnnotationsRefs(generatedForeignKeys, csnUtils, messageFunctions);
        setProp(element, '$generatedForeignKeys', generatedForeignKeys.map(gfk => { 
          return { name: gfk.prefix, origin: gfk.originalKey, source: gfk.sourceElement } } ));
        orderedElements.push(...generatedForeignKeys.map(gfk => [ gfk.prefix, gfk.foreignKey ]));
      });

      parent[prop] = orderedElements.reduce((elementsAccumulator, [ name, element ]) => {
        elementsAccumulator[name] = element;
        return elementsAccumulator;
      }, Object.create(null));
    }

  function createForeignKeysForElement(path, element, prefix, csn, options, pathDelimiter, lvl = 0, originalKey = {} ) {
    const special$self = !csn?.definitions?.$self && '$self';
    const isInspectRefResult = !Array.isArray(path);

    let fks = [];
    if (!element)
      return fks;

    let finalElement = element;
    let finalTypeName;

    // resolve derived type
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

    // main if for this function
    // the element is a managed association
    if (csnUtils.isManagedAssociation(finalElement)) {
      finalElement.keys?.forEach((key, keyIndex) => {
        const continuePath = getContinuePath([ 'keys', keyIndex ]);
        const alias = key.as || implicitAs(key.ref);
        const result = csnUtils.inspectRef(continuePath);
        let gfks = createForeignKeysForElement(result, result.art, alias, csn, options, pathDelimiter, lvl + 1,
          lvl === 0 ? key : originalKey);
        if (lvl === 0) {
          gfks.forEach(gfk => gfk.keyAnnotations.push( ...copyAnnotations(key, gfk.foreignKey)));
          Object.keys(key).forEach( prop => {
            // once applied -> remove the annotations from the keys array, to keep the OData CSN size as small as possible
            if (prop[0] === '@')
              delete key[prop]
          });
        }
        fks = fks.concat(gfks);
      });
    }
    // the element is a structure
    else if (finalElement.elements) {
      Object.entries(finalElement.elements).forEach(([ elemName, elem ]) => {
        // Skip already produced foreign keys
        if (!elem['@odata.foreignKey4']) {
          const continuePath = getContinuePath([ 'elements', elemName ]);
          fks = fks.concat(createForeignKeysForElement(continuePath, elem, elemName, csn, options, pathDelimiter, lvl + 1, originalKey));
        }
      });
    }
    // we have reached a leaf element, create a foreign key
    else if ((finalElement.type == null || isBuiltinType(finalElement.type)) && !finalElement.on) {
      const newFk = Object.create(null);
      [ 'type', 'length', 'scale', 'precision', 'srid', 'default', '@odata.Type', ...EdmTypeFacetNames.map(f => `@odata.${f}`) ].forEach((prop) => {
        // copy props from original element to preserve derived types!
        if (element[prop] !== undefined)
          newFk[prop] = element[prop];
      });
      let result = { prefix, foreignKey: newFk, originalKey, keyAnnotations: [], sourceElement: finalElement }
      return [ result ];
    }

    fks.forEach((fk) => {
      // prepend current prefix
      fk.prefix = `${prefix}${pathDelimiter}${fk.prefix}`;
      // if this is the entry association, decorate the final foreign keys with the association props/annos
      if (lvl === 0) {
        fk.foreignKey['@odata.foreignKey4'] = prefix;

        const fkPath = path.slice(0, path.length - 1);
        fkPath.push(fk.prefix);
        setProp(fk.foreignKey, '$path', fkPath);

        const allowedOverwriteAnnotationNames = ['@odata.Type', ...EdmTypeFacetNames.map(f => `@odata.${f}`)];
        const validAnnoNames = Object.keys(element).filter(pn => pn[0] === '@' && !allowedOverwriteAnnotationNames.includes(pn));
        copyAnnotations(element, fk.foreignKey, false, {}, validAnnoNames);
        const overwriteAnnoNames = Object.keys(element).filter(pn => allowedOverwriteAnnotationNames.includes(pn));
        copyAnnotations(element, fk.foreignKey, true, {}, overwriteAnnoNames);

        // propagate not null to final foreign key
        for (const prop of [ 'notNull', 'key' ]) {
          if (element[prop] !== undefined)
            fk.foreignKey[prop] = element[prop];
        }
        if (element.$location)
          setProp(fk.foreignKey, '$location', element.$location);
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
}

module.exports = createForeignKeyElements;
