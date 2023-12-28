// Note: This is only picked up if "csn" comes before "node" in
//       tsconfig.json -> compilerOptions -> types.
declare const global: NodeJS.Global & typeof globalThis &
{
  cds?: {
    home?: string
  }
};

{
  // Can't use top-level import, due to:
  //  - <https://github.com/Microsoft/TypeScript/wiki/FAQ#why-did-adding-an-import-or-export-modifier-break-my-program>
  //  - <https://github.com/microsoft/TypeScript/issues/8004>
  // We also can't use '*' and instead have to list each export explicitly.
  export {
    ODataOptions,
    SqlOptions,
    HdbcdsOptions,
    HdiOptions,
    CdlOptions,
    EffectiveCsnOptions,
    Options,
    CompileOptions,
    CompileMessage,
    MessageSeverity,
    CompilationError,
  } from  '../../lib/main.d.ts';
}

declare namespace CSN {
  // Most definitions are based on the validator from `from-csn.js`
  // They are meant for use in JSDoc comments.
  //
  // These TypeScript definitions are meant for **internal use only**!

  //////////////////////////////
  // Heavily WORK IN PROGRESS //
  //////////////////////////////

  type TODO = any;

  /**
   * CSN Model. Can be passed to compiler backends for further processing and
   * can be generated from CDL using the compiler and transforming XSN to CSN.
   */
  export interface Model {
    /**
     * Contains the namespace of the first file passed to the compiler.
     */
    namespace?: string
    /**
     * Array of files that need to be loaded for this model. Paths are all
     * relative to the model's directory.  CDL equivalent is the `using`
     * statement.
     */
    requires?: string[]
    /**
     * Dictionary containing all type/entity/... definitions of this model.
     * Property names are fully qualified names (i.e. including namespaces),
     * etc.
     */
    definitions?: Definitions
    /**
     * Dictionary containing annotation definitions of this model.
     * Property names are fully qualified names (i.e. including namespaces),
     * etc.
     *
     * @since v2.0
     */
    vocabularies?: Definitions
    /**
     * Dictionary containing all deletions of types/entities/... in this (differential) model.
     * Property names are fully qualified names.
     */
    deletions?: { [name: string]: Definition }
    /**
     * An array of unnamed extensions, e.g. aspects.
     * Entities, types and more can be extended with elements or just
     * annotations.  If this property is set when compiling CDL sources
     * then either "parseCdl" mode is used or the extension could not be
     * applied.
     */
    extensions?: Extension[]
    /**
     * An array of unnamed changes of elements in this (differential) model.
     * This currently encompasses deletions and type changes of elements, although
     * the latter cannot be reliably distinguished from the (somewhat less likely)
     * deletion and re-addition of an element with different types, the difference
     * lying in whether data are to be migrated (out of scope here).
     */
    migrations?: Migration[]
    /**
     * External texts (translations). The key is a language identifier, e.g. "en" or "de".
     */
    i18n?: i18n
    /**
     * Compiler specific meta information.
     * Not processed by the compiler but always set when generating CSN files.
     */
    meta?: MetaInformation
    /**
     * CSN version, i.e. the version of the CSN format.
     * Current version is 1.0, the previous deprecated one was 0.1.
     */
    $version?: string
    /**
     * Deprecated version object of the CSN document.
     * Use `$version` instead.
     * @deprecated
     */
    version?: { csn: string }
    /**
     * Backend and compiler options.
     * Options to change the behavior of the compiler and its backends.
     * The options should match the used backend.
     */
    options?:  Options
    /**
     * Compilation messages.
     * Note: Use `options.messages` instead.
     */
    messages?: Message[]
    $location?: Location

    // Internal
    $sources?: any
  }

