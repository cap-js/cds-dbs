// path expressions along `Books:author` are not possible

namespace keyless;
entity Books {
  key ID : Integer;
  title  : String;
  stock  : Integer;
  author : Association to Authors;
  authorName: String = author.name;
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
