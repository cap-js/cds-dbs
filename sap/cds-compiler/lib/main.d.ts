// Official cds-compiler API.
// All functions and namespace documented here are available when
// @sap/cds-compiler is required.
//
// These types are improved step by step and use a lot any types at the moment.

// Author's note: All "options" interfaces should actually be types.  However, due to
//                <https://github.com/TypeStrong/typedoc/issues/1519> we can't use
//                intersection types at the moment.

export = compiler;

declare namespace compiler {

  /**
   * Options used by the core compiler and all backends.
   */
  export interface Options {
    [option: string]: any,

    /**
     * Compiler and backend messages. Messages can be simple info messages but
     * also warnings and errors.  It is highly recommended to fix any warnings
     * and to not ignore them.
     * Errors stop the compilation process.
     */
    messages?: object[]
    /**
     * Dictionary of message-ids and their reclassified severity.  This option
     * can be used to increase the severity of messages.  The compiler may
     * ignore decreased severities of error messages as this may lead to issues
     * during compilation otherwise.
     */
    severities?: { [messageId: string]: MessageSeverity}
    /**
     * Dictionary of beta flag names.  This option allows fine-grained control
     * over which beta features should be enabled.
     * For a list of beta flag, please refer to `cdsc --help`.
     *
     * For backwards compatibility, this option may be `true` to indicate that
     * all beta features should be enabled.
     */
    beta?: { [betaFlag: string]: boolean } | boolean
    /**
     * If true, internal consistency checks are enabled and recompilation in
     * backends is disabled.
     *
     * @internal This is an internal option and should not be used by end-users.
     */
    testMode?: boolean
    /**
     * If true, CSN definitions are sorted by name.  Implicitly enabled when testMode is true.
     * `testMode` has higher priority, meaning if `testSortCsn` is `false` and `testMode` is true,
     * definitions will still be sorted.
     */
    testSortCsn?: boolean
    /**
     * A JS prototype that will be used for dictionaries created by the compiler.
     * Dictionaries are e.g. "definitions" and "elements".
     */
    dictionaryPrototype?: any
    /**
     * CSN Flavor:  The compiler supports different CSN flavors.  Backends may support
     * different flavors. This option is mainly used in `compile()`.
     * Flavors are:
     *  - client    : (default) Standard CSN consumable by clients and backends.
     *  - gensrc    : CSN specifically for use as a source, e.g. for combination with
     *                additional "extend" or "annotate" statements, but not suitable
     *                for consumption by clients or backends.
     *  - universal : In development (BETA)
     *
     * @default 'client'
     */
    csnFlavor?: string | 'client' | 'gensrc' | 'universal'
    /**
     * If set to false, backends will create localized convenience views for those views,
     * that only have an association to a localized entity/view.  If set to true, views will
     * only get a convenience view, if they themselves contain localized elements (i.e. either
     * have simple projection on localized elements and CDL-casts to a localized element).
     *
     * If true, the OData backend will not set `$localized: true` markers for such cases.
     *
     * Does not work for backends to.hdi(), to.hdbcds() or to.sql() with `sqlDialect: 'hana'`,
     * since in all those dialects, associations still exist in generated artifacts.
     *
     * @default true
     */
    fewerLocalizedViews?: boolean
  }

  /**
   * Options relevant for compilation and parsing of CDL and CSN files.
   */
  export interface CompileOptions extends Options {
    /**
     * If the given filename does not have a known file extension,
     * use this frontend as the fallback parser.
     */
    fallbackParser?: string | 'cdl' | 'csn'
    /**
     * Where to find `@sap/cds/` packages. This string, if set, is used as
     * the prefix for SAP CDS packages / CDS files.
     */
    cdsHome?: string
    /**
     * "Doc comments" (documentation comments) are those comments starting with `/**` in CDL
     * or the `doc` property in CSN.  This option is an _output_ option, which can have three
     * values:
     *
     *  - `true`:
     *     Doc comments will appear in the compiled CSN.  Basic sanity checks are performed:
     *     In CDL, if a doc comment appears at a not-defined position, where it has no impact,
     *     an info message is emitted.  For CSN input, it is checked that the `doc` property
     *     is a string or `null`.
     *
     *  - `false`:
     *    Doc comments will not be parsed for CDL, and will be stripped from input CSN,
     *    i.e. the compiled CSN (output) does not contain `doc` properties.  No checks
     *    are performed on doc comments.
     *
     *  - `undefined`:
     *    Doc comments are checked (see value `true`). For CDL, doc comments are not parsed,
     *    i.e. will not appear in the compiled CSN (output).
     *    For CSN input, all `doc` properties remain in the CSN.
     *
     * The CDL equivalent of the CSN value `doc: null`, is an empty doc comment.
     */
    docComment?: boolean
    /**
     * If this option is `true`, doc comments are propagated just like annotations.
     * If `false`, they won't be propagated at all.
     *
     * See option 'docComment'.
     *
     * Until @sap/cds-compiler v6.0, doc comments were always propagated.
     *
     * @default `false`
     * @since v6.0
     */
    propagateDocComments?: boolean
    /**
     * When set to `true`, and the model contains an entity `sap.common.Languages`
     * with an element `code`, all generated texts entities additionally contain
     * an element `language` which is an association to `sap.common.Languages`
     * using element `locale`.
     *
     * @since v2.8.0
     */
    addTextsLanguageAssoc?: boolean
    /**
     * An array of directory names that are used for CDS module lookups.
     * Lookup directory `node_modules/` is appended if not set explicitly.
     *
     * All directories in this array follow the same lookup-pattern as `node_modules/`.
     *
     * See <https://cap.cloud.sap/docs/cds/cdl#model-resolution>
     *
     * @since v4.2.0
     */
    moduleLookupDirectories?: string[]
    /**
     * Option for {@link compileSources}.  If set, all objects inside the
     * provided sources dictionary are interpreted as XSN structures instead
     * of CSN, i.e. a compiler-internal representation.
     *
     * @since v2.12.1
     */
    $xsnObjects?: boolean
    /**
     * If `true`, the CSN will have an enumerable property `$locations`.
     * with values for `line` and `col`, i.e. there is only a start position,
     * but no end position.
     *
     * If `false`, the property will be non-enumerable, i.e. it won't be
     * serialized when using `JSON.stringify()`.
     *
     * With value `"withEndPosition"`, the property will be enumerable and
     * will contain values for the end-position.  Other string values
     * are not allowed.  This value was introduced in v5.3.0.
     *
     * $location is not set on all artifacts, and it only indicates the position
     * of the _name_ of the artifact.
     */
    withLocations?: boolean|string
    /**
     * Use the new non-ANTLR based parser for compilation.
     *
     * @since v5.2.0
     * @default true (since v6.0)
     */
    newParser?: boolean
    /**
     * Internal option for LSP only!
     * If set, each AST gets a `tokenStream` property containing all lexed tokens.
     *
     * @private
     */
    attachTokens?: boolean
    /**
     * Internal option for LSP only!
     * If set, enables some extra checks/work for the CDS LSP.
     * May be implicitly set by `$lsp.<api>` functions.
     *
     * @private
     * @since v4.9
     */
    lspMode?: boolean
  }

