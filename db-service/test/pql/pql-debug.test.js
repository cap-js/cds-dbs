// Enable the `pql` debug logger BEFORE @cap-js/sqlite / the SQL service is loaded, so the
// SQLService.cqn2sql debug wrapper gets installed. That wrapper transforms every query a
// second time to render the PQL log line; a non-idempotent first-pass transform used to
// poison the real roundtrip (which runs cqn4sql again).
process.env.DEBUG = 'pql'

const cds = require('../../../test/cds')
const { expect } = cds.test.in(__dirname)

describe('DEBUG=pql transforms the query twice', () => {
  cds.test()

  // The arithmetic self-referential SET (`stock = stock - 1`) is the shape whose
  // alias-prefixed `UPDATE.with` ref does not survive a second infer pass. Under
  // DEBUG=pql this used to fail with:
  //   Error: "Books" not found in the elements of "sap.capire.bookshop.Books"
  test('UPDATE … with arithmetic SET is not poisoned by the second cqn4sql pass', async () => {
    const db = await cds.connect.to('db')
    const q = UPDATE('sap.capire.bookshop.Books')
      .where('ID = 201')
      .with({ stock: { xpr: [{ ref: ['stock'] }, '-', { val: 1 }] } })

    let err
    try {
      await db.run(q)
    } catch (e) {
      err = e
    }
    expect(err, err && err.message).to.be.undefined
  })
})
