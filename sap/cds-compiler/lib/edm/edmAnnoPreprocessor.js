'use strict';

const edmUtils = require('./edmUtils.js');
const { setProp } = require('../base/model');
const { forEachGeneric } = require('../model/csnUtils');

/*
 * Late application specific transformations
 *  At present there are two transformation targets: Structure and Element
 *  These transformations are available today:
 *
 *  Analytical Scenario:
 *    If a structure is annotated with @Aggregation.ApplySupported.PropertyRestrictions
 *    then a number of annotation rewrites are done to this structure and to the
 *    elements of this structure
 *    Also the key properties of all structure elements are removed and a new
 *    artificial key element 'key _ID : String' is inserted at first position of
 *    the elements dictionary
 *
 * PDM (Personal Data Management)
 *    Planned but not yet implemented annotation rewriting (pending to finalization)
 */

/* eslint max-statements-per-line:off */

function mapAnnotationAssignment( artifact, parent, mappingDictionary ) {
  const props = edmUtils.intersect(Object.keys(mappingDictionary), Object.keys(artifact));
  // now start the substitution
  props.forEach((prop) => {
    const [ mapping, value, removeOriginal ] = mappingDictionary[prop];
    if (mapping instanceof Function)
      mapping(artifact, parent, prop);

    else
      edmUtils.assignAnnotation(artifact, mapping, value || artifact[prop]['='] || artifact[prop]);


    if (removeOriginal)
      delete artifact[prop];
  });
}

function addToSetAttr( carrier, propName, propValue, removeFromType = true ) {
  edmUtils.assignProp(carrier, '_SetAttributes', Object.create(null));
  edmUtils.assignAnnotation(carrier._SetAttributes, propName, propValue);
  if (removeFromType)
    delete carrier[propName];
}

function applyAppSpecificLateCsnTransformationOnElement( options, element, struct, error ) {
  if (options.isV2() && struct['@Aggregation.ApplySupported.PropertyRestrictions'])
    mapAnnotationAssignment(element, struct, AnalyticalAnnotations());


  // etag requires Core.OptimisticConcurrency to be set in V4 (cap/issues#2641)
  // Oliver Heinrich mentions in the issue that the Okra runtime must be set to a
  // concurrent runtime mode by the caller, if the annotation is added this late,
  // it doesn't appear in the forOData processed CSN, meaning that the
  // runtime cannot set that okra flag (alternatively the runtime has to search
  // for @[odata|cds].etag annotations...
  if (options.isV4() && (element['@odata.etag'] || element['@cds.etag'])) {
    // don't put element name into collection as per advice from Ralf Handl, as
    // no runtime is interested in the property itself, it is sufficient to mark
    // the entity set.
    edmUtils.assignAnnotation(struct, '@Core.OptimisticConcurrency',
                              (struct['@Core.OptimisticConcurrency'] || [])/* .push(element.name) */);
  }

  function AnalyticalAnnotations() {
    function mapCommonAttributes( elt, structure, prop ) {
      const CommonAttributes = elt[prop];
      if (!Array.isArray(CommonAttributes)) {
        error(null, [ 'definitions', structure.name, 'elements', elt.name ],
              { anno: '@Common.Attributes', code: JSON.stringify(CommonAttributes) },
              'Expecting array value for $(ANNO): $(CODE)');
        return;
      }

      const targets = edmUtils.intersect(CommonAttributes, Object.keys(structure.elements));
      targets.forEach((tgt) => {
        edmUtils.assignAnnotation(structure.elements[tgt], '@sap.attribute-for', elt.name);
      });
    }

    function mapContextDefiningProperties( elt, structure, prop ) {
      const ContextDefiningProperties = elt[prop];
      if (!Array.isArray(ContextDefiningProperties)) {
        error(null, [ 'definitions', structure.name, 'elements', elt.name ],
              { anno: '@Aggregation.ContextDefiningProperties', code: JSON.stringify(ContextDefiningProperties) },
              'Expecting array value for $(ANNO): $(CODE)');
        return;
      }
      if (ContextDefiningProperties.length > 0)
        edmUtils.assignAnnotation(elt, '@sap.super-ordinate', ContextDefiningProperties[ContextDefiningProperties.length - 1]);
    }

    const dict = Object.create(null);
    // analytics term definition unknown, lower case
    dict['@Analytics.Measure'] = [ '@sap.aggregation-role', 'measure' ];
    dict['@Analytics.Dimension'] = [ '@sap.aggregation-role', 'dimension' ];
    dict['@Semantics.currencyCode'] = [ '@sap.semantics', 'currency-code', true ];
    dict['@Semantics.unitOfMeasure'] = [ '@sap.semantics', 'unit-of-measure', true ];

    dict['@Measures.ISOCurrency'] = [ '@sap.unit' ];
    dict['@Measures.Unit'] = [ '@sap.unit' ];

    dict['@Common.Label'] = [ '@sap.label' ];
    dict['@Common.Text'] = [ '@sap.text' ];
    dict['@Aggregation.ContextDefiningProperties'] = [ mapContextDefiningProperties ];
    dict['@Common.Attributes'] = [ mapCommonAttributes ];

    // respect flattened annotation $value
    Object.entries(dict).forEach(([ k, v ]) => {
      dict[`${ k }.$value`] = v;
    });
    return dict;
  }
}

