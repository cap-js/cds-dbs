var { deploy } = require('@quadrio/postgres')
// eslint-disable-next-line no-console
deploy('*').to('db').catch(console.error)
