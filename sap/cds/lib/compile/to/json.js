const cds = require ('../../index')
const path = require('path')

module.exports = (csn,o={}) => {
  const relative = filename => (o.src !== o.cwd) ? path.relative(o.src, path.join(o.cwd, filename)) : filename
  const relative_cds_home = RegExp ('^' + path.relative (o.src || o.cwd || cds.root, cds.home) + '/')
  const { moduleLookupDirectories } = cds.env.cdsc

  const resolver = function (k) {
    const v = this[k] // need the original value w/ non-enumerable $location, not the one that went through classes.toJSON()
    if (!v) return v

    else if (v.grant && v.where) try {
      // Add a parsed _where clause for @restrict.{grant,where} annotations
      // Note: This has moved to cds.compile.for.java meanwhile, but is kept
      // here for compatibility, at least temporarily.
      return {...v, _where: JSON.stringify (cds.parse.xpr(v.where)) }
    } catch {/* ignored */}

    else if (v.kind === "service" && !v['@source'] && v.$location?.file) {
      // Preserve original sources for services so we can use them for finding
      // sibling implementation files when reloaded from csn.json.
      let file = relative(v.$location.file)
        .replace(/\\/g,'/')
        .replace(relative_cds_home,'@sap/cds/')
      for (const mld of moduleLookupDirectories) { // node_modules/ usually, more for Java
        file = file.replace(mld, '')
      }

      // If there is still a relative path pointing outside of cwd, convert it to a module path
      // e.g. ../bookshop/srv/cat-service.cds -> @capire/bookshop/srv/cat-service.cds
      if (file.startsWith('../')) {
        file = to_module_path(file, o.cwd)
      }
      return { '@source': file, ...v }
    }

    return v

  }
  return JSON.stringify (csn, resolver, o?.indents ?? 2)
}

// go upwards, find a package.json and try resolving with this module name
function to_module_path (file, cwd=cds.root) {
  let dir = path.dirname(file)
  while (dir && dir.length > 1) {
    try {
      const pkg = require(path.join(cwd, dir, 'package.json'))
      const module_path = file.replace(dir, pkg.name)
      require.resolve(module_path, { paths:[cwd] })  // check if result is resovable, note that this assumes NPM install
      return module_path
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND')  throw err
      dir = path.dirname(dir)
    }
  }
  return file
}

// module.exports.to_module_path = to_module_path