  /**
   * Options used by OData backends.  Includes options for the OData
   * transformer as well as for rendering EDM and EDMX.
   */
  export interface ODataOptions extends Options {
    /**
     * OData version for output files.  Either 'v4' or 'v2'.
     *
     * @default 'v4'
     */
    odataVersion?: string | 'v4' | 'v2'
    /**
     * Whether to generate OData as flat or as structured.
     * Structured is only supported for OData v4.
     *
     * @default 'flat'
     */
    odataFormat?: string | 'flat' | 'structured'
    /**
     * Naming mode used by the corresponding SQL.
     *
     * @default 'plain'
     */
    sqlMapping?: string | 'plain' | 'quoted' | 'hdbcds'
    /**
     * If `true`, `cds.Compositions` are rendered as `edm:NavigationProperty` with the additional
     * attribute `ContainsTarget="true"` and all contained entities (composition targets) have no
     * `edm.EntitySet`.
     *
     * @note Only available for OData v4 EDM(X) rendering.
     * @default false
     */
    odataContainment?: boolean
    /**
     * If `true`, render generated foreign keys for managed associations.
     * By default foreign keys are never visible in structured OData APIs.
     *
     * @note Only available for structured OData v4 EDM(X) rendering.
     * @default false
     */
    odataForeignKeys?: boolean
    /**
     * If `true`, association targets outside of the current service are added as
     * `edm.EntityType` that only exposes their primary keys and have no `edm.EntitySet`.
     * If the original association target is a service member, a corresponding `edm.Schema`
     * representing the namespace of that service is added to `edm.Services`.  All association
     * targets that are no service members are collected in an `edm.Schema` with namespace `root`.
     *
     * @note Only valid for structured OData v4 EDM(X) rendering.
     * @default false
     * @since v2.1.0
     */
    odataProxies?: boolean
    /**
     * This option is an extension to `odataProxies`.
     * If `true`, an `edm:Reference` instead of a proxy `edm.EntityType` is rendered for each
     * association target that is a service member outside the current service instead of proxies.
     *
     * @note Only valid for structured OData v4 EDM(X) rendering.
     * @default false
     * @since v2.1.0
     */
    odataXServiceRefs?: boolean
    /**
     * The OData specification requires that all primary keys of the principal must be used as
     * referential constraints.  If an association is modelled with only a partial key, no
     * referential constraints are added.  If `true`, partial constraints are rendered for
     * backwards compatibility and mocking scenarios.  A spec violation warning is raised for
     * each incomplete constraint.
     *
     * @note Only valid for OData v2 CSN transformation.
     * @default false
     * @since v2.2.6
     */
    odataV2PartialConstr?: boolean
    /**
     * Service name for which EDMX or EDM shall be rendered.
     *
     * @note Only available for `to.edmx()` and `to.edm()`.  For `to.edmx.all()`
     *       and `to.edm.all()`, use `serviceNames` instead.
     *
     * @see serviceNames
     */
    service?: string
    /**
     * Array of service names for which EDMX or EDM shall be rendered.
     * If unspecified, all services are rendered.
     *
     * @note Only available for `to.edmx.all()` and `to.edm.all()`.  For `to.edmx()`
     *       and `to.edm()`, use `service` instead.
     *
     * @see service
     */
    serviceNames?: string[]
    /**
     * If set, certain OData errors that are not relevant for OpenAPI generation
     * are downgraded to warnings when generating EDM JSON.
     *
     * @default true
     * @since v4.8.0
     * @private
     */
    edm4OpenAPI?: boolean
  }

  /**
   * Options used by the `for.effective()` CSN transformation.
   *
   * @internal
   * @see _for.effective()
   */
  export interface EffectiveCsnOptions extends SqlOptions {
    /**
     * If true, resolve simple type references to their simple base type.
     *
     * @default true
     */
    resolveSimpleTypes?: boolean
    /**
     * If true, transform projections into ordinary views with SELECT.
     *
     * @default true
     */
    resolveProjections?: boolean
    /**
     * If true, remap OData annotations to ABAP annotations.
     *
     * @default false
     */
    remapOdataAnnotations?: boolean
    /**
     * If true, keep '.localized' property in the CSN.
     *
     * @default false
     */
    keepLocalized?: boolean
  }

  /**
   * Options used by SQL `to.sql()` backend.
   *
   * @see to.sql()
   */
  export interface SqlOptions extends Options {
    /**
     * The SQL naming mode decides how names are represented.
     * Among others, this includes whether identifiers are quoted or not (note
     * that "smart quoting" is handled by `sqlDialect`).
     *
     * - `plain`:
     *   In this naming mode, dots are replaced by underscores.
     *   Names are neither upper-cased nor quoted, unless "smart-quoting" is used.
     *   This mode can be used with all SQL dialects.
     * - `quoted`:
     *   In this mode, all identifiers are quoted.  Dots are not replaced in table
     *   and view names but are still replaced by underscores in element names.
     *   This mode can only be used with SQL dialect `hana`.
     * - `hdbcds`:
     *   This mode uses names that are compatible to SAP HANA CDS.
     *   In this mode, all identifiers are quoted.  Dots are neither replaced in table
     *   nor element names.  Namespace identifiers are separated from the remaining
     *   identifier by `::`, i.e. the dot is replaced.  For example `Ns.Books`
     *   becomes `"Ns::Books"`.
     *   This mode can only be used with SQL dialect `hana`.
     *
     * @default 'plain'
     */
    sqlMapping?: string | 'plain' | 'quoted' | 'hdbcds'
    /**
     * Use this option to specify what dialect of SQL you want.
     *
     * Different databases may support different feature sets of SQL.
     * For example, timestamps are handled differently.  Furthermore, "smart-quoting"
     * is enabled for all flavors except `plain`.  This is useful if identifiers
     * collide with reserved keywords.
     *
     * - `plain`:
     *   Use this option for best compatibility with standard SQL.
     *   Note that "smart-quoting" is not available for this mode.
     *   Requires `sqlMapping: 'plain'`.
     * - `sqlite`:
     *   This SQL dialect ensures compatibility with SQLite, which may not support
     *   all SQL features used in your CDS files.  For example, `$at.from`/`$at.to` are
     *   handled differently to ensure correctness for SQLite.  "smart-quoting"
     *   quotes identifiers that are reserved keywords, but does not upper-case them.
     *   Requires `sqlMapping: 'plain'`.
     * - `hana`:
     *   Use this SQL dialect for best compatibility with SAP HANA.
     *   "smart-quoting" upper-cases and quotes identifiers.
     * - `postgres:
     *   This SQL dialect ensures compatibility with PostgreSQL.
     *   Does not support `hana.*` types.  Requires `sqlMapping: 'plain'`.
     *   "smart-quoting" quotes identifiers that are reserved keywords, but does not upper-case them.
     *   Since v3.3.0
     * - `h2`
     *   This SQL dialect ensures compatibility with H2 v2.
     *   Does not support `hana.*` types.  Requires `sqlMapping: 'plain'`.
     *   "smart-quoting" quotes identifiers that are reserved keywords and upper-cases them.
     *   Since v3.4.0
     *
     * @default 'plain'
     */
    sqlDialect?: string | 'plain' | 'sqlite' | 'hana' | 'postgres' | 'h2'
    /**
     * Object containing magic variables.  These magic variables are
     * used as placeholder values.
     *
     * @since 2.11.0
     */
    variableReplacements?: {
      [option: string]: string | object,
      /**
       * Commonly used placeholders for user's name and locale.
       */
      $user?: {
        [option: string]: string | object,
        id?: string
        locale?: string
      },
      /**
       * Commonly used placeholders for session variables.
       */
      $session?: Record<string, string | object>
    }
    /**
     * If turned on, renders:
     *
     *  - `$user.‹id|locale›` as `session_context( '$user.‹id|locale›' )`
     *     instead of requiring them to be set in `sqlOptions.variableReplacements`, and
     *  - `$at.‹from|to›` and `$valid.‹from|to›` as `session_context( '$valid.‹from|to›' )`
     *     instead of using `strftime(…)`.
     *
     * `sqlOptions.variableReplacements` takes precedence for `$user`.  If `$user.id` is set,
     * the compiler will not render a `session_context(…)` function, even if this option is set.
     *
     * Only works with sqlDialect 'sqlite'! Otherwise, it has no effect.
     *
     * @since 3.9.0
     * @beta
     */
    betterSqliteSessionVariables?: boolean
    /**
     * If set, operator `!=` will be treated as a boolean-logic operator,
     * instead of a three-valued operator, by rendering it as `IS DISTINCT FROM`
     * on databases that support it, or an equivalent expression.
     *
     * Note, that if disabled:
     * - `!=`, is not translated and is hence treated as `<>`, meaning it uses
     *   three-valued logic, on databases that support it.
     * - `==` is still treated as two-valued logic operator.
     *
     * This option is the default since cds-compiler v6.
     *
     * @since 5.9.0
     * @default true (since v6.0)
     */
    booleanEquality?: boolean
    /**
     * If set to true, a specified set of functions - inspired by OData and SAP HANA -
     * are translated to database-specific variants.
     *
     * See <https://cap.cloud.sap/docs/guides/databases>
     *
     * @since 5.9.2
     * @default true (since v6.0)
     */
    standardDatabaseFunctions?: boolean
  }

