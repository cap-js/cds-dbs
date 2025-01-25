const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Bookshop - Upsert', () => {
  const { expect } = cds.test(bookshop)

  test('upsert data with "value" as column name', async () => {
    // in our UPSERT logic we used "value" as internal column
    // which led to an ambiguous column error if the entity has an element with the same name
    const { Values } = cds.entities
    const upsert = UPSERT({ ID: 201, value: 42 }).into(Values)
    const res = await upsert;
    expect(res).to.eql(1)
  })

})
