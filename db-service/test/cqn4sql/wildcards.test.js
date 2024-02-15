'use strict'

const cqn4sql = require('../../lib/cqn4sql')
const cds = require('@sap/cds/lib')
const { expect } = cds.test

// TODO: UCSN -> order is different compared to odata model
function customSort(a, b) {
  // Get the last values from the "ref" arrays or set them as empty strings
  const lastValueA = a.ref && a.ref.length ? a.ref[a.ref.length - 1] : ''
  const lastValueB = b.ref && b.ref.length ? b.ref[b.ref.length - 1] : ''

  // Compare the last values alphabetically
  if (lastValueA < lastValueB) {
    return -1
  }
  if (lastValueA > lastValueB) {
    return 1
  }
  // If the last values are equal, maintain their original order
  return 0
}

describe('wildcard expansion and exclude clause', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/schema').then(cds.linked)
  })

  it('Respects excluding when expanding wildcard', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Books { *, author.ID as author } excluding {createdBy, modifiedBy}`,
      model,
    )
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books {
        Books.createdAt,
        Books.modifiedAt,
        Books.ID,
        Books.anotherText,
        Books.title,
        Books.descr,
        Books.author_ID as author,
        Books.coAuthor_ID,
        Books.genre_ID,
        Books.stock,
        Books.price,
        Books.currency_code,
        Books.dedication_addressee_ID,
        Books.dedication_text,
        Books.dedication_sub_foo,
        Books.dedication_dedication,
        Books.coAuthor_ID_unmanaged
      } excluding {createdBy, modifiedBy}`) // excluding becomes necessary as cqn4sql doesn't loose input properties anymore
  })

  it('MUST respect smart wildcard rules', () => {
    const input = CQL`SELECT from bookshop.Bar { 'first' as first, 'second' as createdAt, *, 'third' as ID }`
    let query = cqn4sql(input, model)
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Bar as Bar {
        'first' as first,
        'second' as createdAt,
        'third' as ID,
        Bar.stock,
        Bar.structure_foo,
        Bar.structure_baz,
        Bar.nested_foo_x,
        Bar.nested_bar_a,
        Bar.nested_bar_b,
        Bar.note,
        Bar.struct1_foo,
        Bar.nested1_foo_x
      }`,
    )
  })
  it('overwrite column with struct', () => {
    const input = CQL`SELECT from bookshop.Bar { structure as first, 'second' as createdAt, *, structure as ID }`
    let query = cqn4sql(input, model)
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Bar as Bar {
        Bar.structure_foo as first_foo,
        Bar.structure_baz as first_baz,
        'second' as createdAt,
        Bar.structure_foo as ID_foo,
        Bar.structure_baz as ID_baz,
        Bar.stock,
        Bar.structure_foo,
        Bar.structure_baz,
        Bar.nested_foo_x,
        Bar.nested_bar_a,
        Bar.nested_bar_b,
        Bar.note,
        Bar.struct1_foo,
        Bar.nested1_foo_x
      }`,
    )
  })

  it('MUST respect smart wildcard rules -> structure replacement before star', () => {
    const input = CQL`SELECT from bookshop.Bar { 'first' as structure, * }`
    let query = cqn4sql(input, model)
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Bar as Bar {
        'first' as structure,
        Bar.ID,
        Bar.stock,
        Bar.nested_foo_x,
        Bar.nested_bar_a,
        Bar.nested_bar_b,
        Bar.note,
        Bar.createdAt,
        Bar.struct1_foo,
        Bar.nested1_foo_x
      }`,
    )
  })
  it('MUST respect smart wildcard rules -> structure replacement after star', () => {
    const input = CQL`SELECT from bookshop.Bar { *, 'third' as structure }`
    let query = cqn4sql(input, model)
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Bar as Bar {
        Bar.ID,
        Bar.stock,
        'third' as structure,
        Bar.nested_foo_x,
        Bar.nested_bar_a,
        Bar.nested_bar_b,
        Bar.note,
        Bar.createdAt,
        Bar.struct1_foo,
        Bar.nested1_foo_x
      }`,
    )
  })
  it('MUST respect smart wildcard rules -> ref replaces wildcard element', () => {
    const input = CQL`SELECT from bookshop.Bar { *, nested.bar.a as structure }`
    let query = cqn4sql(input, model)
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Bar as Bar {
        Bar.ID,
        Bar.stock,
        Bar.nested_bar_a as structure,
        Bar.nested_foo_x,
        Bar.nested_bar_a,
        Bar.nested_bar_b,
        Bar.note,
        Bar.createdAt,
        Bar.struct1_foo,
        Bar.nested1_foo_x
      }`,
    )
  })
  it('MUST respect smart wildcard rules -> subquery replacement after star', () => {
    const input = CQL`SELECT from bookshop.Bar { *, (SELECT from bookshop.Bar {ID}) as structure }`
    let query = cqn4sql(input, model)
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Bar as Bar {
          Bar.ID,
          Bar.stock,
          (SELECT from bookshop.Bar as Bar2 {Bar2.ID}) as structure,
          Bar.nested_foo_x,
          Bar.nested_bar_a,
          Bar.nested_bar_b,
          Bar.note,
          Bar.createdAt,
          Bar.struct1_foo,
          Bar.nested1_foo_x
        }`,
    )
  })
  it('expand after wildcard overwrites assoc from wildcard expansion', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books { *, author {name} }`, model)
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(CQL`SELECT from bookshop.Books as Books
        {
          Books.createdAt,
          Books.createdBy,
          Books.modifiedAt,
          Books.modifiedBy,
          Books.ID,
          Books.anotherText,
          Books.title,
          Books.descr,
          (
            SELECT from bookshop.Authors as author {
              author.name
            } where Books.author_ID = author.ID
          ) as author,
          Books.coAuthor_ID,
          Books.genre_ID,
          Books.stock,
          Books.price,
          Books.currency_code,
          Books.dedication_addressee_ID,
          Books.dedication_text,
          Books.dedication_sub_foo,
          Books.dedication_dedication,
          Books.coAuthor_ID_unmanaged,
        }
      `)
  })
  it('expand after wildcard combines assoc from wildcard expansion (flat mode)', () => {
    const flatModel = cds.compile.for.nodejs(JSON.parse(JSON.stringify(model)))
    let query = cqn4sql(CQL`SELECT from bookshop.Books { *, author {name} }`, flatModel)
    const expected = CQL`SELECT from bookshop.Books as Books
        {
          Books.createdAt,
          Books.createdBy,
          Books.modifiedAt,
          Books.modifiedBy,
          Books.ID,
          Books.anotherText,
          Books.title,
          Books.descr,
          Books.author_ID,
          Books.coAuthor_ID,
          Books.genre_ID,
          Books.stock,
          Books.price,
          Books.currency_code,
          Books.dedication_addressee_ID,
          Books.dedication_text,
          Books.dedication_sub_foo,
          Books.dedication_dedication,
          Books.coAuthor_ID_unmanaged,
          (
            SELECT from bookshop.Authors as author {
              author.name
            } where Books.author_ID = author.ID
          ) as author
        }
      `
    //> REVISIT: with UCSN, the order of columns is different...
    if (flatModel.meta.unfolded)
      expect(JSON.parse(JSON.stringify(query.SELECT.columns.sort(customSort)))).to.deep.equal(
        expected.SELECT.columns.sort(customSort),
      )
    else expect(JSON.parse(JSON.stringify(query))).to.deep.equal(expected)
  })

  it('path expression after wildcard replaces assoc from wildcard expansion', () => {
    // "author.name as author" will replace the "author" association from Books -> no fk here
    let query = cqn4sql(CQL`SELECT from bookshop.Books { *, author.name as author }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books
        left outer join bookshop.Authors as author on author.ID = Books.author_ID
        {
          Books.createdAt,
          Books.createdBy,
          Books.modifiedAt,
          Books.modifiedBy,
          Books.ID,
          Books.anotherText,
          Books.title,
          Books.descr,
          author.name as author,
          Books.coAuthor_ID,
          Books.genre_ID,
          Books.stock,
          Books.price,
          Books.currency_code,
          Books.dedication_addressee_ID,
          Books.dedication_text,
          Books.dedication_sub_foo,
          Books.dedication_dedication,
          Books.coAuthor_ID_unmanaged,
        }
      `)
  })
  it('xpr after wildcard replaces assoc from wildcard expansion', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books { *, ('Stephen' || 'King') as author }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books
        {
          Books.createdAt,
          Books.createdBy,
          Books.modifiedAt,
          Books.modifiedBy,
          Books.ID,
          Books.anotherText,
          Books.title,
          Books.descr,
          ('Stephen' || 'King') as author,
          Books.coAuthor_ID,
          Books.genre_ID,
          Books.stock,
          Books.price,
          Books.currency_code,
          Books.dedication_addressee_ID,
          Books.dedication_text,
          Books.dedication_sub_foo,
          Books.dedication_dedication,
          Books.coAuthor_ID_unmanaged,
        }
      `)
  })
  it('val after wildcard replaces assoc from wildcard expansion', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Books { *, 'King' as author }`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Books as Books
        {
          Books.createdAt,
          Books.createdBy,
          Books.modifiedAt,
          Books.modifiedBy,
          Books.ID,
          Books.anotherText,
          Books.title,
          Books.descr,
          'King' as author,
          Books.coAuthor_ID,
          Books.genre_ID,
          Books.stock,
          Books.price,
          Books.currency_code,
          Books.dedication_addressee_ID,
          Books.dedication_text,
          Books.dedication_sub_foo,
          Books.dedication_dedication,
          Books.coAuthor_ID_unmanaged,
        }
      `)
  })

  it('If a shadowed column is excluded, the shadowing column is inserted where defined', () => {
    const input = CQL`SELECT from bookshop.Bar { 'first' as first, 'second' as createdAt, *, 'last' as ID } excluding { ID }`
    let query = cqn4sql(input, model)
    // original query is prototype of transformed query -> JSON.parse(…)
    expect(JSON.parse(JSON.stringify(query))).to.deep.equal(
      CQL`SELECT from bookshop.Bar as Bar {
        'first' as first,
        'second' as createdAt,
        Bar.stock,
        Bar.structure_foo,
        Bar.structure_baz,
        Bar.nested_foo_x,
        Bar.nested_bar_a,
        Bar.nested_bar_b,
        Bar.note,
        Bar.struct1_foo,
        Bar.nested1_foo_x,
        'last' as ID
      }`,
    )
  })

  it('inline wildcard does not ignore large binaries', () => {
    let inlineWildcard = CQL`select from bookshop.Books.twin as Books {
      ID,
      struct.{ * }
    }`

    expect(cqn4sql(inlineWildcard, model)).to.deep.equal(
      CQL`select from bookshop.Books.twin as Books {
        Books.ID,
        Books.struct_deepImage
      }`,
    )
  })

  it('MUST transform wildcard into explicit column refs (1)', () => {
    const input = CQL`SELECT from bookshop.Bar { * }`
    const inputClone = JSON.parse(JSON.stringify(input))
    let query = cqn4sql(input, model)
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Bar as Bar {
        Bar.ID,
        Bar.stock,
        Bar.structure_foo,
        Bar.structure_baz,
        Bar.nested_foo_x,
        Bar.nested_bar_a,
        Bar.nested_bar_b,
        Bar.note,
        Bar.createdAt,
        Bar.struct1_foo,
        Bar.nested1_foo_x
      }`,
    )

    expect(input).to.deep.equal(inputClone)
  })

  it('MUST transform wildcard into explicit column refs (2)', () => {
    let starExpansion = cqn4sql(
      CQL`SELECT from bookshop.Books { * }`, // resolve star into cols already
      model,
    )
    let noColumnsExpansion = cqn4sql(
      CQL`SELECT from bookshop.Books`, // resolve star into cols already
      model,
    )
    const expected = CQL`SELECT from bookshop.Books as Books {
      Books.createdAt,
      Books.createdBy,
      Books.modifiedAt,
      Books.modifiedBy,
      Books.ID,
      Books.anotherText,
      Books.title,
      Books.descr,
      Books.author_ID,
      Books.coAuthor_ID,
      Books.genre_ID,
      Books.stock,
      Books.price,
      Books.currency_code,
      Books.dedication_addressee_ID,
      Books.dedication_text,
      Books.dedication_sub_foo,
      Books.dedication_dedication,
      Books.coAuthor_ID_unmanaged
    }`
    expect(starExpansion).to.deep.equal(expected)
    expect(noColumnsExpansion).to.deep.equal(expected)
  })

  it('MUST transform wildcard into explicit column refs (3)', () => {
    let starExpansion = cqn4sql(
      CQL`SELECT from bookshop.Bar`, // resolve star into cols already
      model,
    )
    let noColumnsExpansion = cqn4sql(
      CQL`SELECT from bookshop.Bar`, // resolve star into cols already
      model,
    )
    expect(starExpansion).to.deep.equal(
      CQL`SELECT from bookshop.Bar as Bar {
        Bar.ID,
        Bar.stock,
        Bar.structure_foo,
        Bar.structure_baz,
        Bar.nested_foo_x,
        Bar.nested_bar_a,
        Bar.nested_bar_b,
        Bar.note,
        Bar.createdAt,
        Bar.struct1_foo,
        Bar.nested1_foo_x
      }`,
    )
    expect(noColumnsExpansion).to.deep.equal(
      CQL`SELECT from bookshop.Bar as Bar {
        Bar.ID,
        Bar.stock,
        Bar.structure_foo,
        Bar.structure_baz,
        Bar.nested_foo_x,
        Bar.nested_bar_a,
        Bar.nested_bar_b,
        Bar.note,
        Bar.createdAt,
        Bar.struct1_foo,
        Bar.nested1_foo_x
      }`,
    )
  })

  it('MUST transform wildcard into explicit column refs and respect order', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Bar {structure as beforeStar, *, structure as afterStar}`, // resolve star into cols already
      model,
    )
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Bar as Bar {
        Bar.structure_foo as beforeStar_foo,
        Bar.structure_baz as beforeStar_baz,
        Bar.ID,
        Bar.stock,
        Bar.structure_foo,
        Bar.structure_baz,
        Bar.nested_foo_x,
        Bar.nested_bar_a,
        Bar.nested_bar_b,
        Bar.note,
        Bar.createdAt,
        Bar.struct1_foo,
        Bar.nested1_foo_x,
        Bar.structure_foo as afterStar_foo,
        Bar.structure_baz as afterStar_baz
      }`,
    )
  })

  // skipped as queries with multiple sources are not supported (at least for now)
  it.skip('MUST transform wildcard into explicit column refs with multiple entities', () => {
    let query = cqn4sql(
      CQL`SELECT from bookshop.Books, bookshop.WithStructuredKey { * }`, // resolve star into cols already
      model,
    )
    expect(query).to.deep.eql(
      CQL`SELECT from bookshop.Books as Books, bookshop.WithStructuredKey as WithStructuredKey {
            Books.createdAt,
            Books.createdBy,
            Books.modifiedAt,
            Books.modifiedBy,
            Books.ID,
            Books.anotherText,
            Books.title,
            Books.descr,
            Books.author_ID,
            Books.coAuthor_ID,
            Books.genre_ID,
            Books.stock,
            Books.price,
            Books.currency_code,
            Books.dedication_addressee_ID,
            Books.dedication_text,
            Books.dedication_sub_foo,
            Books.dedication_dedication,
            Books.coAuthor_ID_unmanaged,
            WithStructuredKey.struct_mid_leaf,
            WithStructuredKey.struct_mid_anotherLeaf,
            WithStructuredKey.second
          }`,
    )
  })
  it('must not yield duplicate columns for already expanded foreign keys with OData CSN input', () => {
    const flatModel = cds.linked(cds.compile.for.nodejs(JSON.parse(JSON.stringify(model))))
    let query = cqn4sql(CQL`SELECT from bookshop.Books where author.name = 'Sanderson'`, flatModel)
    const expected = CQL`SELECT from bookshop.Books as Books
      left outer join bookshop.Authors as author on author.ID = Books.author_ID
      {
      Books.createdAt,
      Books.createdBy,
      Books.modifiedAt,
      Books.modifiedBy,
      Books.ID,
      Books.anotherText,
      Books.title,
      Books.descr,
      Books.author_ID,
      Books.coAuthor_ID,
      Books.genre_ID,
      Books.stock,
      Books.price,
      Books.currency_code,
      Books.dedication_addressee_ID,
      Books.dedication_text,
      Books.dedication_sub_foo,
      Books.dedication_dedication,
      Books.coAuthor_ID_unmanaged,
      } where author.name = 'Sanderson'
    `
    //> REVISIT: with UCSN, the order of columns is different...
    if (flatModel.meta.unfolded)
      expect(JSON.parse(JSON.stringify(query.SELECT.columns.sort(customSort)))).to.deep.equal(
        expected.SELECT.columns.sort(customSort),
      )
    else expect(JSON.parse(JSON.stringify(query))).to.deep.equal(expected)
  })

  it('must be possible to select already expanded foreign keys with OData CSN input', () => {
    const flatModel = cds.linked(cds.compile.for.nodejs(JSON.parse(JSON.stringify(model))))
    let query = cqn4sql(
      CQL`SELECT from bookshop.Books { genre_ID, author_ID } where author.name = 'Sanderson'`,
      flatModel,
    )
    const expected = CQL`SELECT from bookshop.Books as Books
      left outer join bookshop.Authors as author on author.ID = Books.author_ID
      {
      Books.genre_ID,
      Books.author_ID
      } where author.name = 'Sanderson'
    `
    //> REVISIT: with UCSN, the order of columns is different...
    if (flatModel.meta.unfolded)
      expect(JSON.parse(JSON.stringify(query.SELECT.columns.sort(customSort)))).to.deep.equal(
        expected.SELECT.columns.sort(customSort),
      )
    else expect(JSON.parse(JSON.stringify(query))).to.deep.equal(expected)
  })

  it.skip('must error out for clash of already expanded foreign keys with OData CSN input and manually expanded foreign key', () => {
    const odatamodel = cds.linked(cds.compile.for.nodejs(JSON.parse(JSON.stringify(model))))
    expect(() =>
      cqn4sql(CQL`SELECT from bookshop.Books { author, author_ID } where author.name = 'Sanderson'`, odatamodel),
    ).to.throw(/Can't flatten "author" as resulting element name conflicts with existing column "author_ID"/)
  })

  it('does not mistake "*" as wildcard in GROUP BY clause', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Bar { ID } group by '*'`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Bar as Bar { Bar.ID } group by '*'`)
  })
  it('does not mistake "*" as wildcard in ORDER BY clause', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Bar { ID } order by '*'`, model)
    expect(query).to.deep.equal(CQL`SELECT from bookshop.Bar as Bar { Bar.ID } order by '*'`)
  })

  it('ignores virtual field from wildcard expansion', () => {
    let query = cqn4sql(CQL`SELECT from bookshop.Foo { * }`, model)
    expect(query).to.deep.equal(
      CQL`SELECT from bookshop.Foo as Foo { Foo.ID, Foo.toFoo_ID, Foo.stru_u, Foo.stru_nested_nu }`,
    )
  })
})
