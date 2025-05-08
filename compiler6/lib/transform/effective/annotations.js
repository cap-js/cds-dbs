'use strict';

const { CompilerAssertion } = require('../../base/error');
const { forEach } = require('../../utils/objectUtils');

const directMappings = {
  '@Common.IsDayOfCalendarMonth': replace('@Semantics.calendar.dayOfMonth'),
  '@Common.IsDayOfCalendarYear': replace('@Semantics.calendar.dayOfYear'),
  '@Common.IsCalendarWeek': replace('@Semantics.calendar.week'),
  '@Common.IsCalendarMonth': replace('@Semantics.calendar.month'),
  '@Common.IsCalendarQuarter': replace('@Semantics.calendar.quarter'),
  '@Common.IsCalendarHalfyear': replace('@Semantics.calendar.halfyear'),
  '@Common.IsCalendarYear': replace('@Semantics.calendar.year'),
  '@Common.IsCalendarYearWeek': replace('@Semantics.calendar.yearWeek'),
  '@Common.IsCalendarYearMonth': replace('@Semantics.calendar.yearMonth'),
  '@Common.IsCalendarYearQuarter': replace('@Semantics.calendar.yearQuarter'),
  '@Common.IsCalendarYearHalfyear': replace('@Semantics.calendar.yearHalfyear'),
  '@Common.IsCalendarDate': replace('@Semantics.date'),
  '@Common.IsFiscalYearVariant': replace('@Semantics.yearVariant'),
  '@Common.IsFiscalPeriod': replace('@Semantics.period'),
  '@Common.IsFiscalYear': replace('@Semantics.year'),
  '@Common.IsFiscalYearPeriod': replace('@Semantics.yearPeriod'),
  '@Common.IsFiscalQuarter': replace('@Semantics.quarter'),
  '@Common.IsFiscalYearQuarter': replace('@Semantics.yearQuarter'),
  '@Common.IsFiscalWeek': replace('@Semantics.week'),
  '@Common.IsFiscalYearWeek': replace('@Semantics.yearWeek'),
  '@Common.IsDayOfFiscalYear': replace('@Semantics.dayOfYear'),
  '@Measures.ISOCurrency': (csn, artifact, element, oldAnno) => {
    const { targetElement } = getAnnoRefTarget(csn, artifact, element[oldAnno]);
    if (refPointsToThisArtifact(csn, artifact, element, oldAnno)) {
      replace('@Semantics.amount.currencyCode')(csn, artifact, element, oldAnno);
      if (targetElement && targetElement['@Semantics.currencyCode'] === undefined)
        targetElement['@Semantics.currencyCode'] = true;
    }
  },
  '@Measures.Unit': (csn, artifact, element, oldAnno) => {
    const { targetElement } = getAnnoRefTarget(csn, artifact, element[oldAnno]);
    if (refPointsToThisArtifact(csn, artifact, element, oldAnno)) {
      replace('@Semantics.quantity.unitOfMeasure')(csn, artifact, element, oldAnno);
      if (targetElement && targetElement['@Semantics.unitOfMeasure'] === undefined)
        targetElement['@Semantics.unitOfMeasure'] = true;
    }
  },
  '@UI.IsImageURL': replace('@Semantics.imageUrl'),
  '@Common.ValueList.CollectionPath': (csn, artifact, element) => {
    if (!element.target && element['@Consumption.valueHelpDefinition'] === undefined) {
      if (element['@Common.ValueList.Parameters'] && Array.isArray(element['@Common.ValueList.Parameters'])) {
        const InOutParameters = element['@Common.ValueList.Parameters'].filter(param => param.$Type === 'Common.ValueListParameterInOut');

        if (InOutParameters.length === 1) {
          element['@Consumption.valueHelpDefinition'] = [ {
            name: element['@Common.ValueList.CollectionPath'],
          } ];

          delete element['@Common.ValueList.CollectionPath'];
          delete element['@Common.ValueList.Label'];

          element['@Consumption.valueHelpDefinition'][0].element = element['@Common.ValueList.Parameters'][0].ValueListProperty;
          delete element['@Common.ValueList.Parameters'];
        }
      }
    }
  },
  '@Common.TextFor': replace('@Semantics.text', true),
  '@Common.IsLanguageIdentifier': replaceIf('@Semantics.language', true, (csn, artifact, element, anno) => !!element[anno]),
  // We need to set two different annos here, depending on the value -> need a custom replacer
  '@Common.Text': (csn, artifact, element, oldAnno) => {
    const { targetArtifact, targetElement } = getAnnoRefTarget(csn, artifact, element[oldAnno]);
    if (targetArtifact === artifact && !element['@ObjectModel.text.element'] && !targetElement['@Semantics.text']) {
      element['@ObjectModel.text.element'] = element[oldAnno];
      if (targetElement['@Semantics.text'] === undefined)
        targetElement['@Semantics.text'] = true;
      delete element['@Common.Text'];
    }
    else if (targetArtifact && targetElement && !element['@ObjectModel.text.association'] && !targetElement['@Semantics.text']) {
      element['@ObjectModel.text.association'] = element[oldAnno];
      if (targetElement['@Semantics.text'] === undefined)
        targetElement['@Semantics.text'] = true;
      delete element['@Common.Text'];
    }
  },
};

