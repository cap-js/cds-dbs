const rows = 1 << 15
const maps = 1e2
const gen = function* () {
  yield '['
  let sep = ''
  for (let ID = 0; ID < rows; ID++) {
    let row = `${sep}{"ID":${ID},"map":[`
    let rowSep = ''
    for (let key = 0; key < maps; key++) {
      if (rowSep) row += rowSep
      else rowSep = ','
      row += `{"up__ID":"${ID}","key":"${key}","value":"a value for \\"${key}\\""}`
    }
    row += ']}'
    yield row
    sep = ','
  }
  yield ']'
}

module.exports = { rows, maps, gen }