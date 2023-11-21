module.exports = srv => {
  const { fooTemporal } = srv.entities

  srv.on('CREATE', fooTemporal, async function (req) {
    // without the fix, this UPSERT throws
    await UPSERT(req.data).into(fooTemporal)
    return req.data
  })
}