function applyAppSpecificLateCsnTransformationOnStructure( options, struct, error ) {
  if (options.isV2() && struct['@Aggregation.ApplySupported.PropertyRestrictions']) {
    transformAnalyticalModel(struct);
    mapAnnotationAssignment(struct, undefined, AnalyticalAnnotations());
  }

  // nested functions begin
  function transformAnalyticalModel( structure ) {
    const keyName = 'ID__';
    if (!structure?.elements || structure.elements[keyName])
      return;

    // remove key prop from elements, add new key to elements
    const elements = Object.create(null);
    const key = {
      name: keyName, key: true, type: 'cds.String', '@sap.sortable': false, '@sap.filterable': false, '@UI.Hidden': true,
    };
    elements[keyName] = key;
    setProp(structure, '$keys', { [keyName]: key } );
    forEachGeneric(structure.items || structure, 'elements', (e, n) => {
      if (e.key)
        delete e.key;
      elements[n] = e;
    });
    structure.elements = elements;
  }

  function AnalyticalAnnotations() {
    function mapFilterRestrictions( structure, parent, prop ) {
      const stringDict = Object.create(null);
      stringDict.SingleValue = 'single-value';
      stringDict.MultiValue = 'multi-value';
      stringDict.SingleRange = 'interval';

      const filterRestrictions = structure[prop];
      if (!Array.isArray(filterRestrictions)) {
        error(null, [ 'definitions', structure.name ],
              {
                anno: '@Capabilities.FilterRestrictions.FilterExpressionRestrictions',
                code: JSON.stringify(filterRestrictions),
              },
              'Expected array value for $(ANNO): $(CODE)');
        return;
      }
      filterRestrictions.forEach((v) => {
        const e = structure.elements[v.Property];
        if (e)
          edmUtils.assignAnnotation(e, '@sap.filter-restriction', stringDict[v.AllowedExpressions]);
      });
    }

    function mapRequiredProperties( structure, parent, prop ) {
      const requiredProperties = structure[prop];
      if (!Array.isArray(requiredProperties)) {
        error(null, [ 'definitions', structure.name ],
              {
                anno: '@Capabilities.FilterRestrictions.RequiredProperties',
                code: JSON.stringify(requiredProperties),
              },
              'Expecting array value for $(ANNO): $(CODE)');
        return;
      }

      const props = edmUtils.intersect(Object.keys(structure.elements), requiredProperties);
      props.forEach((p) => {
        edmUtils.assignAnnotation(structure.elements[p], '@sap.required-in-filter', true);
      });
    }

    function mapRequiresFilter( structure, parent, prop ) {
      const requiresFilter = structure[prop];
      if (requiresFilter)
        edmUtils.assignAnnotation(structure._SetAttributes, '@sap.requires-filter', requiresFilter);
    }

    // Entity Props
    const dict = Object.create(null);
    dict['@Aggregation.ApplySupported.PropertyRestrictions'] = [ '@sap.semantics', 'aggregate' ];
    dict['@Common.Label'] = [ '@sap.label' ];
    dict['@Capabilities.FilterRestrictions.RequiresFilter'] = [ mapRequiresFilter ];
    dict['@Capabilities.FilterRestrictions.RequiredProperties'] = [ mapRequiredProperties ];
    dict['@Capabilities.FilterRestrictions.FilterExpressionRestrictions'] = [ mapFilterRestrictions ];

    // respect flattened annotation $value
    Object.keys(dict).forEach((k) => {
      dict[`${ k }.$value`] = dict[k];
    });

    return dict;
  }
}