/**
 *
 * @param {CSN.Model} csn
 * @param {CSN.Artifact} artifact
 * @param {CSN.Element} element
 * @param {object} anno
 * @returns {boolean}
 */
function refPointsToThisArtifact( csn, artifact, element, anno ) {
  const { targetArtifact } = getAnnoRefTarget(csn, artifact, element[anno]);
  return targetArtifact && targetArtifact === artifact;
}

/**
 * Walk the possible annotation ref and return the artifact and element it points to
 *
 * @param {CSN.Model} csn
 * @param {CSN.Artifact} startArtifact
 * @param {object} annoValue
 * @returns {object}
 */
function getAnnoRefTarget( csn, startArtifact, annoValue ) {
  if (!annoValue || !annoValue['='])
    return { targetArtifact: undefined, targetElement: undefined };

  const steps = annoValue['='].split('.');
  let base = startArtifact;
  let element;
  for (const step of steps) {
    if (!base.elements)
      return { targetArtifact: undefined, targetElement: undefined };
    element = base.elements[step];
    if (!element)
      return { targetArtifact: undefined, targetElement: undefined };
    if (element.target)
      base = csn.definitions[element.target];
  }

  return { targetArtifact: base, targetElement: element };
}

/**
 * Get the function to replace oldAnno with newAnno on carrier.
 *
 * - If available, use "replacement" as value.
 * - Only do replacement if "condition" returns true
 * - Possibly set additional annotations via "additional"
 * @param {string} newAnno
 * @param {any} replacement
 * @param {Function} [condition]
 * @param {Function} [additional]
 * @returns {Function}
 */
function replace( newAnno, replacement, condition = () => true, additional = () => true ) {
  return function replaceAnnotationPrefix(csn, artifact, carrier, oldAnno) {
    if (carrier[newAnno] === undefined && condition(csn, artifact, carrier, oldAnno, newAnno)) {
      carrier[newAnno] = replacement || carrier[oldAnno];
      additional(carrier, oldAnno, newAnno);
      delete carrier[oldAnno];
    }
  };
}

/**
 * Get the function to replace oldAnno with newAnno on carrier.
 *
 * - If available, use "replacement" as value.
 * - Only do replacement if "condition" returns true
 *
 * @param {string} newAnno
 * @param {any} replacement
 * @param {Function} condition
 * @returns {Function}
 */
function replaceIf( newAnno, replacement, condition ) {
  return replace( newAnno, replacement, condition );
}

/**
 *
 * @param {CSN.Model} csn
 * @returns {object} Transfomer object for applyTransformations
 */
