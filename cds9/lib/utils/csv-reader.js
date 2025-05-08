const { createReadStream, createWriteStream, promises: fsp } = require('fs')
const { Readable } = require('stream')
const cds = require('../../lib')

const SEPARATOR = /[,;\t]/

exports.parse = cds.parse.csv

exports.serialize = function (rows, columns, bom = '\ufeff') {
  let csv = bom + (columns || Object.keys(rows[0])).join(';') + "\n"
  for (let key in rows) csv += `${key};${rows[key]}\r\n`
  return csv
}

exports.readHeader = async function (inStream, o = { ignoreComments: true }) {
  let delimiter = ';'
  let cols = []
  let filtered = false
  await _filterLines(inStream, null, (line, readLine) => {
    if (!cols.length) {
      if (o.ignoreComments && _ignoreLine(line)) {
        filtered = true
        return false
      }
      [delimiter] = SEPARATOR.exec(line) || [';']
      cols = line.split(delimiter).map(each => each.trim()).filter(each => each.length)
      readLine.close() // signal that we have seen enough --> this only ends the readLine interface
    }
    return true
  })

  inStream.destroy() // destroy the stream to avoid leaks of file descriptors
  return { cols, delimiter, filtered }
}

exports.stripComments = async function (file, outStream) {
  // most files don't need filtering, so do a quick check first
  const { filtered } = await exports.readHeader(createReadStream(file))
  if (!filtered) return false

  // buffer whole content so that we can write the out file
  const inStream = Readable.from([await fsp.readFile(file)])
  // clears the output file
  outStream = outStream || createWriteStream(file)
  let prelude = true
  await _filterLines(inStream, outStream, line => {
    if (prelude) {
      if (_ignoreLine(line)) return false
      prelude = false
    }
    // skip empty lines - HANA cannot handle them, e.g. at end of the file
    return line.trim().length > 0
  })
  return true
}

function _ignoreLine(line) {
  return line[0] === '#' || !line.trim().length
}

function _filterLines(input, out, filter) {
  return new Promise((resolve, reject) => {
    const rl = require('readline').createInterface({ input, crlfDelay: Infinity })
    const resumeOnDrain = () => rl.resume()
    let filtered = false
    rl.on('line', line => {
      if (filter(line, rl)) {
        if (out && !out.write(line + '\n')) {
          rl.pause() // pause when writable signals so
          out.removeListener('drain', resumeOnDrain) // avoid too many listeners
          out.once('drain', resumeOnDrain)
        }
      }
      else filtered |= true
    })
    rl.on('error', reject)
    rl.on('close', () => out ? out.end() : resolve(filtered))
    if (out) out.on('finish', () => resolve(filtered))
  })
}
