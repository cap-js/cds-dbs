entity Books {
  key ID : Integer;
  title  : String(111);
  descr  : String(1111);
  author : Association to Authors; // on author.ID = $self.author_ID;
  // author_ID : UUID;
}

entity Authors {
  key ID : Integer;
  name   : String(111);
  books  : Association to many Books on books.author = $self;
}
