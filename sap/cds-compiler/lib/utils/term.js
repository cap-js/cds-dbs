//
// This file is used for color output to stderr and stdout.
// Use `term.asError`, `term.asWarn` and `term.asInfo` as they use color output
// per default if the process runs in a TTY, i.e. stdout as well as
// stderr are TTYs.  stderr/stdout are no TTYs if they are
// (for example) piped into another process or written to file:
//
//    node myApp.js              # stdout.isTTY: true,      stderr.isTTY: true
//    node myApp.js | cat        # stdout.isTTY: undefined, stderr.isTTY: true
//    node myApp.js |& cat       # stdout.isTTY: undefined, stderr.isTTY: undefined
//    node myApp.js > out.txt    # stdout.isTTY: undefined, stderr.isTTY: true
//    node myApp.js 2> out.txt   # stdout.isTTY: true,      stderr.isTTY: undefined
//

'use strict';

const stderrHasColor = process.stderr?.isTTY;
const stdoutHasColor = process.stdout?.isTTY;

// Note: We require both stderr and stdout to be TTYs, as we don't
//       know (in our exported functions) where the text will end up.
const hasColorShell = stdoutHasColor && stderrHasColor;

// https://docs.microsoft.com/en-us/windows/console/console-virtual-terminal-sequences
const t = {
  reset: '\x1b[0m', // Default
  bold: '\x1b[1m', // Bold/Bright
  underline: '\x1b[4m', // for links
  red: '\x1b[31m', // Foreground Red
  green: '\x1b[32m', // Foreground Green
  yellow: '\x1b[33m', // Foreground Yellow
  magenta: '\x1b[35m', // Foreground Magenta
  cyan: '\x1b[36m', // Foreground Cyan
};

/**
 * @param {string|boolean} [useColor]
 */
function term( useColor = 'auto' ) {
  let hasColor = hasColorShell;
  changeColorMode(useColor);

  function changeColorMode( mode ) {
    switch (mode) {
      case false:
      case 'never':
        hasColor = false;
        break;
      case true:
      case 'always':
        hasColor = true;
        break;
      default:
        // Note: See also: https://no-color.org/
        //       > Command-line software which adds ANSI color to its output by default
        //       > should check for the presence of a `NO_COLOR` environment variable
        //       > that, when present (regardless of its value), prevents the addition
        //       > of ANSI color.
        // Note: To be able to disable colors in tests, we check the environment
        //       variables again.
        hasColor = (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') ||
          (hasColorShell && process.env.NO_COLOR === undefined);
        break;
    }
  }

  const as = (codes, o) => (hasColor ? (codes + o + t.reset) : (`${ o }`));

  const asError = o => as(t.red + t.bold, o);
  const asWarning = o => as(t.yellow, o);
  const asInfo = o => as(t.green, o);
  const asHelp = o => as(t.cyan, o);

  const underline = o => as(t.underline, o);
  const bold = o => as(t.bold, o);

  const asSeverity = (severity, msg) => {
    switch ((`${ severity }`).toLowerCase()) {
      case 'error': return asError(msg);
      case 'warning': return asWarning(msg);
      case 'info': return asInfo(msg);
      case 'help': return asHelp(msg);
      // or e.g. 'none'
      default: return msg;
    }
  };

  return {
    changeColorMode,
    as,
    underline,
    bold,

    severity: asSeverity,
    asError,
    asWarning,
    asInfo,
    asHelp,
  };
}

module.exports = { term };
