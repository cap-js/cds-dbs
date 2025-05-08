// Compiler options

/* eslint @stylistic/js/max-len: 0 */

// Remarks:
// - The specification is client-tool centric (bin/cdsc.js):
//   an option named `fooBar` is “produced” by `.option('  --foo-bar')`.
// - Also list the option in the `help` text, used with `cdsc -h`.
// - Specify valid values for non-boolean options in lib/api/validate.js.

'use strict';

const { createOptionProcessor } = require('./base/optionProcessorHelper');
const { availableBetaFlags } = require('./base/model');

// This option processor is used both by the command line parser (to translate cmd line options
// into an options object) and by the API functions (to verify options)
const optionProcessor = createOptionProcessor();

// General options
optionProcessor
  .option('-h, --help')
  .option('-v, --version')
  .option('    --options <file>')
  .option('-w, --warning <level>', { valid: [ '0', '1', '2', '3' ] })
  .option('    --quiet')
  .option('-i, --stdin')
  .option('    --show-message-id')
  .option('    --no-message-id')
  .option('    --no-message-context')
  .option('    --color <mode>', { valid: [ 'auto', 'always', 'never' ] })
  .option('-o, --out <dir>')
  .option('    --cds-home <dir>')
  .option('    --module-lookup-directories <list>')
  .option('    --trace-fs')
  .option('    --error <id-list>')
  .option('    --warn <id-list>')
  .option('    --info <id-list>')
  .option('    --debug <id-list>')
  .option('-E, --enrich-csn')
  .option('-R, --raw-output <name>')
  .option('    --old-parser')
  .option('    --internal-msg')
  .option('    --beta-mode')
  .option('    --beta <list>')
  .option('    --deprecated <list>')
  .option('    --direct-backend')
  .option('    --fallback-parser <type>', { valid: [ 'auto!', 'cdl', 'csn', 'csn!' ] })
  .option('    --shuffle <seed>') // 0 | 1..4294967296
  .option('    --test-mode')
  .option('    --test-sort-csn')
  .option('    --doc-comment')
  .option('    --propagate-doc-comments')
  .option('    --add-texts-language-assoc')
  .option('    --localized-without-coalesce')
  .option('    --tenant-discriminator')
  .option('    --no-composition-includes')
  .option('    --default-binary-length <length>')
  .option('    --default-string-length <length>')
  .option('    --struct-xpr')
  .option('    --no-recompile')
  .option('    --skip-name-check', { optionName: '$skipNameCheck' })
  .positionalArgument('<files...>')
  .help(`
  Usage: cdsc <command> [options] <files...>

  Compile a CDS model given from input <files...>s and generate results according to <command>.
  Input files may be CDS source files (.cds), CSN model files (.json) or pre-processed ODATA
  annotation XML files (.xml). Output depends on <command>, see below. If no command is given,
  "toCsn" is used by default.

  Use "cdsc <command> --help" to get more detailed help for each command.

  General options
   -h, --help               Show this help text
   -v, --version            Display version number and exit
       --quiet              Don't emit anything, neither results nor messages.
   -w, --warning <level>    Show messages up to <level>
                              0: Error
                              1: Warnings
                              2: (default) Info
                              3: Debug
       --options <file>     Use the given JSON file as input options.
                            The key 'cdsc' of 'cds' is used. If not present 'cdsc' is used.
                            Otherwise, the JSON as-is is used as options.
       --no-message-id      Don't show message IDs in errors, warnings, info and debug messages
       --show-message-id    DEPRECATED: Showing the message ID is now the default.
       --no-message-context Print messages as single lines without code context (useful for
                            redirecting output to other processes). Default is to print human-
                            readable text similar to Rust's compiler with a code excerpt.
       --color <mode>       Use colors for warnings. Modes are:
                              auto: (default) Detect color support of the TTY.
                              always:
                              never:
   -o, --out <dir>          Place generated files in directory <dir>, default is "-" for <stdout>
       --cds-home <dir>     When set, modules starting with '@sap/cds/' are searched in <dir>
       --module-lookup-directories <list>  Comma separated list of directories to look
                            for CDS modules. Default is 'node_modules/'.
   -i, --stdin              Read input from stdin.
       --                   Indicate the end of options (helpful if source names start with "-")

  Type options
       --default-binary-length <length> Default 'length' for 'cds.Binary'
       --default-string-length <length> Default 'length' for 'cds.String'

  Diagnostic options
       --trace-fs           Trace file system access caused by "using from"

  Severity options
    Use these options to reclassify messages.  Option argument is a comma separated list of message IDs.
       --error <id-list>    IDs that should be reclassified to errors.
       --warn  <id-list>    IDs that should be reclassified to warnings.
       --info  <id-list>    IDs that should be reclassified to info messages.
       --debug <id-list>    IDs that should be reclassified to debug messages.

  Internal options (for testing only, may be changed/removed at any time)
   -E, --enrich-csn         Show non-enumerable CSN properties and locations of references
   -R, --raw-output <name>  Write XSN for definition "name" and error output to <stdout>,
                            with name = "+", write complete XSN, long!
       --tenant-discriminator  Add tenant fields to entities
       --internal-msg       Write raw messages with call stack to <stdout>/<stderr>
       --old-parser         Use the Antlr based CDL parser
       --beta-mode          Enable all unsupported, incomplete (beta) features
       --beta <list>        Comma separated list of unsupported, incomplete (beta) features to use.
                            Valid values are:
                              ${
                                Object.keys(availableBetaFlags)
                                  .filter(flag => availableBetaFlags[flag])
                                  .sort()
                                  .join(`\n${ ' '.repeat(30) }`)
                              }
       --deprecated <list>  Comma separated list of deprecated options.
       --fallback-parser <type>  If the language cannot be deduced by the file's extensions, use this
                                 parser as a fallback. Valid values are:
                                   cdl   : Use CDL parser
                                   csn   : Use CSN parser
                                   csn!  : Use CSN parser even with extension cds, cdl, hdbcds and hdbdd
                                   auto! : Ignore file extension; use CSN parser if file content starts with '{'
       --direct-backend     Do not compile the given CSN but directly pass it to the backend.
                            Can only be used with certain new CSN based backends. Combination with
                            other flags is limited, e.g. --test-mode will not run a consistency check.
                            No recompilation is triggered in case of errors. cdsc will dump.
       --shuffle <seed>     If provided, some internal processing sequences are changed, most notably by
                            using a shuffled version of ‹model›.definitions. <seed> should be a number
                            between 1 and 4294967296, the compiler uses a random number in that range if the
                            provided argument is 0 or not a number. The same number always produces the same
                            shuffled version of ‹model›.definitions.  This option also enables --test-mode.
       --test-mode          Produce extra-stable output for automated tests (normalize filenames
                            in errors, sort properties in CSN, omit version in CSN)
       --test-sort-csn      Sort the generated CSN by definitions.  This impacts the order of EDMX,
                            OData CSN, CDL order and more.  When --test-mode is enabled, this
                            option is implicitly enabled as well.
       --doc-comment        Preserve /** */ comments at annotation positions as doc property in CSN
       --propagate-doc-comments     Propagate doc comments ('--doc-comment')
       --add-texts-language-assoc   In generated texts entities, add association "language"
                                    to "sap.common.Languages" if it exists
       --localized-without-coalesce Omit coalesce in localized convenience views
       --no-composition-includes  Do NOT add named aspects to 'includes' property of generated composition entity.
       --no-recompile       Don't recompile in case of internal errors
       --struct-xpr         Write structured expressions to the compiler CSN output (possibly then
                            used as input for backends)
       --skip-name-check    Skip certain name checks, e.g. that there must be no '.' in element names.

  Commands
    H, toHana [options] <files...>              (deprecated) Generate HANA CDS source files
    O, toOdata [options] <files...>             Generate ODATA metadata and annotations
    C, toCdl <files...>                         Generate CDS source files
    Q, toSql [options] <files...>               Generate SQL DDL statements
    J, forJava [options] <files...>             Generate CSN for the Java Runtime
       toCsn [options] <files...>               (default) Generate original model as CSN
       parseCdl [options] <file>                Generate a CSN that is close to the CDL source.
       explain <message-id>                     Explain a compiler message.
       parseOnly [options] <files...>           (internal)  Stop compilation after parsing, write messages to <stderr>,
                                                per default no output.
       toRename [options] <files...>            (internal) Generate SQL DDL rename statements
       manageConstraints [options] <files...>   (internal) Generate ALTER TABLE statements to
                                                           add / modify referential constraints.
       inspect [options] <files...>             (internal) Inspect the given CDS files.
       forEffective [options] <files...>        (internal) Get an effective CSN; requires beta mode
       forSeal [options] <files...>             (internal) Get a SEAL CSN

  Environment variables
    NO_COLOR                If set, compiler messages (/output) will not be colored.
                            Can be overwritten by '--color'
    FORCE_COLOR             If set, compiler messages (/output) will be colored. Overrides NO_COLOR.
                            Can be overwritten by '--color'
    CDSC_TRACE_TIME         If set, additional timing information is printed to stderr.
    CDSC_TRACE_API          If set, additional API calling information is printed to stderr.
`);

