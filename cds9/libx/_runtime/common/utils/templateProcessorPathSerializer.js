const segmentSerializer = pathSegmentInfo => {
  const { key: tKey, row, elements, draftKeys } = pathSegmentInfo
  let keyNames = pathSegmentInfo.keyNames

  const keyValuePairs = keyNames
    .map(key => {
      let quote

      switch (elements[key].type) {
        case 'cds.String':
          quote = "'"
          break

        default:
          quote = ''
          break
      }

      const keyValue = row[key] ?? draftKeys?.[key]
      if (keyValue == null) return
      return `${key}=${quote}${keyValue}${quote}`
    })
    .filter(c => c)

  const keyValuePairsSerialized = keyValuePairs.join(',')
  const pathSegment = `${tKey}(${keyValuePairsSerialized})`
  return pathSegment
}

const templatePathSerializer = (elementName, pathSegmentsInfo) => {
  const pathSegments = pathSegmentsInfo.map(pathSegmentInfo => {
    if (typeof pathSegmentInfo === 'string') return pathSegmentInfo
    return segmentSerializer(pathSegmentInfo)
  })
  const path = `${pathSegments.join('/')}${pathSegments.length ? '/' : ''}${elementName}`
  return path
}

module.exports = templatePathSerializer
