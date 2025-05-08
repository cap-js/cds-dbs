// Generate: localized data and managed compositions

'use strict';

const {
  isDeprecatedEnabled,
  forEachGeneric, forEachDefinition,
} = require('../base/model');
const { dictAdd } = require('../base/dictionaries');
const {
  setLink,
  setArtifactLink,
  setAnnotation,
  linkToOrigin,
  setMemberParent,
  createAndLinkCalcDepElement,
  augmentPath,
  isDirectComposition,
  copyExpr,
} = require('./utils');
const { weakLocation, weakRefLocation, weakEndLocation } = require('../base/location');

const $location = Symbol.for( 'cds.$location' );

function generate( model ) {
  const { options } = model;
  // Get simplified "resolve" functionality and the message function:
  const {
    error, warning, info,
  } = model.$messageFunctions;
  const {
    resolvePath,
    resolveUncheckedPath,
    initArtifact,
    extendArtifactBefore,
    applyIncludes,
  } = model.$functions;
  model.$functions.hasTruthyProp = hasTruthyProp;

  const addTextsLanguageAssoc = checkTextsLanguageAssocOption( model, options );
  const useTextsAspect = checkTextsAspect();

  Object.keys( model.definitions ).forEach( processArtifact );

  compositionChildPersistence();
  return;

  /**
   * Process "composition of" artifacts.
   *
   * @param {string} name
   */
  function processArtifact( name ) {
    const art = model.definitions[name];
    if (!(art.$duplicates)) {
      processAspectComposition( art );
      if (art.kind === 'entity' && !art.query && art.elements)
        // check potential entity parse error
        processLocalizedData( art );
    }
  }

  /**
   * Copy `@cds.persistence.skip` and `@cds.persistence.skip` from parent to child
   * for managed compositions.  This needs to be done after extensions, i.e. annotations,
   * have been applied or `annotate E.comp` would not have an effect on `E.comp.subComp`.
   */
  function compositionChildPersistence() {
    const processed = new WeakSet();
    forEachDefinition( model, processCompositionPersistence );

    function processCompositionPersistence( def ) {
      if (def.$inferred === 'composition-entity' && !processed.has( def )) {
        if (def._parent)
          processCompositionPersistence( def._parent );
        copyPersistenceAnnotations( def, def._parent );
        processed.add( def );
      }
    }
  }

  /**
   * Check that special `sap.common.*` aspects for `.texts` entities are
   * consistent with compiler expectations.  Emits messages and returns
   * false if the aspects are not valid.
   *
   * @return {boolean}
   */
  function checkTextsAspect() {
    const textsAspect = model.definitions['sap.common.TextsAspect'];
    if (!textsAspect)
      return false;

    const specialElements = { locale: { key: true } };

    if (textsAspect.kind !== 'aspect' || !textsAspect.elements) {
      error( 'def-invalid-texts-aspect', [ textsAspect.name.location, textsAspect ],
             { '#': 'no-aspect', art: textsAspect } );
      return false;
    }

    let hasError = false;
    if (addTextsLanguageAssoc && textsAspect.elements.language) {
      const lang = textsAspect.elements.language;
      error( 'def-unexpected-element', [ lang.name.location, lang ],
             { option: 'addTextsLanguageAssoc', art: textsAspect, name: 'language' },
        // eslint-disable-next-line @stylistic/js/max-len
             '$(ART) is not used because option $(OPTION) conflicts with existing element $(NAME); remove either option or element' );
      hasError = true;
    }

    for (const name in specialElements) {
      const expected = specialElements[name];
      const elem = textsAspect.elements[name];
      if (!elem) {
        error( 'def-invalid-texts-aspect', [ textsAspect.name.location, textsAspect ],
               { '#': 'missing', art: textsAspect, name } );
        hasError = true;
      }
      else if (expected.key !== undefined && !!elem.key?.val !== expected.key) {
        const loc = elem.key?.location || elem.name?.location || textsAspect.name.location;
        error( 'def-invalid-texts-aspect', [ loc, elem ],
               { '#': expected.key ? 'key' : 'no-key', art: elem } );
        hasError = true;
      }
    }

    if (hasError) // avoid subsequent errors, if the special elements are already wrong
      return false;

    for (const name in textsAspect.elements) {
      const elem = textsAspect.elements[name];
      const include = elem.$inferred === 'include';
      if (!specialElements[name] && elem.key) {
        const loc = include ? elem.location : elem.key.location;
        error( 'def-unexpected-key', [ loc, elem ],
               { '#': !include ? 'std' : 'include', art: textsAspect } );
        hasError = true;
      }
      else if (hasTruthyProp( elem, 'localized' )) {
        // TODO: T:loc, i.e. "localized" from other type (needs resolver?)
        //       Not supported anyway, but important for recompilation (which fails correctly).
        const loc = elem.localized?.location || elem.location;
        error( 'def-unexpected-localized', [ loc, elem ],
               { '#': !include ? 'elements' : 'include', art: textsAspect } );
        hasError = true;
      }
      else if (elem.targetAspect) {
        error( 'def-unexpected-composition', [ elem.targetAspect.location, elem ],
               { art: textsAspect },
               '$(ART) can\'t have composition of aspects' );
        hasError = true;
      }
    }

    return !hasError;
  }

  // localized texts entities ---------------------------------------------------

  /**
   * Process localized data for `art`.  This includes creating `.texts` entities
   * and `locale` associations.
   *
   * @param {XSN.Artifact} art
   */
  function processLocalizedData( art ) {
    const fioriAnno = art['@fiori.draft.enabled'];
    const fioriEnabled = fioriAnno && (fioriAnno.val === undefined || fioriAnno.val);

    const textsName = `${ art.name.id }.texts`;
    const textsEntity = model.definitions[textsName];
    const localized = localizedData( art, textsEntity, fioriEnabled );
    if (!localized)
      return;
    if (textsEntity)            // expanded localized data in source
      return;                   // -> make it idempotent
    createTextsEntity( art, textsName, localized, fioriEnabled );
    addTextsAssociations( art, textsName, localized );
  }

  /**
   * Returns `false`, if there is no localized data or an array of elements
   * that are required for `.texts` entities such as keys and localized elements.
   *
   * @param {XSN.Artifact} art
   * @param {XSN.Artifact|undefined} textsEntity
   * @param {boolean} fioriEnabled
   * @returns {false|XSN.Element[]}
   */
  function localizedData( art, textsEntity, fioriEnabled ) {
    let keys = 0;
    const textElems = [];
    const conflictingElements = [];
    // These elements are required or the localized-mechanism does not work.
    // Other elements from sap.common.TextsAspect may be "overridden" as per
    // usual include-mechanism.
    const protectedElements = [ 'locale', 'texts', 'localized' ];
    if (fioriEnabled)
      protectedElements.push( 'ID_texts' );
    if (addTextsLanguageAssoc)
      protectedElements.push( 'language' );

    for (const name in art.elements) {
      const elem = art.elements[name];
      if (elem.$duplicates)
        return false;           // no localized-data unfold with redefined elems
      if (protectedElements.includes( name ))
        conflictingElements.push( elem );

      const isKey = elem.key && elem.key.val;
      const isLocalized = hasTruthyProp( elem, 'localized' );

      if (isKey) {
        keys += 1;
        textElems.push( elem );
      }
      else if (isLocalized) {
        textElems.push( elem );
      }

      if (isKey && isLocalized) {
        const errpos = elem.localized || elem.type || elem.name;
        warning( 'def-ignoring-localized', [ errpos.location, elem ],
                 { keyword: 'localized' },
                 'Keyword $(KEYWORD) is ignored for primary keys' );
        // continuation semantics as stated: counts as key field in texts entity
      }
    }
    if (textElems.length <= keys)
      return false;

    if (!keys) {
      warning( 'def-expecting-key', [ art.name.location, art ], {},
               'No texts entity can be created when no key element exists' );
      return false;
    }

    if (textsEntity) {
      if (textsEntity.$duplicates)
        return false;
      if (textsEntity.kind !== 'entity' || textsEntity.query ||
          // already have elements "texts" and "localized" (and optionally ID_texts)
          conflictingElements.length !== 2 || art.elements.locale ||
          (fioriEnabled && art.elements.ID_texts)) {
        // TODO if we have too much time: check all elements of texts entity for safety
        warning( null, [ art.name.location, art ], { art: textsEntity },
                 // eslint-disable-next-line @stylistic/js/max-len
                 'Texts entity $(ART) can\'t be created as there is another definition with that name' );
        info( null, [ textsEntity.name.location, textsEntity ], { art },
              'Texts entity for $(ART) can\'t be created with this definition' );
      }
      else if (!art._block || art._block.$frontend !== 'json') {
        info( null, [ art.name.location, art ], {},
              'Localized data expansions has already been done' );
        return textElems;       // make double-compilation even with after toHana
      }
      else if (!art._block.$withLocalized && !options.$recompile) {
        art._block.$withLocalized = true;
        // no semantic loc: message only emitted once
        info( 'def-unexpected-texts-entities', [ art.name.location, null ], {},
              'Input CSN contains expansions for localized data' );
        return textElems;       // make compilation idempotent
      }
      else {
        return textElems;
      }
    }
    for (const elem of conflictingElements) {
      warning( null, [ elem.name.location, art ], { name: elem.name.id },
               'No texts entity can be created when element $(NAME) exists' );
    }
    return !textsEntity && !conflictingElements.length && textElems;
  }

  /**
   * Create the `.texts` entity for the given base artifact.
   *
   * @param {XSN.Artifact} base
   * @param {string} absolute
   * @param {XSN.Element[]} textElems
   * @param {boolean} fioriEnabled
   */
  function createTextsEntity( base, absolute, textElems, fioriEnabled ) {
    const location = weakLocation( base.elements[$location] || base.location );
    const art = {
      kind: 'entity',
      name: { id: absolute, location },
      location,
      elements: Object.create( null ),
      $inferred: 'localized-entity',
    };
    setLink( art, '_block', model.$internal );
    model.definitions[absolute] = art;
    extendArtifactBefore( art ); // having extensions here would be wrong

    if (!fioriEnabled) {
      // To be compatible, we switch off draft without @fiori.draft.enabled
      setAnnotation( art, '@odata.draft.enabled', art.location, false );
    }
    else {
      const textId = {
        name: { location, id: 'ID_texts' },
        kind: 'element',
        key: { val: true, location },
        type: linkMainArtifact( location, 'cds.UUID' ),
        location,
      };
      dictAdd( art.elements, 'ID_texts', textId );
    }

    const enrich = useTextsAspect
      ? enrichTextsEntityWithInclude
      : enrichTextsEntityWithDefaultElements;
    enrich( art, base, absolute, fioriEnabled );

    if (addTextsLanguageAssoc) {
      const language = {
        name: { location, id: 'language' },
        kind: 'element',
        location,
        type: linkMainArtifact( location, 'cds.Association' ),
        target: linkMainArtifact( location, 'sap.common.Languages' ),
        on: {
          op: { val: '=', location },
          args: [
            { path: [ { id: 'language', location }, { id: 'code', location } ], location },
            { path: [ { id: 'locale', location } ], location },
          ],
          location,
        },
      };
      setLink( language, '_block', model.$internal );
      dictAdd( art.elements, 'language', language );
    }

    // assertUnique array value, first entry is 'locale'
    const assertUniqueValue = [];

    for (const orig of textElems)
      addElementToTextsEntity( orig, art, fioriEnabled, assertUniqueValue );

    initArtifact( art );
    if (art.includes) {
      // add elements `locale`, etc. which are required below.
      applyIncludes( art, art ); // TODO: rethink - can we avoid this if only new extend?
    }

    if (fioriEnabled) {
      // The includes mechanism puts TextsAspect's elements before .texts' elements.
      // Because ID_texts is not copied from TextsAspect, the order is messed
      // up.  Fix it.  TODO: introduce $includeAfter from Extensions.md
      const { elements } = art;
      art.elements = Object.create( null );
      const names = [ 'ID_texts', 'locale', ...Object.keys( elements ) ];
      for (const name of names)
        art.elements[name] = elements[name];

      const { locale } = art.elements;
      assertUniqueValue.unshift({
        path: [ { id: locale.name.id, location: locale.location } ],
        location: locale.location,
      });
      setAnnotation( art, '@assert.unique.locale', art.location, assertUniqueValue, 'array' );
    }

    copyPersistenceAnnotations( art, base );
    return art;
  }

  function addElementToTextsEntity( orig, art, fioriEnabled, assertUniqueValue ) {
    const elem = linkToOrigin( orig, orig.name.id, art, 'elements' );
    // To keep the locations of non-inferred original elements, do not set $inferred:
    if (orig.$inferred)
      elem.$inferred = 'localized-origin';
    const { location } = elem;
    if (orig.key && orig.key.val) {
      // elem.key = { val: fioriEnabled ? null : true, $inferred: 'localized', location };
      // TODO: the previous would be better, but currently not supported in toCDL
      if (!fioriEnabled) {
        elem.key = { val: true, $inferred: 'localized', location };
        // If the propagated elements remain key (that is not fiori.draft.enabled)
        // they should be omitted from OData containment EDM
        setAnnotation( elem, '@odata.containment.ignore', location );
      }
      else {
        // add the former key paths to the unique constraint
        assertUniqueValue.push( { path: [ { id: orig.name.id, location } ], location } );
      }
    }
    if (hasTruthyProp( orig, 'localized' )) { // use location of LOCALIZED keyword
      elem.localized = { val: null, $inferred: 'localized', location };
    }
  }

  /**
   * Enrich the `.texts` entity for the given base artifact.
   * In contrast to createTextsEntityWithDefaultElements(), this one creates
   * an include for `sap.common.TextsAspect`.
   *
   * Does NOT apply the include!
   *
   * @param {XSN.Artifact} art
   * @param {XSN.Artifact} base
   * @param {string} absolute
   * @param {boolean} fioriEnabled
   */
  function enrichTextsEntityWithInclude( art, base, absolute, fioriEnabled ) {
    const textsAspectName = 'sap.common.TextsAspect';
    const textsAspect = model.definitions['sap.common.TextsAspect'];
    const { location } = art;

    art.includes = [ createInclude( textsAspectName, location ) ];

    if (fioriEnabled) {
      // "Early" include; only for element `locale`, which has its `key` property
      // removed (or rather: it is not copied).
      linkToOrigin( textsAspect.elements.locale, 'locale', art, 'elements', location );
      art.elements.locale.$inferred = 'localized';
    }

    if (addTextsLanguageAssoc && art.elements.language)
      art.elements.language = undefined; // TODO: Message? Ignore?
    // TODO: what is this necessary?  We do not create a text entity in this case
  }

  /**
   * @param {XSN.Artifact} art
   * @param {XSN.Artifact} base
   * @param {string} absolute
   * @param {boolean} fioriEnabled
   */
  function enrichTextsEntityWithDefaultElements( art, base, absolute, fioriEnabled ) {
    // If there is a type `sap.common.Locale`, then use it as the type for the element `locale`.
    // If not, use the default `cds.String` with a length of 14.
    const hasLocaleType = model.definitions['sap.common.Locale']?.kind === 'type';
    const { location } = art;   // is already a weak location
    const locale = {
      name: { location, id: 'locale' },
      kind: 'element',
      type: linkMainArtifact( location, hasLocaleType ? 'sap.common.Locale' : 'cds.String' ),
      location,
      $inferred: 'localized',   // $generated in Universal CSN, no $location
    };
    if (!hasLocaleType)
      locale.length = { literal: 'number', val: 14, location };

    if (!fioriEnabled)
      locale.key = { val: true, location };
    dictAdd( art.elements, 'locale', locale );
  }

  /**
   * @param {XSN.Artifact} art
   * @param {string} textsName
   * @param {XSN.Element[]} textElems
   */
  function addTextsAssociations( art, textsName, textElems ) {
    // texts : Composition of many Books.texts on texts.ID=ID;
    /** @type {array} */
    const keys = textElems.filter( e => e.key && e.key.val );
    const location = weakEndLocation( art.elements[$location] ) || weakLocation( art.location );
    const texts = {
      name: { location, id: 'texts' },
      kind: 'element',
      location,
      $inferred: 'localized',
      type: linkMainArtifact( location, 'cds.Composition' ),
      cardinality: { targetMax: { literal: 'string', val: '*', location }, location },
      target: linkMainArtifact( location, textsName ),
      on: augmentEqual( location, 'texts', keys ),
    };
    setMemberParent( texts, 'texts', art, 'elements' );
    setLink( texts, '_block', model.$internal );
    // localized : Association to Books.texts on
    //             localized.ID=ID and localized.locale = $user.locale;
    keys.push( [ 'localized.locale', '$user.locale' ] );
    const localized = {
      name: { location, id: 'localized' },
      kind: 'element',
      location,
      $inferred: 'localized',
      type: linkMainArtifact( location, 'cds.Association' ),
      target: linkMainArtifact( location, textsName ),
      on: augmentEqual( location, 'localized', keys ),
    };
    setMemberParent( localized, 'localized', art, 'elements' );
    setLink( localized, '_block', model.$internal );
  }

  /**
   * Create a structure that can be used as an item in `includes`.
   *
   * @param {string} name
   * @param {XSN.Location} location
   */
  function createInclude( name, location ) {
    const include = {
      path: [ { id: name, location } ],
      location,
    };
    setArtifactLink( include.path[0], model.definitions[name] );
    setArtifactLink( include, model.definitions[name] );
    return include;
  }

  /**
   * Returns whether `art` directly or indirectly has the property 'prop',
   * following the 'origin' and the 'type' (not involving elements).
   *
   * DON'T USE FOR ANNOTATIONS (see TODO below)
   *
   * TODO: we should issue a warning if we get localized via TYPE OF
   * TODO: XSN: for anno short form, use { val: true, location, <no literal prop> }
   *       ...then this function also works with annotations
   *
   * @param {XSN.Artifact} art
   * @param {string} prop
   * @returns {boolean}
   */
  function hasTruthyProp( art, prop ) {
    const processed = Object.create( null ); // avoid infloops with circular refs
    let name = (art._main || art).name.id; // is ok, since no recursive type possible
    while (art && !processed[name]) {
      if (art[prop])
        return art[prop].val;
      processed[name] = art;
      if (art._origin) {
        art = art._origin;
        if (!art.name)          // anonymous aspect
          return false;
        name = (art._main || art)?.name?.id;
      }
      else if (art.type) {
        // TODO: also do something special for TYPE OF inside `art`s own elements
        // TODO: check for own - add test case with Type:elem (not TYPE OF elem)
        name = resolveUncheckedPath( art.type, 'type', art );
        art = name && model.definitions[name];
      }
      else {
        return false;
      }
    }
    return false;
  }

  // managed composition of aspects ------------------------------------------

  function processAspectComposition( base ) {
    // TODO: we need to forbid COMPOSITION of entity w/o keys and ON anyway
    // TODO: consider entity includes
    // TODO: nested containment
    // TODO: better do circular checks in the aspect!
    if (base.kind !== 'entity' || base.query)
      return;
    const keys = baseKeys();
    if (keys)
      forEachGeneric( base, 'elements', expand ); // TODO: recursively here?
    return;

    function baseKeys() {
      const k = Object.create( null );
      for (const name in base.elements) {
        const elem = base.elements[name];
        if (elem.$duplicates)
          return false;           // no composition-of-type unfold with redefined elems
        if (elem.key?.val)
          k[name] = elem;
      }
      return k;
    }

    function expand( elem ) {
      if (elem.target)
        return;
      let origin = elem;
      // included element do not have target aspect directly
      while (origin && !origin.targetAspect && origin._origin)
        origin = origin._origin;
      let target = origin.targetAspect;
      if (target?.path)
        target = resolvePath( origin.targetAspect, 'targetAspect', origin );
      if (!target || !target.elements)
        return;
      const entityName = `${ base.name.id }.${ elem.name.id }`;
      const entity = allowAspectComposition( target, elem, keys, entityName ) &&
            createTargetEntity( target, elem, keys, entityName, base );
      elem.target = {
        location: (elem.targetAspect || elem).location,
        $inferred: 'aspect-composition',
      };
      setArtifactLink( elem.target, entity );
      if (entity) {
        // Support using the up_ element in the generated entity to be used
        // inside the anonymous aspect:
        const { up_ } = target.$tableAliases;
        // TODO: invalidate "up_" alias (at least further navigation) if it
        // already has an _origin (when the managed composition is included)
        if (up_)
          setLink( up_, '_origin', entity.elements.up_ );
        model.$compositionTargets[entity.name.id] = true;
        processAspectComposition( entity );
        processLocalizedData( entity );
      }
    }
  }

  /**
   * @returns {boolean|0} `true`, if allowed, `false` if forbidden, `0` if circular containment.
   */
  function allowAspectComposition( target, elem, keys, entityName ) {
    if (!target.elements || Object.values( target.elements ).some( e => e.$duplicates ))
      return false;             // no elements or with redefinitions
    const location = elem.targetAspect?.location || elem.location;
    if ((elem._main._upperAspects || []).includes( target ))
      return 0;               // circular containment of the same aspect

    const keyNames = Object.keys( keys );
    if (!keyNames.length) {
      // TODO: for "inner aspect-compositions", signal already in type
      error( null, [ location, elem ], { target },
             'An aspect $(TARGET) can\'t be used as target in an entity without keys' );
      return false;
    }
    // if (keys.up_) {  // only to be tested if we allow to provide a prefix, which could be ''
    //   // Cannot be in an "inner aspect-compositions" as it would already be wrong before
    //   // TODO: if anonymous type, use location of "up_" element
    //   // FUTURE: add sub info with location of "up_" element
    //   message( 'id', [location, elem], { target, name: 'up_' }, 'Error',
    //      'An aspect $(TARGET) can't be used as target in an entity with a key named $(NAME)' );
    //   return false;
    // }
    if (target.elements.up_) {
      // TODO: for "inner aspect-compositions", signal already in type
      // TODO: if anonymous type, use location of "up_" element
      // FUTURE: if named type, add sub info with location of "up_" element
      error( null, [ location, elem ], { target, name: 'up_' },
             'An aspect $(TARGET) with an element named $(NAME) can\'t be used as target' );
      return false;
    }
    if (model.definitions[entityName]) {
      error( null, [ location, elem ], { art: entityName },
             // eslint-disable-next-line @stylistic/js/max-len
             'Target entity $(ART) can\'t be created as there is another definition with this name' );
      return false;
    }
    const names = Object.keys( target.elements )
      .filter( n => n.startsWith( 'up__' ) && keyNames.includes( n.substring(4) ) );
    if (names.length) {
      // FUTURE: if named type, add sub info with location of "up_" element
      error( null, [ location, elem ], { target: entityName, names }, {
        std: 'Key elements $(NAMES) can\'t be added to $(TARGET) as these already exist',
        one: 'Key element $(NAMES) can\'t be added to $(TARGET) as it already exist',
      } );
      return false;
    }

    if (elem.type && !isDirectComposition( elem )) {
      // Only issue warning for direct usages, not for projections, includes, etc.
      // TODO: Make it configurable error; v6: error
      // TODO: move to resolve.js where we test the targetAspect,
      warning( 'type-expecting-composition', [ elem.type.location, elem ],
               { newcode: 'Composition of', code: 'Association to' },
               'Expecting $(NEWCODE), not $(CODE) for the anonymous target aspect' );
      // auto-correct to avoid additional error 'type-unexpected-target-aspect' if
      // cds.Association:
      const { path, $inferred } = elem.type;
      if (!$inferred && path?.length === 1 && path[0].id === 'cds.Association')
        path[0].id = 'cds.Composition';
    }

    return true;
  }

  function createTargetEntity( target, elem, keys, entityName, base ) {
    const location = weakRefLocation( elem.targetAspect || elem.target || elem );
    elem.on = {
      location,
      op: { val: '=', location },
      args: [
        augmentPath( location, elem.name.id, 'up_' ),
        augmentPath( location, '$self' ),
      ],
      $inferred: 'aspect-composition',
    };

    const art = {
      kind: 'entity',
      name: {
        id: entityName,
        // for code navigation (e.g. via `extend`s): point to the element's name
        location: weakLocation( elem.name.location ),
      },
      location,
      elements: Object.create( null ),
      $inferred: 'composition-entity',
    };
    if (target.name) {          // named target aspect
      if (!isDeprecatedEnabled( options, 'noCompositionIncludes' ))
        art.includes = [ createInclude( target.name.id, location ) ];
      setLink( art, '_origin', target );
      setLink( art, '_upperAspects', [ target, ...(elem._main._upperAspects || []) ] );
    }
    else {
      setLink( art, '_origin', target );
      // TODO: do we need to give the anonymous target aspect a kind and name?
      setLink( art, '_upperAspects', elem._main._upperAspects || [] );
    }

    // Since there is no user-written up_ element, use a weak location to the beginning of {…}.
    const up = { // elements.up_ = ...
      name: { location, id: 'up_' },
      kind: 'element',
      location,
      $inferred: 'aspect-composition',
      type: linkMainArtifact( location, 'cds.Association' ),
      target: linkMainArtifact( location, base.name.id ),
      cardinality: {
        targetMin: { val: 1, literal: 'number', location },
        targetMax: { val: 1, literal: 'number', location },
        location,
      },
    };

    up.key = { location, val: true };
    // managed associations must be explicitly set to not null
    // even if target cardinality is 1..1
    up.notNull = { location, val: true };

    dictAdd( art.elements, 'up_', up );
    // Only for named aspects, use a new location; otherwise use the origin's one.

    // To keep the locations of non-inferred original elements, do not set $inferred:
    const enforceLocation = target.name || elem.$inferred;
    addProxyElements( art, target.elements, 'aspect-composition', enforceLocation && location );

    setLink( art, '_block', model.$internal );
    model.definitions[entityName] = art;
    initArtifact( art );

    // Apply annotations to generated artifact, prepare (not apply!) element
    // annotations (remark: adding elements is not allowed for generated artifacts):
    extendArtifactBefore( art );
    // Copy persistence annotations from aspect.
    copyPersistenceAnnotations( art, target ); // after extendArtifactBefore()

    if (!isDeprecatedEnabled( options, 'noCompositionIncludes' ) && art.includes)
      applyIncludes( art, art ); // for actions
    return art;
  }

  function addProxyElements( proxyDict, elements, inferred, location, prefix = '', anno = '' ) {
    // TODO: also use for includeMembers()? Both are similar. Combine?
    for (const name in elements) {
      const pname = `${ prefix }${ name }`;
      const origin = elements[name];
      const proxy = linkToOrigin( origin, pname, null, null, location, true );
      setLink( proxy, '_block', origin._block );
      if (location)
        proxy.$inferred = inferred;
      if (origin.masked)
        proxy.masked = Object.assign( { $inferred: 'include' }, origin.masked );
      if (origin.key)
        proxy.key = Object.assign( { $inferred: 'include' }, origin.key );
      if (origin.value && origin.$syntax === 'calc') {
        // TODO: If paths become invalid in the new artifact, should we mark
        //       all usages in the expressions? Possibly just the first one?
        // TODO: Unify with coding in extend.js
        proxy.value = Object.assign( { $inferred: 'include' }, copyExpr( origin.value ));
        proxy.$syntax = 'calc';
        createAndLinkCalcDepElement( proxy );
        // TODO: re-check _calcOrigin
        setLink( proxy, '_calcOrigin', origin._calcOrigin || origin );
      }
      if (anno)
        setAnnotation( proxy, anno );
      dictAdd( proxyDict.elements, pname, proxy );
    }
  }

  /**
   * Copy relevant annotations from
   * source to target if present on source but not target.
   *
   * @param {object} target
   * @param {object} source
   */
  function copyPersistenceAnnotations( target, source ) {
    if (!source)
      return;

    // Copied since v6
    const copyJournal = !isDeprecatedEnabled( options, 'noPersistenceJournalForGeneratedEntities' );
    if (copyJournal)
      copy( '@cds.persistence.journal' );

    const copyExists = !isDeprecatedEnabled( options, '_eagerPersistenceForGeneratedEntities' );
    if (copyExists)
      copy( '@cds.persistence.exists' );
    copy( '@cds.persistence.skip' );
    copy( '@cds.tenant.independent' );

    /** @param {string} anno */
    function copy( anno ) {
      if ( source[anno] && !target[anno] )
        target[anno] = { ...source[anno], $inferred: 'parent-origin' };
    }
  }

  function linkMainArtifact( location, absolute ) {
    const r = { location, path: [ { id: absolute, location } ] };
    setArtifactLink( r, model.definitions[absolute] );
    return r;
  }
}