// ----------- toHana -----------
optionProcessor.command('H, toHana')
  .option('-h, --help')
  .option('-n, --sql-mapping <style>', { valid: [ 'plain', 'quoted', 'hdbcds' ], aliases: [ '--names' ] })
  .option('    --render-virtual')
  .option('    --joinfk')
  .option('-u, --user <user>')
  .option('-s, --src')
  .option('-c, --csn')
  .option('    --integrity-not-validated')
  .option('    --integrity-not-enforced')
  .option('    --assert-integrity <mode>', { valid: [ 'true', 'false', 'individual' ] })
  .option('    --assert-integrity-type <type>', { valid: [ 'RT', 'DB' ], ignoreCase: true })
  .option('    --pre2134ReferentialConstraintNames')
  .option('    --disable-hana-comments')
  .option('    --no-standard-database-functions')
  .help(`
  Usage: cdsc toHana [options] <files...>

  ====================================================
  DEPRECATED! Since v5, this backend is deprecated!
  ====================================================

  Generate HANA CDS source files, or CSN.

  Options
   -h, --help                 Show this help text
   -n, --sql-mapping <style>  Naming style for generated entity and element names:
                                plain  : (default) Produce HANA entity and element names in
                                         uppercase and flattened with underscores. Do not generate
                                         structured types.
                                quoted : Produce HANA entity and element names in original case as
                                         in CDL. Keep nested contexts (resulting in entity names
                                         with dots), but flatten element names with underscores.
                                         Generate structured types, too.
                                hdbcds : Produce HANA entity end element names as HANA CDS would
                                         generate them from the same CDS source (like "quoted", but
                                         using element names with dots).
       --render-virtual       Render virtual elements in views and draft tables
       --joinfk               Create JOINs for foreign key accesses
   -u, --user <user>          Value for the "$user" variable
   -s, --src                  (default) Generate HANA CDS source files "<artifact>.hdbcds"
   -c, --csn                  Generate "hana_csn.json" with HANA-preprocessed model
   --integrity-not-enforced   If this option is supplied, referential constraints are NOT ENFORCED.
   --integrity-not-validated  If this option is supplied, referential constraints are NOT VALIDATED.
   --assert-integrity <mode>  Turn DB constraints on/off:
                                true        : (default) Constraints will be generated for all associations if
                                              the assert-integrity-type is set to DB
                                false       : No constraints will be generated
                                individual  : Constraints will be generated for selected associations
   --assert-integrity-type <type>   Specifies how the referential integrity checks should be performed:
                                           RT : (default) No database constraint for an association
                                               if not explicitly demanded via annotation
                                           DB : Create database constraints for associations
   --pre2134ReferentialConstraintNames   Do not prefix the constraint identifier with "c__"
   --disable-hana-comments    Disable rendering of doc comments as SAP HANA comments.
   --no-standard-database-functions Disable rendering of standard database function mappings.
`);

