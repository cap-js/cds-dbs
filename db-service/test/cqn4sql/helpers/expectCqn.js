'use strict'

const chai = require('chai')
chai.use((_chai, utils) => {
  _chai.Assertion.addMethod('equalCqn', function(expected) {
    const normalize = q => JSON.parse(JSON.stringify(q)) // deep clone, no non-enumerable properties
    this.assert(
      utils.eql(normalize(this._obj), normalize(expected)),
      'expected CQN to equal\n#{exp}\n\nbut got\n#{act}',
      'expected CQN to not equal\n#{act}',
      normalize(expected), normalize(this._obj)
    )
  })
})
