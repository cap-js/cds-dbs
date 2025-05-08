
'use strict';

const {
  getLastPartOf, getLastPartOfRef,
  hasValidSkipOrExists, getNormalizedQuery,
  forEachDefinition, getResultingName,
  getVariableReplacement, pathName,
} = require('../model/csnUtils');
const { isBuiltinType, isMagicVariable } = require('../base/builtins');
const { forEach, forEachValue, forEachKey } = require('../utils/objectUtils');
const {
  renderFunc, cdsToSqlTypes, getHanaComment, hasHanaComment,
  getSqlSnippets, createExpressionRenderer, withoutCast,
  variableForDialect, isVariableReplacementRequired,
} = require('./utils/common');
const {
  getDeltaRenderer,
} = require('./utils/delta');
const {
  renderReferentialConstraint, getIdentifierUtils,
} = require('./utils/sql');
const DuplicateChecker = require('./DuplicateChecker');
const { checkCSNVersion } = require('../json/csnVersion');
const { timetrace } = require('../utils/timetrace');
const { isBetaEnabled, isDeprecatedEnabled } = require('../base/model');
const { smartFuncId } = require('../sql-identifier');
const { sortCsn } = require('../model/cloneCsn');
const { manageConstraints, manageConstraint } = require('./manageConstraints');
const { renderUniqueConstraintString, renderUniqueConstraintDrop, renderUniqueConstraintAdd } = require('./utils/unique');
const { ModelError, CompilerAssertion } = require('../base/error');
const { pathId } = require('../model/csnRefs');
const { transformExprOperators } = require('./utils/operators');
const { exprAsTree, condAsTree } = require('../model/xprAsTree');

class SqlRenderEnvironment {
  indent = '';
  path = null;
  alterMode = false;
  changeType = null;

  constructor(values) {
    Object.assign(this, values);
  }

  withIncreasedIndent() {
    return new SqlRenderEnvironment({ ...this, indent: `  ${ this.indent }` });
  }
  withSubPath(path) {
    return new SqlRenderEnvironment({ ...this, path: [ ...this.path, ...path ] });
  }
  cloneWith(values) {
    return Object.assign(new SqlRenderEnvironment(this), values);
  }
}


/**
 * Render the CSN model 'model' to SQL DDL statements. One statement is created
 * per top-level artifact into dictionaries 'hdbtable', 'hdbview', ..., without
 * leading CREATE, without trailing semicolon. All corresponding statements (in
 * proper order) are copied into dictionary 'sql', with trailing semicolon.
 * Also included in the result are dictionaries 'deletions' and 'migrations',
 * keyed by entity name, which reflect statements needed for deleting or changing
 * (migrating) entities.
 * In the case of 'deletions', each entry contains the corresponding DROP statement.
 * In the case of 'migrations', each entry is an array of objects representing
 * changes to the entity. Each change object contains one or more SQL statements
 * (concatenated to one string using \n) and information whether these incur
 * potential data loss.
 *
 * Return an object like this:
 * { "hdbtable": {
 *     "foo" : "COLUMN TABLE foo ...",
 *    },
 *   "hdbview": {
 *     "bar::wiz" : "VIEW \"bar::wiz\" AS SELECT \"x\" FROM ..."
 *   },
 *   "sql: {
 *     "foo" : "CREATE TABLE foo ...;\n",
 *     "bar::wiz" : "CREATE VIEW \"bar::wiz\" AS SELECT \"x\" FROM ...;\n"
 *   },
 *   "deletions": {
 *     "baz": "DROP TABLE baz"
 *   },
 *   "migrations": {
 *     "foo": [
 *       {
 *         "drop": false,
 *         "sql": "ALTER TABLE foo ALTER (elm DECIMAL(12, 9));"
 *       },
 *       {
 *         "drop": true,
 *         "sql": "ALTER TABLE foo DROP (eln);"
 *       },
 *       {
 *         "drop": false,
 *         "sql": "ALTER TABLE foo ADD (elt NVARCHAR(99));"
 *       }
 *     ]
 *   }
 * }
 *
 * @param {CSN.Model} csn HANA transformed CSN
 * @param {CSN.Options} options Transformation options
 * @param {object} messageFunctions Message functions such as `error()`, `info()`, …
 * @returns {object} Dictionary of artifact-type:artifacts, where artifacts is a dictionary of name:content
 */