optionProcessor.command('O, toOdata')
  .option('-h, --help')
  .option('-v, --odata-version <version>', { valid: [ 'v2', 'v4', 'v4x' ], aliases: [ '--version' ] })
  .option('-x, --xml')
  .option('-j, --json')
  .option('    --odata-containment')
  .option('    --odata-capabilities-pullup')
  .option('    --odata-openapi-hints')
  .option('    --edm4openapi', { optionName: 'edm4OpenAPI' })
  .option('    --odata-proxies')
  .option('    --odata-x-service-refs')
  .option('    --odata-foreign-keys')
  .option('    --odata-v2-partial-constr')
  .option('    --odata-vocabularies <list>')
  .option('    --odata-no-creator')
  .option('-c, --csn')
  .option('-f, --odata-format <format>', { valid: [ 'flat', 'structured' ] })
  .option('-n, --sql-mapping <style>', { valid: [ 'plain', 'quoted', 'hdbcds' ], aliases: [ '--names' ] })
  .option('-s, --service-names <list>')
  .option('    --transitive-localized-views')
  .help(`
  Usage: cdsc toOdata [options] <files...>

  Generate ODATA metadata and annotations, or CSN.

  Options
   -h, --help               Show this help text
   -v, --odata-version <version>  ODATA version
                                    v2: ODATA V2
                                    v4: (default) ODATA V4
                                    v4x: { version: 'v4', odataContainment:true, format:'structured' }
   -x, --xml                (default) Generate XML output (separate or combined)
   -j, --json               Generate JSON output as "<svc>.json" (not available for v2)
   -c, --csn                Generate "odata_csn.json" with ODATA-preprocessed model
   -f, --odata-format <format>  Set the format of the identifier rendering
                                  flat       : (default) Flat type and property names
                                  structured : (V4 only) Render structured metadata
       --odata-containment         Generate Containment Navigation Properties for compositions (V4 only)
       --odata-capabilities-pullup Rewrite @Capabilities annotations (V4 containment only).
       --odata-openapi-hints       Add various annotations to JSON API as input for OpenAPI generation.
       --edm4openapi               Downgrade some errors to warnings for OpenAPI generation.
       --odata-proxies             Generate Proxies for out-of-service navigation targets (V4 only).
       --odata-x-service-refs      Generate schema references (V4 only).
       --odata-foreign-keys        Render foreign keys in structured format (V4 only)
       --odata-v2-partial-constr   Render referential constraints also for partial principal key tuple
                                   (Not spec compliant and V2 only)
       --odata-vocabularies <list> JSON array of adhoc vocabulary definitions
                                   { prefix: { alias, ns, uri }, ... }
       --odata-no-creator          Omit creator identification in API
   -n, --sql-mapping <style> Annotate artifacts and elements with "@cds.persistence.name", which is
                             the corresponding database name (see "--sql-mapping" for "toSql")
                               plain   : (default) Names in uppercase and flattened with underscores
                               quoted  : Names in original case as in CDL. Entity names with dots,
                                         but element names flattened with underscores
                               hdbcds  : Names as HANA CDS would generate them from the same CDS
                                         source (like "quoted", but using element names with dots)
    -s, --service-names <list>    List of comma-separated service names to be rendered
                                  (default) empty, all services are rendered
   --transitive-localized-views  If set, the backends will create localized convenience views for
                             those views, that only have an association to a localized entity/view.
`);

