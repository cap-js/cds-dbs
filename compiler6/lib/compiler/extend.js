// Extend

'use strict';

const { weakRefLocation } = require('../base/location');
const { searchName } = require('../base/messages');
const {
  forEachInOrder,
  forEachDefinition,
  forEachMember,
  forEachGeneric,
  isDeprecatedEnabled,
} = require('../base/model');
const { dictAdd, pushToDict } = require('../base/dictionaries');
const { kindProperties, dictKinds } = require('./base');
const {
  setLink,
  setArtifactLink,
  copyExpr,
  setExpandStatusAnnotate,
  linkToOrigin,
  createAndLinkCalcDepElement,
  dependsOnSilent,
  pathName,
  annotationHasEllipsis,
} = require('./utils');
const layers = require('./moduleLayers');
const { CompilerAssertion } = require('../base/error');
const { Location } = require('../base/location');
const { typeParameters } = require('./builtins');

const $location = Symbol.for( 'cds.$location' );

// attach stupid location - TODO: remove in v6
const genLocation = new Location( '' );

const draftElements = [
  'IsActiveEntity',
  'HasActiveEntity',
  'HasDraftEntity',
  'DraftAdministrativeData',
  'SiblingEntity',
];
const draftBoundActions = [
  'draftPrepare',
  'draftActivate',
  'draftEdit',
];

function canBeDraftMember( name, parent, draftMembers ) {
  return parent?.kind === 'entity' && parent._service && draftMembers.includes( name );
}

