// Things which needs to done for parse.cdl after define()

// For transforming a single CDL file into CSN, parse.cdl resolves block-relative
// _artifact_ references (in `type`, `includes`, `target`, `targetAspect`, `from`,
// `extend`, `annotate`) to absolute names.  This is the task of the export
// function of this file, which the compiler calls after the export function of
// './define.js'.

// There should be no need to do other things here – if you think there is,
// consider adding it to './define.js'.  For “semantic locations” in error
// messages, we set also “structural” links and names inside `extensions` (by
// calling functions from './define.js').

'use strict';

const { CompilerAssertion } = require('../base/error');
const { forEachGeneric } = require('../base/model');


// Used for resolving types in parseCdl mode.
// See resolveTypesForParseCdl().
const parseCdlSpeciallyHandledXsnProps = [ '$queries', 'mixin', 'columns', 'args', 'returns' ];
const parseCdlIgnoredXsnProps = [ 'location', 'query', '$tableAliases' ];

function finalizeParseCdl( model ) {
  // Get simplified "resolve" functionality and the message function:
  const {
    resolveUncheckedPath,
    resolveTypeArgumentsUnchecked,
    initMembers,
  } = model.$functions;

  resolveTypesAndExtensionsForParseCdl();
  return;

  function resolveTypesAndExtensionsForParseCdl() {
    const late = model.$collectedExtensions;
    const extensions = [];

    // TODO: why not just use the extensions as they are from the first source?
    for (const name in late) {
      for (const ext of late[name]._extensions) {
        ext.name.id = resolveUncheckedPath( ext.name, '_extensions', ext );
        // Initialize members and define annotations in sub-elements.
        initMembers( ext, ext, ext._block, true );
        extensions.push( ext );
      }
    }

    forEachGeneric( model, 'definitions', art => resolveTypesForParseCdl( art, art ) );
    forEachGeneric( model, 'vocabularies', art => resolveTypesForParseCdl( art, art ) );

    if (extensions.length > 0) {
      // TODO: do a sort based on the location in case there were two extensions
      // on the same definition?  Yes: anno first outside, then inside service def
      model.extensions = extensions;
      model.extensions.forEach( ext => resolveTypesForParseCdl( ext, ext ) );
    }
  }

  /**
   * Resolve all types in parseCdl mode for the given artifact.
   * `main` refers to the current user/scope, e.g. top-level definition, element, function, etc.
   *
   * @param {*} artifact
   * @param {XSN.Artifact} main
   */
  function resolveTypesForParseCdl( artifact, main ) {
    if (!artifact || typeof artifact !== 'object')
      return;

    if (Array.isArray( artifact )) {
      // e.g. `args` array
      artifact.forEach( art => resolveTypesForParseCdl( art, main ) );
      return;
    }

    if (artifact.kind === 'namespace' || artifact.kind === 'service' || artifact.kind === 'context')
      // Services and context artifacts don't have any types.
      return;

    if (artifact.type)
      resolveTypeUnchecked( artifact, main );

    for (const include of artifact.includes || [])
      resolveUncheckedPath( include, 'include', main );

    // define.js takes care that `target` is a ref and
    // `targetAspect` is a structure (anonymous aspect) or ref to aspect.
    if (artifact.target)
      resolveUncheckedPath( artifact.target, 'target', main );
    if (artifact.targetAspect)
      resolveTypesForParseCdl( artifact.targetAspect, main );

    if (artifact.from) {
      const { from } = artifact;
      resolveUncheckedPath( from, 'from', main );
      resolveTypesForParseCdl( from, main );
    }

    // Recursively go through all XSN properties.  There are a few that need to be
    // handled specifically.  Refer to the code below this loop for details.
    for (const prop in artifact) {
      if (artifact[prop] === undefined || parseCdlSpeciallyHandledXsnProps.includes( prop ) ||
        parseCdlIgnoredXsnProps.includes( prop ))
        continue;

      if (artifact[prop] && Object.getPrototypeOf( artifact[prop] ) === null)
        // Dictionary in XSN
        forEachGeneric( artifact, prop, art => resolveTypesForParseCdl( art, art ) );
      else
        resolveTypesForParseCdl( artifact[prop], main );
    }

    // `$queries` has a flat structure that we can use instead of going through all `query`.
    // For these query-related properties, we need to keep the reference to the artifact
    // containing it.  Otherwise some type's aren't properly resolved.
    // TODO: If resolveTypeUnchecked is reworked, we may be able to simplify this coding.
    (artifact.$queries || []).forEach( art => resolveTypesForParseCdl( art, artifact ) );
    (artifact.columns || []).forEach( art => resolveTypesForParseCdl( art, artifact ) );
    forEachGeneric( artifact, 'mixin', art => resolveTypesForParseCdl( art, artifact ) );

    // For better error messages for `type of`s in `returns`, we pass the object as the new main.
    resolveTypesForParseCdl( artifact.returns, artifact.returns );

    // Because `args` can be used in different contexts with different semantics,
    // it needs to be handled specifically.
    if (artifact.args && typeof artifact.args === 'object') {
      if (Array.isArray( artifact.args )) {
        // `args` may either be an array (e.g. query 'from' args) ...
        artifact.args.forEach( (from) => {
          // ... and could be either inside a `from` ...
          if (from && from.kind === '$tableAlias')
            resolveUncheckedPath( from, 'from', from._main );

          // ... or only params ...
          resolveTypesForParseCdl( from, main );
        } );
      }
      else {
        // ... or dictionary (e.g. params)
        forEachGeneric( artifact, 'args', obj => resolveTypesForParseCdl( obj, obj ) );
      }
    }
  }

  /**
   * Resolves `artWithType.type` in an unchecked manner. Handles `type of` cases.
   * `artWithType` has the `type` property, i.e. it could be an `items` object.
   * `user` is the actual artifact, e.g. entity or element.
   *
   * TODO: this should basically be covered by a function of shared.js
   *
   * @param {object} artWithType
   * @param {XSN.Artifact} user
   */
  function resolveTypeUnchecked( artWithType, user ) {
    const name = resolveUncheckedPath( artWithType.type, 'type', user );
    if (name) {                 // correct ref to main artifact
      const type = model.definitions[name];
      resolveTypeArgumentsUnchecked( artWithType, type, user );
    }
    else if (name === '' && artWithType.$typeArgs && model.options.testMode) {
      // Ensure: parser does not allow type args with Main:elem/`type of`,
      // extend … with type only with named type arguments
      throw new CompilerAssertion( 'Unexpected type arguments for TYPE OF' );
    }
  }
}

module.exports = finalizeParseCdl;
