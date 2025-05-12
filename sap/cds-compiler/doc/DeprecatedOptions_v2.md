# Deprecated Options and How to Avoid Them

__Important__: With compiler v3, these deprecated options were removed!

To ease the migration to CDS Compiler Version 2,
the compiler can be called with an option `deprecated`
which makes the compiler behave more like Compiler Version 1 for certain features.

As the name suggest, this option should be used only for a limited time.
The support for certain v1 features might also be dropped after a while
(without an increase of the compiler major version).

__When the `deprecated` option is set, the `beta` option is ignored,
and several new features are not available.__

The value of the option `deprecated` is a dictionary
mapping v1 feature names to (usually boolean) values.
This document lists all those features,
and describes what you can do instead of setting these features.


## Deprecated features influencing the name of generated entities

The `compile()` function generates entities in the following cases:

1. When an element in an entity is specified to be `localized`,
   it creates a __texts entity__ for that entity.
2. For managed composition of aspects,
   it creates a __target entity__ based on the provided target aspect.
3. A projection in a service is automatically generated
   for correspondingly tagged entities in the model (which is then “__auto-exposed__”)
   if an association/composition to the model entity is to be _implicitly redirected_
   to an exposed entity in the service and no such entity exists yet.

As a short example for 1 and 3 (2 is similar to 1):

```
entity my.Model.Base {
  key id: UUID;
  text: localized String;
}
service our.Service {
  entity Proj as projection on my.Model.Base;
}
```

The compiled model contains the following generated entities:

* the text entity `my.Model.Base.texts`,
  which is a composition target of the generated element `my.Model.Base:texts`
* the auto-exposed projection `our.Service.Proj.texts`
  which is a composition target of `our.Service.Proj:texts`

For the following subsections (and in general), it is important to understand that
you can define all auto-exposed entities yourself (well, they are not
_auto_-exposed anymore)
_without_ any difference in the compiled model
except for the sequence of entities in `‹csn›.definitions`.  
That means, you can append the following line to the above example:

```
@cds.autoexposed entity our.Service.Proj.texts as projection on my.Model.Base.texts;
```

The annotation `@cds.autoexposed` ensures that this self-exposed entity
really behaves exactly like an auto-exposed entity:

* it is only used as a direct redirection target, not as an indirect one
  (a detailed explanation of this topic is out-of-scope for this document),
* runtimes also attach a runtime semantics to the annotation `@cds.autoexposed`.

Thus, if you do not like the name of the generated auto-exposed entity,
you can simply __expose the model entity__ yourself and choose the name you like.
__Never ever__ define a projection on the auto-exposed entity,
which has worked in v1 versions and in the v2.1.x versions in certain situations.


### Deprecated `generatedEntityNameWithUnderscore`

With compiler v1,
the generated entities had no suffix starting with a `.` like `.texts` for texts entities,
but a suffix starting with a `_`.

If you have a reference to a generated entity in your model,
you now have to change the model accordingly.  
For example, if you had for v1

```
using { my.Model.Base, my.Model.Base_texts } from './myModel';
entity Root {
  key ID: UUID;
  base:   Association to Base;
  texts:  Association to Base_texts;
}
```

you now have to write for v2 (you see that it is usually actually simpler now)

```
using { my.Model.Base } from './myModel';
entity Root {
  key ID: UUID;
  base:   Association to Base;
  texts:  Association to Base.texts;
}
```

If you are a CSN consumer and analyse the compiled model, you might need
to adopt your code for the name change from `my.Model.Base_texts` to `my.Model.Base.texts`.

In the following areas, nothing will change:

* In the OData backend,
  the “new” `.`s are replaced by `_`s to make the names conform to the OData naming rules.  
  In other words, the EDMX (for the generated entities) looks the same as with v1.
* In the SQL/Hana backends,
  the “new” `.`s are also replaced by `_`s to adopt to HANA CDS naming restrictions
  (with the standard naming mode `plain`, all `.`s are replaced by `_`s anyway).  
  In other words, no texts table migration will take place.

But anyway, you might temporarily want to keep the v1 behavior
by setting the option `deprecated.generatedEntityNameWithUnderscore`.
If you do so, scoped definitions are not possible (like they aren't in v1).

### Deprecated `shortAutoexposed`

In compiler v1 without an option
(especially the v1 option `dependentAutoexposed` which basically leads the v2 default behavior),
the name for auto-exposed entities were constructed by
adding the name part after the last `.` to the service name.

That is, for the above example,
the auto-exposed projection on `my.Model.Base_texts` (in v1) is named
`our.Service.Base_texts` in v1.

You can temporarily enable that behavior in v2 by setting the options
`deprecated.generatedEntityNameWithUnderscore` and `deprecated.shortAutoexposed`.

If you just set `deprecated.shortAutoexposed`, you get `our.Service.Base.texts`.

If you really need that name (instead of the v2 name `our.Service.Proj.texts`),
you can expose the texts entity manually instead of setting the deprecated option:

```
@cds.autoexposed entity our.Service.Base.texts as projection on my.Model.Base.texts;
```

Again, never define a projection on the auto-exposed entity –
you get an error for that starting with compiler v2.2.0
(and earlier for certain definition sequences anyway, actually in v1 also).
