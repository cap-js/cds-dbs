'use strict'

const { setProp, forEachGeneric, forEachDefinition, isBetaEnabled } = require('../base/model');
const { makeMessageFunction } = require('../base/messages');
const { recompileX } = require('../compiler/index');
const { linkToOrigin, pathName } = require('../compiler/utils');
const  {compactModel, compactExpr} = require('../json/to-csn');
const { deduplicateMessages } = require('../base/messages');
const { timetrace } = require('../utils/timetrace');
const {CompilerAssertion} = require('../base/error');
// Paths that start with an artifact of protected kind are special
// either ignore them in QAT building or in path rewriting
const internalArtifactKinds = ['builtin', '$parameters', 'param'];

function translateAssocsToJoinsCSN(csn, options){
  timetrace.start('A2J: Recompiling model');
  // Do not re-complain about localized
  const compileOptions = { ...options, $skipNameCheck: true };
  delete compileOptions.csnFlavor;

  //require('fs').writeFileSync('./csninput_a2j.json', JSON.stringify(csn, null,2))
  //console.log('CSN passed by A2J to compiler:',JSON.stringify(csn,null,2))
  const model = recompileX(csn, compileOptions);
  timetrace.stop('A2J: Recompiling model');
  timetrace.start('A2J: Translating associations to joins');
  translateAssocsToJoins(model, options);
  timetrace.stop('A2J: Translating associations to joins');
  // Use the effective elements list as columns
  forEachDefinition(model, art => {
    if (art.$queries) {
      for (const query of art.$queries) {
        query.columns = Object.values(query.elements);
        // TODO: Remove viaAll
        for (const elemName in query.elements) {
          const elem = query.elements[elemName];
          if (elem.$inferred === '*')
            delete elem.$inferred;
        }
      }
    }
  });

  if (options.messages) {
    // Make sure that we don't complain twice about the same things
    deduplicateMessages( options.messages );
  }

  // FIXME: Move this somewhere more appropriate
  const newCsn = compactModel(model, compileOptions);
  //require('fs').writeFileSync('./csnoutput_a2j.json', JSON.stringify(newCsn, null,2))
  //console.log('CSN returned by A2J:',JSON.stringify(newCsn,null,2))
  return newCsn;
}

