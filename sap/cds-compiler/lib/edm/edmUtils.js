'use strict';

const { setProp } = require('../base/model');
const {
  isEdmPropertyRendered, applyTransformations,
} = require('../model/csnUtils');
const { isBuiltinType } = require('../base/builtins');
const { escapeString, hasControlCharacters, hasUnpairedUnicodeSurrogate } = require('../render/utils/stringEscapes');
const { CompilerAssertion } = require('../base/error');
const { cloneAnnotationValue } = require('../model/cloneCsn');

/* eslint max-statements-per-line:off */
function validateOptions( _options ) {
  if (!_options.isV2 && !_options.isV4) {
    // csn2edm expects "odataVersion" to be a top-level property of options
    // set to 'v4' as default, override with value from incoming options
    const options = Object.assign({ odataVersion: 'v4' }, _options);
    // global flag that indicates whether or not FKs shall be rendered in general
    // V2/V4 flat: yes
    // V4/struct: depending on odataForeignKeys
    options.renderForeignKeys
      = options.odataVersion === 'v4' ? options.odataFormat === 'structured' && !!options.odataForeignKeys : true;

    const v2 = options.odataVersion.match(/v2/i) !== null;
    const v4 = options.odataVersion.match(/v4/i) !== null;

    options.v = [ v2, v4 ];
    options.isStructFormat = options.odataFormat && options.odataFormat === 'structured';
    options.isFlatFormat = !options.isStructFormat;

    options.isV2 = () => v2;
    options.isV4 = () => v4;

    options.pathDelimiter = options.isStructFormat ? '/' : '_';
    return options;
  }
  return _options;
}

// returns intersection of two arrays
function intersect( a, b ) {
  return [ ...new Set(a) ].filter(x => new Set(b).has(x));
}

// Call func(art, name) for each artifact 'art' with name 'name' in 'dictionary' that returns true for 'filter(art)'
function foreach( dictionary, filter, func ) {
  if (dictionary) {
    Object.entries(dictionary).forEach(([ name, value ]) => {
      if (filter(value)) {
        if (Array.isArray(func))
          func.forEach(f => f(value, name));
        else
          func(value, name);
      }
    });
  }
}

// true if _containerEntity is unequal to artifact name (non-recursive containment association)
//      or if artifact belongs to an artificial parameter entity
function isContainee( artifact ) {
  // if $containerNames is present, it is guaranteed that it has at least one entry
  return (artifact.$containerNames && (artifact.$containerNames.length > 1 || artifact.$containerNames[0] !== artifact.name));
}

// Return true if the association 'assoc' has cardinality 'to-many'
function isToMany( assoc ) {
  if (!assoc.cardinality)
    return false;

  // Different representations possible: array or targetMax property
  const targetMax = assoc.cardinality[1] || assoc.cardinality.max;
  if (!targetMax)
    return false;

  return targetMax === '*' || Number(targetMax) > 1;
}

function isNavigable( assoc ) {
  return (assoc.target && (assoc['@odata.navigable'] == null || assoc['@odata.navigable']));
}
function isSingleton( entityCsn ) {
  const singleton = entityCsn['@odata.singleton'];
  const hasNullable = entityCsn['@odata.singleton.nullable'] != null;
  return singleton || (singleton == null && hasNullable);
}

function isParameterizedEntity( artifact ) {
  return artifact.kind === 'entity' && artifact.params;
}

// Return true if 'artifact' is structured (i.e. has elements, like a structured type or an entity)
function isStructuredArtifact( artifact ) {
  // FIXME: No derived types etc yet
  // FIXME: Don't forget cds.Map; maybe use csnUtils.isStructured()?
  return (artifact.items && artifact.items.elements || artifact.elements);
}

// Return true if 'artifact' is a real structured type (not an entity)
function isStructuredType( artifact ) {
  return artifact.kind === 'type' && isStructuredArtifact(artifact);
}

function isDerivedType( artifact ) {
  return artifact.kind === 'type' && !isStructuredArtifact(artifact);
}

