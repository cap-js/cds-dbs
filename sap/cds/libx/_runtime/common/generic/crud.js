const cds = require('../../cds')
const { SELECT } = cds.ql

const _targetEntityDoesNotExist = async req => {
  const exists = await cds.run(SELECT.from(req.subject, [1]))
  return exists.length === 0
}

module.exports = cds.service.impl(function () {
  // prettier-ignore
  this.on(['CREATE', 'READ', 'UPDATE', 'DELETE', 'UPSERT'], '*', async function handle_crud_requests(req) {

    if (!cds.db)
      return req.reject ('NO_DATABASE_CONNECTION') // REVISIT: error message

    if (!req.query)
      return req.reject (501, 'The request has no query and cannot be served generically.')

    if (typeof req.query !== 'string' && req.target?._hasPersistenceSkip)
      return req.reject (501, `Entity "${req.target.name}" is annotated with "@cds.persistence.skip" and cannot be served generically.`)

    // validate that all elements in path exist on db, if necessary
    // - INSERT has no where clause to do this in one roundtrip
    // - SELECT returns [] -> really empty collection or invalid path?
    const subject = req.query.INSERT?.into || req.query.SELECT?.from
    const pathExistsQuery = subject?.ref?.length > 1 && SELECT(1).from({ ref: subject.ref.slice(0,-1) })

    if (req.event === 'CREATE' && pathExistsQuery) {
      // REVISIT: Why dont't we just run the insert and check affected rows?
      const res = await pathExistsQuery
      if (res.length === 0) req.reject(404)
    }

    if (req.event in { DELETE: 1, UPDATE: 1 } && req.target?._isSingleton) {
      if (req.event === 'DELETE' && !req.target['@odata.singleton.nullable'])
        return req.reject (400, 'SINGLETON_NOT_NULLABLE')

      const selectSingleton = SELECT.one(req.target)
      const keyColumns = [...(req.target.keys||[])].filter(e => !e.isAssociation).map(e => e.name)

      // if no keys available, select all columns so we can delete the singleton with same content
      if (keyColumns.length) selectSingleton.columns(keyColumns)
      const singleton = await cds.run(selectSingleton)
      if (!singleton) req.reject(404)

      // REVISIT: Workaround for singleton, to get keys into singleton
      for (const keyName in singleton) {
        if (!keyColumns.includes(keyName)) continue
        req.data[keyName] = singleton[keyName]
      }

      req.query.where(singleton)
    }

    if (req.event === 'READ' && req.query?.SELECT && req.locale) req.query.SELECT.localized ??= true

    const result = await cds.run (req.query, req.data)

    if (req.event === 'READ') {
      // do not execute additional select to distinguish between 412 and 404
      if (result == null && req._etagValidationType === 'if-match') req.reject(412)

      if ((result == null || result.length === 0) && pathExistsQuery) {
        const res = await pathExistsQuery
        if (res.length === 0) req.reject(404)
      }

      return result
    }

    if (req.event === 'DELETE') {
      if (result === 0) req.reject(req._etagValidationType ? 412 : 404)
      return result
    }

    if (req.event === 'UPDATE' && result === 0) {
      if (req._etagValidationType) req.reject(412)
      if (await _targetEntityDoesNotExist(req)) req.reject(404) // REVISIT: add a reasonable error message
    }

    // flag to trigger read after write in legacy odata adapter
    if (req.constructor.name in { ODataRequest: 1 }) req._.readAfterWrite = true
    if (req.protocol?.match(/odata/)) req._.readAfterWrite = true //> REVISIT for noah

    return req.data
  })
})