optionProcessor.command('J, forJava')
  .option('-h, --help')
  .help(`
  Usage: cdsc forJava [options] <files...>

  Generate CSN (structured) for Java Runtime.

  Options
   -h, --help      Show this help text
`);

optionProcessor.command('C, toCdl')
  .option('-h, --help')
  .option('    --no-render-cdl-definition-nesting')
  .option('    --no-render-cdl-common-namespace')
  .help(`
  Usage: cdsc toCdl [options] <files...>

  Generate CDS source files "<artifact>.cds".

  Options
   -h, --help      Show this help text
       --no-render-cdl-definition-nesting   If set, definitions will be nested
                   inside services/contexts instead of having only top-level
                   definitions.
       --no-render-cdl-common-namespace  If true and render-cdl-definition-nesting
                   is set, a common namespace will be extracted and rendered.
`);

optionProcessor.command('Q, toSql')
  .option('-h, --help')
  .option('-n, --sql-mapping <style>', { valid: [ 'plain', 'quoted', 'hdbcds' ], aliases: [ '--names' ] })
  .option('-d, --sql-dialect <dialect>', { valid: [ 'hana', 'sqlite', 'plain', 'postgres', 'h2' ], aliases: [ '--dialect' ] })
  .option('    --render-virtual')
  .option('    --joinfk')
  .option('-u, --user <user>')
  .option('-l, --locale <locale>')
  .option('-s, --src <style>', { valid: [ 'sql', 'hdi' ] })
  .option('-c, --csn')
  .option('    --integrity-not-validated')
  .option('    --integrity-not-enforced')
  .option('    --assert-integrity <mode>', { valid: [ 'true', 'false', 'individual' ] })
  .option('    --assert-integrity-type <type>', { valid: [ 'RT', 'DB' ], ignoreCase: true })
  .option('    --constraints-in-create-table')
  .option('    --pre2134ReferentialConstraintNames')
  .option('    --disable-hana-comments')
  .option('    --generated-by-comment')
  .option('    --better-sqlite-session-variables <bool>')
  .option('    --transitive-localized-views')
  .option('    --no-boolean-equality')
  .option('    --with-hana-associations <bool>', { valid: [ 'true', 'false' ] })
  .option('    --no-standard-database-functions')
  .option('    --v6-now')
  .help(`
  Usage: cdsc toSql [options] <files...>

  Generate SQL DDL statements to create tables and views, or CSN

  Options
   -h, --help                 Show this help text
   -n, --sql-mapping <style>  Naming style for generated entity and element names:
                                plain  : (default) Produce SQL table and view names in
                                         flattened with underscores format (no quotes required)
                                quoted : Produce SQL table and view names in original case as in
                                         CDL (with dots), but flatten element names with
                                         underscores (requires quotes). Can only be used in
                                         combination with "hana" dialect.
                                hdbcds : Produce SQL table, view and column names as HANA CDS would
                                         generate them from the same CDS source (like "quoted", but
                                         using element names with dots). Can only be used in
                                         combination with "hana" dialect.
       --render-virtual       Render virtual elements in views and draft tables
       --joinfk               Create JOINs for foreign key accesses
   -d, --sql-dialect <dialect>  SQL dialect to be generated:
                                plain    : (default) Common SQL - no assumptions about DB restrictions
                                hana     : SQL with HANA specific language features
                                sqlite   : Common SQL for sqlite
                                postgres : Common SQL for postgres - beta-feature
                                h2       : Common SQL for h2
   -u, --user <user>          Value for the "$user" variable
   -l, --locale <locale>      Value for the "$user.locale" variable in "sqlite"/"plain" dialect
   -s, --src <style>          Generate SQL source files as <artifact>.<suffix>
                                sql    : (default) <suffix> is "sql"
                                hdi    : HANA Deployment Infrastructure source files, <suffix> is
                                         the HDI plugin name. Can only be used in combination with
                                         "hana" dialect.
   -c, --csn                  Generate "sql_csn.json" with SQL-preprocessed model
   --integrity-not-enforced   If this option is supplied, referential constraints are NOT ENFORCED.
   --integrity-not-validated  If this option is supplied, referential constraints are NOT VALIDATED.
   --assert-integrity <mode>  Turn DB constraints on/off:
                                true        : (default) Constraints will be generated for all associations if
                                              the assert-integrity-type is set to DB
                                false       : No constraints will be generated
                                individual  : Constraints will be generated for selected associations
   --assert-integrity-type <type>   Specifies how the referential integrity checks should be performed:
                                      RT : (default) No database constraint for an association
                                           if not explicitly demanded via annotation
                                      DB : Create database constraints for associations
   --constraints-in-create-table    If set, the foreign key constraints will be rendered as
                                    part of the "CREATE TABLE" statements rather than as separate
                                    "ALTER TABLE ADD CONSTRAINT" statements
   --pre2134ReferentialConstraintNames   Do not prefix the constraint identifier with "c__"
   --disable-hana-comments    Disable rendering of doc comments as SAP HANA comments.
   --generated-by-comment     Enable rendering of the initial SQL comment for HDI-based artifacts
   --better-sqlite-session-variables <bool>
                              Enable better-sqlite compatible rendering of $user. Only
                              active if sqlDialect is \`sqlite\`:
                                true  : (default) Render better-sqlite session_context(…)
                                false : Render session variables as string literals, used e.g. with sqlite3 driver
   --transitive-localized-views  If set, the backends will create localized convenience views for
                              those views, that only have an association to a localized entity/view.
   --with-hana-associations <bool>
                              Enable or disable rendering of "WITH ASSOCIATIONS" for sqlDialect 'hana'.
                                true  : (default) Render "WITH ASSOCIATIONS"
                                false : Do not render "WITH ASSOCIATIONS"
   --no-standard-database-functions Disable rendering of standard database function mappings.
   --no-boolean-equality      Enable support for boolean logic '!=' operator.
   --v6-now                   Enable new v6 rendering of $now
`);

