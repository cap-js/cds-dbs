// process.env.OLD_HANA = '1'
process.env.DEBUG = 'trace'

describe('hana', () => {
  require('../../test/scenarios/sflight/integration.test')
})

afterAll(async () => {
  const fs = require('fs').promises
  const dur = t => t[0].start - t[t.length - 1].stop
  const traces = global._traces
    .filter(t => typeof t[0] !== 'string')
    .sort((a, b) => dur(a) - dur(b))
    //.map(t => `${t[0].stop - t[0].start} ${t[0].details[0]} ${t[0].details[1]}`)
    .map(t => t.toString({ truncate: a => a }))

  await fs.writeFile(__dirname + `/traces${process.env.OLD_HANA === '1' ? '-old' : '-new'}.log`, traces.join('\n\n'))
})
