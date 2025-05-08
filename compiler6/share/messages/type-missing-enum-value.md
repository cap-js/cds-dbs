# type-missing-enum-value

An enum definition is missing explicit values for one or more of its entries.

Enum definitions that aren't based on string-types do not get implicit values.
They have therefore to be defined explicitly in the model.

The message’s severity is `Warning` and is raised by the compiler.  You need
to adapt your model to fix the warning.

## Example

Erroneous code example:

```cds
entity Books {
  // …
  category: Integer enum {
    Fiction; // ❌
    Action;  // ❌
    // …
  } default #Action;
};
```

Both entries `#Fiction` and `#Action` of the enum `category` are missing an
explicit value.  Because the base type `Integer` is not a string, no implicit
values are defined for them.

## How to Fix

Explicitly assign a value or change the type to a string if the values are not
important in your model.  The erroneous example above can be changed to:

```cds
entity Books {
  // …
  category: Integer enum {
    Fiction = 1;
    Action = 2;
    // …
  } default #Action;
};
```

## Background

Many languages support implicit values for integer-like enums.  However,
CAP CDS does not have this feature, because otherwise, if values are persisted,
adding a new entry in-between existing ones would lead to issues during
deserialization later on.

Assume that CAP would assign implicit values for integer enums.  If a new value
were to be added between `Fiction` and `Action` in the erroneous example above,
then the generated SQL statement for entity `Books` would change:  
Instead of default value `2`, value `3` would be persisted.  Without data
migration, existing action books would have changed their category.

To avoid this scenario, always add explicit values to enums.
