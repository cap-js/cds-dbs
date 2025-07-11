const cds = require('./cds.js')

describe('deploy', () => {
  cds.test(__dirname,'index.cds')

  test('execute', async () => {
    return cds.deploy(cds.options.from).to('db')
  })
})