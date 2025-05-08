/** ------------------------------------------
 * This is a peg.js adaptation of the https://github.com/oasis-tcs/odata-abnf/blob/master/abnf/odata-abnf-construction-rules.txt
 * which directly constructs CQN out of parsed sources.
 *
 * NOTE:
 * In contrast to the OData ABNF source, which uses very detailed semantic rules,
 * this adaptation uses rather generic syntactic rules only, e.g. NOT distinguishing
 * between Collection Navigation or NOT knowing individual function names.
 * This is to be open to future enhancements of the OData standard, as well as
 * to improve error messages. For example a typo in a function name could be
 * reported specifically instead of throwing a generic parser error.
 *
 * See also: https://docs.microsoft.com/en-us/odata/concepts/queryoptions-overview
 * Future test cases http://docs.oasis-open.org/odata/odata/v4.0/errata03/os/complete/abnf/odata-abnf-testcases.xml
 *
 * Limitations: Type, Geo functions are NOT supported,
 * maxdatetime, mindatetime, fractionalseconds,
 * totaloffsetminutes, date, totalseconds,
 * floor, ceiling also are NOT supported by CAP
 *
 * Examples:
 * Books
 * Books/201
 * Books?$select=ID,title&$expand=author($select=name)&$filter=stock gt 1&$orderby=title
 */