  /**
   * Options used by to.hdbcds()
   */
  export interface HdbcdsOptions extends Options {
    /**
     * The SQL naming mode decides how names are represented.
     * Among others, this includes whether identifiers are quoted or not.
     *
     * - `plain`:
     *   In this naming mode, dots are replaced by underscores.
     *   Identifiers are always uppercased. If "smart-quoting" is used, they are also quoted
         if they are also HDBCDS keywords.
     * - `quoted`:
     *   In this mode, all identifiers are quoted.  Dots are not replaced in table
     *   and view names but are still replaced by underscores in element names.
     *   Identifier casing is kept as specified in the source.
     * - `hdbcds`:
     *   This mode uses names that are compatible to SAP HANA CDS.
     *   In this mode, all identifiers are quoted.  Dots are neither replaced in table
     *   nor element names: Structured elements persist, contexts are nested.
     *   Managed associations/compositions are left as-is.  No association-to-join-translation
     *   is done.
     *
     * @default 'plain'
     */
    sqlMapping?: string | 'plain' | 'quoted' | 'hdbcds'
    /**
     * For to.hdbcds(), the SQL dialect is always set to 'hana'.
     */
    sqlDialect?: 'hana'
  }

  /**
   * Options used by to.hdi() and to.hdi.migration()
   */
  export interface HdiOptions extends Options {
    /**
     * The SQL naming mode decides how names are represented.
     * Among others, this includes whether identifiers are quoted or not.
     *
     * - `plain`:
     *   In this naming mode, dots are replaced by underscores.
     *   Names are neither upper-cased nor quoted, unless "smart-quoting" is used.
     * - `quoted`:
     *   In this mode, all identifiers are quoted.  Dots are not replaced in table
     *   and view names but are still replaced by underscores in element names.
     * - `hdbcds`:
     *   This mode uses names that are compatible to SAP HANA CDS.
     *   In this mode, all identifiers are quoted.  Dots are neither replaced in table
     *   nor element names.  Namespace identifiers are separated from the remaining
     *   identifier by `::`, i.e. the dot is replaced.  For example `Ns.Books`
     *   becomes `"Ns::Books"`.
     *
     * @default 'plain'
     */
    sqlMapping?: string | 'plain' | 'quoted' | 'hdbcds'
    /**
     * For to.hdi(), the SQL dialect is always set to 'hana'.
     */
    sqlDialect?: 'hana'
    /**
     * Only for to.hdi.migration().
     * SQL change mode to use (for changed columns).
     *
     * @default 'alter'
     */
    sqlChangeMode?: string | 'alter' | 'drop'
    /**
     * Only for `to.hdi.migration`.  If `true`, `to.hdi.migration` allows that the two
     * passed CSNs are of different CSN versions.  Use at own risk.
     *
     * @default false
     */
    allowCsnDowngrade?: boolean
  }

  /**
   * Options used by `to.cdl()` backend.
   *
   * @note `to.cdl()` currently has no specific options.
   * @see to.cdl()
   */
  export interface CdlOptions extends Options {
    /**
     * If `true`, to.cdl() nests rendered definitions, e.g. all service/context entities
     * are nested inside a service/context definition.
     * This shortens definition names, as instead of `entity a.b.c.d.E {…}`,
     * a `service a.b.c.d {…}` with inner `entity E {…}` is rendered.
     * May introduce additional USING statements for paths that can't be reached
     * without one inside the current scope, e.g. when paths are shadowed in inner scopes.
     *
     * __Example__ (also using `renderCdlCommonNamespace: true`):
     *
     *   ```cds
     *   namespace S;
     *   using { S as S_ };
     *   entity Base {
     *     key id : String;
     *   };
     *   service S {
     *     entity Base as projection on S_.Base as Base;
     *   };
     *   ```
     *
     * If `false`, there is no nesting of definitions inside services or contexts.
     * All definitions are defined using their fully qualified path.
     *
     * __Example__:
     *
     *   ```cds
     *   entity S.Base {
     *     key id : String;
     *   };
     *   service S.S {};
     *   entity S.S.Base as projection on S.Base as Base;
     *   ```
     *
     * @default true (since v6)
     */
    renderCdlDefinitionNesting?: boolean
    /**
     * If `true`, `to.cdl()` tries to extract a common namespace that is then rendered
     * as a `namespace` statement.
     *
     * Only usable in combination with `renderCdlDefinitionNesting: true`.
     *
     * @default true (since v6)
     */
    renderCdlCommonNamespace?: boolean
  }

  /**
   * The compiler's package version.
   * For more details on versioning and SemVer, see `doc/Versioning.md`
   */
  export function version(): string;

