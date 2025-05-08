'use strict';

const { makeMessageFunction } = require('../base/messages');
const { setProp } = require('../base/model');
const { forEachKey } = require('../utils/objectUtils');
const { cleanSymbols } = require('../base/cleanSymbols.js');
const {
  applyAnnotationsFromExtensions,
  forEachDefinition,
  forEachGeneric,
  forAllQueries,
} = require('../model/csnUtils');
const { CompilerAssertion } = require('../base/error');
const {
  cloneCsnDict,
  cloneCsnNonDict,
  sortCsnDefinitionsForTests,
  sortCsn
} = require('../model/cloneCsn');

/**
 * Indicator that a definition is localized and has a convenience view.
 * art[_hasLocalizedView]'s value should be the name of the convenience view.
 */
const _hasLocalizedView = Symbol('_hasLocalizedView');
/**
 * Whether a convenience view was generated for another view.
 * In that case we have a _vertical_ view.
 */
const _isViewForView = Symbol('_isViewForView');     // $inferred = 'LOCALIZED-VERTICAL'
/**
 * Whether a convenience view was generated for an entity that is localized.
 * In that case we have a _horizontal_ view.
 */
const _isViewForEntity = Symbol('_isViewForEntity'); // $inferred = 'LOCALIZED-HORIZONTAL'
/**
 * List of artifacts for which the view/entity is a target.
 * Used to transitively create convenience views.
 */
const _targetFor = Symbol('_targetFor');
const annoPersistenceSkip = '@cds.persistence.skip';

/**
 * Callback function returning `true` if the localization view should be created.
 * @callback AcceptLocalizedViewCallback
 * @param {string} viewName localization view name
 * @param {string} originalName Artifact name of the original view
 */

/**
 * Create transitive localized convenience views.
 *
 * A convenience view is created if the entity/view has a localized element[^1]
 * or if it exposes an association leading to a localized-tagged target.
 *
 * INTERNALS:
 * We have three kinds of localized convenience views:
 *
 *  1. "direct ones" using coalesce() for the table entities with localized
 *     elements[^1]: as projection on the original and '.texts' entity (created in extend.js)
 *  2. for _table_ entities with associations to entities which have a localized
 *     convenience: as projection on the original
 *  3. for _view_ entities with either localized elements[^1] or associations
 *     to entities which have a localized convenience view:
 *     as view using a copy of the original query, but replacing all sources by
 *     their localized convenience view variant if present
 *
 * [^1]: That is, the element has `localized: true`.
 *
 * First, all "direct ones" are built (1).  Then we build all 2 and 3
 * transitively (i.e. as long as an entity has an association which directly or
 * indirectly leads to an entity with localized elements, we create a localized
 * variant for it), and finally make sure via redirection that associations in
 * localized convenience views have as target the localized convenience view
 * variant if present.
 *
 * @param {CSN.Model} csn
 *     Input CSN model.  Should not have existing convenience views.
 *
 * @param {object} options
 *     CSN options.  Only few options are used, see below for important ones.
 *     Options such as `testMode` or `testSortCsn` can also be set.
 *
 * @param {string} [options.localizedLanguageFallback]
 *     Valid values (if set): 'none', 'coalesce' (default)
 *     Whether to use a `coalesce()` function when selecting from `.texts` entities.
 *     If not set, untranslated strings may not return any value.  If 'coalesce'
 *     is used, it will fall back to the original string.
 *
 * @param {boolean} [options.localizedWithoutCoalesce]
 *     Deprecated version of localizedLanguageFallback. Do not use.
 *
 * @param {boolean} [options.fewerLocalizedViews]
 *     Default: true
 *
 * @param {boolean} [options.testMode]
 *
 * @param {object} config
 *     Configuration for creating convenience views.  Non-user visible options.
 *
 * @param {boolean} [config.useJoins]
 *     If true, rewrite the "localized" association to a join in direct convenience views.
 *
 * @param {AcceptLocalizedViewCallback} [config.acceptLocalizedView]
 *     A callback that can be used to suppress the creation of localized convenience views
 *     if desired.  For example, if you want to know which definitions get a convenience view
 *     but don't actually want to create them.
 *
 * @param {boolean} [config.ignoreUnknownExtensions]
 *     If true, do not emit a warning for annotations on unknown `localized.*` views.
 */
