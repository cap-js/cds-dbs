// Checks on XSN performed during compile() that are useful for the user
// but not necessary for the compiler to work.

// TODO: Major issues so far:
//  * Different ad-hoc value/type checks (associations, enum, ...) -
//    specify a proper one and use consistently
//  * Using name comparisons instead proper object comparisons.
//  * effectiveType issues.
//  * Often forgot to consider CSN input

'use strict';

const {
  forEachGeneric,
  forEachDefinition,
  forEachMember,
  forEachMemberRecursively,
  isDeprecatedEnabled,
} = require('../base/model');
const { typeParameters } = require('./builtins');
const { propagationRules } = require('../base/builtins');
const { annotationVal } = require('./utils');

const $location = Symbol.for( 'cds.$location' );

/**
 * Run compiler checks on the given XSN model.
 *
 * @param {XSN.Model} model
 */
function check( model ) {
  const {
    error, warning, info, message,
  } = model.$messageFunctions;

  const {
    getOrigin,
    getInheritedProp,
  } = model.$functions;

  checkSapCommonLocale( model );
  checkSapCommonTextsAspects( model );

  forEachDefinition( model, checkDefinition );
  forEachGeneric( model, 'vocabularies', checkAnnotationDefinition );

  return;

  function checkDefinition( def ) {
    checkEvent( def );
    checkGenericConstruct( def );
    if (def.includes && def.elements)
      checkElementIncludeOverride( def );
    forEachMember( def, member => checkMember( member ) );
    if (def.$queries)
      def.$queries.forEach( checkQuery );
  }

  function checkEvent( def ) {
    // Ensure that events are structured. Up to compiler v4, we allowed non-structured events,
    // because when we introduced them, it was not fully specified what they are.
    if (def.kind === 'event' && def._effectiveType &&
        !def._effectiveType.elements && !def._effectiveType.projection)
      message( 'def-expected-structured', [ (def.type || def.name).location, def ] );
  }

  function checkAnnotationDefinition( art ) {
    // TODO: Should we check elements similar to definition-elements as well?
    checkEnumType( art );
    forEachMemberRecursively( art, (member) => {
      if (member.localized?.val)
        warning( 'def-unexpected-localized-anno', [ member.localized.location, member ] );
    } );
  }

  function* iterateAnnotations( art ) {
    for (const prop in art) {
      if (prop.charAt(0) === '@')
        yield prop;
    }
  }

  function checkGenericConstruct( art ) {
    checkName( art );
    checkTypeArguments( art );

    if (art.value && !art.$calcDepElement && art.type)
      checkTypeCast( art.value, art );

    for (const anno of iterateAnnotations( art ))
      checkAnnotationAssignment1( art, art[anno] );

    checkTypeStructure( art );
    checkAssociation( art ); // type def could be assoc
    checkDefaultValue( art );
    checkEnumType( art );
  }

  function checkMember( member, parentProps = { key: false, virtual: false } ) {
    // To avoid "bubble-up" checks, store required parent properties.
    if (member.key?.val === true)
      parentProps.key = member.key;
    if (member.virtual?.val === true)
      parentProps.virtual = member.virtual;

    checkGenericConstruct( member );

    if (member.kind === 'element')
      checkElement( member, parentProps );

    forEachMember( member, m => checkMember( m, parentProps ) );
  }

  function checkKey( elem, parentProps ) {
    const key = parentProps.key || elem.key;
    if (!key?.val || key?.$inferred)
      return;

    const isVirtual = parentProps.virtual?.val || elem.virtual?.val;
    if (isVirtual) {
      error( 'def-unexpected-key', [ (parentProps.key || elem.key).location, elem ],
             { '#': 'virtual', prop: 'key' } );
    }
    else if (elem._effectiveType?.name?.id === 'cds.Map') {
      error( 'def-unexpected-key', [ elem.type?.location || elem.location, elem ],
             { '#': 'invalidType', prop: 'key', type: 'cds.Map' } );
    }
  }

  function checkElement( elem, parentProps ) {
    checkKey( elem, parentProps );
    checkLocalizedElement( elem );

    if (elem.value) {
      if (elem._main?.query)
        checkSelectItemValue( elem );
      else if (elem.$syntax === 'calc')
        checkCalculatedElementValue( elem );
    }

    checkCardinality( elem ); // TODO: also for assoc types
  }


  function checkName( construct ) { // TODO: move to define.js
    if (model.options.$skipNameCheck || !construct._main)
      return;
    // TODO: Move a corrected version of this check to definer (but do not rely on it!):
    //       The code below misses to consider CSN input!
    //       Maybe remove the check? But consider runtimes that rely on '.' as element separator.
    if (construct.kind === 'element' || construct.kind === 'action' || construct.kind === 'param') {
      if (construct.name.id?.includes( '.' )) {
        error( 'def-invalid-name', [ construct.name.location, construct ],
               { '#': construct.kind || 'std' } );
      }
    }
  }


  /**
   * Check the type arguments on `art`, e.g. cds.Decimal can't have a `length`, structures
   * can't have `precision`, etc.
   *
   * @param {XSN.Artifact} art
   * @param {XSN.Artifact} user
   */
  function checkTypeArguments( art, user = art ) {
    if (art.builtin || art.kind === 'context' || art.kind === 'service')
      return;

    if (art.items)
      checkTypeArguments( art.items, art );

    const actualParams = typeParameters.list.filter( param => art[param] !== undefined );
    if (actualParams.length === 0)
      return;

    const typeArt = art.type?._artifact || art;

    // Note: `_effectiveType` points to `art` itself, if it is an enum type,
    //       descend to the origin in this case.
    let effectiveType = typeArt._effectiveType;
    while (effectiveType?.enum)
      effectiveType = (effectiveType._origin || effectiveType.type?._artifact)?._effectiveType;

    if (!effectiveType || (effectiveType.type && !effectiveType.type._artifact)) {
      return; // e.g. illegal definition references, cycles, unknown artifacts, …
    }
    else if (!art.type && !effectiveType.type && !effectiveType?.builtin) {
      // Special case for deprecated flag "ignore specified elements": The `type` property
      // is lost in columns, but `length`,… are kept -> mismatch.  This behavior is the
      // same as in cds-compiler v3.  See #12169 for details.
      if (!isDeprecatedEnabled( model.options, 'ignoreSpecifiedQueryElements' )) {
        error( 'type-missing-type', [ art.location, user ],
               { otherprop: 'type', prop: actualParams[0] },
               'Missing $(OTHERPROP) property next to $(PROP)' );
      }
      return;
    }

    const expectedParams = effectiveType.parameters &&
      effectiveType.parameters.map( p => p.name || p ) || [];

    for (const param of actualParams) {
      if (!expectedParams.includes( param )) {
        // Whether the type ref itself is a builtin or a custom type with a builtin as base.
        let variant;
        if ((art.type?._artifact || art._effectiveType).builtin)
          variant = 'builtin';
        else if (effectiveType.builtin)
          variant = 'type';
        else // effectiveType is not a builtin -> array or structured
          variant = 'non-scalar';

        error( 'type-unexpected-argument', [ art[param].location, user ], {
          '#': variant, prop: param, art: art.type || art._effectiveType, type: effectiveType,
        } );
        break; // Avoid spam: Only emit the first error.
      }
      else if (!typeParameters.expectedLiteralsFor[param].includes( typeof art[param].val )) {
        // TODO: this could be probably better done via syntax check (already for CSN input)
        error( 'type-unexpected-argument', [ art[param].location, user ], {
          '#': 'incorrect-type',
          prop: param,
          code: typeof art[param].val,
          names: typeParameters.expectedLiteralsFor[param],
          // TODO: no double quote via $(NAMES), but see TODO above
        } );
        break; // Avoid spam: Only emit the first error.
      }
    }
  }

  /**
   * Check the type in an SQL cast expression.
   *
   * @param xpr
   * @param {XSN.Artifact} user
   */
  function requireExplicitTypeInSqlCast( xpr, user ) {
    if (!xpr.type) {
      error( 'expr-missing-type', [ xpr.location, user ], { },
             'Missing type in SQL cast function' );
    }
  }

  function checkTypeCast( xpr, user ) {
    const isCast = (xpr.op?.val === 'cast');
    const elem = isCast
      ? xpr.args?.[0]?._artifact
      : xpr._artifact;
    const type = isCast ? xpr.type : user.type;
    if (!isCast && type.$inferred)
      return; // e.g. $inferred:'generated'
    if (elem && type) { // has explicit type
      if (type._artifact?._effectiveType?.name.id === 'cds.Map')
        error( 'type-invalid-cast', [ type.location, user ], { '#': 'std', type: 'cds.Map' } );
      else if (type._artifact?.elements)
        error( 'type-invalid-cast', [ type.location, user ], { '#': 'to-structure' } );
      else if (elem.elements) // TODO: calc elements
        error( 'type-invalid-cast', [ type.location, user ], { '#': 'from-structure' } );
      else if (elem.target && !type._artifact?.target)
        error( 'type-invalid-cast', [ type.location, user ], { '#': 'from-assoc' } );
      else if (!elem.target && type._artifact?.target && !user.type?.$inferred)
        // $inferred already reported in resolve.js
        error( 'type-invalid-cast', [ type.location, user ], { '#': 'assoc' } );
    }
  }

  function checkLocalizedElement( elem ) {
    if (elem.localized?.val) {
      const type = elem._effectiveType;
      if (type?.category === 'map') {
        error( 'def-unexpected-localized', [ elem.localized.location, elem ],
               { keyword: 'localized', '#': 'map' } );
      }
      else if (type?.elements) { // warning only, as we want to support it in the future
        warning( 'def-unexpected-localized-struct', [ elem.localized.location, elem ],
                 { keyword: 'localized' } );
      }
      else if (!type || !type.builtin || type.category !== 'string') {
        // See discussion issue #6520: should we allow all scalar types?
        info( 'ref-expecting-localized-string', [ elem.type?.location, elem ],
              { keyword: 'localized' },
              'Expecting a string type in combination with keyword $(KEYWORD)' );
      }
    }

    // TODO: This check should be moved to localized.js - WHY?
    // "key" keyword at localized element in SELECT list.
    // TODO: not in inferred elements, but also inside aspects
    // TODO: `localized` is not necessarily at _origin, but the _origin chain
    if (elem.key?.val && elem._main?.query) {
      // either the element was casted to localized (no `_origin`) or
      // original element is localized but not key, as that would have
      // already resulted in a warning by localized.js
      if ((!elem._origin && elem.localized?.val) ||
        (elem._origin?.localized?.val && !elem._origin.key?.val)) {
        warning( 'def-ignoring-localized', [ elem.key.location, elem ], { keyword: 'localized' },
                 'Keyword $(KEYWORD) is ignored for primary keys' );
      }
    }
  }

  function checkQuery( query ) {
    // TODO: check too simple (just one source), as most of those in this file
    // Check expressions in the various places where they may occur
    if (query.from)
      visitSubExpression( query.from, query, checkGenericExpression );

    if (query.where)
      visitExpression( query.where, query, checkGenericExpression );

    if (query.groupBy) {
      for (const groupByEntry of query.groupBy)
        visitExpression( groupByEntry, query, checkGenericExpression );
    }
    if (query.having)
      visitExpression( query.having, query, checkGenericExpression );

    if (query.orderBy) {
      for (const orderByEntry of query.orderBy)
        visitExpression( orderByEntry, query, checkGenericExpression );
    }
    if (query.mixin) {
      for (const mixinName in query.mixin)
        checkAssociation( query.mixin[mixinName] );
    }
  }

  function checkEnumType( enumNode ) {
    // Either the type is an enum or an arrayed enum.  We are only interested in
    // the enum and don't care whether the enum is arrayed.
    enumNode = enumNode.enum ? enumNode : enumNode.items;
    if (!enumNode || !enumNode.enum)
      return;
    const type = enumNode?.type?._artifact?._effectiveType;

    // We can't distinguish (in CSN) between these two cases:
    //   type Base : String enum { b;a = 'abc'; };
    //   type ThroughRef : Base;            (1)
    //   type NotAllowed : Base enum { a }  (2)
    // (2) should not be allowed but (1) should be.  That's why we allow (2).
    if (!type || type.enum)
      return;

    // All builtin types are allowed except binary, structured (Map), and relational types.
    // The latter are "internal" types.
    // Structures/Arrays are not allowed.
    // TODO(v6): Reverse coding: use allow-list approach; don't forget about geo, etc.
    const invalidEnumBuiltins = {
      __proto__: null,
      structure: 'struct',
      binary: 'binary',
      relation: 'relation',
      vector: 'vector',
      map: 'map',
    };
    if (!type.builtin || type.internal || type.category in invalidEnumBuiltins) {
      let typeClass = 'std';
      if (type.category in invalidEnumBuiltins)
        typeClass = invalidEnumBuiltins[type.category];
      else if (type.elements)
        typeClass = 'struct';
      else if (type.items)
        typeClass = 'items';

      error( 'type-invalid-enum', [ enumNode.type.location, enumNode ], { '#': typeClass }, {
        std: 'Only builtin types are allowed as enums',
        binary: 'Binary types are not allowed as enums',
        relation: 'Relational types are not allowed as enums',
        struct: 'Structured types are not allowed as enums',
        vector: 'Vector types are not allowed as enums',
        items: 'Arrayed types are not allowed as enums',
        map: 'Map types are not allowed as enums',
      } );
      return;
    }

    checkEnumValue( enumNode );
  }

  /**
   * Check the given enum's elements and their values.  For example,
   * whether the value types are valid for the used enum type.
   * `enumNode` can be also be `type.items` if the type is an arrayed enum.
   *
   * @param {XSN.Definition} enumNode
   */
  function checkEnumValue( enumNode ) {
    const type = enumNode.type?._artifact?._effectiveType;
    if (!type || !enumNode.enum || !type.builtin)
      return;

    const isNumeric = type.category === 'decimal' || type.category === 'integer';
    const isString = type.category === 'string';

    if (!isString) {
      // Non-string enums MUST have a value as the value is only deducted for string types.
      const emptyValue = Object.keys( enumNode.enum )
        .find( name => !enumNode.enum[name].value );
      if (emptyValue) {
        const failedEnum = enumNode.enum[emptyValue];
        message( 'type-missing-enum-value', [ failedEnum.location, failedEnum ], {
          '#': isNumeric ? 'numeric' : 'std', name: emptyValue,
        } );
      }
    }

    // We only check string and numeric value types.
    // TODO: share value-type check with that of annotation assignments
    if (!isString && !isNumeric)
      return;

    const expectedType = isNumeric ? 'number' : 'string';

    let art = enumNode;
    while (art?._effectiveType && art.length === undefined)
      art = getOrigin( art );
    const maxLength = art.length?.val ?? model.options.defaultStringLength;

    // Do not check elements that don't have a value at all or are
    // references to other enum elements.  There are other checks for that.
    const hasWrongType = element => element.value &&
          (element.value.literal !== expectedType) &&
          (element.value.literal !== 'enum');

    for (const key in enumNode.enum) {
      const element = enumNode.enum[key];
      if (hasWrongType( element )) {
        const actualType = element.value.literal;
        warning( 'type-unexpected-value', [ element.value.location, element ], {
          '#': expectedType, name: key, prop: actualType || 'unknown',
        }, {
          std: 'Incorrect value type $(PROP) for enum element $(NAME)', // Not used
          number: 'Expected numeric value for enum element $(NAME) but was $(PROP)',
          string: 'Expected string value for enum element $(NAME) but was $(PROP)',
        } );
      }
      else if (isString && maxLength !== undefined) {
        const value = element.value?.val ?? element.name.id;
        if (value.length > maxLength) {
          const loc = element.value?.location ?? element.name.location;
          warning( 'def-invalid-value', [ loc, element ], {
            '#': element.value ? 'std' : 'implicit', name: element.name.id, value: maxLength,
          }, {
            std: 'Enum value $(NAME) exceeds specified length $(VALUE)',
            implicit: 'Implicit enum value $(NAME) exceeds specified length $(VALUE)',
          } );
        }
      }
    }
  }

  /**
   * Check that min and max cardinalities of 'art' have legal values
   *
   * TODO: move to define.js or parsers
   *
   * @param {XSN.Artifact} art
   */
  function checkCardinality( art ) {
    if (!art.cardinality)
      return;

    // Max cardinalities must be a positive number or '*'
    for (const prop of [ 'sourceMax', 'targetMax' ]) {
      if (art.cardinality[prop]) {
        const { val, location } = art.cardinality[prop];
        if (val !== '*' && val <= 0) {
          error( 'type-invalid-cardinality', [ location, art ],
                 { '#': prop, prop: val, otherprop: '*' } );
        }
      }
    }

    // If provided, min cardinality must not exceed max cardinality (note that
    // '*' is considered to be >= any number)
    const pair = [
      [ 'sourceMin', 'sourceMax', 'sourceVal' ],
      [ 'targetMin', 'targetMax', 'targetVal' ],
    ];
    pair.forEach( ([ lhs, rhs, variant ]) => {
      if (art.cardinality[lhs] && art.cardinality[rhs] &&
          art.cardinality[rhs].literal === 'number' &&
          art.cardinality[lhs].val > art.cardinality[rhs].val)
        error( 'type-invalid-cardinality', [ art.cardinality.location, art ], { '#': variant } );
    } );
  }

  function checkAssociation( elem ) {
    if (!elem.target && !elem.targetAspect)
      return;
    // TODO: yes, a check similar to this could make it into the compiler)
    //       when virtual element is part of association
    let fkCount = 0;
    if (elem.foreignKeys) {
      for (const k in elem.foreignKeys) {
        ++fkCount;
        // Note: If the foreign key is structured, we don't check its elements!
        const key = elem.foreignKeys[k].targetElement;
        if (key && isVirtualElement( key._artifact ))
          error( 'ref-unexpected-virtual', [ key.location, elem ], { '#': 'fkey' } );
        else if (key._artifact?.$syntax === 'calc' && !key._artifact.value.stored?.val)
          error( 'ref-unexpected-calculated', [ key.location, elem ], { '#': 'fkey' } );
        else if (key._artifact?._effectiveType?.name.id === 'cds.Map')
          error( 'ref-unexpected-map', [ key.location, elem ], { '#': 'keys', type: 'cds.Map' } );
      }
    }
    if (elem.default?.val !== undefined) {
      if (elem.targetAspect || elem.on || fkCount !== 1) {
        const variant = (elem.targetAspect && 'targetAspect') || (elem.on && 'onCond') || 'multi';
        error( 'type-unexpected-default', [ elem.default.location, elem ], {
          '#': variant, keyword: 'default', count: fkCount,
        } );
      }
      else {
        const fkName = Object.keys( elem.foreignKeys )[0];
        if (elem.foreignKeys[fkName].targetElement._artifact?._effectiveType?.elements) {
          error( 'type-unexpected-default', [ elem.default.location, elem ], {
            '#': 'structuredKey', keyword: 'default', name: fkName,
          } );
        }
      }
    }

    checkOnCondition( elem );
  }

  function checkDefaultValue( art ) {
    if (!art._effectiveType)
      return;
    if (art.kind !== 'element' && art.kind !== 'type' && art.kind !== 'param')
      return;

    const defaultValue = getInheritedProp( art, 'default' );
    if (defaultValue?.val === undefined)
      return;

    // Check that "not null" artifacts don't have `null` default values.
    // At least one property must be written explicitly to avoid reporting on inferred elements.
    if (art.default?.val === null || art.notNull?.val) {
      const notNullValue = getInheritedProp( art, 'notNull' );
      if (notNullValue?.val && defaultValue?.val === null) {
        const loc = (art.default || art.notNull)?.location || art.location;
        const variant = art.kind + (!art.default && art.notNull ? 'NotNull' : 'DefaultNull');
        message( 'type-unexpected-null', [ loc, art ], {
          '#': variant,
          art,
          keyword: 'not null',
          value: 'null',
        } );
      }
    }

    const isMap = art._effectiveType?.name.id === 'cds.Map';
    if (isMap) {
      error( 'type-unexpected-default', [ defaultValue.location, art ], {
        '#': 'map', keyword: 'default', type: 'cds.Map',
      } );
    }
    else if (art._effectiveType?.elements) {
      // TODO: error for v7
      warning( 'type-unexpected-default-struct', [ defaultValue.location, art ], {
        '#': art.kind, keyword: 'default',
      }, {
        std: 'Unexpected $(KEYWORD) for a structure',
        param: 'Unexpected $(KEYWORD) for a structured parameter',
        type: 'Unexpected $(KEYWORD) for a structured type definition',
        element: 'Unexpected $(KEYWORD) for a structured element',
      } );
    }
  }

  function getBinaryOp( cond ) {
    const { op, args } = cond;
    return op?.val === 'ixpr' && args?.length === 3 && args[1].literal === 'token' &&
      args[1] || op;
  }

  /**
   * TODO: A function like this could be part of the compiler
   *
   * Check that the given type has no conflicts between its `type` property
   * and its `elements` or `items` property. For example if `type` is not
   * structured but the artifact has an `elements` property then the user
   * made a mistake. This scenario can only happen through CSN and not CDL.
   *
   * @param {XSN.Artifact} artifact
   */
  function checkTypeStructure( artifact ) {
    // Just a basic check. We do not check that the inner structure of `items`
    // is the same as the type but only that all are arrayed or structured.
    if (artifact.type?._artifact) {
      const finalType = artifact.type._artifact._effectiveType || artifact.type._artifact;

      if (artifact.items && !finalType.items) {
        warning( 'type-items-mismatch', [ artifact.type.location, artifact ],
                 { type: artifact.type, prop: 'items' },
                 'Used type $(TYPE) is not arrayed and conflicts with $(PROP) property' );
      }
      else if (artifact.elements && !finalType.elements) {
        // TODO: Handle cds.Map!
        warning( 'type-elements-mismatch', [ artifact.type.location, artifact ],
                 { type: artifact.type, prop: 'elements' },
                 'Used type $(TYPE) is not structured and conflicts with $(PROP) property' );
      }
    }
    if (artifact.items)
      checkTypeStructure( artifact.items );
  }

  /**
   * Report issues when an entity overrides structured elements of an included entity
   * with a scalar one or vice versa.
   *
   * NOTE: Relies on element expansion.
   */
  function checkElementIncludeOverride( def ) {
    for (const name in def.elements) {
      const element = def.elements[name];
      // Element is new in `art`, not expanded; we can't check for !element._origin, due
      // to calculated elements such as `a = b`.
      if (element.$inferred !== 'include' && element.$inferred !== 'aspect-composition') {
        for (const include of def.includes) {
          if (include._artifact?.elements?.[name] !== undefined)
            checkElementOverride( element, include._artifact.elements[name] );
        }
      }
    }

    return;

    function checkElementOverride( elem, original ) {
      const xorElements = !elem.elements !== !original.elements;
      if (xorElements) {
        // one of the two elements is not structured
        const prop = !elem.elements ? 'new-not-structured' : 'old-not-structured';
        // Position at type/struct, not name
        const loc = elem.type?.location || elem.elements?.[$location] || elem.location;
        error( 'ref-invalid-override', [ loc, elem ],
               { '#': prop, art: original._main, name: elem.name.id } );
        return false;
      }
      else if (original.elements &&
        !checkSubStructureOverride( elem, elem.elements, original.elements )) {
        return false;
      }

      const xorTarget = !(elem.target || elem.targetAspect) !==
        !(original.target || original.targetAspect);
      if (xorTarget) {
        // one of the two elements is not an association
        const prop = !elem.target ? 'new-not-target' : 'old-not-target';
        // Position at type/assoc, not name
        const loc = elem.target?.location || elem.type?.location || elem.location;
        error( 'ref-invalid-override', [ loc, elem ],
               { '#': prop, art: original._main, name: elem.name.id } );
        return false;
      }
      return true;
    }

    /**
     * Ensure the new one has at least as many elements as the original.
     */
    function checkSubStructureOverride( user, elements, originals ) {
      for (const element in originals) {
        const elem = elements[element];
        const orig = originals[element];
        if (elem === undefined) {
          const loc = [ elements[$location], user ];
          error( 'ref-invalid-override', loc, { '#': 'missing', id: user.name.id, name: element } );
          return false; // only report once
        }
        else if (!checkElementOverride( elem, orig )) {
          return false;
        }
      }
      return true;
    }
  }


  /**
   * Check a generic expression (or condition) for semantic validity.
   *
   * @param {any} xpr The expression to check
   * @param {XSN.Artifact} user User for semantic location
   * @param {string} [context] where the expression is used, e.g. 'anno'
   */
  function checkGenericExpression( xpr, user, context ) {
    if (context !== 'anno')
      checkExpressionNotVirtual( xpr, user );
    checkExpressionAssociationUsage( xpr, user, false );
    if (xpr.op?.val === 'cast') {
      requireExplicitTypeInSqlCast( xpr, user );
      checkTypeCast( xpr, user );
      checkTypeArguments( xpr, user );
    }
  }

  function checkExpressionNotVirtual( xpr, user ) {
    if (xpr._artifact && isVirtualElement( xpr._artifact ))
      error( 'ref-unexpected-virtual', [ xpr.location, user ], { '#': 'expr' } );
  }

  function checkOnCondition( elem ) {
    if (elem.$inferred === 'localized')
      return; // ignore
    if (!elem.on || elem.on.$inferred)
      return;

    visitExpression( elem.on, elem, (xpr, user) => {
      checkExpressionNotVirtual( xpr, user );
      checkExpressionAssociationUsage( xpr, user, true );

      if (xpr._artifact?._effectiveType?.name.id === 'cds.Map') {
        error( 'ref-unexpected-map', [ xpr.location, user ], { '#': 'onCond', type: 'cds.Map' } );
      }
      else if (xpr._artifact?.$syntax === 'calc' && !xpr._artifact.value.stored?.val) {
        // Essential check. Dependency handling for `on` conditions must change if
        // this is allowed.  See test3/Associations/Dependencies/.
        error('ref-unexpected-calculated', [ xpr.location, user ], { '#': 'on' });
      }
    } );
  }

  function checkSelectItemValue( elem ) {
    checkExpressionAssociationUsage( elem.value, elem, false );
    checkVirtualSelectItemChangeForV6( elem );
    // To avoid duplicate messages, only run this check if the type wasn't inferred from
    // the cast, as otherwise we will check it twice (once here, once via element).
    if (elem.value?.op?.val === 'cast' && elem.type?.$inferred !== 'cast') {
      requireExplicitTypeInSqlCast( elem.value, elem );
      checkTypeCast( elem.value, elem );
      checkTypeArguments( elem.value, elem );
    }
    visitSubExpression( elem.value, elem, (xpr) => {
      checkGenericExpression( xpr, elem );
    } );
  }

  /**
   * In v6, there will be a change in semantics for following example:
   *
   * ```cds
   * view V as select from E {
   *   virtual b, // -> warning: will be new element, not reference in v6
   * }
   * ```
   *
   * We allow users to define _new_ elements using `virtual`.  But all such references
   * in v5 are valid, resolvable references. Hence, the semantics will change in v6.
   * Let users know about it.
   *
   * @param elem
   *
   * TODO: simplify if the old parser is gone (query-invalid-virtual-struct stays)
   */
  function checkVirtualSelectItemChangeForV6( elem ) {
    if (
        !elem.virtual?.val || elem.virtual.$inferred || // not explicitly marked virtual
        !elem.name.$inferred ||                         // has explicit alias
        elem._columnParent ||   // virtual inside expand/inline is already error
        elem._parent.kind === 'element' ||              // dito (expand without ref)
        !elem.value?.path && !elem.value?.func ||       // neither ref nor function call
        elem.value.args ||                              // arguments (with function call)
        elem.value.path?.length > 1 || // multi-path step, i.e. no new definition
        elem.value.path?.some( ps => ps.args || ps.where ) // not a simple reference
    )
      return;

    if (elem.expand) {
      warning( 'query-invalid-virtual-struct', [ elem.expand[$location], elem ],
               { code: `as ${ elem.name.id }` } );
    }
    else {
      error( 'def-upcoming-virtual-change', [ elem.virtual.location, elem ] );
    }
  }

  function checkCalculatedElementValue( elem ) {
    const isStored = elem.value.stored?.val;
    visitExpression( elem.value, elem, (xpr, user) => {
      // We only need to check artifact references.  To avoid false positives and conflicts
      // with $self comparison-checks, ignore bare $self.
      const isArtRef = xpr._artifact && !(xpr.path?.length === 1 &&
          xpr.path[0]._navigation?.kind === '$self');
      if (isArtRef) {
        const lastStep = xpr.path?.[xpr.path.length - 1];
        const sourceLoc = lastStep.location || xpr.location;
        checkExpressionNotVirtual( xpr, user );
        // For inferred (e.g. included) calc elements, this error is already emitted at the origin.
        // And users can't change structured to non-structured elements.
        if (!elem.$inferred && xpr._artifact._effectiveType?.elements) {
          error( 'ref-unexpected-structured', [ sourceLoc, elem ], { '#': 'expr' } );
        }
        else if (xpr._artifact.target !== undefined && (!lastStep.where || isStored)) {
          // Allow using an association _with filter_, but only for on-read calculated elements.
          // TODO: Also allow bare unmanaged association references and remove beta.
          const variant = (isStored && lastStep.where && 'assoc-stored') ||
            (isComposition( model, xpr._artifact ) && 'expr-comp') ||
            'expr';
          error( 'ref-unexpected-assoc', [ sourceLoc, elem ], { '#': variant } );
        }
        else if (xpr._artifact.localized?.val && isStored) {
          error( 'ref-unexpected-localized', [ sourceLoc, elem ], { '#': 'calc' } );
        }
      }
    } );
    // Calculated elements must not refer to keys, because that may lead to another
    // key in an SQL view, which is missing in OData (for on-read).
    // Following associations does not lead to this issue.
    if (elem.value.path && isKeyElement( elem.value._artifact ) &&
      !followsAnAssociation( elem.value.path )) {
      error( 'ref-unexpected-key', [ elem.value.location, elem ], {},
             'Calculated elements can\'t refer directly to key elements' );
    }
  }

  /**
   * Returns true if any of the path steps follows an association.
   *
   * @param path
   * @return {boolean}
   */
  function followsAnAssociation( path ) {
    for (const step of path) {
      if (step._artifact?.target)
        return true;
    }
    return false;
  }

  function isKeyElement( elem ) {
    let parent = elem;
    while (parent) {
      if (parent.key?.val === true)
        return true;
      parent = parent._parent;
    }
    return false;
  }


  /**
   * Check whether the supplied argument is a virtual element
   *
   * TO CLARIFY: do we want the "no virtual element" check for virtual elements/columns, too?
   *
   * @param {any} elem Element to check (part of an expression)
   * @returns {Boolean}
   */
  function isVirtualElement( elem ) {
    let parent = elem?._origin || elem;
    while (parent) {
      if (parent.virtual?.val === true)
        return true;
      parent = parent._parent;
    }
    return false;
  }

  /**
   * Check a tree-like expression for semantic validity
   *
   * @param {any} xpr The expression to check
   * @param {XSN.Artifact} user
   * @param {boolean} allowAssocTail
   * @returns {void}
   */
  function checkExpressionAssociationUsage( xpr, user, allowAssocTail ) {
    if (!xpr.args)
      return;

    // Only check associations and $self if this is not a backlink-like
    // expression (a comparison of $self with an assoc).
    // We don't check token-stream-like 'xpr's.
    const args = Array.isArray( xpr.args ) ? xpr.args : Object.values( xpr.args );
    const isNotSelfComparison = args.length > 0 && xpr.op?.val !== 'xpr' &&
        !isBinaryDollarSelfComparisonWithAssoc( xpr );

    if (isNotSelfComparison) {
      const op = getBinaryOp( xpr );
      for (const arg of args) {
        if (arg && !(op?.val !== '=' && isDollarSelfOrProjectionOperand( arg )))
          checkExpressionIsNotAssocOrSelf( arg, user, allowAssocTail );
      }
    }
  }

  function checkExpressionIsNotAssocOrSelf( arg, user, allowAssocTail ) {
    // Arg must not be an association and not $self
    // Only if path is not approved exists path (that is non-query position)
    if (arg.path && arg.$expected !== undefined) { // not 'approved-exists'
      if (arg.$expected === 'exists') {
        const variant = isComposition( model, arg._artifact ) ? 'expr-comp' : 'expr';
        error( 'ref-unexpected-assoc', [ arg.location, user ], { '#': variant } );
      }
    }
    else if (!allowAssocTail && isAssociationOperand( arg )) {
      const variant = isComposition( model, arg._artifact ) ? 'expr-comp' : 'expr';
      error( 'ref-unexpected-assoc', [ arg.location, user ], { '#': variant } );
    }
  }

  /**
   * Return true if 'arg' is an expression argument of type association or composition.
   */
  function isAssociationOperand( arg ) {
    // If it has a target, it is an association or composition
    return !!arg._artifact?._effectiveType?.target;
  }

  /**
   * Return true if 'arg' is an expression argument denoting "$self" || "$projection"
   */
  function isDollarSelfOrProjectionOperand( arg ) {
    return arg.path?.length === 1 &&
      (arg.path[0].id === '$self' || arg.path[0].id === '$projection');
  }

  /**
   * Return true if 'xpr' is backlink-like expression (a comparison of "$self" with an assoc)
   *
   * @param {any} xpr The expression to check
   * @returns {Boolean}
   */
  function isBinaryDollarSelfComparisonWithAssoc( xpr ) {
    // Must be an expression with arguments
    if (!xpr.op || !xpr.args)
      return false;

    // One argument must be "$self" and the other an assoc
    if (xpr.op.val === '=' && xpr.args.length === 2) {
      // Tree-ish expression from the compiler (not augmented)
      // eslint-disable-next-line @stylistic/js/max-len
      return (isAssociationOperand( xpr.args[0] ) && isDollarSelfOrProjectionOperand( xpr.args[1] ) ||
      // eslint-disable-next-line @stylistic/js/max-len
              isAssociationOperand( xpr.args[1] ) && isDollarSelfOrProjectionOperand( xpr.args[0] ));
    }
    else if (xpr.args.length === 3 && xpr.args[1].val === '=') {
      // Tree-ish expression from the compiler (not augmented)
      // eslint-disable-next-line @stylistic/js/max-len
      return (isAssociationOperand( xpr.args[0] ) && isDollarSelfOrProjectionOperand( xpr.args[2] ) ||
              // eslint-disable-next-line @stylistic/js/max-len
              isAssociationOperand( xpr.args[2] ) && isDollarSelfOrProjectionOperand( xpr.args[0] ));
    }

    // Nothing else qualifies
    return false;
  }

  /**
   * Returns true if the given annotation accepts expressions as values.
   *
   * @param {object} anno
   * @param {XSN.Artifact} art
   * @returns {boolean}
   */
  function checkAnnotationAcceptsExpressions( anno, art ) {
    const name = anno.name?.id;
    if (!name)
      return true;
    if (!propagationRules[`@${ name }`])
      return true;
    error( 'anno-unexpected-expr', [ anno.location, art ], { anno: name },
           'Unexpected expression as value for $(ANNO)' );
    return false;
  }

  function checkAnnotationAssignment1( art, anno ) {
    const name = anno.name?.id;
    if (art.$contains?.$annotation && anno.kind === '$annotation') {
      if (checkAnnotationAcceptsExpressions( anno, art ))
        checkAnnotationExpressions( anno, art );
    }

    // Has been slightly adapted for model.vocabularies but comments need to be
    // adapted, etc.
    // TODO: rework completely!
    // TODO: if we have such a check, consider #variant, anno.@anno, anno@anno
    // Sanity checks (ignore broken assignments)
    if (!name)
      return;

    // Compiler specific annotation validation.
    const annotationChecks = {
      __proto__: null,
      '@cds.redirection.target': checkAnnoRedirectionTarget,
    };

    const annoName = `@${ name }`;
    annotationChecks[annoName]?.(anno, art);

    if (!model.vocabularies)
      return;

    // Just a little workaround to adapt to changed `name`s, not nice coding:
    const hashIndex = anno.name.id.indexOf( '#' );
    const path = (hashIndex > 0 ? anno.name.id.substring( 0, hashIndex ) : anno.name.id)
      .split( '.' ).map( id => ({ id }) );

    // Annotation artifact for longest path step of annotation path
    let fromArtifact = null;
    let pathStepsFound = 0;
    for (let i = path.length; i > 0; i--) {
      const absoluteName = path.slice( 0, i ).map( p => p.id ).join( '.' );
      if (model.vocabularies[absoluteName]) {
        fromArtifact = model.vocabularies[absoluteName];
        pathStepsFound = i;
        break;
      }
    }

    if (!fromArtifact) {
      // Unchecked annotation => nothing to check
      return;
    }

    const { artifact, endOfPath } = resolvePathFrom( path.slice( pathStepsFound ),
                                                     fromArtifact );

    // Check what we actually want to check
    checkAnnotationAssignment( anno, artifact, endOfPath, art );
  }

  function checkAnnoRedirectionTarget( anno, art ) {
    if (anno.$inferred)
      return;
    if (!annotationVal( anno ))
      return; // ignore falsey values, including 'null'

    // Non-entities can't have this annotation, nor can non-service entities,
    // nor can complex queries such as joins, unions, or selecting from an association.

    const isIgnored = isComplexView( art ) || (art.kind !== 'entity') || !art._service;
    if (isIgnored) {
      const loc = anno.val ? anno.location : anno.name.location;
      info( 'anno-ignoring-redirection-target', [ loc, art ], { anno: anno.name.id },
            '$(ANNO) has no effect here; use it on simple projections inside services' );
    }
  }

  // Perform checks for annotation assignment 'anno', using corresponding annotation declaration,
  // made of 'annoDecl' (artifact or undefined) and 'elementDecl' (annotation or element
  // or undefined). Report errors on 'options.messages.
  function checkAnnotationAssignment( anno, annoDecl, elementDecl, art ) {
    // Nothing to check if no actual annotation declaration was found
    if (!annoDecl || annoDecl.artifacts && !elementDecl)
      return;

    // Must be an annotation if found
    if (annoDecl.kind !== 'annotation') // i.e namespace
      return;

    // Element must exist in annotation
    if (!elementDecl) {
      warning( null, [ anno.location || anno.name.location, art, anno ],
               { name: anno.name.id, anno: annoDecl.name.id },
               'Element $(NAME) not found for annotation $(ANNO)' );
      return;
    }

    if (!elementDecl._effectiveType)
      return; // type resolution error

    // Must have literal or path unless it is a boolean
    if (!anno.literal && !anno.path && elementDecl._effectiveType.category !== 'boolean') {
      if (elementDecl.type?._artifact) {
        warning( 'anno-expecting-value', [ anno.location || anno.name.location, art, anno ],
                 { '#': 'type', type: elementDecl.type._artifact } );
      }
      else {
        warning( 'anno-expecting-value', [ anno.location || anno.name.location, art, anno ],
                 { '#': 'std', anno: anno.name.id } );
      }
      return;
    }

    // Value must be assignable to type
    checkValueAssignableTo( anno, anno, elementDecl, art );
  }

  /**
   * Check the expressions inside annotations.
   */
  function checkAnnotationExpressions( anno, art ) {
    if (anno.$tokenTexts) {
      checkGenericExpression( anno, art, 'anno' );
    }
    else if (anno.literal === 'array') {
      anno.val.forEach( val => checkAnnotationExpressions( val, art ) );
    }
    else if (anno.literal === 'struct') {
      const struct = Object.values(anno.struct);
      struct.forEach(val => checkAnnotationExpressions( val, art ));
    }
  }

  // Check that annotation assignment 'value' (having 'path or 'literal' and
  // 'val') is potentially assignable to element 'element'. Complain on 'loc'
  // if not
  function checkValueAssignableTo( annoDef, value, elementDecl, art ) {
    // FIXME: We currently do not have any element declaration that could match
    //        a 'path' value, so we simply leave those alone
    if (value.path)
      return;

    const anno = annoDef.name.id;
    const loc = [ value.location || value.name.location, art, annoDef ];

    // Array expected?
    if (elementDecl._effectiveType.items) {
      // Make sure we have an array value
      if (value.literal !== 'array') {
        warning( null, loc, { anno }, 'An array value is required for annotation $(ANNO)' );
        return;
      }
      // Check each element
      for (const valueItem of value.val)
        checkValueAssignableTo( value, valueItem, elementDecl._effectiveType.items, art );

      return;
    }

    // Struct expected (can only happen within arrays)?
    if (elementDecl._effectiveType.elements) {
      if (value.literal !== 'struct') {
        warning( null, loc, { anno }, 'A struct value is required here for annotation $(ANNO)' );
        return;
      }
      // FIXME: Should check each element
      return;
    }

    // Handle each (primitive) expected element type separately
    // TODO: Don't rely on name; use actual type
    const type = elementDecl._effectiveType;
    if (!type)
      return;
    if (type.category === 'string') {
      if (value.literal !== 'string' && value.literal !== 'enum' &&
          !elementDecl._effectiveType.enum) {
        warning( null, loc, { type, anno },
                 'A string value is required for type $(TYPE) for annotation $(ANNO)' );
      }
    }
    else if (type.category === 'binary') {
      if (value.literal !== 'string' && value.literal !== 'x') {
        warning( null, loc, { type, anno },
                 'A hexadecimal string value is required for type $(TYPE) for annotation $(ANNO)' );
      }
    }
    else if (type.category === 'decimal' || type.category === 'integer') {
      if (value.literal !== 'number' && value.literal !== 'enum' &&
          !elementDecl._effectiveType.enum) {
        warning( null, loc, { type, anno },
                 'A numerical value is required for type $(TYPE) for annotation $(ANNO)' );
      }
    }
    else if (type.category === 'dateTime') {
      if (value.literal !== 'date' && value.literal !== 'time' &&
          value.literal !== 'timestamp' && value.literal !== 'string') {
        // Hm, actually date and time cannot be mixed
        warning( null, loc, { type, anno },
          // eslint-disable-next-line @stylistic/js/max-len
                 'A date/time value or a string is required for type $(TYPE) for annotation $(ANNO)' );
      }
    }
    else if (type.category === 'boolean') {
      if (value.literal && value.literal !== 'boolean') {
        warning( null, loc, { type, anno },
                 'A boolean value is required for type $(TYPE) for annotation $(ANNO)' );
      }
    }
    else if (type.target || type.category === 'geo') {
      warning( null, loc, { type: (type.target ? 'cds.Association' : type), anno },
               'Type $(TYPE) can\'t be assigned a value for annotation $(ANNO)' );
      // TODO: complain at definition instead
    }
    else if (!type.enum) {
      // type error somewhere; ignore
      return;
    }

    // Check enums
    const expectedEnum = elementDecl._effectiveType.enum;
    if (value.literal === 'enum') {
      if (expectedEnum) {
        // Enum symbol provided and expected
        if (!expectedEnum[value.sym.id]) {
          // ... but no such constant
          warning( null, loc, { id: `#${ value.sym.id }`, anno }, 'Enum symbol $(ID) not found in enum for annotation $(ANNO)' );
        }
      }
      else {
        // Enum symbol provided but not expected
        warning( null, loc, { id: `#${ value.sym.id }`, type, anno },
                 'Can\'t use enum symbol $(ID) for non-enum type $(TYPE) for annotation $(ANNO)' );
      }
    }
    else if (expectedEnum) {
      // Enum symbol not provided but expected
      const hasValidValue = Object.keys( expectedEnum )
        .some( symbol => getEnumValue( expectedEnum[symbol] ) === value.val );
      if (!hasValidValue) {
        // ... and none of the valid enum symbols matches the value
        warning( null, loc, { anno }, 'An enum value is required for annotation $(ANNO)' );
      }
    }
  }

  function getEnumValue( enumSymbol ) {
    if (enumSymbol.value)
      return enumSymbol.value?.val;
    if (enumSymbol._effectiveType)
      return enumSymbol._effectiveType?.value?.val;
    return null;
  }

  // TODO: remove
  // Return the artifact (and possibly, its element) found by following 'path'
  // starting at 'from'.  The return value is an object { artifact, endOfPath }
  // with 'artifact' being the last artifact encountered on 'path' (or
  // 'undefined' if none found), and 'endOfPath' being the element or artifact
  // represented by the full path (or 'undefined' if not found).  Note that
  // only elements and artifacts are considered for path traversal (no actions,
  // functions, parameters etc.)
  function resolvePathFrom( path, from, result = {} ) {
    // Keep last encountered artifacts
    if (from && !from._main)
      result.artifact = from;

    // Always keep current path end
    result.endOfPath = from;
    // Stop if found or failed
    if (path.length === 0 || !from)
      return result;

    // Continue search with next path step
    const nextStepEnv = (from._effectiveType || from).artifacts ||
          from._effectiveType?.elements || [];
    return resolvePathFrom( path.slice(1), nextStepEnv[path[0].id], result );
  }
}

