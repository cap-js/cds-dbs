namespace complex.associations;

entity Books {
  key ID : Integer;
  title  : String(111);
  author : Association to Authors;
  name   : Association to Authors on $self.author.ID = name.ID;
}

entity Authors {
  key ID : Integer;
  name   : String(111);
  books  : Association to many Books on books.author = $self;
}
