// convert the standard base64 encoding to the URL-safe variant
const toBase64url = value => {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'base64')
  const base64url = buffer.toString('base64url')
  // Buffer base64url encoding does not have padding by default -> add it
  return base64url.padEnd(Math.ceil(base64url.length / 4) * 4, '=')
}

module.exports = { toBase64url }
