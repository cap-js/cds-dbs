const cds = require('../_runtime/cds')
const LOG = cds.log('persistent-queue|queue|persistent-outbox|outbox')

const { inspect } = require('util')

const TaskRunner = require('./TaskRunner')
const taskRunner = new TaskRunner()

const waitingTime = require('../_runtime/common/utils/waitingTime')

const cdsUser = 'cds.internal.user'
const $taskProcessorRegistered = Symbol('task processor registered')
const $queued = Symbol('queued')
const $unqueued = Symbol('unqueued')
const $stored_reqs = Symbol('stored_reqs')
const $error = Symbol('error')

const _get100NanosecondTimestampISOString = (offset = 0) => {
  const [now, nanoseconds] = [new Date(Date.now() + offset), process.hrtime()[1]]
  return now.toISOString().replace('Z', `${nanoseconds}`.padStart(9, '0').substring(3, 7) + 'Z')
}

const _getTasksEntity = () => {
  const tasksDbName = 'cds.outbox.Messages'
  const tasksEntity = cds.model.definitions[tasksDbName]
  if (!tasksEntity) throw new Error(`The entity '${tasksDbName}' is missing but needed for persistent tasks.`)
  return tasksEntity
}

// REVISIT: Is this always a reliable way to identify the provider tenant?
//          Are there scenarios where the credentials have a different format?
const _isProviderTenant = tenant =>
  (cds.requires.auth && cds.requires.auth.credentials && cds.requires.auth.credentials.identityzoneid === tenant) ||
  cds.requires.multitenancy.t0 === tenant

const hasPersistentQueue = tenant => {
  if (
    (!cds.requires.queue || cds.requires.queue.kind !== 'persistent-queue') &&
    (!cds.requires.outbox || cds.requires.outbox.kind !== 'persistent-outbox')
  )
    return false
  if (cds.requires.multitenancy && tenant && _isProviderTenant(tenant)) return false // no persistence for provider account
  return true
}

const _safeJSONParse = string => {
  try {
    return string && JSON.parse(string)
  } catch {
    // Don't throw
  }
}

