# type-unexpected-foreign-keys

Foreign keys were specified in a composition-of-aspect.

Compositions of aspects are managed by the compiler.
Specifying a foreign key list is not supported.
If you need to specify foreign keys, use a composition
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
  Item : Composition of Item { ID }; // ❌
};
```

`Item` is an aspect.  Because an explicit list of foreign keys is specified,
the compiler rejects this CDS snippet.  With an explicit foreign key list,
only entities can be used, but not aspects.

## How to Fix

Either remove the explicit list of foreign keys and let the compiler handle
the composition, or use a composition of entity instead.

```cds
aspect Item {
  key ID : UUID;
  field : String;
};
entity Model {
  key ID : UUID;
  Item : Composition of Model.Item { ID }; // ok
};
entity Model.Item : Item { };
```

The snippet uses a user-defined entity, that includes the aspects.

## Related Messages

- `type-unexpected-on-condition`
