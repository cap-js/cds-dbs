// required for test.each in mocha and node --test
const {format} = require('util')
module.exports = function each (table) {
  return (msg,fn) => Promise.all (table.map (each => {
    if (!Array.isArray(each))  each = [each]
    return this (format(msg,...each), ()=> fn(...each))
  }))
}
