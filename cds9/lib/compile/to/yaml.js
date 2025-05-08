// A simple YAML serializer
module.exports = function _2yaml (object, {limit=111}={}) {
  return $(object,'',1)?.toString().replace(/^\n/,'')
  function $(o, indent, count, _visited) {
    if (o == null) return o
    if (o.toJSON) o = o.toJSON()
    if (Array.isArray(o)) {
      let s = ''
      for (let e of o)  s += '\n'+indent+'- '+ $(e,indent+'  ',0)
      return s.length > limit ? s : '['+ s.replace (/\n\s*- /g, ', ').replace(/^, /,'') +']'
    }
    if (typeof o === 'object') {
      const visited = new Set (_visited)
      if (visited.has(o)) return console.error('circular reference to',o) // eslint-disable-line no-console
      else visited.add(o)
      let s = ''
      for (let k in o) {
        let e = o[k]
        if (e === undefined) continue
        if (typeof e === 'function') continue
        if (e?.valueOf && e.valueOf() === undefined) continue
        if (e?.toJSON && e.toJSON() === undefined) continue
        let key = /^[$\w]/.test(k) ? k : "'"+ k +"'"
        if (count++ > 0) s += '\n'+indent
        s += key +': '+ $(e,indent+'  ',1,visited)
      }
      return s.length > limit ? s : '{'+ s.replace (/\n\s*/g, ', ').replace(/^, /,'') +'}'
    }
    if (typeof o === 'string') {
      if (o.indexOf('\n')>=0) return '|'+'\n'+indent+ o.replace(/\n/g,'\n'+indent)
      let s = o.trim()
      return !s || /^[\^@#:,=!<>*|]/.test(s) || /:\s/.test(o) ? '"'+ o.replace(/\\/g,'\\\\') +'"'  :  s
    }
    if (typeof o === 'function') return
    else return o
  }
}