  /**
   * Main function: Compile the sources from the files given by the array of
   * `filenames`.  As usual with the `fs` library, relative file names are
   * relative to the working directory `process.cwd()`.  With argument `dir`, the
   * file names are relative to `process.cwd()+dir` (or just `dir` if it is absolute).
   *
   * This function returns a Promise and can be used with `await`.  For an example
   * see `examples/api-usage/`.
   * See function {@link compileSync} or {@link compileSources} for alternative compile
   * functions.
   *
   * The promise is fulfilled if all files could be read and processed without
   * errors.  The fulfillment value is a CSN model.
   *
   * If there are errors, the promise is rejected.  If there was an invocation
   * error (repeated filenames or if the file could not be read), the rejection
   * value is an {@link InvocationError}.  Otherwise, the rejection value is a
   * {@link CompilationError} containing a vector of individual errors.
   *
   * @param filenames Array of files that should be compiled.
   * @param dir Working directory. Relative paths in `filenames` will be resolved relatively to this directory.
   * @param options  Compiler options. If you do not set `messages`, they will be printed to console.
   * @param fileCache
   */
  export function compile(filenames: string[], dir?: string, options?: CompileOptions, fileCache?: FileCache): Promise<CSN>;

  /**
   * Synchronous version of {@link compile}.
   * Usage is discouraged.  Use the asynchronous version if possible.
   *
   * @see compile
   */
  export function compileSync(filenames: string[], dir?: string, options?: CompileOptions, fileCache?: FileCache): CSN;

  /**
   * Synchronously compiles the given sources.
   *
   * Argument `sourcesDict` is a dictionary mapping filenames to either source texts (string)
   * or JavaScript objects, which are usually CSNs, or XSNs (compiler internal AST-like augmented CSNs).
   * The latter requires option `$xsnObjects` to be set to `true`.
   * It could also be a simple string, which is then considered to be the source
   * text of a file named `<stdin>.cds`.
   *
   * This function uses the direct value of USINGs (in CSN `"requires"`) for its dependency graph,
   * i.e. this function does not resolve USINGs.  If a USING matches a key in sourcesDict,
   * we assume that it depends on that file (/sourcesDict entry).
   *
   * See function {@link compile} for the meaning of the argument `options`.  If there
   * are parse or other compilation errors, throws an exception {@link CompilationError}
   * containing a list of individual errors.
   */
  export function compileSources(sourcesDict: Record<string, string|object> | string, options?: CompileOptions): CSN;

  /**
   * In version 2 of cds-compiler, this is an identity function and
   * is only kept for backwards compatibility.
   *
   * @deprecated
   * @returns The input parameter "csn".
   */
  export function compactModel(csn: CSN): CSN;

  /**
   * Exception thrown by the compiler if errors are encountered.
   *
   * Note that compiler functions (e.g. renderers) may not always throw if errors are encountered.
   * You always need to check the option's `messages` array for a {@link CompileMessage} of severity 'Error'.
   */
  export class CompilationError extends Error {
      constructor(messages: CompileMessage[], model?: any, text?: string, ...args: any[]);
      /**
       * String to identify this class. Can be used instead of relying on `instanceof`.
       * Always `ERR_CDS_COMPILATION_FAILURE`.
       * @since v4.0.0
       */
      code: string;
      messages: CompileMessage[];
      toString(): string;
      /**
       * If `options.attachValidNames` is set, this non-enumerable property holds the CSN model.
       * @internal
       */
      model?: CSN;
  }

  /**
   * Exception thrown by the compiler if {@link compile} and its variants are invoked incorrectly.
   * For example, this error is thrown if the same file is passed to {@link compile} twice.
   */
  export class InvocationError extends Error {
    constructor(errs: any, ...args: any[]);
    errors: any[]
  }

  /**
   * Sort the given messages according to their location.  Messages are sorted
   * in ascending order according to their:
   *
   *  - file name
   *  - start line
   *  - start column
   *  - end line
   *  - end column
   *  - semantic location (“home”)
   *  - message text
   *
   * If both messages do not have a location, they are sorted by their semantic
   * location and then by their message text.  If only one message has a file
   * location, that message is sorted prior to those that don't have one.
   *
   * _Note_: Sorting is done in-place.
   *
   * Example of sorted messages:
   * ```
   * A.cds:1:11: Info    id-3: First message text   (in entity:“E”/element:“c”)
   * A.cds:8:11: Error   id-5: Another message text (in entity:“C”/element:“g”)
   * B.cds:3:10: Debug   id-7: First message text   (in entity:“B”/element:“e”)
   * B.cds:3:12: Warning id-4: Message text         (in entity:“B”/element:“d”)
   * B.cds:3:12: Error   id-4: Message text         (in entity:“B”/element:“e”)
   * ```
   *
   * If you also want to sort according to message's severity,
   * see {@link sortMessagesSeverityAware}.
   *
   * @returns The same messages array as the input parameter.
   */
  export function sortMessages(messages: CompileMessage[]): CompileMessage[];

  /**
   * Sort the given messages in severity aware order.  Messages are sorted first
   * by severity where 'Error' comes first, then 'Warning' and so forth.
   * Messages of the same severity are sorted the same as by {@link sortMessages}.
   *
   * _Note_: Sorting is done in-place.
   *
   * @returns The same messages array as the input parameter.
   */
  export function sortMessagesSeverityAware(messages: CompileMessage[]): CompileMessage[];

  /**
   * Removes duplicate messages from the given messages array without destroying
   * references to the array, i.e. removes them in-place.
   *
   * _Note_: Does NOT keep the original order!
   *
   * Two messages are the same if they have the same message hash (see below).
   * If one of the two is more precise, then it replaces the other.
   * A message is more precise if it is contained in the other or if
   * the first does not have an `endLine`/`endCol`.
   *
   * A “message hash” is the string representation of the message.  If the
   * message does not have a semantic location (“home”), the message hash
   * is the result of {@link messageString}.  If the message has a semantic
   * location, the file location is stripped before being passed to
   * {@link messageString}.
   */
  export function deduplicateMessages(messages: CompileMessage[]): void;

  /**
   * Returns a message string with file- and semantic location if present in compact
   * form (i.e. one line).
   *
   * Example:
   * ```
   * <source>.cds:3:11: Error message-id: Can't find type `nu` in this scope (in entity:“E”/element:“e”)
   * ```
   *
   * @param msg               Compiler message which shall be stringified.
   * @param normalizeFilename If true, the file path will be normalized to use `/` as the path separator.
   * @param noMessageId       If true, the message ID will _not_ be part of the string.
   * @param noHome            If true, the semantic location will _not_ be part of the string.
   *
   * @deprecated Use messageString(msg, config) instead.
   */
  export function messageString(msg: CompileMessage, normalizeFilename?: boolean, noMessageId?: boolean, noHome?: boolean): string;

