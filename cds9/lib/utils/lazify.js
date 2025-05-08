/** @type <T>(target:T) => T */
const lazify = module.exports = (o) => {
  if (o.constructor === module.constructor) return lazify_module(o)
  for (let p of Reflect.ownKeys(o)) {
    const d = Reflect.getOwnPropertyDescriptor(o,p)
    if (is_lazy(d.value)) Reflect.defineProperty (o,p,{
      set(v) { Reflect.defineProperty (this,p,{value:v,__proto__:d}) },
      get() { return this[p] = d.value.call(this,p,this) },
      configurable: true,
    })
  }
  return o
}

/**
 * Used to lazify a module's exports.
 * @example
 *  require = lazify (module)
 *  module.exports = {
 *     foo: require ('foo') // will be lazy-loaded
 *  }
 * @returns {(id:string)=>{}} a funtion to use instead of require
 */
const lazify_module = (module) => {
  // monkey-patch module.exports setter to lazify all
  Object.defineProperty (module, 'exports',{ set(all) {
    Object.defineProperty (module, 'exports',{ value:lazify(all) })
  }})
  // return a function to use instead of require
  return (id) => (lazy) => module.require(id) // eslint-disable-line no-unused-vars
}

const is_lazy = (x) => typeof x === 'function' && /^(function\s?)?\(?lazy[,)\t =]/.test(x)
