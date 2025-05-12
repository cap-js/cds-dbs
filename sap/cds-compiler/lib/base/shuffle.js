'use strict';

// Return shuffle functions using pseudo random functions
// By <https://github.com/bryc/code/blob/c97a26ad27a9f9d4f48cd3307fd8ee6f1772d4eb/jshash/PRNGs.md>:

/* eslint no-bitwise: 0, operator-assignment: 0 */

// The random seed must be an integer between 1 and 4294967296 (= 2**32),
// otherwise no shuffling takes place.
function shuffleGen( seed ) {
  return (Number.isSafeInteger( seed ) && seed > 0)
    ? { shuffleArray, shuffleDict }
    : { shuffleArray: a => a, shuffleDict: d => d };

  function random() {           // from function mulberry32() in doc above
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul( seed ^ seed >>> 15, 1 | seed );
    t = t + Math.imul( t ^ t >>> 7, 61 | t ) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  /**
   * Shuffles array in place.
   * https://en.wikipedia.org/wiki/Fisher–Yates_shuffle#The_modern_algorithm
   *
   * @param {Array} array items An array containing the items.
   */
  function shuffleArray( array ) {
    let i = array.length;
    while (i > 1) {
      const j = Math.floor( random() * i );
      --i;
      const temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
    return array;
  }

  /**
   * Return a shuffled version of `dict`.
   */
  function shuffleDict( dict ) {
    if (!dict)
      return dict;
    const names = shuffleArray( Object.keys( dict ) );
    const r = Object.create( null );
    for (const n of names)
      r[n] = dict[n];
    return r;
  }
}

module.exports = shuffleGen;
