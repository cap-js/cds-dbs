const cds = require ('../index'), $ = cds.error.message

module.exports = (req) => (field) => {

  const def = field.name ? field : field.split('.').reduce (
    (target,e) => target.elements[e] || cds.error `There's no element '${e}' in ${target}`,
    req.target
  )
  return {

    isSpecified (_msg) {
      return this.validate ('MANDATORY_VALUE', this.data != undefined,
        _msg, ()=> $`Value has to be filled in.`
      )
    },

    isInRange (range, _msg) {
      let data = this.data; if (data == undefined) return true
      return this.validate ('VALUE_IN_RANGE',
        !range ? data in def.enum : data >= range[0] && data <= range[1],
        _msg, ()=> $`Value has to be in range ${range || Object.keys(def.enum)}.`
      )
    },

    matches (pattern, _msg) {
      let data = this.data; if (data == undefined) return true
      let re = typeof pattern === 'string' ? RegExp(pattern) : pattern
      return this.validate ('VALUE_MATCHING_PATTERN', re.test(data),
        _msg, ()=> $`Value has to match ${re}`
      )
    },

    meets (code, constraint, _msg) {
      if (typeof code === 'function') [code,constraint,_msg] = ['CONSTRAINT',code,constraint]
      let data = this.data; if (data == undefined) return true
      let ok = constraint(data)
      let validate = ok => this.validate(code,ok,_msg, ()=> `Value failed to meet ${constraint}`)
      return typeof ok.then === 'function' ? ok.then(validate) : validate(ok)
    },

    async exists (_msg) {
      let data = req.target.data(req.data), ref = def.refIn(data); if (ref == undefined) return true
      return this.validate ('TARGET_EXISTS', await req.tx.exists(ref).forUpdate(),
        _msg, ()=> $`Record ${def.target} with ${data[def.name]} doesn't exist.`
      )
    },

    validate: (code, ok, _msg, message) => ok || req.error ({
      code: 'FAILED_'+code, target: def.name,
      message: _msg || message()
    }),

    get data(){ return def.dataIn(req.data) },
    get to(){ return {__proto__:this,
      get match(){ return this.matches },
      get exist(){ return this.exists },
      get meet(){ return this.meets },
      get be(){ return {__proto__:this,
        get specified(){ return this.isSpecified },
        get inRange(){ return this.isInRange },
        get in(){ return {__proto__:this,
          get range(){ return this.isInRange },
        }}
      }}
    }},
    get not(){ return {__proto__:this, validate:(c,ok,m,$) => this.validate(
      c, !ok, m, ()=> $().replace(/must|has to/,'must not')
    )}},

  }
}
