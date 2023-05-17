// access of structured elements with dot notation
'use strict'
const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test
// "... to flat fields" is not entirely true, as we also have tests with paths ending on a structure
// -> move them to separate section?
describe('Structured Access', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  describe('in Columns', () => {
    // !!! Runtime uses full path as implicit alias !!!
    // see "±" there we must address the flat name
    // of the column in the order by clause
    it('resolves struct path to flat field', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { dedication.text }`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.dedication_text }`)
    })

    it.skip('WOULD BE CORRECT to use the last segment as implicit alias, but we MUST NOT change current behavior', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { dedication.text }`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.dedication_text as text }`)
    })

    // First path step is resolved as table alias, even if subsequent path steps cannot be resolved
    it('resolves first path step as table alias, if possible', () => {
      expect(() => cqn4sql(CQL`SELECT from bookshop.Books as dedication { dedication.text }`, model)).to.throw(
        /"text" not found in "bookshop.Books"/,
      )
    })
    it('resolves first path step as element of data source if it cannot be resolved as table alias', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { dedication.text }`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.dedication_text }`)
    })
    it('cannot access flat names of structure elements', () => {
      expect(() => cqn4sql(CQL`SELECT from bookshop.Books { dedication_text }`, model)).to.throw(
        /"dedication_text" not found in the elements of "bookshop.Books"/,
      )
    })
    it('cannot access flat names of FKs', () => {
      expect(() => cqn4sql(CQL`SELECT from bookshop.Books { author_ID }`, model)).to.throw(
        /"author_ID" not found in the elements of "bookshop.Books"/,
      )
    })
    it('deeply structured access', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { ID, dedication.sub.foo }`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID, Books.dedication_sub_foo }`)
    })
    // mess around with table alias
    it('using implicit table alias', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { Books.dedication.text }`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.dedication_text }`)
    })

    it('with explicit table alias', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books as Bar { ID, dedication.text }`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Bar { Bar.ID, Bar.dedication_text }`)
    })

    it('table alias equals field name', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books as dedication {
            dedication.stock,
            dedication.dedication.text,
            dedication.dedication.dedication
          }`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as dedication {
            dedication.stock,
            dedication.dedication_text,
            dedication.dedication_dedication,
          }`)
    })
    it('table alias has precedence over struct name', () => {
      expect(() => cqn4sql(CQL`SELECT from bookshop.Books as dedication { dedication.text }`, model)).to.throw(
        /"text" not found in "bookshop.Books"/,
      )
    })
    it('unfolds all leafs of sub structure', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books {
            ID,
            dedication.text,
            Books.dedication.sub,
            dedication.sub as anotherSub
          }`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books {
            Books.ID,
            Books.dedication_text,
            Books.dedication_sub_foo,
            Books.dedication_sub_foo as anotherSub_foo
          }`)
    })
    it('unfolds all leafs of sub structure also if table alias equals a field name', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books as dedication {
            dedication.stock,
            dedication.dedication.text,
            dedication.dedication.dedication,
            dedication.dedication as d2
          }`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as dedication {
            dedication.stock,
            dedication.dedication_text,
            dedication.dedication_dedication,
            dedication.dedication_addressee_ID as d2_addressee_ID,
            dedication.dedication_text as d2_text,
            dedication.dedication_sub_foo as d2_sub_foo,
            dedication.dedication_dedication as d2_dedication
          }`)
    })
  })
  describe('in Where', () => {
    it('simple access of sub element', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { ID }
            WHERE dedication.text = 'For Mummy'`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID }
            WHERE Books.dedication_text = 'For Mummy'`)
    })
  })
  // ORDER BY: resolve first path step as 1) select item
  //                                      2) table alias
  //                                      3) element of data source

  describe('in ORDER BY', () => {
    // flat, implicit alias of column must be used
    it('±', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { dedication.sub }
            ORDER BY dedication_sub.foo, Books.dedication.text, dedication.text`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.dedication_sub_foo }
            ORDER BY dedication_sub_foo, Books.dedication_text, Books.dedication_text`)
    })

    it('table alias shadows data source element', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books as dedication { dedication.dedication.sub }
            ORDER BY dedication_sub.foo, dedication.dedication.text, dedication.stock`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as dedication { dedication.dedication_sub_foo }
            ORDER BY dedication_sub_foo, dedication.dedication_text, dedication.stock`)
    })
    it('table alias shadows data source element (2)', () => {
      expect(() =>
        cqn4sql(CQL`SELECT from bookshop.Books as dedication { ID } ORDER BY dedication.text`, model),
      ).to.throw(/"text" not found in "bookshop.Books"/)
    })
    it('explicit column alias shadows explicit table alias', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Bar as structure { structure.nested as structure }
            ORDER BY structure.foo, structure.bar.a, structure.bar.b`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Bar as structure {
            structure.nested_foo_x as structure_foo_x,
            structure.nested_bar_a as structure_bar_a,
            structure.nested_bar_b as structure_bar_b
          } ORDER BY
            structure_foo_x,
            structure_bar_a,
            structure_bar_b
        `)
    })
    it('explicit column alias shadows explicit table alias (2)', () => {
      expect(() =>
        cqn4sql(CQL`SELECT from bookshop.Books as dedication { ID as dedication } ORDER BY dedication.text`, model),
      ).to.throw(/"text" not found in "dedication"/)
    })
    // new, TODO
    it.skip('functions in ORDER BY have same scope', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { ID, dedication.sub  }
                  ORDER BY power(2*dedication_sub.foo), Books.dedication.dedication+2`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID, Books.dedication_sub_foo }
                  ORDER BY power(2*dedication_sub_foo), Books.dedication_dedication+2`)
    })
  })

  describe('in expressions', () => {
    it('access leaf of structured function argument in column', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books {
            power(Books.dedication.text, 2*dedication.sub.foo) as path
          }`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books {
            power(Books.dedication_text, 2*Books.dedication_sub_foo) as path
          }`)
    })
    it('functions in WHERE', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { ID }
            WHERE power(Books.dedication.text, 2*dedication.sub.foo) > dedication.dedication+2`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID }
            WHERE power(Books.dedication_text, 2*Books.dedication_sub_foo)  > Books.dedication_dedication+2`)
    })
    it('functions in GROUP BY/HAVING', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { ID }
            GROUP BY power(Books.dedication.text, 2*dedication.sub.foo), dedication.dedication+2
            HAVING power(Books.dedication.text, 2*dedication.sub.foo) > dedication.dedication+2`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID }
            GROUP BY power(Books.dedication_text, 2*Books.dedication_sub_foo), Books.dedication_dedication+2
            HAVING power(Books.dedication_text, 2*Books.dedication_sub_foo)  > Books.dedication_dedication+2`)
    })
    it('functions in ORDER BY', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { ID }
            ORDER BY power(dedication.text, 2*dedication.sub.foo), dedication.dedication+2`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID }
            ORDER BY power(Books.dedication_text, 2*Books.dedication_sub_foo), Books.dedication_dedication+2`)
    })

    it('denies path ending on struct field in expression', () => {
      expect(() => cqn4sql(CQL`SELECT from bookshop.Books { 2*dedication.sub as foo }`, model)).to.throw(
        /A structured element can't be used as a value in an expression/,
      )
    })
  })

  describe('in subqueries', () => {
    it('subquery in from with alias', () => {
      let query = cqn4sql(
        CQL`SELECT from (select from bookshop.Books {
            ID,
            dedication.sub.foo as foo
          }) as Bar { ID, foo }`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from (select from bookshop.Books as Books {
            Books.ID,
            Books.dedication_sub_foo as foo
          }) as Bar { Bar.ID, Bar.foo }`)
    })
    // skipped as queries with multiple sources are not supported (at least for now)
    it.skip('MUST resolve struct paths to flat fields also with multiple query targets', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books as Bar, bookshop.Books as BarTwo {
          BarTwo.ID,
          Bar.dedication.text as barText,
          BarTwo.dedication.text as barTwoText
        }`,
        model,
      )
      expect(query).to.deep.equal(
        CQL`SELECT from bookshop.Books as Bar, bookshop.Books as BarTwo {
          BarTwo.ID,
          Bar.dedication_text as barText,
          BarTwo.dedication_text as barTwoText
        }`,
      )
    })
  })

  describe('fk access optimization', () => {
    //   a path along a managed association to a target field that is used as FK of the association
    //   is not translated into a join (or subquery), but as struct access to the local FK element
    it('access fk in column', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.Books { ID, Books.currency.code }`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.ID, Books.currency_code }`)
    })

    it('structured fk', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { ID, Books.dedication.addressee.ID as dedicationAddressee }`,
        model,
      )
      expect(query).to.deep.equal(
        CQL`SELECT from bookshop.Books as Books { Books.ID, Books.dedication_addressee_ID as dedicationAddressee }`,
      )
    })
    it('optimizes assoc.assoc.fk path', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1 as AM { ID, a_assoc.assoc2.ID_2.b }`, model)
      expect(query).to.deep.equal(CQL`SELECT from bookshop.AssocMaze1 as AM { AM.ID, AM.a_assoc_assoc2_ID_2_b }`)
    })

    it('optimizes assoc.fk path, with drilling into structured FK', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.AssocMaze1 as AM { ID, a_struc.ID_1.a, a_strass.A_1.b.assoc2.ID_2.b }`,
        model,
      )
      expect(query).to.deep.equal(
        CQL`SELECT from bookshop.AssocMaze1 as AM { AM.ID, AM.a_struc_ID_1_a, AM.a_strass_A_1_b_assoc2_ID_2_b }`,
      )
    })

    it('optimizes assoc.fk path, with drilling into structured, explicit, aliased FK', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1 as AM { ID, a_strucXA.S_1.a, a_assocYA.A_2.b.ID }`, model)
      expect(query).to.deep.equal(
        CQL`SELECT from bookshop.AssocMaze1 as AM { AM.ID, AM.a_strucXA_T_1_a as a_strucXA_S_1_a, AM.a_assocYA_B_2_b_ID as a_assocYA_A_2_b_ID }`,
      )
    })

    it('optimizes assoc.fk path, with fk being managed assoc', () => {
      let query = cqn4sql(CQL`SELECT from bookshop.AssocMaze1 as AM { ID, a_assocYA.A_2 }`, model)
      expect(query).to.deep.equal(
        CQL`SELECT from bookshop.AssocMaze1 as AM { AM.ID, AM.a_assocYA_B_2_a as a_assocYA_A_2_a, AM.a_assocYA_B_2_b_ID as a_assocYA_A_2_b_ID }`,
      )
    })

    it('optimizes assoc.fk path in expression', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books {
            power(author.ID, 2*dedication.addressee.ID) as path
          }`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books {
            power(Books.author_ID, 2*Books.dedication_addressee_ID) as path
          }`)
    })
    it('resolves struct paths into FROM subquery mix with assoc FK access', () => {
      let query = cqn4sql(
        CQL`SELECT from (select from bookshop.Books {Books.ID, Books.dedication as dedi}) as Bar { ID, dedi.addressee.ID}`,
        model,
      )
      expect(query).to.deep.equal(
        CQL`SELECT from (select from bookshop.Books as Books {
              Books.ID,
              Books.dedication_addressee_ID as dedi_addressee_ID,
              Books.dedication_text as dedi_text,
              Books.dedication_sub_foo as dedi_sub_foo,
              Books.dedication_dedication as dedi_dedication
            }) as Bar { Bar.ID, Bar.dedi_addressee_ID }`,
      )
    })
  })

  describe('in GROUP BY/HAVING', () => {
    it('uses query source elements and not column alias', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { dedication.text }
          GROUP BY dedication.text HAVING dedication.text = 'For Mummy'`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.dedication_text }
          GROUP BY Books.dedication_text HAVING Books.dedication_text = 'For Mummy'`)
    })

    it('resolves and unfolds struct paths ending on struct', () => {
      let query = cqn4sql(
        CQL`SELECT from bookshop.Books { dedication.sub }
          GROUP BY dedication.sub`,
        model,
      )
      expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books { Books.dedication_sub_foo }
          GROUP BY Books.dedication_sub_foo`)
    })
  })
})
