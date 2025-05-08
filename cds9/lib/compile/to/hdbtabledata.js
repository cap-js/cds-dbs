const cds = require('../../../lib')
const { getElementCdsPersistenceName, getArtifactCdsPersistenceName } = require('@sap/cds-compiler')
const { fs, path, isdir, csv } = cds.utils
const { readdir } = fs.promises
let LOG = cds.log('hdbtabledata|build|all')

module.exports = async (model, options = {}) => {
  model = cds.minify(model)
  const baseDir = options.baseDir  // where the hdbtabledata will be located, for usage in the file_name path
  const dirs = Array.isArray(options.dirs) ? options.dirs : _csvDirs(model.$sources.map(path.dirname))
  if (dirs.length === 0) return []  // nothing to do
  const naming = options.sqlMapping || options.names || cds.env.sql.names
  const colMapping = options.column_mapping || cds.env.hana.table_data.column_mapping

  const datas = (await Promise.all(dirs.map(async dir => {
    let files = []
    if (isdir(dir)) {
      files = await readdir(dir)
    }
    return Promise.all(files.filter(_csvs).map(file => _tabledata4(dir, file, cds.linked(model), baseDir, naming, colMapping)))
  })))
    .reduce((a, b) => a.concat(b), [])
  return _toOutput(datas)
}

async function _tabledata4(dir, csvFile, model, baseDir, naming, colMapping) {
  const baseFileName = path.parse(csvFile).name
  const entityName = baseFileName.replace(/-/g, '.')
  const entity = _entity4(entityName, model)
  if (!entity) {
    let message = `no entity '${entityName}' found for CSV file '${path.relative(process.cwd(), path.join(dir, csvFile))}'`
    const candidate = Object.keys(model.definitions)
      .filter(name => !name.startsWith('localized.'))
      .find(name => name.toLowerCase().includes(entityName.toLowerCase()))
    if (candidate) message += `. Did you mean '${candidate}'?`
    return LOG.warn(`[hdbtabledata] ${message}`)
  }

  const tableName = getArtifactCdsPersistenceName(entity.name, naming, model, 'hana')
  const tabledata = { format_version: 1, imports: [] }
  const _import = {
    target_table: tableName,
    source_data: { data_type: 'CSV', file_name: csvFile, has_header: true, type_config: {} },
    import_settings: { import_columns: [], include_filter: [] },
    column_mappings: {}
  };

  const file = path.join(dir, csvFile)
  const reader = fs.createReadStream(file)
  const { cols, delimiter } = await csv.readHeader(reader)
  if (cols.length === 0) return  // no columns at all -> skip import

  cols.forEach(csvCol => {
    // Only translate the column name, but do not check for the existence of the element in the model.
    // This gets tricky for foreign key elements, and the DB deployment anyways checks the column.
    const tableCol = getElementCdsPersistenceName(csvCol, naming, 'hana')
    const el = entity.elements[csvCol]
    _import.import_settings.import_columns.push(tableCol)
    const type = (el?._type || el?.type)?.replace(/^cds\./, '')

    // per-type column mappings, like for LargeBinary
    if (type && typeof colMapping[type] === 'string') {
      _import.column_mappings[tableCol] = {
        name: colMapping[type],
        type: 'function',
        parameters: { column_name : csvCol }
      }
    } else {
      _import.column_mappings[tableCol] = csvCol
    }
  })

  _import.source_data.type_config.delimiter = delimiter

  // add a locale filter for mono-lingual files that refer to generated text tables
  if (entity.elements.locale) {
    const locale = /[._]texts_(.+)\.csv$/.test(csvFile) ? RegExp.$1 : null
    if (locale) {
      const localeKey = getElementCdsPersistenceName(entity.elements.locale.name/*usually 'LOCALE'*/, naming, 'hana');
      _import.import_settings.include_filter.push({ [localeKey]: locale })
    }
  }

  tabledata.imports.push(_import)
  const suffix = '.hdbtabledata'
  return [
    tabledata, {
      name: baseFileName, suffix,
      file: baseFileName + suffix,
      folder: (baseDir || dir), // as metadata, add the dir to which the csvs are relative to
      csvFolder: dir
    }
  ]
}

function _entity4(name, csn) {
  const entity = csn.definitions[name]
  if (!entity) {
    if (/(.+)[._]texts_?/.test(name)) { // 'Books_texts', 'Books_texts_de', 'Books.texts', 'Books.texts_de'
      const base = csn.definitions[RegExp.$1]
      if (base && base.elements && base.elements.texts) {
        return _entity4(base.elements.texts.target, csn)
      }
    }
    return
  }
  if (entity['@cds.persistence.skip'] === true) return LOG.warn(`[hdbtabledata] exclude skipped entity '${name}'`)
  const p = entity.query && entity.query.SELECT || entity.projection
  if (p) {
    let from = p.from
    if (from && from.ref && from.ref.length === 1) {
      return _entity4(from.ref[0], csn)
    }
  }
  return entity
}

function _csvDirs(sources) {
  sources = Array.from(new Set(sources)) // uniq
  const folders = []
  for (let src of sources) {
    for (let data of ['/data', '/csv']) {
      for (let each of [src + data, src + '/src' + data, src + '/..' + data]) {
        let folder = path.resolve(cds.root, each)
        if (isdir(folder)) folders.push(folder)
      }
    }
  }
  return folders
}


function _csvs(filename, _, allFiles) {
  if (filename[0] === '-' || !filename.endsWith('.csv')) return false
  // ignores 'Books_texts.csv'|'Books.texts.csv' if there is any 'Books_texts_LANG.csv'|'Books.texts_LANG.csv'
  if (/(.*)[._]texts\.csv$/.test(filename)) {
    const basename = RegExp.$1
    const monoLangFiles = allFiles.filter(file => new RegExp(basename + '_texts_').test(file))
    if (monoLangFiles.length > 0) {
      LOG.debug(`[hdbtabledata] ignoring '${filename}' in favor of [${monoLangFiles}]`)
      return false
    }
  }
  return true
}

// generator function compliant to what `cds.compile.to` backends can return
function* _toOutput(datas) {
  for (let i = 0; i < datas.length; i++) {
    if (datas[i]) yield datas[i]
  }
}
