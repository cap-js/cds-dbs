# rewrite-undefined-key

The compiler isn’t able to rewrite an association's foreign keys,
because the redirected target is missing elements to match them.

The message's severity is `Error`.

## Example

Erroneous code example:

```cds
entity model.Base {
  key ID : UUID;
  toTarget : Association to model.Target; // (1)
}
entity model.Target {
  key ID : UUID; // (2)
  field : String;
}

service S {
  entity Base as projection on model.Base; // ❌ (3) Can't redirect 'toTarget'

  entity Target as projection on model.Target {
    field, // (4) No 'ID'
  };
}
```

In the example, the projected association `toTarget` at (3) in entity
`S.Base` can't be redirected to `S.Target`, because `S.Target` does not
project element `ID` (4).

`toTarget` (1) is a managed association and hence foreign keys are inferred
for it.  The compiler generates a foreign key `ID`, which corresponds to
element `ID` of `model.Target` (2).

As both entities are exposed in service `S`, the compiler tries to redirect
`S.Base:toTarget` to an entity inside the same service, to create
a “self-contained” service.  It notices, however, that `S.Target` does not
have element `ID`, and therefore can't match the foreign key to a target
element and emits this error message.

## How to Fix

If you don't need to expose association `toTarget` in `S.Target`, you can
exclude it in the projection via an `excluding` clause.

```cds
service S {
  entity Base as projection on model.Base
    excluding { toTarget };
  // ...
}
```

If the association is required in the service, you need to either project
element `ID` in `S.Target`, or redirect the association explicitly.

The easiest fix is to select `ID` explicitly:
```cds
service S {
  // ...
  entity Target as projection on model.Target {
    field, ID, // Explicitly select element ID
  };
}
```

However, if you don't want to expose `ID`, redirect association `toTarget`
explicitly, matching the foreign key to another element:

```cds
service S {
  entity Base as projection on model.Base {
    ID,
    toTarget : redirected to Target { fakeID as ID }, // (1)
  };
  entity Target as projection on model.Target {
    calculateKey() as fakeID : UUID,                  // (2)
    field,
  };
}
```

Note that at (1), we use element `fakeID` of `S.Target` as foreign key `ID`.
That changes its semantic meaning and may not be feasible in all cases!
In the example, we assume at (2) that a key can be calculated.


## Related Messages

- `rewrite-not-supported`