  /**
   * Compiler and backend options.
   *
   * Note: These options also contain the old non-SNAPI options!
   */
  export type Options = Options & {
    transformation?: TODO
    disableHanaComments?: TODO

    user?: any // old, now in variableReplacements
    locale?: any // old, now in variableReplacements.user

    moduleLookupDirectories?: string[]

    // old, keep until internal code gets rid of it
    forHana?: object
    toSql?: object
    toOdata?: object
    toCsn?: { flavor?: string }

    noRecompile?: boolean

    // internal options
    csn?: string
    src?: string
    xml?: boolean
    json?: boolean
    separate?: boolean
    combined?: boolean

    $skipNameCheck?: boolean

    /**
     * used to generate ALTER / ADD / DROP CONSTRAINT SQL Statements or .hdbconstraint artifacts with the `manageConstraints` cdsc CLI tool
     */
    drop?: boolean;
    alter?: boolean;
    violations?: any;

    /**
     * can be used to switch off validation / enforcement flag of resulting foreign key constraints
     */
    integrityNotValidated?: boolean
    integrityNotEnforced?: boolean

    /**
     * Global switch determines if referential integrity is checked.
     * 'individual' is like 'off'. Integrity only checked if an association has
     * dedicated @assert.integrity annotation
     */
    assertIntegrity?: 'true'|true|'false'|false|'individual'
    /**
     * Global option to specify how the integrity checks will mainly be performed.
     */
    assertIntegrityType?: 'RT'|'DB'

    /**
     * If specified, the referential constraints will be part of the
     * "create" table statements
     */
    constraintsInCreateTable?: boolean
    /**
     * Omit the `c__` in front of the constraint identifier
     */
    pre2134ReferentialConstraintNames?: true | false
    /**
     * If true, expressions (in `xpr`) are stored structured.
     * This is currently an internal option and should not be used by end-users.
     */
    structXpr?: boolean

    /**
     * Whether compilation messages inherit from `Error`, i.e. have a
     * stack trace.
     * To minimize the memory weight of messages, messages generally do not
     * inherit from `Error`.  For debugging purposes however, it may be useful
     * to enable a stack trace by setting this value to `true`.
     */
    internalMsg?: boolean


    // `cdsc/cdsse` options ---------------------------------------------------

    /**
     * Internal `cdsc` option.  If set, instead of CSN, XSN is emitted on the
     * console.  The value can either be `+` to indicate that the whole model
     * should be printed or can be the name (and path) to an artifact or a
     * property of it.
     * Consult `cdsc --help` for further details.
     */
    rawOutput?: string
    /**
     * `cdsse` option.  If true, "not found" error messages get another
     * property `validNames` which contains a list of valid artifact names.
     * This option is only useful for LSP clients, e.g. the Visual Studio
     * Code CDS plugin.
     */
    attachValidNames?: boolean
    /**
     * `cdsc` option: Use `-` if the result should be printed to stdout.
     */
    out?: string
    /**
     * Enables a trace output for file accesses
     */
    traceFs?: boolean
    /**
     * Default 'length' for 'cds.String'
     */
    length?: string
    /**
     * @private
     */
    $recompile?: boolean
    color?: boolean | string | 'auto' | 'always' | 'never';
  };

  /**
   * A dictionary of languages with translations.
   */
  export interface i18n {
    [lang: string]: i18nTexts
  }
  /**
   * A dictionary of translated texts for a language.
   */
  export interface i18nTexts {
    [textKey: string]: string
  }

  /**
   * cds-compiler meta information. Most often only "creator" is set.
   */
  export interface MetaInformation {
    creator: string
    /**
     * Options that were used to generate this CSN which may have an impact on the structure
     * of the CSN.  For example backends may flatten structures, etc.
     * Not the same as API options.
     */
    options?: { [optionName: string]: TODO }
    /**
     * Indicates that the CSN was transformed by a backend, e.g. 'odata'
     * A possible value is 'odata'.  Backends may not work with a transformed CSN.
     */
    transformation?: string
    /**
     * From @sap/cds; only used to provide users with better debug messages.
     */
    flavor?: string
  }

  // Definitions --------------------------------------------------------------

  export interface DefinitionRegistry {
     Aspect: Entity,
     Entity: Entity,
     Service: Service,
     Event: Event,
     Context: Context,
     Type: Type,
     Action: Action,
     Function: CSN.Function,
     View: View,
  }
  export type Definition = DefinitionRegistry[keyof DefinitionRegistry];
  export type Definitions = { [name: string]: Definition };

