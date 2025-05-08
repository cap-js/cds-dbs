'use strict';

const { setProp, isBetaEnabled } = require('../base/model');
const { forEachMemberRecursively, forAllQueries, applyTransformationsOnNonDictionary,
        getArtifactDatabaseNameOf, getElementDatabaseNameOf, applyTransformations,
        walkCsnPath, isPersistedOnDatabase
      } = require('../model/csnUtils');
const transformUtils = require('./transformUtils');
const { translateAssocsToJoinsCSN } = require('./translateAssocsToJoins');
const { csnRefs, pathId, traverseQuery, columnAlias} = require('../model/csnRefs');
const { checkCSNVersion } = require('../json/csnVersion');
const validate = require('../checks/validator');
const { rejectManagedAssociationsAndStructuresForHdbcdsNames } = require('../checks/selectItems');
const { addTenantFields } = require('../transform/addTenantFields');
const { addLocalizationViewsWithJoins, addLocalizationViews } = require('../transform/localized');
const { timetrace } = require('../utils/timetrace');
const { createReferentialConstraints, assertConstraintIdentifierUniqueness } = require('./db/constraints');
const { forEach } = require('../utils/objectUtils');
const handleExists = require('./db/assocsToQueries/transformExists');
const { rewriteCalculatedElementsInViews, processCalculatedElementsInEntities } = require('./db/rewriteCalculatedElements');
const replaceAssociationsInGroupByOrderBy = require('./db/groupByOrderBy');
const _forEachDefinition = require('../model/csnUtils').forEachDefinition;
const flattening = require('./db/flattening');
const expansion = require('./db/expansion');
const assertUnique = require('./db/assertUnique');
const generateDrafts = require('./draft/db');
const enrichUniversalCsn = require('./universalCsn/universalCsnEnricher');
const { getViewTransformer, ensureColumnNames } = require('./db/views');
const cdsPersistence = require('./db/cdsPersistence');
const temporal = require('./db/temporal');
const associations = require('./db/associations');
const backlinks = require('./db/backlinks');
const { getDefaultTypeLengths } = require('../render/utils/common');
const { featureFlags } = require('./featureFlags');
const { cloneCsnNonDict, cloneFullCsn } = require('../model/cloneCsn');
const { processSqlServices, createServiceDummy  } = require('./db/processSqlServices');

// By default: Do not process non-entities/views
function forEachDefinition(csn, cb) {
  _forEachDefinition(csn, cb, {skip: ['annotation', 'action', 'function','event']})
}

/**
 * Return a copy of the compact CSN model with a number of transformations made for rendering
 * in HANA CDS style, used by 'toHana', toSql' and 'toRename'.
 * The behavior is controlled by the following options:
 * options = {
 *    sqlMapping // See the behavior of 'sqlMapping' in toHana, toSql and toRename
 * }
 * The result model will always have 'options.forHana' set, to indicate that these transformations have happened.
 * The following transformations are made:
 * - (000) Some primitive type names are mapped to HANA type names (e.g. DateTime => UTCDateTime,
 *         Date => LocalDate, ...).The primitive type 'UUID' is renamed to 'String' (see also 060 below).
 * - (001) Add a temporal where condition to views where applicable before assoc2join
 * - (010) (not for to.hdbcds with hdbcds names): Transform associations to joins
 * - (015) Draft shadow entities are generated for entities/views annotated with '@odata.draft.enabled'.
 * - (020) Check: in "plain" mode, quoted ids are not allowed.
 *         (a) check in namespace declarations
 *         (b) check in artifact/element definitions.
 * - (040) Abstract entities and entities 'implemented in' something are ignored, as well
 *         as entities annotated with '@cds.persistence.skip' or '@cds.persistence.exists'.
 * - (050) Checks on the hierarchical model (pre-flattening)
 *         array of, @cds.valid.from/to
 * - (045) The query is stripped from entities that are annotated with '@cds.persistence.table',
 *         essentially converting views to entities.
 * - (060) Users of primitive type 'UUID' (which is renamed to 'String' in 000) get length 36'.
 * - (070) Default length N is supplied for strings if not specified.
 * - (080) Annotation definitions are ignored (note that annotation assignments are filtered out by toCdl).
 * - (090) Compositions become associations.
 * - (100) 'masked' is ignored (a), and attribute 'localized' is removed (b)
 * - (110) Actions and functions (bound or unbound) are ignored.
 * - (120) (a) Services become contexts.
 * - (130) (not for to.hdbcds with hdbcds names): Elements having structured types are flattened into
 *         multiple elements (using '_' or '.' as name separator, depending on 'sqlMapping').
 * - (140) (not for to.hdbcds with hdbcds names): Managed associations get explicit ON-conditions, with
 *         generated foreign key elements (also using '_' or '.' as name separator, depending on 'sqlMapping').
 * - (150) (a) Elements from inherited (included) entities are copied into the receiving entity
 *         (b) The 'include' property is removed from entities.
 * - (160) Projections become views, with MIXINs for association elements (adding $projection where
 *         appropriate for ON-conditions).
 * - (170) ON-conditions referring to '$self' are transformed to compare explicit keys instead.
 * - (180) In projections and views, ...
 *         (a) association elements that are mixins must not be explicitly redirected
 *         (b) MIXINs are created for association elements in the select list that are not mixins by themselves.
 * - (190) For all enum types, ...
 *         (a) enum constants in defaults are replaced by their values (assuming a matching enum as element type)
 *         (b) the enum-ness is stripped off (i.e. the enum type is replaced by its final base type).
 * - (200) The 'key' property is removed from all elements of types.
 * - (210) (not for to.hdbcds with hdbcds names): Managed associations in GROUP BY and ORDER BY are
 *         replaced by by their foreign key fields.
 * - (220) Contexts that contain no artifacts or only ignored artifacts are ignored.
 * - (230) (only for to.hdbcds with hdbcds names): The following are rejected in views
 *         (a) Structured elements
 *         (b) Managed association elements
 *         (c) Managed association entries in GROUP BY
 *         (d) Managed association entries in ORDER BY
 * - (240) All artifacts (a), elements, foreign keys, parameters (b) that have a DB representation are annotated
 *         with their database name (as '@cds.persistence.name') according to the naming convention chosen
 *         in 'options.sqlMapping'.
 * - (250) Remove name space definitions again (only in forRelationalDB). Maybe we can omit inserting namespace definitions
 *         completely (TODO)
 *
 * @param {CSN.Model}   csn
 * @param {CSN.Options} options
 * @param {object}      messageFunctions Message functions such as `error()`, `info()`, …
 */