optionProcessor.command('toRename')
  .option('-h, --help')
  .option('-n, --sql-mapping <style>', { valid: [ 'quoted', 'hdbcds' ], aliases: [ '--names' ] })
  .help(`
  Usage: cdsc toRename [options] <files...>

  (internal, subject to change): Generate SQL stored procedure containing DDL statements to
  "storedProcedure.sql" that allows to rename existing tables and their columns so that they
  match the result of "toHana" or "toSql" with the "--sql-mapping plain" option.

  Options
   -h, --help           Display this help text
   -n, --sql-mapping <style>
                        Assume existing tables were generated with "--sql-mapping <style>":
                          quoted   : Assume existing SQL tables and views were named in original
                                     case as in CDL (with dots), but column names were flattened
                                     with underscores (e.g. resulting from "toHana --sql-mapping quoted")
                          hdbcds   : (default) Assume existing SQL tables, views and columns were
                                     generated by HANA CDS from the same CDS source (or resulting
                                     from "toHana --sql-mapping hdbcds")
`);

optionProcessor.command('manageConstraints')
  .option('-h, --help')
  .option('-n, --sql-mapping <style>', { valid: [ 'plain', 'quoted', 'hdbcds' ], aliases: [ '--names' ] })
  .option('-s, --src <style>', { valid: [ 'sql', 'hdi' ] })
  .option('    --drop')
  .option('    --alter')
  .option('    --violations')
  .option('    --integrity-not-validated')
  .option('    --integrity-not-enforced')
  .option('-d, --sql-dialect <dialect>', { valid: [ 'hana', 'sqlite', 'plain', 'postgres', 'h2' ], aliases: [ '--dialect' ] })
  .help(`
  Usage: cdsc manageConstraints [options] <files...>

  (internal, subject to change): Generate SQL DDL ALTER TABLE statements to add / modify
  referential constraints on an existing model. This can also be used to
  generate SELECT statements which list all referential integrity violations.

  Options
   -h, --help             Display this help text
   -n, --sql-mapping <style>
                          Assume existing tables were generated with "--sql-mapping <style>":
                            plain    : (default) Assume SQL tables were flattened and dots were
                                        replaced by underscores
                            quoted   : Assume existing SQL tables and views were named in original
                                       case as in CDL (with dots), but column names were flattened
                                       with underscores
                            hdbcds   : Assume existing SQL tables and column names were produced
                                       as HANA CDS would have generated them from the same CDS source
                                       (like "quoted", but using element names with dots).
  -s, --src <style>       Generate SQL source files as <artifact>.<suffix>
                            sql   : (default) <suffix> is "sql"
                            hdi   : constraint will be generated with <suffix> "hdbconstraint"
      --drop              Generate "ALTER TABLE <table> DROP CONSTRAINT <constraint>" statements
      --alter             Generate "ALTER TABLE <table> ALTER CONSTRAINT <constraint>" statements
      --violations        Generates SELECT statements which can be used to list
                          referential integrity violations on the existing data
      --integrity-not-enforced   If this option is supplied, referential constraints are NOT ENFORCED.
      --integrity-not-validated  If this option is supplied, referential constraints are NOT VALIDATED.
  -d, --sql-dialect <dialect>  SQL dialect to be generated:
      plain    : (default) Common SQL - no assumptions about DB restrictions (constraints not supported in this dialect)
      hana     : SQL with HANA specific language features
      sqlite   : Common SQL for sqlite
      postgres : Common SQL for postgres - beta-feature
      h2       : Common SQL for h2 (constraints not supported in this dialect)
`);

