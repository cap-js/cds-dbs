import * as cqn from '@sap/cds/apis/cqn'
import * as csn from '@sap/cds/apis/csn'

type linkedQuery = {
  target: csn.Definition
  elements: elements
}
export type SELECT = cqn.SELECT & linkedQuery
export type INSERT = cqn.INSERT & linkedQuery
export type UPSERT = cqn.UPSERT & linkedQuery
export type UPDATE = cqn.UPDATE & linkedQuery
export type DELETE = cqn.DELETE & linkedQuery
export type CREATE = cqn.CREATE & linkedQuery
export type DROP = cqn.DROP & linkedQuery

export type Query = SELECT | INSERT | UPSERT | UPDATE | DELETE | CREATE | DROP

export type element = csn.Element & {
  key?: boolean
  virtual?: boolean
  unique?: boolean
  notNull?: boolean
}
export type elements = {
  [name: string]: element
}

export type col = cqn.column_expr & { element: element }

export type list = {
  list: cqn.expr[]
}
// Passthrough
export type source = cqn.source
export type ref = cqn.ref
export type val = cqn.val
export type xpr = cqn.xpr
export type expr = cqn.expr
export type func = cqn.function_call
export type predicate = cqn.predicate
export type ordering_term = cqn.ordering_term
export type limit = { rows: val; offset: val }
