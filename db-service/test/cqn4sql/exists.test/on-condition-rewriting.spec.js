'use strict'

const cds = require('@sap/cds')
const { loadModel } = require('../helpers/model')
const { expectCqn } = require('../helpers/expectCqn')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(exist predicate) on-condition construction for semi-join in subquery', () => {
  before(async () => {
    const m = await loadModel()
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, m)
  })

  describe('unmanaged', () => {
    it('assoc navigation in on-condition', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.TestPublisher:texts
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.TestPublisher.texts as $t
        {
          $t.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.TestPublisher as $T2
          WHERE $t.publisher_structuredKey_ID = $T2.publisher_structuredKey_ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    // TODO: infix filter with association with structured foreign key
    it.skip('assoc navigation in on-condition renamed', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.TestPublisher:textsRenamedPublisher
        {
          ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.TestPublisher.texts as textsRenamedPublisher
        {
          textsRenamedPublisher.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.TestPublisher as $T2
          WHERE textsRenamedPublisher.publisherRenamedKey_notID = $T2.publisherRenamedKey_notID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('$self in both sides of on-condition', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books:coAuthorUnmanaged
        {
          name
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Authors as $c
        {
          $c.name
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
          WHERE $c.ID = $B.coAuthor_ID_unmanaged
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('association-like calculated element', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Authors:booksWithALotInStock as booksWithALotInStock
        {
          booksWithALotInStock.ID
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books as booksWithALotInStock
        {
          booksWithALotInStock.ID
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Authors as $A
          WHERE ($A.ID = booksWithALotInStock.author_ID) and (booksWithALotInStock.stock > 100)
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('`texts` composition', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Books:texts
        {
          locale
        }`)

      const expected = cds.ql`
        SELECT from bookshop.Books.texts as $t
        {
          $t.locale
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.Books as $B
          WHERE $t.ID = $B.ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('comparing managed assocs in on-condition', () => {
      const query = cqn4sql(cds.ql`SELECT from a2j.Foo as Foo { ID } WHERE EXISTS buz`)
      const expected = cds.ql`
        SELECT from a2j.Foo as Foo
        {
          Foo.ID
        }
        WHERE EXISTS (
          SELECT 1 from a2j.Buz as $b
          WHERE ($b.bar_ID = Foo.bar_ID and $b.bar_foo_ID = Foo.bar_foo_ID) and $b.foo_ID = Foo.ID
        )`
      expectCqn(query).to.equal(expected)
    })

    it('comparing managed assocs with renamed keys', () => {
      const query = cqn4sql(cds.ql`SELECT from a2j.Foo as Foo { ID } WHERE EXISTS buzRenamed`)
      const expected = cds.ql`
        SELECT from a2j.Foo as Foo
        {
          Foo.ID
        }
        WHERE EXISTS (
          SELECT 1 from a2j.Buz as $b
          WHERE ($b.barRenamed_renameID = Foo.barRenamed_renameID and $b.barRenamed_foo_ID = Foo.barRenamed_foo_ID) and $b.foo_ID = Foo.ID
        )`
      expectCqn(query).to.equal(expected)
    })

    it('on-condition has xpr', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.WorklistItems[ID = 1 and snapshotHash = 0]:releaseChecks[ID = 1 and snapshotHash = 0].detailsDeviations`)

      const expected = cds.ql`
        SELECT from bookshop.QualityDeviations as $d
        {
          $d.snapshotHash,
          $d.ID,
          $d.batch_ID,
          $d.material_ID,
        } WHERE EXISTS (
          SELECT 1 from bookshop.WorklistItem_ReleaseChecks as $r
          WHERE $d.material_ID = $r.parent_releaseDecisionTrigger_batch_material_ID
            and ( $d.batch_ID = '*' or $d.batch_ID = $r.parent_releaseDecisionTrigger_batch_ID )
            and $d.snapshotHash = $r.snapshotHash
            and $r.ID = 1 and $r.snapshotHash = 0
            and EXISTS (
              SELECT 1 from bookshop.WorklistItems as $W
              WHERE $r.parent_ID = $W.ID
                and $r.parent_snapshotHash = $W.snapshotHash
                and $W.ID = 1 and $W.snapshotHash = 0
            )
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('on-condition has xpr and leaf at filter', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.WorklistItems[ID = 1 and snapshotHash = 0]
        :releaseChecks[ID = 1 and snapshotHash = 0]
        .detailsDeviations[ID='0' and snapshotHash='0' and batch_ID='*' and material_ID='1']`)

      const expected = cds.ql`
        SELECT from bookshop.QualityDeviations as $d
        {
          $d.snapshotHash,
          $d.ID,
          $d.batch_ID,
          $d.material_ID,
        } WHERE EXISTS (
          SELECT 1 from bookshop.WorklistItem_ReleaseChecks as $r
          WHERE $d.material_ID = $r.parent_releaseDecisionTrigger_batch_material_ID
            and ( $d.batch_ID = '*' or $d.batch_ID = $r.parent_releaseDecisionTrigger_batch_ID )
            and $d.snapshotHash = $r.snapshotHash
            and $r.ID = 1 and $r.snapshotHash = 0
            and EXISTS (
              SELECT 1 from bookshop.WorklistItems as $W
              WHERE $r.parent_ID = $W.ID
                and $r.parent_snapshotHash = $W.snapshotHash
                and $W.ID = 1 and $W.snapshotHash = 0
            )
        )
        and (
          $d.ID = '0'
          and $d.snapshotHash = '0'
          and $d.batch_ID = '*'
          and $d.material_ID = '1'
        )`

      expectCqn(transformed).to.equal(expected)
    })
  })

  describe('managed', () => {
    it('with structured FK', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.AssocMaze1:a_struc as a_struc
        {
          val
        }`)

      const expected = cds.ql`
        SELECT from bookshop.AssocMaze2 as a_struc
        {
          a_struc.val
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.AssocMaze1 as $A
          WHERE $A.a_struc_ID_1_a = a_struc.ID_1_a and $A.a_struc_ID_1_b = a_struc.ID_1_b
            and $A.a_struc_ID_2_a = a_struc.ID_2_a and $A.a_struc_ID_2_b = a_struc.ID_2_b
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('with simple explicit FKs', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.AssocMaze1:a_strucX as a_strucX
        {
          val
        }`)

      const expected = cds.ql`
        SELECT from bookshop.AssocMaze2 as a_strucX
        {
          a_strucX.val
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.AssocMaze1 as $A
          WHERE $A.a_strucX_a = a_strucX.a and $A.a_strucX_b = a_strucX.b
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('with explicit structured FKs', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.AssocMaze1:a_strucY as a_strucY
        {
          val
        }`)

      const expected = cds.ql`
        SELECT from bookshop.AssocMaze2 as a_strucY
        {
          a_strucY.val
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.AssocMaze1 as $A
          WHERE $A.a_strucY_S_1_a = a_strucY.S_1_a and $A.a_strucY_S_1_b = a_strucY.S_1_b
            and $A.a_strucY_S_2_a = a_strucY.S_2_a and $A.a_strucY_S_2_b = a_strucY.S_2_b
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('with explicit structured renamed FKs', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.AssocMaze1:a_strucXA as a_strucXA
        {
          val
        }`)

      const expected = cds.ql`
        SELECT from bookshop.AssocMaze2 as a_strucXA
        {
          a_strucXA.val
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.AssocMaze1 as $A
          WHERE $A.a_strucXA_T_1_a = a_strucXA.S_1_a and $A.a_strucXA_T_1_b = a_strucXA.S_1_b
            and $A.a_strucXA_T_2_a = a_strucXA.S_2_a and $A.a_strucXA_T_2_b = a_strucXA.S_2_b
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('with explicit FKs being managed associations', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.AssocMaze1:a_assocY as a_assocY
        {
          val
        }`)

      const expected = cds.ql`
        SELECT from bookshop.AssocMaze2 as a_assocY
        {
          a_assocY.val
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.AssocMaze1 as $A
          WHERE $A.a_assocY_A_1_a = a_assocY.A_1_a and $A.a_assocY_A_1_b_ID = a_assocY.A_1_b_ID
            and $A.a_assocY_A_2_a = a_assocY.A_2_a and $A.a_assocY_A_2_b_ID = a_assocY.A_2_b_ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('with explicit FKs being managed associations (base renamed)', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.AssocMaze1:a_assocYA as a_assocYA
        {
          val
        }`)

      const expected = cds.ql`
        SELECT from bookshop.AssocMaze2 as a_assocYA
        {
          a_assocYA.val
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.AssocMaze1 as $A
          WHERE $A.a_assocYA_B_1_a = a_assocYA.A_1_a and $A.a_assocYA_B_1_b_ID = a_assocYA.A_1_b_ID
            and $A.a_assocYA_B_2_a = a_assocYA.A_2_a and $A.a_assocYA_B_2_b_ID = a_assocYA.A_2_b_ID
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('with FKs being mix of structures and managed assoc', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.AssocMaze1:a_strass as a_strass
        {
          val
        }`)

      const expected = cds.ql`
        SELECT from bookshop.AssocMaze4 as a_strass
        {
          a_strass.val
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.AssocMaze1 as $A
          WHERE $A.a_strass_A_1_a = a_strass.A_1_a
            and $A.a_strass_A_1_b_assoc1_ID_1_a = a_strass.A_1_b_assoc1_ID_1_a and $A.a_strass_A_1_b_assoc1_ID_1_b = a_strass.A_1_b_assoc1_ID_1_b
            and $A.a_strass_A_1_b_assoc1_ID_2_a = a_strass.A_1_b_assoc1_ID_2_a and $A.a_strass_A_1_b_assoc1_ID_2_b = a_strass.A_1_b_assoc1_ID_2_b
            and $A.a_strass_A_1_b_assoc2_ID_1_a = a_strass.A_1_b_assoc2_ID_1_a and $A.a_strass_A_1_b_assoc2_ID_1_b = a_strass.A_1_b_assoc2_ID_1_b
            and $A.a_strass_A_1_b_assoc2_ID_2_a = a_strass.A_1_b_assoc2_ID_2_a and $A.a_strass_A_1_b_assoc2_ID_2_b = a_strass.A_1_b_assoc2_ID_2_b
            and $A.a_strass_A_2_a = a_strass.A_2_a
            and $A.a_strass_A_2_b_assoc1_ID_1_a = a_strass.A_2_b_assoc1_ID_1_a and $A.a_strass_A_2_b_assoc1_ID_1_b = a_strass.A_2_b_assoc1_ID_1_b
            and $A.a_strass_A_2_b_assoc1_ID_2_a = a_strass.A_2_b_assoc1_ID_2_a and $A.a_strass_A_2_b_assoc1_ID_2_b = a_strass.A_2_b_assoc1_ID_2_b
            and $A.a_strass_A_2_b_assoc2_ID_1_a = a_strass.A_2_b_assoc2_ID_1_a and $A.a_strass_A_2_b_assoc2_ID_1_b = a_strass.A_2_b_assoc2_ID_1_b
            and $A.a_strass_A_2_b_assoc2_ID_2_a = a_strass.A_2_b_assoc2_ID_2_a and $A.a_strass_A_2_b_assoc2_ID_2_b = a_strass.A_2_b_assoc2_ID_2_b
        )`

      expectCqn(transformed).to.equal(expected)
    })

    it('with FKs being managed associations', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.AssocMaze1:a_assoc as a_assoc
        {
          val
        }`)

      const expected = cds.ql`
        SELECT from bookshop.AssocMaze3 as a_assoc
        {
          a_assoc.val
        }
        WHERE EXISTS (
          SELECT 1 from bookshop.AssocMaze1 as $A
          WHERE $A.a_assoc_assoc1_ID_1_a = a_assoc.assoc1_ID_1_a and $A.a_assoc_assoc1_ID_1_b = a_assoc.assoc1_ID_1_b
            and $A.a_assoc_assoc1_ID_2_a = a_assoc.assoc1_ID_2_a and $A.a_assoc_assoc1_ID_2_b = a_assoc.assoc1_ID_2_b
            and $A.a_assoc_assoc2_ID_1_a = a_assoc.assoc2_ID_1_a and $A.a_assoc_assoc2_ID_1_b = a_assoc.assoc2_ID_1_b
            and $A.a_assoc_assoc2_ID_2_a = a_assoc.assoc2_ID_2_a and $A.a_assoc_assoc2_ID_2_b = a_assoc.assoc2_ID_2_b
        )`

      expectCqn(transformed).to.equal(expected)
    })
  })
})
