using { Currency, managed, sap } from '@sap/cds/common';

namespace bookshop;

type DerivedString: String;
type DerivedFromDerivedString: DerivedString;
type toAuthor: Association to Authors;
type toAuthorDerived: toAuthor;

entity Books : managed {
  key ID : Integer;
  anotherText: DerivedFromDerivedString;
  title  : localized String(111);
  descr  : localized String(1111);
  author : Association to Authors;
  coAuthor : toAuthorDerived;
  genre  : Association to Genres;
  stock  : Integer;
  price  : Decimal;
  currency : Currency;
  image : LargeBinary @Core.MediaType : 'image/png';
  dedication: {
    addressee: Association to Person;
    text: String;
    sub: {
      foo: String;
    };
    dedication: String; // same name as struct
  };
  coAuthor_ID_unmanaged: Integer;
  coAuthorUnmanaged: Association to Authors on $self.coAuthorUnmanaged.ID = $self.coAuthor_ID_unmanaged;
}

entity BooksWithWeirdOnConditions {
  key ID: Integer;
  foo: String;
  onlyOneRef: Association to BooksWithWeirdOnConditions on ID;
  oddNumber: Association to BooksWithWeirdOnConditions on foo / 5 + ID = ID + foo;
  oddNumberWithForeignKeyAccess: Association to many WithStructuredKey on oddNumberWithForeignKeyAccess.struct.mid.anotherLeaf = oddNumberWithForeignKeyAccess.struct.mid.leaf / oddNumberWithForeignKeyAccess.second;
  refComparedToVal: Association to BooksWithWeirdOnConditions on ID != 1;
  refComparedToValFlipped: Association to BooksWithWeirdOnConditions on 1 != ID;
}

entity Books.twin {
  key ID : Integer;
  author : Association to Authors;
  stock  : Integer;
  nonStreamableImage: cds.LargeBinary; // w/o a @Core.MediaType it is not a streamable item
  struct: {
    deepImage: cds.LargeBinary;
  }
}

entity DeepRecursiveAssoc {
  key ID: Integer;
  one: {
    two: {
      three: {
        toSelf: Association to DeepRecursiveAssoc;
      }
    }
  }
}

entity Foo {
  key ID: Integer;
  toFoo: Association to Foo;
  virtual virtualField: String;
  stru {
    u : Integer;
    virtual v : Integer;
    nested {
      nu : Integer;
      virtual nv : Integer;
    }
  }
}


entity Bar {
  key ID: Integer;
  stock: String;
  structure: {
    foo: Integer;
    baz: Integer;
  };
  nested: {
    foo: {
      x : Integer;
    };
    bar: KT;
  };
  note: String;
  createdAt: Date;
  struct1: {  // has only one element
    foo: Integer;
  };
  nested1: {  // has only one leaf element
    foo: {
      x : Integer;
    };
  };
}

entity EStruc {
  key ID: Integer;
  struc1: {
    foo: Integer;
    bar: Integer;
  };
  struc2: {
    foo: Integer;
    bar: Integer;
  };
  struc2Reversed: {
    bar: Integer;
    foo: Integer;
  };
  struc3: {
    oxx: Integer;
    foo: Integer;
  };
}
entity EStrucSibling {
  key ID: Integer;
  struc1: {
    deeper: {
      foo: Integer;
      bar: Integer;
    }
  };
  struc2: {
    foo: Integer;
    bar: Integer;
  };
  struc3: {
    oxx: Integer;
    foo: Integer;
  };
  struc4: {
    foo: Integer;
  };
  sibling: Association to EStruc;
  self: Association to EStrucSibling;
}


entity Baz {
  key id: Integer;
  parent_id: Integer;
  parent: Association to Baz on parent.id = parent_id or parent.id > 17;
}

entity WithStructuredKey {
  key struct: {
    mid : {
      leaf: Integer;
      anotherLeaf: Integer;
    }
  };
  key second : String;
}

entity AssocWithStructuredKey {
  key ID: Integer;
  toStructuredKey: Association to WithStructuredKey;
  accessGroup : Composition of AccessGroups;
}
entity Intermediate {
  key ID: Integer;
  toAssocWithStructuredKey: Association to AssocWithStructuredKey;
}
entity Person {
  key ID : Integer;
  name : String(111);
  dateOfBirth  : Date;
  dateOfDeath  : Date;
  placeOfBirth : String;
  placeOfDeath : String;
  address {
    street : String;
    city : String;
  };
}

entity Receipt {
  key number: Integer;
  total: Decimal;
}

entity Authors : managed, Person {
  books  : Association to many Books on books.author = $self;
}
entity AuthorsUnmanagedBooks : managed, Person {
  books  : Association to many Books on books.coAuthor_ID_unmanaged = ID;
}

/** Hierarchically organized Code List for Genres */
entity Genres : sap.common.CodeList {
  key ID   : Integer;
  parent   : Association to Genres;
  foo: Association to Foo;
  children : Composition of many Genres on children.parent = $self;
  descr : String;
  code : String;
}

entity Orders {
  key ID: UUID;
  items: composition of many {
    key pos: Integer;
  }
}

entity AssocAsKey {
  foo: String;
  key toAuthor: Association to Authors;
}


type KT  : { a : Integer; b : Integer; };
type KTA1 : { a : Integer; b : Association to AssocMaze1; };
type KTA3 : { a : Integer; b : Association to AssocMaze3; };

