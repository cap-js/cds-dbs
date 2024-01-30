namespace complex;

entity Books {
  key ID : Integer;
  title  : String(111);
  author : Association to Authors;
}

entity Authors {
  key ID : Integer;
  name   : String(111);
  books  : Association to many Books on books.author = $self;
}


entity Root {
    key ID : Integer;
    children : Composition of many Child on children.parent = $self;
}

entity Child {
    key ID: Integer;
    parent: Association to one Root;
    children: Composition of many GrandChild on children.parent = $self
}

entity GrandChild {
    key ID: Integer;
    parent: Association to one Child;
}
