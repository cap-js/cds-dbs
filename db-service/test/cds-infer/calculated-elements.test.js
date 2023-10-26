'use strict'

const _inferred = require('../../lib/infer')
const cds = require('@sap/cds/lib')
const { expect } = cds.test

describe('Infer types of calculated elements in select list', () => {
  let model
  beforeAll(async () => {
    model = cds.model = await cds.load(__dirname + '/../bookshop/db/booksWithExpr').then(cds.linked)
  })
  it('calc element has type or has cast', () => {
    let inferred = _inferred(
      CQL`SELECT from booksCalc.Books {
          ID,
          area,
          area as strArea : String,
          cast(area as Integer) as areaCastedToInt
        }`,
      model,
    )
    let { Books } = model.entities
    expect(inferred.elements).to.deep.equal({
      ID: Books.elements.ID,
      area: Books.elements.area,
      strArea: {
        type: 'cds.String',
      },
      areaCastedToInt: {
        type: 'cds.Integer',
      },
    })
  })
  it('calc elements via wildcard', () => {
    let inferred = _inferred(
      CQL`SELECT from booksCalc.Books { * } excluding { length, width, height, stock, price}`,
      model,
    )
    let { Books } = model.entities
    expect(inferred.elements).to.deep.equal({
      ID: Books.elements.ID,
      title: Books.elements.title,
      author: Books.elements.author,
      stock2: Books.elements.stock2,
      ctitle: Books.elements.ctitle,
      areaS: Books.elements.areaS,
      area: Books.elements.area,
      volume: Books.elements.volume,
      storageVolume: Books.elements.storageVolume,
      authorLastName: Books.elements.authorLastName,
      authorName: Books.elements.authorName,
      authorFullName: Books.elements.authorFullName,
      authorFullNameWithAddress: Books.elements.authorFullNameWithAddress,
      authorAdrText: Books.elements.authorAdrText,
      authorAge: Books.elements.authorAge,
      youngAuthorName: Books.elements.youngAuthorName,
      authorAgeNativePG: Books.elements.authorAgeNativePG,
      authorAgeInDogYears: Books.elements.authorAgeInDogYears,
    })
  })
})