function resolveOnConditionAndPrepareConstraints( csn, assocCsn, messageFunctions ) {
  const { info, warning } = messageFunctions;

  if (assocCsn.on) {
    // fill constraint array with [prop, depProp]
    getExpressionArguments(assocCsn.on);

    // for all $self conditions, fill constraints of partner (if any)
    let isBacklink = assocCsn._constraints.selfs.length === 1 && assocCsn._constraints.termCount === 1;

    /* example for _originalTarget:
    entity E (with parameters) {
      ... keys and all the stuff ...
      toE: association to E;
      back: association to E on back.toE = $self
    }
    toE target 'E' is redirected to 'EParameters' (must be as the new parameter list is required)
    back target 'E' is also redirected to 'EParameters' (otherwise backlink would fail)
    ON Condition back.toE => parter=toE cannot be resolved in EParameters, _originalTarget 'E' is
    required for that
    */
    assocCsn._constraints.selfs.filter(p => p).forEach((partnerPath) => {
      // resolve partner path in target
      const originAssocCsn = resolveOriginAssoc(csn, (assocCsn._originalTarget || assocCsn._target), partnerPath);
      const parentName = assocCsn.$abspath[0];
      const parent = csn.definitions[parentName];
      if (originAssocCsn && originAssocCsn.$abspath) {
        const originParentName = originAssocCsn.$abspath[0];
        if (parent.$mySchemaName && originAssocCsn._originalTarget !== parent && originAssocCsn._target !== parent) {
          isBacklink = false;
          // Partnership is ambiguous
          setProp(originAssocCsn, '$noPartner', true);
          info('odata-unexpected-comparison', [ 'definitions', parentName, 'elements', assocCsn.name ], {
            name: `${ originParentName }:${ partnerPath.join('.') }`,
            target: originAssocCsn._target.name,
            id: '$self',
            alias: parentName,
          }, 'Ambiguous comparison of $(NAME) with target $(TARGET) to $(ID) which represents $(ALIAS)');
        }
        if (originAssocCsn.target) {
          // Mark this association as backlink if $self appears exactly once
          // to suppress edm:Association generation in V2 mode
          if (isBacklink) {
            // establish partnership with origin assoc but only if this association is the first one
            if (originAssocCsn._selfReferences.length === 0)
              assocCsn._constraints._partnerCsn = originAssocCsn;

            else
              isBacklink = false;
          }
          // store all backlinks at forward, required to calculate rendering of foreign keys
          // if the termCount != 1 or more than one $self compare this is not a backlink
          if (parent.$mySchemaName && assocCsn._constraints.selfs.length === 1 && assocCsn._constraints.termCount === 1)
            originAssocCsn._selfReferences.push(assocCsn);

          assocCsn._constraints._origins.push(originAssocCsn);
        }
        else {
          /*
            entity E  {
              key id : Integer;
              toMe: association to E on toMe.id = $self; };
            */
          throw new CompilerAssertion(`Backlink association element is not an association or composition: "${ originAssocCsn.name }`);
        }
      }
      else {
        warning(null, [ 'definitions', parentName ],
                { partner: `${ assocCsn._target.name }/${ partnerPath }`, name: `${ parentName }/${ assocCsn.name }` },
                'Can\'t resolve backlink to $(PARTNER) from $(NAME)');
      }
    });
  }

  // nested functions
  function getExpressionArguments( expr ) {
    const allowedTokens = [ '=', 'and', '(', ')' ];
    if (expr && Array.isArray(expr) && !expr.some(isNotAConstraintTerm))
    // if some returns true, this term is not usable as a constraint term
      expr.forEach(fillConstraints);


    // return true if token is not one of '=', 'and', '(', ')' or object
    function isNotAConstraintTerm( tok ) {
      if (tok.xpr)
        return tok.xpr.some(isNotAConstraintTerm);
      if (Array.isArray(tok))
        return tok.some(isNotAConstraintTerm);
      return !(typeof tok === 'object' && tok != null || allowedTokens.includes(tok));
    }

    // fill constraints object with [dependent, principal] pairs and collect all forward assocs for $self terms
    function fillConstraints( arg, pos ) {
      if (arg.xpr) {
        getExpressionArguments(arg.xpr);
      }
      else if (pos > 0 && pos < expr.length) {
        let lhs = expr[pos - 1];
        let rhs = expr[pos + 1];
        if (arg === '=') {
          assocCsn._constraints.termCount++;
          if (lhs.ref && rhs.ref) { // ref is a path
            lhs = lhs.ref;
            rhs = rhs.ref;
            // if exactly one operand starts with the prefix then this is potentially a constraint

            // strip of prefix '$self's
            if (lhs[0] === '$self' && lhs.length > 1)
              lhs = lhs.slice(1);
            if (rhs[0] === '$self' && rhs.length > 1)
              rhs = rhs.slice(1);

            if ((lhs[0] === assocCsn.name && rhs[0] !== assocCsn.name) ||
              (lhs[0] !== assocCsn.name && rhs[0] === assocCsn.name)) {
              // order is always [ property, referencedProperty ]
              // backlink         [ self, assocName ]

              let c;
              if (lhs[0] === assocCsn.name)
                c = [ rhs, lhs.slice(1) ];
              else
                c = [ lhs, rhs.slice(1) ];

              // do we have a $self id?
              // if so, store partner in selfs array
              if (c[0][0] === '$self' && c[0].length === 1) {
                assocCsn._constraints.selfs.push(c[1]);
              }
              else {
                const key = c.join(',');
                assocCsn._constraints.constraints[key] = c;
              }
            }
          }
        }
      }
    }
  }
}

