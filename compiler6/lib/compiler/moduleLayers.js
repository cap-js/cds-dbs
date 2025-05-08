// Module handling, layers and packages

'use strict';

const detectCycles = require('./cycle-detector');
const { setLink } = require('./utils');

function setLayers( sources ) {
  // set dependencies
  for (const name in sources) {
    const ast = sources[name];
    ast.realname = name;
    setLink( ast, '_deps', [] );
    for (const d of ast.dependencies || []) {
      const art = sources[d.realname];
      if (art)
        ast._deps.push( { art } );
    }
  }
  let layerNumber = 0;
  let layerRepresentative;
  detectCycles( sources, null, setExtends );

  // It is ensured that the representative is called last in SCC and that
  // dependent SCCs are called first
  function setExtends( node, representative, sccDeps = Object.create( null ) ) {
    setLink( node, '_layerRepresentative', representative );
    if (layerRepresentative !== representative) {
      layerRepresentative = representative;
      ++layerNumber;
    }
    node.$layerNumber = layerNumber; // for sorting

    for (const dep of node._deps) {
      if (dep.art._scc.lowlink !== node._scc.lowlink) { // not in same SCC
        const depRepr = dep.art._layerRepresentative;
        sccDeps[depRepr.realname] = depRepr;
      }
    }
    if (node === representative) {
      const exts = Object.keys( sccDeps ).map( name => sccDeps[name]._layerExtends );
      Object.assign( sccDeps, ...exts );
      setLink( representative, '_layerExtends', sccDeps );
      // console.log ('SCC:', node.realname)
    }
    return sccDeps;
  }
}

function layer( art ) {
  while (art && art.kind !== 'source')
    art = art._block;
  return art && art._layerRepresentative;
}

function realname( art ) {
  while (art && art.kind !== 'source')
    art = art._block;
  return art && art.realname || '';
}

function compareLayer( a, b ) {
  while (a && a.kind !== 'source')
    a = a._block;
  while (b && b.kind !== 'source')
    b = b._block;
  return a.$layerNumber - b.$layerNumber;
}

module.exports = {
  setLayers,
  layer,
  realname,
  compareLayer,
};
