'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(a2j) backlinks', () => {
  before(async () => {
    const model = await loadModel()
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
      expectCqn(transformed).to.equal(expected)
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
      expectCqn(transformed).to.equal(expected)
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
      expectCqn(transformed).to.equal(expected)
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
      expectCqn(transformed).to.equal(expected)
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
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('on-condition flattening', () => {
    it('$user.id as special ref', () => {
      // compiler generates '$user.id' // cqn4sql generates `ref: ['$user', 'id']`
      const transformed = cqn4sql(cds.ql`
        SELECT from a2j.F as F
        {
          toE.data
        }`)

      const expected = cds.ql`
        SELECT from a2j.F as F
          left outer join a2j.E as toE on (toE.toF_id = F.id)
            and toE.id = $user.id
        {
          toE.data as toE_data
        }`
      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('key renaming', () => {
    it('backlink has assoc as key with renaming on multiple levels', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.AssocMaze2 as AM {
          a,
          a_assocYA_back.ID as x
        }`)
      const expected = cds.ql`
        SELECT from bookshop.AssocMaze2 as AM
          left outer join bookshop.AssocMaze1 as a_assocYA_back
            on a_assocYA_back.a_assocYA_B_1_a    = AM.A_1_a
              and a_assocYA_back.a_assocYA_B_1_b_ID = AM.A_1_b_ID
              and a_assocYA_back.a_assocYA_B_2_a    = AM.A_2_a
              and a_assocYA_back.a_assocYA_B_2_b_ID = AM.A_2_b_ID
        {
          AM.a,
          a_assocYA_back.ID as x
        }`
      expectCqn(transformed).to.equal(expected)
    })
  })
})