function augmentEqual( location, assocname, relations, prefix = '' ) {
  const args = relations.map( eq );
  return (args.length === 1)
    ? args[0]
    : { op: { val: 'and', location }, args, location };

  function eq( refs ) {
    if (Array.isArray( refs ))
      return { op: { val: '=', location }, args: refs.map( ref ), location };

    const { id } = refs.name;
    return {
      op: { val: '=', location },
      args: [
        { path: [ { id: assocname, location }, { id, location } ], location },
        { path: [ { id: `${ prefix }${ id }`, location } ], location },
      ],
      location,
    };
  }
  function ref( path ) {
    return { path: path.split( '.' ).map( id => ({ id, location }) ), location };
  }
}

function checkTextsLanguageAssocOption( model, options ) {
  const languages = model.definitions['sap.common.Languages'];
  const commonLanguagesEntity = options.addTextsLanguageAssoc && languages?.elements?.code;

  if (options.addTextsLanguageAssoc && !commonLanguagesEntity) {
    const variant = !languages ? 'std' : 'code';
    const loc = model.definitions['sap.common.Languages']?.name?.location || null;
    model.$messageFunctions.info( 'api-ignoring-language-assoc', loc, {
      '#': variant, option: 'addTextsLanguageAssoc', art: 'sap.common.Languages', name: 'code',
    }, {
      std: 'Ignoring option $(OPTION) because entity $(ART) is missing',
      code: 'Ignoring option $(OPTION) because entity $(ART) is missing element $(NAME)',
    } );
  }

  return !!commonLanguagesEntity;
}


module.exports = generate;