//
// ---------- JavaScript Helpers -------------

  {

    const TECHNICAL_OPTS = ['$value'] // odata parts to be handled somewhere else
    const OPERATORS = { eq: '=', ne: '!=', lt: '<', gt: '>', le: '<=', ge: '>=' }
    const SUPPORTED_APPLY_TRANSFORMATIONS = { topcount: true, bottomcount: true, topsum: false, bottomsum: false, toppercent: false, bottompercent: false }

    const $ = Object.assign
    const { strict, minimal } = options
    const stack = []
    let SELECT, count

    const safeNumber =
      options.safeNumber ||
      function (inputString) { //> keep that here to allow for usage in https://peggyjs.org/online
        if (typeof inputString !== 'string') return inputString
        // Try to parse the input string as a floating-point number using parseFloat
          const parsedFloat = parseFloat(inputString)
      
        // Check if the parsed value is not NaN and is equal to the original input string
        if (!isNaN(parsedFloat) && String(parsedFloat) === inputString) {
          return parsedFloat
        } 
    
        // Try to parse the input string as an integer using parseInt
        const parsedInt = parseInt(inputString);
        // special case like '3.00000000000001', the precision is not lost and string is returned
        if (!isNaN(parsedInt) && String(parsedInt) === inputString.replace(/^-?\d+\.0+$/, inputString.split('.')[0])) {
          return parsedInt
        }

        // If none of the above conditions are met, return the input string as is
        return inputString
      }

    const skipToken = options.skipToken
    
    const standardBase64 =
      options.standardBase64 ||
      function (str) {
        // convert url-safe to standard base64 (with padding, if necessary)
        return Buffer.from(str, 'base64').toString('base64')
      }
    
    const _compareRefs = col => exp =>
      col === exp ||
      (col.as && exp.as && col.as === exp.as) ||
      (exp.as && col.ref && exp.as === col.ref[col.ref.length - 1]) ||
      (col.ref && exp.ref && col.ref.join('') === exp.ref.join(''))

    const _remapFunc = columns => c => {
      if (Array.isArray(c)) return c.map(_remapFunc(columns))
      const fnObj = c.ref && columns.find(col => 'func' in col && col.as && col.as === c.ref[0])
      if (fnObj) return fnObj
      return c
    }

    const _replaceNullRef = groupBy => c => {
      if (Array.isArray(c)) return c.map(_replaceNullRef(groupBy))
      if (c.ref && !groupBy.find(_compareRefs(c))) return { val: null }
      return c
    }

    const _expand = (columns, col) => {
      if (col.ref.length === 1) {
        if (!columns.find(_compareRefs(col))) {
          columns.push(col)
        }
      } else {
        const assoc = col.ref.shift()
        const exp = columns.find(c => c.ref && c.ref[0] === assoc)
        if (exp)  _expand((exp.expand ??= []), col)
        else {
          const exp = { ref: [assoc], expand: [] }
          _expand(exp.expand, col)
          columns.push(exp)
        }
      }
    }

    const _mergeColumnTrees = descendents => {
      const descendentExpandsByRef = descendents.reduce((expandsByRef, column) => {
        if (typeof column === 'string') {
          expandsByRef[column] ??= []
          return expandsByRef
        }
        if (!column.ref) return expandsByRef
        const firstRef = column.ref[0]
        expandsByRef[firstRef] ??= []
        expandsByRef[firstRef].push(...(column.expand ?? []))
        return expandsByRef
      }, {})

      const mergedExpands = []
      for (const descendentRef in descendentExpandsByRef) {
        if (descendentRef === '*') {
          mergedExpands.push(descendentRef)
          continue
        }
        const mergedColumn = { ref: [descendentRef] }
        if (descendentExpandsByRef[descendentRef].length)
          mergedColumn.expand = _mergeColumnTrees(descendentExpandsByRef[descendentRef])
        mergedExpands.push(mergedColumn)
      }

      return mergedExpands
    }

    const _mergeColumnForests = (newColumns, topColumns) => {
      // Skip if not selection / expand
      if (!topColumns.length) return

      const topColumnsByRef = topColumns.reduce((groups, column) => {
        if (!column.ref) return groups
        const firstRef = column.ref[0]
        groups[firstRef] ??= []
        groups[firstRef].push(...(column.expand ?? []))
        return groups
      }, {})

      // Compile New Columns Forest Information
      const selectedNewColumnsByRef = {}
      const unselectedNewColumnsIdxs = []
      for (const newColumnIndex in newColumns) {
        const newColumn = newColumns[newColumnIndex]
        const newColumnRef = newColumn.ref?.[0]
        if (Object.keys(topColumnsByRef).includes(newColumnRef))
          selectedNewColumnsByRef[newColumnRef] = newColumn
        else if (!newColumn.func) unselectedNewColumnsIdxs.push(newColumnIndex)
      }

      // Skip if there is no overlap
      if (!Object.keys(selectedNewColumnsByRef).length) return

      // Remove unselected New Columns
      for (const unselectedNewColumnIdx of unselectedNewColumnsIdxs) {
        newColumns.splice(unselectedNewColumnIdx, 1)
      }

      // Add Top Columns to New Columns
      for (const topColumnRef in topColumnsByRef) {
        const newColumn = selectedNewColumnsByRef[topColumnRef]
        if (!newColumn) continue
        if (!topColumnsByRef[topColumnRef].length) continue
        if (newColumn.expand) _mergeColumnForests(newColumn.expand, topColumnsByRef[topColumnRef])
        else newColumn.expand = _mergeColumnTrees(topColumnsByRef[topColumnRef])
      }
    }

    const _handleApply = (cqn, apply) => {
      let newCqn = _convertApply({ from: cqn.from }, apply)
      
      if (Array.isArray(newCqn)) {
        for (let i = 0; i < newCqn.length; i++) {
          newCqn[i] = _addNormalQueryOptions(newCqn[i], cqn)
        }
      } else {
        newCqn = _addNormalQueryOptions(newCqn, cqn)
      }

      return newCqn
    }

    const _addNormalQueryOptions = (cqn, topCqn) => {
      if (!topCqn) return cqn
      if (topCqn.apply) delete topCqn.apply

      let newCqn = {}
      if (
        (topCqn.columns && topCqn.columns[0].as === '$count') ||
        (cqn.SELECT.where && topCqn.where) ||
        (cqn.SELECT.limit && topCqn.limit) ||
        (cqn.SELECT.orderBy && topCqn.orderBy) ||
        (cqn.SELECT.search && topCqn.search)
      ) {
        newCqn.from = cqn
      } else newCqn = cqn.SELECT


      // Collect & Select Aggregated Columns
      const aggregatedColumns = newCqn.columns && newCqn.columns.length
        ? newCqn.columns.filter(col => col && typeof col === 'object' && 'func' in col)
        : []
      newCqn.columns = aggregatedColumns.length ? aggregatedColumns : []

      if (newCqn.groupBy && newCqn.groupBy.length) {
        // Expand & Select Columns from GroupBy

        const groupByColumns = newCqn.groupBy.reduce((expandedGroupByColumns, column) => {
            if (column.ref && column.ref.length > 1) {
              const columnToExpand = { ref: [...column.ref] }
              if (column.expand && column.expand.length) columnToExpand.expand = [...column.expand]
              if (column.as) columnToExpand.as = column.as
              _expand(expandedGroupByColumns, columnToExpand, true)
            } else expandedGroupByColumns.push({ ...column })
            return expandedGroupByColumns
          }, [])

          newCqn.columns ??= []
          newCqn.columns.push(...groupByColumns)
      }

      for (const queryOption in topCqn) {
        if (queryOption === 'columns') {
          const mergedColumns = []

          // Add aggregation columns 
          if (newCqn.columns.length) mergedColumns.push(...newCqn.columns)

          // Use columns from parsed CQN if there's no grouping
          if (!newCqn.groupBy || !newCqn.groupBy.length) {   
            for (const column of topCqn.columns) 
              if (!mergedColumns.some(_compareRefs(column))) mergedColumns.push(column)
          } else {
            _mergeColumnForests(mergedColumns, topCqn.columns)
          }

          newCqn.columns = mergedColumns

        } else if (queryOption !== 'from') {
          newCqn[queryOption] = topCqn[queryOption]
        }
      }
      
      if (newCqn.groupBy && newCqn.where) {
        // Replace Where by Having, to be evaluated after GroupBy

        newCqn.having = newCqn.where
          .map(_remapFunc(newCqn.columns))
          .map(_replaceNullRef(newCqn.groupBy))
        delete newCqn.where
      }

      if (!newCqn.columns.length) delete newCqn.columns
      return { SELECT: newCqn }
    }

    const _convertApply = (cqn, apply) => {
      if (!apply) return

      if (cqn.apply) delete cqn.apply
      if (apply.identity && cqn.from.SELECT) cqn = cqn.from.SELECT
      if (
        apply.apply ||
        (apply.where && cqn.where) ||
        (apply.search && cqn.search) ||
        (apply.limit && cqn.limit) ||
        (apply.orderBy && cqn.orderBy)
      ) {
        cqn.from = { SELECT: { ...cqn } }
      }

      const _toplevels = cqn => {
        cqn.recurse = { ref: ['parent'] }

        const _level0 = []
        const _rest = []
        if (apply.topLevels.levels) {
          _rest.push([{ ref: ['DistanceFromRoot'] }, '<=', { val: apply.topLevels.levels - 1 }])
        } else {
          _rest.push([{ ref: ['DistanceFromRoot'] }, '>=', { val: 0 }])
        }

        if (apply.topLevels.expandLevels) {
          for (const expandLevel of apply.topLevels.expandLevels) {
            if (expandLevel.levels === 0) {
              _level0.push([{ func: 'DistanceTo', args: [{ val: expandLevel.nodeID }, { val: null }] }])
            } else {
              _rest.push([{ func: 'DistanceTo', args: [{ val: expandLevel.nodeID }, { val: expandLevel.levels }]  }])
            }
          }
        }
        const _restSimp = _rest[0][1] === '>=' && _rest[0][2].val === 0 ?
          _rest.length === 1 ? [] : [_rest[0]] : _rest
        const _restCombined = _restSimp.flatMap((r, i) => i < _restSimp.length - 1 ? [...r, 'or'] : r)
        if (_level0.length) {
            const _level0Combined = _level0.flatMap((l, i) => ['and', 'not', ...l])
            if (_restSimp.length > 1) {
              cqn.recurse.where = [{ xpr: _restCombined }].concat(_level0Combined)
            } else if (_restSimp.length === 1 && _restSimp[0][1] === '>=' && _restSimp[0][2].val === 0) {
              cqn.recurse.where = _level0Combined.slice(1)
            } else {
              cqn.recurse.where = _restCombined.concat(_level0Combined)
            }
        } else {
          if (_restCombined.length) cqn.recurse.where = _restCombined
        }
      }

      const _descendants = (cqn) => {
        return _ancestors(cqn, apply.descendants, 1)
      }

      const _ancestors = (cqn, info = apply.ancestors, direction = -1) => {
        if (info.nodes) {
          for (const node of info.nodes) {
            if (node.filter && direction === -1) cqn.where = node.filter
            else if (node.search) cqn.search = node.search
          }
        }
        cqn.recurse = { ref: ['parent'] }
        if (direction === 1) {
          const _throw = () => {
            const err = new Error("For descendants, only the following filter is supported: `<ID> eq <val>`")
            err.statusCode = 400
            throw err
          }
          if (info.nodes?.length !== 1 || !info.nodes[0].filter) _throw()
          const rIdx = info.nodes[0].filter.findIndex(e => e.ref?.[0] === info.id)
          if (!rIdx === -1) _throw()
          const op = info.nodes[0].filter[rIdx + 1]
          const val = info.nodes[0].filter[rIdx + 2]?.val
          // ignore additional filters (like `IsActiveEntity`?)
          if (op !== '=' || !val) _throw()

          const endVal = info.distance && direction * info.distance
          const distance = Number.isInteger(endVal) ? endVal : null
          const where = [{ func: 'DistanceTo', args: [{ val }, { val: distance }] }]
          cqn.recurse.where = where
        }
      }

      if (apply.ancestors && apply.topLevels) {
        _ancestors(cqn)
        const extra = {...cqn}
        _toplevels(extra)
        cqn.recurse = extra.recurse
      } else if (apply.ancestors && apply.descendants) {
        _ancestors(cqn)
        const extra = {...cqn}
        _descendants(extra)
        cqn.recurse = extra.recurse
      } else if (apply.topLevels) {
        _toplevels(cqn)
      } else if (apply.ancestors) {
        _ancestors(apply)
      } else if (apply.descendants) {
        _descendants(cqn)
      }

      if (apply.where) cqn.where = apply.where
      if (apply.search) cqn.search = apply.search
      if (apply.limit) cqn.limit = apply.limit
      if (apply.orderBy) cqn.orderBy = apply.orderBy
      if (apply.groupBy)
        cqn.groupBy = apply.groupBy.reduce((groupBy, column) => {
          if (!groupBy.some(_compareRefs(column))) groupBy.push(column)
          return groupBy
        }, [])

      if (apply.aggregate && apply.aggregate.length) cqn.columns = [...(cqn.columns || []), ...apply.aggregate]
      if (cqn.groupBy && cqn.groupBy.length) cqn.columns = [...(cqn.columns || []), ...cqn.groupBy]

      if (apply.apply && cqn.from) _convertApply(cqn.from.SELECT, apply.apply)
      
      if (apply.concat && Array.isArray(apply.concat)) {
        const additionalQueries = []

        for (let select of apply.concat) {
          select.from = Object.keys(cqn).length === 1
            ? cqn.from
            : { SELECT: cqn } 

          const nextCqn = _convertApply(select, select.apply)
          

          if (Array.isArray(nextCqn)) additionalQueries.push(...nextCqn)
          else additionalQueries.push(nextCqn)
        }

        cqn = additionalQueries
      }
      
      if (Array.isArray(cqn)) return cqn
      return { SELECT: cqn }
    }

    const _setLimitOffset = val => {
      if (SELECT.limit && SELECT.limit.offset && SELECT.limit.offset.val) {
        val += SELECT.limit.offset.val
      }
      ;(SELECT.limit || (SELECT.limit = {})).offset = { val }
    }

    // Second parameter needed, to assure that order is correct
    const _setOrderBy = (appendObj, first = false) => {
      SELECT.orderBy = SELECT.orderBy
        ? first
          ? [appendObj, ...SELECT.orderBy]
          : [...SELECT.orderBy, appendObj]
        : [appendObj]
    }

    const _removeLambdaPrefix = (prefix, elements) => {
      for (const e of elements) {
        // remove the prefix identifier
        if (e.ref && e.ref[0] === prefix) e.ref.shift()
        if (e.func) _removeLambdaPrefix(prefix, e.args)
        if (e.xpr) _removeLambdaPrefix(prefix, e.xpr)
      }
      return elements
    }

    const _custom = (k, v) =>  {
        // normalize value
      if (v === 'null') v = null
      else if (v === 'true') v = true
      else if (v === 'false') v = false
      // set value in structure
      // REVISIT: SELECT.from._params is a temporary hack
      const params = SELECT.from._params ??= {}
      let t = params
      let x = k.match(/^(\w+)\[(.*)\]$/)
      while (x) {
        if (!(x[1] in t)) t[x[1]] = x[2] === '' ? [] : {}
        t = t[x[1]]
        k = x[2]
        x = k.match(/^(\w+)\[(.*)\]$/)
      }
      if (Array.isArray(t)) t.push(v)
      else t[k] = v
    }

    const _replaceAliasedInWhere = (where, alias, value, isFromWhere = false) =>  {
      let isAliased = false
      where?.forEach(element => {
        if (element.val === alias) {
          // TODO check if we want to store replaced aliases/values for req.data in actions/functions in CQN 
          element.val = 'list' in value ? value.list.map(ele => ele.val) : value.val
          isAliased = true
        } else if (element.list === alias) {
          element.list = value.list
          isAliased = true
        } else if (element.func) {
          element.args.forEach((arg, i) => {
            if (arg.val === alias) {
              arg.val = value.val
              isAliased = true
            } else if (arg.func) {
              _replaceAliasedInWhere(arg.args, alias, value, isFromWhere)
            }
          })
        } else if (element.SELECT) {
          _replaceAliased(element.SELECT, alias, value, isFromWhere)
        }
      });
      return isAliased
    }
    const _replaceAliased = (select, alias, value, isFromWhere = false) =>  {
      let isAliased = false
      const {where, from} = select
      isAliased =_replaceAliasedInWhere(where, alias, value);

      from?.ref?.forEach(element => {
        isAliased = _replaceAliasedInWhere(element.where, alias, value, true);
      })
      return isAliased
    }
  }