function extend( model ) {
  // Get simplified "resolve" functionality and the message function:
  const {
    message, error, warning, info,
  } = model.$messageFunctions;
  const {
    resolvePath,
    resolveUncheckedPath,
    resolveTypeArgumentsUnchecked,
    resolveDefinitionName,
    attachAndEmitValidNames,
    initMembers,
    initSelectItems,
  } = model.$functions;

  Object.assign( model.$functions, {
    createRemainingAnnotateStatements,
    extendArtifactBefore,
    extendArtifactAfter,
    extendForeignKeys,
    applyIncludes,              // TODO: re-check
  } );

  const includesNonShadowedFirst
      = isDeprecatedEnabled( model.options, '_includesNonShadowedFirst' );

  sortModelSources();
  const extensionsDict = Object.create( null ); // TODO TMP
  forEachDefinition( model, tagIncludes ); // TODO TMP

  forEachDefinition( model, extendArtifactBefore );
  applyExtensions();            // old-style
  return;

  // TMP:
  function tagIncludes( art ) {
    if (art.includes)
      extensionsDict[art.name.id] = [];
  }

  //-----------------------------------------------------------------------------
  // Extensions: general algorithm
  //-----------------------------------------------------------------------------
  // extendArtifactBefore, extendArtifactAfter, createRemainingAnnotateStatements,
  // extendForeignKeys

  /**
   * Goes through all (applied) annotations in the given artifact and chooses one
   * if multiple exist according to the module layer.
   * TODO: update comment if extension algorithm is finished
   *
   * @param {XSN.Artifact} art
   */
  function extendArtifactBefore( art ) {
    // for main artifacts, move extensions from `$collectedExtensions` model dictionary:
    if (!art._main && !art._outer && art._extensions === undefined &&
        art.name && // TODO: probably just a workaround, check with TODO in getOriginRaw()
        art.kind !== 'namespace') {
      const { id } = art.name;
      setLink( art, '_extensions', model.$collectedExtensions[id]?._extensions || null );
      if (art._extensions && !art.builtin) { // keep extensions for builtin in $collectedExtensions
        delete model.$collectedExtensions[id];
        // TODO: if the extension mechanism has been completed, we could uncomment:
        // art._extensions.forEach( ext => resolvePath( ext.name, ext.kind, ext )); // for LSP
        // for now, we do that at the end of createRemainingAnnotateStatements()
      }
    }
    if (art._extensions) {
      // TODO: the following function can now be simplified
      // if (art.$inferred) console.log('CAI:', art.name, art.$inferred,art._extensions)
      // With extensions, member appears in CSN, affects directly the rendering of
      // elements etc.  TODO: do that more specifically on the dicts (via symbol)
      // Probably better: we could use the _extensions dict prop directly in to-csn
      if (art.$inferred)
        setExpandStatusAnnotate( art, 'annotate' );
      if (Array.isArray( art._extensions )) {
        checkExtensionsKind( art._extensions, art ); // TODO: check with builtins
        transformArtifactExtensions( art );
      }
      applyAllExtensions( art );
    }
  }

  // TODO: assert that we have not yet transformed/used _extensions on sub elements
  // TODO necessary(?): transformArtifactExtensions must ensure that each annotate
  // is in either returns,items,elements,enum
  function extendArtifactAfter( art ) {
    const extensionsMap = art._extensions;
    if (!extensionsMap || art.builtin) // builtin members handled via "super annotate"
      return;
    // type extensions after having “populated” the artifact ($typeArgs -> length,
    // …, TODO: do that there) and setting an _effectiveType:
    if (art.$typeExts) {
      const { type } = art;     // if the type is not inferred, it is the origin...
      if (type?._artifact && !type.$inferred) // ...and thus is resolved
        resolveTypeArgumentsUnchecked( art, type._artifact, art );
      const exts = art.$typeExts;
      applyTypeExtensions( art, exts.length, 'length' );
      const scaleDiff = applyTypeExtensions( art, exts.scale, 'scale' );
      applyTypeExtensions( art, exts.precision, 'precision', scaleDiff );
      applyTypeExtensions( art, exts.srid, 'srid' );
      checkPrecisionScaleExtension( art, exts );

      delete art.$typeExts;
    }

    if (art.kind === 'annotate' && !art.returns && extensionsMap.returns && !art._parent?.returns)
      annotateCreate( art, '', art, 'returns' );

    moveDictExtensions( art, extensionsMap, 'actions' );
    moveDictExtensions( art, extensionsMap, 'params' );
    moveReturnsExtensions( art, extensionsMap );

    if (art.returns) {
      ensureArtifactNotProcessed( art.returns );
      pushToDict( art.returns, '_extensions', ...extensionsMap.elements || [] );
      pushToDict( art.returns, '_extensions', ...extensionsMap.enum || [] );
      if (art.kind !== 'annotate') {
        extendHandleReturns( extensionsMap.elements, art );
        extendHandleReturns( extensionsMap.enum, art );
        return;
      }
    }
    const sub = art.items || art.targetAspect?.elements && art.targetAspect;
    if (sub) {
      ensureArtifactNotProcessed( sub );
      pushToDict( sub, '_extensions', ...extensionsMap.elements || [] );
      pushToDict( sub, '_extensions', ...extensionsMap.enum || [] );
    }
    else {
      let elementsProp = 'elements';
      if (art.kind !== 'annotate')
        elementsProp = art.enum && 'enum' || art.target && 'foreignKeys' || 'elements';

      // keys are handled in tweak-assocs.js; don't push them down; see extendForeignKeys()
      if (elementsProp !== 'foreignKeys')
        moveDictExtensions( art, extensionsMap, elementsProp, 'elements' );
      moveDictExtensions( art, extensionsMap, 'enum' );
    }
  }

  /**
   * Apply foreign key extensions.  Because foreign keys are handled late in the compiler
   * (in tweak-assocs.js), we can't apply them in effectiveType(), yet.
   * Instead, we postpone applying them until all foreign keys were generated.
   *
   * @param art
   */
  function extendForeignKeys( art ) {
    // See extendArtifactAfter() for targetAspect/items handling.
    if (!art._extensions || art.items || art.targetAspect?.elements)
      return;

    // push down foreign keys
    moveDictExtensions( art, art._extensions, 'foreignKeys', 'elements' );
    if (!art.foreignKeys)
      return;

    forEachGeneric(art, 'foreignKeys', (key) => {
      if (!key._effectiveType)
        throw new CompilerAssertion('foreign key should have been processed');
      extendArtifactBefore( key );
      extendArtifactAfter( key );
    });
  }

  /**
   * Applying extensions is handled in extendArtifactAfter(). And only afterward,
   * an effective sequence number is set.  Meaning that if a sub-artifact already
   * has a sequence number, then extensions would be lost.
   *
   * A special case are foreign keys, see extendForeignKeys().
   */
  function ensureArtifactNotProcessed( art ) {
    if (!model.options.testMode)
      return;

    if (art.kind !== 'key' && art.$effectiveSeqNo !== 0 && art.$effectiveSeqNo !== undefined) {
      // if the artifact already has a sequence number, then
      // extendArtifactAfter() was already called -> annotations would be lost.
      throw new CompilerAssertion('artifact already processed; extensions would be lost');
    }
  }

  /**
   * Create super annotate statements for remaining extensions
   */
  function createRemainingAnnotateStatements() {
    model.extensions = Object.values( model.$collectedExtensions );
    // TODO: testMode sort?
    model.extensions.forEach( createSuperAnnotate );
    // set _artifact links for “main extensions” late as it would disturb the
    // still existing old extend mechanism, see extendArtifactBefore(),
    // needed for LSP and friends:
    Object.values( model.sources ).forEach( setArtifactLinkForExtensions );
    Object.values( model.definitions ).forEach( setArtifactLinkForExtensions );
  }

  // TODO: delete again - if not, what about extensions in contexts/services?
  //       Check test.lsp-api.js! Links in extensions are needed.
  function setArtifactLinkForExtensions( source ) {
    if (!source.extensions)
      return;
    for (const ext of source.extensions) {
      if (!ext.name?.id)
        continue;

      const { name } = ext;
      const { path } = name;
      if (name._artifact === undefined) {
        const refCtx = (name.id.startsWith( 'localized.' )) ? '_extensions' : ext.kind;
        resolvePath( name, refCtx, ext ); // for LSP
      }
      else if (model.options.lspMode && path?.[0]._artifact === undefined) {
        // we don't use resolvePath(…,'extend'), as that would add a dependency
        resolveDefinitionName( ext );
        setArtifactLink( path[path.length - 1], name._artifact );
      }
    }
  }

  // For extendArtifactBefore(): ------------------------------------------------

  function checkExtensionsKind( extensions, art ) {
    for (const ext of extensions) {
      const kind = ext.expectedKind?.val;
      if (kind && kind !== art.kind) {
        const loc = ext.expectedKind.location;
        if (kind === 'context' || kind === 'service') {
          // We have no real artifact during the construction of a super-annotate statement:
          const msgArgs = {
            '#': (art.kind === 'service' || art.kind === 'annotate') ? art.kind : 'std',
            art,
            kind,
            code: 'extend … with definitions',
            keyword: 'extend service',
          };
          // TODO(v6): Discuss: make this an error?
          warning( 'ext-invalid-kind', [ loc, ext ], msgArgs, {
            std: 'Artifact $(ART) is not of kind $(KIND), use $(CODE) instead',
            annotate: 'There is no artifact $(ART), use $(CODE) instead',
            // do not mention 'extend context', that is not in CAPire
            service: 'Artifact $(ART) is not of kind $(KIND), use $(CODE) or $(KEYWORD) instead',
          } );
        }
        // TODO: Use similar checks for EXTEND ENTITY etc - 'ext-ignoring-kind'
      }
    }
  }

  // TODO: if extensions has more than one of returns,items,elements,enum, delete all those props
  function transformArtifactExtensions( art ) {
    const hasOnlySubExtensions = art._outer; // items, anonymous aspects
    const dict = Object.create( null );
    for (const ext of art._extensions) {
      for (const prop in ext) {
        if (ext[prop] === undefined) // deleted property
          continue;
        // TODO: do this check nicer (after complete move to new extensions mechanism)
        if (prop.charAt(0) === '@' || prop === 'doc' ||
            prop === 'includes' || prop === 'columns' ||
            prop === 'length' || prop === 'scale' || prop === 'precision' || prop === 'srid') {
          if (!hasOnlySubExtensions)
            pushToDict( dict, prop, ext );
        }
        else if (prop === 'elements' || prop === 'enum' || prop === 'actions' ||
                 prop === 'params' || prop === 'returns') {
          if (ext.kind === 'extend')
            pushToDict( dict, 'includes', ext );
          pushToDict( dict, prop, ext );
        }
      }
    }
    art._extensions = dict;
  }

  /**
   * Sort sources according to the reversed layered extension order without
   * reporting any messages.
   *
   * The order of the CSN property `$sources` (from XSN `_sortedSources`) is
   * defined as follows: for _any_ model
   *
   *  - add `type $Sources: String @(Names: []);` to one of the source files
   *  - add `annotate $Sources with @Names: [..., ‹sourceName›]` to each source
   *    file where ‹sourceName› is the file name of the source
   *  - then the array value of `‹csn›.$sources` is the reverse of the array value
   *    of `‹csn›.definitions.$Sources.@Names`
   */
  function sortModelSources() {
    const scheduled = [];
    const layered = layeredExtensions( Object.values( model.sources ) );
    for (;;) {
      const { highest } = extensionsOfHighestLayers( layered );
      if (!highest.length)
        break;
      highest.reverse();
      scheduled.push( ...highest );
    }
    setLink( model, '_sortedSources', scheduled );
  }

  function applyAllExtensions( art ) {
    const extensions = art._extensions;
    for (const prop in extensions) {
      // TODO: do the following `if` in a nicer way
      if ([ 'elements', 'enum', 'actions', 'params', 'returns' ].includes( prop ))
        continue;               // currently just annotates on sub elements - TODO: error here
      // annotations, `doc`, `includes`, `columns`, `length`, ...
      const scheduled = [];
      // sort extensions according to layer (specified elements are bottom layer):
      const layered = layeredExtensions( extensions[prop] );

      let cont = true;
      while (cont) {
        const { highest, issue } = extensionsOfHighestLayers( layered );
        // console.log( 'CA:', annoName, issue, extensions)
        let index = highest.length;
        cont = !!index;         // safety
        while (--index >= 0) {
          const ext = highest[index];
          scheduled.push( ext );
          if (extensionOverwrites( ext, prop )) {
            cont = false;
            break;
          }
        }
        if (issue || index > 0)
          reportDuplicateExtensions( highest, prop, issue, index, art );
      }
      // Now apply the relevant extensions
      scheduled.reverse();
      for (const ext of scheduled)
        applySingleExtension( art, ext, prop );
      delete extensions[prop];
    }
  }

  function extensionOverwrites( ext, prop ) {
    return (prop.charAt(0) !== '@')
      ? (prop === 'doc' || typeParameters.list.includes(prop))
      : !annotationHasEllipsis( ext[prop] );
  }

  // TODO: still a bit annotation assignment specific
  function reportDuplicateExtensions( extensions, prop, issue, index, art ) {
    // TODO: think about messages for these
    if (prop === 'elements' || prop === 'enum' || prop === 'actions' || prop === 'columns' ||
        prop === 'params' || prop === 'returns' || prop === 'includes' )
      return;                   // extensions currently handled extra
    if (issue) {
      // eslint-disable-next-line no-nested-ternary
      let msg = (index < 0)
        ? 'anno-unstable-array'
        : (issue === true)
          ? 'anno-duplicate'
          : 'anno-duplicate-unrelated-layer';
      if (prop.charAt(0) !== '@' && prop !== 'doc') {
        msg = (issue === true)
          ? 'ext-duplicate-extend-type'
          : 'ext-duplicate-extend-type-unrelated-layer';
        // not sure whether to repeat the extended artifact in the message (we
        // have the semantic location, after all)
      }
      const variant = prop === 'doc' ? 'doc' : 'std';
      for (const ext of extensions) {
        const anno = ext[prop];
        if (anno && !anno.$errorReported) {
          message( msg, [ anno.name?.location || anno.location, ext ],
                   { '#': variant, anno: prop, type: art } );
        }
      }
    }
    else if (index > 0) {     // more than one set (not just ...)
      const variant = prop === 'doc' ? 'doc' : 'std';
      const msgid = (prop.charAt(0) === '@' || prop === 'doc')
        ? 'anno-duplicate-same-file' // TODO: always ext-duplicate-…
        : 'ext-duplicate-same-file';
      while (index >= 0) {    // do not report for trailing [...]
        const ext = extensions[index--];
        const anno = ext[prop];
        warning( msgid, [ anno.name?.location || anno.location, ext ],
                 { '#': variant, prop, anno: prop } );
      }
    }
  }

  function applySingleExtension( art, ext, prop ) {
    if (prop === 'includes') {
      if (ext.kind === 'extend' && art.$inferred) {
        error( 'extend-for-generated', [ ext.name.location, ext ], { art, keyword: 'extend' },
               'You can\'t use $(KEYWORD) on the generated $(ART)' );
      }
      else if (art.kind !== 'annotate' && !art._outer) { // not with elem extension in targetAspect
        const { id } = art.name;
        const dict = extensionsDict[id] || (extensionsDict[id] = []);
        dict.push( ext ); // TODO: change
        // console.log( 'ASI:',prop,art.name,ext,extensionsDict[id])
      }
      // art[prop] = (art[prop]) ? art[prop].concat( ext[prop] ) : ext[prop];
    }
    else if (prop === 'columns') {
      const { query } = art;
      for (const col of ext.columns)
        col.$extended = true;

      if (art.kind === 'annotate' && art.$inferred === '')
        return; // internal super-annotate for unknown artifacts

      if (!query?.from?.path) {
        const variant = (query?.from || query)?.op?.val || 'std';
        error( 'extend-columns', [ ext.columns[$location], ext ], { '#': variant, art } );
        return;
      }
      if (!query.columns)
        query.columns = [ { location: query.from.location, val: '*' }, ...ext.columns ];
      else
        query.columns.push( ...ext.columns );
      initSelectItems( query, ext.columns, query, true );
    }
    else if (typeParameters.list.includes( prop )) {
      const typeExts = art.$typeExts || (art.$typeExts = {});
      typeExts[prop] = ext;
    }
    else {
      const result = applyAssignment( art[prop], ext[prop], ext, prop );
      art[prop] = (result.name) ? result : Object.assign( {}, art[prop], result );
    }
  }

  function applyAssignment( previousAnno, anno, art, annoName ) {
    const firstEllipsis = annotationHasEllipsis( anno );
    if (!firstEllipsis)
      return anno;
    const hasBase = previousAnno?.literal === 'array';
    if (!previousAnno) {
      const location = firstEllipsis.location || anno.name.location;
      message( 'anno-unexpected-ellipsis', [ location, art ], { code: '...' } );
      previousAnno = {
        val: [],
        literal: 'array',
        name: { id: annoName.slice( 1 ) },
        location,
      };
    }
    else if (previousAnno.literal !== 'array') {
      // TODO: If we introduce sub-messages, point to the non-array base value.
      error( 'anno-mismatched-ellipsis', [ anno.name.location, art ], { code: '...' } );
      previousAnno = {
        val: [],
        literal: 'array',
        name: previousAnno.name,
        location: previousAnno.location,
      };
    }
    const previousValue = previousAnno.val;
    let prevPos = 0;
    const result = [];
    for (const item of anno.val) {
      const ell = item && item.literal === 'token' && item.val === '...';
      if (!ell) {
        result.push( item );
      }
      else {
        let upToSpec = item.upTo && checkUpToSpec( item.upTo, art, annoName, true );
        while (prevPos < previousValue.length) {
          const prevItem = previousValue[prevPos++];
          result.push( prevItem );
          if (upToSpec && prevItem && equalUpTo( prevItem, item.upTo )) {
            upToSpec = false;
            break;
          }
        }
        if (upToSpec && hasBase) {
          // non-matched UP TO; if there is no base to apply to, there is already an error.
          warning( null, [ item.upTo.location, art ], { anno: annoName, code: '... up to' },
                   'The $(CODE) value does not match any item in the base annotation $(ANNO)' );
        }
      }
    }
    // console.log('TP:',previousValue.map(se),anno.val.map(se),'->',result.map(se))
    return {
      val: result,
      literal: 'array',
      name: previousAnno.name,
      location: previousAnno.location,
    };
  }
  // function se(a) { return a.upTo ? [a.val,a.upTo.val] : a.val ; }

  function checkUpToSpec( upToSpec, art, annoName, isFullUpTo ) {
    const { literal } = upToSpec;
    if (!isFullUpTo) {          // inside struct of UP TO
      if (literal !== 'struct' && literal !== 'array' )
        return true;
    }
    else if (literal === 'struct') {
      return Object.values( upToSpec.struct ).every( v => checkUpToSpec( v, art, annoName ) );
    }
    else if (literal !== 'array' && literal !== 'boolean' && literal !== 'null') {
      return true;
    }
    error( null, [ upToSpec.location, art ],
           { anno: annoName, code: '... up to', '#': literal },
           {
             std: 'Unexpected $(CODE) value type in the assignment of $(ANNO)',
             array: 'Unexpected array as $(CODE) value in the assignment of $(ANNO)',
             // eslint-disable-next-line @stylistic/js/max-len
             struct: 'Unexpected structure as $(CODE) structure property value in the assignment of $(ANNO)',
             boolean: 'Unexpected boolean as $(CODE) value in the assignment of $(ANNO)',
             null: 'Unexpected null as $(CODE) value in the assignment of $(ANNO)',
           } );
    return false;
  }

  function equalUpTo( previousItem, upToSpec ) {
    if (!previousItem)
      return false;
    if ('val' in upToSpec) {
      if (previousItem.val === upToSpec.val) // enum, struct and ref have no val
        return true;
      // TODO v6: delete the special UP TO comparison?
      const upToVal = upToSpec.val;
      const prevVal = previousItem.val;
      // eslint-disable-next-line eqeqeq
      return prevVal == upToVal &&
        ( typeof upToVal === 'number' && stringCouldHaveBeenCdlNumber( prevVal ) ||
          typeof prevVal === 'number' && stringCouldHaveBeenCdlNumber( upToVal ) );
    }
    else if (upToSpec.path) {
      return previousItem.path && normalizeRef( previousItem ) === normalizeRef( upToSpec );
    }
    else if (upToSpec.sym) {
      return previousItem.sym && previousItem.sym.id === upToSpec.sym.id;
    }
    else if (upToSpec.struct && previousItem.struct) {
      return Object.entries( upToSpec.struct )
        .every( ([ n, v ]) => equalUpTo( previousItem.struct[n], v ) );
    }
    return false;
  }

  // We only compare a string by number if the string is not empty, and could have
  // been produced for a CDL number by (a previous version of) the compiler,
  // i.e. having used a decimal dot, or using the scientific notation:
  function stringCouldHaveBeenCdlNumber( val ) { // also consider previous compiler versions
    return val && typeof val === 'string' && /[.eE]/.test( val );
    // We do not use `!Number.isSafeInteger( Number.parseFloat( text||'0' )`
    // because it is unlikely that people have written a non-integer like this,
    // more likely is meant a digit-sequence as string
  }

  function normalizeRef( node ) { // see to-csn.js
    const ref = pathName( node.path );
    // TODO: get rid of name.variant (induces a wrong structure anyway)
    return node.variant ? `${ ref }#${ pathName( node.variant.path ) }` : ref;
  }

  // For extendArtifactAfter(): -------------------------------------------------

  // Remarks on messages: we allow the type extensions only if the artifact
  // originally had that property → any check of the kind “type prop can only be
  // used with FooBar” is independent from `extend … with type`.  Function
  // checkTypeArguments() in resolve.js reports 'type-unexpected-argument', but
  // that is currently incomplete.
  //
  // We then report (in the future), use the first message of:
  // - the usual messages if a type argument is wrong, independently from `extend`
  // - 'ext-unexpected-type-argument' (TODO) if the artifact does not have the prop
  // - 'ext-invalid-type-argument' if the value is wrong for extend (no overwrite)
  //
  // TODO v6: do not allow `extend … with (precision: …)` alone if original def also has `scale`
  function applyTypeExtensions( art, ext, prop, scaleDiff ) {
    // console.log('ATE:',art?.[prop],ext?.[prop],scaleDiff)
    if (!ext?.[prop])
      return 0;
    if (!art[prop]) {
      const isBuiltin = art._effectiveType?.builtin;
      if (isBuiltin && !allowsTypeArgument( art, prop )) {
        // Let checkTypeArguments() in resolve.js report a message, is incomplete
        // though, i.e. can only safely be used for scalars at the moment.  But we
        // will improve that function and not try to do extra things here.
        art[prop] = ext[prop];  // enable checkTypeArguments() doing its job
        return 0;
      }
      // TODO: think about 'ext-unexpected-type-argument'
      error( 'ext-invalid-type-property', [ ext[prop].location, ext ],
             { '#': (isBuiltin ? 'indirect' : 'new-prop'), prop } );
      return 0;
    }
    const artVal = art[prop].val;
    const extVal = ext[prop].val;
    if (prop === 'srid') {
      error( 'ext-invalid-type-property', [ ext[prop].location, ext ], { '#': 'prop', prop } );
    }
    else if (typeof artVal !== 'number' || typeof extVal !== 'number' ) {
      // Users can't change from/to string value for property,
      // e.g. `variable`/`floating` for Decimal
      // TODO: Shouldn't the text distinguish between orig string and extension string?
      // Not sure whether to talk about strings if we have a keyword in CDL
      error( 'ext-invalid-type-property', [ ext[prop].location, ext ], { '#': 'string', prop } );
    }
    else if (extVal < artVal + (scaleDiff || 0)) {
      const number = artVal + (scaleDiff || 0);
      error( 'ext-invalid-type-property', [ ext[prop].location, ext ], {
        '#': (scaleDiff ? 'scale' : 'number'), prop, number, otherprop: 'scale',
      } );
    }
    else {
      art[prop] = ext[prop];
      return extVal - artVal;
    }
    return 0;
  }

  /**
   * If the target artifact has both precision and scale set, then extensions on it must also
   * provide both to avoid user errors for subsequent `extend` statements.
   *
   * @param {XSN.Artifact} art
   * @param {object} exts
   */
  function checkPrecisionScaleExtension( art, exts ) {
    if (art.precision && art.scale) {
      if ((exts.precision || exts.scale) && !(exts.precision && exts.scale)) {
        const missing = exts.precision ? 'scale' : 'precision';
        const prop = exts.precision ? 'precision' : 'scale';
        error( 'ext-missing-type-property', [ exts[prop].location, exts[prop] ],
               { art, prop, otherprop: missing } );
      }
    }
  }

  function allowsTypeArgument( art, prop ) {
    const { parameters } = art._effectiveType;
    if (!parameters)
      return false;
    return parameters.includes( prop ) || parameters[0]?.name === prop;
  }

  function moveDictExtensions( art, extensionsMap, artProp, extProp = artProp ) {
    // TODO: setExpandStatusAnnotate
    const extensions = extensionsMap[extProp];
    if (!extensions)
      return;

    const artDict = art[artProp] || annotateFor( art, extProp ); // no auto-correction in annotate

    for (const ext of extensions) {
      let dictCheck = (art.kind !== 'annotate'); // no check in super annotate statement
      forEachGeneric(ext, extProp, (elemExt, name) => {
        if (elemExt.kind !== 'annotate' && elemExt.kind !== 'extend') // TODO: specified elems
          return;             // definitions inside extend, already handled
        dictCheck = dictCheck && checkRemainingMemberExtensions( art, elemExt, artProp, name );
        const elem = artDict[name] || annotateFor( art, extProp, name );
        setLink( elemExt.name, '_artifact', (elem.kind !== 'annotate' ? elem : null ) );
        ensureArtifactNotProcessed( elem );
        if (elem.$duplicates !== true)
          pushToDict( elem, '_extensions', elemExt );
      });
    }
  }

  function moveReturnsExtensions( art, extensionsMap ) {
    const extensions = extensionsMap.returns;
    if (!extensions)
      return;
    const artReturns = art.returns;
    let extReturns = artReturns;
    const isAction = art.kind === 'action' || art.kind === 'function';

    for (const ext of extensions) {
      if (!artReturns && art.kind !== 'annotate') {
        warning( 'ext-unexpected-returns', [ ext.returns.location, ext ], {
          '#': (isAction ? art.kind : 'std'), keyword: 'returns',
        }, {
          std: 'Unexpected $(KEYWORD); only actions and functions have return parameters',
          action: 'Unexpected $(KEYWORD) for action without return parameter',
          // function without `returns` can happen via CSN input!
          function: 'Unexpected $(KEYWORD) for function without return parameter',
        } );
        // Do not put completely wrong returns into a “super annotate” statement;
        // this could induce consequential errors with [..., …]:
        if (!isAction)
          continue;             // do not put into 'extensions'
        // add to 'extensions' for action/function without returns:
        extReturns ??= annotateFor( art, 'params', '' );
      }
      if (extReturns) {
        setLink( ext.name, '_artifact', (isAction ? artReturns : null ) );
        pushToDict( extReturns, '_extensions', ext.returns );
      }
    }
  }

  function annotateFor( art, prop, name ) {
    const base = annotateBase( art );
    if (name === '' && prop === 'params')
      return base.returns || annotateCreate( base, name, base, 'returns' );
    const dict = base[prop] || (base[prop] = Object.create( null ));
    if (name == null)
      return dict;
    return dict[name] || annotateCreate( dict, name, base );
  }

  function annotateBase( art ) {
    while (art._outer)          // TODO: think about anonymous target aspect
      art = art._outer;
    if (art.kind === 'annotate')
      return art;

    // TODO: more to do if annotate can have `returns` property
    if (art.kind === 'select')
      art = art._parent;
    if (art._main)
      return annotateFor( art._parent, kindProperties[art.kind].dict, art.name.id );

    const { id } = art.name;
    return model.$collectedExtensions[id] ||
           annotateCreate( model.$collectedExtensions, id );
  }

  function annotateCreate( dict, id, parent, prop ) {
    const annotate = {
      kind: 'annotate',
      name: { id, location: genLocation },
      $inferred: '',
      location: genLocation,
    };
    if (parent) {
      setLink( annotate, '_parent', parent );
      setLink( annotate, '_main', parent._main || parent );
    }
    dict[prop || id] = annotate;
    return annotate;
  }

  function extendHandleReturns( extensions, art ) {
    for (const ext of extensions || []) {
      warning( 'ext-expecting-returns', [ ext.name.location, ext ], {
        '#': art.kind, keyword: 'returns', code: 'annotate ‹name› with returns { … }',
      }, {
        std: 'Expected $(CODE)', // unused variant
        action: 'Expected $(KEYWORD) when annotating action return structure, i.e. $(CODE)',
        function: 'Expected $(KEYWORD) when annotating function return structure, i.e. $(CODE)',
      } );
    }
  }

  function checkRemainingMemberExtensions( parent, ext, prop, name ) {
    // console.log('CRME:',prop,name,parent,ext)

    // TODO: just use `ext-undefined-element` etc also when no elements are there
    // at all (but use an extra text variant and the `{…}` location).  Reason: we
    // might allow to add new actions, and an `annotate` on an undefined action
    // should not lead to another message id.  We would use and extra message id
    // if we consider this an error or such sub annotates are then ignored
    // (i.e. not put into the "super annotate").
    const dict = parent[prop];
    if (!dict) {
      // TODO: check - for each name? - better locations
      const location = ext._parent?.[prop]?.[$location] || ext.name.location;
      // Remark: no `elements` dict location with `annotate Main:elem`
      switch (prop) {
        // TODO: change texts, somehow similar to checkDefinitions() ?
        case 'foreignKeys':
        case 'elements':
        case 'enum':            // TODO: extra?
          warning( 'anno-unexpected-elements', [ location, ext._parent ],
                   { '#': (parent._effectiveType?.kind === 'entity') ? 'entity' : 'std' }, {
                     std: 'Elements only exist in entities, types or typed constructs',
                     entity: 'Elements of entity types can\'t be annotated',
                     // TODO: extra msg for 'entity'? → this is some other
                     // situation, somehow similar when trying to annotate elements
                     // of target entity
                   } );
          break;
        case 'params':
          warning( 'anno-unexpected-params', [ location, ext._parent ], {},
                   'Parameters only exist for actions or functions' );
          break;
        case 'actions':
          if (canBeDraftMember( name, parent, draftBoundActions ))
            return true;
          // TODO: use extra text variant and location of dictionary - no
          notFound( 'ext-undefined-action', ext.name.location, ext,
                    { '#': 'action', art: parent, name } );
          break;
        default:
          if (model.options.testMode)
            throw new CompilerAssertion(`Missing case for prop: ${ prop }`);
      }
      return false;
    }
    else if (!dict[name]) {
      // TODO: make variant `returns` an auto-variant for ($ART) ?
      const inReturns = parent._parent?.returns && parent._parent;
      const art = inReturns || parent;
      switch (prop) {
        case 'elements':
          if (canBeDraftMember( name, parent, draftElements ))
            break;
          notFound( 'ext-undefined-element', ext.name.location, ext,
                    { '#': (inReturns ? 'returns' : 'element'), art, name },
                    parent.elements );
          break;
        case 'enum':            // TODO: extra msg id?
          notFound( 'ext-undefined-element', ext.name.location, ext,
                    { '#': (inReturns ? 'enum-returns' : 'enum'), art, name },
                    parent.enum );
          break;
        case 'foreignKeys':
          notFound( 'ext-undefined-key', ext.name.location, ext,
                    { name }, parent.foreignKeys );
          break;
        case 'params':
          notFound( 'ext-undefined-param', ext.name.location, ext,
                    { '#': 'param', art: parent, name },
                    parent.params );
          break;
        case 'actions':
          if (canBeDraftMember( name, parent, draftBoundActions ))
            break;
          notFound( 'ext-undefined-action', ext.name.location, ext,
                    { '#': 'action', art: parent, name },
                    parent.actions );
          break;
        default:
          if (model.options.testMode)
            throw new CompilerAssertion(`Missing case for prop: ${ prop }`);
      }
    }
    return true;
  }

  function notFound( msgId, location, address, args, validDict ) {
    const msg = message( msgId, [ location, address ], args );
    attachAndEmitValidNames( msg, validDict );
  }

  // For createRemainingAnnotateStatements(): -----------------------------------

  function createSuperAnnotate( annotate ) {
    const extensions = annotate._extensions;
    if (extensions && !annotate._main) {
      const { id } = annotate.name;
      const isLocalized = id.startsWith( 'localized.' ); // TODO: && anno
      const art = model.definitions[id];
      for (const ext of extensions)
        checkRemainingMainExtensions( art, ext, isLocalized );
      if (art?.builtin && art.kind !== 'namespace') { // TODO: do not set `builtin` on cds, cds.hana
        setLink( annotate, '_extensions', art._extensions ); // for messages and member extensions
        // direct annotations on builtins or on the builtins for propagation, and
        // also shallow-copied to $collectedExtensions for to-csn
        for (const prop in art) {
          if (prop.charAt(0) === '@' || prop === 'doc')
            annotate[prop] = art[prop];
        }
      }
      if (extensions.length === 1) { // i.e. no proper location if from more than one extension
        annotate.location = extensions[0].location;
        annotate.name.location = extensions[0].name.location;
      }
    }
    extendArtifactBefore( annotate );
    extendArtifactAfter( annotate );
    forEachMember( annotate, createSuperAnnotate );
  }

  function checkRemainingMainExtensions( art, ext, localized ) {
    const isExtend = ext.kind === 'extend';
    if (localized) {
      if (isExtend) {
        // In v5, reject any `extend` on localized.
        error( 'ref-undefined-art', [ ext.location || ext.name.location, ext ],
               { '#': 'localized', keyword: 'annotate' } );
      }
      return;
    }

    if (!resolvePath( ext.name, ext.kind, ext )) // error for extend, info for annotate
      return;

    if (art?.builtin) {
      info( 'anno-builtin', [ ext.name.location, ext ], {} ); // TODO: better location?
    }
    else if (isExtend && art?.kind === 'namespace') {
      // `annotate` on namespaces already handled before
      const hasAnnotations = Object.keys(ext).find(a => a.charAt(0) === '@');
      const firstAnno = ext[hasAnnotations];
      // In v5, extending namespaces is only allowed for `extend with definitions`.
      // Neither annotations nor other extensions are allowed.
      // Non-artifact extensions are reported in resolvePath() already (for v5).
      // Because "namespaces" are the same as "unknown" artifacts in CSN, we don't report
      // an error for `annotate`s.
      // FIXME: The compiler generates empty `annotate` statements for
      //        `extend ns with definitions {…}`. That's why we check the frontend.
      if (hasAnnotations || (!ext.artifacts && ext._block.$frontend !== 'json')) {
        error( 'ref-undefined-art', [ (firstAnno?.name || ext.name).location, ext ], {
          '#': 'namespace', art: ext,
        } );
      }
    }
  }

  // Issue messages for annotations on namespaces and builtins
  // (TODO: really here?, probably split main artifacts vs returns)
  // see also createRemainingAnnotateStatements() where similar messages are reported
  function checkAnnotate( construct, art ) {
    // TODO: Handle extend statements properly: Different message for empty extend?

    // --> without art._block, art not found
    if (construct.kind === 'annotate' && art._block?.$frontend === 'cdl') {
      if (construct.returns && art.kind !== 'action' && art.kind !== 'function' ) {
        // See moveReturnsExtensions()
      }
      else if (!construct.returns &&
          (art.kind === 'action' || art.kind === 'function') && construct.elements) {
        warning( 'ext-expecting-returns', [ construct.name.location, construct ], {
          '#': art.kind, keyword: 'returns', code: 'annotate ‹name› with returns { … }',
        }, {
          std: 'Expected $(CODE)', // unused variant
          action: 'Expected $(KEYWORD) when annotating action return structure, i.e. $(CODE)',
          function: 'Expected $(KEYWORD) when annotating function return structure, i.e. $(CODE)',
        } );
      }
    }
  }

  // extend, mainly old-style ---------------------------------------------------

  /**
   * Apply the extensions inside the extensionsDict on the model.
   *
   * First try normally: extends with structure includes; with remaining cyclic
   * includes, do so without includes.
   */
  function applyExtensions() {
    let noIncludes = false;
    let extNames = Object.keys( extensionsDict ).sort();

    while (extNames.length) {
      const { length } = extNames;
      for (const name of extNames) {
        const art = model.definitions[name];
        if (art && art.kind !== 'namespace' &&
            extendArtifact( extensionsDict[name], art, noIncludes ))
          delete extensionsDict[name];
      }
      extNames = Object.keys( extensionsDict ); // no sort() required anymore
      if (extNames.length >= length)
        noIncludes = Object.keys( extensionsDict ); // = no includes
    }
  }

  /**
   * Extend artifact `art` by `extensions`.  `noIncludes` can have values:
   * - false: includes are applied, extend and annotate is performed
   * - true:  includes are not applied, extend and annotate is performed
   * - 'gen': no includes and no extensions allowed, annotate is performed
   *
   * @param {XSN.Extension[]} extensions
   * @param {XSN.Definition} art
   * @param {boolean|'gen'} [noIncludes=false]
   */
  function extendArtifact( extensions, art, noIncludes = false ) {
    if (!noIncludes && !(canApplyIncludes( art, art ) &&
        extensions.every( ext => canApplyIncludes( ext, art ) )))
      return false;
    if (Array.isArray( noIncludes )) {
      canApplyIncludes( art, art, noIncludes );
      extensions.forEach( ext => canApplyIncludes( ext, art, noIncludes ) );
    }
    else if (!noIncludes &&
             !(canApplyIncludes( art, art ) &&
               extensions.every( ext => canApplyIncludes( ext, art ) ))) {
      // console.log( 'FALSE:',art.name, extensions.map( e => e.name ) )
      return false;
    }
    if (!art.query) {
      model._entities.push( art ); // add structure with includes in dep order
      art.$entity = ++model.$entity;
    }
    if (art.includes) {
      if (!noIncludes) {
        applyIncludes( art, art );
      }
      else {
        for (const ref of art.includes)
          resolvePath( ref, 'include', art );
      }
    }
    // checkExtensionsKind( extensions, art );
    extendMembers( extensions, art, noIncludes === 'gen' );
    if (!noIncludes && art.includes) {
      // early propagation of specific annotation assignments
      propagateEarly( art, '@cds.autoexpose' );
      propagateEarly( art, '@fiori.draft.enabled' );
    }
    // TODO: complain about element extensions inside projection
    return true;
  }

  function extendMembers( extensions, art, noExtend ) {
    // TODO: do the whole extension stuff lazily if the elements are requested
    const elemExtensions = [];
    if (art._main)              // extensions already sorted for main artifacts
      extensions.sort( layers.compareLayer );
    // TODO: use same sequence as in chooseAssignment() - better: use common code with that fn
    // console.log('EM:',art.name,extensions,art._extensions)
    for (const ext of extensions) { // those in extMap.includes
      // console.log(message( 'id', [ext.location, ext], { art: ext.name._artifact },
      //                      'Info', 'EXT').toString())
      if (ext.name._artifact === undefined) { // not already applied
        setArtifactLink( ext.name, art );
        if (noExtend && ext.kind === 'extend') {
          error( 'extend-for-generated', [ ext.name.location, ext ], { art, keyword: 'extend' },
                 'You can\'t use $(KEYWORD) on the generated $(ART)' );
          continue;
        }
        if (ext.includes) {
          // TODO: currently, re-compiling from gensrc does not give the exact
          // element sequence - we need something like
          //    includes = ['Base1',3,'Base2']
          // where 3 means adding the next 3 elements before applying include 'Base2'
          if (art.includes)
            art.includes.push( ...ext.includes );
          else
            art.includes = [ ...ext.includes ];
          applyIncludes( ext, art );
        }
        // console.log(ext,art)
        checkAnnotate( ext, art );
        // TODO: do we allow to add elements with array of {...}?  If yes, adapt
        initMembers( ext, art, ext._block ); // might set _extend, _annotate
        dependsOnSilent( art, ext ); // art depends silently on ext (inverse to normal dep!)
      }
      for (const name in ext.elements) {
        const elem = ext.elements[name];
        if (elem.kind === 'element') { // i.e. not extend or annotate
          elemExtensions.push( elem );
          break;                // more than one elem in same EXTEND is fine
        }
      }
    }
    if (elemExtensions.length > 1)
      reportUnstableExtensions( elemExtensions );

    // This whole function will be removed with a next change - no need to have nice code here:
    const dict = Object.create( null );
    // actions cannot be extended anyway. TODO: there should be a message
    // (possible with CSN input), but that was missing before this change, too.
    for (const e of extensions) {
      if (!e.elements)
        continue;
      for (const n in e.elements) {
        if (e.elements[n].kind === 'extend')
          pushToDict( dict, n, e.elements[n] );
      }
    }
    for (const name in dict) {
      let obj = art;
      if (obj.targetAspect)
        obj = obj.targetAspect;
      while (obj.items)
        obj = obj.items;
      const validDict = obj.elements || obj.enum;
      const member = validDict && validDict[name];
      if (!member)
        extendNothing( dict[name], 'elements', name, art, validDict );
      else if (!(member.$duplicates))
        extendMembers( dict[name], member );
    }
  }

  /**
   * Report 'Warning: Unstable element order due to repeated extensions'
   * except if all extensions are in the same file.
   *
   * @param {XSN.Extension[]} extensions
   */
  function reportUnstableExtensions( extensions ) {
    // No message if all extensions are in the same file:
    const file = layers.realname( extensions[0] );
    if (extensions.every( ( ext, i ) => !i || file === layers.realname( ext ) ))
      return;
    // Similar to chooseAssignment(), TODO there: also extra intralayer message
    // as this is a modeling error
    let lastExt = null;
    let open = [];              // the "highest" layers
    for (const ext of extensions) {
      const extLayer = layers.layer( ext ) ||
          { realname: '', _layerExtends: Object.create( null ) };
      if (!open.length) {
        lastExt = ext;
        open = [ extLayer.realname ];
      }
      else if (extLayer.realname === open[open.length - 1]) { // in same layer
        if (lastExt) {
          message( 'extend-repeated-intralayer', [ lastExt.location, lastExt ] );
          lastExt = null;
        }
        message( 'extend-repeated-intralayer', [ ext.location, ext ] );
      }
      else {
        if (lastExt && (open.length > 1 || !extLayer._layerExtends[open[0]])) {
          // report for lastExt if that is unrelated to other open exts or current ext
          message( 'extend-unrelated-layer', [ lastExt.location, lastExt ], {},
                   'Unstable element order due to other extension in unrelated layer' );
        }
        lastExt = ext;
        open = open.filter( name => !extLayer._layerExtends[name] );
        open.push( extLayer.realname );
      }
    }
  }


  /**
   * @param {XSN.Extension[]} extensions
   * @param {string} prop
   * @param {string} name
   * @param {XSN.Artifact} art
   * @param {object} validDict
   */
  function extendNothing( extensions, prop, name, art, validDict ) {
    // TODO: probably too much magic in the creation of artName…
    const extMain = { ...(art._main || art) };
    const artName = searchName( art, name, dictKinds[prop] );
    setLink( artName, '_main', extMain );
    for (const ext of extensions) {
      // TODO: use shared functionality with notFound in resolver.js
      const { location } = ext.name;
      extMain.kind = ext.kind;
      const msg = error( 'extend-undefined', [ location, artName ], { art: artName }, {
        std: 'Unknown $(ART) - nothing to extend',
        element: 'Artifact $(ART) has no element or enum $(MEMBER) - nothing to extend',
        action: 'Artifact $(ART) has no action $(MEMBER) - nothing to extend',
      } );
      attachAndEmitValidNames( msg, validDict );
    }
  }

  // includes ----------------------------------------------------------------

  /**
   * Returns true, if `art.includes` can be applied on `target`.
   * They can't be applied if any of the artifacts referenced in
   * `art.includes` are yet to be extended.
   * `art !== target` if `art` is an extension.
   *
   * @param {XSN.Definition} art
   * @param {XSN.Artifact} target
   * @param {string[]} [justResolveCyclic]
   * @returns {boolean}
   */
  function canApplyIncludes( art, target, justResolveCyclic ) {
    if (!art.includes)
      return true;
    for (const ref of art.includes) {
      const name = resolveUncheckedPath( ref, 'include', art );
      // console.log('CAI:',justResolveCyclic, name, ref.path, Object.keys(extensionsDict))
      if (justResolveCyclic) {
        if (!justResolveCyclic.includes( name ))
          continue;
        delete ref._artifact;
      }
      else if (name && name in extensionsDict) {
        // one of the includes has itself extensions that need to be applied first
        return false;
      }
      else if (ref._artifact) {
        delete ref._artifact;
      }
    }
    return true;
  }

  /**
   * Apply all includes of `ext` on `ext`.  Checks that `art` allows includes.
   * If `ext === art`, then includes of the artifact itself are applied.
   * If `ext !== art`, applies includes on the extensions, not artifact.
   * Sets `_ancestors` links on `art`.
   *
   * TODO: try to set `_ancestors` only to entities (but beware “intermediate”
   * non-entities).
   *
   * Examples:
   *   ext === art:  `entity E : F {}`  => add elements of F to E
   *   ext !== art:  `extend E with F`  => add elements of F to extension on E
   *
   * @param {XSN.Extension} ext
   * @param {XSN.Artifact} art
   */
  function applyIncludes( ext, art ) {
    if (kindProperties[art.kind].include !== true) {
      error( 'extend-unexpected-include', [ ext.includes[0]?.location, ext ],
             { meta: art.kind } );
      return;
    }

    if (!art._ancestors && !art.query)
      setLink( art, '_ancestors', [] ); // recursive array of includes
    for (const ref of ext.includes) {
      const template = resolvePath( ref, 'include', art );
      // !template -> non-includable, e.g. scalar type, or cyclic
      if (template && !art.query) {
        if (template._ancestors)
          art._ancestors.push( ...template._ancestors );
        art._ancestors.push( template );
      }
    }
    if (!art.query && art.elements) // do not set art.elements and art.enums with query entity!
      includeMembers( ext, art, 'elements' );
    if (art.kind !== 'type') {
      includeMembers( ext, art, 'actions' );
    }
    else {
      for (const ref of ext.includes) {
        const template = ref._artifact; // already resolved
        if (template?.actions && Object.keys( template.actions ).length) {
          warning( 'ref-ignoring-actions', [ ref.location, ext ], { art: template },
                   'The actions of $(ART) are not added to the type' );
        }
      }
    }
  }

  /**
   * Add all members (e.g. elements or actions) of `ext.includes` to `ext[prop]`.
   * If `art` is `ext`, set the parent link accordingly.
   *
   * @param {XSN.Extension} ext
   * @param {XSN.Artifact} art
   * @param {string} prop 'elements' or 'actions'
   */
  function includeMembers( ext, art, prop ) {
    // TODO two kind of messages:
    // Error 'More than one include defines element "A"' (at include ref)
    // Warning 'Overwrites definition from include "I" (at elem def)
    const parent = ext === art && art;
    const members = ext[prop];
    if (members) {
      ext[prop] = Object.create( null );
      ext[prop][$location] = members[$location];
    }
    let hasNewElement = false;

    for (const ref of ext.includes) {
      const template = ref._artifact; // already resolved
      if (template) {           // be robust
        if (template[prop] && !ext[prop])
          ext[prop] = Object.create( null );
        const location = weakRefLocation( ref );
        // eslint-disable-next-line no-loop-func
        forEachInOrder( template, prop, ( origin, name ) => {
          if (members && members[name]) {
            if (!includesNonShadowedFirst && !ext[prop][name])
              dictAdd( ext[prop], name, members[name] ); // to keep order
            return;
          }
          hasNewElement = true;
          const elem = linkToOrigin( origin, name, parent, prop, location );
          setLink( elem, '_block', origin._block );
          if (!parent) // not yet set for EXTEND foo WITH bar => linkToOrigin() did not add it
            dictAdd( ext[prop], name, elem );
          elem.$inferred = 'include';
          if (origin.masked)    // TODO(v6): remove 'masked'
            elem.masked = Object.assign( { $inferred: 'include' }, origin.masked );
          if (origin.key)
            elem.key = Object.assign( { $inferred: 'include' }, origin.key );
          if (origin.value && origin.$syntax === 'calc') {
            // TODO: If paths become invalid in the new artifact, should we mark
            //       all usages in the expressions? Possibly just the first one?
            // TODO: Unify with coding in extend.js
            elem.value = Object.assign( { $inferred: 'include' }, copyExpr( origin.value ));
            elem.$syntax = 'calc';
            createAndLinkCalcDepElement( elem );
            setLink( elem, '_calcOrigin', origin._calcOrigin || origin );
          }
          // TODO: also complain if elem is just defined in art
        } );
      }
    }

    checkRedefinitionThroughIncludes( parent, prop );

    if (!hasNewElement && members) {
      ext[prop] = members;
    }
    else if (members) {
      // TODO: expand elements having direct elements (if needed)
      forEachInOrder( { [prop]: members }, prop, ( elem, name ) => {
        // The element could have been added in the previous loop (includes) to keep
        // the element order.
        if (ext[prop][name] !== elem )
          dictAdd( ext[prop], name, elem );
      } );
    }
  }

  /**
   * Report duplicates in parent[prop] that happen due to multiple includes having the
   * same member.  Covers `entity G : E, G {};` but not `entity G : E {};  extend G with F;`.
   */
  function checkRedefinitionThroughIncludes( parent, prop ) {
    if (!parent[prop])
      return;
    forEachInOrder( parent, prop, ( member, name ) => {
      if (member.$inferred === 'include' && Array.isArray( member.$duplicates )) {
        const includes = [ member, ...member.$duplicates ].map( dup => dup._origin._main );
        error( 'duplicate-definition', [ parent.name.location, member ],
               { '#': `include-${ prop }`, name, sorted_arts: includes } );
      }
    } );
  }
}

