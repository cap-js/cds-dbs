const cds = require('../../cds.js')
const { Readable } = require('stream')

const { gen, rows } = require('./data.js')
const { run } = require('./perf.js')

describe('Map - CLOB', () => {
  const { expect } = cds.test(__dirname, __dirname + '/clob.cds')

  test('perf', async () => {
    const { Map } = cds.entities

    console.log('Starting Insert...')
    const s = performance.now()
    await INSERT(Readable.from(gen(), { objectMode: false })).into(Map)
    const dur = performance.now() - s
    console.log('Finished Insert:', dur, '(', (rows / dur), 'rows/ms)')

    const [{ count: rowCount }] = await cds.ql`SELECT count() from ${Map}`
    expect(rowCount).eq(rows)
    console.log('Validated Insert.')

    /* HANA
Starting Insert...
Finished Insert: 10261.39113 ( 3.19332920701172 rows/ms)
Validated Insert.
$top=30              avg: 3 ms cold: 30 ms
ID='1'               avg: 3 ms cold: 34 ms
    */

    /* postgres
Starting Insert...
Finished Insert: 13024.595653 ( 2.51585545325182 rows/ms)
Validated Insert.
$top=30              avg: 6 ms cold: 9 ms
ID='1'               avg: 0 ms cold: 4 ms
    */

    /* sqlite
Starting Insert...
Finished Insert: 2072.096841 ( 15.813932704123069 rows/ms)
Validated Insert.
$top=30              avg: 1 ms cold: 2 ms
ID='1'               avg: 0 ms cold: 1 ms
    */

    await run('$top=30', cds.ql`SELECT ID, map FROM ${Map} LIMIT ${30}`)
    await run(`ID='1'`, cds.ql`SELECT ID, map FROM ${Map} WHERE ID=${'1'} LIMIT ${1}`)
  })

})