'use strict';

const {
  getLastPartOf, getLastPartOfRef,
  hasValidSkipOrExists, getNormalizedQuery,
  getRootArtifactName, getResultingName, getNamespace, forEachMember, getVariableReplacement,
  pathName, hasPersistenceSkipAnnotation,
} = require('../model/csnUtils');
const { isBuiltinType, isMagicVariable } = require('../base/builtins');
const keywords = require('../base/keywords');
const {
  renderFunc, createExpressionRenderer, getRealName, addContextMarkers, addIntermediateContexts,
  hasHanaComment, getHanaComment, funcWithoutParen, getSqlSnippets,
  cdsToSqlTypes, cdsToHdbcdsTypes, withoutCast, variableForDialect,
  isVariableReplacementRequired,
} = require('./utils/common');
const {
  renderReferentialConstraint,
} = require('./utils/sql');
const DuplicateChecker = require('./DuplicateChecker');
const { forEachDefinition, isDeprecatedEnabled } = require('../base/model');
const { checkCSNVersion } = require('../json/csnVersion');
const { timetrace } = require('../utils/timetrace');

const { smartId, delimitedId } = require('../sql-identifier');
const { ModelError, CompilerAssertion } = require('../base/error');
const { pathId } = require('../model/csnRefs');

const $PROJECTION = '$projection';
const $SELF = '$self';


// TODO: Unify with other RenderEnvironments
class HdbcdsRenderEnvironment {
  indent = '';
  path = null;
  /**
   * Dictionary of aliases for used artifact names, each entry like 'name' : { quotedName, quotedAlias }
   * @type {{[name: string]: {
   *       quotedName: string,
   *       quotedAlias: string
   *     }}}
   */
  topLevelAliases = Object.create(null);
  // Current name prefix (including trailing dot if not empty)
  namePrefix = '';
  // Skip rendering keys in subqueries
  skipKeys = false;
  currentArtifactName = null;
  // The original view artifact, used when rendering queries
  _artifact = null;

  constructor(values) {
    Object.assign(this, values);
  }

  withIncreasedIndent() {
    return new HdbcdsRenderEnvironment({ ...this, namePrefix: '', indent: `  ${ this.indent }` });
  }
  withSubPath(path) {
    return new HdbcdsRenderEnvironment({ ...this, path: [ ...this.path, ...path ] });
  }
  cloneWith(values) {
    return Object.assign(new HdbcdsRenderEnvironment(this), values);
  }
}

/**
 * Get the comment and in addition escape \n and `'` so SAP HANA CDS can handle it.
 *
 * @param {CSN.Artifact} obj
 * @returns {string}
 */
