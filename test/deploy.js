var { deploy } = require('@cap-js/postgres')
// eslint-disable-next-line no-console
deploy('*').to('db').catch(console.error)