// Note: This function can also run for each tenant on startup
const processTasks = (service, tenant, _opts = {}) => {
  const opts = Object.assign({ attempt: 0 }, _opts)
  if (!opts.parallel) opts.chunkSize = 1

  const name = service.name
  const tasksEntity = _getTasksEntity()

  return taskRunner.run({ name, tenant }, () => {
    let letAppCrash = false
    const config = tenant ? { tenant, user: cds.User.privileged } : { user: cds.User.privileged }
    config.after = 1 // make sure spawn puts its cb on the `timer` queue (via setTimeout), which is also used by `taskRunner`
    const spawn = cds.spawn(async () => {
      let tasks
      try {
        const tasksQuery = SELECT.from(tasksEntity)
          .where({ target: name })
          .orderBy(['timestamp', 'ID'])
          .limit(opts.chunkSize)
          .forUpdate()
        if (opts.maxAttempts) tasksQuery.where({ attempts: { '<': opts.maxAttempts } })
        if (opts.parallel) tasksQuery.SELECT.forUpdate.ignoreLocked = true
        LOG._debug && LOG.debug(`${name}: Searching for tasks`)
        tasks = await tasksQuery
      } catch (e) {
        // could potentially be a timeout
        const _waitingTime = waitingTime(opts.attempt)
        LOG.error(`${name}: Task retrieval failed`, e, `Retrying in ${Math.round(_waitingTime / 1000)} s`)
        taskRunner.schedule(
          {
            name,
            tenant,
            waitingTime: _waitingTime
          },
          () => processTasks(service, tenant, { ...opts, attempt: opts.attempt + 1 })
        )
        return
      }
      let waitingTimePlanned
      let currMaxAttempts = 0
      const currTime = Date.now()
      const tasksGen = function* () {
        for (const task of tasks) {
          const _msg = _safeJSONParse(task.msg)
          const taskTimestamp = new Date(task.timestamp).getTime()
          const _waitingTimePlanned = taskTimestamp - currTime
          if (_waitingTimePlanned > 0) {
            waitingTimePlanned = _waitingTimePlanned
            return
          }
          const context = _msg.context
          const userId = _msg[cdsUser]
          const msg = _msg._fromSend ? new cds.Request(_msg) : new cds.Event(_msg)
          delete msg._fromSend
          delete msg[cdsUser]
          currMaxAttempts = Math.max(task.attempts || 0, currMaxAttempts)
          const user = new cds.User.Privileged(userId)
          context.user = user
          if (!msg) continue
          const res = {
            ID: task.ID,
            msg,
            context
          }
          yield res
        }
      }

      const toBeDeleted = []
      const toBeUpdated = []
      const toBeCreated = []
      try {
        const _handleWithErr = async task => {
          try {
            // Problem: If task involves db, dedicated transactions will block on SQLite
            const _run =
              opts.sharedTransaction || cds.db?.kind === 'sqlite'
                ? cds._context.run.bind(cds._context)
                : service.tx.bind(service)
            const result = await _run({ ...task.context, tenant }, async () => {
              return opts.handle ? await opts.handle.call(service, task.msg) : await service.handle(task.msg)
            })
            task.results = result
            toBeDeleted.push(task)
          } catch (e) {
            task[$error] = e
            if (cds.error.isSystemError(e)) {
              LOG.error(`${service.name}: Programming error detected:`, e)
              task.updateData = { attempts: opts.maxAttempts }
              toBeUpdated.push(task)
              throw new Error(`${service.name}: Programming error detected.`)
            }
            if (e.unrecoverable) {
              LOG.error(`${service.name}: Unrecoverable error:`, e)
              if (opts.maxAttempts) {
                task.updateData = { attempts: opts.maxAttempts }
                toBeUpdated.push(task)
              } else toBeDeleted.push(task)
            } else {
              LOG.error(`${service.name}: Emit failed:`, e)
              task.updateData = {}
              toBeUpdated.push(task)
              return false
            }
          }
        }
        const tasks = tasksGen()
        // REVISIT: Maybe we can also support handleMany and provide the iterator (for batch processing)
        if (opts.parallel) {
          const first = tasks.next()?.value // First try to see if task can be processed
          if (!(first && (await _handleWithErr(first)) === false)) {
            // No need to process the rest if the first emit failed
            const res = await Promise.allSettled([...tasks].map(_handleWithErr))
            const errors = res.filter(r => r.status === 'rejected').map(r => r.reason)
            if (errors.length) {
              throw new Error(`${service.name}: Programming errors detected.`)
            }
          }
        } else {
          for (const task of tasks) {
            if ((await _handleWithErr(task)) === false) break
          }
        }
      } catch {
        letAppCrash = true
      }

      const queries = []
      const _waitingTime = waitingTime(currMaxAttempts)
      if (toBeDeleted.length)
        queries.push(
          DELETE.from(tasksEntity).where(
            'ID in',
            toBeDeleted.map(msg => msg.ID)
          )
        )
      if (toBeUpdated.length) {
        for (const u of toBeUpdated) {
          if (toBeDeleted.some(d => d.ID === u.ID)) continue
          const updateData = {
            attempts: { '+=': 1 }
          }
          if (opts.storeLastError !== false) updateData.lastError = inspect(u[$error])
          Object.assign(updateData, u.updateData)
          if (updateData.lastError && typeof updateData.lastError !== 'string')
            updateData.lastError = inspect(updateData.lastError)
          queries.push(UPDATE(tasksEntity).where({ ID: u.ID }).set(updateData))
        }
      }

      const _newMsgFrom = msg => {
        const _fromSend = msg instanceof cds.Request
        const newMsg = { ...msg }
        newMsg._fromSend = _fromSend
        if (!newMsg.queue) return newMsg
        if (!newMsg.queue.after && !newMsg.queue.every) return newMsg
        newMsg.queue = { ...newMsg.queue }
        delete newMsg.queue.every
        delete newMsg.queue.after
        return newMsg
      }

      const _failed = task => {
        const msg = _newMsgFrom(task.msg)
        msg.event = msg.event + '/#failed'
        const _errorToObj = error => {
          if (typeof error === 'string') return { message: error }
          return {
            name: error.name,
            message: error.message,
            stack: error.stack,
            code: error.code,
            ...error
          }
        }
        msg.results = _errorToObj(task[$error])
        if (service.handlers.on.some(h => h.for(msg)) || service.handlers.after.some(h => h.for(msg))) {
          toBeCreated.push(_createTask(service.name, msg, task.context, opts))
        }
      }

      const _succeeded = task => {
        const msg = _newMsgFrom(task.msg)
        msg.event = msg.event + '/#succeeded'
        if (service.handlers.on.some(h => h.for(msg)) || service.handlers.after.some(h => h.for(msg))) {
          toBeCreated.push(_createTask(service.name, msg, task.context, opts))
        }
      }

      for (const task of toBeDeleted) {
        // invoke succeeded handlers
        if (!task.msg.event.endsWith('/#succeeded') && !task.msg.event.endsWith('/#failed')) {
          if (!task.error) {
            // skip programming errors & unrecoverable without maxAttempts
            _succeeded(task)
          }
        }

        // handle `every`
        if (task.msg.queue?.every) {
          const _m = { ...task.msg }
          _m._fromSend = task.msg instanceof cds.Request
          const _task = _createTask(service.name, _m, task.context, opts)
          _task.timestamp = _get100NanosecondTimestampISOString(task.msg.queue.every)
          toBeCreated.push(_task)
        }
      }
      // invoke failed handlers (only if max attempts is reached)
      for (const task of toBeUpdated) {
        if (
          !task.msg.event.endsWith('/#succeeded') &&
          !task.msg.event.endsWith('/#failed') &&
          opts.maxAttempts &&
          task.updateData.attempts >= opts.maxAttempts
        ) {
          _failed(task)
        }
      }

      if (toBeCreated.length) queries.push(INSERT.into(tasksEntity).entries(toBeCreated))

      await Promise.all(queries)

      if (letAppCrash) return

      if (toBeUpdated.length) {
        LOG.error(`${name}: Some tasks could not be processed, retrying in ${Math.round(_waitingTime / 1000)} s`)
        return taskRunner.schedule(
          {
            name,
            tenant,
            waitingTime: _waitingTime
          },
          () => processTasks(service, tenant, opts)
        )
      }
      taskRunner.success({ name, tenant })
      if (toBeDeleted.length === opts.chunkSize || toBeCreated.length) {
        LOG._debug && LOG.debug(`${name}: Retrigger processing`)
        processTasks(service, tenant, opts) // We only processed max. opts.chunkSize, so there might be more
      } else {
        if (waitingTimePlanned) {
          LOG._debug && LOG.debug(`${name}: Planned processing in ${Math.round(waitingTimePlanned / 1000)} s`)
          return taskRunner.plan(
            {
              name,
              tenant,
              waitingTime: waitingTimePlanned
            },
            () => processTasks(service, tenant, opts)
          )
        }

        LOG._debug && LOG.debug(`${name}: All tasks processed`)
      }
    }, config)
    spawn.on('done', () => {
      if (letAppCrash) cds.exit(1)
      taskRunner.end({ name, tenant }, () => processTasks(service, tenant, opts))
    })
    return spawn
  })
}

