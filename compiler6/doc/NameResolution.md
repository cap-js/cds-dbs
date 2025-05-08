# Name Resolution in CDS

> Status Sep 2020: TODOs must be filled, say more about name resolution in CSN.

Name resolution refers to the resolution of names (identifiers) within expressions of the source to the intended artifact or member in the model.

As CDL is related to SQL, its name resolution strategy must be natural to SQL programmers.
This forbids us to use the simple _lexical scoping_ name resolution for all language constructs.

This document presents the exact **semantics** of the resolution in CDS
especially how it is influenced by the language constructs where the reference is embedded in.

In explanations, we have CDL as the main focus, but name resolution in CSN is covered as well.

The overall goal is that the name resolution is low on surprises throughout the complete life-cycle of any CDS model,
and robust concerning any model extensions.

Remark: **this is the intended behavior, the code must still be adapted at some places.**

The impatient reader might want to jump to the [summary],
others might want to [skip the introduction](#design-principles).

## Table of Contents

<!-- toc: start -->

1. [Table of Contents](#table-of-contents)
2. [Introduction](#introduction)
   1. [Background: SQL](#background-sql)
   2. [Background: modern programming languages](#background-modern-programming-languages)
3. [Design Principles](#design-principles)
4. [Name Resolution - the Basics](#name-resolution---the-basics)
   1. [Common rules](#common-rules)
   2. [Resolving paths](#resolving-paths)
   3. [Navigation environment](#navigation-environment)
5. [References to main artifacts](#references-to-main-artifacts)
6. [Values and references to elements](#values-and-references-to-elements)
   1. [References in queries](#references-in-queries)
   2. [References to sibling elements](#references-to-sibling-elements)
   3. [Other element references](#other-element-references)
7. [Paths as annotation values](#paths-as-annotation-values)
8. [Differences to HANA-CDS](#differences-to-hana-cds)
9. [Summary](#summary)

<!-- toc: end -->


## Introduction

If you look at typical examples given in introductionary documents about CDS,
you might wonder why there is a lengthy document about the name resolution.
So, let us start with such an example:

```
namespace sap.core;

context types {
    type Price {
        amount:   Amount;
        currency: CurrencySymbol;
    }
    type Amount: Decimal(5,3);
};
type CurrencySymbol: String(3);

view Products as select from ProductsInternal {
    productId,
    salesPrice
};
entity ProductsInternal {
    productId: Integer;
    retailPrice: types.Price;
    salesPrice = retailPrice;  // calculated fields are not supported yet
};
```

Let us first go a step backwards:
in CDS, all entities and other **main artifacts** (short: artifacts) have a _unique name_,
which we call **absolute name**.
Why don't we just use that name, like we do in SQL and in CSN?

As we want to support a hierarchical naming convention,
it should be easy to _define_ and to _refer to_ artifacts sharing a common name prefix.
In the example above, we have 3 types with the absolute names
`sap.core.types.Price`, `sap.core.types.Amount` and `sap.core.CurrencySymbol`.

For **convenience**, we do not use these lengthy names in CDL,
but shorter names without the common prefix.
These are then "translated" by the name resolution into the absolute names.
This also allows us to easily change the common name prefix in the development phase.

In which area of the code do we assume which common name prefix?
In the example above, we refer to these 3 types by `types.Price`, just `Amount`, and `CurrencySymbol`.
The first observation is:
**name resolution** (and the new name introduced by an artifact definition) **depends on the block structure**.

That being said, name resolution does **not depend on the order of definitions**.
In the example above, the element `amount` has a type `Amount`
which is defined _after_ the element definition.
Similar for the view `Products` whose source entity `ProductsInternal` is defined after the view.

In the view, we also refer to **elements** of (another) artifact.
There is no special language construct for such references –
it is a simple identifier (or path)
like the references to the types and the source entity of the view.
The second observation is:
**name resolution** in CDL **depends on the argument position**,
i.e. the place of the reference relative to the statement
(e.g. in the `from` or `where` clause of a `select` statement).
This is not only valid in SQL and related languages like CDL,
but also in languages like C (for labels after `goto`).

---

Let us now look at the name resolution and why it is not as obvious as it might seem to be…

> What happens if an inner block introduces the same name as an outer block?

Do we have **name shadowing**
(we cannot access the artifact defined in the outer block by its simple name)?
Consider that we have defined a type `CurrencySymbol` inside the block of the context `types`…
Is the same true for nested element definitions?

> How do we refer to elements and subelements inside the definition of a subelement?

Does a simple name refer to a subelement of the same parent element,
or an element of the corresponding main artifact?

> How do we access artifacts which are defined in another file?

That is an easy one: the `using` declarations introduce a file-local alias name to an absolute name
for accessing artifacts in other files or in the current file (useful to refer to shadowed definitions).

> Can something bad happen if extensions come into play?

Yes, extensions must be used with care.  Extensions might break existing models –
if two extensions decide to add an element with the same name to the same entity,
there is nothing we can do about it.

But we make sure that something real bad cannot happen:
an **extension cannot silently change the semantics of a model** –
the name resolution is defined in such a way that a valid and potentially unrelated reference
does not silently (without errors or warnings) point to another artifact
when the extension is applied to the model.


### Background: SQL

In this section, we look at the heritage from SQL.
Given is the following SQL query:

```SQL
SELECT a,
       a.b as e
  FROM a as x,
       tab as a
```

The identifier `a` refers to different objects:

* at the "select item" position in line 1, `a` refers to a _column_ in one of the tables,
* at the "select item" position in line 2, `a` refers to the _table alias_ introduced in line 4,
* at the "table reference" position in line 3, `a` refers to the _table_ `a`, and
* in line 4, we _define_ a table alias with name `a` (`a` is no reference here).

---

Our task is to

* generalize the semantics to make it applicable for CDS features not found in SQL:
  sub structures, associations, extensions, …
* find argument positions which are "similar" to argument positions with given name resolution semantics –
  we then apply the same semantics to the "new" argument positions

As an example for the latter,
let us consider an SQL view which is a projection on a given table and additionally exposes one of its column under an extra name:

```
entity B {
    a: Integer;
}
view E as select from B {
    *,
    a as e
};
```

In CDS, we can define a table which uses the same layout as a given table and additionally exposes one of its elements under an extra name:

```
entity B {
    a: Integer;
}
entity E : B {
    e = a;       // calculated fields are not supported yet
}
```

As the situation is very similar,
the name resolution strategy for the referred column/element should be the same
(the syntax is unfortunately not the same due to the SQL syntax of select items).

In SQL, we have silent semantic changes, but only with subqueries –
see the first example in Section ["Design Principles"](#design-principles).
To avoid this situation in CDL, we are a bit incompatible in this case.


### Background: modern programming languages

Modern programming languages (try to) use just one name resolution strategy: lexical scoping.

Assuming that the "free-floating" column `a` was defined in table `a`,
the `SELECT` query from the beginning of previous section would look like the following in JavaScript:

```javascript
select( [a, tab],
        (x, a) => ({ a: x.a, e: a.b }) )
```

Apart from the syntax and expression structure, the difference to SQL is that
there are **no "free-floating" references**:
the column `a` in (the line of) table `a` must be prefixed by the corresponding table alias `x`
(parameter name of the anonymous function in JavaScript).

This is not only a good thing for itself
(the original SQL query would be considered incorrect if a column `a` is added later to table `tab`)
it also enables lexical scoping, as the table alias names are defined in the query expression itself.

Any "convenience" declaration which "extends" lexical scoping
is usually soon to be declared as obsolete,
because its **little convenience benefit is not worth the additional issues**.
As an example, see the fate of the `with` statement in JavaScript.

---

If sold with the label "OO", the convenience is often considered to be more important.
Given is the following Java program:

```Java
class T {
    int C = 0;
}
class B {
//  class T { int C = 1; }
}
class J extends B {
    int go() {
        return (new T()).C;
    }
    public static void main(String[] args) {
        System.out.println ((new J()).go());
    }
}
```

Uncomment the definition of `B.T` → the output changes from `0` to `1` (silent semantic change).
Now consider that class `B` is usually defined somewhere else →
same kind of convenience, same kind of issues.


## Design Principles

The name resolution rules in the following sections are based on the following design principles:

 1. Applications/customers can safely add new artifacts without silently changing the semantics of other applications.
 2. A valid SQL SELECT should be a valid CDL SELECT with the same semantics
    (modulo changes in the concrete syntax),
    as CDL uses CQL – an "official" extension of SQL SELECT.
 3. Applications/customers can safely add new artifacts without inducing other applications to compile with an error.
 4. The name resolution does not depend on package definitions and its dependencies.
 5. The chosen name resolution strategy for an argument position should not come at a surprise.
 6. Convenience: there must be a more convenient solution than always using absolute names.

Please note that these principles are ordered.
There are __many cases where one principle cannot be fulfilled__ in order to fulfill a higher prioritized design principles.
The first design principle is therefore always fulfilled.
This can be seen in the following examples.

---

For (1), CDL compiles the following source with an error:

```
entity A { a: String(20); j: Integer; x: Integer; }
entity B { b: String(20); j: Integer; }
view V as select from A { a, x } where     // x is valid here
    j = (select from B { j + x });         // invalid: use A.x instead of x (ok: j)

```

It contradicts (2), because SQL would compile the subquery.
But there would be a silent semantic change when column `x` is added to table `B`.

---

For (2), CDL needs to support unqualified element (column) names in the SELECT clause even if a JOIN is used -
we might issue a warning for this case, though.

```
entity A { a: String(20); j: Integer; x: Integer; }     // from Partner A
entity B { b: String(20); j: Integer; }                 // from Partner B
view V as select from A join B {a, b, x} ON A.j = B.j;  // valid customer view
```

It contradicts (3), as the unchanged customer view compiles with an error
when partner B adds an element `x` to their table `B`.

---

Principle (3) is also contradicted for specific features like (multiple) entity includes.

Principle (4) is not part of the name resolution rules in HANA-CDS.

As we never allow to break Principle (1), we have the following guideline:

> **It is fine if definitions in the own source shadow other definitions (in the own source or others),
> because the programmer is aware (and in control) of all these definitions.
> It is evil if definitions made in other sources shadow other definitions (in the own source or others).**


## Name Resolution - the Basics

We start with some terminology:

* An **environment** is a dictionary binding/mapping (local) names to language constructs (e.g. entities or elements).

* A **navigation environment** of a construct is the dictionary for definitions within that construct or a type/entity referred by that construct.

  For contexts (and services), these are the sub artifacts defined within that context.
  For types, entities, elements, these are the elements (or enum symbols) defined within that object or the object's (direct or indirect) type;
  for association types, these are the elements of the target entity.
  (The actions and parameters of an object cannot be accessed this way.)

```
context C { type X: Integer; };  // context "C" supplies env{ X: type("C.X") }
type S { E: Integer; }
extend S with { F: Integer; };   // type "S" supplies env{ E: elem("S","E"), F: … }
type T: S;                       // type "T" supplies the same env as type "S"
```


### Common rules

Name resolution is **case sensitive**.
In general, a model can contain artifacts and members whose name differ in case only;
there might be a linter check which informs model writers if they make use of this "feature".

While being case sensitive might be against the original intention of SQL,
it actually _conforms_ to the SQL Specification after abstraction from the lexical syntax,
see e.g. [SQL-92, §5.2.10 and 5.2.12…14](http://www.contrib.andrew.cmu.edu/~shadow/sql/sql1992.txt)
for the semantics of quoted and non-quoted identifiers.
In CDL, we just do *not* transform non-quoted identifiers to all-upper names.

Also, CSN-processors are cumbersome to write if they have to deal with (partial/feigned) case-insensitivity.

---

In CDL, an identifier may be used before its definitions,
there is **no need of forward declarations**.
Thus, the sequence of definitions inside a block does not matter for the scope rules:

```
using T as OuterT;    // introduced to have a name for the shadowed "T"
type T: String(20);
context C {
    type D: T;        // -> C.T -> cds.Integer
    type T: Integer;
    type O: OuterT;   // -> T -> String(20)
}
// type C.O: T;       // alternative: define "C.O" outside the block of "C"
```

There are two reasons to do so:

* When using associations, (mutually) recursive usage is quite common, and forward references are cumbersome.
  (We can always access shadowed artifacts.)
* Real-world models will very likely reside in multiple files/resources – there is no natural order in which the definitions are to be processed.


### Resolving paths

The algorithm for resolution of paths (consisting of dot-connected names)
is as follows:

 1. First, we try to find the language construct _O_ for the first name in the path;
    this language construct is called the **path base**.

 2. We resolve the next name in the path by inspecting the navigation environment of _O_.
    The found language artifact is our next _O_.

 3. We repeat Step 2 until the complete path is resolved.

Even the algorithm for finding the path base follows the same pattern:

* We have a list of search environments, which we inspect in order.
  The first hit is the path base.
  It is an error if the name (the first name of the path) cannot be found in any environment of the list.

* All but the last environment are constructed from definitions in the current source
  following the lexical block structure of the source,
  or a small, fixed number of predefined names (e.g. `$self`.)
  We will call such an environment a **lexical search environment**.

* Only the last environment contains bindings **defined externally**, at least potentially.
  It can be the environment for predefined artifacts (like `cds.Integer`),
  or the navigation environment of the "current artifact/member of interest" (like the elements of the projection source).

So the guideline at the end of the previous section essentially becomes
**lexical scoping first, search in one externally provided environment last**.

The basic difference between the name resolution strategies is the relevance of the lexical and the last environments,
and how they are build.


### Navigation environment

The navigation environment might depend on the argument position.

If an object is typed with an array,
the environment supplied by that object is usually considered to be empty.
For `type of` references and the to-be-extended element referenced in an inner extend,
it is the environment supplied by the array item type:

```
@A.e: 1     // warning: cannot find `e` for annotation assignments
annotation A : array of { e: Integer; };

entity E {
    items: many { i: Integer; };
}
type T: type of E:items.i;      // valid = Integer
annotate E with {
    items { i @lineElement; };  // valid annotation
}
view V as select from E {
    items.i                     // not valid (yet)
}
```

For the to-be-extended element referenced in an inner extend,
we consider the environment supplied by an association to be empty:

```
type A: association to E;
entity E { i: Integer; }
annotate A with {
    @targetElem i;     // err(info): do not follow associations
}
type S { e: Integer; }
type T : S;
annotate T with {
    @derivedElem e;    // ok: follow derived type (not yet without beta)
}
```


## References to main artifacts

When we have an argument position where we expect a main artifact,

* the list of lexical search environments depends on the blocks containing the current statement, and
* the last, non-lexical search environment is independent from the block structure or a current object of interest.

A reference to a main artifact can be a reference to a:

* **projection or view source** (table reference after `SELECT … FROM` in SQL),
* **association target**,
* **type** (but not the reference after `type of`, see below)
* **annotation** for an annotation assignment,
* to-be-extended main artifact of an **outer extend**
* **structure include**,
* **type parameter** (should be a constant, not yet).

---

The construction of the list of lexical search environments **starts at the innermost block** containing the current statement,
and then continues to the next outer block:

* As opposed to HANA-CDS, we skip blocks containing just element definitions
  (or generally definitions of members like actions).
* For blocks of `context` and `service` definitions, we add the definition inside that block
  (all definitions in the environment supplied by the context or service can contain more definitions).
* For the top-level block of the current source,
  we add the top-level definitions and the bindings for the `using` declarations.

The last, non-lexical search environment is the environment for built-in artifacts.
Currently, it contains `String` for `cds.String`, similarly `LargeString`,
`Integer`, `Integer64`, `Binary`, `LargeBinary`, `Decimal`, `DecimalFloat`, `Double`,
`Date`, `Time`, `Timestamp`, `DateTime`, and `Boolean` and `hana`, also the namespace `cds`.

When searching for an annotation (after the initial `@`), the last search environment
are the model definitions.

---

We conclude this section with a little weird example –
nobody would write models like that, but it demonstrates the exact semantics.

```
namespace test;
using cds.Boolean as Integer;
type Time {
    @Date                  // @Date: true, not @cds.Date: true
    Date: Date;            // typeOf(test.Time,Date) = cds.Date, no error
    C: C.Date;             // typeOf(test.Time,C) = test.C.Date, no error
}
@C.Anno                    // @test.C.Anno: true
define context C {
    type Date: Time;       // test.C.Date -> test.C.Time, not test.Time
    type Time: Integer;    // test.C.Time -> alias Integer -> cds.Boolean
    type CC: C.Integer;    // test.C.CC -> test.C.Integer
}
@Integer                   // @cds.Boolean: true (warning: is no annotation)
type C.Integer: Time;      // test.C.Integer -> test.Time, not test.C.Time
```

In this example, we have the following two lexical search environments:

* The search environment containing definitions directly inside the block after `define context C`:
  `Date`, `Time` and `CC`, but not `Integer` (but which is in the environment supplied by `test.C`).
  Used as first search environment when resolving main artifact references in the block after `define context C`,
  the next search environment is the environment containing top-level definitions.

* The search environment containing the top-level definitions and using declarations of the source:
  `Integer`, `Time` and `C`.
  Used as first search environment when resolving main artifact references outside the block after `define context C`,
  the next search environment is the non-lexical environment containing built-in artifacts.

There is no lexical search environment for the element definitions supplied by `test.Time`.

---

We allow paths for names in top-level definitions.
All but the last name in the paths are (on-the-fly) contexts,
which do _not introduce blocks_ for the lexical scoping:

```
entity N.mid.E {
   key i: Integer;
   to1: association to E;                // invalid
   to2: association to mid.E;            // invalid
   to3: association to N.mid.E;          // valid
}
context C {
   context mid {
       entity E {
           key i: Integer;
           to1: association to E;        // valid
           to2: association to mid.E;    // valid
           to3: association to C.mid.E;  // valid
        }
    }
}
```


## Values and references to elements

When we have an argument position where we expect a value or a reference to an element,

* We usually have just one lexical search environment
  which is – dependening on the call context – only inspected if the path consists of at least two identifiers.
  This basically introduces an **escape mechanism**.
* The last, non-lexical environments is usually the environment either
  supplied from an artifact referred by the current statement or
  supplied by the object containing the current definition.

It is often allowed to switch to the ["main artifact name resolution"](#references-to-main-artifacts)
by prefixing the path with a `:`, used usually to refer to constants.

The semantics is best explained separately for the _different groups_ of argument positions.


### References in queries

We start with the most complicated group, because it is known from SQL:
references in `SELECT` item positions –
similar: `WHERE`, `ON`, **TODO**: `GROUP BY`, `ORDER BY` (or special?), …

**TODO**: do the same for `as projection on`?

**TODO**: names in `mixins`

The list of search environments is created as follows:

* The (first) lexical search environment is build from the explicit and implicit alias names
  for the sources (table references after `from`);
  we also bind `$projection` to the resulting view/projection elements of the current SELECT
  if not already used as a table alias.
* If the current SELECT is a sub-SELECT,
  we have additional lexical search environments containing alias names for the corresponding outer SELECTs;
  their `$projection` bindings are shadowed.
* For compatibility with ABAP CDS, we have another environment with one entry:
  we bind `$parameters` to the parameters of the current view –
  the SQL way is to use `:param1` instead of `$parameters.param1`, see below.
* The last, non-lexical environment is the environment containing the elements from all source entities of the current SELECT;
  if an element with the same name is contained in more than one source,
  this search environment binds the name to an "ambiguity" entry (i.e. a reference to it leads to an error)
* There are no additional non-lexical search environments for the elements of outer SELECTs.

The above mentioned `:`-escape mechanism leads to the following name resolution:

* The first lexical search environment is the environment containing all parameter names of the current view.
* The following search environments are the usual ones from the "main artifact name resolution";
  constant values can be accessed this way (_TODO_: probably not now).


### References to sibling elements

The next group is for references in member definitions to other elements of the same main artifact.
Such a reference can be a reference to a:

* **calculated field**
* references in the **`default` value** (HANA SQL does not allow this)
* references in the `ON` condition of an **unmanaged association***
* reference after **`type of`** – can also be a references to an element of another main artifact

The list of search environments is created as follows:

* There is one lexical search environment, it has one entry:
  we bind `$self` to the main artifact, or to be exact:
  to the current instance of that artifact, e.g. the current line of an entity.
  This environment is also inspected if the path consists of just `$self` –
  useful for `on` conditions of unmanaged associations.
* The second and last, the non-lexical search environment is the environment supplied by
  the object (main artifact or element) where the current member is defined in.

The above mentioned `:`-escape mechanism leads to the "main artifact name resolution";
it can be used to access constants, or –for references after `type of`– elements of other artifacts.

The reason for the `$self` references is visible in an example with subelements
(calculated fields are not supported yet):

```
type T {
    a: Integer;
    b = a;            // b = a
    c = $self.a;      // c = a
}
entity E {
    a: Integer;
    x: T;             // x.b = x.a, x.c = x.a
    y { a: Integer;
        b = a;        // y.b = y.a
        c = $self.a;  // y.c = a
    };
}
entity S {
    $self: Integer;   // we might complain about such an element name
    x = $self.$self;  // x = $self (the element)
}
```


### Other element references

A **foreign key** in the definition of a managed association,
is just searched in the environment supplied by the target entity.
No lexical search environment is inspected first.

In an **inner extend**,
we just search in the navigation environment of the current language construct.
No lexical search environment is inspected first.
<br/>
These are actually not necessary references to elements,
but also sub artifacts (e.g. `extend` in `extend context`),
actions (in the `actions` clause of `extend entity`), or
parameters (in the `parameters` clause of `extend action`).

_TODO_: more use cases, like references inside filter conditions of paths.


## Paths as annotation values

We can also use paths as annotation assignment values.

If there is _no annotation definition_ (there might be a warning for this)
then the path cannot be resolved at all.
The same is true if the annotation type
does not allow path values (then there might be a warning for this)
or just a `cds.UnspecifiedRef`.

If there is an annotation definition which allows to use paths
by specifying the type _`cds.ArtifactRef`_ (or a variant of it),
then the path resolution works as described in
[Section "References to Main Artifacts"](#references-to-main-artifacts).

If there is an annotation definition which allows to use paths
by specifying the type _`cds.ElementRef`_
then the path resolution works as described in
[Section "References sibling elements"](#references-to-sibling-elements).
If that annotation is assigned to a main artifact
then _same main artifact_ means the main artifact itself.



## Differences to HANA-CDS

The most visible differences in the name resolution semantics of CDL compared to HANA CDS are:

* Using constant values requires to prefix the path (referring to the constant) with a `:`.
* There is a new semantic for paths (without initial `:`) used in annotation assignments.
* In the definitions of sub elements, accessing elements supplied by the corresponding main artifact
  requires to prefix the path with `$self.`.
  Accessing sibling elements works the same as in HANA CDS.
* It is no problem to define elements which have the same (local) name as the referenced type.
* In views with more than one source entity,
  selecting an element `e` from one source without the use of a table alias (which is not recommended anyway!)
  suddenly does not compile anymore if another source entity is extended by a new element `e`.

In HANA-CDS, the name resolution works quite uniformly for all argument positions,
with most clauses of `SELECT` being the main exception.
It is also compatible to the "pre-extension" name resolution semantics of HANA-CDS.
This is nice!  Why do we specify a different name resolution semantics for CDL?

The reason is:
we do not want to have the "extended" lexical scoping semantics of HANA CDS concerning elements,
which heavily relies on the package hierarchy.
To avoid silent semantic changes with extensions,
the HANA-CDS compiler enforces the following properties:

* Every source belongs to a package;
  packages can depend on other packages, no cycles are allowed.
* No language construct can be extended in the same package where it is defined in,
  no language construct can be extended twice in the same package
* Artifacts can only be extended by top-level extend statements,
  elements can only be extended by inner extends (the second is true for CDx/Language, too).

These are properties which do not hold for consumers of the CAP CDS Compiler.

Additionally, while direct changes in base packages can always lead to semantic changes,
the following example shows that this unwanted effect is more likely in HANA-CDS:

```
// BaseApp.cds ---
entity E {
  a: String(20);
  b {
    // a: Integer;   // CHANGE: introduce sub element
    x: Integer;
  };
}
// MyExtension.cds ---
extend E with {
  extend b with {
    z = a;           // in CDL: $self.a, calculated fields are not supported yet
  }
}
```

In HANA-CDS, both files compile before and after the change in `BaseApp.cds`:
the element `b.z` of `E` refers to element `a` of `E`, but after the change to `b.a` of `E`,
because that element is visible in the base package and all its extensions
(we would not see the problem if `b.a` would have been introduced by an extension in another package).

In CDx/Language, the files only compile after the change in `BaseApp.cds`:
(with the same semantics as in HANA-CDS).  To make it work before the change,
element `b.z` of `E` can refer to element `a` of `E` by writing this references as `$self.a` –
with this path, `b.z` still refers to `a` of `E` after the change in `BaseApp.cds`.


## Summary

[summary]: #summary

To avoid silent semantic changes with extensions or new CDL versions,
we follow the following principle:

> **After we have tried to find a local name in an environment containing
> artifacts or elements which are potentially defined somewhere else (e.g. via an extension),
> we do not inspect any other environment.**

In CDx/Language, we basically have two search strategies.
But let us start with Strategy 0:

**Resolving a name in the tail of a path**.

For a path `a.b`, we only inspect one environment when resolving `b`: the environment supplied by `a`.
For example, if `a` is a structured element, we try to find `b` in all sub elements of `a` –
it does not matter
whether the sub element `b` has been directly defined with the definition of element `a`, or
whether is has been defined externally:
via an extension or as an element of the referenced type.

**Resolving the first name of a path when looking for artifacts**.

We apply _lexical scoping_  when we refer to types, entities and similar artifacts.
When looking for an artifact `A`,
we search in the blocks of surrounding `context`, `service` and top-level definitions,
starting at the _innermost block_ and ending at the _top-level block_ of the source.
To make it clear: we do not search in blocks of type, entity or other definitions,
just blocks of contexts (and similar constructs).

We only consider definitions within these blocks, _not_ all sub artifacts of the contexts,
which might have been introduced by context extensions, or
by using a path in the definition, e.g. `type MyContext.A: …`.

If the search is not successful so far,
we finally inspect an environment containing artifacts
which are normally not defined in our own source:

* For the `@A` of an _annotation assignment_,
  we look for `A` in the `definitions` property of the model.
* For all other references,
  we look for `A` in the built-in environment,
  where we define things like `cds.Integer`.

This search is also used for path references in annotation assignments
when the corresponding definition allows the type `cds.ArtifactRef` (or variants, future).

**Resolving the first name of a path when looking for values or elements**.

We search for elements supplied by the current "language construct of interest",
which depends on the argument position.
The most relevant ones are:

* The element or artifact where the current (sub) artifact is defined in,
  i.e. we access sibling elements.
* The source of the current projection or view.

Depending on the argument position,
there is an _escape mechanism_ – which is tried first – to access also other elements.
The most relevant ones are:

* If the paths starts with the identifier `$self`,
  we look for the next name of the path in the environment supplied by the
  corresponding main artifact of the current element.
  This is useful for element references inside sub elements to access siblings of ancestors.
* If a path in most clauses of a view starts with `a`,
  and `a` is an explicit or implicit table alias (which we always see in our source),
  we look for the next identifier of the path in the environment supplied by the corresponding entity.
* If the path is prefixed by a `:`,
  we actually switch to the other search strategy: looking for artifacts like types.
  This is useful to access constant values (or for `type of`).

This search is also used for path references in annotation assignments
when the corresponding definition allows the type `cds.ElementRef` (future).