function finalizeReferentialConstraints( csn, assocCsn, options, info ) {
  if (assocCsn.on) {
    /* example for originalTarget:
    entity E (with parameters) {
      ... keys and all the stuff ...
      toE: association to E;
      back: association to E on back.toE = $self
    }
    toE target 'E' is redirected to 'EParameters' (must be as the new parameter list is required)
    back target 'E' is also redirected to 'EParameters' (otherwise backlink would fail)
    ON Condition back.toE => parter=toE cannot be resolved in EParameters, originalTarget 'E' is
    required for that
    */
    assocCsn._constraints._origins.forEach((originAssocCsn) => {
      // if the origin assoc is marked as primary key and if it's managed, add all its foreign keys as constraint
      // as they are also primary keys of the origin entity as well
      if (!assocCsn._target.$isParamEntity && originAssocCsn.key && originAssocCsn.keys) {
        for (const fk of originAssocCsn.keys) {
          const realFk = originAssocCsn._parent.elements[fk.$generatedFieldName];
          const pk = assocCsn._parent.elements[fk.ref[0]];
          if (isConstraintCandidate(pk) && isConstraintCandidate(realFk)) {
            const c = [ [ fk.ref[0] ], [ fk.$generatedFieldName ] ];
            const key = c.join(',');
            assocCsn._constraints.constraints[key] = c;
          }
        }
      }
    });

    if (!assocCsn._target.$isParamEntity) {
      // Use $path to identify main artifact in case assocs parent was a nested type and deanonymized
      // Some (draft) associations don't have a $path, use _parent as last resort
      let dependentEntity = assocCsn.$path ? csn.definitions[assocCsn.$path[1]] : assocCsn._parent;
      let localDepEntity = assocCsn._parent;
      // _target must always be a main artifact
      let principalEntity = assocCsn._target;
      if (assocCsn.type === 'cds.Composition') {
      // Header is composed of Items => Cds.Composition: Header is principal => use header's primary keys
        principalEntity = dependentEntity;
        localDepEntity = undefined;
        dependentEntity = assocCsn._target;
        // Swap the constraint elements to be correct on Composition [principal, dependent] => [dependent, principal]
        Object.keys(assocCsn._constraints.constraints).forEach((cn) => {
          assocCsn._constraints.constraints[cn] = [ assocCsn._constraints.constraints[cn][1], assocCsn._constraints.constraints[cn][0] ];
        } );
      }
      // Remove all target elements that are not key in the principal entity
      // and all elements that annotated with '@cds.api.ignore'
      const remainingPrincipalRefs = [];
      foreach(assocCsn._constraints.constraints,
              (c) => {
                // rc === true will remove the constraint (positive filter expression)
                let rc = true;
                // concatenate all paths in flat mode to identify the correct element
                // in structured mode only resolve top level element (path rewriting is done elsewhere)
                const depEltName = ( options.isFlatFormat ? c[0].join('_') : c[0][0] );
                const principalEltName = ( options.isFlatFormat ? c[1].join('_') : c[1][0] );
                const fk = (dependentEntity.kind === 'entity' && dependentEntity.elements[depEltName]) ||
            (localDepEntity && localDepEntity.elements && localDepEntity.elements[depEltName]);
                const pk = principalEntity.$keys && principalEntity.$keys[principalEltName];
                if (isConstraintCandidate(fk) && isConstraintCandidate(pk)) {
                  if (options.isStructFormat) {
                    // In structured mode it might be the association has a new _parent due to
                    // type de-anonymization.
                    // There are three cases for dependent ON condition paths:
                    // 1) path is relative to assoc in same sub structure
                    // 2) path is absolute and ends up in a different environment
                    // 3) path is absolute and touches in assoc's environment

                    // => 1) if _parents are equal, fk path is relative to assoc
                    if (fk._parent === assocCsn._parent) {
                      rc = false;
                    }
                    // => 2) & 3) if path is not relative to assoc, remove main entity (pos=0) and assoc (pos=n-1)
                    // and check path identity: If absolute path touches assoc's _parent, add it
                    else if (!assocCsn.$abspath.slice(1, assocCsn.$abspath.length - 1).some((p, i) => c[0][i] !== p)) {
                      // this was an absolute addressed path, remove environment prefix
                      c[0].splice(0, assocCsn.$abspath.length - 2);
                      rc = false;
                    }
                  }
                  else {
                    // for flat mode isConstraintCandidate(fk) && isConstraintCandidate(pk) is sufficient
                    rc = false;
                  }
                }
                if (!rc)
                  remainingPrincipalRefs.push(principalEltName);
                return rc;
              },
              (c, cn) => {
                delete assocCsn._constraints.constraints[cn];
              });

      // V2 check that ALL primary keys are constraints
      if (principalEntity.$keys) {
        const renderedKeys = Object.values(principalEntity.$keys).filter(isConstraintCandidate).map(v => v.name);
        if (options.isV2() && intersect(renderedKeys, remainingPrincipalRefs).length !== renderedKeys.length) {
          if (options.odataV2PartialConstr) {
            info('odata-incomplete-constraints',
                 [ 'definitions', assocCsn._parent.name, 'elements', assocCsn.name ], { version: '2.0' });
          }
          else {
            assocCsn._constraints.constraints = {};
          }
        }
      }
    }
  }
  // Handle managed association, a managed composition is treated as association
  else if (!assocCsn._target.$isParamEntity && assocCsn.keys) {
    // If FK is key in target => constraint
    // Don't consider primary key associations (fks become keys on the source entity) as
    // this would impose a constraint against the target.
    // Filter out all elements that annotated with '@cds.api.ignore'

    // In structured format, foreign keys of managed associations are never rendered, so
    // there are no constraints for them.
    const remainingPrincipalRefs = [];
    for (const fk of assocCsn.keys) {
      const realFk = assocCsn._parent.items ? assocCsn._parent.items.elements[fk.$generatedFieldName] : assocCsn._parent.elements[fk.$generatedFieldName];
      const pk = assocCsn._target.elements[fk.ref[0]];
      if (pk && pk.key && isConstraintCandidate(pk) && isConstraintCandidate(realFk)) {
        remainingPrincipalRefs.push(fk.ref[0]);
        const c = [ [ fk.$generatedFieldName ], [ fk.ref[0] ] ];
        const key = c.join(',');
        assocCsn._constraints.constraints[key] = c;
      }
    }

    // V2 check that ALL primary keys are constraints
    const renderedKeys = Object.values(assocCsn._target.$keys).filter(isConstraintCandidate).map(v => v.name);
    if (options.isV2() && intersect(renderedKeys, remainingPrincipalRefs).length !== renderedKeys.length) {
      if (options.odataV2PartialConstr) {
        info('odata-incomplete-constraints',
             [ 'definitions', assocCsn._parent.name, 'elements', assocCsn.name ], { version: '2.0' } );
      }
      else {
        assocCsn._constraints.constraints = {};
      }
    }
  }

  // If this association points to a redirected Parameter EntityType, do not calculate any constraints,
  // continue with multiplicity
  if (assocCsn._target.$isParamEntity)
    assocCsn._constraints.constraints = {};

  return assocCsn._constraints;

  /*
   * In Flat Mode an element is a constraint candidate if it is of scalar type.
   * In Structured mode, it eventually can be of a named type (which is
   * by the construction standards for OData either a complex type or a
   * type definition (alias to a scalar type).
   * The element must never be an association or composition and be renderable.
   */
  function isConstraintCandidate( elt ) {
    return (elt &&
            elt.type &&
            (!options.isFlatFormat || options.isFlatFormat && isBuiltinType(elt.type)) &&
            !(elt.type === 'cds.Association' || elt.type === 'cds.Composition') &&
            isEdmPropertyRendered(elt, options));
  }
}

