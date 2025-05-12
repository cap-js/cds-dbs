# extend-unrelated-layer

Unstable element order due to extensions for the same artifact in
unrelated layers.

A _layer_ can be seen as a group of connected sources, for example CDL files.
They form a cyclic connection through their dependencies
(for example, `using` in CDL).

## Example

Erroneous code example using four CDS files:

```cds
// (1) Base.cds: Contains the artifact that should be extended
entity FooBar {  }

// (2) FooExtend.cds: First unrelated layer to Base.cds
using from './Base';
extend FooBar { foo : Integer; }

// (3) BarExtend.cds: Second unrelated layer to Base.cds
using from './Base';
extend FooBar { bar : Integer; }

// (4) ❌ All.cds: Combine all files
using from './FooExtend';
using from './BarExtend';
```

In (4) the compiler will warn that the element order of `FooBar` is unstable.
That is because the extensions in (2) and (3) are in different layers and when
used in (4) it can’t be ensured which extension is applied first.

Instead of passing (4) to the compiler, you can also pass (2) and (3) to it.
Because there are no cyclic dependencies between the files, each file
represents one layer.

## How to Fix

Move extensions for the same artifact into the same layer, that is, the same
file.

For the erroneous example above, remove the extension from (3) and move
it to (2):

```cds
// (2) FooExtend.cds
using from './Base';
extend FooBar {
  foo : Integer;
  bar : Integer;
}
```

## Related Messages

- `extend-repeated-intralayer`
