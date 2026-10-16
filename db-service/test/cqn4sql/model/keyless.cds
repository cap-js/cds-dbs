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

// Unmanaged associations whose target is a keyless entity: navigation works
// (the on-condition correlates on fields), but a path expression inside the
// association's filter cannot be rendered because the correlated subquery has
// no primary key of the target to correlate back on.
entity Keyless {
  field   : String;
  myField : String;
  toSelf  : Association to Keyless on toSelf.field = myField;
}

entity ToKeyless {
  myField  : String;
  toKeyless: Association to Keyless on toKeyless.field = myField;
}
