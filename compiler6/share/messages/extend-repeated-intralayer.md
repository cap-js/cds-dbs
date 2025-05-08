# extend-repeated-intralayer

The order of elements of an artifact may not be stable due to multiple
extensions in the same layer (for example in the same file).

A _layer_ can be seen as a group of connected sources, for example, CDL files.
They form a cyclic connection through their dependencies
(for example, `using` in CDL).

## Example

Erroneous code example with multiple CDL files:

```cds
// (1) Definition.cds
using from './Extension.cds';
entity FooBar { };
extend FooBar { foo: Integer; }; // ❌

// (2) Extension.cds
using from './Definition.cds';
extend FooBar { bar: Integer; }; // ❌
```

Here we have a cyclic dependency between (1) and (2).  Together they form one
layer with multiple extensions.  Again, the element order isn’t stable.

## How to Fix

Move extensions for the same artifact into the same extension block:

```cds
// (1) Definition.cds : No extension block
using from './Extension.cds';
entity FooBar { }

// (2) Extension.cds : Now contains both extensions
using from './Definition.cds';
extend FooBar {
  foo : Integer;
  bar : Integer;
}
```

## Related Messages

- `extend-unrelated-layer`
