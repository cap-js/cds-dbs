/**
 * A $refLink is a pointer into the model, which refers
 * to the element / entity which is associated with one particular
 * step in a `ref` array.
 */
export interface $refLink {
  // the definition to which the parallel ref step refers to
  definition: Element | Entity
  // the target entity in which the definition is resolvable
  target: Entity
  // for entity references and associations, this holds
  // the table alias to which all following steps belong
  alias: String?
}

export type $refLinks = $refLink[]

type Element = Artifact & {}
type Entity = Artifact & {}

/**
 * An artifact is a definition but may also be an anonymous struct, e.g.
 * in the `elements` property of a definition.
 */
type Artifact = {
  /** Element must not be NULL */
  notNull?: boolean | null
  /** Whether the element is a key */
  key?: boolean
  /** Whether the element is unique (similar to SQL's UNIQUE) */
  unique?: boolean
  /** Whether the element is virtual */
  virtual?: boolean
  /** Value for calculated elements */
  value?: any

  // associations
  on?: OnCondition
  target?: TODO
  keys?: TODO[]

  kind?: String
  /**
   * Fully qualified name of the definition, i.e. name includes namespace.
   */
  name?: string
  /**
   * Base type of this definition.
   * Used in type definitions.
   */
  type?: String
  /**
   * If the definition is structured-type then this property contains all
   * elements for the type (or entity).
   * Cannot be combined with `items` or `enum`.
   */
  elements?: { [name: string]: Element }
  /**
   * If the definition is an arrayed-type then this property contains the
   * artifact for its items.
   * Cannot be combined with `elements` or `enum`.
   */
  items?: Artifact
}

type Query = TODO
type OnCondition = TODO[]
type TODO = any