/**
 * Ensure that the `locale` element of `sap.common.TextsAspects`
 * is a string type.  This is required by CAP runtimes to work properly.
 *
 * @param {XSN.Model} model
 */
function checkSapCommonTextsAspects( model ) {
  const name = 'sap.common.TextsAspect';
  const locale = model.definitions[name]?.elements?.locale;
  if (locale) {
    // `locale` could also be `sap.common.Locale`, which must also be a string.
    if (locale._effectiveType !== model.definitions['cds.String']) {
      const hasCommonLocale = !!model.definitions['sap.common.Locale'];
      const { error } = model.$messageFunctions;
      error( 'def-invalid-element-type', [ (locale.type || locale.name).location, locale ], {
        '#': hasCommonLocale ? 'texts-aspect-locale' : 'std',
        art: name,
        elemref: 'locale',
        type: 'cds.String',
        othertype: 'sap.common.Locale',
      } );
    }
  }
}

/**
 * Checks that sap.common.Locale is of type cds.String.  This limitation may
 * be lifted later on.
 *
 * @param {XSN.Model} model
 */
function checkSapCommonLocale( model ) {
  const localeArt = model.definitions['sap.common.Locale'];
  if (localeArt) {
    if (localeArt._effectiveType !== model.definitions['cds.String']) {
      const { message } = model.$messageFunctions;
      message( 'type-expected-builtin', [ localeArt.name.location, localeArt ],
               { name: 'sap.common.Locale' },
               'Expected $(NAME) to be a string type' );
    }
  }
}


