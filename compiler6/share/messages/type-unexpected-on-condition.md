# type-unexpected-on-condition

An ON-condition was specified in a composition-of-aspect.

Compositions of aspects are managed by the compiler.
Specifying an ON-condition is not supported.
If you need to specify an ON-condition, use a composition
of an entity instead.

The message's severity is `Error`.

## Example

Erroneous code example:

```cds
aspect Item {
  key ID : UUID;
  field : String;
};
entity Model {
  key ID : UUID;
  Item : Composition of Item on Item.ID = ID; // ❌
};
```

`Item` is an aspect.  Because an ON-condition is specified, the compiler
rejects this CDS snippet.  With an ON-condition, only entities can be used,
but not aspects.

## How to Fix

Either remove the ON-condition and let the compiler handle
the composition, or use a composition of entity instead.

```cds
aspect Item {
  key ID : UUID;
  field : String;
};
entity Model {
  key ID : UUID;
  Item : Composition of Model.Item on Item.ID = ID; // ok
};
entity Model.Item : Item { };
```

The snippet uses a user-defined entity, that includes the aspects.

## Related Messages

- `type-unexpected-foreign-keys`
