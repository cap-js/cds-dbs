const { readFileSync } = require('fs')
const yaml = require('js-yaml')

const parser = module.exports = {
  read: (file) => parser.parse (readFileSync(file,'utf-8'), { filename: file }),
  parse: (src,o) => {
    const all = yaml.loadAll(src,o)
    return all.length > 1 ? all : all[0]
  }
}
