'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds')
const { expect } = cds.test
const _inferred = require('../../lib/infer')

describe('Flattening', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  describe('in columns', () => {
    it('unfolds structure', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Bar as Bar {
              ID,
              structure
            }`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Bar as Bar {
              Bar.ID,
              Bar.structure_foo,
              Bar.structure_baz
            }`)
    })

    it('unfolds structure also with table alias', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Bar as structure {
              structure,
              ID
            }`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Bar as structure {
              structure.structure_foo,
              structure.structure_baz,
              structure.ID
            }`)
    })

    it('unfolds structure also with alias', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Bar as Bar {
              structure as ding
            }`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Bar as Bar {
              Bar.structure_foo as ding_foo,
              Bar.structure_baz as ding_baz
            }`)
    })

    it('unfolds structure repeatedly if properly aliased', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Bar as Bar {
              structure as ding,
              Bar.structure as bing
            }`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Bar as Bar {
              Bar.structure_foo as ding_foo,
              Bar.structure_baz as ding_baz,
              Bar.structure_foo as bing_foo,
              Bar.structure_baz as bing_baz
            }`)
    })

    it('unfolds nested structure', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Bar as Bar {
              nested
            }`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Bar as Bar {
              Bar.nested_foo_x,
              Bar.nested_bar_a,
              Bar.nested_bar_b
            }`)
    })
    // unmanaged ...
    it('ignores unmanaged association in SELECT clause (has no value)', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { author, coAuthorUnmanaged }`, model)
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.Books as Books { Books.author_ID }`)
    })

    it('ignores managed composition in SELECT clause (has no value)', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Orders as src { ID, items }`, model)
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.Orders as src { src.ID }`)
    })

    // why?
    it('ignores managed composition in SELECT clause (has no value) even if it results in an empty select list', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Orders as src { items }`, model)
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.Orders as src { }`)
    })
    it('rejects struct fields in column expression', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Bar { 2*nested as x }`, model)).to.throw(
        `The operator "*" can only be used with scalar operands`,
      )
    })

    it('expands managed associations in function args in columns', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Bar { sin(nested1) as x }`, model)
      const expected = cds.ql`
        SELECT from bookshop.Bar as $B {
          sin($B.nested1_foo_x) as x
        }`
      expect(transformed).to.deep.eql(expected)
    })

    it('rejects managed associations in column expression', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { 2*author as x }`, model)).to.throw(
        `The operator "*" can only be used with scalar operands`,
      )
    })
    it('expands managed associations in function args in columns', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books { sin(author) as x }`, model)
      const expected = cds.ql`
        SELECT from bookshop.Books as $B {
          sin($B.author_ID) as x
        }`
      expect(transformed).to.deep.eql(expected)
    })
    it('rejects unmanaged associations in expressions in SELECT clause (1)', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { 2*coAuthorUnmanaged as x }`, model)).to.throw(
        /An association can't be used as a value in an expression/,
      )
    })

    it('rejects unmanaged associations in expressions in SELECT clause (2)', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { sin(coAuthorUnmanaged) as x }`, model)).to.throw(
        /An association can't be used as a value in an expression/,
      )
    })

    it('rejects unmanaged associations in expressions in SELECT clause (3)', () => {
      expect(() =>
        cqn4sql(cds.ql`SELECT from bookshop.AssocWithStructuredKey { sin(emptyStructUnmanaged) as x }`, model),
      ).to.throw(/Structured element “emptyStructUnmanaged” expands to nothing and can't be used in expressions/)
    })

    it('unfolds managed associations in SELECT clause', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books {
            ID,
            author,
            coAuthor,
            genre
          }`,
        model,
      )
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.Books as Books {
            Books.ID,
            Books.author_ID,
            Books.coAuthor_ID,
            Books.genre_ID
          }`)
    })

    it('unfolds managed associations in SELECT clause with foreign keys', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books {
            ID,
            author,
            author_ID,
            coAuthor,
            coAuthor_ID,
            genre,
            genre_ID
          }`,
        cds.linked(cds.compile.for.nodejs(JSON.parse(JSON.stringify(model)))),
      )
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.Books as Books {
            Books.ID,
            Books.author_ID,
            Books.coAuthor_ID,
            Books.genre_ID
          }`)
    })

    it('unfolds managed associations in SELECT clause also with table alias', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as genre {
            genre.author,
            genre,
            ID
          }`,
        model,
      )
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.Books as genre {
            genre.author_ID,
            genre.genre_ID,
            genre.ID
          }`)
    })

    it('unfolds managed associations in SELECT clause also with alias', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books {
            ID,
            author as person,
            Books.genre as topic
          }`,
        model,
      )
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.Books as Books {
            Books.ID,
            Books.author_ID as person_ID,
            Books.genre_ID as topic_ID
          }`)
    })

    it('unfolds implicit up_ association in SELECT clause', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Orders.items as src { up_ }`, model)
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.Orders.items as src {
            src.up__ID
          }`)
    })

    it('unfolds managed associations with structured FKs', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocWithStructuredKey as src { toStructuredKey }`, model)
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.AssocWithStructuredKey as src {
            src.toStructuredKey_struct_mid_leaf,
            src.toStructuredKey_struct_mid_anotherLeaf,
            src.toStructuredKey_second
          }`)
    })

    // TODO also relevant for "inferred"?
    it('unfolds managed associations with structured FKs (2)', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID, a_struc }`, model)
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.AssocMaze1 as AM {
            AM.ID,
            AM.a_struc_ID_1_a, AM.a_struc_ID_1_b,
            AM.a_struc_ID_2_a, AM.a_struc_ID_2_b
          }`)
    })

    // TODO also relevant for "inferred"?
    it('unfolds managed associations with explicit simple FKs', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID, a_strucX }`, model)
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.AssocMaze1 as AM {
            AM.ID,
            AM.a_strucX_a, AM.a_strucX_b
          }`)
    })

    // TODO also relevant for "inferred"?
    it('unfolds managed associations with explicit structured FKs', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID, a_strucY }`, model)
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.AssocMaze1 as AM {
            AM.ID,
            AM.a_strucY_S_1_a, AM.a_strucY_S_1_b,
            AM.a_strucY_S_2_a, AM.a_strucY_S_2_b
          }`)
    })

    // TODO also relevant for "inferred"?
    it('unfolds managed associations with explicit structured aliased FKs', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID, a_strucXA }`, model)
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.AssocMaze1 as AM {
            AM.ID,
            AM.a_strucXA_T_1_a, AM.a_strucXA_T_1_b,
            AM.a_strucXA_T_2_a, AM.a_strucXA_T_2_b
          }`)
    })

    // also relevant for "inferred"?
    it('unfolds managed associations with FKs being managed associations', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID, a_assoc }`, model)
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.AssocMaze1 as AM {
            AM.ID,
            AM.a_assoc_assoc1_ID_1_a, AM.a_assoc_assoc1_ID_1_b,
            AM.a_assoc_assoc1_ID_2_a, AM.a_assoc_assoc1_ID_2_b,
            AM.a_assoc_assoc2_ID_1_a, AM.a_assoc_assoc2_ID_1_b,
            AM.a_assoc_assoc2_ID_2_a, AM.a_assoc_assoc2_ID_2_b,
          }`)
    })

    // also relevant for "inferred"?
    it('unfolds managed associations with explicit FKs being managed associations', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID, a_assocY }`, model)
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.AssocMaze1 as AM {
            AM.ID,
            AM.a_assocY_A_1_a, AM.a_assocY_A_1_b_ID,
            AM.a_assocY_A_2_a, AM.a_assocY_A_2_b_ID
          }`)
    })

    // also relevant for "inferred"?
    it('unfolds managed associations with explicit aliased FKs being managed associations', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID, a_assocYA as asso }`, model)
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.AssocMaze1 as AM {
            AM.ID,
            AM.a_assocYA_B_1_a as asso_B_1_a , AM.a_assocYA_B_1_b_ID as asso_B_1_b_ID,
            AM.a_assocYA_B_2_a as asso_B_2_a,  AM.a_assocYA_B_2_b_ID as asso_B_2_b_ID
          }`)
    })

    // also relevant for "inferred"?
    it('unfolds managed associations with FKs being mix of struc and managed assoc', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID, a_strass }`, model)
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.AssocMaze1 as AM {
            AM.ID,
            AM.a_strass_A_1_a,
            AM.a_strass_A_1_b_assoc1_ID_1_a, AM.a_strass_A_1_b_assoc1_ID_1_b,
            AM.a_strass_A_1_b_assoc1_ID_2_a, AM.a_strass_A_1_b_assoc1_ID_2_b,
            AM.a_strass_A_1_b_assoc2_ID_1_a, AM.a_strass_A_1_b_assoc2_ID_1_b,
            AM.a_strass_A_1_b_assoc2_ID_2_a, AM.a_strass_A_1_b_assoc2_ID_2_b,
            AM.a_strass_A_2_a,
            AM.a_strass_A_2_b_assoc1_ID_1_a, AM.a_strass_A_2_b_assoc1_ID_1_b,
            AM.a_strass_A_2_b_assoc1_ID_2_a, AM.a_strass_A_2_b_assoc1_ID_2_b,
            AM.a_strass_A_2_b_assoc2_ID_1_a, AM.a_strass_A_2_b_assoc2_ID_1_b,
            AM.a_strass_A_2_b_assoc2_ID_2_a, AM.a_strass_A_2_b_assoc2_ID_2_b
          }`)
    })

    // also relevant for "inferred"?
    it('unfolds managed associations with explicit FKs being path into a struc', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.AssocMaze1 as AM { ID, a_part }`, model)
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.AssocMaze1 as AM {
            AM.ID,
            AM.a_part_a,
            AM.a_part_b
          }`)
    })
    //
    // two data sources
    //

    // TODO move out
    it('does not transform queries with multiple query sources, but just returns the inferred query', () => {
      const query = cds.ql`SELECT from bookshop.Books as Books, bookshop.Authors as Authors {Books.ID as bid, Authors.ID as aid}`
      expect(cqn4sql(query, model)).to.deep.equal(_inferred(query, model))
    })

    // skipped as queries with multiple sources are not supported (at least for now)
    it.skip('unfolds association in SELECT clause, two data sources', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books, bookshop.Authors {
          Books.ID,
          Books.author,
          genre,
          coAuthorUnmanaged
        }`,
        model,
      )

      expect(query).to.deep.eql(
        cds.ql`SELECT from bookshop.Books as Books, bookshop.Authors as Authors {
          Books.ID,
          Books.author_ID,
          Books.genre_ID
        }`,
      )
    })

    // skipped as queries with multiple sources are not supported (at least for now)
    it.skip('unfolds association in SELECT clause also with alias', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books, bookshop.Authors {
          Books.ID,
          Books.author as a,
          genre as g,
          coAuthorUnmanaged
        }`,
        model,
      )

      expect(query).to.deep.eql(
        cds.ql`SELECT from bookshop.Books as Books, bookshop.Authors as Authors {
          Books.ID,
          Books.author_ID as a_ID,
          Books.genre_ID as g_ID
        }`,
      )
    })
  })

  describe('in list', () => {
    it('unfolds structure with one leaf', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books {
              ID
            } where (ID, author) in (select from bookshop.Books { ID, author } where title = 'x')`,
        model,
      )
      const expected = cds.ql`
        SELECT from bookshop.Books as Books {
              Books.ID
            } where (Books.ID, Books.author_ID) in (
              select from bookshop.Books as $B {
                $B.ID,
                $B.author_ID
              } where $B.title = 'x'
            )`
      expect(query).to.deep.equal(expected)
    })

    it('unfolds structure with multiple leafs', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Bar as Bar {
              ID
            } where (ID, structure) in (select from bookshop.Bar { ID, structure } where ID = 'x')`,
        model,
      )
      const expected = cds.ql`
        SELECT from bookshop.Bar as Bar {
          Bar.ID
        }
        where (Bar.ID, Bar.structure_foo, Bar.structure_baz) in (
          select from bookshop.Bar as $B {
            $B.ID,
            $B.structure_foo,
            $B.structure_baz 
          } where $B.ID = 'x'
        )`
      expect(query).to.deep.equal(expected)
    })
  })
  describe('in where', () => {
    it('unfolds structure in subquery', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books { ID } WHERE exists (
              SELECT address from bookshop.Authors as Authors where ID > Books.ID
              )`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep
        .equal(cds.ql`SELECT from bookshop.Books as Books { Books.ID } WHERE exists (
              SELECT Authors.address_street, Authors.address_city from bookshop.Authors as Authors where Authors.ID > Books.ID
            )`)
    })
    it('rejects struct fields in expressions in toplevel WHERE clause', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Bar { ID } WHERE 2 = nested`, model)).to.throw(
        /Can't compare structure "nested" to value "2"; only possible for structures with one sub-element/,
      )
    })

    it('expands struct fields in function args with exactly one leaf', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Bar { ID } WHERE sin(nested1) < 0`, model)
      const expected = cds.ql`
        SELECT from bookshop.Bar as $B {
          $B.ID
        }
        WHERE sin($B.nested1_foo_x) < 0`
      expect(transformed).to.deep.eql(expected)
    })

    it('rejects managed association in WHERE clause', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID } WHERE author`, model)).to.throw(
        /An association can't be used as a value in an expression/,
      )
    })

    it('rejects managed associations in expressions in WHERE clause (2)', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books { ID } WHERE sin(author) < 0`, model)
      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          $B.ID
        }
        WHERE sin($B.author_ID) < 0`
      expect(transformed).to.deep.eql(expected)

    })
    // (PB) TODO align error message with the examples below
    it('rejects unmanaged associations in WHERE clause', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID } WHERE coAuthorUnmanaged`, model)).to.throw(
        /An association can't be used as a value in an expression/,
      )
    })

    it('rejects unmanaged associations in expressions in WHERE clause (1)', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID } WHERE 2 = coAuthorUnmanaged`, model)).to.throw(
        /An association can't be used as a value in an expression/,
      )
    })

    it('rejects unmanaged associations in expressions in WHERE clause (2)', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID } WHERE sin(coAuthorUnmanaged) > 0`, model)).to.throw(
        /An association can't be used as a value in an expression/,
      )
    })
  })

  describe('in subqueries', () => {
    //
    // subqueries
    //

    it('unfolds structure in value subquery (result is invalid SQL)', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books {
          ID,
          (SELECT from bookshop.Person as Person { address }) as foo
        }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books {
          Books.ID,
          (SELECT from bookshop.Person as Person { Person.address_street, Person.address_city}) as foo
        }`)
    })

    it('unfolds structure in value subquery (result is invalid SQL), access outer table alias in inner query', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books {
          (SELECT address from bookshop.Authors as Authors where ID > Books.ID) as authorColumn,

          (SELECT from bookshop.Genres as G {
            (SELECT address from bookshop.Authors as genreAuthor where ID > Books.ID and G.ID = 42) as AuthorInG,
          }) as genreColumn
        }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books {
          (SELECT Authors.address_street, Authors.address_city from bookshop.Authors as Authors where Authors.ID > Books.ID) as authorColumn,
          (SELECT from bookshop.Genres as G {
            (SELECT genreAuthor.address_street, genreAuthor.address_city from bookshop.Authors as genreAuthor
               where genreAuthor.ID > Books.ID and G.ID = 42) as AuthorInG,
          }) as genreColumn
        }`)
    })
    it('unfolds managed association in value subquery', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books {
            ID,
            (SELECT from bookshop.Books { author }) as foo
          }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.equal(cds.ql`SELECT from bookshop.Books as $B {
            $B.ID,
            (SELECT from bookshop.Books as $B2 { $B2.author_ID }) as foo
          }`)
    })

    it('unfolds managed association in value subquery (result is invalid SQL)', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books {
            ID,
            (SELECT from bookshop.AssocMaze1 as AM { a_struc as a }) as foo
          }`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep.eql(cds.ql`SELECT from bookshop.Books as Books {
            Books.ID,
            (SELECT from bookshop.AssocMaze1 as AM {
              AM.a_struc_ID_1_a as a_ID_1_a, AM.a_struc_ID_1_b as a_ID_1_b,
              AM.a_struc_ID_2_a as a_ID_2_a, AM.a_struc_ID_2_b as a_ID_2_b}
            ) as foo
          }`)
    })

    it('unfolds managed association in EXISTS subquery', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Authors as Authors { ID } WHERE exists (
            SELECT author from bookshop.Books as Books where Books.ID > Authors.ID
            )`,
        model,
      )
      expect(JSON.parse(JSON.stringify(query))).to.deep
        .equal(cds.ql`SELECT from bookshop.Authors as Authors { Authors.ID } WHERE exists (
            SELECT Books.author_ID from bookshop.Books as Books where Books.ID > Authors.ID
          )`)
    })

    it('unfolds managed association in FROM subquery', () => {
      let query = cqn4sql(
        cds.ql`SELECT from (select from bookshop.Books as Books { author, coAuthor as co}) as Q {
        author,
        co
      }`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from (select from bookshop.Books as Books {
        Books.author_ID,
        Books.coAuthor_ID as co_ID
       } ) as Q {
        Q.author_ID,
        Q.co_ID
      }`)
    })
  })

  describe('in order by', () => {
    it('unfolds struct field with a single element in ORDER BY clause', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Bar as Bar { stock } ORDER BY struct1`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Bar as Bar { Bar.stock }
            ORDER BY Bar.struct1_foo
          `)
    })
    it('unfolds nested struct field with a single leaf element in ORDER BY clause', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Bar as Bar { stock } ORDER BY nested1`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Bar as Bar { Bar.stock }
              ORDER BY Bar.nested1_foo_x
            `)
    })
    it('rejects struct field with multiple elements in ORDER BY', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Bar { stock } ORDER BY structure`, model)).to.throw(
        /Structured element “structure” expands to multiple fields and can't be used in order by/,
      )
    })
    it('rejects nested struct field with multiple leafs elements in ORDER BY', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Bar { stock } ORDER BY nested`, model)).to.throw(
        /Structured element “nested” expands to multiple fields and can't be used in order by/,
      )
    })

    it('fails for structures with multiple leafs in ORDER BY, accessing a deep element', () => {
      expect(() =>
        cqn4sql(cds.ql`SELECT from bookshop.WithStructuredKey { second } order by struct.mid`, model),
      ).to.throw(/Structured element “struct.mid” expands to multiple fields and can't be used in order by/)
    })

    it('unfolds structured access to a single element in ORDER BY, select list alias shadows table alias', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Bar as structure { structure.structure as structure }
      ORDER BY structure.foo, structure.baz`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Bar as structure {
        structure.structure_foo as structure_foo,
        structure.structure_baz as structure_baz
      } ORDER BY
      structure_foo,
      structure_baz
      `)
    })

    it('unfolds structured access to a single element in ORDER BY, table alias shadows data source element', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Bar as ID { stock }
      ORDER BY ID.structure.foo, ID.structure.baz`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Bar as ID { ID.stock } ORDER BY
      ID.structure_foo,
      ID.structure_baz
      `)
    })

    it('xy unfolds structured access to a single element in ORDER BY clause', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Bar as Bar { structure as out } ORDER BY out.foo, out.baz, Bar.nested.foo, Bar.nested.bar.a, Bar.nested.bar.b`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Bar as Bar {
        Bar.structure_foo as out_foo,
        Bar.structure_baz as out_baz,
      } ORDER BY
        out_foo,
        out_baz,
        Bar.nested_foo_x,
        Bar.nested_bar_a,
        Bar.nested_bar_b
      `)
    })

    it('unfolds structured access to a single element in ORDER BY clause', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Bar as Bar { structure as out } ORDER BY out.foo, out.baz, Bar.nested.foo, Bar.nested.bar.a, Bar.nested.bar.b`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Bar as Bar {
        Bar.structure_foo as out_foo,
        Bar.structure_baz as out_baz,
      } ORDER BY
        out_foo,
        out_baz,
        Bar.nested_foo_x,
        Bar.nested_bar_a,
        Bar.nested_bar_b
      `)
    })

    it('rejects struct fields in expressions in ORDER BY clause (1)', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Bar { ID } ORDER BY 2*nested`, model)).to.throw(
        `The operator "*" can only be used with scalar operands`,
      )
    })

    it('expands struct fields in function args in ORDER BY clause', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Bar { ID } ORDER BY sin(nested1)`, model)
      const expected = cds.ql`
        SELECT from bookshop.Bar as $B {
          $B.ID
        }
        ORDER BY sin($B.nested1_foo_x)`
      expect(transformed).to.deep.eql(expected)
    })
    it('unfolds managed association with one FK in ORDER BY clause', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books { ID, author, coAuthor as co }
        order by Books.author, co`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books {
        Books.ID,
        Books.author_ID,
        Books.coAuthor_ID as co_ID
      } order by
        Books.author_ID,
        co_ID
      `)
    })
    it('same as above but navigation to foreign key in order by', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books  {
          ID,
          author,
          coAuthor as co
        }
        order by
          Books.author,
          co.ID`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books {
        Books.ID,
        Books.author_ID,
        Books.coAuthor_ID as co_ID
      } order by
        Books.author_ID,
        co_ID
      `)
    })

    it('rejects managed association with multiple FKs in ORDER BY clause', () => {
      expect(() =>
        cqn4sql(cds.ql`SELECT from bookshop.AssocWithStructuredKey { ID } order by toStructuredKey`, model),
      ).to.throw(/Structured element “toStructuredKey” expands to multiple fields and can't be used in order by/)
    })

    it('rejects managed associations in expressions in ORDER BY clause (1)', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID } ORDER BY 2*author`, model)).to.throw(
        `The operator "*" can only be used with scalar operands`,
      )
    })

    it('expands managed associations in expressions in ORDER BY clause (2)', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books { ID } ORDER BY sin(author)`, model)
      const expected = cds.ql`
        SELECT from bookshop.Books as $B {
          $B.ID
        }
        ORDER BY sin($B.author_ID)`
      expect(transformed).to.deep.eql(expected)
    })
    it('ignores unmanaged associations in ORDER BY clause', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID } ORDER BY ID, coAuthorUnmanaged`, model)
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.Books as Books { Books.ID } order by ID`)
    })
    it('rejects unmanaged associations in expressions in ORDER BY clause (1)', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID } ORDER BY 2*coAuthorUnmanaged`, model)).to.throw(
        /An association can't be used as a value in an expression/,
      )
    })

    it('rejects unmanaged associations in expressions in ORDER BY clause (2)', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID } ORDER BY sin(coAuthorUnmanaged)`, model)).to.throw(
        /An association can't be used as a value in an expression/,
      )
    })
  })

  describe('in group by', () => {
    it('unfolds struct field in GROUP BY clause', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Bar as Bar { ID } group by Bar.structure, nested`, model)
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Bar as Bar { Bar.ID } group by
            Bar.structure_foo,
            Bar.structure_baz,
            Bar.nested_foo_x,
            Bar.nested_bar_a,
            Bar.nested_bar_b
          `)
    })

    it('unfolds managed association in GROUP BY clause', () => {
      let query = cqn4sql(
        cds.ql`SELECT from bookshop.Books as Books { ID, author, coAuthor as co }
            group by author, Books.coAuthor`,
        model,
      )
      expect(query).to.deep.equal(cds.ql`SELECT from bookshop.Books as Books {
            Books.ID,
            Books.author_ID,
            Books.coAuthor_ID as co_ID
          } group by
            Books.author_ID,
            Books.coAuthor_ID
          `)
    })

    it('if only partial foreign key is accessed, only the requested key is flattened', () => {
      const q = cds.ql`SELECT from bookshop.Intermediate as Intermediate {
        ID
      } group by toAssocWithStructuredKey.toStructuredKey.second`

      const qx = cds.ql`SELECT from bookshop.Intermediate as Intermediate
      left join bookshop.AssocWithStructuredKey as toAssocWithStructuredKey
        on toAssocWithStructuredKey.ID = Intermediate.toAssocWithStructuredKey_ID
      {
        Intermediate.ID
      } group by toAssocWithStructuredKey.toStructuredKey_second`
      const res = cqn4sql(q, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
    })
    // TODO: currently no-op in runtime (those structured elements are flat), however this should work
    it.skip('if only partial, structured foreign key is accessed, only the requested key is flattened', () => {
      const q = cds.ql`SELECT from bookshop.Intermediate {
        ID
      } group by toAssocWithStructuredKey.toStructuredKey.struct.mid.leaf`

      const qx = cds.ql`SELECT from bookshop.Intermediate as Intermediate
      left join bookshop.AssocWithStructuredKey as toAssocWithStructuredKey
        on toAssocWithStructuredKey.ID = Intermediate.toAssocWithStructuredKey_ID
      {
        Intermediate.ID
      } group by toAssocWithStructuredKey.toStructuredKey_struct_mid_leaf`
      const res = cqn4sql(q, model)
      expect(JSON.parse(JSON.stringify(res))).to.deep.equal(qx)
    })

    it('rejects managed associations in expressions in GROUP BY clause (1)', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID } GROUP BY 2*author`, model)).to.throw(
        `The operator "*" can only be used with scalar operands`,
      )
    })

    it('expands managed associations in function args', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books { ID } GROUP BY sin(author)`, model)
      const expected = cds.ql`
        SELECT from bookshop.Books as $B {
          $B.ID
        }
        GROUP BY sin($B.author_ID)`
      expect(transformed).to.deep.eql(expected)
    })
    it('rejects struct fields in expressions in GROUP BY clause (1)', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Bar as Bar { ID } GROUP BY 2*nested`, model)).to.throw(
        `The operator "*" can only be used with scalar operands`,
      )
    })

    it('expands struct fields in expressions in GROUP BY clause (2)', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Bar { ID } GROUP BY sin(nested1)`, model)
      const expected = cds.ql`
        SELECT from bookshop.Bar as $B {
          $B.ID
        }
        GROUP BY sin($B.nested1_foo_x)`
      expect(transformed).to.deep.eql(expected)
    })

    it('ignores unmanaged associations in GROUP BY clause', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID } GROUP BY ID, coAuthorUnmanaged`, model)
      expect(query).to.deep.eql(cds.ql`SELECT from bookshop.Books as Books { Books.ID } GROUP BY Books.ID`)
    })

    it('ignores unmanaged associations in GROUP BY and deletes the clause if it is the only GROUP BY column', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID } GROUP BY coAuthorUnmanaged`, model)
      expect(JSON.parse(JSON.stringify(query))).to.deep.eql(cds.ql`SELECT from bookshop.Books as Books { Books.ID }`)
    })
    it('ignores unmanaged associations in ORDER BY and deletes the clause if it is the only ORDER BY column', () => {
      let query = cqn4sql(cds.ql`SELECT from bookshop.Books as Books { ID } ORDER BY coAuthorUnmanaged`, model)
      expect(JSON.parse(JSON.stringify(query))).to.deep.eql(cds.ql`SELECT from bookshop.Books as Books { Books.ID }`)
    })

    it('rejects unmanaged associations in expressions in GROUP BY clause (1)', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID } GROUP BY 2*coAuthorUnmanaged`, model)).to.throw(
        /An association can't be used as a value in an expression/,
      )
    })

    it('rejects unmanaged associations in expressions in GROUP BY clause (2)', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID } GROUP BY sin(coAuthorUnmanaged)`, model)).to.throw(
        /An association can't be used as a value in an expression/,
      )
    })
  })

  describe('in having', () => {
    it('rejects struct field in HAVING clause', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Bar { ID } HAVING nested`, model)).to.throw(
        /A structured element can't be used as a value in an expression/,
      )
    })

    // -----------------------------------------------------------------------------------------------------------------
    // TODO SMW move tests that contain paths to a suitable place

    // -----------------------------------------------------------------------------------------------------------------

    //
    // expressions
    //   structured fields inside expressions aren't supported anywhere

    it('rejects struct fields in expressions in HAVING clause (1)', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Bar { ID } HAVING 2 = nested`, model)).to.throw(
        /Can't compare structure "nested" to value "2"; only possible for structures with one sub-element/
      )
    })

    it('expands struct fields in expressions in function clause', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Bar { ID } HAVING sin(nested1) < 0`, model)
      const expected = cds.ql`
        SELECT from bookshop.Bar as $B
        {
          $B.ID
        }
        HAVING sin($B.nested1_foo_x) < 0`
      expect(transformed).to.deep.eql(expected)
    })

    it('rejects managed association in HAVING clause', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID } HAVING author`, model)).to.throw(
        /An association can't be used as a value in an expression/,
      )
    })
    //
    // expressions
    //   managed associations inside expressions aren't supported anywhere
    //   TODO if implementation is same for all clauses, we probably don't need all these tests

    it('expands managed associations in expressions in function args', () => {
      const transformed = cqn4sql(cds.ql`SELECT from bookshop.Books { ID } HAVING sin(author) < 0`, model)
      const expected = cds.ql`
        SELECT from bookshop.Books as $B
        {
          $B.ID
        }
        HAVING sin($B.author_ID) < 0`
      expect(transformed).to.deep.eql(expected)
    })

    it('rejects unmanaged associations in HAVING clause', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID } HAVING coAuthorUnmanaged`, model)).to.throw(
        /An association can't be used as a value in an expression/,
      )
    })
    it('rejects unmanaged associations in expressions in HAVING clause (1)', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID } HAVING 2 = coAuthorUnmanaged`, model)).to.throw(
        /An association can't be used as a value in an expression/,
      )
    })

    it('rejects unmanaged associations in expressions in HAVING clause (2)', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID } HAVING sin(coAuthorUnmanaged) < 0`, model)).to.throw(
        /An association can't be used as a value in an expression/,
      )
    })

    it('rejects unmanaged in function args', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Books { ID } HAVING sin(coAuthorUnmanaged) < 0`, model)).to.throw(
        /An association can't be used as a value in an expression/,
      )
    })
    it('rejects structure with multiple leafs in function args', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Bar { ID } HAVING sin(structure) < 0`, model)).to.throw(
        /Structured element “structure” expands to multiple fields and can't be used in expressions/,
      )
    })
    it('does not reject structure with multiple leafs in list', () => {
      expect(() => cqn4sql(cds.ql`SELECT from bookshop.Bar { ID } WHERE (ID, structure) in (ID, structure)`, model)).to.not.throw(
        /Structured element “structure” expands to multiple fields and can't be used in expressions/,
      )
    })
  })
})
