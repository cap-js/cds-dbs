# def-upcoming-virtual-change

The behavior of `@sap/cds-compiler` v6 will change for a selected element.

## Example

Erroneous code example:

```cds
entity Source {
  key ID : String;
  a : String;
};

entity Proj as projection on Source {
  ID,
  virtual a, // ❌ behavior will change in v6
};
```

In `@sap/cds-compiler` v5 and earlier, element `Proj:a` is a reference
to element `Source:a`, which was marked virtual.

In `@sap/cds-compiler` v6 and later, it will instead be a _new_ element,
without any reference to `Source:a`.

This may or may not affect your runtime coding, hence the warning.


## How to Fix

If the v6 behavior works for you, there is nothing you need to do.

However, if you want to keep a reference to `Source:a` in CSN, for example
because you use the reference at runtime, then you can keep the old behavior
by either:

1. prepending a table alias to the reference
2. adding a column alias

```cds
// (1) prepend a table alias
entity V as projection on E {
  ID,
  virtual E.a, // ok
};
```

```cds
// (2) add an alias
entity V as projection on E {
  ID,
  virtual a as a, // ok
};
```