function transformForRelationalDBWithCsn(csn, options, messageFunctions) {
  // copy the model as we don't want to change the input model
  timetrace.start('HANA transformation');

  timetrace.start('Clone CSN');
  /** @type {CSN.Model} */
  csn = cloneFullCsn(csn, options);
  timetrace.stop('Clone CSN');

  if (options.tenantDiscriminator)
    addTenantFields(csn, options);

  checkCSNVersion(csn, options);

  const pathDelimiter = (options.sqlMapping === 'hdbcds') ? '.' : '_';
  // There is also an explicit default length via options.defaultStringLength
  const implicitDefaultLengths = getDefaultTypeLengths(options.sqlDialect);

  /** @type {object} */
  let csnUtils;
  /** @type {object} */
  let error; // message functions
  /** @type {() => void} */
  let throwWithAnyError;
  // transformUtils
  let addDefaultTypeFacets,
    expandStructsInExpression,
    flattenStructuredElement,
    flattenStructStepsInRef;

  bindCsnReference();

  throwWithAnyError(); // reclassify and throw in case of non-configurable errors

  if (options.csnFlavor === 'universal' && isBetaEnabled(options, 'enableUniversalCsn')) {
    enrichUniversalCsn(csn, options);
    bindCsnReference();
  }

  ensureColumnNames(csn, options, csnUtils);

  const dialect = options.sqlDialect;
  const doA2J = !(options.transformation === 'hdbcds' && options.sqlMapping === 'hdbcds');
  if (!doA2J)
    forEachDefinition(csn, handleMixinOnConditions);

  // replace all type refs to builtin types with direct type
  transformUtils.rewriteBuiltinTypeRef(csn);

  timetrace.start('Validate');
  // Run validations on CSN - each validator function has access to the message functions and the inspect ref via this
  validate.forRelationalDB(csn, {
    ...messageFunctions, csnUtils, ...csnUtils, csn, options,
  });
  timetrace.stop('Validate');

  // exit if validators found errors
  throwWithAnyError();

  if(csn.meta?.[featureFlags]?.$calculatedElements)
    rewriteCalculatedElementsInViews(csn, options, csnUtils, pathDelimiter, messageFunctions);

  timetrace.start('Where-Exists handling');
  // Needs to happen before tuple expansion, so the newly generated WHERE-conditions have it applied
  handleExists(csn, options, error, csnUtils.inspectRef, csnUtils.initDefinition, csnUtils.dropDefinitionCache);
  timetrace.stop('Where-Exists handling');

  // Check if structured elements and managed associations are compared in an expression
  // and expand these structured elements. This tuple expansion allows all other
  // subsequent procession steps (especially a2j) to see plain paths in expressions.
  // If errors are detected, throwWithAnyError() will return from further processing

  timetrace.start('Expand Structures (expressions + refs)');
  // If this function is ever undefined, we have a bug in our logic.
  // @ts-ignore
  expandStructsInExpression(csn, { drillRef: true });

  forEachDefinition(csn, [
    // (001) Add a temporal where condition to views where applicable before assoc2join
    //       assoc2join eventually rewrites the table aliases
    temporal.getViewDecorator(csn, messageFunctions, csnUtils, options),
    // check unique constraints - further processing is done in rewriteUniqueConstraints
    assertUnique.prepare(csn, options, messageFunctions)
  ]);

  if(doA2J) {
    // Expand a structured thing in: keys, columns, order by, group by
    // In addition, kill all non-sql-backend relevant annotations
    expansion.expandStructureReferences(csn, options, pathDelimiter, messageFunctions, csnUtils, { processAnnotations: true });
    bindCsnReference();
  }

  timetrace.stop('Expand Structures (expressions + refs)');

  // Remove properties attached by validator - they do not "grow" as the model grows.
  applyTransformations(csn, {
    _art: killProp,
    _links: killProp,
    _element: killProp,
    _column: killProp,
    _from: killProp,
    _type: killProp,
    _target: killProp,
    $env: killProp,
    $path: killProp,
    $scope: killProp,
  });

  bindCsnReferenceOnly();

  timetrace.start('Flattening (refs + elements)');
  // TODO: Instead of 3 separate applyTransformations, we could have each of them just return the "listeners", merge them into
  // one big listener that then gets passed into one single applyTransformations. Each listener would then have to return an array of callbacks to call.
  // With that, we could still ensure the processing order (assuming we don't run into problems with scoping).
  // To analyze: Increased memory vs. saved cycles
  // Looked at it with AFC: This is only a small part of the overall processing time, enrich step of validator is just as expensive
  if(doA2J) {
    const resolved = new WeakMap();
    // No refs with struct-steps exist anymore
    flattening.flattenAllStructStepsInRefs(csn, options, messageFunctions, resolved, pathDelimiter);
    // No type references exist anymore
    // Needs to happen exactly between flattenAllStructStepsInRefs and flattenElements to keep model resolvable.
    flattening.resolveTypeReferences(csn, options, messageFunctions, resolved, pathDelimiter);
    // No structured elements exists anymore
    flattening.flattenElements(csn, options, messageFunctions, pathDelimiter);
  } else {
    // For to.hdbcds with naming mode hdbcds we also need to resolve the types
    flattening.resolveTypeReferences(csn, options, messageFunctions, new WeakMap(), pathDelimiter);
  }
  timetrace.stop('Flattening (refs + elements)');

  // With flattening errors, it makes little sense to continue.
  throwWithAnyError();

  // (010) If requested, translate associations to joins
  if (doA2J)
    handleAssocToJoins();

  bindCsnReference();

  const redoProjections = [];
  // Use the "raw" forEachDefinition here to ensure that the $ignore takes effect
  _forEachDefinition(csn, (artifact) => {
    if(artifact.kind === 'entity' && artifact.projection) {
      artifact.query = { SELECT: artifact.projection };
      delete artifact.projection;
      redoProjections.push(() => {
        if(artifact.query) {
          artifact.projection = artifact.query.SELECT;
          delete artifact.query;
          if(artifact.$syntax === 'projection') {
            delete artifact.$syntax;
          }
        }
      })
    } else if(artifact.kind === 'annotation' || artifact.kind === 'action' || artifact.kind === 'function' || artifact.kind === 'event'){
      // $ignore actions etc. - this loop seemed handy for this, as we can hook into an existing if
      artifact.$ignore = true;
    }
  });

  processCalculatedElementsInEntities(csn, options);

  timetrace.start('Transform CSN')

  // Rename primitive types, make UUID a String; replace `items` by cds.LargeString
  //
  // First, gather all nodes that are arrayed: Don't replace inline, or getFinalTypeInfo()
  // may not return `.items` for types that were already processed.
  // TODO: Do this in resolveTypeReferences?
  {
    applyTransformations(csn, {
      type: (node) => {
        renamePrimitiveTypesAndUuid(node.type, node, 'type');
        addDefaultTypeFacets(node, implicitDefaultLengths);
      },
    });
  }

  forEachDefinition(csn, [
    // (040) Ignore entities and views that are abstract or implemented
    // or carry the annotation cds.persistence.skip/exists
    // These entities are not removed from the csn, but flagged as "to be ignored"
    cdsPersistence.getAnnoProcessor(),
    // (050) Check @cds.valid.from/to only on entity
    //       Views are checked in (001), unbalanced valid.from/to's or mismatching origins
    temporal.getAnnotationHandler(csn, options, pathDelimiter, messageFunctions)
  ]);

  // eliminate the doA2J in the functions 'handleManagedAssociationFKs' and 'createForeignKeyElements'
  doA2J && flattening.handleManagedAssociationsAndCreateForeignKeys(csn, options, messageFunctions, pathDelimiter, true, csnUtils, { skipDict: { actions: true }, allowArtifact: artifact => (artifact.kind === 'entity') });

  doA2J && forEachDefinition(csn, flattenIndexes);
  // Managed associations get an on-condition - in views and entities
  doA2J && associations.attachOnConditions(csn, csnUtils, pathDelimiter);

  {
    // (045) Strip all query-ish properties from views and projections annotated with '@cds.persistence.table',
    // and make them entities
    const fns = [cdsPersistence.getPersistenceTableProcessor(csn, options, messageFunctions)];
    // Allow using managed associations as steps in on-conditions to access their fks
    // To be done after handleAssociations, since then the foreign keys of the managed assocs
    // are part of the elements
    if(doA2J) fns.push(associations.getFKAccessFinalizer(csn, csnUtils, pathDelimiter));

    forEachDefinition(csn, fns);
  }

  // Create convenience views for localized entities/views.
  // To be done after getFKAccessFinalizer because associations are
  // handled and before handleDBChecks which removes the localized attribute.
  // Association elements of localized convenience views do not have hidden properties
  // like $managed set, so we cannot do this earlier on.
  if (doA2J)
    addLocalizationViewsWithJoins(csn, options);
  else
    addLocalizationViews(csn, options);

  forEachDefinition(csn, [
    (definition, artName, prop, path) => {
      if (!doA2J && definition.query && isPersistedOnDatabase(definition)) {
        // reject managed association and structure publishing for to-hdbcds.hdbcds
        const that = { csnUtils, options, error };
        rejectManagedAssociationsAndStructuresForHdbcdsNames.call(that, definition, path)
      }
    },
    // (170) Transform '$self' in backlink associations to appropriate key comparisons
    // Must happen before draft processing because the artificial ON-conditions in generated
    // draft shadow entities have crooked '_artifact' links, confusing the backlink processing.
    // But it must also happen after flattenForeignKeys has been called for all artifacts,
    // because otherwise we would produce wrong ON-conditions for the keys involved. Sigh ...
    backlinks.getBacklinkTransformer(csnUtils, messageFunctions, options, pathDelimiter, doA2J)
  ]);

  /**
   * Referential Constraints are only supported for sql-dialect "hana" and "sqlite".
   * For to.hdbcds with naming mode "hdbcds", no foreign keys are calculated,
   * hence we do not generate the referential constraints for them.
   */
  if(options.sqlDialect !== 'plain' && options.sqlDialect !== 'h2' && doA2J)
    createReferentialConstraints(csn, options);

  // no constraints for drafts
  generateDrafts(csn, options, pathDelimiter, messageFunctions);

  // Set the final constraint paths and produce hana tc indexes if required
  // See function comment for extensive information.
  assertUnique.rewrite(csn, options, pathDelimiter);

  // Associations that point to things marked with @cds.persistence.skip are removed
  forEachDefinition(csn, cdsPersistence.getAssocToSkippedIgnorer(csn, options, messageFunctions, csnUtils));

  // some errors can't be handled in the subsequent processing steps for e.g. HDBCDS
  messageFunctions.throwWithError();

  // TODO: Might have to do this earlier if we want special rendering for projections?
  const findAndMarkSqlServiceArtifacts = options.sqlDialect === 'hana' && options.src === 'hdi' && (csn.meta?.[featureFlags]?.$sqlService || csn.meta?.[featureFlags]?.$dummyService) ? processSqlServices(csn, options): () => {}

  // Apply view-specific transformations
  // (160) Projections now finally become views
  // Replace managed association in group/order by with foreign keys
  const transformEntityOrViewPass2 = getViewTransformer(csn, options, messageFunctions);
  forEachDefinition(csn, [(artifact, artifactName) => {
    findAndMarkSqlServiceArtifacts(artifact, artifactName);
    if(artifact.$dummyService)
      createServiceDummy(artifact, artifactName, csn, messageFunctions);
  },  transformViews]);

  if(!doA2J) {
    forEachDefinition(csn, [
      // (200) Strip 'key' property from type elements
      removeKeyPropInType,
      (artifact, artifactName) => {
        if(artifact.kind === 'type') {
          forEachMemberRecursively(artifact, (member, memberName, prop, path) => {
            // Check type parameters (length, precision, scale ...)
            if (!member.$ignore) {
              if (member.type)
                checkTypeParameters(member, artifact, path);
              if (member.items?.type)
                checkTypeParameters(member.items, artifact, path.concat([ 'items' ]));
            }
          }, [ 'definitions', artifactName ]);
        }
      }
    ]);
  }

  // TODO: Could we maybe merge this with the final applyTransformations?
  applyTransformations(csn, {
    type: (parent, prop, type, path) => {
      checkTypeParameters(parent, csn.definitions[path[1]], path);
    },
    $tableConstraints: (parent, prop, tableConstraints, path) => {
      /* assert that there will be no conflicting unique- and foreign key constraint identifiers */
      assertConstraintIdentifierUniqueness(parent, path[1], path, error);
    },
    elements: (parent, prop, elements, path) => {
      // Attach @cds.persistence.name to elements
      const artifact = csn.definitions[path[1]];
      forEach(elements, (name, element) => {
        if ((!element.virtual || artifact.query))
          csnUtils.addStringAnnotationTo('@cds.persistence.name', getElementDatabaseNameOf(name, options.sqlMapping, options.sqlDialect), element);
      });
      // Remove leading $self to keep renderer-diffs smaller
      if(doA2J && options.transformation === 'hdbcds')
        flattening.removeLeadingSelf(parent, prop, elements);
    }
  }, [(definitions, artifactName, artifact) => {
    // Attach @cds.persistence.name to artifacts
    if (!artifact.$ignore && artifact.kind !== 'service' && artifact.kind !== 'context')
      csnUtils.addStringAnnotationTo('@cds.persistence.name', getArtifactDatabaseNameOf(artifactName, options.sqlMapping, csn, options.sqlDialect), artifact);
  }], { allowArtifact: artifact => artifact.kind === 'entity'});

  throwWithAnyError();

  function killProp(parent, prop){
    delete parent[prop];
  }

  function killParent(parent, a, b, path){
    if(path.length > 2) {
      const tail = path[path.length-1];
      const parentPath = path.slice(0, -1)
      const parentParent = walkCsnPath(csn, parentPath);
      delete parentParent[tail];
    } else {
      delete parent.$ignore;
    }
  }

  const killers = {
    // Used to ignore actions etc from processing and remove associations/elements
    '$ignore': killParent,
    // Still used in flattenStructuredElements - in db/flattening.js
    '_flatElementNameWithDots': killProp,
    // Set when setting default string/binary length - used in copyTypeProperties and fixBorkedElementsOfLocalized
    // to not copy the .length property if it was only set via default
    '$default': killProp,
    // Set when we turn UUID into String, checked during generateDraftForHana
    '$renamed': killProp,
    // Set when we remove .key from temporal things, used in localized.js
    '$key': killProp,
    // We need .elements easily for rendering - otherwise we have to compute it then
    // Does not fit in the "killers" theme - TODO: Find a better place
    SET: (parent, prop, SET) => {
      if(!SET.elements) {
        const stack = [parent];
        while(stack.length > 0) {
          const query = stack.pop();

          if(query.SET)
            stack.push(query.SET.args[0]);
          else if(query.SELECT)
            setProp(SET, 'elements', query.SELECT.elements);
        }
      }
    },
    includes: killProp,
    masked: killProp,
    localized: killProp,
  }

  if(options.sqlDialect === 'postgres') {
    killers.length = (parent) => {
      if (parent.type === 'cds.Binary') {
        delete parent.length;
      }
    }
  }

  if(options.sqlDialect === 'hana' && options.withHanaAssociations === false && doA2J) {
    killers.target = killParent;
  }

  const killTypes = [];

  if(doA2J) { // replace types and aspects with dummies to shrink overall CSN size
    killers.kind = (parent, prop, kind, path) => {
      if(kind === 'type' || kind === 'aspect') {
        const artifactName = path[1];
        killTypes.push(() => {
          csn.definitions[artifactName] = {
            kind,
            type: 'cds.Integer'
          };
        })
      }
    }
  }

  applyTransformations(csn, killers, [], { skipIgnore: false });

  killTypes.forEach(fn => fn());
  redoProjections.forEach(fn => fn());

  timetrace.stop('Transform CSN');
  timetrace.stop('HANA transformation');
  return csn;

  /* ----------------------------------- Functions start here -----------------------------------------------*/

  function bindCsnReference(){
    messageFunctions.setModel(csn);
    ({ error, throwWithAnyError } = messageFunctions);

    ({ flattenStructuredElement,
      flattenStructStepsInRef,
      addDefaultTypeFacets,
      expandStructsInExpression,
      csnUtils
    } = transformUtils.getTransformers(csn, options, messageFunctions, pathDelimiter));
  }

  function bindCsnReferenceOnly(){
    // invalidate caches for CSN ref API
    const csnRefApi = csnRefs(csn);
    Object.assign(csnUtils, csnRefApi);
  }

  // For non-A2J only
  function handleMixinOnConditions(artifact, artifactName) {
    if (!artifact.query) // projections can't have mixins
      return;
    forAllQueries(artifact.query, (query, path) => {
      const { mixin } = query.SELECT || {};
      if (mixin) {
        query.SELECT.columns
          // filter for associations which are used in the SELECT
          .filter((c) => {
            return c.ref && c.ref.length > 1;
          })
          .forEach((usedAssoc) => {
            const assocName = pathId(usedAssoc.ref[0]);
            const mixinAssociation = mixin[assocName];
            if (mixinAssociation)
              mixinAssociation.on = getResolvedMixinOnCondition(mixinAssociation, query, assocName, path.concat(['mixin', assocName]));
          })
      }
    }, ['definitions', artifactName, 'query']);
  }

  // For non-A2J only
  function getResolvedMixinOnCondition(mixinAssociation, query, assocName, path) {
    const referencedThroughStar = query.SELECT.columns.some((column) => column === '*');
    return mixinAssociation.on.map(handeMixinOnConditionPart);

    function handeMixinOnConditionPart(onConditionPart, i)  {
      let columnToReplace;
      if (onConditionPart.ref && (onConditionPart.ref[0] === '$projection' || onConditionPart.ref[0] === '$self')){
        const { links } = csnUtils.inspectRef(path.concat(['on', i]));
        if (links) {
          columnToReplace = onConditionPart.ref[links.length - 1];
        }
      }
      if (!columnToReplace)
        return onConditionPart;

      const replaceWith = query.SELECT.columns.find(col => columnAlias(col) === columnToReplace);
      if (!replaceWith && referencedThroughStar) {
          // not explicitly in column list, check query sources
          // get$combined also includes elements which are part of "excluding {}"
          // this shouldn't be an issue here, as such references get rejected
        const elementsOfQuerySources = csnUtils.get$combined(query);
        forEach(elementsOfQuerySources, (id, element) => {
            // if the ref points to an element which is not explicitly exposed in the column list,
            // but through the '*' operator -> replace the $projection / $self with the correct source entity
          if(id === columnToReplace)
            onConditionPart.ref[0] = element[0].parent;
        });
        return onConditionPart;
      }
      else if (replaceWith) {
        const clone = cloneCsnNonDict(replaceWith, options);
        delete clone.cast;  // No implicit CAST in on-condition
        delete clone.as;
        return clone;
      }
      else {
        return onConditionPart
      }
    }
  }


  /**
   * @param {CSN.Artifact} artifact
   * @param {string} artifactName
   */
  function transformViews(artifact, artifactName) {
    if (!artifact.$ignore) {
      // Do things specific for entities and views (pass 2)
      if ((artifact.kind === 'entity') && artifact.query) {

        // First pass: Set alias name for SELECTs without table alias. Required for setting proper table aliases
        // for HDBCDS in naming mode HDBCDS.  We use the same schema as the core-compiler, so duplicates should
        // have already been reported.
        if(options.transformation === 'hdbcds' && options.sqlMapping === 'hdbcds') {
          let selectDepth = 0;
          traverseQuery(artifact.query, null, null, (query, fromSelect) => {
            if (!query.ref && !query.as && fromSelect) {
              // Use +1; for UNION, it's the next select, for SELECT, it's increased later.
              query.as = `$_select_${selectDepth + 1}__`;
            }
            if (query.SELECT) ++selectDepth;
          });
        }

        const process = (parent, prop, query, path) => {
          transformEntityOrViewPass2(parent, artifact, artifactName, path.concat(prop))
          replaceAssociationsInGroupByOrderBy(parent, options, csnUtils.inspectRef, error, path.concat(prop));
          return query;
        }
        applyTransformationsOnNonDictionary(csn.definitions, artifactName, {
          SELECT: process
        }, {}, [ 'definitions']);
      }
    }
  }

  /**
   * @param {CSN.Artifact} artifact
   * @param {string} artifactName
   */
  function removeKeyPropInType(artifact, artifactName) {
    if (!doA2J && !artifact.$ignore && artifact.kind === 'type') {
      forEachMemberRecursively(artifact, (member) => {
        if (member.key)
          delete member.key;
      }, [ 'definitions', artifactName ]);
    }
  }

  function handleAssocToJoins() {
    timetrace.start('A2J');
    // the augmentor isn't able to deal with technical configurations and since assoc2join can ignore it we
    // simply make it invisible and copy it over to the result csn
    forEachDefinition(csn, (art) => {
      if (art.technicalConfig)
        setProp(art, 'technicalConfig', art.technicalConfig);
      if (art.kind === 'type' && art.projection) {
        // Missing 'elements' already reported by csnRefs.
        delete art.projection;
      }
    });

    const newCsn = translateAssocsToJoinsCSN(csn, options);

    // restore all (non-enumerable) properties that wouldn't survive reaugmentation/compactification into the new compact model
    forEachDefinition(csn, (art, artName) => {
      if (art['$tableConstraints']) {
        newCsn.definitions[artName].$tableConstraints = art['$tableConstraints'];
      }
      if (art.technicalConfig)
        newCsn.definitions[artName].technicalConfig = art.technicalConfig;
    });

    // To ensure we preserve feature flags
    newCsn.meta = csn.meta;

    csn = newCsn;
    timetrace.stop('A2J');
  }

  // Change the names of those builtin types that have different names in HANA.
  // (do that directly in the csn where the builtin types are defined, so that
  // all users of the types benefit from it). Also add the type parameter 'length'
  // to 'UUID' (which becomes a string).
  // TODO: there is no benefit at all - it is fundamentally wrong
  function renamePrimitiveTypesAndUuid(val, node, key) {
    // assert key === 'type'
    const hanaNamesMap = {
      __proto__: null,
      'cds.UUID': 'cds.String'
    };
    node[key] = hanaNamesMap[val] || val;
    if (val === 'cds.UUID' && !node.length) {
      node.length = 36;
      setProp(node, '$renamed', 'cds.UUID');
    }

    if(options.sqlDialect === 'h2' && val === 'cds.Decimal' && node.scale === undefined) {
      node[key] = 'cds.DecimalFloat'; // cds.Decimal and cds.Decimal(p) should map do DECFLOAT for h2
    }

    // Length/Precision/Scale is done in addDefaultTypeFacets
  }

  // If 'obj' has final type 'cds.UUID' (renamed to String in 000), set its length to 36.
  // function setLengthForFormerUuid(obj) {
  //   if (!obj || !obj.type)
  //     return;
  //   if (obj.type === 'cds.UUID' && !obj.length) {
  //     obj.length = 36;
  //   }
  // }

  /**
   * Check that required actual parameters on 'node.type' are set, that their values are in the correct range etc.

   * @param {*} node
   * @param {CSN.Artifact} artifact
   * @param {CSN.Path} path
   */
  function checkTypeParameters(node, artifact, path) {
    if (node.type && !node.virtual) {
      const absolute = node.type;
      switch (absolute) {
        case 'cds.String':
        case 'cds.Binary':
        case 'cds.hana.VARCHAR': {
          checkTypeParamValue(node, 'length', { min: 1, max: 5000 }, path);
          break;
        }
        case 'cds.Decimal': {
          // Don't check with "plain"?
          if (node.precision || node.scale) {
            checkTypeParamValue(node, 'precision', { max: 38 }, path);
            checkTypeParamValue(node, 'scale', { max: node.precision }, path);
          }
          break;
        }

        case 'cds.hana.BINARY':
        case 'cds.hana.NCHAR':
        case 'cds.hana.CHAR': {
          checkTypeParamValue(node, 'length', { min: 1, max: 2000 }, path);
          break;
        }
        case 'cds.hana.ST_POINT':
        case 'cds.hana.ST_GEOMETRY': {
          checkTypeParamValue(node, 'srid', { max: Number.MAX_SAFE_INTEGER }, path);
          break;
        }
        case 'cds.Map': {
          if (options.sqlDialect === 'plain')
            error('ref-unsupported-type', path, { '#': 'dialect', type: node.type, value: 'plain' });
          else if (options.transformation === 'hdbcds')
            error('ref-unsupported-type', path, {'#': 'hdbcds', type: node.type, value: options.sqlDialect });
          break;
        }
        case 'cds.Vector': {
          if (options.sqlDialect !== 'hana') {
            error('ref-unsupported-type', path, {
              '#': 'hana', type: node.type, value: 'hana',
              othervalue: options.sqlDialect
            });
          }
          else if (options.transformation === 'hdbcds') {
            error('ref-unsupported-type', path, {
              '#': 'hdbcds', type: node.type, value: options.sqlDialect
            });
          }
          break;
        }
      }
    }

    // Check that the value of the type property `paramName` (e.g. length, precision, scale ...) is of `expectedType`
    // (which can currently only be 'positiveInteger') and (optional) the value is in a given range
    function checkTypeParamValue(node, paramName, range = null, path = null) {
      const paramValue = node[paramName];
      if (paramValue == null) {
        if(options.toSql || artifact.query || !['cds.Binary','cds.hana.BINARY', 'cds.hana.NCHAR','cds.hana.CHAR'].includes(node.type)) {
          return true;
        } else {
          return error('type-missing-argument', path, { name: paramName, id: node.type, $reviewed: false });
        }
      }
      if (range) {
        if (isMaxParameterLengthRestricted(node.type) && range.max && paramValue > range.max) {
          error('type-unexpected-argument', path,
            { '#': 'max', prop: paramName, type: node.type, number: range.max, $reviewed: false });
          return false;
        }
        if (range.min && paramValue < range.min) {
          error('type-unexpected-argument', path,
            { '#': 'min', prop: paramName, type: node.type, number: range.min, $reviewed: false });
          return false;
        }
      }
      return true;
    }
  }

  /**
  * Check if the maximum length of the value of the given type is restricted.
  *
  * @param {string} type
  * @returns {boolean}
  */
  function isMaxParameterLengthRestricted(type) {
    return !(options.toSql && type === 'cds.String' && (options.sqlDialect === 'sqlite' || options.sqlDialect === 'plain'));
  }

  /**
   * Flatten technical configuration stuff
   *
   * @param {CSN.Artifact} art
   * @param {string} artName Artifact Name
   */
  function flattenIndexes(art, artName) {
    // Flatten structs in indexes (unless explicitly asked to keep structs)
    const tc = art.technicalConfig;
    if (art.kind === 'entity') {
      if (tc && tc[dialect]) {
        // Secondary and fulltext indexes
        for (const name in tc[dialect].indexes) {
          const index = tc[dialect].indexes[name];
          if (Array.isArray(index)) {
            const flattenedIndex = [];
            const isFulltextIndex = (index[0] === 'fulltext');
            index.forEach((val, idx) => {
              if (typeof val === 'object' && val.ref) {
                // Replace a reference by references to it's elements, if it is structured
                const path = [ 'definitions', artName, 'technicalConfig', dialect, 'indexes', name, idx ];
                const { art } = csnUtils.inspectRef(path);
                if (!art) {
                  // A reference that has no artifact (e.g. the reference to the index name itself). Just copy it over
                  flattenedIndex.push(val);
                }
                else if (art.elements) {
                  // The reference is structured
                  if (isFulltextIndex)
                    error(null, path, { name: artName }, 'A fulltext index can\'t be defined on a structured element $(NAME)');
                  // First, compute the name from the path, e.g ['s', 's1', 's2' ] will result in 'S_s1_s2' ...
                  const [ refPath ] = flattenStructStepsInRef(val.ref, path);
                  // ... and take this as the prefix for all elements
                  const flattenedElems = flattenStructuredElement(art, refPath, [], ['definitions', artName, 'elements']);
                  Object.keys(flattenedElems).forEach((elem, i, elems) => {
                    // if it's not the first entry, add a ',' ...
                    if (i)
                      flattenedIndex.push(',');
                    // ... then add the flattened element name as a single ref
                    flattenedIndex.push({ ref: [ elem ] });
                    // ... then check if we have to propagate a 'asc'/'desc', omitting the last, which will be copied automatically
                    if ((idx + 1) < index.length && (index[idx + 1] === 'asc' || index[idx + 1] === 'desc') && i < elems.length - 1)
                      flattenedIndex.push(index[idx + 1]);
                  });
                }
                else {
                  // The reference is not structured, so just replace it by a ref to the combined prefix path
                  const [ refPath ] = flattenStructStepsInRef(val.ref, path);
                  flattenedIndex.push({ ref: refPath });
                }
              }
              else // it's just some token like 'index', '(' etc. so we copy it over
              {
                flattenedIndex.push(val);
              }
            });
            // Replace index by the flattened one
            tc[dialect].indexes[name] = flattenedIndex;
          }
        }
      }
    }
  }

}

module.exports = {
  transformForRelationalDBWithCsn,
};