function _addLocalizationViews(csn, options, config) {
  const messageFunctions = makeMessageFunction(csn, options, 'localized');
  if (checkExistingLocalizationViews(csn, options, messageFunctions))
    return csn;

  const { useJoins, acceptLocalizedView, ignoreUnknownExtensions } = config;
  const noCoalesce = (options.localizedLanguageFallback === 'none' ||
                      options.localizedWithoutCoalesce);
  // default is true, hence only check for explicitly disabled option
  const ignoreAssocToLocalized = options.fewerLocalizedViews !== false;

  createDirectConvenienceViews();     // 1
  createTransitiveConvenienceViews(); // 2 + 3
  cleanDefinitionSymbols();
  applyAnnotationsForLocalizedViews();
  sortLocalizedForTests(csn, options);
  messageFunctions.throwWithError();
  return csn;

  /**
   * Create direct convenience localization views for entities that have localized elements.
   * Only entities that have `localized` elements are used.  `localized` in types or sub-elements
   * are not respected.
   */
  function createDirectConvenienceViews() {
    forEachDefinition(csn, (art, artName) => {
      if (art.kind !== 'entity' || art.query || art.projection)
        // Ignore non-entities and views.  The latter are handled at a later point (step 2+3).
        return;

      if (isInLocalizedNamespace(artName))
        // We already issued a warning for it in hasExistingLocalizationViews()
        return;

      const localized = getLocalizedTextElements( artName );
      if (localized)
        addLocalizedView( artName, localized );
    });
  }

  /**
   * Add a localized convenience view for the given artifact.
   * Can either be an entity or view.  `textElements` are the elements which
   * are needed for creating a horizontal convenience view, i.e. only required
   * for entities.
   *
   * @param {string} artName
   * @param {string[]} [textElements=[]]
   */
  function addLocalizedView( artName, textElements = [] ) {
    const art = csn.definitions[artName];
    const artPath = [ 'definitions', artName ];
    const viewName = `localized.${ artName }`;

    if (csn.definitions[viewName]) {
      // Already exists, skip creation.
      messageFunctions.info( null, artPath, null, 'Convenience view can\'t be created due to conflicting names' );
      return;
    }

    art[_hasLocalizedView] = viewName;

    if (acceptLocalizedView && !acceptLocalizedView(viewName, artName))
      return;

    let view;
    if (art.query || art.projection)
      view = createLocalizedViewForView(art);
    else
      view = createLocalizedViewForEntity(art, artName, textElements);

    copyPersistenceAnnotations(view, art);
    csn.definitions[viewName] = view;
  }

  /**
   * Create a localized data view for the given entity `art` with `textElements`.
   * In JOIN mode the FROM query is rewritten to remove associations and the
   * columns are expanded.
   *
   * @param {CSN.Definition} entity
   * @param {string} entityName
   * @param {string[]} [textElements]
   * @returns {CSN.View}
   */
  function createLocalizedViewForEntity( entity, entityName, textElements = [] ) {
    // Only use joins if requested and text elements are provided.
    const shouldUseJoin = useJoins && !!textElements.length;
    const columns = [ ];

    const convenienceView = {
      '@odata.draft.enabled': false,
      kind: 'entity',
      query: { // TODO: Use projection
        SELECT: {
          from: createFromClauseForEntity(),
          columns,
        },
      },
      elements: cloneCsnDict(entity.elements, options),
      [_isViewForEntity]: true,
    };
    copyLocation(convenienceView, entity);
    copyLocation(convenienceView.query, entity);

    if (shouldUseJoin)
      // Expand elements; (variant 1)
      columns.push( ...columnsForEntityWithExcludeList( entity, 'L_0', textElements ) )
    else
      columns.push( '*' ); // (variant 2)

    for (const originalElement of textElements) {
      const elem = entity.elements[originalElement];
      // Note: $key is used by forRelationalDB.js to indicate that this element was a key in the original,
      //      user's entity.  Keys may have been changed by the backends (e.g. by `@cds.valid.key`)
      if (!elem.key && !elem.$key)
        columns.push( createColumnLocalizedElement( originalElement, shouldUseJoin ) );
      else if (shouldUseJoin)
        // In JOIN mode we also want to add keys.
        columns.push( createColumnRef( [ 'L_0', originalElement ] ));

      addCoreComputedIfNecessary(convenienceView.elements, originalElement);
    }

    return convenienceView;


    function createFromClauseForEntity() {
      if (!shouldUseJoin) {
        return createColumnRef( [ entityName ], 'L');
      }

      const from = {
        join: 'left',
        args: [
          createColumnRef( [ entityName ], 'L_0'),
          createColumnRef( [ textsEntityName(entityName) ], 'localized_1' ),
        ],
        on: []
      };

      for (const originalElement of textElements) {
        const elem = entity.elements[originalElement];
        if (elem.key || elem.$key) {
          from.on.push( createColumnRef( [ 'localized_1', originalElement ] ));
          from.on.push( '=' );
          from.on.push( createColumnRef( [ 'L_0', originalElement ] ));
          from.on.push( 'and' );
        }
      }

      from.on.push( createColumnRef( [ 'localized_1', 'locale' ] ) );
      from.on.push( '=' );
      from.on.push( createColumnRef( [ '$user', 'locale' ] ) );

      return from;
    }

  }

  /**
   * Create a localized convenience view for the given definition `view`.
   * Does _not_ rewrite references.
   *
   * @param {CSN.Definition} view
   * @returns {CSN.View}
   */
  function createLocalizedViewForView( view ) {
    const convenienceView = {
      kind: 'entity',
      '@odata.draft.enabled': false
    };

    if (view.query)
      convenienceView.query = cloneCsnNonDict(view.query, options);
    else if (view.projection)
      convenienceView.projection = cloneCsnNonDict(view.projection, options);

    convenienceView.elements = cloneCsnDict(view.elements, options);
    convenienceView[_isViewForView] = true;
    copyLocation(convenienceView, view);

    Object.keys(convenienceView.elements).forEach((elemName) => {
      addCoreComputedIfNecessary(convenienceView.elements, elemName);
    });

    if (view.params)
      convenienceView.params = cloneCsnDict(view.params, options);

    return convenienceView;
  }

  /** @return {CSN.Column} */
  function createColumnLocalizedElement(elementName, shouldUseJoins) {
    // In JOIN mode the association is removed.  We use `_N` suffixes for minimal
    // test-ref-diffs.
    // TODO: Remove `L_0` special handling.
    const mainName = shouldUseJoins ? 'L_0' : 'L';
    const localizedNames = shouldUseJoins ? [ 'localized_1' ] : [ 'L', 'localized' ];

    if (noCoalesce) {
      return createColumnRef( [...localizedNames, elementName], elementName );
    }

    return {
      func: 'coalesce',
      args: [
        createColumnRef( [ ...localizedNames, elementName] ),
        createColumnRef( [ mainName, elementName ] ),
      ],
      as: elementName,
    };
  }

  /**
   * Update the view element in such a way that it is compatible to the old XSN
   * based localized functionality.
   * Also, because `coalesce` is a function, mark the element `@Core.Computed`
   * if necessary.
   *
   * @param {object} elementsDict
   * @param {string} elementName
   */
  function addCoreComputedIfNecessary(elementsDict, elementName) {
    const element = elementsDict[elementName];
    if (!element.localized)
      return;

    if (noCoalesce) {
      // In the XSN based localized functionality, `localized` was set to `false`
      // because of the propagator and the `texts` entity.  The element is not
      // computed because it is directly referenced.
      // We imitate this behavior here to get a smaller test-file diff.
      element.localized = false;
    }
    else if (!element.key && !element.$key) {
      // Because in coalesce mode a function is used, localized non-key elements
      // are not directly referenced which results in a `@Core.Computed` annotation.
      element['@Core.Computed'] = true;
    }
  }

  /**
   * Returns all text element names for a definition `<artName>` if its texts entity
   * exists and `<artName>` has localized fields.  Otherwise `null` is returned.
   * Text elements are localized elements as well as keys.
   *
   * @param {string} artName Artifact name
   * @return {string[] | null}
   */
  function getLocalizedTextElements( artName ) {
    const art = csn.definitions[artName];
    const artPath = [ 'definitions', artName ];

    let keyCount = 0;
    let textElements = [];

    forEachGeneric(art, 'elements', (elem, elemName , _prop) => {
      if (elem.$ignore) // from SAP HANA backend
        return;

      if (elem.key || elem.$key)
        keyCount += 1;

      if (elem.key || elem.$key || elem.localized)
        textElements.push( elemName );
    }, artPath);

    if (textElements.length <= keyCount || keyCount <= 0)
      // Nothing to do: no localized fields or all localized fields are keys
      return null;

    if (!isEntityPreprocessed( art )) {
      messageFunctions.info( null, artPath, { name: artName },
             'Skipped creation of convenience view for $(NAME) because the artifact is missing localization elements' );
      return null;
    }

    const textsName = textsEntityName( artName );
    const textsEntity = csn.definitions[textsName];

    if (!textsEntity) {
      messageFunctions.info( null, artPath, { name: artName },
             'Skipped creation of convenience view for $(NAME) because its texts entity could not be found' );
      return null;
    }
    if (!isValidTextsEntity( textsEntity )) {
      messageFunctions.info( null, [ 'definitions', textsName ], { name: artName },
             'Skipped creation of convenience view for $(NAME) because its texts entity does not appear to be valid' );
      return null;
    }
    if (!art[annoPersistenceSkip] && textsEntity[annoPersistenceSkip]) {
      messageFunctions.message( 'anno-unexpected-localized-skip', artPath,
          { name: textsName, art: artName, anno: annoPersistenceSkip } );
      return null;
    }

    // There may be keys in the original artifact that were added by the core compiler,
    // for example elements that are marked @cds.valid.from.
    // These keys are not present in the texts entity generated by the compiler.
    // So if we don't filter them out, we may generate invalid SQL.
    textElements = textElements.filter((elemName) => {
      const hasElement = !!textsEntity.elements[elemName];
      if (!hasElement && (art.elements[elemName].key || art.elements[elemName].$key))
        keyCount--;
      return hasElement;
    });

    if (textElements.length <= keyCount || keyCount <= 0)
      // Repeat the check already used above as the number of keys may have changed.
      return null;

    return textElements;
  }

  /**
   * Transitively create convenience views for entities/views that have
   * associations to localized entities, views that themselves have such
   * a dependency or views that contain projections on localized elements.
   *
   * The algorithm is as follows:
   *
   *  1. For each view with elements that have `localized: true` markers:
   *      => add view to array `entities`
   *     For each view/entity with associations:
   *      - If target is NOT localized => add view/entity to target's `_targetFor` property
   *      - If target is     localized => add view/entity to array `entities`
   *  2. As long as `entities` has entries:
   *      a. For each entry in `entities`
   *         - Create a convenience view
   *         - If the entry has a `_targetFor` property, add its entries to `nextEntities`
   *           because they now have a transitive dependency on a localized view.
   *      b. Copy all entries from `nextEntities` to `entities`.
   *      c. Clear `nextEntities`.
   *  3. Rewrite all references to the localized variants.
   */
  function createTransitiveConvenienceViews() {
    let entities = [];
    forEachDefinition( csn, collectLocalizedEntities );

    let nextEntities = [];
    while (entities.length) {
      entities.forEach( createViewAndCollectSources );
      entities = [ ...nextEntities ];
      nextEntities = [];
    }
    forEachDefinition( csn, rewriteToLocalized );
    return;

    function collectLocalizedEntities( art, artName ) {
      if (art.kind !== 'entity')
        // Ignore non-entities but also process entities because of associations.
        return;
      if (isInLocalizedNamespace(artName))
        // Ignore existing `localized.` views.
        return;
      if (art[_hasLocalizedView])
        // Entity already has a convenience view.
        return;

      _collectFromElements(art.elements);

      function _collectFromElements(elements) {
        if (!elements)
          return;

        // Element may be localized or has an association to localized entity.
        for (const elemName in elements) {
          const elem = elements[elemName];

          if ((art.query || art.projection) && elem.localized && !elem.key && !elem.$key) {
            // e.g. projections ; ignore if key is present (warning already issued) or
            // if the artifact is an entity (already processed in (1))
            entities.push(artName);
          }
          else if (!ignoreAssocToLocalized && elem.target) {
            // If the target has a localized view then we are localized as well.
            const def = csn.definitions[elem.target];
            if (!def)
              continue;

            if (def[_hasLocalizedView]) {
              // The target may already be localized and if so, then add the artifact
              // to the to-be-processed entities.
              entities.push(artName);
            }
            else {
              // Otherwise the target view may become localized at a later point so
              // we should add it to a reverse-dependency list.
              if (!def[_targetFor])
                def[_targetFor] = [];
              def[_targetFor].push(artName);
            }

          } else {
            // recursive check
            _collectFromElements(elem.elements);
          }
        }
      }
    }

    /**
     * Create a localization view for `artName` and add views/entities that depend
     * on `artName` to `nextEntities`
     *
     * @param {string} artName
     */
    function createViewAndCollectSources( artName ) {
      const art = csn.definitions[artName];
      if (art[_hasLocalizedView])
        // view/entity was already processed
        return;

      addLocalizedView(artName);

      if (!ignoreAssocToLocalized && art[_targetFor])
        nextEntities.push(...art[_targetFor]);
      delete art[_targetFor];
    }
  }

  /**
   * Rewrites query/association references inside `art` to "localized"-ones if they exist.
   *
   * @param {CSN.Definition} art
   * @param {string} artName
   */
  function rewriteToLocalized( art, artName ) {
    if (art[_isViewForEntity]) {
      // For entity convenience views only references in elements need to be rewritten.
      // a.k.a 'LOCALIZED-HORIZONTAL'
      forEachGeneric(art, 'elements', elem => rewriteDirectRefPropsToLocalized(elem));
    }
    else if (art[_isViewForView]) {
      // For view convenience views (i.e. transitive views) we need to rewrite `from`
      // references as well as need to handle `mixin` elements.
      // a.k.a 'LOCALIZED-VERTICAL'
      forAllQueries(art.query || { SELECT: art.projection }, (query) => {
        query = query.SELECT || query.SET || query;
        if (query.from)
          rewriteFrom(query.from);
        if (query.mixin)
          forEachGeneric(query, 'mixin', elem => rewriteDirectRefPropsToLocalized(elem));

        (query.columns || []).forEach((column) => {
          if (column && typeof column === 'object' && column.cast)
            rewriteDirectRefPropsToLocalized(column.cast);
        });
      }, [ 'definitions', artName ]);

      forEachGeneric(art, 'elements', elem => rewriteDirectRefPropsToLocalized(elem));
    }
  }

  /**
   * A query's FROM clause may be a simple ref but could also be more complex
   * and contain `args` that themselves are JOINs with `args`.
   * So rewrite the references recursively.
   *
   * @param {CSN.QueryFrom} from
   */
  function rewriteFrom(from) {
    rewriteRefToLocalized( from );
    if (Array.isArray(from.args))
      from.args.forEach(arg => rewriteFrom(arg));
  }

  /**
   * Rewrites type references in `obj[ 'ref' | 'target' | 'on' ]]`.
   * Does _not_ do so recursively!
   *
   * @param {object} obj
   */
  function rewriteDirectRefPropsToLocalized( obj ) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj))
      return;

    for (const prop of [ 'ref', 'target' ]) {
      const val = obj[prop];
      if (prop === 'ref') {
        rewriteRefToLocalized(obj);
      }
      else if (Array.isArray(val)) {
        val.forEach(rewriteDirectRefPropsToLocalized);
      }
      else if (typeof val === 'string') {
        const def = csn.definitions[val];
        if (def && def[_hasLocalizedView])
          obj[prop] = def[_hasLocalizedView];
      }
    }
  }

  /**
   * Rewrites the type reference `obj.ref`.
   *
   * @param {object} obj
   * @todo Aliases?
   */
  function rewriteRefToLocalized( obj ) {
    if (!obj || !obj.ref)
      return;
    const ref = Array.isArray(obj.ref) ? obj.ref[0] : obj.ref;
    if (typeof ref === 'string') {
      const def = csn.definitions[ref];
      if (def && def[_hasLocalizedView]) {
        if (Array.isArray(obj.ref))
          obj.ref[0] = def[_hasLocalizedView];
        else
        obj.ref = def[_hasLocalizedView];
      }

    } else if (ref.id) {
      const def = csn.definitions[ref.id];
      if (def && def[_hasLocalizedView])
        obj.ref[0].id = def[_hasLocalizedView];

    } else if (options.testMode) {
      throw new CompilerAssertion('Debug me: Unhandled reference during localized-rewrite!');
    }
  }

  /**
   * @param {string} artName
   */
  function textsEntityName(artName) {
    // We can assume that the element exists.  This is checked in isEntityPreprocessed().
    return csn.definitions[artName].elements.texts.target;
  }

  function cleanDefinitionSymbols() {
    forEachDefinition(csn, function cleanDefinition(definition) {
      cleanSymbols(definition, _hasLocalizedView, _isViewForEntity, _isViewForView, _targetFor);
    });
  }

  /**
   * In case that the user tried to annotate `localized.*` artifacts, apply them.
   */
  function applyAnnotationsForLocalizedViews() {
    applyAnnotationsFromExtensions(csn, {
      override: true,
      filter: (name) => name.startsWith('localized.'),
      notFound(name, index) {
        if (!ignoreUnknownExtensions) {
          messageFunctions.message('ext-undefined-def', [ 'extensions', index ],
                                   { art: name });
        }
      },
    });
    forEachDefinition(csn, checkAnnotationsOnLocalized);
  }

  /**
   * @param {CSN.Definition} def
   * @param {string} defName
   */
  function checkAnnotationsOnLocalized(def, defName) {
    const localizedPrefix = 'localized.';
    if (defName.startsWith(localizedPrefix)) {
      const artName = defName.substring(localizedPrefix.length);
      const art = csn.definitions[artName];
      if (def[annoPersistenceSkip] && !art?.[annoPersistenceSkip]) {
        messageFunctions.message( 'anno-unexpected-localized-skip', ['definitions', defName], {
          '#': 'view',
          name: defName,
          art: artName,
          anno: annoPersistenceSkip
        });
      }
    }
  }
}

