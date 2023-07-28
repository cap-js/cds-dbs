const cds = require('@sap/cds')

const msg = function (message) {
  return `# association # unmanaged # ${message}`
}

module.exports = [
  async function unmanagedExpand(ctx) {
    const children = { ID: '00000000-0000-0000-0000-000000000000', parent_ID: '00000000-0000-0000-0000-000000000000' }
    const parent = { ID: '00000000-0000-0000-0000-000000000000' }
    await ctx.db.run(cds.ql.UPSERT(Object.assign({}, children)).into('complex.associations.unmanaged.child'))
    await ctx.db.run(cds.ql.UPSERT(Object.assign({}, parent)).into('complex.associations.unmanaged.parent'))
    const result = await ctx.db.run(
      cds.ql.SELECT(['*', { ref: ['children'], expand: ['*'] }]).from('complex.associations.unmanaged.parent'),
    )

    expect(result[0]).toMatchObject(parent, msg('Expand on unmanaged association not properly resolved'))
  },
]
