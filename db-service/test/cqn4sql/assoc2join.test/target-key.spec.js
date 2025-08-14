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
  })
})
