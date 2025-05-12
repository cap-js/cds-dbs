// Detect cycles in the dependencies between nodes (artifacts and elements)

// Cycle detection works by setting dependencies during the "resolve" phase of
// the compiler.  If an artifact `art` (directly) depends on two artifacts
// `loud` and `silent`, the following property is set:
//   art._dep = [ { art: loud, location: <of reference to loud> }, { art: silent } ]
//
// If a dependency is part of a cycle, the compiler issues an error message
// when a location is provided.  We use "silent" dependencies for structural
// ones, e.g. that a structure type depends on each of its elements.

// The question "is part of a cycle" is equivalent to "is an edge between two
// nodes of the same strongly connected component".  To compute these, we use
// an iterative version of Tarjan's corresponding graph algorithm
// <http://en.wikipedia.org/wiki/Tarjan%27s_strongly_connected_components_algorithm>.

'use strict';

const { setLink: setProp } = require('./utils'); // check enum/non-enum

// Detect cyclic dependencies between all nodes reachable from `definitions`.
// If such a dependency is found, call `reportCycle` with arguments `dep.art`
// and `dep.location`, where `dep` is a stored dependency for a node as
// explained above.
function detectCycles( definitions, reportCycle, cbScc ) {
  let index = 0;
  const stack = [];
  if (!cbScc)
    cbScc = defaultCb;          // cannot use as default in parameter def

  for (const name in definitions) {
    const a = definitions[name];
    strongConnectRec( a );
  }
  // now the cleanup
  let nodes = Object.getOwnPropertyNames( definitions ).map( n => definitions[n] );
  while (nodes.length) {        // still nodes to cleaned
    nodes = cleanup( nodes );
  }
  return;

  function strongConnectRec( a ) {
    if (a._scc)                 // already processed
      return;
    while (a)
      a = strongConnect( a );
  }

  // Try to build a SCC starting from the node `v`.
  function strongConnect( v ) {
    // console.log('CALL: ', v.kind,v.name)
    ++index;
    if (!v._scc) {
      setProp( v, '_scc', {
        index,
        lowlink: index,
        onStack: true,
        depIndex: 0,
      } );
      stack.push( v );
      // console.log('PUSH: ', v.kind,v.name)
    }
    if (!v._deps)               // builtins, otherwise forgotten (TODO: assert in --test-mode)
      setProp( v, '_deps', [] );
    // assert( v._scc.onStack );

    // Now consider successors of v (called w):
    while (v._scc.depIndex < v._deps.length) {
      const w = v._deps[v._scc.depIndex++].art;
      if (!w._scc) {            // node has not yet been visited
        setProp( w, '_sccCaller', v );
        // console.log('CALL: ', v._scc.depIndex )
        return w;               // recursive call with w in recursive algorithm
      }
      else if (w._scc.onStack && v._scc.lowlink > w._scc.lowlink) {
        // console.log('SAME: ', w.kind,w.name)
        v._scc.lowlink = w._scc.lowlink;
      }
    }

    // console.log('NEXT: ', v.kind,v.name)
    // If v is a root node, pop the stack and process SCC
    if (v._scc.lowlink === v._scc.index) {
      let w;
      // First set `lowlink` to `lowlink` of root to => all nodes in a SCC have
      // the same number.  This is not done in the original algorithm, but this
      // info is needed for the test "in same SCC" below.
      let i = stack.length;
      do {
        w = stack[--i];
        w._scc.lowlink = v._scc.lowlink;
      } while (w !== v);
      // Now call `reportCycle` for all dependencies inside SCC:
      let r;
      do {
        w = stack.pop();
        w._scc.onStack = false;
        r = cbScc( w, v, r );
      } while (w !== v);
    }

    // Now do the stuff after call in recursive algorithm
    const caller = v._sccCaller;
    if (caller && caller._scc.lowlink > v._scc.lowlink)
      caller._scc.lowlink = v._scc.lowlink;
    return caller;
  }

  function defaultCb( w, v, r ) {
    for (const dep of w._deps) {
      if (dep.art._scc.lowlink === w._scc.lowlink) // in same SCC
        reportCycle( w, dep.art, dep.location, dep.semanticLoc );
    }
    return r;
  }

  // Remove properties `_scc` and `_sccCaller` from the objects in `nodes` and
  // return further objects to be cleaned.
  function cleanup( nodeSet ) {
    const todos = [];
    for (const v of nodeSet) {
      if (v._scc) {
        delete v._scc;
        delete v._sccCaller;
        for (const w of v._deps) {
          if (w.art._scc)
            todos.push( w.art );
        }
      }
    }
    return todos;
  }
}

module.exports = detectCycles;
