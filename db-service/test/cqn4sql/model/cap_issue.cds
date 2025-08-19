// here we gather special scenarios which came up through tickets
// which are not easily reproducible by our standard models

entity Foo {
    key ID : Int16;
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

entity Owner2 {
   key ID : Int16;
   foo       : Association to one Foo;
   owner2    : Association to one Employees;
   isSpecial : Boolean default false;
   validFrom : Date;
   validTo   : Date;
}

entity Owner {
   key ID : Int16;
   foo       : Association to one Foo;
   owner     : Association to one Employees;
   validFrom : Date;
   validTo   : Date;
}

entity Employees {
   key userID : String;
}

entity Boo {
   key ID : Int16;
   foo_ID : UUID;
   text: localized String;
   foo    : Association to one Foo on foo.ID = foo_ID;
}