const registerTaskProcessor = (name, context) => {
  const registry = context[$taskProcessorRegistered] || (context[$taskProcessorRegistered] = new Set())
  if (!registry.has(name)) {
    registry.add(name)
    return true
  }
  return false
}

const _createTask = (name, msg, context, taskOpts) => {
  const _msg = { [cdsUser]: context.user.id }
  const _newContext = {}
  for (const key in context) {
    if (!taskOpts.ignoredContext.includes(key)) _newContext[key] = context[key]
  }
  _msg.context = _newContext

  if (msg._fromSend || msg.reply) _msg._fromSend = true // send or emit?
  for (const prop of ['inbound', 'event', 'data', 'headers', 'queue', 'results']) {
    if (msg[prop]) _msg[prop] = msg[prop]
  }
  if (msg.query) {
    _msg.query = msg.query.flat()
    delete _msg.query._target
    delete _msg.query.__target
    delete _msg.query.target
  }
  const taskMsg = {
    ID: cds.utils.uuid(),
    target: name,
    timestamp: _get100NanosecondTimestampISOString(msg.queue?.after), // needs to be different for each emit
    msg: JSON.stringify(_msg)
  }
  return taskMsg
}

const writeInQueue = async (name, msg, context, taskOpts) => {
  const taskMsg = _createTask(name, msg, context, taskOpts)
  const tasksEntity = _getTasksEntity()
  return cds.tx(context).run(INSERT.into(tasksEntity).entries(taskMsg))
}

