import eslint_js from '@eslint/js'

/**
 * Makes the eslint config object available for external use.
 */
export const eslint = eslint_js.configs


/**
 * Recommended ESLint config for @sap/cds projects.
 */
export const defaults = {

  rules: {
    'no-unused-vars': 'warn',
    'no-console': 'warn',
  },

  languageOptions: {
    ecmaVersion: 2022,
    globals: {

      // cds.ql commands ...
      SELECT: 'readonly',
      INSERT: 'readonly',
      UPSERT: 'readonly',
      UPDATE: 'readonly',
      DELETE: 'readonly',
      CREATE: 'readonly',
      DROP: 'readonly',

      // tagged template strings ...
      CDL: 'readonly',
      CQL: 'readonly',
      CXL: 'readonly',

      // subset of Node.js globals ...
      __filename: 'readonly',
      __dirname: 'readonly',
      exports: 'writable',
      require: 'readonly',
      global: 'readonly',
      module: 'readonly',
      console: 'readonly',
      process: 'readonly',
      performance: 'readonly',
      setImmediate: 'readonly',
      setInterval: 'readonly',
      setTimeout: 'readonly',
      clearImmediate: 'readonly',
      clearInterval: 'readonly',
      clearTimeout: 'readonly',
      structuredClone: 'readonly',
      atob: 'readonly',
      btoa: 'readonly',

      Buffer: 'readonly',
      fetch: 'readonly',
      Headers: 'readonly',
      Request: 'readonly',
      Response: 'readonly',
      ReadableStream: 'readonly',
      WritableStream: 'readonly',
      URL: 'readonly',
      URLSearchParams: 'readonly',
    }
  },

  linterOptions: {
    reportUnusedDisableDirectives: false,
  }
}

/**
 * ESLint config for jest and mocha test.
 */
export const tests = {
  files: [ '**/test/**/*.js', '**/test?/**/*.js', '**/*.test.js', '**/*-test.js' ],
  languageOptions: {
    globals: {
      mocha: 'readonly',
      jest: 'readonly',
      expect: 'readonly',
      describe: 'writable',
      xdescribe: 'writable',
      context: 'writable',
      suite: 'writable',
      test: 'writable', xtest: 'writable',
      it: 'writable',
      fail: 'writable',
      before: 'readonly',
      after: 'readonly',
      beforeAll: 'readonly',
      afterAll: 'readonly',
      beforeEach: 'readonly',
      afterEach: 'readonly',
    }
  },
}

/**
 * ESLint config for code running in web browsers.
 */
export const browser = {
  files: [ '**/app/**/*.js', '**/webapp/**/*.js' ],
  languageOptions: {
    globals: {
      window: 'readonly',
      history: 'readonly',
      document: 'readonly',
      location: 'writeable',
      localStorage: 'readonly',
      sessionStorage: 'readonly',
      parent: 'readonly',
      event: 'readonly',
      sap: 'readonly',
    }
  },
}

/**
 * Global ignores for all configs.
 */
export const ignores = [
  '**/@cds-models/**',
  '**/node_modules/**',
  'node_modules/**',
  // '**/webapp/**',
]

/**
 * Recommended all-in-one config for external eslint use, i.e. in cap/dev
 * monorepo, other cap impl projects, as well as in cap-based projects.
 * Currently the same as internal, could differ in the future.
 */
export const recommended = [
  eslint.recommended,
  defaults,
  browser,
  tests,
  { ignores },
  { files: ['bin/*.js'], rules: { 'no-console': 'off' } },
]

/**
 * Default export is for internal use in @sap/cds and cap/dev projects.
 * It adds additional ignores, e.g. for peggy-generated parser code.
 */
export default Object.assign ([ ...recommended, {ignores:[
  '**/libx/odata/parse/parser.js',
]}], { recommended, defaults, browser, tests, ignores })