  /**
   * Base for top level definitions.
   * @todo Add properties when they are required.
   */
  export interface _BaseDefinition extends Annotated {
    kind?: KindValue
    /**
     * Fully qualified name of the definition, i.e. name includes namespace.
     */
    name?: string
    /**
     * Base type of this definition.
     * Used in type definitions.
     */
    type?: ArtifactReference
    /**
     * If the definition is structured-type then this property contains all
     * elements for the type (or entity).
     * Cannot be combined with `items` or `enum`.
     */
    elements?: { [name: string]: Element }
    /**
     * If the definition is an arrayed-type then this property contains the
     * artifact for its items.
     * Cannot be combined with `elements` or `enum`.
     */
    items?:    Artifact
    /**
     * If the definition is an enum-type then this property contains the
     * allowed enum elements for it.
     * Cannot be combined with `elements` or `items`.
     */
    enum?: EnumList

    // Functions
    actions?:  { [name: string]: Action }
    params?:   { [name: string]: Parameter }
    returns?:  Artifact

    /** A doc-comment */
    doc?: string

    /** An entity include, i.e. extensions to the artifact */
    includes?: FQN[]

    // Properties for types
    length?:    Integer
    precision?: Integer
    scale?:     Integer
    srid?:      Integer
    query?:     Query
    projection?: QuerySelect
    abstract?:  boolean

    // Internal properties
    $path?:      Path
    $location?:  Location
    $syntax?:    string  // TODO: to be removed in the future
    $draftRoot?: TODO     // only used by forRelationalDB.js
    $sources?:   TODO[]   // used by edmPreprocessor.js
    $ignore?:    boolean // Used in forRelationalDB.js and toCdl.js
    // EDM specific
    _target?: TODO
    _constraints?: TODO
    _parent?: TODO

    technicalConfig?: TODO
  }

  /**
   * Extensions can be `annotate` or `extend` artifacts.
   * By default, extensions are applied if possible. However, by using the
   * special `parseCdl` option no extensions are applied.
   */
  export interface Extension {
    /**
     * Artifact that should be extended.
     * Only set when extension is an `extend`.
     */
    extend?: FQN
    /**
     * Artifact that should be extended.
     * Only set when extension is an `annotate`. Other properties
     */
    annotate?: FQN
    /** Elements that shall be extended/annotated. */
    elements?: Elements
    /** Elements that shall be extended/annotated. */
    actions?: { [name: string]: Action }
    params?: { [name: string]: Parameter }
    /** Returns of an action */
    returns?: TODO
    /** Artifacts to use as extensions. */
    includes?: string[]
    /** Projection extensions. */
    columns?: Column[]
    /** Enum extensions. */
    enum?: EnumList
  }

  export interface Migration {
    /* Artifact that shall be migrated, i.e. changed. */
    migrate: FQN
    /* Elements that shall be removed. */
    remove?: { [name: string]: Element }
    /* Changes of elements that shall be applied. */
    change?: { [name: string]: ElementChange }
  }

  /**
   * Element changes are part of differential models and refer to modifications of existing elements.
   */
  export interface ElementChange {
    /** Old version of this element. */
    old: Element
    /** New version of this element. */
    new: Element
  }

  /**
   * An artifact is a definition but may also be an anonymous struct, e.g.
   * in the `elements` property of a definition.
   */
  export interface Artifact extends _BaseDefinition {
    /** Element must not be NULL (e.g. in SQL) */
    notNull?: boolean | null
    /** List of foreign keys */
    keys?: TODO[]
    /** Whether the element is a key */
    key?: boolean
    /** Whether the element is unique (similar to SQL's UNIQUE) */
    unique?: boolean
    /** Whether the element is virtual */
    virtual?: boolean
    /** A masked element is not part of a "SELECT *" query. */
    masked?: boolean
    /** Cardinality of the association */
    cardinality?: Cardinality
    default?: { val?: TODO, literal?: 'number' | 'string' } & { xpr: TODO[] }
    /** Value for calculated elements */
    value?: any

    targetAspect?: TODO
    localized?: boolean

    $origin?: TODO

    // associations

    on?: OnCondition
    target?: TODO
    /**
     * Whether the association was managed before being transformed.
     * Only set and used by forRelationalDB.
     */
    $managed?: boolean

