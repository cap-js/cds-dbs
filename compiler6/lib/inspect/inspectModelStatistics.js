'use strict';

const { forEach } = require('../utils/objectUtils');
const { term } = require('../utils/term');
const { CompilerAssertion } = require('../base/error');

/**
 * Return a string representation of the inspected results.
 *
 * @param {XSN.Model} xsn
 * @param {CSN.Options} options
 * @returns {string}
 */
function inspectModelStatistics( xsn, options ) {
  let result = '';

  // Default color mode is 'auto'
  const color = term(options.color !== undefined ? options.color : 'auto');

  const defCount = countDefinitionKinds(xsn);
  const sources = {
    cdl: Object.keys(xsn.sources).filter(name => xsn.sources[name].$frontend === 'cdl').length,
    csn: Object.keys(xsn.sources).filter(name => xsn.sources[name].$frontend === 'csn').length,
  };

  result += `cds-compiler model statistics:

${ color.underline('files') }:         ${ Object.keys(xsn.sources).length }
  cdl sources: ${ sources.cdl }
  csn sources: ${ sources.csn }

${ color.underline('definitions') }:  ${ defCount.definitions }
  entities:   ${ defCount.entity }
  queries:    ${ defCount.view }
  aspects:    ${ defCount.aspect }
  events:     ${ defCount.event }
  types:      ${ defCount.type }
  services:   ${ defCount.service }
  context:    ${ defCount.context }
  actions:    ${ defCount.action }
  functions:  ${ defCount.function }
  namespaces: ${ defCount.namespace } (explicitly in CDL)

${ color.underline('vocabularies') }: ${ Object.keys(xsn.vocabularies || {}).length }
`;
  return result;
}

function countDefinitionKinds( xsn ) {
  const result = {
    definitions: 0,
    entity: 0,
    action: 0,
    function: 0,
    aspect: 0,
    event: 0,
    type: 0,
    service: 0,
    context: 0,
    namespace: 0,
    // non-kind
    view: 0,
  };
  forEach(xsn.definitions || {}, (name, def) => {
    if (def.builtin)
      return;
    ++result.definitions;

    if (def.query || def.projection)
      ++result.view;
    else if (result[def.kind] !== undefined)
      ++result[def.kind];
    else
      throw new CompilerAssertion(`Unhandled kind: ${ def.kind } for ${ name }`);
  });
  return result;
}


module.exports = {
  inspectModelStatistics,
};
