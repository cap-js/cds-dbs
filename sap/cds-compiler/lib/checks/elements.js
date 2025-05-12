'use strict';

const {
  forEachMember,
  forEachMemberRecursively,
  cardinality2str,
  hasPersistenceSkipAnnotation,
} = require('../model/csnUtils');
const { isBuiltinType } = require('../base/builtins');
const { isGeoTypeName } = require('../compiler/builtins');
const { setProp } = require('../base/model');
// Only to be used with validator.js - a correct `this` value needs to be provided!

/**
 * Checks artifact's primary keys and an error is registered if some of the keys
 * is of type 'cds.hana.ST_POINT', 'cds.hana.ST_GEOMETRY' or if it is arrayed
 *
 * @param {CSN.Artifact} art The artifacts that will be checked
 */
function checkPrimaryKey( art ) {
  if (art.kind !== 'entity' && art.kind !== 'aspect')
    return;
  forEachMember(art, (member, memberName, prop, path) => {
    checkIfPrimaryKeyIsOfGeoType.bind(this)(member, memberName);
    checkIfPrimaryKeyIsArray.bind(this)(member, memberName);
    if (member.elements) {
      forEachMemberRecursively(member, (subMember, subMemberName) => {
        checkIfPrimaryKeyIsOfGeoType.bind(this)(subMember, subMemberName, member.key);
        checkIfPrimaryKeyIsArray.bind(this)(subMember, subMemberName, member.key);
      },
                               path);
    }
  });

  /**
   *
   * @param {CSN.Element} member The member
   * @param {string} elemFqName Full name of the element following the structure,
   *                            concatenated with '/', used for error reporting
   * @param {boolean} parentIsKey Whether parent is a key
   * @param {CSN.Path} parentPath The path of the parent element (optional)
   */
  function checkIfPrimaryKeyIsOfGeoType( member, elemFqName, parentIsKey, parentPath ) {
    if (member.key || parentIsKey) {
      const finalBaseType = this.csnUtils.getFinalTypeInfo(member.type);
      if (isGeoTypeName(finalBaseType?.type)) {
        this.error(null, parentPath || member.$path,
                   { type: finalBaseType.type, name: elemFqName },
                   'Type $(TYPE) can\'t be used as primary key in element $(NAME)');
      }
      else if (finalBaseType && this.csnUtils.isStructured(finalBaseType) && !finalBaseType.$visited) {
        setProp(finalBaseType, '$visited', true);
        forEachMemberRecursively(finalBaseType,
                                 (subMember, subMemberName) => checkIfPrimaryKeyIsOfGeoType
                                   .bind(this)(subMember,
                                               `${ elemFqName }/${ subMemberName }`,
                                               member.key || parentIsKey,
                                               member.$path));
        delete finalBaseType.$visited;
      }
    }
  }

  /**
   *
   * @param {CSN.Element} member The member
   * @param {string} elemFqName Full name of the element following the structure,
   *                            concatenated with '/', used for error reporting
   * @param {boolean} parentIsKey Whether parent is a key
   * @param {CSN.Path} parentPath The path of the parent element (optional)
   */
  function checkIfPrimaryKeyIsArray( member, elemFqName, parentIsKey, parentPath ) {
    if (member.key || parentIsKey) {
      const finalBaseType = this.csnUtils.getFinalTypeInfo(member.type);
      if (member.items || (finalBaseType && finalBaseType.items)) {
        let msg = 'std';
        if (member.target)
          msg = this.csnUtils.isComposition(member) ? 'comp' : 'assoc';

        this.error('def-invalid-key-cardinality', parentPath || member.$path,
                   {
                     name: elemFqName,
                     value: cardinality2str(member, false),
                     '#': msg,
                   }, 'Array-like type in element $(NAME) can\'t be used as primary key');
      }
      else if (finalBaseType && this.csnUtils.isStructured(finalBaseType) && !finalBaseType.$visited) {
        setProp(finalBaseType, '$visited', true);
        forEachMemberRecursively(finalBaseType,
                                 (subMember, subMemberName) => checkIfPrimaryKeyIsArray
                                   .bind(this)(subMember,
                                               `${ elemFqName }/${ subMemberName }`,
                                               member.key || parentIsKey,
                                               member.$path));
        delete finalBaseType.$visited;
      }
    }
  }
}


/**
 * Checks virtual elements and throws an error if some is either structured or
 * an association
 *
 * @param {CSN.Element} member Element to be checked
 */
