namespace search;

@cds.search: {
    author.name
}
entity Books {
  key ID : Integer;
  title: String;

  author : Association to Authors;
  coAuthor_ID_unmanaged: Integer;
  coAuthorUnmanaged: Association to Authors on coAuthorUnmanaged.ID = coAuthor_ID_unmanaged;
}

entity Authors {
  key ID : Integer;
  name: String;
  books: Association to Books on books.author = $self;
}
