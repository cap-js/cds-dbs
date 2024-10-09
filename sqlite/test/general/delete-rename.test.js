const cds = require('../../../test/cds.js')

describe('delete on rename', () => {
  const { POST, DELETE, expect } = cds.test(__dirname, 'testModel.cds')

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
    expect(res).to.containSubset({ status: 201 })

    // make sure the resulting query is resolved all the way to the database table
    res = await DELETE('/rename/SProjDeep(1)/childrenRename(1)')

    expect(res).to.containSubset({ status: 204 })
  })
})
