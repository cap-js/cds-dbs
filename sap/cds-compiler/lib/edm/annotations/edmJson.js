'use strict';

const edmUtils = require('../edmUtils.js');
const { parseExpr } = require('../../transform/parseExpr');
const {
  EdmTypeFacetMap,
  EdmTypeFacetNames,
  EdmPrimitiveTypeMap,
} = require('../EdmPrimitiveTypeDefinitions.js');
const { isBuiltinType, isAnnotationExpression } = require('../../base/builtins');
const { transformExpression } = require('../../transform/db/applyTransformations.js');

/**
 * Translate a given token stream expression into an edmJson representation
 *
 * Returns $edmJson AST or val if val had no expression
 * @param {object} carrier
 * @param {object} anno
 * @param {object} location
 * @param {object} messageFunctions
 * @returns {object}
 */

function xpr2edmJson( carrier, anno, location, options, messageFunctions ) {
  const { message, error } = messageFunctions;

  const annoVal = carrier[anno];
  if (!annoVal)
    return annoVal;

  const canonicFunctionDefinitions = {
    'odata.fillUriTemplate': { min: 2 },
    'odata.uriEncode': { exact: 1 },
    // OData-ABNF
    // string
    'odata.concat': { min: 2 },
    'odata.contains': { exact: 2 },
    'odata.endswith': { exact: 2 },
    'odata.indexof': { exact: 2 },
    'odata.length': { exact: 1 },
    'odata.matchesPattern': { exact: 2 },
    'odata.startswith': { exact: 2 },
    'odata.substring': { min: 2, max: 3 },
    'odata.tolower': { exact: 1 },
    'odata.toupper': { exact: 1 },
    'odata.trim': { exact: 1 },
    // collection
    'odata.hassubset': { exact: 2 },
    'odata.hassubsequence': { exact: 2 },
    // date & time
    'odata.year': { exact: 1 },
    'odata.month': { exact: 1 },
    'odata.day': { exact: 1 },
    'odata.hour': { exact: 1 },
    'odata.minute': { exact: 1 },
    'odata.second': { exact: 1 },
    'odata.fractionalseconds': { exact: 1 },
    'odata.totalseconds': { exact: 1 },
    'odata.date': { exact: 1 },
    'odata.time': { exact: 1 },
    'odata.totaloffsetminutes': { exact: 1 },
    'odata.mindatetime': { exact: 0 },
    'odata.maxdatetime': { exact: 0 },
    'odata.now': { exact: 0 },
    // arithmetic
    'odata.round': { exact: 1 },
    'odata.floor': { exact: 1 },
    'odata.ceiling': { exact: 1 },
    // geo
    'odata.geo.distance': { exact: 2 },
    'odata.geo.length': { exact: 1 },
    'odata.geo.intersects': { exact: 2 },
    // deprecated
    'odata.cast': { use: 'cast(…)' },
    'odata.isof': { use: 'IsOf(…)' },
    'odata.case': { use: '?:' },
  };
  //----------------------------------
  // Error transformer
  const notADynExpr = (parent, op, xpr, csnPath, parentparent, parentprop, txt) => {
    error('odata-anno-xpr', location, {
      anno, op: txt ?? op, '#': 'notadynexpr',
    });
    delete parent[op];
  };
  const noOp = () => (true);
  //----------------------------------
  // Create the transformer dictionary
  const transform = {
    args: noOp,
    param: noOp,
    literal: noOp,
    //----------------------------------
    // operators not supported as dynamic expression
    '.': notADynExpr,
    isNull: (p, o) => notADynExpr(p, o, null, null, null, null, 'is null'),
    isNotNull: (p, o) => notADynExpr(p, o, null, null, null, null, 'is not null'),
    exists: notADynExpr,
    '#': notADynExpr,
    SELECT: notADynExpr,
    SET: (p, o) => notADynExpr(p, o, null, null, null, null, 'UNION'),
    like: notADynExpr,
    new: notADynExpr,
  };

  //----------------------------------
  // list is a $Collection => []
  transform.list = (parent, prop, xpr, csnPath, parentparent, parentprop) => {
    parentparent[parentprop] = xpr.filter(a => a);
    transformExpression(parentparent, parentprop, transform);
  };
  // XPR
  transform.xpr = (parent, prop, xpr, csnPath, parentparent, parentprop) => {
    // eliminate 'xpr' node by pulling up xpr node to its parent
    parentparent[parentprop] = xpr;
    transformExpression(parentparent, parentprop, transform);
  };
  //----------------------------------
  // CASE
  transform.case = (parent, prop, caseExpr) => {
    // transform simple case expression into search case expression
    // case <expr1> when <expr2> ... ===> case when <expr1> = <expr2> ...
    let i = 0;

    // single leg is not an array
    if (!Array.isArray(caseExpr))
      caseExpr = [ caseExpr ];

    if (!caseExpr[i].when) {
      caseExpr.filter(elt => elt.when).forEach((when) => {
        when.when[0] = { '=': [ caseExpr[i], when.when[0] ] };
      });
      i++;
    }
    const edmIf = { $If: [ caseExpr[i].when[0], caseExpr[i].when[1] ] };
    let curIf = edmIf;
    for (i++; i < caseExpr.length && caseExpr[i].when; i++) {
      const newEdmIf = { $If: [ caseExpr[i].when[0], caseExpr[i].when[1] ] };
      curIf.$If.push(newEdmIf);
      curIf = newEdmIf;
    }
    // else
    if (i < caseExpr.length)
      curIf.$If.push(caseExpr[i]);
    parent.$If = edmIf.$If;
    delete parent.case;
    transformExpression(parent, undefined, transform);
  };
  transform.$If = (_parent, _prop, expr) => {
    transformExpression(expr, undefined, transform);
  };
  //----------------------------------
  // Cast => $Cast
  transform.cast = (parent, prop, castExpr, csnPath, parentparent, parentprop) => {
    const csnType = castExpr[0];
    // try to resolve to final scalar base type and use that instead of derived type
    if (!isBuiltinType(csnType.type)) {
      const finalType = options.getFinalTypeInfo(csnType.type);
      if (finalType?.type && isBuiltinType(finalType.type)) {
        csnType.type = finalType.type;
        [ 'length', 'precision', 'scale', 'unicode', 'srid' ].forEach((facet) => {
          csnType[facet] ??= finalType[facet];
        });
      }
    }
    const edmTypeName = edmUtils.mapCdsToEdmType(csnType, messageFunctions, options, false, location);
    const typeFunc = { func: 'Type', args: [ { val: edmTypeName } ] };
    const castFunc = { func: '$Cast', args: [ typeFunc, castExpr[1] ] };

    if (csnType.length != null)
      typeFunc.args.push( { func: 'MaxLength', args: [ { val: csnType.length } ] });
    if (csnType.srid != null)
      typeFunc.args.push( { func: 'SRID', args: [ { val: csnType.srid } ] });
    if (csnType.unicode != null)
      typeFunc.args.push( { func: 'Unicode', args: [ { val: csnType.unicode } ] });
    if (csnType.precision != null)
      typeFunc.args.push( { func: 'Precision', args: [ { val: csnType.precision } ] });
    else if (csnType.type === 'cds.Timestamp' && edmTypeName === 'Edm.DateTimeOffset')
      typeFunc.args.push( { func: 'Precision', args: [ { val: 7 } ] });

    if (edmTypeName === 'Edm.Decimal' && csnType.precision == null && csnType.scale == null || csnType.scale === 'floating')
      typeFunc.args.push( { func: 'Scale', args: [ { val: 'variable' } ] });

    else if (csnType.scale != null)
      typeFunc.args.push( { func: 'Scale', args: [ { val: csnType.scale } ] });


    parentparent[parentprop] = castFunc;
    transformExpression(parentparent, parentprop, transform);
  };
  //----------------------------------
  const evalArgs = (argDef, args, propName) => {
    if (Array.isArray(args)) {
      args = args.filter(a => a);
      if (argDef.min != null && (!args || argDef.min > args.length)) {
        error('odata-anno-xpr-args', location, {
          anno, op: `${ propName }(…)`, count: argDef.min, '#': 'atleast',
        });
      }
      if (argDef.max != null && (!args || argDef.max < args.length)) {
        error('odata-anno-xpr-args', location, {
          anno, op: `${ propName }(…)`, count: argDef.max, '#': 'atmost',
        });
      }
      if (argDef.exact != null && (!args || argDef.exact !== args.length)) {
        if (argDef.exact === 0) {
          error('odata-anno-xpr-args', location, {
            anno, op: `${ propName }(…)`,
          });
        }
        else {
          error('odata-anno-xpr-args', location, {
            anno, op: `${ propName }(…)`, count: argDef.exact, '#': 'exactly',
          });
        }
      }
    }
  };

  // Binary Operator Macro
  const op = (opStr, exact = 2) => (parent, prop, xpr) => {
    evalArgs({ exact }, xpr, prop);
    parent[opStr] = xpr;
    delete parent[prop];
    transformExpression(parent, undefined, transform);
  };
  //----------------------------------
  // LOGICAL
  transform.and = op('$And');
  transform.$And = noOp;
  transform.or = op('$Or');
  transform.$Or = noOp;
  transform.not = op('$Not', 1);
  transform.$Not = noOp;
  //----------------------------------
  // RELATIONAL
  transform['='] = op('$Eq');
  transform['=='] = op('$Eq');
  transform.$Eq = noOp;
  transform['<>'] = op('$Ne');
  transform['!='] = op('$Ne');
  transform.$Ne = noOp;
  transform['>'] = op('$Gt');
  transform.$Gt = noOp;
  transform['>='] = op('$Ge');
  transform.$Ge = noOp;
  transform['<'] = op('$Lt');
  transform.$Lt = noOp;
  transform['<='] = op('$Le');
  transform.$Le = noOp;
  transform.in = (parent, prop, xpr) => {
    let args = xpr[1].list;
    if (!args) {
      if (Array.isArray(xpr[1].xpr))
        args = xpr[1].xpr;
      else
        args = [ xpr[1] ];
    }
    evalArgs({ min: 1 }, args, prop);
    parent.$In = [ xpr[0], args ];
    delete parent[prop];
    transformExpression(parent, undefined, transform);
  };
  transform.$In = noOp;
  transform.between = (parent, prop, xpr, csnPath, parentparent, parentprop) => {
    evalArgs({ exact: 2 }, xpr.slice(1), prop);
    transformExpression(xpr, undefined, transform);
    delete parent[prop];
    parentparent[parentprop]
    = {
        $And: [
          { $Le: [ xpr[1], xpr[0] ] },
          { $Le: [ xpr[0], xpr[2] ] },
        ],
      };
  };
  transform['||'] = (parent, prop, xpr, csnPath, parentparent, parentprop) => {
    evalArgs({ exact: 2 }, xpr, prop);
    transformExpression(xpr, undefined, transform);
    delete parent[prop];
    parentparent[parentprop].$Apply = xpr;
    parentparent[parentprop].$Function = 'odata.concat';
  };
  //----------------------------------
  // ARITHMETICAL AND UNARY
  transform['+'] = (parent, prop, xpr, csnPath, parentparent, parentprop) => {
    if (Array.isArray(xpr)) {
      op('$Add')(parent, prop, xpr);
    }
    else {
      delete parent[prop];
      parentparent[parentprop] = xpr;
      transformExpression(parentparent, parentprop, transform);
    }
  };
  transform.$Add = noOp;
  transform['-'] = (parent, prop, xpr) => {
    op(Array.isArray(xpr) ? '$Sub' : '$Neg')(parent, prop, xpr);
  };
  transform.$Sub = noOp;
  transform.$Neg = noOp;
  transform['*'] = op('$Mul');
  transform.$Mul = noOp;
  transform['/'] = op('$DivBy');
  transform.$DivBy = noOp;
  // $Div, $Mod are functions
  //----------------------------------
  // LITERALS
  transform.val = (parent, prop, xpr, csnPath, parentparent, parentprop) => {
    if (xpr === null)
      parent.$Null = true;
    else
      parentparent[parentprop] = xpr;
  };
  transform.ref = (parent, prop, xpr, csnPath, parentparent, parentprop) => {
    // until empty filter syntax is introduced for the annotation expressions,
    // we ignore the filters in order to generate EDMX
    if (xpr.some(ps => ps.args/* || ps.where */)) {
      error('odata-anno-xpr-ref', location, {
        anno, elemref: parent, '#': 'args',
      });
    }
    const [ head, ...tail ] = xpr;
    if ((head.id || head) === '$self')
      xpr = tail;
    parentparent[parentprop] = { $Path: xpr.map(ps => ps.id || ps).join('/') };
  };
  //----------------------------------
  // Functions
  transform.func = (parent, prop, xpr, csnPath, parentparent, parentprop) => {
    const rewriteArgs = (argDefs, evalVal = true) => {
      Object.entries(argDefs).forEach(([ argName, argDef ]) => {
        const [ foundProps, newArgs ]
          = parent.args
            ? parent.args.reduce((acc, arg) => {
              ((arg.func === argName) ? acc[0] : acc[1]).push(arg);
              return acc;
            }, [ [], [] ] )
            : [ [], [] ];
        parent.args = newArgs;
        if (foundProps.length !== 1) {
          error('odata-anno-xpr-args', location, {
            anno, op: `${ xpr }(…)`, prop: `${ argName }(…)`, '#': 'wrongcount',
          });
        }
        else {
          const func = foundProps[0];
          evalArgs(argDef, func.args, argName);
          if (func.args.length) {
            // set prop (eventually undefined)
            parent[argName] = /* func.args[0].ref?.join('.') || */ func.args[0].val;
            if (evalVal && !parent[argName]) {
              error('odata-anno-xpr-args', location, {
                anno, op: `${ argName }(…)`, meta: argDef.meta || 'literal', '#': 'wrongval_meta',
              });
            }
          }
        }
      });
    };

    const rewriteType = () => {
      let rc = true;
      const isDollarFunc = xpr[0] === '$';

      // Map Edm primitive type funcs to $Type funcs
      let [ foundTypeProps, newArgs ]
      = parent.args
        ? parent.args.reduce((acc, arg) => {
          (arg.func === '$Collection' || arg.func === 'Collection' ? acc[0] : acc[1]).push(arg);
          return acc;
        }, [ [], [] ] )
        : [ [], [] ];

      if (foundTypeProps.length === 1) {
        const type = foundTypeProps[0];
        evalArgs({ exact: 1 }, type.args, type.func);
        if (type.args?.length === 1) {
          const typeName = type.args[0].func;
          if (EdmPrimitiveTypeMap[`Edm.${ type.args[0].func }`])
            newArgs.push({ func: typeName, args: type.args[0].args || [] });
          else
            newArgs.push(type);

          parent.$Collection = true;
        }
        parent.args = newArgs;
      }


      let typePropName = isDollarFunc ? '$Type' : 'Type';
      [ foundTypeProps, newArgs ]
      = parent.args
          ? parent.args.reduce((acc, arg) => {
            (EdmPrimitiveTypeMap[`Edm.${ arg.func }`] ? acc[0] : acc[1]).push(arg);
            return acc;
          }, [ [], [] ] )
          : [ [], [] ];
      if (foundTypeProps.length) {
        foundTypeProps.forEach((type) => {
          const edmType = `Edm.${ type.func }`;
          const td = EdmPrimitiveTypeMap[edmType];
          const typeFuncDef = {
            func: typePropName,
            args: [ { val: edmType } ],
          };
          evalArgs(td, type.args, type.func);
          if (type.args.length) {
            let i = 0;
            EdmTypeFacetNames.forEach((facetName) => {
              const facetDef = td[facetName];
              if (facetDef && i < type.args.length) {
                const facetFuncDef = {
                  func: `${ facetName }`,
                  args: [ type.args[i++] ],
                };
                typeFuncDef.args.push(facetFuncDef);
              }
            });
          }
          newArgs.push(typeFuncDef);
        });
        parent.args = newArgs;
      }

      [ foundTypeProps, newArgs ]
      = parent.args
          ? parent.args.reduce((acc, arg) => {
            ((arg.func === '$Type' || arg.func === 'Type') ? acc[0] : acc[1]).push(arg);
            return acc;
          }, [ [], [] ] )
          : [ [], [] ];

      parent.args = newArgs;
      if (foundTypeProps.length !== 1) {
        typePropName = isDollarFunc ? '$Type' : 'Type';
        error('odata-anno-xpr-type', location, { anno, op: `${ xpr }(…)` });
        rc = false;
      }
      else {
        let typeArg;
        const typeProp = foundTypeProps[0];
        typePropName = typeProp.func;

        const [ collTypes, newTypeArgs ]
        = typeProp.args
          ? typeProp.args.reduce((acc, arg) => {
            ((arg.func === '$Collection' || arg.func === 'Collection') ? acc[0] : acc[1]).push(arg);
            return acc;
          }, [ [], [] ] )
          : [ [], [] ];
        typeProp.args = newTypeArgs;

        const [ scalarTypes, typeFacets ]
        = typeProp.args.reduce((acc, arg) => {
          ((/* arg.ref || */ arg.val) ? acc[0] : acc[1]).push(arg);
          return acc;
        }, [ [], [] ] );

        let typeOpStr = collTypes.length
          ? `${ typePropName }(${ isDollarFunc ? '$Collection' : 'Collection' }(…))`
          : `${ typePropName }(…)`;

        if (collTypes.length) {
          if (collTypes.length > 1 || scalarTypes.length) {
            error('odata-anno-xpr-type', location, { anno, op: `${ xpr }(…)` });
          }
          else {
            typeOpStr = `${ typePropName }(${ collTypes[0].func }(…))`;
            if (collTypes[0].args.length !== 1) {
              error('odata-anno-xpr-type', location, { anno, op: `${ xpr }(…)` });
            }
            else {
              typeArg = collTypes[0].args[0];
              parent.$Collection = true;
            }
          }
        }
        else if (scalarTypes.length !== 1) {
          error('odata-anno-xpr-type', location, { anno, op: `${ xpr }(…)` });
          rc = false;
        }
        else {
          typeArg = scalarTypes[0];
        }
        if (typeArg && rc) {
          // do final type checks and assignment
          const typeDef = typeArg?.ref?.join('.') || typeArg?.val;
          if (typeof typeDef !== 'string')
            error('odata-anno-xpr-type', location, { anno, op: `${ xpr }(…)` });
          else
            parent.$Type = typeDef;

          const td = EdmPrimitiveTypeMap[typeDef];
          if (td) {
            if (td.v2 !== options.isV2() && td.v4 !== options.isV4()) {
              message('odata-unexpected-edm-type', location,
                      {
                        anno,
                        type: typeDef,
                        version: (options.isV4() ? '4.0' : '2.0'),
                        '#': 'anno',
                      });
            }
            evalArgs(td, typeFacets, typeDef);
            EdmTypeFacetNames.forEach((facetName) => {
              const facetDef = EdmTypeFacetMap[facetName];
              const optional
              = (facetDef.optional !== undefined)
                ? (Array.isArray(facetDef.optional)
                  ? facetDef.optional.includes(typeDef)
                  : facetDef.optional)
                : false;

              if (td[facetName]) {
                // ignore facets that are not type relevant
                const facetFuncName = isDollarFunc ? `$${ facetName }` : facetName;
                const facetArgs = typeFacets.filter(arg => arg.func === facetName || arg.func === `$${ facetName }`);

                if (facetArgs.length === 0 && !optional && (options.isV2() === facetDef.v2 || options.isV4() === facetDef.v4)) {
                  message('odata-unexpected-edm-facet', location,
                          {
                            anno,
                            type: typeDef,
                            name: facetName,
                            version: (options.isV4() ? '4.0' : '2.0'),
                            '#': 'anno',
                          });
                }
                else if (facetArgs.length > 1) {
                  error('odata-anno-xpr-args', location, {
                    anno, op: typeOpStr, prop: `${ facetFuncName }(…)`, '#': 'wrongcount',
                  });
                }
                else if (facetArgs.length === 1) {
                  const facetArg = facetArgs[0];
                  if (facetArg.args.length !== 1) {
                    error('odata-anno-xpr-args', location, {
                      anno, op: `${ facetFuncName }(…)`, count: 1, '#': 'exactly',
                    });
                  }
                  else {
                    const facetVal = facetArg.args[0].val;
                    const isNan = Number.isNaN(Number.parseInt(facetVal, 10));
                    if (isNan && options.isV4() && facetName === 'Scale' && facetVal !== 'variable') {
                      error('odata-anno-xpr-args', location, {
                        anno,
                        op: `${ facetFuncName }(…)`,
                        meta: 'number',
                        rawvalues: [ 'variable' ],
                        '#': 'wrongval_meta_list',
                      });
                    }
                    else if (isNan && facetName !== 'Scale') {
                      error('odata-anno-xpr-args', location, {
                        anno, op: `${ facetFuncName }(…)`, meta: 'number', '#': 'wrongval_meta',
                      });
                    }
                    else {
                      parent[`$${ facetName }`] = facetVal;
                    }
                  }
                }
              }
            });
            if (typeDef === 'Edm.Decimal') {
              if (parent.$Precision && parent.$Scale) {
                const precision = Number.parseInt(parent.$Precision, 10);
                const scale = Number.parseInt(parent.$Scale, 10);
                if (!Number.isNaN(precision) && !Number.isNaN(scale) && scale > precision) {
                  message('odata-invalid-scale', location, {
                    '#': 'anno',
                    anno,
                    number: scale,
                    rawvalue: precision,
                  });
                }
              }
              if (options.isV2() && parent.$Scale === 'variable') {
                parent['@sap.variable.scale'] = true;
                delete parent.$Scale;
              }
            }
          }
          else {
            // Error out for arbitrary types until we know better
            // probably todo: Check for reachability of arb type names such as namespace
            // reqDef entry etc...
            if (typeDef) { // eslint-disable-line no-lonely-if
              error('odata-anno-xpr-type', location, {
                anno, op: `${ xpr }(…)`, type: `${ typeDef }`, '#': 'edm',
              });
            }
            /*
            typeFacets.forEach((facet) => {
              if (facet.args.length === 1 && facet.args[0].val) {
                const facetName = facet.func.startsWith('$') ? facet.func.slice(1) : facet.func;
                if (EdmTypeFacetMap[facetName])
                  parent[`$${facetName}`] = facet.args[0].val;
              }
            });
            */
          }

          delete typeProp.args;
        }
      }
      return rc;
    };

    const standard = (tgt = parent, x = xpr) => {
      tgt[x] = parent.args?.filter(a => a);
      delete parent.func;
      delete parent.args;
    };

    const exactArgs = (tgt = parent, x = xpr, count = undefined) => {
      standard(tgt, x);
      evalArgs({ exact: count }, tgt[x], xpr);
    };

    const oneArg = (tgt = parent, x = xpr) => {
      exactArgs(tgt, x, 1);
    };

    const twoArgs = (tgt = parent, x = xpr) => {
      exactArgs(tgt, x, 2);
    };

    const dollar = () => {
      parent[`$${ xpr }`] = parent[xpr];
      delete parent[xpr];
    };

    const apply = (argDefs, propName) => {
      rewriteArgs(argDefs); // $Function
      standard();
      let funcName = parent[propName];
      if (funcName) {
        if (!funcName.startsWith('odata.'))
          funcName = `odata.${ funcName }`;

        const argDef = canonicFunctionDefinitions[funcName];
        if (argDef) {
          if (argDef.use) {
            error('odata-anno-xpr', location, {
              anno, op: parent[propName], code: argDef.use, '#': 'use',
            });
          }
          else {
            evalArgs(argDef, parent[xpr], xpr);
          }
        }
        else {
          funcName = parent[propName];
          if (funcName.split('.').length !== 2) {
            error('odata-anno-xpr', location, {
              anno, op: `${ propName }(…)`, code: funcName, meta: 'namespace', othermeta: 'function', '#': 'canonfuncalias',
            });
          }
        }
      }
    };

    // these are the function transformers
    const funcDefs = {
      $Has: twoArgs,
      Has: [ twoArgs, dollar ],
      $Div: twoArgs,
      Div: [ twoArgs, dollar ],
      $Mod: twoArgs,
      Mod: [ twoArgs, dollar ],
      $Apply: () => {
        apply( { $Function: { exact: 1 } }, '$Function');
      },
      Apply: () => {
        apply({ Function: { exact: 1 } }, 'Function');
        dollar();
      },
      $Cast: () => {
        if (rewriteType())
          oneArg();
        else
          standard();
      },
      $IsOf: () => {
        if (rewriteType())
          oneArg();
        else
          standard();
      },
      IsOf: () => {
        if (rewriteType())
          oneArg();
        else
          standard();
        dollar();
      },
      $LabeledElement: () => {
        rewriteArgs({ $Name: { exact: 1, meta: 'qualified name' } });
        oneArg();
      },
      LabeledElement: () => {
        rewriteArgs({ Name: { exact: 1, meta: 'qualified name' } });
        parent.$Name = parent.Name; // Make it an attribute or rendering fails.
        delete parent.Name;
        oneArg();
        dollar();
      },
      $LabeledElementReference: () => {
        oneArg();
        if (parent[xpr].length === 1 && typeof parent[xpr][0].val !== 'string') {
          error('odata-anno-xpr-args', location, {
            anno, op: `${ xpr }(…)`, meta: 'literal', '#': 'wrongval_meta',
          });
        }
      },
      $UrlRef: oneArg,
      UrlRef: [ oneArg, dollar ],
      // $Record ???
      $Collection: () => {
        standard(parentparent, parentprop);
        transformExpression(parentparent, parentprop, transform);
      },
      $Path: () => {
        oneArg(parent, xpr);
        const args = parent[xpr];
        if (args?.length && typeof args[0].val !== 'string') {
          error('odata-anno-xpr-args', location, {
            anno, op: `${ xpr }(…)`, meta: 'string', '#': 'wrongval_meta',
          });
        }
        transformExpression(parentparent, parentprop, transform);
      },
      $Null: () => {
        parent[xpr] = true;
        delete parent.func;
        if (parent.args?.length)
          error('odata-anno-xpr-args', location, { anno, op: `${ xpr }(…)` });
        delete parent.args;
      },
    };
    funcDefs.LabeledElementReference = [ funcDefs.$LabeledElementReference, dollar ];
    funcDefs.Collection = funcDefs.$Collection;
    funcDefs.Path = funcDefs.$Path;

    const funcDef = funcDefs[xpr];
    if (funcDef) {
      if (Array.isArray(funcDef))
        funcDef.forEach(f => f());
      else
        funcDef();
      transformExpression(parent, undefined, transform);
    }
    else {
      const funcName = xpr.startsWith('odata.') ? xpr : `odata.${ xpr }`;
      const argDef = canonicFunctionDefinitions[funcName];
      if (argDef) {
        if (argDef.use) {
          error('odata-anno-xpr', location, {
            anno, op: `${ xpr }(…)`, code: argDef.use, '#': 'use',
          });
        }
        else {
          evalArgs(argDef, parent.args, xpr);
          parentparent[parentprop].$Apply = [ ...(parent.args || []) ];
          parentparent[parentprop].$Function = funcName;
          delete parentparent[parentprop].func;
          delete parentparent[parentprop].args;
          transformExpression(parentparent, parentprop, transform);
        }
      }
      else {
        error('odata-anno-xpr', location, {
          anno, op: `${ xpr }(…)`, '#': 'notadynexpr',
        });
      }
    }
    delete parent[prop];
  };

  return transformExpression(carrier, anno, {
    '=': (parent, prop, xpr, csnPath, parentparent, parentprop) => {
      if (isAnnotationExpression(parent)) {
        delete parent['='];
        parentparent[parentprop] = transformExpression({ $edmJson: parseExpr( parent, { array: false }) }, undefined, transform);
      }
    },
  });
}