function remapODataAnnotations( csn ) {
  /**
   *
   * @param {CSN.Artifact} artifact
   * @param {CSN.Element} element Element to process
   */
  function remapAnnotationsOnElement( artifact, element ) {
    if (element.elements && !element.$ignore) // We expect to only be called on flattened CSN - error if we encounter .elements!
      throw new CompilerAssertion(`Expected a flat model. Found element with subelements: ${ JSON.stringify(element) }`);
    for (const prop in element) {
      if (directMappings[prop])
        directMappings[prop](csn, artifact, element, prop);
    }
  }

  return {
    elements: (parent, prop, elements, path, _parentParent, _dummy, context) => {
      const artifact = csn.definitions[path[1]];
      // Don't process bound actions, as they are still structured
      if (artifact?.kind === 'entity' && !context.$in_actions) {
        for (const elementName in elements)
          remapAnnotationsOnElement(artifact, elements[elementName]);
      }
    },
  };
}

/**
 * Do the .texts anno magic if we can be reasonably sure that we are actually dealing with a .texts entity.
 *
 * @param {string} artifactName
 * @param {CSN.Artifact} artifact
 */
function sealAnnoMagicForTexts(artifactName, artifact) {
  if (artifactName.endsWith('.texts') && artifact.elements?.locale) {
    const firstNonKey = getFirstNonKeyElement(artifact);
    if (firstNonKey && firstNonKey.type === 'cds.String') {
      artifact['@ObjectModel.supportedCapabilities'] ??= [];
      if (!artifact['@ObjectModel.supportedCapabilities'].find(part => part['#'] === 'LANGUAGE_DEPENDENT_TEXT'))
        artifact['@ObjectModel.supportedCapabilities'].push({ '#': 'LANGUAGE_DEPENDENT_TEXT' });
      if (artifact.elements.locale['@Semantics.language'] === undefined)
        artifact.elements.locale['@Semantics.language'] = true;
      if (firstNonKey['@Semantics.text'] === undefined)
        firstNonKey['@Semantics.text'] = true;
    }
  }
}

/**
 *
 * @param {CSN.Artifact} artifact
 * @returns {CSN.Element|null}
 */
function getFirstNonKeyElement(artifact) {
  for (const elementName in artifact.elements) {
    if (Object.prototype.hasOwnProperty.call(artifact.elements, elementName)) {
      if (!artifact.elements[elementName].key)
        return artifact.elements[elementName];
    }
  }

  return null;
}

/**
 *
 * @param {CSN.Model} csn
 * @returns {object} Transfomer object for applyTransformations
 */
