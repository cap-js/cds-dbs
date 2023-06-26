const StandardFunctions = {
  average: x => `avg(${x})`,
}

const HANAFunctions = {
  // https://help.sap.com/docs/SAP_HANA_PLATFORM/4fe29514fd584807ac9f2a04f6754767/f12b86a6284c4aeeb449e57eb5dd3ebd.html
}

for (let each in HANAFunctions) HANAFunctions[each.toUpperCase()] = HANAFunctions[each]

module.exports = { ...StandardFunctions, ...HANAFunctions }
