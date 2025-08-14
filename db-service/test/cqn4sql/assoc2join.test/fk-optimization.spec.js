'use strict'

const { loadModel } = require('../helpers/model')
const cds = require('@sap/cds')
const { expect } = cds.test
require('../helpers/test.setup')

let cqn4sql = require('../../../lib/cqn4sql')

describe('(a2j) fk detection', () => {
  before(async () => {
    const model = await loadModel([__dirname + '/../model/index'])
    const orig = cqn4sql // keep reference to original to avoid recursion
    cqn4sql = q => orig(q, model)
  })

  describe('simple', () => {
    it('follow managed assoc, select FK', () => {
      const query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { author.ID }`)
      const expected = cds.ql`
	  	SELECT from bookshop.Books as Books
		  {
		    Books.author_ID
		  }`
      expect(query).to.equalCqn(expected)
    })
    it('follow managed assoc, select FK and other field', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { author.ID, author.name }`)
      const expected = cds.ql`
        SELECT from bookshop.Books as Books
          left outer join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.author_ID,
          author.name as author_name
        }`
      expect(transformed).to.equalCqn(expected)
    })
    it('select managed assoc with structured foreign key', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.Intermediate as Intermediate
        {
          ID,
          toAssocWithStructuredKey.toStructuredKey
        }`)
      const expected = cds.ql`
        SELECT from bookshop.Intermediate as Intermediate
          left outer join bookshop.AssocWithStructuredKey as toAssocWithStructuredKey on toAssocWithStructuredKey.ID = Intermediate.toAssocWithStructuredKey_ID
        {
          Intermediate.ID,
          toAssocWithStructuredKey.toStructuredKey_struct_mid_leaf as toAssocWithStructuredKey_toStructuredKey_struct_mid_leaf,
          toAssocWithStructuredKey.toStructuredKey_struct_mid_anotherLeaf as toAssocWithStructuredKey_toStructuredKey_struct_mid_anotherLeaf,
          toAssocWithStructuredKey.toStructuredKey_second as toAssocWithStructuredKey_toStructuredKey_second
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('two assoc steps, last to foreign key', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from Classrooms as Classrooms
        {
          pupils.pupil.ID as studentCount
        }
        where Classrooms.ID = 1`)
      const expected = cds.ql`
        SELECT from Classrooms as Classrooms
          left join ClassroomsPupils as pupils
          on pupils.classroom_ID = Classrooms.ID
        {
          pupils.pupil_ID as studentCount
        }
        where Classrooms.ID = 1`
      expect(transformed).to.equalCqn(expected)
    })

    it('two step path ends in foreign key in aggregation clauses', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from Classrooms as Classrooms
        {
          pupils.pupil.ID as studentCount
        }
        where pupils.pupil.ID = 1
        group by pupils.pupil.ID
        having pupils.pupil.ID = 1
        order by pupils.pupil.ID`)
      const expected = cds.ql`
        SELECT from Classrooms as Classrooms
          left join ClassroomsPupils as pupils
          on pupils.classroom_ID = Classrooms.ID
        {
          pupils.pupil_ID as studentCount
        }
        where pupils.pupil_ID = 1
        group by pupils.pupil_ID
        having pupils.pupil_ID = 1
        order by pupils.pupil_ID`
      expect(transformed).to.equalCqn(expected)
    })

    it('two step path ends in foreign key in function arg', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from Classrooms as Classrooms
        {
          count(pupils.pupil.ID) as studentCount
        }
        where Classrooms.ID = 1`)
      const expected = cds.ql`
        SELECT from Classrooms as Classrooms
          left join ClassroomsPupils as pupils
          on pupils.classroom_ID = Classrooms.ID
        {
          count(pupils.pupil_ID) as studentCount
        }
        where Classrooms.ID = 1`
      expect(transformed).to.equalCqn(expected)
    })

    it('inline to foreign key', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from S.Source {
          toMid.toTarget.toSource.sourceID as foreignKey,
          toMid.{ toTarget.{ toSource.{ sourceID as inlineForeignKey } } },
        }`)

      const expected = cds.ql`
        SELECT from S.Source as $S {
          $S.toMid_toTarget_toSource_sourceID as foreignKey,
          $S.toMid_toTarget_toSource_sourceID as toMid_toTarget_toSource_inlineForeignKey
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('path ends on assoc which is fk', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from fkaccess.Books as Books
        {
          authorAddress.address as assocAsForeignKey
        }`)
      const expected = cds.ql`
        SELECT from fkaccess.Books as Books
        {
          Books.authorAddress_address_street as assocAsForeignKey_street,
          Books.authorAddress_address_number as assocAsForeignKey_number,
          Books.authorAddress_address_zip as assocAsForeignKey_zip,
          Books.authorAddress_address_city as assocAsForeignKey_city
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('path ends on assoc which is fk, prefix is structured', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from fkaccess.Books as Books
        {
          deeply.nested.authorAddress.address as deepAssocAsForeignKey
        }`)
      const expected = cds.ql`
        SELECT from fkaccess.Books as Books
        {
          Books.deeply_nested_authorAddress_address_street as deepAssocAsForeignKey_street,
          Books.deeply_nested_authorAddress_address_number as deepAssocAsForeignKey_number,
          Books.deeply_nested_authorAddress_address_zip as deepAssocAsForeignKey_zip,
          Books.deeply_nested_authorAddress_address_city as deepAssocAsForeignKey_city
        }`
      expect(transformed).to.equalCqn(expected)
    })
  })

  describe('prefix is join relevant', () => {
    it('follow managed assoc, select FK', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Authors as Authors { ID, books.genre.ID }`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID
        {
          Authors.ID,
          books.genre_ID as books_genre_ID
        }`
      expect(transformed).to.equalCqn(expected)
    })
    it('select managed assoc', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Authors as Authors { ID, books.genre.ID }`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID
        {
          Authors.ID,
          books.genre_ID as books_genre_ID
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('three assocs, last navigates to foreign key', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Authors as Authors { ID, books.genre.parent.ID as foo }`)
      const expected = cds.ql`
        SELECT from bookshop.Authors as Authors
          left outer join bookshop.Books as books on books.author_ID = Authors.ID
          left outer join bookshop.Genres as genre on genre.ID = books.genre_ID
        { 
          Authors.ID, 
          genre.parent_ID as foo
        }`
      expect(transformed).to.equalCqn(expected)
    })
  })

  describe('fk renaming', () => {
    it('only partial key is optimized', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from bookshop.PartialStructuredKey as PartialStructuredKey
        {
          toSelf.struct.one,
          toSelf.struct.two
        }`)
      const expected = cds.ql`
        SELECT from bookshop.PartialStructuredKey as PartialStructuredKey
          left outer join bookshop.PartialStructuredKey as toSelf on toSelf.struct_one = PartialStructuredKey.toSelf_partial
        {
          PartialStructuredKey.toSelf_partial as toSelf_struct_one,
          toSelf.struct_two as toSelf_struct_two
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('association (with multiple, structured, renamed fks) is key', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from ForeignKeyIsAssoc as ForeignKeyIsAssoc
        {
          my.room as teachersRoom
        }`)
      const expected = cds.ql`
        SELECT from ForeignKeyIsAssoc as ForeignKeyIsAssoc
        {
          ForeignKeyIsAssoc.my_room_number as teachersRoom_number,
          ForeignKeyIsAssoc.my_room_name as teachersRoom_name,
          ForeignKeyIsAssoc.my_room_location as teachersRoom_info_location
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('association as key leads to non-key field', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from Pupils as Pupils
        {
          ID
        }
        group by classrooms.classroom.ID, classrooms.classroom.name`)
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

    it('multi step path ends in foreign key', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from Classrooms as Classrooms
        {
          count(pupils.pupil.classrooms.classroom.ID) as classCount
        }
        where pupils.pupil.classrooms.classroom.ID = 1
        order by pupils.pupil.classrooms.classroom.ID`)
      const expected = cds.ql`
        SELECT from Classrooms as Classrooms
          left join ClassroomsPupils as pupils on pupils.classroom_ID = Classrooms.ID
          left join Pupils as pupil on pupil.ID = pupils.pupil_ID
          left join ClassroomsPupils as classrooms2 on classrooms2.pupil_ID = pupil.ID
        {
          count(classrooms2.classroom_ID) as classCount
        }
        where classrooms2.classroom_ID = 1
        order by classrooms2.classroom_ID`
      expect(transformed).to.equalCqn(expected)
    })

    it('path ends on assoc which is fk', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from fkaccess.Books as Books
        {
          authorAddressFKRenamed.address as renamedAssocAsForeignKey
        }`)

      const expected = cds.ql`
        SELECT from fkaccess.Books as Books
        {
          Books.authorAddressFKRenamed_bar_street as renamedAssocAsForeignKey_street,
          Books.authorAddressFKRenamed_bar_number as renamedAssocAsForeignKey_number,
          Books.authorAddressFKRenamed_bar_zip as renamedAssocAsForeignKey_zip,
          Books.authorAddressFKRenamed_bar_city as renamedAssocAsForeignKey_city
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('recursive path end ons deeply nested struct (renamed) that contains assoc', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from fkaccess.Books as Books
        {
          toSelf.deeply.nested
        }`)
      const expected = cds.ql`
        SELECT from fkaccess.Books as Books
        {
          Books.toSelf_baz_authorAddress_address_street as toSelf_deeply_nested_authorAddress_street,
          Books.toSelf_baz_authorAddress_address_number as toSelf_deeply_nested_authorAddress_number,
          Books.toSelf_baz_authorAddress_address_zip as toSelf_deeply_nested_authorAddress_zip,
          Books.toSelf_baz_authorAddress_address_city as toSelf_deeply_nested_authorAddress_city
        }`
      expect(transformed).to.equalCqn(expected)
    })
  })

  describe('in subqueries', () => {
    it('expose managed in inner, expose the same also in outer - both fk', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from (
          SELECT from bookshop.Books as Books
          {
            author
          }
        ) as Bar
        {
          Bar.author
        }`)
      const expected = cds.ql`
        SELECT from (
          SELECT from bookshop.Books as Books
          {
            Books.author_ID
          }
        ) as Bar
        {
          Bar.author_ID
        }`
      expect(transformed).to.equalCqn(expected)
    })

    it('expose managed in inner with alias, expose the same also in outer - both fk', () => {
      const transformed = cqn4sql(cds.ql`
        SELECT from (
          SELECT from bookshop.Books as Books
          {
            author as a
          }
        ) as Bar
        {
          Bar.a
        }`)
      const expected = cds.ql`
        SELECT from (
          SELECT from bookshop.Books as Books
          {
            Books.author_ID as a_ID
          }
        ) as Bar
        {
          Bar.a_ID
        }`
      expect(transformed).to.equalCqn(expected)
    })
  })

  describe('Shared foreign key identity', () => {
    // special test from compiler test suite
    it('subpaths are renamed but all lead to FK', () => {
      const transformed = cqn4sql(cds.ql`
      SELECT from A as A
      {
        a.b.c.toB.b.c.d.parent.c.d.e.ID as a_b_c_toB_foo_boo,
        a.b.c.toB.e.f.g.child.c.d.e.ID as a_b_c_toB_bar_bas
      }`)
      const expected = cds.ql`
      SELECT from A as A
      {
        A.a_b_c_toB_foo_boo as a_b_c_toB_foo_boo,
        A.a_b_c_toB_bar_bas as a_b_c_toB_bar_bas
      }`
      expect(transformed).to.equalCqn(expected)
    })
  })
})
