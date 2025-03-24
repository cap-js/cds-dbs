// COPIED AS IS (excluding unused code) FROM @sap/cds

const dynatrace = {}
try {
  dynatrace.sdk = require('@dynatrace/oneagent-sdk')
  dynatrace.api = dynatrace.sdk.createInstance()
} catch {
  // If module was not required, do not do anything
}

const _shall_wrap = () => {
  return dynatrace.sdk !== undefined && !process.env.CDS_SKIP_DYNATRACE
}

const _dynatraceResultCallback = function (tracer, cb) {
  return function (err, ...args) {
    const results = args.shift()
    if (err) {
      tracer.error(err)
    } else {
      tracer.setResultData({
        rowsReturned: (results && results.length) || results
      })
    }
    tracer.end(cb, err, results, ...args)
  }
}

const _execUsingDynatrace = (client, execFn, dbInfo) => {
  // args = [sql, options, callback] --> options is optional
  return function (...args) {
    const cb = args[args.length - 1]

    const tracer = dynatrace.api.traceSQLDatabaseRequest(dbInfo, {
      statement: args[0]
    })

    tracer.startWithContext(execFn, client, ...args.slice(0, args.length - 1), _dynatraceResultCallback(tracer, cb))
  }
}

const _preparedStmtUsingDynatrace = function (client, prepareFn, dbInfo) {
  // args = [sql, options, callback] --> options is optional
  return function (...args) {
    const cb = args[args.length - 1]

    const tracer = dynatrace.api.traceSQLDatabaseRequest(dbInfo, {
      statement: args[0]
    })

    tracer.startWithContext(prepareFn, client, ...args.slice(0, args.length - 1), (err, stmt) => {
      if (err) {
        tracer.error(err)
        tracer.end(cb, err)
      } else {
        // same here. hana-client does not like decorating
        const originalExecFn = stmt.exec
        stmt.exec = function (...args) {
          const stmtCb = args[args.length - 1]
          originalExecFn.call(stmt, ...args.slice(0, args.length - 1), _dynatraceResultCallback(tracer, stmtCb))
        }
        cb(null, stmt)
      }
    })
  }
}

const _wrapped = (client, credentials, tenant) => {
  const dbInfo = {
    name: `SAPHANA${tenant ? `-${tenant}` : ''}`,
    vendor: dynatrace.sdk.DatabaseVendor.HANADB,
    host: credentials.host,
    port: Number(credentials.port)
  }

  // hana-client does not like decorating.
  // because of that, we need to override the fn and pass the original fn for execution
  const originalExecFn = client.exec
  client.exec = _execUsingDynatrace(client, originalExecFn, dbInfo)
  const originalPrepareFn = client.prepare
  if (client.name === '@sap/hana-client') {
    // client.prepare = ... doesn't work for hana-client
    Object.defineProperty(client, 'prepare', { value: _preparedStmtUsingDynatrace(client, originalPrepareFn, dbInfo) })
  } else {
    client.prepare = _preparedStmtUsingDynatrace(client, originalPrepareFn, dbInfo)
  }

  return client
}

module.exports = {
  wrap_client: (client, credentials, tenant) => {
    if (client.isDynatraceSupported) return client //> client will wrap itself
    if (!_shall_wrap()) return client
    return _wrapped(client, credentials, tenant)
  }
}