    /** OData specific; true if the artifact would have a localized convenience view */
    $localized?: boolean

    $tableConstraints?: TableConstraints;

    _flatElementNameWithDots?: string // only used by forOdataNew
    _links?: Artifact[] // only used in enricher
    _type?: Artifact

    // (HANA) backend specific
    $key?: boolean
    _art?: TODO
    // OData backend specific:
    $foreignKeyConstraint?: TODO

    // Universal CSN expander
    _status?: string;

    /** Enums: The enum's value: a string or number */
    val?: string | number
    /**
     * Enums:A reference to another enum value.
     * Note: Although allowed, enum values should not point to other elements.
     */
    '#'?:  string
  }

  /**
   * Special artifact with further properties that can be used by the backends.
   * Such properties are added e.g. in `model/csnRefs.js`.
   */
  export interface ArtifactWithRefs extends Artifact {
    _effectiveType?: ArtifactWithRefs | 0 | null
  }

  // TODO: Be more specific than a general "Artifact"
  // TODO: Sometimes even wrong, e.g. for context

  export type Elements = { [name: string]: Element };

  export interface Aspect extends Artifact {}
  export interface Entity extends Artifact {}
  export interface Event extends Artifact {}
  export interface View extends Artifact {}
  export interface Type extends Artifact {}
  export interface Element extends Artifact {
    /**
     * flag used by foreign key constraint algorithm to detect whether
     * a composition / association had a $self in its on-condition
     */
    $selfOnCondition?: {
      up_: [string];
    };
    /**
     * if a composition/association should not end up in a foreign key constraint,
     * this flag indicates that the backlink should also be ignored
     */
    $skipReferentialConstraintForUp_?: boolean;
    /**
     * Indicates that this composition/association should result in a foreign key constraint.
     *
     * This is necessary because if the global integrity checks are set to 'individual' and
     * an association with a $self comparison has an annotation like "@assert.integrity: 'DB'",
     * we must create foreign key constraints for the up_ link (which lacks this annotation most likely)
     *
     */
     $createReferentialConstraintForUp_?: boolean;
  }
  export interface Parameter extends Artifact {}
  export interface Action extends Artifact {}
  export interface Function extends Action {}
  export interface Association extends Element {}
  export interface Composition extends Element {}
  export interface Context extends Artifact {}
  export interface Service extends Artifact {}

  export interface TableConstraints {
    unique?: TODO;
    referential?: ReferentialConstraint;
  }

  export interface ReferentialConstraint {
   identifier: string,
   foreignKey: string[] // list of foreign key elements.
   parentKey: string[]  // list of parent key elements.
   dependentTable: string // in which the constraint will be created.
   parentTable: string // to which the foreign key refers to.
   onDeleteRemark: string // gives guidance why this particular onDelete rule was calculated
   onDelete: 'RESTRICT' | 'CASCADE'; // the action which will be triggered on delete of parent key
   validated: boolean; // are existing records in the db validated for referential integrity?
   enforced: boolean; // are future operations on the referenced parent key validated for referential integrity violations?
  }

  export type OnCondition = TODO[];

  export interface Query extends Annotated {
    SELECT?: QuerySelect
    SET?: QuerySet
    from?: QueryFrom
    args?: TODO[]
    xpr?: TODO
    columns?: Column[]
    where?: TODO
    having?: TODO
    groupBy?: TODO[]
    orderBy?: TODO[]
    limit?: QueryLimit
    mixin?: TODO
    excluding?: string[]
    elements?: { [name: string]: Element }
    // internal: TODO
    $elements?: { [name: string]: Element }
    $path?: any
    // May be wrong here
    projection?: TODO,
  }

  export interface QuerySet extends Query {
    op?: string
    all?: boolean
  }

  export interface QueryLimit{
    rows?: TODO
    offset?: TODO
  }

  export interface QueryFrom extends Query {
    ref?: TODO[] // Not just number|string but also objects
    args?: TODO
    as?: TODO
    cast?: {
      type: FQN
    }
    join?: TODO
    cardinality?: Cardinality
    on?: TODO[]
  }

  export interface QuerySelect extends Query {
    distinct?: boolean
  }

