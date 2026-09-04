// Reproduction for: https://github.com/cap-js/cds-dbs/issues/1723
// CQN2PQLRenderer.from_args throws for parameterized views when DEBUG=pql is set.
//
// The bug: when DEBUG=pql, SQLService.cqn2sql is wrapped to first call cqn2pql for
// pretty-printing. cqn2pql uses CQN2PQLRenderer which extends CQN2SQL but does not
// override from_args. The base-class from_args throws:
//   "Parameterized views are not supported by CQN2PQLRenderer"

const CQN2PQLRenderer = require('../lib/cqn2pql')
const { expect } = require('@sap/cds').test

describe('CQN2PQLRenderer - parameterized views (issue #1723)', () => {
  // CQN that cqn4sql produces for: SELECT from ParamBooks(available: {val:100}) { ID, title }
  const cqn = {
    SELECT: {
      from: {
        ref: [
          {
            id: 'sap.capire.bookshop.ParamBooks',
            args: { available: { val: 100 } },
          },
        ],
      },
      columns: [
        { ref: ['ID'] },
        { ref: ['title'] },
      ],
    },
  }

  test('render() should not throw for parameterized views', () => {
    const renderer = new CQN2PQLRenderer({ model: undefined })
    // Before the fix this throws:
    //   Error: Parameterized views are not supported by CQN2PQLRenderer
    expect(() => renderer.render(cqn)).to.not.throw()
  })

  test('rendered SQL contains the entity name', () => {
    const renderer = new CQN2PQLRenderer({ model: undefined })
    const result = renderer.render(cqn)
    expect(result.sql).to.include('ParamBooks')
  })
})
