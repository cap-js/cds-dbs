# rewrite-not-supported

The compiler isn’t able to rewrite ON conditions for some associations.
They have to be explicitly defined by the user.

The message's severity is `Error`.

## Example

Erroneous code example:

```cds
entity Base {
  key id     : Integer;
  primary    : Association to Primary on primary.id = primary_id;
  primary_id : Integer;
}

entity Primary {
  key id       : Integer;
  secondary    : Association to Secondary on secondary.id = secondary_id;
  secondary_id : Integer;
}

entity Secondary {
  key id : Integer;
  text   : LargeString;
}

entity View as select from Base {
  id,
  primary.secondary // ❌ The ON condition isn’t rewritten here
};
```

In the previous example, the ON condition in `View` of `secondary` can’t be
automatically rewritten because the associations are unmanaged and the
compiler can’t determine how to properly rewrite them for `View`.

## How to Fix

You have to provide an explicit ON condition.  This can be achieved by using
the `redirected to` statement:

```cds
entity View as select from Base {
  id,
  primary.secondary_id,
  primary.secondary: redirected to Secondary on
    secondary.id = secondary_id
};
```

In the corrected view above, the association `secondary` gets an explicit ON
condition.  For this to work it is necessary to add `secondary_id` to the
selection list, that means, we have to explicitly use the foreign key.


## Related Messages

- `rewrite-undefined-key`