function translateAssocsToJoins(model, inputOptions = {})
{
  const { error, warning, throwWithError } = makeMessageFunction(model, inputOptions, 'a2j');

  const options = model.options || inputOptions;

  // create JOINs for foreign key paths
  const noJoinForFK = options.forHana ? !options.joinfk : true;

  // Note: This is called from the 'forHana' transformations, so it is controlled by its options
  const pathDelimiter = (options.forHana && options.sqlMapping === 'hdbcds') ? '.' : '_';

  forEachDefinition(model, prepareAssociations);
  forEachDefinition(model, transformQueries);

  // If A2J reports error - end! Continuing with a broken model makes no sense
  throwWithError();

  return model;

  function prepareAssociations(art)
  {
    if(art.kind === 'element' && art.target)
    {
      /* Create the prefix string up to the main artifact which is
         prepended to all source side paths of the resulting ON condition
         (cut off name.id from name.element)
      */
      art.$elementPrefix = '';
      for(let parent = art._parent; parent?.kind === 'element'; parent = parent._parent)
        art.$elementPrefix = parent.name.id + pathDelimiter + art.$elementPrefix;

      /*
        Create path prefix tree for Foreign Keys, required to substitute
        aliases in ON cond calculation, also very useful to detect fk overlaps.
      */
      if(art.foreignKeys && !art.$fkPathPrefixTree)
      {
        art.$fkPathPrefixTree = { children: Object.create(null) };
        forEachGeneric(art, 'foreignKeys', fk => {
          let ppt = art.$fkPathPrefixTree;
          fk.targetElement.path.forEach(ps => {
            if(!ppt.children[ps.id])
              ppt = ppt.children[ps.id] = { children: Object.create(null) };
            else
              ppt = ppt.children[ps.id];
          });
          ppt._fk = fk;
        });
      }
    }
    // drill into structures
    forEachGeneric(art, 'elements', prepareAssociations);
  }

  function transformQueries(art)
  {
    if(art.$queries === undefined)
      return;

    function forEachQuery(callback, env) {
      art.$queries.forEach((q,i) => {
        if(env !== undefined)
          env.queryIndex = i;
        callback(q, env);
      });
    }

    const env = {
      aliasCount: 0,
      walkover: { from: true, onCondFrom:true, select:true, filter: true },
    };
    /*
      Setup QAs for mixins
      Mark all mixin assoc definitions with a pseudo QA that points to the assoc target.
      This QA is required to detect mixin assoc usages to decide whether a minimum or full
      join needs to be done
    */
    forEachQuery(createQAForMixinAssoc, env);

    /*
      Setup QATs and leaf QAs (@ query and subqueries in from clause)
      a) For all paths in a query create the path prefix trees aka QATs.
          Paths that start with a mixin assoc are Qat'ed into the mixin definition.
          If a mixin assoc is published, its leaf Qat receives the pseudo QA(view) from the rootQat,
          which is the mixin definition itself. See 1a)
      b) Create QAs for FROM clause subqueries, as they are not yet swept by the path walk
    */
    env.callback = mergePathIntoQAT;
    forEachQuery(walkQuery, env);

    forEachQuery(createQAForFromClauseSubQuery, env);

    // 2) Walk over each from table path, transform it into a join tree
    env.walkover = { from:true, onCondFrom:false, select: false, filter: false };
    env.callback = createInnerJoins;
    forEachQuery(walkQuery, env);

    // 3) Transform all remaining join relevant paths into left outer joins and connect with
    //    FROM block join tree. Instead of walking paths it is sufficient to process the $qat
    //    of each $tableAlias.
    forEachQuery(createLeftOuterJoins, env);

    // 4) Rewrite ON condition paths that are part of the original FROM block
    //    (same rewrite as (injected) assoc ON cond paths but with different table alias).
    // 5) Prepend table alias to all remaining paths
    env.walkover = { from:false, onCondFrom:true, select: true, filter: false };
    env.callback = substituteDollarSelf;
    forEachQuery(walkQuery, env);
    env.callback = rewriteGenericPaths;
    forEachQuery(walkQuery, env);

    // 6) Attach firstFilterConds to Where Condition.
    forEachQuery(attachFirstFilterConditions);
  }

  // Transform each FROM table path into a join tree and attach the tree to the path object
  function createInnerJoins(fromPathNode, env)
  {
    const fqat = env.lead.$tableAliases[fromPathNode.name.id].$fqat;
    const joinTree = createJoinTree(env, undefined, fqat, 'inner', '$fqat', undefined);

    replaceTableAliasInPlace( fromPathNode, joinTree);
  }

  // Translate all other join relevant query paths into left outer join tree and attach it to the lead query
  function createLeftOuterJoins(query, env)
  {
    if(query.op.val === 'SELECT')
    {
      env.lead = query;
      let joinTree = query.from;
      for(const tan in query.$tableAliases)
      {
        if(query.$tableAliases[tan].kind !== '$self') // don't drive into $projection/$self tableAlias (yet)
        {
          const ta = query.$tableAliases[tan];
          joinTree = createJoinTree(env, joinTree, ta.$qat, 'left', '$qat', ta.$QA);
        }
      }
      query.from = joinTree;
    }
  }

  /*
    Each leaf node of a table path must end in either a direct or a target artifact.
    During mergePathIntoQat() this 'leaf' artifact is marked as a QA at the corresponding
    'leaf' QAT and to the respective $tableAlias which is used to link paths to the correct
    table alias. Subqueries are not considered in the mergePathIntoQat(), so a subquery QA
    must be created and added separately to the lead query $tableAlias'es.
    Also, the name of the subquery (the alias) needs to be set to the final QA alias name.
  */
  function createQAForFromClauseSubQuery(query, env)
  {
    for (const taName in query.$tableAliases) {
      if (query.$tableAliases[taName].kind !== '$self') {
        const ta = query.$tableAliases[taName];
        if(!ta.$QA) {
          let alias = taName;
          if (ta.name.$inferred === '$internal') {
            // query has no explicit table alias, i.e. is internal: make it visible and remove `$`
            alias = ta.name.id.replace(/^[$]/, '_');
            ta.$inferred = undefined;
            ta.name.$inferred = undefined;
          }
          ta.$QA = createQA(env, ta._origin, alias, undefined);
          incAliasCount(env, ta.$QA);
          if(ta.name && ta.name.id) {
            ta.name.id = ta.$QA.name.id;
          }
        }
      }
    }
    // Only subqueries of the FROM clause have a name (which is the alias)
    // TODO Discuss: a query does not have a name.id anymore
    // const queryAlias = query._parent; // parent could also be outer query, or main entity
    // if(query.op.val === 'SELECT' && query.name.id && queryAlias && queryAlias.kind === '$tableAlias')
    // {
    //   query.name.id = queryAlias._parent.$tableAliases[query.name.id].$QA.name.id;
    // }
  }

  /*
    Add an artificial QA for each mixin definition. This QA completes the QAT
    data-structure that requires a QA at the rootQat before starting the join generation.
    This QA is marked as 'mixin' which indicates that the paths of the ON condition must
    not receive the usual source and target table alias (which is used for generic associations)
    but instead just use the rootQA of the individual ON condition paths. These paths are
    resolved against the FROM clause and must of course be connected to the respective table
    aliases.

  */
  function createQAForMixinAssoc(query, env)
  {
    if(query.op.val === 'SELECT')
    {
      env.lead = query;
      // use view as QA origin
      forEachGeneric(query, 'mixin', art => {
        if(!art.$QA)
        {
          art.$QA = createQA(env, art.target._artifact, art.name.id );
          art.$QA.mixin = true;
        }
      });
    }
  }

  /*
    Substitute $self/$projection expression with its value
  */
  function substituteDollarSelf(pathNode, env)
  {
    // do not substitute $self values for outer order by clauses
    if (env?.location === 'UnionOuterOrderBy')
      return;

    let pathValue = pathNode;
    let [head, ...tail] = pathValue.path;
    while(tail.length && head._navigation?.kind === '$self') {
      const self = head;
      [head, ...tail] = tail;
      if(head) {
        pathValue = self._navigation._origin.elements[head.id].value;
        // core compiler has already caught $self.<assoc>.<postfix> and
        // non-path $self expressions with postfix path
        if(pathValue.path) {
          if(tail.length)
            pathValue = constructPathNode([...pathValue.path, ...tail], pathValue.alias, false);
          [head, ...tail] = pathValue.path;
        }
      }
    }
    if(head)
      replaceNodeContent(pathNode, pathValue);
  }

  /*
    Prefix all paths with table alias (or replace existing alias)

    Rewrite a given path of the native ON condition to TableAlias.ColumnName
    and substitute all eventually occurring foreign key path segments against
    the respective FK aliases.
    No flattening of structured leaf types necessary, this is done in renderer
  */
  function rewriteGenericPaths(pathNode, env)
  {
    if(pathNode.$rewritten)
      return;

    if(env.location === 'onCondFrom')
    {
      if(checkPathDictionary(pathNode, env)) {
        const [ tableAlias, tail ] = constructTableAliasAndTailPath(pathNode.path);
        const pathStr = translateONCondPath(tail).map(ps => ps.id).join(pathDelimiter);
        replaceNodeContent(pathNode,
          constructPathNode([ tableAlias, { id: pathStr, _artifact: pathNode._artifact } ]));
      }
    }
    else
    {
      // Paths without _navigation in ORDER BY are select item aliases, they must
      // be rendered verbatim
      let [head, ...tail] = pathNode.path;
      if((env.location === 'OrderBy' && !head._navigation)||
         env.location === 'UnionOuterOrderBy' && (!head._navigation || ['$self', '$projection'].includes(head.id)))
        return;

      // path outside ON cond:
      // spin the crystal ball to identify the correct table alias

      // pop ta ps
      if(head._navigation.kind !== '$tableAlias')
        tail = pathNode.path;
      // if tail.length > 1, search bottom up for QA
      // default to rootQA, _parent.$QA has precedence
      const [QA, ps] = rightMostQA(tail, head._navigation._parent.$QA || head._navigation.$QA);
      if(!QA) {
        error(null, pathNode.$location,
          { name: pathName(pathNode.path) },
          'Debug me: No QA found for generic path rewriting in $(NAME)')
        return;
      }
      // if the found QA is the mixin QA and if the path length is one,
      // this indicates the publishing of a mixin assoc, don't rewrite the path
      if(QA.mixin && tail.length === 1)
        return;
      let pos = tail.indexOf(ps);
      // cut off ps if it's a join relevant association with postfix
      if(tail.length-(pos+1) > 0 && ps._artifact.target && !ps._navigation.$njr)
        pos++;
      // QA + tail is the rewritten path
      tail = tail.slice(pos);
      // check from left to right (longest match) if a subsequent QAT is $njr
      // if so, substitute path with pregenerated foreign key, prepend by optional
      // (to be flattened) prefix

      for(let i = 0; i < tail.length-1; i++) {
        if(tail[i]._navigation && tail[i]._navigation.$njr) {
          // the correct flattened foreign key must match the leaf artifact and access path prefix of this path
          const leafArt = tail[tail.length-1]._artifact;
          const tailPath = tail.map(p=>p.id).join(pathDelimiter);
          const fk = tail[i]._artifact.$flatSrcFKs.find(f => f._artifact === leafArt && f.acc.startsWith(tailPath));
          if(!fk) {
            // const revealInternalProperties = require('../model/revealInternalProperties.js');
            // console.log('++++++++ Path tail: ', revealInternalProperties(tail[tail.length-1]._artifact));
            // console.log('******** Flat FKs\n', tail[i]._artifact.$flatSrcFKs.map(f => revealInternalProperties(f._artifact)));
            throw new CompilerAssertion('Debug me: No flat FK found for FK rewriting');
          }
          // replace tail path with flattened foreign key including prefix
          tail.splice(i, tail.length, fk);
        }
      }
      tail = [
        { id: tail.map(p => p.id).join(pathDelimiter),
          _artifact: tail[tail.length-1]._artifact
        }
      ];
      replaceNodeContent(pathNode,
        constructPathNode([ constructTableAliasPathStep(QA), ...tail ]));
    }

    function rightMostQA(path, rootQA) {
      // iterate over the path and search for first QA that
      // either matches a $tableAlias or an association,
      // if no QA could be found, return rootQA
      // this is the table alias
      /*
        Search right to left to find first QA in QAT tree
        Start with n-1st path element (to not find QA for exposed
        nested association).
        If no QA could be found, return rootQA with first path
        step.
      */
      let QA = undefined;
      let pl = path.length-1;
      let ps = path[pl]; // return [null, ps] for pl==0
      while(!QA && pl > 0)
      {
        ps = path[--pl];
        if(ps._navigation)
          QA = ps._navigation.$QA;
      }
      return [(QA ? QA : rootQA), ps];
    }
  }

  /*
    AND filter conditions of the first path steps of the FROM clause to the WHERE condition.
    If WHERE does not exist, create a new one. This step must be done after rewriteGenericPaths()
    as the filter expressions would be traversed twice.
  */
  function attachFirstFilterConditions(query)
  {
    if(query.$startFilters)
    {
      if(query.where)
      {
        if(query.where.op.val === 'and')
          query.where.args.push(...query.$startFilters.map(parenthesise));
        else
          query.where = { op: {val: 'and' }, args: [ parenthesise(query.where),  ...query.$startFilters.map(parenthesise) ] };
      }
      else
        query.where = query.$startFilters.length > 1
          ? { op: {val: 'and' }, args: query.$startFilters.map(parenthesise) }
          : parenthesise(query.$startFilters[0]);
    }
  }

  /*
    Transform a QATree into a JOIN tree
    Starting from a root (parentQat) follow all QAT children and in
    case QAT.origin is an association, create a new JOIN node using
    the existing joinTree as LHS and the QAT.QA as RHS.
  */
  function createJoinTree(env, joinTree, parentQat, joinType, qatAttribName, lastAssocQA)
  {
    for(const childQatId in parentQat)
    {
      const childQat = parentQat[childQatId];

      // If this QAT is not join relevant, don't drill down any further but
      // continue with current parentQat
      if(!childQat.$njr) {
        let newAssocLHS = lastAssocQA;
        const art = childQat._origin;
        if(art.kind === 'entity')
        {
          if(!childQat.$QA)
            childQat.$QA = createQA(env, art, art.name.id.split('.').pop(), childQat._namedArgs);
          incAliasCount(env, childQat.$QA);
          newAssocLHS = childQat.$QA;

          if(joinTree === undefined) // This is the first artifact in the JOIN tree
          {
            joinTree = childQat.$QA;
            // Collect the toplevel filters and add them to the where condition
            if(childQat._filter)
            {
              // Filter conditions are unique for each JOIN, they don't need to be copied
              const filter = childQat._filter;
              rewritePathsInFilterExpression(filter, function(pathNode) {
                return [ /* tableAlias=> */ constructTableAliasPathStep(childQat.$QA),
                        /* filterPath=> */ pathNode.path ];
              }, env);

              if(!env.lead.$startFilters)
                env.lead.$startFilters = [];
              env.lead.$startFilters.push( filter );
            }
          }
        }
        else if(art.target) { // it's not an artifact, so it should be an assoc step
          if(joinTree === undefined)
            throw new CompilerAssertion('Can\'t follow Associations without starting Entity');

          if(!childQat.$QA)
            childQat.$QA = createQA(env, art.target._artifact, art.name.id, childQat._namedArgs);

          incAliasCount(env, childQat.$QA);
          joinTree = createJoinQA(joinType, joinTree, childQat.$QA, childQat, lastAssocQA, env);
          newAssocLHS = childQat.$QA;
        }
        // Follow the children of this QAT to append more JOIN nodes
        joinTree = createJoinTree(env, joinTree, childQat[qatAttribName], joinType, qatAttribName, newAssocLHS);
      }
    }
    return joinTree;
  }

  function createJoinQA(joinType, lhs, rhs, assocQAT, assocSourceQA, env)
  {
    const node = { op: { val: 'join' }, join: { val: joinType }, args: [ lhs, rhs ] };
    const assoc = assocQAT._origin;
    if(isBetaEnabled(options, 'mapAssocToJoinCardinality')) {
      node.cardinality = mapAssocToJoinCardinality(assoc);
    }
    // 'path steps' for the src/tgt table alias
    const srcTableAlias = constructTableAliasPathStep(assocSourceQA);
    const tgtTableAlias = constructTableAliasPathStep(assocQAT.$QA);

    node.on = createOnCondition(assoc, srcTableAlias, tgtTableAlias, options.tenantDiscriminator);

    if(assocQAT._filter)
    {
      // Filter conditions are unique for each JOIN, they don't need to be copied
      const filter = assocQAT._filter;
      rewritePathsInFilterExpression(filter, function(pathNode) {
        return [ tgtTableAlias, pathNode.path ];
      }, env);

      // If toplevel ON cond op is AND add filter condition to the args array,
      // create a new toplevel AND op otherwise
      const onCond = (Array.isArray(node.on) ? node.on[0] : node.on);

      if(onCond.op.val === 'and')
        onCond.args.push(parenthesise(filter));
      else
        node.on = parenthesise({ op: { val: 'and' }, args: [ parenthesise(onCond), parenthesise(filter) ] });
    }
    return node;

    /*
        Map assoc cardinality to allowed JOIN cardinality

        Allowed join cardinalities are:
        [ EXACT ] ONE | MANY TO [ EXACT ] ONE | MANY

        Source side EXACT ONE is not applicable with CSN due to missing
        sourceMin/Max

        Mapping:

        sourceMax != 1 > MANY, sourceMax = 1 > ONE
        targetMax != 1 > MANY, targetMax = 1 > ONE
        targetMin = 1 && targetMax = 1 > EXACT ONE

        Default is the CDS default for Association
        sourceMax = *, targetMax = 1 > MANY TO ONE

        Default is the CDS default for Composition
        sourceMin = 1, sourceMax = 1, targetMax = 1 > EXACT ONE TO ONE
    */
    function mapAssocToJoinCardinality(assoc) {
      /** @type {object} */
      const xsnCard = {
        targetMax : { literal: 'number', val: 1 }
      };
      if(assoc.type._artifact._effectiveType.name.id === 'cds.Composition') {
        xsnCard.sourceMin = { literal: 'number', val: 1 };
        xsnCard.sourceMax = { literal: 'number', val: 1 };
      }
      else {
        xsnCard.sourceMax = { literal: 'string', val: '*' }
      }

      if(assoc.cardinality) {
        if(assoc.cardinality.sourceMax && assoc.cardinality.sourceMax.val === 1) {
          xsnCard.sourceMax.literal = 'number';
          xsnCard.sourceMax.val = 1;
        }
        if(assoc.cardinality.targetMax && assoc.cardinality.targetMax.val !== 1) {
          xsnCard.targetMax.literal = 'string';
          xsnCard.targetMax.val = '*';
        }
        else if(assoc.cardinality.targetMin && assoc.cardinality.targetMin.val === 1)
          xsnCard.targetMin = { literal: 'number', val: 1 };
      }
      return xsnCard;
    }
    // produce the ON condition for a given association
    function createOnCondition(assoc, srcAlias, tgtAlias, compareTenants)
    {
      const prefixes = [ assoc.name.id ];
      /* This is no art and can be removed once ON cond for published
          and renamed backlink assocs are publicly available. Example:

        entity E { ...; toE: association to E; toEb: association to E on $self = toEb.toE; };
        entity EP as projection on E { *, toEb as foo };
        This requires ON cond rewritten to: $self = foo.toE but instead its still $self = toEb.toE,
        so prefix 'foo' won't match....
      */
      if(assoc._origin && !prefixes.includes(assoc._origin.name.id))
        prefixes.push(assoc._origin.name.id);

      // produce the ON condition of the managed association
      if(assoc.foreignKeys)
      {
        /*
          Get both the source and the target column names for the EQ term.
          For the src side provide a path prefix for all paths that is the assocElement name itself preceded by
          the path up to the first lead artifact (usually the entity or view) (or in QAT speak: follow the parent
          QATs until a QA has been found).
        */
        if(!assoc.$flatSrcFKs)
          setProp(assoc, '$flatSrcFKs', flattenElement(assoc, true, assoc.name.id, assoc.name.id));
        if(!assoc.$flatTgtFKs)
          setProp(assoc, '$flatTgtFKs', flattenElement(assoc, false));

        if(assoc.$flatSrcFKs.length != assoc.$flatTgtFKs.length)
          throw new CompilerAssertion('srcPaths length ['+assoc.$flatSrcFKs.length+'] != tgtPaths length ['+assoc.$flatTgtFKs.length+']');

        /*
          Put all src/tgt path siblings into the EQ term and create the proper path objects
          with the src/tgt table alias path steps in front.
        */
        const args = compareTenants && addTenantComparison(assoc) || [];
        for(let i = 0; i < assoc.$flatSrcFKs.length; i++)
        {
          args.push({op: {val: '=' },
            args: [ constructPathNode( [ srcAlias, prefixFK(assoc.$elementPrefix, assoc.$flatSrcFKs[i]) ] ),
                    constructPathNode( [ tgtAlias, assoc.$flatTgtFKs[i] ] ) ] });
        }
        // TODO: why inner "parenthesise" - comparison in `and`?
        return parenthesise((args.length > 1 ? { op: { val: 'and' }, args: [ ...args.map(parenthesise) ] } : args[0] ));
      }
      else {
        if(env.assocStack === undefined) {
          env.assocStack = [];
          env.assocStack.head = function() {
            return this[this.length-1];
          }
          env.assocStack.id = function() {
            return (this.head() && this.head().name.id);
          }
          env.assocStack.element = function() {
            return (this.head() && (this.head().name.element || this.head().name.id));
          }
          env.assocStack.stripAssocPrefix = function(path) {
            return this.stripPrefix(path);
          }

          // offset must be a negative value to indicate prefix length
          // offset=0 includes the element assoc id itself
          env.assocStack.stripPrefix = function(path, offset=0) {
            const elt = this.element();
            const id = this.id();
            if(elt) {
              let found = true;
              const epath = [elt];
              const epl = epath.length+offset;
              if(epl < path.length) {
                for(let i = 0; i < epl && found; i++) {
                  found = epath[i] === path[i].id;
                }
                if(found)
                  return path.slice(epl);
              }
            }
            if(id) {
              let found = true;
              const epath = [id];
              const epl = epath.length+offset;
              if(epl < path.length) {
                for(let i = 0; i < epl && found; i++) {
                  found = epath[i] === path[i].id;
                }
                if(found)
                  return path.slice(epl);
              }
            }
            return path;
          }
        }

        env.assocStack.push(assoc);
        const onCond = cloneOnCondition(assoc.on);
        env.assocStack.pop();
        return compareTenants ? addTenantComparison(assoc, onCond) : onCond;
      }

      // Add tenant comparison
      function addTenantComparison(assoc, cond) {
        // It is enough to test whether the target is tenant-dependent.  If it is,
        // the current query must also be (check in addTenantFields).  If we allow
        // assocs from tenant-independent entities to tenant-dependent ones, we
        // also need to use the current query = `env.lead`.
        if(annotationVal(assoc.target._artifact['@cds.tenant.independent']))
          return cond;

        const args = [ constructPathNode([ srcAlias ]), constructPathNode([ tgtAlias ]) ];
        args[0].path.push({ id: 'tenant' }); // no need for _artifact
        args[1].path.push({ id: 'tenant' }); // no need for _artifact
        const comparison = { op: {val: '=' }, args };
        if (!cond)              // for managed assoc
          return [ comparison ];
        return { op: { val: 'and' }, args: [ comparison, parenthesise(cond) ] };
      }

      // make foreign key absolute to its main entity
      function prefixFK(prefix, fk) {
        return prefix ? { id: prefix+fk.id, _artifact: fk._artifact } : fk
      }
      // clone ON condition with rewritten paths and substituted backlink conditions
      function cloneOnCondition(expr)
      {
        const op = expr.op?.val;
        if(op === 'xpr' || op === 'ixpr' || op === 'nary')
          return cloneOnCondExprStream(expr);
        else
          return cloneOnCondExprTree(expr);
      }

      function cloneOnCondExprStream(expr) {
        const args = expr.args;
        const result = { op: { val: expr.op.val }, args: [ ] };
        for(let i = 0; i < args.length; i++)
        {
          const op = args[i].op?.val;
          if(op === 'xpr' || op === 'ixpr' || op === 'nary')
          {
            result.args.push(cloneOnCondition(args[i]));
          }
          // If this is a backlink condition, produce the
          // ON cond of the forward assoc with swapped src/tgt aliases
          else if(i < args.length-2 && args[i].path &&
                  args[i+1]?.literal === 'token' && args[i+1]?.val === '=' && args[i+2].path)
          {
            const fwdAssoc = getForwardAssociation(args[i].path, args[i+2].path);
            if(fwdAssoc)
            {
              //env.assocStack.includes(fwdAssoc) => recursion
              if(env.assocStack.length === 2) {
                // reuse (ugly) error message from forHana
                error(null, [env.assocStack[0].location,env.assocStack[0]],
                  { name: '$self', id: '$self' },
                  'An association that uses $(NAME) in its ON-condition can\'t be compared to $(ID)');
                // don't check these paths again
                args[i].$check = args[i+2].$check = false;
              }
              else {
                result.args.push(createOnCondition(fwdAssoc, ...swapTableAliasesForFwdAssoc(fwdAssoc, srcAlias, tgtAlias)));
              }
              i += 2; // skip next two tokens and continue with loop
              continue;
            }
            else // it's ensured that it's a path
              result.args.push(rewritePathNode(args[i]));
          }
          else // could be `{op:…}`, clone generically
            result.args.push(cloneOnCondition(args[i]));
        }
        return result;
      }

      function cloneOnCondExprTree(expr) {
        // TODO: This function is not covered by an tests, only cloneOnCondExprStream is.
        // keep parentheses intact
        if(Array.isArray(expr))
          return expr.map(cloneOnCondition);

        // If this is a backlink condition, produce the
        // ON cond of the forward assoc with swapped src/tgt aliases
        const fwdAssoc = getForwardAssociationExpr(expr);
        if(fwdAssoc) {
          if(env.assocStack.length === 2) {
            // reuse (ugly) error message from forHana
            error(null, expr.location, 'An association that uses “$self” in its ON-condition can\'t be compared to “$self”');
            // don't check these paths again
            expr.args.forEach(x => x.$check = false );
            return expr;
          }
          else {
            return createOnCondition(fwdAssoc, ...swapTableAliasesForFwdAssoc(fwdAssoc, srcAlias, tgtAlias));
          }
        }

        // If this is an ordinary expression, clone it and mangle its arguments
        // this will substitute multiple backlink conditions ($self = ... AND $self = ...AND ...)
        if(expr.op) {
          const x = clone(expr);
          if(expr.args)
            x.args = expr.args.map(cloneOnCondition);
          return x;
        }

        // If this is a regular path, rewrite it
        return rewritePathNode(expr);
      }

      // The src/tgtAliases need to be swapped for ON Condition of the forward assoc.
      // If the QAT assoc is a mixin and forward assoc was propagated, the original
      // forward definition must have a target in the query source otherwise the ON cond
      // is not resolvable (exception propagated mixins, as these are defined against the
      // view signature and not a query source). If the target is not part of the query source,
      // raise an error. Swap source and target otherwise.
      function swapTableAliasesForFwdAssoc(fwdAssoc, srcAlias, tgtAlias) {
        const newSrcAlias = tgtAlias;
        let newTgtAlias = {};

        let i = 0;
        let fwdOrigin = fwdAssoc;
        while(fwdOrigin._origin) {
          fwdOrigin = fwdOrigin._origin;
          i++;
        }
        // If fwdAssoc was propagated and the origin is not a mixin itself (which always
        // points to the signature of the current view and ensures that the ON cond is
        // resolvable) make sure that the original assoc target is contained in the local
        // query source
        if(assoc.kind === 'mixin' && i > 0 && fwdOrigin.kind !== 'mixin') {
          const tas = Object.values(env.lead.$tableAliases);
          const i = tas.findIndex(ta => ta._artifact === fwdOrigin.target._artifact);
          if(i >= 0 && tas[i].$QA) {
            newTgtAlias.id = tas[i].$QA.name.id;
            newTgtAlias._artifact = tas[i]._effectiveType;
            newTgtAlias._navigation = tas[i].$QA.path[0]._navigation;
          }
          else {
            error(null, [ assocQAT._origin.location, assocQAT._origin ], { name: fwdOrigin.target._artifact.name.id, art: assoc.name.id },
                    'Expected association target $(NAME) of association $(ART) to be a query source');
            newTgtAlias = Object.assign(newTgtAlias, srcAlias);
          }
        }
        else {
          newTgtAlias = Object.assign(newTgtAlias, srcAlias);
        }
        return [newSrcAlias, newTgtAlias];
      }

      function rewritePathNode(pathNode)
      {
        let tableAlias;
        let path = pathNode.path;
        if(!path) // it's not a path return it
          return pathNode;

        let [head, ...tail] = path;

        // don't rewrite path
        if(internalArtifactKinds.includes(head._artifact.kind))
          return pathNode;

        // strip the absolute path indicators
        let hasDollarSelfPrefix = false;
        if (['$projection', '$self'].includes(head.id) && tail.length) {
          hasDollarSelfPrefix = true;
          path = tail;
        }

        if(!checkPathDictionary(pathNode, env)) {
          return pathNode;
        }

        if(rhs.mixin)
        {
          if (hasDollarSelfPrefix) {
            /* Do the $projection resolution ONLY in own query not for referenced forward ON condition
            view YP as select from Y mixin ( toXP: association to XP on $projection.yid = toXP.xid; } into { yid };
            view XP as select from X mixin { toYP: association to YP on $self = toYP.toXP; } into { xid, toYP.elt };
            X join Y ON ($self = toYP.toXP) => ($projection.yid = toXP.xid) => (Y.yid = X.xid)
            $projection must be removed from $projection.yid (get's aliased with the mixinAssocQAT.$QA)
            */
            if(env.assocStack.length < 2) {
              const value = env.lead.elements[path[0].id].value;
              /*
                If the value is an expression in the select block, return the unmodified
                expression. rewriteGenericPaths will check and rewrite these paths later
                to the correct ON condition expression.
              */

              if(!value.path)
                return value;
              else {
                // check for associations, not allowed at this time, trouble in resolving
                // and addressing the correct foreign key (tuple)
                [ head, ...tail ] = path;
                path = value.path.concat(tail);
              }
            }
          }
          else {
            // $self/$projection without tail is an error: $self = $self
          }

          /*
            If all mixin assoc paths would result in the same join node (that is exactly
            one shared QAT for all mixin path steps) it would be sufficient to reuse the
            definition QA (see createQAForMixinAssoc()) for sharing the table alias.

            As mixin assoc paths may have different filter conditions, separate QATs are
            created for each distinct filter, resulting in separate JOIN trees requiring
            individual table aliases. This also requires separate QAs at the assoc QAT
            to hold the individual table aliases (that's why the definition QA is cloned
            in mergePathIntoQAT()).

            Paths in the ON condition referring to the target side are linked to the
            original mixin QA via head._navigation (done by the compiler), which in turn
            is childQat._parent (a mixin assoc path step MUST be path root, so _parent
            IS the mixin definition. Mixin QATs are created at the mixin definition).
            In order to create the correct table alias path, the definition QA must
            be replaced with the current childQat.QA (the clone with the correct alias).
            The original QA is used as template for its clones and can safely be replaced.

            Example:
            select from ... mixin { toTgt: association to Tgt on toTgt.elt = elt; }
            into { toTgt[f1].field1, toTgt[f2].field2 };

            toTgt definition has definition QA, ON cond path 'toTgt' refers to definition QA.
            assoc path 'toTgt[f1].' and 'toTgt[f2]' have separate QATs with QA clones.
            'toTgt.elt' must now be rendered for each JOIN using the correct QA clone.
          */

          if(assocQAT.$QA.mixin)
            assocQAT._parent.$QA = assocQAT.$QA;

          /* if the $projection path has association path steps make sure to address the
             element by its last table alias name. Search from the end upwards
             to the top for the first association path step and cut off path here.
           */
          let i = path.length-1;
          while(i >= 0 && !path[i--]._artifact.target);
          // if this mixin ON condition path had a $projection/$self prefix, it could be
          // that the path of the select list had many many associations, we're only interested in
          // the last one (see MixinUsage2.cds V.toX as an example)
          if(hasDollarSelfPrefix)
            path.splice(0, i+1);

          /*
            If the mixin is a backlink to some forward association, the forward ON condition
            needs to be added in inverse direction. The challenge is to find the
            correct QAs for the paths of the forward ON condition.

            Example:
              entity A { key id: Integer; }
              entity B { key id: Integer; toV: association to V on id = toV.id; elt: String; }
              view V as select from A
              mixin {
                toB: association to B on $self = toB.toV;   // first use of 'id = toV.id'
              }
              into {
                A.id
                toB.elt
              };

              view V1 as select from A
              mixin {
                toB: association to B on $self = toB.toV;  // second use of 'id = toV.id'
              }
              into {
                A.id
                toB.elt
              };

            Information we have:
            * this is the forward assoc env.assocStack.length == 2s
            * name of the forward association (env.assocStack)
            * the forward association's target side is this view
              => For all paths on the target side, we have to find the appropriate $tableAlias
                 path._artifact is reference into view.elements, the value of the select item
                 is the path in the select list. The first path step is linked into $tableAliases via
                 _navigation
            * the forward association's source side is the target of the mixin (the assocQAT.QA)
              => easy: assocQAT is _navigation
            * If a $self is used multiple times, the forward ON cond paths are resolved to
              the original target (in the example above against V). However, we cannot lookup
              the _navigation link by following the _artifact.value.path[0] as this would always
              lead to V.query[0].$tableAliases.$A. Instead we need to lookup the element in the
              combined list of elements made available by the from clause.
          */
          let _navigation = undefined; // don't modify original path
          if(env.assocStack.length === 2) {
            // a mixin assoc cannot have a structure prefix, it's sufficient to check head
            if(head.id === env.assocStack.id()) {
              // source side from view point of view (target side from forward point of view)
              path = tail; // pop assoc step
              const elt = env.lead._combined[path[0].id];

              if(elt) {
                if(Array.isArray(elt)) {
                  const names = elt.map(e => (e._origin._main || e._origin).name.id);
                  error(null, [ assocQAT._origin.location, assocQAT._origin ], { elemref: path[0].id, id: assoc.name.id, art: assoc._main, names },
                    'Element $(ELEMREF) referred in association $(ID) of artifact $(ART) is available from multiple query sources $(NAMES)');
                  return pathNode.path;
                } else {
                  // check if element has same origin on both ends
                  if(elt._origin._main !== path[0]._artifact._origin._main) {
                    warning(null, [ assocQAT._origin.location, assocQAT._origin ], {
                      elemref: path[0].id,
                      id: assoc.name.id, art: assoc._main.name.id,
                      name: path[0]._artifact._origin._main.name.id,
                      alias: elt._origin._main.name.id,
                      source: elt._main.name.id,
                    }, 'Element $(ELEMREF) referred in association $(ID) of artifact $(ART) originates from $(NAME) and from $(ALIAS) in $(SOURCE)');
                  }
                  _navigation = elt._parent;
                }
              } else {
                error(null, [ assocQAT._origin.location, assocQAT._origin ], { elemref: path[0].id, id: assoc.name.id, art: (assoc._main || assoc) },
                  'Element $(ELEMREF) referred in association $(ID) of artifact $(ART) has not been found');
                return pathNode.path;
              }
            } else {
              // target side from view point of view (source side from forward point of view)
              //if(assocQAT.$QA._artifact === path[0]._artifact._parent)
              _navigation = assocQAT;
            }
          }
          [ tableAlias, path ] = constructTableAliasAndTailPath(path, _navigation);
        }
        else // ON condition of non-mixin association
        {
          // strip a structure prefix from this ON cond path (offset -1)
          [ head, ...tail ] = path = env.assocStack.stripPrefix(path, -1);
          if(prefixes.includes(head.id)) // target side
          {
            // no element prefix on target side
            path = translateONCondPath(tail);
            tableAlias = tgtAlias;
          }
          else // source side
          {
            tableAlias = srcAlias;
            // if path is not an absolute path, prepend element prefix
            path = translateONCondPath(path, !hasDollarSelfPrefix ? assoc.$elementPrefix : undefined);
          }
        }
        const pathStr = path.map(ps => ps.id).join(pathDelimiter);
        return constructPathNode([ tableAlias, { id: pathStr, _artifact: pathNode._artifact } ]);
      }

      // Return the original association if expr is a backlink term, undefined otherwise
      function getForwardAssociationExpr(expr) {
        if(expr.op && expr.op.val === '=' && expr.args.length === 2) {
          return getForwardAssociation(expr.args[0].path, expr.args[1].path);
        }
        return undefined;
      }

      function getForwardAssociation(lhs, rhs) {
        // [alpha.]BACKLINK.[beta.]FORWARD
        if(lhs && rhs) {
          if(rhs.length === 1 && rhs[0].id === '$self' &&
              lhs.length > 1 && hasPrefix(lhs))
            return lhs[lhs.length-1]._artifact;
          if(lhs.length === 1 && lhs[0].id === '$self' &&
              rhs.length > 1 && hasPrefix(rhs))
            return rhs[rhs.length-1]._artifact;
        }

        function hasPrefix(path) {
          return path.reduce((rc, ps) => !rc ? (ps.id == env.assocStack.id()) : rc, false);
        }
        return undefined;
      }
    } // createOnCondition
  } // createJoinQA

  /*
    A QA (QueryArtifact) is a representative for a table/view that must appear
    in the FROM clause either named directly or indirectly through an association.
   */
  function createQA(env, artifact, alias, namedArgs=undefined)
  {
    if(alias === undefined) {
      throw new CompilerAssertion('no alias provided');
    }

    const pathStep = {
      id: (artifact._main || artifact).name.id,
      _artifact: artifact,
      _navigation : { name: { select: env.queryIndex + 1 } } // ???
    };

    if(namedArgs)
      pathStep.args = namedArgs;
    if(isBooleanAnnotation(artifact['@cds.persistence.udf'], true))
      pathStep.$syntax = 'udf';
    if(isBooleanAnnotation(artifact['@cds.persistence.calcview'], true))
      pathStep.$syntax = 'calcview';

    const node = constructPathNode( [ pathStep  ], alias );
    return node;
  }

  // Remark CW: why boolean and not just truthy/falsy as usual?  See annotationVal() below
  function isBooleanAnnotation(prop, val=true) {
    return prop && prop.val !== undefined && prop.val === val && prop.literal === 'boolean';
  }

  function incAliasCount(env, QA)
  {
    if(!QA.numberedAlias)
    {
      // Debug only:
      // QA.name.id += '_' + (QA.path[0]._navigation === undefined ? '***navigation_missing***' : QA.path[0]._navigation.name.select) + '_' + env.aliasCount++;
      QA.name.id += '_' + env.aliasCount++;
      QA.numberedAlias = true;
    }
  }
  /*
    Recursively walk over expression and replace any found path with a new
    path consisting of two path steps. The first path step is the table alias
    and the second path step is the concatenated string of the original path steps.
    Leaf _artifact of pathNode is used as the leaf artifact of the new path string.

    Both the table alias and the original (remaining) path steps are to be produced
    by getTableAliasAndPathSteps().

    tableAlias = [ aliasName, _artifact, _navigation ]
    path = [ { id: ..., _artifact: ... (unused) } ]
  */
  function rewritePathsInFilterExpression(node, getTableAliasAndPathSteps, env)
  {
    const innerEnv = {
      lead: env.lead,
      location: env.location,
      position: env.position,
      aliasCount: env.aliasCount,
      walkover: {},
      callback: [
        function(pathNode) {
          if(checkPathDictionary(pathNode, env)) {
            const head = pathNode.path[0];
            if(head._navigation?.kind === '$self') {
              substituteDollarSelf(pathNode);
            }
            else {
              const [ tableAlias, path ] = getTableAliasAndPathSteps(pathNode);
              const rewrittenPath = [];
              const leafArtifact = path.at(-1)._artifact;
              // Walk from left to right and search for first assoc. If assocs in filters become join relevant in the future,
              // i.e. not only fk-access, we need to revisit this
              for(let i = 0; i < path.length; i++) {
                const pathStep = path[i];
                if(pathStep._artifact?.foreignKeys) {
                  const possibleNonAliasedFkName = path.slice(i).map(ps => ps.id).join(pathDelimiter);
                  if(!pathStep._artifact.$flatSrcFKs)
                      setProp(pathStep._artifact, '$flatSrcFKs', flattenElement(pathStep._artifact, true, pathStep._artifact.name.id, pathStep._artifact.name.id));
                  const fk = pathStep._artifact.$flatSrcFKs.find(f => f._artifact === leafArtifact && f.acc.startsWith(possibleNonAliasedFkName));
                  if(fk) {
                    rewrittenPath.push(fk);
                    i = path.length;
                    continue;
                  }
                }

                rewrittenPath.push(pathStep);
              }
              replaceNodeContent(pathNode, constructPathNode([ tableAlias, { id: rewrittenPath.map(ps => ps.id).join(pathDelimiter), _artifact: pathNode._artifact } ]));
            }
          }
        } ]
    };
    walk(node, innerEnv);
  }

  /*
    Replace the content of the old node with the new one.
    If newNode is a not a path (expression or constant/literal value), oldPath must be cleared first.
    If newNode is a path => oldNode._artifact === newNode._artifact, no need to
    exchange _artifact (as non-iterable property it is not assigned).
  */
  function replaceNodeContent(oldNode, newNode)
  {
    if(!newNode.path) {
      Object.keys(oldNode).forEach(k => {
        delete oldNode[k] });
      delete oldNode._artifact;
    }
    Object.assign(oldNode, newNode);
  }

  /*
    Replace the table alias node in $tableAliases inplace with the newly created JOIN node
    See define.js initTableExpression for details where _joinParent and $joinArgsIndex is set.
  */
  function replaceTableAliasInPlace( tableAlias, replacementNode ) {
    if (tableAlias._joinParent)
      tableAlias._joinParent.args[tableAlias.$joinArgsIndex] = replacementNode;
    else
        tableAlias._parent.from = replacementNode;
  }

  /*
    Collect all of paths to all leafs for a given element
    respecting the src or the target side of the ON condition.
    Return an array of column names and it's leaf element.
   */
  function flattenElement(element, srcSide, prefix, acc)
  {
    // terminate if element is unstructured
    if(!element.foreignKeys && !element.elements)
      return [ { id: prefix, _artifact: element, acc } ];

    let paths = [];
    // get paths of managed assocs (unmanaged assocs are not allowed in FK paths)
    if(element.foreignKeys)
    {
      for(const fkn in element.foreignKeys)
      {
        const fk = element.foreignKeys[fkn];
        // ignore an unmanaged association
        if(fk.targetElement._artifact.target &&
           fk.targetElement._artifact.on &&
           !fk.targetElement._artifact.foreignKeys)
          continue;
        // once a fk is to be followed, treat all sub-paths as srcSide, this will add fk.name.id only
        if(srcSide)
          paths = paths.concat(flattenElement(fk.targetElement._artifact, true,  fk.name.id, fk.targetElement.path.map(ps => ps.id).join(pathDelimiter)));
        else
        {
          // consume path segments until the next assoc and substitute against fk alias until path is eaten up
          let [ assocStep, tail, fkPrefix ] = pathAsStringUpToAssoc(fk.targetElement.path);
          while(assocStep && tail.length)
          {
            [tail, fkPrefix] = substituteFKAliasForPath(assocStep, tail, fkPrefix);
            [assocStep, tail, fkPrefix] = pathAsStringUpToAssoc(tail, fkPrefix);
          }
          paths = paths.concat(flattenElement(fk.targetElement._artifact, true, fkPrefix, fk.targetElement.path.map(ps => ps.id).join(pathDelimiter)));
        }
      }
    }
    // get paths of plain structured elements
    else if(element.elements)
    {
      for(const n in element.elements)
      {
        const elt = element.elements[n];
        paths = paths.concat(flattenElement(elt, true, elt.name.id, elt.name.id));
      }
    }
    return paths.map(p => {
      return {
        id: (prefix ? prefix + pathDelimiter : '' ) + p.id,
        acc: (acc ? acc + pathDelimiter : '') + p.acc,
        _artifact: p._artifact
      }
    } );
  }


  /*
    Construct both the TA path step and the path tail for a given AST path array
   */
  function constructTableAliasAndTailPath(path, navigation=undefined)
  {
    const [head, ...tail] = path;
    if(navigation === undefined)
      navigation = head._navigation;

    const QA = navigation.$QA || navigation._parent.$QA;

    // First path step is table alias, use and pop it off
    if(navigation.$QA && tail.length > 0)
      path = tail;

    return [ constructTableAliasPathStep(QA), path ];
  }

  function constructTableAliasPathStep(QA) {
    return { id: QA.name.id, _artifact: QA._artifact, _navigation: QA.path[0]._navigation };
  }
  /*
    Translate ON cond paths and substitute FK aliases
  */
  function translateONCondPath(path, prefix)
  {
    let [ assocStep, tail, fkPrefix ] = pathAsStringUpToAssoc(path);
    while(assocStep && tail.length)
    {
      [tail, fkPrefix] = substituteFKAliasForPath(assocStep, tail, fkPrefix);
      [assocStep, tail, fkPrefix] = pathAsStringUpToAssoc(tail, fkPrefix);
    }
    return [ { id: (prefix ? prefix + fkPrefix : fkPrefix), _artifact: path[path.length-1]._artifact } ];
  }

  /*
    Munch path steps and append them to a path string until an
    assoc step is found. The assoc path step is also appended
    to the path string. If no assoc path step has occurred, all
    path steps are added to the path string and tail is empty.

    Return assocPathStep, the remaining tail path and the path string
  */
  function pathAsStringUpToAssoc(path, pathStr)
  {
    if(!pathStr)
      pathStr = '';
    const assocStep = path.find(ps => {
      if(pathStr.length > 0)
        pathStr += pathDelimiter;
      pathStr += ps.id;
      return (ps._artifact.target); // true if it has a target => is assoc => terminate find
    });
    return [ assocStep, path.slice(path.indexOf(assocStep)+1), pathStr ];
  }

  /*
    Substitute the n first path steps of a given path against a FK alias name.
    Resolve a foreign key of a managed association by following the n first
    path steps. Longest path matches:
    Example: fk tuple { a.b, a.b.c, a.b.e },
    path: a.b.c.d.e.f: FK a.b.c is found, even if FK a.b is one level higher in the prefix tree.
    path: a.b.x.y.z: FK a.b is found, remaining tail path is x.y.z
    Add the FK alias name to the path string.

    Return remaining tail path and the path string.
  */

  /**
   * @param {any}     assocStep
   * @param {any[]}   path
   * @param {string} [pathStr='']
   */
  function substituteFKAliasForPath(assocStep, path, pathStr='')
  {
    if(assocStep && assocStep._artifact && assocStep._artifact.$fkPathPrefixTree) {
      let ppt = assocStep._artifact.$fkPathPrefixTree.children;
      /** @type any */
      let fk = undefined; // last found FK
      let fkPs = undefined; // last path step that found FK
      path.forEach(ps => {
        if(ppt[ps.id])
        {
          if(ppt[ps.id]._fk)
          {
            fk = ppt[ps.id]._fk;
            fkPs = ps;
          }
          ppt = ppt[ps.id].children;
        }
      });

      if(fk)
      {
        if(pathStr.length)
          pathStr += pathDelimiter;
        pathStr += fk.name.id;
      }

      const tail = path.slice(path.indexOf(fkPs)+1);
      // If foreign key is an association itself, apply substituteFKAliasForPath on tail
      if(fk && fk.targetElement._artifact.target && tail.length)
        return substituteFKAliasForPath(fk.targetElement, tail, pathStr);
      else
        return [ tail, pathStr ];
    }
    else {
      //error(null, assocStep.location, `No fkPrefixTree for association, please report this error`);
      return [ path, pathStr ];
    }
  }

  /*
    checkPathDictionary performs these checks (for ON condition and filter paths)
    1) all paths must end on a scalar type
    2) Unmanaged associations are not allowed
       Exception: The first path step of a mixin assoc is allowed (to identify the
       target side of the mixin ON condition) and with backlink associations
    3) Managed associations are only allowed to access a foreign key element
    4) $self, $projection without suffix should not appear here anymore
    Returns true on success, false otherwise
  */
  function checkPathDictionary(pathDict, env)
  {
    if(pathDict.$check !== undefined)
      return pathDict.$check;

    pathDict.$check = true;

    // all leaf types must be scalar in a query
    let path = pathDict.path;
    let [head, ...tail] = path;

    // pop head again if it is a table alias or $projection
    if(['$projection', '$self'].includes(head.id)) {
      path = tail;
      [head, ...tail] = path;
    }
    if(head && env.tableAliases && env.tableAliases.includes(head.id)) {
      path = tail;
    }
    // assocStack eventually undefined => head is not Assoc
    // assoc prefix can be something structured or just the id, the core
    // compiler decides if it wants to add 'element' or only 'id' to the XSN
    // we need to unambiguously identify the target side with the full assoc prefix.
    // If the path is on the target side, strip the prefix of and treat src/tgt
    // paths uniformly.
    path = (env.assocStack?.stripAssocPrefix(path) || path);
    const lead = env.art || env.lead;
    path.forEach((ps) => {
      /* checks for all path steps */
      if(ps.args) {
        error(null, [pathDict.location, lead],
          { art: lead._main || lead, id: ps.id },
          '$(ART): $(ID) must not have parameters');
        pathDict.$check = false;
      }
      if(ps.where) {
        error(null, [pathDict.location, lead],
          { art: lead._main || lead, id: ps.id },
          '$(ART): $(ID) must not have a filter');
        pathDict.$check = false;
      }
      if(ps._artifact.virtual) {
        error(null, [pathDict.location, lead],
          { art: lead._main || lead, id: ps.id },
          '$(ART): $(ID) must not be virtual');
        pathDict.$check = false;
      }
      // checks for all path steps except the first one (if it is the name of the defining association)
      if(ps._artifact && ps._artifact.target)
      {
        // if this is not the last path step, complain
        const la1 = pathDict.path[pathDict.path.indexOf(ps)+1];
        if(la1) {
          if(ps._artifact.on)
          {
            error(null, [pathDict.location, lead],
              { art: lead._main || lead, id: ps.id, alias: pathAsStr(pathDict.path) },
              '$(ART): $(ID) in path $(ALIAS) must not be an unmanaged association');
            pathDict.$check = false;
          }
          else if(ps._artifact.$fkPathPrefixTree)// must be managed
          {
            if(!ps._artifact.$fkPathPrefixTree.children[la1.id]) {
              error(null, [pathDict.location, lead],
                { art: lead._main || lead, id: la1.id, name: ps.id, alias: pathAsStr(pathDict.path) },
                '$(ART): $(ID) is not foreign key of managed association $(NAME) in path $(ALIAS)' );
              pathDict.$check = false;
            }
          }
        }
        else {
          // it is the last path step => no association
          error(null, [pathDict.location, lead],
            { art: lead._main || lead, id: ps.id, alias: pathAsStr(pathDict.path) },
            '$(ART): $(ID) in path $(ALIAS) must not be an association');
          pathDict.$check = false;
        }
      }
    });

    const lastSegment = path[path.length - 1];
    const artifact = lastSegment && lastSegment._artifact && lastSegment._artifact.type && lastSegment._artifact.type._artifact && lastSegment._artifact.type._artifact;
    if (artifact && artifact.elements) {
      error(null, [pathDict.location, lead],
        { art: lead._main || lead, id: lastSegment.id },
        '$(ART): $(ID) must have scalar type');
      pathDict.$check = false;
    }
    return pathDict.$check;
  }

  /*
    Create path prefix trees and merge paths into the trees depending on the path location.
    There are prefix trees for FROM table paths and all other paths. Paths of ON conditions
    (of either JOINs in FROM clause or of mixin associations) are not added to the QATree,
    as no associations can be followed in these paths. It is not the job of this transformer
    to semantically check for illegal association path steps in the various clauses of the query.

    All prefix trees are put underneath the $tableAlias structure with attribute $qat or $fqat.
    Each path step appears exactly once for a given filter condition in the prefix tree and
    has a link to its definition (origin). The default filter is an empty string ''.

    A special note on paths in filter conditions. Filter paths are treated like postfix
    paths to an association path step, meaning, they are inserted into the assoc's $qat or $fqat
    depending on where the association was traversed.
    As HANA CDS doesn't allow to traverse assocs in filter paths, this is checked in flyTrap above.

    A node in the path prefix tree is abbreviated as QAT (which stands for Query Association Tree,
    a term originating from way back in time).
  */
  function mergePathIntoQAT(pathDict, env)
  {
    const path = pathDict.path;

    if(path.length === 0)
      return;

    let qatChildrenName = '$qat';
    if(env.location === 'from')
      qatChildrenName = '$fqat';
    if(env.location === 'onCondFrom')
      return;

    let [head, ...tail] = path;

    // qatParent is the node where the starting qat is attached to
    let qatParent = undefined;

    // Note: If head is $self, we would need to resolve it if the path follows associations.
    //       However, that is already rejected by SQL backend checks. For example $self paths
    //       can't be "$self.assoc.foo.bar".

    // FROM and filter paths do not have a _navigation, but for filter paths
    // the corresponding path step (to where the filter was attached to) is in env.pathStep
    if(!head._navigation)
    {
      // speciality for OrderBy: If path has no _navigation don't merge it.
      // Path is alias to select item expression
      if(['OrderBy', 'UnionOuterOrderBy'].includes(env.location))
        return;

      // env.pathStep is set in walkPath for walk on filter conditions
      if(env.pathStep)
        qatParent = env.pathStep._navigation;
      else if(pathDict.name) // from table path with its alias
        qatParent = env.lead.$tableAliases[pathDict.name.id];
      else
        // tableAlias not found yet, last resort is head.id => published Assoc
        qatParent = env.lead.$tableAliases[head.id];
      tail = path; // start with the full path
    }
    // All other paths have a _navigation attribute
    else if(head._navigation)
    {
      /*
        Always start with QAT merge at $tableAlias, even if path doesn't start there.
        First identify $tableAlias (must be either head or head's parent) The resolver
        sets a _navigation at the very first path step that either points to $tableAlias
        or to a top level element from _combined which itself parent's to $tableAlias).
      */
      if(head._navigation.kind === '$navElement')
      {
        qatParent = head._navigation._parent;
        tail = path; // Start with the full path (no table alias prefix)
      }
      else if(head._navigation.kind === 'mixin') // This is a mixin assoc
      {
        qatParent = head._navigation;
        tail = path;
      }
      else // Head is a table alias already
      {
        qatParent = head._navigation;
      }
    }

    if(qatParent == undefined)
      throw new CompilerAssertion('table alias/qathost not found for path: ' +  pathAsStr(path));

    const rootQat = qatParent;

    // Create the very first QAT if it doesn't exist
    // (filter condition for table alias prefix not allowed)
    let qatChildren = createQATChildren(qatParent);
    /** @type {object} */
    let qat = null;

    tail.forEach((pathStep, i) => {
      /*
        If the current path step has not yet been inserted into the list of children at
        the parent QAT, create a new QAT (linkToOrigin) and a dictionary for subsequent
        path steps (a separate one for each filter condition).
      */
      let qatName = pathStep.id;

      if(pathStep.where) {
        qatName  += JSON.stringify(compactExpr(pathStep.where));
      }
      if(pathStep.args) {
        // sort named arguments
        const sortedNamedArgs = Object.create(null);
        Object.keys(pathStep.args).sort().forEach(p => {
          sortedNamedArgs[p] = compactExpr(pathStep.args[p]);
        })
        qatName += JSON.stringify(sortedNamedArgs);
      }


      qat = qatChildren[qatName];
      if (!qat)
      {
        qat = linkToOrigin(pathStep._artifact, pathStep.id, qatParent, undefined, pathStep.location);
        /*
          Query filter have precedence over default filters.
          Clone default filter for each usage to avoid path rewriting of the definition.
          TODO: If Filter become JOIN relevant, default filters MUST BE cloned before starting the transformation
                or the paths won't be added to the QAT and the rewriting would be done on the filter definition.
        */
        if(pathStep.where /*|| pathStep._artifact.where*/)
          qat._filter = pathStep.where /*|| clone(pathStep._artifact.where)*/;
        if(pathStep.args)
          qat._namedArgs= pathStep.args;

        /*
          If qat._origin has a QA, it must be a mixin association
          (No other QA's have been created so far). Clone new QA from this
          template to have space for table aliases (if mixin assoc is
          followed with different filter conditions).
        */
        if(qat._origin.$QA) {
          qat.$QA = clone(qat._origin.$QA);
          if(qat._namedArgs)
            qat.$QA.path[0].args = qat._namedArgs;
        }
        qat.kind = '$navElement';
        qatChildren[qatName] = qat;
      }

      /*
        Mark QAT non join relevant (njr) if:

        1) the current association QAT has no children yet
        2) the association is managed
        3) the n+1st path step is element of the foreign key tuple of the association
        4) the association path step has no filter expression and no actual parameter list
        5) the final base type of the path leaf node must be a scalar type
        6) a path which is not a FROM block member terminates on association
        optionally
        7) Association is exactly to one [1..1]

        If qat is njr:
        flatten out source side foreign keys (they are required later for path rewriting)
        and add it to the qat and xref to assocs own foreign keys.
        If njr prevails, this QAT will not pass createJoinQA with createOnCondition,
        so the flattening can either be done right here or very late when rewriting generic paths.
      */
      const art = qat._origin;
      if(noJoinForFK && qat._origin.target) {
        if(!pathStep.args && // has no args
          (
            (
              !pathStep.where && // has no filter
              // not leaf + next step is foreign key
              i < tail.length-1 &&
              // path terminates on a scalar type
              // _effectiveType.elements can be removed if forRelationalDB can expand fk paths correctly
              !(tail[tail.length-1]._artifact._effectiveType.elements || tail[tail.length-1]._artifact._effectiveType.target) &&
              // association is managed
              art.foreignKeys &&
              // n+1st path step is foreign key
              Object.values(art.foreignKeys).some(fk => fk.targetElement.path[0].id === tail[i+1].id)
            )
          ||
            (
              // Non-FROM block path terminates on association, e.g. publishing associations
              // with or without filter.
              i === tail.length-1 &&
              env.location !== 'from'
            )
          ))
        {
          // If qat has no children yet mark it njr
          if(!qat[qatChildrenName]) {
            setProp(qat, '$njr', true);
            // flatten left hand side ON condition paths ( => foreign keys to the source side)
            setProp(art, '$flatSrcFKs', flattenElement(art, true, art.name.id, art.name.id));
          }
        }
        else {
          // This QAT is join relevant
          setProp(qat, '$njr', false);
        }
      }

      qatChildren = createQATChildren(qat);
      qatParent = qat; // Current qat becomes parent to the next level of children
      // don't destroy $self navigation for later $self substitution
      if(!pathStep._navigation || pathStep._navigation.kind !== '$self')
        setProp( pathStep, '_navigation', qat );
    });

    if(!qat)
      throw new CompilerAssertion('No leaf qat for head: ' + head + ' tail: ' + pathAsStr(tail, '"') + ' produced');

    /*
      If path terminates on an entity or an association (from clause,
      published Ad-Hoc Assocs), attach QA to the (leaf) QAT and to the
      rootQAT (which is the tableAlias).
      This QA will later serve as the initial 'lastAssocQA' for all other
      join relevant paths that originate from this alias. Also this is the
      only place where the original FROM alias is available.
    */
    let art = qat._origin;
    if(art._main)               // element (assoc) or sub query
      if(art.target)
        art = art.target._artifact;
      else
        art = undefined;

    if(art)
    {
        // If rootQat ($tableAlias) already has a QA, reuse it, create a new one otherwise.
      if(!rootQat.$QA)
      {
        // Use the original FROM alias if available!
        if(pathDict.name && pathDict.name.id)
          rootQat.$QA = qat.$QA = createQA(env, art, pathDict.name.id, qat._namedArgs);
      }
    }

    // Mark Qat root path from right to left join relevant
    // starting with the first $njr=false Qat
    let njr = true;
    do {
      if(qat.$njr !== undefined && qat.$njr === false)
        njr = false;
      if(qat.$njr !== undefined && !njr)
        qat.$njr = njr;
      qat = qat._parent;
    } while(qat._parent && qat._parent[qatChildrenName]);


    // Return or create a new children dictionary for a given QAT
    // Children are grouped under the filter condition that precedes them.
    function createQATChildren(parentQat)
    {
      if(!parentQat[qatChildrenName])
        parentQat[qatChildrenName] = Object.create(null);
      return parentQat[qatChildrenName];
    }
  }

  function pathAsStr(p, delim='')
  {
    return p.map(p => delim + p.id + delim).join('.');
  }

  // for debugging only
  // eslint-disable-next-line no-unused-vars
  function printPath(pathDict, env)
  {
    const alias = (pathDict.name && pathDict.name.id) || '<undefined>'
    const path = pathDict.path;
    const s = pathAsStr(path, '"');
    const me = env.lead && (env.lead.name.id || env.lead.op);
    console.log(me + ': ' + env.location + ': ' + s + ' alias: ' + alias);
  }

  function clone(obj) {
    let newObj;
    if (typeof obj !== 'object' || obj === null) // return primitive type, note that typeof null === 'object'
      return obj;
    if (Array.isArray(obj))
      newObj = [];
    else if (obj.constructor) // important for classes, else prototype chain for inheritance will not be correct
      newObj = new obj.constructor()
    else if (!Object.getPrototypeOf(obj))
      newObj = Object.create(null);  // dictionary
    else
      newObj = {};

    const props =  Object.getOwnPropertyNames(obj);  // clone own properties only, not inherited ones
    for (const p of props) {
      const pd = Object.getOwnPropertyDescriptor(obj, p);
      if (pd && pd.enumerable === false)
      {
        pd.value = obj[p]; // don't copy references
        Object.defineProperty(newObj, p, pd);
      }
      else
        newObj[p] = clone(obj[p]);
    }
    return newObj;
  }

  function parenthesise(expr) {
    if(typeof expr === 'object' && expr.op && expr.args)
      setProp(expr, '$parens', [ expr.$location ]);
    return expr;
  }
}