/**
 * Group extensions by their layers.  A definition (for specified elements)
 * is considered to be provided in a layer named '', the lowest layer.
 *
 * @param {object[]} extensions Array of extensions.
 * @returns {Record<string, object>} key: layer name, value: {name, layer, extensions[]}`
 */
function layeredExtensions( extensions ) {
  const layered = Object.create( null );
  for (const ext of extensions) {
    const layer = (ext.kind === 'annotate' || ext.kind === 'extend' || ext.kind === 'source') &&
                  layers.layer( ext );
    // just consider layer if Extend/Annotate, not Define
    const name = (layer) ? layer.realname : '';
    const done = layered[name];
    if (done)
      done.extensions.push( ext );
    else
      layered[name] = { name, layer, extensions: [ ext ] };
  }
  return layered;
}

/**
 * Return extensions of the highest layers.
 * Also returns whether there could be an issue:
 * - false: there are just extensions in one file,
 * - 'unrelated': there is just one extension per layer
 * - true: there is at least one layer with two or more extensions, and
 *   at least two files are involved
 *
 * @param {Record<string, object>} layered Structure as returned by layeredExtensions()
 * @returns {{highest, issue: boolean|string}}
 */
function extensionsOfHighestLayers( layered ) {
  const layerNames = Object.keys( layered );
  // console.log('HIB:',layerNames)
  if (layerNames.length <= 1) {
    const name = layerNames[0];
    const highest = layered[name]?.extensions || [];
    highest.sort( compareExtensions );
    delete layered[name];
    return { highest, issue: inMoreThanOneFile( highest ) };
  }

  // collect all layers which are lower than another layer
  const allExtends = Object.create( null );
  allExtends[''] = {};        // the "Define" layer
  for (const name of layerNames) {
    if (name)                 // not the "Define" layer
      Object.assign( allExtends, layered[name].layer._layerExtends );
  }
  // console.log('HIE:',Object.keys(allExtends))
  const highest = [];           // extensions
  const highestLayers = [];
  for (const name of layerNames) {
    if (!(name in allExtends)) {
      const layer = layered[name];
      delete layered[name];
      highestLayers.push( layer );
      highest.push( ...layer.extensions );
    }
  }
  highest.sort( compareExtensions );
  const good = highestLayers.every( layer => !inMoreThanOneFile( layer.extensions ) );
  // TODO: use layer.file instead
  const issue = !good || highestLayers.length > 1 && 'unrelated';
  // console.log('HI:',highest.map(l=>l.name),issue,issue&&extensions)
  return { highest, issue };
}

