const { createJoinCQNFromExpanded, rawToExpanded, hasExpand } = require('@sap/cds/libx/_runtime/db/expand')
const { sqlFactory } = require('@sap/cds/libx/_runtime/db/sql-builder')
const { PGSelectBuilder, PGResourceBuilder, PGFunctionBuilder, PGExpressionBuilder } = require('./sql-builder')
const { postProcess, getPostProcessMapper } = require('@sap/cds/libx/_runtime/db/data-conversion/post-processing')
const { PG_TYPE_CONVERSION_MAP } = require('./converters/conversion')
const { flattenArray } = require('./utils/deep')
const { remapColumnNames } = require('./utils/columns')
const LOG = cds.log('cds-db2')

const ISO_8601_FULL = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(([+-]\d\d:\d\d)|Z)?$/i
/**
 * Processes a generic CQN statement and executes the query against the database.
 * The result rows are processed and returned.
 * @param {Object} model
 * @param {import('ibm_db').PoolClient} dbc
 * @param {Object} query
 * @param {*} user
 * @param {String} locale
 * @param {*} txTimestamp
 * @return {import('ibm_db').QueryArrayResult}
 */
const executeGenericCQN = (model, dbc, query, user, isQuery /*, locale, txTimestamp */) => {
  const { sql, values = [] } = _cqnToSQL(model, query, user)
  const isOne = query.SELECT && query.SELECT.one
  const postPropertyMapper = getPostProcessMapper(PG_TYPE_CONVERSION_MAP, model, query)
  return _executeSQLReturningRows(dbc, sql, values, isOne, postPropertyMapper, null, null, isQuery)
}

/**
 * Processes a SELECT CQN statement and executes the query against the database.
 * The result rows are processed and returned.
 * @param {Object} model
 * @param {import('ibm_db').PoolClient} dbc
 * @param {Object} query
 * @param {*} user
 * @param {String} locale
 * @param {*} txTimestamp
 * @return {import('ibm_db').QueryArrayResult}
 */
const executeSelectCQN = (model, dbc, query, user /*, locale, txTimestamp*/) => {
  if (hasExpand(query)) {
    return processExpand(dbc, query, model, user)
  } else {
    const { sql, values = [] } = _cqnToSQL(model, query, user)
    const isOne = query.SELECT && query.SELECT.one
    const postPropertyMapper = getPostProcessMapper(PG_TYPE_CONVERSION_MAP, model, query)
    return _executeSQLReturningRows(dbc, sql, values, isOne, postPropertyMapper)
  }
}

/**
 * Handles INSERT statements which require a special treatment because batch
 *
 * @see https://github.com/brianc/node-postgres/issues/2257
 * @param {Object} model
 * @param {import('ibm_db').PoolClient} dbc
 * @param {Object} query
 * @param {*} user
 * @param {String} locale
 * @param {*} txTimestamp
 * @return {Array}
 */
const executeInsertCQN = async (model, dbc, cqn, user) => {
  const { sql, values = [] } = _cqnToSQL(model, cqn, user)
  const postPropertyMapper = getPostProcessMapper(PG_TYPE_CONVERSION_MAP, model, cqn)
  const resultPromises = []

  // Only bulk inserts will have arrays in arrays
  if (Array.isArray(values[0])) {
    for (const value of values) {
      resultPromises.push(_executeSQLReturningRows(dbc, _appendReturning(sql), value, false, postPropertyMapper))
    }
  } else {
    resultPromises.push(_executeSQLReturningRows(dbc, _appendReturning(sql), values, false, postPropertyMapper))
  }

  let results = await Promise.all(resultPromises)
  results = flattenArray(results)
  results = results.map(result => remapColumnNames(model.definitions[cqn.INSERT.into], result))
  return results
}

/**
 * Executes a raw SQL statement against the database.
 *
 * @param {import('ibm_db').PoolClient} dbc
 * @param {String} sql
 * @param {String} [values]
 * @return {Array} the result rows
 */
async function executePlainSQL (dbc, rawSql, rawValues) {
  const { sql, values } = _replacePlaceholders({
    sql: rawSql,
    values: rawValues,
  })

  LOG._debug && LOG.debug('sql > ', rawSql)
  values && values.length > 0 && LOG._debug && LOG.debug('values > ', rawValues)

  // values will be often undefined but is required for potential queries using placeholders
  const result = await dbc.query(sql, values)
  return result.rows
}

/**
 * Processes requests with expands.
 *
 * @param {import('ibm_db').PoolClient} dbc
 * @param {Object} cqn
 * @param {Object} model
 * @param {*} user
 * @return {import('ibm_db').QueryArrayResult} the
 */
