'use strict'

const { loadModel } = require('../helpers/model')
const cds = require('@sap/cds')
const { expect } = cds.test
require('../helpers/test.setup')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(a2j) backlinks', () => {
  before(async () => {
    const model = await loadModel([__dirname + '/../model/index'])
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, model)
  })

  describe('backlink is managed', () => {
    it('basic', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from a2j.Header as Header {
        toItem_selfMgd.id,
      }`)
      const expected = cds.ql`
        SELECT from a2j.Header as Header
          left outer join a2j.Item as toItem_selfMgd
            on toItem_selfMgd.toHeader_id = Header.id and toItem_selfMgd.toHeader_id2 = Header.id2
        {
          toItem_selfMgd.id as toItem_selfMgd_id
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('navigate along backlink assoc', () => {
      const transformed = cqn4sql(cds.ql`
      SELECT from a2j.Folder as Folder {
        nodeCompanyCode.assignments.data
      }`)
      const expected = cds.ql`
      SELECT from a2j.Folder as Folder
        left outer join a2j.Folder as nodeCompanyCode
          on nodeCompanyCode.id = Folder.nodeCompanyCode_id
        left outer join a2j.Assignment as assignments
          on assignments.toFolder_id = nodeCompanyCode.id
      {
        assignments.data as nodeCompanyCode_assignments_data
      }`
      expect(transformed).to.equalCqn(expected)
    })
  })

  describe('backlink is unmanaged', () => {
    it('self unmanaged', () => {
      const transformed = cqn4sql(cds.ql`
      SELECT from a2j.Header as Header {
        toItem_selfUmgd.id,
      }`)
      const expected = cds.ql`
      SELECT from a2j.Header as Header
        left outer join a2j.Item as toItem_selfUmgd
          on toItem_selfUmgd.elt2 = Header.elt
      {
        toItem_selfUmgd.id as toItem_selfUmgd_id
      }`
      expect(transformed).to.equalCqn(expected)
    })
  })

  describe('multiple backlinks', () => {
    it('one backlink is managed, the other unmanaged', () => {
      const transformed = cqn4sql(cds.ql`
      SELECT from a2j.Header as Header {
        toItem_combined.id,
      }`)
      const expected = cds.ql`
      SELECT from a2j.Header as Header
        left outer join a2j.Item as toItem_combined
          on (
            (toItem_combined.toHeader_id = Header.id and toItem_combined.toHeader_id2 = Header.id2)
            OR
            (toItem_combined.elt2 = Header.elt)
          ) and 5 != 4
      {
        toItem_combined.id as toItem_combined_id
      }`
      expect(transformed).to.equalCqn(expected)
    })

    it('different backlink paths used (managed/unmanaged/combined)', () => {
      const transformed = cqn4sql(cds.ql`
      SELECT from a2j.Header as Header {
        toItem_selfMgd.id as selfMgd_id,
        toItem_selfUmgd.id as selfUmgd_id,
        toItem_combined.id as combined_id,
        toItem_fwd.id as direct_id
      }`)
      const expected = cds.ql`
      SELECT from a2j.Header as Header
        left outer join a2j.Item as toItem_selfMgd
          on toItem_selfMgd.toHeader_id = Header.id and toItem_selfMgd.toHeader_id2 = Header.id2
        left outer join a2j.Item as toItem_selfUmgd
          on toItem_selfUmgd.elt2 = Header.elt
        left outer join a2j.Item as toItem_combined
          on (
            (toItem_combined.toHeader_id = Header.id and toItem_combined.toHeader_id2 = Header.id2)
            OR
            (toItem_combined.elt2 = Header.elt)
          ) and 5 != 4
        left outer join a2j.Item as toItem_fwd
          on Header.id = toItem_fwd.id
      {
        toItem_selfMgd.id as selfMgd_id,
        toItem_selfUmgd.id as selfUmgd_id,
        toItem_combined.id as combined_id,
        toItem_fwd.id as direct_id
      }`
      expect(transformed).to.equalCqn(expected)
    })
  })

  describe('on-condition flattening', () => {
    it('$user.id as special ref', () => {
      // compiler generates '$user.id' // cqn4sql generates `ref: ['$user', 'id']`
      let query = cqn4sql(
        cds.ql`select from a2j.F as F {
            toE.data
          }`,
      )

      const expected = cds.ql`select from a2j.F as F
          left outer join a2j.E as toE on (toE.toF_id = F.id) and
          toE.id = $user.id
          {
            toE.data as toE_data
          }
          `
      expect(query).to.deep.equal(expected)
    })
  })
})