function checkVirtualElement( member ) {
  if (member.virtual) {
    if (this.csnUtils.isAssocOrComposition(member))
      this.error(null, member.$path, {}, 'Element can\'t be virtual and an association or composition');
  }
}

/**
 * Checks whether managed associations with cardinality 'to many' have no ON-condition.
 * If there isn't, and if _all_ key elements on the target side are covered by the foreign key,
 * then the association is effectively to-one -> warning.
 *
 * @param {CSN.Artifact} member The member (e.g. element artifact)
 */
function checkManagedAssoc( member ) {
  if (!member.target || isManagedComposition.bind(this)(member))
    return;

  const targetMax = member.cardinality?.max ?? 1;
  if (targetMax === 1 || member.on)
    return;

  const isPersisted = !hasPersistenceSkipAnnotation(this.artifact) && !this.artifact['@cds.persistence.exists'];
  if (isPersisted && !member.keys && (targetMax === '*' || Number(targetMax) > 1) && this.options.transformation === 'sql') {
    // Since cds-compiler v6, managed to-many no longer get 'keys'.
    // As this would lead to DROP COLUMNs, emit an error instead.
    this.error('type-missing-on-condition', member.cardinality?.$path || member.$path, {
      value: cardinality2str(member, false),
      '#': this.csnUtils.isComposition(member) ? 'comp' : 'std',
    }, {
      // same as 'to-many-no-on', but as error
      std: 'Expected association with target cardinality $(VALUE) to have an ON-condition',
      comp: 'Expected composition with target cardinality $(VALUE) to have an ON-condition',
    });
  }

  // Implementation note:  Imported services (i.e. external ones) may contain to-many associations
  // with an empty foreign key list.  If the user (in this case importer) explicitly sets an empty
  // foreign key array, we won't emit a warning to avoid spamming the user.
  if (!member.keys || member.keys.length === 0)
    return;

  // We use the fact that `key` is only supported top-level (warning otherwise).
  // And if an element of a structured _type_ is "key", we get a warning for the key.
  // However, we may get false negatives for our warning, which is acceptable, e.g. for
  // `type T : { key i: String; }; entity A { id : T; };` with `… to many A { id };`
  const target = typeof member.target === 'object' ? member.target : this.csnUtils.getCsnDef(member.target);
  const targetKeys = Object.entries(target.elements || {}).filter(elem => !!elem[1].key);
  const foreignKeys = structurizeForeignKeys(member.keys);
  if (!coversAllTargetKeys.call(this, foreignKeys, targetKeys))
    return; // foreign key does not cover at least one target key -> can be to-many

  this.warning(!isPersisted ? 'to-many-no-on-noDB' : 'to-many-no-on', member.cardinality?.$path || member.$path, {
    value: cardinality2str(member, false),
    '#': this.csnUtils.isComposition(member) ? 'comp' : 'std',
  }, {
    std: 'Expected association with target cardinality $(VALUE) to have an ON-condition',
    comp: 'Expected composition with target cardinality $(VALUE) to have an ON-condition',
  });
}

/**
 * Returns true if the foreign keys cover _all_ of the target keys.
 * Returns false otherwise.
 *
 * @see checkManagedAssoc()
 *
 * @param {object} foreignKeys Structure returned by `structurizeForeignKeys()`.
 * @param {Array} targetKeys Object.entries() value of target keys.
 * @returns {boolean} Whether all target keys are covered
 */
function coversAllTargetKeys( foreignKeys, targetKeys ) {
  if (foreignKeys.length < targetKeys.length || targetKeys.length === 0) {
    // there are fewer foreign keys than keys on the target side
    // or there are no keys on the target side, in which case there is no
    // possibility to cover all keys.
    return false;
  }

  for (const [ targetKeyName, targetKey ] of targetKeys) {
    const foreignKey = foreignKeys.entries[targetKeyName];
    if (!foreignKey)
      return false; // foreign key does not cover this target key
    if (foreignKey.length > 0) { // foreign key only selects sub-structures, not whole structured key
      const elements = targetKey.elements || this.csnUtils.getFinalTypeInfo(targetKey.type)?.elements;
      if (!elements)
        return false; // model error (e.g. 'many type')
      if (!coversAllTargetKeys( foreignKey, Object.entries(elements) ))
        return false;
    }
  }
  return true;
}

