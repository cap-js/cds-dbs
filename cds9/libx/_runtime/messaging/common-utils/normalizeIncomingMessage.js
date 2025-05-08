const _JSONorString = string => {
  try {
    return JSON.parse(string)
  } catch {
    return string
  }
}

// Some messaging systems don't adhere to the standard that the payload has a `data` property.
// For these cases, we interpret the whole payload as `data`.
const normalizeIncomingMessage = message => {
  const _payload = typeof message === 'object' ? message : _JSONorString(message)
  let data, headers
  if (typeof _payload === 'object' && 'data' in _payload) {
    data = _payload.data
    headers = { ..._payload }
    delete headers.data
  } else {
    data = _payload
    headers = {}
  }

  return {
    data,
    headers
  }
}

module.exports = normalizeIncomingMessage
