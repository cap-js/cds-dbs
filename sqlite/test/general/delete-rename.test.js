const cds = require('../../../test/cds.js')

const { POST, DELETE } = cds.test(__dirname, 'testModel.cds')

describe('delete on rename', () => {
  test('delete on projection with renamed elements', async () => {
    let res
    res = await POST('/rename/SProjDeep', {
      IDRename: 1,
      parentRename: 1,
      otherNameRename: 'some name',
      otherName2Rename: 'some name2',
      childrenRename: [
        { IDRename: 1, otherNameRename: 'children name', otherName2Rename: 'children name 1' },
        { IDRename: 2, otherNameRename: 'children name', otherName2Rename: 'children name 2' },
      ],
    })
    expect(res).toMatchObject({ status: 201 })

    // make sure the resulting query is resolved all the way to the database table
    res = await DELETE('/rename/SProjDeep(1)/childrenRename(1)')

    expect(res).toMatchObject({ status: 204 })
  })
})
