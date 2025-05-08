/** @type <T> (target:T) => ({
  with <X,Y,Z> (x:X, y:Y, z:Z): ( T & X & Y & Z )
  with <X,Y> (x:X, y:Y): ( T & X & Y )
  with <X> (x:X): ( T & X )
}) */
module.exports = (target) => ({ with (...aspects) {
  const t = is_class(target) ? target.prototype : target
  const excludes = _excludes [typeof t] || {}
  for (let each of aspects) {
    const a = is_class(each) ? each.prototype : each
    for (let p of Reflect.ownKeys(a)) {
      if (p in excludes) continue
      Reflect.defineProperty (t,p, Reflect.getOwnPropertyDescriptor(a,p))
    }
  }
  return target
}})

const _excludes = { object:{}, function: function(){}, }
const is_class = (x) => typeof x === 'function' && x.prototype && /^class\b/.test(x)
