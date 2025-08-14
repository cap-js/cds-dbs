'use strict'

const { loadModel } = require('../helpers/model')
const cds = require('@sap/cds')
const { expect } = cds.test
require('../helpers/test.setup')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(a2j) target key detection', () => {
  before(async () => {
    const model = await loadModel([__dirname + '/../model/index'])
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, model)
  })

  describe('simple', () => {
    it('key from target if there is a join relevant leaf for shared prefix', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from Pupils as Pupils
        {
          ID
        }
        group by classrooms.classroom.ID, classrooms.classroom.name`)
      // REVISIT: could `classroom.ID` also be `classrooms.classroom_ID`?
      const expected = cds.ql`
        SELECT from Pupils as Pupils
          left join ClassroomsPupils as classrooms
            on classrooms.pupil_ID = Pupils.ID
          left join Classrooms as classroom
            on classroom.ID = classrooms.classroom_ID
        {
          Pupils.ID
        }
        group by classroom.ID, classroom.name`
      expect(transformed).to.equalCqn(expected)
    })

    it('key from target if there is a join relevant leaf for shared prefix (structured)', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from Pupils as Pupils
        {
          ID
        }
        group by classrooms.classroom.ID, classrooms.classroom.info.capacity`)
      const expected = cds.ql`
        SELECT from Pupils as Pupils
          left join ClassroomsPupils as classrooms
            on classrooms.pupil_ID = Pupils.ID
          left join Classrooms as classroom
            on classroom.ID = classrooms.classroom_ID
        {
          Pupils.ID
        }
        group by classroom.ID, classroom.info_capacity`
      expect(transformed).to.equalCqn(expected)
    })

    it('round trip leads to join', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from S.Source {
          toMid.toTarget.toSource.sourceID as fullForeignKey,
          toMid.toTarget.toSource.toMid.toTarget.toSource.sourceID as foreignKeyAfterRoundTrip
        }`)

      const expected = cds.ql`
        SELECT from S.Source as $S
          left join S.Mid as toMid
          on toMid.toTarget_toSource_sourceID = $S.toMid_toTarget_toSource_sourceID
          left join S.Target as toTarget
          on toTarget.toSource_sourceID = toMid.toTarget_toSource_sourceID
          left join S.Source as toSource
          on toSource.sourceID = toTarget.toSource_sourceID
        {
          $S.toMid_toTarget_toSource_sourceID as fullForeignKey,
          toSource.toMid_toTarget_toSource_sourceID as foreignKeyAfterRoundTrip
        }`

      expect(transformed).to.deep.equal(expected)
    })
  })

  describe('with filter', () => {
    it('fk access invalidated', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from ClassroomsPupils as ClassroomsPupils
        {
          pupil[ID = 5].ID as student
        }`)
      const expected = cds.ql`
        SELECT from ClassroomsPupils as ClassroomsPupils
          left join Pupils as pupil
            on pupil.ID = ClassroomsPupils.pupil_ID
            and pupil.ID = 5
        {
          pupil.ID as student
        }`
      expect(transformed).to.equalCqn(expected)
    })
    it('optimized next to non-optimized', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from ClassroomsPupils as ClassroomsPupils
        {
          pupil[ID = 5].ID as nonOptimized,
          pupil.ID as optimized
        }`)
      const expected = cds.ql`
        SELECT from ClassroomsPupils as ClassroomsPupils
          left join Pupils as pupil
            on pupil.ID = ClassroomsPupils.pupil_ID
            and pupil.ID = 5
        {
          pupil.ID as nonOptimized,
          ClassroomsPupils.pupil_ID as optimized
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('Shared prefixes with associations as foreign keys', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from S.Source {
          toMid.toTarget.toSource.sourceID as fullForeignKey,
          toMid[1=1].toTarget.toSource.sourceID as foreignKeyAfterToMid,
          toMid[1=1].toTarget[1=1].toSource.sourceID as foreignKeyAfterToTarget,
          toMid[1=1].toTarget[1=1].toSource[1=1].sourceID as targetsKeyAfterToSource
        }`)
      const expected = cds.ql`
        SELECT from S.Source as $S
          left join S.Mid as toMid
            on toMid.toTarget_toSource_sourceID = $S.toMid_toTarget_toSource_sourceID and 1 = 1
          left join S.Target as toTarget2
            on toTarget2.toSource_sourceID = toMid.toTarget_toSource_sourceID and 1 = 1
          left join S.Source as toSource3
            on toSource3.sourceID = toTarget2.toSource_sourceID and 1 = 1
        {
          $S.toMid_toTarget_toSource_sourceID as fullForeignKey,
          toMid.toTarget_toSource_sourceID as foreignKeyAfterToMid,
          toTarget2.toSource_sourceID as foreignKeyAfterToTarget,
          toSource3.sourceID as targetsKeyAfterToSource
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('partially shared prefixes', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from S.Source {
          toMid.toTarget.toSource.sourceID as fullForeignKey,
          toMid[1=1].toTarget.toSource.sourceID as foreignKeyAfterToMid,
          toMid.toTarget[1=1].toSource.sourceID as foreignKeyAfterToTarget,
          toMid.toTarget.toSource[1=1].sourceID as targetsKeyAfterToSource
        }`)

      // `foreignKeyAfterToTarget` and `targetsKeyAfterToSource` share the join node `toMid2` to `$S`
      const expected = cds.ql`
        SELECT from S.Source as $S
          left join S.Mid as toMid
            on toMid.toTarget_toSource_sourceID = $S.toMid_toTarget_toSource_sourceID and 1 = 1

          left join S.Mid as toMid2
            on toMid2.toTarget_toSource_sourceID = $S.toMid_toTarget_toSource_sourceID
          left join S.Target as toTarget2
            on toTarget2.toSource_sourceID = toMid2.toTarget_toSource_sourceID and 1 = 1

          left join S.Target as toTarget3
            on toTarget3.toSource_sourceID = toMid2.toTarget_toSource_sourceID
          left join S.Source as toSource3
            on toSource3.sourceID = toTarget3.toSource_sourceID and 1 = 1
        {
          $S.toMid_toTarget_toSource_sourceID as fullForeignKey,
          toMid.toTarget_toSource_sourceID as foreignKeyAfterToMid,
          toTarget2.toSource_sourceID as foreignKeyAfterToTarget,
          toSource3.sourceID as targetsKeyAfterToSource
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('Own join nodes with roundtrip', () => {
      // TODO: toMid.toTarget.toSource[1=1].toMid.toTarget.toSource.sourceID as third
      const transformed = cqn4sql(cds.ql`
        SELECT from S.Source {
          toMid[1 = 1].toTarget.toSource.toMid.toTarget.toSource.sourceID as first,
          toMid.toTarget[1=1].toSource.toMid.toTarget.toSource.sourceID as second
        }`)

      const expected = cds.ql`
        SELECT from S.Source as $S
          left join S.Mid as toMid
          on toMid.toTarget_toSource_sourceID = $S.toMid_toTarget_toSource_sourceID and 1 = 1
          left join S.Target as toTarget
          on toTarget.toSource_sourceID = toMid.toTarget_toSource_sourceID
          left join S.Source as toSource
          on toSource.sourceID = toTarget.toSource_sourceID

          left join S.Mid as toMid3
          on toMid3.toTarget_toSource_sourceID = $S.toMid_toTarget_toSource_sourceID
          left join S.Target as toTarget3
          on toTarget3.toSource_sourceID = toMid3.toTarget_toSource_sourceID and 1 = 1
          left join S.Source as toSource3
          on toSource3.sourceID = toTarget3.toSource_sourceID
        {
          toSource.toMid_toTarget_toSource_sourceID as first,
          toSource3.toMid_toTarget_toSource_sourceID as second
        }`

      expect(transformed).to.deep.equal(expected)
    })

    it('Shared base joins with round-trips', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from S.Source {
          toMid.toTarget.toSource.sourceID as fullForeignKey,
          toMid.toTarget.toSource.toMid[1=1].toTarget.toSource.sourceID as foreignKeyAfterToMid,
          toMid.toTarget.toSource.toMid.toTarget[1=1].toSource.sourceID as foreignKeyAfterToTarget,
          toMid.toTarget.toSource.toMid.toTarget.toSource[1=1].sourceID as targetsKeyAfterToSource
        }`)

      // everything up to `toSource` can be used by all columns
      // own join for `toMid` in column `foreignKeyAfterToTarget` (join `toMid3` is re-used by `targetsKeyAfterToSource`)
      // own join for `toTarget` in column `targetsKeyAfterToSource` (without the filter)

      const expected = cds.ql`
        SELECT from S.Source as $S
          left join S.Mid as toMid
            on toMid.toTarget_toSource_sourceID = $S.toMid_toTarget_toSource_sourceID
          left join S.Target as toTarget
            on toTarget.toSource_sourceID = toMid.toTarget_toSource_sourceID
          left join S.Source as toSource
            on toSource.sourceID = toTarget.toSource_sourceID
          left join S.Mid as toMid2
            on toMid2.toTarget_toSource_sourceID = toSource.toMid_toTarget_toSource_sourceID and 1 = 1

          left join S.Mid as toMid3
            on toMid3.toTarget_toSource_sourceID = toSource.toMid_toTarget_toSource_sourceID
          left join S.Target as toTarget3
            on toTarget3.toSource_sourceID = toMid3.toTarget_toSource_sourceID and 1 = 1

          left join S.Target as toTarget4
            on toTarget4.toSource_sourceID = toMid3.toTarget_toSource_sourceID
          left join S.Source as toSource4
            on toSource4.sourceID = toTarget4.toSource_sourceID and 1 = 1
        {
          $S.toMid_toTarget_toSource_sourceID as fullForeignKey,
          toMid2.toTarget_toSource_sourceID as foreignKeyAfterToMid,
          toTarget3.toSource_sourceID as foreignKeyAfterToTarget,
          toSource4.sourceID as targetsKeyAfterToSource
        }`
      expect(transformed).to.deep.equal(expected)
    })
  })
})
