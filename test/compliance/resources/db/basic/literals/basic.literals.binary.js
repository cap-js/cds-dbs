const buff = Buffer.from(new Uint8Array(1 << 16))

module.exports = [
  {
    binary: null,
  },
  {
    largeBinary: null,
  },
  {
    binary: buff,
    '=binary': buff.toString('base64'),
  },
  {
    largeBinary: buff,
    '=largeBinary': buff.toString('base64'),
  },
]
