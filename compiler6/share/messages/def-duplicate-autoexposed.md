# def-duplicate-autoexposed

Two or more entities with the same name can’t be auto-exposed in the same
service.

Auto-exposure is a compiler feature which makes it easier for developers
to write services.  Auto-exposure uses the name of the entity to expose
it in the service.  It ignores the entity’s namespace and context.
This may lead to name collisions.

The message’s severity is `Error` and is raised by the compiler.  You need to
adapt your model to fix the error.

## Example

Erroneous code example:

```cds
// (1)
entity ns.first.Foo {
  key parent : Association to one ns.Base;
};
// (2)
entity ns.second.Foo {
  key parent : Association to one ns.Base;
};
// (3)
entity ns.Base {
  key id    : UUID;
  to_first  : Composition of many  ns.first.Foo;
  to_second : Composition of many ns.second.Foo;
}
service ns.MyService {
  // (4) ❌
  entity BaseView as projection on ns.Base;
};
```

Both (1) and (2) define an entity `Foo`, but in different namespaces.  For
example, they could be located in different files with a `namespace` statement.
(3) contains compositions of both `first.Foo` and `second.Foo`.

In (4), a projection on `Base` is exposed in service `MyService`.
Both composition targets are auto-exposed.  However, because the namespaces
of (2) and (3) are ignored, a name collision happens.

## How to Fix

You need to explicitly expose one or more entities under a name that does not
exist in the service, yet.

For the erroneous example above, you could add these two lines to the service
`ns.MyService`:

```cds
  entity first.Foo as projection on ns.first.Foo;   // (5)
  entity second.Foo as projection on ns.second.Foo; // (6)
```

Here we reuse the namespaces `first` and `second`.   We don’t use `ns` because
it’s the common namespace.  But you can choose any other name.

The compiler will pick up both manually exposed entities and will correctly
redirect all associations.

_Note:_ For the example, it is sufficient to expose only one entity.  If you
remove (6), you will get these two projections:
- `ns.MyService.first.Foo` for (5)
- `ns.MyService.Foo` for (6)
Where (6) is the name chosen by the compiler.

## Notes on auto-exposure

You may wonder why the compiler does not reuse the namespace when
auto-exposing entities.  The reason is that the resulting auto-exposed names
could become _long_ names that don’t seem natural nor intuitive.  We chose to
expose the entity name because that’s what most developers want to do when
they manually expose entities.

## Other Notes

This message was called `duplicate-autoexposed` in cds-compiler v3 and earlier.
