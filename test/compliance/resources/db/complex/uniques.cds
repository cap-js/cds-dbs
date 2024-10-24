namespace complex.uniques;

entity Books {
  key ID : Integer;
  title  : String(111);
  pages  : Composition of many Pages on pages.book = $self;
}

@assert.unique: { number: [number, book] }
entity Pages {
  key ID : Integer;
  book   : Association to Books;
  number : Integer;
}