/**
 * Return a new CSN path object constructed from an array of pathSteps
 * The final _artifact ref is set as _artifact ref to the path
 *
 * @param {Object[]} pathSteps Array of [ 'pathStep id', _artifact reference, namedArgs (optional) ]
 * @param {any}     [alias] Alias to set as the name property -> { id: <alias> }
 * @param {boolean} [rewritten=true] If true, mark the objects with $rewritten
 * @returns {object} CSN path
 */
function constructPathNode(pathSteps, alias, rewritten=true)
{
  const node = {
    $rewritten: rewritten,
    path : pathSteps.map(p => {
      const o = {};
      Object.keys(p).forEach(k => {
        if(!(rewritten && ['_'].includes(k[0])))
          o[k] = p[k];
      });
      setProp(o, '_artifact', p._artifact );
      setProp(o, '_navigation', p._navigation );
      return o; })
  };

  if(alias)
    node.name = { id: alias }

  // set the leaf artifact
  setProp(node, '_artifact', pathSteps[pathSteps.length-1]._artifact);
  if(pathSteps[0]._navigation)
    setProp(node.path[0], '_navigation', pathSteps[0]._navigation);
  return node;
}

// Crawl all relevant sections of the query AST for paths
function walkQuery(query, env)
{
  if(!query)
    return;

  if(!env.walkover)
    env.walkover = {};
  env.location = query.op;
  env.position = query;

  if(query.op.val === 'SELECT')
  {
    env.lead = query;

    env.location = 'from';
    walkFrom(query.from);

    env.location = 'select';
    if(env.walkover[env.location])
    {
      for(const alias in query.elements)
        walk(query.elements[alias].value, env);

      env.location = 'Where';
      walk(query.where, env);
      env.location = 'GroupBy';
      walk(query.groupBy, env);
      env.location = 'Having';
      walk(query.having, env);
      env.location = 'OrderBy';
      walk(query.orderBy, env);
      env.location = 'UnionOuterOrderBy';
      // outer orderBy's of anonymous union
      walk(query.$orderBy, env);
      if(query.limit) {
        env.location = 'Limit';
        walk(query.limit.rows, env);
        env.location = 'Offset';
        walk(query.limit.offset, env);
      }
    }
  }

  function walkFrom(fromBlock)
  {
    const aliases = [];
    env.position = fromBlock;
    if(fromBlock)
    {
      if(env.walkover[env.location] && walkPath(fromBlock, env))
      {
        if(fromBlock.name)
          aliases.push(fromBlock.name.id);
      }
      else
      {
        if(fromBlock.args)
          fromBlock.args.reduce((a, arg) => a.splice(0,...walkFrom(arg)), aliases);

        env.location = 'onCondFrom';
        if(env.walkover[env.location])
        {
          env.tableAliases = aliases;
          walk(fromBlock.on, env)
          delete env.tableAliases;
        }
        env.location = 'from';
      }
    }
    return aliases;
  }
}

