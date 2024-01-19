const  { Readable } = require('stream')

const generator = function*() {
  yield Buffer.from('Simple Large Binary')
}

module.exports = [
  {
    binary: null,
    largebinary: null,
  },
  {
    binary: Buffer.from('Simple Binary')
  },
  {
    binary: Buffer.from('Simple Binary').toString('base64'),
    '=binary': Buffer.from('Simple Binary')
  },
  {
    largebinary: Buffer.from('Simple Large Binary'),
    '=largebinary': () => Readable.from(generator())  
  },
  {
    largebinary: Buffer.from('Simple Large Binary').toString('base64'),
    '=largebinary': () => Readable.from(generator())  
  },
  {
    largebinary: Readable.from(generator()),
    '=largebinary': () => Readable.from(generator())  
  }
]
