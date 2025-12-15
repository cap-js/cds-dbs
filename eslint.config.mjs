// aslant.config.mjs
import cds from '@sap/cds/eslint.config.mjs'
import mocha from 'eslint-plugin-mocha'

export default [
  ...cds.recommended,

  // Only apply to test files
  {
    files: ['test/**/*.js', '**/*.{spec,test}.js'],
    plugins: { mocha },
    rules: {
      'mocha/no-exclusive-tests': 'error'
    }
  }
]