// ---------- Entity Paths ---------------

  ODataRelativeURI // Note: case-sensitive!
    = '/'? (p:path { SELECT = p })
    ( o"?" o ( '&'? o QueryOption ( o'&'+o QueryOption )*)? )? o {
      if (count) {
        // columns set because of $count: ignore $select, $expand, $top, $skip, $orderby
        // REVISIT: don't ignore query options but throw bad request (as okra did)?
        SELECT.columns = [{ args: [{ val: 1 }], as: '$count', func: 'count' }]
        delete SELECT.expand
        delete SELECT.limit
        delete SELECT.orderBy
        if (SELECT.apply)
          return _handleApply(SELECT, SELECT.apply)
        return { SELECT }
      }
      let onlyColumnsFromExpand
      if (SELECT.expand) {
        // Books?$expand=author w/o $select=author
        if (!SELECT.columns) {
          SELECT.columns = ['*']
          onlyColumnsFromExpand = true
        }
        for (const exp of SELECT.expand) {
          const idx = SELECT.columns.findIndex(_compareRefs(exp))
          if (idx > -1) SELECT.columns.splice(idx, 1)
          SELECT.columns.push(exp)
        }
        delete SELECT.expand
      }
      if (SELECT.count && SELECT.apply) 
        SELECT.__countAggregated = true
      if(SELECT.apply)
        return _handleApply(SELECT, SELECT.apply, onlyColumnsFromExpand)
      return { SELECT }
    }

  path
    = "$count" {count = true}
    / rv:$("$ref"/"$value") {return !TECHNICAL_OPTS.includes(rv) && {from: {ref: [rv]}}}
    / head:(
      (identifier filter:(OPEN CLOSE/OPEN args CLOSE)? !segment) / val:segment{return [val]}
    )? tail:((s:"/" {return s;}) path?)? {
      tail = tail && tail[1]
      if (!head && !tail) {
        return {from: {ref: ['']}}
      } else if (!head && tail && tail.from) {
        tail.from.ref.unshift('')
        return tail
      } 
      const [id, filter] = head
      // minimal: val also as path segment
      const ref = []
      if (filter) {
        if (filter.length > 2) {
          ref.push({ id, where: filter[1].map(f => f.val && f.val.match && f.val.match(/^"(.*)"$/) ? { val: f.val.match(/^"(.*)"$/)[1] } : f) })
        } else {
          ref.push({ id, where: [] })
        }
      } else {
        if (minimal) {
          ref.push(`${typeof id === 'object' && 'val' in id ? id.val : id}`)
        } else {
          // REVISIT: keep 123 as number?
          if (typeof id === 'object' && typeof id.val === 'string' && id.val.match(/^[1-9]\d*$|^0$/)) {
            ref.push({ val: safeNumber(id.val) })
          } else {
            ref.push(id)
          }
        }
      }
      if (tail && tail.from) {
        const more = tail.from.ref
        if (Object.prototype.hasOwnProperty.call(more[0], 'val')) ref[ref.length-1] = { id:ref[ref.length-1], where:[more.shift()] }
        ref.push (...more)
      }
      const res = {from: {ref}}
      if (tail && tail.columns) res.columns = tail.columns
      return res
    }

  args
    = val:val {return [val]}
    / ref:ref o"="o val:val more:( COMMA args )? {
      const args = [ ref, '=', val ]
      if (more) args.push ('and', ...more[1])
      return args
    }

  // `path` cannot be used in hierarchy functions, hence use a simpler definition
  simplePath
    = i:identifier filter:(OPEN CLOSE/OPEN a:args CLOSE{ return a })? tail:("/" s:simplePath{ return s })*{
      const ref = [filter ? { id: i, where: filter } : i]
      if (tail.length) ref.push(...tail.map(t => t.from.ref[0]))
      return {
        from: {
          ref 
        }
      }
    }


