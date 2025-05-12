const { readFileSync } = require ('fs')

const SEPARATOR = /[,;\t]/
const CSV = module.exports = { read, parse }

function read (res) {
  try{
    return CSV.parse (readFileSync (res, 'utf-8'))
  } catch {/* ignore */}
}

function parse (csv) {
  if (csv[0] === BOM)  csv = csv.slice(1)
  let sep
  // this also means that \r\n within quotes is NOT retained but normalized to \n.  We accept this for now.
  const lines = csv.split(/\r?\n/)
  const rows = [], headers = []

  let val, values=[]
  let inString=false, quoted=false
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l]
    if (!rows.length && _ignoreLine (line))  continue
    if (!sep)  [sep] = SEPARATOR.exec(line)||[';']
    if (inString)  val += '\n' // overflow from last line
    else val = undefined

    let currCol=0, c
    for (let i=0; i<line.length; ) {
      c = line[i++]
      if (c === sep && !inString) {  // separator
        currCol++
        if (!rows.length && val !== undefined)  headers.push (currCol)     // skip column if header value is empty
        if (headers.includes(currCol))  values.push (_value4(val, quoted)) // skip value if column was skipped
        val = undefined, quoted = false //> start new val
      }
      else if (c === '"' && val === undefined) { // start quoted string
        val = ''
        inString = true
      }
      else if (c === '"' && inString) { // within quoted string
        if (line[i] === '"')  val += line[i++]  // escape quote:  "" > "
        else inString = false, quoted = true // stop string
      }
      else {  // normal char
        if (val === undefined)  val = ''
        val += c
      }
    }

    // finish line w/ remaining value
    if (!inString || l === lines.length-1 ) { // unless unterminated string and more lines to come
      currCol++
      if (!rows.length && val !== undefined)  headers.push(currCol)  // skip column if header value is empty
      if ((val !== undefined || c === sep) && headers.includes(currCol))  values.push (_value4(val, quoted))
      if (values.length > 0)  { rows.push (values); values = [] }
    }
  }
  return rows
}

function _value4 (val, quoted = false) {
  if (quoted)  return val
  if (val)  val = val.trim()
  if (val === 'true') return true
  else if (val === 'false') return false
  else return val
}

function _ignoreLine(line) {
  return line[0] === '#' || !line.trim().length
}

const BOM = '\ufeff'
