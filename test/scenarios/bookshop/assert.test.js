const cds = require('../../cds.js')
const bookshop = cds.utils.path.resolve(__dirname, '../../bookshop')

const admin = {
  auth: {
    username: 'alice',
  },
}

describe('Bookshop - assert', () => {
  const { expect, POST } = cds.test(bookshop)

  before(async () => {
    const { Books, Genres } = cds.entities

    const asserts = []
    let newSubselect = 'SELECT '
    let sep = ''
    for (const col in Books.elements) {
      const element = Books.elements[col]
      if (!element.virtual && !element.association && !element.value) {
        newSubselect += `${sep}new.${col}`
        sep = ','
      }

      const assert = element['@assert']
      if (!assert) continue

      const query = cds.ql.SELECT([{ xpr: assert.xpr, as: 'error' }]).from(Books)
      const { sql } = cds.db.cqn2sql(query, {})

      asserts.push(sql)

      if (asserts.length === 1) break
    }

    const inner = asserts.map(sql => sql.replace(`${Books}`, `(${newSubselect})`)).join('\nUNION ALL\n')

    const sql = `
    CREATE TRIGGER ${Books}_insert BEFORE INSERT ON ${Books}
      BEGIN
        SELECT RAISE(ABORT, error) FROM (
          SELECT string_agg(error, '\n') AS error FROM (
            ${inner}
          ) WHERE error IS NOT NULL
        ) WHERE error IS NOT NULL;
      END;
    `

    await cds.run(sql)
  })

  test('Books', async () => {
    const res = await POST(
      '/admin/Books',
      {
        ID: 280,
        title: 'Dracula',
        descr:
          "Dracula is a classic Gothic horror novel about a vampire's attempt to spread the undead curse from Transylvania to England.",
        author: { ID: 101 },
        genre: { ID: 10 },
        stock: 5,
        price: '12.05',
        currency: { code: 'USD' },
      },
      admin,
    )
    debugger
  })
})
