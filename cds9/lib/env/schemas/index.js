const { join } = require('path')

module.exports = new class {
  async default4(name) {
    const file = join(__dirname, name.replace(/\.\w+$/, ''))
    try {
      return structuredClone(require(file))
    } catch {
      throw new Error(`ENOENT: Could not load schema '${name}' from ${file}`)
    }
  }
}