function determineMultiplicity( csn ) {
  /*
    =>  SRC Cardinality
    CDS   => EDM
    ------------
    undef => '*'  // CDS default mapping for associations
    undef => 1    // CDS default mapping for compositions
    1     => 0..1 // Association
    1     => 1    // Composition
    n     => '*'
    *     => '*'

    => TGT Cardinality
    CDS   => EDM
    ------------
    undef      => 0..1 // CDS default mapping for associations
    0..1       => 0..1
    1          => 0..1
    1 not null => 1  (targetMin=1 is set by transform/toOdata.js)
    1..1       => 1   // especially for unmanaged assocs :)
    0..m       => '*' // CDS default mapping for compositions
    m          => '*'
    1..n       => '*'
    n..m       => '*'
    *          => '*'
  */

  /* new csn:
  src, min, max
  */

  const isAssoc = csn.type === 'cds.Association';
  if (!csn.cardinality)
    csn.cardinality = Object.create(null);

  if (!csn.cardinality.src)
    csn.cardinality.src = isAssoc ? '*' : '1';
  if (!csn.cardinality.min)
    csn.cardinality.min = 0;
  if (!csn.cardinality.max)
    csn.cardinality.max = 1;

  const srcCardinality
    = (csn.cardinality.src == 1) // eslint-disable-line eqeqeq
      ? (!isAssoc || csn.cardinality.srcmin == 1) // eslint-disable-line eqeqeq
        ? '1'
        : '0..1'
      : '*';
  const tgtCardinality
    = (csn.cardinality.max > 1 || csn.cardinality.max === '*')
      ? '*'
      : (csn.cardinality.min == 1) // eslint-disable-line eqeqeq
        ? '1'
        : '0..1';

  return [ srcCardinality, tgtCardinality ];
}

