# anno-duplicate-unrelated-layer

An annotation is assigned multiple times through unrelated layers.

A _layer_ can be seen as a group of connected sources, for example CDL files.
They form a cyclic connection through their dependencies
(for example, `using` in CDL).  If there are no cyclic dependencies, a single
CDL file is equivalent to a layer.

## Example

Erroneous code example using four CDS files:

```cds
// (1) Base.cds: Contains the artifact that should be annotated
entity FooBar {  }

// (2) FooAnnotate.cds: First unrelated layer to Base.cds
using from './Base';
annotate FooBar with @Anno: 'Foo';

// (3) BarAnnotate.cds: Second unrelated layer to Base.cds
using from './Base';
annotate FooBar with @Anno: 'Bar';

// (4) All.cds: Combine all files ❌
using from './FooAnnotate';
using from './BarAnnotate';
```

In (4) the compiler will warn that there are duplicate annotations in unrelated
layers.  That is because (2) and (3) are unrelated, i.e. they do not have a
connection.

Due to these unrelated layers, the compiler can’t decide in (4) which
annotation should be applied first.

Instead of passing (4) to the compiler, you can also pass (2) and (3) to it.
Because there are no cyclic dependencies between the files, each file
represents one layer.

## How to Fix

Remove one of the duplicate annotations.  Chances are, that only one was
intended to begin with.  For the erroneous example above, remove the annotation
from (3).

Alternatively, add an annotation assignment to (4).  This annotation has
precedence and the error will vanish.  For the example above, (4) will look
like this:

```cds
// (4) All.cds: Combine all files
using from './FooAnnotate';
using from './BarAnnotate';
// This annotation has precedence.
annotate FooBar with @Anno: 'Bar';
```

You can also make (3) depend on (2) so that they are no longer in unrelated
layers and the compiler can determine which annotation to apply.

```cds
// (3) BarAnnotate.cds: Now depends on (2)
using from './FooAnnotate';
annotate FooBar with @Anno: 'Bar';
```

This works because there is now a defined dependency order.
