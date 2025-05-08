# syntax-expecting-unsigned-int

The compiler expects a safe non-negative integer here.
The last safe integer is `2^53 - 1` or `9007199254740991`.

A safe integer is an integer that fulfills all of the following:

- Can be exactly represented as an IEEE-754 double precision number.
- The IEEE-754 representation cannot be the result of rounding any
  other integer to fit the IEEE-754 representation.

The message's severity is `Error`.

## Example

Erroneous code example:

<!-- cds-mode: ignore -->
```cds
type LengthIsUnsafe : String(9007199254740992); // ❌
type NotAnInteger : String(42.1);               // ❌
```

In the erroneous example, the string length for the type `LengthIsUnsafe` is
not a safe integer. It is too large.
Likewise, the string length for the type `NotAnInteger` is a decimal.

## How to Fix

You have to provide a safe integer:

```cds
type LengthIsSafe : String(9007199254740991);
type AnInteger : String(42);
```

At other places, using unsafe integers (or non-integer numbers) is allowed:

- Annotation values: The value is then simply a string.
- Expressions: The `val` property in the CSN contains a string
  having a sibling `literal: 'number'`.
