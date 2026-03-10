// Uses OpenTelemetry API (https://www.npmjs.com/package/@opentelemetry/api) for SQL tracing of HANA connections.
// The API package is a no-op stub when no SDK is registered at runtime, so requiring it is always safe.

let otel
try {
  otel = require('@opentelemetry/api')
} catch {
  // If module was not required, do not do anything
}

const _shall_wrap = () => {
  return otel !== undefined && !process.env.CDS_SKIP_DYNATRACE
}

const _dbInfo = (credentials, tenant) => ({
  'db.system': 'hanadb',
  'db.name': `SAPHANA${tenant ? `-${tenant}` : ''}`,
  'net.peer.name': credentials.host,
  'net.peer.port': Number(credentials.port),
})

const _execUsingOtel = (client, execFn, dbAttrs) => {
  const tracer = otel.trace.getTracer('@cap-js/hana')
  // args = [sql, options, callback] --> options is optional
  return function (...args) {
    const cb = args[args.length - 1]
    const span = tracer.startSpan('hana.exec', {
      kind: otel.SpanKind.CLIENT,
      attributes: { ...dbAttrs, 'db.statement': args[0] },
    })
    const ctx = otel.trace.setSpan(otel.context.active(), span)
    otel.context.with(ctx, () => {
      execFn.call(client, ...args.slice(0, args.length - 1), (err, results, ...rest) => {
        if (err) {
          span.recordException(err)
          span.setStatus({ code: otel.SpanStatusCode.ERROR, message: err.message })
        } else {
          const rowCount = results && results.length != null ? results.length : results
          if (rowCount != null) span.setAttribute('db.rows_returned', rowCount)
        }
        span.end()
        cb(err, results, ...rest)
      })
    })
  }
}

const _preparedStmtUsingOtel = (client, prepareFn, dbAttrs) => {
  const tracer = otel.trace.getTracer('@cap-js/hana')
  // args = [sql, options, callback] --> options is optional
  return function (...args) {
    const cb = args[args.length - 1]
    const span = tracer.startSpan('hana.prepare', {
      kind: otel.SpanKind.CLIENT,
      attributes: { ...dbAttrs, 'db.statement': args[0] },
    })
    const ctx = otel.trace.setSpan(otel.context.active(), span)
    otel.context.with(ctx, () => {
      prepareFn.call(client, ...args.slice(0, args.length - 1), (err, stmt) => {
        if (err) {
          span.recordException(err)
          span.setStatus({ code: otel.SpanStatusCode.ERROR, message: err.message })
          span.end()
          cb(err)
        } else {
          const originalExecFn = stmt.exec
          stmt.exec = function (...args) {
            const stmtCb = args[args.length - 1]
            originalExecFn.call(stmt, ...args.slice(0, args.length - 1), (err, results, ...rest) => {
              if (err) {
                span.recordException(err)
                span.setStatus({ code: otel.SpanStatusCode.ERROR, message: err.message })
              } else {
                const rowCount = results && results.length != null ? results.length : results
                if (rowCount != null) span.setAttribute('db.rows_returned', rowCount)
              }
              span.end()
              stmtCb(err, results, ...rest)
            })
          }
          cb(null, stmt)
        }
      })
    })
  }
}

const _wrapped = (client, credentials, tenant) => {
  const dbAttrs = _dbInfo(credentials, tenant)

  const originalExecFn = client.exec
  client.exec = _execUsingOtel(client, originalExecFn, dbAttrs)

  const originalPrepareFn = client.prepare
  const wrappedPrepareFn = _preparedStmtUsingOtel(client, originalPrepareFn, dbAttrs)
  if (client.name === '@sap/hana-client') {
    // hana-client does not allow overriding prepare via assignment
    Object.defineProperty(client, 'prepare', { value: wrappedPrepareFn })
  } else {
    client.prepare = wrappedPrepareFn
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
