const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

describe('Bookshop - assertions', () => {
  const { expect } = cds.test(bookshop)
  let CatalogService, cats

  before("bootstrap the database", async () => {
    CatalogService = cds.services.CatalogService;
    expect(CatalogService).not.to.be.undefined;

    cats = await cds.connect.to("CatalogService");
  });

  test('simple assertion', async () => {
    const { Books } = cds.entities
    await INSERT({ ID: 42, title: 'Harry Potter and the Chamber of Secrets', stock: 15 }).into(Books)
    // try to withdraw more books than there are in stock
    await cats.tx({ user: "alice" }, async () => {
        await expect( cats.send("submitOrder", { book: 42, quantity: 16 }) )
        .to.be.rejectedWith(/The stock must be greater than 0 after withdrawal/)
    });
      
      // stock fpr harry potter should still be 15
    const book = await SELECT.one.from(Books).where({ ID: 42 })
    expect(book.stock).to.equal(15)
  })
})
