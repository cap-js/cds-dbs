# wildcard-excluding-one

You're replacing an element in your projection, that is already included by
using the wildcard `*`.

The message's severity is `Info`.

## Example

Erroneous code example:

```cds
entity Book {
  key  id : String;
     isbn : String;
  content : String;
};
entity IsbnBook as projection on Book {
  *,
  isbn as id, // ❌
};
```

`IsbnBook:id` replaces `Book:id`, which was included in `IsbnBook` through
the wildcard `*`.

## How to Fix

Add the replaced element to the list of wildcard excludes:

```cds
entity IsbnBook as projection on Book {
  *,
  isbn as id
} excluding { id };
```

