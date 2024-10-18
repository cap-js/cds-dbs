module.exports = [
  {
    integer8: null,
  },
  {
    integer8: 0,
  },
  {
    integer8: 255,
  },
  /* REVISIT: UInt8 is not allowed to be over/under flow 0-255
  {
    integer8: -1,
    '!': /./,
  },
  {
    integer8: 256,
    '!': /./,
  },
  */
  {
    integer16: null,
  },
  {
    integer16: 32767,
  },
  {
    integer16: -32768,
  },
  /* REVISIT: UInt16 is not allowed to be over/under flow -32768 - 32767
  {
    integer16: 32768,
    '!': /./,
  },
  {
    integer16: -32769,
    '!': /./,
  },
  */
  {
    integer32: null,
  },
  {
    integer32: -2147483648,
  },
  {
    integer32: 2147483647,
  },
  {
    integer64: null,
  },
  {
    integer64: '9223372036854775806',
  },
  {
    integer64: '-9223372036854775808',
  },
  {
    decimal: null
  },
  {
    decimal: 0,
    '=decimal': '0.0000'
  },
  {
    decimal: 1,
    '=decimal': '1.0000'
  },
  {
    decimal: '3.14153',
    '=decimal': '3.1415'
  },
  {
    decimal: 3.14,
    '=decimal': '3.1400'
  },
  {
    double: 3.14159265358979
  },
  {
    float: '3.14159265358979',
    '=float': /^3\.14159265358979/
  },
  {
    float: '-9007199254740991',
    '=float': /-9007199254740991/
  },
  {
    float: '9007199254740991',
    '=float': /^9007199254740991/
  },
  /* Ignoring transformations
  {
    decimal: 3.141592653589793,
    '=decimal': 3.1415
  },
  {
    decimal: 31415,
    '=decimal': 5
  },
  */
]
