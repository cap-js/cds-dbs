/* eslint-disable no-console */
const cds = require('@sap/cds')
const path = require('node:path')

/** @type {import('chai').expect} */
const expect = cds.test.expect

describe('hdbtabledata generation', () => {

  const console = global.console
  beforeAll(() => global.console = testLogger)
  afterAll(() => global.console = console)
  beforeEach(() => testLogger.clear())

  cds.root = path.join(__dirname, 'app-tabledata')
  // init env, avoids setting up an app with us as plugin installed
  cds.env.hana.table_data = require('../../package.json').cds.hana.table_data
  const to_hdbtabledata = require('../../lib/compile/hdbtabledata')

  test('no csvs', async () => {
    const model = await cds.load('*')
    const data = await to_hdbtabledata(model, { dirs: ['__dir1', '__dir2'] })
    expect(data.next().value).to.be.undefined
  })

  test('bookshop', async () => {
    const model = await cds.load('*')
    const data = await to_hdbtabledata(model)
    {
      let [td, { file }] = data.next().value
      expect(file).to.eql('my.bookshop-Authors.hdbtabledata')
      expect(td).to.containSubset({
        imports: [{
          target_table: 'MY_BOOKSHOP_AUTHORS',
          source_data: { data_type: 'CSV', file_name: 'my.bookshop-Authors.csv', has_header: true, type_config: { delimiter: ';' } },
          column_mappings: {
            ID: 'ID', NAME: 'NaME', DATEOFBIRTH: 'DATEOFBIRTH', PLACEOFBIRTH: 'placeOfBirth', DATEOFDEATH: 'dateOfDeath', PLACEOFDEATH: 'placeOfDeath',
            IMAGE: {
              type : 'function',
              name : 'decodeBase64',
              parameters : { column_name : 'image' }
            }
          },
          import_settings: { import_columns: ['ID', 'NAME', 'DATEOFBIRTH', 'PLACEOFBIRTH', 'DATEOFDEATH', 'PLACEOFDEATH', 'IMAGE'], include_filter: [] }
        }]
      })
    }
    {
      let [td, { file }] = data.next().value
      expect(file).to.eql('my.bookshop-Books.hdbtabledata')
      expect(td).to.containSubset({
        imports: [{
          target_table: 'MY_BOOKSHOP_PRODUCTS',
          source_data: { data_type: 'CSV', file_name: 'my.bookshop-Books.csv', has_header: true, type_config: { delimiter: ';' } },
          column_mappings: { ID: 'ID', TITLE: 'title', DESCR: 'descr', AUTHOR_ID: 'author_ID', STOCK: 'stock', PRICE: 'price', CURRENCY_CODE: 'currency_code' },
          import_settings: { import_columns: ['ID', 'TITLE', 'DESCR', 'AUTHOR_ID', 'STOCK', 'PRICE', 'CURRENCY_CODE'], include_filter: [] }
        }]
      })
    }
    {
      let [td, { file }] = data.next().value
      expect(file).to.eql('my.bookshop-Books2.hdbtabledata')
      expect(td).to.containSubset({
        imports: [{
          target_table: 'MY_BOOKSHOP_PRODUCTS',
          source_data: { data_type: 'CSV', file_name: 'my.bookshop-Books2.csv', has_header: true, type_config: { delimiter: ';' } },
          column_mappings: { ID: 'ID', TITLE: 'title', DESCR: 'descr', AUTHOR_ID: 'author_ID', STOCK: 'stock', PRICE: 'price', CURRENCY_CODE: 'currency_code' },
          import_settings: { import_columns: ['ID', 'TITLE', 'DESCR', 'AUTHOR_ID', 'STOCK', 'PRICE', 'CURRENCY_CODE'], include_filter: [] }
        }]
      })
    }
    {
      let [td, { file }] = data.next().value
      expect(file).to.eql('my.bookshop-Books_texts.hdbtabledata')
      expect(td).to.containSubset({
        imports: [{
          target_table: 'MY_BOOKSHOP_PRODUCTS_TEXTS',
          source_data: { data_type: 'CSV', file_name: 'my.bookshop-Books_texts.csv', has_header: true, type_config: { delimiter: ';' } },
          column_mappings: { ID: 'ID', LOCALE: 'locale', TITLE: 'title', DESCR: 'descr' },
          import_settings: { import_columns: ['ID', 'LOCALE', 'TITLE', 'DESCR', 'FOO_BAR'], include_filter: [] }
        }]
      })
    }
    {
      let [td, { file }] = data.next().value
      expect(file).to.eql('my.bookshop-Orders.texts_de.hdbtabledata')
      expect(td).to.containSubset({
        imports: [{
          target_table: 'MY_BOOKSHOP_ORDERS_TEXTS',
          source_data: { data_type: 'CSV', file_name: 'my.bookshop-Orders.texts_de.csv', has_header: true, type_config: { delimiter: ';' } },
          column_mappings: { LOCALE: 'locale', DESCR: 'descr' },
          import_settings: { import_columns: ['ID', 'LOCALE', 'DESCR'], include_filter: [{ LOCALE: 'de' }] }
        }]
      })
    }
    {
      let [td, { file }] = data.next().value
      expect(file).to.eql('sap.common-Currencies_texts_de.hdbtabledata')
      expect(td).to.containSubset({
        imports: [{
          target_table: 'SAP_COMMON_CURRENCIES_TEXTS',
          source_data: { data_type: 'CSV', file_name: 'sap.common-Currencies_texts_de.csv', has_header: true, type_config: { delimiter: ';' } },
          column_mappings: { CODE: 'code', LOCALE: 'locale', NAME: 'name', DESCR: 'descr' },
          import_settings: { import_columns: ['CODE', 'LOCALE', 'NAME', 'DESCR'], include_filter: [{ LOCALE: 'de' }] }
        }]
      })
    }
    {
      let [td, { file }] = data.next().value
      expect(file).to.eql('sap.common-Currencies_texts_fr.hdbtabledata')
      expect(td).to.containSubset({
        imports: [{
          target_table: 'SAP_COMMON_CURRENCIES_TEXTS',
          source_data: { data_type: 'CSV', file_name: 'sap.common-Currencies_texts_fr.csv', has_header: true, type_config: { delimiter: ';' } },
          column_mappings: { CODE: 'code', LOCALE: 'locale', NAME: 'name', DESCR: 'descr' },
          import_settings: { import_columns: ['CODE', 'LOCALE', 'NAME', 'DESCR'], include_filter: [{ LOCALE: 'fr' }] }
        }]
      })
    }
    {
      let [td, { file }] = data.next().value
      expect(file).to.eql('test-NonLocalized.hdbtabledata')
      expect(td).to.containSubset({
        imports: [{
          target_table: 'TEST_NONLOCALIZED',
          source_data: { data_type: 'CSV', file_name: 'test-NonLocalized.csv', has_header: true, type_config: { delimiter: ';' } },
          column_mappings: { ID: 'ID', STR: 'str' },
          import_settings: { import_columns: [ 'ID', 'STR' ], include_filter: [] }
        }]
      })
    }
    {
      let [td, { file }] = data.next().value
      expect(file).to.eql('test.with-comments.hdbtabledata')
      expect(td).to.containSubset({
        imports: [{
          target_table: 'TEST_WITH_COMMENTS',
          source_data: { data_type: 'CSV', file_name: 'test.with-comments.csv', has_header: true, type_config: { delimiter: ';' } },
          column_mappings: { ID: 'ID', STR: 'str' },
          import_settings: { import_columns: [ 'ID', 'STR' ], include_filter: [] },
        }]
      })
    }
    // no more entries expected
    expect(data.next().value).to.be.undefined

    const logs = testLogger.consoleLogs.join("\n")
    expect(logs).to.match(/no entity.*found.* Did you mean.*Authors/i)
    expect(logs).to.match(/exclude skipped entity.*Imported/i)
  })

  test('column mapping disabled', async () => {
    const model = await cds.load('*')
    const data = await to_hdbtabledata(model, { column_mapping: { LargeBinary: false }})
    {
      let [td, { file }] = data.next().value
      expect(file).to.eql('my.bookshop-Authors.hdbtabledata')
      expect(td).to.containSubset({
        imports: [{
          target_table: 'MY_BOOKSHOP_AUTHORS',
          source_data: { data_type: 'CSV', file_name: 'my.bookshop-Authors.csv', has_header: true, type_config: { delimiter: ';' } },
          column_mappings: { ID: 'ID', NAME: 'NaME', DATEOFBIRTH: 'DATEOFBIRTH', PLACEOFBIRTH: 'placeOfBirth', DATEOFDEATH: 'dateOfDeath', PLACEOFDEATH: 'placeOfDeath', IMAGE: 'image' },
          import_settings: { import_columns: ['ID', 'NAME', 'DATEOFBIRTH', 'PLACEOFBIRTH', 'DATEOFDEATH', 'PLACEOFDEATH', 'IMAGE'], include_filter: [] }
        }]
      })
    }
  })

  test('relative path to csvs', async () => {
    const baseDir = path.resolve(__dirname, 'app-tabledata')
    const model = await cds.load('*')
    const data = await to_hdbtabledata(model, { baseDir })
    const [td, { file, folder, csvFolder }] = data.next().value
    expect(td.imports[0].source_data.file_name).to.eql(path.normalize('my.bookshop-Authors.csv'))
    expect(file).to.eql('my.bookshop-Authors.hdbtabledata')
    expect(folder).to.eql(baseDir)
    expect(csvFolder).to.eql(path.join(baseDir, 'db/csv'))
  })

  test('_texts.csv, but no localized', async () => {
    const model = await cds.load(path.resolve(__dirname, 'app-tabledata/db/non-loc.cds'))
    const data = await to_hdbtabledata(model)
    expect(data.next().value).to.be.not.undefined
    expect(data.next().value).to.be.undefined
  })

  test('_text tables names in all naming modes', async () => {
    const baseDir = path.resolve(__dirname, 'app-tabledata')
    const model = await cds.load('*')
    for (const sqlMapping of ['plain', 'quoted', 'hdbcds']) {
      const data = await to_hdbtabledata(model, { baseDir, sqlMapping })
      for (let [td] of data) {
        td.imports
          .filter(imp => imp.source_data.file_name.match(/[._]texts.csv$/i))
          .forEach(imp => expect(imp.target_table).to.match(/_texts$/i)) // `_texts` table name, not `.texts` entity
      }
    }
  })

  test('ignore CSV comments', async () => {
    const model = await cds.load(path.resolve(__dirname, 'app-tabledata/db/with-comments.cds'))
    const data = await to_hdbtabledata(model)
    let [td] = data.next().value
    expect(td).to.containSubset({
      imports: [{
        target_table: 'TEST_WITH_COMMENTS',
        source_data: { data_type: 'CSV', file_name: 'test.with-comments.csv', has_header: true, type_config: { delimiter: ';' } },
        column_mappings: { ID: 'ID', STR: 'str' },
        import_settings: { import_columns: ['ID', 'STR'], include_filter: [] }
      }]
    })
  })

})

const testLogger = {
  consoleLogs: [],
  __proto__: console,
  log: (...args) => testLogger.consoleLogs.push(args.join(' ')),
  warn: (...args) => {
    testLogger.logLevel >= testLogger.LOG_LEVEL_WARN ? console.warn(args) : testLogger.consoleLogs.push(args.join(' '))
  },
  error: (...args) => {
    testLogger.logLevel >= testLogger.LOG_LEVEL_ERROR ? console.error(args) : testLogger.consoleLogs.push(args.join(' '))
  },
  LOG_LEVEL_NONE: -1,
  LOG_LEVEL_WARN: 1,
  LOG_LEVEL_ERROR: 0,
  LOG_LEVEL_INFO: 2,
  LOG_LEVEL_DEBUG: 3,
  logLevel: this.LOG_LEVEL_ERROR,
  clear: () => {
    testLogger.logLevel = testLogger.LOG_LEVEL_ERROR
    testLogger.consoleLogs.length = 0
  }
}