// Not everything that can occur in OData annotations can be expressed with
// corresponding constructs in cds annotations. For these special cases
// we have a kind of "inline assembler" mode, i.e. you can in cds provide
// as annotation value a json snippet that looks like the final edm-json.
// See example in test/odataAnnotations/smallTests/edmJson_noReverse_ok
// and test3/ODataBackends/DynExpr

function getEdmJsonHandler( Edm, options, messageFunctions, handleTerm ) {
  const { message } = messageFunctions;

  const { v } = options;
  const dynamicExpressions = {
    $And: { create: () => new Edm.Expr(v, 'And'), anno: true },
    $Or: { create: () => new Edm.Expr(v, 'Or'), anno: true },
    $Not: { create: () => new Edm.Expr(v, 'Not'), anno: true },
    $Eq: { create: () => new Edm.Expr(v, 'Eq'), anno: true },
    $Ne: { create: () => new Edm.Expr(v, 'Ne'), anno: true },
    $Gt: { create: () => new Edm.Expr(v, 'Gt'), anno: true },
    $Ge: { create: () => new Edm.Expr(v, 'Ge'), anno: true },
    $Lt: { create: () => new Edm.Expr(v, 'Lt'), anno: true },
    $Le: { create: () => new Edm.Expr(v, 'Le'), anno: true },
    // valueThingName: 'EnumMember' Implicit Cast Rule String => Primitive Type is OK
    $Has: { create: () => new Edm.Expr(v, 'Has'), anno: true },
    $In: { create: () => new Edm.Expr(v, 'In'), anno: true },
    $Add: { create: () => new Edm.Expr(v, 'Add'), anno: true },
    $Sub: { create: () => new Edm.Expr(v, 'Sub'), anno: true },
    $Neg: { create: () => new Edm.Expr(v, 'Neg'), anno: true },
    $Mul: { create: () => new Edm.Expr(v, 'Mul'), anno: true },
    $Div: { create: () => new Edm.Expr(v, 'Div'), anno: true },
    $DivBy: { create: () => new Edm.Expr(v, 'DivBy'), anno: true },
    $Mod: { create: () => new Edm.Expr(v, 'Mod'), anno: true },
    $Apply: {
      create: () => new Edm.Apply(v),
      attr: [ '$Function' ],
      anno: true,
    },
    $Cast: {
      create: () => new Edm.Cast(v),
      attr: [ '$Type', ...EdmTypeFacetNames.map(n => `$${ n }`), '@sap.variable.scale' ],
      jsonAttr: [ '$Collection' ],
      anno: true,
    },
    $IsOf: {
      create: () => new Edm.IsOf(v),
      attr: [ '$Type', ...EdmTypeFacetNames.map(n => `$${ n }`), '@sap.variable.scale' ],
      jsonAttr: [ '$Collection' ],
      anno: true,
    },
    $If: { create: () => new Edm.If(v), anno: true },
    $LabeledElement: {
      create: () => new Edm.LabeledElement(v),
      attr: [ '$Name' ],
      anno: true,
    },
    $LabeledElementReference: {
      create: obj => new Edm.LabeledElementReference(v, obj.$LabeledElementReference),
    },
    $UrlRef: { create: () => new Edm.UrlRef(v), anno: true },
    $Null: { create: () => new Edm.Null(v), anno: true, children: false },
  };
  Object.entries(dynamicExpressions).forEach(([ k, dv ]) => {
    if (!dv.name)
      dv.name = k.slice(1);
    if (dv.children === undefined)
      dv.children = true;
  });
  const dynamicExpressionNames = Object.keys(dynamicExpressions);
  return { handleEdmJson };

  function handleEdmJson( obj, msgContext, exprDef ) {
    let edmNode;
    if (obj == null)
      return edmNode;

    const dynExprs = edmUtils.intersect(dynamicExpressionNames, Object.keys(obj));

    if (dynExprs.length > 1) {
      message('odata-anno-value', msgContext.location,
              { anno: msgContext.anno(), rawvalues: dynExprs, '#': 'multexpr' });
      return edmNode;
    }

    if (dynExprs.length === 0) {
      if (typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length === 1) {
        const k = Object.keys(obj)[0];
        const val = obj[k];
        edmNode = new Edm.ValueThing(v, k[0] === '$' ? k.slice(1) : k, val );
        edmNode.setJSON( { [edmNode.kind]: val } );
      }
      // This thing is either a record or a collection or a literal
      else if (Array.isArray(obj)) {
        // EDM JSON doesn't mention annotations on collections
        edmNode = new Edm.Collection(v);
        obj.forEach(o => edmNode.append(handleEdmJson(o, msgContext)));
      }
      else if (typeof obj === 'object') {
        edmNode = new Edm.Record(v);
        const annos = Object.create(null);
        const props = Object.create(null);
        Object.entries(obj).forEach(([ k, val ]) => {
          if (k === '@type') {
            edmNode.setJSON({ Type: val });
            // try to shorten full qualified type URI to short type name
            const parts = val.split('#');
            const shortTypeName = parts[parts.length - 1];
            edmNode.setXml({ Type: shortTypeName });
          }
          else {
            let child;
            const [ head, tail ] = k.split('@');
            if (tail) {
              child = handleTerm(tail, val, msgContext);
            }
            else {
              child = new Edm.PropertyValue(v, head);
              child.append(handleEdmJson(val, msgContext));
            }
            if (child) {
              if (tail && head.length) {
                if (!annos[head])
                  annos[head] = [ child ];
                else
                  annos[head].push(child);
              }
              else {
                if (head.length)
                  props[head] = child;
                edmNode.append(child);
              }
            }
          }
        });
        // add collected annotations to record members
        Object.entries(annos).forEach(([ n, val ]) => {
          if (props[n])
            props[n].prepend(...val);
        });
      }
      else { // literal
        edmNode = new Edm.ValueThing(v,
                                     exprDef?.valueThingName || getXmlTypeName(obj), obj);
        // typename for static expression rendering
        edmNode.setJSON( { [getJsonTypeName(obj)]: obj } );
      }
    }
    else {
      // name of special property determines element kind
      exprDef = dynamicExpressions[dynExprs[0]];
      edmNode = exprDef.create(obj);

      // iterate over each obj.property and translate expression into EDM
      Object.entries(obj).forEach(([ name, val ]) => {
        if (exprDef) {
          if (exprDef.anno && name[0] === '@' && !name.startsWith('@sap.')) {
            edmNode.append(handleTerm(name.slice(1), val, msgContext));
          }
          else if (exprDef.attr && exprDef.attr.includes(name)) {
            if (options.isV2() && name.startsWith('@sap.'))
              edmNode.setXml( { [`sap:${ name.slice(5).replace(/\./g, '-') }`]: val } );
            if (name[0] === '$')
              edmNode.setEdmAttribute(name.slice(1), val);
          }
          else if (exprDef.jsonAttr && exprDef.jsonAttr.includes(name)) {
            if (name[0] === '$')
              edmNode.setJSON( { [name.slice(1)]: val });
          }
          else if (exprDef.children) {
            if (Array.isArray(val)) {
              val.forEach((a) => {
                edmNode.append(handleEdmJson(a, msgContext, exprDef));
              });
            }
            else {
              edmNode.append(handleEdmJson(val, msgContext, exprDef));
            }
          }
        }
      });
    }
    return edmNode;

    function getXmlTypeName( val ) {
      let typeName = 'String';
      if (typeof val === 'boolean')
        typeName = 'Bool';

      else if (typeof val === 'number')
        typeName = Number.isInteger(val) ? 'Int' : 'Decimal';

      return typeName;
    }

    function getJsonTypeName( val ) {
      const typeName = getXmlTypeName(val);
      if (typeName === 'Int')
        return 'Edm.Int32';
      return `Edm.${ typeName }`;
    }
  }
}


module.exports = { xpr2edmJson, getEdmJsonHandler };
