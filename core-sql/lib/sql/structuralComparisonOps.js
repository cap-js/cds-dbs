/**
  * For operators of <eqOps>, this is replaced by comparing all leaf elements with null, combined with and.
  * If there are at least two leaf elements and if there are tokens before or after the recognized pattern, we enclose the resulting condition in parens (...)
  */
const eqOps = [['is'], ['='], /* ['=='] */ ]
/**
  * For operators of <notEqOps>, do the same but use or instead of and.
  * This ensures that not struc == <value> is the same as struc != <value>.
  */
const notEqOps = [['is', 'not'], ['<>'], ['!=']]
/**
  * not supported in comparison w/ struct because of unclear semantics
  */
const notSupportedOps = [['>'], ['<'], ['>='], ['<=']]

module.exports = { eqOps, notEqOps, notSupportedOps }