function sealAnnoMagic(csn) {
  return {
    '@ObjectModel.supportedCapabilities': (parent, prop, anno, path) => {
      // Filter only for values we care about
      const filteredAnno = anno.filter(value => value['#'] === 'ANALYTICAL_DIMENSION' || value['#'] === 'LANGUAGE_DEPENDENT_TEXT' || value['#'] === 'ANALYTICAL_PROVIDER');
      if (filteredAnno.filter(value => value['#'] === 'ANALYTICAL_PROVIDER').length > 0 && parent.kind === 'entity' && isPartOfINAService(csn, path[1]) && parent.elements) {
        forEach(parent.elements, (elementName, element) => {
          if (element.target && csn.definitions[element.target]['@ObjectModel.supportedCapabilities']?.filter(value => value['#'] === 'ANALYTICAL_DIMENSION').length > 0) {
            const tuples = getOnConditionAsComparisonTuples(element.on, elementName);
            const targetEntity = csn.definitions[element.target];
            if (element.on.length === 3 && tuples.length > 0 ) {
              tuples.forEach(({ source }) => {
                const sourceElement = parent.elements[source.ref[0]];
                if (!sourceElement.target && sourceElement['@ObjectModel.foreignKey.association'] === undefined)
                  sourceElement['@ObjectModel.foreignKey.association'] = { '=': elementName };
              });
            }

            else if (element.on.length > 3 && tuples.length > 0 && targetEntity['@ObjectModel.representativeKey']) {
              tuples.forEach(({ source, target }) => {
                if (target.ref[1] === targetEntity['@ObjectModel.representativeKey']['=']) {
                  const sourceElement = parent.elements[source.ref[0]];
                  if (!sourceElement.target && sourceElement['@ObjectModel.foreignKey.association'] === undefined)
                    sourceElement['@ObjectModel.foreignKey.association'] = { '=': elementName };
                }
              });
            }
          }
        });
      }

      if (filteredAnno.filter(value => value['#'] === 'ANALYTICAL_DIMENSION').length > 0 && parent.kind === 'entity' && parent.elements) {
        forEach(parent.elements, (_elementName, element) => {
          if (element['@ObjectModel.text.element'] && parent.elements[element['@ObjectModel.text.element']['=']] && parent.elements[element['@ObjectModel.text.element']['=']]['@Semantics.text'] === undefined)
            parent.elements[element['@ObjectModel.text.element']['=']]['@Semantics.text'] = true;
          if (element.target && element.target.endsWith('.texts') && csn.definitions[element.target].elements?.locale)
            sealAnnoMagicForTexts(element.target, csn.definitions[element.target]);
        });
      }

      if (filteredAnno.length === 1 && parent.kind && parent['@ObjectModel.modelingPattern'] === undefined) {
        if (filteredAnno[0]['#'] === 'ANALYTICAL_PROVIDER')
          parent['@ObjectModel.modelingPattern'] = { '#': 'ANALYTICAL_CUBE' };
        else
          parent['@ObjectModel.modelingPattern'] = { '#': filteredAnno[0]['#'] };
      }
    },
  };
}

function isPartOfINAService(csn, artifactName) {
  const parts = artifactName.split('.');
  if (parts.length === 1)
    return false; // No dots
  for (let i = 0; i < parts.length; i++) {
    const possibleServiceName = parts.slice(0, i).join('.');
    const possibleDefinition = csn.definitions[possibleServiceName];
    if (possibleDefinition?.kind === 'service')
      return possibleDefinition['@protocol'] === 'ina';
  }

  return false;
}

/**
 * Split the given on-condition into bite-sized tuples IF
 * - the operator is a =
 * - one of the arguments is of the form <assoc>.<field>
 * - one of the arguments is of the form <field>
 * - there are no braces
 * - each of the comparison tuples is "joined" via "and"
 *
 * Return an empty array if we encounter any tuples/things that do NOT match those criteria
 * @param {CSN.OnCondition} on
 * @param {string} assocName
 * @returns {object[]}
 */
function getOnConditionAsComparisonTuples(on, assocName) {
  const validTuples = [];
  for (let i = 0; i < on.length - 2; i += 4) {
    let isValid = false;
    const arg1 = on[i];
    const operator = on[i + 1];
    const arg2 = on[i + 2];
    const possibleAnd = i + 3 < on.length ? on[i + 3] : 'and';
    if (possibleAnd === 'and' && operator === '=' && (arg1.ref?.length === 1 && arg2.ref?.length === 2 && arg2.ref[0] === assocName || arg1.ref?.length === 2 && arg1.ref[0] === assocName && arg2.ref?.length === 1 )) { // TODO: Do we care about filters? Filters could cause a crash here?
      if (arg1.ref.length === 1) { // arg1 needs to point to be <field>, arg2 needs to be <assoc>.<field>
        validTuples.push({ source: arg1, target: arg2 });
        isValid = true;
      }
      else {  // arg1 needs to point to be <assoc>.<field>, arg2 needs to be <field>
        validTuples.push({ source: arg2, target: arg1 });
        isValid = true;
      }
    }

    if (!isValid)
      return [];
  }
  return validTuples;
}


module.exports = {
  remapODataAnnotations,
  sealAnnoMagic,
};