/**
 * Create transitive localized convenience views to the given CSN.
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param [config]
 */
function addLocalizationViews(csn, options, config = {}) {
  return _addLocalizationViews(csn, options, { ...config, useJoins: false });
}

/**
 * Create transitive localized convenience views to the given CSN but
 * rewrite the "localized" association to joins in direct entity convenience
 * views.  This is needed e.g. by SQL for SQLite where A2J is used.
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param [config]
 */
function addLocalizationViewsWithJoins(csn, options, config = {}) {
  return _addLocalizationViews(csn, options, { ...config, useJoins: true });
}

/**
 * @param {string[]} ref Reference path
 * @param {string} [as] Alias for path.
 * @return {CSN.Column}
 */
function createColumnRef(ref, as) {
  const column = { ref };
  if (as)
    column.as = as;
  // @ts-ignore
  return column;
}

/**
 * Create columns for the given entity's elements.
 * Only create columns for elements that are not part of the excludeList.
 *
 * @param {CSN.Definition} entity
 * @param {string} entityName
 * @param {string[]} excludeList
 * @returns {CSN.Column[]}
 */
function columnsForEntityWithExcludeList(entity, entityName, excludeList) {
  // @ts-ignore
  return Object.keys(entity.elements)
    .filter(elementName => !excludeList.includes(elementName))
    .map(elementName => {
      return { ref: [ entityName, elementName ] };
    });
}

