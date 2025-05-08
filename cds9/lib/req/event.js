const EventContext = require ('./context')

/**
 * Instances of class cds.Event represent asynchronous messages as well as
 * synchronous requests. The latter are instances of subclass cds.Request.
 */
class EventMessage extends EventContext {}

module.exports = exports = EventMessage
exports.Context = EventContext