/**
 * Structurizes a foreign key into an object that can be used to compare foreign
 * keys against their corresponding keys on target side.
 *
 * For `Association to T { a.b, a.c, b }` this structure will be returned:
 *  `{ length: 2, entries: { a: { length: 2, entries: { b: { length: 0, … }, …} } }}`
 *
 * @param {object[]} keys Foreign key array.
 * @returns {object} Structured foreign key. Custom format, i.e. not via `elements`.
 */
function structurizeForeignKeys( keys ) {
  const map = { entries: Object.create(null), length: 0 };
  for (const key of keys) {
    let entry = map;
    for (const step of key.ref) {
      if (!entry.entries[step]) {
        entry.entries[step] = { entries: Object.create(null), length: 0 };
        ++entry.length;
      }
      entry = entry.entries[step];
    }
  }
  return map;
}

/**
 *
 * @param {CSN.Element} member The member
 * @returns {boolean} Whether the member is managed composition
 */
function isManagedComposition( member ) {
  if (member.targetAspect)
    return true;
  if (!member.target)
    return false;
  const target = typeof member.target === 'object' ? member.target : this.csnUtils.getCsnDef(member.target);
  return target.kind !== 'entity';
}


/**
 * All DB  & OData flat mode must reject recursive type usages in entities
 * 'items' break recursion as 'items' will turn into an NCLOB and the path
 * prefix to 'items' can be flattened in the DB.
 * In OData flat mode the first appearance of 'items' breaks out into structured
 * mode producing (legal) recursive complex types.
 *
 * @param {CSN.Artifact} art The artifact
 */
function checkRecursiveTypeUsage( art ) {
  const visit = (def) => {
    const loc = def.$path;
    // recursive types are allowed inside arrays
    if (def.items)
      return;
    let { type } = def;
    let prevType;
    let isDeref = false;
    if (type && !isBuiltinType(type) && !def.elements) {
      do {
        prevType = type;
        // TODO: `type.ref.length > 1`, but OData backend must be tested first (#5144)
        //  e.g. `{ ref: [ "MyType" ] }`
        if (type.ref) {
          def = this.artifactRef(type);
          isDeref = true;
        }
        else {
          def = this.csn.definitions[type];
        }
        type = def.type;
      } while (type && !isBuiltinType(type) && !def.items && !def.elements && prevType !== type);
    }
    if (def.$visited || (type && prevType === type)) {
      // Recursion via type is allowed in V4 struct, but not via dereferencing
      if (!isDeref && this.options.odataVersion === 'v4' && this.options.odataFormat === 'structured')
        return;
      if (!def.$recErr) {
        this.error(null, loc, {}, 'Unexpected recursive type definition');
        setProp(def, '$recErr', true);
      }
    }
    else if (def.elements) {
      setProp(def, '$visited', true);
      for (const n in def.elements)
        visit(def.elements[n]);
      delete def.$visited;
    }
  };
  // elements & params are flattening candidates
  // FUTURE:
  // Once we have universal CSN for the runtimes
  // Validate service members only for OData
  if (art.kind === 'entity') {
    for (const n in art.elements)
      visit(art.elements[n]);
    for (const n in art.params)
      visit(art.params[n]);
  }
  if (this.options.odataVersion) {
    // func/action params/returns don't allow recursive type derefs
    if (art.kind === 'action' || art.kind === 'function') {
      for (const n in art.params)
        visit(art.params[n]);
      if (art.returns)
        visit(art.returns);
    }
  }
}

/**
 * Member validator to check that certain annotations (@cds.valid { from, to, key }) are not
 * assigned to calculated elements in an entity.
 *
 * TODO: Allow @cds.valid on persisted calculated elements (when they become available).
 *
 * @param {CSN.Element} member the element to be checked
 * @param {string} _memberName the elements name
 * @param {string} _prop which kind of member are we looking at -> only prop "elements"
 * @param {CSN.Path} _path the path to the member
 */
function rejectAnnotationsOnCalcElement( member, _memberName, _prop, _path ) {
  if (this.artifact.kind === 'entity' && !(this.artifact.query && this.artifact.projection)) {
    if (member.value) {
      for (const anno in member) {
        if (anno.startsWith('@cds.valid.')) {
          this.error('anno-unexpected-temporal', member.$path, { anno },
                     'Unexpected $(ANNO) assigned to a calculated element');
        }
      }
    }
  }
}
module.exports = {
  checkPrimaryKey,
  checkVirtualElement,
  checkManagedAssoc,
  checkRecursiveTypeUsage,
  rejectAnnotationsOnCalcElement,
};
