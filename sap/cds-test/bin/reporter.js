const { BRIGHT, BOLD, INVERT, GRAY, GREEN, RESET, LF='\n', DIMMED, YELLOW, RED } = require('./colors')
const PASS = '\x1b[38;5;244m'
const FAIL = '\x1b[38;5;244m' // '\x1b[38;5;124m'
const SKIP = RESET+DIMMED
const { relative } = require('node:path'), cwd = process.cwd(), local = f => relative(cwd,f)
const { inspect } = require('node:util')
/* eslint-disable no-console */

module.exports = function report_on (test,o) {

  const files = o.files
  const suites = { passed:[], failed:[] }
  const tests = { passed:0, failed:0, todo:0, skipped:0, recent:null }

  // monkey-patch test.on to support filter functions like root, leaf, any
  const {on} = test; test.on = (eve,filter,fn) => on.call (test, 'test:'+eve, !fn ? fn = filter : x => filter(x) && fn(x))
  const root = x => !x.nesting && x.name.endsWith('.js')
  const leaf = x => x.name[0] !== '<' && x.details?.type !== 'suite'
  const any = x => x.name[0] !== '<'
  const _indent4 = x => '  '.repeat (x.nesting + root(x))

  // add handlers according to options
  if (o.debug ??= process.env.debug) return debug(o.debug) // eslint-disable-line no-cond-assign
  if (o.verbose || !o.silent && files.length < 2) verbose(); else silent()
  if (o.unmute) unmute()
  common()
  return test


  /**
   * Adds common handlers to report test results.
   * Used in silent mode as well as verbose mode.
   */
  function common() {

    test.on ('pass', leaf, x => {
      x.skip ? tests.skipped++ : x.todo ? tests.todo++ : tests.passed++
    })

    test.on ('fail', x => {
      if (x.details.error.failureType in { subtestsFailed:1, cancelledByParent: 2 }) return
      tests.failed++
      if (o.silent) console.log(_indent4(x), BOLD + RED, 'X' + RESET+GRAY, x.name, RESET)
      if (o.quiet) return
      let err = x.details.error.cause || x.details.error
      let msg = typeof err === 'string' ? err : inspect (err, { colors:true, depth:11 })
      if (err.code === 'ERR_ASSERTION') msg = msg.replace(/\s+.*lib\/expect\.js:.*\)/g,'')
      if (x.file && x.details.error.failureType === 'hookFailed') console.log (
        RED, LF, _indent4(x), 'Error:', x.details.error.message,
        'at ' + local(x.file)+':'+x.line+':'+x.column, RESET
      )
      console.log (msg
        .replace(/\s+.*async Promise.all \(index \d+\)/g,'')
        .replace(/\s+.*\(node:.*/g,'')
        .replace(/^/gm, _indent4(x)+'  ')
      )
      if (!err.message && !o.unmute)
        console.log('   ', INVERT+YELLOW, 'NOTE', RESET+YELLOW, '--unmute app log output to see error details.', RESET )
      console.log(RESET)
    })

    test.on ('complete', root, x => {
      (x.details.passed ? suites.passed : suites.failed) .push (x.file)
    })

    test.once ('fail', ()=> process.exitCode = 1)
    process.on('exit', summary)
  }


  /**
   * Adds handlers to report test results on root-level only,
   * i.e., on test file level.
   */
  function silent() {
    console.log() // start with an initial blank line
    test.on ('complete', root, x => {
      if (x.details.passed) console.log (GREEN,' ✔', RESET+PASS, local(x.name))
      else console.log (BRIGHT+RED,' X', RESET+RED, local(x.name), RESET)
    })
  }


  /**
   * Adds handlers to report test results in detail,
   * i.e., on nested tests level.
   */
  function verbose() {

    // report tests on file level
    let i=0
    if (files.length > 1 || files[0] !== process.argv[2] && files[0] !== process.argv[3]) // if not only one completely specified test file
      test.on ('dequeue', x => x.name === '<next>' && console.log (LF+GRAY+'—'.repeat(77)+BRIGHT, LF+ files[i++], RESET))

    // report test suites (i.e, describe/suite/test with subtests)
    let _recent = null, _recent_nesting = 0 // to add newlines before outer leaf tests following a suite
    test.on ('start', any, x => {
      if (_recent) {
        console.log(LF+_indent4(_recent), '', _recent.name)
        _recent_nesting = x.nesting
      }
      _recent = x
    })

    // report passed tests on leaf level
    test.on ('pass', leaf, x => {
      if (_recent_nesting > x.nesting && leaf(x)) console.log()
      x.skip ? console.log(_indent4(x), YELLOW, '○' + SKIP, local(x.name), RESET) :
      x.todo ? console.log(_indent4(x), YELLOW, '+' + SKIP, local(x.name), RESET) :
      /*pass*/ console.log(_indent4(x), GREEN,  '✔' + PASS, local(x.name), RESET)
      _recent_nesting = _recent?.nesting
      _recent = null
    })

    // report failed tests on leaf level
    test.on ('fail', leaf, x => {
      if (_recent_nesting > x.nesting && leaf(x)) console.log()
      console.log(_indent4(x), BOLD+RED, 'X' + RESET+FAIL, local(x.name), RESET)
      _recent_nesting = _recent?.nesting
      _recent = null
    })
  }


  /**
   * Adds handlers to pipe stdout and stderr of the tests themselves
   * or the app servers started in there.
   */
  function unmute() {
    test.on ('stdout', x => process.stdout.write(x.message))
    test.on ('stderr', x => process.stderr.write(x.message))
  }


  /**
   * Adds handlers to debug test stream events.
   */
  function debug (events) {
    inspect.defaultOptions.depth = 11
    if (events === 'all') events = 'enqueue,dequeue,start,pass,fail,complete,error'
    for (let eve of events.split(',')) test.on (eve, x => {
      if (x.details) x.details = { ...x.details }
      // delete x.testNumber
      // delete x.details
      // delete x.file
      // delete x.line
      // delete x.column
      console.log(INVERT + YELLOW, eve, RESET, { ...x })
    })
  }


  /**
   * Prints the summary of passed, skipped, failed tests.
   */
  function summary () {
    const time = (performance.now() / 1000).toFixed(3)
    console.log(
      report ('passed', BOLD+GREEN) +
      report ('failed', BOLD+RED) +
      report ('skipped', YELLOW) +
      report ('todo', YELLOW) +
      `\n${PASS} ${time}s ${RESET}\n`
    )
    function report (kind, color) {
      const t = tests[kind], s = suites[kind]?.length || 0
      if (t == 0) return ''
      if (s == 0 || files.length == 1) return LF+`${color} ${t} ${kind} ${RESET}`
      else return LF+`${color} ${t} in ${s} suite${s==1?'':'s'} ${kind} ${RESET}`
    }
    const _recent = require('os').userInfo().homedir + '/.cds-test-recent.json'
    const recent = require('fs').existsSync(_recent) ? require(_recent) : {}
    if (!o.recent && !o.passed && !o.failed) recent.options = {...o, argv:process.argv.slice(2) }
    if (!o.failed) recent.passed = suites.passed // only update recent.passed if not called w/ --failed
    if (!o.passed) recent.failed = suites.failed // only update recent.failed if not called w/ --passed
    require('fs').writeFileSync(_recent, JSON.stringify(recent,null,2))
  }

}
