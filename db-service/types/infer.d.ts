declare namespace Inferred {
  /**
   * A $refLink is a pointer into the model, which refers
   * to the element / entity which is associated with one particular
   * step in a `ref` array.
   */
  export type $refLink = $refLink & {
    // the definition to which the parallel ref step refers to
    definition: Element | Entity
    // the target entity in which the definition is resolvable
    target: Entity
    // for entity references and associations, this holds
    // the table alias to which all following steps belong
    alias: String?
  }

  export type $refLinks = $refLink[]

  export type tokenStream = {
    exits?
    and?
    or?
    '/'?
    '*'?
    '+'?
    '-'?
    null?
    'not null'?
    val?: any
    func?: any
    ref?: refStep[]
    $refLinks?: $refLinks
  }[]

  export type Column =
    | '*'
    | {
        ref?: refStep[]
        $refLinks?: $refLinks
        func?: string
        args?: ArtifactReference[]
        key?: boolean
        as?: string
        cast?: {
          target?: string
        }
      }

  type refStep = { id?: string; where?: tokenStream }
  type Query = TODO
  type OnCondition = TODO[]
  type TODO = any
}
