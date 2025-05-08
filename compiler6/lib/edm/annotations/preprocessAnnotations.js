'use strict';

const { forEachDefinition, forEachGeneric } = require('../../model/csnUtils.js');


/** ************************************************************************************************
 * preprocessAnnotations
 *
 * options:
 *   v
 *
 * This module never produces errors. In case of "unexpected" situations we issue a message and
 * try to proceed with the processing as good as possible.
 *
 */
function preprocessAnnotations( csn, serviceName, options, messageFunctions ) {
  const { message } = messageFunctions;
  const fkSeparator = '_';

  resolveShortcuts();


  // ----------------------------------------------------------------------------------------------
  // helper functions
  // ----------------------------------------------------------------------------------------------

  // helper to determine the OData version
  // TODO: improve option handling
  function isV2() {
    return options.v && options.v[0];
  }

  // return value can be null is target has no key
  function getKeyOfTargetOfManagedAssoc( anno, assoc ) {
    // assoc.target can be the name of the target or the object itself
    const targetName = (typeof assoc.target === 'object') ? assoc.target.name : assoc.target;
    const target = (typeof assoc.target === 'object') ? assoc.target : csn.definitions[assoc.target];

    const keyNames = Object.keys(target.elements).filter(x => target.elements[x].key && !target.elements[x].target);
    if (keyNames.length === 0) {
      keyNames.push('MISSING');
      message('odata-anno-preproc', assoc.$path, { anno, name: targetName, '#': 'nokey' } );
    }
    else if (keyNames.length > 1) {
      message('odata-anno-preproc', assoc.$path, { anno, name: targetName, '#': 'multkeys' });
    }

    return keyNames[0];
  }

  // ----------------------------------------------------------------------------------------------
  // main annotation processors
  // ----------------------------------------------------------------------------------------------


  // resolve shortcuts
  function resolveShortcuts() {
    forEachDefinition(csn, (artifact, artifactName) => {
      const location = [ 'definitions', artifactName ];
      if (artifactName === serviceName || artifactName.startsWith(`${ serviceName }.`)) {
        handleAnnotations(artifactName, artifactName, artifact, location);
        if (artifact.elements) {
          Object.entries(artifact.elements).forEach(([ elementName, element ]) => {
            handleAnnotations(artifactName, elementName, element, [ ...location, 'elements', elementName ]);
          });
        }
        if (artifact.params) {
          Object.entries(artifact.params).forEach(([ paramName, param ]) => {
            handleAnnotations(artifactName, paramName, param, [ ...location, 'actions', artifactName, 'params', paramName ]);
          });
        }
        forEachGeneric(artifact, 'actions', (action, actionName) => {
          if (action.params) {
            Object.entries(action.params).forEach(([ paramName, param ]) => {
              handleAnnotations(actionName, paramName, param, [ ...location, 'actions', actionName, 'params', paramName ]);
            });
          }
        });
      }
    });

    function handleAnnotations( defName, carrierName, carrier, location ) {
      // collect the names of the carrier's annotation properties
      const annoNames = Object.keys(carrier).filter( x => x[0] === '@');

      annoNames.forEach((aName) => {
        const aNameWithoutQualifier = aName.split('#')[0];

        // Always - draft annotations, value is action name
        //   - v2: prefix with entity name
        //   - prefix with service name
        draftAnnotations(aName, aNameWithoutQualifier);

        // Always - FixedValueListShortcut
        //   expand shortcut form of ValueList annotation
        fixedValueListShortCut(aNameWithoutQualifier);

        // Always - TextArrangementReordering
        //   convert @Common.TextArrangement annotation that is on same level as Text annotation into a nested annotation
        textArrangementReordering(aName, aNameWithoutQualifier);
      });

      // inner functions
      function draftAnnotations( aName, aNameWithoutQualifier ) {
        if ((carrier.kind === 'entity') &&
            (aNameWithoutQualifier === '@Common.DraftRoot.PreparationAction' ||
              aNameWithoutQualifier === '@Common.DraftRoot.ActivationAction' ||
              aNameWithoutQualifier === '@Common.DraftRoot.EditAction' ||
              aNameWithoutQualifier === '@Common.DraftNode.PreparationAction')
        ) {
          let value = carrier[aName];
          // prefix with service name, if not already done
          if (value === 'draftPrepare' || value === 'draftActivate' || value === 'draftEdit') {
            // mocha test has no whatsMySchemaName
            const schemaName = options.whatsMySchemaName && options.whatsMySchemaName(carrierName) || serviceName;
            carrier[aName] = `${ schemaName }.${ value }`;
            value = carrier[aName];
          }
          // for v2: function imports live inside EntityContainer -> path needs to contain "EntityContainer/"
          //         we decided to prefix names of bound action/functions with entity name -> needs to be reflected in path, too
          if (isV2()) {
            const entityNameShort = carrierName.split('.').pop();
            carrier[aName] = value.replace(/(draft(Prepare|Activate|Edit))$/, (match, p1) => `EntityContainer/${ entityNameShort }_${ p1 }`);
          }
        }
      }

      function fixedValueListShortCut( anno ) {
        if (anno === '@Common.ValueList.entity' ||
            anno === '@Common.ValueList.viaAssociation') {
          const _fixedValueListShortCut = () => {
            // note: we loop over all annotations that were originally present, even if they are
            //       removed from the carrier via this handler
            //       we don't remove anything from the array "annoNames"

            // if CollectionPath is explicitly given, no shortcut expansion is made
            if (carrier['@Common.ValueList.CollectionPath'])
              return false;


            if (carrier.kind === 'entity') {
              message('odata-anno-preproc', [ ...location, anno ], { anno, '#': 'notforentity' });
              return false;
            }

            // check on "type"? e.g. if present, it must be #fixed ... ?

            // value list entity
            let enameShort = null;  // (string) name of value list entity, short (i.e. name within service)
            let enameFull = null;   // (string) name of value list entity, fully qualified name

            if (anno === '@Common.ValueList.viaAssociation') {
              // value is expected to be an expression, namely the path to an association of the carrier entity
              const assocName = carrier['@Common.ValueList.viaAssociation']['='];
              if (!assocName) {
                message('odata-anno-preproc', [ ...location, anno ], { anno, '#': 'viaassoc' });
                return false;
              }
              const assoc = csn.definitions[defName].elements[assocName];
              if (!assoc || !assoc.target) {
                message('odata-anno-preproc', [ ...location, anno ], { anno, id: assocName, '#': 'noassoc' });
                return false;
              }

              enameFull = assoc.target.name || assoc.target; // full name
              enameShort = enameFull.split('.').pop();
            }
            else if (anno === '@Common.ValueList.entity') {
              // if both annotations are present, ignore 'entity' and raise a message
              if (annoNames.map(x => x.split('#')[0]).find(x => (x === '@Common.ValueList.viaAssociation'))) {
                message('odata-anno-preproc', [ ...location, anno ],
                        {
                          name: '@Common.ValueList.entity',
                          anno: '@Common.ValueList',
                          value: 'entity',
                          code: 'viaAssociation',
                          '#': 'vallistignored',
                        });
                return false;
              }

              const annoVal = carrier['@Common.ValueList.entity']; // name of value list entity
              if (annoVal['='])
                message('odata-anno-preproc', [ ...location, anno ], { anno, '#': 'notastring' });

              // mocha test has no whatsMySchemaName
              const schemaName = options.whatsMySchemaName && options.whatsMySchemaName(defName) || serviceName;
              enameShort = annoVal['='] || annoVal;
              enameFull = `${ schemaName }.${ enameShort }`;
            }

            const vlEntity = csn.definitions[enameFull]; // (object) value list entity
            if (!vlEntity) {
              message('odata-anno-preproc', [ ...location, anno ], { anno, id: enameFull, '#': 'notexist' });
              return false;
            }

            // label
            //   explicitly provided label wins
            const label = carrier['@Common.ValueList.Label'] ||
                        carrier['@Common.Label'] || vlEntity['@Common.Label'] || enameShort;

            // localDataProp
            //   name of the element carrying the value help annotation
            //   if this is a managed assoc, use fk field instead (if there is a single one)
            let localDataProp = carrierName.split('/').pop();
            if (carrier.target && carrier.on === undefined) {
              localDataProp = localDataProp + fkSeparator +
                getKeyOfTargetOfManagedAssoc(anno, carrier);
            }

            // if this carrier is a generated foreign key field and the association is marked @cds.api.ignore
            // rename the localDataProp to be 'assocName/key'
            if (carrier['@cds.api.ignore']) {
              const assocName = carrier['@odata.foreignKey4'];
              if (assocName && options.isV4())
                localDataProp = localDataProp.replace(assocName + fkSeparator, `${ assocName }/`);
            }

            // valueListProp: the (single) key field of the value list entity
            //   if no key or multiple keys -> message
            let valueListProp = null;
            const keys = Object.keys(vlEntity.elements).filter( x => vlEntity.elements[x].key && !vlEntity.elements[x].target );
            if (keys.length === 0) {
              message('odata-anno-preproc', [ ...location, anno ], { anno, name: enameFull, '#': 'vhlnokey' });
              return false;
            }
            else if (keys.length > 1) {
              message('odata-anno-preproc', [ ...location, anno ], { anno, name: enameFull, '#': 'vhlmultkeys' });
            }
            valueListProp = keys[0];

            // textField:
            //   first entry of @UI.Identification
            //     a record with property 'Value' and expression as its value
            //     or shortcut expansion array of paths
            // OR
            //   the (single) non-key string field, if there is one
            let stringFields = [];
            const Identification = vlEntity['@UI.Identification'];
            if (Identification && Identification[0] && Identification[0]['=']) {
              stringFields.push(Identification[0]['=']);
            }
            else if (Identification && Identification[0] && Identification[0].Value && Identification[0].Value['=']) {
              stringFields.push(Identification[0].Value['=']);
            }
            else {
              stringFields = Object.keys(vlEntity.elements).filter(
                x => !vlEntity.elements[x].key && vlEntity.elements[x].type === 'cds.String'
              );
            }

            // explicitly provided parameters win
            let parameters = carrier['@Common.ValueList.Parameters'];
            if (!parameters) {
              parameters = [ {
                $Type: 'Common.ValueListParameterInOut',
                LocalDataProperty: { '=': localDataProp },
                ValueListProperty: valueListProp,
              } ];
              stringFields.forEach((n) => {
                parameters.push({
                  $Type: 'Common.ValueListParameterDisplayOnly',
                  ValueListProperty: n,
                });
              });
            }

            const newObj = Object.create( Object.getPrototypeOf(carrier) );
            Object.keys(carrier).forEach( (e) => {
              if (e === '@Common.ValueList.entity' || e === '@Common.ValueList.viaAssociation') {
                newObj['@Common.ValueList.Label'] = label;
                newObj['@Common.ValueList.CollectionPath'] = enameShort;
                newObj['@Common.ValueList.Parameters'] = parameters;
              }
              else if (e === '@Common.ValueList.type' ||
                      e === '@Common.ValueList.Label' ||
                      e === '@Common.ValueList.Parameters') {
                // nop
              }
              else {
                newObj[e] = carrier[e];
              }
              delete carrier[e];
            });
            Object.assign(carrier, newObj);
            return true;
          };

          const success = _fixedValueListShortCut();
          if (!success) {
            // In case of failure, avoid subsequent messages
            delete carrier[anno];
            delete carrier['@Common.ValueList.type'];
          }
        }
      }

      function textArrangementReordering( aName, aNameWithoutQualifier ) {
        if (aNameWithoutQualifier === '@Common.TextArrangement') {
          const value = carrier[aName];
          const textAnno = carrier['@Common.Text'];
          // can only occur if there is a @Common.Text annotation at the same target
          if (!textAnno)
            message('odata-anno-preproc', [ ...location, '@Common.TextArrangement' ], { anno: '@Common.TextArrangement', name: '@Common.Text', '#': 'txtarr' });


          // change the scalar anno into a "pseudo-structured" one
          // TODO should be flattened, but then alphabetical order is destroyed

          // Do not overwrite existing nested annotation values, instead give existing
          // nested annotation precedence and remove outer annotation (always)
          if (!carrier['@Common.Text.@UI.TextArrangement'] && textAnno)
            carrier['@Common.Text'] = { $value: textAnno, '@UI.TextArrangement': value };

          delete carrier[aName];
        }
      }
    }
  }
}

module.exports = {
  preprocessAnnotations,
};
