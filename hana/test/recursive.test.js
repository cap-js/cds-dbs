const cds = require('../../test/cds')

describe('search', () => {
  cds.test(__dirname + '/../../test/bookshop')

  test('debug', async () => {
    const cqn = {
      SELECT: {
        from: { ref: ['Genres'] },
        recurse: {
          ref: ['children'],
          where: [{ ref: ['DistanceFromRoot'] }, '<=', { val: 3 }]
        }
      }
    }

    const res = await cds.run(cqn)

    debugger
  })
})