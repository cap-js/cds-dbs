// Only runs as the child of simple-queries.test.js: features are read when the service is loaded
const cds = require('../../test/cds.js')

const project = require('path').resolve(__dirname, 'beershop')

const suite = process.env.SIMPLE_QUERIES_CHILD ? describe : describe.skip

suite('OData read with sql_simple_queries and ieee754compatible: false', () => {
  const { expect, GET } = cds.test('serve', '--project', project)

  test('-> Decimal is returned as number', async () => {
    expect(cds.env.features.sql_simple_queries).to.be.ok
    expect(cds.env.features.ieee754compatible).to.equal(false)
    const { data } = await GET('/beershop/Beers?$select=abv&$orderby=abv desc&$top=1')
    expect(data.value[0].abv).to.equal(5.9)
  })
})
