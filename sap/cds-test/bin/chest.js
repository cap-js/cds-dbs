#!/usr/bin/env node
/* eslint-disable no-console */

const options = {
  'timeout':  { type:'string',  short:'t' },
  'verbose':  { type:'boolean', short:'v' },
  'unmute':   { type:'boolean', short:'u' },
  'silent':   { type:'boolean', short:'s' },
  'quiet':    { type:'boolean', short:'q' },
  'list':     { type:'boolean', short:'l' },
  'recent':   { type:'boolean' },
  'passed':   { type:'boolean' },
  'failed':   { type:'boolean' },
  'match':    { type:'string' },
  'include':  { type:'string', short:'i', default: '(.test.js|.spec.js)$' },
  'exclude':  { type:'string', short:'x', default: '^(gen,*.tmp)$' },
  'only':     { type:'string', short:'o', },
  'skip':     { type:'string', short:'n', },
  'workers':  { type:'string', short:'w' },
  'debug':    { type:'string' },
  'help':     { type:'boolean', short:'h' },
}

const USAGE = `
Usage:

  cds test [ options ] [ patterns ]

Options:

  -l, --list     List found test files
  -i, --include  Include matching files, default: ${options.include.default}
  -x, --exclude  Exclude matching files, default: ${options.exclude.default}
  -n, --skip     Skip all matching test cases
  -o, --only     Run only matching test cases
  -q, --quiet    No output at all
  -s, --silent   No output
  -t, --timeout  in milliseconds
  -u, --unmute   Unmute output
  -v, --verbose  Increase verbosity
  -w, --workers  Specify number of workers
  -?, --help     Displays this usage info
  --failed       Repeat recently failed test suite(s)
  --passed       Repeat recently passed test suite(s)
  --recent       Repeat recently run test suite(s)
  --match        Alias to --include
`

const { DIMMED, YELLOW, GRAY, RESET } = require('./colors')
const regex4 = s => !s ? null : RegExp (s.replace(/[,.*]/g, s => ({ ',': '|', '.': '\\.', '*': '.*' })[s]))
const recent = () => {try { return require(home+'/.cds-test-recent.json') } catch {/* egal */}}
const os = require('os'), home = os.userInfo().homedir
const path = require('node:path')
const fs = require('node:fs')

async function test (argv,o) {
  if (o.help || argv == '?') return console.log (USAGE)
  if (o.recent) o = { ...o, ...recent().options }
  if (o.passed) o.files = recent().passed
  if (o.failed) o.files = recent().failed
  if (!o.files) o.files = await fetch (argv,o)
  if (o.list) return list (o.files)
  if (o.skip) process.env._chest_skip = o.skip
  if (o.files.length > 1) console.log (DIMMED,`\nRunning ${o.files.length} test suites...`, RESET)
  const test = require('node:test').run({ ...o,
    execArgv: [ '--require', require.resolve('../lib/fixtures/node-test.js') ],
    timeout: +o.timeout || undefined,
    concurrency: +o.workers || true,
    forceExit: true,
    testSkipPatterns: regex4 (o.skip), skip: false,
    testNamePatterns: regex4 (o.only), only: false,
  })
  require('./reporter')(test, test.options = o)
}

async function fetch (argv,o) {
  if (o.match) o.include = o.match
  if (o.exclude === 'jest.config') o.exclude = jest().testPathIgnorePatterns?.join('|') || o.exclude
  const patterns = regex4 (argv.join('|')) || { test: ()=> true }
  const include = regex4 (o.include || options.include.default) || { test: ()=> true }
  const exclude = regex4 (o.exclude || options.exclude.default) || { test: ()=> false }
  const ignore = /^(\..*|node_modules|_out)$/
  const files = []
  const _read = fs.promises.readdir
  const _isdir = x => fs.statSync(x).isDirectory()
  await async function _visit (dir) {
    const entries = await _read (dir)
    return Promise.all (entries.map (each => {
      if (ignore.test(each) || exclude.test(each = path.join (dir,each))) return
      if (include.test(each)) return patterns.test(each) && files.push(each)
      if (_isdir(each)) return _visit (each)
    }))
  } (process.cwd())
  if (!files.length) throw YELLOW+`\n No matching test files found. \n`+RESET
  return files
}

function list (files) {
  const { relative } = require('node:path'), cwd = process.cwd()
  const time = (performance.now() / 1000).toFixed(3)
  console.log()
  console.log(`Found these matching test files:`, DIMMED, '\n')
  for (let f of files) console.log('  ', relative(cwd, f))
  console.log(RESET+'\n', files.length, 'total')
  console.log(GRAY, time+'s', RESET, '\n')
}

function jest() {
  const config_js = process.cwd() + '/jest.config'
  const exists = fs.existsSync
  for (const ext of [ '.js', '.json', '.mjs', '.cjs' ]) {
    if (exists (config_js+ext)) {
      // IMPORTANT: We need to jun that in a separate process to avoid loading the cds.env in current process
      const { stdout } = require('node:child_process') .spawnSync ('node', [
        '-e', `console.log( JSON.stringify (require('${config_js+ext}') ))`
      ], { encoding: 'utf-8' })
      return JSON.parse (stdout)
    }
  }
  return console.warn ('No jest.config found, skipping testPathIgnorePatterns')
}

if (!module.parent) {
  const { positionals, values } = require('node:util').parseArgs ({ options, allowPositionals: true })
  test (positionals, values) .catch (e => { console.error(e); process.exitCode = 2 })
}

else module.exports = Object.assign ( test, {
  options: [
    '--files',
    '--include',
    '--exclude',
    '--timeout',
    '--workers',
  ],
  flags: [
    '--verbose',
    '--unmute',
    '--silent',
    '--quiet',
    '--list',
    '--recent',
    '--passed',
    '--failed',
  ],
  shortcuts: [ '-f', '-i', '-x', '-t', '-w', '-v', '-u', '-s', '-q', '-l' ],
  help: USAGE
})
