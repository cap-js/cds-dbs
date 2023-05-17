/* eslint-disable no-console */
class CustomReporter {
  constructor(globalConfig, reporterOptions, reporterContext) {
    this._globalConfig = globalConfig
    this._options = reporterOptions
    this._context = reporterContext
  }

  onRunComplete(testContexts, results) {
    const sections = {
      CSN: ['literals', 'definitions', 'CREATE', 'DROP'],
      CQN: ['SELECT', 'INSERT', 'UPSERT', 'UPDATE', 'DELETE'],
      HANA: ['functions'],
    }
    const categories = Object.keys(sections)
      .map(k => sections[k])
      .flat()
      .reduce((r, c) => {
        r[c] = true
        return r
      }, {})

    const complianceMap = {}

    results.testResults.forEach(result => {
      result.testResults.forEach(result => {
        const key = result.ancestorTitles.reverse().find(a => categories[a])
        const curCompliance = (complianceMap[key] = complianceMap[key] || {
          count: 0,
          pass: 0,
          fail: 0,
        })

        curCompliance.count++
        curCompliance[result.status === 'failed' ? 'fail' : 'pass']++
      })
    })

    console.log('| specification | compliance |')
    console.log(`| :--- | ---: |`)
    Object.keys(sections).forEach(k => {
      console.log(`| ${k} |  |`)
      sections[k].forEach(c => {
        const cur = complianceMap[c]
        if (!cur) {
          return
        }
        console.log(`| ${c} | (${cur.pass} / ${cur.count}) |`)
      })
    })
  }
}

module.exports = CustomReporter
