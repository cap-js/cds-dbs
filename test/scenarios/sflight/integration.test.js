const childProcess = require('child_process')
const path = require('path')
const cds = require('../../cds')

// REVISIT: sflight tests don't expect IEEE754 compliant responses, but do send the IEEE754 header according to the test
// As it is not possible to configure the IEEE754 flag for @cap-js/hana it is required to inject this configurable:true
// As the cqn2sql output converter injection doesn't allow for it to be overwritten at a later stage, but configurable will stay true
Object.defineProperty(cds.builtin.types.Decimal.constructor.prototype, "CQN2HANA:convertOutput", { get: () => a => a, configurable: true })

const sflightPath = path.resolve(__dirname,'../../../test/sflight')

// IMPORTANT: Wrapping that in beforeAll to avoid loading cds.env before cds.test()
beforeAll(() => {
  if (cds.env.fiori) cds.env.fiori.lean_draft = cds.env.fiori.draft_compat = true
  else cds.env.features.lean_draft = cds.env.features.lean_draft_compatibility = true
})

// Set the test project to the sflight project

describe('Integration', () => {
  const dirs = ['travel_processor', 'travel_analytics']

  describe('Jest', () => {
    require(path.resolve(sflightPath, 'test/odata.test.js'))

    beforeAll(() => {
      Object.defineProperty(cds.builtin.types.Decimal.constructor.prototype, "CQN2HANA:convertOutput", { value: a => a })
    })
  })

  describe.skip.each(dirs)('%s', dir => {
    // Install all dev dependencies for the UI5 apps
    beforeAll(() => npm(`app/${dir}/`, ['ci']), 60 * 1000)

    // Run app test command
    test('Karma', () => npm(`app/${dir}/`, ['run', 'test:node', '--', '--ci=true']), 2 * 60 * 1000)
  })
})

/**
 * Runs the npm command with the given arguments in the relative path to the sflight root folder
 * @param {String} dir
 * @param {Array<String>} args
 * @returns {Promise} Resolves when the command finishes throws when an error occurs
 */
const npm = (dir, args) => {
  const proc = childProcess.spawn('npm', args, {
    cwd: path.resolve(sflightPath, dir),
    stdio: 'pipe',
    env: {
      ...process.env,
      // Cascade prepared deployment to child process
      CDS_CONFIG: JSON.stringify({ requires: { db: cds.db.options } }),
      // Ensure that lean draft is enabled
      CDS_FIORI_LEAN__DRAFT: true,
      CDS_FIORI_DRAFT__COMPAT: true,
    },
  })

  let logs = ''
  proc.stdout.on('data', chunk => {
    if (/Chrome/.test(chunk)) {
      process.stdout.write(chunk)
      logs += `${chunk}`
    }
  })

  return new Promise((resolve, reject) => {
    proc.on('error', e => reject(e))
    proc.on('exit', code => {
      if (code) return reject(new Error(`Failed to run npm ${args.join(' ')} (${dir}): ${logs}`))
      resolve()
    })
  })
}
