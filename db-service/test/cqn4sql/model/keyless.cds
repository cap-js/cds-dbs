// path expressions along `Authors:author` are not possible
entity Books {
  key ID : Integer;
  title  : String;
  stock  : Integer;
  author : Association to Authors;
  authorWithExplicitForeignKey: Association to Authors { ID };
  my: Association to Books;
}

entity Authors {
  ID : Integer;
  name   : String;
  book: Association to Books;
  // backlink has no foreign keys...
  bookWithBackLink: Association to Books on bookWithBackLink.author = $self;
}