/**
 * Copy `source.$location` as a non-enumerable to `target.$location`.
 *
 * @param {object} target
 * @param {object} source
 */
function copyLocation(target, source) {
  if (source.$location)
    setProp(target, '$location', source.$location);
}

/**
 * Copy @cds.persistence.skip annotations from the source to
 * the target.  Ignores existing annotations on the _target_.
 *
 * @param {CSN.Artifact} target
 * @param {CSN.Artifact} source
 */
function copyPersistenceAnnotations(target, source) {
  forEachKey(source, anno => {
    // Note:
    //   v3/v4: Because `.exists` is copied to the convenience view, it could
    //   lead to some localization views referencing non-existing ones.
    //   But that is the contract: User says that it already exists!
    //   v2/>=v5, `.exists` is never copied.
    if (anno === annoPersistenceSkip)
      target[anno] = source[anno];
  });
}

/**
 * Warns about the first existing `localized.` view.
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 * @param {object} messageFunctions
 */
function checkExistingLocalizationViews(csn, options, messageFunctions) {
  if (!csn || !csn.definitions)
    return false;

  let hasExistingViews = false;
  let hasNonViews = false;

  forEachDefinition(csn, (def, name) => {
    if (isInLocalizedNamespace(name) || name === 'localized') {
      if (!def.query && !def.projection) {
        if (!name.endsWith('.texts')) {
          hasNonViews = true;
          messageFunctions.error('reserved-namespace-localized', ['definitions', name], { name: 'localized' },
            'The namespace $(NAME) is reserved for localization views');
        }
      } else if (!hasExistingViews) {
        hasExistingViews = true;
        messageFunctions.info( null, [ 'definitions', name ], {},
          'Input CSN already contains localization views, no further ones will be created' );
      }
    }
  });
  return hasExistingViews || hasNonViews;
}