/**
 * Visits each expression.
 *
 * TODO: Properly visit expressions; will be improved step by step;
 *       Currently only replaces old foreachPath(), which had very poor performance.
 *
 * @param {any} xpr
 * @param {XSN.Artifact} user
 * @param {(xpr: any, user: any, parentExpr: any) => void} callback
 */
function visitExpression( xpr, user, callback ) {
  if (!xpr)
    return; // e.g. parse error

  callback( xpr, user, null );
  visitSubExpression( xpr, user, callback );
}

/**
 * Visits each sub-expression.
 *
 * @param {any} xpr
 * @param {XSN.Artifact} user
 * @param {(xpr: any, user: any, parentExpr: any) => void} callback
 */
function visitSubExpression( xpr, user, callback ) {
  if (xpr.args) {
    const args = Array.isArray( xpr.args ) ? xpr.args : Object.values( xpr.args );
    // Check for illegal argument usage within the expression
    for (const arg of args) {
      if (arg) { // null for parse errors
        callback( arg, user, xpr.args );
        // Recursively traverse the argument expression
        visitSubExpression( arg, user, callback );
      }
    }
  }

  if (xpr.path?.length) {
    for (const arg of xpr.path) {
      if (arg.where) {
        callback( arg.where, user, arg );
        visitSubExpression( arg.where, user, callback );
      }
    }
  }
}

/**
 * Whether the given element is a composition.
 * TODO: `type T: Composition of E; entity V { e: T default 3 };`
 * See also getUnderlyingBuiltinType()/compositionTextVariant() in utils.js.
 *
 * @return {boolean}
 */
function isComposition( model, elem ) {
  elem = elem?._effectiveType;
  if (!elem || !elem.target)
    return false;
  do {
    if (elem.type?._artifact === model.definitions['cds.Composition'])
      return true;
    // Because inferred elements don't have a direct `type` property,
    // we need to go along the origin chain.
    elem = elem._origin;
  } while (elem);
  return false;
}

function isComplexView( art ) {
  if (!art?.query) // non-query
    return false;
  // Either UNION, JOIN, SUB-SELECT, or target is an association
  return (!art.query.from?._artifact || art.query.from._artifact.kind === 'element');
}

module.exports = check;
