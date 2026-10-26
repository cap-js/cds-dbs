'use strict'

module.exports = { resolveEnumToken, resolveEnumCastType, findEnumDefinition }

const cds = require('@sap/cds')

/**
 * Resolves an enum token to a value literal.
 *
 * If the token already has a `val`, it is used directly.
 * Otherwise, the enum value is resolved by looking up the symbol
 * in the enum definition found from the surrounding context.
 *
 * @param {object} token - The enum token with a `#` property.
 * @param {object[]} tokenStream - The surrounding token stream for context discovery.
 * @param {number} index - The index of the enum token in the token stream.
 * @param {object} [enumDef] - An already-discovered enum definition (optimization for lists).
 * @returns {object} A value token `{ val: resolvedValue }`.
 */
function resolveEnumToken(ctx, token, tokenStream, index, enumDef) {
  if ('val' in token) {
    const result = { val: token.val }
    if (token.cast) result.cast = resolveEnumCastType(ctx, token.cast)
    return result
  }

  // Check if the token itself has a cast with an enum type
  if (!enumDef && token.cast?.type) {
    const typeDef = ctx.model.definitions[token.cast.type]
    if (typeDef?.enum) enumDef = typeDef.enum
  }

  if (!enumDef) enumDef = findEnumDefinition(ctx, tokenStream, index)
  if (!enumDef) {
    throw new Error(`Can't resolve enum value "#${token['#']}"`)
  }

  const entry = enumDef[token['#']]
  if (!entry) {
    throw new Error(`Unknown enum symbol "#${token['#']}"`)
  }

  const result = { val: 'val' in entry ? entry.val : token['#'] }
  if (token.cast) result.cast = resolveEnumCastType(ctx, token.cast)
  return result
}

/**
 * If `cast.type` refers to a user-defined enum type, resolves it to the
 * underlying scalar CDS built-in type so that the SQL builder (`cqn2sql`)
 * can render a valid SQL type name.
 *
 * Example: `{ type: 'enums.Priority' }` → `{ type: 'cds.Integer' }`
 *
 * Non-enum types (including CDS built-ins) are returned unchanged.
 *
 * @param {object} cast - The cast descriptor with a `type` property.
 * @returns {object} The cast descriptor with the resolved type.
 */
function resolveEnumCastType(ctx, cast) {
  if (!cast?.type) return cast
  let def = ctx.model.definitions[cast.type]
  while (def?.enum) {
    const baseType = def.type
    if (!baseType) return cast // no base type declared – leave as-is
    if (cds.builtin.types[baseType]) return { ...cast, type: baseType }
    def = ctx.model.definitions[baseType]
  }
  return cast
}

/**
 * Scans the token stream around the given index to find an element
 * definition that has an `enum` property, which can be used to resolve
 * enum symbols to their values.
 *
 * @param {object[]} tokenStream - The token stream to scan.
 * @param {number} index - The index of the enum token.
 * @returns {object|null} The enum definition object, or null if not found.
 */
function findEnumDefinition(ctx, tokenStream, index) {
  // Scan backward
  for (let j = index - 1; j >= 0; j--) {
    const t = tokenStream[j]
    if (typeof t === 'string') continue // operators, keywords
    if (t !== null && typeof t === 'object' && '#' in t) continue // other enum tokens
    if ('val' in t && !t.ref) continue // plain value literals

    const def = t.$refLinks?.at(-1)?.definition
    if (def?.enum) return def.enum
    if (t.cast?.type) {
      const typeDef = ctx.model.definitions[t.cast.type]
      if (typeDef?.enum) return typeDef.enum
    }
    if (def) break // found a ref without enum type, stop
  }

  // Scan forward
  for (let j = index + 1; j < tokenStream.length; j++) {
    const t = tokenStream[j]
    if (typeof t === 'string') continue
    if (t !== null && typeof t === 'object' && '#' in t) continue
    if ('val' in t && !t.ref) continue

    const def = t.$refLinks?.at(-1)?.definition
    if (def?.enum) return def.enum
    if (t.cast?.type) {
      const typeDef = ctx.model.definitions[t.cast.type]
      if (typeDef?.enum) return typeDef.enum
    }
    if (def) break
  }

  return null
}
