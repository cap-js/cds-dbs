// make sure that in a localized scenario combined with a
// mixed-in where clause via a restrict annotation, all aliases
// are properly replaced in the on-conditions.

// the issue here was that we had a where condition like
// `where exists foo[id=1] or exists foo[id=2]`
// with `foo` being an association `foo : Association to one Foo on foo.ID = foo_ID;`.
// While building up the where exists subqueries, we calculate unique table aliases for `foo`,
// which results in a table alias `foo2` for the second condition of the initial where clause.
// Now, if we incorporate the on-condition into the where clause of the second where exists subquery,
// we must replace the table alias `foo` from the on-condition with `foo2`.

// the described scenario didn't work because in a localized scenario, the localized `foo`
// association (pointing to `localized.Foo`) was compared to the non-localized version
// of the association (pointing to `Foo`) and hence, the alias was not properly replaced
namespace db;

aspect cuid : {
   key ID : Int16;
}

entity Foo : cuid {
   text: localized String;
   owner         : Composition of many Owner
                      on owner.foo = $self;
   activeOwners  : Association to many ActiveOwner
                      on activeOwners.foo = $self;
   owner2        : Composition of many Owner2
                      on owner2.foo = $self;
   specialOwners : Association to many SpecialOwner2
                      on specialOwners.foo = $self;

   boos          : Association to many Boo
                      on boos.foo = $self;
}

entity ActiveOwner   as projection on Owner where validFrom <= $now
and                                               validTo   >= $now;

entity SpecialOwner2 as projection on Owner2 where validFrom <= $now
and                                                validTo   >= $now
and                                                isSpecial =  true;

entity Owner2 : cuid {
   foo       : Association to one Foo;
   owner2    : Association to one Employees;
   isSpecial : Boolean default false;
   validFrom : Date;
   validTo   : Date;
}

entity Owner : cuid {
   foo       : Association to one Foo;
   owner     : Association to one Employees;
   validFrom : Date;
   validTo   : Date;
}

entity Employees {
   key userID : String;
}

@cds.autoexpose
@restrict: [{
   grant : '*', to : 'admin', where : 'exists foo.specialOwners[owner2_userID = $user.id] or exists foo.activeOwners[owner_userID = $user.id]'
}]
entity Boo : cuid {
   foo_ID : UUID;
   text: localized String;
   foo    : Association to one Foo on foo.ID = foo_ID;
}