entity AssocMaze1 {
  key ID  : Integer;
  a_struc   : Association to AssocMaze2;
  // managed assocs with explicit aliased foreign keys look quite academic when written as source code like her,
  // but they automatically come into play when redirecting (explicitly or implicitly) mgd assocs and
  // renaming fields used as FK
  a_strucX  : Association to AssocMaze2 {a, b};
  a_strucY  : Association to AssocMaze2 {S_1, S_2};
  a_strucXA : Association to AssocMaze2 {S_1 as T_1, S_2 as T_2};
  a_assoc   : Association to AssocMaze3;
  a_assocY  : Association to AssocMaze2 {A_1, A_2};
  a_assocYA : Association to AssocMaze2 {A_1 as B_1, A_2 as B_2};
  a_strass  : Association to AssocMaze4;
  a_part    : Association to AssocMaze2 {A_1.a, S_2.b };

  strucX : KT;
  strucY : { S_1 : KT; S_2 : KT } ;
}

entity AssocMaze2 {
  key ID_1 { a : Integer; b : Integer; };
  key ID_2 : KT;
  S_1 { a : Integer; b : Integer; };
  S_2 : KT;
  A_1 { a : Integer; b : Association to AssocMaze1; };
  A_2 : KTA1;
  a : Integer;
  b : Integer;
  val : Integer;

  a_assocYA_back : Association to many AssocMaze1 on a_assocYA_back.a_assocYA = $self;
}

entity AssocMaze3 {
  key assoc1 : Association to AssocMaze2;
  key assoc2 : Association to AssocMaze2;
  val : Integer;
}

entity AssocMaze4 {
  key A_1 { a : Integer; b : Association to AssocMaze3; };
  key A_2 : KTA3;
  val : Integer;
}

entity SkippedAndNotSkipped {
  key ID: Integer;
  skipped: Association to Skip;
  self: Association to SkippedAndNotSkipped;
}

entity NotSkipped {
  key ID: Integer;
  skipped: Association to Skip;
  text: String;
}

@cds.persistence.skip: true
entity Skip {
  key ID: Integer;
  text: String;
  notSkipped: Association to NotSkipped;
}

@cds.localized: false
entity BP as projection on Books;
@cds.localized: true
entity BPLocalized as projection on Books;

entity SoccerTeams {
  key ID : Integer;
  goalKeeper: Composition of one SoccerPlayers on 
    goalKeeper.jerseyNumber = 1 and goalKeeper.team = $self;
}
entity SoccerPlayers {
  key jerseyNumber: Integer;
  name: String;
  team: Association to SoccerTeams;
}

entity TestPublisher {
  key ID : Integer;
  key publisher : Association to Publisher;
  key publisherRenamedKey : Association to Publisher { structuredKey.ID as notID };
  texts: Composition of TestPublisher.texts on texts.publisher.structuredKey.ID = publisher.structuredKey.ID;
  textsRenamedPublisher: Composition of TestPublisher.texts on textsRenamedPublisher.publisherRenamedKey.structuredKey.ID = publisherRenamedKey.structuredKey.ID;
}

entity TestPublisher.texts {
  key ID : Integer;
  key publisher: Association to Publisher;
  key publisherRenamedKey : Association to Publisher { structuredKey.ID as notID };
}

entity Publisher {
  key structuredKey {
    ID : UUID;
  }
  title : localized String;
}

aspect snapshot4Release {
  key snapshotHash : String default '0';
}
entity QualityDeviations : snapshot4Release {
  key ID                  : String;
  key batch_ID            : String(10);
  key material_ID         : String(40);
}
entity Batches : snapshot4Release {
  key ID                  : String;
  key material_ID         : String(40);
}
entity ReleaseDecisionTriggers : snapshot4Release {
  key ID                 : String;
  key batch_ID           : String(10);
  key batch_material_ID  : String(40);
}
entity WorklistItems : snapshot4Release {
  key ID : Integer;
  key releaseDecisionTrigger : Association to one ReleaseDecisionTriggers;
      releaseChecks          : Composition of many WorklistItem_ReleaseChecks // -> navigate to see what is further relevant config
                                   on  releaseChecks.parent.ID           = ID
                                   and releaseChecks.parent.snapshotHash = snapshotHash;
}
entity WorklistItem_ReleaseChecks : snapshot4Release {
  key ID : Integer;
  detailsDeviations : Association to many QualityDeviations
              on  detailsDeviations.material_ID  = parent.releaseDecisionTrigger.batch_material_ID
              and (
                      detailsDeviations.batch_ID = '*'
                  or detailsDeviations.batch_ID = parent.releaseDecisionTrigger.batch_ID
              )
              and detailsDeviations.snapshotHash = snapshotHash;
  parent : Association to one WorklistItems;
  }

entity DataRestrictions {
    key ID                          : String(255) not null;
        dataRestrictionAccessGroups : Composition of many DataRestrictionAccessGroups
                                          on dataRestrictionAccessGroups.dataRestriction = $self;

}


entity DataRestrictionAccessGroups {

    key dataRestrictionID : String(255) not null;
    key accessGroupID     : String(255) not null;
        dataRestriction   : Association to DataRestrictions
                                on dataRestriction.ID = dataRestrictionID;

        accessGroup       : Association to one AccessGroups
                                on accessGroup.ID = accessGroupID;
                              

}
entity AccessGroups {
    key ID : String(255) not null;
    description: localized String (255);
}

entity PartialStructuredKey {
  key struct: {
    one: Integer;
    two: Integer;
  };
  toSelf: Association to PartialStructuredKey { struct.one as partial}
}

  entity Reproduce {
    key ID : Integer;
    title : String(5000);
    author : Association to Authors;
    accessGroup : Composition of AccessGroups;
  }

entity Unmanaged {
  key struct: {
    leaf: Int16;
    toBook: Association to Books;
  };
  field: Integer;
  // needs to be expanded in join-conditions
  toSelf: Association to Unmanaged on struct = toSelf.struct;
}

entity Item {
  key ID: Integer;
  item: Association to Item;
}
