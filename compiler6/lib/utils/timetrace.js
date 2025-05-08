'use strict';

const { CompilerAssertion } = require('../base/error');

function hrtimeToSec( dt ) {
  const sec = (dt / BigInt('1000000000')).toString().padStart(2, ' ');
  // first, get remaining ns, then convert to ms.
  const msec = ((dt % BigInt('1000000000')) / BigInt('1000000')).toString().padStart(3, '0');
  return [ sec, msec ];
}

/**
 * A single StopWatch encapsulates the runtime of a selected code frame.
 *
 * @class TimeTrace
 */
class StopWatch {
  /**
   * Creates an instance of TimeTrace.
   * @param {string} id
   *
   * @memberOf TimeTrace
   */
  constructor(id) {
    this.id = id;
    this.startTime = process.hrtime.bigint();
    this.lapTime = this.startTime;
  }

  /**
   * Start watch.
   */
  start() {
    this.startTime = process.hrtime.bigint();
    this.lapTime = this.startTime;
  }

  /**
   * Stop and return delta T in nanoseconds,
   * but do not set start time
   */
  stop() {
    const endTime = process.hrtime.bigint();
    return endTime - this.startTime;
  }

  lap() {
    const endTime = process.hrtime.bigint();
    const dt = endTime - this.startTime;
    this.lapTime = process.hrtime.bigint();
    return dt;
  }

  stopInFloatSecs() {
    const dt = this.stop();
    return dt / BigInt(1000000000);
  }

  // lap as sec.ns float
  lapInFloatSecs() {
    const dt = this.lap();
    return dt / BigInt(1000000000);
  }
}

/**
 * The main class to handle measuring the runtime of code blocks
 *
 * Results are logged to stderr
 *
 * To enable time tracing, set CDSC_TRACE_TIME to true in the environment
 *
 * @class TimeTracer
 */
class TimeTracer {
  /**
   * Creates an instance of TimeTracer.
   *
   * @memberOf TimeTracer
   */
  constructor() {
    this.traceStack = [];
    this.lastStop = null;
  }

  /**
   * Reset the time tracer.  Use this if an exception is thrown, because then
   * start/end won't correctly match.
   *
   * @param {string} reason
   */
  reset(reason) {
    // eslint-disable-next-line no-console
    console.error(`Reset TimeTrace: Stopping all timers because: ${ reason }`);
    while (this.traceStack.length)
      this.stop(this.traceStack[this.traceStack.length - 1].id);
  }

  /**
   * Start a new TimeTrace, using the given id for logging etc.
   *
   * @param {string} id A short description of whats going on
   *
   * @memberOf TimeTracer
   */
  start(id) {
    // Get time between last stop and new start: Those sections were not tracked.
    const [ sec, msec ] = this.lastStop ? hrtimeToSec(this.lastStop.stop()) : [ ' 0', '000' ];
    this.lastStop = null;
    let base = `${ ' '.repeat(this.traceStack.length * 2) }${ id } started:`;
    base += ' '.repeat(60 - base.length);
    if (sec !== ' 0' || msec !== '000')
      // eslint-disable-next-line no-console
      console.error( `${ base } ${ sec }s ${ msec }ms    (since last stop)` );
    else
      // eslint-disable-next-line no-console
      console.error( `${ base }` );
    this.traceStack.push(new StopWatch(id));
  }

  /**
   * Stop the current TimeTrace and log the execution time.
   *
   * @param {string} id
   * @memberOf TimeTracer
   */
  stop(id) {
    if (this.traceStack.length === 0)
      throw new CompilerAssertion('TimeTracer mismatch: called stop() too many times');
    const current = this.traceStack.pop();
    if (current.id !== id)
      throw new CompilerAssertion(`TimeTracer mismatch; expected id: “${ id }”, was “${ current.id }”`);
    let diff = '';
    if (this.lastStop !== null) {
      const [ sec, msec ] = hrtimeToSec(this.lastStop.stop());
      if ( sec !== ' 0' || msec !== '000')
        diff = `    (diff to last stop: ${ sec }s ${ msec }ms)`;
    }
    const [ sec, msec ] = hrtimeToSec(current.stop());
    const base = `${ ' '.repeat(this.traceStack.length * 2) }${ current.id } took:`;
    // eslint-disable-next-line no-console
    console.error( `${ base }${ ' '.repeat(60 - base.length) } ${ sec }s ${ msec }ms${ diff }` );
    this.lastStop = new StopWatch(id);
  }
}

const ignoreTimeTrace = {
  start: () => { /* ignore */ },
  stop: () => { /* ignore */ },
  reset: () => { /* ignore */ },
};

const doTimeTrace = process?.env?.CDSC_TRACE_TIME !== undefined;
module.exports = {
  timetrace: (doTimeTrace ? new TimeTracer() : ignoreTimeTrace),
  TimeTracer,
  StopWatch,
};
