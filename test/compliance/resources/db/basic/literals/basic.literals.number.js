module.exports = [
  {
    integer: null,
  },
  {
    integer: -2147483648,
  },
  {
    integer: 2147483647,
  },
  {
    integer64: '9223372036854775806',
  },
  {
    integer64: '-9223372036854775808',
  },
  {
    decimal: '3.14153',
    '=decimal': 3.14153 //> 3.1415 as soon as precision is enforced
  },
  {
    decimal: 3.14
  },
  {
    double: 3.14159265358979
  },
  {
    float: '3.14159265358979',
    '=float': 3.14159265358979
  },
  {
    float: '-9007199254740991',
    '=float': -9007199254740991
  },
  {
    float: '9007199254740991',
    '=float': 9007199254740991
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