  /**
   * Returns a message string with file- and semantic location if present in compact
   * form (i.e. one line).
   *
   * Example:
   * ```
   * <source>.cds:3:11: Error message-id: Can't find type `nu` in this scope (in entity:“E”/element:“e”)
   * ```
   *
   * Example Usage:
   *   ```js
   *   const config = { normalizeFilename: false, noMessageId: true };
   *   console.log(messages.map(msg => compiler.messageString(msg, config)));
   *   ```
   *
   * @param config.normalizeFilename
   *     If true, the file path will be normalized to use `/` as the path separator (instead of `\` on Windows).
   *
   * @param config.noMessageId
   *     If true, will _not_ show the message ID (+ explanation hint) in the output.
   *
   * @param config.noHome
   *     If true, will _not_ show message's semantic location.
   *
   * @param config.moduleForMarker
   *     If set, downgradable error messages will get a '‹↓›' marker, depending on whether
   *     the message can be downgraded for the given module.  A `‹↑›` is used if the message
   *     will be an error in the next major cds-compiler release.
   *     Was called `module` in v4.8.0 and earlier.
   */
  export function messageString(msg: CompileMessage, config?: {
    normalizeFilename?: boolean
    noMessageId?: boolean
    noHome?: boolean
    module?: string
  }): string;

  /**
   * Returns a message string with file- and semantic location if present in multiline form
   * with a source code snippet below that has highlights for the message's location.
   * The message (+ message id) are colored according to their severity.
   *
   * IMPORTANT: Argument `config` should be re-used by subsequent calls to this function,
   *            because it caches argument `config.sourceLineMap`.
   *
   * Example Output:
   *   ```
   *   Error[message-id]: Can't find type `nu` in this scope
   *      |
   *     <source>.cds:3:10, at entity:“E”/element:“e”
   *      |
   *    3 |       e : nu;
   *      |           ^^
   *  ```
   *
   * Example Usage:
   *   ```js
   *   const config = { sourceMap: fileCache, cwd: '' };
   *   console.log(messages.map(msg => compiler.messageStringMultiline(msg, config)));
   *   ```
   *
   * @param config.normalizeFilename
   *     If true, the file path will be normalized to use `/` as the path separator (instead of `\` on Windows).
   *
   * @param config.noMessageId
   *     If true, will _not_ show the message ID (+ explanation hint) in the output.
   *
   * @param config.hintExplanation
   *     If true, messages with explanations will get a "…" marker, see {@link hasMessageExplanation}.
   *
   * @param config.moduleForMarker
   *     If set, downgradable error messages will get a '‹↓›' marker, depending on whether
   *     the message can be downgraded for the given module.  A `‹↑›` is used if the message
   *     will be an error in the next major cds-compiler release.
   *     Was called `module` in v4.8.0 and earlier.
   *
   * @param config.sourceMap
   *     A dictionary of filename<->source-code entries.  You can pass the fileCache that is used
   *     by the compiler.
   *
   * @param config.sourceLineMap
   *     A dictionary of filename<->source-newline-indices entries. Is used to extract source code
   *     snippets for message locations.  If not set, will be set and filled by this function on-demand.
   *     An entry is an array of character/byte offsets to new-lines, for example sourceLineMap[1] is the
   *     end-newline for the second line.
   *
   * @param config.cwd
   *     The current working directory (cwd) that was passed to the compiler.
   *     This value is only used if a source map is provided and relative paths needs to be
   *     resolved to absolute ones.
   *
   * @param config.color
   *     If true/'always', ANSI escape codes will be used for coloring the severity.  If false/'never',
   *     no coloring will be used.  If 'auto', we will decide based on certain factors such
   *     as whether the shell is a TTY and whether the environment variable `NO_COLOR` is
   *     unset.
   */
  export function messageStringMultiline(msg: CompileMessage, config?: {
    normalizeFilename?: boolean
    noMessageId?: boolean
    hintExplanation?: boolean
    moduleForMarker?: string
    sourceMap?: Record<string, string>
    sourceLineMap?: Record<string, number[]>
    cwd?: string
    color?: boolean | 'auto' | 'always' | 'never'
  }): string;

  /**
   * Returns a context (code) string for the given message that is human readable.
   *
   * The message context can be used to indicate to users where an error occurred.
   * The line length is limited to 100 characters.  If the message spans more than three
   * lines, only the first three lines are printed and an ellipsis will be appended in the next line.
   * If only one line is to be shown, the affected columns will be highlighted by a caret (`^`).
   * All lines are prepended by a pipe (`|`) and show the corresponding line number.
   *
   * Example Output:
   * ```
   *     |
   *  13 |     num * nu
   *     |           ^^
   * ```
   *
   * @param sourceLines  The source code split up into lines, e.g. by `str.split(/\r\n?|\n/);`.
   * @param msg          Message whose location is used to print the message context.
   * @param config       Configuration for the message context.
   * @param config.color If true, ANSI escape codes will be used for coloring the severity.  If false, no
   *                     coloring will be used.  If 'auto', we will decide based on certain factors such
   *                     as whether the shell is a TTY and whether the environment variable `NO_COLOR` is
   *                     unset.
   *
   * @deprecated Use {@link messageStringMultiline} with `config.sourceMap` and `config.sourceLineMap` instead!
   */
  export function messageContext(sourceLines: string[], msg: CompileMessage, config?: {
    color?: boolean | 'auto'
  }): string;

  /**
   * Get an explanatory text for a complicated compiler message with ID
   * messageId.  This function does a file lookup in `share/messages`.
   * If the message explanation does not exist, an exception is thrown.
   *
   * @throws May throw an ENOENT error if the message explanation cannot be found.
   * @see hasMessageExplanation
   */
  export function explainMessage(messageId: string): string;
  /**
   * Returns `true` if the given messageId has an explanatory text.
   * Contrary to {@link explainMessage}, this function does not do
   * any file lookup.
   */
  export function hasMessageExplanation(messageId: string): boolean;

  /**
   * Returns true if at least one of the given messages is of severity "Error".
   */
  export function hasErrors(messages: CompileMessage[]): boolean;

  export namespace parse {
      /**
       * Parse the given CDL in parseCdl mode and return its corresponding CSN representation.
       *
       * @param cdl      CDL source as string.
       * @param filename Filename to be used in compiler messages.
       * @param options  Compiler options. Note that if `options.messages` is not set, messages will be printed to stderr.
       */
      function cdl(cdl: string, filename: string, options?: Options): CSN;

      /**
       * Parse the given CQL and return its corresponding CQN representation.
       *
       * @param cdl      CDL source as string.
       * @param filename Filename to be used in compiler messages, default is '<query>.cds'
       * @param options  Compiler options. Note that if `options.messages` is not set, messages will be printed to stderr.
       * @returns Returns the CSN representation of the expression, i.e. CDS Query Notation.
       */
      function cql(cdl: string, filename?: string, options?: Options): CQN;

      /**
       * Parse the given CDL expression and return its corresponding CXN representation.
       *
       * @param cdl      CDL source as string.
       * @param filename Filename to be used in compiler messages, default is '<expr>.cds'
       * @param options  Compiler options. Note that if `options.messages` is not set, messages will be printed to stderr.
       * @returns Returns the CSN representation of the expression, i.e. CDS Expression Notation.
       */
      function expr(cdl: string, filename?: string, options?: Options): CXN;
  }

