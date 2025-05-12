module.exports = (target, srv, result, keys_as_segments) => {
  const targetName = target.name.replace(`${srv.definition.name}.`, '')
  if (!target.keys) return targetName

  const filteredKeys = [...target.keys].filter(k => !k.isAssociation).map(k => k.name)
  if (!filteredKeys.every(k => k in result)) return

  const keyValuePairs = filteredKeys.reduce((acc, key) => {
    const value = result[key]
    if (result[key] === undefined) return acc

    if (Buffer.isBuffer(value)) {
      acc[key] = value.toString('base64')
    } else {
      const _type = target.elements[key]._type
      if (typeof value === 'string' && _type !== 'cds.UUID') acc[key] = `'${value}'`
      else acc[key] = value
    }

    return acc
  }, {})

  if (keys_as_segments) { 
    let location = targetName
    for (const k in keyValuePairs) location += `/${keyValuePairs[k]}` 
    return location 
  }

  let keys
  const entries = Object.entries(keyValuePairs)
  if (entries.length === 1) {
    keys = entries[0][1]
    if (target.elements[entries[0][0]]['@odata.Type'] === 'Edm.String') keys = `'${keys}'`
  } else {
    keys = entries
      .map(([key, value]) => `${key}=${target.elements[key]['@odata.Type'] === 'Edm.String' ? `'${value}'` : value}`)
      .join(',')
  }

  return `${targetName}(${keys})`
}