//
// ---------- Query Options ------------

  QueryOption =
    "$skiptoken="   o skiptoken /
    "$search="      o s:search { if (s) SELECT.search = s } / // top level search is parsed differently than within expand
    option:ExpandOption { if(option && option.apply) SELECT.apply = option.apply} /
    temporal /
    format /
    custom /
    aliasedParamEqualsValOrPrefixParam /
    deltaToken
  // @OData spec for $expand:
  // "Allowed system query options are $filter, $select, $orderby, $skip, $top, $count, $search, $expand and 
  // $apply (https://go.sap.corp/0jzs)."
  ExpandOption =
    "$select="      o select ( COMMA select )* /
    "$expand="      o expand ( COMMA expand )* expandCount? /
    "$filter="      o f:filter { SELECT.where = f } /
    "$orderby="     o o:orderby ( COMMA o2:orderby{_setOrderBy(o2)} )* {_setOrderBy(o,true)} /
    "$top="         o val:top { (SELECT.limit || (SELECT.limit={})).rows = {val} } /
    "$skip="        o val:skip { _setLimitOffset(val) } /
    "$search="      o s:search_expand { if (s) SELECT.search = s } /
    "$count="       o count /
    "$apply="       &{ return cds.env.features.skip_apply_parsing } o [^&]* { return null } /
    "$apply="       o trafos:transformations { return trafos } /
    // Workaround to support empty expand even if not OData compliant old adapter supported it and did not crash
    "$expand=" {return null}

  temporal = ("$at" / "$from" / "$toInclusive" / "$to") "=" date

  select
    = col:('*' / ref) {
      SELECT.columns = Array.isArray(SELECT.columns) ? SELECT.columns : []
      if (!SELECT.columns.find(_compareRefs(col))) SELECT.columns.push(col)
      return col
    }

  expandCount 
    = "/$count" {
      const err = new Error('"/$count" is not supported for expand operation');
      err.statusCode=501;
      throw err;
    }

  expandQueryOptions
   = (
      expandOptions:(option:ExpandOption o ";"? { return option })*
      {
      	if (expandOptions.find(option => option && option.apply !== undefined)) {
        	const err = new Error('"$apply" is not supported for expand operation');
      		err.statusCode=501;
      		throw err;
        }
        if (SELECT.columns) {
          for (const col of SELECT.columns) {
            if (!SELECT.expand.find(_compareRefs(col))) SELECT.expand.push(col)
          }
          delete SELECT.columns
        } else {
          if (Array.isArray(SELECT.expand) && SELECT.expand.indexOf('*') === -1) SELECT.expand.unshift('*')
        }
      }
      )

  expandQueryOption
   = (OPEN {
        stack.push (SELECT)
        SELECT = SELECT.expand[SELECT.expand.length-1]
        SELECT.expand = []
      }) 
      expandQueryOptions? 
      (CLOSE {
        if (!SELECT.expand.length) {
          SELECT.expand.push('*') // by default expand everything
        }
        SELECT = stack.pop()
      })
    

