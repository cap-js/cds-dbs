'use strict'

const eslint_js = require('@eslint/js')
const typescript_parser = require('@typescript-eslint/parser')
const globals = require('globals')

module.exports = [
  // global rules for all files
  eslint_js.configs.recommended,
  // Generic config for JavaScript files: Setup environment, version, etc.
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
        ...globals.es6,
        SELECT: true,
        INSERT: true,
        UPSERT: true,
        UPDATE: true,
        DELETE: true,
        CREATE: true,
        DROP: true,
        CDL: true,
        CQL: true,
        CXL: true,
      },
    },
    rules: {
      'no-extra-semi': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: 'lazy' }],
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: typescript_parser,
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': ['warn'],
    },
  },
  {
    files: ['**/hana/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
]
