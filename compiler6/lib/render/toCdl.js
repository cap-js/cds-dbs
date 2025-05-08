'use strict';

// to.cdl() renderer
//
// This file contains the whole to.cdl(), which takes CSN and outputs CDL.
// It used e.g. by `cds import`.
//
//
// # Development Notes
//
// ## Abbreviations used
//  - fqn : fully qualified name, i.e. a name that is a global definition reference
//


const keywords = require('../base/keywords');
const { cdlNewLineRegEx } = require('../language/textUtils');
const { findElement, createExpressionRenderer, withoutCast } = require('./utils/common');
const { escapeString, hasUnpairedUnicodeSurrogate } = require('./utils/stringEscapes');
const { checkCSNVersion } = require('../json/csnVersion');
const { normalizeTypeRef, forEachDefinition } = require('../model/csnUtils');
const enrichUniversalCsn = require('../transform/universalCsn/universalCsnEnricher');
const { isBetaEnabled } = require('../base/model');
const { ModelError, CompilerAssertion } = require('../base/error');
const { typeParameters, specialFunctions } = require('../compiler/builtins');
const { isAnnotationExpression } = require('../base/builtins');
const { forEach } = require('../utils/objectUtils');
const { isBuiltinType } = require('../base/builtins');
const { cloneFullCsn } = require('../model/cloneCsn');
const { getKeysDict, implicitAs } = require('../model/csnRefs');
const { undelimitedIdentifierRegex } = require('../parsers/identifiers');
const { getNormalizedQuery } = require('../model/csnUtils');
const {
  line,
  pretty,
  nestBy,
  bracketBlock,
  joinDocuments,
} = require('./utils/pretty');

const specialFunctionKeywords = Object.create(null);

const MAX_LINE_WIDTH = 72;
const INDENT_SIZE = 2;

function format( document ) {
  return pretty(document, MAX_LINE_WIDTH);
}

/**
 * @param {string} path
 * @returns {string}
 */
function rootPathSegment( path ) {
  // RegEx is at least twice as fast as .split()[0]
  return path.match(/^[^.]+/)[0];
}

/**
 * Path alias to be rendered as a USING statement.
 */
class UsingAlias {
  path;
  alias;

  /**
   * @param {string} path
   * @param {string} alias
   */
  constructor(path, alias) {
    this.path = path;
    this.alias = alias;
  }

  requiresExplicitAlias() {
    return this.alias && implicitAs(this.path) !== this.alias;
  }
}

class NameScopeStack {
  /** @type {DefinitionPathTree[]} */
  #scopes = [];
  /** @type {Record<string, UsingAlias>} */
  #aliasToFqn = Object.create(null);
  /** @type {Record<string, UsingAlias>} */
  #fqnToAlias = Object.create(null);
  /** @type {string|null} */
  #namespaceAlias = null;

  /**
   @param {DefinitionPathTree} root
   @param {CSN.Model} csn
   */
  setRootScope( root, csn ) {
    root.availableRootPaths = Object.assign(Object.create(null), root.children);
    this.#scopes = [ root ];

    this.#prepareUniqueUsingsForRootPaths(csn);
  }

  /**
   * @param {DefinitionPathTree} scope
   */
  pushNameEnv(scope) {
    const outerScope = this.#scopes.at(-1);

    const isNamespace = this.#scopes.length === 1 && !scope.definition;
    if (isNamespace)
      this.#namespaceAlias = implicitAs(scope.name);

    // Own children are always available.
    // Root paths of the outer scope are also available in the inner scope.
    scope.availableRootPaths = Object.assign(Object.create(null), outerScope.availableRootPaths, scope.children);
    this.#scopes.push(scope);
  }

  popNameEnv() {
    const popped = this.#scopes.pop();
    const wasNamespace = this.#scopes.length === 1 && !popped.definition;
    if (wasNamespace)
      this.#namespaceAlias = null;
  }