// REVISIT: per OData spec $apply should be also supported inside of $expand
  expand
  = (
      c:('*' / ref) {
        const col = c === '*' ? {} : c
        col.expand = ['*']
        if (!Array.isArray(SELECT.expand)) SELECT.expand = []
        if (!SELECT.expand.find(_compareRefs(col))) SELECT.expand.push(col)
        return col
      }
    )
    expandQueryOption?

  top
    = val:integer { return val }

  skiptoken
    = skiptoken:skiptokenChars? {
      skipToken(skiptoken, { SELECT })
    }

  skip
    = val:integer { return val }

  search
    = p:search_clause {return p}
      / o // Do not add search property for space only

  search_clause
    = val:$(($[ ]* (
            [^"&]+
            / ('"' ("\\\\" / "\\\"" / [^"])+ '"' [ ]*)+
      ))+)
      { return [{ val }] }

  search_expand
    = val:$( [^;)]+ ) { return [{ val }] }
       / o // Do not add search property for space only

  filter
    = p:where_clause { return p }

  where_clause = p:( n:NOT? {return n?[n]:[]} )(
      OPEN xpr:where_clause CLOSE {p.push({xpr})}
      / comp:comparison {p.push(...comp)}
      / xpr:lambda {
        if (p[p.length - 1] === 'not' && xpr[0] === 'not') {
          p.push({ xpr })
        } else {
          p.push(...xpr)
        }
      }
      / func:boolish {p.push(func)}
      / val:bool {p.push({val})}
      / list:listFilter {p.push(...list)}
    )( ao:(AND/OR) more:where_clause {p.push(ao,...more)} )*
    { return p }

  lambda =
    nav:( n:identifier {return[n]} ) '/' ( n:identifier '/' {nav.push(n)} )*
    xpr:(
      any:any {
        let id = nav.pop()
        if (!any) return ['exists', { ref: [...nav, { id }] }]
        let xpr = []
        for (let i=0, k=0; i<any.length; ++i) {
          let each = any[i]
          if (each.ref && each.ref.length === 0 && any[i+1] === '=') {
            xpr[k++] = { func:'contains', args:[{ref:[id]}, any[i+=2]] }
          } else {
            xpr[k++] = each
          }
        }
        if (xpr.length < any.length) {
          if (!nav.length) {
            // no navigation
            return xpr
          }
          id = nav.pop()
          return ['exists', { ref: [...nav, { id, where: xpr }] }]
        } else {
          return ['exists', { ref: [...nav, { id, where: any }] }]
        }
      }
      / all:all {
        let id = nav.pop()
        return ['not', 'exists', { ref: [...nav, { id, where: ['not', { xpr: [...all] }] }] }]
      }
    )
    { return xpr }

  inner_lambda =
    p:( n:NOT? { return n ? [n] : [] } )(
      OPEN xpr:inner_lambda CLOSE { p.push({xpr}) }
      / comp:comparison { p.push(...comp) }
      / func:function { p.push(func) }
      / lambda:lambda { p.push(...lambda)}
      / list:listFilter { p.push(...list) }
    )
    ( ao:(AND/OR) more:inner_lambda { p.push(ao, ...more) } )*
    { return p }

  lambda_clause =
    prefix:identifier ":" inner:inner_lambda { return _removeLambdaPrefix(prefix, inner) }

  any =
   "any" OPEN p:lambda_clause? CLOSE { return p }

  all =
   "all" OPEN p:lambda_clause CLOSE { return p }

  orderby
    = ref:(
        lambda {
          const err = new Error('"$orderby" does not support lambda');
          err.statusCode=501;
          throw err;
        } /
        function /
        ref
      ) 
      sort:( _ s:$("asc" / "desc") { return s })? {
        // TODO: Lambda support
        const appendObj = $(ref, sort && {sort});
        return appendObj;
    }

  count
    = val:bool { if(val) SELECT.count = true }

  transformations
    = mainTransformation:trafo additionalTransformation:("/" t2:trafo {
      return t2
    })* {
    	if(mainTransformation === undefined) return
      additionalTransformation = (Array.isArray(additionalTransformation)) ? additionalTransformation : [additionalTransformation] 
      // Loop through additionalTransformation
      // Loop through each element, add it to current level, if element is already part of result, increase level
      for(let trafos of additionalTransformation) {
        for(const trafo in trafos) {
          if (trafo === 'limit' && trafos.limit && mainTransformation.limit && mainTransformation.limit.offset && trafos.limit.rows)
            mainTransformation.limit.rows = trafos.limit.rows
          else if(
          	mainTransformation[trafo] || 
            (trafo === 'groupBy' && (mainTransformation.where || mainTransformation.search)) || 
            (trafo === 'aggregate' && 'groupBy' in mainTransformation && !('groupBy' in trafos))
          ) {
            let _apply = mainTransformation
            mainTransformation = { apply: _apply } 
            if (trafo === 'limit' && trafos[trafo].offset && _apply.limit && _apply.limit.offset && _apply.limit.offset.val)
              trafos[trafo].offset += _apply.limit.offset.val
            
            _apply = mainTransformation
            _apply[trafo] = trafos[trafo]
          } else {
            mainTransformation[trafo] = trafos[trafo]
          }
        }
      }
      return {apply: mainTransformation}
    }

  deltaToken = "$deltatoken=" o token:([^&]*) { return token }

    valList "value with double-quoted string"
    = val:doubleQuotedString {return {val}}
    / !"'" val:val {return val}

  innerListParam = (val1:valList val2:("," v:valList { return v })* { return [val1, ...val2] })

  aliasedParamVal = val / jsonObject / jsonArray / "[" list:innerListParam "]" { return { list } }

  custom = k:$([[a-zA-Z0-9-_.~!\[\]]+) "="? v:$([^&]*)? {
    _custom(k, v)
  }

  aliasedParam "an aliased parameter (@param)" = "@" i:identifier { return "@" + i }
  aliasedParamEqualsValOrPrefixParam = alias:aliasedParam "=" !aliasedParam value:aliasedParamVal {
    const isAliased =  _replaceAliased(SELECT, alias, value);
    if (!isAliased) { // custom parameters with "@" prefix (not aliased)
      if (value.val) {
        value = value.val
      } else if (value.list && Array.isArray(value.list)) {
        value = value.list.map(obj => obj.val)
      }
      _custom(alias, value) 
    }
  }

  format = "$format=" f:$([^&]*) {
    if (f.toLowerCase() !== "json") {
      const err = new Error('Only query parameter "json" is allowed in "$format".')
      err.statusCode = 501
      throw err;
    }
  }

//
// ---------- Expressions ------------

  comparison
    = a:operand _ o:$("eq" / "ne" / "lt" / "gt" / "le" / "ge") _ b:operand {
      return [ a, OPERATORS[o] || o, b ]
    }

  listFilterParam = aliased:aliasedParam { return { list: aliased } } / listRoundBrackets

  listFilter
    = a:operand _ "in" _ b:listFilterParam {
      return [ a, "in", b ]
    }

  mathCalc
    = operand (_ ("add" / "sub" / "mul" / "div" / "mod") _ operand)*
  
  operand
    = navigationCount / function / val / ref / jsonObject / jsonArray / list
  
  navigationCount "navigation with $count"
  = navigationPath:(head:identifier key:(OPEN keyArgs:args CLOSE {return keyArgs;})? '/' {
    if (key) {
      // we have key in xpr
      return {id: head, where: key}
    }
    return head;
  })+ count: '$count'
    { return {func: 'count', as: '$count', args: [{ref: navigationPath}]} }
  
  ref "a reference"
    = head:identifier tail:( '/' n:identifier {return n})*
    {
      if (head === "null") {
        return { val: null }
      }
      return { ref:[ head, ...tail ] }
    }

  val
    = val:bool {return {val}}
    / val:date {return {val}}
    / val:time {return {val}}
    / val:guid {return {val}}
    / val:number {return typeof val === 'number' ? {val} : { val, literal:'number' }}
    / val:string {return {val}}
    / val:binary {return {val}}
    / val:aliasedParam {return {val}}
    / null

  null "null" =  "null" {return {val: null }}
  
  // REVISIT why not JSON.parse() and return JS object?
  jsonObject "a json object"
    = val:$("{" (jsonObject / [^}])* "}") {return {val}}
  
  // REVISIT why not JSON.parse() and return JS array?
  jsonArray "a json array"
    = val:$("[" o "]" / "[" o "{" (jsonArray / [^\]])* "]") {return {val}}

  // REVISIT: only used for contains(identifier, ["searchterm"]) <- use innerList instead?
  list "a list"
    = "[" any:$([^\]])* "]" // > needs improvment
    { return { list: any.replace(/"/g,'').split(',').map(ele => ({ val: ele })) } }
  
  innerList = (val1:val val2:("," v:val { return v })* { return [val1, ...val2] })

  listRoundBrackets "a list"
    = OPEN list:innerList CLOSE // > needs improvment
    { return {list} }

  
  functionName "a function name"
  = $[a-zA-Z]+

  function 
    = func:functionName OPEN args:functionArgs CLOSE {
      if (strict && !(func.toLowerCase() in strict.functions)) {
        throw Object.assign(new Error(`Function "${func}" is not supported`), { statusCode: 501 })
      }
      return { func: func.toLowerCase(), args }
    }

  functionArgs
    = args:(a:operand more:( COMMA o:operand { return o } )* { return [ a, ...more ] })* { return args.length ? args[0] : args }

  boolish
    = func:("contains"i/"endswith"i/"startswith"i/"matchespattern"i) OPEN a:operand COMMA b:operand CLOSE
    { return { func: func.toLowerCase(), args:[a,b] }}

  NOT = o "NOT"i _ {return 'not'}
  AND = _ "AND"i _ {return 'and'}
  AND_SPACE =    _ {return 'and'}
  OR  = _  "OR"i _ {return 'or'}


//
// ---------- Transformations ------------
// Odata spec: http://docs.oasis-open.org/odata/odata-data-aggregation-ext/v4.0/odata-data-aggregation-ext-v4.0.html

  trafo
    = (
      "aggregate" agg:aggregateTrafo{return agg} /
      "groupby" group:groupbyTrafo{return group} /
      "filter" filter:filterTrafo{return filter} /

      // REVISIT: All transformations below need improvment
      "search" search:searchTrafo{return search} /
      "concat" con:concatTrafo{return con} / //> Return con so that concat string is not returned
      "compute" compute:computeTrafo{return compute} /
      "top" top:topTrafo{return top} /
      "skip" skip:skipTrafo{return skip} /
      "orderby" order:orderbyTrafo{return order} /
      "com.sap.vocabularies.Hierarchy.v1.TopLevels" toplevels:topLevelsTrafo{return toplevels} /
      "ancestors" ancestors:ansDescTrafo{return { ancestors: ancestors }} /
      "descendants" descendants:ansDescTrafo{return { descendants: descendants }} /
      func:("topcount"i/"bottomcount"i/"topsum"i/"bottomsum"i/"toppercent"i/"bottompercent"i) args:commonFuncTrafo {
        func = func.toLowerCase()
        if (!SUPPORTED_APPLY_TRANSFORMATIONS[func]) {
          throw Object.assign(new Error(`Transformation "${func}" in $apply is not yet supported.`), { statusCode: 501 })
        }        
        return {aggregate: [{ func, args }]}
      } /
      identity: identityTrafo {return identity}
      // customFunction
    )

  aggregateTrafo
    = OPEN o head:aggregateItem tail:(o COMMA o p:aggregateItem {return p})* o CLOSE {
      let response = {aggregate: [head,...tail]}
      return response
    }
  aggregateItem
    = res:("$count" as:asAlias { return { func: 'count', args: [{ val: 1 }], as } }
           / aggregateExpr
          ) { return res }
  aggregateExpr
    = path:(
        ref
     // / mathCalc - needs CAP support
      )
      func:aggregateWith? aggregateFrom? as:asAlias?
        { return { func, args: [ path ], as: as ?? path.ref[0] } }
      / identifier OPEN aggregateExpr CLOSE // needs CAP support
   // / customAggregate // needs CAP support
  aggregateWith
    = _ "with" _ func:$[a-zA-Z]+ { return func.toLowerCase(); }
  aggregateFrom
    = _ "from" _ ref aggregateWith aggregateFrom? // needs CAP support
  asAlias
    = _ "as" _ alias:identifier { return alias; }

  groupbyTrafo
    = OPEN OPEN head:groupByElem tail:(COMMA p:groupByElem {return p})* (CLOSE {
      
      return { groupBy: [head, ...tail] }
    }) trafos:(COMMA t:transformations {return t})? CLOSE {
    	  let apply = {}
        apply = (trafos) ? {groupBy: [head, ...tail], ...trafos.apply} : {groupBy: [head, ...tail]} 
        return apply
    }
  groupByElem
    = c:(rollupSpec / ref) { return c }
  rollupSpec // TODO fix this + add CAP support
    = rollup:("rollup" OPEN o ('$all' / ref) (o COMMA ref)+ o CLOSE) {
        const err = new Error("Rollup in groupby is not supported yet.");
        err.statusCode=501;
        throw err;
      }

  filterTrafo = OPEN o where:(where:filter{
    return where
  }) o CLOSE {
  	return {where: where}
  }

  searchTrafo = OPEN search:$([^)]*) CLOSE {
    search = search.trim()
    if (!search) return
    return {search: [{val: search }]}
  }

  concatTrafo = OPEN o trafo1:transformations trafo2:(o COMMA o trafos:transformations{ return trafos })+ o CLOSE {
    return {concat: [trafo1, ...trafo2]}
  }

  // REVISIT: support compute - current implementation is deviating from odata
  computeTrafo = OPEN o computeExpr (o COMMA o computeExpr)* o CLOSE

  computeExpr = where_clause asAlias

  commonFuncTrafo = OPEN o first:operand o COMMA o second:operand o CLOSE { return [first, second] }

  // REVISIT: support identity
  identityTrafo = "identity" {return {identity: true }}

  topTrafo
    = OPEN o val:top o CLOSE {
      return {limit: {rows: {val}}}
    }

  skipTrafo
    = OPEN o val:skip o CLOSE {
      return {limit: {offset: {val}}}
    }

  orderbyTrafo
    = OPEN o o:orderby o2:( COMMA o2:orderby{return o2} )* o CLOSE {
      return {orderBy: [o,...o2]}
    }

  topLevelsTrafo
    = OPEN o t:topLevelsArg ts:(o COMMA o t2:topLevelsArg{ return t2 })* o CLOSE {
      ts.forEach(_t => Object.assign(t, _t))
      return { 
        topLevels: t
      }
    }

  topLevelsArg
    = hierarchyNodes /
      hierarchyQualifier /
      nodeProperty /
      levels /
      expandLevels

  hierarchyNodes
    = o "HierarchyNodes" o "=" o "$root/" p:simplePath o {
      return { hierarchyNodes: p }
    }

  hierarchyQualifier
    = o "HierarchyQualifier" o "=" o s:string o {
      return { hierarchyQualifier: s }
    }

  nodeProperty
    = o "NodeProperty" o "=" o s:string o {
      return { nodeProperty: s }
    }

  levels
    = o "Levels" o "=" o i:integer o {
       return { levels: i}
    }

  expandLevels
    = o "ExpandLevels" o "=" o "[" o e:expandItem es:(o COMMA o e2:expandItem{ return e2 })* "]" {
      return { expandLevels: [e, ...es] }
    }

  expandItem
    = o "{" o e1:expandItemProp o "," o e2:expandItemProp o "}" {
      return Object.assign(e1,e2)
    }

  expandItemProp
    = "\"NodeID\"" o ":" o s:doubleQuotedString{return { nodeID: s } } /
      "\"Levels\"" o ":" o l:expandItemLevel{return { levels: l } }

  expandItemLevel
    = i:integer{ return i } /
      null{ return null }

  ansDescTrafo
    = OPEN o "$root/" p:simplePath o COMMA o h:identifier o COMMA o e:identifier o COMMA? t:ansDescGetNodes? o COMMA? d:integer? o COMMA? k:ansDescKeepStart? CLOSE {
        return { 
            path: p,
            hierarchy: h,
            id: e,
            nodes: t,
            distance: d,
            keepStart: k?.keepStart || false
        }
    }

    ansDescGetNodes
    = g:ansDescGetNode gs:( o "/" o g2:ansDescGetNode{return g2} )*{ return [g, ...gs] }

    ansDescGetNode
    = ansDescSearchNode /
      ansDescFilterNode

    ansDescFilterNode
    = "filter(" f:filter ")"{ return { filter: f } }

    ansDescSearchNode
    = "search(" s:search_expand ")"{ return { search: s } }

    ansDescKeepStart
    = "keep start"{ return { keepStart: true } }

//
// ---------- Literals -----------

  bool "a boolean"
    = b:("true" / "false") { return b === 'true'}

  string "a single quoted string" // "Edm.String"
    = "'" s:$("''" / [^'])* "'" // 'A user''s story'
    {return s.replace(/''/g,"'")}

  doubleQuotedString "a doubled quoted string"
    = '"' s:$('\\"' / '\\\\' / [^"])* '"'
    {return s.replace(/\\\\/g,"\\").replace(/\\"/g,'"')}

  word "a string"
    = $([^ \t\n()"&;]+)

  time "a time"
    = $([0-9][0-9]":"[0-9][0-9]":"[0-9][0-9])

  date "a date"
    = s:$( [0-9]+"-"[0-9][0-9]"-"[0-9][0-9] // date
      ( "T"[0-9][0-9]":"[0-9][0-9](":"[0-9][0-9]("."[0-9]+)?)? // time
      ( "Z" / (("+" / "-")[0-9][0-9]":"[0-9][0-9]) )? // timezone (Z or +-hh:mm)
    )?) {
      if (s.split('-')[0].length > 4)
        throw Object.assign(new Error(`The type Edm.DateTimeOffset is not compatible with "${s}"`), { statusCode: 400 })
      return s
    }

  // to avoid 123-123-123 being matched as number and showing error for "-123-123"
  endsWithMinus
    = [0-9]+ "-"

  number "a number"
    = !endsWithMinus s:$( [+-]? [0-9]+ ("."[0-9]+)? ("e"[0-9]+)? ) { return safeNumber(s) }

  integer "an integer"
    = s:$( [+-]? [0-9]+ ) { return parseInt(s) }

  identifier "an identifier"
    = !bool !guid s:$([_a-zA-Z][_a-zA-Z0-9"."\u0041-\u005A\u0061-\u007A\u00AA\u00B5\u00BA\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0\u08A2-\u08AC\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0977\u0979-\u097F\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D\u0C58\u0C59\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D60\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191C\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2183\u2184\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005\u3006\u3031-\u3035\u303B\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA697\uA6A0-\uA6E5\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA80-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]*) { return s }

  guid "a guid"
    = $( hex16 hex16 "-"? hex16 "-"? hex16 "-"? hex16 "-"? hex16 hex16 hex16 )

  hex16 "a hex value"
    = $( [0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F] )

  segment // > everything except / and ?
    = val:$( [^/?]+ ) { return { val } }

  skiptokenChars
    = $( [a-zA-Z0-9-"."_~!$'()*+,;=:@"/""?"]+ )

  binary "a binary" // > url-safe base64
    = "binary'" s:$([a-zA-Z0-9-_]+ ("=="/"=")?) "'" { return cds.env.features.base64_binaries ? standardBase64(s) : Buffer.from(s, 'base64') }

//
// ---------- Punctuation ----------

  COLON = o":"o
  COMMA = o","o
  SEMI  = o";"o
  OPEN  = o"("o
  CLOSE = o")"

//
// ---------- Whitespaces -----------

  o "an optional whitespace" = $[ \t\n]*
  _ "a whitespace" = $[ \t\n]+

//
// ------------------------------------