optionProcessor.command('toCsn')
  .option('-h, --help')
  .option('-f, --csn-flavor <flavor>', { valid: [ 'client', 'gensrc', 'universal' ], aliases: [ '--flavor' ] })
  .option('    --with-localized')
  .option('    --with-locations')
  .option('    --transitive-localized-views')
  .help(`
  Usage: cdsc toCsn [options] <files...>

  Generate original model as CSN to "csn.json"

  Options
   -h, --help             Show this help text
   -f, --csn-flavor <flavor>  Generate CSN in one of two flavors:
                                client  : (default) Standard CSN consumable by clients and backends
                                gensrc  : CSN specifically for use as a source, e.g. for
                                          combination with additional "extend" or "annotate"
                                          statements, but not suitable for consumption by clients or
                                          backends
                                universal: in development (BETA)
       --with-locations   Add $location to CSN artifacts. In contrast to \`--enrich-csn\`,
                          $location is an object with 'file', 'line' and 'col' properties.
       --transitive-localized-views If --with-locations and this option are set, the backends
                          will create localized convenience views for those views,
                          that only have an association to a localized entity/view.

  Internal options (for testing only, may be changed/removed at any time)
       --with-localized   Add localized convenience views to the CSN output.
`);

optionProcessor.command('parseCdl')
  .option('-h, --help')
  .positionalArgument('<file>')
  .option('    --with-locations')
  .help(`
  Usage: cdsc parseCdl [options] <file>

  Only parse the CDL and output a CSN that is close to the source. Does not
  resolve imports, apply extensions or expand any queries.

  Options
       --with-locations   Add $location to CSN artifacts.
   -h, --help             Show this help text
`);