  /**
   * To be able to refer to definitions outside the current scope, we need to have
   * unique USING statements.  The most stable way is to create a USING statement for
   * root path-segments on-demand and give it an alias by having it unique in the set
   * of all path segments of all definitions.
   *
   * While this will still lead to some long paths here and there, it is the most
   * secure way to avoid ambiguities due to shadowing names.
   *
   * @param {CSN.Model} csn
   */
  #prepareUniqueUsingsForRootPaths(csn) {
    // We include vocabularies here, too, because their names are affected by a global "namespace".
    const names = [
      ...Object.keys(csn.definitions || {}),
      ...Object.keys(csn.vocabularies || {}),
      ...(csn.extensions || []).map(ext => ext.extend || ext.annotate || ''),
    ];
    const segmentedNames = names.map(name => name.split('.'));
    this.nonRootSegments = new Set(segmentedNames.map(segments => segments.slice(1)).flat(1));
    // Don't use `this.#scopes[0].availableRootPaths`, as that will contain unreachable paths,
    // e.g. for a file that contains `namespace a.b`, `a` is not reachable.
    this.rootSegments = new Set(segmentedNames.map(name => name[0]));
    this.rootSegments.add('cds'); // builtin namespaces
    this.rootSegments.add('hana');
  }

  /**
   * @param {string} fqn Path for which we want to add an alias.
   */
  #addUsingAlias( fqn ) {
    const segments = fqn.split('.');
    let aliasName = segments.at(-1);
    // An explicit alias only needs to be used if the implicit one has the possibility of
    // being shadowed in any scope or if there is already an alias of that name.
    if (this.nonRootSegments.has(aliasName) || this.#aliasToFqn[aliasName]) {
      // There is a non-root segment of the same root name, hence the need for aliases.
      let counter = 0;
      aliasName += '_';
      const baseAlias = aliasName;
      while (this.nonRootSegments.has(aliasName) || this.rootSegments.has(aliasName) || this.#aliasToFqn[aliasName]) {
        // Alias must be unique among _all_ segments and existing USINGs.
        aliasName = `${ baseAlias }${ ++counter }`;
      }
    }

    // Always add an alias, even if unnecessary, as we'd otherwise try to create
    // it in #useAliasForPath() again if the same rootName is seen again.
    if (this.#aliasToFqn[aliasName])
      throw new CompilerAssertion(`to.cdl: Alias "${ aliasName }" already exists; collision for ${ fqn } and ${ this.#aliasToFqn[aliasName].path }`);
    const alias = new UsingAlias(fqn, aliasName);
    this.#aliasToFqn[aliasName] = alias;
    this.#fqnToAlias[fqn] = alias;
  }

  /**
   * We assume that definition names, when rendered, are always relative
   * to the current name environment.
   *
   * This function must only be used for statements that _create_ definitions
   * and not for references _to_ definitions.
   *
   * @param {string} fqn
   * @returns {string}
   */
  definitionName(fqn) {
    const leaf = this.#scopes.at(-1);
    if (!leaf?.name)
      return fqn;
    if (isBuiltinType(fqn)) {
      // For e.g. `annotate` statements:
      // - `annotate String;` is invalid
      // - `annotate cds.String;` works
      return fqn;
    }
    if (fqn.startsWith(`${ leaf.name }.`))
      return fqn.substring(leaf.name.length + 1); // '+1' => also remove '.'
    throw new CompilerAssertion('to.cdl: Definition to be rendered is not in current name scope!');
  }

  /**
   * Get a relative reference to the given definition name in the current name environment.
   *
   * This function must only be used for references _to_ definitions and not
   * for statements that _create_ definitions, i.e _introduce_ a new name.
   *
   * @param {string} fqn
   * @returns {string}
   */
  definitionReference(fqn) {
    if (isBuiltinType(fqn)) {
      const ref = this.builtinShorthandReference(fqn);
      if (ref !== null)
        return ref;
    }

    const name = rootPathSegment(fqn);
    // Go through all scopes except the root one, since in there, paths are always absolute.
    for (let i = this.#scopes.length - 1; i >= 1; i--) {
      const tree = this.#scopes[i];

      if (tree.name && fqn.startsWith(`${ tree.name }.`)) {
        // FQN is in current scope.
        const relativeName = fqn.substring(tree.name.length + 1);
        const relativeRoot = rootPathSegment(relativeName);

        // Since CDS requires root path segments to be _known within a CDL document_, we
        // need to check if the root path is _known_.  If not, we need a USING statement.
        // Example: `namespace ns; entity C : ns.D {};` -> must render alias, as 'D' would
        // be invalid! Required for parseCdl.
        if (!tree.children[relativeRoot])
          return this.#useAliasForPathInScope(fqn, tree);

        // Name can be used relative to scope 'tree'.  We now need to check if the relative
        // name does not collide with more inner scopes by checking for direct children.
        for (let j = this.#scopes.length - 1; j > i; j--) {
          if (this.#scopes[j].children[relativeRoot]) {
            // collision; requires alias
            return this.#useAliasForPathInScope(fqn, tree);
          }
        }

        return relativeName;
      }
      else if (name in tree.children) {
        // Name is in current scope, but it is not the artifact we're looking for.
        // Use a global alias to avoid confusing it.
        return this.#useAliasForPathInScope(fqn, null);
      }
    }

    // At this point, the path is unknown and outside any non-root scope.

    if (this.#namespaceAlias && (name !== 'cds' || this.#namespaceAlias === 'cds')) {
      // There is a namespace. We need a USING for all non-builtin paths, but also for
      // builtins if the namespace alias collides. Builtin collision, e.g.
      // `type my.cds.String : cds.String;` with common namespace "my.cds".
      return this.#useAliasForPathInScope(fqn, null);
    }
    if (name !== 'cds' && !this.#scopes[0].availableRootPaths?.[name]) {
      // In case the non-builtin path is unknown, add a using statement. Required for parseCdl.
      // Completely unknown: -> alias
      return this.#useAliasForPathInScope(fqn, null);
    }
    // Builtin or root path is known.
    return fqn;
  }

  /**
   * Adapt the FQN to use a global alias.  The alias is created for either
   * the scope in which the FQN resides or the root path segment.
   *
   * @param {string} fqn
   * @param {DefinitionPathTree} [scope]
   * @returns {string}
   */
  #useAliasForPathInScope( fqn, scope ) {
    const path = scope?.name ? scope.name : rootPathSegment(fqn);
    if (!this.#fqnToAlias[path]?.path)
      this.#addUsingAlias(path);

    if (this.#fqnToAlias[path].alias === path)
      return fqn; // shortcut to avoid substring()

    return this.#fqnToAlias[path].alias + fqn.substring(path.length);
  }

  /**
   * Returns a shorthand reference to the builtin type if possible or
   * null otherwise, in which case the caller must ensure that the full type
   * can be used.
   *
   * Example:
   *   cds.Integer -> Integer
   *   cds.hana.NCHAR -> hana.NCHAR
   *
   * @param {string} type
   * @returns {string|null}
   */
  builtinShorthandReference(type) {
    const shortHand = type.slice(4); // remove 'cds.'
    const root = rootPathSegment(shortHand);
    if (this.#scopes.at(-1).availableRootPaths[root])
      return null; // there is already an artifact of the same name
    if (this.#namespaceAlias === root)
      return null; // alias collides with shorthand
    return shortHand;
  }

  /**
   * Get a list of objects meant to be rendered as USING statements.
   *
   * @returns {UsingAlias[]}
   */
  getUsings() {
    const result = [];
    for (const alias in this.#aliasToFqn)
      result.push(this.#aliasToFqn[alias]);
    return result;
  }
}

/**
 * @see createDefinitionPathTree()
 */
class DefinitionPathTree {
  name = null;
  /** @type {Record<string, DefinitionPathTree>} */
  children = Object.create(null);
  definition = null;
  /** @type {Record<string, DefinitionPathTree>} */
  availableRootPaths = null; // used in NameScopeStack

  /**
   * @param {string} fqn
   */
  constructor(fqn) {
    this.name = fqn;
  }
}

/**
 * For a CSN model, constructs a tree of all path segments of all definitions, e.g.
 * definitions `a.b.c.d` and `a.b.e.f` will end up in:
 * ```
 * a
 * └─ b
 *    ├─ c
 *    │  └─ d (link to definition)
 *    └─ e
 *       └─ f (link to definition)
 * ```
 *
 * @param {CSN.Model} csn
 * @param {CdlOptions} options
 * @returns {DefinitionPathTree}
 */
function createDefinitionPathTree( csn, options ) {
  const tree = new DefinitionPathTree('');
  if (!csn.definitions)
    return tree;

  const useNesting = options.renderCdlDefinitionNesting !== false;

  for (const defName in csn.definitions) {
    const segments = defName.split('.');
    if (!useNesting) {
      // If we don't want nesting, don't do more work than necessary:
      // only the first path step is relevant
      segments.length = 1;
    }
    let leaf = tree;
    for (let i = 0; i < segments.length; i++) {
      const level = segments[i];
      const fqn = segments.slice(0, i + 1).join('.');
      leaf.children[level] ??= new DefinitionPathTree(fqn);
      leaf = leaf.children[level];
    }
    leaf.definition = csn.definitions[defName];
  }
  return tree;
}


class CsnToCdl {
  /**
   * @param {CSN.Model} csn
   * @param {CdlOptions} options
   * @param {object} msg
   */
  constructor(csn, options, msg) {
    this.csn = csn;
    this.options = options;
    this.msg = msg;

    if (this.options.csnFlavor === 'universal' && isBetaEnabled(this.options, 'enableUniversalCsn')) {
      // Since the expander modifies the CSN, we need to clone it first or
      // toCdl can't guarantee that the input CSN is not modified.
      this.csn = cloneFullCsn(this.csn, this.options);
      enrichUniversalCsn(this.csn, this.options);
    }

    checkCSNVersion(this.csn, this.options);

    this.exprRenderer = this.createCdlExpressionRenderer();
    this.subelementAnnotates = [];
  }

  render() {
    const cdlResult = Object.create(null);
    cdlResult.model = '';

    const env = createEnv();

    const useNesting = this.options.renderCdlDefinitionNesting !== false;
    this.definitionTree = createDefinitionPathTree(this.csn, this.options);
    this.commonNamespace = this.getCommonNamespace();

    env.nameEnvStack.setRootScope(this.definitionTree, this.csn);

    const useNamespace = this.commonNamespace !== this.definitionTree;
    if (useNamespace)
      env.nameEnvStack.pushNameEnv(this.commonNamespace);

    cdlResult.model += useNesting
      ? this.renderNestedDefinitions(env)
      : this.renderDefinitions(env);
    // sub-element annotations that can't be written directly.
    cdlResult.model += this.renderExtensions(this.subelementAnnotates, env);

    if (this.csn.vocabularies)
      cdlResult.model += this.renderVocabularies(this.csn.vocabularies, env);
    if (this.csn.extensions)
      cdlResult.model += this.renderExtensions(this.csn.extensions, env);

    if (useNamespace)
      env.nameEnvStack.popNameEnv();

    cdlResult.model = this.renderUsingAliases(env.nameEnvStack.getUsings(), env) + cdlResult.model;
    if (this.csn.requires) {
      let usingsStr = this.csn.requires.map(req => `using from '${ req }';`).join('\n');
      usingsStr += '\n\n';
      cdlResult.model = usingsStr + cdlResult.model;
    }

    if (this.commonNamespace.name)
      cdlResult.model = `namespace ${ this.renderArtifactName(this.commonNamespace.name, env) };\n\n${ cdlResult.model }`;

    this.msg.throwWithError();
    return cdlResult;
  }

  /**
   * Determine a common namespace along all definitions.
   * Returns this.definitionTree if there is no common namespace.
   *
   * @returns {DefinitionPathTree}
   */
  getCommonNamespace() {
    let root = this.definitionTree;
    if (this.options.renderCdlDefinitionNesting === false || this.options.renderCdlCommonNamespace === false)
      return root; // User does not want common namespace.

    if (this.csn.vocabularies) {
      // TODO: With vocabularies, we don't search for a common namespace.
      //   Reason being that `namespace` statements affect vocabularies, but
      //   we don't create definition trees for them.
      return root;
    }
    if (this.csn.extensions?.length > 0) {
      // TODO: Check for the case of `entity Unknown.E {}; annotate Unknown;`
      //   by going through all extensions.
      return root;
    }

    while (root) {
      const keys = Object.keys(root.children);
      if (keys.length !== 1 || root.children[keys[0]].definition) {
        // There is either more than one sibling path, or the path is a definition.
        // We MUST NOT create a common namespace for `entity A {}; entity A.A {}`!
        break;
      }
      if (keys[0] === 'cds') {
        // Don't use 'cds' as common namespace _anywhere_, not even in `namespace foo.cds.bar;`
        // While our code _does_ handle such cases, as it also needs to do so for `String`, etc.,
        // it would make reading to.cdl() output worse.
        return this.definitionTree;
      }
      root = root.children[keys[0]];
    }

    return root;
  }

  /**
   * @param {UsingAlias[]} aliases
   * @param {CdlRenderEnvironment} env
   * @returns {string}
   */
  renderUsingAliases(aliases, env) {
    if (this.options.renderCdlDefinitionNesting !== false) {
      // openAPI importer searches for a single USING statement and replaces it.
      // Let's try to be backward compatible.
      return aliases.length > 0 ? `using { ${ aliases.map(entry => (entry.requiresExplicitAlias()
        ? `${ this.quotePathIfRequired(entry.path, env) } as ${ this.quoteNonIdentifierOrKeyword(entry.alias, env) }`
        : entry.path)).join(', ') } };\n\n` : '';
    }

    let result = '';
    for (const entry of aliases) {
      if (entry.requiresExplicitAlias())
        result += `using { ${ this.quotePathIfRequired(entry.path, env) } as ${ this.quoteNonIdentifierOrKeyword(entry.alias, env) } };\n`;
      else
        result += `using { ${ entry.path } };\n`;
    }
    return result !== '' ? `${ result }\n` : result;
  }

  /**
   * Render definitions in a flat list, i.e. without nesting.
   *
   * @param {CdlRenderEnvironment} env
   * @returns {string}
   */
  renderDefinitions(env) {
    let result = '';
    forEachDefinition(this.csn, (artifact, artifactName) => {
      const sourceStr = this.renderDefinition(artifactName, artifact, env);
      if (sourceStr !== '')
        result += `${ sourceStr }\n`;
    });
    return result;
  }

  /**
   * Render entries from the `csn.definitions` dictionary.
   * Returns an empty string if nothing is rendered.
   *
   * @return {string}
   */
  renderNestedDefinitions(env) {
    const that = this;
    let result = '';
    renderTree(this.definitionTree);
    return result;

    /**
     * @param {DefinitionPathTree} tree
     */
    function renderTree( tree ) {
      for (const name in tree.children) {
        const entry = tree.children[name];
        const def = entry.definition;

        if (def?.kind === 'service' || def?.kind === 'context') {
          // Render service/context with nested definitions.
          env.path = [ 'definitions', entry.name ];
          result += that.renderAnnotationAssignmentsAndDocComment(def, env);
          result += `${ env.indent }${ def.kind } ${ that.renderArtifactName(entry.name, env) } {\n`;
          env.increaseIndent();
          env.nameEnvStack.pushNameEnv(entry);
          if (entry.children)
            renderTree(entry);
          env.nameEnvStack.popNameEnv();
          env.decreaseIndent();
          if (result.at(-1) === '\n' && result.at(-2) === '\n')
            result = result.substring(0, result.length - 1); // to get the closing brace on the next line after a definition, remove one linebreak
          result += `${ env.indent }};\n\n`;
        }
        else if (def) {
          const sourceStr = that.renderDefinition(entry.name, def, env);
          if (sourceStr !== '')
            result += `${ sourceStr }\n`;
          if (entry.children)
            renderTree(entry);
        }
        else if (entry.children) {
          renderTree(entry);
        }
      }
    }
  }

  /**
   * Render annotation definitions, i.e. entries from csn.vocabularies.
   * Returns an empty string if there isn't anything to render.
   *
   * @param {object} vocabularies
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderVocabularies( vocabularies, env ) {
    let result = '';
    for (const key in vocabularies)
      result += this.renderVocabulariesEntry(key, vocabularies[key], env);
    return result;
  }

  /**
   * @param {string} name
   * @param anno
   * @param {CdlRenderEnvironment} env
   * @returns {string}
   */
  renderVocabulariesEntry( name, anno, env ) {
    if (anno.$ignore)
      return '';
    // This environment is passed down the call hierarchy, for dealing with
    // indentation and name resolution issues
    env.path = [ 'vocabularies', name ];
    const sourceStr = this.renderArtifact(name, anno, env, 'annotation');
    return `${ sourceStr }\n`;
  }

  /**
   * Render 'extend' and 'annotate' statements from the `extensions` array.
   * Could be annotate-statements for sub-elements annotations or from parseCdl's
   * extensions array or just unapplied extensions.
   *
   * @param {CSN.Extension[]} extensions
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderExtensions( extensions, env ) {
    if (!env.path)
      env = env.cloneWith({ path: [ 'extensions' ] });
    return extensions.map((ext, index) => this.renderExtension(ext, env.withSubPath([ index ]))).join('\n');
  }

  /**
   * Render an 'extend' and 'annotate' statement.
   *
   * @param {CSN.Extension} ext
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderExtension( ext, env ) {
    if (ext.extend)
      return this.renderExtendStatement(ext.extend, ext, env);
    return this.renderAnnotateStatement(ext, env);
  }

  /**
   * Render an 'extend' statement.
   * `extName` is the extension's artifact's name, most likely `ext.extend`.
   * This function is recursive, which is why you need to pass it explicitly.
   *
   * @param {string} extName
   * @param {object} ext
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderExtendStatement( extName, ext, env ) {
    // Element extensions have `kind` set. Don't use for enum extension.
    const isElementExtend = (ext.kind === 'extend' && !ext.enum);
    let result = this.renderAnnotationAssignmentsAndDocComment(ext, env);
    extName = this.renderArtifactName(extName, env);

    if (ext.includes && ext.includes.length > 0) {
      // Includes can't be combined with anything in braces {}.
      const affix = isElementExtend ? 'element ' : '';
      const includes = ext.includes.map((inc, i) => this.renderDefinitionReference(inc, env.withSubPath([ 'includes', i ]))).join(', ');
      result += `${ env.indent }extend ${ affix }${ extName } with ${ includes };\n`;
      return result;
    }

    const typeParams = this.renderTypeParameters(ext, true);
    if (typeParams) {
      result += `${ env.indent }extend ${ extName } with ${ typeParams };\n`;
      return result;
    }

    // If there is nothing to extend, e.g. only annotations, don't render an
    // empty element list.  This would end up in diffs with parseCdl CSN.
    if (!ext.elements && !ext.columns && !ext.actions && !ext.enum) {
      result += `${ env.indent }extend ${ extName };\n`;
      return result;
    }

    // We have the "old-style" prefix syntax and the "new-style" postfix "with <type>" syntax.
    // The former one can not only extend (sub-)elements but also actions in the same statement whereas
    // the latter cannot.
    // If there are actions, check if there are also elements/columns, and if so, use the prefix notation.
    const usePrefixNotation = ext.actions && (ext.columns || ext.elements);
    if (usePrefixNotation)
      result += `${ env.indent }extend ${ this.getExtendPrefixVariant(ext) } ${ extName } with {\n`;
    else
      result += `${ env.indent }extend ${ extName } with ${ this.getExtendPostfixVariant(ext) }{\n`;

    if (ext.columns)
      result += this.renderViewColumns(ext, env.withIncreasedIndent());

    else if (ext.elements || ext.enum)
      result += this.renderExtendStatementElements(ext, env);

    // Not part of if/else cascade, because it may be in postfix notation.
    if (ext.actions) {
      const childEnv = env.withIncreasedIndent();
      let actions = '';
      forEach(ext.actions, (actionName, action) => {
        actions += this.renderActionOrFunction(actionName, action, childEnv.withSubPath([ 'actions', actionName ]), true);
      });
      if (!usePrefixNotation)
        result += actions;
      else if (actions !== '')
        result += `${ env.indent }} actions {\n${ actions }`;
    }

    result += `${ env.indent }};\n`;
    return result;
  }

  /**
   * What <extend> prefix type to use.  Used to render `extend <type> <ref>` statements.
   *
   * @param {object} ext
   * @return {string}
   */
  getExtendPrefixVariant( ext ) {
    if (ext.kind === 'extend')
      return 'element'; // element extensions inside an `extend`
    if (ext.columns)
      return 'projection';
    if (ext.elements)
      return 'entity';
    return '';
  }

  /**
   * What <extend> postfix type to use.  Used to render `extend <ref> with <type>` statements.
   *
   * @param {CSN.Extension} ext
   * @return {string}
   */
  getExtendPostfixVariant( ext ) {
    if (ext.columns)
      return 'columns ';
    if (ext.actions)
      return 'actions ';
    if (ext.enum)
      return 'enum ';
    if (ext.elements) { // enum/elements ambiguity -> look into elements
      const isLikelyElement = Object.keys(ext.elements)
        .find(name => ext.elements[name].value !== undefined);
      if (isLikelyElement)
        return 'elements ';
    }
    // ambiguity; no postfix, i.e. `extend … with { … }`.s
    return '';
  }

  /**
   * Render the elements inside an `extend` statement. They may themselves be `extend` statements.
   *
   * @param {CSN.Extension} ext
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderExtendStatementElements( ext, env ) {
    let result = '';
    const prop = ext.elements ? 'elements' : 'enum';
    forEach(ext[prop] || {}, (elemName, element) => {
      const childEnv = env.withIncreasedIndent().withSubPath([ 'elements', elemName ]);
      if (element.kind === 'extend')
        result += this.renderExtendStatement(elemName, element, childEnv);
      else
        // As soon as we are inside an element, nested `extend` are not possible,
        // since we can't extend an existing element of a new one.
        result += this.renderElement(elemName, element, childEnv.withSubPath([ prop, elemName ]));
    });
    return result;
  }

  /**
   * Render an 'annotate' statement.
   *
   * @param {CSN.Extension} ext
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderAnnotateStatement( ext, env ) {
    // Special case: Super annotate has both "returns" and "elements".
    // Render as separate `annotate`s, but keep the order.
    if (ext.elements && ext.returns) {
      const [ , second ] = Object.keys(ext).filter(key => key === 'elements' || key === 'returns');

      // The first of 'elements' or 'returns' gets all other properties as well.
      // The second only gets one property (itself).
      let result = this.renderAnnotateStatement({ ...ext, [second]: undefined }, env);
      result += this.renderAnnotateStatement({ annotate: ext.annotate, [second]: ext[second] }, env);

      return result;
    }

    // Top-level annotations of the artifact
    let result = this.renderAnnotationAssignmentsAndDocComment(ext, env);
    // Note: Not renderDefinitionReference, because we don't care if there
    //       are annotations to unknown things. That's allowed!
    result += `${ env.indent }annotate ${ this.renderArtifactName(ext.annotate, env) }`;

    if (ext.params)
      result += this.renderAnnotateParamsInParentheses(ext, env);

    // Element extensions and annotations (possibly nested)
    if (ext.elements || ext.enum)
      result += ` ${ this.renderAnnotateStatementElements(ext, env) }`;

    else if (ext.returns)
      result += this.renderAnnotateReturns(ext, env);


    if (ext.actions) { // Bound action annotations
      result += ' actions {\n';
      env.increaseIndent();
      env.path.push('actions', '');
      for (const name in ext.actions) {
        env.path[env.path.length - 1] = name;
        const action = ext.actions[name];
        result += this.renderAnnotationAssignmentsAndDocComment(action, env) + env.indent + this.quoteNonIdentifierOrKeyword(name, env);
        // Action parameter annotations
        if (action.params)
          result += this.renderAnnotateParamsInParentheses(action, env);
        if (action.returns)
          result += this.renderAnnotateReturns(action, env);

        result = removeTrailingNewline(result);
        result += ';\n';
      }
      env.decreaseIndent();
      result += `${ env.indent }}`;
    }

    result = removeTrailingNewline(result);
    result += ';\n';
    return result;
  }

  /**
   * Render the elements-specific part of an 'annotate' statement for an element dictionary
   * 'ext.elements' (assuming that the surrounding parent has just been rendered, without trailing newline).
   * Returns the resulting source string, ending without a trailing newline.
   *
   * @param {object} ext
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderAnnotateStatementElements( ext, env ) {
    const elements = ext.enum ? ext.enum : ext.elements;
    let result = '{\n';
    env.increaseIndent();
    env.path.push(ext.enum ? 'enum' : 'elements', '');
    for (const name in elements) {
      env.path[env.path.length - 1] = name;
      const elem = elements[name];
      result += this.renderAnnotationAssignmentsAndDocComment(elem, env);
      result += env.indent + this.quoteNonIdentifierOrKeyword(name, env);
      if (elem.elements) {
        env.path.push('elements');
        result += ` ${ this.renderAnnotateStatementElements(elem, env) }`;
        env.path.pop();
      }
      else if (elem.enum) {
        env.path.push('enum');
        result += ` ${ this.renderAnnotateStatementElements(elem, env) }`;
        env.path.pop();
      }

      result += ';\n';
    }
    env.path.length -= 2;
    env.decreaseIndent();
    result += `${ env.indent }}`;
    return result;
  }

  /**
   * Renders the `returns` part of an `annotate` statement for (bound) actions.
   * `ext` must be an object with a `returns` property.
   *
   * @param {CSN.Extension} ext
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderAnnotateReturns( ext, env ) {
    env = env.withSubPath([ 'returns', 'elements' ]);
    let result = ' returns';

    const returnAnnos = this.renderAnnotationAssignmentsAndDocComment(ext.returns, env.withIncreasedIndent());
    if (returnAnnos)
      result += `\n${ returnAnnos }`;

    if (ext.returns.elements) {
      // Annotations are on separate lines: Have it aligned nicely
      result += returnAnnos ? `${ env.indent }` : ' ';
      result += this.renderAnnotateStatementElements(ext.returns, env);
    }
    return result;
  }

  /**
   * Render a parameter list for `annotate` statements, in parentheses `()`.
   *
   * @param {CSN.Artifact} ext
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderAnnotateParamsInParentheses( ext, env ) {
    const childEnv = env.withIncreasedIndent();
    let result = '(\n';
    const paramAnnotations = [];
    forEach(ext.params, (paramName, param) => {
      const annos = this.renderAnnotationAssignmentsAndDocComment(param, childEnv);
      const name = this.quoteNonIdentifierOrKeyword(paramName, childEnv);
      // Not supported, yet (#13052)
      // const sub = (param.elements || param.enum) ? ` ${renderAnnotateStatementElements(param, childEnv)}` : '';
      paramAnnotations.push( annos + childEnv.indent + name);
    });
    result += `${ paramAnnotations.join(',\n') }\n${ env.indent })`;
    return result;
  }

  /**
   * Render an artifact. Return the resulting source string.
   *
   * @param {string} artifactName
   * @param {CSN.Artifact} art
   * @param {CdlRenderEnvironment} env
   */
  renderDefinition( artifactName, art, env ) {
    env = env.cloneWith({ path: [ 'definitions', artifactName ] });

    const kind = art.kind || 'type'; // the default kind is "type".
    switch (kind) {
      case 'entity':
        if (art.query || art.projection)
          return this.renderView(artifactName, art, env);
        return this.renderArtifact(artifactName, art, env);
      case 'aspect':
        return this.renderAspect(artifactName, art, env);

      case 'context':
      case 'service':
        return this.renderContextOrService(artifactName, art, env);

      case 'annotation': // annotation in 'csn.definitions' for compiler v1 compatibility
        return this.renderArtifact(artifactName, art, env, 'annotation');

      case 'action':
      case 'function':
        return this.renderActionOrFunction(artifactName, art, env, false);

      case 'type':
      case 'event':
        return this.renderArtifact(artifactName, art, env);

      default:
        throw new ModelError(`to.cdl: Unknown artifact kind: '${ art.kind }' at ${ JSON.stringify(env.path) }`);
    }
  }

  /**
   * @param {string} artifactName
   * @param {CSN.Artifact} art
   * @param {CdlRenderEnvironment} env
   * @param {string} [overrideKind] If set, override the artifact kind.
   */
  renderArtifact( artifactName, art, env, overrideKind ) {
    let result = this.renderAnnotationAssignmentsAndDocComment(art, env);
    let kind = overrideKind || art.$syntax === 'aspect' && 'aspect' || art.kind;
    if (art.abstract)
      kind = `abstract ${ kind }`;
    // Vocabularies are in a separate name environment. We can't shorten them.
    const normalizedArtifactName = kind !== 'annotation'
      ? this.renderArtifactName(artifactName, env)
      : this.quotePathIfRequired(artifactName, env);
    result += `${ env.indent }${ kind } ${ normalizedArtifactName }`;

    if (art.params)
      result += this.renderParameters(art, env);

    let isDirectStruct = false;
    const isQuery = art.query || art.projection;
    if (isQuery) {
      result += ' : ';
      // types/events (should) only support "projections"
      result += this.renderQuery(getNormalizedQuery(art).query, true, 'projection',
                                 env.withSubPath([ art.projection ? 'projection' : 'query' ]));
    }
    else {
      const type = this.renderTypeReferenceAndProps(art, env);
      if (type) {
        isDirectStruct = type.startsWith('{');

        if (art.includes?.length && isDirectStruct) {
          // We can only render includes, if the type is directly structured. Otherwise, we would
          // render e.g. `type T : Include : T2;`, which is invalid.  We use `extend` in such cases.
          result += this.renderIncludes(art.includes, env);
        }

        // For nicer output, no colon if unnamed structure is used.
        result += (!art.type && art.elements) ? ` ${ type }` : ` : ${ type }`;
      }
      else {
        this.msg.warning('syntax-missing-type', env.path, { '#': art.kind, name: artifactName }, {
          std: 'Missing type for definition $(NAME); can\'t be represented in CDL',
          entity: 'Missing elements for entity $(NAME); can\'t be represented in CDL',
        });
      }
    }

    if (art.actions) {
      if (!isQuery && !isDirectStruct) {
        // If there are no elements nor query, but actions, CDL syntax requires braces.
        result += ' { }';
      }
      result += this.renderBoundActionsAndFunctions(art, env);
    }

    result += ';\n';

    if (art.includes?.length && !isDirectStruct) {
      // If we're not a directly structured type, render the `includes` as `extend`
      // statements directly below the type definition.
      result += this.renderExtendStatement(artifactName, { includes: art.includes }, env);
    }

    return result;
  }

  /**
   * @param {string} artifactName
   * @param {CSN.Artifact} art
   * @param {CdlRenderEnvironment} env
   * @returns {string}
   */
  renderContextOrService( artifactName, art, env ) {
    let result = this.renderAnnotationAssignmentsAndDocComment(art, env);
    result += `${ env.indent }${ art.kind } ${ this.renderArtifactName(artifactName, env) }`;
    return `${ result } {};\n`;
  }

  /**
   * Render an aspect. Return the resulting source string.
   * Behaves very similar to renderEntity, _except_ that aspects are
   * allowed to _not_ have elements, e.g. `aspect A;`.
   *
   * @param {string} artifactName
   * @param {CSN.Artifact} art
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderAspect( artifactName, art, env ) {
    let result = this.renderAnnotationAssignmentsAndDocComment(art, env);
    result += `${ env.indent }aspect ${ this.renderArtifactName(artifactName, env) }`;
    if (art.includes)
      result += this.renderIncludes(art.includes, env);

    if (art.elements)
      result += ` ${ this.renderElements(art, env) }`;
    else if (art.actions)
      // if there are no elements, but actions, CDL syntax requires braces.
      result += ' { }';

    result += `${ this.renderBoundActionsAndFunctions(art, env) };\n`;
    return result;
  }

  /**
   * Render a list of elements enclosed in braces.  If the list is empty, returns `{ }`.
   *
   * @param {object} artifact Artifact with `elements` property.
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderElements( artifact, env ) {
    let elements = '';
    const childEnv = env.withIncreasedIndent();
    for (const name in artifact.elements)
      elements += this.renderElement(name, artifact.elements[name], childEnv.withSubPath([ 'elements', name ]));

    return (elements === '') ? '{ }' : `{\n${ elements }${ env.indent }}`;
  }

  /**
   * Render an element (of an entity, type or annotation, not a projection or view)
   * or an enum symbol.
   * Returns the resulting source string.
   *
   * @param {string} elementName
   * @param {CSN.Element} element
   * @param {CdlRenderEnvironment} env
   */
  renderElement( elementName, element, env ) {
    const isCalcElement = (element.value !== undefined);
    let result = this.renderAnnotationAssignmentsAndDocComment(element, env);
    result += env.indent;
    result += element.virtual ? 'virtual ' : '';
    result += element.key ? 'key ' : '';
    result += element.masked ? 'masked ' : '';
    result += this.quoteNonIdentifierOrKeyword(elementName, env);
    if (element['#'] !== undefined) { // enum symbol reference
      result += ` = #${ element['#'] }`;
    }
    else if (element.val !== undefined) { // enum value
      result += ` = ${ this.exprRenderer.renderExpr(element, env) }`;
    }
    else if (!isCalcElement || !isDirectAssocOrComp(element.type) && !element.$filtered && !element.$enclosed) {
      // If the element is a calculated element _and_ a direct association or
      // composition, we'd render `Association to F on (cond) = calcValue;` which
      // would alter the ON-condition.
      // If it is a calculated element _and_ an indirect association (via type chain),
      // we'd get a cast to an association.
      const props = this.renderTypeReferenceAndProps(element, env);
      if (props !== '')
        result += ` : ${ props }`;
    }

    if (isCalcElement) { // calculated element // @ts-ignore
      result += ' = ';
      env.path.push('value');
      const isSubExpr = (element.value.xpr && xprContainsCondition(element.value.xpr));
      result += isSubExpr
        ? this.exprRenderer.renderSubExpr(element.value, env)
        : this.exprRenderer.renderExpr(element.value, env);
      if (element.value.stored === true)
        result += ' stored';
      env.path.length -= 1;
    }

    return `${ result };\n`;
  }

  /**
   * Render annotations that were extended to a query element of a view or projection (they only
   * appear in the view's 'elements', not in their 'columns' for client CSN, because the element
   * itself may not even be in 'columns', e.g. if it was expanded from a '*').  Return the
   * resulting rendered 'annotate' statement or an empty string if none required.
   *
   * Note: In the past, we checked if the annotation also exists in the respective column,
   *       however, in client CSN, annotations are not part of the column and in parseCdl CSN,
   *       no `elements` exist.
   *
   * @param {CSN.Artifact} art
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderQueryElementAndEnumAnnotations( art, env ) {
    const annotate = this.collectAnnotationsOfElementsAndEnum(art, env);
    if (annotate)
      return this.renderExtensions([ annotate ], env);
    return '';
  }

  /**
   * Create an "annotate" statement as a CSN extension for all annotations of (sub-)elements.
   * If no annotation was found, we return `null`.
   *
   * @param {CSN.Artifact} artifact
   * @param {CdlRenderEnvironment} env
   * @return {CSN.Extension|null}
   */
  collectAnnotationsOfElementsAndEnum( artifact, env ) {
    // Array, which may be annotated as well.
    if (artifact.items) {
      env = env.withSubPath([ 'items' ]);
      artifact = artifact.items;
    }

    if (!artifact.elements && !artifact.enum && !artifact.keys)
      return null;

    const annotate = { annotate: env.path[1] };

    // Based on the current path, create a correctly nested structure
    // of elements for which we collect annotations.
    let obj = annotate;
    for (let i = 2; i < env.path.length; ++i) {
      const key = env.path[i];
      if (key === 'elements' || key === 'actions' || key === 'params') {
        obj[key] = Object.create(null);
        const elem = env.path[i + 1];
        obj[key][elem] = {};
        obj = obj[key][elem];
      }
      else if (key === 'returns') {
        obj.returns = {};
        obj = obj.returns;
      }
      else {
        // ignore others, e.g. 'items'
      }
    }
    return collectAnnos(obj, artifact) ? annotate : null;

    /**
     * Recursive function to collect annotations. `annotateObj` will get an `elements`
     * object with annotations only if there are annotations on `art`'s (sub-)elements or
     * enums.  Returned object will use "elements" even for enums, since that is
     * expected in extensions.
     *
     * @return {boolean} True, if there were annotations, false otherwise.
     */
    function collectAnnos( annotateObj, art ) {
      if (!Object.hasOwnProperty.call(art, 'elements') &&
        !Object.hasOwnProperty.call(art, 'enum') &&
        !Object.hasOwnProperty.call(art, 'keys'))
        return false;

      const dict = art.enum || art.keys && getKeysDict(art) || art.elements;
      // Use "elements" for all. This is allowed in extensions.
      const collected = { elements: Object.create(null) };
      let hasAnnotation = false;

      forEach(dict, (elemName, element) => {
        if (!collected.elements[elemName])
          collected.elements[elemName] = { };

        let hasElementAnnotations = false;
        for (const name in element) {
          if (name.startsWith('@')) {
            collected.elements[elemName][name] = element[name];
            hasElementAnnotations = true;
            hasAnnotation = true;
          }
        }

        const hasSubAnnotations = collectAnnos(collected.elements[elemName], element);
        if (!hasElementAnnotations && !hasSubAnnotations)
          delete collected.elements[elemName]; // delete if no annotations exist
        hasAnnotation = hasAnnotation || hasSubAnnotations;
      });

      if (hasAnnotation)
        annotateObj.elements = collected.elements;

      return hasAnnotation;
    }
  }

  /**
   * Render the source of a query, which may be a path reference, possibly with an alias,
   * or a subselect, or a join operation, as seen from artifact 'art'.
   * Returns the source as a string.
   *
   * @param {object} source
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderViewSource( source, env ) {
    // Sub-SELECT
    if (source.SELECT || source.SET) {
      const subEnv = env.withIncreasedIndent();
      let result = `(\n${ subEnv.indent }${ this.renderQuery(source, false, 'view', subEnv) }\n${ env.indent })`;
      if (source.as)
        result += this.renderAlias(source.as, env);

      return result;
    }
    // JOIN
    else if (source.join) {
      // One join operation, possibly with ON-condition
      env.path.push('args', 0);
      let result = `(${ this.renderViewSource(source.args[0], env) }`;
      for (let i = 1; i < source.args.length; i++) {
        env.path[env.path.length - 1] = i;
        result += ` ${ source.join } `;
        result += this.renderJoinCardinality(source.cardinality);
        result += `join ${ this.renderViewSource(source.args[i], env) }`;
      }
      env.path.length -= 2;
      if (source.on) {
        env.path.push('on');
        result += ` on ${ this.exprRenderer.renderExpr(source.on, env.withSubPath([ 'on' ])) }`;
        env.path.length -= 1;
      }
      result += ')';
      return result;
    }
    // Ordinary path, possibly with an alias

    return this.renderAbsolutePathWithAlias(source, env);
  }

  renderJoinCardinality( card ) {
    let result = '';
    if (card) {
      if (card.srcmin && card.srcmin === 1)
        result += 'exact ';
      result += card.src && card.src === 1 ? 'one ' : 'many ';
      result += 'to ';
      if (card.min && card.min === 1)
        result += 'exact ';
      if (card.max)
        result += (card.max === 1) ? 'one ' : 'many ';
    }
    return result;
  }

  /**
   * Render a path that starts with an absolute name (as used e.g. for the source of a query),
   * with plain or quoted names, depending on options. Expects an object 'path' that has a 'ref'.
   * Returns the name as a string.
   *
   * @param {object} path
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderAbsolutePath( path, env ) {
    // Sanity checks
    if (!path.ref)
      throw new ModelError(`Expecting ref in path: ${ JSON.stringify(path) }`);

    // Determine the absolute name of the first artifact on the path (before any associations or element traversals)
    const firstArtifactName = path.ref[0].id || path.ref[0];

    // Render the first path step (absolute name, with different quoting/naming ..)
    let result = this.renderDefinitionReference(firstArtifactName, env);

    // Even the first step might have parameters and/or a filter
    env.path.push('ref', 0);
    if (path.ref[0].args)
      result += `(${ this.renderArguments(path.ref[0], ':', env) })`;
    if (path.ref[0].where)
      result += this.renderFilterAndCardinality(path.ref[0], env);
    env.path.length -= 2;

    // Add any path steps (possibly with parameters and filters) that may follow after that
    if (path.ref.length > 1)
      result += `:${ this.exprRenderer.renderExpr({ ref: path.ref.slice(1) }, env) }`;

    return result;
  }

  /**
   * Render a path that starts with an absolute name (as used for the source of a query),
   * possibly with an alias, with plain or quoted names, depending on options. Expects an object 'path' that has a
   * 'ref' and (in case of an alias) an 'as'. If necessary, an artificial alias
   * is created to the original implicit name.
   * Returns the name and alias as a string.
   *
   * @param {object} path
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderAbsolutePathWithAlias( path, env ) {
    // We may have changed the implicit alias due to renderAbsolutePath() and renderDefinitionReference()
    // introducing USING statements. We need to ensure that the implicit alias stays the same.
    const isElementRef = path.ref.length > 1;
    const alias = path.as || implicitAs(path.ref);

    let result = this.renderAbsolutePath(path, env);
    if (path.as) {
      // Source had an alias - render it
      result += this.renderAlias(path.as, env);
    }
    else if (!isElementRef) {
      const defName = path.ref[0].id || path.ref[0];
      const sourcePath = env.nameEnvStack.definitionReference(defName);
      // Source did not have an alias, but we add one as we'd
      // otherwise have a different implicit alias.
      if (sourcePath.split('.').at(-1) !== alias)
        result += this.renderAlias(alias, env);
    }
    return result;
  }

  /**
   * Render the given columns.
   *
   * @param {CSN.Extension | CSN.QuerySelect} art
   * @param {object} elements
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderViewColumns( art, env, elements = Object.create(null) ) {
    env.path.push( 'columns', -1 );
    const result = art.columns.map((col, i) => {
      env.path[env.path.length - 1] = i;
      return this.renderViewColumn(col, env, findElement(elements, col));
    }).join(',\n');
    env.path.length -= 2;
    return `${ result }\n`;
  }

  /**
   * Render a single view or projection column 'col', as it occurs in a select list or
   * projection list within 'art', possibly with annotations.
   * Return the resulting source string (no trailing LF).
   *
   * @param {object} col
   * @param {CdlRenderEnvironment} env
   * @param {CSN.Element} element Element corresponding to the column. Generated by the compiler.
   */
  renderViewColumn( col, env, element ) {
    // Annotations and column
    let result = '';
    if (!col.doc) {
      // TODO: In contrast to annotations, we do not render the doc comment as part
      //       of an `annotate` statement.  That may change in the future.
      result += this.renderDocComment(element, env);
    }
    result += this.renderAnnotationAssignmentsAndDocComment(col, env);
    result += env.indent;

    // only if column is virtual, keyword virtual was present in the source text
    result += col.virtual ? 'virtual ' : '';
    result += col.key ? 'key ' : '';

    let exprResult;
    // Use special rendering for .expand/.inline - renderExpr cannot easily handle some cases
    if (col.expand || col.inline)
      exprResult = this.renderInlineExpand(col, env);
    else if (col.xpr && xprContainsCondition(col.xpr))
      exprResult = this.exprRenderer.renderSubExpr(withoutCast(col), env);
    else
      exprResult = this.exprRenderer.renderExpr(withoutCast(col), env);

    result += exprResult;

    // A new association (cast with `type` and `target`) uses `as` as its primary name, not alias.
    // The same for `virtual <name>`, which is a new element definition instead of a reference.
    const isNewElementDefinition = exprResult === '';
    if (isNewElementDefinition && col.as) {
      result += this.quoteNonIdentifierOrKeyword(col.as, env);
    }
    else if (col.as && !col.inline && !col.expand) {
      // Alias for inline/expand is already handled by renderInlineExpand
      result += this.renderAlias(col.as, env);
    }


    // Explicit type provided for the view element?
    if (col.cast) {
      env.path.push('cast');
      // Special case: Explicit association type is actually a redirect
      if (col.cast.target && !col.cast.type)
        result += ` : ${ this.renderRedirectedTo(col.cast, env) }`;
      else
        result += ` : ${ this.renderTypeReferenceAndProps(col.cast, env, { typeRefOnly: true, noAnnoCollect: true }) }`;
      env.path.length -= 1;
    }
    return result;
  }

  /**
   * For the current column, render a (nested) inline/expand. If the current column
   * does not have an .expand/.inline, '' is returned
   *
   * @param {object} obj Thing with .expand or .inline
   * @param {CdlRenderEnvironment} env
   * @returns {string}
   */
  renderInlineExpand( obj, env ) {
    // No expression to render for { * } as alias
    let result = (obj.as && obj.expand && !obj.ref) ? '' : this.exprRenderer.renderExpr(withoutCast(obj), env);

    const isAnonymousExpand = (obj.expand && !obj.ref);

    // s as alias { * }
    if (obj.as && !isAnonymousExpand)
      result += this.renderAlias(obj.as, env);

    // We found a leaf - no further drilling
    if (!obj.inline && !obj.expand) {
      env.path.push('cast');
      if (obj.cast && obj.cast.type)
        result += ` : ${ this.renderTypeReferenceAndProps(obj.cast, env, { noAnnoCollect: true }) }`;
      else if (obj.cast && obj.cast.target) // test tbd
        result += ` : ${ this.renderRedirectedTo(obj.cast, env) }`;
      env.path.length -= 1;
      return result;
    }

    if (obj.inline)
      result += '.{\n';
    else
      result += result !== '' ? ' {\n' : '{\n';

    // Drill down and render children of the expand/inline
    const childEnv = env.withIncreasedIndent();
    const expandInline = obj.expand || obj.inline;
    result += expandInline //
      .map(elm => this.renderAnnotationAssignmentsAndDocComment(elm, childEnv) + childEnv.indent + this.renderInlineExpand(elm, childEnv))
      .join(',\n');
    result += `\n${ env.indent }}`;

    // Don't forget about the .excluding
    if (obj.excluding)
      result += ` excluding { ${ obj.excluding.join(',') } }`;

    // { * } as expand
    if (obj.as && isAnonymousExpand)
      result += this.renderAlias(obj.as, env);

    return result;
  }

  /**
   * Render .doc properties as comments in CDL
   *
   * @param {object} obj Object to render for
   * @param {CdlRenderEnvironment} env
   * @returns {String}
   */
  renderDocComment( obj, env ) {
    if (!obj || obj && obj.doc === undefined)
      return '';
    else if (obj && obj.doc === null) // empty doc comment needs to be rendered
      return `\n${ env.indent }/** */\n`;

    let { doc } = obj;
    if (/[*]\//.test(doc)) // only escape sequence allowed in CDL for doc comments
      doc = doc.replace(/[*]\//g, '*\\/');

    // Smaller comment for single-line comments.  If the comment starts or ends with whitespace
    // we must use a block comment, or it will be lost when compiling the source again.
    if (!obj.doc.includes('\n') && !/(^\s)|(\s$)/.test(obj.doc))
      return `${ env.indent }/** ${ doc } */\n`;

    const comment = doc.split('\n').map(l => `${ env.indent } * ${ l }`).join('\n');
    return `${ env.indent }/**\n${ comment }\n${ env.indent } */\n`;
  }

  /**
   * @param {string} artifactName
   * @param {CSN.Artifact} art
   * @param {CdlRenderEnvironment} env
   */
  renderView( artifactName, art, env ) {
    const syntax = (art.projection) ? 'projection' : 'entity';
    let result = this.renderAnnotationAssignmentsAndDocComment(art, env);
    result += `${ env.indent }entity ${ this.renderArtifactName(artifactName, env) }`;
    if (art.params)
      result += this.renderParameters(art, env);
    result += ' as ';
    result += this.renderQuery(getNormalizedQuery(art).query, true, syntax, env.withSubPath([ art.projection ? 'projection' : 'query' ]), art.elements);
    if (art.actions) // Views/Projections also allow actions. Just the VIEW keyword variant did not.
      result += this.renderBoundActionsAndFunctions(art, env);
    result += ';\n';
    result += this.renderQueryElementAndEnumAnnotations(art, env);
    if (art.includes)
      result += this.renderExtension({ extend: artifactName, includes: art.includes }, env);
    return result;
  }

  /**
   * Render a query 'query', i.e. a select statement with where-condition etc.
   * If 'isLeadingQuery' is true, mixins, actions and functions of 'art' are
   * also rendered into the query. Use 'syntax' style ('projection', 'view',
   * or 'entity')
   *
   * @param {CSN.Query} query
   * @param {boolean} isLeadingQuery
   * @param {string} syntax The query syntax, either "projection", "entity" or "view"
   * @param {CdlRenderEnvironment} env
   * @param {object} [elements]
   */
  renderQuery( query, isLeadingQuery, syntax, env, elements = query.elements || Object.create(null) ) {
    const that = this;
    if (query.SET) {
      // Set operator, such as UNION, INTERSECT, or EXCEPT...
      return renderQuerySet();
    }
    else if (!query.SELECT) {
      // ...otherwise must have a SELECT
      throw new ModelError(`Unexpected query operation ${ JSON.stringify(query) }`);
    }

    let result = '';
    const select = query.SELECT;

    // If not a projection, must be view/entity.
    result += (syntax === 'projection') ? 'projection on ' : 'select from ';

    env.path.push('from');
    result += this.renderViewSource(select.from, env);
    env.path.length -= 1;

    if (select.mixin) {
      let elems = '';
      env.path.push('mixin', '');
      env.increaseIndent();
      forEach(select.mixin, (name, mixin) => {
        env.path[env.path.length - 1] = name;
        elems += this.renderElement(name, mixin, env);
      });
      env.decreaseIndent();
      env.path.length -= 2;
      if (elems) {
        result += ' mixin {\n';
        result += elems;
        result += `${ env.indent }} into`;
      }
    }
    result += select.distinct ? ' distinct' : '';
    if (select.columns) {
      result += ' {\n';
      env.increaseIndent();
      result += this.renderViewColumns(select, env, elements);
      env.decreaseIndent();
      result += `${ env.indent }}`;
    }

    const childEnv = env.withIncreasedIndent();
    if (select.excluding) {
      const excludes = select.excluding.map(id => `${ childEnv.indent }${ this.quoteNonIdentifierOrKeyword(id, env) }`).join(',\n');
      result += ` excluding {\n${ excludes }\n`;
      result += `${ env.indent }}`;
    }

    if (isLeadingQuery && query.actions)
      result += this.renderBoundActionsAndFunctions(query, env);

    if (select.where)
      result += `${ continueIndent(result, env) }where ${ this.exprRenderer.renderExpr(select.where, env.withSubPath([ 'where' ])) }`;

    if (select.groupBy)
      result += `${ continueIndent(result, env) }group by ${ select.groupBy.map((expr, i) => this.exprRenderer.renderExpr(expr, env.withSubPath([ 'groupBy', i ]))).join(', ') }`;

    if (select.having)
      result += `${ continueIndent(result, env) }having ${ this.exprRenderer.renderExpr(select.having, env.withSubPath([ 'having' ])) }`;

    if (select.orderBy)
      result += `${ continueIndent(result, env) }order by ${ select.orderBy.map((entry, i) => this.renderOrderByEntry(entry, env.withSubPath([ 'orderBy', i ]))).join(', ') }`;

    if (select.limit)
      result += `${ continueIndent(result, env) }${ this.renderLimit(select.limit, env.withSubPath([ 'limit' ])) }`;

    return result;

    /**
     * Utility function to make sure that we continue with the same indentation in WHERE, GROUP BY, ... after a closing curly brace and beyond
     *
     * @param {string} str
     * @param {CdlRenderEnvironment} indentEnv
     * @return {string}
     */
    function continueIndent( str, indentEnv ) {
      if (str.endsWith('}') || str.endsWith('})')) {
        // The preceding clause ended with '}', just append after that
        return ' ';
      }
      // Otherwise, start new line and indent normally
      return `\n${ indentEnv.withIncreasedIndent().indent }`;
    }

    /**
     * Render UNION, INTERSECT, and EXCEPT, i.e. sets.
     *
     * @return {string}
     */
    function renderQuerySet() {
      const subQueries = query.SET.args.map((arg, i) => {
        // First arg may be leading query
        const subEnv = env.withSubPath([ 'SET', 'args', i ]);
        const subQuery = that.renderQuery(arg, isLeadingQuery && (i === 0), 'view', subEnv, elements);
        return `(${ subQuery })`;
      });

      let setResult = subQueries.join(`\n${ env.indent }${ query.SET.op }${ query.SET.all ? ' all' : '' } `);
      // Set operation may also have an ORDER BY and LIMIT/OFFSET (in contrast to the ones belonging to
      // each SELECT)
      if (query.SET.orderBy)
        setResult += `${ continueIndent(setResult, env) }order by ${ query.SET.orderBy.map((entry, i) => that.renderOrderByEntry(entry, env.withSubPath([ 'SET', 'orderBy', i ]))).join(', ') }`;

      if (query.SET.limit)
        setResult += `${ continueIndent(setResult, env) }${ that.renderLimit(query.SET.limit, env.withSubPath([ 'SET', 'limit' ])) }`;
      return setResult;
    }
  }

  /**
   * Render one entry of a query's ORDER BY clause (which always has a 'value' expression, and may
   * have a 'sort' property for ASC/DESC and a 'nulls' for FIRST/LAST
   *
   * @param {object} entry
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderOrderByEntry( entry, env ) {
    let result = this.renderAnnotationAssignmentsAndDocComment(entry, env) + this.exprRenderer.renderExpr(entry, env);
    if (entry.sort)
      result += ` ${ entry.sort }`;

    if (entry.nulls)
      result += ` nulls ${ entry.nulls }`;

    return result;
  }

  /**
   * Render a query's LIMIT clause, which may also have OFFSET.
   *
   * @param {CSN.QueryLimit} limit
   * @param {CdlRenderEnvironment} limitEnv
   * @return {string}
   */
  renderLimit( limit, limitEnv ) {
    let limitStr = '';
    if (limit.rows !== undefined)
      limitStr += `limit ${ this.exprRenderer.renderExpr(limit.rows, limitEnv.withSubPath([ 'rows' ])) }`;

    if (limit.offset !== undefined) {
      const offsetIndent = (limitStr === '') ? '' : `\n${ limitEnv.withIncreasedIndent().indent }`;
      limitStr += `${ offsetIndent }offset ${ this.exprRenderer.renderExpr(limit.offset, limitEnv.withSubPath([ 'offset' ])) }`;
    }
    return limitStr;
  }

  /**
   * Render an entity's actions and functions (if any)
   * (expect an entity with trailing '}' or an 'extend' statement ending with 'with'
   * to have just been rendered).
   * Return the resulting source string.
   *
   * @param {CSN.Artifact} art
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderBoundActionsAndFunctions( art, env ) {
    let result = '';
    if (art.actions) {
      const childEnv = env.withIncreasedIndent();
      for (const name in art.actions)
        result += this.renderActionOrFunction(name, art.actions[name], childEnv.withSubPath([ 'actions', name ]), true);
      result = (result === '')
        ? ' actions { }'
        : ` actions {\n${ result }${ env.indent }}`;
    }
    return result;
  }

  /**
   * Render an action or function 'act' with name 'actName'. Return the resulting source string.
   *
   * @param {string} actionName
   * @param {CSN.Action} act
   * @param {CdlRenderEnvironment} env
   * @param {boolean} isBound
   * @return {string}
   */
  renderActionOrFunction( actionName, act, env, isBound ) {
    let result = this.renderAnnotationAssignmentsAndDocComment(act, env) + env.indent + act.kind;
    if (isBound) {
      // for bound actions, paths are not global
      result += ` ${ this.quotePathIfRequired(actionName, env) }`;
    }
    else {
      result += ` ${ this.renderArtifactName(actionName, env) }`;
    }
    result += this.renderParameters(act, env);
    if (act.returns) {
      let actEnv = env.withSubPath([ 'returns' ]);
      const annos = this.renderAnnotationAssignmentsAndDocComment(act.returns, actEnv.withIncreasedIndent());
      if (annos) // if `returns` has annotations, increase indent for nicer aligned output
        actEnv = actEnv.withIncreasedIndent();
      const type = this.renderTypeReferenceAndProps(act.returns, actEnv);
      result += ` returns${ annos ? '\n' : ' ' }${ annos }${ annos ? actEnv.indent : '' }${ type }`;
    }

    result += ';\n';
    return result;
  }

  /**
   * Render art.params, i.e. list of parameter in parentheses.  If there is only one
   * parameter, a single line is used, otherwise an indented list is used.
   * If there are no params, an empty list `()` is returned.
   *
   * @param {CSN.Artifact} art
   * @param {CdlRenderEnvironment} env
   * @returns {string}
   */
  renderParameters( art, env ) {
    const childEnv = env.withIncreasedIndent();
    const parameters = Object.keys(art.params || {}).map(name => this.renderParameter(name, art.params[name], childEnv));
    if (parameters.length === 0)
      return '()';
    return `(\n${ parameters.join(',\n') }\n${ env.indent })`;
  }

  /**
   * Render an action or function parameter 'par' with name 'parName'. Return the resulting source string (no trailing LF).
   *
   * @param {string} parName
   * @param {object} par
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderParameter( parName, par, env ) {
    env = env.withSubPath( [ 'params', parName ]);
    let result = `${ this.renderAnnotationAssignmentsAndDocComment(par, env) }${ env.indent }`;
    result += `${ this.quoteNonIdentifierOrKeyword(parName, env) } : ${ this.renderTypeReferenceAndProps(par, env) }`;
    return result;
  }

  /**
   * Render a reference to a type used by 'artifact' (named or inline) and (element) properties
   * such as `not null` and `default <xpr>`.
   * Allow suppressing rendering of structs such as enums - used in columns for example.
   *
   * @param {CSN.Artifact} artifact
   * @param {CdlRenderEnvironment} env
   * @param {object} [config={}]
   * @param {boolean} [config.typeRefOnly] Whether to only render type defs, no arrayed/structured/enum.
   * @param {boolean} [config.noAnnoCollect] Do not collect annotations of sub-elements.
   * @return {string}
   */
  renderTypeReferenceAndProps( artifact, env, config = {} ) {
    let result = '';
    const { typeRefOnly, noAnnoCollect } = config;

    if (typeRefOnly && !artifact.type)
      throw new ModelError(`Expected artifact to have a type; in: ${ JSON.stringify(env.path) }`);

    if (artifact.localized) // works even for type definitions
      result += 'localized ';

    // Some properties are always "top-level", even for "many", e.g. "default" or
    // "not null". Keep a reference to the outer artifact.
    const origArtifact = artifact;
    if (!artifact.type && artifact.items) {
      this.checkArrayedArtifact(artifact, env);
      result += 'many '; // alternative: 'array of'; but not used
      artifact = artifact.items;
      env = env.withSubPath([ 'items' ]);
    }

    const type = normalizeTypeRef(artifact.type);

    if (!type && artifact.elements) {
      result += this.renderElements(artifact, env);
      result += this.renderNullability(artifact.notNull);
      // structured default not possible at the moment
      return result;
    }

    const defaultValue = origArtifact.default ? origArtifact.default : artifact.default;
    const notNull = origArtifact.notNull ? origArtifact.notNull : artifact.notNull;

    // Association type
    if (isDirectAssocOrComp(type)) {
      const isComp = type === 'cds.Composition';
      // Type, cardinality and target; CAPire uses CamelCase
      result += isComp ? 'Composition' : 'Association';
      result += this.renderCardinality(artifact);

      // `targetAspect` may be set by the core compiler and refers to the original named or unnamed aspect.
      // In parseCdl, `target` may still be an object containing elements.  This would be replaced
      // by targetAspect in client CSN, but we can't rely on that.
      // If a name exists (either in target or targetAspect), prefer it over rendering elements.
      const elements = artifact.target?.elements || artifact.targetAspect?.elements;
      if (typeof artifact.target === 'string' || typeof artifact.targetAspect === 'string') {
        result += this.renderAbsolutePath({ ref: [ artifact.target || artifact.targetAspect ] },
                                          { ...env, additionalKeywords: [ 'MANY', 'ONE' ] });
      }
      else if (elements) {
        // anonymous aspect, either parseCdl or client CSN.
        result += this.renderElements({ elements }, env.withSubPath([ artifact.target?.elements ? 'target' : 'targetAspect' ]));
      }
      else {
        throw new ModelError('Association/Composition is missing its target! Throwing exception to trigger recompilation.');
      }

      // ON-condition (if any)
      if (artifact.on)
        result += ` on ${ this.exprRenderer.renderExpr(artifact.on, env.withSubPath([ 'on' ])) }`;

      // Foreign keys (if any, unless we also have an ON_condition (which means we have been transformed from managed to unmanaged)
      if (artifact.keys && !artifact.on)
        result += ` ${ this.renderForeignKeys(artifact, env) }`;

      if (!artifact.on) {
        // unmanaged associations can't be followed by "not null" or "default"
        result += this.renderNullability(notNull);
        result += this.renderDefaultExpr(defaultValue, env.withSubPath([ 'default' ]));
      }
      return result;
    }

    // At this point, we will render a named type.

    // If we have a type and elements, we may have sub-structure annotates that would
    // get lost if we only render the type name.
    // We only extract annotations of enums, if "typeRefOnly" is true.  Otherwise, since
    // the full enum is rendered below, we would have unnecessary annotations.
    if (!noAnnoCollect && (!artifact.enum || typeRefOnly)) {
      const annotate = this.collectAnnotationsOfElementsAndEnum(artifact, env);
      if (annotate)
        this.subelementAnnotates.push(annotate);
    }

    // Reference to another artifact
    if (typeof type === 'string') {
      // If we get here, it must be a named type
      result += this.renderNamedTypeWithParameters(artifact, env);
    }
    else if (type?.ref) {
      result += this.renderAbsolutePath(artifact.type, env);
    }

    if (artifact.enum && !typeRefOnly)
      result += this.renderEnum(artifact.enum, env);

    result += this.renderNullability(notNull);
    // If there is a default value, and it's a calculated element, do not
    // render the default (because it's not supported for calc elements).
    if (defaultValue !== undefined && !artifact.value)
      result += this.renderDefaultExpr(defaultValue, env.withSubPath([ 'default' ]));

    return result;
  }

  /**
   * Render REDIRECTED TO with its keys/on condition for the given artifact.
   *
   * @param {object} art
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderRedirectedTo( art, env ) {
    let result = `redirected to ${ this.renderDefinitionReference(art.target, env) }`;
    if (art.on)
      result += ` on ${ this.exprRenderer.renderExpr(art.on, env.withSubPath([ 'on' ])) }`;
    else if (art.keys)
      result += ` ${ this.renderForeignKeys(art, env) }`;
    return result;
  }

  /**
   * Render the named type with optional parameters, e.g. `MyString(length: 10)`.
   *
   * @param {CSN.Artifact} artWithType
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderNamedTypeWithParameters( artWithType, env ) {
    const type = normalizeTypeRef(artWithType.type);
    let result = this.renderDefinitionReference(type, env);
    result += this.renderTypeParameters(artWithType);
    return result;
  }


  /**
   * Render the 'enum { ... } part of a type declaration
   *
   * @param {CSN.EnumList} enumPart
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderEnum( enumPart, env ) {
    let result = ' enum {\n';
    const childEnv = env.withIncreasedIndent();
    for (const name in enumPart)
      result += this.renderElement(name, enumPart[name], childEnv.withSubPath([ 'enum', name ]));
    result += `${ env.indent }}`;
    return result;
  }

  /**
   * Render an annotation value, which is either
   *  - a normal expressions
   *  - a somewhat simplified expression, with slightly different representation
   *
   * @param {any} annoValue
   * @param {CdlRenderEnvironment} env
   */
  renderAnnotationValue( annoValue, env ) {
    if (isAnnotationExpression(annoValue)) {
      // Once inside an expression, we stay there.
      const xpr = this.exprRenderer.renderExpr(annoValue, env);
      return `( ${ xpr } )`;
    }
    else if (Array.isArray(annoValue)) {
      return this.renderAnnotationArrayValue( annoValue, env );
    }
    else if (typeof annoValue === 'object' && annoValue !== null) {
      // Enum symbol
      if (annoValue['#'] !== undefined) {
        return `#${ annoValue['#'] }`;
      }
      // Shorthand for absolute path (as string)
      else if (annoValue['='] !== undefined) {
        if (annoValue['='].startsWith('@'))
          return this.quoteAnnotationPathIfRequired(annoValue['='], env);
        return this.quotePathIfRequired(annoValue['='], env);
      }
      // Shorthand for ellipsis: `... up to <val>`
      else if (annoValue['...'] !== undefined) {
        if (annoValue['...'] === true)
          return '...';
        return `... up to ${ this.renderAnnotationValue(annoValue['...'], env) }`;
      }

      // Struct value (can currently only occur within an array)
      // Render as one-liner if there is at most one key.  Render as multi-line
      // struct if there are more and use nicer indentation.
      const keys = Object.keys(annoValue);
      const childEnv = env.withIncreasedIndent();
      const values = keys.map(key => `${ this.quoteAnnotationPathIfRequired(key, env) }: ${ this.renderAnnotationValue(annoValue[key], childEnv.withSubPath([ key ])) }`);
      const result = joinDocuments(values, [ ',', line() ]);
      return format(nestBy(env.indent.length, bracketBlock(INDENT_SIZE, '{', result, '}') ));
    }
    // Null
    else if (annoValue === null) {
      return 'null';
    }
    // Primitive: string, number, boolean

    // Quote strings, leave all others as they are
    return (typeof annoValue === 'string') ? renderString(annoValue, env) : String(annoValue);
  }

  /**
   * Renders an array annotation value.  Uses a heuristic to put each element on its own line
   * if a single-line becomes longer than 100 characters or if any sub-expression already
   * contains a line break.  The latter checks makes nested arrays with structures more
   * readable.
   *
   * @param {any[]} annoValue
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderAnnotationArrayValue( annoValue, env ) {
    const childEnv = env.withIncreasedIndent();
    // Render array parts as values.
    const items = annoValue.map((item, i) => this.renderAnnotationValue(item, childEnv.withSubPath([ i ])));
    const result = joinDocuments(items, [ ',', line() ]);
    return format(nestBy(env.indent.length, bracketBlock(INDENT_SIZE, '[', result, ']')));
  }

  /**
   * Render a single path step 's' at path position 'idx', which can have filters or parameters or be a function
   *
   * @param {string|object} s
   * @param {number} idx
   * @param {object} env
   * @returns {string}
   */
  renderPathStep( s, idx, env ) {
    // Simple id or absolute name
    if (typeof s === 'string') {
      // In first path position, do not quote $projection and magic $-variables like CURRENT_DATE, $now etc.
      // FIXME: We should rather explicitly recognize quoting somehow
      if (idx === 0 && s.startsWith('$'))
        return s;
      return this.quoteNonIdentifierOrKeyword(s, env);
    }
    // ID with filters or parameters
    else if (typeof s === 'object') {
      // Sanity check
      if (!s.func && !s.id)
        throw new ModelError(`Unknown path step object: ${ JSON.stringify(s) }`);

      // Not really a path step but an object-like function call
      if (s.func)
        return `${ s.func }(${ this.renderArguments(s, '=>', env) })`;

      // Path step, possibly with view parameters and/or filters
      let result = `${ this.quoteNonIdentifierOrKeyword(s.id, env) }`;
      if (s.args) {
        // View parameters
        result += `(${ this.renderArguments(s, ':', env) })`;
      }

      result += this.renderFilterAndCardinality(s, env);

      return result;
    }

    throw new ModelError(`Unknown path step: ${ JSON.stringify(s) }`);
  }

  /**
   * Render function arguments or view parameters (positional if array, named if object/dict),
   * using 'sep' as separator for named parameters
   *
   * @param {object} node with `args` to render
   * @param {string} sep
   * @param {CdlRenderEnvironment} env
   * @returns {string}
   */
  renderArguments( node, sep, env ) {
    if (!node.args)
      return '';
    else if (Array.isArray(node.args))
      return this.renderPositionalArguments(node, env);
    else if (typeof node.args === 'object')
      return this.renderNamedArguments(node, sep, env);
    throw new ModelError(`Unknown args: ${ JSON.stringify(node.args) }; expected array/object`);
  }

  /**
   * Render named function arguments or view parameters,
   * using 'sep' as separator.
   *
   * @param {object} node with `args` to render
   * @param {string} separator
   * @param {CdlRenderEnvironment} env
   * @returns {string}
   */
  renderNamedArguments( node, separator, env ) {
    const that = this;
    return Object.keys(node.args).map(function renderNamedArgument(key) {
      return `${ that.quoteNonIdentifierOrKeyword(key, env) } ${ separator } ${ that.renderArgument(node.args[key], env.withSubPath([ 'args', key ])) }`;
    }).join(', ');
  }

  /**
   * Render a comma separated list of positional function arguments.
   *
   * @param {object} node with `args` to render
   * @param {CdlRenderEnvironment} env
   * @returns {string}
   */
  renderPositionalArguments( node, env ) {
    if (!node.args)
      return '';
    const func = node.func?.toUpperCase();
    const that = this;
    if (func) {
      return node.args.map(function renderFunctionArg(arg, i) {
        return that.renderArgument(arg, env.withSubPath([ 'args', i ]), getKeywordsForSpecialFunctionArgument(func, i));
      }).join(', ');
    }
    return node.args.map((arg, i) => this.renderArgument(arg, env.withSubPath([ 'args', i ]))).join(', ');
  }

  /**
   * Render a function argument, e.g. for generic functions or CAST().
   * Ensures that parentheses are used if necessary, e.g. for `someFct( (1=1), (1=1) )`.
   *
   * @param {any} arg
   * @param {CdlRenderEnvironment} env
   * @param {string[]} additionalKeywords
   * @return {string}
   */
  renderArgument( arg, env, additionalKeywords = [] ) {
    // If the argument is a xpr with e.g. `=`, it may require parentheses.
    // For nested xpr, `exprRenderer.renderExpr()` will already add parentheses.
    env = env.cloneWith({ additionalKeywords });
    if (isSimpleFunctionExpression(arg && arg.xpr, additionalKeywords))
      return this.exprRenderer.renderExpr(arg, env);
    return this.exprRenderer.renderSubExpr(arg, env);
  }

  /**
   * Render an artifact's cardinality.
   *
   * @param artifact
   * @returns {string}
   */
  renderCardinality( artifact ) {
    if (this.isSimpleCardinality(artifact.cardinality))
      return this.renderSimpleCardinality(artifact);
    return this.renderBracketCardinality(artifact);
  }

  /**
   * Render a cardinality (only those parts that were actually provided)
   *
   * @param {CSN.Artifact} art
   * @return {string}
   */
  renderBracketCardinality( art ) {
    const isComp = normalizeTypeRef(art.type) === 'cds.Composition';
    const suffix = (isComp ? ' of ' : ' to ');
    const card = art.cardinality;

    if (!card)
      return suffix;

    let result = '[';
    if (card.src !== undefined)
      result += `${ card.src }, `;
    if (card.min !== undefined)
      result += `${ card.min }..`;
    if (card.max !== undefined)
      result += card.max;
    // srcmin can't be represented in CDL
    return `${ result }]${ suffix }`;
  }

  /**
   * A "simple" cardinality is one that only has a "max" cardinality property
   * which is either '*' or 1.
   *
   * @param {CSN.Cardinality} cardinality
   * @return {boolean}
   */
  isSimpleCardinality( cardinality ) {
    return !cardinality || (
      cardinality.min === undefined &&
      cardinality.src === undefined &&
      cardinality.srcmin === undefined &&
      (cardinality.max === '*' || cardinality.max === 1)
    );
  }

  /**
   * Renders the simple cardinality of an association/composition, i.e. "many"/"one",
   * including the "of"/"to" part.
   *
   * @param {CSN.Element} elem
   * @return {string}
   */
  renderSimpleCardinality( elem ) {
    let result = (normalizeTypeRef(elem.type) === 'cds.Association' ? ' to ' : ' of ');
    if (!elem.cardinality)
      return result;
    if (elem.cardinality.max === '*')
      result += 'many ';
    else if (elem.cardinality.max === 1)
      result += 'one ';
    return result;
  }

  renderFilterAndCardinality( s, env ) {
    let result = '';
    const cardinality = s.cardinality ? (`${ s.cardinality.max }: `) : '';
    let filter = '';

    // TODO: Unify with other filter rendering for SELECT
    if (s.groupBy)
      filter += ` group by ${ s.groupBy.map((expr, i) => this.exprRenderer.renderExpr(expr, env.withSubPath([ 'groupBy', i ]))).join(', ') }`;
    if (s.having)
      filter += ` having ${ this.exprRenderer.renderExpr(s.having, env.withSubPath([ 'having' ])) }`;
    if (s.orderBy)
      filter += ` order by ${ s.orderBy.map((entry, i) => this.renderOrderByEntry(entry, env.withSubPath([ 'orderBy', i ]))).join(', ') }`;
    if (s.limit)
      filter += ` ${ this.renderLimit(s.limit, env.withSubPath([ 'limit' ])) }`;

    if (s.where) {
      let where = this.exprRenderer.renderExpr(s.where, env.withSubPath([ 'where' ]));
      // Special rules in CDS parser: If filter starts with one of these SQL keywords, WHERE is mandatory.
      if (filter || /^(?:group|having|order|limit)\s/i.test(where))
        where = ` where ${ where }`;
      filter = `${ where } ${ filter }`;
    }

    filter = filter.trim();

    if (cardinality || filter) {
      if (filter.endsWith(']')) // for cases such as [… ![id] ]
        result += `[ ${ cardinality }${ filter } ]`;
      else
        result += `[${ cardinality }${ filter }]`;
    }
    return result;
  }

  renderDefaultExpr( defaultValue, env ) {
    if (!defaultValue)
      return '';
    let result = ' default ';
    if (defaultValue.xpr && xprContainsCondition( defaultValue.xpr))
      result += this.exprRenderer.renderSubExpr(withoutCast(defaultValue), env);
    else
      result += this.exprRenderer.renderExpr(withoutCast(defaultValue), env);
    return result;
  }

  // Render the nullability of an element or parameter (can be unset, true, or false)
  renderNullability( notNull /* , env */) {
    if (notNull === undefined) {
      // Attribute not set at all
      return '';
    }
    return notNull ? ' not null' : ' null';
  }

  /**
   * Render foreign keys.
   *
   * @param {object} art
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderForeignKeys( art, env ) {
    const renderedKeys = [];
    let hasAnnotations = false;
    env = env.withSubPath([ 'keys', -1 ]);
    env.increaseIndent();

    for (let i = 0; i < art.keys.length; ++i) {
      env.path[env.path.length - 1] = i;
      const fKey = art.keys[i];

      const annos = this.renderAnnotationAssignmentsAndDocComment(fKey, env).trim();
      if (annos) {
        hasAnnotations = true;
        renderedKeys.push(annos);
      }

      const alias = fKey.as ? this.renderAlias(fKey.as, env) : '';
      const key = this.exprRenderer.renderExpr(fKey, env);
      renderedKeys.push(`${ key }${ alias },`);
    }

    if (hasAnnotations) {
      const sep = `\n${ env.indent }`;
      env.decreaseIndent();
      return `{${ sep }${ renderedKeys.join(sep) }\n${ env.indent }}`;
    }

    let result = renderedKeys.join(' ');
    if (result[result.length - 1] === ',') // remove trailing comma
      result = result.slice(0, -1);
    return `{ ${ result } }`;
  }

  /**
   * Render an explicit alias, e.g. for columns.
   *
   * @param {string} alias
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderAlias( alias, env ) {
    return ` as ${ this.quoteNonIdentifierOrKeyword(alias, env) }`;
  }

  /**
   * Render (primitive) type parameters of artifact 'artWithType', i.e.
   * length, precision and scale (even if incomplete), plus any other unknown ones.
   *
   * @param {CSN.Artifact} artWithType
   * @param {boolean} noShortVersion If true, parameters will not be shortened, e.g. `(10)`
   *                                 for length instead of `(length: 10)`.
   * @returns {string}
   */
  renderTypeParameters( artWithType, noShortVersion = false ) {
    const params = typeParameters.list.filter(param => artWithType[param] !== undefined);
    if (params.length === 0)
      return '';

    if (!noShortVersion) {
    // Special cases for 1 or 2 arguments.
      if (params.length === 1 && artWithType.length !== undefined)
        return `(${ artWithType.length })`;
      if (params.length === 2 && artWithType.precision !== undefined && artWithType.scale !== undefined)
        return `(${ artWithType.precision }, ${ artWithType.scale })`;
    }

    // Render named params
    const renderedParams = [];
    for (const param of params)
      renderedParams.push(`${ param }: ${ artWithType[param] }`);

    return `(${ renderedParams.join(', ') })`;
  }

  /**
   * Render all annotation assignments of annotatable object 'obj'.
   *
   * @param {object} obj Object that has annotations
   * @param {CdlRenderEnvironment} env
   * @param {{parentheses: boolean}} [config] Config for renderAnnotationAssignment()
   * @return {string}
   */
  renderAnnotationAssignmentsAndDocComment( obj, env, config ) {
    let result = this.renderDocComment(obj, env);
    for (const name in obj) {
      if (name.startsWith('@'))
        result += this.renderAnnotationAssignment(obj[name], name, env.withSubPath([ name ]), config);
    }
    return result;
  }

  /**
   * Render a single annotation assignment 'anno' with fully qualified name 'name' (no trailing LF).
   * We might see variants like 'A.B.C#foo' or even 'A.B#foo.C'. The latter needs to be quoted as
   * dots in the variant are not recognized by the compiler.
   *
   * @param {any} anno Annotation value
   * @param {string} name Annotation name, e.g. `@A.B.C#foo.C`
   * @param {CdlRenderEnvironment} env
   * @param {object} [config] parentheses: Whether the annotation assignment must be surrounded by parentheses.
   * @return {string} Rendered annotation, possibly quoted: `@![A.B.C#foo.C]: value`
   */
  renderAnnotationAssignment( anno, name, env, config = { parentheses: false } ) {
    name = name.substring(1);
    // Take the annotation assignment apart into <nameBeforeVariant>#<variantAndRest>
    const parts = name.split('#');
    let nameBeforeVariant = parts[0];
    const variant = parts.length > 1 ? parts.slice(1).join('#') : undefined;
    const { parentheses } = config;

    let result = `${ env.indent }@`;
    if (parentheses)
      result += '(';

    // if the variant is empty, render '#' as part of the name, e.g `variant !== undefined`.
    if (variant === '')
      nameBeforeVariant += '#';

    result += this.quoteAnnotationPathIfRequired(nameBeforeVariant, env);

    if (variant !== undefined && variant !== '') {
      // Unfortunately, the compiler does not allow `.@` after the first variant identifier,
      // nor multiple `#`, so we're back at simple paths that are possibly quoted.
      result += `#${ this.quotePathIfRequired(variant, env) }`;
    }
    result += ` : ${ this.renderAnnotationValue(anno, env) }`;

    if (parentheses)
      result += ')';
    return `${ result }\n`;
  }

  /**
   * Render the name of an artifact, quote path steps if necessary.
   *
   * @param {string} artifactName Artifact name to render
   * @param {CdlRenderEnvironment} env
   * @return {string} Artifact name ready for rendering
   */
  renderArtifactName( artifactName, env ) {
    return this.quotePathIfRequired(env.nameEnvStack.definitionName(artifactName), env);
  }

  /**
   * Render the name of a definition.  Ensures the first segment of the name
   * is available in the rendered CDL.  Otherwise, a USING is added.
   *
   * @param {string} name
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderDefinitionReference( name, env ) {
    if (name === '$self' && !this.csn.definitions.$self)
      return '$self';
    name = env.nameEnvStack.definitionReference(name);
    return this.quotePathIfRequired(name, env);
  }

  /**
   * @param {string[]} includes
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  renderIncludes( includes, env ) {
    return ` : ${ includes.map((name, i) => this.renderDefinitionReference(name, env.withSubPath([ 'includes', i ]))).join(', ') }`;
  }

  createCdlExpressionRenderer() {
    const that = this;
    return createExpressionRenderer({
      finalize: x => x,
      typeCast(x) {
        const typeRef = that.renderTypeReferenceAndProps(x.cast, this.env.withSubPath([ 'cast' ]), { typeRefOnly: true, noAnnoCollect: true });
        const arg = { ...x, cast: null }; // "arg" without cast to avoid recursion.
        return `cast(${ that.renderArgument(arg, this.env) } as ${ typeRef })`;
      },
      val(x) {
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
            return renderString(x.val, this.env);
          case 'object':
            if (x.val === null)
              return 'null';
            // otherwise fall through to
          default:
            throw new ModelError(`Unknown literal or type: ${ JSON.stringify(x) }`);
        }
      },
      enum: x => `#${ x['#'] }`,
      ref(x) {
        return `${ x.param ? ':' : '' }${ x.ref.map((step, index) => that.renderPathStep(step, index, this.env.withSubPath([ 'ref', index ]))).join('.') }`;
      },
      windowFunction(x) {
        const funcDef = this.func(x);
        return `${ funcDef } ${ this.renderExpr(x.xpr, this.env.withSubPath([ 'xpr' ])) }`; // xpr[0] is 'over'
      },
      func(x) {
        if (keywords.cdl_functions.includes(x.func.toUpperCase()) && !x.args)
          return x.func;
        const name = that.quoteFunctionIfRequired(x.func, this.env);
        if (!x.args) // e.g. for methods without arguments, `args` is not set at all.
          return `${ name }`;
        return `${ name }(${ that.renderArguments( x, '=>', this.env ) })`;
      },
      xpr(x) {
        const xprEnv = this.env.withSubPath([ 'xpr' ]);
        if (this.isNestedXpr && !x.cast)
          return `(${ this.renderExpr(x.xpr, xprEnv) })`;
        return this.renderExpr(x.xpr, xprEnv);
      },
      // Sub-queries in expressions need to be in parentheses, otherwise
      // left-associativity of UNIONS may result in different results.
      // For example: `select from E where id in (select from E union select from E);`:
      // Without parentheses, it would be different query.
      SET(x) {
        return `(${ that.renderQuery(x, false, 'view', this.env.withIncreasedIndent()) })`;
      },
      SELECT(x) {
        return `(${ that.renderQuery(x, false, 'view', this.env.withIncreasedIndent()) })`;
      },
    });
  }

  // checks -------------------------------------------------------------------
  // The CDL backend has very few checks, but we need to tell the user if
  // something can't be rendered.

  /**
   * If an artifact is an array via `.items`, some properties on `art` can't be rendered,
   * for example "not null", because there is no CDL representation for it.  Only "not null"
   * on `.items` can be rendered.
   *
   * Furthermore, to.cdl() can only render one nesting level of `items`.  `items` inside
   *  `items, etc. can't be represented in CDL, hence can't be rendered.
   *
   * @param {CSN.Artifact} art
   * @param {CdlRenderEnvironment} env
   */
  checkArrayedArtifact( art, env ) {
    if (!art.items)
      return;
    if (art.notNull !== undefined) {
      this.msg.warning('def-unexpected-nullability', env.path, { prop: 'not null', otherprop: 'items' },
                       'Property $(PROP) not rendered, because it can only be rendered inside $(OTHERPROP) for arrayed artifacts');
    }

    if (art.items.items && !art.items.type)
      this.msg.message('type-invalid-items', [ ...env.path, 'items' ], { '#': 'nested', prop: 'items' } );

    const type = art.items.type && normalizeTypeRef(art.items.type);
    if (type === 'cds.Association' || type === 'cds.Composition') {
      // check for `art.items.target` not sufficient; could be indirect type reference
      const isComp = type === 'cds.Composition';
      this.msg.message('type-invalid-items', [ ...env.path, 'items' ], { '#': isComp ? 'comp' : 'assoc', prop: 'items' });
    }
  }

  /**
   * Quote simple path steps with `![]` if necessary. For simple ids such as
   * `elem` use `quoteNonIdentifierOrKeyword` instead.
   *
   * In contrast to quoteNonIdentifierOrKeyword, does not handle additional keywords,
   * because it was not required, yet.
   *
   * Due to token rewrite, all keywords after a dot (`.`) are rewritten to
   * identifiers, i.e. we only need to check for the identifier RegEx.
   *
   * @param {string} path
   * @param {CdlRenderEnvironment} env
   * @returns {string}
   */
  quotePathIfRequired( path, env ) {
    return path.split('.').map((step, index) => {
      if (index === 0)
        return this.quoteNonIdentifierOrKeyword(step, env);
      else if (!undelimitedIdentifierRegex.test(step))
        return this.delimitedId(step, env);
      return step;
    }).join('.');
  }

  /**
   * Quote the id with `![]` if necessary. For paths such as `E.key` use
   * `quotePathIfRequired` instead.
   * See quoteNonIdentifier() if you want to ignore keywords.
   *
   * Set env.additionalKeywords to an array of UPPERCASE keywords
   * that also need quoting, e.g. in special functions.
   *
   * @param {string} id
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  quoteNonIdentifierOrKeyword( id, env ) {
    // Quote if required for CDL
    if (requiresQuotingForCdl(id, env?.additionalKeywords || []))
      return this.delimitedId(id, env);
    return id;
  }

  /**
   * Quote the id with `![]` if necessary. For paths such as `E.key` use
   * `quotePathIfRequired` instead.
   * See quoteNonIdentifierOrKeyword() if you want to quote identifiers
   * that are keywords as well.
   *
   * Does not quote the given id if it is a keyword.
   *
   * @param {string} id
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  quoteNonIdentifier( id, env ) {
    if (!undelimitedIdentifierRegex.test(id))
      return this.delimitedId(id, env);
    return id;
  }

  /**
   * Quote the given function name if required.
   *
   * @param {string} funcName
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  quoteFunctionIfRequired( funcName, env ) {
    if (cdlNewLineRegEx.test(funcName)) {
      this.msg.error('name-invalid-identifier', env.path, {},
                     'An identifier can\'t contain newline characters in CDL');
    }
    return apiSmartFunctionId(funcName);
  }

  /**
   * Quote an annotation path, e.g. `@My.@Anno.Description` if necessary.
   * `anno` can start with `@` but is not required to be.
   * Example of an annotation path that needs to be quoted:
   * `@![ spaces in path ].@!["double quotes"]`.
   *
   * @param {string} anno
   * @param {CdlRenderEnvironment} env
   * @returns {string}
   */
  quoteAnnotationPathIfRequired( anno, env ) {
    return anno.split('.').map((segment) => {
      if (segment.startsWith('@'))
        return `@${ this.quoteNonIdentifier(segment.slice(1), env) }`;
      return this.quoteNonIdentifier(segment, env);
    }).join('.');
  }

  /**
   * The same as the exported function apiDelimitedId, but checks that we can actually represent the
   * string: newline characters are not allowed.
   *
   * @param {string} id
   * @param {CdlRenderEnvironment} env
   * @return {string}
   */
  delimitedId( id, env ) {
    if (cdlNewLineRegEx.test(id)) {
      this.msg.error('name-invalid-identifier', env.path, {},
                     'An identifier can\'t contain newline characters in CDL');
    }
    return apiDelimitedId(id);
  }
}

class CdlRenderEnvironment {
  indent = '';
  path = null;
  elementName = null;
  additionalKeywords = [];
  nameEnvStack = new NameScopeStack();

  constructor(values) {
    Object.assign(this, values);
  }

  increaseIndent() {
    this.indent = `  ${ this.indent }`;
  }
  decreaseIndent() {
    this.indent = this.indent.substring(0, this.indent.length - INDENT_SIZE);
  }
  withIncreasedIndent() {
    const indent = ' '.repeat(this.indent.length + INDENT_SIZE);
    return new CdlRenderEnvironment({ ...this, indent });
  }
  withSubPath(path) {
    return new CdlRenderEnvironment({ ...this, path: [ ...this.path, ...path ] });
  }
  cloneWith(values) {
    return Object.assign(new CdlRenderEnvironment(this), values);
  }
}


/**
 * Returns a newly created default environment (which keeps track of indentation, required USING
 * declarations and name prefixes.
 *
 * @param {object} [values]
 * @return {CdlRenderEnvironment}
 */
function createEnv( values = {} ) {
  return new CdlRenderEnvironment( values );
}

/**
 * Remove a trailing `\n`/newline/LF from `str` and return the modified string.
 * Useful if you want to append a `;` to the string, but not on a separate line.
 *
 * @param {string} str
 * @return {string}
 */
function removeTrailingNewline( str ) {
  if (str[str.length - 1] === '\n')
    str = str.substring(0, str.length - 1);
  return str;
}

/**
 * Returns true if 'id' requires quotes for CDL, i.e. if 'id'
 * does not match the first part of the `Identifier` rule of `language.g4`
 * or if 'id' is a reserved keyword.
 *
 * Set additionalKeywords to an array of UPPERCASE keywords
 * that also need quoting, e.g. in special functions.
 *
 * @param {string} id
 * @param {string[]} [additionalKeywords]
 * @return {boolean}
 */
function requiresQuotingForCdl( id, additionalKeywords ) {
  return !undelimitedIdentifierRegex.test(id) ||
    keywords.cdl.includes(id.toUpperCase()) ||
    keywords.cdl_functions.includes(id.toUpperCase()) ||
    additionalKeywords.includes(id.toUpperCase());
}

/**
 * Returns true if the given type is an association or composition,
 * without type indirection.
 *
 * @param {string|string[]} type
 * @return {boolean}
 */

function isDirectAssocOrComp( type ) {
  type = normalizeTypeRef(type);
  return (type === 'cds.Association' || type === 'cds.Composition');
}

const conditionOperators = [
  // Antlr rule 'condition', 'conditionAnd'
  'AND', 'OR',

  // redepage CdlGrammar.g4 rule 'expression'
  '=', '<>', '>', '>=', '<', '<=', '==', '!=',
  // These are not forbidden, since they must be preceded by one of the comparators above.
  // 'any', 'some', 'all',

  'IS', 'IN', 'NOT', 'NULL', 'EXISTS',
  // Antlr rule 'predicate'
  'BETWEEN', 'LIKE', 'ESCAPE',
];

/**
 * Returns true if the given xpr-array can be rendered without parentheses
 * in a `fct(<xpr>)` expression such as `cast(<xpr> as Type)`.  We only need to
 * look at the first nesting level.  Otherwise, `renderExpr()` will already add parentheses.
 *
 * The list of `conditionOperators` was created by looking at the `expression` Antlr rule.
 * Because of token-rewrites, there are functions that allow operators/tokens that would
 * require parentheses in other functions.  For example *regex functions allow `IN` but
 * if `IN` is used in other functions, it requires parentheses.  To allow for that case,
 * you can set `additionalAllowedKeywords` to list of tokens that are allowed.
 *
 * Note that this is more of a heuristic for "nicer" CDL output.  For example the
 * following snippet is parsable without parentheses:
 *   `cast( case when int > 1 then int else 0 end as Integer ),`
 * However, because it is a flat xpr-array, we see `>` and assume that it is not
 * a simple expression.
 *
 * @param {any[]} xpr
 * @param {string[]} additionalAllowedKeywords
 * @return {boolean}
 */
function isSimpleFunctionExpression( xpr, additionalAllowedKeywords = [] ) {
  return !xpr || xpr.every(val => typeof val !== 'string' ||
      (additionalAllowedKeywords.includes(val.toUpperCase()) ||
        !conditionOperators.includes(val.toUpperCase())));
}

/**
 * If `xpr` contains tokens that are used in conditions, it may be required to put the
 * rendered expression in parentheses.  This function checks if any direct entry in
 * `xpr` is a condition token such as `AND`.
 *
 * May report false positives for e.g. `CASE WHEN 1>1 THEN …`.
 *
 * @param {any[]} xpr
 * @return {boolean}
 */
function xprContainsCondition( xpr ) {
  return xpr && xpr.some(val => typeof val === 'string' &&
    conditionOperators.includes(val.toUpperCase()));
}

/**
 * Special functions may have special parser rules, such as SAP HANA RegEx functions.
 * They allow certain keywords in their arguments.
 *
 * This function is used to determine if arguments need to be put in parentheses or not.
 * See {@link isSimpleFunctionExpression}.
 *
 * @param {string} funcName
 * @param {number} argumentIndex
 * @returns {string[]}
 */
function getKeywordsForSpecialFunctionArgument( funcName, argumentIndex ) {
  const f = specialFunctions[funcName] && specialFunctions[funcName][argumentIndex];
  if (!f)
    return [];
  const additionalKeywords = [];
  if (f.intro)
    additionalKeywords.push(...f.intro);
  if (f.expr)
    additionalKeywords.push(...f.expr);
  if (f.separator)
    additionalKeywords.push(...f.separator);
  return additionalKeywords;
}

/**
 * Get a list of all special keywords for the given function.
 *
 * @param {string} funcName
 * @return {undefined|string[]}
 */
function getAllKeywordsForSpecialFunction( funcName ) {
  if (specialFunctionKeywords[funcName])
    return specialFunctionKeywords[funcName];
  else if (!specialFunctions[funcName])
    return undefined;

  const additionalKeywords = [];
  for (const arg of specialFunctions[funcName]) {
    if (arg.intro)
      additionalKeywords.push(...arg.intro);
    if (arg.expr)
      additionalKeywords.push(...arg.expr);
    if (arg.separator)
      additionalKeywords.push(...arg.separator);
  }
  specialFunctionKeywords[funcName] = additionalKeywords;
  return additionalKeywords;
}

/**
 * Render the given string.  Uses back-tick strings.
 * env is used for indentation of three-back-tick strings.
 *
 * @param {string} str
 * @param {CdlRenderEnvironment} env
 * @returns {string}
 */
function renderString( str, env ) {
  if (isSimpleString(str))
    return `'${ str.replace(/'/g, '\'\'') }'`;

  // We try to work similar to how JavaScript implements JSON.stringify.
  // JSON.stringify() also checks for unpaired unicode surrogates (see §25.5.2.2,
  // <https://tc39.es/ecma262/#sec-quotejsonstring>).
  str = escapeString(str, {
    $: '\\$',
    '`': '\\`',
    '\\': '\\\\',
    // Replace commonly known escape sequences for control characters
    // See lib/language/multiLineStringParser.js
    '\f': '\\f',
    '\v': '\\v',
    '\t': '\\t',
    '\b': '\\b',
    // If CR, LS, or PS appear, they have been encoded explicitly.  If we don't escape
    // them, a recompilation may yield different results because of newline normalization.
    '\r': '\\r',
    '\u{2028}': '\\u{2028}',
    '\u{2029}': '\\u{2029}',
    // Don't encode LF
    '\n': '\n',
    // JSON.stringify() is not required to escape all control characters, but if used, files may
    // be interpreted as binary.  Therefore, we replace them.
    // We exclude LF from this list (\n). Characters with "nice" escapes have been replaced above.
    control: hexEscape,
    unpairedSurrogate: hexEscape,
  });

  // Note: String is normalized, only \n is the line separator.
  const lines = str.split('\n');
  // We don't know whether a text block was used or not.  But if there
  // are more than three lines, text blocks with indentation "look nicer".
  // This value was chosen by personal taste.
  if (lines.length > 3) {
    str = lines.join(`\n${ env.indent }`);
    return `\`\`\`\n${ env.indent }${ str }\n${ env.indent }\`\`\``;
  }

  return `\`${ str }\``;
}

/** @param {number} codePoint */
function hexEscape( codePoint ) {
  const hex = codePoint.toString(16);
  return `\\u{${ hex }}`;
}

/**
 * Returns true if the given string can be represented by using single quotes.
 * @param {string} str
 */
function isSimpleString( str ) {
  // A single-line string allows everything except certain line separators/breaks.
  // See ANTLR grammar for specifics.
  // Furthermore, if control characters are used, we escape them,
  // as these are explicitly mentioned in the JSON spec (§9):
  // <https://www.ecma-international.org/wp-content/uploads/ECMA-404_2nd_edition_december_2017.pdf>
  // On top, because (invalid) surrogate pairs need to be handled, we check for them as well.
  // v3: Not a simple string if ' (\u0027) is in string.
  // eslint-disable-next-line no-control-regex
  return str === '' || (/^[^\u{0000}-\u{001F}\u2028\u2029]+$/u.test(str) &&
    !hasUnpairedUnicodeSurrogate(str));
}

/**
 * Quotes the identifier using CDL-style ![]-quotes.
 *
 * NOTE: It is not guaranteed that the resulting string can _always_ be parsed!
 *       If `id` contains newline characters, the resulting delimited identifier
 *       will not be parsable by the compiler!
 *
 * @param id
 * @returns {string}
 */
function apiDelimitedId( id ) {
  return `![${ id.replace(/]/g, ']]') }]`;
}

/**
 * Returns a delimited identifier if the given identifier needs quoting.
 * Because "special functions" such as SAP HANA RegEx functions have local keywords that
 * are not default CDL keywords, specify a function name to take care of that.
 *
 * NOTE: It is not guaranteed that the resulting string can _always_ be parsed!
 *       If `id` contains newline characters, the resulting delimited identifier
 *       will not be parsable by the compiler!
 *
 * @param {string} id
 * @param {null|string} insideFunction
 * @return {string}
 */
function apiSmartId( id, insideFunction = null ) {
  insideFunction = insideFunction?.toUpperCase();
  const extra = insideFunction && specialFunctions[insideFunction] ? getAllKeywordsForSpecialFunction(insideFunction) : [];
  if (requiresQuotingForCdl(id, extra))
    return apiDelimitedId(id);
  return id;
}

/**
 * Quote the given function name if required.
 *
 * NOTE: It is not guaranteed that the resulting string can _always_ be parsed!
 *       If `funcName` contains newline characters, the resulting delimited identifier
 *       will not be parsable by the compiler!
 *
 * @param {string} funcName
 * @return {string}
 */
function apiSmartFunctionId( funcName ) {
  const funcId = funcName.toUpperCase();
  const requiresQuoting = !undelimitedIdentifierRegex.test(funcName) ||
    (keywords.cdl.includes(funcId) && !specialFunctions[funcId]);
  if (requiresQuoting)
    return apiDelimitedId(funcName);
  return funcName;
}

/**
 * Render the CSN model 'model' to CDS source text.
 * Returned object has the following properties:
 *  - `model`: CSN model rendered as CDL (string).
 *  - `namespace`: Namespace statement + `using from './model.cds'.
 *
 * @param {CSN.Model} csn
 * @param {CdlOptions} options
 * @param {object} msg Message Functions
 */
function csnToCdl( csn, options, msg ) {
  const renderer = new CsnToCdl(csn, options, msg);
  return renderer.render();
}


module.exports = {
  csnToCdl,
  smartId: apiSmartId,
  smartFunctionId: apiSmartFunctionId,
  delimitedId: apiDelimitedId,
};
