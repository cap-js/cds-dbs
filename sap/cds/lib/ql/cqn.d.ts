/**
 * `INSERT` and `UPSERT` queries are represented by the same internal
 * structures. The `UPSERT` keyword is used to indicate that the
 * statement should be updated if the targeted data exists.
 * The `into` property specifies the target entity.
 *
 * The data to be inserted or updated can be specified in different ways:
 *
 * - in the `entries` property as deeply nested records.
 * - in the `columns` and `values` properties as in SQL.
 * - in the `columns` and `rows` properties, with `rows` being array of `values`.
 * - in the `from` property with a `SELECT` query to provide the data to be inserted.
 *
 * The latter is the equivalent of SQL's `INSERT INTO ... SELECT ...` statements.
 */
export class INSERT { INSERT: UPSERT['UPSERT'] }
export class UPSERT { UPSERT: {
  into      : ref
  entries?  : data[]
  columns?  : string[]
  values?   : scalar[]
  rows?     : scalar[][]
  from?     : SELECT
}}


/**
 * `UPDATE` queries are used to capture modifications to existing data.
 * They support a `where` clause to specify the rows to be updated,
 * and a `with` clause to specify the new values. Alternatively, the
 * `data` property can be used to specify updates with plain data only.
 */
export class UPDATE { UPDATE: {
  entity  : ref
  where?  : expr
  data    : data
  with    : changes
}}


/**
 * `DELETE` queries are used to remove data from a target datasource.
 * They support a `where` clause to specify the rows to be deleted.
 */
export class DELETE { DELETE: {
  from    : ref
  where?  : expr
}}


/**
 * `SELECT` queries are used to retrieve data from a target datasource,
 * and very much resemble SQL's `SELECT` statements, with these noteworthy
 * additions:
 *
 * - The `from` clause supports `{ref}` paths with infix filters.
 * - The `columns` clause supports deeply nested projections.
 * - The `count` property requests the total count, similar to OData's `$count`.
 * - The `one` property indicates that only a single record object shall be
 *   returned instead of an array.
 *
 * Also, CDS, and hence CQN, supports minimalistic `SELECT` statements with a `from`
 * as the only mandatory property, which is equivalent to SQL's `SELECT * from ...`.
 */
export class SELECT { SELECT: {
  distinct?   : true
  count?      : true
  one?        : true
  from        : source
  columns?    : column[]
  where?      : xo[]
  having?     : xo[]
  groupBy?    : expr[]
  orderBy?    : order[]
  limit?      : { rows: val, offset: val }
}}

type source = OneOf< ref &as | SELECT | {
  join : 'inner' | 'left' | 'right'
  args : [ source, source ]
  on?  : expr
}>

type column = OneOf< '*' | expr &as &cast | ref &as & OneOf<(
  { expand?: column[] } |
  { inline?: column[] }
)> &infix >

type order = expr & {
  sort  : 'asc' | 'desc'
  nulls : 'first' | 'last'
}


interface changes { [elm:string]: OneOf< scalar | expr | changes | changes[] >}
interface data { [elm:string]: OneOf< scalar | data | data[] >}
interface as { as?: name }
interface cast { cast?: {type:name} }

interface infix {
  orderBy?  : order[]
  where?    : expr
  limit?    : { rows: val, offset: val }
}


/**
 * Expressions can be entity or element references, query parameters,
 * literal values, lists of all the former, function calls, sub selects,
 * or compound expressions.
 */
export type expr  = OneOf< ref | val | xpr | list | func | param | SELECT >
export type ref   = { ref: OneOf< name | { id:name &infix } >[] }
export type val   = { val: scalar }
export type xpr   = { xpr: xo[] }
export type list  = { list: expr[] }
export type func  = { func: string, args: expr[] }
export type param = { ref: [ '?' | number | string ], param: true }

/**
 * This is used in `{xpr}` objects as well as in `SELECT.where` clauses to
 * represent compound expressions as flat `xo` sequences.
 * Note that CQN by intent does not _understand_ expressions and therefore
 * keywords and operators are just represented as plain strings.
 * This allows us to translate to and from any other query languages,
 * including support for native SQL features.
 */
type xo       = OneOf< expr | keyword | operator >
type operator = '=' | '==' | '!=' | '<' | '<=' | '>' | '>='
type keyword  = 'in' | 'like' | 'and' | 'or' | 'not'
type scalar   = number | string | boolean | null
type name     = string



// ---------------------------------------------------------------------------
//  maybe coming later...

declare class CREATE { CREATE: {} }
declare class DROP { DROP: {} }


// ---------------------------------------------------------------------------
//  internal helpers...

type OneOf<U> = Partial<(U extends any ? (k:U) => void : never) extends (k: infer I) => void ? I : never>