function toSqlDdl( csn, options, messageFunctions ) {
  const withHanaAssociations = options.withHanaAssociations && options.sqlDialect === 'hana';

  timetrace.start('SQL rendering');
  const {
    error, warning, info, throwWithAnyError,
  } = messageFunctions;
  const { quoteSqlId, prepareIdentifier, renderArtifactName } = getIdentifierUtils(csn, options);
  const reportedMissingReplacements = Object.create(null);

  const exprRenderer = createExpressionRenderer({
    // FIXME: For the sake of simplicity, we should get away from all this uppercasing in toSql
    finalize: x => String(x).toUpperCase(),
    typeCast(x) {
      const typeRef = renderBuiltinType(x.cast.type) + renderTypeParameters(x.cast);
      return `CAST(${ this.renderExpr(withoutCast(x)) } AS ${ typeRef })`;
    },
    val: renderExpressionLiteral,
    enum(x) {
      // visitExpr first checks for `#`, then `val`:
      if (x.val !== undefined)
        return renderExpressionLiteral(x);
      error('expr-unexpected-enum', this.env.path, 'Enum values are not yet supported for conversion to SQL');
      return '';
    },
    ref(x) {
      return renderExpressionRef(x, this.env);
    },
    windowFunction( x) {
      return renderWindowFunction(smartFuncId(prepareIdentifier(x.func), options.sqlDialect), x, this.env);
    },
    func(x) {
      return renderFunc(smartFuncId(prepareIdentifier(x.func), options.sqlDialect), x, a => renderArgs(a, '=>', this.env, null), { messageFunctions, options, path: this.env.path });
    },
    xpr(x) {
      const env = this.env.withSubPath([ 'xpr' ]);
      if (this.isNestedXpr && !x.cast)
        return `(${ this.renderSubExpr(x.xpr, env) })`;
      return this.renderSubExpr(x.xpr, env);
    },
    SELECT( x) {
      return `(${ renderQuery(x, this.env.withIncreasedIndent()) })`;
    },
    SET( x) {
      return `(${ renderQuery(x, this.env.withIncreasedIndent()) })`;
    },
  });

  function renderExpr( x, env ) {
    // TODO:
    //   Can we to structurizing upfront?
    //   Neither condAsTree() nor exprAsTree() traverse `.args` / `.where`.
    //   This is fine, since renderExpr() calls itself for function arguments and filters.
    x = Array.isArray(x) ? condAsTree(x) : exprAsTree(x);
    x = transformExprOperators(x, options, messageFunctions, env);
    return exprRenderer.renderExpr(x, env);
  }

  const render = getDeltaRenderer(options, {
    renderElement,
    renderArtifactName,
    renderAssociationElement,
    quoteSqlId,
    renderStringForSql,
    activateAlterMode,
    getHanaComment,
    renderExpr,
  });

  // FIXME: Currently requires 'options.forHana', because it can only render HANA-ish SQL dialect
  if (!options.forHana && !isBetaEnabled(options, 'sqlExtensions'))
    throw new CompilerAssertion('to.sql can currently only be used with SAP HANA preprocessing');

  checkCSNVersion(csn, options);

  // The final result in hdb-kind-specific form, without leading CREATE, without trailing newlines
  // (note that the order here is relevant for transmission into 'mainResultObj.sql' below and that
  // the attribute names must be the HDI plugin names for --src hdi)
  // The result object may have a `sql` dictionary for `toSql`.
  const mainResultObj = {
    hdbtabletype: Object.create(null),
    hdbtable: Object.create(null),
    hdbindex: Object.create(null),
    hdbfulltextindex: Object.create(null),
    hdbview: Object.create(null),
    hdbconstraint: Object.create(null),
    deletions: Object.create(null),
    constraintDeletions: [],
    migrations: Object.create(null),
    hdbrole: Object.create(null),
    hdbsynonym: Object.create(null),
  };

  const sqlServiceEntities = Object.create(null);
  const dummySqlServiceEntities = Object.create(null);

  // Registries for artifact and element names per CSN section
  const definitionsDuplicateChecker = new DuplicateChecker(options.sqlMapping);
  const deletionsDuplicateChecker = new DuplicateChecker();
  const extensionsDuplicateChecker = new DuplicateChecker();
  const removeElementsDuplicateChecker = new DuplicateChecker();
  const changeElementsDuplicateChecker = new DuplicateChecker();

  // Render each artifact on its own
  forEachDefinition((options && options.testMode) ? sortCsn(csn, options) : csn, (artifact, artifactName) => {
    renderDefinitionInto(artifactName, artifact, mainResultObj, new SqlRenderEnvironment());
  });

  // Render each deleted artifact
  for (const artifactName in csn.deletions)
    renderArtifactDeletionInto(artifactName, csn.deletions[artifactName], mainResultObj);

  const supportsSqlExtensions = (options.sqlDialect === 'hana' || isBetaEnabled(options, 'sqlExtensions'));

  if (csn.changedPrimaryKeys && supportsSqlExtensions) {
    csn.changedPrimaryKeys = options.testMode ? sortCsn(csn.changedPrimaryKeys) : csn.changedPrimaryKeys;
    csn.changedPrimaryKeys.forEach((artifactName) => {
      const drop = render.dropKey(artifactName);
      addMigration(mainResultObj, artifactName, true, render.concat(...drop));
    });
  }

  // Render each artifact extension
  // Only SAP HANA SQL is currently supported.
  // Note that extensions may contain new elements referenced in migrations, thus should be compiled first.
  if (csn.extensions && supportsSqlExtensions) {
    csn.extensions = options.testMode ? sortCsn(csn.extensions) : csn.extensions;
    for (let i = 0; i < csn.extensions.length; ++i) {
      const extension = csn.extensions[i];
      if (extension.extend) {
        const artifactName = extension.extend;
        const artifact = csn.definitions[artifactName];
        const env = new SqlRenderEnvironment({ path: [ 'extensions', i ] });
        renderArtifactExtensionInto(artifactName, artifact, extension, mainResultObj, env);
      }
    }
  }

  // Render each artifact change
  // Only SAP HANA SQL is currently supported.
  if (csn.migrations && supportsSqlExtensions) {
    csn.migrations = options.testMode ? sortCsn(csn.migrations) : csn.migrations;
    for (const migration of csn.migrations) {
      if (migration.migrate) {
        const artifactName = migration.migrate;
        // There is no "migrations" property in client CSN, so for better locations, use
        // a path to the definition.
        const env = new SqlRenderEnvironment({ path: [ 'definitions', artifactName ] });
        renderArtifactMigrationInto(artifactName, csn.definitions[artifactName], migration, mainResultObj, env);
      }
    }
  }

  if (csn.changedPrimaryKeys && supportsSqlExtensions) {
    csn.changedPrimaryKeys = options.testMode ? sortCsn(csn.changedPrimaryKeys) : csn.changedPrimaryKeys;
    csn.changedPrimaryKeys.forEach((artifactName) => {
      const add = render.addKey(artifactName, csn.definitions[artifactName].elements);
      addMigration(mainResultObj, artifactName, true, render.concat(...add));
    });
  }

  // Can only happen for HDI based deployment
  // .hdbrole documentation: https://help.sap.com/docs/SAP_HANA_PLATFORM/3823b0f33420468ba5f1cf7f59bd6bd9/625d7733c30b4666b4a522d7fa68a550.html
  Object.keys(sqlServiceEntities).forEach((sqlServiceName) => {
    const accessRole = {
      role: {
        name: renderArtifactNameWithoutQuotes(`${ sqlServiceName }.access`),
        object_privileges: Object.entries(sqlServiceEntities[sqlServiceName]).map(([ name, entity ]) => ({
          name: renderArtifactNameWithoutQuotes(name),
          type: entity.query || entity.projection ? 'VIEW' : 'TABLE',
          privileges: [ 'SELECT' ],
          privileges_with_grant_option: [],
        })),
      },
    };

    if (accessRole.role.object_privileges.length > 0)
      mainResultObj.hdbrole[`${ sqlServiceName }_access`] = JSON.stringify(accessRole, null, 2);
  });

  // Can only happen for HDI based deployment
  Object.keys(dummySqlServiceEntities).forEach((sqlServiceName) => {
    const synonym = Object.create(null);
    Object.entries(dummySqlServiceEntities[sqlServiceName]).forEach(([ name ]) => {
      const artName = renderArtifactNameWithoutQuotes(name);
      const dummyArtName = renderArtifactNameWithoutQuotes(`dummy.${ name }`);
      synonym[artName] = {
        target: {
          object: dummyArtName,
        },
      };
    });

    mainResultObj.hdbsynonym[`${ sqlServiceName }`] = JSON.stringify(synonym, null, 2);
  });

  // trigger artifact and element name checks
  definitionsDuplicateChecker.check(error, options);
  extensionsDuplicateChecker.check(error);
  deletionsDuplicateChecker.check(error);

  // Throw exception in case of errors
  throwWithAnyError();

  // Transfer results from hdb-specific dictionaries into 'sql' dictionary in proper order if src === 'sql'
  // (relying on the order of dictionaries above)
  // FIXME: Should consider inter-view dependencies, too
  const sql = Object.create(null);

  // Handle hdbKinds separately from alterTable case
  const {
    // eslint-disable-next-line no-unused-vars
    deletions, constraintDeletions, migrations: _, ...hdbKinds
  } = mainResultObj;
  for (const hdbKind of Object.keys(hdbKinds)) {
    for (const name in mainResultObj[hdbKind]) {
      if (options.src === 'sql') {
        let sourceString = mainResultObj[hdbKind][name];
        // Hack: Other than in 'hdbtable' files, in HANA SQL COLUMN is not mandatory but default.
        if (options.sqlDialect === 'hana' && hdbKind === 'hdbtable' && sourceString.startsWith('COLUMN '))
          sourceString = sourceString.slice('COLUMN '.length);
        sql[name] = `CREATE ${ sourceString };`;
      }
    }
    if (options.src === 'sql')
      delete mainResultObj[hdbKind];
  }

  // add `ALTER TABLE ADD CONSTRAINT` statements per default for `to.sql` w/ dialect `hana` / `postgres`
  if (!options.constraintsInCreateTable && options.src === 'sql' && (options.sqlDialect === 'hana' || options.sqlDialect === 'postgres' /* || options.sqlDialect === 'sqlite' */)) {
    const constraints = Object.create(null);
    const alterStmts = manageConstraints(csn, options);

    forEachKey(alterStmts, (constraintName) => {
      if (!csn.unchangedConstraints?.has(constraintName))
        constraints[constraintName] = `${ alterStmts[constraintName] }`;
    });
    mainResultObj.constraints = constraints;
  }

  if (options.src === 'sql')
    mainResultObj.sql = sql;

  for (const name in deletions)
    deletions[name] = `${ deletions[name] }`;

  timetrace.stop('SQL rendering');
  return mainResultObj;

  /**
   * Render a definition into the appropriate dictionary of 'resultObj'.
   *
   * @param {string} artifactName Name of the artifact to render
   * @param {CSN.Artifact} art Artifact to render
   * @param {object} resultObj Result collector
   * @param {SqlRenderEnvironment} env Render environment
   */
  function renderDefinitionInto( artifactName, art, resultObj, env ) {
    env.path = [ 'definitions', artifactName ];
    // Ignore whole artifacts if forRelationalDB says so
    if (art.abstract || hasValidSkipOrExists(art)) {
      if (art.$dummyService) { // collect entities that are in an external ABAP sql service so we can render the .hdbsynonym later
        dummySqlServiceEntities[art.$dummyService] ??= Object.create(null);
        dummySqlServiceEntities[art.$dummyService][artifactName] = art;
      }

      return;
    }

    switch (art.kind) {
      case 'entity':
        if (art.$sqlService) { // collect entities that are in a sql service so we can render the .hdbrole later
          sqlServiceEntities[art.$sqlService] ??= Object.create(null);
          sqlServiceEntities[art.$sqlService][artifactName] = art;
        }

        if (art.query || art.projection) {
          const result = renderView(artifactName, art, env);
          if (result)
            resultObj.hdbview[artifactName] = result;
        }
        else {
          renderEntityInto(artifactName, art, resultObj, env);
        }
        break;
      case 'type':
      case 'context':
      case 'service':
      case 'namespace':
      case 'annotation':
      case 'action':
      case 'function':
      case 'event':
      case 'aspect':
        // Ignore: not SQL-relevant
        return;
      default:
        throw new ModelError(`Unknown artifact kind: ${ art.kind }`);
    }
  }

  /**
   * Render the given artifactName according to the sqlMapping, but
   * - uppercased for plain
   * - without enclosing " for quoted/hdbcds
   *
   * @param {string} artifactName
   * @returns {string}
   */
  function renderArtifactNameWithoutQuotes( artifactName ) {
    if (options.sqlMapping === 'plain')
      return renderArtifactName(artifactName).toUpperCase();
    return renderArtifactName(artifactName).slice(1, -1); // trim leading/trailing "
  }

  /**
   * Render an artifact extension into the appropriate dictionary of 'resultObj'.
   * Only SAP HANA SQL is currently supported.
   *
   * @param {string} artifactName Name of the artifact to render
   * @param {CSN.Artifact} artifact The complete artifact
   * @param {CSN.Artifact} ext Extension to render
   * @param {object} resultObj Result collector
   * @param {SqlRenderEnvironment} env Render environment
   */
  function renderArtifactExtensionInto( artifactName, artifact, ext, resultObj, env ) {
    // Property kind is always omitted for elements and can be omitted for
    // top-level type definitions, it does not exist for extensions.
    if (artifactName && !ext.query) {
      if (ext.constraint)
        renderConstraintExtendInto(artifactName, ext, resultObj);
      else
        renderExtendInto(artifactName, artifact.elements, ext.elements, resultObj, env, extensionsDuplicateChecker);
    }

    if (!artifactName)
      throw new ModelError(`Undefined artifact name: ${ artifactName }`);
  }

  // Render an artifact deletion into the appropriate dictionary of 'resultObj'.
  function renderArtifactDeletionInto( artifactName, art, resultObj ) {
    const tableName = renderArtifactName(artifactName);
    deletionsDuplicateChecker.addArtifact(tableName, art.$location, artifactName);

    addDeletion(resultObj, artifactName, `-- [WARNING] this statement is lossy\nDROP TABLE ${ tableName }`);
  }

  // Render an artifact migration into the appropriate dictionary of 'resultObj'.
  // Only SAP HANA SQL is currently supported.
  function renderArtifactMigrationInto( artifactName, artifact, migration, resultObj, env ) {
    function reducesTypeSize( def ) {
      // HANA does not allow decreasing the value of any of those type parameters.
      return def.old.type === def.new.type &&
        [ 'length', 'precision', 'scale' ].some(param => def.new[param] < def.old[param]);
    }
    function getEltStr( defVariant, eltName, changeType = 'extension' ) {
      return defVariant.target
        ? renderAssociationElement(eltName, defVariant, env)
        : renderElement(eltName, defVariant, null, null, activateAlterMode(env, changeType));
    }
    function getEltStrNoProps( defVariant, eltName, ...props ) {
      const defNoProps = Object.assign({}, defVariant);
      for (const prop of props)
        delete defNoProps[prop];
      return getEltStr(defNoProps, eltName);
    }
    function oldAnnoChangedIncompatibly( defOld, defNew ) {
      return typeof defOld === 'string' && defOld.trim().length && !(typeof defNew === 'string' && defNew.trim().startsWith(`${ defOld.trim() } `));
    }
    function getUnknownSqlReason( anno, artName, defOld, defNew, eltName ) {
      const changeKind = defNew === undefined
        ? `removed (previous value: ${ JSON.stringify(defOld) })`
        : `changed from ${ JSON.stringify(defOld) } to ${ JSON.stringify(defNew) }`;
      return eltName
        ? `annotation ${ anno } of element ${ artName }:${ eltName } has been ${ changeKind }`
        : `annotation ${ anno } of artifact ${ artName } has been ${ changeKind }`;
    }

    const sqlSnippetAnnos = [ '@sql.prepend', '@sql.append' ];

    const tableName = renderArtifactName(artifactName);

    // Change entity properties
    if (migration.properties) {
      for (const [ prop, def ] of Object.entries(migration.properties)) {
        if (prop === 'doc' && !options.disableHanaComments) { // def.new may be `null`
          const alterComment = render.alterEntityComment(artifactName, def.new);
          addMigration(resultObj, artifactName, false, alterComment);
        }
        else if (sqlSnippetAnnos.includes(prop)) { // NOTE: @sql.replace may be supported in the future
          if (oldAnnoChangedIncompatibly(def.old, def.new)) {
            // anno was previously set and current change is not simply an appendix → previous anno would have to be reverted → unknown SQL
            addMigration(resultObj, artifactName, false, null, getUnknownSqlReason(prop, artifactName, def.old, def.new));
          }
          else {
            addMigration(resultObj, artifactName, false, render.alterEntitySqlSnippet(artifactName, def.new));
          }
        }
      }
    }

    // Drop columns (unsupported in sqlite)
    if (migration.remove) {
      const entries = Object.entries(migration.remove);
      if (entries.length) {
        const removeCols = entries.filter(([ , value ]) => !value.target).map(([ key ]) => quoteSqlId(key));
        const removeAssocs = entries.filter(([ , value ]) => value.target).map(([ key ]) => quoteSqlId(key));

        removeElementsDuplicateChecker.addArtifact(tableName, undefined, artifactName);
        [ ...removeCols, ...removeAssocs ].forEach(element => removeElementsDuplicateChecker.addElement(quoteSqlId(element), undefined, element));

        // Remove columns.
        if (removeCols.length)
          addMigration(resultObj, artifactName, true, render.dropColumns(artifactName, removeCols).map(s => (options.src !== 'hdi' ? `-- [WARNING] this statement is lossy\n${ s }` : s)));

        // Remove associations.
        removeAssocs.forEach(assoc => addMigration(resultObj, artifactName, true, render.dropAssociation(artifactName, assoc)));
      }
    }

    if (migration.removeConstraints) {
      const constraintTypes = [ 'unique', 'referential' ];
      constraintTypes.forEach((constraintType) => {
        if (migration.removeConstraints[constraintType]) {
          const entries = Object.entries(migration.removeConstraints[constraintType]);
          const optionsWithDrop = { ...options, drop: true };
          let renderer;
          if (constraintType === 'referential')
            renderer = constraint => manageConstraint(constraint, csn, optionsWithDrop, '', quoteSqlId);
          else
            renderer = (constraint, constraintName) => renderUniqueConstraintDrop(constraint, renderArtifactName(`${ artifactName }_${ constraintName }`), tableName, quoteSqlId);
          entries.forEach(( [ constraintName, constraint ]) => {
            addConstraintDeletion(resultObj, constraint.parentTable, renderer(constraint, constraintName));
          });
        }
      });
    }

    // Change column types (unsupported in sqlite)
    if (migration.change) {
      changeElementsDuplicateChecker.addArtifact(tableName, undefined, artifactName);
      for (const [ eltName, def ] of Object.entries(migration.change)) {
        const sqlId = quoteSqlId(eltName);
        changeElementsDuplicateChecker.addElement(sqlId, undefined, eltName);

        const eltStrOld = getEltStr(def.old, eltName, 'migration');
        const eltStrNew = getEltStr(def.new, eltName, 'migration');
        if (eltStrNew === eltStrOld)
          continue; // Prevent spurious migrations, where the column DDL does not change.

        const annosIncompat = [];
        sqlSnippetAnnos
          .filter(anno => def.old[anno] !== def.new[anno])
          .forEach((anno) => { // NOTE: @sql.replace may be supported in the future
            if (oldAnnoChangedIncompatibly(def.old[anno], def.new[anno])) {
              annosIncompat.push(anno);
              // anno was previously set and current change is not simply an appendix → previous anno would have to be reverted → unknown SQL
              addMigration(resultObj, artifactName, false, null, getUnknownSqlReason(anno, artifactName, def.old[anno], def.new[anno], eltName));
            }
          });

        if (annosIncompat.length) {
          const eltStrOldNoAnnos = getEltStrNoProps(def.old, eltName, ...annosIncompat);
          const eltStrNewNoAnnos = getEltStrNoProps(def.new, eltName, ...annosIncompat);
          if (eltStrOldNoAnnos === eltStrNewNoAnnos) { // only incompatibly-changed annos were modified
            continue;
          }
        }

        if (!options.disableHanaComments && def.old.doc !== def.new.doc) {
          const eltStrOldNoDoc = getEltStrNoProps(def.old, eltName, 'doc');
          const eltStrNewNoDoc = getEltStrNoProps(def.new, eltName, 'doc');
          if (eltStrOldNoDoc === eltStrNewNoDoc) { // only `doc` changed
            const alterComment = render.alterColumnComment(artifactName, sqlId, def.new.doc);
            addMigration(resultObj, artifactName, false, alterComment);
            continue;
          }
        }

        if (options.sqlChangeMode === 'drop' || def.old.target || def.new.target || (reducesTypeSize(def) && options.src === 'hdi')) {
          // Lossy change because either an association is removed and/or added, or the type size is reduced.
          // Drop old element and re-add it in its new shape.
          const drop = def.old.target
            ? render.dropAssociation(artifactName, sqlId)
            : render.dropColumns(artifactName, [ sqlId ]);
          const add = def.new.target
            ? render.addAssociations(artifactName, { [eltName]: def.new }, env)
            : render.addColumnsFromElementsObj(artifactName, { [eltName]: def.new }, env);
          addMigration(resultObj, artifactName, true, render.concat(...drop, ...add).map(s => (def.lossy !== undefined && options.src !== 'hdi' ? `-- [WARNING] this statement could ${ def.lossy ? 'be lossy' : 'fail' }: ${ def.details }\n${ s }` : s)));
        }
        else { // Lossless change: no associations directly affected, no size reduction.
          addMigration(resultObj, artifactName, false, render.alterColumns(artifactName, sqlId, def, eltStrNew, eltName, activateAlterMode(env, 'migration')).map(s => (def.lossy !== undefined ? `-- [WARNING] this statement could ${ def.lossy ? 'be lossy' : 'fail' }: ${ def.details }\n${ s }` : s)));
        }
      }
    }

    if (render.getConsolidatedAlterColumn) {
      const consolidated = render.getConsolidatedAlterColumn(artifactName);
      if (consolidated)
        addMigration(resultObj, artifactName, false, consolidated);
    }
  }

  /**
   * Render a (non-projection, non-view) entity (and possibly its indices) into the appropriate
   * dictionaries of 'resultObj'.
   *
   * @param {string} artifactName Name of the artifact to render
   * @param {CSN.Artifact} art Artifact to render
   * @param {object} resultObj Result collector
   * @param {SqlRenderEnvironment} env Render environment
   */
  function renderEntityInto( artifactName, art, resultObj, env ) {
    const childEnv = env.withIncreasedIndent();
    // tables can have @sql.prepend and @sql.append
    const { front, back } = getSqlSnippets(options, art);
    let result = front;
    // Only SAP HANA has row/column tables
    if (options.sqlDialect === 'hana') {
      if (art.technicalConfig?.hana?.storeType) {
        // Explicitly specified
        result += `${ art.technicalConfig.hana.storeType.toUpperCase() } `;
      }
      else if (!front) {
        // in 'hdbtable' files, COLUMN or ROW is mandatory, and COLUMN is the default
        result += 'COLUMN ';
      }
    }
    const tableName = renderArtifactName(artifactName);
    definitionsDuplicateChecker.addArtifact(art['@cds.persistence.name'], art.$location, artifactName);
    result += `TABLE ${ tableName }`;
    result += ' (\n';
    result += Object.keys(art.elements)
      .map(eltName => renderElement(eltName, art.elements[eltName], definitionsDuplicateChecker, getFzIndex(eltName, art.technicalConfig?.hana), childEnv))
      .filter(s => s !== '')
      .join(',\n');

    const uniqueFields = Object.keys(art.elements).filter(name => art.elements[name].unique && !art.elements[name].virtual)
      .map(name => quoteSqlId(name))
      .join(', ');
    if (uniqueFields !== '')
      result += `,\n${ childEnv.indent }UNIQUE(${ uniqueFields })`;

    const primaryKeys = render.primaryKey(art.elements);
    if (primaryKeys !== '')
      result += `,\n${ childEnv.indent }${ primaryKeys }`;

    // for `to.sql` w/ dialect `hana` the constraints will be part of the alter statement
    const constraintsAsAlter = !options.constraintsInCreateTable && options.src === 'sql' && (options.sqlDialect === 'hana' || options.sqlDialect === 'postgres');
    if (!constraintsAsAlter && art.$tableConstraints?.referential) {
      const renderReferentialConstraintsAsHdbconstraint = options.src === 'hdi';
      const referentialConstraints = {};
      forEach(art.$tableConstraints.referential, ( fileName, referentialConstraint ) => {
        referentialConstraints[fileName] = renderReferentialConstraint(referentialConstraint, childEnv.indent, false, csn, options);
      });
      if (renderReferentialConstraintsAsHdbconstraint) {
        forEach(referentialConstraints, (fileName, constraint ) => {
          resultObj.hdbconstraint[fileName] = constraint;
        });
      }
      else {
        forEachValue(referentialConstraints, (constraint) => {
          result += `,\n${ constraint }`;
        });
      }
    }
    // Append table constraints if any
    // 'CONSTRAINT <name> UNIQUE (<column_list>)
    // OR create a unique index for HDI
    const uniqueConstraints = art.$tableConstraints?.unique;
    for (const cn in uniqueConstraints) {
      const constraint = renderUniqueConstraintString(uniqueConstraints[cn], renderArtifactName(`${ artifactName }_${ cn }`), tableName, quoteSqlId, options);
      if (options.src === 'hdi')
        resultObj.hdbindex[`${ artifactName }.${ cn }`] = constraint;
      else
        result += `,\n${ childEnv.indent }${ constraint }`;
    }
    result += `${ env.indent }\n)`;

    if (options.sqlDialect === 'hana')
      result += renderTechnicalConfiguration(art.technicalConfig, childEnv);


    if (withHanaAssociations) {
      const associations = Object.keys(art.elements)
        .map(name => renderAssociationElement(name, art.elements[name], childEnv))
        .filter(s => s !== '')
        .join(',\n');
      if (associations !== '') {
        result += `${ env.indent } WITH ASSOCIATIONS (\n${ associations }\n`;
        result += `${ env.indent })`;
      }
    }
    // Only HANA has indices
    // FIXME: Really? We should provide a DB-agnostic way to specify that
    if (options.sqlDialect === 'hana')
      renderIndexesInto(art.technicalConfig?.hana?.indexes, artifactName, resultObj, env);

    if (options.sqlDialect === 'hana' && hasHanaComment(art, options))
      result += ` COMMENT ${ renderStringForSql(getHanaComment(art), options.sqlDialect) }`;

    if (back)
      result += back;

    resultObj.hdbtable[artifactName] = result;
  }

  /**
   * Render an extended entity constraint into the appropriate dictionaries of 'resultObj'.
   * Only SAP HANA SQL is currently supported.
   *
   * @param {string} artifactName Name of the artifact to render
   * @param {object} ext Constraint comprising the extension
   * @param {object} resultObj Result collector
   */
  function renderConstraintExtendInto( artifactName, { constraint, constraintName, constraintType }, resultObj ) {
    const result = constraintType === 'unique' ? renderUniqueConstraintAdd(constraint, renderArtifactName(`${ artifactName }_${ constraintName }`), renderArtifactName(constraint.parentTable), quoteSqlId, options)
      : manageConstraint(constraint, csn, options, '', quoteSqlId);

    addMigration(resultObj, artifactName, false, [ result ]);
  }


  /**
   * Render an extended entity into the appropriate dictionaries of 'resultObj'.
   * Only SAP HANA SQL is currently supported.
   *
   * @param {string} artifactName Name of the artifact to render
   * @param {object} artifactElements Elements comprising the artifact
   * @param {object} extElements Elements comprising the extension
   * @param {object} resultObj Result collector
   * @param {SqlRenderEnvironment} env Render environment
   * @param {DuplicateChecker} duplicateChecker
   */
  function renderExtendInto( artifactName, artifactElements, extElements, resultObj, env, duplicateChecker ) {
    const tableName = renderArtifactName(artifactName);
    if (duplicateChecker)
      duplicateChecker.addArtifact(tableName, undefined, artifactName);
    const elements = render.addColumnsFromElementsObj(artifactName, extElements, env, duplicateChecker);
    const associations = render.addAssociations(artifactName, extElements, env);
    if (elements.length + associations.length > 0)
      addMigration(resultObj, artifactName, false, [ ...elements, ...associations ]);
  }

  function addMigration( resultObj, artifactName, drop, sqlArray, description ) {
    if (!(artifactName in resultObj.migrations))
      resultObj.migrations[artifactName] = [];

    if (!sqlArray) {
      if (description)
        resultObj.migrations[artifactName].push({ description });
      return;
    }
    const migrations = sqlArray.map(migrationSql => ({ drop, sql: migrationSql }));
    resultObj.migrations[artifactName].push(...migrations);
  }

  function addConstraintDeletion( resultObj, artifactName, deletionSql ) {
    resultObj.constraintDeletions.push(deletionSql);
  }
  function addDeletion( resultObj, artifactName, deletionSql ) {
    resultObj.deletions[artifactName] = deletionSql;
  }

  /**
   * Retrieve the 'fzindex' (fuzzy index) property (if any) for element 'elemName' from hanaTc (if defined)
   *
   * @param {string} elemName Element to retrieve the index for
   * @param {object} hanaTc Technical configuration object
   * @returns {object} fzindex for the element
   */
  function getFzIndex( elemName, hanaTc ) {
    if (!hanaTc?.fzindexes?.[elemName])
      return undefined;

    if (Array.isArray(hanaTc.fzindexes[elemName][0])) {
      // FIXME: Should we allow multiple fuzzy search indices on the same column at all?
      // And if not, why do we wrap this into an array?
      return hanaTc.fzindexes[elemName][hanaTc.fzindexes[elemName].length - 1];
    }

    return hanaTc.fzindexes[elemName];
  }


  /**
   * Render an element 'elm' with name 'elementName' (of an entity or type, not of a
   * projection or view), optionally with corresponding fuzzy index 'fzindex' from the
   * technical configuration.
   * Ignore association elements (those are rendered later by renderAssociationElement).
   * Return the resulting source string (no trailing LF).
   *
   * @param {string} elementName Name of the element to render
   * @param {CSN.Element} elm CSN element
   * @param {DuplicateChecker} duplicateChecker Utility for detecting duplicates
   * @param {object} fzindex Fzindex object for the element
   * @param {SqlRenderEnvironment} env Render environment
   * @returns {string} Rendered element
   */
  function renderElement( elementName, elm, duplicateChecker, fzindex, env ) {
    if (elm.virtual || elm.target)
      return '';
    env = env.withSubPath([ 'elements', elementName ]);
    const isPostgresAlterColumn = env.alterMode && env.changeType === 'migration' && options.sqlDialect === 'postgres';
    const quotedElementName = quoteSqlId(elementName);
    if (duplicateChecker)
      duplicateChecker.addElement(quotedElementName, elm.$location, elementName);

    let result = `${ env.indent + quotedElementName }${ isPostgresAlterColumn ? ' TYPE' : '' } ${ renderTypeReference(elm, env)
    }${ renderNullability(elm, true, env.alterMode) }`;
    // calculated elements (on write) can't have a default; ignore it
    if (elm.$default && env.alterMode && !elm.value && options.sqlDialect !== 'postgres')
      result += ` DEFAULT ${ renderExpr(elm.$default, env.withSubPath([ '$default' ])) }`;
    else if (elm.default && !elm.value)
      result += ` DEFAULT ${ renderExpr(elm.default, env.withSubPath([ 'default' ])) }`;

    // Only SAP HANA has fuzzy indices
    if (fzindex && options.sqlDialect === 'hana')
      result += ` ${ renderExpr(fzindex, env) }`;

    // (table) elements can only have a @sql.append
    const { back } = getSqlSnippets(options, elm);
    result += back; // Needs to be rendered before the COMMENT

    if (options.sqlDialect === 'hana' && hasHanaComment(elm, options))
      result += ` COMMENT ${ renderStringForSql(getHanaComment(elm), options.sqlDialect) }`;

    return result;
  }


  /**
   * Render an element 'elm' with name 'elementName' if it is an association, in the style required for
   * HANA native associations (e.g. 'MANY TO ONE JOIN "source" AS "assoc" ON (condition)').
   * Return a string with one line per association element, or an empty string if the element
   * is not an association.
   * Any change to the cardinality rendering must be reflected in A2J mapAssocToJoinCardinality() as well.
   *
   * @param {string} elementName Name of the element to render
   * @param {CSN.Element} elm CSN element
   * @param {SqlRenderEnvironment} env Render environment
   * @returns {string} Rendered association element
   */
  function renderAssociationElement( elementName, elm, env ) {
    env = env.withSubPath([ 'elements', elementName ]);
    let result = '';
    if (elm.target) {
      result += env.indent;
      if (elm.cardinality) {
        if (isBetaEnabled(options, 'hanaAssocRealCardinality') && elm.cardinality.src === 1)
          result += 'ONE TO ';
        else
          result += 'MANY TO ';

        if (elm.cardinality.max === '*' || Number(elm.cardinality.max) > 1)
          result += 'MANY';
        else
          result += 'ONE';
      }
      else {
        result += 'MANY TO ONE';
      }
      result += ' JOIN ';
      result += `${ renderArtifactName(elm.target) } AS ${ quoteSqlId(elementName) } ON (`;
      result += `${ renderExpr(elm.on, env.withSubPath([ 'on' ])) })`;
    }
    return result;
  }


  /**
   * Render the 'technical configuration { ... }' section of an entity that comes as a suffix
   * to the CREATE TABLE statement (includes migration, unload prio, extended storage,
   * auto merge, partitioning, ...).
   * Return the resulting source string.
   *
   * @param {object} tc Technical configuration
   * @param {SqlRenderEnvironment} env Render environment
   * @returns {string} Rendered technical configuration
   */
  function renderTechnicalConfiguration( tc, env ) {
    let result = '';

    if (!tc)
      return result;


    // FIXME: How to deal with non-HANA technical configurations?
    // This also affects renderIndexes
    tc = tc.hana;
    if (!tc)
      throw new ModelError('Expecting a SAP HANA technical configuration');

    if (tc.tableSuffix) {
      // Although we could just render the whole bandwurm as one stream of tokens, the
      // compactor has kindly stored each part (e.g. `migration enabled` `row store`, ...)
      // in its own `xpr` (for the benefit of the `toCdl` renderer, which needs semicolons
      // between parts). We use this here for putting each one line)

      // This array contains technical configurations that are illegal in HANA SQL
      const ignore = [
        'PARTITION BY KEEPING EXISTING LAYOUT',
        'ROW STORE',
        'COLUMN STORE',
        'MIGRATION ENABLED',
        'MIGRATION DISABLED',
      ];
      for (const xpr of tc.tableSuffix) {
        const clause = renderExpr(xpr, env);
        if (!ignore.includes(clause.toUpperCase()))
          result += `\n${ env.indent }${ clause }`;
      }
    }
    return result;
  }

  /**
   * Render the array `indexes` from the technical configuration of an entity 'artifactName'
   *
   * @param {object} indexes Indices to render
   * @param {string} artifactName Artifact to render indices for
   * @param {object} resultObj Result collector
   * @param {SqlRenderEnvironment} env Render environment
   */
  function renderIndexesInto( indexes, artifactName, resultObj, env ) {
    // Indices and full-text indices
    for (const idxName in indexes || {}) {
      let result = '';
      if (Array.isArray(indexes[idxName][0])) {
        // FIXME: Should we allow multiple indices with the same name at all? (last one wins)
        for (const index of indexes[idxName])
          result = renderExpr(insertTableName(index), env);
      }
      else {
        result = renderExpr(insertTableName(indexes[idxName]), env);
      }
      // FIXME: Full text index should already be different in compact CSN
      if (result.startsWith('FULLTEXT'))
        resultObj.hdbfulltextindex[`${ artifactName }.${ idxName }`] = result;

      else
        resultObj.hdbindex[`${ artifactName }.${ idxName }`] = result;
    }


    /**
     * Insert 'artifactName' (quoted according to naming style) into the index
     * definition 'index' in two places:
     *   CDS:  unique index            "foo" on             (x, y)
     * becomes
     *   SQL:  unique index "<artifact>.foo" on "<artifact>"(x, y)
     * CDS does not need this because the index lives inside the artifact, but SQL does.
     *
     * @param {Array} index Index definition
     * @returns {Array} Index with artifact name inserted
     */
    function insertTableName( index ) {
      const i = index.indexOf('index');
      const j = index.indexOf('(');
      if (i > index.length - 2 || !index[i + 1].ref || j < i || j > index.length - 2)
        throw new ModelError(`Unexpected form of index: "${ index }"`);

      let indexName = renderArtifactName(`${ artifactName }.${ index[i + 1].ref }`);
      if (options.sqlMapping === 'plain')
        indexName = indexName.replace(/(\.|::)/g, '_');

      const result = index.slice(0, i + 1); // CREATE UNIQUE INDEX
      result.push({ ref: [ indexName ] }); // "<artifact>.foo"
      result.push(...index.slice(i + 2, j)); // ON
      result.push({ ref: [ renderArtifactName(artifactName) ] }); // <artifact>
      result.push(...index.slice(j)); // (x, y)
      return result;
    }
  }

  /**
   * Render the source of a query, which may be a path reference, possibly with an alias,
   * or a sub-select, or a join operation.
   *
   * Returns the source as a string.
   *
   * @param {object} source Query source
   * @param {SqlRenderEnvironment} env Render environment
   * @returns {string} Rendered view source
   */
  function renderQuerySource( source, env ) {
    // Sub-SELECT
    if (source.SELECT || source.SET) {
      let result = `(${ renderQuery(source, env.withIncreasedIndent()) })`;
      if (source.as)
        result += ` AS ${ quoteSqlId(source.as) }`;

      return result;
    }
    // JOIN
    else if (source.join) {
      // One join operation, possibly with ON-condition
      let result = `${ renderQuerySource(source.args[0], env.withSubPath([ 'args', 0 ])) }`;
      for (let i = 1; i < source.args.length; i++) {
        result = `(${ result } ${ source.join.toUpperCase() } `;
        if (options.sqlDialect === 'hana')
          result += renderJoinCardinality(source.cardinality);
        result += `JOIN ${ renderQuerySource(source.args[i], env.withSubPath([ 'args', i ])) }`;
        if (source.on)
          result += ` ON ${ renderExpr(source.on, env.withSubPath([ 'on' ])) }`;

        result += ')';
      }
      return result;
    }
    // Ordinary path, possibly with an alias

    // Sanity check
    if (!source.ref)
      throw new ModelError(`Expecting ref in ${ JSON.stringify(source) }`);

    return renderAbsolutePathWithAlias(source, env);
  }

  /**
   * Render the cardinality of a join/association
   *
   * @param {object} card CSN cardinality representation
   * @returns {string} Rendered cardinality
   */
  function renderJoinCardinality( card ) {
    let result = '';
    if (card) {
      if (card.srcmin === 1)
        result += 'EXACT ';
      result += card.src === 1 ? 'ONE ' : 'MANY ';
      result += 'TO ';
      if (card.min === 1)
        result += 'EXACT ';
      if (card.max)
        result += (card.max === 1) ? 'ONE ' : 'MANY ';
    }
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
   * @param {SqlRenderEnvironment} env Render environment
   * @returns {string} Rendered path
   */
  function renderAbsolutePathWithAlias( path, env ) {
    // This actually can't happen anymore because assoc2joins should have taken care of it
    if (path.ref[0].where)
      throw new ModelError(`"At ${ JSON.stringify(env.path) }": Filters in FROM are not supported for conversion to SQL (path: ${ JSON.stringify(path) })`);

    // SQL needs a ':' after path.ref[0] to separate associations
    let result = renderAbsolutePath(path, ':', env);

    // Take care of aliases
    const implicitAlias = path.ref.length === 0 ? getLastPartOf(getResultingName(csn, options.sqlMapping, path.ref[0])) : getLastPartOfRef(path.ref);
    if (path.as) {
      // Source had an alias - render it
      result += ` AS ${ quoteSqlId(path.as) }`;
    }
    else {
      const quotedAlias = quoteSqlId(implicitAlias);
      if (getLastPartOf(result) !== quotedAlias) {
        // Render an artificial alias if the result would produce a different one
        result += ` AS ${ quotedAlias }`;
      }
    }
    return result;
  }


  /**
   * Render a path that starts with an absolute name (as used e.g. for the source of a query),
   * with plain or quoted names, depending on options. Expects an object 'path' that has a 'ref'.
   * Uses <separator> (typically ':': or '.') to separate the first artifact name from any
   * subsequent associations.
   * Returns the name as a string.
   *
   * @param {object} path Path to render
   * @param {string} sep Separator between path steps
   * @param {SqlRenderEnvironment} env Render environment
   * @returns {string} Rendered path
   */
  function renderAbsolutePath( path, sep, env ) {
    // Sanity checks
    if (!path.ref)
      throw new ModelError(`Expecting ref in path: ${ JSON.stringify(path) }`);

    // Determine the absolute name of the first artifact on the path (before any associations or element traversals)
    const firstArtifactName = path.ref[0].id || path.ref[0];

    let result = renderArtifactName(firstArtifactName);
    // store argument syntax hint in environment
    // $syntax is set only by A2J and only at the first path step after FROM clause rewriting
    const syntax = path.ref[0].$syntax;
    // Even the first step might have parameters and/or a filter
    // Render the actual parameter list. If the path has no actual parameters,
    // the ref is not rendered as { id: ...; args: } but as short form of ref[0] ;)
    // An empty actual parameter list is rendered as `()`.
    const ref = csn.definitions[path.ref[0].id] || csn.definitions[path.ref[0]];
    if (ref?.params) {
      result += path.ref[0]?.args
        ? `(${ renderArgs(path.ref[0], '=>', env.withSubPath([ 'ref', 0 ]), syntax) })`
        : '()';
    }
    else if (syntax === 'udf') {
      // if syntax is user defined function, render empty argument list
      // CV without parameters is called as simple view
      result += '()';
    }
    if (path.ref[0].where) {
      const cardinality = path.ref[0].cardinality ? (`${ path.ref[0].cardinality.max }: `) : '';
      result += `[${ cardinality }${ renderExpr(path.ref[0].where, env.withSubPath([ 'ref', 0, 'where' ])) }]`;
    }

    // Add any path steps (possibly with parameters and filters) that may follow after that
    if (path.ref.length > 1)
      result += `${ sep }${ renderTypeRef({ ref: path.ref.slice(1) }, env) }`;

    return result;
  }


  /**
   * Render function arguments or view parameters (positional if array, named if object/dict),
   * using 'sep' as separator for positional parameters
   *
   * @param {object} node with `args` to render
   * @param {string} sep Separator between args
   * @param {SqlRenderEnvironment} env Render environment
   * @param {string|null} syntax Some magic A2J parameter - for calcview parameter rendering
   * @returns {string} Rendered arguments
   * @throws Throws if args is not an array or object.
   */
  function renderArgs( node, sep, env, syntax ) {
    if (!node.args)
      return '';
    // Positional arguments
    if (Array.isArray(node.args))
      return node.args.map((arg, i) => renderExpr(arg, env.withSubPath([ 'args', i ]))).join(', ');

    // Named arguments (object/dict)
    else if (typeof node.args === 'object')
      // if this is a function param which is not a reference to the model, we must not quote it
      return Object.keys(node.args).map(key => `${ node.func ? key : decorateParameter(key, syntax) } ${ sep } ${ renderExpr(node.args[key], env.withSubPath([ 'args', key ])) }`).join(', ');


    throw new ModelError(`Unknown args: ${ JSON.stringify(node.args) }`);


    /**
     * Render the given argument/parameter correctly.
     *
     * @param {string} arg Argument to render
     * @param {string|null} parameterSyntax Some magic A2J parameter - for calcview parameter rendering
     * @returns {string} Rendered argument
     */
    function decorateParameter( arg, parameterSyntax ) {
      if (parameterSyntax === 'calcview')
        return `PLACEHOLDER."$$${ arg }$$"`;

      return quoteSqlId(arg);
    }
  }

  /**
   * Render a single view column 'col', as it occurs in a select list or projection list.
   * Return the resulting source string (one line per column item, no CR).
   *
   * @param {object} col Column to render
   * @param {CSN.Elements} elements of leading or subquery
   * @param {SqlRenderEnvironment} env Render environment
   * @returns {string} Rendered column
   */
  function renderViewColumn( col, elements, env ) {
    let result = '';
    const leaf = col.as || col.ref?.[col.ref.length - 1] || col.func;
    if (leaf && elements[leaf]?.virtual) {
      if (isDeprecatedEnabled(options, '_renderVirtualElements'))
        // render a virtual column 'null as <alias>'
        result += `${ env.indent }NULL AS ${ quoteSqlId(col.as || leaf) }`;
    }
    else {
      result = env.indent + renderExpr(withoutCast(col), env);
      if (col.as)
        result += ` AS ${ quoteSqlId(col.as) }`;
      else if (col.func && !col.args) // e.g. CURRENT_TIMESTAMP
        result += ` AS ${ quoteSqlId(col.func) }`;
    }
    return result;
  }

  /**
   * Render a view
   *
   * @param {string} artifactName Name of the view
   * @param {CSN.Artifact} art CSN view
   * @param {SqlRenderEnvironment} env Render environment
   * @returns {string} Rendered view
   */
  function renderView( artifactName, art, env ) {
    const viewName = renderArtifactName(artifactName);
    definitionsDuplicateChecker.addArtifact(art['@cds.persistence.name'], art?.$location, artifactName);
    let result = `VIEW ${ viewName }`;

    if (options.sqlDialect === 'hana' && hasHanaComment(art, options))
      result += ` COMMENT ${ renderStringForSql(getHanaComment(art), options.sqlDialect) }`;

    result += renderParameterDefinitions(art.params, env);
    result += ` AS ${ renderQuery(getNormalizedQuery(art).query,
                                  env.withSubPath([ art.projection ? 'projection' : 'query' ]),
                                  art.elements, !!art.projection) }`;

    const childEnv = env.withIncreasedIndent();
    const associations = Object.keys(art.elements)
      .filter(name => !!art.elements[name].target)
      .map(name => renderAssociationElement(name, art.elements[name], childEnv))
      .filter(s => s !== '')
      .join(',\n');
    if (associations !== '' && withHanaAssociations) {
      result += `${ env.indent }\nWITH ASSOCIATIONS (\n${ associations }\n`;
      result += `${ env.indent })`;
    }

    // views can only have a @sql.append
    const { back } = getSqlSnippets(options, art);
    if (back)
      result += back;

    return result;
  }

  /**
   * Render the parameter definition of a view if any. Return the parameters in parentheses, or an empty string
   *
   * @param {Object} params Dictionary of parameters
   * @param {SqlRenderEnvironment} env
   * @returns {string} Rendered parameters
   */
  function renderParameterDefinitions( params, env ) {
    let result = '';
    if (params) {
      const parray = [];
      for (const pn in params) {
        const paramEnv = env.withSubPath([ 'params', pn ]);
        const p = params[pn];
        if (p.notNull === true || p.notNull === false)
          info('query-ignoring-param-nullability', paramEnv.path, { '#': 'sql' });
        // do not quote parameter identifiers for naming mode "quoted" / "hdbcds"
        // this would be an incompatible change, as non-uppercased, quoted identifiers
        // are rejected by the HANA compiler.
        let pIdentifier;
        if (options.sqlMapping === 'quoted' || options.sqlMapping === 'hdbcds')
          pIdentifier = prepareIdentifier(pn);
        else
          pIdentifier = quoteSqlId(pn);
        let pstr = `IN ${ pIdentifier } ${ renderTypeReference(p, paramEnv) }`;
        if (p.default)
          pstr += ` DEFAULT ${ renderExpr(p.default, new SqlRenderEnvironment({ ...env, indent: '' })) }`;

        parray.push(pstr);
      }
      result = `(${ parray.join(', ') })`;
    }
    return result;
  }

  /**
   * Render a query 'query', i.e. a select statement with where-condition etc.
   *
   * @param {CSN.Query} query CSN query
   * @param {SqlRenderEnvironment} env Render environment
   * @param {CSN.Elements} [elements] to override direct query elements - e.g. leading union should win
   * @param {boolean} [isProjection]
   * @returns {string} Rendered query
   */
  function renderQuery( query, env, elements = null, isProjection = false ) {
    let result = '';
    // Set operator, like UNION, INTERSECT, ...
    if (query.SET) {
      env = env.withSubPath([ 'SET' ]);
      result += query.SET.args
        .map((arg, index) => {
          // Wrap each query in the SET in parentheses that
          // - is a SET itself (to preserve precedence between the different SET operations),
          // - has an ORDER BY/LIMIT (because UNION etc. can't stand directly behind an ORDER BY)
          const argEnv = env.withSubPath([ 'args', index ]);
          const queryString = renderQuery( arg, argEnv, elements || query.SET.elements, false);
          return (arg.SET || arg.SELECT?.orderBy || arg.SELECT?.limit) ? `(${ queryString })` : queryString;
        })
        .join(`\n${ env.indent }${ query.SET.op?.toUpperCase() }${ query.SET.all ? ' ALL ' : ' ' }`);

      // Set operation may also have an ORDER BY and LIMIT/OFFSET (in contrast to the ones belonging to
      // each SELECT)
      // If the whole SET has an ORDER BY/LIMIT, wrap the part before that in parentheses
      // (otherwise some SQL implementations (e.g. sqlite) would interpret the ORDER BY/LIMIT as belonging
      // to the last SET argument, not to the whole SET)
      if (query.SET.orderBy || query.SET.limit) {
        result = `(${ result })`;
        if (query.SET.orderBy) {
          const orderBy = query.SET.orderBy.map(entry => renderOrderByEntry(entry, env.withSubPath([ 'orderBy' ]))).join(', ');
          result += `\n${ env.indent }ORDER BY ${ orderBy }`;
        }
        if (query.SET.limit) {
          const limit = renderLimit(query.SET.limit, env.withSubPath([ 'limit' ]));
          result += `\n${ env.indent }${ limit }`;
        }
      }

      return result;
    }
    // Otherwise must have a SELECT
    else if (!query.SELECT) {
      throw new ModelError(`Unexpected query operation ${ JSON.stringify(query) }`);
    }
    if (!isProjection)
      env = env.withSubPath([ 'SELECT' ]);
    const select = query.SELECT;
    const childEnv = env.withIncreasedIndent();
    result += `SELECT${ select.distinct ? ' DISTINCT' : '' }`;
    // FIXME: We probably also need to consider `excluding` here ?
    result += `\n${ (select.columns || [ '*' ])
      .map((col, index) => {
        if (!select.mixin?.[firstPathStepId(col.ref)]) {
          const colEnv = select.columns ? childEnv.withSubPath([ 'columns', index ]) : childEnv;
          return renderViewColumn(col, elements || select.elements, colEnv);
        }
        return ''; // No mixin columns
      })
      .filter(s => s !== '')
      .join(',\n') }\n`;
    result += `${ env.indent }FROM ${ renderQuerySource( select.from, env.withSubPath([ 'from' ])) }`;
    if (select.where)
      result += `\n${ env.indent }WHERE ${ renderExpr(select.where, env.withSubPath([ 'where' ])) }`;

    if (select.groupBy)
      result += `\n${ env.indent }GROUP BY ${ select.groupBy.map((expr, i) => renderExpr(expr, env.withSubPath([ 'groupBy', i ]))).join(', ') }`;

    if (select.having)
      result += `\n${ env.indent }HAVING ${ renderExpr(select.having, env.withSubPath([ 'having' ])) }`;

    if (select.orderBy)
      result += `\n${ env.indent }ORDER BY ${ select.orderBy.map((entry, i) => renderOrderByEntry(entry, env.withSubPath([ 'orderBy', i ]))).join(', ') }`;

    if (select.limit)
      result += `\n${ env.indent }${ renderLimit(select.limit, env.withSubPath([ 'limit' ])) }`;

    return result;
  }

  /**
   * Returns the id of the first path step in 'ref' if any, otherwise undefined
   *
   * @param {Array} ref Array of refs
   * @returns {string|undefined} Id of first path step
   */
  function firstPathStepId( ref ) {
    return (ref?.[0]?.id || ref?.[0]);
  }

  /**
   * Render a query's LIMIT clause, which may also have OFFSET.
   *
   * @param {CSN.QueryLimit} limit Limit clause
   * @param {SqlRenderEnvironment} env Render environment
   * @returns {string} Rendered LIMIT clause
   */
  function renderLimit( limit, env ) {
    let result = '';
    if (limit.rows !== undefined)
      result += `LIMIT ${ renderExpr(limit.rows, env.withSubPath([ 'rows' ])) }`;

    if (limit.offset !== undefined) {
      const indent = result !== '' ? `\n${ env.indent }` : '';
      result += `${ indent }OFFSET ${ renderExpr(limit.offset, env.withSubPath([ 'offset' ])) }`;
    }

    return result;
  }

  /**
   * Render one entry of a query's ORDER BY clause (which always has a 'value' expression, and may
   * have a 'sort' property for ASC/DESC and a 'nulls' for FIRST/LAST
   *
   * @param {object} entry Part of an ORDER BY
   * @param {SqlRenderEnvironment} env Render environment
   * @returns {string} Rendered ORDER BY entry
   */
  function renderOrderByEntry( entry, env ) {
    let result = renderExpr(entry, env);
    if (entry.sort)
      result += ` ${ entry.sort.toUpperCase() }`;

    if (entry.nulls)
      result += ` NULLS ${ entry.nulls.toUpperCase() }`;

    return result;
  }

  /**
   * Render a reference to the type used by 'elm'. env.path must point to the element/param.
   *
   * @param {CSN.Element} elm CSN element
   * @param {SqlRenderEnvironment} env
   * @returns {string} Rendered type reference
   */
  function renderTypeReference( elm, env ) {
    let result = '';

    if (!elm.type && !elm.value) {
      // Anonymous structured type: Not supported with SQL, but doesn't happen anyway after flattening.
      if (options.testMode)
        throw new ModelError(`to.sql(): Missing type of: ${ JSON.stringify(env.path) }`);
      return result;
    }
    else if (elm.target) {
      if (options.testMode)
        throw new ModelError(`to.sql(): Unexpected association in: ${ JSON.stringify(env.path) }`);
      return result;
    }

    if (elm.type) {
      // If we get here, it must be a primitive (i.e. builtin) type
      if (isBuiltinType(elm.type)) {
        // cds.Integer => render as INTEGER (no quotes)
        result += renderBuiltinType(elm.type);
        result += renderTypeParameters(elm);
      }
      else {
        throw new ModelError(`Unexpected non-primitive type of: ${ JSON.stringify(env.path) }`);
      }
    }

    if (elm.value) {
      if (!elm.value.stored)
        throw new CompilerAssertion('Found calculated element on-read in rendering; should have been replaced!');
      // The SQL standard 2016 describes the syntax in section 11.3 - 11.4
      // of the SQL Foundation spec (for 2003 in 5WD-02-Foundation-2003-09.pdf). Summarized:
      //   <generation clause> ::= GENERATED ALWAYS AS '(' <value expression> ')'
      result += ` GENERATED ALWAYS AS (${ renderExpr(elm.value, env.withSubPath([ 'value' ])) })`;
      // However, it appears many databases require a trailing "STORED".
      if (options.sqlDialect === 'sqlite' || options.sqlDialect === 'postgres')
        result += ' STORED';
      return result;
    }
    return result;
  }

  /**
   * Render the name of a builtin CDS type
   *
   * @param {string} typeName Name of the type
   * @returns {string} Rendered type
   */
  function renderBuiltinType( typeName ) {
    const types = cdsToSqlTypes[options.sqlDialect];
    const result = types?.[typeName] || cdsToSqlTypes.standard[typeName];
    if (!result && options.testMode)
      throw new CompilerAssertion(`Expected to find a type mapping for ${ typeName }`);
    return result || 'CHAR';
  }

  /**
   * Render the nullability of an element or parameter (can be unset, true, or false)
   *
   * @param {object} obj Object to render for
   * @param {boolean} treatKeyAsNotNull Whether to render KEY as not null
   * @param {boolean} deltaMode Look for a $notNull and use that with precedence over notNull
   * @returns {string} NULL/NOT NULL or ''
   */
  function renderNullability( obj, treatKeyAsNotNull = false, deltaMode = false ) {
    if (deltaMode && obj.$notNull !== undefined) { // can be set via compare.js if it goes from "not null" to implicit "null"
      return obj.$notNull ? ' NOT NULL' : ' NULL';
    }

    if (obj.notNull === undefined && !(obj.key && treatKeyAsNotNull)) {
      // Attribute not set at all
      return '';
    }
    return obj.notNull || obj.key ? ' NOT NULL' : ' NULL';
  }

  /**
   * Render (primitive) type parameters of element 'elm', i.e.
   * length, precision and scale (even if incomplete), plus any other unknown ones.
   *
   * @param {CSN.Element} elm CSN element
   * @returns {string} Rendered type parameters
   */
  function renderTypeParameters( elm ) {
    const params = [];
    // Length, precision and scale (even if incomplete)
    if (elm.length !== undefined)
      params.push(elm.length);

    if (elm.precision !== undefined)
      params.push(elm.precision);

    if (elm.scale !== undefined)
      params.push(elm.scale);

    if (elm.srid !== undefined) {
      // SAP HANA Geometry types translate into CHAR in plain/sqlite (give them the default length of 2000)
      if (options.sqlDialect !== 'hana')
        params.push(2000);
      else
        params.push(elm.srid);
    }
    return params.length === 0 ? '' : `(${ params.join(', ') })`;
  }

  function renderExpressionLiteral( x ) {
    // Literal value, possibly with explicit 'literal' property
    switch (x.literal || typeof x.val) {
      case 'number':
      case 'boolean':
      case 'null':
        // 17.42, NULL, TRUE
        return String(x.val).toUpperCase();
      case 'x':
        // x'f000'
        return `${ x.literal }'${ x.val }'`;
      case 'date':
      case 'time':
      case 'timestamp':
        if (options.sqlDialect === 'sqlite') {
          // simple string literal '2017-11-02'
          return `'${ x.val }'`;
        }
        // date'2017-11-02'
        return `${ x.literal }'${ x.val }'`;

      case 'string':
        // 'foo', with proper escaping
        return renderStringForSql(x.val, options.sqlDialect);
      case 'object':
        if (x.val === null)
          return 'NULL';

      // otherwise fall through to
      default:
        throw new ModelError(`Unknown literal or type: ${ JSON.stringify(x) }`);
    }
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
      return renderStringForSql(magicReplacement, options.sqlDialect);

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

    return renderStringForSql(name, options.sqlDialect);
  }

  /**
   * Must not be used for type refs, as something like `$user` will be interpreted as a magic
   * variable and not definition name.
   *
   * @param {object} x
   * @param {object} env
   * @return {string}
   */
  function renderExpressionRef( x, env ) {
    if (!x.param && isMagicVariable(pathId(x.ref[0])))
      return renderMagicVariable(x.ref, env);

    // FIXME: We currently cannot distinguish whether '$parameters' was quoted or not - we
    //        assume that it was not if the path has length 2
    if (firstPathStepId(x.ref) === '$parameters' && x.ref.length === 2) {
      // Parameters must be uppercased and unquoted in SQL
      return `:${ x.ref[1].toUpperCase() }`;
    }
    if (x.param)
      return `:${ x.ref[0].toUpperCase() }`;

    return x.ref.map((step, i) => renderPathStep(step, i, env.withSubPath([ 'ref', i ])))
      .filter(s => s !== '')
      .join('.');
  }

  function renderTypeRef( x, env ) {
    const prefix = x.param ? ':' : '';
    const ref = x.ref.map((step, index) => renderPathStep(step, index, env.withSubPath([ 'ref', index ]))).join('.');
    return `${ prefix }${ ref }`;
  }

  /**
   * Render a single path step 's' at path position 'idx', which can have filters or parameters or be a function
   *
   * @param {string|object} s Path step to render
   * @param {number} idx index of the path step in the overall path
   * @param {object} env
   * @returns {string} Rendered path step
   */
  function renderPathStep( s, idx, env ) {
    // Simple id or absolute name
    if (typeof (s) === 'string') {
      // Some magic for first path steps
      // Ignore initial $projection and initial $self
      if (idx === 0 && (s === '$projection' || s === '$self'))
        return '';
      return quoteSqlId(s);
    }
    // ID with filters or parameters
    else if (typeof s === 'object') {
      // Sanity check
      if (!s.func && !s.id)
        throw new ModelError(`Unknown path step object: ${ JSON.stringify(s) }`);

      // Not really a path step but an object-like function call
      if (s.func)
        return `${ s.func }(${ renderArgs(s, '=>', env, null) })`;

      // Path step, possibly with view parameters and/or filters
      let result = `${ quoteSqlId(s.id) }`;
      if (s.args) {
        // View parameters
        result += `(${ renderArgs(s, '=>', env, null) })`;
      }
      if (s.where) {
        // Filter, possibly with cardinality
        // FIXME: Does SQL understand filter cardinalities?
        const cardinality = s.cardinality ? (`${ s.cardinality.max }: `) : '';
        result += `[${ cardinality }${ renderExpr(s.where, env.withSubPath([ 'where' ])) }]`;
      }
      return result;
    }

    throw new ModelError(`Unknown path step: ${ JSON.stringify(s) }`);
  }


  function renderWindowFunction( funcName, node, fctEnv ) {
    let r = `${ funcName }(${ renderArgs(node, '=>', fctEnv, null) }) `;
    r += renderExpr(node.xpr, fctEnv.withSubPath([ 'xpr' ])); // xpr[0] is 'over'
    return r;
  }


  /**
   * Returns a copy of 'env' with alterMode set to true
   *
   * @param {SqlRenderEnvironment} env Render environment
   * @param {string} changeType 'extension' or 'migration'
   * @returns {object} Render environment with alterMode
   */
  function activateAlterMode( env, changeType ) {
    return env.cloneWith({ alterMode: true, changeType });
  }
}

/**
 * Render the given string for SQL databases.
 *
 * @param {string} str
 * @param {string} sqlDialect
 * @return {string}
 */
function renderStringForSql( str, sqlDialect ) {
  if (sqlDialect === 'hana' || sqlDialect === 'sqlite' || sqlDialect === 'h2') {
    // SQLite
    // ======
    // SQLite's tokenizer available at
    // <https://www.sqlite.org/src/file?name=src/tokenize.c>.
    //
    // Note that NUL may have side effects, as explained on
    // <https://sqlite.org/nulinstr.html>.
    //
    //
    // H2
    // ======
    // H2's tokenizer available at
    // <https://github.com/h2database/h2database/blob/master/h2/src/main/org/h2/command/Tokenizer.java>.
    // For strings, see method "readCharacterString()".
    //
    //
    // HANA
    // ====
    // Respects the specification available at
    // <https://help.sap.com/doc/9b40bf74f8644b898fb07dabdd2a36ad/2.0.04/en-US/SAP_HANA_SQL_Reference_Guide_en.pdf>.
    //
    //   <string_literal> ::= <single_quote>[<any_character>...]<single_quote>
    //   <single_quote> ::= '
    //
    //  and
    //  > # Quotation marks
    //  > Single quotation marks are used to delimit string literals.
    //  > A single quotation mark itself can be represented using two single quotation marks.
    str = str.replace(/'/g, '\'\'')
      // eslint-disable-next-line no-control-regex
      .replace(/\u{0}/ug, '\' || CHAR(0) || \'');
  }
  else {
    // Generic SQL databases
    // =====================
    // While escaping NUL may be useful to avoid the SQL file being identified as binary,
    // we can't escape it using `CHAR(0)`.  This function is not available on e.g. PostgreSQL.
    // On top of this, PostgreSQL also has this limitation:
    // > chr(int) | text | Character with the given code. For UTF8 the argument is treated as a Unicode code point.
    // >          |      | For other multibyte encodings the argument must designate an ASCII character. The NULL (0)
    // >          |      | character is not allowed because text data types cannot store such bytes.
    // - <https://www.postgresql.org/docs/9.1/functions-string.html>
    str = str.replace(/'/g, '\'\'');
  }
  return `'${ str }'`;
}

module.exports = {
  toSqlDdl,
};
