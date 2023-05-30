/* eslint-disable no-console */
class CustomReporter {
  constructor(globalConfig, reporterOptions, reporterContext) {
    this._globalConfig = globalConfig
    this._options = reporterOptions
    this._context = reporterContext
  }

  onRunComplete(testContexts, results) {
    const databases = {}

    // Loop over all test files
    results.testResults.forEach(result => {
      // Loop over all tests in a single file
      const database = /\/([^/]*)\/test\//.exec(result.testFilePath)[1]
      databases[database] = databases[database] || {}
      const currentReport = databases[database]

      result.testResults.forEach(result => {
        ;[...(result.retryReasons || []), ...result.failureDetails].forEach(e => {
          if (e.message[0] !== '#') return
          e.message.split('\n').forEach(m => {
            m.split('#').reduce((l, c) => {
              c = c.trim()
              if (c === '') return l
              l[c] = l[c] || {}
              return l[c]
            }, currentReport)
          })
        })
      })
    })

    const print = function (level, prefix) {
      Object.keys(level)
        .sort((a, b) => a.localeCompare(b))
        .map(k => {
          const l = level[k]
          console.log(prefix + '- ' + k.trim())
          print(l, prefix + '  ')
        })
      return true
    }

    print(databases, '')
  }
}

module.exports = CustomReporter
