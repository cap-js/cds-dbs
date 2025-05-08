const validateIfNoneMatch = (target, header, result) => {
  if (target._etag && header && result) {
    let ifm = extractIfNoneMatch(header)
    if (ifm === '*') return true
    if (result[target._etag.name] === ifm) return true
  }
}

const extractIfNoneMatch = header => {
  if (header) {
    if (header.startsWith('W/')) header = header.substring(2)
    if (header.startsWith('"') && header.endsWith('"')) header = header.substring(1, header.length - 1)
  }

  return header
}

module.exports = {
  validateIfNoneMatch,
  extractIfNoneMatch
}