// return effective target cardinality
// If csn is a backlink, return the source cardinality (including srcmin/src) from
// the forward association
// This function works only after finalizeConstraints
function getEffectiveTargetCardinality( csn ) {
  const rc = { min: 0, max: 1 };
  if (!csn._constraints || !csn._constraints.$finalized)
    throw new CompilerAssertion(`_constraints missing or not finalized: "${ csn.name }`);
  // partner (forward) cardinality has precedence
  if (csn._constraints._partnerCsn) {
    if (csn._constraints._partnerCsn.cardinality?.srcmin)
      rc.min = csn._constraints._partnerCsn.cardinality.srcmin;
    if (csn._constraints._partnerCsn.cardinality?.src)
      rc.max = csn._constraints._partnerCsn.cardinality.src;
  }
  else if (csn.cardinality) {
    if (csn.cardinality.min)
      rc.min = csn.cardinality.min;
    if (csn.cardinality.max)
      rc.max = csn.cardinality.max;
  }
  return rc;
}

function mapCdsToEdmType( csn, messageFunctions, options, isMediaType = false, location = undefined ) {
  if (location === undefined)
    location = csn.$path;
  const isV2 = options.odataVersion === 'v2';
  const { error } = messageFunctions || { error: () => true };
  const cdsType = csn.type;
  if (cdsType === undefined) {
    error(null, location, 'no type found');
    return '<NOTYPE>';
  }
  if (!isBuiltinType(cdsType))
    return cdsType;

  let edmType = {
    // Edm.String, Edm.Binary
    'cds.String': 'Edm.String',
    'cds.hana.NCHAR': 'Edm.String',
    'cds.LargeString': 'Edm.String',
    'cds.hana.VARCHAR': 'Edm.String',
    'cds.hana.CHAR': 'Edm.String',
    'cds.hana.CLOB': 'Edm.String',
    'cds.Binary': 'Edm.Binary',
    'cds.hana.BINARY': 'Edm.Binary',
    'cds.LargeBinary': 'Edm.Binary',
    // numbers: exact and approximate
    'cds.Decimal': 'Edm.Decimal',
    'cds.DecimalFloat': 'Edm.Decimal',
    'cds.hana.SMALLDECIMAL': 'Edm.Decimal', // V4: Scale="floating" Precision="16"
    'cds.Integer64': 'Edm.Int64',
    'cds.Integer': 'Edm.Int32',
    'cds.Int64': 'Edm.Int64',
    'cds.Int32': 'Edm.Int32',
    'cds.Int16': 'Edm.Int16',
    'cds.UInt8': 'Edm.Byte',
    'cds.hana.SMALLINT': 'Edm.Int16',
    'cds.hana.TINYINT': 'Edm.Byte',
    'cds.Double': 'Edm.Double',
    'cds.hana.REAL': 'Edm.Single',
    // other: date/time, boolean
    'cds.Date': 'Edm.Date',
    'cds.Time': 'Edm.TimeOfDay',
    // For a very long time it was unclear whether or not to map the Date types to a different Edm Type in V2,
    // no one has ever asked about it in the meantime. The falsy if is just there to remember the eventual mapping.
    'cds.DateTime': 'Edm.DateTimeOffset', // (isV2 && false) ? 'Edm.DateTime'
    'cds.Timestamp': 'Edm.DateTimeOffset', // (isV2 && false) ? 'Edm.DateTime'
    'cds.Boolean': 'Edm.Boolean',
    'cds.UUID': 'Edm.Guid',
    'cds.hana.ST_POINT': 'Edm.GeometryPoint',
    'cds.hana.ST_GEOMETRY': 'Edm.Geometry',
    /* unused but EDM defined
    Edm.Geography
    Edm.GeographyPoint
    Edm.GeographyLineString
    Edm.GeographyPolygon
    Edm.GeographyMultiPoint
    Edm.GeographyMultiLineString
    Edm.GeographyMultiPolygon
    Edm.GeographyCollection    Edm.GeometryLineString
    Edm.GeometryPolygon
    Edm.GeometryMultiPoint
    Edm.GeometryMultiLineString
    Edm.GeometryMultiPolygon
    Edm.GeometryCollection
    */
  }[cdsType];
  if (!edmType) {
    if (isEdmPropertyRendered(csn, options)) {
      error('ref-unsupported-type', location,
            { type: cdsType, version: (isV2 ? '2.0' : '4.0'), '#': 'odata' });
    }
    // return a version compatible type to avoid later compatibility failures
    edmType = isV2 ? 'Edm.String' : 'Edm.PrimitiveType';
  }


  if (isV2) {
    if (edmType === 'Edm.Date')
      edmType = 'Edm.DateTime';
    if (edmType === 'Edm.TimeOfDay')
      edmType = 'Edm.Time';
  }
  else if (isMediaType) { // isV4
  // CDXCORE-CDXCORE-173
    edmType = 'Edm.Stream';
  }
  return edmType;
}