  /**
   * @note Actual name is "for" which can't be used directly in the documentation
   *       as it is a reserved name in TypeScript.
   *
   * @see for
   */
  export namespace _for {
    /**
     * Transform the given (inferred/client) CSN into one that is used for OData.
     * Changes include flattening, type resolution and more, according to
     * the provided options.
     */
    function odata(csn: CSN, options?: ODataOptions): CSN;
    /**
     * Transform the given CSN into one that has these properties:
     *  - types are resolved
     *  - elements are flattened
     *  - …
     *
     * THIS IS HIGHLY EXPERIMENTAL
     *
     * Beta flag `effectiveCsn` is required.
     *
     * @internal
     */
    function effective(csn: CSN, options?: EffectiveCsnOptions): CSN;
    /**
     * Transform the given CSN into one that has the properties required for SEAL
     *
     * @internal
     */
    function seal(csn: CSN, options?: EffectiveCsnOptions): CSN;
    /**
     * Transform the given (inferred/client) CSN into one that is used by the
     * CAP Java runtime.  The CSN is structured.
     * Changes include draft handling and the tenant discriminator if requested.
     *
     * @internal
     */
    function java(csn: CSN, options?: ODataOptions): CSN;
  }

  export { _for as for };

  export namespace to {
    /**
     * Renders the given CSN into a CDL source representation.
     *
     * The CDL string representation may change between minor @sap/cds-compiler
     * versions, but when compiled, will return the same CSN again.
     * Hence, stylistic changes such as additional whitespace is not considered
     * a breaking change.
     *
     * @returns Object containing the rendered model.
     */
    function cdl(csn: CSN, options?: CdlOptions): CdlResult;
    namespace cdl {
      /**
       * Immutable list of reserved keywords in CDL.
       * These keywords are used for automatic quoting in {@link to.cdl}.
       */
      const keywords: string[];
      /**
       * Immutable list of CDL functions, used for automatic quoting in {@link to.cdl}.
       * Only relevant for element references of path length 1.
       */
      const functions: string[];

      /**
       * If the given `name` requires brackets in SQL, return an escaped
       * identifier in brackets.
       * Otherwise, return the name without brackets.
       *
       * NOTE: If `name` contains newline characters, the resulting delimited identifier
       *       will not be parsable by the compiler!
       *
       * Example:
       *    ```js
       *    to.cdl.smartId('with ![brackets]')
       *    // '![with ![brackets]]]'
       *    to.cdl.smartId('OCCURRENCE', null)
       *    // 'OCCURRENCE'
       *    to.cdl.smartId('OCCURRENCE', 'REPLACE_REGEXPR')
       *    // '![OCCURRENCE]'
       *    to.cdl.smartId('myId')
       *    // 'myId'
       *    ```
       *
       * @param name
       * @param [insideFunction=null]
       *     Inside special functions such as SAP HANA's `OCCURRENCES_REGEXPR`, there are more
       *     keywords than in other places.  Set this value to a function name, if you want to
       *     handle those additional keywords as well.
       */
      function smartId(name: string, insideFunction?: string|null) : string;
      /**
       * If the given function `name` requires quoting in CDL, return an escaped
       * function identifier in brackets for CDL.
       * Otherwise, return the function name without brackets.
       *
       * NOTE: If `name` contains newline characters, the resulting delimited identifier
       *       will not be parsable by the compiler!
       *
       * Example:
       *    ```js
       *    to.cdl.smartFunctionId('with ![brackets]')
       *    // '![with ![brackets]]]'
       *    to.cdl.smartFunctionId('myFunction')
       *    // 'myFunction'
       *    ```
       *
       * @param name
       */
      function smartFunctionId(name: string) : string;
      /**
       * Escapes the given name according to the CDL language and puts it
       * into `![` and `]`, properly escaping all `]` in the identifier.
       *
       * NOTE: If `name` contains newline characters, the resulting delimited identifier
       *       will not be parsable by the compiler!
       *
       * Example:
       *    ```js
       *    to.cdl.delimitedId('with ![brackets]')
       *    // '![with ![brackets]]]'
       *    to.cdl.delimitedId('myId')
       *    // '![myId]'
       *    ```
       *
       * @param name
       */
      function delimitedId(name: string) : string;
    }

    /**
     * Renders the given CSN into SQL statements such as `CREATE TABLE`, `CREATE VIEW`, etc.
     *
     * @returns Array of SQL statements as strings, tables first, views second and optionally table constraints last.
     */
    function sql(csn: CSN, options?: SqlOptions): string[];
    namespace sql {
      namespace sqlite {
        /**
         * Immutable list of reserved keywords for SQLite. The list is used by {@link to.sql}.
         * Taken from <http://www.sqlite.org/draft/lang_keywords.html>.
         */
        const keywords: string[];
      }
      namespace h2 {
        /**
         * Immutable list of reserved keywords for H2. The list is used by {@link to.sql}.
         * Taken from <http://www.h2database.com/html/advanced.html#keywords>.
         */
        const keywords: string[];
      }
      namespace postgres {
        /**
         * Immutable list of reserved keywords for PostgreSQL. The list is used by {@link to.sql}.
         * Taken from <https://www.postgresql.org/docs/current/sql-keywords-appendix.html>.
         */
        const keywords: string[];
      }

      /**
       * If the given `name` requires quoting for SQL dialect `dialect`,
       * returns a quoted and escaped identifier for that SQL dialect.
       * Otherwise, returns the name without quotes.
       *
       * Example:
       *    ```js
       *    to.sql.smartId('with "quotes"', 'sqlite')
       *    // '"with ""quotes"""'
       *    to.sql.smartId('SELECT', 'sqlite')
       *    // '"SELECT"'
       *    to.sql.smartId('myId', 'sqlite')
       *    // 'myId'
       *    ```
       *
       * @param name
       * @param dialect
       */
      function smartId(name: string, dialect: string) : string;
      /**
       * If the given function `name` requires quoting for SQL dialect `dialect`,
       * returns a quoted and escaped function identifier for that SQL dialect.
       * Otherwise, returns the function name without quotes.
       *
       * Example:
       *    ```js
       *    to.sql.smartFunctionId('with "quotes"', 'sqlite')
       *    // '"with ""quotes"""'
       *    to.sql.smartFunctionId('myFunction', 'sqlite')
       *    // 'myFunction'
       *    ```
       *
       * @param name
       * @param dialect
       */
      function smartFunctionId(name: string, dialect: string) : string;
      /**
       * Escapes the given name according to the SQL dialect and puts it
       * into quotes.
       *
       * Example:
       *    ```js
       *    to.sql.delimitedId('with "quotes"', 'sqlite')
       *    // '"with ""quotes"""'
       *    to.sql.delimitedId('myId', 'sqlite')
       *    // '"myId"'
       *    ```
       *
       * @param name
       * @param dialect
       */
      function delimitedId(name: string, dialect: string) : string;

      /**
       * Return all non-lossy changes in artifacts between two given models.
       * Note: Only supports changes in artifacts compiled/rendered as db-CSN/SQL.
       *
       * ATTENTION: This function may change without prior notice!
       *            It is still considered work-in-progress!
       *
       * @beta
       *
       * @param csn          A client/inferred CSN model representing the desired "after-image"
       * @param options      SQL specific options
       * @param beforeImage  A db-transformed CSN representing the "before-image", or null in case no such image
       *                     is known, i.e. for the very first migration step.
       * @returns See {@link SqlMigrationResult} for details.
       */
      function migration(csn: CSN, options: SqlOptions, beforeImage: CSN): SqlMigrationResult;
    }