function inMoreThanOneFile( extensions ) {
  if (extensions.length <= 1)
    return false;
  const file = extensions[0].location?.file;
  return !file || extensions.some( e => e.location?.file !== file );
}

/**
 * Compare two extensions which are not comparable via layering:
 * - via the fs.realpath of the file (not layer!) of the extensions, then
 * - via the line, then column of the extensions.
 * Returns <0 if `a`<`b`, >1 if `a`>`b`, i.e. can be used for ascending sort.
 */
function compareExtensions( a, b ) {
  const fileA = layers.realname( a );
  const fileB = layers.realname( b );
  if (fileA !== fileB)
    return (fileA > fileB) ? 1 : -1;
  return (a?.location?.line || 0) - (b?.location?.line || 0) ||
    (a?.location?.col || 0) - (b?.location?.col || 0);
}


/**
 * Propagate the given `prop` (e.g. annotation) early, i.e. copy it from all `.includes`
 * if they have the property.
 *
 * @param {XSN.Definition} art
 * @param {string} prop
 */
function propagateEarly( art, prop ) {
  if (art[prop])
    return;
  for (const ref of art.includes) {
    const aspect = ref._artifact;
    if (aspect) {
      const anno = aspect[prop];
      if (anno && (anno.val !== null || !art[prop]))
        art[prop] = Object.assign( { $inferred: 'include' }, anno );
    }
  }
}


module.exports = extend;
