const cds = require('@sap/cds')

const msg = function (message) {
  return `# association # managed # ${message}`
}

module.exports = [
  async function managedExpand(ctx) {
    const child = { ID: '00000000-0000-0000-0000-000000000000' }
    const parent = { ...child, child }
    await ctx.db.run(cds.ql.UPSERT(Object.assign({}, child)).into('complex.associations.managed.child'))
    await ctx.db.run(cds.ql.UPSERT(Object.assign({}, parent)).into('complex.associations.managed.parent'))

    const result = await ctx.db.run(
      cds.ql.SELECT(['*', { ref: ['child'], expand: ['*'] }]).from('complex.associations.managed.parent'),
    )

    expect(result[0]).toMatchObject(parent, msg('Inserting structured association does not resolve foreign keys'))
  },
]