const processExpand = (dbc, cqn, model, user) => {
  let queries = []
  const expandQueries = createJoinCQNFromExpanded(cqn, model, true)
  for (const cqn of expandQueries.queries) {
    // REVISIT
    // Why is the post processing in expand different?
    const { sql, values } = _cqnToSQL(model, cqn, user, true)
    const postPropertyMapper = getPostProcessMapper(PG_TYPE_CONVERSION_MAP, model, cqn)

    queries.push(_executeSQLReturningRows(dbc, sql, values, false, postPropertyMapper))
  }

  return rawToExpanded(expandQueries, queries, cqn.SELECT.one, cqn._target)
}

/**
 * Transforms the CQN notation to SQL
 *
 * @param {Object} model
 * @param {Object} cqn
 * @param {*} user
 * @param {Boolean} isExpand
 * @return {Object} the query object containing sql and values
 */
function _cqnToSQL (model, cqn, user, isExpand = false) {
  const dateString = new Date().toISOString()
  return _replacePlaceholders(
    sqlFactory(
      cqn,
      {
        customBuilder: {
          SelectBuilder: PGSelectBuilder,
          ResourceBuilder: PGResourceBuilder,
          ExpressionBuilder: PGExpressionBuilder,
          FunctionBuilder: PGFunctionBuilder,
        },
        isExpand, // Passed to inform the select builder that we are dealing with an expand call
        now: dateString.slice(0, dateString.length - 1), //'NOW ()',
        user,
      },
      model,
      isExpand,
    ),
  )
}

/**
 * Placeholders in Postgres don't use ? but $1 $2, etc.
 * We just replace them here.
 *
 * @param {Object} query
 * @return {Object} the modified query
 */
const _replacePlaceholders = query => {
  var questionCount = 0
  query.sql = query.sql.replace(/(\\*)(\?)/g, (match, escapes) => {
    if (escapes.length % 2) {
      return '?'
    } else {
      questionCount++
      //return '$' + questionCount
      return '?'
    }
  })
  return query
}

/**
 * Enriches INSERT statements with a Returning clause to enable
 * returning the inserted IDs.
 *
 * @param {Object} query
 * @return {Object} the modified query
 */
const _appendReturning = query => {
  //query += ' Returning *'
  return query
}

/**
 * Executes a sql statement againt the database.
 *
 * @param {import('ibm_db').PoolClient} dbc
 * @param {String} sql
 * @param {Array} values
 * @param {Boolean} isOne
 * @param {Function} postMapper
 * @param {Function} propertyMapper
 * @param {Function} objStructMapper
 * @returns {import('ibm_db').QueryResult} the executed and processed result
 */
async function _executeSQLReturningRows (
  dbc,
  sql,
  values,
  isOne,
  postMapper,
  propertyMapper,
  objStructMapper,
  isQuery = true,
) {
  LOG._debug && LOG.debug('sql > ', sql)
  values && values.length > 0 && LOG._debug && LOG.debug('values > ', values)

  // reformat timestamps
  // 2002-12-31T23:00:00+01:00 and 2002-12-31T23:00:00 and 2002-12-31T23:00:00Z
  // TODO: Move this function
  values = values?.map(value => {
    if (value && value !== null) {
      if (typeof value === 'object' && value.toISOString) {
        value = value.toISOString()
      }
      if (typeof value === 'string' && value.length >= 19 && value.length <= 30 && ISO_8601_FULL.test(value)) {
        return value.replace('T', ' ').replace('Z', '').replace('+00:00', '').replace('+0000', '')
      }
    }
    return value
  })
  sql = sql.replace(/\s(_\w*)/gm, ' "$1"')

  if (!isQuery) {
    const stmt = dbc.prepareSync(sql)
    const affectedRows = stmt.executeNonQuerySync(values)
    stmt.closeSync()
    return affectedRows
  }

  let rawResult = dbc.querySync(sql, values)
  if (rawResult.error) {
    LOG.warn(sql, values)
    // SQLSTATE 01504 - The SQL statement will modify an entire table or view.  SQLSTATE=01504
    // SQLSTATE 01517 - A character that could not be converted was replaced with a substitute character
    // SQLSTATE 01602 - Performance of this complex query might be sub-optimal
    if (!rawResult.state.startsWith('01')) {
      LOG.error(sql, values)
      throw new Error(rawResult)
    }
  }
  if (isOne) {
    if (rawResult && rawResult.length > 0) {
      rawResult = rawResult[0]
    } else {
      rawResult = null
    }
  }
  return postProcess(rawResult, postMapper, propertyMapper, objStructMapper)
}

const executeUpdateCQN = async (model, dbc, cqn, user) => {
  const result = await executeGenericCQN(model, dbc, cqn, user, false)
  return Array.isArray(result) ? result.length : result
}

const executeDeleteCQN = async (model, dbc, cqn, user) => {
  const result = await executeGenericCQN(model, dbc, cqn, user, false)
  return Array.isArray(result) ? result.length : result
}

module.exports = {
  delete: executeDeleteCQN,
  insert: executeInsertCQN,
  update: executeUpdateCQN,
  read: executeSelectCQN,
  //stream: executeSelectStreamCQN,
  cqn: executeGenericCQN,
  sql: executePlainSQL,
}
