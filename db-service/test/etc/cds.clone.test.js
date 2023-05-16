const cds = require('@sap/cds/lib')
const { expect } = cds.test

describe('Cloning queries', () => {
  it('should create effectively equal clones with cds.ql.clone()', () => {
    let q1 = SELECT.from('Books').where({ ID: 201 })
    let q2 = cds.ql.clone(q1)
    expect(q2).to.not.equal(q1) // using strict equal (===)
    expect(q2).to.deep.equal(q1) // not using strict equal
    expect(q2).to.eql(q1) // shortcut for .to.deep.equal
    expect(q2).eqls(q1) // shortcut for .to.deep.equal
  })

  it('creates flat queries with .flat()', () => {
    let q1 = SELECT.from('Books').where({ ID: 201 })
    let q2 = cds.ql.clone(q1)

    expect(
      JSON.stringify(q1), //> {"SELECT":{"from":{"ref":["Books"]},"where":[{"ref":["ID"]},"=",{"val":201}]}}
    ).to.not.eql(
      JSON.stringify(q2), //> {"SELECT":{}}
    )

    expect(
      JSON.stringify(q1), //> {"SELECT":{"from":{"ref":["Books"]},"where":[{"ref":["ID"]},"=",{"val":201}]}}
    ).to.eql(
      JSON.stringify(q2.flat()), //> {"SELECT":{"from":{"ref":["Books"]},"where":[{"ref":["ID"]},"=",{"val":201}]}}
    )

    // WARNING: q.flat() modifies q! -> never use that in productive code !!!
  })

  it(`supports shallow clones`, () => {
    let q1 = SELECT.from('Books').where({ ID: 201 })
    let q2 = { ...q1 }

    expect(q2).to.eql(q1) //> IMPORTANT: breaks when we add enumerable elements to cds.ql.Query.prototype !!

    // 1) compare content
    expect(q2.SELECT).to.eql(q1.SELECT)

    // 2) compare shallow copies
    expect({ ...q2 }).to.eql({ ...q1 })

    // 3) force-assign the same proto
    Object.setPrototypeOf(q2, q1.__proto__)
    expect(q2).to.eql(q1) //> now it is equal
  })

  it(`works well with JSON-clones`, () => {
    let q1 = SELECT.from('Books').where({ ID: 201 })
    let q2 = JSON.parse(JSON.stringify(q1))

    expect(q2).to.eql(q1) //> IMPORTANT: breaks when we add enumerable elements to cds.ql.Query.prototype !!

    // 1) compare content
    expect(q2.SELECT).to.eql(q1.SELECT)

    // 2) compare shallow copies
    expect({ ...q2 }).to.eql({ ...q1 })

    // 3) force-assign the same proto
    Object.setPrototypeOf(q2, q1.__proto__)
    expect(q2).to.eql(q1) //> now it is equal
  })
})