    /**
     * Renders the given CSN into EDM in the JSON format _and_ XML format.
     * That is, it is a combination of `to.edm()` and `to.edmx()`.
     * Requires `options.service` to be set.
     *
     * Not to be confused with `for.odata()`, which returns an OData transformed CSN.
     *
     * @returns An object `'<protocol>': object` where the value is `'<serviceName>': object` entry
     *          which consists of `{edmx: string, edm?: object}`.
     * @since v4.6.0
     */
    function odata(csn: CSN, options?: ODataOptions): Record<string, object>;
    namespace odata {
      /**
       * Renders the given CSN into EDM in JSON format _and_ XML format for each service.
       * That is, it is a combination of `to.edm.all()` and `to.edmx.all()`.
       * If `options.serviceNames` is not set, all services will be rendered.
       *
       * @returns A map of `'<protocol>': object` where each entry is `'<serviceName>': object` entries where
       *          each entry consists of `{edmx: string, edm?: object}`.
       * @since v4.6.0
       */
      function all(csn: CSN, options: ODataOptions): Record<string, object>;
    }

    /**
     * Renders the given CSN into EDM (JSON format).  Requires `options.service` to be set.
     *
     * @returns Rendered EDM as JSON structure.
     */
    function edm(csn: CSN, options?: ODataOptions): object;
    namespace edm {
      /**
       * Renders the given CSN into EDM (JSON format) for each service.
       * If `options.serviceNames` is not set, all services will be rendered.
       *
       * @returns A map of `{ '<serviceName>': object }` entries.
       */
      function all(csn: CSN, options: ODataOptions): Record<string, object>;
    }

    /**
     * Renders the given CSN into EDMX.  Requires `options.service` to be set.
     *
     * @returns Rendered EDMX as string.
     */
    function edmx(csn: CSN, options: ODataOptions): string;
    namespace edmx {
      /**
       * Renders the given CSN into EDMX for each service.
       * If `options.serviceNames` is not set, all services will be rendered.
       *
       * @returns A map of `{ '<serviceName>': '<xml>' }` entries.
       */
      function all(csn: CSN, options?: ODataOptions): Record<string, string>;
    }

    /**
     * Renders the given CSN into HDBCDS artifacts.
     *
     * DEPRECATED! This backend is deprecated and will be removed with cds-compiler v7!
     *
     * @deprecated
     * @returns A map of `{ '<artifactName>.hdbcds|hdbconstraint>': '<content>' }` entries.
     */
    function hdbcds(csn: CSN, options?: HdbcdsOptions): Record<string, string>;
    namespace hdbcds {
      /**
       * Immutable list of SAP HANA CDS keywords, used for smart quoting in
       * {@link to.hdbcds} with option `sqlMapping: 'plain'`.
       *
       * @deprecated
       */
      const keywords: string[];
    }

    /**
     * Renders the given CSN into HDI statements such as `COLUMN TABLE`, `VIEW`, etc.
     *
     * @returns A map of `{ '<artifactName>.hdbtable|hdbview|hdbconstraint>': '<content>' }` entries.
     */
    function hdi(csn: CSN, options?: HdiOptions): Record<string, string>;
    namespace hdi {
      /**
       * Immutable list of SAP HANA keywords, used for smart quoting in
       * {@link to.hdi} with option `sqlMapping: 'plain'`.
       * Taken from <https://help.sap.com/viewer/7c78579ce9b14a669c1f3295b0d8ca16/Cloud/en-US/28bcd6af3eb6437892719f7c27a8a285.html>.
       */
      const keywords: string[];

      /**
       * Return all changes in artifacts between two given models.
       * Note: Only supports changes in entities (not views etc.) compiled/rendered as HANA-CSN/SQL.
       *
       * @param csn          A client/inferred CSN model representing the desired "after-image"
       * @param options      Options
       * @param beforeImage  A SAP HANA-transformed CSN representing the "before-image", or null in case
       *                     no such image is known, i.e. for the very first migration step.
       * @returns See {@link HdiMigrationResult} for details.
       */
      function migration(csn: CSN, options: HdiOptions, beforeImage: CSN): HdiMigrationResult;
    }
  }

  /**
   * Result of the `to.cdl()` renderer.
   */
  export type CdlResult = {
    /**
     * Rendered model, including extensions.
     */
    model?: string
  }

  /**
   * Result type of {@link to.hdi.migration}.
   */
  export type HdiMigrationResult = {
    /**
     * The desired after-image in HANA-CSN format
     */
    afterImage: CSN
    /**
     * An array of objects with all artifacts in the after-image.  Each object specifies
     * the artifact filename, the suffix, and the corresponding SQL statement to create
     * the artifact.
     */
    definitions: object[],
    /**
     * An array of objects with the deleted artifacts.  Each object specifies the artifact
     * filename and the suffix.
     */
    deletions: object[],
    /**
     * An array of objects with the changed (migrated) artifacts.  Each object specifies the
     * artifact filename, the suffix, and the changeset (an array of changes, each specifying
     * whether it incurs potential data loss, and its respective SQL statement(s), with
     * multiple statements concatenated as a multi-line string in case the change e.g.
     * consists of a column drop and add).
     */
    migrations: Array<{
      name: string
      suffix: string
      changeset: object[]
    }>,
  }

  /**
   * Result type of {@link to.sql.migration}.
   *
   * ATTENTION: This structure may change without prior notice!
   *            It is still considered work-in-progress!
   *
   * @beta
   */
  export type SqlMigrationResult = {
    /**
     * The desired after-image in db-transformed CSN format
     */
    afterImage: CSN
    /**
     * An array of SQL statements to drop views/tables.
     */
    drops: string[],
    /**
     * An array of SQL statements to ALTER/CREATE tables/views.
     */
    createsAndAlters: string[],
  }

  /**
   * Return the resulting database name for (absolute) 'artifactName', depending on the current naming
   * mode.
   *
   * - For the 'hdbcds' naming mode, this means converting `.` to `::` on
   *   the border between namespace and top-level artifact and correctly replacing some `.` with `_`.
   * - For the 'plain' naming mode, it means converting all `.` to `_` and upper-casing.
   * - For the 'quoted' naming mode, this means correctly replacing some `.` with `_`.
   *
   * The above rules might differ for different SQL dialects.
   * Exceptions will be listed below.
   *
   * @param artifactName The fully qualified name of the artifact
   * @param sqlMapping The naming mode to use. See {@link SqlOptions.sqlMapping} for more details.
   * @param csn
   * @param sqlDialect The SQL dialect to use. See {@link SqlOptions.sqlDialect} for more details.
   * @returns {string} The resulting database name for (absolute) 'artifactName', depending on the current naming mode.
   * @since v2.1.0
   */
  export function getArtifactCdsPersistenceName(artifactName: string, sqlMapping: string, csn: CSN, sqlDialect: string): string;
  /**
   *  Return the resulting database element name for `elemName`, depending on the current
   *  naming mode.
   *  - For the 'hdbcds' naming mode, this is just 'elemName'.
   *  - For the 'plain' naming mode, it means converting all `.` to `_` and upper-casing.
   *  - For the 'quoted' naming mode, it means converting all `.` to `_`.
   *  No other naming modes are accepted!
   *
   * The above rules might differ for different SQL dialects.
   * Exceptions will be listed below.
   *
   * @param elemName The name of the element. For structured elements, concat by dot, e.g. `sub.elem`.
   * @param sqlMapping The naming mode to use. See {@link SqlOptions.sqlMapping} for more details.
   * @param sqlDialect The SQL dialect to use. See {@link SqlOptions.sqlDialect} for more details.
   * @returns The resulting database element name for 'elemName', depending on the current naming mode.
   */
  export function getElementCdsPersistenceName(elemName: string, sqlMapping: string, sqlDialect: string): string;

