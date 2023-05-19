const cds = require('@sap/cds/lib')
// const DEBUG = cds.log('projection')

// Replaces all view references with the actual cqn query
module.exports = (db = cds.db) => {
  db.on('SELECT', projection.bind(db))
  db.on('INSERT', insertView.bind(db))
  db.on('UPDATE', updateView.bind(db))
  db.on('DELETE', deleteView.bind(db))
}

let cache
const resetCache = function () {
  cache = new WeakMap()
}
resetCache()

const projection = async function (req, next) {
  const cqn = this.cqn4sql(req.query)
  if (!cqn.target?.query && !cqn.SELECT.from.SELECT) {
    return next()
  }

  const src = this.cqn4sql(cqn.target.query || cqn.SELECT.from)
  src.__internal__ = true

  let dataProm

  // Check view cache
  if (cqn.target.query) {
    let currentCache = cache.get(cqn.target.query)
    if (!currentCache) {
      currentCache = this.run(src, req.data)
      // cache.set(cqn.target.query, currentCache)
    }
    dataProm = currentCache.then(data => [...data])
  } else {
    dataProm = this.run(src, req.data)
  }

  const data = await dataProm
  if (!data || !data.length || !cqn.SELECT.from.as) {
    return data
  }

  const map = module.exports.columnMap(cqn)
  map(data)
  return data
}

const insertView = async function (req, next) {
  resetCache()
  const cqn = this.cqn4sql(req.query)
  if (!cqn.target?.query) {
    return next()
  }

  const select = this.cqn4sql(cqn.target.query)
  const hasRenames = select.SELECT.columns.find(c => c.as)
  if (!hasRenames) {
    // REVISIT: once cqn4sql can be called multiple times remove __normalized__ = false
    const clone = cqn.clone()
    clone.__internal__ = true
    clone.INSERT.into = { ref: [select.target.name] }
    clone.__normalized__ = false
    clone.sources = undefined
    return this.run(clone, req.data)
  }

  cds.error`TODO: rename data properties according to select.SELECT.columns`
}

const updateView = async function (req, next) {
  resetCache()
  const cqn = this.cqn4sql(req.query)
  if (!cqn.target?.query) {
    return next()
  }

  const select = this.cqn4sql(cqn.target.query)
  const hasRenames = select.SELECT.columns.find(c => c.as)
  if (!hasRenames) {
    // REVISIT: once cqn4sql can be called multiple times remove __normalized__ = false
    const clone = cqn.clone()
    clone.__internal__ = true
    clone.UPDATE.entity = { ref: [select.target.name] }
    clone.__normalized__ = false
    clone.sources = undefined
    return this.run(clone, req.data)
  }

  cds.error`TODO: rename data properties according to select.SELECT.columns`
}

const deleteView = async function (req, next) {
  resetCache()
  const cqn = this.cqn4sql(req.query)
  if (!cqn.target?.query) {
    return next()
  }

  const select = this.cqn4sql(cqn.target.query)
  // REVISIT: once cqn4sql can be called multiple times remove __normalized__ = false
  const clone = cqn.clone()
  clone.__internal__ = true
  clone.DELETE.from = { ref: [select.target.name] }
  clone.__normalized__ = false
  clone.sources = undefined
  return this.run(clone, req.data)
}

module.exports.columnMap = function (cqn) {
  const alias = cqn.SELECT.from.as
  const transformations = cqn.SELECT.columns
    // .filter(alias ? c => c.ref && c.ref.as !== c.ref[1] : c => c.ref)
    .map(c => {
      let columnAlias = c.as || c.val || c.func || c.ref?.[c.ref?.length - 1]
      const assign = `res[${JSON.stringify(columnAlias)}] = `
      if (!c.ref) {
        return `${assign}row${alias ? `[${JSON.stringify(alias)}]` : ''}[${JSON.stringify(columnAlias)}]`
      }
      if (c.ref.length === 1) {
        return ''
      }
      return `${assign}row${c.ref
        .map((p, i) => (i === 0 && alias ? `[${JSON.stringify(alias)}]` : `[${JSON.stringify(p)}]`))
        .join('')}`
    })

  const mapDefinition = `
for(i = 0; i < data.length; i++) {
  const row = ${alias ? '{' + JSON.stringify(alias) + ':data[i]}' : 'data[i]'}
  const res = {}
  ${transformations.join('\n')}
  data[i] = res
}`
  const map = new Function('data', mapDefinition)
  map.src = mapDefinition
  return map
}