exports.unqueued = function unqueued(srv) {
  return srv[$unqueued] || srv
}

exports.queued = function queued(srv, customOpts) {
  // queue max. once
  if (!new.target) {
    const former = srv[$queued]
    if (former) return former
  }

  const originalSrv = srv[$unqueued] || srv
  const queuedSrv = Object.create(originalSrv)
  queuedSrv[$unqueued] = originalSrv

  if (!new.target) Object.defineProperty(srv, $queued, { value: queuedSrv })

  let requiresOpts = cds.requires.queue
  // compat for cds.requires.outbox
  if (requiresOpts && cds.requires.outbox !== undefined) {
    cds.utils.deprecated({ old: 'cds.requires.outbox', use: 'cds.requires.queue' })
    if (typeof cds.requires.outbox === 'object')
      requiresOpts = Object.assign({}, requiresOpts, cds.requires.outbox || {})
  }
  let serviceOpts = srv.options?.queued ?? srv.options?.outboxed ?? srv.options?.outbox

  if (typeof requiresOpts === 'string') requiresOpts = { kind: requiresOpts }
  if (typeof serviceOpts === 'string') serviceOpts = { kind: serviceOpts }

  const queueOpts = Object.assign(
    {},
    (typeof requiresOpts === 'object' && requiresOpts) || {},
    (typeof serviceOpts === 'object' && serviceOpts) || {},
    customOpts || {}
  )

  queuedSrv.handle = async function (req) {
    const context = req.context || cds.context
    if (
      (queueOpts.kind === 'persistent-queue' || queueOpts.kind === 'persistent-outbox') &&
      hasPersistentQueue(context.tenant)
    ) {
      // returns true if not yet registered
      if (registerTaskProcessor(srv.name, context)) {
        // NOTE: What if there are different queue options for the same service?!
        //       There could be tasks for srv1 with { maxAttempts: 1 }
        //       and tasks for srv1 with { maxAttempts: 9 }.
        //       How would they be processed? I'd rather not have dedicated
        //       service names or store serialized options for each task.
        context.on('succeeded', () => processTasks(originalSrv, context.tenant, queueOpts))
      }
      await writeInQueue(srv.name, req, context, queueOpts)
      return
    }

    if (!context[$stored_reqs]) {
      context[$stored_reqs] = []
      context.on('succeeded', async () => {
        // REVISIT: Also allow maxAttempts for in-memory queue?
        for (const _req of context[$stored_reqs]) {
          try {
            if (_req.reply) await originalSrv.send(_req)
            else await originalSrv.emit(_req)
          } catch (e) {
            LOG.error('Emit failed', { event: _req.event, cause: e })
            if (cds.error.isSystemError(e)) {
              await cds.shutdown(e)
              return
            }
          }
        }
        delete context[$stored_reqs]
      })
    }
    context[$stored_reqs].push(req)
  }

  queuedSrv.flush = function flush(tenant = cds.context?.tenant, opts) {
    return processTasks(originalSrv, tenant, Object.assign({}, queueOpts, opts))
  }

  return queuedSrv
}