function addTypeFacets( node, csn ) {
  const isV2 = node.v2;
  const decimalTypes = { 'cds.Decimal': 1, 'cds.DecimalFloat': 1, 'cds.hana.SMALLDECIMAL': 1 };
  if (csn.length != null)
    node.setEdmAttribute('MaxLength', csn.length);
  if (csn.precision != null)
    node.setEdmAttribute('Precision', csn.precision);
  // else if (csn.type === 'cds.hana.SMALLDECIMAL' && !isV2)
  //   node.Precision = 16;
  if (csn.scale !== undefined)
    node.setEdmAttribute('Scale', csn.scale);
  // else if (csn.type === 'cds.hana.SMALLDECIMAL' && !isV2)
  //   node._edmAttributes.Scale = 'floating';
  else if (csn.type === 'cds.Timestamp' && node._edmAttributes.Type === 'Edm.DateTimeOffset')
    node.setEdmAttribute('Precision', 7);
  if (csn.type in decimalTypes) {
    if (isV2) {
      // no prec/scale or scale is 'floating'/'variable'
      if (!(csn.precision || csn.scale) || (csn.scale === 'floating' || csn.scale === 'variable')) {
        node.setXml( { 'sap:variable-scale': true } );
        node.removeEdmAttribute('Scale');
      }
    }
    else {
      // map both floating and variable to => variable
      if (node._edmAttributes.Scale === 'floating')
        node.setEdmAttribute('Scale', 'variable');
      if (csn.precision == null && csn.scale == null)
        // if Decimal has no p, s set scale 'variable'
        node.setXml( { Scale: 'variable' } ); // floating is V4.01
    }
  }
  // Unicode unused today
  if (csn.unicode)
    node.setEdmAttribute('Unicode', csn.unicode);
  if (csn.srid)
    node.setEdmAttribute('SRID', csn.srid);
}


/**
   * A simple identifier is a Unicode character sequence with the following restrictions:
   * - The first character MUST be the underscore character (U+005F) or any character in the Unicode category “Letter (L)” or “Letter number (Nl)”
   * - The remaining characters MUST be the underscore character (U+005F) or any character in the Unicode category:
   *   “Letter (L)”,
   *   “Letter number (Nl)”,
   *   “Decimal number (Nd)”,
   *   “Non-spacing mark (Mn)”,
   *   “Combining spacing mark (Mc)”,
   *   “Connector punctuation (Pc)”,
   *   “Other, format (Cf)”
   * source: https://docs.oasis-open.org/odata/odata-csdl-xml/v4.01/os/odata-csdl-xml-v4.01-os.pdf#page=75
   *
   * @param {string} identifier
   */
function isODataSimpleIdentifier( identifier ) {
  // this regular expression reflects the specification from above
  const regex = /^[\p{Letter}\p{Nl}_][_\p{Letter}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Cf}]{0,127}$/gu;
  return identifier && identifier.match(regex);
}