  export interface QuerySelectEnriched extends QuerySelect {
    $alias?: string | null
    _sources?: { name: Definitions }
  }

  export type EnumList = { [name: string]: Enum };

  /** TODO: Don't just use an alias */
  export type Enum = Element;

  export type Payload = {[elementName: string]: Type}

  export type Column = TODO; /*
  '*' | {
    ref?: TODO[]
    func?: string
    args?: ArtifactReference[]
    key?: boolean
    as?: string
    cast?: {
      target?: string
    }
  }
  */

  export interface Cardinality {
    srcmin?: number | '*'
    src?: number | '*'
    min?: number | '*'
    max?: number | '*'
  }

  /**
   * Possible values for the 'kind' property.  'string' is also used
   * because the TypeScript compiler otherwise warns about some usages.
   */
  export type KindValue = string
                        | 'entity'
                        | 'service'
                        | 'event'
                        | 'context'
                        | 'aspect'
                        | 'type'
                        | 'action'
                        | 'function';
  /**
   * A fully qualified name (FQN) contains all surrounding service-, context-
   * and namespace-names separated by a dot (`.`).
   * For example an entity `E` in service `S` in namespace `N` would have the
   * FQN `N.S.E`.
   */
  export type FQN = string;

  /**
   * An artifact reference is either a fully qualified name or consists
   * of multiple "ref" strings describing the "path" of the type.
   */
  export type ArtifactReference = any; // TODO: string | ArtifactReferencePath

  export type ArtifactReferencePath = {
    ref?: Path
  }

  /**
   * CSN Location, often exposed by "$location" in CSN.
   * Columns and lines are 1-based.
   *
   * All properties are optional, even `file`.
   */
  export interface Location {
    __proto__?: any, // See https://github.com/microsoft/TypeScript/issues/38385
    file?:    string
    line?:    number
    col?:     number
    endLine?: number
    endCol?:  number
  }

  /**
   * A CSN path describes the path that needs to be traversed to reach the
   * element in the JSON structure (i.e. CSN).
   * Its elements are either strings (for objects) or
   * numbers (for indexes in arrays).
   */
  export type Path = (PathSegment)[]
  export type PathSegment = string|number;

  export enum PrimitiveType {
    UUID = 'cds.UUID',
    Boolean = 'cds.Boolean',
    Integer = 'cds.Integer',
    Integer64 = 'cds.Integer64',
    Decimal = 'cds.Decimal',
    DecimalFloat = 'cds.DecimalFloat',
    Double = 'cds.Double',
    Date = 'cds.Date',
    Time = 'cds.Time',
    DateTime = 'cds.DateTime',
    Timestamp = 'cds.Timestamp',
    String = 'cds.String',
    Binary = 'cds.Binary',
    LargeBinary = 'cds.LargeBinary',
    LargeString = 'cds.LargeString',
    HanaSmallInt = 'cds.hana.SMALLINT',
    HanaTinyInt = 'cds.hana.TINYINT',
    HanaSmallDecimal = 'cds.hana.SMALLDECIMAL',
    HanaReal = 'cds.hana.REAL',
    HanaChar = 'cds.hana.CHAR',
    HanaNchar = 'cds.hana.NCHAR',
    HanaVarchar = 'cds.hana.VARCHAR',
    HanaClob = 'cds.hana.CLOB',
    HanaBinary = 'cds.hana.BINARY',
    HanaStPoint = 'cds.hana.ST_POINT',
    HanaStGeometry = 'cds.hana.ST_GEOMETRY',
  }

  /**
   * Indicates that the object may have annotation assignments.
   * Annotations start with an '@'.
   */
  export interface Annotated {
    // since TypeScript 4.1
    [annotation: `@${string}`]: any;

    // Some common annotations
    '@cds.autoexpose'?: boolean
    '@cds.autoexposed'?: boolean
    '@odata.draft.enabled'?: boolean
    '@odata.containment.ignore'?: boolean
    '@Core.Computed'?: boolean
    '@assert.unique.data'?: any
    '@assert.unique.locale'?: any
    '@fiori.draft.enabled'?: boolean
    '@cds.valid.from'?: boolean
    '@cds.valid.to'?: boolean
  }

}