/**
 * Returns true if the given entity appears to be a valid texts entity.
 *
 * @param {CSN.Artifact} entity
 */
function isValidTextsEntity(entity) {
  if (!entity)
    return false;
  const requiredTextsProps = [ 'locale' ];
  return requiredTextsProps.some( prop => !!entity.elements[prop])
}

/**
 * Returns true if the localized entity has elements that are generated by
 * the core-compiler.  If elements are missing but the entity is localized
 * then the pre-processing by the core-compiler was not done.
 *
 * @param {CSN.Artifact} entity
 */
function isEntityPreprocessed(entity) {
  if (!entity)
    return false;
  if (!entity.elements.localized)
    return false;
  return entity.elements.texts && entity.elements.texts.target;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function isInLocalizedNamespace(name) {
  return name === 'localized' || name.startsWith('localized.');
}

/**
 * Return true if the given artifact has a localized convenience view in the CSN model.
 *
 * @param {CSN.Model} csn
 * @param {string} artifactName
 * @returns {boolean}
 */
function hasLocalizedConvenienceView(csn, artifactName) {
  return !isInLocalizedNamespace(artifactName) && !!csn.definitions[`localized.${ artifactName }`];
}

/**
 * For tests (testMode), sort the generated localized definitions, i.e. their props,
 * but also sort 'csn.definitions' if requested.
 *
 * @param {CSN.Model} csn
 * @param {CSN.Options} options
 */
function sortLocalizedForTests(csn, options) {
  if (options.testMode) {
    for (const defName in csn.definitions) {
      if (defName.startsWith('localized.'))
        csn.definitions[defName] = sortCsn(csn.definitions[defName], options);
    }
  }
  sortCsnDefinitionsForTests(csn, options);
}

module.exports = {
  addLocalizationViews,
  addLocalizationViewsWithJoins,
  isInLocalizedNamespace,
  hasLocalizedConvenienceView,
};