/**
 * Escape the given string for attribute values.  We follow the spec as
 * described in §2.3 <https://www.w3.org/TR/xml/#NT-AttValue>:
 *
 *   AttValue ::=  '"' ([^<&"] | Reference)* '"'
 *               | "'" ([^<&'] | Reference)* "'"
 *
 * This function assumes that the attribute value is surrounded by double quotes ("),
 * hence single quotes are not escaped.
 *
 * Note that even though certain special characters such as newline (LF) are allowed,
 * they may be normalized to something different.  For example LF is normalized
 * to a space.  Therefore we need to escape it.
 * See §3.3.3 <https://www.w3.org/TR/xml/#AVNormalize>.
 *
 * Furthermore, control characters need to be escaped, see §2.2:
 * <https://www.w3.org/TR/xml/#charsets>
 * We also encode LF (#xA), etc. because of XML normalization in XML parsers.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeStringForAttributeValue( str ) {
  if (typeof str !== 'string')
    return str;

  if (!/[&<"]/.test(str) && !hasControlCharacters(str) && !hasUnpairedUnicodeSurrogate(str))
    return str;

  str = escapeString(str, {
    '&': '&amp;',
    '<': '&lt;',
    '"': '&quot;',
    control: encodeNonCharacters,
    unpairedSurrogate: encodeNonCharacters,
  });

  // Notes
  // -----
  // According to the specification, "§2.11: End-of-Line Handling", we should normalize line endings:
  //    > ... by translating both the two-character sequence #xD #xA and any #xD that is not
  //    > followed by #xA to a single #xA character.
  // However, line endings were already normalized in the CDL parser.
  // If we were to normalize it again, it would be work done twice, possibly resulting in
  // unwanted normalization (once is expected, twice is not).
  // If we were to ever change this, use this RegEx:
  //   /\r\n?|\n/g => '&#xA;'

  return str;
}

/**
 * Escape the given string for element content.  We follow the spec as
 * described in §3.1 <https://www.w3.org/TR/xml/#NT-content>:
 *
 *   content  ::= CharData? ((element | Reference | CDSect | PI | Comment) CharData?)*
 *   CharData ::= [^<&]* - ([^<&]* ']]>' [^<&]*)
 *
 * i.e., we need to escape '<', '&' as well as `>` if it is preceded by `]]`.
 * See also $2.4: “'>' MUST be replaced for compatibility reasons if it appears as ]]>”
 *
 * Furthermore, control characters need to be escaped, see §2.2:
 * <https://www.w3.org/TR/xml/#charsets>
 * We also encode LF (#xA), etc. because of XML normalization in XML parsers.
 *
 * In contrast to `escapeStringForAttributeValue()`, newlines do
 * not need to be escaped.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeStringForText( str ) {
  if (typeof str !== 'string')
    return str;

  if (!/[&<>]/.test(str) && !hasControlCharacters(str) && !hasUnpairedUnicodeSurrogate(str))
    return str;

  str = escapeString(str, {
    '&': '&amp;',
    '<': '&lt;',
    control: encodeNonCharacters,
    unpairedSurrogate: encodeNonCharacters,
  });

  // Note: You can test this with <https://www.w3schools.com/xml/xml_validator.asp>:
  //       This sequence is allowed in attribute values but not element content.
  str = str.replace(/]]>/g, ']]&gt;');

  return str;
}

/**
 * Control characters need to be escaped, see §2.2:
 * <https://www.w3.org/TR/xml/#charsets>
 *
 *   Char  ::=  #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
 *   --> any Unicode character, excluding the surrogate blocks, FFFE, and FFFF.
 *
 * @param {number} codePoint
 * @returns {string}
 */
function encodeNonCharacters( codePoint ) {
  const hex = codePoint.toString(16).toUpperCase();
  return `&#x${ hex };`;
}

// return the path prefix of a given name or if no prefix available 'root'
function getSchemaPrefix( name ) {
  const lastDotIdx = name.lastIndexOf('.');
  return (lastDotIdx > 0 ) ? name.substring(0, lastDotIdx) : 'root';
}

// get artifacts base name
function getBaseName( name ) {
  const lastDotIdx = name.lastIndexOf('.');
  return (lastDotIdx > 0 ) ? name.substring(lastDotIdx + 1, name.length) : name;
}

// This is a poor mans path resolver for $self partner paths only
function resolveOriginAssoc( csn, env, path ) {
  for (const segment of path) {
    const elements = (env?.items?.elements || env?.elements);
    if (elements)
      env = elements[segment];
    const type = (env?.items?.type || env?.type);
    if (type && !isBuiltinType(type) && !(env?.items?.elements || env?.elements))
      env = csn.definitions[type];
  }
  return env;
}

