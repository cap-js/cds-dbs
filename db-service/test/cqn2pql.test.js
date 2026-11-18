const cds = require('@sap/cds')
const CQN2PQLRenderer = require('../lib/cqn2pql')
const { expect } = cds.test

describe('CQN2PQLRenderer', () => {

  describe('basic rendering', () => {
    const q = cds.ql`SELECT ID, title from sap.capire.bookshop.Books where ID = 42`

    test('values are inlined, not bound parameters', () => {
      const { sql, values } = new CQN2PQLRenderer({ model: undefined }).render(q)
      expect(sql).to.include('42')
      expect(values).to.be.undefined
    })

    test('identifiers are not quoted', () => {
      const { sql } = new CQN2PQLRenderer({ model: undefined }).render(q)
      expect(sql).to.not.match(/[`"]/)
    })

    test('FROM and WHERE are on separate lines', () => {
      const { sql } = new CQN2PQLRenderer({ model: undefined }).render(q)
      expect(sql).to.include('\nFROM ')
      expect(sql).to.include('\nWHERE ')
    })
  })

  describe('parameterized views', () => {

    test('single arg is rendered inline in the FROM clause', () => {
      const q = cds.ql`SELECT ID, title from sap.capire.bookshop.ParamBooks(available: 100)`
      const { sql } = new CQN2PQLRenderer({ model: undefined }).render(q)
      expect(sql).to.include('ParamBooks(available: 100)')
    })

    test('multiple args are comma-separated', () => {
      const q = cds.ql`SELECT ID from sap.capire.bookshop.PBooks(P1: 1, P2: 2)`
      const { sql } = new CQN2PQLRenderer({ model: undefined }).render(q)
      expect(sql).to.include('PBooks(P1: 1, P2: 2)')
    })

  })

})
