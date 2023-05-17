// TODO: Add HANA TYPE EXPECTATIONS
module.exports = [
  {
    binary: null,
  },
  /*
  REVISIT: investigate why this is always considered binary by sqlite
  {
    binary: () => Buffer.from('binary'),
    '=binary': 'binary'
  },
  {
    binary: 'binary'
  }
  */
]
