const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const alphabetize = (_, i) => alphabet[i % alphabet.length]

module.exports = [
  {
    string: null,
    char: null,
    short: null,
    medium: null,
    large: null,
    blob: null,
  },
  {
    string: undefined,
    char: undefined,
    short: undefined,
    medium: undefined,
    large: undefined,
    blob: undefined,
    '=string': null,
    '=char': null,
    '=short': null,
    '=medium': null,
    '=large': null,
    '=blob': null,
  },
  {
    string: 'Simple String',
  },
  {
    char: 'A',
  },
  {
    large: () => [...new Array(1000)].map(alphabetize).join(''),
  },
  {
    string: '💾',
  },
  {
    string:
      'Simplified Chinese: 中国, Traditional Chinese: 中國, Korean: 대한민국, Japanese: 日本国, Russion: Российская Федерация, Greek: Ελληνική Δημοκρατία',
  },
  /* Ignoring transformations
  {
    char: () => alphabet,
    '=char': () => alphabet.substring(0, 1)
  },
  {
    short: () => alphabet,
    '=short': () => alphabet.substring(0, 10)
  },
  {
    medium: () => [...new Array(100)].map(alphabetize).join('')
  },
  {
    medium: () => [...new Array(101)].map(alphabetize).join(''),
    '=medium': () => [...new Array(100)].map(alphabetize).join('')
  },
  {
    large: () => [...new Array(10001)].map(alphabetize).join(''),
    '=large': () => [...new Array(10000)].map(alphabetize).join('')
  },
  /*
  { // Have to fix jest worker max memory settings for 2gb limit testing
    blob: () => [...new Array(1 << 30)].map(alphabetize).join('')
  }
  */
  /*
  {
    blob: () => Buffer.from([...new Array(1 << 20)].map(alphabetize).join(''))
  },
*/
]