optionProcessor.command('parseOnly')
  .option('-h, --help')
  .option('    --trace-parser')
  .option('    --trace-parser-amb')
  .positionalArgument('<file>')
  .help(`
  Usage: cdsc parseOnly [options] <files...>

  (internal): Stop compilation after parsing and write messages to <stderr>.
  Per default, nothing is printed.  With \`--raw-output +\`, XSN is printed
  to <stdout>.

  Options
   -h, --help               Show this help text

  Diagnostic options
       --trace-parser       Trace parser
       --trace-parser-amb   Trace parser ambiguities
`);

optionProcessor.command('explain')
  .option('-h, --help')
  .positionalArgument('<message-id>')
  .help(`
  Usage: cdsc explain [options] <message-id>

  Explain the compiler message that has the given message-id.
  The explanation contains a faulty example and a solution.

  Use \`explain list\` to list all available messages.

  Options
   -h, --help        Show this help text
`);

optionProcessor.command('inspect')
  .option('-h, --help')
  .option('    --statistics')
  .option('    --propagation <art>')
  .positionalArgument('<files...>')
  .help(`
  Usage: cdsc inspect [options] <files...>

  (internal): Inspect the CSN model compiled from the provided CDS files.

  Options
   -h, --help                Show this help text
       --statistics          Print model statistics
       --propagation <art>   Show propagation sources for <art>
`);

optionProcessor.command('forEffective')
  .option('-h, --help')
  .option('--resolve-simple-types <val>', { valid: [ 'true', 'false' ] } )
  .option('--resolve-projections <val>', { valid: [ 'true', 'false' ] } )
  .option('--remap-odata-annotations <val>', { valid: [ 'true', 'false' ] } )
  .option('--keep-localized <val>', { valid: [ 'true', 'false' ] } )
  .option('--effective-service-name <name>')
  .positionalArgument('<files...>')
  .help(`
  Usage: cdsc forEffective [options] <files...>

  (internal): Get the effective CSN model compiled from the provided CDS files.
  This command may change any time, including its name.
  Beta mode is required.

  Options
   -h, --help                            Show this help text
       --resolve-simple-types <val>      Resolve simple types:
                                          true: (default) resolve simple type references to their simple base type
                                          false:          do not resolve simple type references
       --resolve-projections <val>       Resolve projections:
                                          true: (default) transform projections into ordinary views with SELECT
                                          false:          leave them as real projections
       --remap-odata-annotations <val>   Remap OData annotations to ABAP annotations:
                                          true:           remap annotations
                                          false:(default) leave them as is
       --keep-localized <val>            Keep '.localized' property in the CSN:
                                          true:           property is kept
                                          false:(default) property is deleted
       --effective-service-name <name>   Filter the output CSN to only contain the given service
`);

optionProcessor.command('forSeal')
  .option('-h, --help')
  .option('--remap-odata-annotations <val>', { valid: [ 'true', 'false' ] } )
  .option('--derive-analytical-annotations <val>', { valid: [ 'true', 'false' ] })
  .positionalArgument('<files...>')
  .help(`
  Usage: cdsc forSeal [options] <files...>

  (internal): Get the SEAL CSN model compiled from the provided CDS files.

  Options
   -h, --help                            Show this help text
       --remap-odata-annotations <val>   Remap OData annotations to ABAP annotations:
                                          true: (default)   remap annotations
                                          false:            leave them as is
       --derive-analytical-annotations <val>    Set analytics annotations
                                          true:             set the annotations
                                          false: (default)  don't set them
`);

module.exports = {
  optionProcessor,
};
