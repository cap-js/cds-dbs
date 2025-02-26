module.exports.run = async function (name, query) {
  return cds.tx(async tx => {
    const parseRows = typeof query === 'string'

    let s = performance.now()
    const res = await tx.run(query)
    if (parseRows) tx.parseRows(res)
    const cold = performance.now() - s
    s = performance.now()

    const runs = 100
    for (let i = 0; i < runs; i++) {
      const res = await tx.run(query)
      if (parseRows) tx.parseRows(res)
    }
    const dur = performance.now() - s
    console.log(name.padEnd(20, ' '), 'avg:', (dur / runs) >>> 0, 'ms', 'cold:', cold >>> 0, 'ms')
  })
}