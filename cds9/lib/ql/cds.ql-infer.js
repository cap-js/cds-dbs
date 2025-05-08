const cds = require('../index')
const infer = exports = module.exports = (..._) => infer.target(..._)


/**
 * Infers the target entity of a query
 * @param {import('./cds.ql-Query')} q
 */
infer.target = function (q, ctx) {
  if (q._target instanceof cds.entity) return q._target //> already inferred
  const subject = _subject4(q)
  const target = (
    subject?.SELECT ? infer.target (subject, ctx ??= _context4(q)) :
    subject?.ref ? infer.ref (subject.ref, ctx ??= _context4(q)) :
    undefined
  )
  Object.defineProperty (q, '_target', { value: target, configurable:true, writable:true })
  return target
}

infer.ref = function (ref, ctx) {
  const defs = (ctx.model||ctx).definitions
  let name = _name4(ref[0]), d = defs?.[name] || ctx.entities?.[name]
  if (!d) return { name, _unresolved:true, __proto__: cds.entity.prototype }
  else for (let i=1; i < ref.length; ++i) {
    d = d.elements?.[name = _name4(ref[i])] || cds.error `Element ${name} not found in ${d}`
    if (d.target) d = defs[d.target] || cds.error `Target ${d.target} not found in ${defs}`
  }
  return d
}

/** @param {import('./SELECT').class} q */
infer.elements = function (q) {

  const subject = _subject4(q); if (!subject) return
  const source = subject.SELECT ? subject : infer.target(q)

  return _infer_elements4 (q.SELECT.columns, source, q.SELECT.from.as)
  function _infer_elements4 (columns, source, alias) {

    // SELECT from Books; SELECT * from Books
    if (!columns || columns.length === 1 && columns[0] === '*') return source?.elements

    const elements = {}; columns.forEach (c => {

      // 1) SELECT *, ... from Books
      if (c === '*') {
        return Object.assign (elements, source.elements)
      }

      const ref = c.ref?.map(_name4); if (alias && alias === ref?.[0] && ref.length > 1) ref.shift()
      const as = c.as || ref?.join('_') || c.func || c.val || cds.error `Alias required for column expressions ${c}`
      let d = source, is2many

      // 2) SELECT ... : String from Books
      if (c.cast) {
        return elements[as] = builtin [c.cast.type]
      }

      // 3) SELECT title, author.name from Books
      if (c.ref && d?.elements) {
        for (let r of ref) d = (d.SELECT ? d : d._target||d).elements?.[r]
          || cds.error `Couldn't resolve element "${ref.join('/')}" in ${source.kind} ${source.name||''} ${Object.keys(source.elements)}`
        if (d._target) { is2many = d.is2many; c.expand || c.inline ? d = d._target : d }
        // ... d is further processed in steps 5,6,7 below
      }

      // 4) SELECT 1, 2+3, count(*) from Books; SELECT type, name from sqlite.schema
      else if (!c.expand) {
        return elements[as] = _typeof(c) // { ..._typeof(c), name: as }
      }

      // 5) SELECT author.books { title } from Books
      if (c.expand) {
        if (d.items) { d = d.items; is2many = true }
        d = new cds.struct ({ elements: _infer_elements4 (c.expand, d) }) //> { a, b, c } as x
        return elements[as] = is2many ? new cds.array ({ items: d }) : d
      }

      // 6) SELECT author.books.{ title } from Books
      if (c.inline) {
        const nested = _infer_elements4 (c.inline, d)
        for (let n in nested) elements[as+'_'+n] = nested[n]
      }

      // 7) SELECT title, author.name from Books
      else return elements[as] = d // NOTE: the else is neccessary after step 5 above
    })
    return elements
  }
}

const _context4 = q => q._srv ?? cds.context?.model ?? cds.model ?? {}
const _subject4 = (q) => q._subject
  || q.SELECT?.from
  || q.INSERT?.into
  || q.UPSERT?.into
  || q.UPDATE?.entity
  || q.DELETE?.from

const _name4 = r => r.id || r
const _typeof = c => {
  if (c.val !== undefined) return builtin [typeof c.val] || builtin [ Number.isInteger(c.val) ? 'Integer' : 'Decimal' ]
  if (c.func === 'count') return builtin.Integer
  if (c.xpr?.length === 1) return _typeof(c.xpr[0])
  return unknown
}

const unknown = exports.unknown = Object.freeze (new cds.type ({ _unresolved:true }))
const builtin = function() {
  const bi={}, bt = cds.builtin.types
  for (let t of Object.keys(bt)) bi[t] = bi[t.slice(4)] = { type:t, __proto__: bt[t] }
  bi.boolean = bi['cds.Boolean']
  bi.string = bi['cds.String']
  return bi
}()