function setSAPSpecificV2AnnotationsToEntityContainer( options, carrier ) {
  if (!options.isV2())
    return;
  // documented in https://wiki.scn.sap.com/wiki/display/EmTech/SAP+Annotations+for+OData+Version+2.0#SAPAnnotationsforODataVersion2.0-Elementedm:EntityContainer
  const SetAttributes = {
    // EntityContainer only
    '@sap.supported.formats': addToSetAttr,
    '@sap.use.batch': addToSetAttr,
    '@sap.message.scope.supported': addToSetAttr,
  };

  Object.entries(carrier).forEach(([ p, v ]) => {
    (SetAttributes[p] || function () { /* no-op */ })(carrier, p, v); // eslint-disable-line func-names
  });
}

function setSAPSpecificV2AnnotationsToEntitySet( options, carrier ) {
  if (!options.isV2())
    return;
  // documented in https://wiki.scn.sap.com/wiki/display/EmTech/SAP+Annotations+for+OData+Version+2.0#SAPAnnotationsforODataVersion2.0-Elementedm:EntitySet
  const SetAttributes = {
    // EntitySet, EntityType
    '@sap.label': (s, pn, pv) => {
      addToSetAttr(s, pn, pv, false);
    },
    '@sap.semantics': checkSemantics,
    // EntitySet only
    '@sap.creatable': addToSetAttr,
    '@sap.updatable': addToSetAttr,
    '@sap.deletable': addToSetAttr,
    '@sap.updatable.path': addToSetAttr,
    '@sap.deletable.path': addToSetAttr,
    '@sap.searchable': addToSetAttr,
    '@sap.pageable': addToSetAttr,
    '@sap.topable': addToSetAttr,
    '@sap.countable': addToSetAttr,
    '@sap.addressable': addToSetAttr,
    '@sap.requires.filter': addToSetAttr,
    '@sap.change.tracking': addToSetAttr,
    '@sap.maxpagesize': addToSetAttr,
    '@sap.delta.link.validity': addToSetAttr,
  };

  Object.entries(carrier).forEach(([ p, v ]) => {
    (SetAttributes[p] || function () { /* no-op */ })(carrier, p, v); // eslint-disable-line func-names
  });

  function checkSemantics( struct, propName, propValue ) {
    if (propValue === 'timeseries' || propValue === 'aggregate') {
      // aggregate is forwarded to Set and must remain on Type
      addToSetAttr(struct, propName, propValue, propValue !== 'aggregate');
    }
  }
}

function setSAPSpecificV2AnnotationsToAssociation( carrier ) {
  // documented in https://wiki.scn.sap.com/wiki/display/EmTech/SAP+Annotations+for+OData+Version+2.0
  const SetAttributes = {
    // Applicable to NavProp and foreign keys, add to AssociationSet
    '@sap.creatable': (c, pn, pv) => {
      addToAssociationSet(c, pn, pv, false);
    },
    // Not applicable to NavProp, applicable to foreign keys, add to AssociationSet
    '@sap.updatable': addToAssociationSet,
    // Not applicable to NavProp, not applicable to foreign key, add to AssociationSet
    '@sap.deletable': (c, pn, pv) => {
      addToAssociationSet(c, pn, pv);
      removeFromForeignKey(c, pn);
    },
    // applicable to NavProp, not applicable to foreign keys, not applicable to AssociationSet
    '@sap.creatable.path': removeFromForeignKey,
    '@sap.filterable': removeFromForeignKey,
  };

  Object.entries(carrier).forEach(([ p, v ]) => {
    (SetAttributes[p] || function () { /* no-op */ })(carrier, p, v); // eslint-disable-line func-names
  });

  function addToAssociationSet( target, propName, propValue, removeFromType = true ) {
    if (target.target) {
      edmUtils.assignProp(target, '_SetAttributes', Object.create(null));
      edmUtils.assignAnnotation(target._SetAttributes, propName, propValue);
      if (removeFromType)
        delete target[propName];
    }
  }

  function removeFromForeignKey( target, propName ) {
    if (target['@odata.foreignKey4'] && target[propName] !== undefined)
      delete target[propName];
  }
}


module.exports = {
  applyAppSpecificLateCsnTransformationOnElement,
  applyAppSpecificLateCsnTransformationOnStructure,
  setSAPSpecificV2AnnotationsToEntityContainer,
  setSAPSpecificV2AnnotationsToEntitySet,
  setSAPSpecificV2AnnotationsToAssociation,
};