  /**
   * Traverse the CSN node `csn`.
   *
   * If `csn` is an array, call it recursively on each array item.
   * If `csn` is an(other) object, call a function on each property:
   * - The property name is a used as key in argument `userFunctions` and the
   *   constant `defaultFunctions` above to get the function which is called on
   *   the property value, see `defaultFunctions` for details.
   * - If no function is found with the property name, try to find one with the
   *   first char, which is useful for annotations.
   * - If still not found, call `traverseCsn` recursively.
   *
   * The functions in `userFunctions` are usually transformer functions, which
   * change the input CSN destructively.
   */
  export function traverseCsn(userFunctions: Record<string, TraverseCsnCallback>, csn: object|any[]): void;
  export type TraverseCsnCallback = (
    userFunctions: Record<string, TraverseCsnCallback>,
    value: any,
    csn: any,
    prop: string
  ) => any;

  /**
   * CSN Model related functions.
   */
  export namespace model {
    /**
     * Returns true if the given definition name is in a reserved namespace such as `cds.*`
     * but not `cds.foundation.*`.
     *
     * @param definitionName Top-level definition name of the artifact.
     * @since v2.14.0
     */
    function isInReservedNamespace(definitionName: string): boolean;
  }

  /**
   * @private
   */
  export namespace $lsp {
    /**
     * Compiler internal notation.
     * @private
     */
    type XSN = any;
    /**
     * Compile the given files with the given options.  The return object uses an internal object
     * format that must not be used outside of the cds-lsp.
     * Respects the value of `options.fallbackParser`.
     *
     * @param filenames Array of files that should be compiled.
     * @param dir Working directory. Relative paths in `filenames` will be resolved relatively to this directory.
     * @param options Compiler options. If you do not set `messages`, they will be printed to console.
     * @param fileCache
     * @private
     */
    function compile(filenames: string[], dir?: string, options?: CompileOptions, fileCache?: FileCache): Promise<XSN>;
    /**
     * Parse the given source with the correct parser based on the file name's
     * extension. For example uses CDL parser for `.cds` files.
     * Respects the value of `options.fallbackParser`.
     *
     * @param {string} source Source code of the file.
     * @param {string} filename Filename including its extension, e.g. "file.cds"
     * @param {object} options Compile options
     * @param {object} messageFunctions If not provided, parse errors will not lead to an exception
     * @private
     */
    function parse(source: string, filename: string, options?: CompileOptions, messageFunctions?: object): XSN;
    /**
     * Get the name of the given artifact.  This function is internal and does not work with CSN.
     * It should be used to retrieve an artifact's name instead of relying on `artifact.name`
     * as that object may be modified in the future.
     *
     * @private
     */
    function getArtifactName(artifact: object): object;

    type LspSemanticTokenEvent = {
      event: 'reference' | 'definition',
      semanticToken: object,
      hint?: string
      node?: object
    }
    /**
     * Traverse the given XSN model and yield all _semantic tokens_ that are required by
     * the LSP.  These semantic tokens mostly include _identifiers_, that is, references
     * or definitions.  They also include the `returns` structure, as it is an annotation
     * target as well.
     */
    function traverseSemanticTokens(xsn: object, options: CompileOptions): Generator<LspSemanticTokenEvent>;
    /**
     * Given an XSN reference object, e.g. the `semanticToken` value of a `traverseSemanticTokens`
     * event, return a generator that yields the reference's target and their origins until the
     * base definition is reached.
     */
    function getSemanticTokenOrigin(obj: LspSemanticTokenEvent): Generator<object>;
  }

  /**
   * CDS Schema Notation. Not yet specified in this TypeScript declaration file.
   * See <https://cap.cloud.sap/docs/cds/csn> for more.
   */
  export type CSN = any;

  /**
   * CDS Query Notation. Not yet specified in this TypeScript declaration file.
   * See <https://cap.cloud.sap/docs/cds/cqn> for more.
   */
  export type CQN = any;

  /**
   * CDS Expression Notation. Not yet specified in this TypeScript declaration file.
   * See <https://cap.cloud.sap/docs/cds/cxn> for more.
   */
  export type CXN = any;

  export class CompileMessage {
    constructor(location: Location, msg: string, severity?: MessageSeverity, id?: string | null, home?: string | null, moduleName?: string | null);
    /**
     * Optional ID of the message.  Can be used to reclassify messages.
     *
     * @note This property is non-enumerable as message IDs are not finalized, yet.
     */
    messageId?: string

    severity: MessageSeverity

    /**
     * Location information like file and line/column of the message.
     */
    $location: Location & {
      address?: {
        /**
         * Fully qualified name of the affected definition.
         */
        definition?: string
      }
    }
    /**
     * String representation of the message.  It may be a multi-line message in the future.
     */
    message: string
    /**
     * A string describing the path to the artifact, e.g. `entity:"E"/element:"x"`.
     */
    home?: string
    /**
     * Array of names that are valid at the specified position.
     * Contains values if the message describes an "artifact not found" message.
     *
     * @internal Only to be used by the LSP implementation for CDS.
     */
    validNames: string[] | null
    /**
     * If `internalMsg` is set, then this property will have an error object with a stack trace.
     */
    error?: Error
    /**
     * Returns a human-readable string of the compiler message.  Uses {@link messageString} to render
     * the message without filename normalization and without a message ID.
     */
    toString(): string;
  }

  /**
   * Severities a compiler message can have.
   */
  export type MessageSeverity = string | 'Error' | 'Warning' | 'Info' | 'Debug';

  /**
   * CSN Location, often exposed by `$location` in CSN.
   * Columns and lines are 1-based, i.e. value `0` is an invalid value and
   * indicates absence of the property.
   *
   * Note that the columns are UTF-16 _code unit_ offsets in a line.
   * A column is neither the number of _graphemes_ nor _code points_!
   *
   * All properties are optional, even `file`.
   */
  export type Location = {
    file?:    string
    line?:    number
    col?:     number
    endLine?: number
    endCol?:  number
  }

  /**
   * File cache for compile() functions.
   * This cache is a dictionary of absolute file names to the file content with values:
   *  - `false`: the file does not exist
   *  - `true`: file exists (fstat), no further knowledge yet - i.e. value will change!
   *  - `string` or `Buffer`: the file content
   *  - `{ realname: fs.realpath.native(filename) }`: if filename is not canonicalized
   */
  export type FileCache = Record<string, boolean | string | Buffer | { realname: string }>;

}
