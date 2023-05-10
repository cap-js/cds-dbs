namespace a2j;

entity Header {
  key id : Integer;
  key id2 : Integer;
  elt: String(100);
  toItem_selfMgd : Association to many Item on $self.toItem_selfMgd.toHeader = $self;
  toItem_selfUmgd : Association to many Item on
    ((($self.toItem_selfUmgd.toHeaderUnmanaged = $self)));
  toItem_combined: association to Item on
    (toItem_combined.toHeader = $self OR toItem_combined.toHeaderUnmanaged = $self) and 5 != 4;
  toItem_fwd: association to Item on id = toItem_fwd.id;
}

entity Item {
  key id : Integer;
  elt2: String(100);
  toHeader: Association to one Header;
  toHeaderUnmanaged: association to Header on elt2 = toHeaderUnmanaged.elt;
}

entity Folder {
  key id: Integer;
  nodeCompanyCode: association to Folder;
  assignments: composition of Assignment on $self = assignments.toFolder;
  };

  entity Assignment {
  key id: Integer;
  toFolder: association to Folder;
  data: String;
  };

  entity E {
  key id: String;
  key toF: association to F;
  data: String;
  };

  entity F {
    key id: String;
    // toE.id requires forwardAssocPathStep to be restored after converting ON cond of toF
    toE: association to E on $self = toE.toF and toE.id = $user.id;
  };

  entity Foo {
    key ID : Integer;
    bar : Association to Bar;
    barRenamed : Association to Bar { ID as renameID, foo };
    buz : Composition of many Buz
            on buz.bar = bar
            and buz.foo.ID = ID;
    buzUnmanaged : Composition of many Buz
            on buzUnmanaged.bar.foo.ID = bar.foo.ID
            and buzUnmanaged.bar.ID = bar.ID
            and buzUnmanaged.foo.ID = ID;
    buzRenamed : Composition of many Buz
            on buzRenamed.barRenamed = barRenamed
            and buzRenamed.foo.ID = ID;
  }

  entity Bar {
    key ID : String;
    key foo : Association to Foo;
    buz : Composition of many Buz
            on buz.bar = $self;
  }

  entity Buz {
    key ID : String;
    key bar : Association to Bar;
    key barRenamed : Association to Bar { ID as renameID, foo };
    foo : Association to Foo;
  }