function getEscapedHanaComment( obj ) {
  return getHanaComment(obj)
    .replace(/\n/g, '\\n')
    .replace(/'/g, "''");
}

/**
 * Render a string for HDBCDS, i.e. put it in quotes and escape single quotes.
 *
 * @param {string} str
 * @returns {string}
 */
function renderStringForHdbcds( str ) {
  return `'${ str.replace(/'/g, '\'\'') }'`;
}

/**
 * Render the CSN model 'model' to CDS source text.
 *
 * @param {CSN.Model} csn HANA transformed CSN
 * @param {CSN.Options} [options] Transformation options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {object} Dictionary of filename: content
 */
function toHdbcdsSource( csn, options, messageFunctions ) {
  timetrace.start('HDBCDS rendering');
  const plainNames = options.sqlMapping === 'plain';
  const quotedNames = options.sqlMapping === 'quoted';
  const hdbcdsNames = options.sqlMapping === 'hdbcds';

  const {
    info, warning, error, throwWithAnyError, message,
  } = messageFunctions;

  const reportedMissingReplacements = Object.create(null);

  const exprRenderer = createExpressionRenderer({
    finalize: x => x,
    typeCast(x) {
      let typeRef = renderTypeReference(x.cast, this.env.withSubPath([ 'cast' ]));
      // inside a cast expression, the cds and hana cds types need to be mapped to hana sql types
      const hanaSqlType = cdsToSqlTypes.hana[x.cast.type] || cdsToSqlTypes.standard[x.cast.type];
      if (hanaSqlType) {
        const typeRefWithoutParams = typeRef.substring(0, typeRef.indexOf('(')) || typeRef;
        typeRef = typeRef.replace(typeRefWithoutParams, hanaSqlType);
      }
      return `CAST(${ this.renderExpr(withoutCast(x)) } AS ${ typeRef })`;
    },
    val: renderExpressionLiteral,
    enum: x => `#${ x['#'] }`,
    ref: renderExpressionRef,
    windowFunction: renderExpressionFunc,
    func: renderExpressionFunc,
    xpr(x) {
      const xprEnv = this.env.withSubPath([ 'xpr' ]);
      if (this.isNestedXpr && !x.cast)
        return `(${ this.renderSubExpr(x.xpr, xprEnv) })`;
      return this.renderSubExpr(x.xpr, xprEnv);
    },
    SELECT(x) {
      return `(${ renderQuery(x, false, this.env.withIncreasedIndent()) })`;
    },
    SET(x) {
      return `${ renderQuery(x, false, this.env.withIncreasedIndent()) }`;
    },
  });

  function renderExpr( x, env ) {
    return exprRenderer.renderExpr(x, env);
  }

  checkCSNVersion(csn, options);

  const hdbcdsResult = Object.create(null);

  const globalDuplicateChecker = new DuplicateChecker(options.sqlMapping); // registry for all artifact names and element names

  const killList = [];
  if (quotedNames)
    addContextMarkers(csn, killList);

  if (!plainNames)
    addIntermediateContexts(csn, killList);

  // Render each top-level artifact on its own
  const hdbcds = Object.create(null);
  for (const artifactName in getTopLevelArtifacts()) {
    const art = csn.definitions[artifactName];
    // This environment is passed down the call hierarchy, for dealing with
    // indentation and name resolution issues
    const env = createEnv();
    const sourceStr = renderDefinition(artifactName, art, env); // Must come first because it populates 'env.topLevelAliases'
    if (sourceStr !== '') {
      const name = plainNames ? artifactName.replace(/\./g, '_').toUpperCase() : artifactName;
      hdbcds[name] = [
        renderNamespaceDeclaration(name, env),
        renderUsings(name, env),
        sourceStr,
      ].join('');
    }
  }

  // render .hdbconstraint into result
  const hdbconstraint = Object.create(null);
  forEachDefinition(csn, (art) => {
    if (art.$tableConstraints && art.$tableConstraints.referential) {
      const referentialConstraints = {};
      Object.entries(art.$tableConstraints.referential)
        .forEach(([ fileName, referentialConstraint ]) => {
          referentialConstraints[fileName] = renderReferentialConstraint(
            referentialConstraint, createEnv().withIncreasedIndent().indent, false, csn, options
          );
        });
      Object.entries(referentialConstraints)
        .forEach(([ fileName, constraint ]) => {
          hdbconstraint[fileName] = constraint;
        });
    }
  });
  hdbcdsResult.hdbcds = hdbcds;
  hdbcdsResult.hdbconstraint = hdbconstraint;

  if (globalDuplicateChecker)
    globalDuplicateChecker.check(error, options); // perform duplicates check

  killList.forEach(fn => fn());

  throwWithAnyError();
  timetrace.stop('HDBCDS rendering');
  return options.testMode ? sort(hdbcdsResult) : hdbcdsResult;

  /**
   * Sort the given object alphabetically
   *
   * @param {Object} obj Object to sort
   * @returns {Object} With keys sorted
   */
  function sort( obj ) {
    const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
    const sortedResult = Object.create(null);
    for (const key of keys)
      sortedResult[key] = obj[key];

    return sortedResult;
  }

  /**
   * Render a definition. Return the resulting source string.
   *
   * @param {string} artifactName Name of the artifact to render
   * @param {CSN.Artifact} art Content of the artifact to render
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} The rendered artifact
   */
  function renderDefinition( artifactName, art, env ) {
    // We're always a top-level artifact.
    env.path = [ 'definitions', artifactName ];
    // Ignore whole artifacts if toHana says so
    if (art.abstract || hasValidSkipOrExists(art))
      return '';

    switch (art.kind) {
      case 'entity':
        // FIXME: For HANA CDS, we need to replace $self at the beginning of paths in association ON-condition
        // by the full name of the artifact we are rendering (should actually be done by forRelationalDB, but that is
        // somewhat difficult because this kind of absolute path is quite unusual). In order not to have to pass
        // the current artifact name down through the stack to renderExpr, we just put it into the env.
        env.currentArtifactName = artifactName;
        if (art.query || art.projection)
          return renderView(artifactName, art, env);

        return renderEntity(artifactName, art, env);

      case 'context':
      case 'service':
        return renderContext(artifactName, art, env, false);
      case 'namespace':
        return renderNamespace(artifactName, art, env);
      case 'type':
      case 'aspect':
        return renderType(artifactName, art, env);
      case 'annotation':
      case 'action':
      case 'function':
      case 'event':
        return '';
      default:
        throw new ModelError(`Unknown artifact kind: ${ art.kind }`);
    }
  }

  /**
   * Return a dictionary with the direct sub-artifacts of the artifact with name 'artifactName' in the csn
   *
   * @param {string} artifactName Find all children of this artifact
   * @returns {object} Dictionary with direct sub-artifacts
   */
  function getSubArtifacts( artifactName ) {
    const prefix = `${ artifactName }.`;
    const result = Object.create(null);
    for (const name in csn.definitions) {
      // We have a direct child if its name starts with prefix and contains no more dots
      if (name.startsWith(prefix) && !name.substring(prefix.length).includes('.')) {
        result[getLastPartOf(name)] = csn.definitions[name];
      }
      else if (name.startsWith(prefix) && !isContainedInOtherContext(name, artifactName)) {
        const prefixPlusNextPart = name.substring(0, name.substring(prefix.length).indexOf('.') + prefix.length);
        if (csn.definitions[prefixPlusNextPart]) {
          const art = csn.definitions[prefixPlusNextPart];
          if (![ 'service', 'context', 'namespace' ].includes(art.kind)) {
            const nameWithoutPrefix = name.substring(prefix.length);
            result[nameWithoutPrefix] = csn.definitions[name];
          }
        }
        else {
          result[name.substring(prefix.length)] = csn.definitions[name];
        }
      }
    }
    return options && options.testMode ? sort(result) : result;
  }

  /**
   * Check whether the given context is the direct parent of the containee.
   *
   * @param {string} containee Name of the contained artifact
   * @param {string} contextName Name of the (grand?)parent context
   * @returns {boolean} True if there is another context in between
   */
  function isContainedInOtherContext( containee, contextName ) {
    const parts = containee.split('.');
    const prefixLength = contextName.split('.').length;

    for (let i = parts.length - 1; i > prefixLength; i--) {
      const prefix = parts.slice(0, i).join('.');
      const art = csn.definitions[prefix];
      if (art && (art.kind === 'context' || art.kind === 'service'))
        return true;
    }

    return false;
  }

  /**
   * Render a context or service. Return the resulting source string.
   *
   * If the context is shadowed by another entity, the context itself is not rendered,
   * but any contained (and transitively contained) entities and views are.
   *
   * @param {string} artifactName Name of the context/service
   * @param {CSN.Artifact} art Content of the context/service
   * @param {HdbcdsRenderEnvironment} env Environment
   * @param {boolean} isShadowed
   * @returns {string} The rendered context/service
   */
  function renderContext( artifactName, art, env, isShadowed ) {
    let result = '';
    if (!isShadowed)
      isShadowed = contextIsShadowed(artifactName);
    if (isShadowed) {
      const subArtifacts = getSubArtifacts(artifactName);
      for (const name in subArtifacts)
        result += renderDefinition(`${ artifactName }.${ name }`, subArtifacts[name], env);

      return `${ result }\n`;
    }

    const childEnv = env.withIncreasedIndent();
    result += `${ env.indent }context ${ renderArtifactName(artifactName, env, true) }`;
    result += ' {\n';
    const subArtifacts = getSubArtifacts(artifactName);
    let renderedSubArtifacts = '';
    for (const name in subArtifacts)
      renderedSubArtifacts += renderDefinition(`${ artifactName }.${ name }`, subArtifacts[name], updatePrefixForDottedName(childEnv, name));

    if (renderedSubArtifacts === '')
      return '';

    return `${ result + renderedSubArtifacts + env.indent }};\n`;
  }

  /**
   * Check whether the given context is shadowed, i.e. part of his name prefix is shared by a
   *  non-context/service/namespace definition
   *
   * @param {string} artifactName
   * @returns {boolean}
   */
  function contextIsShadowed( artifactName ) {
    if (artifactName.indexOf('.') === -1)
      return false;

    const parts = artifactName.split('.');

    for (let i = 0; i < parts.length; i++) {
      const art = csn.definitions[parts.slice(0, i).join('.')];
      if (art && art.kind !== 'context' && art.kind !== 'service' && art.kind !== 'namespace')
        return true;
    }
    return false;
  }

  /**
   * In case of an artifact with . in the name (that are not a namespace/context part),
   * we need to update the env to correctly render the artifact name.
   *
   * @param {HdbcdsRenderEnvironment} env Environment
   * @param {string} name Possibly dotted artifact name
   * @returns {HdbcdsRenderEnvironment} Updated env or original instance
   */
  function updatePrefixForDottedName( env, name ) {
    if (plainNames) {
      let innerEnv = env;
      if (name.indexOf('.') !== -1) {
        const parts = name.split('.');
        for (let i = 0; i < parts.length - 1; i++)
          innerEnv = addNamePrefix(innerEnv, parts[i]);
      }

      return innerEnv;
    }
    return env;
  }

  /**
   * Render a namespace. Return the resulting source string.
   *
   * @param {string} artifactName Name of the namespace
   * @param {CSN.Artifact} art Content of the namespace
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} The rendered children of the namespace
   */
  function renderNamespace( artifactName, art, env ) {
    // We currently do not render anything for a namespace, we just append its id to
    // the environment's current name prefix and descend into its children
    let result = '';
    const childEnv = addNamePrefix(env, getLastPartOf(artifactName));
    const subArtifacts = getSubArtifacts(artifactName);
    for (const name in subArtifacts)
      result += renderDefinition(`${ artifactName }.${ name }`, subArtifacts[name], updatePrefixForDottedName(childEnv, name));

    return result;
  }

  /**
   * Render a non-query entity. Return the resulting source string.
   *
   * @param {string} artifactName Name of the entity
   * @param {CSN.Artifact} art Content of the entity
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} The rendered entity
   */
  function renderEntity( artifactName, art, env ) {
    let result = '';
    const childEnv = env.withIncreasedIndent();
    const normalizedArtifactName = renderArtifactName(artifactName, env);

    globalDuplicateChecker.addArtifact(art['@cds.persistence.name'], env.path, artifactName);

    if (hasHanaComment(art, options))
      result += `${ env.indent }@Comment: '${ getEscapedHanaComment(art) }'\n`;

    // tables can have @sql.prepend and @sql.append
    const { front, back } = getSqlSnippets(options, art);

    if (front) // attach @sql.prepend after adding @Comment annotation
      result += front;

    result += `${ env.indent + (art.abstract ? 'abstract ' : '') }entity ${ normalizedArtifactName }`;
    if (art.includes) {
      // Includes are never flattened (don't exist in HANA)
      result += ` : ${ art.includes.map((name, i) => renderAbsoluteNameWithQuotes(name, env.withSubPath([ 'includes', i ]))).join(', ') }`;
    }
    result += ' {\n';
    const duplicateChecker = new DuplicateChecker(); // registry for all artifact names and element names
    duplicateChecker.addArtifact(artifactName, env.path, artifactName);
    // calculate __aliases which must be used in case an association
    // has the same identifier as it's target
    createTopLevelAliasesForArtifact(artifactName, art, env);
    for (const name in art.elements)
      result += renderElement(name, art.elements[name], childEnv.withSubPath([ 'elements', name ]), duplicateChecker);

    duplicateChecker.check(error);
    result += `${ env.indent }}`;
    result += `${ renderTechnicalConfiguration(art.technicalConfig, env) }`;

    if (back)
      result += back;

    return `${ result };\n`;
  }

  /**
   * If an association/composition has the same identifier as it's target
   * we must render a "using target as __target" and use the alias to refer to the target
   *
   * @param {string} artName
   * @param {CSN.Artifact} art
   * @param {HdbcdsRenderEnvironment} env
   */
  function createTopLevelAliasesForArtifact( artName, art, env ) {
    forEachMember(art, (element) => {
      if (!element.target)
        return;

      if (uppercaseAndUnderscore(element.target) === element['@cds.persistence.name']) {
        let alias = createTopLevelAliasName(element['@cds.persistence.name']);
        // calculate new alias if it would conflict with other csn.Artifact
        while (csn.definitions[alias])
          alias = createTopLevelAliasName(alias);
        env.topLevelAliases[element['@cds.persistence.name']] = {
          quotedName: formatIdentifier(element['@cds.persistence.name']),
          quotedAlias: formatIdentifier(alias),
        };
      }
    });
  }

  /**
   * Render the 'technical configuration { ... }' section 'tc' of an entity.
   *
   * @param {object} tc content of the technical configuration
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} Return the resulting source string.
   */
  function renderTechnicalConfiguration( tc, env ) {
    if (!tc)
      return '';

    let result = '';
    const childEnv = env.withIncreasedIndent();

    // FIXME: How to deal with non-HANA technical configurations? We should probably just iterate all entries
    // in 'tc' that we find and render them all (is it syntactically allowed yet to have more than one?)
    tc = tc.hana;
    if (!tc)
      throw new ModelError('Expecting a SAP HANA technical configuration');

    result += `\n${ env.indent }technical ${ tc.calculated ? '' : 'hana ' }configuration {\n`;

    // Store type (must be separate because SQL wants it between 'CREATE' and 'TABLE')
    if (tc.storeType)
      result += `${ tc.storeType } store;\n`;

    // Fixed parts belonging to the table (includes migration, unload prio, extended storage,
    // auto merge, partitioning, ...)
    if (tc.tableSuffix) {
      // Unlike SQL, CDL and HANA CDS require a semicolon after each table-suffix part
      // (e.g. `migration enabled; row store; ...`). In order to keep both
      // the simplicity of "the whole bandwurm is just one expression that can be
      // rendered to SQL without further knowledge" and at the same time telling
      // CDS about the boundaries, the compactor has put each part into its own `xpr`
      // object. Semantically equivalent because a "trivial" SQL renderer would just
      // concatenate them.
      for (const xpr of tc.tableSuffix)
        result += `${ childEnv.indent + renderExpr(xpr, childEnv) };\n`;
    }

    // Indices and full-text indices
    for (const idxName in tc.indexes || {}) {
      if (Array.isArray(tc.indexes[idxName][0])) {
        // FIXME: Should we allow multiple indices with the same name at all?
        for (const index of tc.indexes[idxName])
          result += `${ childEnv.indent + renderExpr(index, childEnv) };\n`;
      }
      else {
        result += `${ childEnv.indent + renderExpr(tc.indexes[idxName], childEnv) };\n`;
      }
    }
    // Fuzzy search indices
    for (const columnName in tc.fzindexes || {}) {
      if (Array.isArray(tc.fzindexes[columnName][0])) {
        // FIXME: Should we allow multiple fuzzy search indices on the same column at all?
        // And if not, why do we wrap this into an array?
        for (const index of tc.fzindexes[columnName])
          result += `${ childEnv.indent + renderExpr(fixFuzzyIndex(index, columnName), childEnv) };\n`;
      }
      else {
        result += `${ childEnv.indent + renderExpr(fixFuzzyIndex(tc.fzindexes[columnName], columnName), childEnv) };\n`;
      }
    }
    result += `${ env.indent }}`;
    return result;


    /**
     *  Fuzzy indices are stored in compact CSN as they would appear in SQL after the column name,
     *  i.e. the whole line in SQL looks somewhat like this:
     *    s nvarchar(10) FUZZY SEARCH INDEX ON FUZZY SEARCH MODE 'ALPHANUM'
     *  But in CDL, we don't write fuzzy search indices together with the table column, so we need
     *  to insert the name of the column after 'ON' in CDS syntax, making it look like this:
     *    fuzzy search mode on (s) search mode 'ALPHANUM'
     *  This function expects an array with the original expression and returns an array with the modified expression
     *
     * @param {Array} fuzzyIndex Expression array representing the fuzzy index
     * @param {string} columnName Name of the SQL column
     * @returns {Array} Modified expression array
     */
    function fixFuzzyIndex( fuzzyIndex, columnName ) {
      return fuzzyIndex.map(token => (token === 'on' ? { xpr: [ 'on', { xpr: { ref: columnName.split('.') } } ] } : token));
    }
  }

  /**
   * Render an element (of an entity, type or annotation, not a projection or view).
   * Return the resulting source string.
   *
   * @param {string} elementName Name of the element
   * @param {CSN.Element} elm Content of the element
   * @param {HdbcdsRenderEnvironment} env Environment
   * @param {DuplicateChecker} [duplicateChecker] Utility for detecting duplicates
   * @param {boolean} [isSubElement] Whether the given element is a subelement or not - subelements cannot be key!
   * @returns {string} The rendered element
   */
  function renderElement( elementName, elm, env, duplicateChecker, isSubElement ) {
    // Ignore if toHana says so
    if (elm.virtual)
      return '';

    // Special handling for HANA CDS: Must omit the ':' before anonymous structured types (for historical reasons)
    const omitColon = (!elm.type && elm.elements);
    let result = '';
    const quotedElementName = formatIdentifier(elementName);
    if (duplicateChecker)
      duplicateChecker.addElement(quotedElementName, env.path, elementName);

    if (hasHanaComment(elm, options))
      result += `${ env.indent }@Comment: '${ getEscapedHanaComment(elm) }'\n`;

    result += env.indent + (elm.key && !isSubElement ? 'key ' : '') +
      (elm.masked ? 'masked ' : '') +
      quotedElementName + (omitColon ? ' ' : ' : ') +
      renderTypeReference(elm, env);
    // GENERATED AS ALWAYS() can't have a trailing "[not] null" nor "default".
    // Because we already emit an error that calc-on-write is not supported, just ignore nullability/default.
    if (!elm.value?.stored) {
      result += renderNullability(elm);
      if (elm.default && !elm.target)
        result += ` default ${ renderExpr(elm.default, env.withSubPath([ 'default' ])) }`;
    }

    // (table) elements can only have a @sql.append
    const { back } = getSqlSnippets(options, elm);

    if (back)
      result += back;

    return `${ result };\n`;
  }

  /**
   * Render the source of a query, which may be a path reference, possibly with an alias,
   * or a subselect, or a join operation, as seen from artifact 'art'.
   * Returns the source as a string.
   *
   * @param {object} source Source to render
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} Rendered view source
   */
  function renderViewSource( source, env ) {
    // Sub-SELECT
    if (source.SELECT || source.SET) {
      let result = `(${ renderQuery(source, false, env.withIncreasedIndent()) })`;
      if (source.as)
        result += ` as ${ formatIdentifier(source.as) }`;
      return result;
    }
    // JOIN
    else if (source.join) {
      // One join operation, possibly with ON-condition
      let result = `${ renderViewSource(source.args[0], env.withSubPath([ 'args', 0 ])) }`;
      for (let i = 1; i < source.args.length; i++) {
        result = `(${ result } ${ source.join } `;
        result += `join ${ renderViewSource(source.args[i], env.withSubPath([ 'args', i ])) }`;
        if (source.on)
          result += ` on ${ renderExpr(source.on, env.withSubPath([ 'on' ])) }`;

        result += ')';
      }
      return result;
    }
    // Ordinary path, possibly with an alias

    return renderAbsolutePathWithAlias(source, env);
  }

  /**
   * Render a path that starts with an absolute name (as used e.g. for the source of a query),
   * with plain or quoted names, depending on options. Expects an object 'path' that has a 'ref'.
   * Returns the name as a string.
   *
   * @param {object} path Path to render
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} Rendered path
   */
  function renderAbsolutePath( path, env ) {
    // Sanity checks
    if (!path.ref)
      throw new ModelError(`Expecting ref in path: ${ JSON.stringify(path) }`);


    // Determine the absolute name of the first artifact on the path (before any associations or element traversals)
    const firstArtifactName = path.ref[0].id || path.ref[0];

    let result = '';
    // Render the first path step (absolute name, with different quoting/naming ..)
    if (plainNames)
      result += renderAbsoluteNamePlain(firstArtifactName, env);
    else
      result += renderAbsoluteNameWithQuotes(firstArtifactName, env);

    // Even the first step might have parameters and/or a filter
    if (path.ref[0].args)
      result += `(${ renderArgs(path.ref[0], ':', env.withSubPath([ 'ref', 0 ])) })`;

    if (path.ref[0].where) {
      const cardinality = path.ref[0].cardinality ? (`${ path.ref[0].cardinality.max }: `) : '';
      result += `[${ cardinality }${ renderExpr(path.ref[0].where, env.withSubPath([ 'ref', 0, 'where' ])) }]`;
    }

    // Add any path steps (possibly with parameters and filters) that may follow after that
    if (path.ref.length > 1)
      result += `.${ renderTypeRef({ ref: path.ref.slice(1) }, env) }`;

    return result;
  }

  /**
   * Render a path that starts with an absolute name (as used for the source of a query),
   * possibly with an alias, with plain or quoted names, depending on options. Expects an object 'path' that has a
   * 'ref' and (in case of an alias) an 'as'. If necessary, an artificial alias
   * is created to the original implicit name.
   * Returns the name and alias as a string.
   *
   * @param {object} path Path to render
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} Rendered path including alias
   */
  function renderAbsolutePathWithAlias( path, env ) {
    let result = renderAbsolutePath(path, env);
    // Take care of aliases - for artifact references, use the resulting name (multi-dot joined with _)
    const implicitAlias = path.ref.length === 0 ? getLastPartOf(getResultingName(csn, options.sqlMapping, path.ref[0])) : getLastPartOfRef(path.ref);
    if (path.as) {
      // Source had an alias - render it
      result += ` as ${ formatIdentifier(path.as) }`;
    }
    else if (getLastPartOf(result) !== formatIdentifier(implicitAlias)) {
      // Render an artificial alias if the result would produce a different one
      result += ` as ${ formatIdentifier(implicitAlias) }`;
    }
    return result;
  }

  /**
   * Render a single view or projection column 'col', as it occurs in a select list or
   * projection list within 'art', possibly with annotations.
   * Return the resulting source string (no trailing LF).
   *
   * @param {object} col Column to render
   * @param {CSN.Elements} elements where column exists
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} Rendered column
   */
  function renderViewColumn( col, elements, env ) {
    const leaf = col.as || col.ref && col.ref[col.ref.length - 1] || col.func;
    const element = elements[leaf];

    // Render 'null as <alias>' only for database and if element is virtual
    if (element?.virtual) {
      if (isDeprecatedEnabled(options, '_renderVirtualElements'))
        return `${ env.indent }null as ${ formatIdentifier(leaf) }`;
      return '';
    }
    return renderNonVirtualColumn();


    function renderNonVirtualColumn() {
      let result = env.indent;
      // only if column is virtual, keyword virtual was present in the source text
      if (col.virtual)
        result += 'virtual ';
      // If key is explicitly set in a non-leading query, issue an error.
      if (col.key && env.skipKeys)
        error(null, env.path, { keyword: 'key', $reviewed: true }, 'Unexpected $(KEYWORD) in subquery');

      const key = (!env.skipKeys && (col.key || element?.key) ? 'key ' : '');
      result += key + renderExpr(withoutCast(col), env);
      let alias = col.as || (!col.args && col.func); // func: e.g. CURRENT_TIMESTAMP
      // HANA requires an alias for 'key' columns just for syntactical reasons
      // FIXME: This will not complain for non-refs (but that should be checked in forRelationalDB)
      // Explicit or implicit alias?
      // Shouldn't we simply generate an alias all the time?
      if ((key || col.cast) && !alias)
        alias = leaf;

      if (alias)
        result += ` as ${ formatIdentifier(alias) }`;

      // Explicit type provided for the view element?
      if (col.cast?.target) {
        // Special case: Explicit association type is actually a redirect
        // Redirections are never flattened (don't exist in HANA)
        result += ` : redirected to ${ renderAbsoluteNameWithQuotes(col.cast.target, env.withSubPath([ 'cast', 'target' ])) }`;
        if (col.cast.on)
          result += ` on ${ renderExpr(col.cast.on, env.withSubPath([ 'cast', 'on' ])) }`;
      }

      return result;
    }
  }

  /**
   * Render a view. If '$syntax' is set (to 'projection', 'view', 'entity'),
   * the view query is rendered in the requested syntax style, otherwise it
   * is rendered as a view.
   *
   * @param {string} artifactName Name of the artifact
   * @param {CSN.Artifact} art Content of the artifact
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} The rendered view
   */
  function renderView( artifactName, art, env ) {
    let result = '';
    const artifactPath = [ 'definitions', artifactName ];
    globalDuplicateChecker.addArtifact(art['@cds.persistence.name'], artifactPath, artifactName);

    if (hasHanaComment(art, options))
      result += `${ env.indent }@Comment: '${ getEscapedHanaComment(art) }'\n`;

    result += `${ env.indent }${ art.abstract ? 'abstract ' : '' }view ${ renderArtifactName(artifactName, env) }`;
    if (art.params) {
      const childEnv = env.withIncreasedIndent();
      const parameters = Object.keys(art.params)
        .map(name => renderParameter(name, art.params[name], childEnv.withSubPath([ 'params', name ])))
        .join(',\n');
      // SAP HANA only understands the 'with parameters' syntax'
      result += ` with parameters\n${ parameters }\n${ env.indent }as `;
    }
    else {
      result += ' as ';
    }
    env._artifact = art;
    result += renderQuery(getNormalizedQuery(art).query, true, env.withSubPath([ art.projection ? 'projection' : 'query' ]), art.elements);

    // views can only have a @sql.append
    const { back } = getSqlSnippets(options, art);
    if (back)
      result += back;

    result += ';\n';

    return result;
  }

  /**
   * Render a query 'query', i.e. a select statement with where-condition etc.
   * If 'isLeadingQuery' is true, mixins, actions and functions of 'art' are
   * also rendered into the query. Use 'syntax' style ('projection', 'view',
   * or 'entity')
   *
   * @param {CSN.Query} query Query object
   * @param {boolean} isLeadingQuery Whether the query is the leading query or not
   * @param {HdbcdsRenderEnvironment} env Environment
   * @param {object} [elements] For leading query, the elements of the artifact
   * @returns {string} The rendered query
   */
  function renderQuery( query, isLeadingQuery, env, elements = null ) {
    const isProjection = env.path[env.path.length - 1] === 'projection';
    let result = '';
    env.skipKeys = !isLeadingQuery;
    // Set operator, like UNION, INTERSECT, ...
    if (query.SET) {
      // First arg may be leading query
      result += `(${ renderQuery(query.SET.args[0], isLeadingQuery, env.withSubPath([ 'SET', 'args', 0 ]), elements || query.SET.elements) }`;
      // FIXME: Clarify if set operators can be n-ary (assuming binary here)
      if (query.SET.op) {
        // Loop over all other arguments, i.e. for A UNION B UNION C UNION D ...
        for (let i = 1; i < query.SET.args.length; i++)
          result += `\n${ env.indent }${ query.SET.op }${ query.SET.all ? ' all' : '' } ${ renderQuery(query.SET.args[i], false, env.withSubPath([ 'SET', 'args', i ]), elements || query.SET.elements) }`;
      }
      result += ')';
      // Set operation may also have an ORDER BY and LIMIT/OFFSET (in contrast to the ones belonging to
      // each SELECT)
      if (query.SET.orderBy)
        result += `${ continueIndent(result, env) }order by ${ query.SET.orderBy.map((entry, i) => renderOrderByEntry(entry, env.withSubPath([ 'SET', 'orderBy', i ]))).join(', ') }`;

      if (query.SET.limit)
        result += `${ continueIndent(result, env) }${ renderLimit(query.SET.limit, env.withSubPath([ 'SET', 'limit' ])) }`;

      return result;
    }
    // Otherwise must have a SELECT
    else if (!query.SELECT) {
      throw new ModelError(`Unexpected query operation ${ JSON.stringify(query) } at ${ JSON.stringify(env.path) }`);
    }

    if (!isProjection)
      env = env.withSubPath([ 'SELECT' ]);

    const select = query.SELECT;
    result += `select from ${ renderViewSource(select.from, env.withSubPath([ 'from' ])) }`;

    const childEnv = env.withIncreasedIndent();
    childEnv.currentArtifactName = $PROJECTION; // $self to be replaced by $projection
    if (select.mixin) {
      let elems = '';
      for (const name in select.mixin)
        elems += renderElement(name, select.mixin[name], childEnv.withSubPath([ 'mixin', name ]));

      if (elems) {
        result += ' mixin {\n';
        result += elems;
        result += `${ env.indent }} into`;
      }
    }
    result += select.distinct ? ' distinct' : '';
    if (select.columns) {
      result += ' {\n';
      result += select.columns
        .map((col, i) => renderViewColumn(col, elements || select.elements, childEnv.withSubPath([ 'columns', i ])))
        .filter(s => s !== '')
        .join(',\n');
      result += `\n${ env.indent }}`;
    }
    if (select.excluding) {
      const excludingList = select.excluding.map(id => `${ childEnv.indent }${ formatIdentifier(id) }`).join(',\n');
      result += ` excluding {\n${ excludingList }\n`;
      result += `${ env.indent }}`;
    }

    return renderSelectProperties(select, result, env);
  }

  /**
   * Render WHERE, GROUP BY, HAVING, ORDER BY and LIMIT clause
   *
   * @param {CSN.QuerySelect} select
   * @param {string} alreadyRendered The query as it has been rendered so far
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} The query with WHERE etc. added
   */
  function renderSelectProperties( select, alreadyRendered, env ) {
    if (select.where)
      alreadyRendered += `${ continueIndent(alreadyRendered, env) }where ${ renderExpr(select.where, env.withSubPath([ 'where' ])) }`;

    if (select.groupBy)
      alreadyRendered += `${ continueIndent(alreadyRendered, env) }group by ${ select.groupBy.map((expr, i) => renderExpr(expr, env.withSubPath([ 'groupBy', i ]))).join(', ') }`;

    if (select.having)
      alreadyRendered += `${ continueIndent(alreadyRendered, env) }having ${ renderExpr(select.having, env.withSubPath([ 'having' ])) }`;

    if (select.orderBy)
      alreadyRendered += `${ continueIndent(alreadyRendered, env) }order by ${ select.orderBy.map((entry, i) => renderOrderByEntry(entry, env.withSubPath([ 'orderBy', i ]))).join(', ') }`;

    if (select.limit)
      alreadyRendered += `${ continueIndent(alreadyRendered, env) }${ renderLimit(select.limit, env.withSubPath([ 'limit' ])) }`;

    return alreadyRendered;
  }

  /**
   * Utility function to make sure that we continue with the same indentation in WHERE, GROUP BY, ... after a closing curly brace and beyond
   *
   * @param {string} result Result of a previous render step
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} String to join with
   */
  function continueIndent( result, env ) {
    if (result.endsWith('}') || result.endsWith('})')) {
      // The preceding clause ended with '}', just append after that
      return ' ';
    }
    // Otherwise, start new line and indent normally
    return `\n${ env.withIncreasedIndent().indent }`;
  }

  /**
   * Render a query's LIMIT clause, which may also have OFFSET.
   *
   * @param {CSN.QueryLimit} limit CSN limit clause
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} Rendered limit clause
   */
  function renderLimit( limit, env ) {
    let result = '';
    if (limit.rows !== undefined)
      result += `limit ${ renderExpr(limit.rows, env.withSubPath([ 'rows' ])) }`;

    if (limit.offset !== undefined) {
      const indent = result !== '' ? `\n${ env.withIncreasedIndent().indent }` : '';
      result += `${ indent }offset ${ renderExpr(limit.offset, env.withSubPath([ 'offset' ])) }`;
    }

    return result;
  }

  /**
   * Render one entry of a query's ORDER BY clause (which always has a 'value' expression, and may
   * have a 'sort' property for ASC/DESC and a 'nulls' for FIRST/LAST
   *
   * @param {object} entry CSN order by
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} Rendered order by
   */
  function renderOrderByEntry( entry, env ) {
    let result = renderExpr(entry, env);
    if (entry.sort)
      result += ` ${ entry.sort }`;

    if (entry.nulls)
      result += ` nulls ${ entry.nulls }`;

    return result;
  }

  /**
   * Render a view parameter.
   *
   * @param {string} parName Name of the parameter
   * @param {object} par CSN parameter
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} The resulting parameter as source string (no trailing LF).
   */
  function renderParameter( parName, par, env ) {
    if (par.notNull === true || par.notNull === false)
      info('query-ignoring-param-nullability', env.path, { '#': 'std' });
    return `${ env.indent + formatParamIdentifier(parName, env.path) } : ${ renderTypeReference(par, env) }`;
  }

  /**
   * Render a type (derived or structured).
   * Return the resulting source string.
   *
   * @param {string} artifactName Name of the artifact
   * @param {CSN.Artifact} art Content of the artifact
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} Rendered type/annotation
   */
  function renderType( artifactName, art, env ) {
    if (art.kind === 'aspect' || art.kind === 'type' && !hdbcdsNames || art.kind === 'type' && hdbcdsNames && !art.elements)
      return '';
    let result = '';
    result += `${ env.indent + (art.kind) } ${ renderArtifactName(artifactName, env, true) }`;
    if (art.includes) {
      // Includes are never flattened (don't exist in HANA)
      result += ` : ${ art.includes.map(name => renderAbsoluteNameWithQuotes(name, env)).join(', ') }`;
    }
    if (art.elements && !art.type) {
      const childEnv = env.withIncreasedIndent();
      // Structured type or annotation with anonymous struct type
      result += ' {\n';
      for (const name in art.elements)
        result += renderElement(name, art.elements[name], childEnv.withSubPath([ 'elements', name ]));

      result += `${ env.indent }};\n`;
    }
    else {
      // Derived type or annotation with non-anonymous type
      result += ` : ${ renderTypeReference(art, env) };\n`;
    }
    return result;
  }

  /**
   * Render a reference to a type used by 'elm' (named or inline)
   * Allow suppressing enum-rendering - used in columns for example
   *
   * @param {object} elm Element using the type reference
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} Rendered type reference
   */
  function renderTypeReference( elm, env ) {
    let result = '';

    // Array type: Render items instead
    if (elm.items && !elm.type) {
      // HANA CDS does not support keyword many
      let rc = `array of ${ renderTypeReference(elm.items, env.withSubPath([ 'items' ])) }`;
      if (elm.items.notNull != null)
        rc += elm.items.notNull ? ' not null' : ' null';
      return rc;
    }

    // FIXME: Is this a type attribute?
    result += (elm.localized ? 'localized ' : '');

    // Anonymous structured type
    if (!elm.type && !elm.value) {
      if (!elm.elements)
        throw new ModelError(`Missing type of: ${ JSON.stringify(elm) }`);

      result += '{\n';
      const childEnv = env.withIncreasedIndent();
      // omit "key" keyword for nested elements, as this will result in a deployment error in naming mode 'hdbcds'
      const dontRenderKeyForNestedElement = hdbcdsNames;
      for (const name in elm.elements)
        result += renderElement(name, elm.elements[name], childEnv.withSubPath([ 'elements', name ]), null, dontRenderKeyForNestedElement);

      result += `${ env.indent }}`;
      return result;
    }

    // Association type
    if ([ 'cds.Association', 'cds.Composition' ].includes(elm.type))
      return result + renderAssociationType(elm, env);

    if (elm.type?.ref) {
      // Reference to another element
      // For HANA CDS, we need a 'type of'
      result += `type of ${ renderAbsolutePath(elm.type, env.withSubPath([ 'type' ])) }`;
    }
    else if (isBuiltinType(elm.type)) {
      // If we get here, it must be a named type
      result += renderBuiltinType(elm);
    }
    else {
      // Simple absolute name
      // Type names are never flattened (derived types are unraveled in HANA)
      result += renderAbsoluteNameWithQuotes(elm.type, env.withSubPath([ 'type' ]));
    }

    if (elm.value) {
      if (!elm.value.stored)
        throw new CompilerAssertion('Found calculated element on-read in rendering; should have been replaced!');
      message('def-unsupported-calc-elem', env.path, { '#': 'hdbcds' });
      result += ` GENERATED ALWAYS AS ${ renderExpr(elm.value, env.withSubPath([ 'value' ])) }`;
      return result;
    }

    return result;
  }

  /**
   * @param {CSN.Element} elm
   * @param {HdbcdsRenderEnvironment} env
   * @returns {string}
   */
  function renderAssociationType( elm, env ) {
    // Type, cardinality and target
    let result = `association${ renderCardinality(elm.cardinality) } to `;

    // normal target or named aspect
    if (elm.target || elm.targetAspect && typeof elm.targetAspect === 'string') {
      // we might have a "using target as __target"
      const targetArtifact = csn.definitions[elm.target];
      const targetAlias = env.topLevelAliases[targetArtifact['@cds.persistence.name']];
      if (targetAlias) {
        result += targetAlias.quotedAlias;
      }
      else {
        const target = elm.target || elm.targetAspect;
        const childEnv = env.withSubPath([ elm.target ? 'target' : 'targetAspect' ]);
        result += plainNames ? renderAbsoluteNamePlain(target, childEnv) : renderAbsoluteNameWithQuotes(target, childEnv);
      }
    }

    // ON-condition (if any)
    if (elm.on) {
      result += ` on ${ renderExpr(elm.on, env.withSubPath([ 'on' ])) }`;
    }
    else if (elm.targetAspect?.elements) { // anonymous aspect
      const childEnv = env.withIncreasedIndent();
      result += '{\n';
      for (const name in elm.targetAspect.elements)
        result += renderElement(name, elm.targetAspect.elements[name], childEnv.withSubPath([ 'targetAspect', 'elements', name ]));

      result += `${ env.indent }}`;
    }

    // Foreign keys (if any, unless we also have an ON_condition (which means we have been transformed from managed to unmanaged)
    if (elm.keys && !elm.on)
      result += ` { ${ Object.keys(elm.keys).map(name => renderForeignKey(elm.keys[name], env.withSubPath([ 'keys', name ]))).join(', ') } }`;

    return result;
  }

  /**
   * Render a builtin type. cds.Integer => render as Integer (no quotes)
   * Map Decimal (w/o Prec/Scale) to cds.DecimalFloat for HANA CDS
   *
   * @param {CSN.Element} elm Element with the type
   * @returns {string} The rendered type
   */
  function renderBuiltinType( elm ) {
    if (elm.type === 'cds.Decimal' && elm.scale === undefined && elm.precision === undefined)
      return 'DecimalFloat';

    const type = cdsToHdbcdsTypes[elm.type] || elm.type;
    return type.replace(/^cds\./, '') + renderTypeParameters(elm);
  }

  /**
   * Render a single path step 's' at path position 'idx', which can have filters or parameters or be a function
   *
   * @param {string|object} s Path step
   * @param {number} idx Path position
   * @param {HdbcdsRenderEnvironment} env
   * @returns {string} Rendered path step
   */
  function renderPathStep( s, idx, env ) {
    // Simple id or absolute name
    if (typeof s === 'string') {
      // HANA-specific extra magic (should actually be in forRelationalDB)
      // In HANA, we replace leading $self by the absolute name of the current artifact
      // (see FIXME at renderDefinition)
      if (idx === 0 && s === $SELF) {
        // do not produce USING for $projection
        if (env.currentArtifactName === $PROJECTION)
          return env.currentArtifactName;

        return plainNames ? renderAbsoluteNamePlain(env.currentArtifactName, env)
          : renderAbsoluteNameWithQuotes(env.currentArtifactName, env);
      }

      // TODO: quote $parameters if it doesn't reference a parameter, this requires knowledge about the kind
      // Example: both views are correct in HANA CDS
      // entity E { key id: Integer; }
      // view EV with parameters P1: Integer as select from E { id, $parameters.P1 };
      // view EVp as select from E as "$parameters" { "$parameters".id };

      if (idx === 0 &&
            [ $SELF, $PROJECTION, '$session' ].includes(s))
        return s;

      return formatIdentifier(s);
    }
    // ID with filters or parameters
    else if (typeof s === 'object') {
      // Sanity check
      if (!s.func && !s.id)
        throw new ModelError(`Unknown path step object: ${ JSON.stringify(s) }`);

      // Not really a path step but an object-like function call
      if (s.func)
        return `${ s.func }(${ renderArgs(s, '=>', env) })`;

      // Path step, possibly with view parameters and/or filters
      let result = `${ formatIdentifier(s.id) }`;
      if (s.args) {
        // View parameters
        result += `(${ renderArgs(s, ':', env) })`;
      }
      if (s.where) {
        // Filter, possibly with cardinality
        const cardinality = s.cardinality ? `${ s.cardinality.max }: ` : '';
        result += `[${ cardinality }${ renderExpr(s.where, env.withSubPath([ 'where' ])) }]`;
      }
      return result;
    }

    throw new ModelError(`Unknown path step: ${ JSON.stringify(s) } at ${ JSON.stringify(env.path) }`);
  }

  /**
   * @param {object} x Expression with a val and/or literal property
   * @returns {string} Rendered expression
   */
  function renderExpressionLiteral( x ) {
    // Literal value, possibly with explicit 'literal' property
    switch (x.literal || typeof x.val) {
      case 'number':
      case 'boolean':
      case 'null':
        return x.val;
      case 'x':
      case 'date':
      case 'time':
      case 'timestamp':
        return `${ x.literal }'${ x.val }'`;
      case 'string':
        return renderStringForHdbcds(x.val);
      case 'object':
        if (x.val === null)
          return 'null';

        // otherwise fall through to
      default:
        throw new ModelError(`Unknown literal or type: ${ JSON.stringify(x) }`);
    }
  }

  /**
   * Render the given expression x - which has a .func property
   *
   * @param {object} x
   * @returns {string}
   */
  function renderExpressionFunc( x ) {
    const regex = RegExp(/^[a-zA-Z][\w#$]*$/, 'g');
    const funcName = regex.test(x.func) ? x.func : quoteId(x.func);
    // we can't quote functions with parens, issue warning if it is a reserved keyword
    if (!funcWithoutParen(x, 'hana') && keywords.hdbcds.includes(uppercaseAndUnderscore(funcName)))
      warning(null, this.env.path, { id: uppercaseAndUnderscore(funcName) }, 'The identifier $(ID) is a SAP HANA keyword');
    return renderFunc(funcName, x, a => renderArgs(a, '=>', this.env), { options });
  }


  /**
   * Render a magic variable.  Values are determined in following order:
   *   1. User defined replacement in options.variableReplacements
   *   2. Predefined fallback values
   *   3. Rendering of the variable as a string (i.e. its name) + warning
   *
   * @param {CSN.Path} ref
   * @param {object} env
   * @return {string}
   */
  function renderMagicVariable( ref, env ) {
    const magicReplacement = getVariableReplacement(ref, options);
    if (magicReplacement !== null)
      return renderStringForHdbcds(magicReplacement);

    const name = pathName(ref);
    const result = variableForDialect(options, name);
    if (result)
      return result;

    if (isVariableReplacementRequired(name)) {
      reportedMissingReplacements[name] = true;
      error('ref-undefined-var', env.path, { '#': 'value', id: name, option: 'variableReplacements' });
    }
    else if (!reportedMissingReplacements[name]) {
      reportedMissingReplacements[name] = true;
      warning('ref-unsupported-variable', env.path, { name, option: 'variableReplacements' },
              'Variable $(NAME) is not supported. Use option $(OPTION) to specify a value for $(NAME)');
    }

    return renderStringForHdbcds(name);
  }

  /**
   * Must not be used for type refs, as something like `$user` will be interpreted as a magic
   * variable and not definition name.
   *
   * @param {object} x Expression with a ref property
   * @returns {string} Rendered expression
   * @todo no extra magic with x.param
   */
  function renderExpressionRef( x ) {
    if (!x.param && isMagicVariable(pathId(x.ref[0])))
      return renderMagicVariable(x.ref, this.env);

    const prefix = x.param ? ':' : '';
    const ref = x.ref.map((step, index) => renderPathStep(step, index, this.env.withSubPath([ 'ref', index ]))).join('.');
    return `${ prefix }${ ref }`;
  }

  function renderTypeRef( x, env ) {
    const prefix = x.param ? ':' : '';
    const ref = x.ref.map((step, index) => renderPathStep(step, index, env.withSubPath([ 'ref', index ]))).join('.');
    return `${ prefix }${ ref }`;
  }

  /**
   * Render function arguments or view parameters (positional if array, named if object/dict),
   * using 'sep' as separator for positional parameters
   *
   * @param {object} node with `args` to render
   * @param {string} sep Separator between arguments
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} Rendered arguments
   */
  function renderArgs( node, sep, env ) {
    const args = node.args || {};
    // Positional arguments
    if (Array.isArray(args)) {
      return args.map((arg, i) => renderExpr(arg, env.withSubPath([ 'args', i ]))).join(', ');
    }
    // Named arguments (object/dict)
    else if (typeof args === 'object') {
      // if this is a function param which is not a reference to the model, we must not quote it
      return Object.keys(args)
        .map(key => `${ node.func ? key : formatIdentifier(key) } ${ sep } ${ renderExpr(args[key], env.withSubPath([ 'args', key ])) }`)
        .join(', ');
    }


    throw new ModelError(`Unknown args: ${ JSON.stringify(args) }`);
  }

  /**
   * Render a cardinality (only those parts that were actually provided)
   *
   * @param {CSN.Cardinality} card Cardinality
   * @returns {string} Rendered cardinality
   */
  function renderCardinality( card ) {
    if (!card)
      return '';

    let result = '[';
    if (card.src !== undefined)
      result += `${ card.src }, `;

    if (card.min !== undefined)
      result += `${ card.min }..`;

    if (card.max !== undefined)
      result += card.max;

    return `${ result }]`;
  }

  /**
   * Render the nullability of an element or parameter (can be unset, true, or false)
   *
   * @param {object} obj Thing to render for
   * @returns {string} null/not null
   */
  function renderNullability( obj /* , env */) {
    if (obj.notNull === undefined) {
      // Attribute not set at all
      return '';
    }
    return obj.notNull ? ' not null' : ' null';
  }

  /**
   * Render a foreign key (no trailing LF)
   *
   * @todo Can this still happen after Hana transformation?
   *
   * @param {object} fKey Foreign key to render
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} Rendered foreign key
   */
  function renderForeignKey( fKey, env ) {
    const alias = fKey.as ? (` as ${ formatIdentifier(fKey.as) }`) : '';
    return `${ renderExpr(fKey, env) }${ alias }`;
  }

  /**
   * Render (primitive) type parameters of element 'elm', i.e.
   * length, precision and scale (even if incomplete), plus any other unknown ones.
   *
   * @param {CSN.Element} elm Element to render type parameters for
   * @returns {string} Rendered type parameters
   */
  function renderTypeParameters( elm /* , env */) {
    const params = [];
    // Length, precision and scale (even if incomplete)
    if (elm.length !== undefined)
      params.push(elm.length);

    if (elm.precision !== undefined)
      params.push(elm.precision);

    if (elm.scale !== undefined)
      params.push(elm.scale);

    if (elm.srid !== undefined)
      params.push(elm.srid);

    return params.length === 0 ? '' : `(${ params.join(', ') })`;
  }

  /**
   * Render an absolute name in 'plain' mode, i.e. uppercased and underscored. Also record the
   * fact that 'absName' is used in 'env', so that an appropriate USING can be constructed
   * if necessary.
   *
   * @param {string} absName Absolute name
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} Uppercased and underscored absName
   */
  function renderAbsoluteNamePlain( absName, env ) {
    // Add using declaration
    env.topLevelAliases[absName] = {
      quotedName: formatIdentifier(uppercaseAndUnderscore(absName)),
      quotedAlias: formatIdentifier(uppercaseAndUnderscore(absName)),
    };
    return formatIdentifier(uppercaseAndUnderscore(absName));
  }

  /**
   * Render an absolute name 'absName', with appropriate quotes. Also record the
   * fact that 'absName' is used in 'env', so that an appropriate USING can be constructed
   * if necessary.
   *
   * @param {string} absName absolute name
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} absName, with correct quotes
   */
  function renderAbsoluteNameWithQuotes( absName, env ) {
    // Special case: If the top-level artifact name is not a valid artifact name, it came from an unchecked annotation
    // and must be left as it is (just quoted)
    let topLevelName = getRootArtifactName(absName, csn);
    const realName = getRealName(csn, absName);

    if (realName === absName)
      topLevelName = absName;

    if (!csn.definitions[topLevelName])
      return quotePathString(absName);


    // Another special case: If we are rendering for HANA, and if the first path step is an artifact that is
    // 'implemented in' something, we need to treat the whole name like a top-level id.
    if (csn.definitions[absName]?.['@cds.persistence.exists']) {
      env.topLevelAliases[absName] = {
        quotedName: quoteAbsoluteNameAsId(absName),
        quotedAlias: quoteId(createTopLevelAliasName(absName)),
      };
      return env.topLevelAliases[absName].quotedAlias;
    }

    // Retrieve or create a suitable alias name for the surrounding top-level artifact
    let topLevelAlias = env.topLevelAliases[topLevelName];
    if (!topLevelAlias) {
      env.topLevelAliases[topLevelName] = {
        quotedName: quoteAbsolutePathString(topLevelName),
        quotedAlias: quoteId(createTopLevelAliasName(topLevelName)),
      };
      topLevelAlias = env.topLevelAliases[topLevelName];
    }

    // Replace the top-level name with its alias
    if (absName === topLevelName) {
      return topLevelAlias.quotedAlias;
    }
    else if (csn.definitions[absName] && realName !== absName) {
      // special handling for names with dots

      const prefix = absName.slice(0, absName.length - realName.length);
      const nonTopLevelPrefix = prefix.slice(topLevelName.length + 1, -1); // also trim off .
      if (nonTopLevelPrefix)
        return `${ topLevelAlias.quotedAlias }.${ quotePathString(nonTopLevelPrefix) }.${ quotePathString(realName) }`;

      return `${ topLevelAlias.quotedAlias }.${ quotePathString(realName) }`;
    }
    return `${ topLevelAlias.quotedAlias }.${ quotePathString(realName) }`;
  }

  /**
   * Create a suitable alias name for a top-level artifact name. Ideally, it should not conflict with
   * any other identifier in the model and be somewhat recognizable and un-ugly...
   *
   * @todo check for conflicts instead of praying that it works...
   * @param {string} topLevelName Name of a top-level artifact
   * @returns {string} Appropriate __alias
   */
  function createTopLevelAliasName( topLevelName ) {
    // FIXME: We should rather check for conflicts than just using something obscure like this ...
    return `__${ topLevelName.replace(/::/g, '__').replace(/\./g, '_') }`;
  }

  /**
   * Render appropriate USING directives for all artifacts used by artifact 'artifactName' in 'env'.
   *
   * @param {string} artifactName Artifact to render usings for
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} Usings for the given artifact
   */
  function renderUsings( artifactName, env ) {
    const distinct = {};
    Object.keys(env.topLevelAliases)
      .filter(name => env.topLevelAliases[name].quotedAlias !== formatIdentifier(uppercaseAndUnderscore(artifactName))) // avoid "using FOO as FOO" in FOO.cds
      .forEach((name) => {
        const nativeObjectExists = csn.definitions[name]?.['@cds.persistence.exists'];
        if (!plainNames && nativeObjectExists)
          checkForNameClashesWithNativeObject(name);
        distinct[`using ${ env.topLevelAliases[name].quotedName } as ${ env.topLevelAliases[name].quotedAlias };\n`] = '';
      });
    /**
     * If we generate a `using <native object> from <bar>` clause,
     * we warn if we generate a SAP HANA CDS artifact which would hide the
     * native DB object from being found by the SAP HANA CDS compiler
     * see cap/cds-compiler#8269 for details
     * @param {string} name of the native db object
     */
    function checkForNameClashesWithNativeObject( name ) {
      const possibleShadowName = getNamePrefix(env.topLevelAliases[name].quotedName);
      const mightBeShadowedBy = csn.definitions[possibleShadowName];
      if (mightBeShadowedBy) {
        const artifactWillBeRendered = isArtifactRendered(mightBeShadowedBy, possibleShadowName);
        // only warn if actually rendered to HANA CDS
        if (artifactWillBeRendered)
          warning('anno-hidden-exists', [ 'definitions', name ], { name: possibleShadowName }, 'Native database object is hidden by a definition starting with $(NAME)');
      }
    }

    function isArtifactRendered( art, artName ) {
      const isHanaCdsContext = art.kind === 'service' || art.kind === 'context';
      if (isHanaCdsContext)
        return isContextRendered(artName);
      if ([ 'action', 'function', 'event' ].includes(art.kind) || options.sqlMapping !== 'hdbcds' && art.kind === 'type')
        return false;
      return !(art['@cds.persistence.exists'] || hasPersistenceSkipAnnotation(art));
    }

    /**
     * Check if there is at least one entity which will be rendered as SAP HANA CDS entity
     * inside the given context (or in its sub-contexts).
     * Or in other words: If the context will be rendered as a SAP HANA CDS context in the end.
     *
     * @param {string} contextName
     * @returns {boolean} true if a context/service will be rendered as a SAP HANA CDS context.
     */
    function isContextRendered( contextName ) {
      const subArtifacts = getSubArtifacts(contextName);
      return Object.entries(subArtifacts).some(([ artName, art ]) => {
        if (art.kind === 'context')
          return isContextRendered(`${ contextName }.${ artName }`);
        return isArtifactRendered(art, artName);
      });
    }

    /**
     * @param {string} usingName the string which appears in the `using <string> from ..` including the quotes
     * @returns the prefix of the `using` name.
     * @example
     *  "com.sap.foo.native.object"  -->  com
     *  "com.sap.foo::native.object" -->  com.sap.foo.native
     */
    function getNamePrefix( usingName ) {
      usingName = usingName.replace(/"/g, '');
      if (usingName.indexOf('::') !== -1) {
        const parts = usingName.split('::');
        return `${ parts[0] }.${ parts[1].split('.')[0] }`;
      }
      return usingName.split('.')[0];
    }
    return Object.keys(distinct).join('');
  }

  /**
   * Depending on the naming style, render the namespace declaration for a top-level artifact 'name'
   * if it has a namespace parent. Assume that this is only called for top-level artifacts.
   *  - For 'quoted' and 'hdbcds' names, render the namespace declaration (resulting in '.' or '::' style names)
   *  - For 'plain' names, do not render anything (namespace already part of flattened names).
   * Return the namespace declaration (with trailing LF) or an empty string.
   *
   * @param {string} topLevelName Name of a top-level artifact
   * @param {HdbcdsRenderEnvironment} env Environment
   * @returns {string} Rendered namespace declaration
   */
  function renderNamespaceDeclaration( topLevelName, env ) {
    if (plainNames) {
      // No namespaces in plain mode
      return '';
    }
    // The top-level artifact's parent would be the namespace (if any)
    const namespace = getNamespace(csn, topLevelName);
    if (namespace)
      return `${ env.indent }namespace ${ quotePathString(namespace) };\n`;

    return '';
  }

  /**
   * Return a dictionary of top-level artifacts contained in the model (by their name)
   *
   * @returns {CSN.Definitions} Dictionary of top-level artifacts name:content
   */
  function getTopLevelArtifacts() {
    const result = Object.create(null);
    for (const name in csn.definitions) {
      if (plainNames) {
        const art = csn.definitions[name];
        // For 'plain' naming, take all entities and views, nothing else
        if (art.kind === 'entity')
          result[name] = art;
      }
      else {
        // For all other naming conventions, take all top-level artifacts except namespaces
        const topLevelName = getRootArtifactName(name, csn);
        const topLevelArtifact = csn.definitions[topLevelName];
        if (topLevelArtifact && topLevelArtifact.kind !== 'namespace')
          result[topLevelName] = topLevelArtifact;
      }
    }
    return options && options.testMode ? sort(result) : result;
  }

  /**
   * Returns a newly created default environment (which keeps track of indentation, required USING
   * declarations and name prefixes.
   *
   * @param {object} [values]
   * @returns {HdbcdsRenderEnvironment} Fresh environment
   */
  function createEnv( values = {} ) {
    return new HdbcdsRenderEnvironment(values);
  }

  /**
   * Returns a copy of 'env' with (quoted) name prefix 'id' and a dot appended to the current name prefix
   *
   * @param {HdbcdsRenderEnvironment} env Current environment
   * @param {string} id Name prefix to add
   * @returns {HdbcdsRenderEnvironment} New environment with added prefix
   */
  function addNamePrefix( env, id ) {
    return env.cloneWith({ namePrefix: `${ env.namePrefix + quoteId(id) }.` });
  }

  /**
   * Return a path string 'path' with appropriate "-quotes.
   *
   * @param {string} path Path to quote
   * @returns {string} Quoted path
   */
  function quotePathString( path ) {
    // "foo"."bar"."wiz"."blub"
    return path.split('.').map(quoteId).join('.');
  }

  /**
   * Return an absolute path 'absPath', with '::' inserted if required by naming strategy 'hdbcds',
   * with appropriate "-quotes
   *
   * @param {string} absPath Absolute path to quote
   * @returns {string} Quoted path
   */
  function quoteAbsolutePathString( absPath ) {
    const namespace = getNamespace(csn, absPath);
    const resultingName = getResultingName(csn, options.sqlMapping, absPath);

    if (hdbcdsNames && namespace)
      return `${ quotePathString(namespace) }::${ quotePathString(resultingName.slice(namespace.length + 2)) }`;

    return quotePathString(resultingName);
  }

  /**
   * Return an id 'id' with appropriate double-quotes
   *
   * @param {string} id Identifier to quote
   * @returns {string} Properly quoted identifier
   */
  function quoteId( id ) {
    switch (options.sqlMapping) {
      case 'plain':
        return smartId(id, 'hdbcds');
      case 'quoted':
      case 'hdbcds':
      default:
        return delimitedId(id, 'hdbcds');
    }
  }

  /*
   * Return an absolute name 'absName', with '::' inserted if required by naming strategy 'hdbcds', quoted
   * as if it was a single identifier (required only for native USINGs)
   *
   * @param {string} absName Absolute name
   * @returns {string} Correctly quoted absName
   */
  function quoteAbsoluteNameAsId( absName ) {
    const resultingName = getResultingName(csn, options.sqlMapping, absName);

    if (hdbcdsNames) {
      const namespace = getNamespace(csn, absName);
      if (namespace) {
        const id = `${ namespace }::${ resultingName.substring(namespace.length + 2) }`;
        return `"${ id.replace(/"/g, '""') }"`;
      }
    }
    return `"${ resultingName.replace(/"/g, '""') }"`;
  }

  /**
   * Quote and/or uppercase an identifier 'id', depending on naming strategy
   *
   * @param {string} id Identifier
   * @returns {string} Quoted/uppercased id
   */
  function formatIdentifier( id ) {
    id = plainNames ? id.toUpperCase() : id;
    return quoteId(id);
  }

  /**
   * Quote or uppercase a parameter identifier 'id', depending on naming strategy
   * Smart quoting cannot be applied to the parameter identifiers, issue warning instead.
   *
   *
   * @param {string} id Identifier
   * @param {CSN.Path} [location] Optional location for the warning.
   * @returns {string} Quoted/uppercased id
   */
  function formatParamIdentifier( id, location ) {
    // Warn if colliding with HANA keyword, but do not quote for plain
    // --> quoted reserved words as param lead to a weird deployment error
    if (keywords.hdbcds.includes(uppercaseAndUnderscore(id)))
      warning(null, location, { id }, 'The identifier $(ID) is a SAP HANA keyword');

    if (plainNames)
      return uppercaseAndUnderscore(id);

    return quoteId(id);
  }

  /**
   * Render the name of an artifact, using the current name prefix from 'env'
   * and the real name of the artifact. In case of plain names, this
   * is equivalent to simply flattening and uppercasing the whole name.
   *
   * To handle such cases for hdbcds in quoted/hdbcds, we:
   * - Find the part of the name that is no longer prefix (context/service/namespace)
   * - For Service.E -> E, for Service.E.Sub -> E.Sub
   * - Replace all dots in this "real name" with underscores
   * - Join with the env prefix
   *
   *
   * @param {string} artifactName Artifact name to render
   * @param {HdbcdsRenderEnvironment} env Render environment
   * @param {boolean} [fallthrough=false] For certain artifacts, plain-rendering is supposed to look like quoted/hdbcds
   * @returns {string} Artifact name ready for rendering
   */
  function renderArtifactName( artifactName, env, fallthrough = false ) {
    if (plainNames && !fallthrough)
      return formatIdentifier(uppercaseAndUnderscore(artifactName));
    // hdbcds with quoted or hdbcds naming
    return env.namePrefix + quoteId(getRealName(csn, artifactName).replace(/\./g, '_'));
  }

  /**
   * For 'name', replace '.' by '_', convert to uppercase, and add double-quotes if
   * required because of non-leading '$' (but do not consider leading '$', other special
   * characters, or SQL keywords/functions - somewhat weird but this retains maximum
   * compatibility with a future hdbtable-based solution and with sqlite, where non-leading
   * '$' is legal again but nothing else)
   *
   * @param {string} name Name to transform
   * @returns {string} Uppercased and underscored name
   */
  function uppercaseAndUnderscore( name ) {
    // Always replace '.' by '_' and uppercase
    return name.replace(/\./g, '_').toUpperCase();
  }
}

module.exports = { toHdbcdsSource };
