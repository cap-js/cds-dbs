const cds = require('../../test/cds')

describe('search', () => {
  cds.test(__dirname, 'recurse.cds')

  test('debug', async () => {
    const { GenresTree } = cds.entities('Test')

    const cqn = {
      SELECT: {
        columns: [
          '*',
          { ref: ['children'], expand: ['*'] },
        ],
        from: { ref: [GenresTree.name] },
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