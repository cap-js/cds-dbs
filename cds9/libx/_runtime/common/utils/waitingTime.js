const MAX_WAITING_TIME = 1480000
module.exports = x => (x > 18 ? MAX_WAITING_TIME : (Math.pow(1.5, x) + Math.random()) * 1000)