/* node: any
  env: { callback: (array of) callback methods with signature(thing, env)
          ...:      any additional payload for the callback
        }
*/
function walk(node, env)
{
  env.position = node;
  // In some expressions queries can occur, do not follow them as they
  // are walked as member of the queries array
  if(!env || !node || (node && node.query && !node.query._artifact))
    return;

  if(node.path) {
    walkPath(node, env);
    return;
  }

  // Ask for Array before typeof object (which would also be true for Array)
  if(Array.isArray(node)) {
    node.forEach(n => walk(n, env));
  }
  // instanceof Object doesn't respect dictionaries...
  else if(typeof node === 'object') {
    Object.entries(node).forEach(([n, v]) => {
      if(n !== 'type') {
        walk(v, env);
      }
    });
  }
}

function walkPath(node, env)
{
  const path = node.path;
  // Ignore paths that have no artifact (function calls etc.) or that are builtins ($now, $user)
  // or that are parameters ($parameters or escaped paths (':')
  //path.length && path[ path.length-1 ]._artifact
  const art = path?.length && path[path.length-1]._artifact;

  // regardless of the position in the query, ignore paths that have virtual path steps
  if(art && path.some(ps => ps._artifact?.virtual?.val))
    return path;
  if(art && !internalArtifactKinds.includes(art.kind) && node.scope !== 'param')
  {
    if(env.callback)
    {
      // an array of callbacks applied to the node
      if(Array.isArray(env.callback))
        env.callback.forEach(cb => cb(node, env));
      else
        env.callback(node, env);
    }

    /*
      NOTE: As long as association path steps are not allowed in filters,
      it is not required to walk over filter expressions.
      Simple filter paths are rewritten in createJoinTree (first filter)
      and createJoinQA (subsequent one that belong to the ON condition).

      If the filter becomes JOIN relevant, default FILTERS (part of the
      association definition) MUST be CLONED to each assoc path step
      BEFORE resolution.

    let filterEnv = Object.assign({walkover: {} }, env);
    filterEnv.location = 'filter';
    if(filterEnv.walkover[filterEnv.location])
    {
      // Walk over all filter expressions (not JOIN relevant,
      // cannot be detected in generic walk. Store path step
      // to which this filter was attached to in filterEnt.pathStep
      path.filter(pathStep=>pathStep.where).forEach(pathStep => {
        filterEnv.pathStep = pathStep;
        walk(pathStep.where, filterEnv) });
    }
    */
    // TODO: Parameter expressions!
  }
  // else if(path) {
  //   var util = require('util');
  //   var { reveal } = require('../model/revealInternalProperties');

  //   console.log('Path not resolved, can\'t find leaf _artifact: ' + path.map(p=>p.id).join('.') + '\n' +
  //   util.inspect( reveal( node, false ), false, null ));
  // }
  return path;
}

function annotationVal( anno ) {
  // XSN TODO: also set `val:true` but no location for anno short form
  return anno && (anno.val === undefined || anno.val);
}

module.exports = { translateAssocsToJoinsCSN };