function mergeIntoNavPropEntry( annoPrefix, navPropEntry, prefix, props ) {
  let newEntry = false;

  // Filter properties with prefix and reduce them into a new dictionary
  const o = props.filter(p => p[0].startsWith(`${ annoPrefix }.`)).reduce((a, c) => {
    // clone the annotation value to avoid side effects with rewritten paths
    a[c[0].replace(`${ annoPrefix }.`, '')] = cloneAnnotationValue(c[1]);
    return a;
  }, { });

  // BEFORE merging found capabilities, prefix the paths
  applyTransformations({ definitions: { o } }, {
    '=': (parent, prop, value) => {
      parent[prop] = prefix.concat(value).join('.');
    },
  });
  // don't overwrite existing restrictions
  const prop = annoPrefix.split('.')[1];
  if (!navPropEntry[prop]) {
    // if dictionary has entries, add them to navPropEntry
    if (Object.keys(o).length) {
      // ReadRestrictions may have sub type ReadByKeyRestrictions { Description, LongDescription }
      // chop annotations into dictionaries
      if (annoPrefix === '@Capabilities.ReadRestrictions' &&
                      Object.keys(o).some(k => k.startsWith('ReadByKeyRestrictions.'))) {
        const no = {};
        Object.entries(o).forEach(([ k, v ]) => {
          const [ head, ...tail ] = k.split('.');
          if (head === 'ReadByKeyRestrictions' && tail.length) {
            if (!no.ReadByKeyRestrictions)
              no.ReadByKeyRestrictions = {};
            // Don't try to add entry into non object
            if (typeof no.ReadByKeyRestrictions === 'object')
              no.ReadByKeyRestrictions[tail.join('.')] = v;
          }
          else {
            no[k] = v;
          }
        });
        navPropEntry[prop] = no;
      }
      else {
        navPropEntry[prop] = o;
      }
      newEntry = true;
    }
  }
  else {
    // merge but don't overwrite into existing navprop
    Object.entries(o).forEach(([ k, v ]) => {
      if (!navPropEntry[prop][k])
        navPropEntry[prop][k] = v;
    });
  }
  return newEntry;
}

// Assign but not overwrite annotation
function assignAnnotation( node, name, value ) {
  if (value !== undefined &&
      name !== undefined && name[0] === '@')
    node[name] ??= value;
}

// Set non enumerable property if it doesn't exist yet
function assignProp( obj, prop, value ) {
  if (obj[prop] === undefined)
    setProp(obj, prop, value);
}

//
// create Cross Schema Reference object
//
function createSchemaRef( serviceRoots, targetSchemaName ) {
  // prepend as many path ups '..' as there are path steps in the service ref
  const serviceRef = path4(serviceRoots[targetSchemaName]).split('/').filter(c => c.length);
  serviceRef.splice(0, 0, ...Array(serviceRef.length).fill('..'));
  // uncomment this to make $metadata absolute
  // if(serviceRef.length===0)
  //   serviceRef.push('');
  if (serviceRef[serviceRef.length - 1] !== '$metadata')
    serviceRef.push('$metadata');
  const sc = {
    kind: 'reference',
    name: targetSchemaName,
    ref: { Uri: serviceRef.join('/') },
    inc: { Namespace: targetSchemaName },
  };
  setProp(sc, '$mySchemaName', targetSchemaName);
  return sc;

  /**
     * Resolve a service endpoint path to mount it to as follows...
     * Use _path or def[@path] if given (and remove leading '/')
     * Otherwise, use the service definition name with stripped 'Service'
     */
  function path4( def, _path = def['@path'] ) {
    if (_path)
      return _path.replace(/^\//, '');
    const last = def.name.split('.').at(-1); // > my.very.CatalogService --> CatalogService
    return ( // generate one from the service's name
      last
        .replace(/Service$/, '')     // > CatalogService --> Catalog
        .replace(/([a-z0-9])([A-Z])/g, (_, c, C) => `${ c }-${ C.toLowerCase() }`)  // > ODataFooBarX9 --> odata-foo-bar-x9
        .replace(/_/g, '-')  // > foo_bar_baz --> foo-bar-baz
        .toLowerCase()      // > FOO --> foo
    );
  }
}

// convert cds.Map without elements into empty open struct for a (type) definition
function convertMapToOpenStruct( node, isV4 ) {
  const typeDef = node.items || node;
  if (node.kind && isV4 && typeDef.type === 'cds.Map' && typeDef.elements == null) {
    typeDef.elements = Object.create(null);
    typeDef.type = undefined;
    assignAnnotation(node, '@open', true);
    return true;
  }
  return false;
}

module.exports = {
  convertMapToOpenStruct,
  assignAnnotation,
  assignProp,
  createSchemaRef,
  validateOptions,
  intersect,
  foreach,
  isContainee,
  isToMany,
  isNavigable,
  isSingleton,
  isStructuredType,
  isStructuredArtifact,
  isParameterizedEntity,
  isDerivedType,
  resolveOnConditionAndPrepareConstraints,
  finalizeReferentialConstraints,
  determineMultiplicity,
  getEffectiveTargetCardinality,
  mapCdsToEdmType,
  addTypeFacets,
  isODataSimpleIdentifier,
  escapeStringForAttributeValue,
  escapeStringForText,
  getSchemaPrefix,
  getBaseName,
  mergeIntoNavPropEntry,
};
