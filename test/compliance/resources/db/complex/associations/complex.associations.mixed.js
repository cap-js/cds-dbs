const cds = require('@sap/cds')

const msg = function (message) {
  return `# association # mixed # ${message}`
}

module.exports = [
  async function mixedExpand(ctx) {
    const parent = { ID: '00000000-0000-0000-0000-000000000000' }
    const child = { ID: '00000000-0000-0000-0000-000000000000', parent }
    await ctx.db.run(cds.ql.UPSERT(Object.assign({}, child)).into('complex.associations.mixed.child'))
    await ctx.db.run(cds.ql.UPSERT(Object.assign({}, parent)).into('complex.associations.mixed.parent'))
    const [children, parents] = await Promise.all([
      ctx.db.run(cds.ql.SELECT(['*']).from('complex.associations.mixed.child')),
      ctx.db.run(cds.ql.SELECT(['*', { ref: ['children'], expand: ['*'] }]).from('complex.associations.mixed.parent')),
    ])

    expect(children[0].parent_ID).toEqual(parent.ID, 'Inserting structured association does not resolve foreign keys')

    expect(parents[0]?.children?.length).toEqual(
      1,
      'Expand on unmanaged association with managed association as on condition does not select the correct data',
    )
  },
]
