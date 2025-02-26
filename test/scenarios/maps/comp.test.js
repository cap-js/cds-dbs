const cds = require('../../cds.js')
const { Readable } = require('stream')

const { gen, rows, maps } = require('./data.js')
const { run } = require('./perf.js')

describe('Map - Composition', () => {
  const { expect } = cds.test(__dirname, __dirname + '/comp.cds')

  test('perf', async () => {
    const { Map } = cds.entities
    let s, dur

    console.log('Starting Insert...')
    s = performance.now()
    await INSERT(Readable.from(gen(), { objectMode: false })).into(Map)
    dur = performance.now() - s
    console.log('Finished Insert:', dur, '(', (rows / dur), 'rows/ms)')

    const [{ count: rowCount }] = await cds.ql`SELECT count() FROM ${Map}`
    const [{ count: mapCount }] = await cds.ql`SELECT count() FROM ${Map}.map`
    expect(rowCount).eq(rows)
    expect(mapCount).eq(maps * rows)
    console.log('Validated Insert.')

    /*
Starting Insert...
Finished Insert: 28935.987634 ( 1.1324306747179196 rows/ms)
Validated Insert.
$top=30              avg: 18 ms cold: 165 ms
ID='1'               avg: 4 ms cold: 83 ms
    */

    await run('$top=30', cds.ql`SELECT ID, map {*} FROM ${Map} LIMIT ${30}`)
    await run(`ID='1'`, cds.ql`SELECT ID, map {*} FROM ${Map} WHERE ID=${'1'} LIMIT ${1}`)
  })

})