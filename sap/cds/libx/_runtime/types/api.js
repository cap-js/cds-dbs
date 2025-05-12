// Columns

/**
 * @typedef {object} ColumnRef
 * @property {string[]} ref
 * @property {function} func
 */

/**
 * @typedef {Array<ColumnRef>} ColumnRefs
 */

// Input constraints

/**
 * @typedef {object} InputConstraints
 * @property {object} element
 * @property {*} value
 * @property {Array} errors
 * @property {string} [key]
 * @property {pathSegmentInfo[]} [pathSegmentsInfo]
 * @property {string} event
 */

// ON condition

/**
 * @typedef {object} ONConditionAliases
 * @property {string} select
 * @property {string} join
 */

/**
 * @typedef {object} ONConditionOptions
 * @property {string | Array} [associationNames]
 * @property {object} [csn]
 * @property {ONConditionAliases} [aliases]
 * @property {boolean} [resolveView=true]
 */

// Template processor

/**
 * @typedef {object} TemplateProcessorInfo
 * @property {entity} target
 * @property {Map} elements
 */

/**
 * @typedef {object} TemplateProcessorPathOptions
 * @property {object} [draftKeys]
 * @property {function} [rowUUIDGenerator]
 * @property {string[]} [segments=[]] - Path segments to relate the error message.
 * @property {boolean} [includeKeyValues=false] Indicates whether the key values are included in the path segments
 * The path segments are used to build the error target (a relative resource path)
 */

/**
 * @typedef {object} TemplateProcessor
 * @property {Function} processFn
 * @property {object} data
 * @property {TemplateProcessorInfo} template
 * @property {boolean} [isRoot=true]
 * @property {TemplateProcessorPathOptions} [pathOptions=null]
 */

/**
 * @typedef {object} pathSegmentInfo
 * @property {string} key
 * @property {string[]} keyNames
 * @property {object} row
 * @property {object} elements
 * @property {string[]} draftKeys
 */

/**
 * @typedef {object} templateElementInfo
 * @property {object} row
 * @property {string} key
 * @property {object} element
 * @property {boolean} plain
 * @property {entity} target
 * @property {boolean} isRoot
 * @property {string[] | Array<pathSegmentInfo>} [pathSegmentsInfo]
 */

// Search

/**
 * @typedef {object} searchContainsArg
 * @property {ColumnRefs} [list] The columns to
 * be searched
 * @property {string} [val] The search string
 */

/**
 * @typedef {Array<searchContainsArg>} searchContainsArgs
 */

/**
 * @typedef {object} searchContainsExp
 * @property {string} func='contains' The function name
 * @property {searchContainsArgs} args
 */

/**
 * @typedef {object} search2cqnOptions
 * @property {ColumnRefs} [columns] The columns to be searched
 * @property {string} locale The user locale
 */

// Assert targets map

/**
 * @typedef {object} assertTargetMap
 * @property {Map<string, targetMaps>} targets
 * @property {targetMaps[]} allTargets
 */

/**
 * @typedef {object} targetMaps
 * @property {string} key
 * @property {entity} entity
 * @property {object} keys
 * @property {object} foreignKey
 * @property {templateElementInfo} assocInfo
 */

module.exports = {}
